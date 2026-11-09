/**
 * Sobreposição modal em <dialog> (NOD-56, extraída na NOD-327): o mecanismo comum da captura ampliada e da prévia de
 * arquivo. Esc fecha (nativo do <dialog>), o clique no fundo fecha, clicar dentro não fecha, arrastar de dentro para
 * fora não fecha, e ao fechar o foco volta a quem abriu — ou, se a conversa re-renderizou com o dialog aberto, ao
 * elemento novo equivalente (`reencontrar`).
 */
export type OpcoesSobreposicao = {
  /** A classe do <dialog>; também serve para fechar a sobreposição anterior da mesma classe antes de abrir outra. */
  classe: string;
  rotulo: string;
  html: string;
  /** Quem abriu: recebe o foco de volta ao fechar. */
  origem: HTMLElement;
  /** Seletor do elemento novo equivalente à origem, se ela saiu do DOM (re-render da conversa). */
  reencontrar?: () => HTMLElement | null;
  /** Seletor de quem fecha ao ser clicado (o ×, o Fechar). Também recebe o foco ao abrir. */
  seletorFechar: string;
  /** Chamado quando o dialog fecha, antes de sair do DOM (cancelar um carregamento, por exemplo). */
  aoFechar?: () => void;
};

export function abrirSobreposicao(o: OpcoesSobreposicao): HTMLDialogElement {
  document.querySelector<HTMLDialogElement>(`dialog.${CSS.escape(o.classe)}`)?.close();
  const dialog = document.createElement("dialog");
  dialog.className = o.classe;
  dialog.setAttribute("aria-label", o.rotulo);
  dialog.innerHTML = o.html;
  // O clique no backdrop chega com o alvo no próprio <dialog> (o conteúdo fica num filho que o cobre). Exige que o
  // pressionar também tenha sido no fundo: arrastar de dentro para fora não fecha.
  let pressionouNoFundo = false;
  dialog.addEventListener("pointerdown", (ev) => { pressionouNoFundo = ev.target === dialog; });
  dialog.addEventListener("click", (ev) => {
    const alvo = ev.target as HTMLElement;
    if ((alvo === dialog && pressionouNoFundo) || alvo.closest(o.seletorFechar)) dialog.close();
  });
  dialog.addEventListener("close", () => {
    o.aoFechar?.();
    dialog.remove();
    // Outro da mesma classe já abriu no lugar (duplo clique em outro card): o foco é dele, não volta à origem velha.
    if (document.querySelector(`dialog.${CSS.escape(o.classe)}[open]`)) return;
    const alvo = o.origem.isConnected ? o.origem : o.reencontrar?.() ?? null;
    alvo?.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLElement>(o.seletorFechar)?.focus({ preventScroll: true });
  return dialog;
}
