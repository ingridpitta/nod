import type { DesfechoRotina } from "../contracts/motivos.ts";
import type { OpcaoRitmo } from "../contracts/rotina-ritmo.ts";
import { parseCron5 } from "./rotina-janela.ts";

/**
 * definido em 2026-10-23 (NOD-313): a rotina que roda muitas vezes seguidas sem novidade ganha UM card na conversa do bot
 * sugerindo espaçar, restringir a dias úteis, pausar ou deixar como está.
 *
 * REGRA DE NEGÓCIO (Marlon, 2026-10-23): a rotina NUNCA é pausada nem alterada automaticamente. Este módulo só calcula a
 * SUGESTÃO; a mudança sai apenas do clique da pessoa no card (use-cases/ritmo-rotina.ts, `decidirSugestaoDeRitmo`).
 */

/** Execuções seguidas sem novidade que abrem o card (N da issue). */
export const SEM_NOVIDADE_PARA_SUGERIR = 20;
/** "Deixar como está" cala a sugestão desta rotina por 30 dias. */
export const SILENCIO_DO_DEIXAR_MS = 30 * 24 * 60 * 60 * 1000;
/** O horário comercial de "Só dias úteis 8h–19h": a última hora cheia em que a rotina ainda dispara é 18. */
export const HORAS_COMERCIAIS: readonly number[] = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

export type { OpcaoRitmo };
export const OPCOES_RITMO: readonly OpcaoRitmo[] = ["espacar", "uteis", "pausar", "deixar"];

/** A sugestão calculada para o card: o cron de cada opção que muda o horário (null = a opção não se aplica). */
export type SugestaoDeRitmo = {
  /** "a cada 30 min", "a cada 2 h", "uma vez por dia". */
  hoje: string;
  espacar: { cron: string; rotulo: string } | null;
  uteis: { cron: string; fusoIana: string } | null;
};

/**
 * O fuso da pessoa quando a rotina está em UTC. O nod ainda não guarda o fuso de cada pessoa; o padrão do servidor
 * (NOD_FUSO_PADRAO) é este mesmo. Suposição registrada no PR da NOD-313.
 */
export const FUSO_DA_PESSOA_PADRAO = "America/Sao_Paulo";

const FUSOS_UTC = new Set(["UTC", "Etc/UTC", "Etc/UCT", "UCT", "GMT", "Etc/GMT", "Etc/Universal", "Universal", "Etc/Zulu", "Zulu"]);

/** O fuso do horário comercial: o da rotina; se ela está em UTC, o fuso padrão da pessoa (NOD_FUSO_PADRAO). */
export function fusoDoHorarioComercial(fusoRotina: string, fusoPadrao: string): string {
  return FUSOS_UTC.has(fusoRotina) ? fusoPadrao : fusoRotina;
}

const MINUTOS_DIA = 24 * 60;

/** Menor distância, em minutos, entre dois disparos do mesmo dia (com a volta da meia-noite); 1440 = uma vez por dia. */
export function periodoEmMinutos(cron: string): number {
  const c = parseCron5(cron);
  const instantes = c.hora.flatMap((h) => c.minuto.map((m) => h * 60 + m)).sort((a, b) => a - b);
  if (instantes.length <= 1) return MINUTOS_DIA;
  let menor = MINUTOS_DIA - instantes[instantes.length - 1]! + instantes[0]!;
  for (let i = 1; i < instantes.length; i++) menor = Math.min(menor, instantes[i]! - instantes[i - 1]!);
  return menor;
}

/** O intervalo como a pessoa lê: "30 min", "1 h", "6 h"; um dia ou mais vira "uma vez por dia". */
export function intervaloEmPortugues(minutos: number): string {
  if (minutos >= MINUTOS_DIA) return "uma vez por dia";
  if (minutos < 60) return `a cada ${minutos} min`;
  const horas = minutos / 60;
  return `a cada ${Number.isInteger(horas) ? horas : horas.toFixed(1).replace(".", ",")} h`;
}

