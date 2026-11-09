import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno, TokensTurno } from "../../../contracts/turno.ts";
import type { MsgCerebroServidor } from "../../../contracts/voz.ts";
import { ESFORCO_LIGACAO_CODEX, pedidoThreadStart, pedidoTurnStart, type EventoAppServer, type SandboxCodex } from "../../../domain/codex-app-server.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { classificarResultado, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { log } from "../../../obs/log.ts";
import { conectarCerebro, type CerebroLigacao, type FabricaSocket } from "../cerebro-ligacao.ts";
import type { Processo } from "../processo.ts";
import type { SinksTurno } from "../spi.ts";
import { PEDIDO_DE_RESUMO, textoDaVez } from "./claude-ligacao.ts";
import { criarClienteAppServer } from "./cliente-app-server.ts";
import { configMcpCodex, escreverLauncherProxy, overridesIsolamentoCodex, overridesTerminalCodex, SEM_RECUSADAS, type RecusadasCodex } from "./codex-comum.ts";

/**
 * O laço de voz do Codex (definido em 2026-10-04, ADR-076), no molde do de Claude (ADR-072). O turno-cérebro de uma
 * ligação com bot de Codex sobe um `codex app-server` (JSON-RPC por linha no stdio) aberto a ligação inteira, numa
 * thread efêmera com as instruções de voz e o modelo de voz. Cada vez da pessoa vira `turn/start` (ou `turn/steer`, se
 * um turno ainda corre); cada `item/agentMessage/delta` vai direto ao servidor pelo canal do cérebro como `fala`.
 *
 * O `codex exec` não serve aqui: não tem deltas e é um processo por fala (pesquisa de 2026-10-04). O app-server é
 * marcado EXPERIMENTAL pela OpenAI; este laço só foi exercitado contra o app-server falso (ADR-076).
 *
 * No `fim`, interrompe o turno em curso, pede o mesmo resumo de até 5 linhas do Claude e, quando esse turno conclui,
 * fecha a entrada: o resumo é a fala da entrega.
 */

/** Flags do `app-server` que entram só se o help da versão instalada as listar (as do `exec` valem lá; aqui, não se sabe). */
export const FLAGS_OPCIONAIS_APP_SERVER = ["--ignore-user-config", "--ignore-rules", "--strict-config"] as const;

/** definido em 2026-10-04: prazo do handshake (initialize + thread/start). Não é relógio de trabalho (ADR-067): só o subir. */
const PRAZO_HANDSHAKE_MS = 30_000;
/** definido em 2026-10-04: depois do resumo, o tempo que o app-server tem para sair sozinho com o stdin fechado. */
const SAIDA_APOS_RESUMO_MS = 2_000;

/**
 * argv do app-server. As chaves `-c` vão ANTES do subcomando (são do `codex` raiz e chegam a qualquer subcomando); a
 * config do MCP aponta para o launcher 0600, e o token do turno nunca entra aqui.
 */
export function argsAppServer(p: { configMcp: string; flagsNoHelp: readonly string[]; recusadas?: RecusadasCodex; sandbox?: SandboxCodex; terminal?: { hooks: string; argMcp: string; mcpDaPessoa: boolean } }): string[] {
  // ADR-103: com o kit do terminal, sem sandbox (como o Claude, ADR-055), o hook do nod no lugar do isolamento e o MCP do
  // nod junto dos da pessoa nos modos dela. Sem ele, o isolamento de sempre.
  if (p.terminal) {
    return [
      "-c", p.terminal.argMcp, "-c", 'approval_policy="never"', "-c", 'sandbox_mode="danger-full-access"', "-c", p.terminal.hooks,
      ...overridesTerminalCodex({ mcpDaPessoa: p.terminal.mcpDaPessoa, recusadas: p.recusadas }).flatMap((o) => ["-c", o]),
      "app-server",
      ...FLAGS_OPCIONAIS_APP_SERVER.filter((f) => p.flagsNoHelp.includes(f)),
    ];
  }
  return [
    // definido em 2026-10-07 (ADR-083 §6): o chat com projeto autorizado escreve na pasta, como o `codex exec`.
    "-c", `mcp_servers=${p.configMcp}`, "-c", 'approval_policy="never"', "-c", `sandbox_mode="${p.sandbox ?? "read-only"}"`,
    ...overridesIsolamentoCodex(p.recusadas ?? SEM_RECUSADAS).flatMap((o) => ["-c", o]),
    "app-server",
    ...FLAGS_OPCIONAIS_APP_SERVER.filter((f) => p.flagsNoHelp.includes(f)),
  ];
}

