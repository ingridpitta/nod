import { comportamentoDaRolagem } from "./movimento.ts";

/**
 * definido em 2026-10-16 (review de design do #342, ponto 4): o único jeito da web levar a pessoa a um balão ou card —
 * rola até ele, realça um instante e PÕE O FOCO nele. Sem o foco, o redesenho da lista o deixava no `body` e teclado e
 * leitor de tela perdiam o lugar. O alvo não é focável por natureza: ganha `tabindex="-1"` (focável por script, fora da
 * ordem do Tab) só se não tiver um. `preventScroll` deixa a rolagem com o `scrollIntoView` (suave ou não).
 * Tipos estruturais: os testes rodam sem a lib DOM (tsconfig.server.json).
 */
export type AlvoDoAtalho = {
  scrollIntoView(o: { block: "center"; behavior: "auto" | "smooth" }): void;
  classList: { add(c: string): void; remove(c: string): void };
  hasAttribute(nome: string): boolean;
  setAttribute(nome: string, valor: string): void;
  focus(o: { preventScroll: boolean }): void;
};

export const REALCE_MS = 1600;

export function levarAoAlvo(alvo: AlvoDoAtalho, c: { reduzido: boolean; agendar: (fn: () => void, ms: number) => unknown; realcar?: boolean }): void {
  alvo.scrollIntoView({ block: "center", behavior: comportamentoDaRolagem(c.reduzido) });
  if (!alvo.hasAttribute("tabindex")) alvo.setAttribute("tabindex", "-1");
  alvo.focus({ preventScroll: true });
  if (c.realcar === false) return;
  alvo.classList.add("realce");
  c.agendar(() => alvo.classList.remove("realce"), REALCE_MS);
}

/**
 * definido em 2026-10-16 (review de design do #342, ponto 3): o atalho "Ver pergunta" da lista de rotinas espera a
 * timeline desenhar o balão; achou → leva; ainda no prazo → tenta de novo; prazo vencido (o balão está fora da janela
 * carregada, o caso comum numa rotina frequente com pergunta de ontem) → abre a faixa com o que espera a pessoa, nunca em
 * silêncio. Re-revisão de design do #342 (ajuste C, QA): não cai no "último card qualquer" da conversa — ele pode estar
 * respondido ou ser de outro assunto, e o foco nele diria a teclado e leitor de tela "é este" sem ser.
 */
export function passoDoAtalho(achou: boolean, agora: number, ate: number): "levar" | "tentar" | "faixa" {
  if (achou) return "levar";
  return agora < ate ? "tentar" : "faixa";
}

/**
 * definido em 2026-10-16 (re-revisão de design do #342, ajuste C): "o que espera você" escolhe para onde ir. O card da
 * própria decisão → leva e realça. Sem ele na timeline, o último balão/card da conversa → só rola e foca, SEM realce:
 * pode estar respondido ou ser de outro assunto, e o realce diria "é este" sem ser. Nenhum → null (a faixa abre).
 */
export function alvoDoQueEspera<T>(doMesmoAlvo: T | null, ultimo: T | null): { alvo: T; realcar: boolean } | null {
  if (doMesmoAlvo) return { alvo: doMesmoAlvo, realcar: true };
  return ultimo ? { alvo: ultimo, realcar: false } : null;
}
