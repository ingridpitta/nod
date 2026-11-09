import type { CustoDoBotHoje } from "../contracts/cota.ts";
import type { EpochMs } from "../contracts/ids.ts";

/**
 * O custo de cada bot hoje e o aviso de ritmo (definido em 2026-10-12, ADR-099 §7: "custo visível, sem teto"). Puro: `agora`
 * e o fuso por parâmetro. Nada aqui segura trabalho. Sem consumidor na UI desde
 * o NOD-369 (emenda à ADR-099 item 7): o topo de Trabalhos não mostra mais.
 *
 * A regra do aviso: o gasto de HOJE até agora passa de 2× a média dos 7 dias anteriores, cada um somado da meia-noite
 * até o MESMO horário (no fuso da pessoa), e passa do piso de US$ 1.
 *
 * NOD-276 (definido em 2026-10-15, D9): a média é a dos dias em que o bot gastou (soma ÷ dias com soma > 0). Antes, dia
 * sem gasto contava zero: o bot que trabalhou um dia em sete tinha média de 1/7 do normal e qualquer dia comum dele
 * "passava de 7×". Com menos de 3 dias com gasto nos 7, o ritmo é "sem base" e não há aviso: falta com que comparar.
 */

/** definido em 2026-10-12: o aviso sai acima de 2× a média do mesmo horário. */
export const VEZES_FORA_DO_RITMO = 2;
/** definido em 2026-10-12: abaixo de US$ 1 no dia não há aviso (centavos dobrando não são ritmo). */
export const PISO_DO_AVISO_USD = 1;
/** Os 7 dias anteriores. */
export const DIAS_DA_MEDIA = 7;
/** NOD-276 (D9): com menos que isto de dias com gasto nos 7 anteriores, não há base para o aviso. */
export const DIAS_MINIMOS_DA_BASE = 3;

const DIA_MS = 86_400_000;

/** O fuso IANA aceito pelo Intl; o que não for vira o padrão. */
export function fusoValido(fuso: string | null | undefined, padrao: string): string {
  if (!fuso || fuso.length > 64) return padrao;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return padrao;
  }
}

/** Quanto o relógio do fuso está à frente do UTC no instante (ms; -3 h em São Paulo). */
function deslocamento(instante: EpochMs, fuso: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instante))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const comoUtc = Date.UTC(partes["year"]!, partes["month"]! - 1, partes["day"]!, partes["hour"]!, partes["minute"]!, partes["second"]!);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** A meia-noite (00:00 no fuso) do dia que contém `instante`. Com horário de verão, corrige pelo deslocamento da meia-noite. */
export function meiaNoiteNoFuso(instante: EpochMs, fuso: string): EpochMs {
  const local = instante + deslocamento(instante, fuso);
  const meiaNoiteLocal = Math.floor(local / DIA_MS) * DIA_MS;
  const palpite = meiaNoiteLocal - deslocamento(instante, fuso);
  return meiaNoiteLocal - deslocamento(palpite, fuso);
}

/**
 * As janelas a somar: a de hoje (da meia-noite até agora) e, para cada um dos 7 dias anteriores, da meia-noite dele até o
 * mesmo tempo decorrido. A primeira é hoje.
 */
export function janelasDoDia(agora: EpochMs, fuso: string): { inicio: EpochMs; fim: EpochMs }[] {
  const hoje = meiaNoiteNoFuso(agora, fuso);
  const decorrido = agora - hoje;
  const janelas = [{ inicio: hoje, fim: agora }];
  for (let d = 1; d <= DIAS_DA_MEDIA; d++) {
    // Meio-dia do dia anterior, para o horário de verão não empurrar a conta para o dia errado.
    const inicio = meiaNoiteNoFuso(hoje - d * DIA_MS + DIA_MS / 2, fuso);
    janelas.push({ inicio, fim: inicio + decorrido });
  }
  return janelas;
}

/** O ritmo de um bot: `hoje` e os gastos dos 7 dias anteriores no mesmo horário (faltando dia, ele não entra na média). */
export function ritmoDoBot(hojeUsd: number, anteriores: readonly number[]): Pick<CustoDoBotHoje, "mediaUsd" | "vezes" | "foraDoRitmo"> & { ritmo: "normal" | "sem base" } {
  const comGasto = anteriores.slice(0, DIAS_DA_MEDIA).filter((v) => Number.isFinite(v) && v > 0);
  const mediaUsd = comGasto.length === 0 ? 0 : comGasto.reduce((s, v) => s + v, 0) / comGasto.length;
  if (comGasto.length < DIAS_MINIMOS_DA_BASE) return { mediaUsd, vezes: null, foraDoRitmo: false, ritmo: "sem base" };
  const vezes = hojeUsd / mediaUsd;
  return { mediaUsd, vezes, foraDoRitmo: hojeUsd >= PISO_DO_AVISO_USD && vezes > VEZES_FORA_DO_RITMO, ritmo: "normal" };
}

/**
 * A soma de um bot numa janela (o que o repositório devolve). `tokens` = entrada + saída dos gastos; `semCusto` = algum
 * gasto teve consumo e nenhum custo informado (o Codex) — o dólar da janela é só parte do que custou.
 */
export type SomaDoDia = { agenteId: string; janela: number; usd: number; tokens?: number; semCusto?: boolean };

/**
 * Os bots do dia a partir das somas por (bot, janela) — janela 0 é hoje, 1 a 7 os dias anteriores. Entra quem gastou hoje
 * (em dólar ou só em tokens) ou está fora do ritmo, do que mais gastou ao que menos (empate: mais tokens primeiro).
 *
 * revisto em 2026-10-15 (NOD-273, D4): o bot que só roda no Codex não some mais da lista — aparece com os tokens, e
 * `parcial` diz que o dólar de hoje não cobre tudo. O ritmo segue só em dólar (tokens não têm preço aqui).
 */
export function custoDosBots(somas: readonly SomaDoDia[]): CustoDoBotHoje[] {
  const porBot = new Map<string, { usd: number[]; tokens: number; parcial: boolean }>();
  for (const s of somas) {
    if (s.janela < 0 || s.janela > DIAS_DA_MEDIA) continue;
    const linha = porBot.get(s.agenteId) ?? { usd: new Array<number>(DIAS_DA_MEDIA + 1).fill(0), tokens: 0, parcial: false };
    linha.usd[s.janela] = (linha.usd[s.janela] ?? 0) + (Number.isFinite(s.usd) ? s.usd : 0);
    if (s.janela === 0) {
      linha.tokens += Number.isFinite(s.tokens) ? (s.tokens ?? 0) : 0;
      linha.parcial ||= s.semCusto === true;
    }
    porBot.set(s.agenteId, linha);
  }
  return [...porBot.entries()]
    .map(([agenteId, l]) => ({ agenteId, hojeUsd: l.usd[0] ?? 0, tokens: l.tokens, parcial: l.parcial, ...ritmoDoBot(l.usd[0] ?? 0, l.usd.slice(1)) }))
    .filter((b) => b.hojeUsd > 0 || b.tokens > 0 || b.foraDoRitmo)
    .sort((a, b) => b.hojeUsd - a.hojeUsd || b.tokens - a.tokens || a.agenteId.localeCompare(b.agenteId));
}
