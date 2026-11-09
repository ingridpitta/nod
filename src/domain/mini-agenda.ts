import type { ItemAgenda } from "../contracts/agenda.ts";
import type { DesfechoRotina } from "../contracts/motivos.ts";

/**
 * NOD-85 (definido em 2026-10-29): a mini-agenda que `ver_agenda` devolve ao bot — até 5 linhas curtas e o link que abre
 * Configurações › Rotinas no dia. Pura: recebe os itens já projetados (projetarAgenda) e o nome de cada rotina.
 */
export const LINHAS_MINI_AGENDA = 5;

/** Dia civil no formato AAAA-MM-DD, com mês e dia que existem. */
export const DIA_AGENDA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * O link interno que a web troca por um botão "Abrir na agenda" (web/lib/texto-formatado.ts). Não é http: o bot não sabe
 * o endereço do nod, e a web só aceita este formato exato, sem nada de fora.
 */
export function linkDaAgenda(dia: string, soProblema: boolean): string {
  return `nod:agenda?dia=${dia}${soProblema ? "&problema=1" : ""}`;
}

const DESFECHO: Record<DesfechoRotina, string> = {
  executou: "rodou",
  passou_em_branco: "em branco",
  sem_novidade: "sem novidade",
  falhou: "falhou",
  interrompida: "interrompida",
  bloqueada: "bloqueada",
  nao_rodou: "não rodou",
  adiada: "adiada",
};

const formatadores = new Map<string, Intl.DateTimeFormat>();
function partes(ms: number, fuso: string): { semana: string; dia: string; mes: string; hora: string; minuto: string } {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatadores.set(fuso, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { semana: String(p.weekday ?? "").replace(".", ""), dia: p.day ?? "", mes: p.month ?? "", hora: p.hour ?? "", minuto: p.minute ?? "" };
}

const quando = (ms: number, fuso: string, comHora = true): string => {
  const p = partes(ms, fuso);
  return `${p.semana} ${p.dia}/${p.mes}${comHora ? ` ${p.hora}:${p.minuto}` : ""}`;
};

/** Item que conta como problema na mini-agenda: execução com problema ou faixa com algum. */
export const itemComProblema = (i: ItemAgenda): boolean => (i.tipo === "execucao" ? i.problema : i.tipo === "faixa" ? i.problemas > 0 : false);

export function linhaDaMiniAgenda(item: ItemAgenda, rotina: { bot: string; titulo: string }, fuso: string): string {
  const quem = `${rotina.bot} · ${rotina.titulo}`;
  if (item.tipo === "execucao") return `${quando(item.instante, fuso)} · ${quem} · ${DESFECHO[item.desfecho]}`;
  if (item.tipo === "prevista") return `${quando(item.instante, fuso)} · ${quem} · prevista`;
  const passo = item.intervaloMin ? `a cada ${item.intervaloMin} min` : "várias vezes";
  const contas = [item.execucoes ? `${item.execucoes} rodadas` : "", item.previstas ? `${item.previstas} previstas` : "", item.problemas ? `${item.problemas} com problema` : ""].filter(Boolean).join(", ");
  return `${quando(item.instante, fuso, false)} · ${quem} · ${passo}${contas ? ` (${contas})` : ""}`;
}

/** O começo da instrução, numa linha, como título curto da rotina. */
export function tituloDaRotina(instrucao: string, max = 40): string {
  const t = instrucao.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function miniAgenda(entrada: {
  itens: readonly ItemAgenda[];
  rotinas: ReadonlyMap<string, { bot: string; titulo: string }>;
  fuso: string;
  soProblema: boolean;
  max?: number;
}): { linhas: string[]; total: number } {
  const escolhidos = entrada.itens.filter((i) => entrada.rotinas.has(i.rotinaId) && (!entrada.soProblema || itemComProblema(i)));
  const max = entrada.max ?? LINHAS_MINI_AGENDA;
  const linhas = escolhidos.slice(0, max).map((i) => linhaDaMiniAgenda(i, entrada.rotinas.get(i.rotinaId) ?? { bot: "", titulo: "" }, entrada.fuso));
  return { linhas, total: escolhidos.length };
}
