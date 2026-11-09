/**
 * definido em 2026-10-28 (NOD-42): a parte pura da busca na conversa (⌘F). Sem DOM: recebe os textos da timeline em
 * segmentos (um por nó de texto, agrupados por bloco = mensagem/card) e devolve as faixas que casam, em offsets do
 * texto ORIGINAL de cada segmento. Sem acento e sem caixa: "acao" acha "Ação" e "AÇÃO". Um match nunca atravessa
 * blocos (duas mensagens vizinhas não "colam"), mas atravessa nós de texto do mesmo bloco (negrito no meio da palavra).
 *
 * Ordem do resultado: a da LEITURA da contagem, da mais recente para a mais antiga (1 = a mais perto do fim da
 * conversa, que é onde a pessoa está). "Próxima" (Enter, ˄) anda para trás no tempo; "anterior" (Shift+Enter, ˅)
 * volta para a mais recente; as duas dão a volta.
 */

export type Segmento = { bloco: string; texto: string };
export type Ponto = { segmento: number; offset: number };
export type Ocorrencia = { chave: string; inicio: Ponto; fim: Ponto };

export const MINIMO_DO_TERMO = 2;

type Normalizado = { texto: string; inicio: number[]; fim: number[] };

/** Normaliza (NFD sem marcas, minúsculas) guardando, para cada unidade do resultado, onde ela começa e termina no original. */
function soAscii(t: string): boolean {
  for (let k = 0; k < t.length; k++) if (t.charCodeAt(k) > 0x7f) return false;
  return true;
}

export function normalizar(original: string): Normalizado {
  // Caminho rápido (2026-10-28, revisão do PR 560): ASCII não tem acento nem par substituto — cada unidade é ela mesma.
  if (soAscii(original)) {
    const inicio = Array.from({ length: original.length }, (_, k) => k);
    return { texto: original.toLowerCase(), inicio, fim: inicio.map((k) => k + 1) };
  }
  let texto = "";
  const inicio: number[] = [];
  const fim: number[] = [];
  let i = 0;
  for (const cp of original) {
    const j = i + cp.length;
    const n = cp.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < n.length; k++) { inicio.push(i); fim.push(j); }
    texto += n;
    i = j;
  }
  return { texto, inicio, fim };
}

export function normalizarTermo(termo: string): string {
  return normalizar(termo).texto.replace(/\s+/g, " ").trim();
}

export function termoValido(termo: string): boolean {
  return [...normalizarTermo(termo)].length >= MINIMO_DO_TERMO;
}

/** Converte um offset do texto do bloco (segmentos concatenados) em segmento + offset. `fim` puxa para o fim do anterior. */
function pontoNoBloco(cortes: number[], primeiro: number, offset: number, fim: boolean): Ponto {
  for (let s = 0; s < cortes.length - 1; s++) {
    const a = cortes[s] ?? 0;
    const b = cortes[s + 1] ?? 0;
    if (fim ? offset > a && offset <= b : offset >= a && offset < b) return { segmento: primeiro + s, offset: offset - a };
  }
  const ultimo = cortes.length - 2;
  return { segmento: primeiro + Math.max(0, ultimo), offset: offset - (cortes[Math.max(0, ultimo)] ?? 0) };
}

/**
 * Acha todas as ocorrências do termo, sem sobreposição, e devolve na ordem da contagem (mais recente primeiro).
 * `chave` = bloco + ordem dentro do bloco: é o que mantém a ocorrência atual quando a timeline é regravada.
 */
export function acharOcorrencias(segmentos: readonly Segmento[], termo: string): Ocorrencia[] {
  if (!termoValido(termo)) return [];
  const agulha = normalizarTermo(termo);
  const emOrdem: Ocorrencia[] = [];
  // A ordem conta por bloco, não por grupo: o mesmo bloco pode voltar depois de outro (texto em volta de uma mensagem).
  const ordens = new Map<string, number>();
  let s = 0;
  while (s < segmentos.length) {
    const bloco = segmentos[s]?.bloco ?? "";
    const primeiro = s;
    const cortes = [0];
    let junto = "";
    while (s < segmentos.length && segmentos[s]?.bloco === bloco) {
      junto += segmentos[s]?.texto ?? "";
      cortes.push(junto.length);
      s++;
    }
    const { n, palheiro } = normalizadoDoBloco(bloco, junto);
    let ordem = ordens.get(bloco) ?? 0;
    let de = 0;
    for (;;) {
      const achou = buscarComEspacos(palheiro, agulha, de);
      if (!achou) break;
      const [a, b] = achou;
      emOrdem.push({
        chave: `${bloco}#${ordem++}`,
        inicio: pontoNoBloco(cortes, primeiro, n.inicio[a] ?? 0, false),
        fim: pontoNoBloco(cortes, primeiro, n.fim[b - 1] ?? 0, true),
      });
      de = b;
    }
    ordens.set(bloco, ordem);
  }
  return emOrdem.reverse();
}

