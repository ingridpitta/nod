import type { EventoStream, ResultadoTurno, SinaisTurno, TokensTurno } from "../contracts/turno.ts";
import { entradaFerramentaObservavel } from "./entrada-ferramenta-observavel.ts";
import { motivoDoHookDoNod } from "./negacao-nativa.ts";
import { redigirECortar, redigirSegredos } from "./segredos.ts";

/** Os blocos de resposta a mensagens do meio (criarFalaDoMeio em mensagem-no-meio.ts), pelo próprio objeto do evento. */
export type FalaDoMeioNoTurno = { falados: ReadonlySet<EventoStream>; obrigatorios: ReadonlySet<EventoStream> };

/**
 * Parser PURO do `claude -p --output-format stream-json --verbose --include-partial-messages`
 * (contrato empírico de 2026-09-16, mapa-cli + fixtures reais em tests/fixtures/stream-json).
 * Tipos/subtipos desconhecidos (system/status, system/thinking_tokens, signature_delta…) viram
 * 'ignorado' em vez de derrubar o turno. Nenhuma decisão lê texto de erro (ADR-009 / E9.1).
 */
type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown, padrao = ""): string {
  return typeof v === "string" ? v : padrao;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** O `resetsAt` do rate_limit vem em segundos (medido no CLI 2.1.x); zero, negativo ou não número viram `null`. */
function emMs(v: unknown): number | null {
  const s = num(v);
  return s !== null && s > 0 ? s * 1000 : null;
}

function tokensDe(usage: Obj | null): TokensTurno {
  return {
    entrada: num(usage?.["input_tokens"]) ?? 0,
    saida: num(usage?.["output_tokens"]) ?? 0,
    cacheLeitura: num(usage?.["cache_read_input_tokens"]) ?? 0,
    cacheCriacao: num(usage?.["cache_creation_input_tokens"]) ?? 0,
  };
}

function nomes(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

function janelaDe(modelUsage: Obj | null): number | null {
  const janelas = Object.values(modelUsage ?? {}).map((u) => num(obj(u)?.["contextWindow"])).filter((j): j is number => j !== null);
  return janelas.length ? Math.max(...janelas) : null;
}

/** Medido em 2026-10-01 no 2.1.286: `completed`, `failed`, `killed` (task_updated) e `stopped` (task_notification). */
const ESTADOS_FINAIS_DE_TAREFA: readonly string[] = ["completed", "failed", "killed", "stopped", "cancelled"];

function textoDoConteudo(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const o = obj(c);
      return o && o["type"] === "text" ? str(o["text"]) : "";
    })
    .join("");
}

const DESCRICAO_TAREFA_MAX = 80;

/** A `description` do subagente vem do modelo: uma linha, sem controle, redigida e com até 80 caracteres (NOD-350). */
function descricaoDaTarefa(v: unknown): string {
  // QA: a sequência ANSI inteira sai ("\x1b[31m"), não só o ESC — sobrava "[31m" na tela.
  // eslint-disable-next-line no-control-regex
  const semAnsi = str(v).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ");
  // eslint-disable-next-line no-control-regex
  const limpa = semAnsi.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]+/g, " ").replace(/\s+/g, " ").trim();
  const redigida = (redigirECortar(limpa, 400) ?? "").replace(/\s+/g, " ").trim();
  const corte = /[\uD800-\uDBFF]$/.test(redigida.slice(0, DESCRICAO_TAREFA_MAX - 1)) ? DESCRICAO_TAREFA_MAX - 2 : DESCRICAO_TAREFA_MAX - 1;
  const curta = redigida.length > DESCRICAO_TAREFA_MAX ? `${redigida.slice(0, corte).trimEnd()}…` : redigida;
  return curta || "Subagente";
}

/** `completed` conclui; `failed` falha; `killed`/`stopped`/`cancelled` param (o Parar da pessoa ou do CLI). */
function finalDaTarefa(status: string): "concluido" | "falhou" | "parado" {
  return status === "completed" ? "concluido" : status === "failed" ? "falhou" : "parado";
}

/**
 * NOD-353 (revisão 2 do #523): a linha `user` pode trazer mais de um `tool_result` (ferramentas paralelas); cada um vira
 * um evento, para o fim de cada chamada (e o Falhou dela) chegar pelo id. As outras linhas dão um evento só.
 */
export function eventosDaLinhaStreamJson(linha: string): EventoStream[] {
  const ev = interpretarLinhaStreamJson(linha);
  if (ev.tipo !== "tool_result") return [ev];
  const content = obj(obj(JSON.parse(linha.trim()))?.["message"])?.["content"];
  const todos = (Array.isArray(content) ? content : []).flatMap((bloco): EventoStream[] => {
    const b = obj(bloco);
    return b?.["type"] === "tool_result" ? [{ tipo: "tool_result", toolUseId: str(b["tool_use_id"]), isError: b["is_error"] === true, texto: textoDoConteudo(b["content"]) }] : [];
  });
  return todos.length > 0 ? todos : [ev];
}

