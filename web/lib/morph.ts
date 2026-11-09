/**
 * NOD-348 (emenda da ADR-114): o morph da fala viva, puro e sem DOM (o tsconfig do servidor, que checa os testes, não tem
 * `lib: dom`); `regiaoPorBlocos` (web/lib/regioes.ts) o usa com o DOM de verdade.
 */
/**
 * O bloco que se atualiza no lugar (NOD-348, a fala viva; emenda da ADR-114): a classe da raiz, os atributos do mascote
 * (null = sem mascote) e as partes, filhas do `.bubble-wrap`, cada uma com `data-parte`. Com `morfar`, o bloco cujo HTML
 * mudou não é recriado: a raiz e o `<nod-mascote>` ficam (a animação não reinicia), o mascote recebe os atributos novos,
 * e só as partes que mudaram são trocadas.
 */
export type Morph = { raiz: string; mascote: Record<string, string> | null; partes: readonly { chave: string; html: string }[] };

/** O que o morph faz: a classe nova da raiz (null = igual), os atributos do mascote, e as partes na ordem nova (`html` null = fica o nó). */
export type PlanoDoMorph = {
  raiz: string | null;
  mascote: { definir: Record<string, string>; remover: string[] };
  partes: { chave: string; html: string | null }[];
};

/**
 * Puro: o plano para levar a fala de `antes` a `depois`, ou null quando não dá para morfar (um dos dois sem morph, ou o
 * mascote que aparece ou some — a estrutura mudou, e o bloco é recriado como sempre). Chave de parte repetida também recria.
 */
export function planoDoMorph(antes: Morph | undefined, depois: Morph | undefined): PlanoDoMorph | null {
  if (!antes || !depois) return null;
  if ((antes.mascote === null) !== (depois.mascote === null)) return null;
  const chaves = depois.partes.map((p) => p.chave);
  if (new Set(chaves).size !== chaves.length) return null;
  const velhas = new Map(antes.partes.map((p) => [p.chave, p.html]));
  const de = antes.mascote ?? {};
  const para = depois.mascote ?? {};
  return {
    raiz: antes.raiz === depois.raiz ? null : depois.raiz,
    mascote: {
      definir: Object.fromEntries(Object.entries(para).filter(([k, v]) => de[k] !== v)),
      remover: Object.keys(de).filter((k) => !(k in para)),
    },
    partes: depois.partes.map((p) => ({ chave: p.chave, html: velhas.get(p.chave) === p.html ? null : p.html })),
  };
}

export type DecisaoDoBloco = { tipo: "manter" } | { tipo: "morfar"; plano: PlanoDoMorph } | { tipo: "recriar" };

/**
 * Puro, o que `regiaoPorBlocos` faz com cada bloco: o mesmo HTML fica; o que mudou e tem morph nos dois lados morfa;
 * o resto é recriado (bloco novo, chave repetida, sem morph). `semMorph` (localStorage `nod.semMorph=1`) força a
 * recriação — a medida de comparação do gatilho da ADR-114.
 */
export function decidirBloco(antes: { html: string; morfar?: Morph } | undefined, depois: { html: string; morfar?: Morph }, semMorph = false): DecisaoDoBloco {
  if (!antes) return { tipo: "recriar" };
  if (antes.html === depois.html) return { tipo: "manter" };
  const plano = semMorph ? null : planoDoMorph(antes.morfar, depois.morfar);
  return plano ? { tipo: "morfar", plano } : { tipo: "recriar" };
}

/** O mínimo do DOM que o aplicador usa (os testes não têm DOM; ver tests/unit/web/morph-da-fala.test.ts). */
export type NoDoMorph = {
  className: string;
  readonly firstElementChild: NoDoMorph | null;
  readonly nextElementSibling: NoDoMorph | null;
  readonly parentNode: unknown;
  readonly childNodes: ArrayLike<unknown> & Iterable<unknown>;
  getAttribute(nome: string): string | null;
  getAttributeNames(): string[];
  setAttribute(nome: string, valor: string): void;
  removeAttribute(nome: string): void;
  replaceChildren(...nos: never[]): void;
  querySelector(seletor: string): NoDoMorph | null;
  insertBefore(no: NoDoMorph, antes: NoDoMorph | null): unknown;
  remove(): void;
};

