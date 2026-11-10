import { ORCAMENTO_RESULTADO_CHARS } from "../shared/constantes.ts";

/**
 * NOD-480 (emenda da ADR-040): o orçamento de contexto do turno pela janela do modelo. "Modelo simples = contexto
 * menor" (Marlon, 09/11): no Sonnet sem 1M, no Haiku ou em qualquer janela de 200k ou menos, o que volta a cada chamada
 * depois de um resumo (~122k, medido no #718) fica perto do limiar de compactação do Claude Code, e uma ou duas saídas
 * de ferramenta enchem o resto — o disjuntor do CLI para o turno com `autocompact_thrashing`. O orçamento decide, antes
 * do turno, se o prompt vai enxuto e qual o teto de cada saída. Numa janela de 1M tudo fica como antes.
 */

export const JANELA_PADRAO = 200_000;
export const JANELA_LONGA = 1_000_000;

/**
 * A janela do turno. A que o Claude Code informou no último turno do bot com o mesmo modelo (`result.modelUsage[*]
 * .contextWindow`, gravada no Raio-X) ganha: é a da conta de verdade (um Opus sem contexto longo é 200k). Sem ela, pelo
 * nome: `[1m]` ou Opus/Fable = 1M (definido em 2026-11-09: o Opus do Atlas informava 1_000_000, #712); o resto = 200k,
 * que é o lado seguro — o pior caso é um prompt enxuto num modelo grande.
 */
export function janelaDoModelo(modelo: string, observada?: number | null): number {
  if (typeof observada === "number" && Number.isFinite(observada) && observada >= 10_000) return Math.floor(observada);
  if (/\[1m\]/i.test(modelo)) return JANELA_LONGA;
  // "auto" no Claude Code é o recomendado (Opus, harness.ts).
  if (/opus|fable|^auto$/i.test(modelo)) return JANELA_LONGA;
  return JANELA_PADRAO;
}

/** O que o Claude Code reserva para a saída e o resumo antes de calcular o limiar (lido no binário 2.1.309, #718). */
export const RESERVA_DO_CLI = 20_000;
/** A folga fixa abaixo do limiar no 2.1.309 (#718). */
export const FOLGA_DO_LIMIAR = 13_000;

/**
 * O limiar em que o Claude Code compacta. Lido no binário 2.1.309 (#718): compacta acima de `min(W − 20%·W, W − 13k)`,
 * `W = janela − 20k` — ~144k numa janela de 200k. Usamos o lado conservador da fórmula para qualquer janela.
 */
export function limiarDeCompactacao(janela: number): number {
  const w = Math.max(0, janela - RESERVA_DO_CLI);
  return Math.max(0, Math.floor(Math.min(w - 0.2 * w, w - FOLGA_DO_LIMIAR)));
}

/**
 * definido em 2026-11-09 (NOD-480): a parte do Claude Code fora do prompt do nod que entra em toda chamada (o prompt das
 * nativas, as definições delas, os nomes das ferramentas adiadas e as skills). Estimado do #718: `cacheLido` 76.467 nas
 * três chamadas do Atlas menos o prompt do nod (~15,9k), o catálogo (~9,6k) e as ferramentas do nod (~13,2k).
 */
export const BASE_DO_HARNESS_TOKENS = 38_000;
/** Medido no #718 (motor `309ec3dd`): o resumo e os anexos que o Claude Code põe de volta depois de cada compactação. */
export const RESUMO_E_ANEXOS_TOKENS = 46_000;
/** Por ferramenta adiada (só o nome e a linha da busca), definido em 2026-11-09 pela média dos nomes `mcp__nod__*`. */
export const TOKENS_POR_FERRAMENTA_ADIADA = 15;
/**
 * definido em 2026-11-09: a parte fixa (o que volta depois de cada resumo) não passa da metade do limiar. Acima disso o
 * prompt vai enxuto. Com metade livre, a próxima compactação só vem depois de várias saídas, não de uma ou duas.
 */
export const FRACAO_SEGURA = 0.5;
/**
 * definido em 2026-11-09: o teto de cada saída de ferramenta é 4% do limiar — 25 saídas cheias até a compactação. Na
 * janela de 200k dá ~5,8k tokens (~20k caracteres); na de 1M passa dos tetos de hoje, que ficam valendo.
 */
