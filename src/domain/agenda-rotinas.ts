import { AGENDA_MAX_POR_DIA, DESFECHOS_COM_PROBLEMA, type ItemAgenda } from "../contracts/agenda.ts";
import type { DesfechoRotina } from "../contracts/motivos.ts";
import type { EstadoRotina, ExecucaoRotina } from "../contracts/rotina.ts";
import { janelasEntre, parseCron5, TETO_JANELAS_AGENDA } from "./rotina-janela.ts";

/**
 * Teto de janelas previstas listadas num pedido, somadas todas as rotinas (revisão 3 do PR 595): a projeção é síncrona e
 * 50 rotinas de minuto em minuto em 42 dias seriam 3 milhões de janelas (~600 ms de event loop). As rotinas mais espaçadas
 * vêm primeiro; a que estoura o teto sai `cortado`, e só ela.
 */
export const TETO_JANELAS_POR_PEDIDO = 100_000;

/**
 * Teto de pares (cron, fuso) DIFERENTES projetados num pedido (revisão 4 do PR 595): o teto de janelas não limita o
 * trabalho da rotina rara (diária, mensal), que consulta o fuso várias vezes por dia e quase não gasta janela. Rotinas
 * com o mesmo cron e fuso (a regra: "0 9 * * *") reaproveitam a mesma projeção; acima do teto, a rotina sai `cortado`.
 */
export const TETO_PROJECOES_POR_PEDIDO = 200;

/** Janelas por dia que o cron promete (minutos × horas); cron que não parseia vai por último. */
function frequencia(cron: string): number {
  try { const c = parseCron5(cron); return (c.minuto.length || 60) * (c.hora.length || 24); } catch { return Infinity; }
}

/**
 * NOD-85 (definido em 2026-10-29): a projeção pura da agenda. Junta as execuções guardadas (passado) com as janelas do
 * cron (futuro, só rotina ativa), agrupa por dia no fuso da pessoa e resume a rotina frequente numa faixa.
 */
const COM_PROBLEMA: ReadonlySet<DesfechoRotina> = new Set(DESFECHOS_COM_PROBLEMA);
export const temProblema = (d: DesfechoRotina): boolean => COM_PROBLEMA.has(d);

/** `gatilho` webhook (NOD-84): só o passado (as execuções guardadas); o cron dela é sentinela, não há janela prevista. */
export type RotinaParaAgenda = { id: string; cron: string; fusoIana: string; estado: EstadoRotina; gatilho?: "horario" | "webhook" };

const formatadores = new Map<string, Intl.DateTimeFormat>();
/** AAAA-MM-DD do instante no fuso (en-CA formata assim). */
export function diaNoFuso(ms: number, fuso: string): string {
  let f = formatadores.get(fuso);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }); formatadores.set(fuso, f); }
  return f.format(new Date(ms));
}

/** O passo mais comum entre instantes vizinhos, em minutos (null com menos de dois). */
function passoMaisComum(instantes: number[]): number | null {
  const contagem = new Map<number, number>();
  for (let i = 1; i < instantes.length; i++) {
    const p = Math.round(((instantes[i] ?? 0) - (instantes[i - 1] ?? 0)) / 60_000);
    contagem.set(p, (contagem.get(p) ?? 0) + 1);
  }
  let melhor: number | null = null;
  let vezes = 0;
  for (const [p, n] of contagem) if (n > vezes || (n === vezes && melhor !== null && p < melhor)) { melhor = p; vezes = n; }
  return melhor;
}

export type ProjecaoAgenda = { itens: ItemAgenda[]; registroDesde: Map<string, number | null>; cortado: Set<string> };

/**
 * `execucoes`: TODAS as guardadas das rotinas (≤ `guardadas` por rotina), não só as do intervalo — a mais antiga diz
 * desde quando há registro. Previstas só a partir de `agora` e sem repetir a janela que já tem execução. Um cron que o
 * parser recusa (linha antiga) fica sem previstas em vez de derrubar a agenda.
 */
