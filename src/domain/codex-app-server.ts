import type { ContaDaIa } from "../contracts/estado-ia.ts";
import type { JanelaDoPlano, UsoDoPlano } from "../contracts/uso-do-plano.ts";
import { emailDaConta, planoLegivel } from "./estado-ia.ts";
import { redigirECortar } from "./segredos.ts";
import { LIMIAR_PERTO } from "./uso-do-plano.ts";

/**
 * Protocolo do `codex app-server` (definido em 2026-10-04, ADR-076): JSON-RPC 2.0, uma mensagem JSON por linha no
 * stdin/stdout do processo. Puro — só monta as linhas que o laço de voz escreve e interpreta as que ele lê.
 *
 * NÃO HOMOLOGADO: o Codex não estava instalado na máquina onde este parser foi escrito; os nomes de métodos e campos
 * vêm do protocolo v2 publicado (codex-rs/app-server-protocol, main de 2026-10-03) e só foram exercitados contra o
 * app-server falso de `tests/fixtures/codex-falso.mjs`. O parser é tolerante: campo que falta vira null, linha que não
 * é JSON vira `ignorado`, nunca lança.
 */

/** NOD-174: o mesmo teto do `erroCru` do Codex exec (codex-stream.ts). */
const ERRO_CRU_APP_SERVER_MAX_CHARS = 500;

export type IdRpc = number | string;

/**
 * Esforço de raciocínio aceito pelo protocolo (depende do modelo; `model/list` diz quais o modelo aceita). revisto em
 * 2026-10-10: `max` medido no `model/list` do 0.147 (GPT-5.6 Sol e Luna; o Sol também diz `ultra`, que o nod não usa).
 */
export type EsforcoCodex = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * definido em 2026-10-04: "low" no laço de voz. `model/list` (supportedReasoningEfforts) diria o menor esforço que o
 * Luna aceita, mas a resposta nunca foi vista com o Codex real; "low" é aceito por toda a família GPT-6 na API
 * (pesquisa de 2026-10-04). Trocar pelo menor da lista quando a sonda do app-server existir.
 */
export const ESFORCO_LIGACAO_CODEX: EsforcoCodex = "low";

export type TokensAppServer = { entrada: number; saida: number; cacheLeitura: number };

export type EventoAppServer =
  /** Resposta a um pedido nosso. */
  | { tipo: "resposta"; id: IdRpc; resultado: Record<string, unknown> }
  /** Resposta de erro a um pedido nosso (a mensagem crua fica só aqui; quem loga usa o código). */
  | { tipo: "resposta_erro"; id: IdRpc; codigo: number | null; mensagem: string }
  | { tipo: "delta"; threadId: string | null; turnId: string | null; itemId: string | null; texto: string }
  | { tipo: "turno_iniciado"; turnId: string | null }
  /**
   * Item do turno começou ou acabou. `ferramenta` = `mcp__<servidor>__<ferramenta>` quando é chamada MCP (o mesmo nome
   * que o Claude Code usa), null para os outros itens. `texto` = o texto completo de uma mensagem do agente, no fim.
   */
  /**
   * revisto em 2026-10-14 (ADR-103): as nativas do Codex também viram `ferramenta`, pelo nome que o hook do nod conhece
   * (NATIVAS_DO_TERMINAL_CODEX), e `entrada` leva o que identifica o passo (o comando, o caminho, a busca) para a trilha
   * da conversa — nunca a saída.
   */
  | { tipo: "item"; fase: "inicio" | "fim"; turnId: string | null; itemId: string | null; tipoItem: string; ferramenta: string | null; falhou: boolean; texto: string | null; entrada?: Record<string, unknown> | null }
  | { tipo: "turno_concluido"; turnId: string | null; status: "completed" | "interrupted" | "failed"; erro: string | null }
  /** Pedido do servidor que EXIGE resposta (sem ela o turno trava). O laço sempre nega. */
  | { tipo: "pedido_servidor"; id: IdRpc; metodo: string }
  | { tipo: "uso"; tokens: TokensAppServer }
  /** Notificação `error` do servidor (a mensagem crua fica só aqui). */
  | { tipo: "erro"; mensagem: string | null; vaiRepetir: boolean }
  /**
   * O que o laço não usa. `metodo` = a notificação que o parser não conhece (NOD-167: o laço loga só o nome, uma vez
   * por ligação, para a homologação mostrar o que o app-server real manda); ausente = linha que não é JSON-RPC útil.
   */
  | { tipo: "ignorado"; metodo?: string };

