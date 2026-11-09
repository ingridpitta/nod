import type { Confianca } from "../../contracts/mensagem.ts";
import type { CabecalhoMidia, RecusasMidia } from "../../contracts/anexo.ts";
import type { DesfechoItem } from "../../contracts/motivos.ts";
import type { Negacao } from "../../contracts/negacao.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { LONGPOLL_APROVACAO_MS, PRAZO_FERRAMENTA_PROXY_MS } from "../../shared/constantes.ts";
import { negacaoConectorIndisponivel, redigirNegacao } from "../mcp-proxy/negacao.ts";

/**
 * Cliente HTTP ÚNICO das rotas internas do nod (EMENDA 6, EMENDA-L9 §7): /api/interno/… com
 * `Authorization: Bearer <token de turno>`. Usado pelo proxy MCP (src/adapters/mcp-proxy/proxy.ts) e
 * pelo driver catcher (in-process, sem processo filho). Nunca manda `Origin` (o roteador responde
 * 403 antes do token) e nunca manda 'remetente' no corpo: a identidade é a do token (ADR-024).
 *
 * Forma das rotas (tabela ROTAS em src/contracts/api.ts; handlers em rotas/interno.ts):
 *   GET  /api/interno/plano                         → PlanoTurno do token
 *   POST /api/interno/ferramentas/:nome {argumentos} → ResultadoChamada (ok | negacao | aguardar)
 *   GET  /api/interno/decisoes/:id/aguardar         → {estado:'decidida', itens} | {estado:'pendente'}
 *   POST /api/interno/negacoes                      → negação decidida LOCALMENTE pelo proxy (trilha)
 *
 * definido em 2026-09-16 (unificação da L9): os tipos de fio abaixo eram o stub da L5
 * (cliente-nod-stub.ts, apagado); `chamarFerramenta` é o atalho do catcher — resolve `aguardar`
 * e negação em texto, como o proxy faria, para o tool_result do roteiro.
 */
export type RespostaPlano =
  | { ok: true; plano: PlanoTurno }
  | { ok: false; motivo: "plano_ausente" | "servidor_fora" | "falha_tecnica"; status: number | null };

/** Corpo devolvido por POST /api/interno/ferramentas/:nome. `aguardar` = decisão criada, o proxy faz long-poll. */
export type RespostaFerramenta =
  | { ok: true; conteudo: string; confianca: Confianca; isError?: boolean; imagem?: { mimeType: "image/png"; data: string }; audio?: { mimeType: "audio/wav"; data: string } }
  | { ok: false; negacao: Negacao }
  | { aguardar: string }
  /** ADR-048: o servidor decidiu e a ferramenta roda NESTA máquina (gh do Mac); o proxy executa e relata. */
  | { executarLocal: { capacidade: string; argumentos: Record<string, unknown> } };

export type RespostaAguardar =
  /** `resultado` (0032): o que a ação aprovada no computador devolveu — conteúdo NÃO confiável. */
  | { estado: "decidida"; itens: { idx: number; desfecho: DesfechoItem | null; resultado?: string }[] }
  /** `soltar` (ADR-083, #194): a memória do Mac apertou — pare de esperar agora e encerre o turno. */
  | { estado: "pendente"; soltar?: true };

export type FalhaTransporte = { transporte: "servidor_fora" | "timeout" | "falha_tecnica"; status: number | null };

export type ConteudoFerramenta = { conteudo: string; isError: boolean };

