/**
 * O Nod no celular (definido em 2026-10-10, ADR-094): a mesma web, servida pelo mesmo servidor, com a barra de bots virando
 * gaveta, a conversa em tela cheia e o campo acima do teclado. Celular é decidido pelo TOQUE e pelo tamanho juntos: um
 * dedo como ponteiro principal (sem hover) e o lado menor da tela de telefone. Janela estreita no Mac continua desktop; o
 * iPad continua com as colunas. web/mobile.css usa exatamente esta consulta (o teste confere).
 */
export const CONSULTA_CELULAR = "(hover: none) and (pointer: coarse) and (max-width: 600px), (hover: none) and (pointer: coarse) and (max-height: 500px)";

type MatchMedia = (consulta: string) => { matches: boolean };

/** Sem `matchMedia` (testes, ambiente sem janela) não é celular. */
export function ehCelular(mm: MatchMedia | undefined = matchMediaDaJanela()): boolean {
  return mm ? mm(CONSULTA_CELULAR).matches : false;
}

// Sem citar o global `matchMedia` por nome: os testes compilam sem a lib DOM (como web/lib/movimento.ts).
function matchMediaDaJanela(): MatchMedia | undefined {
  const mm = (globalThis as { matchMedia?: MatchMedia }).matchMedia;
  return typeof mm === "function" ? (q) => mm.call(globalThis, q) : undefined;
}

/**
 * A área que sobra acima do teclado. No iPhone o teclado não encolhe a página (só o viewport visual) e a página pode rolar
 * por baixo dele; a .app passa a ter a altura e o topo do viewport visual, e o campo fica colado no teclado. Com zoom de
 * pinça (`scale` ≠ 1) não mexe: a pessoa está olhando um pedaço da tela de propósito. null = usar o 100dvh do CSS.
 */
export function areaVisivel(vv: { height: number; offsetTop: number; scale: number } | null | undefined, celular: boolean): { altura: number; topo: number } | null {
  if (!celular || !vv || Math.abs(vv.scale - 1) > 0.01) return null;
  return { altura: Math.round(vv.height), topo: Math.max(0, Math.round(vv.offsetTop)) };
}

/**
 * Enter no teclado do celular quebra a linha, como no WhatsApp; enviar é a seta. No computador, Enter envia e Shift+Enter
 * quebra. Composição de texto (acentos, teclado japonês) nunca envia no meio. Ctrl/⌘+Enter envia nos dois.
 */
export function enterEnvia(ev: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }, celular: boolean): boolean {
  if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return false;
  return !celular || ev.ctrlKey || ev.metaKey;
}