/** A cadência que a pessoa lê, sem chamar uma rotina semanal ou mensal de "uma vez por dia". */
export function cadenciaEmPortugues(cron: string): string {
  const c = parseCron5(cron);
  const vezesPorDia = c.hora.length * c.minuto.length;
  const vezes = (n: number, periodo: "semana" | "mês") => (n === 1 ? `uma vez por ${periodo}` : `${n} vezes por ${periodo}`);
  if (c.diasMes !== "*") {
    // Dia 29–31 não existe em todos os meses; combinar dia do mês com semana/mês também não tem frequência mensal fixa.
    if (c.mes !== "*" || c.diasSemana !== "*" || c.diasMes.some((d) => d > 28)) return vezesPorDia === 1 ? "nas datas programadas" : `${vezesPorDia} vezes nas datas programadas`;
    return vezes(vezesPorDia * c.diasMes.length, "mês");
  }
  const dias = diasDaSemana(c.diasSemana);
  if (dias.length < 7) {
    const semanal = c.diasSemana === "uteis" ? (vezesPorDia === 1 ? "uma vez em cada dia útil" : `${vezesPorDia} vezes em cada dia útil`) : vezes(vezesPorDia * dias.length, "semana");
    return c.mes === "*" ? semanal : `${semanal} nos meses programados`;
  }
  const instantes = c.hora.flatMap((h) => c.minuto.map((m) => h * 60 + m)).sort((a, b) => a - b);
  const lacunas = instantes.map((atual, i) => ((instantes[(i + 1) % instantes.length] ?? atual) - atual + MINUTOS_DIA) % MINUTOS_DIA);
  const regular = lacunas.length > 1 && lacunas.every((n) => n === lacunas[0]);
  const diaria = vezesPorDia === 1 ? "uma vez por dia" : regular ? intervaloEmPortugues(lacunas[0]!) : `${vezesPorDia} vezes por dia`;
  return c.mes === "*" ? diaria : `${diaria} nos meses programados`;
}

/** O degrau seguinte: ≤15 min → 1 h; 30 min/1 h → 2 h; acima de 1 h e abaixo de 6 h → 6 h; ≥6 h → 1×/dia. */
function proximoDegrau(periodo: number): number | null {
  if (periodo <= 15) return 60;
  if (periodo <= 60) return 120;
  if (periodo < 360) return 360;
  if (periodo < MINUTOS_DIA) return MINUTOS_DIA;
  return null;
}

/** As horas, em ordem, guardando entre elas pelo menos `passo` horas (a partir da primeira). */
function horasEspacadas(horas: readonly number[], passo: number): number[] {
  const escolhidas: number[] = [];
  for (const h of horas) if (escolhidas.length === 0 || h - escolhidas[escolhidas.length - 1]! >= passo) escolhidas.push(h);
  // A volta da meia-noite também conta: 2h e 22h ficam a 4 h uma da outra.
  while (escolhidas.length > 1 && 24 - escolhidas[escolhidas.length - 1]! + escolhidas[0]! < passo) escolhidas.pop();
  return escolhidas;
}

function campoHoras(horas: readonly number[]): string {
  if (horas.length === 24) return "*";
  return horas.join(",");
}

/**
 * O cron do degrau seguinte, mantendo dia do mês, mês e dia da semana. O minuto é o primeiro da rotina (ancorado no
 * relógio, como o cron já é). Uma vez por dia: às 9h se a rotina já rodava às 9h; senão na primeira hora dela dentro de
 * 8h–18h; sem nenhuma, na primeira hora dela.
 */
export function cronEspacado(cron: string): { cron: string; minutos: number } | null {
  const alvo = proximoDegrau(periodoEmMinutos(cron));
  if (alvo === null) return null;
  const c = parseCron5(cron);
  const [, horaS, diaMes, mes, diaSem] = cron.trim().split(/\s+/) as [string, string, string, string, string];
  const minuto = c.minuto[0] ?? 0;
  let horas: string;
  if (alvo === MINUTOS_DIA) horas = String(c.hora.includes(9) ? 9 : (c.hora.find((h) => HORAS_COMERCIAIS.includes(h)) ?? c.hora[0] ?? 9));
  else if (alvo === 60) horas = horaS === "*" ? "*" : campoHoras(c.hora);
  else if (c.hora.length === 24) horas = `*/${alvo / 60}`;
  else horas = campoHoras(horasEspacadas(c.hora, alvo / 60));
  const novo = `${minuto} ${horas} ${diaMes} ${mes} ${diaSem}`;
  const minutos = periodoEmMinutos(novo);
  return minutos > periodoEmMinutos(cron) ? { cron: novo, minutos } : null;
}

/**
 * O cron de "Só dias úteis 8h–19h": o mesmo minuto, as horas da rotina dentro de 8h–18h e os dias da rotina que caem de
 * segunda a sexta (a interseção: a rotina só de fim de semana não ganha a opção, a de segunda segue só de segunda).
 * null quando nada sobra ou quando ela já roda só assim. revisto em 2026-10-23 (revisão do PR da NOD-313).
 */
