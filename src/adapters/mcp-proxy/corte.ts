/**
 * Corte do resultado ao orçamento ANTES de entrar no contexto (ADR-013, quarta responsabilidade).
 * O corte é visível: a marca diz quanto ficou de fora, para o modelo não inventar o resto. Nunca corta
 * entre os dois code units de um par substituto (surrogate): recua um.
 *
 * definido em 2026-09-24: a marca também diz o que fazer. A Nina chamou GMAIL_FETCH_EMAILS com o
 * corpo HTML completo; 10 e-mails deram 956.210 bytes e os 8.000 caracteres que sobraram mal cobriam
 * o <head> do primeiro. Sem a dica, o modelo trabalha com o pedaço em vez de refazer pedindo menos.
 *
 * definido em 2026-09-28: o orçamento passa a ser o do Claude Code no terminal (constantes.ts) e o corte
 * deixa de perder dado. JSON é compactado sem perda antes de qualquer corte; o que ainda não cabe é
 * cortado por ITENS inteiros da maior lista (o ClickUp da Ada caía no meio de uma task); e o resto fica
 * guardado para `ler_mais` — o equivalente do arquivo em que o terminal salva a resposta grande.
 */
export type ResultadoCorte = { texto: string; cortado: boolean; original: number };

/** O que ficou de fora de uma resposta cortada, guardado pelo proxy durante o turno para `ler_mais`. */
export type Resto =
  | { tipo: "itens"; raiz: unknown; caminho: readonly (string | number)[]; itens: readonly unknown[]; desde: number; original: number; paginacao: string }
  | { tipo: "texto"; texto: string; desde: number; original: number };

export type ResultadoCorteResposta = ResultadoCorte & { resto: Resto | null };

/** Espaço reservado à marca: o texto entregue (conteúdo + marca) nunca passa do orçamento. */
const RESERVA_MARCA = 400;
/** A lista cortada por itens é procurada até esta profundidade (data.tasks, response.data.items…). */
const PROFUNDIDADE_LISTA = 4;
const CHAVES_PAGINACAO = /^(page|next_?page|next_?cursor|cursor|next_?page_?token|has_?more|last_?page|total|total_?count|offset|limit)$/i;

/** Corte só por caracteres, com a marca antiga. Usado onde não há `ler_mais` (gh na máquina fora do proxy). */
export function cortar(texto: string, orcamentoChars: number): ResultadoCorte {
  const original = texto.length;
  const orcamento = Math.max(0, Math.floor(orcamentoChars));
  if (original <= orcamento) return { texto, cortado: false, original };
  const fim = semPartirPar(texto, orcamento);
  return {
    texto: `${texto.slice(0, fim)}\n[cortado pelo nod: ${original - fim} de ${original} caracteres ficaram de fora; limite por resposta de ferramenta = ${orcamento}. Se precisa do resto, refaça a chamada pedindo menos itens ou só metadados]`,
    cortado: true,
    original,
  };
}

/**
 * Resposta de ferramenta que vai ao modelo: intacta se cabe; JSON compactado sem perda se assim cabe;
 * senão os primeiros itens inteiros da maior lista (ou os primeiros caracteres), com uma marca que diz
 * quanto faltou e o `ref` para `ler_mais`.
 */
export function cortarResposta(texto: string, orcamentoChars: number, ref: string): ResultadoCorteResposta {
  const original = texto.length;
  const orcamento = Math.max(0, Math.floor(orcamentoChars));
  if (original <= orcamento) return { texto, cortado: false, original, resto: null };
  const valor = jsonDe(texto);
  if (valor !== undefined) {
    const enxuto = enxugar(valor);
    const compacto = JSON.stringify(enxuto);
    // Só espaçamento e campos vazios saíram: nenhuma informação perdida, nenhuma marca.
    if (compacto.length <= orcamento) return { texto: compacto, cortado: false, original, resto: null };
    const lista = maiorLista(enxuto);
    if (lista) {
      const r = fatiar({ tipo: "itens", raiz: enxuto, caminho: lista.caminho, itens: lista.itens, desde: 0, original, paginacao: paginacaoDe(enxuto, lista.caminho) }, orcamento, ref);
      if (r) return { texto: r.texto, cortado: true, original, resto: r.resto };
    }
    const r = fatiarTexto({ tipo: "texto", texto: compacto, desde: 0, original }, orcamento, ref);
    return { texto: r.texto, cortado: true, original, resto: r.resto };
  }
  const r = fatiarTexto({ tipo: "texto", texto, desde: 0, original }, orcamento, ref);
  return { texto: r.texto, cortado: true, original, resto: r.resto };
}

/** A próxima parte de um resto guardado; `resto` null quando esta foi a última. */
export function continuarResposta(resto: Resto, orcamentoChars: number, ref: string): { texto: string; resto: Resto | null } {
  const orcamento = Math.max(0, Math.floor(orcamentoChars));
  if (resto.tipo === "texto") return fatiarTexto(resto, orcamento, ref);
  const r = fatiar(resto, orcamento, ref);
  if (r) return r;
  // Um item sozinho não cabe: o que falta da lista segue como texto, em partes, sem perder nada.
  return fatiarTexto({ tipo: "texto", texto: JSON.stringify(resto.itens.slice(resto.desde)), desde: 0, original: resto.original }, orcamento, ref);
}