export function interpretarLinhaStreamJson(linha: string): EventoStream {
  const bruta = linha.trim();
  if (bruta === "") return { tipo: "ignorado", razao: "linha_vazia", tipoBruto: null };
  let json: unknown;
  try {
    json = JSON.parse(bruta);
  } catch {
    return { tipo: "ignorado", razao: "json_invalido", tipoBruto: null };
  }
  const o = obj(json);
  if (!o) return { tipo: "ignorado", razao: "json_invalido", tipoBruto: null };
  const type = str(o["type"]);
  const subtype = str(o["subtype"]);
  const tipoBruto = subtype ? `${type}/${subtype}` : type;

  if (type === "system" && subtype === "init") {
    const tools = Array.isArray(o["tools"]) ? o["tools"].filter((t): t is string => typeof t === "string") : [];
    return {
      tipo: "init",
      sessaoCli: str(o["session_id"]),
      ferramentas: tools,
      modelo: str(o["model"]),
      versaoCli: str(o["claude_code_version"]),
      apiKeySource: str(o["apiKeySource"], "desconhecido"),
      skills: nomes(o["skills"]),
      comandos: nomes(o["slash_commands"]),
      comandosSoDoTerminal: nomes(o["terminal_slash_commands"]),
      plugins: (Array.isArray(o["plugins"]) ? o["plugins"] : []).flatMap((p) => {
        const x = obj(p);
        return x && typeof x["name"] === "string" && typeof x["path"] === "string" ? [{ nome: x["name"], caminho: x["path"] }] : [];
      }),
    };
  }
  if (type === "system" && subtype === "compact_boundary") {
    // O stream usa snake_case; o transcript em disco, camelCase (medido nos .jsonl de 28/09). Aceita os dois.
    const meta = obj(o["compact_metadata"]) ?? obj(o["compactMetadata"]);
    return {
      tipo: "compactacao",
      antes: num(meta?.["pre_tokens"]) ?? num(meta?.["preTokens"]),
      depois: num(meta?.["post_tokens"]) ?? num(meta?.["postTokens"]),
      gatilho: str(meta?.["trigger"], "desconhecido"),
    };
  }
  // ADR-067: comando em segundo plano (Bash com run_in_background, Monitor). Só o que roda em segundo plano segura a
  // sessão viva. NOD-350: o subagente (local_agent) em primeiro plano também abre `task_started` e entra na lista da task
  // com `emFundo: false`; um comando em primeiro plano segue ignorado.
  if (type === "system" && subtype === "task_started" && str(o["task_id"]) !== "") {
    const agente = o["task_type"] === "local_agent";
    const emFundo = o["is_backgrounded"] === true;
    if (!emFundo && !agente) return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto };
    return {
      tipo: "tarefa_fundo",
      id: str(o["task_id"]),
      estado: "iniciada",
      natureza: agente ? "agente" : "comando",
      ...(agente ? { descricao: descricaoDaTarefa(o["description"]) } : {}),
      ...(emFundo ? {} : { emFundo: false as const }),
    };
  }
  if (type === "system" && (subtype === "task_updated" || subtype === "task_notification") && str(o["task_id"]) !== "") {
    const status = subtype === "task_updated" ? str(obj(o["patch"])?.["status"]) : str(o["status"]);
    if (ESTADOS_FINAIS_DE_TAREFA.includes(status)) return { tipo: "tarefa_fundo", id: str(o["task_id"]), estado: "terminada", final: finalDaTarefa(status) };
  }
  if (type === "system" && subtype === "task_progress" && str(o["task_id"]) !== "") {
    const usage = obj(o["usage"]);
    const chamadas = num(usage?.["tool_uses"]);
    const duracao = num(usage?.["duration_ms"]);
    const nome = str(o["last_tool_name"]).slice(0, 80);
    return {
      tipo: "tarefa_progresso",
      id: str(o["task_id"]),
      chamadas: chamadas !== null && chamadas >= 0 ? Math.floor(chamadas) : 0,
      ultimaFerramenta: nome || null,
      duracaoMs: duracao !== null && duracao >= 0 ? Math.floor(duracao) : null,
    };
  }
  if (type === "rate_limit_event") {
    const info = obj(o["rate_limit_info"]);
    const janelas = obj(info?.["unifiedWindows"]);
    const cinco = obj(janelas?.["five_hour"]);
    const sete = obj(janelas?.["seven_day"]);
    const daJanela = obj(janelas?.[str(info?.["rateLimitType"])]);
    return {
      tipo: "rate_limit",
      status: str(info?.["status"], "desconhecido"),
      utilizacaoCincoHoras: num(cinco?.["utilization"]),
      utilizacaoSeteDias: num(sete?.["utilization"]),
      renovaCincoHorasEm: emMs(cinco?.["resetsAt"]),
      renovaSeteDiasEm: emMs(sete?.["resetsAt"]),
      voltaEm: emMs(info?.["resetsAt"]) ?? emMs(daJanela?.["resetsAt"]),
      ...(info?.["isUsingOverage"] === true ? { usandoOverage: true } : {}),
    };
  }
  // NOD-350 (medido no 2.1.296): as linhas assistant/user dos subagentes chegam no stream principal com
  // `parent_tool_use_id` = o id do `Agent` que os chamou. Não são do turno do bot: nem passo, nem fala, nem ferramenta
  // aberta no vigia. O progresso deles chega pelo `task_progress`. Só a `chamada` (custo, Raio-X) segue contando.
  const doSubagente = typeof o["parent_tool_use_id"] === "string" && o["parent_tool_use_id"] !== "";
  if (type === "stream_event") {
    const ev = obj(o["event"]);
    if (doSubagente && ev?.["type"] !== "message_delta") return { tipo: "ignorado", razao: "subagente", tipoBruto: `${type} ev=${str(ev?.["type"], "?")}` };
    if (ev?.["type"] === "content_block_delta") {
      const delta = obj(ev["delta"]);
      if (delta?.["type"] === "text_delta") return { tipo: "delta", texto: str(delta["text"]) };
    }
    // O message_delta fecha a chamada com o usage completo dela (o do message_start ainda não tem a saída).
    if (ev?.["type"] === "message_delta" && obj(ev["usage"])) {
      const usage = obj(ev["usage"]);
      const t = tokensDe(usage);
      return {
        tipo: "chamada",
        entrada: t.entrada,
        cacheLido: t.cacheLeitura,
        cacheNovo: t.cacheCriacao,
        saida: t.saida,
        pensamento: num(obj(usage?.["output_tokens_details"])?.["thinking_tokens"]) ?? 0,
        subagente: typeof o["parent_tool_use_id"] === "string",
      };
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: `${type} ev=${str(ev?.["type"], "?")}` };
  }
  if ((type === "assistant" || type === "user") && doSubagente) return { tipo: "ignorado", razao: "subagente", tipoBruto: type };
  if (type === "assistant") {
    // NOD-174: o erro da API vem também como `assistant` com model "<synthetic>" e o mesmo texto do `result` ("Credit
    // balance is too low"). É do CLI, nunca do modelo: não vira bloco da fala. O cru segue no `erroCru` do result.
    if (obj(o["message"])?.["model"] === "<synthetic>") return { tipo: "ignorado", razao: "sintetico", tipoBruto: "assistant" };
    const content = obj(o["message"])?.["content"];
    if (Array.isArray(content)) {
      for (const bloco of content) {
        const b = obj(bloco);
        if (b?.["type"] === "tool_use") {
          const nome = str(b["name"]);
          return { tipo: "tool_use", id: str(b["id"]), nome, input: entradaFerramentaObservavel(nome, b["input"]) };
        }
      }
      // O CLI emite UMA linha `assistant` por bloco de conteúdo (thinking, text, tool_use — ver
      // s3-mcp-ok.jsonl), então uma linha com texto e ferramenta juntos não foi observada; se vier, a
      // ferramenta ganha, como antes deste evento existir.
      const texto = textoDoConteudo(content);
      if (texto.trim() !== "") return { tipo: "texto_bloco", texto };
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "assistant" };
  }
  if (type === "user") {
    const content = obj(o["message"])?.["content"];
    if (Array.isArray(content)) {
      for (const bloco of content) {
        const b = obj(bloco);
        if (b?.["type"] === "tool_result") {
          return { tipo: "tool_result", toolUseId: str(b["tool_use_id"]), isError: b["is_error"] === true, texto: textoDoConteudo(b["content"]) };
        }
      }
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "user" };
  }
  if (type === "result") {
    const denials = Array.isArray(o["permission_denials"]) ? o["permission_denials"] : [];
    return {
      tipo: "result",
      sucesso: subtype === "success" && o["is_error"] !== true,
      subtype,
      erroCru:
        subtype === "success" && o["is_error"] !== true
          ? null
          : redigirECortar([subtype, str(o["error"]), Array.isArray(o["errors"]) ? o["errors"].map(String).join("; ") : "", str(o["result"])].filter(Boolean).join(" | "), 500),
      sessaoCli: typeof o["session_id"] === "string" ? o["session_id"] : null,
      texto: str(o["result"]),
      custoUsd: num(o["total_cost_usd"]),
      tokens: tokensDe(obj(o["usage"])),
      numTurnos: num(o["num_turns"]) ?? 0,
      janela: janelaDe(obj(o["modelUsage"])),
      negacoesPermissao: denials.map((d) => str(obj(d)?.["tool_name"])).filter((n) => n !== ""),
    };
  }
  return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto };
}

