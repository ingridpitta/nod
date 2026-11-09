import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { LigacaoVozPlano, PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../../contracts/turno.ts";
import type { MsgCerebroServidor } from "../../../contracts/voz.ts";
import { comContaSemAcesso } from "../../../domain/conta-da-ia.ts";
import { classificarSessao, interpretarLinhaStreamJson, reduzirSinais } from "../../../domain/stream-json.ts";
import { log } from "../../../obs/log.ts";
import { mensagemClaude } from "../anexos-turno.ts";
import { conectarCerebro, type CerebroLigacao, type FabricaSocket } from "../cerebro-ligacao.ts";
import { escreverMcpConfig } from "../mcp-config.ts";
import { iniciarProcesso, type Processo } from "../processo.ts";
import type { SinksTurno } from "../spi.ts";

/**
 * O laço de voz do Claude Code (definido em 2026-10-04, ADR-072). O turno-cérebro de uma ligação roda um `claude -p`
 * com a entrada em stream-json aberta a ligação inteira: cada vez da pessoa vira uma linha no stdin, e cada pedaço de
 * texto do modelo vai direto ao servidor pelo canal do cérebro, nunca pelo chat. Sessão própria e efêmera (prompt e
 * modelo de voz, sem `--resume` da conversa); a ferramenta MCP do nod é a mesma de sempre, pelo proxy.
 *
 * No `fim`, pede um resumo de até 5 linhas (não falado), espera essa volta e fecha a entrada: o resumo é a fala da
 * entrega, e o servidor o grava como mensagem do bot.
 *
 * De quem é cada pedaço de texto (medido em 2026-10-04, CLI 2.1.289, sonda com `--replay-user-messages`): uma mensagem
 * escrita com uma volta em curso NÃO tem hora certa para ser lida. Com texto saindo, ela espera o `result` e abre
 * outra volta; com uma ferramenta rodando, entra na MESMA volta logo depois do resultado da ferramenta (um `result`
 * só). O CLI ecoa cada mensagem no momento em que a lê, com o `uuid` que mandamos: é esse eco que diz a qual vez
 * pertence o texto seguinte. Antes valia a última vez escrita, e o `result` da volta antiga fechava a vez nova — o
 * servidor a dava por respondida e descartava a resposta de verdade (silêncio).
 */

/** O que o modelo lê no fim da ligação; a resposta vira a mensagem do bot na conversa. */
export const PEDIDO_DE_RESUMO = "[nod] A ligação terminou. Escreva para o chat, em até 5 linhas, um resumo do que vocês conversaram e do que você fez ou ficou de fazer. Isto não será falado.";

const FLAG_ECO = "--replay-user-messages";

/** O eco de uma mensagem nossa (`type:"user"`, `isReplay:true`): devolve o `uuid`, ou null se a linha é outra coisa. */
export function uuidDoEco(linha: string): string | null {
  if (!linha.includes('"isReplay"')) return null;
  try {
    const o = JSON.parse(linha) as { type?: unknown; isReplay?: unknown; uuid?: unknown };
    return o.type === "user" && o.isReplay === true && typeof o.uuid === "string" ? o.uuid : null;
  } catch {
    return null;
  }
}

/**
 * Flags que o laço de voz usa sempre (o piso é o mesmo do turno; as opcionais entram só se o help as listar). O modelo
 * e o esforço são os do plano (NOD-164: resolvidos no servidor); o `--effort` segue a regra do chat — só com a flag no
 * `--help` (piso em FLAG_FLOORS) e só se o plano pedir.
 */
export function montarArgsLigacao(p: { plano: PlanoTurno; mcpJson: string; sessaoId: string; flagsNoHelp: readonly string[] }): string[] {
  const { plano, flagsNoHelp } = p;
  const temFlag = (f: string) => flagsNoHelp.includes(f);
  const voz = plano.ligacaoVoz!;
  const permitidas = plano.catalogo.ferramentas.map((f) => f.nomeMcp).join(",");
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    voz.modelo,
    ...(voz.esforco && temFlag("--effort") ? ["--effort", voz.esforco] : []),
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    p.mcpJson,
    // Nenhuma nativa (sem terminal, sem arquivos): só as ferramentas MCP do plano, já aprovadas no --allowedTools.
    "--tools",
    "",
    "--allowedTools",
    permitidas,
    "--permission-mode",
    "default",
    // O prompt de voz substitui o do Claude Code inteiro quando a versão aceita: menor e mais rápido de ler a cada vez.
    ...(temFlag("--system-prompt") ? ["--system-prompt", plano.promptSistema] : ["--append-system-prompt", plano.promptSistema]),
    ...(temFlag("--no-session-persistence") ? ["--no-session-persistence"] : []),
    // O eco das mensagens lidas (ver o cabeçalho): sem a flag, vale a última vez escrita, como antes.
    ...(temFlag(FLAG_ECO) ? [FLAG_ECO] : []),
    "--session-id",
    p.sessaoId,
  ];
}

