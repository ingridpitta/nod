/**
 * NOD-468: o texto que a pessoa lê na tarefa aberta fica parado quando o conteúdo acima dele muda de altura (o log do
 * trabalho, a descrição relida, um bloco que abre). A rolagem guardada (rolagem-guardada.ts, alvo-de-rolagem.ts) é um
 * número: o mesmo scrollTop, com 20–85 px a mais ou a menos acima, mostra outro texto. O `overflow-anchor` do navegador
 * não ajuda porque o innerHTML recria os nós a cada desenho (e o Safari não o tem).
 *
 * Aqui a âncora é de conteúdo: antes de regravar, o bloco com chave estável que a pessoa lê no topo da caixa e a
 * distância dele ao topo da vista; depois, o mesmo bloco (pela chave) e o scrollTop que o deixa à mesma distância. Quem
 * está colada no fim não usa âncora (segue o fim, ADA-12 revisão 3); quem chama decide.
 *
 * As posições vêm do layout (offsetTop/offsetHeight), não do getBoundingClientRect: no Chrome com toque (medido em
 * 2026-11-11 a 390 px) o retângulo lido logo depois de escrever o scrollTop no mesmo desenho ainda era o de antes, e a
 * compensação contava a escrita da rolagem guardada como se fosse conteúdo que mudou (−47 px em vez de 0).
 *
 * Só no desenho (ADR-061: o caminho do scroll não busca no DOM).
 */

/** Os blocos que servem de âncora: a chave é o `data-ancora` ou o `id` (o comentário, a descrição, o trabalho). */
export const SELETOR_DE_ANCORAS = "[data-ancora], [id]:not(textarea):not(input):not(select)";

export type Ancora = { readonly chave: string; readonly desvio: number };

/** O pedaço do HTMLElement que a âncora lê. */
export type Caixa = { offsetTop: number; offsetParent: unknown; clientTop: number; scrollTop: number; clientHeight: number };
export type Bloco = { offsetTop: number; offsetParent: unknown; offsetHeight: number; id?: string; getAttribute(n: string): string | null; contains(outro: unknown): boolean };
type Conteudo<B extends Bloco> = { querySelectorAll(sel: string): ArrayLike<B> };
type ComOffset = { offsetTop: number; offsetParent: unknown };

function chaveDe(b: Bloco): string | null {
  const a = b.getAttribute("data-ancora");
  if (a) return `a:${a}`;
  const id = b.id ?? b.getAttribute("id");
  return id ? `i:${id}` : null;
}

/** O topo do elemento no documento pela cadeia de offsetParent (o layout, sem a rolagem de ninguém). */
function topoNoLayout(e: ComOffset): number {
  let y = 0;
  let atual: ComOffset | null = e;
  for (let i = 0; atual && i < 64; i++) { y += atual.offsetTop; atual = (atual.offsetParent as ComOffset | null) ?? null; }
  return y;
}

/** O topo do bloco dentro do conteúdo que rola na caixa (0 = o começo do que rola). */
export function topoNaCaixa(b: ComOffset, caixa: Caixa): number {
  return topoNoLayout(b) - topoNoLayout(caixa) - caixa.clientTop;
}

/**
 * O bloco que segura a leitura, como o scroll anchoring do Chrome escolhe: o primeiro bloco com chave, na ordem do
 * documento, que aparece na caixa; e, dentro dele, o primeiro que aparece, até o mais interno. Quem cruza o topo é o que
 * a pessoa lê: crescer embaixo do lido (o fim da descrição relida) não mexe nele. QA de 2026-11-11: a regra de antes
 * ("o que começa no topo ou abaixo dele") segurava o bloco de baixo e levava o texto lido para cima o tanto que a
 * descrição cresceu (390: −105 px). A ordem do documento também deixa a coluna do lado (que vem depois) fora da escolha
 * quando o meio aparece. Sem bloco à vista, sem âncora.
 * A chave repetida (o mesmo id em duas formas) não serve: depois não se sabe qual é o mesmo bloco.
 */
export function acharAncora<B extends Bloco>(caixa: Caixa, conteudo: Conteudo<B>): Ancora | null {
  const topo = caixa.scrollTop;
  const fundo = topo + caixa.clientHeight;
  const blocos = conteudo.querySelectorAll(SELETOR_DE_ANCORAS);
  const contagem = new Map<string, number>();
  const chaves: (string | null)[] = [];
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    const k = b ? chaveDe(b) : null;
    chaves.push(k);
    if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  let escolhido: { b: B; chave: string; y: number } | null = null;
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    const k = chaves[i];
    if (!b || !k || contagem.get(k) !== 1) continue;
    // Na ordem do documento, o primeiro que vem depois do escolhido e não está dentro dele já é outro bloco (mais
    // embaixo ou ao lado): ninguém depois dele está dentro do escolhido.
    if (escolhido && !escolhido.b.contains(b)) break;
    if (b.offsetHeight <= 0 || !b.offsetParent) continue;
    const y = topoNaCaixa(b, caixa);
    if (y + b.offsetHeight <= topo || y >= fundo) continue;
    escolhido = { b, chave: k, y };
  }
  return escolhido ? { chave: escolhido.chave, desvio: escolhido.y - topo } : null;
}

/** O scrollTop que põe a âncora à mesma distância do topo da vista; null se ela sumiu (ou não é mais única). */
export function topoPelaAncora<B extends Bloco>(ancora: Ancora, caixa: Caixa, conteudo: Conteudo<B>): number | null {
  const blocos = conteudo.querySelectorAll(SELETOR_DE_ANCORAS);
  let achado: B | null = null;
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    if (!b || chaveDe(b) !== ancora.chave) continue;
    if (achado) return null;
    achado = b;
  }
  if (!achado || achado.offsetHeight <= 0 || !achado.offsetParent) return null;
  return topoNaCaixa(achado, caixa) - ancora.desvio;
}
