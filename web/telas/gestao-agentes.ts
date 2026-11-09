import type { PedidoSecao } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";
import { ehCelular } from "../lib/celular.ts";
import type { AcaoGestao, BotGerido } from "./gestao.ts";
import { htmlMenuConta, type DadosMenuConta } from "./menu-conta.ts";

export type { AcaoGestao, BotGerido } from "./gestao.ts";
export { textoDuplicar } from "./gestao.ts";

export function dialogo(html: string, menu = false): HTMLDialogElement {
  document.getElementById("gestao-dialogo")?.remove();
  const d = document.createElement("dialog");
  d.id = "gestao-dialogo";
  d.className = menu ? "bot-menu" : "bot-dialogo";
  d.innerHTML = html;
  const titulo = d.querySelector("h2");
  if (titulo) { titulo.id = "gestao-dialogo-titulo"; d.setAttribute("aria-labelledby", titulo.id); }
  const focoAnterior = document.activeElement;
  d.addEventListener("click", (e) => { e.stopPropagation(); if (e.target === d) d.close(); });
  // O foco só volta à origem se a ação do diálogo não o levou a outro lugar (Renomear foca o nome na gaveta).
  d.addEventListener("close", () => { const foi = document.activeElement; d.remove(); if (focoAnterior instanceof HTMLElement && focoAnterior.isConnected && (!foi || foi === document.body || d.contains(foi) || foi === focoAnterior)) focoAnterior.focus(); });
  document.body.append(d);
  d.showModal();
  return d;
}

/**
 * O corpo do menu do bot (os itens). NOD-382: `celular` dá o menu curto (no máximo 5); fora dele, os 9 de sempre.
 */
export function corpoDoMenu(a: BotGerido, dona: boolean, celular: boolean): string {
  const caminhos: Record<AcaoGestao, string> = {
    fixar: "M16 3l5 5-4 1-4 4v4l-2 2-3-5-5-3 2-2h4l4-4z M8 16l-5 5",
    mover: "M3 5h6l2 3h10v12H3z",
    "nao-lido": "M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
    renomear: "M16 3l5 5-12 12-6 1 1-6z M13 6l5 5",
    perfil: "M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 10h6 M9 12h6 M17 16h6",
    duplicar: "M8 8h13v13H8z M4 16H3V3h13v1",
    copiar: "M8 8h13v13H8z M4 16H3V3h13v1",
    "ver-perfil": "M12 12a4 4 0 100-8 4 4 0 000 8 M4 21c0-4 4-6 8-6s8 2 8 6",
    ocultar: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M3 3l18 18 M10 10a3 3 0 004 4",
    excluir: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
    restaurar: "M3 4v6h6 M3 10a9 9 0 119 11",
  };
  const item = (acao: AcaoGestao, _icone: string, texto: string, perigo = false) => `<button type="button" role="menuitem" data-gestao="${acao}"${perigo ? ' class="danger"' : ""}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${caminhos[acao]}"/></svg>${texto}</button>`;
  const rotulo: Partial<Record<AcaoGestao, [string, string, boolean?]>> = {
    fixar: ["♧", a.papel === "nod" ? (a.fixado ? "Deixar discreto" : "Voltar ao topo") : a.fixado ? "Desafixar" : "Fixar"],
    "nao-lido": ["◉", a.naoLido ? "Marcar como lido" : "Marcar como não lido"],
    mover: ["▱", `Time · ${esc(a.secao?.trim() || "Sem time")}`],
    "ver-perfil": ["◎", "Ver perfil"],
    ocultar: ["◌", "Mostrar na lista"],
    excluir: ["♲", "Excluir", true],
  };
  // NOD-382: no celular o menu tem no máximo 5 itens; o resto mora no perfil do bot. O desktop segue com os 9 de antes.
  // definido em 2026-10-07 (ADR-081): o Nod tem o menu dele — fixar vira "Voltar ao topo"/"Deixar discreto" (desafixado ele
  // mora na barra de cima da lateral) e não há mover, renomear, duplicar, ocultar nem excluir; a linha final diz por quê.
  return celular
    ? itensDoMenuCelular(a, dona).map((acao) => { const [ic, txt, perigo] = rotulo[acao]!; return item(acao, ic, txt, perigo); }).join("")
    : a.papel === "nod"
    ? item("fixar", "♧", a.fixado ? "Deixar discreto" : "Voltar ao topo") + item("nao-lido", "◉", a.naoLido ? "Marcar como lido" : "Marcar como não lido") + '<hr>' + item("perfil", "⚙", "Editar perfil") + item("copiar", "▢", "Copiar ID da conversa") + '<hr><p class="menu-nota">O Nod fica sempre com você: não dá para excluir, ocultar nem renomear.</p>'
    : `${dona ? item("fixar", "♧", a.fixado ? "Desafixar" : "Fixar") + item("mover", "▱", `Time · ${esc(a.secao?.trim() || "Sem time")}`) + item("nao-lido", "◉", a.naoLido ? "Marcar como lido" : "Marcar como não lido") + '<hr>' + item("renomear", "✎", "Renomear bot") + item("perfil", "⚙", "Editar perfil") : ""}${item("duplicar", "▣", "Duplicar")}<hr>${item("copiar", "▢", "Copiar ID da conversa")}${dona ? '<hr>' + item("ocultar", "◌", a.oculto ? "Mostrar na barra lateral" : "Ocultar da barra lateral") + item("excluir", "♲", "Excluir", true) : ""}`;
}

