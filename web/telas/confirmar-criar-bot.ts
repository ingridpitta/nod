import { esc } from "../lib/render.ts";

/**
 * NOD-383 (critério 5, Gil item 6; v2: o gesto é segurar o + do topo): no celular, segurar o + não cria o bot na hora. O
 * toque longo é fácil de dar sem querer (rolando a barra, guardando o celular), e o bot criado sem querer fica na lista.
 * Antes, o Nod pergunta numa folha de baixo, como uma mensagem dele (mascote e balão): "Criar um bot agora?". Só Criar
 * cria; Cancelar, tocar fora, arrastar a folha para baixo e Esc cancelam. O foco começa em Cancelar. No desktop o gesto
 * continua criando direto (o atalho Shift+Enter é de propósito).
 */

export const TITULO_CRIAR_BOT = "Criar um bot agora?";
export const TEXTO_CRIAR_BOT = "Ele começa em branco e pergunta por onde começar.";
/** Quanto a folha precisa descer (px) para o arrasto contar como cancelar. */
export const ARRASTO_CANCELA = 60;

export function htmlConfirmarCriarBot(mascote: string): string {
  return `<div class="fcb-alca" aria-hidden="true"></div>
    <div class="fcb-msg"><span class="fcb-mascote" aria-hidden="true">${mascote}</span><div class="fcb-balao"><h2 id="fcb-titulo">${esc(TITULO_CRIAR_BOT)}</h2><p id="fcb-texto">${esc(TEXTO_CRIAR_BOT)}</p></div></div>
    <div class="fcb-acoes"><button type="button" class="bt fcb-criar" data-fcb="criar">Criar</button><button type="button" class="bt link fcb-cancelar" data-fcb="cancelar">Cancelar</button></div>`;
}

type Evento = { target: unknown; clientX?: number; clientY?: number; preventDefault?: () => void };
type Botao = { disabled: boolean; focus(): void };
type Dialogo = {
  id: string;
  className: string;
  innerHTML: string;
  open: boolean;
  setAttribute(nome: string, valor: string): void;
  addEventListener(tipo: string, fn: (e: Evento) => void): void;
  querySelector(seletor: string): unknown;
  showModal(): void;
  close(): void;
  remove(): void;
  getBoundingClientRect?(): { top: number; left: number; right: number; bottom: number };
};
type Doc = { body: { append(el: unknown): void }; createElement(tag: "dialog"): unknown; getElementById(id: string): { close?(): void; remove(): void } | null };

/** Abre a folha e responde true só quando a pessoa toca Criar (uma vez). */
export function confirmarCriarBot(mascote: string, doc: Doc = (globalThis as unknown as { document: Doc }).document): Promise<boolean> {
  // Uma folha que já estava aberta fecha antes (o close dela responde "não" para quem esperava) e só então sai.
  const antiga = doc.getElementById("folha-criar-bot");
  antiga?.close?.();
  antiga?.remove();
  const d = doc.createElement("dialog") as Dialogo;
  d.id = "folha-criar-bot";
  d.className = "folha-criar-bot";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-labelledby", "fcb-titulo");
  d.setAttribute("aria-describedby", "fcb-texto");
  d.innerHTML = htmlConfirmarCriarBot(mascote);
  return new Promise<boolean>((resolver) => {
    let resposta: boolean | null = null;
    const fechar = (criar: boolean) => {
      if (resposta !== null) return;
      resposta = criar;
      d.close();
    };
    // O toque fora só conta se começou fora: o dedo que segurou o + ainda está na tela quando a folha abre, e o soltar dele
    // não pode cancelar (nem criar) nada.
    let comecouFora = false;
    let inicioY: number | null = null;
    // O alvo é o próprio <dialog> tanto no fundo (::backdrop) quanto no padding da folha: só fora da caixa é "fora".
    const foraDaCaixa = (e: Evento): boolean => {
      const r = d.getBoundingClientRect?.();
      if (!r || e.clientX === undefined || e.clientY === undefined) return true;
      return e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right;
    };
    // O dedo que segurou o + solta já com a folha aberta, e o mousedown que o navegador gera desse toque cai no próprio
    // <dialog> e tiraria o foco de Cancelar (QA da NOD-383). Fora dos botões, o mousedown não move o foco.
    d.addEventListener("mousedown", (e) => {
      if (e.target === d) e.preventDefault?.();
    });
    d.addEventListener("pointerdown", (e) => {
      comecouFora = e.target === d && foraDaCaixa(e);
      inicioY = comecouFora ? null : e.clientY ?? null;
    });
    // Arrastar para baixo: medido no pointermove (com touch-action: none na folha, o navegador não rouba o gesto para
    // rolar); o pointerup cobre quem soltar sem mover.
    const arrasto = (e: Evento) => {
      if (inicioY !== null && e.clientY !== undefined && e.clientY - inicioY >= ARRASTO_CANCELA) fechar(false);
    };
    d.addEventListener("pointermove", arrasto);
    d.addEventListener("pointerup", (e) => {
      arrasto(e);
      inicioY = null;
    });
    d.addEventListener("pointercancel", () => {
      inicioY = null;
    });
    d.addEventListener("click", (e) => {
      const alvo = e.target as { closest?: (s: string) => { dataset?: { fcb?: string } } | null } | null;
      const qual = alvo && alvo !== d && typeof alvo.closest === "function" ? alvo.closest("[data-fcb]")?.dataset?.fcb : undefined;
      if (qual === "criar") {
        (d.querySelector(".fcb-criar") as Botao | null)!.disabled = true;
        fechar(true);
      } else if (qual === "cancelar") fechar(false);
      else if (e.target === d && comecouFora) fechar(false);
    });
    // Esc dispara `cancel` e fecha o <dialog>; o `close` resolve como cancelar.
    d.addEventListener("close", () => {
      d.remove();
      resolver(resposta === true);
    });
    doc.body.append(d);
    d.showModal();
    (d.querySelector(".fcb-cancelar") as Botao | null)?.focus();
  });
}

/**
 * O "criar rápido" do + segurado: no celular pergunta antes; no desktop cria direto. Devolve se criou. `criar` é chamado
 * no máximo uma vez, e nunca quando a pessoa cancela.
 */
export async function criarRapido(celular: boolean, confirmar: () => Promise<boolean>, criar: () => Promise<void>): Promise<boolean> {
  if (celular && !(await confirmar())) return false;
  await criar();
  return true;
}
