import { ITEM_DE_LISTA } from "./texto-formatado.ts";

/**
 * NOD-358 (emenda da ADR-114): a resposta do bot sai em vários balões, um por parágrafo, como uma pessoa manda no
 * WhatsApp. Só se corta em linha em branco da prosa; código e tabela ficam inteiros, porque a linha em branco dentro de
 * uma cerca é código e a tabela termina na linha em branco que a separa da prosa. A fronteira não vale quando:
 * - o bloco de cima termina em ":" (também "**Próximos passos:**"): a frase que apresenta a lista fica com a lista;
 * - a lista ou a citação de cima continua embaixo (lista solta, linha recuada, ">", o passo a passo com código entre
 *   os itens);
 * - um título "#" já apareceu no balão: daí até o fim é documento (relatório não vira confete);
 * - já há BALOES_MAX balões: o resto fica junto no último.
 * Cada balão é um pedaço exato do texto: o texto sem fronteira sai em um balão, byte a byte (a resposta de um parágrafo
 * fica como era). Com fronteira, o último perde as linhas em branco do fim, como os outros.
 *
 * `parcial` (fala viva, texto ainda chegando): o começo do bloco seguinte que ainda não decidiu se continua a lista de
 * cima ("1", "-", "``") não aparece até decidir, e a quebra do fim (que pode ser o começo da linha em branco do próximo
 * balão) também não. Assim os balões só crescem: o anterior nunca muda e nada se junta de volta (definido em
 * 2026-10-26, NOD-358). medido em 2026-10-26: 0 exceções em 61 mil textos (fuzz de prefixos das revisões 1 e 2 do
 * PR #522, markdown aleatório com lista, código, tabela, citação, título e CRLF).
 */
/** definido em 2026-10-26 (NOD-358): o protótipo j3-2 tem 3; acima de 5, a resposta já é um documento e não uma conversa. */
export const BALOES_MAX = 5;

const CERCA = /(```[\s\S]*?(?:```|$))/g;
/** Em branco como no `trim()`: NBSP, U+3000 e U+FEFF também (revisão 8 do PR #522). */
const LINHA_EM_BRANCO = /\n(?:[^\S\n]*\n)+/g;
/** A linha recuada que continua o item: dois espaços ou um tab (revisão 3 do PR #522: "\t- sub"). */
const RECUO = /^(?: {2}|\t)/;
/** Sem regex de espaços seguidos: ` {2,}\s*\S` era quadrático numa linha de espaços com um NBSP (revisão 7 do PR #522). */
const ehContinuacao = (linha: string): boolean => RECUO.test(linha) && linha.trim() !== "";
const CITACAO = /^ {0,3}>/;
/** A frase que apresenta: termina em ":", também dentro da ênfase ("**Próximos passos:**", "_Veja:_") ou com emoji ("👇"). */
const APRESENTA = /:\s*(?:\*\*|\*|__|_)?\s*(?:\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*\s*)*$/u;
/**
 * Só o fim da linha, aparado, decide se ela apresenta (revisão 5 do PR #522: ":" + milhares de espaços era quadrático).
 * definido em 2026-10-26: 64 cabe o ":" com ênfase e vários emoji; a frase que apresenta termina nele.
 */
const FIM_QUE_APRESENTA = 64;
/** O começo de linha que ainda pode virar item ("1", "1.", "-", "- "). */
const ITEM_INDECISO = /^ {0,3}(?:[-*+]|\d{1,3}[.)]?)\s*$/;
/** A cerca que ainda está abrindo: uma ou duas crases. */
const CERCA_INDECISA = /^ {0,3}`{1,2}$/;
/**
 * O título, como o `TITULO` do texto formatado o reconhece ("#" a "######", espaço e mais um caractere), sem o grupo
 * preguiçoso que era quadrático numa linha de milhares de espaços (revisão 5 do PR #522).
 */
const TITULO = /^ {0,3}#{1,6}\s./;
/** O código logo depois do item é do passo a passo, mesmo sem ":" ("1. Instale" + cerca; revisão 4 do PR #522). */
const ABRE_CERCA = /^ {0,3}```/;

export interface OpcoesBaloes {
  parcial?: boolean;
}

/**
 * A timeline é redesenhada a cada quadro (a memória de `textoFormatado` existe por isso): a divisão de cada texto também
 * fica guardada. medido em 2026-10-26: 2,35 ms → 0,5 ms por redesenho de 200 falas típicas (bancada em Node da revisão
 * 1 do PR #522, antes e depois da memória e da leitura de trás para frente).
 */
