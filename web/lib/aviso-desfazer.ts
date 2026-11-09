import { esc } from "./render.ts";

/**
 * NOD-449 (protótipo aprovado, passo "Lida, com Desfazer"): o aviso no pé da tela depois de marcar como lido — uma frase
 * e Desfazer. Sai sozinho em alguns segundos; um aviso novo toma o lugar do anterior (o Desfazer vale para o último).
 * No celular, fica acima da barra de baixo (o CSS cuida). `role="status"`: o leitor de tela anuncia sem roubar o foco.
 */

export const DURACAO_AVISO_MS = 6000;
/**
 * Definido em 2026-11-02 (revisão 6 do #626): o aviso só com a frase (a recusa das páginas, ~130 caracteres) quebra a linha
 * e fica 12 s, o dobro do com Desfazer: a 390 px a frase ocupa até três linhas e precisa ser lida inteira.
 */
export const DURACAO_AVISO_FRASE_MS = 12_000;

let atual: { el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null = null;

export function fecharAvisoDesfazer(): void {
  if (!atual) return;
  clearTimeout(atual.timer);
  atual.el.remove();
  atual = null;
}

/**
 * `abrir` (ADA-2 F5): um botão antes do Desfazer que leva ao que acabou de nascer ("Tarefa criada · Abrir · Desfazer").
 * Sem `aoDesfazer`, o mesmo aviso neutro só com a frase (QA do #626: a recusa das páginas, sem o vermelho do erro); essa
 * variante (`nl-aviso-frase`) quebra a linha e dura DURACAO_AVISO_FRASE_MS (revisão 6).
 */
export function mostrarAvisoDesfazer(o: { texto: string; aoDesfazer?: () => void | Promise<void>; abrir?: { rotulo: string; aoAbrir: () => void }; ms?: number }): HTMLElement {
  fecharAvisoDesfazer();
  const el = document.createElement("div");
  const aoDesfazer = o.aoDesfazer;
  const abrir = o.abrir;
  el.className = aoDesfazer || abrir ? "nl-aviso" : "nl-aviso nl-aviso-frase";
  el.setAttribute("role", "status");
  el.innerHTML = `<span>${esc(o.texto)}</span>${abrir ? `<button type="button" class="nl-desfazer nl-abrir">${esc(abrir.rotulo)}</button>` : ""}${aoDesfazer ? '<button type="button" class="nl-desfazer nl-desfazer-acao">Desfazer</button>' : ""}`;
  el.querySelector(".nl-abrir")?.addEventListener("click", () => {
    fecharAvisoDesfazer();
    abrir?.aoAbrir();
  });
  el.querySelector(".nl-desfazer-acao")?.addEventListener("click", () => {
    fecharAvisoDesfazer();
    if (aoDesfazer) void aoDesfazer();
  });
  document.body.appendChild(el);
  const timer = setTimeout(() => {
    if (atual?.el === el) fecharAvisoDesfazer();
  }, o.ms ?? (aoDesfazer || abrir ? DURACAO_AVISO_MS : DURACAO_AVISO_FRASE_MS));
  atual = { el, timer };
  return el;
}
