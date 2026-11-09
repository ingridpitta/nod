import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { EsforcoAgente } from "../../../contracts/agente.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno, TokensTurno } from "../../../contracts/turno.ts";
import type { UsoDoPlano } from "../../../contracts/uso-do-plano.ts";
import {
  chaveToml,
  hooksDaLista,
  pastaNaConfig,
  pedidoAbrirThread,
  pedidoAccountRateLimitsRead,
  pedidoConfigBatchWrite,
  pedidoConfigRead,
  pedidoHooksList,
  pedidoTurnStart,
  type AberturaThread,
  type EsforcoCodex,
  type EventoAppServer,
  type SandboxCodex,
  usoDoPlanoDoRateLimits,
} from "../../../domain/codex-app-server.ts";
import { ultimaLinhaUtil } from "../../../domain/codex-stream.ts";
import { criarFalaDoMeio } from "../../../domain/mensagem-no-meio.ts";
import { ehPastaDeTask, NATIVA_MCP_DA_PESSOA } from "../../../domain/nativas.ts";
import { redigirECortar } from "../../../domain/segredos.ts";
import { causaDoCodexChat, classificarSessao, reduzirSinais, SINAIS_ZERADOS, textoDaRodada } from "../../../domain/stream-json.ts";
import { log } from "../../../obs/log.ts";
import { pastaValidaNoWindows } from "../../../domain/caminhos.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS, VARIAVEL_CONFIG_HOOK } from "../../../shared/constantes.ts";
import { baixarAnexos, entradaCodex } from "../anexos-turno.ts";
import type { ConfigHook } from "../hook-nativas.ts";
import type { Processo } from "../processo.ts";
import type { SinksTurno } from "../spi.ts";
import { comAvisoSemTerminal } from "./claude-cli.ts";
import { criarClienteAppServer, type ClienteAppServer } from "./cliente-app-server.ts";
import { argMcpCodex, comandoHookCodex, configMcpCodex, escreverLauncherProxy, hooksDoTerminalCodex, type RecusadasCodex } from "./codex-comum.ts";
import { argsAppServer } from "./codex-ligacao.ts";

/**
 * O chat do Codex no `codex app-server` (definido em 2026-10-07, ADR-083 §6, decisão S4). O `codex exec` é um prompt
 * por turno, sem sessão: a mensagem da pessoa no meio do trabalho esperava o turno acabar. Aqui o turno é uma thread
 * aberta enquanto o bot trabalha, com a mesma sessão viva do Claude (ADR-067): cada volta do modelo fecha com um
 * `turn/completed` (vira um `result`), a mensagem nova entra pelo `turn/steer` no turno ativo (ou abre o próximo
 * `turn/start`) e, sem nada novo, a entrada fecha e o processo sai.
 *
 * revisto em 2026-10-14 (ADR-103, paridade do Codex): com o kit do terminal no plano, o Codex roda como o da pessoa —
 * shell, apply_patch, web, skills, AGENTS.md, subagentes — sem sandbox, na pasta do bot, e cada nativa passa pelo hook
 * PreToolUse do nod, confiado pela API do app-server (medido no 0.147.0: hook de `-c` só roda confiado; o
 * `--dangerously-bypass-hook-trust` não vale no app-server). Sem o hook (máquina sem o script, hook que não carregou ou
 * não ficou confiado), o turno roda isolado, como antes, e o prompt diz que não há terminal. A thread não é mais
 * efêmera: o id volta como `sessaoCli`, e o turno seguinte a continua (`thread/resume`) ou a copia (`thread/fork`).
 * Sem app-server, ou se ele não sobe, quem chama segue no `codex exec`.
 */

/** definido em 2026-10-07: o mesmo prazo do handshake da ligação (só o subir; não é relógio de trabalho, ADR-067). */
const PRAZO_HANDSHAKE_MS = 30_000;
/** definido em 2026-10-07: depois de fechar a entrada, o tempo que o app-server tem para sair sozinho. */
const SAIDA_APOS_FIM_MS = 2_000;
/** definido em 2026-10-14 (ADR-103): o tempo para tirar a entrada `[projects]` da config antes de fechar. */
const PRAZO_LIMPEZA_MS = 5_000;
/** NOD-12: quanto o fim da sessão espera a leitura do uso do plano antes de seguir sem ela. */
export const PRAZO_USO_DO_PLANO_MS = 2_000;

