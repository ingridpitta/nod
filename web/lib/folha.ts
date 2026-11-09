/**
 * ADA-17 (ADR-148, F2): a folha de baixo do celular (bottom sheet) das propriedades da tarefa aberta.
 *
 * Fica fora do #quadro (no body): o conteúdo da tarefa é regravado a cada frame e a folha aberta não pode sumir com ele.
 * Foco preso dentro dela (Tab e Shift+Tab dão a volta), Esc, toque no fundo e arrastar a alça para baixo fecham, e o
 * foco volta ao chip que a abriu (procurado de novo pelo seletor: o chip pode ter sido regravado). A altura máxima é a da
 * área visível acima do teclado (`--teclado`, web/lib/teclado-visivel.ts), nunca `vh` (CSS em web/celular-base.css).
 *
 * O corpo é HTML pronto (quem chama escapa o texto de fora). Um toque num `[data-folha-acao]` chama `aoClicar`.
 */
export const CLASSE_FOLHA = "qd-folha-cel";
/** Quanto a alça precisa descer para fechar a folha. */
export const ARRASTO_FECHA = 80;

export type FolhaAberta = { el: HTMLElement; fechar: (devolverFoco?: boolean) => void; trocarCorpo: (html: string) => void };

const FOCAVEIS = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

import { focaveisVisiveis } from "./folha-gestos.ts";

export { DEPOIS_DE_SOLTAR_MS, TOQUE_MAX_MS, engolirCliqueDoToque, focaveisVisiveis } from "./folha-gestos.ts";

let aberta: FolhaAberta | null = null;

/** A folha aberta agora (uma por vez). */
export const folhaAberta = (): FolhaAberta | null => (aberta?.el.isConnected ? aberta : null);

export function abrirFolha(doc: Document, o: {
  id: string;
  titulo: string;
  corpo: string;
  /** Seletor do elemento que recebe o foco ao fechar (o chip que abriu). */
  voltarPara?: string | null;
  aoClicar?: (el: HTMLElement, f: FolhaAberta) => void;
  aoFechar?: () => void;
}): FolhaAberta {
  folhaAberta()?.fechar(false);
  const fundo = doc.createElement("div");
  fundo.className = `qd-folha-fundo ${CLASSE_FOLHA}-fundo`;
  const el = doc.createElement("div");
  el.className = `qd-folha ${CLASSE_FOLHA}`;
  el.id = o.id;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", `${o.id}-tit`);
  el.innerHTML = `<div class="qd-folha-alca" aria-hidden="true"></div><div class="qd-folha-cab"><h2 class="qd-folha-tit" id="${o.id}-tit" tabindex="-1"></h2>` +
    `<button type="button" class="qd-link qd-folha-ok" data-folha-fechar>Fechar</button></div><div class="qd-folha-corpo">${o.corpo}</div>`;
  el.querySelector(".qd-folha-tit")!.textContent = o.titulo;
  let fechada = false;
  const f: FolhaAberta = {
    el,
    fechar(devolverFoco = true) {
      if (fechada) return;
      fechada = true;
      fundo.remove();
      el.remove();
      if (aberta === f) aberta = null;
      o.aoFechar?.();
      if (devolverFoco && o.voltarPara) doc.querySelector<HTMLElement>(o.voltarPara)?.focus({ preventScroll: true });
    },
    trocarCorpo(html: string) {
      const c = el.querySelector(".qd-folha-corpo");
      if (c) c.innerHTML = html;
      focarInicio();
    },
  };
  const focarInicio = (): void => {
    const marcado = el.querySelector<HTMLElement>('[data-folha-foco], [aria-checked="true"], [aria-current="true"]');
    (marcado ?? el.querySelector(".qd-folha-corpo")?.querySelector<HTMLElement>(FOCAVEIS) ?? el.querySelector<HTMLElement>(".qd-folha-tit"))?.focus({ preventScroll: true });
  };
  fundo.addEventListener("click", () => f.fechar());
  el.addEventListener("click", (ev) => {
    const alvo = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-folha-acao], [data-folha-fechar]");
    if (!alvo || !el.contains(alvo)) return;
    if (alvo.hasAttribute("data-folha-fechar")) { f.fechar(); return; }
    o.aoClicar?.(alvo, f);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); f.fechar(); return; }
    if (ev.key !== "Tab") return;
    const lista = focaveisVisiveis([...el.querySelectorAll<HTMLElement>(FOCAVEIS)]);
    if (!lista.length) { ev.preventDefault(); return; }
    const primeiro = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    if (ev.shiftKey && (doc.activeElement === primeiro || !el.contains(doc.activeElement))) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && (doc.activeElement === ultimo || !el.contains(doc.activeElement))) { ev.preventDefault(); primeiro.focus(); }
  });
  // Arrastar a alça (ou o cabeçalho) para baixo fecha.
  let inicioY: number | null = null;
  const cab = (ev: Event): boolean => !!(ev.target as Element | null)?.closest?.(".qd-folha-alca, .qd-folha-cab");
  el.addEventListener("pointerdown", (ev) => { if (cab(ev)) inicioY = ev.clientY; });
  el.addEventListener("pointermove", (ev) => { if (inicioY !== null && ev.clientY - inicioY > ARRASTO_FECHA) { inicioY = null; f.fechar(); } });
  el.addEventListener("pointerup", () => { inicioY = null; });
  el.addEventListener("pointercancel", () => { inicioY = null; });
  doc.body.append(fundo, el);
  aberta = f;
  focarInicio();
  return f;
}
