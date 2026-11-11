import { assertFusoIana, RotinaInvalida } from "./rotina-janela.ts";

/**
 * NOD-412: pausar uma rotina até uma data. A data chega como hora LOCAL no fuso da rotina ("2026-11-16" ou
 * "2026-11-16T09:00") e vira um instante absoluto, que é o que o banco guarda (`retomar_em`) e o agendador compara.
 *
 * Horário de verão (definido em 2026-11-11):
 * - hora que não existe (o relógio pula de 00:00 para 01:00): vale o primeiro instante válido depois dela;
 * - hora que existe duas vezes (o relógio volta): vale a primeira ocorrência.
 * Só a data quer dizer 00:00 local: "até segunda" deixa a primeira janela de segunda rodar.
 */

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;

/** Antecedência mínima: pausar "até daqui a pouco" que já passou (ou está passando) é engano, não pausa. */
export const RETOMADA_MIN_MS = MINUTO;
/** Teto de 366 dias: mais que isso é pausa sem data, e a pessoa reativa quando quiser. */
export const RETOMADA_MAX_MS = 366 * DIA;

type Local = { y: number; mo: number; d: number; h: number; mi: number };

const FORMATADORES = new Map<string, Intl.DateTimeFormat>();
function formatador(fusoIana: string): Intl.DateTimeFormat {
  let f = FORMATADORES.get(fusoIana);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: fusoIana, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
    FORMATADORES.set(fusoIana, f);
  }
  return f;
}

function localDe(instante: number, fusoIana: string): Local & { w: number } {
  const parts = formatador(fusoIana).formatToParts(new Date(instante));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const semana: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { y: Number(get("year")), mo: Number(get("month")), d: Number(get("day")), h: Number(get("hour")), mi: Number(get("minute")), w: semana[get("weekday")] ?? 0 };
}

const chave = (l: Local) => (((l.y * 100 + l.mo) * 100 + l.d) * 100 + l.h) * 100 + l.mi;

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/;

/** "AAAA-MM-DD" ou "AAAA-MM-DDTHH:MM" no fuso da rotina → instante (ms). Formato ou data inválida → RotinaInvalida. */
export function instanteLocal(texto: string, fusoIana: string): number {
  assertFusoIana(fusoIana);
  const m = FORMATO.exec(texto.trim());
  if (!m) throw new RotinaInvalida("entrada_invalida", "use AAAA-MM-DD ou AAAA-MM-DDTHH:MM, no fuso da rotina");
  const alvo: Local = { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), h: m[4] === undefined ? 0 : Number(m[4]), mi: m[5] === undefined ? 0 : Number(m[5]) };
  const utc = Date.UTC(alvo.y, alvo.mo - 1, alvo.d, alvo.h, alvo.mi);
  const conferido = new Date(utc);
  if (alvo.h > 23 || alvo.mi > 59 || conferido.getUTCFullYear() !== alvo.y || conferido.getUTCMonth() !== alvo.mo - 1 || conferido.getUTCDate() !== alvo.d) {
    throw new RotinaInvalida("entrada_invalida", `essa data não existe: ${texto}`);
  }
  // Nenhum fuso passa de ±14 h: o instante certo está nessa faixa. O primeiro minuto cuja hora local já chegou ao alvo
  // é a primeira ocorrência (hora repetida) ou o primeiro instante válido depois do salto (hora que não existe).
  const k = chave(alvo);
  for (let t = utc - 15 * 60 * MINUTO; t <= utc + 15 * 60 * MINUTO; t += MINUTO) {
    if (chave(localDe(t, fusoIana)) >= k) return t;
  }
  throw new RotinaInvalida("entrada_invalida", `não deu para situar ${texto} em ${fusoIana}`);
}

/** A data de retomada aceita: depois de agora + 1 min e até 366 dias. */
export function validarRetomada(instante: number, agora: number): void {
  if (!Number.isFinite(instante)) throw new RotinaInvalida("entrada_invalida", "data de retomada inválida");
  if (instante < agora + RETOMADA_MIN_MS) throw new RotinaInvalida("entrada_invalida", "a data de retomada já passou");
  if (instante > agora + RETOMADA_MAX_MS) throw new RotinaInvalida("entrada_invalida", "a retomada pode ser em até 366 dias");
}

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;

/**
 * "hoje 18:00", "amanhã 09:00", "seg 09:00" (até 6 dias) ou "seg 16/11, 09:00": quando a rotina volta, na hora da
 * rotina. É o texto da agenda ("Pausada até …") e da linha no chat.
 */
export function textoRetomada(instante: number, fusoIana: string, agora: number): string {
  const l = localDe(instante, fusoIana);
  const hoje = localDe(agora, fusoIana);
  const hora = `${String(l.h).padStart(2, "0")}:${String(l.mi).padStart(2, "0")}`;
  const dias = Math.round((Date.UTC(l.y, l.mo - 1, l.d) - Date.UTC(hoje.y, hoje.mo - 1, hoje.d)) / DIA);
  if (dias === 0) return `hoje ${hora}`;
  if (dias === 1) return `amanhã ${hora}`;
  const dia = DIAS_CURTOS[l.w] ?? "";
  if (dias > 1 && dias < 7) return `${dia} ${hora}`;
  return `${dia} ${String(l.d).padStart(2, "0")}/${String(l.mo).padStart(2, "0")}, ${hora}`;
}