export function abrirMenu(a: BotGerido, dona: boolean, ancora: HTMLElement, executar: (acao: AcaoGestao) => void, ponto?: { x: number; y: number }): void {
  const corpo = corpoDoMenu(a, dona, ehCelular());
  const d = dialogo(`<div role="menu" aria-label="Ações de ${esc(a.nome)}"><p class="menu-nome">${esc(a.nome)}</p>${corpo}</div>`, true);
  // definido em 2026-09-30: no clique direito o menu nasce no cursor; sem ponto, ao lado do que o abriu.
  const r = ancora.getBoundingClientRect();
  const x = ponto ? ponto.x + 4 : r.right;
  const y = ponto ? ponto.y + 4 : r.top;
  d.style.left = `${Math.max(12, Math.min(x, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.max(12, Math.min(y, window.innerHeight - d.offsetHeight - 12))}px`;
  d.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gestao]");
    if (btn) { const acao = btn.dataset.gestao as AcaoGestao; d.close(); executar(acao); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    // NOD-379: a cópia inerte do bot segurado (celular) mora no diálogo; as setas só andam pelos itens.
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button:not([inert] button)")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
}

/**
 * ADR-125 (NOD-349): o Compartilhar do topo da gaveta — o que já existia no menu do bot, num menu pequeno ancorado no
 * botão: Copiar ID da conversa e Duplicar bot (o Nod não se duplica, ADR-081).
 */
export function abrirMenuCompartilhar(a: BotGerido, ancora: HTMLElement, executar: (acao: "copiar" | "duplicar") => void): void {
  const item = (acao: "copiar" | "duplicar", texto: string) => `<button type="button" role="menuitem" data-gestao="${acao}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8h13v13H8z M4 16H3V3h13v1"/></svg>${texto}</button>`;
  const d = dialogo(`<div role="menu" aria-label="Compartilhar ${esc(a.nome)}">${item("copiar", "Copiar ID da conversa")}${a.papel === "nod" ? "" : item("duplicar", "Duplicar bot")}</div>`, true);
  d.classList.add("menu-compartilhar");
  ancora.setAttribute("aria-expanded", "true");
  d.addEventListener("close", () => ancora.setAttribute("aria-expanded", "false"));
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.max(12, Math.min(r.bottom + 6, window.innerHeight - d.offsetHeight - 12))}px`;
  d.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gestao]");
    if (btn) { const acao = btn.dataset.gestao as "copiar" | "duplicar"; d.close(); executar(acao); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  d.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * NOD-370: `depois` roda logo depois de fechar, já fora do diálogo (ex.: pôr o foco na linha que ficou no lugar). Ele
 * recebe se o diálogo ainda estava aberto (a pessoa pode ter saído com Esc com o pedido em andamento); um erro nele não
 * vira o erro do salvar.
 */
export function pedirGestao(titulo: string, corpo: string, confirmar: string, salvar: (dados: FormData) => Promise<void>, perigo = false, depois?: (dialogoAindaAberto: boolean) => void): void {
  const d = dialogo(`<form><h2>${esc(titulo)}</h2>${corpo}<p class="dialogo-erro" role="alert"></p><div class="acoes"><button class="bt" type="button" data-cancelar>Cancelar</button><button class="bt ${perigo ? "danger" : "pri"}" type="submit">${esc(confirmar)}</button></div></form>`);
  d.querySelector("[data-cancelar]")?.addEventListener("click", () => d.close());
  d.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault(); e.stopPropagation();
    const form = e.currentTarget as HTMLFormElement;
    const dados = new FormData(form);
    for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    void salvar(dados).then(() => {
      const aberto = d.open;
      d.close();
      // O erro do `depois` sobe à parte (window.onerror): a ação já foi feita e o diálogo não mostra falha.
      try { depois?.(aberto); } catch (erro) { queueMicrotask(() => { throw erro; }); }
    }, () => {
      d.querySelector(".dialogo-erro")!.textContent = "Não foi possível concluir. Confira o aviso da página e tente novamente.";
      for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false;
    });
  });
  d.querySelector<HTMLInputElement>("input")?.select();
}

/**
 * O menu da conta (web/telas/menu-conta.ts) sobre o mesmo diálogo dos menus do bot. NOD-367: cada item abre uma seção das
 * Configurações (`secao` recebe o pedido: "geral", "agentes", "feedback", "ajuda", "conexao"); Sair e o convite da conta
 * vão por `conta`.
 */
export function abrirMenuConta(ancora: HTMLElement, dados: DadosMenuConta, acoes: { secao(s: PedidoSecao): void; conta?(qual: string): void }, folha = false): void {
  const d = dialogo(htmlMenuConta(dados), true);
  d.classList.add("menu-conta");
  // NOD-379: no celular o avatar fica no topo da inicial e o menu vira folha de baixo (o CSS a prende embaixo).
  if (folha) d.classList.add("folha");
  // Nasce acima do avatar, alinhado à esquerda da barra (a largura dela menos as margens).
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, r.left)}px`;
  d.style.top = folha ? "auto" : `${Math.max(12, r.top - d.offsetHeight - 10)}px`;
  d.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    const secao = alvo.closest<HTMLElement>("[data-secao]")?.dataset.secao as PedidoSecao | undefined;
    if (secao) { d.close(); acoes.secao(secao); return; }
    // NOD-345: Sair (e o convite do espaço provisório) saem da sessão ou abrem o cartão na conversa do Nod.
    const conta = alvo.closest<HTMLElement>("[data-conta]")?.dataset.conta;
    if (conta) { d.close(); acoes.conta?.(conta); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  d.querySelector<HTMLButtonElement>("[data-secao]:not(.mc-faixa [data-secao])")?.focus();
}

