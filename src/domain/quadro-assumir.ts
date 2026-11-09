import type { ColunaQuadro } from "../contracts/quadro.ts";

/**
 * NOD-422, PR 2 (definido em 2026-11-02): as regras puras do "o quadro assume a esteira" (src/use-cases/assumir-quadro.ts).
 */

/**
 * As rotinas que o assumir nunca pausa, pelo começo do id. A bc381ef2 fica de fora (decisão da issue: é a rotina que não
 * é da esteira do quadro). Configurável por NOD_QUADRO_ASSUMIR_FORA (lista separada por vírgula; vazia = nenhuma).
 */
export const ROTINAS_FORA_PADRAO: readonly string[] = ["bc381ef2"];

export function lerRotinasFora(env: { NOD_QUADRO_ASSUMIR_FORA?: string }): readonly string[] {
  const bruto = env.NOD_QUADRO_ASSUMIR_FORA;
  if (bruto === undefined) return ROTINAS_FORA_PADRAO;
  return bruto.split(",").map((x) => x.trim().toLowerCase()).filter((x) => /^[0-9a-f-]{4,36}$/.test(x));
}

/** A rotina está na lista de exclusão: o id começa por algum prefixo dela (sem caixa). */
export function rotinaFora(id: string, fora: readonly string[]): boolean {
  const x = id.toLowerCase();
  return fora.some((p) => p !== "" && x.startsWith(p.toLowerCase()));
}

/**
 * Os bots do quadro: o anfitrião, quem cuida de alguma coluna (a passagem, ADR-142) e quem tem tarefa nele. Na ordem em
 * que aparecem (o card lista nessa ordem), sem repetir.
 */
export function botsDoQuadro(anfitriaoId: string, colunas: readonly ColunaQuadro[], tarefas: readonly { agenteId: string | null }[]): string[] {
  const ids = [anfitriaoId, ...colunas.map((c) => c.responsavel ?? null), ...tarefas.map((t) => t.agenteId)];
  return [...new Set(ids.filter((x): x is string => !!x))];
}

/** O título da rotina no card: a primeira linha da instrução, curta. */
export function tituloDaRotina(instrucao: string): string {
  const linha = (instrucao.split("\n").find((l) => l.trim() !== "") ?? "").trim();
  return linha.length > 80 ? `${linha.slice(0, 79)}…` : linha || "rotina";
}

/** O id curto que o card e o recibo mostram. */
export const idCurto = (id: string): string => id.replace(/-/g, "").slice(0, 8);
