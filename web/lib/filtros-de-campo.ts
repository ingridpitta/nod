import type { LabelDto, OpcaoPrazo } from "../../src/contracts/quadro-labels.ts";

/**
 * Os filtros por campo do quadro (labels e prazo), puros (definido em 2026-11-10). O painel de filtros da tela (o
 * popover "Filtrar por campo", como no Multica) lista os campos de `descritorDosCampos` e liga os predicados
 * `porLabel`/`porPrazo` no modo "é" ou "não é". Nada aqui lê o DOM nem o relógio: `agora` e o `fuso` vêm de quem chama.
 *
 * Prazo (a data AAAA-MM-DD da tarefa, sem hora), no fuso de quem lê:
 * - vencida: antes de hoje;
 * - hoje: hoje;
 * - semana: de hoje até domingo desta semana (a semana começa na segunda; o que venceu antes de hoje não entra);
 * - prox7: de hoje até hoje + 7 dias;
 * - sem_prazo: sem data.
 */

export type ModoFiltro = "é" | "não é";
/** As opções de prazo na ordem do popover (a web só importa tipos do contrato: a lista é a mesma de OPCOES_PRAZO). */
export const OPCOES_PRAZO = ["vencida", "hoje", "semana", "prox7", "sem_prazo"] as const satisfies readonly OpcaoPrazo[];
export type ComLabels = { labelIds?: readonly string[] | null };
export type ComPrazo = { prazoEm?: string | null };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const formatadores = new Map<string, Intl.DateTimeFormat>();

/** O dia de hoje (AAAA-MM-DD) no fuso de quem lê. Fuso inválido cai no UTC (nunca quebra o filtro). */
export function diaNoFuso(agora: number, fuso: string): string {
  let f = formatadores.get(fuso);
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }); }
    catch { f = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }); }
    formatadores.set(fuso, f);
  }
  return f.format(new Date(agora));
}

const diaUtc = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const mais = (d: string, dias: number): string => new Date(diaUtc(d) + dias * 86_400_000).toISOString().slice(0, 10);
/** Quantos dias de `de` até `ate` (negativo = antes). */
export const diasEntre = (de: string, ate: string): number => Math.round((diaUtc(ate) - diaUtc(de)) / 86_400_000);
/** O domingo da semana de `hoje` (a semana começa na segunda). */
const domingoDe = (hoje: string): string => mais(hoje, (7 - new Date(diaUtc(hoje)).getUTCDay()) % 7);

/** A tarefa com este prazo casa com a opção, sendo `hoje` o dia de quem lê. */
export function casaPrazo(prazoEm: string | null | undefined, opcao: OpcaoPrazo, hoje: string): boolean {
  const p = prazoEm && DATA.test(prazoEm) ? prazoEm : null;
  if (opcao === "sem_prazo") return p === null;
  if (p === null) return false;
  switch (opcao) {
    case "vencida": return p < hoje;
    case "hoje": return p === hoje;
    case "semana": return p >= hoje && p <= domingoDe(hoje);
    case "prox7": return p >= hoje && p <= mais(hoje, 7);
  }
}

/** Predicado do prazo: "é" = casa com alguma das opções; "não é" = com nenhuma. Sem opções, tudo passa. */
export function porPrazo(opcoes: readonly OpcaoPrazo[], modo: ModoFiltro, agora: number, fuso: string): (t: ComPrazo) => boolean {
  if (opcoes.length === 0) return () => true;
  const hoje = diaNoFuso(agora, fuso);
  return (t) => {
    const casa = opcoes.some((o) => casaPrazo(t.prazoEm, o, hoje));
    return modo === "é" ? casa : !casa;
  };
}

/** Predicado das labels: "é" = a tarefa tem alguma delas; "não é" = não tem nenhuma. Sem ids, tudo passa. */
export function porLabel(ids: readonly string[], modo: ModoFiltro): (t: ComLabels) => boolean {
  if (ids.length === 0) return () => true;
  const alvo = new Set(ids);
  return (t) => {
    const casa = (t.labelIds ?? []).some((id) => alvo.has(id));
    return modo === "é" ? casa : !casa;
  };
}

export const ROTULOS_PRAZO: Record<OpcaoPrazo, string> = {
  vencida: "Vencida",
  hoje: "Vence hoje",
  semana: "Vence esta semana",
  prox7: "Nos próximos 7 dias",
  sem_prazo: "Sem prazo",
};

/** Um valor que o popover lista (a cor só na label: vira um ponto pequeno). */
export type ValorDeCampo = { id: string; rotulo: string; cor?: LabelDto["cor"] };
/** Um campo do painel de filtros: o rótulo, o ícone (o nome do ícone do design system) e os valores. */
export type CampoDeFiltro = { campo: "label" | "prazo"; rotulo: string; icone: "etiqueta" | "calendario"; modos: readonly ModoFiltro[]; valores: ValorDeCampo[] };

/** Os campos de labels e prazo de um quadro, na ordem do popover (Label, Prazo). Sem label no quadro, o campo vem vazio. */
export function descritorDosCampos(q: { labels?: readonly LabelDto[] | null }): CampoDeFiltro[] {
  return [
    { campo: "label", rotulo: "Label", icone: "etiqueta", modos: ["é", "não é"], valores: (q.labels ?? []).map((l) => ({ id: l.id, rotulo: l.nome, cor: l.cor })) },
    { campo: "prazo", rotulo: "Prazo", icone: "calendario", modos: ["é", "não é"], valores: OPCOES_PRAZO.map((o) => ({ id: o, rotulo: ROTULOS_PRAZO[o] })) },
  ];
}

/**
 * O prazo da tarefa como a tela o mostra: "Vencida há 2 dias", "Hoje", "Amanhã", "Sexta", "12 nov". `tom` diz se pede
 * atenção (vencida em vermelho sutil, hoje em âmbar); o resto é tinta comum.
 */
export function rotuloDoPrazo(prazoEm: string, agora: number, fuso: string): { texto: string; tom: "vencida" | "hoje" | "normal" } {
  const hoje = diaNoFuso(agora, fuso);
  const d = diasEntre(hoje, prazoEm);
  if (d < 0) return { texto: d === -1 ? "Venceu ontem" : `Vencida há ${-d} dias`, tom: "vencida" };
  if (d === 0) return { texto: "Hoje", tom: "hoje" };
  if (d === 1) return { texto: "Amanhã", tom: "normal" };
  const data = new Date(diaUtc(prazoEm));
  if (d < 7) return { texto: data.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" }).replace(/^./, (c) => c.toUpperCase()).replace(/-feira$/, ""), tom: "normal" };
  const mesmoAno = prazoEm.slice(0, 4) === hoje.slice(0, 4);
  return { texto: data.toLocaleDateString("pt-BR", { day: "numeric", month: "short", ...(mesmoAno ? {} : { year: "numeric" }), timeZone: "UTC" }).replace(".", ""), tom: "normal" };
}