/**
 * Cache da normalização por bloco (2026-10-28, revisão do PR 560): com a busca aberta, a timeline muda enquanto o bot
 * escreve, mas só o bloco vivo muda — os outros saem daqui. Uma entrada por bloco, trocada quando o texto dele muda (o
 * bloco vivo não acumula versões parciais); o controlador esquece tudo ao fechar.
 */
const CACHE_MAX = 2000;
const cache = new Map<string, { junto: string; n: Normalizado; palheiro: string }>();
function normalizadoDoBloco(bloco: string, junto: string): { n: Normalizado; palheiro: string } {
  const visto = cache.get(bloco);
  if (visto && visto.junto === junto) return visto;
  const n = normalizar(junto);
  // espaços em sequência no DOM (quebra de linha, indentação) casam com um espaço do termo
  const novo = { junto, n, palheiro: n.texto.replace(/\s/g, " ") };
  if (!visto && cache.size >= CACHE_MAX) cache.clear();
  cache.set(bloco, novo);
  return novo;
}

export function esquecerNormalizados(): void {
  cache.clear();
}

/** Para os testes: quantos blocos estão no cache. */
export function tamanhoDoCache(): number {
  return cache.size;
}

/** indexOf em que cada espaço da agulha casa com 1+ espaços do palheiro. Devolve [início, fim) no palheiro. */
function buscarComEspacos(palheiro: string, agulha: string, de: number): [number, number] | null {
  if (!agulha.includes(" ")) {
    const a = palheiro.indexOf(agulha, de);
    return a < 0 ? null : [a, a + agulha.length];
  }
  const partes = agulha.split(" ").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(partes.join(" +"), "g");
  re.lastIndex = de;
  const m = re.exec(palheiro);
  return m ? [m.index, m.index + m[0].length] : null;
}

/** Anda na lista com volta: +1 = próxima (mais antiga), -1 = anterior (mais recente). */
export function andar(atual: number, total: number, passo: 1 | -1): number {
  if (total <= 0) return -1;
  if (atual < 0) return passo === 1 ? 0 : total - 1;
  return (((atual + passo) % total) + total) % total;
}

/** Depois de regravar a timeline: a mesma ocorrência (pela chave) ou, se ela sumiu, a mais próxima da posição antiga. */
export function reposicionar(chaveAtual: string | null, indiceAntigo: number, chavesNovas: readonly string[]): number {
  if (chavesNovas.length === 0) return -1;
  if (chaveAtual !== null) {
    const i = chavesNovas.indexOf(chaveAtual);
    if (i >= 0) return i;
  }
  return Math.min(Math.max(indiceAntigo, 0), chavesNovas.length - 1);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const doisDigitos = (n: number): string => String(n).padStart(2, "0");

export type Contagem = { atual: number; total: number; desde: Date | null };

/** O que a pílula mostra: "3/6 · desde 24/10" ou "Nada desde 24/10". Termo curto demais: nada. */
export function textoDaContagem(c: Contagem): string {
  const desde = c.desde ? `desde ${doisDigitos(c.desde.getDate())}/${doisDigitos(c.desde.getMonth() + 1)}` : "";
  if (c.total === 0) return desde ? `Nada ${desde}` : "Nada";
  const pos = `${Math.max(c.atual, 0) + 1}/${c.total}`;
  return desde ? `${pos} · ${desde}` : pos;
}

/** O que o leitor de tela ouve: "3 de 6, desde 24 de outubro". */
export function anuncioDaContagem(c: Contagem): string {
  const desde = c.desde ? `desde ${c.desde.getDate()} de ${MESES[c.desde.getMonth()] ?? ""}` : "";
  if (c.total === 0) return desde ? `Nada ${desde}` : "Nada encontrado";
  const pos = `${Math.max(c.atual, 0) + 1} de ${c.total}`;
  return desde ? `${pos}, ${desde}` : pos;
}