type Obj = Record<string, unknown>;

const ehObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numero = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ehId = (v: unknown): v is IdRpc => typeof v === "number" || typeof v === "string";

function linha(msg: Obj): string {
  return `${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`;
}

function pedido(id: IdRpc, method: string, params: Obj): string {
  return linha({ id, method, params });
}

export function pedidoInitialize(id: IdRpc, cliente: { nome: string; versao: string }): string {
  return pedido(id, "initialize", { clientInfo: { name: cliente.nome, title: "nod", version: cliente.versao } });
}

export function notificacaoInitialized(): string {
  return linha({ method: "initialized" });
}

/** revisto em 2026-10-14 (ADR-103): `danger-full-access` = o kit do terminal, sem sandbox, como o Claude (ADR-055). */
export type SandboxCodex = "read-only" | "workspace-write" | "danger-full-access";

/**
 * Thread efêmera do laço de voz: nada vai para o histórico do Codex, sem aprovação interativa (o nod decide pelo
 * proxy), sandbox só de leitura. As instruções de voz vão como `developerInstructions`, o mesmo canal que o
 * `codex exec` usa (`-c developer_instructions`).
 *
 * definido em 2026-10-07 (ADR-083 §6): o chat do Codex abre a thread NÃO efêmera (`efemera: false`) e com a sandbox
 * das pastas autorizadas (`workspace-write` com projeto, como o `codex exec`); a ligação segue com os padrões.
 */
export function pedidoThreadStart(id: IdRpc, p: { modelo: string; instrucoes: string; cwd: string; sandbox?: SandboxCodex; efemera?: boolean }): string {
  return pedido(id, "thread/start", {
    model: p.modelo,
    cwd: p.cwd,
    approvalPolicy: "never",
    sandbox: p.sandbox ?? "read-only",
    developerInstructions: p.instrucoes,
    ephemeral: p.efemera ?? true,
  });
}

/**
 * definido em 2026-10-14 (ADR-103): o chat continua a thread do Codex como o Claude continua a sessão. `retomar` =
 * `thread/resume` pelo id (a conversa segue); `bifurcar` = `thread/fork` (a rede de 2 min: a original fica com o trabalho
 * promovido). Os dois aceitam os mesmos cwd, sandbox e instruções do `thread/start` (protocolo v2 do 0.147.0).
 */
export type AberturaThread = { tipo: "nova" } | { tipo: "retomar"; threadId: string } | { tipo: "bifurcar"; threadId: string };

export function pedidoAbrirThread(id: IdRpc, abertura: AberturaThread, p: { modelo: string; instrucoes: string; cwd: string; sandbox: SandboxCodex }): string {
  const comum = { model: p.modelo, cwd: p.cwd, approvalPolicy: "never", sandbox: p.sandbox, developerInstructions: p.instrucoes };
  if (abertura.tipo === "retomar") return pedido(id, "thread/resume", { threadId: abertura.threadId, ...comum });
  if (abertura.tipo === "bifurcar") return pedido(id, "thread/fork", { threadId: abertura.threadId, ...comum, ephemeral: false });
  return pedido(id, "thread/start", { ...comum, ephemeral: false });
}

/** ADR-103: os hooks que o app-server carregou para a pasta (a confiança do hook do nod sai daqui). */
export function pedidoHooksList(id: IdRpc, cwd: string): string {
  return pedido(id, "hooks/list", { cwds: [cwd] });
}

export type HookListado = { chave: string; hash: string; confiado: boolean; comando: string | null; daSessao: boolean };

/** `hooks/list` → `{data: [{cwd, hooks: [{key, currentHash, trustStatus, command, source}]}]}` (medido no 0.147.0). */
export function hooksDaLista(resultado: Obj): HookListado[] {
  const entradas = Array.isArray(resultado.data) ? resultado.data : [];
  return entradas.flatMap((e: unknown) => (ehObj(e) && Array.isArray(e.hooks) ? e.hooks : [])).flatMap((h: unknown) => {
    if (!ehObj(h)) return [];
    const chave = texto(h.key);
    const hash = texto(h.currentHash);
    if (!chave || !hash) return [];
    return [{ chave, hash, confiado: h.trustStatus === "trusted", comando: texto(h.command), daSessao: h.source === "sessionFlags" }];
  });
}

