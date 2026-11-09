import { ESTADO_MAX_BYTES_ARTEFATO, HTML_MAX_ARTEFATO, HTML_MAX_LEITURA_ARTEFATO, TITULO_MAX_ARTEFATO } from "../contracts/artefato.ts";
import { ErroDeDominio } from "./erro.ts";

/**
 * Regras puras do artefato do nod (ADR-051). O HTML é do bot e não é interpretado aqui: o servidor só
 * guarda, mede e corta; quem o isola é a web (iframe sandbox sem allow-same-origin, CSP sem rede).
 */

/** Caracteres como o Postgres conta (char_length = code points), sem montar um array de 500 000 itens. */
export function caracteres(texto: string): number {
  let n = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < texto.length) {
      const d = texto.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/**
 * O caractere NUL não cabe em text nem em jsonb do Postgres (22021/22P05 virariam 500): recusa antes.
 * definido em 2026-09-28: é o único caractere que o banco recusa; o resto do HTML passa como veio.
 */
const NUL = "\u0000";

/** Título de card: uma linha, espaços colapsados, 1..120. Fora disso, entrada_invalida. */
export function normalizarTitulo(titulo: string): string {
  const t = titulo.replace(/\s+/g, " ").trim();
  if (t === "" || t.includes(NUL) || caracteres(t) > TITULO_MAX_ARTEFATO) throw new ErroDeDominio("entrada_invalida", { cause: "titulo do artefato" });
  return t;
}

/** O HTML vai como veio (o bot escreveu; a web isola). Só o tamanho é regra: 1..500 000 caracteres. */
export function validarHtml(html: string): string {
  if (html.trim() === "" || html.includes(NUL) || caracteres(html) > HTML_MAX_ARTEFATO) throw new ErroDeDominio("entrada_invalida", { cause: "html do artefato" });
  return html;
}

/** Bytes UTF-8 de um texto, sem TextEncoder (o domínio não tem DOM nem node:*). */
export function bytesUtf8(texto: string): number {
  let n = 0;
  for (const c of texto) {
    const p = c.codePointAt(0) ?? 0;
    n += p < 0x80 ? 1 : p < 0x800 ? 2 : p < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * O estado que a página salvou: qualquer valor JSON (o que o bot escolheu guardar) de até 64 KB
 * serializado. `undefined`, função, BigInt ou ciclo não são JSON e são recusados. O banco mede de novo
 * na forma normalizada do jsonb (0031) — esta é a recusa barata, antes de tocar nele.
 */
export function validarEstado(dados: unknown): string {
  let texto: string | undefined;
  try {
    texto = JSON.stringify(dados);
  } catch {
    throw new ErroDeDominio("entrada_invalida", { cause: "estado do artefato não é JSON" });
  }
  if (texto === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "estado do artefato ausente" });
  // JSON.stringify escreve o NUL como \u0000, que o jsonb recusa (22P05).
  if (texto.includes("\\u0000")) throw new ErroDeDominio("entrada_invalida", { cause: "estado do artefato com NUL" });
  if (bytesUtf8(texto) > ESTADO_MAX_BYTES_ARTEFATO) throw new ErroDeDominio("entrada_invalida", { cause: "estado do artefato > 64 KB" });
  return texto;
}

/**
 * O HTML como ler_artefato o devolve ao modelo: até 60 000 caracteres e, se cortado, uma marca que diz
 * quanto ficou de fora — para o modelo não inventar o resto. Nunca corta no meio de um par substituto.
 */
export function htmlParaLeitura(html: string, max = HTML_MAX_LEITURA_ARTEFATO): string {
  if (html.length <= max) return html;
  let fim = max;
  const c = html.charCodeAt(fim - 1);
  if (c >= 0xd800 && c <= 0xdbff) fim -= 1;
  return `${html.slice(0, fim)}\n<!-- [cortado pelo nod: ${html.length - fim} de ${html.length} caracteres ficaram de fora] -->`;
}

/**
 * A fala que acompanha o card na conversa. É o que o modelo lê no histórico (por isso leva o id, para
 * publicar a próxima versão) e o que a busca e o relato veem; a web desenha o card pelo payload.
 */
export function textoDaPublicacao(p: { titulo: string; versao: number; artefatoId: string }): string {
  return `Artefato «${p.titulo}» publicado (v${p.versao}) · artefato_id ${p.artefatoId}`;
}
