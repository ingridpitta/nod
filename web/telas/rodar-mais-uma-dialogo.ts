import { htmlRodarMaisUma } from "../lib/executar-rotina.ts";

/**
 * definido em 2026-10-16 (revisão do Gil no #335, A1): abre a pergunta do "Testar agora" (`htmlRodarMaisUma`).
 * true = "Rodar mais uma"; Esc, Cancelar e clique fora = false. Ao fechar, o foco volta para quem abriu.
 */
export function abrirRodarMaisUma(pergunta: string, origem?: HTMLElement | null): Promise<boolean> {
  return new Promise((resolver) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bot-dialogo";
    dialog.setAttribute("aria-labelledby", "rodar-mais-uma-titulo");
    dialog.innerHTML = htmlRodarMaisUma(pergunta);
    document.body.append(dialog);
    let sim = false;
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (origem?.isConnected) origem.focus({ preventScroll: true });
      resolver(sim);
    }, { once: true });
    dialog.querySelector("[data-sim]")!.addEventListener("click", () => { sim = true; dialog.close(); });
    dialog.querySelector("[data-nao]")!.addEventListener("click", () => dialog.close());
    // Clique no fundo (fora da caixa): o alvo é o próprio <dialog>.
    dialog.addEventListener("click", (ev) => { if (ev.target === dialog) dialog.close(); });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-nao]")!.focus();
  });
}
