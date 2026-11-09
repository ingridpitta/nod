/**
 * As listas de ordem das IAs (definido em 2026-10-10, plano das IAs, PR 3): a de Provedores de IA (a ordem da pessoa) e a
 * da 2B (a ordem do bot). Arrasta-se pela alça (`[data-alca-ordem]`) dentro da lista (`[data-ordem-lista]`), entre os
 * itens (`[data-ordem-item]`). Por eventos de ponteiro, não pelo drag-and-drop do HTML: o do HTML não funciona com o dedo
 * no Safari do iPhone, e a mesma alça vale para mouse e toque (ADR-094). Pelo teclado, as setas para cima e para baixo na
 * alça movem um lugar. A lista só é regravada pelo render, depois de `aoSoltar`.
 */

import { ordemArrastada, ordemComPasso } from "./ordem.ts";

const itensDa = (lista: Element): HTMLElement[] => [...lista.querySelectorAll<HTMLElement>("[data-ordem-item]")];
const idsDa = (lista: Element): string[] => itensDa(lista).map((el) => el.dataset.ordemItem ?? "");

export function instalarOrdemArrastavel(raiz: Document, aoSoltar: (lista: string, ordem: string[]) => void): void {
  let arrasto: { lista: HTMLElement; item: HTMLElement; alvo: HTMLElement | null; id: number } | null = null;

  const limpar = () => {
    if (!arrasto) return;
    arrasto.item.classList.remove("arrastando");
    arrasto.alvo?.classList.remove("alvo");
    arrasto = null;
  };

  raiz.addEventListener("pointerdown", (ev) => {
    const alca = (ev.target as HTMLElement).closest<HTMLElement>("[data-alca-ordem]");
    const item = alca?.closest<HTMLElement>("[data-ordem-item]");
    const lista = item?.closest<HTMLElement>("[data-ordem-lista]");
    if (!alca || !item || !lista || ev.button !== 0) return;
    ev.preventDefault();
    alca.setPointerCapture?.(ev.pointerId);
    item.classList.add("arrastando");
    arrasto = { lista, item, alvo: null, id: ev.pointerId };
  });

  raiz.addEventListener("pointermove", (ev) => {
    if (!arrasto || ev.pointerId !== arrasto.id) return;
    // O item sob o ponteiro, pela altura: a alça capturou o ponteiro, então o alvo do evento é sempre ela.
    const sob = itensDa(arrasto.lista).find((el) => { const r = el.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY <= r.bottom; }) ?? null;
    const alvo = sob === arrasto.item ? null : sob;
    if (alvo === arrasto.alvo) return;
    arrasto.alvo?.classList.remove("alvo");
    alvo?.classList.add("alvo");
    arrasto.alvo = alvo;
  });

  const soltar = (ev: PointerEvent) => {
    if (!arrasto || ev.pointerId !== arrasto.id) return;
    const { lista, item, alvo } = arrasto;
    limpar();
    if (!alvo) return;
    const ordem = ordemArrastada(idsDa(lista), item.dataset.ordemItem ?? "", alvo.dataset.ordemItem ?? "");
    aoSoltar(lista.dataset.ordemLista ?? "", ordem);
  };
  raiz.addEventListener("pointerup", soltar);
  raiz.addEventListener("pointercancel", () => limpar());

  raiz.addEventListener("keydown", (ev) => {
    const alca = (ev.target as HTMLElement).closest?.<HTMLElement>("[data-alca-ordem]");
    if (!alca || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
    const item = alca.closest<HTMLElement>("[data-ordem-item]");
    const lista = item?.closest<HTMLElement>("[data-ordem-lista]");
    if (!item || !lista) return;
    ev.preventDefault();
    const id = item.dataset.ordemItem ?? "";
    aoSoltar(lista.dataset.ordemLista ?? "", ordemComPasso(idsDa(lista), id, ev.key === "ArrowUp" ? -1 : 1));
    // A lista é regravada: a alça do mesmo item volta a ter o foco, para a pessoa seguir com as setas.
    queueMicrotask(() => raiz.querySelector<HTMLElement>(`[data-ordem-lista="${lista.dataset.ordemLista ?? ""}"] [data-ordem-item="${id}"] [data-alca-ordem]`)?.focus());
  });
}