/** Quatro sinais write-ahead (ADR-009): init = o CLI aceitou o prompt; qualquer saída = producedOutput. */
export function reduzirSinais(sinais: SinaisTurno, ev: EventoStream): SinaisTurno {
  switch (ev.tipo) {
    case "init":
      return { ...sinais, attempted: true, promptSubmitted: true };
    case "delta":
    case "texto_bloco":
    case "tool_use":
    case "tool_result":
      return { ...sinais, attempted: true, producedOutput: true };
    // NOD-293 (N6, definido em 2026-10-20): o result com is_error é o erro do CLI, não saída do modelo (NOD-174: nem
    // entra na fala). Ligar producedOutput por ele fazia o turno que só falhou virar `trabalho_incompleto`.
    case "result":
      return ev.sucesso ? { ...sinais, attempted: true, producedOutput: true } : { ...sinais, attempted: true };
    default:
      return sinais;
  }
}

export const SINAIS_ZERADOS: SinaisTurno = { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false };

/**
 * Bloco de texto escrito ANTES da última ferramenta só entra na fala se passar disto.
 * definido em 2026-09-28: a linha "Progresso" do prompt pede UMA frase curta por etapa entre
 * ferramentas ("Categorizando lote de 11 e-mails"), então narração cabe folgada em 280 caracteres e
 * fica só no cartão de atividade. Texto maior que isso antes de uma ferramenta é relatório: o modelo
 * escreveu a resposta, chamou `lembrar` e fechou com "Anotado." — e o `result` do CLI traz só a
 * última mensagem, então a pessoa (e o colega que perguntou) recebia só "Anotado.".
 */
