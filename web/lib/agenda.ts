import type { Agente } from "../../src/contracts/agente.ts";
import type { AgendaDto, ItemAgenda, RotinaNaAgenda } from "../../src/contracts/agenda.ts";

/**
 * NOD-85 (protótipo v2 aprovado em 2026-10-29): a agenda das rotinas, peças puras. O servidor projeta (`GET rotinas/agenda`,
 * ADR-011) e devolve cada item com o `dia` no fuso do navegador; aqui a web só agrupa por dia, aplica o filtro, acha o lugar
 * da linha do agora e junta o mesmo minuto em bloco. As datas são do navegador (o mesmo fuso que vai na leitura).
 */

/** Dias lidos de uma vez: a semana do alvo, a anterior e a seguinte (o servidor aceita até 42). */
export const DIAS_DA_JANELA = 21;
/** definido em 2026-10-29 (Gil, NOD-85): a partir de 6 bots, a régua troca os mascotes por "+N" e busca, e 6 rotinas no mesmo minuto viram um bloco. */
export const LIMIAR_MUITOS = 6;
/** Mascotes visíveis na régua antes do "+N" e no bloco do mesmo minuto. */
export const MASCOTES_NA_REGUA = 5;
export const MASCOTES_NO_BLOCO = 3;
/** Mais que isto de pausadas viram a linha "N rotinas pausadas", que abre. */
export const MAX_PAUSADAS_SOLTAS = 3;

