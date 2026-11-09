/**
 * ADA-2 (ADR-148): o topo do celular encolhe quando o conteúdo passa por baixo dele.
 *
 * Parado no topo da conversa, do quadro ou da tarefa, a faixa da pílula não tem fundo (o título grande começa limpo);
 * rolado, `topo-encolhido` no cabeçalho liga o vidro (web/celular-base.css, só na consulta do celular).
 *
 * Por que rolagem e não IntersectionObserver com sentinela (desvio do plano): o #timeline e a .qd-conteudo são
 * regravados a cada render, e uma sentinela injetada sumiria ou mudaria a contagem de filhos que outros módulos leem.
 * A escuta é passiva, só LÊ `scrollTop` (nunca escreve: a rolagem guardada é da ADA-12) e junta as leituras num quadro.
 * A troca de vista (o `hidden` do quadro) também reavalia, porque não dispara rolagem.
 */
export const CLASSE_ENCOLHIDO = "topo-encolhido";
/** A partir de quantos px rolados o topo vira vidro: menos que isso é "parado no topo" (o quique do iOS fica fora). */
export const LIMIAR_ENCOLHE = 8;
/** Quem rola sob o topo, em ordem de empilhamento: a conversa (#timeline) por baixo, o quadro e a tarefa (#quadro) por cima. */
export const ROLAVEIS_DO_TOPO = ["timeline", "quadro"] as const;

type Agendar = (f: () => void) => number;
type Cancelar = (id: number) => void;
/** O pedaço do MutationObserver que usamos (este módulo também compila no tsconfig do servidor, sem a lib DOM). */
type Observador = new (cb: () => void) => { observe(alvo: object, o: { attributes: boolean; attributeFilter: string[] }): void; disconnect(): void };
type Visivel = { readonly hidden: boolean; readonly scrollTop: number };
type Rolavel = Visivel & {
  addEventListener(tipo: "scroll", f: () => void, o: { passive: boolean }): void;
  removeEventListener(tipo: "scroll", f: () => void): void;
};
type ComClasses = { classList: { contains(c: string): boolean; toggle(c: string, ligar: boolean): boolean; remove(c: string): void } };
const janela = globalThis as unknown as { requestAnimationFrame?: Agendar; cancelAnimationFrame?: Cancelar; MutationObserver?: Observador };

/** Decide pelo que está à vista: o rolável visível mais na frente (o último da lista) que estiver rolado. */
export function estaEncolhido(rolaveis: readonly Visivel[], limiar = LIMIAR_ENCOLHE): boolean {
  for (let i = rolaveis.length - 1; i >= 0; i--) {
    const r = rolaveis[i]!;
    if (r.hidden) continue;
    return r.scrollTop > limiar;
  }
  return false;
}

/**
 * Liga a escuta. `rolaveis` em ordem de empilhamento (a conversa por baixo, o quadro por cima). Devolve quem desliga
 * (tira as escutas, cancela o quadro pendente e a classe), e `reavaliar` para quem troca o conteúdo sem rolar.
 */
export function ligarTopoEncolhe(
  alvo: () => ComClasses | null,
  rolaveis: readonly Rolavel[],
  o: { agendar?: Agendar; cancelar?: Cancelar; Observador?: Observador } = {},
): { reavaliar: () => void; desligar: () => void } {
  const agendar: Agendar = o.agendar ?? ((f) => janela.requestAnimationFrame!(f));
  const cancelar: Cancelar = o.cancelar ?? ((id) => janela.cancelAnimationFrame!(id));
  let pendente: number | null = null;
  let ligado = true;
  const aplicar = (): void => {
    pendente = null;
    if (!ligado) return;
    const el = alvo();
    if (!el) return;
    const quer = estaEncolhido(rolaveis);
    if (el.classList.contains(CLASSE_ENCOLHIDO) !== quer) el.classList.toggle(CLASSE_ENCOLHIDO, quer);
  };
  const reavaliar = (): void => {
    if (!ligado || pendente !== null) return;
    pendente = agendar(aplicar);
  };
  for (const r of rolaveis) r.addEventListener("scroll", reavaliar, { passive: true });
  const Obs = o.Observador ?? janela.MutationObserver;
  const obs = Obs ? new Obs(reavaliar) : null;
  for (const r of rolaveis) obs?.observe(r, { attributes: true, attributeFilter: ["hidden"] });
  return {
    reavaliar,
    desligar: () => {
      ligado = false;
      for (const r of rolaveis) r.removeEventListener("scroll", reavaliar);
      obs?.disconnect();
      if (pendente !== null) cancelar(pendente);
      pendente = null;
      alvo()?.classList.remove(CLASSE_ENCOLHIDO);
    },
  };
}