export const NARRACAO_MAX_CHARS = 280;

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
const juntarBlocos = (partes: readonly string[]) => partes.map((p) => p.trim()).filter((p) => p !== "").join("\n\n");

/**
 * Fala = relatórios escritos antes da última ferramenta (> NARRACAO_MAX_CHARS, ainda não contidos no
 * texto final) + texto final, separados por linha em branco. Sem relatório a acrescentar, o texto final
 * sai intacto. `obrigatorios` (definido em 2026-10-07, ADR-083 §6): índices de `antesDaUltimaFerramenta` que entram
 * de qualquer tamanho — a resposta a uma mensagem do meio que não pôde sair como fala na hora.
 */
export function comporFala(antesDaUltimaFerramenta: readonly string[], final: string, obrigatorios: ReadonlySet<number> = new Set()): string {
  return comporFalaContada(antesDaUltimaFerramenta, final, obrigatorios).texto;
}

/**
 * comporFala e quantos blocos ela colou acima da final (definido em 2026-10-18, chat limpo, PR 1): o Raio-X grava o
 * número na execução do turno (`blocosColados`) para a semana de medição da narração no Modo WhatsApp (Parte 5 do plano).
 * A `composicao` não serve: é gravada na emissão do plano, antes de a fala existir.
 */
export function comporFalaContada(antesDaUltimaFerramenta: readonly string[], final: string, obrigatorios: ReadonlySet<number> = new Set()): { texto: string; colados: number } {
  const alvo = normalizar(final);
  const relatorios: string[] = [];
  for (const [i, bloco] of antesDaUltimaFerramenta.entries()) {
    const t = bloco.trim();
    if (t.length <= NARRACAO_MAX_CHARS && !obrigatorios.has(i)) continue;
    const n = normalizar(t);
    if (alvo.includes(n) || relatorios.some((r) => normalizar(r).includes(n))) continue;
    relatorios.push(t);
  }
  return relatorios.length === 0 ? { texto: final, colados: 0 } : { texto: juntarBlocos([...relatorios, final]), colados: relatorios.length };
}

