import { prazoLegivel } from "./quadro.ts";

/**
 * NOD-415 (ADR-141): o risco de prazo do quadro. Só com meta E prazo (fluxo contínuo, sem meta, não tem progresso nem
 * risco): com menos de 20% do período (meta posta → fim do dia do prazo) pela frente e menos de 80% das tarefas feitas, o
 * quadro avisa a pessoa UMA vez por (quadro, meta, prazo) — trocar a meta ou o prazo é outra situação, e avisa de novo.
 *
 * Puro: quem chama classifica cada tarefa pelo grupo da coluna dela (Feito, Fechado, Não iniciado).
 */
/** `deFora`: o título foi escrito por um turno não confiável; o aviso (sino e push) não o mostra, só conta (revisão 1). */
export type TarefaParaRisco = { titulo: string; feita: boolean; fechada: boolean; naoIniciada: boolean; deFora?: boolean };
/** `metaDesde`: quando a meta foi posta (o começo do período); as tarefas já vêm filtradas pela meta. */
export type QuadroParaRisco = { meta: string | null; prazo: string | null; metaDesde: number; cumpridoEm: number | null };

export const FRACAO_DO_PERIODO = 0.2;
export const PROGRESSO_MINIMO = 0.8;
/** Quantas tarefas o aviso sugere cortar, no máximo (as de Não iniciado, na ordem do quadro). */
export const MAX_SUGESTOES = 5;

const DIA_MS = 86_400_000;

/** O fim do dia do prazo em São Paulo (UTC−3, sem horário de verão desde 2019). */
export function fimDoPrazo(prazo: string): number {
  return Date.parse(`${prazo}T23:59:59.999-03:00`);
}

export type Risco = { feitas: number; total: number; restanteMs: number; cortaveis: string[]; cortaveisDeFora: number };

export function riscoDoQuadro(q: QuadroParaRisco, tarefas: readonly TarefaParaRisco[], agora: number): Risco | null {
  if (!q.meta || !q.prazo || q.cumpridoEm !== null) return null;
  const validas = tarefas.filter((t) => !t.fechada);
  const total = validas.length;
  if (total === 0) return null;
  const feitas = validas.filter((t) => t.feita).length;
  if (feitas / total >= PROGRESSO_MINIMO) return null;
  const fim = fimDoPrazo(q.prazo);
  const periodo = fim - q.metaDesde;
  const restanteMs = fim - agora;
  // Prazo antes de a meta ser definida (ou no mesmo instante): o período inteiro já é "o fim".
  if (periodo > 0 && restanteMs >= FRACAO_DO_PERIODO * periodo) return null;
  const naoIniciadas = validas.filter((t) => t.naoIniciada);
  const cortaveis = naoIniciadas.filter((t) => !t.deFora).map((t) => t.titulo);
  return { feitas, total, restanteMs, cortaveis, cortaveisDeFora: naoIniciadas.length - cortaveis.length };
}

function quantoFalta(restanteMs: number, prazo: string): string {
  if (restanteMs <= 0) return `o prazo (${prazoLegivel(prazo)}) já passou`;
  if (restanteMs < DIA_MS) return `falta menos de 1 dia para o prazo (${prazoLegivel(prazo)})`;
  const dias = Math.ceil(restanteMs / DIA_MS);
  return `${dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`} para o prazo (${prazoLegivel(prazo)})`;
}

/** O aviso, determinístico: o resumo e o que cortar (o que ainda não começou). */
export function textoDoRisco(q: { meta: string; prazo: string }, r: Risco): string {
  const resumo = `O quadro "${q.meta}" está em risco: ${r.feitas} de ${r.total} tarefas feitas e ${quantoFalta(r.restanteMs, q.prazo)}.`;
  const nCortaveis = r.cortaveis.length + r.cortaveisDeFora;
  if (nCortaveis === 0) return `${resumo} Tudo o que sobrou já começou: vale rever o prazo ou a meta.`;
  if (r.cortaveis.length === 0) return `${resumo} Para caber, dá para cortar o que ainda não começou: ${nCortaveis === 1 ? "1 tarefa" : `${nCortaveis} tarefas`} (veja no quadro).`;
  const lista = r.cortaveis.slice(0, MAX_SUGESTOES).map((t) => `"${t}"`).join(", ");
  const sobra = nCortaveis - Math.min(r.cortaveis.length, MAX_SUGESTOES);
  const mais = sobra > 0 ? ` e mais ${sobra}` : "";
  return `${resumo} Para caber, dá para cortar o que ainda não começou: ${lista}${mais}.`;
}

/** A chave do "uma vez só": o mesmo quadro com a mesma meta e o mesmo prazo não avisa de novo. */
export function chaveDoRisco(q: { id: string; meta: string; prazo: string }): string {
  return JSON.stringify(["risco-quadro", q.id, q.meta, q.prazo]);
}
