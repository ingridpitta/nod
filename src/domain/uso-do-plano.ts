import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import type { EventoStream } from "../contracts/turno.ts";
import type { JanelaDoPlano, SituacaoDoPlano, UsoDoPlano } from "../contracts/uso-do-plano.ts";

/**
 * Uso do plano (definido em 2026-10-06, NOD-179): o que o CLI informa vira um número para a pessoa, nunca um gate
 * (emenda à ADR-036). Puro: `agora` e o fuso chegam por parâmetro (o servidor guarda epoch; ADR-007).
 */

type EventoRateLimit = Extract<EventoStream, { tipo: "rate_limit" }>;

const SITUACAO_DO_STATUS: Record<string, SituacaoDoPlano> = { allowed: "normal", allowed_warning: "perto", rejected: "esgotado" };

function janela(utilizacao: number | null, renovaEm: number | null): JanelaDoPlano | null {
  return utilizacao === null ? null : { utilizacao, renovaEm };
}

/**
 * O último `rate_limit` do turno, como uso do plano. `medidoEm` dá o instante de cada evento (o driver sabe quando
 * cada linha chegou). Sem evento, `undefined`: o turno não informou e nada é gravado.
 */
export function ultimoUsoDoPlano(eventos: readonly EventoStream[], harness: IdHarness, medidoEm: (indice: number) => EpochMs): UsoDoPlano | undefined {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const ev = eventos[i];
    if (ev?.tipo !== "rate_limit") continue;
    const r: EventoRateLimit = ev;
    return {
      harness,
      // hasOwn: um status como "constructor" ou "toString" acharia a propriedade herdada do Object e descartaria a leitura.
      situacao: Object.hasOwn(SITUACAO_DO_STATUS, r.status) ? SITUACAO_DO_STATUS[r.status]! : "desconhecida",
      cincoHoras: janela(r.utilizacaoCincoHoras, r.renovaCincoHorasEm),
      semana: janela(r.utilizacaoSeteDias, r.renovaSeteDiasEm),
      medidoEm: medidoEm(i),
    };
  }
  return undefined;
}

// ── Validação do que chega do Mac (A3/A4 do plano de engenharia) ──────────────────────────────────────────────────

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** Utilização passa um pouco de 1 quando o CLI deixa estourar; acima disso é lixo. */
export const UTILIZACAO_MAXIMA = 1.5;
const IDS_HARNESS: readonly string[] = HARNESSES.map((h) => h.id);
const SITUACOES: readonly string[] = ["normal", "perto", "esgotado", "desconhecida"];

function numeroFinito(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function janelaValida(v: unknown, medidoEm: number): JanelaDoPlano | null | undefined {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  if (!numeroFinito(o["utilizacao"]) || o["utilizacao"] < 0 || o["utilizacao"] > UTILIZACAO_MAXIMA) return undefined;
  const renova = o["renovaEm"];
  if (renova !== null && (!numeroFinito(renova) || renova < medidoEm - 10 * MINUTO || renova > medidoEm + 8 * DIA)) return undefined;
  return { utilizacao: o["utilizacao"], renovaEm: renova };
}

/**
 * O `usoDoPlano` que veio do Mac, validado; `undefined` quando o formato não serve (a entrega segue sem ele).
 * `medidoEm` entre agora − 7 dias e agora + 10 min (relógio de outro Mac adiantado) e, ao gravar, limitado ao
 * `agora` do servidor: um Mac adiantado não trava a linha contra leituras novas de verdade.
 */
export function usoDoPlanoValido(v: unknown, agora: EpochMs): UsoDoPlano | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const harness = o["harness"];
  const situacao = o["situacao"];
  const medido = o["medidoEm"];
  if (typeof harness !== "string" || !IDS_HARNESS.includes(harness)) return undefined;
  if (typeof situacao !== "string" || !SITUACOES.includes(situacao)) return undefined;
  if (!numeroFinito(medido) || medido < agora - 7 * DIA || medido > agora + 10 * MINUTO) return undefined;
  const medidoEm = Math.min(medido, agora);
  const cincoHoras = janelaValida(o["cincoHoras"], medido);
  const semana = janelaValida(o["semana"], medido);
  if (cincoHoras === undefined || semana === undefined) return undefined;
  return { harness: harness as IdHarness, situacao: situacao as SituacaoDoPlano, cincoHoras, semana, medidoEm };
}

