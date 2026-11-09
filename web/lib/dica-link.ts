import { partesDoEndereco } from "./links.ts";

function linha(doc: Document, tag: "b" | "span", texto: string, classe?: string): HTMLElement {
  const el = doc.createElement(tag);
  el.textContent = texto;
  if (classe) el.className = classe;
  return el;
}

/**
 * definido em 2026-09-28 (ADR-053): passar o mouse (ou o foco do teclado) num link do bot mostra o
 * endereço inteiro antes do clique. A dica é um elemento só, fixo na janela: dentro da tabela que rola
 * ela seria cortada.
 */
export function instalarDicaDeLink(doc: Document): void {
  let dica: HTMLElement | null = null;
  const esconder = () => {
    if (dica) dica.hidden = true;
  };
  const mostrar = (a: HTMLAnchorElement) => {
    const partes = partesDoEndereco(a.href);
    if (!partes) return;
    if (!dica) {
      dica = doc.createElement("div");
      dica.className = "lk-dica";
      dica.setAttribute("role", "tooltip");
      doc.body.append(dica);
    }
    dica.replaceChildren(
      linha(doc, "b", partes.host),
      ...(partes.resto ? [linha(doc, "span", partes.resto)] : []),
      ...(partes.seguro ? [] : [linha(doc, "span", "Sem https: a conexão não é protegida", "lk-dica-aviso")]),
      linha(doc, "span", "Abre no navegador", "lk-dica-abre"),
    );
    dica.hidden = false;
    const janela = doc.defaultView;
    const largura = janela?.innerWidth ?? 1024;
    const altura = janela?.innerHeight ?? 768;
    const r = a.getBoundingClientRect();
    const d = dica.getBoundingClientRect();
    dica.style.left = `${Math.max(8, Math.min(r.left - 12, largura - d.width - 8))}px`;
    dica.style.top = `${r.bottom + 8 + d.height > altura - 8 ? r.top - 8 - d.height : r.bottom + 8}px`;
  };
  const alvo = (ev: Event) => (ev.target instanceof Element ? ev.target.closest<HTMLAnchorElement>("a[data-lk]") : null);
  doc.addEventListener("mouseover", (ev) => {
    const a = alvo(ev);
    if (a) mostrar(a);
  });
  doc.addEventListener("mouseout", (ev) => {
    const a = alvo(ev);
    if (a && !(ev instanceof MouseEvent && ev.relatedTarget instanceof Node && a.contains(ev.relatedTarget))) esconder();
  });
  doc.addEventListener("focusin", (ev) => {
    const a = alvo(ev);
    if (a) mostrar(a);
  });
  doc.addEventListener("focusout", esconder);
  doc.addEventListener("click", esconder);
  doc.addEventListener("scroll", esconder, true);
}