/**
 * Classifica pelo ESTADO DE PROTOCOLO (ADR-009), nunca pela string de erro — `stderr` entra na
 * assinatura só para o teste adversarial provar que variá-lo não muda nada (E9.1):
 *  - result presente → sucesso | falha (subtype ≠ success: erro_max_turns | erro_execucao; `rate_limit` `rejected`
 *    na mesma rodada: limite_do_plano, com `limiteVoltaEm`);
 *  - sem result e (o driver interrompeu OU chegou signal OU houve init) → interrompido com motivo
 *    INDEFINIDO: quem sabe se pediu é o servidor (parado_pela_pessoa se pararSolicitadoEm existe,
 *    senão sem_progresso). A regra é a MESMA antes e depois do init — a sonda de 2026-09-16 mediu
 *    (s6.log) que o SIGTERM sai como exit 143 com signal null, então o exit code sozinho não diz
 *    "interrompido" e o driver informa `interrompidoPeloDriver` quando chamou interromper();
 *  - sem init, exitCode null e sem signal → lancamento_falhou (spawn não aconteceu);
 *  - sem init, exitCode ≠ 0 → sessao_rejeitada: TODA recusa pré-init cai aqui (s2c foi a única
 *    observada). CLI não autenticado é motivo do INVENTÁRIO (sonda → nao_autenticado) e barra o
 *    turno antes do spawn (montarPlano → executor_indisponivel); este classificador não o infere.
 *
 * O texto (definido em 2026-09-28) é o que vira a fala do bot e a resposta ao colega:
 *  - com result: comporFala(blocos antes da última ferramenta, final). O final é `result.texto` do sucesso; vazio
 *    (Codex, que nunca o preenche, ou falha, cujo texto é o erro do CLI), são os blocos depois da última ferramenta; sem
 *    eles, todos os blocos; sem blocos, os deltas colados, como antes;
 *  - sem result (interrompido): tudo o que foi escrito — os blocos separados por linha em branco mais o
 *    trecho em streaming que não chegou a fechar um bloco; sem blocos, os deltas colados, como antes.
 *
 * `falaDoMeio` (definido em 2026-10-07, ADR-083 §6): a resposta a uma mensagem da pessoa no meio do turno. A que o
 * driver já mandou como fala intermediária (`falados`) sai da fala, e o `result.texto` igual a ela também; a que não
 * saiu (`obrigatorios`) entra mesmo curta, antes de outra ferramenta. Sem nenhuma, tudo como antes.
 */
