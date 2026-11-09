import { esc } from "../lib/render.ts";
import { nesteAparelho } from "../lib/aparelho.ts";

/**
 * NOD-345 (decisão do Gil, opção 2): o lembrete de que o espaço está só neste computador são DUAS coisas e nada mais —
 * a linha fixa no menu da conta (web/telas/menu-conta.ts) e UMA fala do bot Nod, uma vez na vida desta instalação, depois
 * que a pessoa já tem algo a perder (a primeira rotina). Sem banner, sem repetir, sem contar dias.
 */
export const CHAVE_LEMBRETE = "nod-lembrete-conta";

export type SituacaoLembrete = {
  /** O servidor tem contas (o modo anunciou `contas`). */
  contas: boolean;
  /** null = ainda não lido; false = sem conta (espaço provisório); true = já tem conta. */
  temConta: boolean | null;
  rotinas: number;
  jaFalou: boolean;
};

export const deveLembrar = (s: SituacaoLembrete): boolean => s.contas && s.temConta === false && s.rotinas > 0 && !s.jaFalou;

export const htmlLembrete = (): string =>
  `<section class="cc-bloco" aria-label="Lembrete da conta"><div class="cc-lembrete"><p>Seu espaço está só ${nesteAparelho()}. Se ele se perder, o que você montou vai junto. Com uma conta, você entra de qualquer lugar.</p><div class="cc-acoes">${`<button type="button" class="bt cc-link" data-act="conta-lembrete-ok">Agora não</button><button type="button" class="bt pri" data-act="conta-abrir" data-etapa="inicio">${esc("Criar conta")}</button>`}</div></div></section>`;

export function jaFalou(storage: Pick<Storage, "getItem"> | null): boolean {
  try { return storage?.getItem(CHAVE_LEMBRETE) === "1"; } catch { return true; }
}
export function marcarFalou(storage: Pick<Storage, "setItem"> | null): void {
  try { storage?.setItem(CHAVE_LEMBRETE, "1"); } catch { /* sem storage: some nesta aba e pode voltar noutra */ }
}
