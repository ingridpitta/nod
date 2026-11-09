/**
 * NOD-122: o único lugar da web que pergunta se a pessoa pediu "Reduzir movimento". Toda animação feita em JS (rolagem
 * suave, o laço do mascote) passa por aqui; o CSS já trata o resto (web/interface.css, `prefers-reduced-motion`).
 */
export const CONSULTA_MOVIMENTO_REDUZIDO = "(prefers-reduced-motion: reduce)";

type MatchMedia = (consulta: string) => { matches: boolean };

/** Sem `matchMedia` (testes, ambiente sem janela) não há pedido de movimento reduzido. */
export function movimentoReduzido(mm: MatchMedia | undefined = matchMediaDaJanela()): boolean {
  return mm ? mm(CONSULTA_MOVIMENTO_REDUZIDO).matches : false;
}

// Sem citar o global `matchMedia` por nome: os testes compilam sem a lib DOM (tsconfig.server.json).
function matchMediaDaJanela(): MatchMedia | undefined {
  const mm = (globalThis as { matchMedia?: MatchMedia }).matchMedia;
  return typeof mm === "function" ? (q) => mm.call(globalThis, q) : undefined;
}

/** `scrollIntoView`/`scrollTo` suave só sem movimento reduzido; com ele, o salto é direto. */
export function comportamentoDaRolagem(reduzido: boolean): "auto" | "smooth" {
  return reduzido ? "auto" : "smooth";
}

/**
 * O laço de quadros do mascote (web/lib/mascote-elemento.ts) só se reagenda com alguém se mexendo, a aba à vista e
 * sem movimento reduzido. Com ele, cada mascote fica no quadro parado da pose (POSES do bloub) e nenhum rAF roda.
 */
export function lacoDoMascoteSegue(c: { ativos: number; oculto: boolean; reduzido: boolean }): boolean {
  return c.ativos > 0 && !c.oculto && !c.reduzido;
}

/** O instante amostrado do motor: com movimento reduzido, a pose fixa do estado; senão, o relógio da animação. */
export function instanteDoMascote(c: { reduzido: boolean; pose: number; tempo: number }): number {
  return c.reduzido ? c.pose : c.tempo;
}