export function classificarResultado(entrada: {
  eventos: readonly EventoStream[];
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  sinais?: Partial<SinaisTurno>;
  /** true quando o driver chamou interromper() (SIGTERM) — antes ou depois do init. */
  interrompidoPeloDriver?: boolean;
  falaDoMeio?: FalaDoMeioNoTurno;
  /** NOD-293 (C20): o id do driver (`claude-cli`, `codex-chat`…) para a causa `sem_result:<driver>`. */
  driver?: string;
}): ResultadoTurno {
  let sinais: SinaisTurno = { ...SINAIS_ZERADOS, ...entrada.sinais };
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  // NOD-171: o último `rate_limit` da rodada que o `result` fecha; a rodada seguinte começa sem nenhum.
  let rateLimit: Extract<EventoStream, { tipo: "rate_limit" }> | null = null;
  let rateLimitDoResult: Extract<EventoStream, { tipo: "rate_limit" }> | null = null;
  const ferramentasChamadas: string[] = [];
  // NOD-353: as chamadas cujo `tool_result` voltou com erro, pelo índice em `ferramentasChamadas` (o "Falhou" da fala).
  const indicePorId = new Map<string, number>();
  const ferramentasFalharam: number[] = [];
  let textoStream = "";
  // Deltas desde o último bloco completo: o trecho que um SIGTERM deixa sem o `assistant` que o fecharia.
  let textoAberto = "";
  const blocos: { texto: string; posicao: number; obrigatorio: boolean }[] = [];
  const falados = entrada.falaDoMeio?.falados;
  const obrigatorios = entrada.falaDoMeio?.obrigatorios;
  const jaFaladas: string[] = [];
  const jaFaladasCruas: string[] = [];
  let ultimaFerramenta = -1;
  // definido em 2026-10-11: o motivo de cada negação do hook do nod, pelo nome da ferramenta que o tool_use pediu.
  const nomePorId = new Map<string, string>();
  const negacoesDoNod: { nome: string; motivo: string }[] = [];
  // NOD-276 (D10): o usage de cada chamada à API (`message_delta`). Sem `result` é o único uso que o turno deixa.
  let tokensDasChamadas: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
  for (const [posicao, ev] of entrada.eventos.entries()) {
    sinais = reduzirSinais(sinais, ev);
    if (ev.tipo === "tool_use") nomePorId.set(ev.id, ev.nome);
    if (ev.tipo === "tool_result" && ev.isError) {
      const motivo = motivoDoHookDoNod(ev.texto);
      if (motivo !== null) negacoesDoNod.push({ nome: nomePorId.get(ev.toolUseId) ?? "", motivo: motivo.slice(0, 1000) });
      const i = indicePorId.get(ev.toolUseId);
      if (i !== undefined && !ferramentasFalharam.includes(i)) ferramentasFalharam.push(i);
    }
    if (ev.tipo === "chamada") tokensDasChamadas = somarTokens(tokensDasChamadas, { entrada: ev.entrada, saida: ev.saida, cacheLeitura: ev.cacheLido, cacheCriacao: ev.cacheNovo });
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "rate_limit") rateLimit = ev;
    else if (ev.tipo === "result") {
      result = ev;
      rateLimitDoResult = rateLimit;
      rateLimit = null;
    } else if (ev.tipo === "tool_use") {
      // Revisão 3 do #523: o id repetido no turno (o `item_N` do Codex a cada rodada) vale para a chamada mais recente.
      if (ev.id) indicePorId.set(ev.id, ferramentasChamadas.length);
      ferramentasChamadas.push(ev.nome);
      ultimaFerramenta = posicao;
    } else if (ev.tipo === "delta") {
      textoStream += ev.texto;
      textoAberto += ev.texto;
    } else if (ev.tipo === "texto_bloco") {
      textoAberto = "";
      if (falados?.has(ev)) {
        jaFaladas.push(normalizar(ev.texto));
        jaFaladasCruas.push(ev.texto);
      }
      else blocos.push({ texto: ev.texto, posicao, obrigatorio: obrigatorios?.has(ev) === true });
    }
  }
  const lancou = entrada.exitCode !== null || entrada.signal !== null || entrada.eventos.length > 0;
  sinais = { ...sinais, attempted: sinais.attempted || lancou };
  const sessaoCli = result?.sessaoCli ?? init?.sessaoCli ?? null;
  const tokensZerados: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

  const todos = blocos.map((b) => b.texto);
  // A resposta do meio já foi fala: o `result.texto` que a repete (era o último bloco) e os deltas dela não voltam.
  const jaFalado = (t: string) => jaFaladas.includes(normalizar(t));
  const deltas = jaFaladasCruas.reduce((t, falada) => t.replace(falada, ""), textoStream);
  if (result) {
    const depois = blocos.filter((b) => b.posicao > ultimaFerramenta).map((b) => b.texto);
    // NOD-174: na falha, o `result` é o erro do CLI em inglês, não fala do bot — fica só no `erroCru`. O que o modelo
    // escreveu antes do erro continua (vira parcial no servidor).
    const doResult = result.sucesso && !jaFalado(result.texto) ? result.texto : "";
    const final = doResult || juntarBlocos(depois) || juntarBlocos(todos) || deltas;
    const anteriores = blocos.filter((b) => b.posicao < ultimaFerramenta);
    const antes = anteriores.map((b) => b.texto);
    const fala = comporFalaContada(antes, final, new Set(anteriores.flatMap((b, i) => (b.obrigatorio ? [i] : []))));
    const base = {
      texto: fala.texto,
      blocosColados: fala.colados,
      sessaoCli,
      sinais,
      custoUsd: result.custoUsd,
      tokens: result.tokens,
      ferramentasChamadas,
      ...(ferramentasFalharam.length > 0 ? { ferramentasFalharam } : {}),
      negacoesPermissao: result.negacoesPermissao,
      ...(negacoesDoNod.length > 0 ? { negacoesDoNod } : {}),
    };
    if (result.sucesso) return { desfecho: "sucesso", ...base };
    // NOD-171: o CLI barrou pelo plano (`rejected`) e a rodada fechou com erro. Pelo estado, nunca pelo texto do result.
    // Com o overage em uso o pedido seguiu apesar do `rejected`: o erro é outro. O max_turns diz o próprio motivo.
    // NOD-293 (C20): o turno falho também diz a causa em código (o subtype do result); texto do CLI nunca.
    const causa = `falha:${/^[A-Za-z0-9_-]{1,32}$/.test(result.subtype) ? result.subtype : "desconhecido"}`;
    if (rateLimitDoResult?.status === "rejected" && !rateLimitDoResult.usandoOverage && result.subtype !== "error_max_turns") {
      return { desfecho: "falha", motivoFalha: "limite_do_plano", limiteVoltaEm: rateLimitDoResult.voltaEm ?? null, erroCru: result.erroCru, ...base, causa };
    }
    return { desfecho: "falha", motivoFalha: result.subtype === "error_max_turns" ? "erro_max_turns" : "erro_execucao", erroCru: result.erroCru, ...base, causa };
  }

  const texto = blocos.length > 0 ? juntarBlocos([...todos, textoAberto]) : deltas;
  // NOD-276 (definido em 2026-10-15, D10): sem `result` o CLI não diz o custo, mas as chamadas já gastaram. Antes o turno
  // saía com tokens zerados e custo null — um turno caído no meio sumia dos somatórios como se não tivesse custado nada.
  // Agora sai com os tokens das chamadas e `custoDesconhecido` (a tela diz "custo desconhecido"; o total, "parcial").
  const gastou = tokensDasChamadas.entrada + tokensDasChamadas.saida + tokensDasChamadas.cacheLeitura + tokensDasChamadas.cacheCriacao > 0;
  // NOD-264 (C20): a causa da entrega sem result, só em código — o driver interrompeu, o sinal que chegou ou o exit.
  // NOD-293 (C20): o exit 0 sem result também (era o turno_interrompido sem causa que sobrava): `sem_result:<driver>`.
  const causa = entrada.interrompidoPeloDriver === true
    ? "interrompido_pelo_driver"
    : entrada.signal !== null
      ? `sinal:${entrada.signal}`
      : entrada.exitCode === null
        ? null
        : entrada.exitCode !== 0
          ? `exit:${entrada.exitCode}`
          : `sem_result:${entrada.driver && /^[A-Za-z0-9_-]{1,32}$/.test(entrada.driver) ? entrada.driver : "desconhecido"}`;
  const base = { texto, sessaoCli, custoUsd: null, tokens: gastou ? tokensDasChamadas : tokensZerados, ...(gastou ? { custoDesconhecido: true } : {}), ferramentasChamadas, ...(ferramentasFalharam.length > 0 ? { ferramentasFalharam } : {}), negacoesPermissao: [] as string[], ...(negacoesDoNod.length > 0 ? { negacoesDoNod } : {}), ...(causa ? { causa } : {}) };
  if (entrada.interrompidoPeloDriver === true || entrada.signal !== null || init) return { desfecho: "interrompido", ...base, sinais };
  if (entrada.exitCode === null) {
    return { desfecho: "interrompido", motivoInterrupcao: "lancamento_falhou", ...base, sinais };
  }
  if (entrada.exitCode !== 0) {
    return { desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", ...base, sinais: { ...sinais, rejected: true } };
  }
  return { desfecho: "interrompido", motivoInterrupcao: "sem_progresso", ...base, sinais };
}