export interface ClienteNod {
  plano(): Promise<RespostaPlano>;
  ferramenta(nome: string, argumentos: Record<string, unknown>): Promise<RespostaFerramenta | FalhaTransporte>;
  aguardar(decisaoId: string, fatiaMs: number): Promise<RespostaAguardar | FalhaTransporte>;
  /** Negação decidida LOCALMENTE pelo proxy (fora do catálogo): o servidor grava trilha e pede interrupção. */
  negacao(n: Negacao): Promise<void>;
  /** ADR-048: desfecho (código fechado) de uma ferramenta executada nesta máquina, para a trilha. */
  execucaoLocal?(nome: string, codigo: string): Promise<void>;
  /**
   * NOD-323: sobe uma mídia da pasta do bot (corpo binário cru; vazio = só o cartão). `status` é o do servidor: 201/200
   * com {id, familia, exibicao, semBytes}; 415/429/409/400 com {codigo}; 503 = ocupado, tente de novo.
   */
  /** `sinal` cancela o envio (a J6 parou); `retryAposS` é o retry-after do 503. */
  midia?(cabecalho: CabecalhoMidia, corpo: Uint8Array, sinal?: AbortSignal): Promise<{ status: number; json: unknown; retryAposS?: number } | FalhaTransporte>;
  /** NOD-323: o que não foi anexado, só código e contagem (nunca o caminho). */
  recusasMidia?(recusas: RecusasMidia): Promise<void>;
  /** Atalho do catcher: ferramenta + (aguardar) + negação resolvidos em texto, isError quando negado/fora. */
  chamarFerramenta(nome: string, argumentos: Record<string, unknown>): Promise<ConteudoFerramenta>;
}