/**
 * definido em 2026-10-14 (ADR-103): grava no config.toml da conta. `valor` null apaga a chave (medido no 0.147.0:
 * `config/batchWrite` com `value: null` tira `[projects."<pasta>"]` e o arquivo volta ao de antes).
 */
export function pedidoConfigBatchWrite(id: IdRpc, edicoes: readonly { chave: string; valor: unknown }[]): string {
  return pedido(id, "config/batchWrite", { edits: edicoes.map((e) => ({ keyPath: e.chave, value: e.valor, mergeStrategy: "replace" })), reloadUserConfig: true });
}

/** A chave TOML de um caminho, entre aspas (o caminho tem barra e ponto). */
export const chaveToml = (...partes: string[]): string => partes.map((p) => (/^[A-Za-z0-9_-]+$/.test(p) ? p : JSON.stringify(p))).join(".");

/** `config/read` → o config efetivo; a chave `projects.<pasta>` diz se a pasta já estava confiada antes do turno. */
export function pedidoConfigRead(id: IdRpc, cwd: string): string {
  return pedido(id, "config/read", { cwd });
}

/** `config/read` → `{config: {projects: {"<pasta>": {trust_level}}}}`: a pasta já tinha entrada na config da pessoa? */
export function pastaNaConfig(resultado: Obj, pasta: string): boolean {
  const config = ehObj(resultado.config) ? resultado.config : {};
  const projetos = ehObj(config.projects) ? config.projects : {};
  return ehObj(projetos[pasta]);
}

/** ADR-103: o id da thread que `thread/resume` e `thread/fork` devolvem (`{thread: {id}}`, como o `thread/start`). */
export const idDaThreadAberta = (resultado: Obj): string | null => idDaThread(resultado);

const entradaTexto = (t: string) => [{ type: "text", text: t }];

/**
 * Sem `esforco` (o chat com o esforço padrão do modelo), o campo não vai: vale o do modelo.
 * revisto em 2026-10-14 (ADR-103): `imagens` = arquivos do turno que entram como `localImage` (UserInput do protocolo v2
 * do 0.147.0); antes o anexo levava o turno ao `codex exec`, sem o terminal.
 */
export function pedidoTurnStart(id: IdRpc, p: { threadId: string; texto: string; esforco?: EsforcoCodex; imagens?: readonly string[] }): string {
  const input = [...entradaTexto(p.texto), ...(p.imagens ?? []).map((path) => ({ type: "localImage", path }))];
  return pedido(id, "turn/start", { threadId: p.threadId, input, ...(p.esforco ? { effort: p.esforco } : {}) });
}

/** Fala nova no meio de um turno: entra no turno em andamento, sem abrir outro. */
export function pedidoTurnSteer(id: IdRpc, p: { threadId: string; texto: string; turnoEsperado: string }): string {
  return pedido(id, "turn/steer", { threadId: p.threadId, input: entradaTexto(p.texto), expectedTurnId: p.turnoEsperado });
}

export function pedidoTurnInterrupt(id: IdRpc, p: { threadId: string; turnId: string }): string {
  return pedido(id, "turn/interrupt", { threadId: p.threadId, turnId: p.turnId });
}

/** definido em 2026-10-04: código JSON-RPC da recusa a pedido do servidor que o nod não sabe negar pelo formato. */
export const CODIGO_RECUSA_NOD = -32000;

/**
 * Resposta que NEGA um pedido do servidor (aprovação de comando, de arquivo, de permissão, elicitação de MCP). O laço
 * de voz nunca aprova nada pelo Codex: o que precisa de aprovação passa pelo nod. Método conhecido recebe a recusa no
 * formato dele; o resto recebe um erro JSON-RPC, que o servidor trata como recusa.
 */
