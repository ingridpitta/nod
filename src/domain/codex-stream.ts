import type { EventoStream } from "../contracts/turno.ts";
import { entradaFerramentaObservavel } from "./entrada-ferramenta-observavel.ts";
import { redigirECortar } from "./segredos.ts";

/**
 * definido em 2026-09-18: normaliza eventos de codex exec --json; custo desconhecido permanece null.
 * definido em 2026-09-28: cada agent_message completa sai como `delta` (texto ao vivo) E `texto_bloco`
 * (composição da fala). O `turn.completed` não traz texto, então sem os blocos a fala eram todas as
 * mensagens coladas sem separador; com eles vale a mesma regra do Claude: a última mensagem é o final
 * e as anteriores só entram se forem relatório (comporFala em stream-json.ts).
 */
export function interpretarCodex(linha: string): EventoStream[] {
  let v: Record<string, unknown>;
  try { const j: unknown = JSON.parse(linha); if (!j || typeof j !== "object" || Array.isArray(j)) return []; v = j as Record<string, unknown>; } catch { return []; }
  const item = v.item && typeof v.item === "object" ? v.item as Record<string, unknown> : {};
  if (v.type === "thread.started") return [{ tipo: "init", sessaoCli: "", ferramentas: [], modelo: "", versaoCli: "", apiKeySource: "desconhecido" }];
  if (v.type === "item.completed" && item.type === "agent_message" && typeof item.text === "string") {
    return item.text.trim() === "" ? [{ tipo: "delta", texto: item.text }] : [{ tipo: "delta", texto: item.text }, { tipo: "texto_bloco", texto: item.text }];
  }
  if (v.type === "item.started" && item.type === "mcp_tool_call") {
    const nome = `mcp__${String(item.server ?? "nod")}__${String(item.tool ?? "")}`;
    return [{ tipo: "tool_use", id: String(item.id ?? ""), nome, input: entradaFerramentaObservavel(nome, item.arguments) }];
  }
  // definido em 2026-10-05: a chamada que falha traz o motivo do Codex (ex.: "user cancelled MCP tool call").
  if (v.type === "item.completed" && item.type === "mcp_tool_call") return [{ tipo: "tool_result", toolUseId: String(item.id ?? ""), isError: item.status === "failed", texto: item.status === "failed" ? mensagemDe(item.error) ?? "" : "" }];
  if (v.type !== "turn.completed" && v.type !== "turn.failed") return [];
  const usage = v.usage && typeof v.usage === "object" ? v.usage as Record<string, unknown> : {};
  const n = (key: string) => typeof usage[key] === "number" && Number.isFinite(usage[key]) ? usage[key] as number : 0;
  return [{ tipo: "result", sucesso: v.type === "turn.completed", subtype: v.type === "turn.completed" ? "success" : "error", erroCru: v.type === "turn.failed" ? mensagemDe(v.error) : null, sessaoCli: null, texto: "", custoUsd: null,
    tokens: { entrada: n("input_tokens"), saida: n("output_tokens"), cacheLeitura: n("cached_input_tokens"), cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [] }];
}

/** definido em 2026-10-05: o motivo cru cabe numa linha de diagnóstico; o resto de um erro longo não ajuda. */
export const ERRO_CODEX_MAX_CHARS = 500;

/** NOD-158: redige antes de cortar; o stderr do Codex chega a ecoar `OPENAI_API_KEY=…`. */
const aparar = (texto: string): string | null => redigirECortar(texto.trim(), ERRO_CODEX_MAX_CHARS);

/** `{ message }` ou texto solto, como o Codex manda em `turn.failed.error`, `item.error` e no evento `error`. */
function mensagemDe(erro: unknown): string | null {
  if (typeof erro === "string") return aparar(erro);
  if (erro && typeof erro === "object" && "message" in erro && typeof erro.message === "string") return aparar(erro.message);
  return null;
}

/**
 * O que o Codex disse de errado numa linha do `--json`, fora do `turn.failed` (que já vira `erroCru` do result): o
 * evento `error` e o item `error`. O item é aviso do próprio Codex e não encerra o turno; medido em 2026-10-05 com o
 * 0.147.0: "Code Mode is unavailable because code-mode host is disabled…" vinha assim, e o nod o jogava fora.
 */
export function erroDoCodex(linha: string): string | null {
  let v: Record<string, unknown>;
  try { const j: unknown = JSON.parse(linha); if (!j || typeof j !== "object" || Array.isArray(j)) return null; v = j as Record<string, unknown>; } catch { return null; }
  if (v.type === "error") return mensagemDe(v.message) ?? mensagemDe(v.error);
  const item = v.item && typeof v.item === "object" ? v.item as Record<string, unknown> : {};
  if (v.type === "item.completed" && item.type === "error") return mensagemDe(item.message) ?? mensagemDe(item.error);
  return null;
}

/**
 * A última linha com conteúdo do stderr, sem o carimbo de hora do log do Codex. É o motivo de um turno que morre
 * antes do primeiro evento (medido em 2026-10-05: "Error loading config.toml: unknown configuration field …").
 */
export function ultimaLinhaUtil(stderr: string): string | null {
  const linhas = stderr.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const ultima = linhas[linhas.length - 1];
  return ultima ? aparar(ultima.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+/, "")) : null;
}