/**
 * Aplica o plano no bloco que já está na tela. false = a fala na tela não tem a forma esperada (raiz `[data-morfar]`,
 * `.bubble-wrap` e o mascote quando o plano tem um): quem chama recria o bloco, o caminho de antes.
 */
export function aplicarMorph(bloco: NoDoMorph, plano: PlanoDoMorph, criar: (html: string) => NoDoMorph | null): boolean {
  const raiz = bloco.firstElementChild;
  if (!raiz || raiz.getAttribute("data-morfar") === null) return false;
  const wrap = raiz.querySelector(":scope > .bubble-wrap");
  if (!wrap) return false;
  const temMascote = Object.keys(plano.mascote.definir).length + plano.mascote.remover.length > 0;
  const mascote = raiz.querySelector(':scope > [data-parte="mascote"]');
  if (temMascote && !mascote) return false;
  const naTela = new Map<string, NoDoMorph>();
  for (let no = wrap.firstElementChild; no; no = no.nextElementSibling) {
    const chave = no.getAttribute("data-parte");
    if (chave !== null && !naTela.has(chave)) naTela.set(chave, no);
  }
  const novos: NoDoMorph[] = [];
  const noLugar: [NoDoMorph, NoDoMorph][] = [];
  for (const p of plano.partes) {
    const ficou = p.html === null ? naTela.get(p.chave) : undefined;
    const no = ficou ?? criar(p.html ?? "");
    if (!no) return false;
    // NOD-358 (revisão 2 do PR #522): a parte `data-no-lugar` (o balão que cresce) muda por dentro e o nó fica, para a
    // animação de entrada (`.balao-entra`) não ser cortada no meio por um nó novo a cada pedaço do streaming.
    const velho = ficou ? undefined : naTela.get(p.chave);
    if (velho && velho.getAttribute("data-no-lugar") !== null && no.getAttribute("data-no-lugar") !== null) {
      noLugar.push([velho, no]);
      novos.push(velho);
    } else novos.push(no);
  }
  // Daqui para baixo a tela muda: tudo o que podia falhar já foi conferido.
  if (plano.raiz !== null) raiz.className = plano.raiz;
  for (const [velho, novo] of noLugar) trocarConteudo(velho, novo);
  if (mascote) {
    for (const [k, v] of Object.entries(plano.mascote.definir)) mascote.setAttribute(k, v);
    for (const k of plano.mascote.remover) mascote.removeAttribute(k);
  }
  const ficam = new Set(novos);
  const sobram: NoDoMorph[] = [];
  for (let no = wrap.firstElementChild; no; no = no.nextElementSibling) if (!ficam.has(no)) sobram.push(no);
  for (const no of sobram) no.remove();
  let cursor = wrap.firstElementChild;
  for (const no of novos) {
    if (no === cursor) cursor = cursor.nextElementSibling;
    else wrap.insertBefore(no, cursor);
  }
  return true;
}

/** NOD-358: a parte `data-no-lugar` recebe os atributos e os filhos da nova, e o nó (com a animação em curso) fica. */
export function trocarConteudo(velho: NoDoMorph, novo: NoDoMorph): void {
  // Parte 2 do plano "o pensamento no chat": o `open` de um <details> é da pessoa (abriu ou fechou o pensamento), nunca
  // do HTML novo — o render não o escreve, e tirá-lo fecharia o pensamento a cada pedaço do streaming.
  for (const nome of velho.getAttributeNames()) if (nome !== "open" && novo.getAttribute(nome) === null) velho.removeAttribute(nome);
  for (const nome of novo.getAttributeNames()) {
    const valor = novo.getAttribute(nome) ?? "";
    if (velho.getAttribute(nome) !== valor) velho.setAttribute(nome, valor);
  }
  velho.replaceChildren(...([...novo.childNodes] as never[]));
}
