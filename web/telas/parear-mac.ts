import type { Api } from "../lib/api.ts";
import { urlDeRetorno, type PedidoPareamento } from "../lib/parear-mac.ts";
import { esc } from "../lib/render.ts";

/**
 * "Conectar este Mac?" (ADR-069). Diálogo próprio, fora das regiões que o render refaz: a pessoa
 * confirma, o nod abre o pedido e o navegador leva o código ao app pelo 127.0.0.1. Agora não = o app
 * continua esperando até o prazo e a pessoa pode tentar de novo por ele.
 */
export function abrirPareamento(api: Api, pedido: PedidoPareamento, esquecer: () => void): void {
  const dialog = document.createElement("dialog");
  dialog.className = "bot-dialogo";
  dialog.setAttribute("aria-labelledby", "parear-titulo");
  dialog.innerHTML = `<h2 id="parear-titulo">Conectar este Mac?</h2>
    <p>O app do nod em <b>${esc(pedido.nome)}</b> vai trabalhar pela sua conta: seus bots rodam nele, com o Claude Code ou o Codex desse Mac.</p>
    <p>Só confirme se foi você quem clicou em <b>Entrar com Google</b> no app agora.</p>
    <p data-estado class="dialogo-erro" role="status"></p>
    <div class="acoes"><button class="bt" data-nao type="button">Agora não</button> <button class="bt pri" data-sim type="button">Conectar este Mac</button></div>`;
  document.body.append(dialog);
  dialog.showModal();
  dialog.addEventListener("close", () => { esquecer(); dialog.remove(); }, { once: true });
  const sim = dialog.querySelector<HTMLButtonElement>("[data-sim]")!;
  dialog.querySelector("[data-nao]")!.addEventListener("click", () => dialog.close());
  sim.addEventListener("click", async () => {
    sim.disabled = true;
    try {
      const { codigo } = await api.parearMac(pedido.nome, pedido.desafio);
      esquecer();
      window.location.href = urlDeRetorno(pedido, codigo);
    } catch {
      sim.disabled = false;
      dialog.querySelector("[data-estado]")!.textContent = "Não foi possível conectar. Abra o app e clique em Entrar com Google de novo.";
    }
  });
}
