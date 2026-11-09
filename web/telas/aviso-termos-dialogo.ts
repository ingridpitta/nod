import type { IaDesktop } from "../../src/contracts/desktop.ts";
import { htmlDoAvisoDosTermos } from "./aviso-termos.ts";

/** Abre o aviso; true = "Ligar mesmo assim". Esc, Cancelar e fechar = false. */
export function abrirAvisoDosTermos(ia: IaDesktop): Promise<boolean> {
  return new Promise((resolver) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bot-dialogo";
    dialog.setAttribute("aria-labelledby", "aviso-termos-titulo");
    dialog.innerHTML = htmlDoAvisoDosTermos(ia);
    document.body.append(dialog);
    let sim = false;
    dialog.addEventListener("close", () => { dialog.remove(); resolver(sim); }, { once: true });
    dialog.querySelector("[data-sim]")!.addEventListener("click", () => { sim = true; dialog.close(); });
    dialog.querySelector("[data-nao]")!.addEventListener("click", () => dialog.close());
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-nao]")!.focus();
  });
}
