/**
 * ADR-125 (NOD-349, definido em 2026-10-23): a identidade editável no topo da gaveta e o teclado das abas e do popover
 * do avatar. `instalarIdentidade` liga os eventos no documento uma vez só; as regras puras moram em identidade-regras.ts.
 */
import { AVISO_MS, decidirCampo, desfazerAoFalhar, ERRO_AO_SALVAR, ERRO_NOME_VAZIO, proximaAba, proximoRadio, type CampoIdentidade } from "./identidade-regras.ts";

export { comPendentes, criarFilaDePerfil, criarSalvarAvatar, ERRO_AO_SALVAR, sobreporPendentes } from "./identidade-regras.ts";

export type AcoesDaIdentidade = {
  /** Grava o campo; rejeita = falhou (o campo volta ao salvo e a linha diz ERRO_AO_SALVAR). */
  salvarCampo(agenteId: string, campo: CampoIdentidade, valor: string): Promise<void>;
  /** Fecha o popover do avatar; com `focarAvatar` (Esc) o foco volta ao avatar, no clique fora fica onde a pessoa clicou. */
  fecharPopover(focarAvatar: boolean): void;
  /** A aba escolhida pelo teclado. */
  escolherAba(agenteId: string, aba: string): void;
  /** A forma ou a cor escolhida pelas setas no popover. */
  escolherRadio(botao: HTMLButtonElement): void;
};

let avisoTimer: ReturnType<typeof setTimeout> | undefined;
let avisoAtual = "";

/** Escreve o aviso na linha neutra (role=status) e apaga depois de `AVISO_MS`; o redesenho da gaveta o reescreve. */
export function avisarNaIdentidade(texto: string, raiz: ParentNode = document): void {
  avisoAtual = texto;
  const linha = raiz.querySelector<HTMLElement>("#detalhes .gvn-erro");
  if (!linha) return;
  linha.textContent = texto;
  linha.closest(".gvn-erro-linha")?.classList.toggle("visivel", Boolean(texto));
  if (avisoTimer) clearTimeout(avisoTimer);
  if (texto) avisoTimer = setTimeout(() => avisarNaIdentidade("", raiz), AVISO_MS);
}

/** Revisão da NOD-349: a gaveta redesenhada no meio do aviso (a frota relida depois do erro) não o apaga antes da hora. */
export function reaplicarAviso(raiz: ParentNode = document): void {
  if (!avisoAtual) return;
  const linha = raiz.querySelector<HTMLElement>("#detalhes .gvn-erro");
  if (!linha || linha.textContent === avisoAtual) return;
  linha.textContent = avisoAtual;
  linha.closest(".gvn-erro-linha")?.classList.add("visivel");
}

// Revisão 3 da NOD-349: o redesenho com o foco num campo tira o input do DOM e o devolve; no Chromium isso dispara
// focusout, que salvaria o texto pela metade. Durante a troca, o focusout não conta.
let trocandoCampo = false;
export function preservandoCampo(trocar: () => void): void {
  trocandoCampo = true;
  try { trocar(); } finally { trocandoCampo = false; }
}

const campoDe = (el: EventTarget | null): HTMLInputElement | null =>
  el instanceof HTMLInputElement && el.matches("#detalhes .gvn-nome, #detalhes .gvn-sub") ? el : null;

