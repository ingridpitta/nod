/**
 * O foco depois de responder em "Sua vez" (definido em 2026-10-18, QA do PR #389). O item respondido sai da lista quando a
 * fila é relida, e o foco caía no `body`: quem navega por teclado ou leitor de tela voltava ao topo do documento. Agora
 * o foco vai para o próximo item da fila (o de baixo; sem ele, o de cima) e, com a fila vazia, para o título "Sua vez".
 *
 * A web só pede e redesenha (AGENTS.md): o clique guarda o pedido, e cada desenho da tela tenta cumpri-lo. Enquanto o item
 * respondido ainda está na tela (a fila não voltou), espera; se a pessoa já pôs o foco noutro lugar, não rouba.
 */

/** Quanto tempo o pedido vale: a fila relida chega em centenas de ms; depois disso o foco já não é "logo depois". */
export const VALIDADE_DO_FOCO_MS = 10_000;

export type FocoDaFila = { respondida: string; proximo: string | null; ate: number };

/** O item que recebe o foco quando `respondida` sair: o de baixo, senão o de cima, senão nenhum (vai ao título). */
export function proximoDaFila(ids: readonly string[], respondida: string): string | null {
  const i = ids.indexOf(respondida);
  if (i < 0) return null;
  return ids[i + 1] ?? ids[i - 1] ?? null;
}

type Focavel = { focus(): void; hasAttribute(nome: string): boolean; setAttribute(nome: string, valor: string): void };
/** O pedaço do `document` que isto usa (os testes passam um falso). */
export type DocumentoDoFoco = { querySelector(seletor: string): Focavel | null; activeElement: unknown; body: unknown };

/** Os ids vêm do servidor (uuid): fora disso, nenhum seletor é montado. */
const ID_SEGURO = /^[\w-]+$/;

/**
 * Tenta cumprir o pedido. "esperando" = o item respondido ainda está na tela (tente no próximo desenho); "feito" = o foco
 * foi posto, ou o pedido caducou (vencido, outra tela, foco já noutro lugar).
 */
export function aplicarFocoDaFila(doc: DocumentoDoFoco, pedido: FocoDaFila, agora: number): "esperando" | "feito" {
  if (agora > pedido.ate || !ID_SEGURO.test(pedido.respondida)) return "feito";
  const tela = doc.querySelector(".tela-sua-vez");
  if (!tela) return "feito";
  if (doc.querySelector(`.tela-sua-vez [data-decisao="${pedido.respondida}"]`)) return "esperando";
  if (doc.activeElement && doc.activeElement !== doc.body) return "feito";
  const item = pedido.proximo && ID_SEGURO.test(pedido.proximo) ? doc.querySelector(`.tela-sua-vez li[data-decisao="${pedido.proximo}"]`) : null;
  const alvo = item ?? doc.querySelector(".tela-sua-vez h1");
  if (!alvo) return "feito";
  // O li e o h1 não são focáveis por natureza: tabindex -1 recebe o foco sem entrar na ordem do Tab.
  if (!alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
  alvo.focus();
  return "feito";
}

/**
 * O botão em foco que sobrevive ao redesenho (definido em 2026-10-18, QA do PR #389). "Sua vez" e a conversa são
 * regravadas a cada minuto ("há 10 min" vira "há 11 min") e a cada frame de outro bot; o botão em foco (a opção do
 * cartão, o ×, "Abrir conversa") saía do DOM e o foco caía no `body` no meio da navegação por teclado. Os campos de texto
 * já voltavam (main.ts, `respostas`); os botões voltam pela ação e pelos dados que os identificam.
 */
export type BotaoEmFoco = { act: string; id: string; texto: string };
type ComDados = { tagName: string; dataset: Record<string, string | undefined> };

export function botaoEmFoco(ativo: ComDados | null | undefined): BotaoEmFoco | null {
  if (!ativo || ativo.tagName !== "BUTTON" || !ativo.dataset.act) return null;
  return { act: ativo.dataset.act, id: ativo.dataset.id ?? "", texto: ativo.dataset.texto ?? "" };
}

/** O mesmo botão no desenho novo: mesma ação, mesmo `data-id` e, na opção, o mesmo texto. */
export function acharBotao<T extends ComDados>(botoes: Iterable<T>, b: BotaoEmFoco): T | null {
  for (const el of botoes) {
    if (el.dataset.act === b.act && (el.dataset.id ?? "") === b.id && (el.dataset.texto ?? "") === b.texto) return el;
  }
  return null;
}