export function respostaNegando(id: IdRpc, metodo: string): string {
  switch (metodo) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return linha({ id, result: { decision: "decline" } });
    // Protocolo v1 (ainda aceito pelo servidor): outro vocabulário.
    case "execCommandApproval":
    case "applyPatchApproval":
      return linha({ id, result: { decision: "denied" } });
    case "mcpServer/elicitation/request":
      return linha({ id, result: { action: "decline" } });
    default:
      return linha({ id, error: { code: CODIGO_RECUSA_NOD, message: "negado pelo nod" } });
  }
}

/** NOD-167: a lista de modelos da conta (a sonda do app-server confere que o id do Luna está nela). */
export function pedidoModelList(id: IdRpc): string {
  return pedido(id, "model/list", {});
}

/**
 * NOD-209: QUAL conta está logada no Codex, sem chamar modelo nem ler `~/.codex/auth.json`. Medido em 2026-10-12 no
 * Codex 0.162.1: depois do initialize/initialized, `account/read` devolve
 * `{account: {type: "chatgpt", email, planType: "pro"}, requiresOpenaiAuth: true, …}`.
 */
export function pedidoAccountRead(id: IdRpc): string {
  return pedido(id, "account/read", {});
}

/** `account/read` → a conta; null sem conta, com chave de API (não tem e-mail) ou num formato que não é o medido. */
export function contaDoAccountRead(resultado: Obj): ContaDaIa | null {
  const conta = resultado.account;
  if (!ehObj(conta)) return null;
  const email = emailDaConta(conta.email);
  if (!email) return null;
  return { email, organizacao: null, plano: planoLegivel(conta.planType) };
}

/**
 * NOD-12 (definido em 2026-10-22): o uso do plano da conta logada no Codex, sem chamar modelo nem ler credencial (o
 * app-server responde com a sessão que ele mesmo tem). Medido em 2026-10-22 no Codex 0.162.0: `account/rateLimits/read`
 * devolve `{rateLimits: {primary: {usedPercent, windowDurationMins, resetsAt}, secondary: {…}, rateLimitReachedType,
 * planType, …}, rateLimitsByLimitId, …}`, `usedPercent` de 0 a 100, `resetsAt` em segundos, 300 min e 10080 min.
 */
export function pedidoAccountRateLimitsRead(id: IdRpc): string {
  return pedido(id, "account/rateLimits/read", {});
}

/** A janela do Codex → a do nod (0 a 1, ms). null = ausente ou num formato que não é o medido. */
function janelaDoCodex(v: unknown): { janela: JanelaDoPlano; minutos: number | null } | null {
  if (!ehObj(v) || typeof v.usedPercent !== "number" || !Number.isFinite(v.usedPercent) || v.usedPercent < 0) return null;
  const renova = typeof v.resetsAt === "number" && Number.isFinite(v.resetsAt) && v.resetsAt > 0 ? v.resetsAt * 1000 : null;
  const minutos = typeof v.windowDurationMins === "number" && Number.isFinite(v.windowDurationMins) ? v.windowDurationMins : null;
  return { janela: { utilizacao: v.usedPercent / 100, renovaEm: renova }, minutos };
}

/** Até 6 h é a janela curta ("5 horas"); a partir de 6 dias, a semana. Sem a duração: primary = 5 h, secondary = semana. */
const JANELA_CURTA_MAX_MIN = 360;
const SEMANA_MIN_MIN = 6 * 24 * 60;

/**
 * `account/rateLimits/read` → o uso do plano do turno (harness codex-cli). null = resposta sem nenhuma janela legível
 * (a tela diz "o ChatGPT não informou"); nunca lança. Esgotado quando uma janela chegou a 100% ou o Codex diz que o
 * limite foi atingido (`rateLimitReachedType`); perto a partir do mesmo 80% do medidor.
 */
