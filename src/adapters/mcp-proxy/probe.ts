import type { CapacidadeConector, TransporteConector } from "../../contracts/conector.ts";
import type { JsonSchema } from "../../contracts/ferramentas-nod.ts";
import type { ResultadoSonda } from "../../contracts/servicos.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { log } from "../../obs/log.ts";
import { PROBE_MS } from "../../shared/constantes.ts";
import { criarClienteMcp, ErroTransporteMcp, type FerramentaDescoberta } from "./cliente-mcp.ts";

/**
 * Sonda de conector (ADR-013): descobre o catálogo por tools/list e captura readOnlyHint AQUI, na
 * DESCOBERTA — nunca em tempo de chamada. Roda no servidor com ambiente de REGIME SERVIDOR
 * (allowlist, ADR-015 B) mais o env decifrado do conector; stderr só vai ao log (cliente-mcp).
 * Teto PROBE_MS por requisição (definido em 2026-09-16, src/shared/constantes.ts). No http, a sonda é leitura
 * e tem nova tentativa (NOD-157): a operação inteira cabe em ORCAMENTO_CONECTOR_MS.
 */
export type ConfigSonda = {
  nome: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  /** Env DECIFRADO do conector; mesclado sobre a allowlist do regime servidor. */
  env?: Record<string, string>;
};

export type OpcoesSonda = {
  timeoutMs?: number;
  /**
   * NOD-208: orçamento da sonda inteira no http (initialize, tools/list, páginas e novas tentativas); o prazo de
   * cada requisição é cortado ao que sobra. Ausente = ORCAMENTO_CONECTOR_MS (30 s) do cliente.
   */
  orcamentoMs?: number;
  /** Fonte do ambiente base (default process.env); injetável no teste. */
  ambiente?: Readonly<Record<string, string | undefined>>;
  fetchImpl?: typeof fetch;
};

const TIPOS: readonly JsonSchema["type"][] = ["object", "string", "number", "integer", "boolean", "array", "null"];

/** Reduz o inputSchema do conector ao subconjunto JsonSchema do nod (o que o proxy expõe e valida). */
export function paraJsonSchema(entrada: unknown): JsonSchema {
  const e = (typeof entrada === "object" && entrada !== null ? entrada : {}) as Record<string, unknown>;
  const tipo = TIPOS.find((t) => t === e.type) ?? "object";
  const saida: JsonSchema = Array.isArray(e.anyOf) || Array.isArray(e.oneOf) ? {} : { type: tipo };
  if (Array.isArray(e.anyOf)) saida.anyOf = e.anyOf.map(paraJsonSchema);
  if (Array.isArray(e.oneOf)) saida.oneOf = e.oneOf.map(paraJsonSchema);
  if (Array.isArray(e.type)) {
    delete saida.type;
    saida.anyOf = e.type.map((type) => paraJsonSchema({ ...e, type }));
  }
  if (typeof e.description === "string") saida.description = e.description;
  if (typeof e.properties === "object" && e.properties !== null) {
    const props: Record<string, JsonSchema> = {};
    for (const [k, v] of Object.entries(e.properties as Record<string, unknown>)) props[k] = paraJsonSchema(v);
    saida.properties = props;
  }
  if (Array.isArray(e.required)) saida.required = e.required.filter((r): r is string => typeof r === "string");
  if (typeof e.additionalProperties === "boolean") saida.additionalProperties = e.additionalProperties;
  if (Array.isArray(e.enum)) saida.enum = e.enum.filter((x): x is string => typeof x === "string");
  if (typeof e.items === "object" && e.items !== null) saida.items = paraJsonSchema(e.items);
  if (typeof e.minLength === "number") saida.minLength = e.minLength;
  if (typeof e.minItems === "number") saida.minItems = e.minItems;
  return saida;
}

export function paraCapacidade(t: FerramentaDescoberta): CapacidadeConector {
  return {
    nome: t.name,
    descricao: typeof t.description === "string" ? t.description : "",
    schema: paraJsonSchema(t.inputSchema),
    // Ausente = NÃO é readOnly (default fechado): só a anotação explícita libera a ferramenta em turno não confiável (ADR-026).
    readOnlyHint: t.annotations?.readOnlyHint === true,
    ...(t.annotations?.destructiveHint === true ? { destructiveHint: true } : {}),
  };
}

