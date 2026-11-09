import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { reagirMenuModo, renderConfirmaTotal, renderMenuModo, type EventoMenuModo } from "../telas/aprovacoes.ts";
import { dialogo } from "../telas/gestao-agentes.ts";

/**
 * A metade com DOM do botão de aprovações (ADR-059): o menu que abre acima do botão e a confirmação do total dentro
 * dele. Mora fora de telas/aprovacoes.ts para os testes da web (Node, sem DOM) importarem o render e a regra
 * (`reagirMenuModo`) sem puxar `document`.
 */
export function abrirMenuModo(ancora: HTMLElement, nome: string, atual: ModoAprovacao, escolher: (modo: ModoAprovacao, confirmado: boolean) => void, revisor = false): void {
  const d = dialogo(renderMenuModo(nome, atual, revisor), true);
  d.classList.add("modo-menu");
  ancora.setAttribute("aria-expanded", "true");
  d.addEventListener("close", () => ancora.setAttribute("aria-expanded", "false"));
  // O campo fica no pé da tela: o menu abre ACIMA do botão, alinhado à esquerda dele. A confirmação cresce o menu
  // para baixo; `posicionar` o devolve para cima do botão.
  const r = ancora.getBoundingClientRect();
  const posicionar = () => {
    d.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - d.offsetWidth - 12))}px`;
    d.style.top = `${Math.max(12, r.top - d.offsetHeight - 8)}px`;
  };
  posicionar();
  d.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();

  const itemTotal = () => d.querySelector<HTMLButtonElement>('[data-modo="total"]');
  const confirmacao = () => d.querySelector<HTMLElement>(".modo-confirma");
  // Quando a confirmação abriu: o clique que chega logo depois (o segundo de um duplo clique) não conta (reagirMenuModo).
  let abriuEm = 0;
  const reagir = (ev: EventoMenuModo) => {
    const r = reagirMenuModo(atual, confirmacao() !== null, ev);
    if (r.tipo === "ignorar") return;
    if (r.tipo === "fechar") d.close();
    else if (r.tipo === "escolher") { d.close(); escolher(r.modo, r.confirmado); }
    else if (r.tipo === "abrir-confirmacao") {
      itemTotal()?.insertAdjacentHTML("afterend", renderConfirmaTotal(nome));
      abriuEm = performance.now();
      itemTotal()?.setAttribute("aria-expanded", "true");
      posicionar();
      // O foco vai para "Agora não": Enter sem querer não liga o modo.
      d.querySelector<HTMLButtonElement>('[data-confirma="nao"]')?.focus();
    } else {
      confirmacao()?.remove();
      itemTotal()?.removeAttribute("aria-expanded");
      posicionar();
      itemTotal()?.focus();
    }
  };

  d.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const clique = { cliques: e.detail, msDesdeAConfirmacao: performance.now() - abriuEm };
    const confirma = alvo.closest<HTMLButtonElement>("[data-confirma]");
    if (confirma) { reagir({ tipo: confirma.dataset.confirma === "sim" ? "confirmar" : "agora-nao", ...clique }); return; }
    const btn = alvo.closest<HTMLButtonElement>("[data-modo]");
    if (btn) reagir({ tipo: "item", modo: btn.dataset.modo as ModoAprovacao, ...clique });
  });
  // Esc com a confirmação aberta fecha só ela. O keydown cancelado não chega a fechar o <dialog>; o `cancel` cobre o
  // navegador que fecha mesmo assim. `escDaConfirmacao` impede o mesmo Esc de fechar a confirmação e depois o menu (o
  // `cancel` é a ação padrão do keydown e sai na mesma tarefa; o setTimeout zera a marca logo depois).
  let escDaConfirmacao = false;
  d.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !confirmacao()) return;
    e.preventDefault();
    e.stopPropagation();
    escDaConfirmacao = true;
    setTimeout(() => { escDaConfirmacao = false; });
    reagir({ tipo: "esc" });
  });
  d.addEventListener("cancel", (e) => {
    if (escDaConfirmacao) { e.preventDefault(); return; }
    if (confirmacao()) { e.preventDefault(); reagir({ tipo: "esc" }); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const itens = [...d.querySelectorAll<HTMLButtonElement>("[data-modo], [data-confirma]")];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
}