export function usoDoPlanoDoRateLimits(resultado: Obj, medidoEm: number): UsoDoPlano | null {
  const rl = ehObj(resultado.rateLimits) ? resultado.rateLimits : null;
  if (!rl) return null;
  const primaria = janelaDoCodex(rl.primary);
  const secundaria = janelaDoCodex(rl.secondary);
  let cincoHoras: JanelaDoPlano | null = null;
  let semana: JanelaDoPlano | null = null;
  for (const [j, padrao] of [[primaria, "cinco"], [secundaria, "semana"]] as const) {
    if (!j) continue;
    const qual = j.minutos === null ? padrao : j.minutos <= JANELA_CURTA_MAX_MIN ? "cinco" : j.minutos >= SEMANA_MIN_MIN ? "semana" : null;
    if (qual === "cinco" && !cincoHoras) cincoHoras = j.janela;
    else if (qual === "semana" && !semana) semana = j.janela;
  }
  if (!cincoHoras && !semana) return null;
  const maior = Math.max(cincoHoras?.utilizacao ?? 0, semana?.utilizacao ?? 0);
  const atingido = typeof rl.rateLimitReachedType === "string" && rl.rateLimitReachedType.length > 0;
  const situacao = maior >= 1 || atingido ? "esgotado" : maior >= LIMIAR_PERTO ? "perto" : "normal";
  return { harness: "codex-cli", situacao, cincoHoras, semana, medidoEm };
}

export type ModeloAppServer = { id: string; padrao: boolean; esforcos: string[]; esforcoPadrao: string | null };

/**
 * `model/list` → `{data: [{id, model, isDefault, supportedReasoningEfforts, defaultReasoningEffort}], nextCursor}`.
 * NÃO HOMOLOGADO (como o resto deste arquivo): tolera `model` no lugar de `id` e esforços como texto solto ou como
 * `{reasoningEffort}`; item sem id é descartado.
 */
export function modelosDaLista(resultado: Obj): ModeloAppServer[] {
  const itens = Array.isArray(resultado.data) ? resultado.data : Array.isArray(resultado.models) ? resultado.models : [];
  return itens.flatMap((v: unknown) => {
    if (!ehObj(v)) return [];
    const id = texto(v.id) ?? texto(v.model);
    if (!id) return [];
    const esforcos = (Array.isArray(v.supportedReasoningEfforts) ? v.supportedReasoningEfforts : []).flatMap((e: unknown) => {
      const t = texto(e) ?? (ehObj(e) ? texto(e.reasoningEffort) ?? texto(e.effort) : null);
      return t ? [t] : [];
    });
    return [{ id, padrao: v.isDefault === true, esforcos, esforcoPadrao: texto(v.defaultReasoningEffort) }];
  });
}

/** `thread/start` → `{thread: {id}}`; tolera `threadId` solto. */
export function idDaThread(resultado: Obj): string | null {
  return (ehObj(resultado.thread) ? texto(resultado.thread.id) : null) ?? texto(resultado.threadId);
}

/** `turn/start` → `{turn: {id}}`; `turn/steer` → `{turnId}`. */
export function idDoTurno(resultado: Obj): string | null {
  return (ehObj(resultado.turn) ? texto(resultado.turn.id) : null) ?? texto(resultado.turnId);
}

/**
 * definido em 2026-10-14 (ADR-103): o item do app-server → o nome da nativa no plano (o mesmo que o PreToolUse do Codex
 * manda ao hook). Tipos do protocolo v2 da versão 0.147.0 (`codex app-server generate-ts`, ThreadItem).
 */
const NATIVA_DO_ITEM: Record<string, string> = {
  commandExecution: "Bash",
  fileChange: "apply_patch",
  webSearch: "web_search",
  imageView: "view_image",
  collabAgentToolCall: "spawn_agent",
  imageGeneration: "image_generation",
};

function nomeDaFerramenta(item: Obj): string | null {
  const tipo = texto(item.type);
  const ferramenta = texto(item.tool);
  if (tipo === "mcpToolCall" && ferramenta) return `mcp__${texto(item.server) ?? "nod"}__${ferramenta}`;
  if (tipo === "dynamicToolCall" && ferramenta) return ferramenta;
  return tipo !== null ? NATIVA_DO_ITEM[tipo] ?? null : null;
}

/** ADR-103: o que identifica o passo de uma nativa (o comando, os arquivos, a busca, a imagem); null nas outras. */
function entradaDoItem(item: Obj): Obj | null {
  switch (texto(item.type)) {
    case "commandExecution":
      return texto(item.command) !== null ? { command: texto(item.command) } : null;
    case "fileChange":
      return Array.isArray(item.changes) ? { arquivos: item.changes.flatMap((c: unknown) => (ehObj(c) && texto(c.path) !== null ? [texto(c.path)] : [])) } : null;
    case "webSearch":
      return texto(item.query) !== null ? { query: texto(item.query) } : null;
    case "imageView":
      return texto(item.path) !== null ? { path: texto(item.path) } : null;
    default:
      return null;
  }
}

