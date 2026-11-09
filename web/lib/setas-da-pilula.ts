import { campoTemTexto, type AcaoAtalho, type ContextoTecla, type ElementoDeCampo } from "./atalhos.ts";

/**
 * NOD-461: a ponta do DOM das setas da pílula (⌥← → e ⌥⇧← →), separada do main.ts para o palco do Chrome
 * (tests/concurrency/quadro-chrome.test.ts) passar pelo mesmo caminho da tecla: keydown → atalhoDoTeclado → aqui.
 */

/** O pedaço do documento que as setas leem (os testes de unidade compilam sem o DOM). */
export type DocDaPilula = {
  querySelectorAll(s: string): ArrayLike<{ getClientRects(): { length: number } }>;
  activeElement: { closest?(s: string): unknown } | null;
};

/** O pedaço do contexto do atalho que só o DOM sabe: campo com texto, quem já tratou a tecla e menu aberto. */
export function contextoDaPilula(doc: DocDaPilula, alvo: ElementoDeCampo | null, ev: { defaultPrevented: boolean }): Pick<ContextoTecla, "campoComTexto" | "teclaDoAlvo" | "menuAberto"> {
  return {
    // ⌥← → num campo com texto anda por palavra no Mac (campoComTexto, atalhos.ts).
    campoComTexto: campoTemTexto(alvo),
    // O cabeçalho de coluna do quadro move a coluna com Alt+← → e já deu preventDefault (o listener dele vem antes).
    teclaDoAlvo: ev.defaultPrevented,
    menuAberto: Array.from(doc.querySelectorAll('[role="menu"]')).some((m) => m.getClientRects().length > 0),
  };
}

export type PilulaDoAtalho = {
  andar(passo: -1 | 1, o?: { foco?: boolean; espiar?: boolean }): boolean;
  moverAtual(passo: -1 | 1, o?: { foco?: boolean }): boolean;
};

/**
 * Faz a ação da pílula; null quando a ação não é dela. No ícone da doca o foco vai junto; longe dela a doca espia.
 * ⌘[ ⌘] (o colchete, sem `seta`) não espiam. Na ponta devolve false, mas a tecla já foi engolida pelo main.
 */
export function executarNaPilula(doc: DocDaPilula, a: AcaoAtalho, q: PilulaDoAtalho): boolean | null {
  if (a.tipo === "engolir") return true;
  if (a.tipo !== "pagina" && a.tipo !== "mover-pagina") return null;
  const foco = !!doc.activeElement?.closest?.("#cabecalho .pg-ic");
  if (a.tipo === "mover-pagina") return q.moverAtual(a.passo, { foco });
  return q.andar(a.passo, { foco, espiar: a.seta === true });
}