export type OpcoesClienteNod = {
  url: string;
  token: string;
  /** definido em 2026-09-16: 5 s — acima disso o servidor local está fora, não lento (ADR-029: conector_indisponivel com `desde`). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  agora?: () => number;
};

export const TIMEOUT_CLIENTE_NOD_MS = 5_000;
/** NOD-323: 50 MiB numa rede de casa leva tempo; 2 min antes de desistir (o proxy tenta uma vez de novo). */
export const PRAZO_UPLOAD_MIDIA_MS = 120_000;

function ehFalha(x: unknown): x is FalhaTransporte {
  return typeof x === "object" && x !== null && "transporte" in x;
}

/** Predicado: a resposta é falha de TRANSPORTE (servidor fora, timeout), não uma decisão do servidor. */
export function ehFalhaTransporte(x: RespostaFerramenta | RespostaAguardar | FalhaTransporte): x is FalhaTransporte {
  return ehFalha(x);
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function criarClienteNod(opcoes: OpcoesClienteNod): ClienteNod {
  const base = opcoes.url.replace(/\/+$/, "");
  const f = opcoes.fetchImpl ?? fetch;
  const timeout = opcoes.timeoutMs ?? TIMEOUT_CLIENTE_NOD_MS;
  // O servidor só responde a ferramenta depois de ouvir o conector: esperar menos que ele é declarar
  // "servidor fora" um servidor que está trabalhando. timeoutMs explícito (testes) vale para tudo.
  const prazoFerramenta = (nome: string): number => (nome.startsWith("computador_") ? 240_000 : opcoes.timeoutMs ?? PRAZO_FERRAMENTA_PROXY_MS);
  const agora = opcoes.agora ?? (() => Date.now());

  async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: unknown, timeoutMs = timeout): Promise<{ status: number; json: unknown } | FalhaTransporte> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await f(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${opcoes.token}`, "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      const texto = await r.text();
      let json: unknown = null;
      try {
        json = texto === "" ? null : JSON.parse(texto);
      } catch {
        json = texto;
      }
      return { status: r.status, json };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { transporte: "timeout", status: null };
      return { transporte: "servidor_fora", status: null };
    } finally {
      clearTimeout(t);
    }
  }

  const cliente: ClienteNod = {
    async plano() {
      const r = await chamar("GET", "/api/interno/plano");
      if (ehFalha(r)) return { ok: false, motivo: "servidor_fora", status: null };
      if (r.status === 200 && obj(r.json)) return { ok: true, plano: r.json as PlanoTurno };
      if (r.status === 401 || r.status === 404) return { ok: false, motivo: "plano_ausente", status: r.status };
      return { ok: false, motivo: "falha_tecnica", status: r.status };
    },

    async ferramenta(nome, argumentos) {
      const r = await chamar("POST", `/api/interno/ferramentas/${encodeURIComponent(nome)}`, { argumentos }, prazoFerramenta(nome));
      if (ehFalha(r)) return r;
      const c = obj(r.json);
      if (r.status === 200 && c) {
        if ("ok" in c || "aguardar" in c || "executarLocal" in c) return r.json as RespostaFerramenta;
        // Servidor de teste sem chamar-ferramenta: {conteudo, isError} cru vira resposta ok (confiança do chamador).
        if (typeof c["conteudo"] === "string") return c["isError"] === true ? { ok: true, conteudo: `erro: ${c["conteudo"]}`, confianca: "confiavel" } : { ok: true, conteudo: c["conteudo"], confianca: "confiavel" };
      }
      // 401/403/404/5xx: o corpo é o JSON seguro do servidor (código fechado, ADR-002), nunca err.message.
      return { transporte: "falha_tecnica", status: r.status };
    },

    async aguardar(decisaoId, fatiaMs) {
      const r = await chamar("GET", `/api/interno/decisoes/${encodeURIComponent(decisaoId)}/aguardar`, undefined, fatiaMs + timeout);
      if (ehFalha(r)) return r;
      if (r.status === 200 && obj(r.json)) return r.json as RespostaAguardar;
      return { transporte: "falha_tecnica", status: r.status };
    },

    async negacao(n) {
      await chamar("POST", "/api/interno/negacoes", n);
    },

    async execucaoLocal(nome, codigo) {
      await chamar("POST", "/api/interno/execucoes-locais", { nome, codigo });
    },

    async midia(cabecalho, corpo, sinal) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opcoes.timeoutMs ?? PRAZO_UPLOAD_MIDIA_MS);
      const parar = () => ctrl.abort();
      if (sinal?.aborted) ctrl.abort();
      else sinal?.addEventListener("abort", parar, { once: true });
      try {
        const r = await f(`${base}/api/interno/midias`, {
          method: "POST",
          headers: { authorization: `Bearer ${opcoes.token}`, "content-type": "application/octet-stream", "x-nod-midia": encodeURIComponent(JSON.stringify(cabecalho)) },
          body: corpo as Uint8Array<ArrayBuffer>,
          signal: ctrl.signal,
        });
        const texto = await r.text();
        let json: unknown = null;
        try {
          json = texto === "" ? null : JSON.parse(texto);
        } catch {
          json = null;
        }
        const retry = Number(r.headers.get("retry-after") ?? "");
        return { status: r.status, json, ...(Number.isFinite(retry) && retry > 0 ? { retryAposS: retry } : {}) };
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return { transporte: "timeout", status: null };
        return { transporte: "servidor_fora", status: null };
      } finally {
        clearTimeout(t);
        sinal?.removeEventListener("abort", parar);
      }
    },

    async recusasMidia(recusas) {
      await chamar("POST", "/api/interno/midias/recusas", { recusas });
    },

    async chamarFerramenta(nome, argumentos) {
      const r = await chamar("POST", `/api/interno/ferramentas/${encodeURIComponent(nome)}`, { argumentos }, prazoFerramenta(nome));
      if (ehFalha(r)) {
        const n = negacaoConectorIndisponivel(nome, agora(), r.transporte === "timeout" ? "timeout_transporte" : "conector_indisponivel");
        return { conteudo: redigirNegacao(n, agora()), isError: true };
      }
      const c = obj(r.json);
      if (r.status < 200 || r.status >= 300 || !c) {
        return { conteudo: typeof r.json === "string" ? r.json : JSON.stringify(r.json), isError: true };
      }
      if ("aguardar" in c && typeof c["aguardar"] === "string") {
        const a = await cliente.aguardar(c["aguardar"], LONGPOLL_APROVACAO_MS);
        if (!ehFalha(a) && a.estado === "decidida") return { conteudo: JSON.stringify({ estado: "decidida", itens: a.itens }), isError: false };
        return { conteudo: JSON.stringify({ estado: "pendente", decisao_id: c["aguardar"], instrucao: "encerre o turno; a decisão retoma depois" }), isError: false };
      }
      if (c["ok"] === false && obj(c["negacao"])) return { conteudo: redigirNegacao(c["negacao"] as Negacao, agora()), isError: true };
      // O catcher não tem gh nem executa nada fora: registra que a ferramenta rodaria na máquina.
      if (obj(c["executarLocal"])) return { conteudo: JSON.stringify({ executaria_na_maquina: c["executarLocal"] }), isError: false };
      if (typeof c["conteudo"] === "string") return { conteudo: c["conteudo"], isError: c["isError"] === true };
      return { conteudo: JSON.stringify(r.json), isError: false };
    },
  };
  return cliente;
}