function turnoDe(params: Obj): string | null {
  return texto(params.turnId) ?? (ehObj(params.turn) ? texto(params.turn.id) : null);
}

function interpretarNotificacao(metodo: string, params: Obj): EventoAppServer {
  switch (metodo) {
    case "item/agentMessage/delta": {
      const delta = texto(params.delta);
      if (delta === null) return { tipo: "ignorado" };
      return { tipo: "delta", threadId: texto(params.threadId), turnId: texto(params.turnId), itemId: texto(params.itemId), texto: delta };
    }
    case "turn/started":
      return { tipo: "turno_iniciado", turnId: turnoDe(params) };
    case "item/started":
    case "item/completed": {
      const item = ehObj(params.item) ? params.item : {};
      const tipoItem = texto(item.type) ?? "desconhecido";
      const fim = metodo === "item/completed";
      return {
        tipo: "item",
        fase: fim ? "fim" : "inicio",
        turnId: texto(params.turnId),
        itemId: texto(item.id),
        tipoItem,
        ferramenta: nomeDaFerramenta(item),
        falhou: fim && (item.status === "failed" || item.status === "declined" || (item.error !== undefined && item.error !== null)),
        texto: fim && tipoItem === "agentMessage" ? texto(item.text) : null,
        entrada: entradaDoItem(item),
      };
    }
    case "turn/completed": {
      const turno = ehObj(params.turn) ? params.turn : {};
      const status = turno.status === "interrupted" ? "interrupted" : turno.status === "failed" ? "failed" : "completed";
      // NOD-174: o motivo do Codex chega ao `erroCru` (redigido antes do corte); sem mensagem fica null, nunca o "erro"
      // genérico de antes. Interrompido não é falha do fornecedor: sem erro.
      const erro = status !== "interrupted" && ehObj(turno.error) ? redigirECortar(texto(turno.error.message), ERRO_CRU_APP_SERVER_MAX_CHARS) : null;
      return { tipo: "turno_concluido", turnId: turnoDe(params), status, erro };
    }
    case "thread/tokenUsage/updated": {
      const uso = ehObj(params.tokenUsage) && ehObj(params.tokenUsage.total) ? params.tokenUsage.total : null;
      if (!uso) return { tipo: "ignorado" };
      return { tipo: "uso", tokens: { entrada: numero(uso.inputTokens), saida: numero(uso.outputTokens), cacheLeitura: numero(uso.cachedInputTokens) } };
    }
    case "error": {
      const erro = ehObj(params.error) ? params.error : {};
      return { tipo: "erro", mensagem: redigirECortar(texto(erro.message), ERRO_CRU_APP_SERVER_MAX_CHARS), vaiRepetir: params.willRetry === true };
    }
    default:
      return { tipo: "ignorado", metodo: metodo.slice(0, 80) };
  }
}

/** Uma linha do stdout do app-server vira um evento; nada aqui lança. */
export function interpretarLinhaAppServer(linhaCrua: string): EventoAppServer {
  let v: unknown;
  try {
    v = JSON.parse(linhaCrua);
  } catch {
    return { tipo: "ignorado" };
  }
  if (!ehObj(v)) return { tipo: "ignorado" };
  const metodo = texto(v.method);
  const params = ehObj(v.params) ? v.params : {};
  // Pedido do servidor: tem método E id. Notificação: só método. Resposta: só id.
  if (metodo !== null && ehId(v.id)) return { tipo: "pedido_servidor", id: v.id, metodo };
  if (metodo !== null) return interpretarNotificacao(metodo, params);
  if (!ehId(v.id)) return { tipo: "ignorado" };
  if (ehObj(v.error)) return { tipo: "resposta_erro", id: v.id, codigo: typeof v.error.code === "number" ? v.error.code : null, mensagem: texto(v.error.message) ?? "" };
  return { tipo: "resposta", id: v.id, resultado: ehObj(v.result) ? v.result : {} };
}