/**
 * NOD-382: os itens do menu do bot no celular (toque longo e ⋯), no máximo 5. Excluir só no bot da pessoa e nunca no Nod
 * (ADR-081); o bot de outra pessoa só abre o perfil.
 */
export function itensDoMenuCelular(a: Pick<BotGerido, "papel" | "oculto">, dona: boolean): AcaoGestao[] {
  if (a.papel === "nod") return ["fixar", "nao-lido", "ver-perfil"];
  if (!dona) return ["ver-perfil"];
  // O bot oculto não está na frota (o perfil não abre): em Configurações › Agentes › Ocultos, Mostrar na lista ou Excluir.
  if (a.oculto) return ["ocultar", "excluir"];
  return ["fixar", "nao-lido", "mover", "ver-perfil", "excluir"];
}

/**
 * NOD-382: Compartilhar do perfil no celular — a folha que sobe de baixo, com Copiar ID e Duplicar (linhas de 56). O Nod
 * não se duplica (ADR-081).
 */
export function abrirFolhaCompartilhar(a: BotGerido, executar: (acao: "copiar" | "duplicar") => void): void {
  const item = (acao: "copiar" | "duplicar", texto: string) => `<button type="button" role="menuitem" class="pfc-folha-linha" data-gestao="${acao}">${esc(texto)}</button>`;
  const d = dialogo(`<div role="menu" aria-label="Compartilhar ${esc(a.nome)}"><p class="pfc-folha-titulo">Compartilhar ${esc(a.nome)}</p>${item("copiar", "Copiar ID")}${a.papel === "nod" ? "" : item("duplicar", "Duplicar")}</div>`, true);
  d.classList.add("pfc-folha");
  d.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gestao]");
    if (btn) { const acao = btn.dataset.gestao as "copiar" | "duplicar"; d.close(); executar(acao); }
  });
  d.querySelector<HTMLButtonElement>("button")?.focus();
}

/**
 * NOD-382: a confirmação do Excluir no celular — folha com "Excluir ‹nome›?" (17/600), a frase curta, o botão de contorno
 * vermelho e Cancelar, os dois com 44. Falhou: a folha fica e diz por quê.
 */
export function confirmarExclusaoNaFolha(a: BotGerido, excluir: () => Promise<void>, depois?: (dialogoAindaAberto: boolean) => void): void {
  const d = dialogo(`<form class="pfc-confirma"><h2>Excluir ${esc(a.nome)}?</h2><p>As rotinas pausam, os acessos são revogados e o que está rodando para. Dá para restaurar em Configurações › Agentes.</p><p class="dialogo-erro" role="alert"></p><button type="submit" class="pfc-contorno pfc-perigo">Excluir</button><button type="button" class="pfc-contorno pfc-cancelar" data-cancelar>Cancelar</button></form>`);
  d.classList.add("pfc-folha");
  d.querySelector("[data-cancelar]")?.addEventListener("click", () => d.close());
  d.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault(); e.stopPropagation();
    const form = e.currentTarget as HTMLFormElement;
    for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
    void excluir().then(() => {
      const aberto = d.open;
      d.close();
      try { depois?.(aberto); } catch (erro) { queueMicrotask(() => { throw erro; }); }
    }, () => {
      d.querySelector(".dialogo-erro")!.textContent = "Não deu para excluir. Tente de novo.";
      for (const b of form.querySelectorAll<HTMLButtonElement>("button")) b.disabled = false;
    });
  });
  d.querySelector<HTMLButtonElement>("[data-cancelar]")?.focus();
}