function fatiar(resto: Extract<Resto, { tipo: "itens" }>, orcamento: number, ref: string): { texto: string; resto: Resto | null } | null {
  const total = resto.itens.length;
  const disponiveis = total - resto.desde;
  const montar = (k: number) => JSON.stringify(substituir(resto.raiz, resto.caminho, resto.itens.slice(resto.desde, resto.desde + k)));
  const cabe = (k: number) => montar(k).length <= orcamento - RESERVA_MARCA;
  if (disponiveis <= 0 || !cabe(1)) return null;
  // O tamanho cresce com k: a maior quantidade que cabe sai por busca binária.
  let lo = 1;
  let hi = disponiveis;
  while (lo < hi) {
    const meio = Math.ceil((lo + hi) / 2);
    if (cabe(meio)) lo = meio;
    else hi = meio - 1;
  }
  const ate = resto.desde + lo;
  const faltam = total - ate;
  const onde = resto.caminho.length ? resto.caminho.join(".") : "raiz";
  const proximo = faltam > 0 ? ` Para os próximos ${faltam}, chame ler_mais com ref="${ref}".` : " Estes são os últimos.";
  const pagina = resto.paginacao ? ` A fonte também pagina (${resto.paginacao}): pode haver mais páginas além destes ${total}.` : "";
  const marca = `\n[nod: mostrando os itens ${resto.desde + 1}–${ate} de ${total} em "${onde}" (resposta original: ${resto.original} caracteres).${proximo}${pagina}]`;
  return { texto: montar(lo) + marca, resto: faltam > 0 ? { ...resto, desde: ate } : null };
}

function fatiarTexto(resto: Extract<Resto, { tipo: "texto" }>, orcamento: number, ref: string): { texto: string; resto: Resto | null } {
  const total = resto.texto.length;
  const tamanho = Math.max(1, orcamento - RESERVA_MARCA);
  const fim = Math.min(total, resto.desde + semPartirPar(resto.texto.slice(resto.desde), tamanho));
  const faltam = total - fim;
  const origem = resto.original !== total ? ` (resposta original: ${resto.original} caracteres)` : "";
  const proximo = faltam > 0 ? ` Para o resto, chame ler_mais com ref="${ref}", ou refaça a chamada pedindo menos itens ou só metadados.` : " Esta é a última parte.";
  const marca = `\n[nod: mostrando os caracteres ${resto.desde + 1}–${fim} de ${total}${origem}; limite por resposta de ferramenta = ${orcamento}.${proximo}]`;
  return { texto: resto.texto.slice(resto.desde, fim) + marca, resto: faltam > 0 ? { ...resto, desde: fim } : null };
}

/** Quantos code units cabem em `limite` sem partir um par substituto. */
function semPartirPar(texto: string, limite: number): number {
  let fim = Math.min(texto.length, Math.max(0, limite));
  const c = fim > 0 && fim < texto.length ? texto.charCodeAt(fim - 1) : 0;
  if (c >= 0xd800 && c <= 0xdbff) fim -= 1;
  return fim;
}

function jsonDe(texto: string): unknown {
  const t = texto.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return undefined;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return undefined;
  }
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const vazio = (v: unknown) => v === null || v === "" || (Array.isArray(v) && v.length === 0) || (ehObjeto(v) && Object.keys(v).length === 0);

/** Tira campos null, "", [] e {} de objetos (em listas a posição importa: os elementos ficam). */
function enxugar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(enxugar);
  if (!ehObjeto(v)) return v;
  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(v)) {
    const e = enxugar(valor);
    if (!vazio(e)) saida[chave] = e;
  }
  return saida;
}

/** A lista (≥ 2 itens) que mais pesa na resposta, até PROFUNDIDADE_LISTA. */
function maiorLista(raiz: unknown): { caminho: (string | number)[]; itens: unknown[] } | null {
  let melhor: { caminho: (string | number)[]; itens: unknown[]; tamanho: number } | null = null;
  const visitar = (v: unknown, caminho: (string | number)[], profundidade: number) => {
    if (profundidade > PROFUNDIDADE_LISTA) return;
    if (Array.isArray(v)) {
      if (v.length >= 2) {
        const tamanho = JSON.stringify(v).length;
        if (!melhor || tamanho > melhor.tamanho) melhor = { caminho, itens: v, tamanho };
      }
      v.forEach((x, i) => visitar(x, [...caminho, i], profundidade + 1));
      return;
    }
    if (ehObjeto(v)) for (const [chave, x] of Object.entries(v)) visitar(x, [...caminho, chave], profundidade + 1);
  };
  visitar(raiz, [], 0);
  const achada = melhor as { caminho: (string | number)[]; itens: unknown[] } | null;
  return achada ? { caminho: achada.caminho, itens: achada.itens } : null;
}

function substituir(raiz: unknown, caminho: readonly (string | number)[], valor: unknown): unknown {
  if (caminho.length === 0) return valor;
  const [cabeca, ...cauda] = caminho;
  if (Array.isArray(raiz) && typeof cabeca === "number") return raiz.map((x, i) => (i === cabeca ? substituir(x, cauda, valor) : x));
  if (ehObjeto(raiz) && typeof cabeca === "string") return { ...raiz, [cabeca]: substituir(raiz[cabeca], cauda, valor) };
  return raiz;
}

/** Chaves de paginação (valores simples) na raiz e nos objetos do caminho até a lista: "page=0, last_page=false". */
function paginacaoDe(raiz: unknown, caminho: readonly (string | number)[]): string {
  const achadas: string[] = [];
  let atual: unknown = raiz;
  for (let i = 0; i <= caminho.length; i++) {
    if (ehObjeto(atual)) {
      for (const [chave, valor] of Object.entries(atual)) {
        if (CHAVES_PAGINACAO.test(chave) && ["string", "number", "boolean"].includes(typeof valor)) achadas.push(`${chave}=${String(valor)}`);
      }
    }
    const passo = caminho[i];
    if (passo === undefined) break;
    atual = Array.isArray(atual) && typeof passo === "number" ? atual[passo] : ehObjeto(atual) && typeof passo === "string" ? atual[passo] : undefined;
  }
  return achadas.slice(0, 5).join(", ");
}