// ── O medidor (o que a tela da NOD-12 vai mostrar) ───────────────────────────────────────────────────────────────

/**
 * Limiares da NOD-12: 80% perto, 90% alerta, 100% limite. revisto em 2026-10-22 (protótipo aprovado da NOD-12): o alerta
 * desceu de 95% para 90%, o mesmo limiar do anel do seletor (`ALERTA_USO`, web/telas/seletor-ia.ts); um teste de
 * conformidade confere os dois (a web não importa o domínio). A reserva de 99% do portão (cota-da-ia.ts) não muda.
 */
export const LIMIAR_PERTO = 0.8;
export const LIMIAR_ALERTA = 0.9;

export type FaixaDoMedidor = "normal" | "perto" | "alerta" | "limite" | "renovado";
export type EstadoDaJanela = {
  faixa: FaixaDoMedidor;
  /** 0 a 100; `null` quando a janela já renovou e o número velho não vale mais. */
  restamPct: number | null;
  renovaEm: EpochMs | null;
  texto: string;
};
export type EstadoDoMedidor = { cincoHoras: EstadoDaJanela | null; semana: EstadoDaJanela | null };

function horaMinuto(instante: number, fusoIana: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instante));
}
function diaMes(instante: number, fusoIana: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, day: "2-digit", month: "2-digit" }).format(new Date(instante));
}

/** "renova às 14:30" no mesmo dia (no fuso da pessoa); "renova em 09/10 às 14:30" em outro dia. */
function quandoRenova(renovaEm: number, agora: number, fusoIana: string): string {
  const hora = horaMinuto(renovaEm, fusoIana);
  return diaMes(renovaEm, fusoIana) === diaMes(agora, fusoIana) ? `renova às ${hora}` : `renova em ${diaMes(renovaEm, fusoIana)} às ${hora}`;
}

function estadoDaJanela(j: JanelaDoPlano, agora: EpochMs, fusoIana: string): EstadoDaJanela {
  if (j.renovaEm !== null && agora > j.renovaEm) {
    return { faixa: "renovado", restamPct: null, renovaEm: j.renovaEm, texto: `Renovou às ${horaMinuto(j.renovaEm, fusoIana)}; o número volta no próximo trabalho` };
  }
  const sufixo = j.renovaEm === null ? "" : ` · ${quandoRenova(j.renovaEm, agora, fusoIana)}`;
  if (j.utilizacao >= 1) return { faixa: "limite", restamPct: 0, renovaEm: j.renovaEm, texto: `Limite atingido${sufixo}` };
  const restamPct = Math.min(100, Math.max(0, 100 - Math.round(j.utilizacao * 100)));
  const faixa: FaixaDoMedidor = j.utilizacao >= LIMIAR_ALERTA ? "alerta" : j.utilizacao >= LIMIAR_PERTO ? "perto" : "normal";
  return { faixa, restamPct, renovaEm: j.renovaEm, texto: `Restam ${restamPct}%${sufixo}` };
}

/** As duas janelas prontas para mostrar. Janela que o CLI não informou fica `null` (a tela diz "não informa"). */
export function estadoDoMedidor(uso: UsoDoPlano, agora: EpochMs, fusoIana = "UTC"): EstadoDoMedidor {
  return {
    cincoHoras: uso.cincoHoras ? estadoDaJanela(uso.cincoHoras, agora, fusoIana) : null,
    semana: uso.semana ? estadoDaJanela(uso.semana, agora, fusoIana) : null,
  };
}