/**
 * definido em 2026-10-14 (ADR-103): o hook do Codex falha ABERTO (medido no 0.147.0: timeout de 5 s estourado → o comando
 * rodou). O hook nega sozinho em PRAZO_HOOK_CODEX_MS — a espera da aprovação no turno mais folga para a confirmação —, e o
 * timeout que o Codex recebe fica TIMEOUT_HOOK_CODEX_S acima disso, para o node subir e responder com folga.
 */
export const PRAZO_HOOK_CODEX_MS = ESPERA_APROVACAO_NO_TURNO_MS + 15_000;
export const TIMEOUT_HOOK_CODEX_S = Math.ceil(PRAZO_HOOK_CODEX_MS / 1000) + 45;

/**
 * definido em 2026-10-07: o esforço do bot no vocabulário do Codex. Sem esforço escolhido, o campo não vai e vale o
 * padrão do modelo (o `codex exec` nunca o mandou). revisto em 2026-10-10: o `model/list` do 0.147 mostrou `max` no
 * GPT-5.6 Sol e no Luna (medido sem turno); o servidor só manda um nível que o modelo do catálogo aceita
 * (raciocinioValido), então o `max` vai como `max`.
 */
const ESFORCO_CODEX: Record<EsforcoAgente, EsforcoCodex> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };

/**
 * Onde o Codex passa a ler um steer já aceito (definido em 2026-10-08, revisão do épico #188, X1): o texto entra na
 * próxima amostragem do modelo, então o que fecha o item em curso (a mensagem que já saía, ou a ferramenta) ainda é de
 * antes; a primeira fala depois do fim de um item é a resposta. Medido só contra o app-server falso.
 */
const FRONTEIRAS_CODEX: readonly EventoStream["tipo"][] = ["texto_bloco", "tool_result", "result"];

/** O que o adapter repassa ao laço enquanto a thread está viva. */
export type SessaoChatCodex = { aceitaMensagens(): boolean; receberMensagem(texto: string, id?: string): boolean };

/** Uma mensagem da pessoa a caminho da sessão, com os ids que o laço confirma quando ela entrar (X2). */
type ItemDaFila = { texto: string; ids: string[] };

/**
 * ADR-103: o que a máquina tem para o kit do terminal no Codex — o script do hook do nod, o node que o roda, a home (a
 * pasta do bot é ~/nod/<bot>) e a fila do forno (ADR-097). Ausente = esta máquina não liga o terminal no Codex.
 */
export type TerminalChatCodex = { hookPath: string; nodePath: string; electronComoNode?: boolean; home: string; vaga?: { dir: string; invocar: string }; windows?: boolean };

export type ContextoChatCodex = {
  plano: PlanoTurno;
  sinks: SinksTurno;
  bin: string;
  flagsNoHelp: readonly string[];
  recusadas?: RecusadasCodex;
  env: Record<string, string>;
  cwdBase: string;
  urlNod: string;
  proxyPath: string;
  nodePath?: string;
  electronComoNode?: boolean;
  sigtermParaSigkillMs?: number;
  versaoNod?: string;
  terminal?: TerminalChatCodex | null;
  fetch?: typeof fetch;
  aoProcesso(p: Processo | null): void;
  aoSessao(s: SessaoChatCodex | null): void;
};

const TOKENS_ZERADOS: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
const menos = (a: TokensTurno, b: TokensTurno): TokensTurno => ({
  entrada: Math.max(0, a.entrada - b.entrada),
  saida: Math.max(0, a.saida - b.saida),
  cacheLeitura: Math.max(0, a.cacheLeitura - b.cacheLeitura),
  cacheCriacao: 0,
});

/** O hook do nod não ficou de pé nesta abertura: o turno roda de novo, isolado (ADR-103). */
class SemHook extends Error {}