/**
 * NOD-212: a causa de uma falha de sonda, para o log separar o que o `motivo` junta (conector_indisponivel cobre 401,
 * 5xx, rede, sessão expirada e resposta grande). Só rótulos fixos e o código: nunca a URL, a chave ou a mensagem bruta.
 */
export function causaDaFalhaDeSonda(e: unknown): string {
  if (!(e instanceof ErroTransporteMcp)) return "falha_tecnica";
  if (e.sessaoExpirada) return "sessao_expirada";
  if (e.status !== undefined) return `http_${e.status}`;
  if (e.motivo === "timeout_transporte") return "prazo";
  if (e.cause instanceof ErroTransporteMcp) return causaDaFalhaDeSonda(e.cause);
  if (e.cause instanceof Error && e.cause.message === "resposta_mcp_grande") return "resposta_grande";
  if (e.cause instanceof Error && e.cause.name === "AbortError") return "prazo";
  if (typeof e.cause === "string") {
    const rpc = /^(-\d+) /.exec(e.cause);
    if (rpc) return `rpc_${rpc[1]}`;
    if (e.cause === "resposta não JSON-RPC") return "resposta_invalida";
  }
  if (e.motivo === "falha_tecnica") return "catalogo_invalido";
  return "rede";
}

export async function sondarConector(cfg: ConfigSonda, opcoes: OpcoesSonda = {}): Promise<ResultadoSonda> {
  const env = cfg.transporte === "http" ? { ...(cfg.env ?? {}) } : { ...montarAmbiente("servidor", opcoes.ambiente ?? process.env, process.platform), ...(cfg.env ?? {}) };
  const cliente = criarClienteMcp({
    nome: cfg.nome,
    transporte: cfg.transporte,
    comando: cfg.comando ?? null,
    args: cfg.args ?? [],
    url: cfg.url ?? null,
    env,
    timeoutMs: opcoes.timeoutMs ?? PROBE_MS,
    fetchImpl: opcoes.fetchImpl,
    ...(opcoes.orcamentoMs !== undefined ? { orcamentoMs: Math.max(1, opcoes.orcamentoMs) } : {}),
  });
  try {
    const ferramentas = await cliente.listar();
    const composio = cfg.transporte === "http" && cfg.url && ["app.composio.dev", "backend.composio.dev"].includes(new URL(cfg.url).hostname);
    // definido em 2026-09-17: só ferramentas concretas por capacidade; meta-executores burlariam a aprovação do destino.
    const concretas = composio ? ferramentas.filter((t) => !t.name.startsWith("COMPOSIO_")) : ferramentas;
    if (concretas.length === 0) {
      // NOD-208: catálogo vazio também é falha com log (antes, silêncio). `meta` = quantos COMPOSIO_* vieram.
      // O motivo devolvido segue conector_indisponivel: o contrato e a CHECK do banco não mudam. Sem URL nem chave.
      log("aviso", "sonda_conector_falhou", { conector: cfg.nome, motivo: "catalogo_vazio", meta: ferramentas.length - concretas.length, total: ferramentas.length });
      return { ok: false, motivo: "conector_indisponivel" };
    }
    return { ok: true, ferramentas: concretas.map(paraCapacidade) };
  } catch (e) {
    const motivo = e instanceof ErroTransporteMcp ? e.motivo : "falha_tecnica";
    log("aviso", "sonda_conector_falhou", { conector: cfg.nome, motivo, causa: causaDaFalhaDeSonda(e), ...(e instanceof ErroTransporteMcp && e.status !== undefined ? { status: e.status } : {}), erro: e instanceof Error ? e.name : "desconhecido" });
    const recusado = e instanceof ErroTransporteMcp && (e.status === 401 || e.status === 403);
    return { ok: false, motivo, ...(recusado ? { causa: "acesso_recusado" as const } : {}) };
  } finally {
    await cliente.fechar().catch(() => undefined);
  }
}