export function cronDiasUteis(cron: string): string | null {
  const novo = cronDiasUteisSempre(cron, 0);
  if (novo === null) return null;
  const a = parseCron5(cron);
  const b = parseCron5(novo);
  const iguais = a.hora.join() === b.hora.join() && diasDaSemana(a.diasSemana).join() === diasDaSemana(b.diasSemana).join();
  return iguais ? null : novo;
}

const UTEIS = [1, 2, 3, 4, 5];

function diasDaSemana(d: "*" | number[] | "uteis"): number[] {
  if (d === "*") return [0, 1, 2, 3, 4, 5, 6];
  if (d === "uteis") return UTEIS;
  return [...new Set(d)].sort((x, y) => x - y);
}

/** `deslocamento`: horas a somar às da rotina para chegar às do fuso do horário comercial (0 = mesmo fuso). */
function cronDiasUteisSempre(cron: string, deslocamento: number): string | null {
  const c = parseCron5(cron);
  const [minutoS, , diaMes, mes] = cron.trim().split(/\s+/) as [string, string, string, string, string];
  const locais = c.hora.map((h) => h + deslocamento);
  // A hora que muda de dia também mudaria dia da semana/mês e, na borda, o mês. Com calendário restrito, não arrisca
  // preservar campos que passariam a apontar para outra data no fuso da pessoa.
  const cruzaDiaUtil = locais.some((h) => (h < 0 || h > 23) && HORAS_COMERCIAIS.includes((h + 24) % 24));
  if (cruzaDiaUtil && (c.diasSemana !== "*" || c.diasMes !== "*" || c.mes !== "*")) return null;
  const horas = [...new Set(locais.map((h) => (h + 24) % 24).filter((h) => HORAS_COMERCIAIS.includes(h)))].sort((x, y) => x - y);
  const dias = diasDaSemana(c.diasSemana).filter((d) => UTEIS.includes(d));
  if (horas.length === 0 || dias.length === 0) return null;
  return `${minutoS} ${horas.join(",")} ${diaMes} ${mes} ${dias.join() === UTEIS.join() ? "1-5" : dias.join(",")}`;
}

/** Quantas horas o fuso está à frente do UTC neste instante; null se não for hora cheia (ex.: +05:30). */
export function deslocamentoEmHoras(fusoIana: string, agora: number): number | null {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: fusoIana, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(agora));
  const n = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const minuto = Math.floor(agora / 60_000) * 60_000;
  const minutos = (Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute")) - minuto) / 60_000;
  return minutos % 60 === 0 ? minutos / 60 : null;
}

/**
 * A sugestão inteira para o card da rotina com este cron e fuso. A rotina em UTC passa ao fuso da pessoa com as horas
 * CONVERTIDAS (12h UTC vira 9h em São Paulo): "dias úteis" restringe o horário, nunca o desloca.
 */
export function sugestaoDeRitmo(cron: string, fusoIana: string, agora: number, fusoPadrao: string = FUSO_DA_PESSOA_PADRAO): SugestaoDeRitmo {
  const espacado = cronEspacado(cron);
  const fusoUteis = fusoDoHorarioComercial(fusoIana, fusoPadrao);
  const deslocamento = fusoUteis === fusoIana ? 0 : deslocamentoEmHoras(fusoUteis, agora);
  const uteis = deslocamento === 0 && fusoUteis === fusoIana ? cronDiasUteis(cron) : deslocamento === null ? null : cronDiasUteisSempre(cron, deslocamento);
  return {
    hoje: cadenciaEmPortugues(cron),
    espacar: espacado ? { cron: espacado.cron, rotulo: cadenciaEmPortugues(espacado.cron) } : null,
    uteis: uteis ? { cron: uteis, fusoIana: fusoUteis } : null,
  };
}

/** Quando o card abre: N seguidas, sem card aberto, fora do silêncio do "Deixar como está". */
export function deveSugerir(estado: { seguidas: number; silenciadaAte: number | null; cardAberto: boolean }, agora: number): boolean {
  if (estado.cardAberto) return false;
  if (estado.silenciadaAte !== null && estado.silenciadaAte > agora) return false;
  return estado.seguidas >= SEM_NOVIDADE_PARA_SUGERIR;
}

/**
 * Como o desfecho mexe na contagem: sem novidade soma; executou ou falhou zera (a rotina trouxe algo ou precisa de
 * atenção). O resto (passou em branco, não rodou, adiada, bloqueada, interrompida) não é "rodou sem novidade" nem
 * novidade: não soma nem zera.
 */
export function efeitoNaContagem(desfecho: DesfechoRotina): "soma" | "zera" | "neutro" {
  if (desfecho === "sem_novidade") return "soma";
  if (desfecho === "executou" || desfecho === "falhou") return "zera";
  return "neutro";
}