/**
 * NOD-264 (C20): a causa do turno sem result, só se tiver a forma de código (`renovacao_negada:sem_plano`,
 * `sinal:SIGTERM`, `exit:1`…). Texto livre (stderr, frase do CLI) nunca atravessa a ponte nem entra no evento.
 */
export function causaDaEntrega(causa: unknown): string | null {
  return typeof causa === "string" && causa.length <= 64 && /^[a-z_]+(:[A-Za-z0-9_-]{1,32})?$/.test(causa) ? causa : null;
}

/**
 * NOD-293 (C20): a causa do turno do Codex app-server (codex-chat.ts) que não deu certo. A volta que o app-server recusou
 * (`turn/start` com erro) fecha como `result` de erro e vira `turno_recusado`; o processo que saiu com erro ou morreu por
 * sinal diz mais que o subtype genérico da volta (`exit:N`, `sinal:X`); o Parar fica `interrompido_pelo_driver` (o laço
 * ainda troca pela causa dele). Sucesso não tem causa.
 */
export function causaDoCodexChat(r: Pick<ResultadoTurno, "desfecho" | "causa">, fim: { turnoRecusado: boolean; exitCode: number | null; signal: string | null }): string | undefined {
  if (r.desfecho === "sucesso") return undefined;
  if (r.causa === "interrompido_pelo_driver") return r.causa;
  if (fim.turnoRecusado) return "turno_recusado";
  if (fim.signal !== null) return `sinal:${fim.signal}`;
  if (fim.exitCode !== null && fim.exitCode !== 0) return `exit:${fim.exitCode}`;
  return r.causa;
}

/** NOD-264 (C20): quantas linhas do fim do stderr vão para o log local quando o turno acaba sem result. */
export const LINHAS_DO_STDERR = 20;

/**
 * NOD-264 (C20): as últimas `LINHAS_DO_STDERR` linhas do stderr, com os segredos redigidos ANTES de cortar (segredos.ts).
 * Só para o log da máquina — nunca atravessa a ponte. Vazio vira null.
 */
export function fimDoStderr(stderr: string, linhas: number = LINHAS_DO_STDERR): string | null {
  const ultimas = redigirSegredos(stderr).split("\n").map((l) => l.trimEnd()).filter((l) => l !== "").slice(-linhas);
  return ultimas.length > 0 ? ultimas.join("\n").slice(-4000) : null;
}

/** Uma rodada da sessão viva: os eventos até um `result`, inclusive. */
function rodadas(eventos: readonly EventoStream[]): { fechadas: EventoStream[][]; aberta: EventoStream[] } {
  const fechadas: EventoStream[][] = [];
  let atual: EventoStream[] = [];
  for (const ev of eventos) {
    atual.push(ev);
    if (ev.tipo === "result") {
      fechadas.push(atual);
      atual = [];
    }
  }
  return { fechadas, aberta: atual };
}