/** O turno inteiro no app-server; null = o app-server não subiu (quem chama roda o `codex exec`). */
export async function rodarChatCodex(c: ContextoChatCodex): Promise<ResultadoTurno | null> {
  const querTerminal = (c.plano.nativas ?? []).includes("Bash");
  const pode = querTerminal && c.terminal != null && typeof c.plano.pastaDoBot === "string" && c.plano.pastaDoBot !== "";
  if (pode) {
    const r = await rodarUmaVez(c, true);
    if (r !== "sem_hook") return r;
  }
  // O plano prometeu o terminal e esta máquina não o dá: o modelo lê que não há, como no Claude sem o hook.
  const plano = querTerminal ? { ...c.plano, ...comAvisoSemTerminal(c.plano) } : c.plano;
  const r = await rodarUmaVez({ ...c, plano }, false);
  return r === "sem_hook" ? null : r;
}

async function rodarUmaVez(c: ContextoChatCodex, comTerminal: boolean): Promise<ResultadoTurno | null | "sem_hook"> {
  const { plano, sinks } = c;
  const pastas = plano.workspacePastas ?? null;
  // ADA-11 (ADR-147): no Windows, a pasta com nome que o NTFS não aceita deixa o turno sem o terminal (falha fechada).
  const pastaInvalida = comTerminal && c.terminal?.windows === true && !pastaValidaNoWindows(plano.pastaDoBot ?? "");
  if (pastaInvalida) log("aviso", "pasta_invalida_no_windows", { turno_id: plano.turnoId });
  const terminal = comTerminal && !pastaInvalida ? c.terminal! : null;
  // ADR-103: com o terminal, a pasta do bot (ou a da task); sem pasta, o cwd estável por bot (NOD-188); com pasta, a ativa.
  const pastaBot = terminal ? join(terminal.home, "nod", plano.pastaDoBot!) : null;
  const pasta = pastaBot ?? pastas?.ativa ?? join(c.cwdBase, `texto-${plano.agenteId}`);
  if (pastaBot || !pastas) await mkdir(pasta, { recursive: true });
  // ADR-103: com o terminal, o Codex recebe o caminho REAL da pasta. Medido na sonda paga (0.162.0): o `cwd` que ele manda
  // ao hook é o real (/private/var), mas o caminho dentro do patch segue o cwd dado (/var); com o real dos dois lados a
  // cerca compara igual, e um arquivo dentro da pasta do bot não vira "gravar fora".
  const cwd = pastaBot ? await realpath(pasta).catch(() => pasta) : pasta;
  const dir = await mkdtemp(join(c.cwdBase, "codex-chat-"));
  let timerSaida: ReturnType<typeof setTimeout> | null = null;
  let devolverRestantes: (() => void) | null = null;
  try {
    const launcher = await escreverLauncherProxy(dir, { urlNod: c.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: c.proxyPath });
    const lig = { urlNod: c.urlNod, proxyPath: launcher, nodePath: c.nodePath, electronComoNode: c.electronComoNode };
    const configMcp = configMcpCodex(plano, lig, c.recusadas);
    const sandbox: SandboxCodex = terminal ? "danger-full-access" : pastas ? "workspace-write" : "read-only";
    const mcpDaPessoa = terminal !== null && (plano.nativas ?? []).includes(NATIVA_MCP_DA_PESSOA);
    let env = c.env;
    let comandoHook: string | null = null;
    const arquivoNegacoes = join(dir, "negacoes.jsonl");
    let argTerminal: { hooks: string; argMcp: string; mcpDaPessoa: boolean } | undefined;
    if (terminal && pastaBot) {
      // ADR-103: a config do hook (0600, no diretório do turno, apagada no fim) vai pela variável; o comando fica fixo.
      // A cerca compara com o caminho real da pasta (o cwd acima) e da home.
      const real = (p: string) => realpath(p).catch(() => p);
      const config: ConfigHook = {
        url: c.urlNod, token: plano.tokenDeTurno, pastaDoBot: cwd, home: await real(terminal.home), daTask: ehPastaDeTask(plano.pastaDoBot!),
        ...(terminal.vaga ? { vaga: terminal.vaga } : {}), formato: "codex", prazoMs: PRAZO_HOOK_CODEX_MS, negacoes: arquivoNegacoes, mcpDaPessoa,
        // NOD-54 (ADR-134): o original do arquivo gravado fora da pasta vai para o checkpoint do turno.
        checkpoint: { turnoId: plano.turnoId, pastaDoBot: plano.pastaDoBot!, home: homedir() },
      };
      const caminhoConfig = join(dir, "hook-nativas.json");
      await writeFile(caminhoConfig, JSON.stringify(config), { mode: 0o600 });
      env = { ...c.env, [VARIAVEL_CONFIG_HOOK]: caminhoConfig };
      comandoHook = comandoHookCodex({ nodePath: terminal.nodePath, hookPath: terminal.hookPath, electronComoNode: terminal.electronComoNode, windows: terminal.windows === true });
      argTerminal = { hooks: hooksDoTerminalCodex({ comando: comandoHook, timeoutS: TIMEOUT_HOOK_CODEX_S }), argMcp: argMcpCodex(plano, lig, { recusadas: c.recusadas, mcpDaPessoa }), mcpDaPessoa };
    }
    const args = argsAppServer({ configMcp, flagsNoHelp: c.flagsNoHelp, recusadas: c.recusadas, sandbox, ...(argTerminal ? { terminal: argTerminal } : {}) });
    const esforco = plano.entrada.esforco ? ESFORCO_CODEX[plano.entrada.esforco] : undefined;
    // ADR-103: anexo entra no app-server (imagem como localImage, texto na mensagem); antes levava o turno ao `codex exec`.
    const anexos = plano.entrada.anexos?.length ? await baixarAnexos(plano, c.urlNod, c.fetch) : [];
    const primeira = anexos.length > 0 ? await entradaCodex(plano.entrada.texto, anexos, dir) : { texto: plano.entrada.texto, imagens: [] as string[] };

    const eventos: EventoStream[] = [];
    const pendentes: Promise<void>[] = [];
    let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
    const meio = criarFalaDoMeio(FRONTEIRAS_CODEX);
    // NOD-402 (ADR-130): nem nos bastidores da conversa — tudo vai na entrega, que o `sem_novidade` cala.
    const falaNaHora = plano.modoTurno !== "sala" && !plano.bastidores && sinks.falaIntermediaria !== undefined;
    // A entrada da sessão: aberta depois do handshake, fechada quando o modelo terminou e nada mais chegou.
    let aberta = false;
    let fila: ItemDaFila[] = [];
    // X2 (revisto em 2026-10-08): os ids aceitos por `receberMensagem` que ainda não entraram nem voltaram.
    const aCaminho = new Set<string>();
    const entrou = (ids: readonly string[]) => {
      for (const id of ids) if (aCaminho.delete(id)) sinks.mensagemEntrou?.(id);
    };
    const devolver = (ids: readonly string[]) => {
      for (const id of ids) if (aCaminho.delete(id)) sinks.mensagemDevolvida?.(id);
    };
    devolverRestantes = () => devolver([...aCaminho]);
    let steersEmVoo = 0;
    let decidindo = false;
    const rodadas: EventoStream[][] = [];
    let inicioDaRodada = 0;
    let rodadasFaladas = 0;
    // `thread/tokenUsage/updated` traz o total da thread; o `result` de cada volta leva a diferença (classificarSessao soma).
    let totalAtual = TOKENS_ZERADOS;
    let totalAnterior = TOKENS_ZERADOS;
    let ultimoErro: string | null = null;
    // NOD-293 (C20): a última volta fechada foi recusada pelo app-server (vira a causa `turno_recusado`).
    let turnoRecusado = false;
    const ferramentasAbertas = new Map<string, string>();
    // ADR-103: a pasta do turno já tinha `[projects]` na config da pessoa antes? Se não, o nod tira a entrada no fim.
    let pastaReal: string | null = null;
    let projetoExistia = true;

    const emitir = (ev: EventoStream) => {
      eventos.push(ev);
      sinks.evento(ev);
      if (ev.tipo === "delta") sinks.delta(ev.texto);
      // ADR-083 §6: a resposta à mensagem do meio vira fala gravada agora, não passo do card.
      const resposta = meio.avaliar(ev, falaNaHora);
      if (resposta !== null && falaNaHora) sinks.falaIntermediaria!(resposta);
      const depois = reduzirSinais(sinais, ev);
      for (const k of ["attempted", "rejected", "promptSubmitted", "producedOutput"] as const) if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
      sinais = depois;
    };

    const fecharRodada = (sucesso: boolean, subtype: string, erroCru: string | null) => {
      const tokens = menos(totalAtual, totalAnterior);
      totalAnterior = totalAtual;
      emitir({ tipo: "result", sucesso, subtype, sessaoCli: null, texto: "", custoUsd: null, tokens, numTurnos: 1, negacoesPermissao: [], erroCru: sucesso ? null : erroCru ?? ultimoErro });
      rodadas.push(eventos.slice(inicioDaRodada));
      inicioDaRodada = eventos.length;
    };

    const falarRodadas = () => {
      if (!falaNaHora) return;
      for (; rodadasFaladas < rodadas.length; rodadasFaladas++) {
        const texto = textoDaRodada(rodadas[rodadasFaladas]!, meio);
        if (texto.trim() !== "") sinks.falaIntermediaria!(texto);
      }
    };

    /**
     * ADR-103: a busca na web é ferramenta hospedada (o hook não a vê); o driver avisa o servidor na hora, pela mesma rota
     * do hook, e o turno passa a tratar o que vier de fora como não confiável (0033). Falhar aqui não para o turno.
     */
    const contaminar = (ferramenta: string) => {
      const buscar = c.fetch ?? fetch;
      pendentes.push(
        buscar(`${c.urlNod.replace(/\/+$/, "")}/api/interno/nativas`, {
          method: "POST",
          headers: { authorization: `Bearer ${plano.tokenDeTurno}`, "content-type": "application/json" },
          body: JSON.stringify({ ferramenta, contamina: true }),
          signal: AbortSignal.timeout(10_000),
        }).then(
          (r) => { if (!r.ok) log("aviso", "codex_chat_web_nao_marcada", { turno_id: plano.turnoId, status: r.status }); },
          () => { log("aviso", "codex_chat_web_nao_marcada", { turno_id: plano.turnoId, status: null }); },
        ),
      );
    };

    function tratar(ev: EventoAppServer): void {
      switch (ev.tipo) {
        case "delta":
          if (ev.texto !== "") emitir({ tipo: "delta", texto: ev.texto });
          return;
        case "item":
          if (ev.fase === "fim" && ev.texto !== null && ev.texto.trim() !== "") emitir({ tipo: "texto_bloco", texto: ev.texto });
          if (!ev.ferramenta || !ev.itemId) return;
          if (ev.fase === "inicio") {
            ferramentasAbertas.set(ev.itemId, ev.ferramenta);
            if (ev.ferramenta === "web_search" && terminal) contaminar("web_search");
            emitir({ tipo: "tool_use", id: ev.itemId, nome: ev.ferramenta, input: ev.entrada ?? null });
          } else if (ferramentasAbertas.delete(ev.itemId)) {
            emitir({ tipo: "tool_result", toolUseId: ev.itemId, isError: ev.falhou, texto: "" });
          }
          return;
        case "uso":
          totalAtual = { ...ev.tokens, cacheCriacao: 0 };
          return;
        case "erro":
          ultimoErro = ev.mensagem ?? ultimoErro;
          log("aviso", "codex_chat_erro_servidor", { turno_id: plano.turnoId, vai_repetir: ev.vaiRepetir });
          return;
        default:
          return;
      }
    }

    const cliente: ClienteAppServer = criarClienteAppServer({
      bin: c.bin,
      args,
      env,
      cwd,
      sigtermParaSigkillMs: c.sigtermParaSigkillMs,
      aoEvento: tratar,
      aoTurnoConcluido(ev) {
        ultimoErro = ev.erro ?? ultimoErro;
        turnoRecusado = false;
        fecharRodada(ev.status === "completed", ev.status === "completed" ? "success" : ev.status === "interrupted" ? "error_interrupted" : "error_during_execution", ev.erro);
        void decidir();
      },
      aoNegado(metodo) {
        log("aviso", "codex_chat_pedido_negado", { turno_id: plano.turnoId, metodo: metodo.slice(0, 80) });
      },
    });
    const proc = cliente.processo;
    c.aoProcesso(proc);

    /** ADR-103: tira `[projects."<pasta>"]` que o app-server gravou na config da pessoa por causa deste turno. */
    const limparProjeto = async () => {
      if (!terminal || projetoExistia || pastaReal === null || cliente.fechando()) return;
      const chave = chaveToml("projects", pastaReal);
      let relogio: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        cliente.pedir((id) => pedidoConfigBatchWrite(id, [{ chave, valor: null }])).catch(() => log("aviso", "codex_chat_projeto_ficou", { turno_id: plano.turnoId })),
        new Promise<void>((r) => { relogio = setTimeout(r, PRAZO_LIMPEZA_MS); }),
      ]);
      clearTimeout(relogio);
      projetoExistia = true;
    };

    /**
     * NOD-12 (2026-10-22): o uso do plano da conta, lido no fim da sessão (`account/rateLimits/read`, sem modelo nem
     * credencial). Melhor esforço com prazo curto: sem resposta, o turno acaba igual e a tela diz que o ChatGPT não
     * informou. A leitura vai com o resultado e o servidor grava na conta do turno (assentar-turno), como a do Claude.
     */
    let usoDoPlano: UsoDoPlano | null = null;
    const lerUsoDoPlano = async () => {
      if (cliente.fechando()) return;
      let relogio: ReturnType<typeof setTimeout> | undefined;
      const lido = await Promise.race([
        cliente.pedir((id) => pedidoAccountRateLimitsRead(id)).then((res) => usoDoPlanoDoRateLimits(res, Date.now())).catch(() => null),
        new Promise<null>((r) => { relogio = setTimeout(() => r(null), PRAZO_USO_DO_PLANO_MS); }),
      ]);
      clearTimeout(relogio);
      if (lido) usoDoPlano = lido;
      else log("info", "codex_chat_sem_uso_do_plano", { turno_id: plano.turnoId });
    };

    let encerrando = false;
    const encerrar = async () => {
      aberta = false;
      if (encerrando || cliente.fechando()) return;
      encerrando = true;
      await lerUsoDoPlano();
      await limparProjeto();
      cliente.fechar();
      timerSaida = setTimeout(() => void proc.interromper(), SAIDA_APOS_FIM_MS);
    };

    /** Texto na sessão: steer no turno ativo, senão espera o turno abrir (ou o próximo). */
    const mandar = (item: ItemDaFila) => {
      if (cliente.turno().estado !== "ativo") return void fila.push(item);
      steersEmVoo += 1;
      cliente.steer(item.texto, (aceito) => {
        steersEmVoo -= 1;
        if (aceito) {
          // X1/X2: o texto entrou no turno, mas o modelo só o lê depois do item em curso.
          meio.absorveu();
          entrou(item.ids);
        } else {
          // O turno acabou antes de o steer chegar: o texto abre o próximo turno.
          fila.push(item);
        }
        if (cliente.turno().estado === "livre") void decidir();
      });
    };

    /** `itens` = as mensagens da pessoa que este turno leva (nenhuma no primeiro, que leva o pedido do plano). */
    const iniciar = (texto: string, itens: readonly ItemDaFila[] = [], imagens: readonly string[] = []) => {
      const ids = itens.flatMap((i) => i.ids);
      cliente.iniciarTurno((id, threadId) => pedidoTurnStart(id, { threadId, texto, ...(esforco ? { esforco } : {}), ...(imagens.length ? { imagens } : {}) }), (id, r) => {
        if (id === null) {
          log("aviso", "codex_chat_turno_recusado", { turno_id: plano.turnoId, codigo: r.tipo === "resposta_erro" ? r.codigo : null });
          // X2: a volta que levava as mensagens não abriu — elas voltam para a fila do servidor (viram turno próprio).
          devolver(ids);
          turnoRecusado = true;
          // NOD-293 (B7, 2026-10-20): o erro que o Codex deu ao recusar o turno (login vencido, modelo indisponível) é o
          // que explica a falha; vai como erroCru, redigido, em vez do "turno_recusado" genérico que o escondia.
          fecharRodada(false, "error_during_execution", r.tipo === "resposta_erro" ? (redigirECortar(r.mensagem, 500)?.trim() || "turno_recusado") : null);
          return void decidir();
        }
        if (itens.length > 0) {
          // X1: a volta começou com o texto: nada de antes no caminho, a próxima fala já é a resposta.
          meio.armar();
          entrou(ids);
        }
        const juntos = fila;
        fila = [];
        for (const t of juntos) mandar(t);
      });
    };

    /**
     * Depois de cada volta (ADR-067, como o `aposRodada` do Claude): o que chegou abre a próxima; sem nada, pergunta ao
     * laço se a pessoa escreveu (`ocioso`); sem nada de novo, fecha a entrada e o app-server sai.
     */
    async function decidir(): Promise<void> {
      if (decidindo || steersEmVoo > 0 || cliente.turno().estado !== "livre") return;
      decidindo = true;
      try {
        if (aberta && fila.length === 0 && sinks.ocioso) await sinks.ocioso();
        if (aberta && fila.length > 0 && !cliente.fechando()) {
          falarRodadas();
          const juntos = fila;
          fila = [];
          return iniciar(juntos.map((i) => i.texto).join("\n\n"), juntos);
        }
        await encerrar();
      } catch {
        await encerrar();
      } finally {
        decidindo = false;
      }
    }

    c.aoSessao({
      aceitaMensagens: () => aberta && !cliente.fechando(),
      receberMensagem(texto, id) {
        if (!aberta || cliente.fechando()) return false;
        // X2: aceita para entrar; o laço só confirma quando o steer for aceito ou a volta abrir com ela.
        if (id !== undefined) aCaminho.add(id);
        mandar({ texto, ids: id !== undefined ? [id] : [] });
        return true;
      },
    });

    /**
     * ADR-103: antes da thread, o hook do nod tem de estar carregado e confiado — o app-server só roda hook de `-c`
     * confiado (medido no 0.147.0). A confiança vai para a config da conta pelo próprio app-server (`config/batchWrite`,
     * como o codex-acp faz) e vale para o hash do hook, que é fixo: grava uma vez por conta e máquina.
     */
    const confiarNoHook = async () => {
      if (!terminal || !comandoHook) return;
      const listar = async () => hooksDaLista(await cliente.pedir((id) => pedidoHooksList(id, cwd))).find((h) => h.daSessao && h.comando === comandoHook);
      const nosso = await listar();
      if (!nosso) throw new SemHook("hook_nao_carregou");
      if (!nosso.confiado) {
        await cliente.pedir((id) => pedidoConfigBatchWrite(id, [{ chave: chaveToml("hooks", "state", nosso.chave, "trusted_hash"), valor: nosso.hash }]));
        if (!(await listar())?.confiado) throw new SemHook("hook_nao_confiado");
        log("info", "codex_hook_confiado", { turno_id: plano.turnoId });
      }
      pastaReal = cwd;
      projetoExistia = pastaNaConfig(await cliente.pedir((id) => pedidoConfigRead(id, pastaReal!)), pastaReal);
    };

    const sessao = plano.entrada.sessaoCli;
    const abertura: AberturaThread = sessao ? (plano.entrada.bifurcar ? { tipo: "bifurcar", threadId: sessao } : { tipo: "retomar", threadId: sessao }) : { tipo: "nova" };
    const pedirThread = (a: AberturaThread) => (id: number | string) => pedidoAbrirThread(id, a, { modelo: plano.entrada.modelo, instrucoes: plano.promptSistema, cwd, sandbox });
    try {
      await cliente.abrirThread({
        versaoNod: c.versaoNod ?? "0",
        prazoMs: PRAZO_HANDSHAKE_MS,
        antes: confiarNoHook,
        threadStart: pedirThread(abertura),
        // ADR-103: a thread que esta conta não tem (outra máquina, outra conta, sessão apagada) vira uma thread nova.
        ...(abertura.tipo !== "nova" ? { reserva: pedirThread({ tipo: "nova" }), aoReserva: (motivo: string) => log("aviso", "codex_chat_retomada_falhou", { turno_id: plano.turnoId, abertura: abertura.tipo, motivo: motivo.slice(0, 80) }) } : {}),
      });
    } catch (e) {
      if (e instanceof SemHook) {
        log("aviso", "codex_chat_sem_hook", { turno_id: plano.turnoId, motivo: e.message });
        return "sem_hook";
      }
      // Nada foi escrito para o modelo ainda: o turno segue no `codex exec`, como sem app-server.
      log("aviso", "codex_chat_app_server_falhou", { turno_id: plano.turnoId, erro: e instanceof Error ? e.message.slice(0, 80) : "handshake" });
      return null;
    }
    emitir({ tipo: "init", sessaoCli: cliente.threadId(), ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp), modelo: plano.entrada.modelo, versaoCli: "codex-app-server", apiKeySource: "none" });
    // ADR-009: promptSubmitted gravado antes de o prompt sair para o app-server.
    await Promise.all(pendentes);
    aberta = true;
    iniciar(primeira.texto, [], primeira.imagens);

    const fim = await proc.fim;
    aberta = false;
    await Promise.all(pendentes);
    const r = classificarSessao({
      eventos,
      exitCode: fim.erroSpawn ? null : fim.exitCode,
      signal: fim.erroSpawn ? null : fim.signal,
      stderr: fim.stderr,
      sinais,
      // Fechar a entrada e matar o que não saiu sozinho é o fim normal, não um Parar.
      interrompidoPeloDriver: proc.interrompido() && !cliente.fechando(),
      rodadasJaFaladas: rodadasFaladas,
      falaDoMeio: meio,
      driver: "codex-chat",
    });
    const causa = causaDoCodexChat(r, { turnoRecusado, exitCode: fim.erroSpawn ? null : fim.exitCode, signal: fim.erroSpawn ? null : fim.signal });
    const erroCru = r.desfecho === "sucesso" ? r.erroCru : r.erroCru ?? ultimoErro ?? ultimaLinhaUtil(fim.stderr);
    // ADR-103: o comando que o hook barrou não vira item no stream do Codex; a causa vem do arquivo que o hook anotou.
    const negacoesDoNod = terminal ? await lerNegacoes(arquivoNegacoes) : [];
    // ADR-103: a thread persiste no Codex da conta; o id é a sessão que o próximo turno continua.
    const sessaoCli = cliente.threadId() || null;
    return { ...r, erroCru, sessaoCli, ...(causa ? { causa } : {}), ...(negacoesDoNod.length > 0 ? { negacoesDoNod: [...(r.negacoesDoNod ?? []), ...negacoesDoNod] } : {}), ...(usoDoPlano ? { usoDoPlano } : {}) };
  } finally {
    if (timerSaida) clearTimeout(timerSaida);
    // X2: o que ficou na fila ou com o steer no ar quando a sessão acabou não entrou: volta para a fila do servidor.
    devolverRestantes?.();
    c.aoSessao(null);
    c.aoProcesso(null);
    await rm(dir, { recursive: true, force: true });
  }
}

/** As negações que o hook anotou no turno (ADR-103); linha que não é o formato dele fica de fora. */
async function lerNegacoes(arquivo: string): Promise<{ nome: string; motivo: string }[]> {
  const texto = await readFile(arquivo, "utf8").catch(() => "");
  return texto.split("\n").flatMap((l) => {
    try {
      const v = JSON.parse(l) as { nome?: unknown; motivo?: unknown };
      return typeof v.nome === "string" && typeof v.motivo === "string" ? [{ nome: v.nome, motivo: v.motivo }] : [];
    } catch {
      return [];
    }
  });
}