export function projetarAgenda(entrada: {
  rotinas: readonly RotinaParaAgenda[];
  execucoes: readonly ExecucaoRotina[];
  de: number;
  ate: number;
  agora: number;
  fuso: string;
  guardadas: number;
}): ProjecaoAgenda {
  const { de, ate, agora, fuso } = entrada;
  // Revisão 1 do PR #595: a rotina frequente tem milhares de janelas; o dia de cada uma sai de um cache por quarto de hora
  // (todo fuso IANA muda em múltiplos de 15 min, então o dia civil não muda dentro de um quarto de hora alinhado em UTC).
  const diasPorQuarto = new Map<number, string>();
  const diaDe = (ms: number): string => {
    const q = Math.floor(ms / 900_000);
    let d = diasPorQuarto.get(q);
    if (d === undefined) { d = diaNoFuso(q * 900_000, fuso); diasPorQuarto.set(q, d); }
    return d;
  };
  const porRotina = new Map<string, ExecucaoRotina[]>();
  for (const e of entrada.execucoes) porRotina.set(e.rotinaId, [...(porRotina.get(e.rotinaId) ?? []), e]);
  const itens: ItemAgenda[] = [];
  const registroDesde = new Map<string, number | null>();
  const cortado = new Set<string>();
  let orcamento = TETO_JANELAS_POR_PEDIDO;
  const projecoes = new Map<string, { janelas: number[]; cortado: boolean }>();
  const ordem = entrada.rotinas.map((r) => ({ r, f: frequencia(r.cron) })).sort((a, b) => a.f - b.f).map((x) => x.r);
  for (const r of ordem) {
    const todas = porRotina.get(r.id) ?? [];
    registroDesde.set(r.id, todas.length >= entrada.guardadas ? Math.min(...todas.map((e) => e.instanteAgendado)) : null);
    const doIntervalo = todas.filter((e) => e.instanteAgendado >= de && e.instanteAgendado < ate);
    const jaTem = new Set(doIntervalo.map((e) => e.instanteAgendado));
    let previstas: number[] = [];
    if (r.estado === "ativa" && r.gatilho !== "webhook" && Math.max(de, agora) < ate) {
      try {
        const chave = `${r.cron}\u0000${r.fusoIana}`;
        let j = projecoes.get(chave);
        if (!j && projecoes.size < TETO_PROJECOES_POR_PEDIDO) {
          j = janelasEntre({ cron: r.cron, fusoIana: r.fusoIana, de: Math.max(de, agora), ate, teto: Math.min(TETO_JANELAS_AGENDA, orcamento) });
          projecoes.set(chave, j);
        }
        if (!j) { cortado.add(r.id); } else {
          const usadas = j.janelas.length <= orcamento ? j.janelas : j.janelas.slice(0, Math.max(0, orcamento));
          orcamento -= usadas.length;
          previstas = usadas.filter((t) => !jaTem.has(t));
          if (j.cortado || usadas.length < j.janelas.length) cortado.add(r.id);
        }
      } catch { previstas = []; }
    }
    const dias = new Map<string, { exec: ExecucaoRotina[]; prev: number[] }>();
    const doDia = (d: string) => { let x = dias.get(d); if (!x) { x = { exec: [], prev: [] }; dias.set(d, x); } return x; };
    for (const e of doIntervalo) doDia(diaDe(e.instanteAgendado)).exec.push(e);
    for (const t of previstas) doDia(diaDe(t)).prev.push(t);
    for (const [dia, { exec, prev }] of dias) {
      if (exec.length + prev.length > AGENDA_MAX_POR_DIA) {
        const instantes = [...exec.map((e) => e.instanteAgendado), ...prev].sort((a, b) => a - b);
        itens.push({
          tipo: "faixa", rotinaId: r.id, dia, instante: instantes[0] ?? 0, ultima: instantes[instantes.length - 1] ?? 0,
          intervaloMin: passoMaisComum(instantes), previstas: prev.length, execucoes: exec.length,
          problemas: exec.filter((e) => temProblema(e.desfecho)).length,
        });
        continue;
      }
      for (const e of exec) itens.push({ tipo: "execucao", rotinaId: r.id, dia, instante: e.instanteAgendado, desfecho: e.desfecho, motivo: e.motivo, problema: temProblema(e.desfecho), turnoId: e.turnoId, em: e.em });
      for (const t of prev) itens.push({ tipo: "prevista", rotinaId: r.id, dia, instante: t });
    }
  }
  itens.sort((a, b) => a.instante - b.instante || a.rotinaId.localeCompare(b.rotinaId));
  return { itens, registroDesde, cortado };
}
