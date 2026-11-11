/**
 * O contorno de foco só para quem navega pelo teclado (pedido do Marlon, 2026-11-10). O `:focus-visible` do navegador
 * acende também no clique em select, input e nos elementos que o código foca depois de um clique, e o anel ficava
 * pesado em muitos lugares. Aqui a página guarda como a pessoa chegou ao foco: `data-foco="ponteiro"` no `<html>` depois
 * de um clique ou toque, `data-foco="teclado"` depois de Tab (ou de setas fora de um campo). O CSS
 * (web/estilos.css) apaga o contorno no modo ponteiro; no teclado ele continua, mais suave (--focus-ring).
 */
export type ModoDeFoco = "ponteiro" | "teclado";

/** As teclas que movem o foco (as setas só contam fora de um campo, onde servem para escrever). */
const NAVEGA = new Set(["Tab", "F6"]);
const SETAS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

type Alvo = { tagName?: string; isContentEditable?: boolean } | null;

const ehCampo = (a: Alvo): boolean => !!a && (a.isContentEditable === true || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName ?? ""));

/** O modo que uma tecla liga (ou null: a tecla não muda o modo). */
export function modoDaTecla(tecla: string, alvo: Alvo, comModificador: boolean): ModoDeFoco | null {
  if (NAVEGA.has(tecla)) return "teclado";
  if (!comModificador && SETAS.has(tecla) && !ehCampo(alvo)) return "teclado";
  return null;
}

type Raiz = { dataset: Record<string, string | undefined> };
type Doc = { documentElement: Raiz; addEventListener(tipo: string, f: (ev: never) => void, captura: boolean): void };

/** Liga o modo de foco no documento: começa em ponteiro (a maioria abre clicando) e muda a cada clique ou tecla. */
export function ligarModoDeFoco(doc: Doc): void {
  const raiz = doc.documentElement;
  raiz.dataset.foco = "ponteiro";
  doc.addEventListener("pointerdown", () => { raiz.dataset.foco = "ponteiro"; }, true);
  doc.addEventListener("keydown", (ev: { key: string; target: Alvo; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) => {
    const m = modoDaTecla(ev.key, ev.target, !!(ev.metaKey || ev.ctrlKey || ev.altKey));
    if (m) raiz.dataset.foco = m;
  }, true);
}