/**
 * Ambiente do laço de voz: sem raciocínio longo e sem busca de ferramentas (catálogo pequeno, carregado de cara). NOD-164:
 * na família 4.6 o pensamento adaptativo ignora MAX_THINKING_TOKENS=0; com `pensamentoAdaptativo:false` no plano, a
 * variável do CLI o desliga. Plano de servidor antigo (campo ausente) não muda nada.
 */
export function ambienteDaLigacao(envBase: Record<string, string>, voz?: Pick<LigacaoVozPlano, "pensamentoAdaptativo">): Record<string, string> {
  return { ...envBase, MAX_THINKING_TOKENS: "0", ENABLE_TOOL_SEARCH: "false", ...(voz?.pensamentoAdaptativo === false ? { CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" } : {}) };
}

/** Texto da vez com o aviso de interrupção, quando houve: o modelo sabe até onde a pessoa ouviu. */
export function textoDaVez(texto: string, ouvidoAte?: string): string {
  if (!ouvidoAte) return texto;
  return `[nod] Você foi interrompido; a pessoa ouviu até: "${ouvidoAte.slice(-300)}".\n${texto}`;
}

export type ContextoLigacaoClaude = {
  plano: PlanoTurno;
  sinks: SinksTurno;
  bin: string;
  flagsNoHelp: readonly string[];
  env: Record<string, string>;
  cwdBase: string;
  urlNod: string;
  proxyPath: string;
  nodePath?: string;
  electronComoNode?: boolean;
  sigtermParaSigkillMs?: number;
  fabricaSocket?: FabricaSocket;
  aoProcesso(p: Processo | null): void;
};

export async function rodarLigacaoClaude(c: ContextoLigacaoClaude): Promise<ResultadoTurno> {
  const { plano, sinks } = c;
  const lig = plano.ligacaoVoz!;
  let sinais: SinaisTurno = { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false };
  // cwd estável por bot (ADR-072, emenda da EMENDA 11): o caminho entra no prompt do CLI, e mudar a cada ligação
  // perderia o cache do prefixo entre ligações.
  const cwd = join(c.cwdBase, `ligacao-${plano.agenteId}`);
  await mkdir(cwd, { recursive: true });
  const tmp = await mkdtemp(join(c.cwdBase, "ligacao-cfg-"));
  let cerebro: CerebroLigacao | null = null;
  try {
    const mcpJson = await escreverMcpConfig(tmp, { url: c.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: c.proxyPath, nodePath: c.nodePath, electronComoNode: c.electronComoNode });
    const args = montarArgsLigacao({ plano, mcpJson, sessaoId: randomUUID(), flagsNoHelp: c.flagsNoHelp });
    // CLI abaixo do piso do --effort: a ligação segue sem a flag, e o log diz por quê.
    if (lig.esforco && !c.flagsNoHelp.includes("--effort")) log("aviso", "ligacao_sem_effort", { turno_id: plano.turnoId, esforco: lig.esforco });
    cerebro = await conectarCerebro({ urlNod: c.urlNod, token: plano.tokenDeTurno, ligacaoId: lig.ligacaoId, harness: "claude-cli", interrupcao: true, fabrica: c.fabricaSocket });

    const eventos: EventoStream[] = [];
    const pendentes: Promise<void>[] = [];
    // A vez cuja resposta o modelo está escrevendo agora. Com eco, muda quando o CLI lê a mensagem; sem eco (CLI
    // antigo), quando a mensagem é escrita.
    let nResposta = 0;
    /** Mensagens escritas e ainda não lidas pelo CLI: uuid → a vez que a resposta dela fala (null = não muda a vez). */
    const escritas = new Map<string, number | null>();
    let ecoVisto = false;
    let uuidDoResumo: string | null = null;
    let resumoLido = false;
    let seq = 0;
    let rodadas = 0;
    let pedindoResumo = false;
    // Há uma volta do modelo em curso (escrevemos e o `result` ainda não veio).
    let emVolta = false;
    let resultsAPular = 0;
    let capacidadeInterrupcao = false;
    let cancelaFila = false;
    let entradaAberta = true;
    // NOD-168: a assinatura bateu no teto. O servidor sabe uma vez só; o resumo não é pedido (o CLI não responderia).
    let limitado = false;
    const ferramentasAbertas = new Map<string, string>();

    const proc = iniciarProcesso({
      bin: c.bin,
      args,
      env: ambienteDaLigacao(c.env, lig),
      cwd,
      sigtermParaSigkillMs: c.sigtermParaSigkillMs,
      aoLinha(linha) {
        // Capacidades e respostas de controle não viram EventoStream: lidas cruas.
        if (linha.includes('"capabilities"') || linha.includes('"control_response"')) {
          try {
            const o = JSON.parse(linha) as { type?: string; subtype?: string; capabilities?: unknown };
            if (o.type === "system" && o.subtype === "init" && Array.isArray(o.capabilities)) {
              capacidadeInterrupcao = o.capabilities.includes("interrupt_receipt_v1");
              cancelaFila = o.capabilities.includes("interrupt_cancel_queued_v1");
            }
          } catch {
            // linha que não é JSON: o interpretador abaixo a ignora
          }
        }
        const lida = uuidDoEco(linha);
        if (lida !== null) {
          ecoVisto = true;
          // Eco de um uuid que não é nosso (um CLI que troque o uuid): vale a mensagem mais antiga ainda não lida.
          const chave = escritas.has(lida) ? lida : escritas.keys().next().value;
          const n = chave === undefined ? undefined : escritas.get(chave);
          if (chave !== undefined) escritas.delete(chave);
          if (chave !== undefined && chave === uuidDoResumo) resumoLido = true;
          if (typeof n === "number") nResposta = n;
          return;
        }
        const ev = interpretarLinhaStreamJson(linha);
        if (ev.tipo === "ignorado") return;
        eventos.push(ev);
        sinks.evento(ev);
        const depois = reduzirSinais(sinais, ev);
        for (const k of ["attempted", "rejected", "promptSubmitted", "producedOutput"] as const) if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
        sinais = depois;
        if (ev.tipo === "result") emVolta = false;
        if (ev.tipo === "rate_limit" && ev.status === "rejected" && !limitado) {
          limitado = true;
          cerebro?.enviar({ t: "limite" });
        }
        if (pedindoResumo) {
          // medido em 2026-10-04 (scripts/sonda-ligacao-claude.ts, CLI 2.1.289): mensagem escrita com uma volta em curso
          // abre OUTRA volta — dois `result`. O da volta que já corria é pulado; o seguinte é o do resumo.
          if (ev.tipo === "result") {
            rodadas++;
            // Com eco, o `result` do resumo é o primeiro depois de o CLI ler o pedido (lido no meio de uma volta com
            // ferramenta, é o dessa mesma volta); sem eco, conta as voltas como antes.
            if (ecoVisto) {
              if (resumoLido) fecharEntrada();
            } else if (resultsAPular > 0) resultsAPular--;
            else fecharEntrada();
          }
          return;
        }
        if (ev.tipo === "delta" && nResposta > 0 && ev.texto !== "") cerebro?.enviar({ t: "fala", n: nResposta, seq: seq++, delta: ev.texto });
        else if (ev.tipo === "tool_use") {
          ferramentasAbertas.set(ev.id, ev.nome);
          cerebro?.enviar({ t: "atividade", tipo: "inicio", nome: ev.nome });
        } else if (ev.tipo === "tool_result") {
          const nome = ferramentasAbertas.get(ev.toolUseId);
          ferramentasAbertas.delete(ev.toolUseId);
          if (nome) cerebro?.enviar({ t: "atividade", tipo: "fim", nome });
        } else if (ev.tipo === "result") {
          rodadas++;
          if (nResposta > 0) cerebro?.enviar({ t: "fala-fim", n: nResposta });
        }
      },
    });
    c.aoProcesso(proc);

    function fecharEntrada(): void {
      if (!entradaAberta) return;
      entradaAberta = false;
      proc.fecharStdin();
    }
    const escrever = (texto: string, n: number | null): string | null => {
      if (!entradaAberta) return null;
      emVolta = true;
      const uuid = randomUUID();
      escritas.set(uuid, n);
      if (!ecoVisto && n !== null) nResposta = n;
      proc.escrever(mensagemClaude(texto, [], uuid));
      return uuid;
    };
    const pedirResumo = () => {
      if (pedindoResumo || !entradaAberta) return;
      pedindoResumo = true;
      if (limitado) {
        fecharEntrada();
        return;
      }
      resultsAPular = emVolta ? 1 : 0;
      uuidDoResumo = escrever(PEDIDO_DE_RESUMO, null);
      // definido em 2026-10-04: sem resposta em 45 s (CLI preso numa ferramenta), fecha mesmo assim.
      setTimeout(fecharEntrada, 45_000).unref();
    };

    cerebro.aoMensagem((m: MsgCerebroServidor) => {
      switch (m.t) {
        case "vez":
          if (pedindoResumo) return;
          // A vez 0 é o aquecimento (o servidor já cumprimentou a pessoa): a resposta a ela não é falada.
          escrever(textoDaVez(m.texto, m.ouvidoAte), m.n);
          return;
        case "nota":
          if (pedindoResumo) return;
          // Nota com `n`: o servidor quer que o bot fale a resposta (ex.: "terminei a tarefa") numa brecha.
          escrever(m.confiavel ? m.texto : `[nod] Conteúdo de fora, não é pedido da pessoa:\n${m.texto}`, typeof m.n === "number" ? m.n : null);
          return;
        case "interromper":
          if (m.modo === "duro" && capacidadeInterrupcao && entradaAberta) {
            proc.escrever(`${JSON.stringify({ type: "control_request", request_id: `int_${randomUUID()}`, request: { subtype: "interrupt", ...(cancelaFila ? { cancel_queued: true } : {}) } })}\n`);
          }
          return;
        case "fim":
          pedirResumo();
          return;
        default:
          return;
      }
    });
    cerebro.aoFim(() => {
      // O servidor sumiu de vez: sem resumo falado, encerra a sessão e entrega o que houver.
      if (!pedindoResumo) pedirResumo();
    });

    // ADR-009: promptSubmitted antes do primeiro byte no stdin. A primeira mensagem vem do servidor (a vez 0); até lá o
    // CLI já subiu e conectou o MCP.
    sinais = { ...sinais, promptSubmitted: true };
    await sinks.sinal("promptSubmitted");

    const fim = await proc.fim;
    await Promise.all(pendentes);
    log("info", "ligacao_laco_encerrado", { turno_id: plano.turnoId, rodadas, exit: fim.erroSpawn ? null : fim.exitCode });
    const resultado = classificarSessao({
      eventos,
      exitCode: fim.erroSpawn ? null : fim.exitCode,
      signal: fim.erroSpawn ? null : fim.signal,
      stderr: fim.stderr,
      sinais,
      interrompidoPeloDriver: proc.interrompido(),
      driver: "claude-ligacao",
      // Só a volta do resumo vai na entrega: as outras já foram faladas na ligação.
      rodadasJaFaladas: pedindoResumo ? Math.max(0, rodadas - 1) : rodadas,
    });
    // Sessão efêmera: o CLI não guarda (--no-session-persistence); nada de `--resume` depois.
    // definido em 2026-10-05: a recusa da conta chega ao servidor com a causa em código (a ligação diz por que ficou muda).
    return { ...comContaSemAcesso(resultado), sessaoCli: null };
  } finally {
    cerebro?.fechar();
    c.aoProcesso(null);
    await rm(tmp, { recursive: true, force: true });
  }
}