/** Liga Enter/Esc/blur dos campos, o teclado das abas e o do popover (setas, Tab preso, Esc e clique fora). */
export function instalarIdentidade(acoes: AcoesDaIdentidade, doc: Document = document): void {
  // Esc desfaz: o blur que vem depois não salva (a marca vale para aquele blur só).
  const desfeitos = new WeakSet<HTMLInputElement>();

  doc.addEventListener("keydown", (ev) => {
    const campo = campoDe(ev.target);
    if (campo) {
      // Revisão da NOD-349: o Enter que confirma a composição do IME não salva; depois de Enter ou Esc o foco volta ao
      // campo (o blur só dispara o salvar), para quem usa teclado não cair no começo da página.
      if (ev.isComposing) return;
      if (ev.key === "Enter") { ev.preventDefault(); campo.blur(); campo.focus(); return; }
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        campo.value = campo.dataset.salvo ?? "";
        desfeitos.add(campo);
        campo.blur();
        campo.focus();
      }
      return;
    }
    const alvo = ev.target as HTMLElement | null;
    const tab = alvo?.closest?.<HTMLButtonElement>('#detalhes [role="tab"]');
    if (tab) {
      if (ev.altKey || ev.ctrlKey || ev.metaKey) return; // atalho do navegador ou do sistema não troca de aba
      const abas = [...doc.querySelectorAll<HTMLButtonElement>('#detalhes [role="tab"]')];
      const i = proximaAba(abas.length, abas.indexOf(tab), ev.key);
      if (i === null) return;
      ev.preventDefault();
      const nova = abas[i]!;
      acoes.escolherAba(nova.dataset.id ?? "", nova.dataset.aba ?? "detalhes");
      doc.querySelector<HTMLElement>(`#detalhes [role="tab"][data-aba="${nova.dataset.aba ?? ""}"]`)?.focus();
      return;
    }
    // Esc com o foco no próprio avatar e o popover aberto fecha o popover (antes voltava o nível da gaveta).
    if (ev.key === "Escape" && alvo?.closest?.('#detalhes .gvn-avatar[aria-expanded="true"]')) { ev.preventDefault(); ev.stopPropagation(); acoes.fecharPopover(true); return; }
    const pop = alvo?.closest?.<HTMLElement>("#detalhes .gvn-pop");
    if (!pop) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); acoes.fecharPopover(true); return; }
    if (ev.key === "Tab") {
      // Foco preso no popover: o Tab dá a volta entre o rádio marcado de cada grupo e Redefinir.
      const focaveis = [...pop.querySelectorAll<HTMLElement>('button[tabindex="0"], button:not([tabindex])')];
      const i = focaveis.indexOf(doc.activeElement as HTMLElement);
      const prox = focaveis[(i + (ev.shiftKey ? -1 : 1) + focaveis.length) % focaveis.length];
      if (prox) { ev.preventDefault(); prox.focus(); }
      return;
    }
    const radio = alvo?.closest?.<HTMLButtonElement>('[role="radio"]');
    const grupo = radio?.closest<HTMLElement>('[role="radiogroup"]');
    if (!radio || !grupo) return;
    const radios = [...grupo.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const colunas = grupo.classList.contains("gvn-formas") ? 4 : 6;
    const i = proximoRadio(radios.indexOf(radio), radios.length, colunas, ev.key);
    if (i === null) return;
    ev.preventDefault();
    acoes.escolherRadio(radios[i]!);
  }, true);

  doc.addEventListener("focusout", (ev) => {
    if (trocandoCampo) return;
    const campo = campoDe(ev.target);
    if (!campo) return;
    const id = campo.dataset.id ?? "";
    const qual: CampoIdentidade = campo.dataset.campo === "titulo" ? "titulo" : "nome";
    const salvo = campo.dataset.salvo ?? "";
    if (desfeitos.has(campo)) { desfeitos.delete(campo); return; }
    const d = decidirCampo(qual, campo.value, salvo);
    if (d.tipo === "nada") { campo.value = salvo; return; }
    if (d.tipo === "vazio") { campo.value = salvo; avisarNaIdentidade(ERRO_NOME_VAZIO, doc); return; }
    campo.value = d.valor;
    campo.dataset.salvo = d.valor;
    // Fora do focusout (revisão da NOD-349): redesenhar aqui tiraria do DOM o campo ou o botão que vai receber o foco ou
    // o clique. No próximo tique o foco já chegou lá (e o render respeita o campo focado e o ponteiro apertado).
    setTimeout(() => {
      acoes.salvarCampo(id, qual, d.valor).catch(() => {
        // Só desfaz a tentativa que falhou: se a pessoa já digitou outra coisa ou outro valor foi salvo, fica como está.
        const atual = doc.querySelector<HTMLInputElement>(`#detalhes [data-campo="${qual}"][data-id="${CSS.escape(id)}"]`) ?? campo;
        const volta = desfazerAoFalhar({ salvo: atual.dataset.salvo ?? "", valor: atual.value }, d.valor, salvo);
        if (!volta) return;
        atual.dataset.salvo = volta.salvo;
        atual.value = volta.valor;
        avisarNaIdentidade(ERRO_AO_SALVAR, doc);
      });
    }, 0);
  });

  // Clique fora fecha o popover (o clique no próprio avatar é o data-act que alterna).
  doc.addEventListener("pointerdown", (ev) => {
    const pop = doc.querySelector("#detalhes .gvn-pop");
    const alvo = ev.target as HTMLElement | null;
    if (!pop || !alvo || pop.contains(alvo) || alvo.closest?.(".gvn-avatar")) return;
    acoes.fecharPopover(false);
  });

}
