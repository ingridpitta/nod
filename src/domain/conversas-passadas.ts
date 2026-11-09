import { codificarCursor, lerCursor, type CursorBiblioteca } from "./biblioteca.ts";

/** NOD-61: as regras puras de buscar_conversas e ler_conversa (src/contracts/ferramentas-conversas.ts). */

/** definido em 2026-10-29 (NOD-61): até 10 resultados por busca. */
export const LIMITE_BUSCAR_CONVERSAS = 10;
/** definido em 2026-10-29 (NOD-61): o trecho de cada resultado tem até 300 caracteres. */
export const TRECHO_BUSCAR_CONVERSAS = 300;
/** definido em 2026-10-29 (NOD-61): ler_conversa devolve até 20 falas (a pedida e 19 vizinhas). */
export const JANELA_LER_CONVERSA = 20;
export const VIZINHAS_PADRAO = 5;
/** definido em 2026-10-29 (NOD-61): cada fala de ler_conversa vem com até 2.000 caracteres; o resultado inteiro passa pelo corte do proxy (ler_mais). */
export const TETO_FALA_LER_CONVERSA = 2000;

/** O menor uuid: com ele, o cursor de uma data pega só o que veio ANTES daquele instante (estrito; revisão 3, B2). */
const UUID_MINIMO = "00000000-0000-0000-0000-000000000000";
const DATA = /^\d{4}-\d{2}-\d{2}$/u;
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/u;

/**
 * `antes_de` → cursor da busca: o `mais_antigos` de uma busca anterior (cursor da Biblioteca), uma data (AAAA-MM-DD, meia-noite
 * UTC) ou um instante ISO. null quando não é nenhum dos três ou a data não existe (2026-02-30).
 */
export function cursorDoAntesDe(texto: string): CursorBiblioteca | null {
  const t = texto.trim();
  const cursor = lerCursor(t);
  if (cursor) return cursor;
  if (!DATA.test(t) && !INSTANTE_ISO.test(t)) return null;
  const ms = Date.parse(DATA.test(t) ? `${t}T00:00:00Z` : t);
  if (Number.isNaN(ms) || ms < Date.parse("0001-01-01T00:00:00Z")) return null;
  if (DATA.test(t) && new Date(ms).toISOString().slice(0, 10) !== t) return null;
  const instante = `${new Date(ms).toISOString().slice(0, 23)}000Z`;
  return lerCursor(codificarCursor({ criadoEm: instante, id: UUID_MINIMO }));
}

/**
 * Quantas vizinhas pedir ao banco antes e depois: padrão 5 e 5, cada uma até 19. A janela (20 com a pedida) é cortada depois,
 * no que existe: `antes` tem preferência e o que faltar antes completa depois (QA do PR #594, bug 3).
 */
export function vizinhasDaJanela(antes: number | undefined, depois: number | undefined): { antes: number; depois: number } {
  const maximo = JANELA_LER_CONVERSA - 1;
  const a = Math.min(Math.max(0, Math.trunc(antes ?? VIZINHAS_PADRAO)), maximo);
  const d = Math.min(Math.max(0, Math.trunc(depois ?? VIZINHAS_PADRAO)), maximo);
  return { antes: a, depois: d };
}

/** Uma fala de ler_conversa: até `teto` caracteres (sem partir um par de surrogates), e se cortou. */
export function falaCortada(texto: string, teto = TETO_FALA_LER_CONVERSA): { texto: string; cortada: boolean } {
  const chars = [...texto];
  if (chars.length <= teto) return { texto, cortada: false };
  return { texto: `${chars.slice(0, teto - 1).join("")}…`, cortada: true };
}