/** A fala de UMA rodada fechada (eventos até o `result`): a mesma composição do fim do turno. */
export function textoDaRodada(eventos: readonly EventoStream[], falaDoMeio?: FalaDoMeioNoTurno): string {
  return classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "", falaDoMeio }).texto;
}

const somarTokens = (a: TokensTurno, b: TokensTurno): TokensTurno => ({
  entrada: a.entrada + b.entrada,
  saida: a.saida + b.saida,
  cacheLeitura: a.cacheLeitura + b.cacheLeitura,
  cacheCriacao: a.cacheCriacao + b.cacheCriacao,
});

/**
 * O fim de uma SESSÃO VIVA (definido em 2026-10-01, ADR-067): o CLI fica aberto enquanto há comando em segundo plano
 * ou mensagem nova, e cada volta do modelo fecha com um `result`. Medido no 2.1.286: `total_cost_usd` é ACUMULADO na
 * sessão (vale o do último) e `usage` é da rodada (soma-se). As rodadas já entregues como fala intermediária
 * (`rodadasJaFaladas`) não entram de novo no texto.
 *
 * Com um `result` só e nada depois dele, devolve exatamente o mesmo que classificarResultado. Se depois do último
 * `result` o modelo voltou a trabalhar e o processo foi interrompido (Parar, sinal), o turno sai interrompido com o
 * que foi escrito desde então — e não "sucesso" pelo `result` de uma rodada anterior.
 */
export function classificarSessao(entrada: Parameters<typeof classificarResultado>[0] & { rodadasJaFaladas?: number }): ResultadoTurno {
  const { fechadas, aberta } = rodadas(entrada.eventos);
  if (fechadas.length === 0) return classificarResultado(entrada);
  const results = fechadas.map((r) => r.at(-1)).filter((e): e is Extract<EventoStream, { tipo: "result" }> => e?.tipo === "result");
  const ultimo = results.at(-1)!;
  const tokens = results.reduce((t, r) => somarTokens(t, r.tokens), { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 } as TokensTurno);
  const negacoesPermissao = [...new Set(results.flatMap((r) => r.negacoesPermissao))];
  const trabalhouDepois = aberta.some((e) => e.tipo === "delta" || e.tipo === "texto_bloco" || e.tipo === "tool_use");
  // Comando em segundo plano que nunca terminou: havia trabalho pendente quando o processo acabou.
  const emFundo = new Set<string>();
  for (const e of entrada.eventos) {
    if (e.tipo !== "tarefa_fundo") continue;
    if (e.estado === "iniciada") emFundo.add(e.id);
    else emFundo.delete(e.id);
  }
  const pendente = trabalhouDepois || emFundo.size > 0;
  const parou = entrada.interrompidoPeloDriver === true || entrada.signal !== null || (entrada.exitCode !== null && entrada.exitCode !== 0);
  // A sessão de uma rodada só (o turno de sempre): nada muda, nem os espaços do texto.
  if (fechadas.length === 1 && !(entrada.rodadasJaFaladas ?? 0) && !(pendente && parou)) return classificarResultado(entrada);
  const cortado = pendente && parou;
  const textoAberto = trabalhouDepois ? classificarResultado({ eventos: aberta, exitCode: null, signal: null, stderr: "", interrompidoPeloDriver: true, falaDoMeio: entrada.falaDoMeio }).texto : "";
  const texto = juntarBlocos([...fechadas.slice(entrada.rodadasJaFaladas ?? 0).map((r) => textoDaRodada(r, entrada.falaDoMeio)), textoAberto]);
  const geral = classificarResultado(entrada);
  if (cortado) {
    const init = entrada.eventos.find((e) => e.tipo === "init");
    // NOD-353: os índices de falha da rodada aberta não valem para a lista do turno inteiro (a de `geral`).
    const { ferramentasFalharam: _daRodada, ...interrompido } = classificarResultado({ ...entrada, eventos: init ? [init, ...aberta] : aberta, interrompidoPeloDriver: true });
    return { ...interrompido, texto, sessaoCli: geral.sessaoCli, ferramentasChamadas: geral.ferramentasChamadas, ...(geral.ferramentasFalharam ? { ferramentasFalharam: geral.ferramentasFalharam } : {}), custoUsd: ultimo.custoUsd, tokens, negacoesPermissao, ...(geral.negacoesDoNod ? { negacoesDoNod: geral.negacoesDoNod } : {}) };
  }
  return { ...geral, texto, tokens, negacoesPermissao };
}