/** definido em 2026-10-26: o dobro das 200 falas que a timeline guarda, como a memória de `textoFormatado`. */
const MEMORIA_MAX = 400;
const memoria = new Map<string, string[]>();

/**
 * Ao vivo, cada prefixo é dividido uma vez e não volta: fica só o último (com duas falas vivas na tela, cada
 * uma é redividida a cada quadro: linear, ~0,75 ms por 28 mil caracteres, revisão 6). medido em 2026-10-26: guardar os prefixos
 * retinha ~9,8 MB num turno de 28 mil caracteres em ~1.250 pedaços (revisão 3 do PR #522, heap do Node antes e depois).
 */
let ultimoAoVivo: { texto: string; baloes: string[] } | null = null;

export function dividirEmBaloes(texto: string, opcoes: OpcoesBaloes = {}): string[] {
  if (opcoes.parcial) {
    if (ultimoAoVivo?.texto !== texto) ultimoAoVivo = { texto, baloes: dividirSemMemoria(texto, opcoes) };
    return ultimoAoVivo.baloes;
  }
  const chave = texto;
  const guardado = memoria.get(chave);
  if (guardado) return guardado;
  const baloes = dividirSemMemoria(texto, opcoes);
  memoria.set(chave, baloes);
  if (memoria.size > MEMORIA_MAX) memoria.delete(memoria.keys().next().value ?? "");
  return baloes;
}

/** A divisão sem a memória: para a guarda de desempenho, que mede o custo de dividir (com a memória, mediria o `Map`). */
export function dividirSemMemoria(texto: string, opcoes: OpcoesBaloes = {}): string[] {
  return dividir(texto, opcoes.parcial === true);
}

interface Corte {
  /** Onde o bloco de cima acaba (o "\n" que fecha a última linha dele). */
  fim: number;
  /** Onde o bloco de baixo começa. */
  inicio: number;
}

function dividir(original: string, parcial: boolean): string[] {
  if (original.trim() === "") return [];
  // CRLF (e o "\r" solto): a linha em branco "\r\n\r\n" também separa (e "." do item de lista não casa com o "\r"). O "\r" do fim
  // ao vivo vira "\n" e cai com o fim em branco, sem corte à parte (revisão 7 do PR #522).
  const texto = original.includes("\r") ? original.replace(/\r\n?/g, "\n") : original;
  const { cortes, codigo } = mapa(texto);
  // As linhas em branco do fim saem (o espaço da última linha com texto fica). Varredura, não regex: `(?:\n[ \t]*)+$`
  // voltava atrás em toda sequência longa de quebras fora do fim (revisão 6 do PR #522: 10 mil "\n" num código aberto, 613 ms).
  const aparar = (balao: string): string => {
    let i = balao.length;
    while (i > 0 && /\s/.test(balao[i - 1] ?? "")) i--;
    const quebra = balao.indexOf("\n", i);
    return quebra < 0 ? balao : balao.slice(0, quebra);
  };
  // Sem CRLF, `texto` é o original: o balão único sai byte a byte. Com CRLF, sai normalizado, como ao vivo (senão o
  // balão ao vivo não seria começo do final; fuzz da revisão 2 do PR #522).
  if (cortes.length === 0) return [parcial ? aparar(texto) : texto];
  const ler = leitor(texto, codigo);

  const inicios = [0];
  const fins: number[] = [];
  let documento = ler.temTitulo(0, cortes[0]?.fim ?? texto.length);
  let fimVisivel = texto.length;
  let inicioDoBloco = 0;
  let listaAntes = false;
  for (let k = 0; k < cortes.length; k++) {
    const corte = cortes[k] as Corte;
    const fimDeB = cortes[k + 1]?.fim ?? texto.length;
    const quebra = texto.indexOf("\n", corte.inicio);
    const primeira = texto.slice(corte.inicio, quebra < 0 || quebra > fimDeB ? fimDeB : quebra);
    if (texto.slice(corte.inicio, fimDeB).trim() === "") continue;
    const deA = inicios.at(-1) ?? 0;
    // O bloco de cima termina em lista? Só o último bloco dele é lido: sem item nem prosa ali (só continuação e
    // código), vale o do bloco anterior do mesmo balão (revisão 4 do PR #522: reler o balão inteiro era quadrático).
    const lido = ler.listaNoTrecho(deA, inicioDoBloco, corte.fim);
    const naLista: boolean = lido ?? (inicioDoBloco > deA ? listaAntes : false);
    listaAntes = naLista;
    inicioDoBloco = corte.inicio;
    const juntar = documento || inicios.length >= BALOES_MAX || ler.apresenta(deA, corte.fim)
      || (naLista && (ITEM_DE_LISTA.test(primeira) || ehContinuacao(primeira) || ABRE_CERCA.test(primeira)))
      || (ler.emCitacao(deA, corte.fim) && CITACAO.test(primeira));
    if (!juntar) {
      const ultimo = k === cortes.length - 1 && quebra < 0;
      if (parcial && ultimo && (CERCA_INDECISA.test(primeira) || (naLista && ITEM_INDECISO.test(primeira)))) {
        fimVisivel = corte.fim;
        break;
      }
      fins.push(corte.fim);
      inicios.push(corte.inicio);
    }
    if (ler.temTitulo(corte.inicio, fimDeB)) documento = true;
  }
  fins.push(fimVisivel);
  if (inicios.length === 1 && !parcial && texto === original && fimVisivel === texto.length) return [original];
  return inicios.map((de, i) => {
    const balao = texto.slice(de, fins[i]);
    return i === inicios.length - 1 ? aparar(balao) : balao;
  });
}