export const FRACAO_POR_SAIDA = 0.04;
/** Caracteres por token no português dos prompts do nod (definido em 2026-11-09: a média dos prompts de referência). */
export const CHARS_POR_TOKEN = 3.5;

/** O teto de hoje do Bash no Claude Code (`bashOutputMaxChars`, padrão 30000; aceita 4000–128000, lido no 2.1.312). */
export const SAIDA_BASH_PADRAO_CHARS = 30_000;
export const SAIDA_BASH_MINIMA_CHARS = 4_000;
/** O teto de hoje do Read (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`, padrão 25000). */
export const LEITURA_PADRAO_TOKENS = 25_000;
export const LEITURA_MINIMA_TOKENS = 2_000;
/** O menor teto de saída de ferramenta do nod: abaixo disso uma página de resultado já não cabe. */
export const RESULTADO_MINIMO_CHARS = 8_000;

export const tokensDeChars = (chars: number): number => Math.ceil(Math.max(0, chars) / CHARS_POR_TOKEN);

/** O orçamento que vai no plano (`PlanoTurno.orcamento`). Os tetos ausentes = o padrão de hoje (não mexer). */
export type OrcamentoContexto = {
  janela: number;
  limiar: number;
  /** Tokens que voltam a cada chamada depois de um resumo, com o prompt como saiu. */
  parteFixa: number;
  /** O prompt saiu enxuto (catálogo sem a lista de capacidades) e o driver força a busca de ferramentas. */
  enxuto: boolean;
  /** Teto do resultado das ferramentas do nod e dos apps (o proxy corta e oferece `ler_mais`). */
  resultadoChars: number;
  /** Teto da saída do Bash; acima, o Claude Code grava num arquivo e manda um trecho e o caminho. Ausente = 30000. */
  saidaBashChars?: number;
  /** Teto de uma leitura do Read. Ausente = o padrão do Claude Code. */
  leituraTokens?: number;
};

export type MedidaDoPrompt = { promptChars: number; ferramentas: number };

/** Os tokens que voltam a cada chamada depois de um resumo. */
export function parteFixa(m: MedidaDoPrompt): number {
  return tokensDeChars(m.promptChars) + m.ferramentas * TOKENS_POR_FERRAMENTA_ADIADA + BASE_DO_HARNESS_TOKENS + RESUMO_E_ANEXOS_TOKENS;
}

/** A parte fixa passa da fração segura do limiar: o prompt precisa ir enxuto. */
export function precisaEnxugar(janela: number, m: MedidaDoPrompt): boolean {
  return parteFixa(m) > FRACAO_SEGURA * limiarDeCompactacao(janela);
}

const entre = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(v)));

/**
 * O orçamento do turno. `m` mede o prompt como ele vai (enxuto ou não, decidido antes por `precisaEnxugar`). Os tetos
 * são proporcionais ao limiar e nunca passam do padrão de hoje: em 1M saem iguais aos de antes (e sem env no driver).
 */
export function orcamentoDoTurno(p: { janela: number; enxuto: boolean; medida: MedidaDoPrompt }): OrcamentoContexto {
  const limiar = limiarDeCompactacao(p.janela);
  const porSaida = FRACAO_POR_SAIDA * limiar;
  const resultadoChars = entre(porSaida * CHARS_POR_TOKEN, RESULTADO_MINIMO_CHARS, ORCAMENTO_RESULTADO_CHARS);
  const bash = entre(porSaida * CHARS_POR_TOKEN, SAIDA_BASH_MINIMA_CHARS, SAIDA_BASH_PADRAO_CHARS);
  const leitura = entre(porSaida, LEITURA_MINIMA_TOKENS, LEITURA_PADRAO_TOKENS);
  return {
    janela: p.janela,
    limiar,
    parteFixa: parteFixa(p.medida),
    enxuto: p.enxuto,
    resultadoChars,
    ...(bash < SAIDA_BASH_PADRAO_CHARS ? { saidaBashChars: bash } : {}),
    ...(leitura < LEITURA_PADRAO_TOKENS ? { leituraTokens: leitura } : {}),
  };
}
