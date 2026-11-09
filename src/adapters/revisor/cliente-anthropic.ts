/**
 * O cliente do revisor no servidor (definido em 2026-10-25, ADR-115 "Revisor no servidor"): UMA chamada à API de
 * mensagens da Anthropic, por `fetch`, com a chave do Nod (`NOD_REVISOR_CHAVE`). Sem SDK e sem nova tentativa (plano,
 * revisão de engenharia 18): o SDK tenta de novo por padrão (2 vezes, inclusive no 429 e no timeout) e o tempo de
 * parede passaria do prazo da revisão; aqui um `AbortSignal.timeout` corta a chamada inteira — conexão, resposta e corpo.
 *
 * Nunca lança: devolve o texto do modelo (cru; quem lê o veredito é o domínio) e as fichas, ou a falha com um código curto
 * para o log. O corpo de erro da API não é lido nem logado (pode ecoar o pedido, que leva dado da pessoa).
 *
 * revisto em 2026-10-26 (revisão do #524, item 2): o pedido leva a saída estruturada da API (`output_config.format`, um
 * JSON schema; GA, sem cabeçalho beta, aceita no Haiku 4.5): a geração fica presa ao veredito, e o `lerVeredito` estrito
 * continua sendo quem decide (a recusa do modelo ou o corte em `max_tokens` ainda podem sair fora do esquema).
 */
import { ESQUEMA_VEREDITO } from "../../domain/revisor.ts";

export const URL_API_ANTHROPIC = "https://api.anthropic.com/v1/messages";
/** A versão da API (cabeçalho obrigatório da Messages API). */
export const VERSAO_API_ANTHROPIC = "2023-06-01";
/**
 * definido em 2026-10-25: o veredito é um JSON de uma linha com o motivo até 160 caracteres (SAIDA_REVISOR_MAX = 600
 * caracteres de texto); 400 fichas cobrem isso com folga e cortam o custo de um modelo que desande.
 */
export const MAX_FICHAS_SAIDA = 400;
/** O corpo da resposta acima disto é tratado como falha (a resposta normal tem ~1 KB). */
const CORPO_MAX = 64 * 1024;

export type ChamadaRevisor = { modelo: string; sistema: string; entrada: string; prazoMs: number };

/**
 * `motivo` vai só para o log: `http_<status>`, `rede`, `prazo`, `formato` (o corpo não é a mensagem esperada) ou
 * `recusa` (`stop_reason: "refusal"`). As fichas vêm quando a API respondeu, mesmo numa recusa (o teto conta o gasto).
 */
export type ResultadoCliente =
  | { ok: true; texto: string; fichasEntrada: number; fichasSaida: number; ms: number }
  | { ok: false; falha: "prazo" | "api"; motivo: string; status?: number; fichasEntrada?: number; fichasSaida?: number; ms: number };

export interface ClienteRevisor {
  revisar(c: ChamadaRevisor): Promise<ResultadoCliente>;
}

export type OpcoesCliente = {
  chave: string;
  url?: string;
  fetchImpl?: typeof fetch;
  agora?: () => number;
};

/**
 * A falha conta no disjuntor? (revisão do #524, item 3) Só a do serviço, que vale para todas as contas: rede, prazo,
 * corpo que não é uma mensagem, e os status que não dependem do pedido — 401/403 (a chave), 404 (o modelo), 408, 429 e
 * 5xx (inclui o 529, sobrecarga). O que o CONTEÚDO do pedido pode provocar não conta: a recusa do modelo, o 400/413/422
 * e o texto fora do esquema (este nem é falha do cliente). Senão uma conta abriria o disjuntor de todas por injeção.
 */
export function contaNoDisjuntor(r: Extract<ResultadoCliente, { ok: false }>): boolean {
  if (r.falha === "prazo" || r.motivo === "rede" || r.motivo === "formato") return true;
  if (r.status === undefined) return false;
  return r.status >= 500 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 408 || r.status === 429;
}

function inteiro(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** As fichas de entrada somam as do cache (a chamada não pede cache: elas vêm 0, mas se vierem, são cobradas). */
function fichasDe(uso: unknown): { fichasEntrada: number; fichasSaida: number } {
  const u = typeof uso === "object" && uso !== null ? (uso as Record<string, unknown>) : {};
  return { fichasEntrada: inteiro(u.input_tokens) + inteiro(u.cache_creation_input_tokens) + inteiro(u.cache_read_input_tokens), fichasSaida: inteiro(u.output_tokens) };
}

function ehAborto(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export function criarClienteAnthropic(o: OpcoesCliente): ClienteRevisor {
  const url = o.url ?? URL_API_ANTHROPIC;
  const f = o.fetchImpl ?? fetch;
  const agora = o.agora ?? Date.now;
  return {
    async revisar(c) {
      const inicio = agora();
      const ms = () => Math.max(0, agora() - inicio);
      if (c.prazoMs <= 0) return { ok: false, falha: "prazo", motivo: "prazo", ms: 0 };
      const sinal = AbortSignal.timeout(c.prazoMs);
      let corpo: string;
      let status: number;
      try {
        const r = await f(url, {
          method: "POST",
          headers: { "x-api-key": o.chave, "anthropic-version": VERSAO_API_ANTHROPIC, "content-type": "application/json" },
          body: JSON.stringify({
            model: c.modelo,
            max_tokens: MAX_FICHAS_SAIDA,
            system: c.sistema,
            messages: [{ role: "user", content: c.entrada }],
            output_config: { format: { type: "json_schema", schema: ESQUEMA_VEREDITO } },
          }),
          signal: sinal,
          redirect: "error",
        });
        status = r.status;
        if (status !== 200) {
          await r.body?.cancel().catch(() => undefined);
          return { ok: false, falha: "api", motivo: `http_${status}`, status, ms: ms() };
        }
        corpo = await r.text();
      } catch (e) {
        return { ok: false, falha: ehAborto(e) || sinal.aborted ? "prazo" : "api", motivo: ehAborto(e) || sinal.aborted ? "prazo" : "rede", ms: ms() };
      }
      if (corpo.length > CORPO_MAX) return { ok: false, falha: "api", motivo: "formato", status, ms: ms() };
      let msg: unknown;
      try {
        msg = JSON.parse(corpo);
      } catch {
        return { ok: false, falha: "api", motivo: "formato", status, ms: ms() };
      }
      if (typeof msg !== "object" || msg === null || !Array.isArray((msg as { content?: unknown }).content)) return { ok: false, falha: "api", motivo: "formato", status, ms: ms() };
      const m = msg as { content: unknown[]; stop_reason?: unknown; usage?: unknown };
      const fichas = fichasDe(m.usage);
      if (m.stop_reason === "refusal") return { ok: false, falha: "api", motivo: "recusa", status, ...fichas, ms: ms() };
      // Só os blocos de texto: um modelo com raciocínio (fora do padrão) devolve blocos `thinking` antes.
      const texto = m.content
        .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string")
        .map((b) => b.text)
        .join("");
      return { ok: true, texto, ...fichas, ms: ms() };
    },
  };
}
