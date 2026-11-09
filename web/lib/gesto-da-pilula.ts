/**
 * ADA-8 (definido em 2026-11-04, docs/plano-gestos-da-pilula.md; emenda ADA-8 da ADR-146): as regras puras do gesto na pílula
 * do topo. Um dono só para o dedo, com a física da busca (a referência que funciona):
 * - o eixo trava a 10 px, e só com dominância de 1,5×; a diagonal trava em "nenhum" e o gesto não faz nada;
 * - vertical: puxar ↓ 36 px abre a busca; no miolo da busca aberta, empurrar ↑ 36 px fecha (igual à NOD-42);
 * - horizontal: a partir de 36 px, a página anterior/seguinte (para a esquerda = a seguinte); na ponta, um tranco;
 * - a pílula segue o dedo pela metade, até 30 px, nos dois eixos;
 * - segurar 450 ms parado abre um menu só: "Buscar na conversa" e as páginas.
 * - no fim o gesto confere o eixo de novo com o deslocamento inteiro: começar reto e terminar torto também não faz nada.
 * O DOM mora em web/lib/gesto-da-pilula-na-tela.ts.
 */

export const TRAVA_PX = 10;
export const DOMINANCIA = 1.5;
export const LIMIAR_PX = 36;
export const SEGURAR_MS = 450;
export const ACOMPANHA_MAX_PX = 30;

export type Eixo = "x" | "y" | "nenhum";

/** null = ainda dentro da tremida (pode virar toque ou segurar); "nenhum" = diagonal, o gesto morre. */
export function eixoDoGesto(dx: number, dy: number): Eixo | null {
  if (Math.hypot(dx, dy) <= TRAVA_PX) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= DOMINANCIA * ay) return "x";
  if (ay >= DOMINANCIA * ax) return "y";
  return "nenhum";
}

/** Quanto a pílula segue o dedo: metade do arrasto, até 30 px, no sentido dele. */
export function acompanhar(d: number): number {
  const v = Math.min(ACOMPANHA_MAX_PX, Math.abs(d) / 2);
  return d < 0 ? -v : v;
}

export type FimDaPilula =
  | { tipo: "buscar" }
  | { tipo: "fechar-busca" }
  | { tipo: "pagina"; passo: -1 | 1 }
  | { tipo: "tranco"; lado: -1 | 1 }
  | { tipo: "nada" };

export type GestoSolto = {
  eixo: Eixo | null;
  dx: number;
  dy: number;
  /** O gesto começou no miolo da busca já aberta. */
  buscaAberta: boolean;
  podeBuscar: boolean;
  /** Páginas na pílula (menos de 2 = nenhuma troca) e a posição atual na ordem dela. */
  total: number;
  atual: number;
};

/** O que soltar o dedo faz. Cada eixo tem um efeito só: a busca nunca troca de página e o lado nunca abre a busca. */
export function fimDoGestoDaPilula(g: GestoSolto): FimDaPilula {
  // Revisão do #651: o eixo trava cedo (10 px) e o dedo real quase nunca vai reto; sem conferir no fim, um arrasto que
  // começa de lado e termina a 45° trocava a página (e o que começa para baixo abria a busca).
  if (g.eixo === null || g.eixo === "nenhum" || eixoDoGesto(g.dx, g.dy) !== g.eixo) return { tipo: "nada" };
  if (g.eixo === "y") {
    if (g.buscaAberta) return g.dy <= -LIMIAR_PX ? { tipo: "fechar-busca" } : { tipo: "nada" };
    return g.podeBuscar && g.dy >= LIMIAR_PX ? { tipo: "buscar" } : { tipo: "nada" };
  }
  if (g.buscaAberta || g.total < 2 || Math.abs(g.dx) < LIMIAR_PX) return { tipo: "nada" };
  const passo: -1 | 1 = g.dx < 0 ? 1 : -1;
  const destino = g.atual + passo;
  return destino < 0 || destino >= g.total ? { tipo: "tranco", lado: passo } : { tipo: "pagina", passo };
}

/**
 * A roda sobre a pílula (computador): só o eixo horizontal troca (o trackpad de lado), com dominância de 1,5×. A roda
 * vertical do mouse passava pelo topo e trocava a página sem querer. Menos de 4 px é tremida. +1 = a seguinte.
 */
export function passoDaRodaHorizontal(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < 4 || Math.abs(dx) < DOMINANCIA * Math.abs(dy)) return 0;
  return dx > 0 ? 1 : -1;
}

export type ItemDoMenuDaPilula = { tipo: "buscar" } | { tipo: "pagina"; pos: number; nome: string; atual: boolean };

/** O menu do segurar: a busca (quando dá para buscar) e, com mais de uma página, cada página na ordem da pílula. */
export function itensDoMenuDaPilula(o: { podeBuscar: boolean; paginas: readonly string[]; atual: number }): ItemDoMenuDaPilula[] {
  const itens: ItemDoMenuDaPilula[] = o.podeBuscar ? [{ tipo: "buscar" }] : [];
  if (o.paginas.length > 1) o.paginas.forEach((nome, pos) => itens.push({ tipo: "pagina", pos, nome, atual: pos === o.atual }));
  return itens;
}
