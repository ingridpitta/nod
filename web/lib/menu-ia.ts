import { dialogo } from "../telas/gestao-agentes.ts";
import { escolhaDoItem, type EscolhaSeletor } from "../telas/seletor-ia.ts";

/**
 * A metade com DOM do seletor de IA do campo (definido em 2026-10-16, plano "tela limpa", T6): o menu abre ACIMA do
 * botão, como o do chip de aprovações (web/lib/menu-modo.ts). O `dialogo` para a propagação do clique (o menu é modal),
 * então os cliques do menu — inclusive o link para Provedores de IA — passam por este listener, e não pelo `data-act`
 * global do main. Mora fora de telas/seletor-ia.ts para os testes da web (Node, sem DOM) importarem o render puro.
 * Devolve o `<dialog>` para o main fechá-lo quando a conversa troca com o menu aberto.
 */
export function abrirMenuIa(ancora: HTMLElement, html: string, escolher: (e: EscolhaSeletor) => void, aoMudar: () => void = () => undefined): HTMLDialogElement {
  const d = dialogo(html, true);
  d.classList.add("ia-sel-menu");
  d.setAttribute("aria-label", "IA e modelo");
  ancora.setAttribute("aria-expanded", "true");
  aoMudar();
  // `aoMudar` redesenha o miolo do botão (a seta vira para cima com o menu aberto e volta ao fechar, por Esc ou clique fora).
  d.addEventListener("close", () => { ancora.setAttribute("aria-expanded", "false"); aoMudar(); });
  // O campo fica no pé da tela: o menu abre acima do botão, alinhado à direita dele (o botão mora à direita do texto).
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, Math.min(r.right - d.offsetWidth, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.max(12, r.top - d.offsetHeight - 8)}px`;
  d.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  d.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-escolha]");
    if (!item || item.disabled) return;
    const escolha = escolhaDoItem(item.dataset);
    if (!escolha) return;
    d.close();
    escolher(escolha);
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("[data-escolha]:not(:disabled)")];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  // Quem abriu fecha o menu se o campo mudar de conversa com ele aberto (main.ts): o clique nunca grava noutro bot.
  return d;
}
