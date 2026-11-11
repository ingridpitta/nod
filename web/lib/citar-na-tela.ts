/**
 * 2026-11-10 (a issue do Multica, core/drafts/reply-annotation.ts): "Citar" um trecho na tarefa aberta. Selecionar texto
 * de um comentário (ou da descrição) mostra um botão flutuante discreto "Citar"; ele abre o campo de resposta da thread
 * (ou o campo do fim, para a descrição e os pedidos de quem participa) com "> Nome: trecho" no começo. A citação é a do
 * celular (web/telas/tarefa-celular.ts: `trechoDe`, `prefixoDaResposta`), que já vai no próprio texto do comentário.
 */
import { prefixoDaResposta, trechoDe } from "../telas/tarefa-celular.ts";

export type Citacao = { raiz: string | null; nome: string; trecho: string };

/** Onde se cita: o texto de um comentário da linha do tempo ou a descrição da tarefa aberta. */
const ALVO = "#quadro .qd-tarefa .ta-com-txt, #quadro .qd-tarefa .ta-desc, #quadro .qd-tarefa .qd-t-desc";

/**
 * O que citar a partir do nó onde a seleção está (puro sobre o DOM): a thread (o comentário raiz do `li.ta-th`), o nome
 * de quem escreveu e o trecho. null = fora de um alvo.
 */
export function citacaoDoNo(no: Node | null, texto: string): Citacao | null {
  // Sem `instanceof Element` (o nó de texto sobe ao pai): o teste passa um falso com closest/matches/querySelector.
  const el = no && "closest" in no ? (no as Element) : no?.parentElement ?? null;
  const alvo = el?.closest<HTMLElement>(ALVO);
  const trecho = trechoDe(texto);
  if (!alvo || !trecho) return null;
  if (alvo.matches(".ta-desc, .qd-t-desc")) return { raiz: null, nome: "Descrição", trecho };
  const com = alvo.closest<HTMLElement>(".ta-com");
  const nome = com?.querySelector(".ta-com-nome")?.textContent?.trim() || "Comentário";
  // A thread: o primeiro comentário do li.ta-th (a raiz). O pedido de quem participa não tem thread: vai ao campo do fim.
  const th = com?.closest<HTMLElement>("li.ta-th");
  const raiz = th && !th.classList.contains("ta-th-pedido") ? th.querySelector<HTMLElement>(":scope > .ta-com")?.id.replace(/^com-/, "") || null : null;
  return { raiz, nome, trecho };
}

/** O texto que entra no começo do campo: "> Nome: trecho" e a linha em branco. */
export const textoDaCitacao = (c: Pick<Citacao, "nome" | "trecho">): string => prefixoDaResposta(c);

/** Liga o botão flutuante ao documento. `aoCitar` abre o campo certo com a citação. */
export function ligarCitar(doc: Document, aoCitar: (c: Citacao) => void): void {
  let bt: HTMLButtonElement | null = null;
  let atual: Citacao | null = null;
  let quadro = 0;
  const esconder = (): void => { if (bt) bt.hidden = true; atual = null; };
  const mostrar = (): void => {
    const sel = doc.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { esconder(); return; }
    const r = sel.getRangeAt(0);
    const c = citacaoDoNo(r.commonAncestorContainer, sel.toString());
    if (!c) { esconder(); return; }
    const caixa = r.getBoundingClientRect();
    if (!bt || !bt.isConnected) {
      bt = doc.createElement("button");
      bt.type = "button";
      bt.className = "ta-citar";
      bt.textContent = "Citar";
      // Clicar não pode desfazer a seleção antes do clique chegar.
      bt.addEventListener("mousedown", (ev) => ev.preventDefault());
      bt.addEventListener("click", () => { const x = atual; esconder(); doc.getSelection?.()?.removeAllRanges(); if (x) aoCitar(x); });
      doc.body.appendChild(bt);
    }
    atual = c;
    bt.hidden = false;
    bt.style.top = `${Math.max(4, caixa.top - 34)}px`;
    bt.style.left = `${Math.max(4, caixa.left + caixa.width / 2 - 28)}px`;
  };
  doc.addEventListener("selectionchange", () => {
    const raf = doc.defaultView?.requestAnimationFrame;
    if (!raf) { mostrar(); return; }
    doc.defaultView?.cancelAnimationFrame(quadro);
    quadro = raf(mostrar);
  });
  doc.addEventListener("scroll", esconder, true);
}
