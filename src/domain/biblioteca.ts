import { LIMITE_BIBLIOTECA, TETO_BIBLIOTECA } from "../contracts/biblioteca.ts";

/**
 * NOD-326: o cursor da Biblioteca é a chave do último item da página — o instante com microssegundos, como o Postgres o
 * guarda (o Date do JS perderia os µs e a página seguinte repetiria ou pularia itens do mesmo milissegundo), e o id, que
 * desempata. Opaco para a web: "<instante>_<uuid>" (só caracteres seguros na URL).
 */
export type CursorBiblioteca = { criadoEm: string; id: string };

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function codificarCursor(c: CursorBiblioteca): string {
  return `${c.criadoEm}_${c.id}`;
}

/** null quando o texto não é um cursor que este servidor emitiu. */
export function lerCursor(texto: string): CursorBiblioteca | null {
  if (texto.length === 0 || texto.length > 80) return null;
  const [criadoEm, id, ...resto] = texto.split("_");
  if (resto.length > 0 || !criadoEm || !id || !INSTANTE.test(criadoEm) || !UUID.test(id)) return null;
  // Revisão 1: o Date.parse aceita 2026-02-30 (vira 2 de março) e o Postgres não; a data tem de voltar igual.
  const t = Date.parse(criadoEm);
  // QA: o ano 0000 o JS aceita e o Postgres não (não há ano zero no timestamptz); começa em 0001.
  if (Number.isNaN(t) || criadoEm.startsWith("0000") || new Date(t).toISOString().slice(0, 23) !== criadoEm.slice(0, 23)) return null;
  return { criadoEm, id };
}

/** O limite pedido na query: ausente → 60; fora de 1..200 ou não inteiro → null (entrada inválida). */
export function limiteDaBiblioteca(texto: string | null): number | null {
  if (texto === null || texto === "") return LIMITE_BIBLIOTECA;
  if (!/^\d{1,4}$/.test(texto)) return null;
  const n = Number(texto);
  return n >= 1 && n <= TETO_BIBLIOTECA ? n : null;
}
