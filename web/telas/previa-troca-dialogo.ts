import { htmlDaPreviaDaTroca } from "./inteligencia.ts";

/**
 * ADR-108 (R5, canvas D1): a prévia ao trocar a IA de um bot com tasks em andamento. true = "Levar as tasks também";
 * false = "Só daqui em diante" (o padrão, com o foco); null = fechou sem escolher (Esc): nada é gravado.
 */
export function abrirPreviaDaTroca(p: { nomeDoBot: string; destino: string; tasks: number }): Promise<boolean | null> {
  return new Promise((resolver) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bot-dialogo";
    dialog.setAttribute("aria-labelledby", "previa-troca-titulo");
    dialog.innerHTML = htmlDaPreviaDaTroca(p);
    document.body.append(dialog);
    let escolha: boolean | null = null;
    dialog.addEventListener("close", () => { dialog.remove(); resolver(escolha); }, { once: true });
    dialog.querySelector("[data-levar]")!.addEventListener("click", () => { escolha = true; dialog.close(); });
    dialog.querySelector("[data-so-daqui]")!.addEventListener("click", () => { escolha = false; dialog.close(); });
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-so-daqui]")!.focus();
  });
}