/** Os cortes possíveis (linhas em branco fora das cercas) e os trechos de código, em ordem. */
function mapa(texto: string): { cortes: Corte[]; codigo: [number, number][] } {
  const cortes: Corte[] = [];
  const codigo: [number, number][] = [];
  let pos = 0;
  let temConteudo = false;
  // O primeiro caractere com conteúdo, uma vez: reler o começo a cada linha em branco era quadrático (revisão 7).
  const primeiro = texto.search(/\S/);
  texto.split(CERCA).forEach((trecho, i) => {
    if (i % 2 === 1) codigo.push([pos, pos + trecho.length]);
    else {
      for (const m of trecho.matchAll(LINHA_EM_BRANCO)) {
        const fim = pos + m.index;
        // O bloco de cima precisa ter conteúdo: linhas em branco no começo do texto não cortam.
        if (temConteudo || (primeiro >= 0 && primeiro < fim)) {
          temConteudo = true;
          cortes.push({ fim, inicio: fim + m[0].length });
        }
      }
    }
    if (trecho.trim() !== "") temConteudo = true;
    pos += trecho.length;
  });
  return { cortes, codigo };
}

/**
 * Lê as linhas do bloco [de, ate) de trás para frente, sem copiar o bloco (o balão acumulado de uma lista solta longa é
 * relido a cada corte). `emCodigo` é uma busca binária nos trechos de código, que vêm em ordem.
 */
function leitor(texto: string, codigo: readonly [number, number][]) {
  const emCodigo = (pos: number): boolean => {
    let lo = 0;
    let hi = codigo.length - 1;
    while (lo <= hi) {
      const meio = (lo + hi) >> 1;
      const [a, b] = codigo[meio] as [number, number];
      if (pos < a) hi = meio - 1;
      else if (pos >= b) lo = meio + 1;
      else return true;
    }
    return false;
  };
  /** As linhas não em branco, da última para a primeira: [início da linha, linha]. */
  function* deTras(de: number, ate: number): Generator<[number, string]> {
    let fim = ate;
    while (fim > de) {
      const quebra = texto.lastIndexOf("\n", fim - 1);
      const inicio = Math.max(quebra + 1, de);
      const linha = texto.slice(inicio, fim);
      if (linha.trim() !== "") yield [inicio, linha];
      fim = quebra < de ? de : quebra;
    }
  }
  const ultima = (de: number, ate: number): string => deTras(de, ate).next().value?.[1] ?? "";
  return {
    apresenta: (de: number, ate: number): boolean => APRESENTA.test(ultima(de, ate).trimEnd().slice(-FIM_QUE_APRESENTA)),
    emCitacao: (de: number, ate: number): boolean => CITACAO.test(ultima(de, ate)),
    /**
     * O bloco termina numa lista: subindo, passa pelas linhas recuadas (continuação, sublista) e pelos blocos de código
     * (o passo a passo "1. Instale:" + cerca + "2. Rode:"), e a primeira linha de prosa sem recuo é um item.
     */
    listaNoTrecho: (de: number, desde: number, ate: number): boolean | null => {
      for (const [inicio, linha] of deTras(Math.max(de, desde), ate)) {
        if (emCodigo(inicio)) continue;
        if (ITEM_DE_LISTA.test(linha)) return true;
        if (!ehContinuacao(linha)) return false;
      }
      return null;
    },
    temTitulo: (de: number, ate: number): boolean => {
      for (const [inicio, linha] of deTras(de, ate)) if (!emCodigo(inicio) && TITULO.test(linha)) return true;
      return false;
    },
  };
}