const dois = (n: number) => String(n).padStart(2, "0");
export const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function diaDe(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function data(dia: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(a!, m! - 1, d!);
}

/** Meia-noite do dia no fuso do navegador (o Date local acerta o horário de verão). */
export const inicioDoDia = (dia: string): number => data(dia).getTime();

export function somarDias(dia: string, n: number): string {
  const d = data(dia);
  d.setDate(d.getDate() + n);
  return diaDe(d.getTime());
}

/** O dia existe de fato (o Date rola 31/02 para março). */
export const diaValido = (dia: string): boolean => DIA.test(dia) && somarDias(dia, 0) === dia;

/** A segunda-feira da semana do dia (a régua vai de segunda a domingo). */
export function segunda(dia: string): string {
  const s = data(dia).getDay();
  return somarDias(dia, s === 0 ? -6 : 1 - s);
}

export const semana = (dia: string): string[] => Array.from({ length: 7 }, (_, i) => somarDias(segunda(dia), i));

/** A janela lida para mostrar o dia: da segunda da semana anterior até o domingo da seguinte. */
export function janelaDe(dia: string): { de: string; ate: string } {
  const de = somarDias(segunda(dia), -7);
  return { de, ate: somarDias(de, DIAS_DA_JANELA) };
}

export const dentro = (dia: string, j: { de: string; ate: string } | null): boolean => !!j && dia >= j.de && dia < j.ate;

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export const nomeDoMes = (mes: string): string => {
  const n = MESES[Number(mes.slice(5, 7)) - 1] ?? "";
  return n.charAt(0).toUpperCase() + n.slice(1);
};
export const diaDaSemana = (dia: string): string => SEMANA[data(dia).getDay()] ?? "";
export const diaCurto = (dia: string): string => `${diaDaSemana(dia)} ${Number(dia.slice(8))}`;

/** "Hoje · qui 29", "Ontem · qua 28", "Amanhã · sex 30"; os outros, "seg 2 de novembro" quando o mês é outro. */
export function nomeDoDia(dia: string, hoje: string): string {
  const rel = dia === hoje ? "Hoje" : dia === somarDias(hoje, -1) ? "Ontem" : dia === somarDias(hoje, 1) ? "Amanhã" : null;
  const curto = diaCurto(dia);
  if (rel) return `${rel} · ${curto}`;
  return dia.slice(0, 7) === hoje.slice(0, 7) ? curto : `${curto} de ${MESES[Number(dia.slice(5, 7)) - 1]}`;
}

export const hora = (ms: number): string => {
  const d = new Date(ms);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
};

/** As células do mini mês (semanas começando na segunda; null = fora do mês). */
export function gradeDoMes(mes: string): (string | null)[] {
  const primeiro = `${mes}-01`;
  const vazio = (data(primeiro).getDay() + 6) % 7;
  const celulas: (string | null)[] = Array.from({ length: vazio }, () => null);
  for (let d = primeiro; d.slice(0, 7) === mes; d = somarDias(d, 1)) celulas.push(d);
  while (celulas.length % 7) celulas.push(null);
  return celulas;
}

export function somarMeses(mes: string, n: number): string {
  const d = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}`;
}

export const itemComProblema = (i: ItemAgenda): boolean => (i.tipo === "execucao" ? i.problema : i.tipo === "faixa" ? i.problemas > 0 : false);

export const chaveDoItem = (i: ItemAgenda): string => `${i.tipo}:${i.rotinaId}:${i.instante}`;

/** O começo da instrução, como título curto da rotina (o mesmo corte da mini-agenda do chat). */
export function tituloDaRotina(instrucao: string, max = 48): string {
  const t = instrucao.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export type BotDaAgenda = Pick<Agente, "id" | "nome" | "cor" | "forma">;

export type LinhaAgenda = {
  chave: string;
  item: ItemAgenda;
  rotina: RotinaNaAgenda;
  bot: BotDaAgenda | null;
  /** A rotina está parada por falta de acesso: a prevista fica esmaecida e diz "Parada". */
  parada: boolean;
};

export type EntradaAgenda =
  | { tipo: "linha"; linha: LinhaAgenda }
  /** 6 ou mais rotinas no mesmo minuto: uma linha só, que abre no lugar. */
  | { tipo: "bloco"; chave: string; instante: number; linhas: LinhaAgenda[] }
  /** O dia é anterior ao registro guardado desta rotina (a poda de 20): "sem registro", não um dia vazio. */
  | { tipo: "sem-registro"; rotina: RotinaNaAgenda; bot: BotDaAgenda | null };

export type DiaAgenda = { dia: string; entradas: EntradaAgenda[]; problema: boolean; agora: number | null };

export type FiltroAgenda = { bots: readonly string[]; soProblema: boolean };

export type VisaoAgenda = {
  dias: DiaAgenda[];
  /** Dias com problema na janela lida (ponto na régua e no mini mês), sem filtro. */
  comProblema: Set<string>;
  /** Os bots que têm rotina na janela, por nome. */
  bots: BotDaAgenda[];
  filtrado: boolean;
};

/**
 * A agenda pronta para desenhar: os dias da janela, cada um com as entradas na ordem da hora. Com filtro, o dia sem nada
 * some (hoje fica, é onde mora a linha do agora, e o dia em foco, `manter`, para dizer que está vazio); sem filtro, todo
 * dia aparece.
 */
export function montarAgenda(entrada: { dto: AgendaDto; agentes: readonly BotDaAgenda[]; parados: ReadonlySet<string>; filtro: FiltroAgenda; agora: number; manter?: string | null }): VisaoAgenda {
  const { dto, filtro } = entrada;
  const hoje = diaDe(entrada.agora);
  const botPorId = new Map(entrada.agentes.map((a) => [a.id, a]));
  const rotinaPorId = new Map(dto.rotinas.map((r) => [r.id, r]));
  const comProblema = new Set(dto.itens.filter(itemComProblema).map((i) => i.dia));
  const idsDeBots = [...new Set(dto.rotinas.map((r) => r.agenteId))];
  const bots = idsDeBots.map((id) => botPorId.get(id)).filter((b): b is BotDaAgenda => !!b).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const filtrado = filtro.bots.length > 0 || filtro.soProblema;
  const passaBot = (r: RotinaNaAgenda) => filtro.bots.length === 0 || filtro.bots.includes(r.agenteId);

  const porDia = new Map<string, LinhaAgenda[]>();
  for (const item of dto.itens) {
    const rotina = rotinaPorId.get(item.rotinaId);
    if (!rotina || !passaBot(rotina) || (filtro.soProblema && !itemComProblema(item))) continue;
    const linha: LinhaAgenda = { chave: chaveDoItem(item), item, rotina, bot: botPorId.get(rotina.agenteId) ?? null, parada: entrada.parados.has(rotina.id) };
    const lista = porDia.get(item.dia) ?? [];
    lista.push(linha);
    porDia.set(item.dia, lista);
  }

  const dias: DiaAgenda[] = [];
  const de = diaDe(dto.de);
  const ate = diaDe(dto.ate - 1);
  for (let dia = de; dia <= ate; dia = somarDias(dia, 1)) {
    const linhas = (porDia.get(dia) ?? []).sort((a, b) => a.item.instante - b.item.instante || (a.bot?.nome ?? "").localeCompare(b.bot?.nome ?? "", "pt-BR"));
    const entradas = agruparMinuto(dia, linhas);
    // "sem registro": dia que já passou, antes da execução mais antiga guardada da rotina.
    if (dia < hoje && !filtro.soProblema) {
      for (const r of dto.rotinas) {
        if (r.registroDesde !== null && passaBot(r) && dia < diaDe(r.registroDesde)) entradas.push({ tipo: "sem-registro", rotina: r, bot: botPorId.get(r.agenteId) ?? null });
      }
    }
    if (filtrado && entradas.length === 0 && dia !== hoje && dia !== entrada.manter) continue;
    const agora = dia === hoje ? posicaoDoAgora(entradas, entrada.agora) : null;
    dias.push({ dia, entradas, problema: linhas.some((l) => itemComProblema(l.item)), agora });
  }
  return { dias, comProblema, bots, filtrado };
}

function agruparMinuto(dia: string, linhas: LinhaAgenda[]): EntradaAgenda[] {
  const saida: EntradaAgenda[] = [];
  for (let i = 0; i < linhas.length; ) {
    const atual = linhas[i]!;
    let j = i;
    while (j < linhas.length && linhas[j]!.item.instante === atual.item.instante && linhas[j]!.item.tipo !== "faixa") j++;
    const mesmos = linhas.slice(i, j);
    if (atual.item.tipo !== "faixa" && mesmos.length >= LIMIAR_MUITOS) {
      saida.push({ tipo: "bloco", chave: `bloco:${dia}:${atual.item.instante}`, instante: atual.item.instante, linhas: [...mesmos].sort((a, b) => Number(itemComProblema(b.item)) - Number(itemComProblema(a.item))) });
      i = j;
    } else {
      saida.push({ tipo: "linha", linha: atual });
      i++;
    }
  }
  return saida;
}

/** Quantas entradas ficam acima da linha do agora (as que já passaram). */
function posicaoDoAgora(entradas: readonly EntradaAgenda[], agora: number): number {
  let n = 0;
  for (const e of entradas) {
    const instante = e.tipo === "linha" ? e.linha.item.instante : e.tipo === "bloco" ? e.instante : -Infinity;
    if (instante <= agora) n++;
    else break;
  }
  return n;
}

/** O resumo do bloco: o problema sempre aparece ("1 falhou"); sem problema, quantas rodaram ou estão previstas. */
export function resumoDoBloco(linhas: readonly LinhaAgenda[]): string {
  const problemas = linhas.filter((l) => itemComProblema(l.item));
  if (problemas.length) {
    const conta = new Map<string, number>();
    for (const l of problemas) if (l.item.tipo === "execucao") conta.set(ROTULO[l.item.desfecho], (conta.get(ROTULO[l.item.desfecho]) ?? 0) + 1);
    return [...conta].map(([r, n]) => `${n} ${r.toLowerCase()}`).join(", ");
  }
  const previstas = linhas.filter((l) => l.item.tipo === "prevista").length;
  return previstas === linhas.length ? "Previstas" : previstas === 0 ? "Rodaram" : `${linhas.length - previstas} rodaram`;
}

const ROTULO: Record<Extract<ItemAgenda, { tipo: "execucao" }>["desfecho"], string> = {
  executou: "Concluída",
  passou_em_branco: "Em branco",
  sem_novidade: "Sem novidade",
  falhou: "Falhou",
  interrompida: "Interrompida",
  bloqueada: "Parada",
  nao_rodou: "Não rodou",
  adiada: "Adiada",
};

/** O desfecho escrito da linha (a cor fica só no ponto). */
export function rotuloDaLinha(l: Pick<LinhaAgenda, "item" | "parada">): string {
  const i = l.item;
  if (i.tipo === "execucao") return ROTULO[i.desfecho];
  if (i.tipo === "prevista") return l.parada ? "Parada" : "Prevista";
  const passo = i.intervaloMin ? `a cada ${i.intervaloMin} min` : "várias vezes";
  const n = (q: number, um: string, varios: string) => (q ? `${q} ${q === 1 ? um : varios}` : "");
  const contas = [n(i.execucoes, "rodada", "rodadas"), n(i.previstas, "prevista", "previstas"), i.problemas ? `${i.problemas} com problema` : ""].filter(Boolean).join(" · ");
  return contas ? `${passo} · ${contas}` : passo;
}

/** O link interno que o bot escreve (`ver_agenda`): `nod:agenda?dia=AAAA-MM-DD[&problema=1]`, exato, nada mais. */
const LINK_AGENDA = /^nod:agenda\?dia=(\d{4}-\d{2}-\d{2})(&problema=1)?$/;

export function lerLinkDaAgenda(href: string): { dia: string; soProblema: boolean } | null {
  const m = LINK_AGENDA.exec(href.trim());
  if (!m || !diaValido(m[1]!)) return null;
  return { dia: m[1]!, soProblema: !!m[2] };
}
