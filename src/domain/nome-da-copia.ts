import { pastaDoBot } from "./nativas.ts";

/** O nome de bot cabe em 60 caracteres (a pasta também: `pastaDoBot` corta em 60). */
const LIMITE_NOME = 60;
const TETO_N = 999;

/**
 * NOD-289 (M3): o nome da cópia é o primeiro livre entre "X (cópia)", "X (cópia 2)", "X (cópia 3)"…, sempre dentro de
 * 60 caracteres (a base encurta para o sufixo caber). Livre = nenhum bot existente (oculto e excluído contam: o
 * excluído pode ser restaurado) tem a mesma PASTA sem diferenciar maiúsculas — cobre o nome igual (`resolverAlvo` e
 * `resolverBot` comparam sem maiúsculas) e o nome diferente que vira a mesma pasta ("a/b" e "a-b").
 * Depois de 999 cópias o sufixo leva `desempate` (o começo de um id novo); na prática não acontece.
 */
export function nomeDaCopia(nomeOriginal: string, existentes: readonly string[], desempate = "nova"): string {
  const ocupadas = new Set(existentes.map(chave));
  for (let n = 1; n <= TETO_N; n++) {
    const nome = comSufixo(nomeOriginal, n === 1 ? " (cópia)" : ` (cópia ${n})`);
    if (!ocupadas.has(chave(nome))) return nome;
  }
  return comSufixo(nomeOriginal, ` (cópia ${desempate.slice(0, 8)})`);
}

const grafemas = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Corta a base por grafema (Intl.Segmenter), nunca no meio de um caractere visível: `slice` por unidade UTF-16 partia
 * o emoji no limite, e o corte por code point ainda deixava ZWJ, indicador regional ou tom de pele solto (👨‍👩‍👧 virava
 * "👨‍"). O teto continua em unidades UTF-16 (o `.length` que `criar-bots` valida e o `slice(0, 60)` de `pastaDoBot`),
 * para o sufixo nunca sair cortado da pasta.
 */
function comSufixo(base: string, sufixo: string): string {
  const cabe = LIMITE_NOME - sufixo.length;
  const partes = Array.from(grafemas.segment(base), (s) => s.segment);
  let tamanho = base.length;
  while (tamanho > cabe) tamanho -= partes.pop()?.length ?? tamanho;
  return `${partes.join("").trimEnd()}${sufixo}`;
}

const chave = (nome: string): string => pastaDoBot(nome).toLocaleLowerCase();