export type ContextoLigacaoCodex = {
  plano: PlanoTurno;
  sinks: SinksTurno;
  bin: string;
  /** Flags que `codex app-server --help` listou (as opcionais entram só se estiverem aqui). */
  flagsNoHelp: readonly string[];
  /** Chaves de config que a versão instalada recusou (negociadas na sonda do driver); ausente = nenhuma. */
  recusadas?: RecusadasCodex;
  /** Ambiente já filtrado (`ambienteCodex`). */
  env: Record<string, string>;
  cwdBase: string;
  urlNod: string;
  proxyPath: string;
  nodePath?: string;
  electronComoNode?: boolean;
  sigtermParaSigkillMs?: number;
  versaoNod?: string;
  fabricaSocket?: FabricaSocket;
  aoProcesso(p: Processo | null): void;
};

export async function rodarLigacaoCodex(c: ContextoLigacaoCodex): Promise<ResultadoTurno> {
  const { plano, sinks } = c;
  const lig = plano.ligacaoVoz!;
  let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
  // cwd estável por bot, como no Claude (ADR-072): o caminho entra no contexto do modelo.
  const cwd = join(c.cwdBase, `ligacao-${plano.agenteId}`);
  await mkdir(cwd, { recursive: true });
  const dir = await mkdtemp(join(c.cwdBase, "ligacao-codex-"));
  let cerebro: CerebroLigacao | null = null;
  let timerSaida: ReturnType<typeof setTimeout> | null = null;
  try {
    const launcher = await escreverLauncherProxy(dir, { urlNod: c.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: c.proxyPath });
    const configMcp = configMcpCodex(plano, { urlNod: c.urlNod, proxyPath: launcher, nodePath: c.nodePath, electronComoNode: c.electronComoNode }, c.recusadas);
    const args = argsAppServer({ configMcp, flagsNoHelp: c.flagsNoHelp, recusadas: c.recusadas });

    // Só o que compõe a entrega: as ferramentas da ligação inteira e o turno do resumo. As falas já foram ditas.
    const eventos: EventoStream[] = [];
    const pendentes: Promise<void>[] = [];
    // O que chegou enquanto um turno subia (ou que o steer não alcançou), com a vez a que responde.
    let fila: { texto: string; n: number }[] = [];
    /** A vez mais recente da pessoa (a vez 0 é o aquecimento e nunca é falada). */
    let nResposta = 0;
    /** A vez que o turno em curso responde: a dele ao abrir, a da fala nova quando um steer é aceito. */
    let nDoTurno = 0;
    let seq = 0;
    // Mudado só dentro dos callbacks: a anotação por `as` evita o TS estreitar para "nao" no fim da função.
    let resumo = "nao" as "nao" | "pedido" | "rodando" | "feito";
    const resumoDeltas: string[] = [];
    const resumoBlocos: string[] = [];
    let resumoOk = false;
    // NOD-174: o que o Codex disse de errado (evento `error` ou `turn/completed` com falha), para o `erroCru` do desfecho.
    let ultimoErro: string | null = null;
    let tokens: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
    let negados = 0;
    const ferramentasAbertas = new Map<string, string>();
    /** NOD-167: as notificações que o laço não conhece, logadas uma vez cada (só o nome, nunca o conteúdo). */
    const ignorados = new Set<string>();

    const emitir = (ev: EventoStream, compoeEntrega: boolean) => {
      if (compoeEntrega) eventos.push(ev);
      sinks.evento(ev);
      const depois = reduzirSinais(sinais, ev);
      for (const k of ["attempted", "rejected", "promptSubmitted", "producedOutput"] as const) if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
      sinais = depois;
    };

    // definido em 2026-10-07 (ADR-083, S4): o JSON-RPC, a máquina do turno e a recusa dos pedidos do servidor moram no
    // cliente compartilhado com o chat do Codex; aqui fica só o que é da voz (as vezes, o resumo, o canal do cérebro).
    const cliente = criarClienteAppServer({
      bin: c.bin,
      args,
      env: c.env,
      cwd,
      sigtermParaSigkillMs: c.sigtermParaSigkillMs,
      aoEvento: tratar,
      aoTurnoConcluido(ev) {
        ultimoErro = ev.erro ?? ultimoErro;
        if (resumo === "rodando") {
          resumo = "feito";
          resumoOk = ev.status === "completed";
          return encerrar();
        }
        if (nDoTurno > 0) cerebro?.enviar({ t: "fala-fim", n: nDoTurno });
        return seguir();
      },
      aoNegado(metodo) {
        negados++;
        log("aviso", "codex_ligacao_pedido_negado", { turno_id: plano.turnoId, metodo: metodo.slice(0, 80) });
      },
    });
    const proc = cliente.processo;
    c.aoProcesso(proc);

    const encerrar = () => {
      if (cliente.fechando()) return;
      cliente.fechar();
      timerSaida = setTimeout(() => void proc.interromper(), SAIDA_APOS_RESUMO_MS);
    };

    const iniciarTurno = (texto: string, n: number) => {
      nDoTurno = n;
      cliente.iniciarTurno((id, threadId) => pedidoTurnStart(id, { threadId, texto, esforco: ESFORCO_LIGACAO_CODEX }), (id, r) => {
        if (id === null) {
          log("aviso", "codex_ligacao_turno_recusado", { turno_id: plano.turnoId, codigo: r.tipo === "resposta_erro" ? r.codigo : null });
          if (resumo === "rodando") {
            resumo = "feito";
            return encerrar();
          }
          if (nDoTurno > 0) cerebro?.enviar({ t: "fala-fim", n: nDoTurno });
          return seguir();
        }
        if (resumo === "pedido") return cliente.interromperTurno();
        const juntos = fila;
        fila = [];
        for (const f of juntos) entregar(f.texto, f.n);
      });
    };

    /** O que fazer quando não há turno: o resumo pedido, ou o que chegou enquanto o anterior corria. */
    const seguir = () => {
      if (resumo === "pedido") {
        resumo = "rodando";
        return iniciarTurno(PEDIDO_DE_RESUMO, 0);
      }
      if (fila.length > 0) {
        const juntos = fila;
        fila = [];
        iniciarTurno(juntos.map((f) => f.texto).join("\n\n"), Math.max(...juntos.map((f) => f.n)));
      }
    };

    const entregar = (texto: string, n: number) => {
      const turno = cliente.turno();
      if (turno.estado === "livre") return iniciarTurno(texto, n);
      if (turno.estado === "iniciando") return void fila.push({ texto, n });
      cliente.steer(texto, (aceito) => {
        // Aceito: daqui em diante o turno responde a fala nova.
        if (aceito) return void (nDoTurno = n);
        // O turno acabou (ou não aceita steer) antes de a fala chegar: ela abre o próximo.
        if (cliente.turno().estado === "livre") iniciarTurno(texto, n);
        else fila.push({ texto, n });
      });
    };

    const pedirResumo = () => {
      if (resumo !== "nao") return;
      fila = [];
      resumo = "pedido";
      if (cliente.turno().estado === "livre") return seguir();
      cliente.interromperTurno();
    };

    function tratar(ev: EventoAppServer): void {
      switch (ev.tipo) {
        case "delta":
          if (resumo === "rodando") {
            resumoDeltas.push(ev.texto);
            emitir({ tipo: "delta", texto: ev.texto }, false);
            return;
          }
          if (nDoTurno > 0 && ev.texto !== "") cerebro?.enviar({ t: "fala", n: nDoTurno, seq: seq++, delta: ev.texto });
          emitir({ tipo: "delta", texto: ev.texto }, false);
          return;
        case "item":
          if (ev.texto !== null && resumo === "rodando") resumoBlocos.push(ev.texto);
          if (!ev.ferramenta || !ev.itemId) return;
          if (ev.fase === "inicio") {
            ferramentasAbertas.set(ev.itemId, ev.ferramenta);
            cerebro?.enviar({ t: "atividade", tipo: "inicio", nome: ev.ferramenta });
            emitir({ tipo: "tool_use", id: ev.itemId, nome: ev.ferramenta, input: null }, true);
          } else {
            const nome = ferramentasAbertas.get(ev.itemId);
            ferramentasAbertas.delete(ev.itemId);
            if (nome) cerebro?.enviar({ t: "atividade", tipo: "fim", nome });
            emitir({ tipo: "tool_result", toolUseId: ev.itemId, isError: ev.falhou, texto: "" }, true);
          }
          return;
        case "uso":
          tokens = { ...ev.tokens, cacheCriacao: 0 };
          return;
        case "erro":
          ultimoErro = ev.mensagem ?? ultimoErro;
          log("aviso", "codex_ligacao_erro_servidor", { turno_id: plano.turnoId, vai_repetir: ev.vaiRepetir });
          return;
        case "ignorado":
          if (ev.metodo !== undefined && !ignorados.has(ev.metodo) && ignorados.size < 50) {
            ignorados.add(ev.metodo);
            log("info", "codex_ligacao_notificacao_ignorada", { turno_id: plano.turnoId, metodo: ev.metodo });
          }
          return;
        default:
          return;
      }
    }

    // Handshake: initialize → initialized → thread/start. O processo que morre ou não responde no prazo derruba o turno.
    try {
      await cliente.abrirThread({ versaoNod: c.versaoNod ?? "0", prazoMs: PRAZO_HANDSHAKE_MS, threadStart: (id) => pedidoThreadStart(id, { modelo: lig.modelo, instrucoes: plano.promptSistema, cwd }) });
    } catch (e) {
      throw new ErroDeDominio("executor_indisponivel", { cause: e instanceof Error ? e.message : "handshake" });
    }
    emitir({ tipo: "init", sessaoCli: null, ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp), modelo: lig.modelo, versaoCli: "codex-app-server", apiKeySource: "none" }, true);

    // ADR-009: promptSubmitted antes da primeira fala no stdin (o init acima já o marca; aqui é awaited).
    await Promise.all(pendentes);
    cerebro = await conectarCerebro({ urlNod: c.urlNod, token: plano.tokenDeTurno, ligacaoId: lig.ligacaoId, harness: "codex-cli", interrupcao: true, fabrica: c.fabricaSocket });
    cerebro.aoMensagem((m: MsgCerebroServidor) => {
      switch (m.t) {
        case "vez":
          if (resumo !== "nao") return;
          // A vez 0 é o aquecimento (o servidor já cumprimentou a pessoa): a resposta a ela não é falada.
          nResposta = m.n;
          entregar(textoDaVez(m.texto, m.ouvidoAte), m.n);
          return;
        case "nota":
          if (resumo !== "nao") return;
          // O aviso não é uma vez nova: a resposta a ele sai como a da vez mais recente.
          entregar(m.confiavel ? m.texto : `[nod] Conteúdo de fora, não é pedido da pessoa:\n${m.texto}`, nResposta);
          return;
        case "interromper":
          if (m.modo !== "duro") return;
          // NOD-167: a vez sem resposta pode ser justo um turn/start que demorou a voltar; ao voltar, já interrompe.
          cliente.interromperTurno({ aoAbrir: true });
          return;
        case "fim":
          pedirResumo();
          return;
        default:
          return;
      }
    });
    cerebro.aoFim(() => {
      // O servidor sumiu de vez: sem fala, encerra com o resumo e entrega o que houver.
      pedirResumo();
    });

    const fim = await proc.fim;
    await Promise.all(pendentes);
    log("info", "ligacao_laco_encerrado", { turno_id: plano.turnoId, harness: "codex-cli", resumo, negados, exit: fim.erroSpawn ? null : fim.exitCode });

    if (resumo === "feito") {
      const texto = resumoBlocos.length > 0 ? resumoBlocos.join("\n\n") : resumoDeltas.join("");
      if (texto !== "") emitir({ tipo: "texto_bloco", texto }, true);
      emitir({ tipo: "result", sucesso: resumoOk, subtype: resumoOk ? "success" : "error", sessaoCli: null, texto: resumoOk ? texto : "", custoUsd: null, tokens, numTurnos: 1, negacoesPermissao: [], erroCru: resumoOk ? null : (ultimoErro ?? "resumo_falhou") }, true);
    }
    const resultado = classificarResultado({
      eventos,
      exitCode: fim.erroSpawn ? null : fim.exitCode,
      signal: fim.erroSpawn ? null : fim.signal,
      stderr: fim.stderr,
      sinais,
      interrompidoPeloDriver: proc.interrompido() && !cliente.fechando(),
      driver: "codex-ligacao",
    });
    // Thread efêmera: nada a retomar depois.
    return { ...resultado, sessaoCli: null };
  } finally {
    if (timerSaida) clearTimeout(timerSaida);
    cerebro?.fechar();
    c.aoProcesso(null);
    await rm(dir, { recursive: true, force: true });
  }
}
