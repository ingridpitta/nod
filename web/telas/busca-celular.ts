import type { MensagemAchada, PaginaDaBusca } from "../../src/contracts/busca.ts";
import {
  appInerte,
  comRecente,
  falaDoStatus,
  criarMotorDaBusca,
  filtrar,
  gravarRecentes,
  lerRecentes,
  MAXIMO_BOTS_SEM_TEXTO,
  semRecente,
  termoLimpo,
  trechoComNegrito,
  type EstadoMensagens,
} from "../lib/busca-celular.ts";
import { esc } from "../lib/escape.ts";

/**
 * NOD-380 (definido em 2026-10-28, protótipo v3): a busca única do celular, em tela cheia. Sobe de baixo já com o teclado;
 * sem texto mostra Recentes e Bots; com texto, Bots, Salas e Mensagens (o grupo vazio some). Fica fora do `render()` do
 * app: a lista se redesenha a cada letra sem tocar no campo (o foco e o teclado não piscam). O voltar do navegador fecha.
 */

export type BotDaBusca = { agenteId: string; conversaId: string; nome: string; titulo: string; sub: string; mascote: (tamanho: "md" | "lg") => string };
export type SalaDaBusca = { salaId: string; conversaId: string; nome: string; sub: string; membros: string };
/** O que a linha da mensagem mostra, resolvido com a frota e as salas que a web já tem. */
export type RostoDaMensagem = { titulo: string; sufixo: string; avatar: string };

export type ModeloDaBusca = {
  termo: string;
  recentes: readonly string[];
  bots: readonly BotDaBusca[];
  salas: readonly SalaDaBusca[];
  mensagens: EstadoMensagens<MensagemAchada>;
  rosto: (m: MensagemAchada) => RostoDaMensagem;
  data: (iso: string) => string;
};

const LUPA = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
const XIS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
const RELOGIO = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M9 5.5V9l2.5 1.5"/></svg>';
const SALA = '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M7.5 3.5 6 16.5M14 3.5l-1.5 13M3.5 7.5h13M3 12.5h13"/></svg>';

function rotulo(titulo: string, extra = ""): string {
  return `<div class="bc-rotulo"><h2>${esc(titulo)}</h2>${extra}</div>`;
}

function linhaBot(b: BotDaBusca, termo: string): string {
  return `<li><button type="button" class="bc-linha" data-bc="bot" data-agente="${esc(b.agenteId)}" data-conversa="${esc(b.conversaId)}">${b.mascote("md")}<span class="bc-txt"><b>${trechoComNegrito(b.nome, termo)}</b>${b.sub ? `<span class="bc-sub">${esc(b.sub)}</span>` : ""}</span></button></li>`;
}

function linhaSala(s: SalaDaBusca, termo: string): string {
  return `<li><button type="button" class="bc-linha" data-bc="sala" data-sala="${esc(s.salaId)}" data-conversa="${esc(s.conversaId)}"><span class="bc-av-sala">${SALA}</span><span class="bc-txt"><b>${trechoComNegrito(s.nome, termo)}</b><span class="bc-sub">${esc(s.sub || s.membros)}</span></span></button></li>`;
}

function linhaMensagem(m: MensagemAchada, modelo: ModeloDaBusca, termo: string): string {
  const r = modelo.rosto(m);
  return `<li><button type="button" class="bc-msg" data-bc="mensagem" data-id="${esc(m.id)}">${r.avatar}<span class="bc-txt"><span class="bc-msg-topo"><b>${esc(r.titulo)}</b>${r.sufixo ? `<span class="bc-em">${esc(r.sufixo)}</span>` : ""}<time datetime="${esc(m.em)}">${esc(modelo.data(m.em))}</time></span><span class="bc-trecho">${trechoComNegrito(m.trecho, termo)}</span></span></button></li>`;
}

const ESQUELETO = `<li class="bc-esqueleto" aria-hidden="true"><span class="bc-esq-av"></span><span class="bc-esq-txt"><span></span><span></span></span></li>`;
const LINHA_ERRO = `<div class="bc-erro"><span>Não deu para buscar nas mensagens</span> · <button type="button" class="bc-texto" data-bc="tentar">Tentar de novo</button></div>`;

/** O grupo Mensagens: esqueleto na 1ª página, a lista, o "Ver mais" e o erro, que nunca apaga o resto. */
function grupoMensagens(modelo: ModeloDaBusca, termo: string): string {
  const e = modelo.mensagens;
  if (e.tipo === "inativo") return "";
  if (e.tipo === "carregando") return `<section class="bc-grupo" aria-busy="true">${rotulo("Mensagens")}<ul class="bc-lista-msg">${ESQUELETO.repeat(3)}</ul></section>`;
  if (e.tipo === "erro") return `<section class="bc-grupo">${rotulo("Mensagens")}${LINHA_ERRO}</section>`;
  if (e.itens.length === 0) return "";
  const mais = e.erroNoMais
    ? LINHA_ERRO
    : e.proximo
      ? `<button type="button" class="bc-texto bc-mais" data-bc="mais"${e.maisCarregando ? ' aria-disabled="true" aria-busy="true"' : ""}>${e.maisCarregando ? "Carregando…" : "Ver mais mensagens"}</button>`
      : "";
  return `<section class="bc-grupo">${rotulo("Mensagens")}<ul class="bc-lista-msg">${e.itens.map((m) => linhaMensagem(m, modelo, termo)).join("")}</ul>${mais}</section>`;
}

/** O corpo da busca (abaixo do campo). Puro: o teste confere cada estado sem DOM. */
export function htmlDaBusca(modelo: ModeloDaBusca): string {
  const termo = termoLimpo(modelo.termo);
  if (!termo) {
    const recentes = modelo.recentes.length
      ? `<section class="bc-grupo">${rotulo("Recentes", '<button type="button" class="bc-texto" data-bc="limpar-recentes">Limpar</button>')}<ul>${modelo.recentes
          .map((r) => `<li class="bc-recente"><button type="button" class="bc-recente-termo" data-bc="recente" data-termo="${esc(r)}">${RELOGIO}<span>${esc(r)}</span></button><button type="button" class="bc-tirar" data-bc="tirar-recente" data-termo="${esc(r)}" aria-label="Tirar ${esc(r)} dos recentes">${XIS}</button></li>`)
          .join("")}</ul></section>`
      : "";
    const bots = modelo.bots.slice(0, MAXIMO_BOTS_SEM_TEXTO);
    const fila = bots.length
      ? `<section class="bc-grupo">${rotulo("Bots")}<ul class="bc-fila">${bots.map((b) => `<li><button type="button" class="bc-bot" data-bc="bot" data-agente="${esc(b.agenteId)}" data-conversa="${esc(b.conversaId)}">${b.mascote("lg")}<span>${esc(b.nome)}</span></button></li>`).join("")}</ul></section>`
      : "";
    return recentes + fila;
  }
  const bots = filtrar(modelo.bots, termo, (b) => [b.nome, b.titulo]);
  const salas = filtrar(modelo.salas, termo, (s) => [s.nome]);
  const msgs = grupoMensagens(modelo, termo);
  const nada = bots.length === 0 && salas.length === 0 && msgs === "";
  if (nada) return `<p class="bc-nada">Nada encontrado para “${esc(termo)}”.</p>`;
  return (
    (bots.length ? `<section class="bc-grupo">${rotulo("Bots")}<ul>${bots.map((b) => linhaBot(b, termo)).join("")}</ul></section>` : "") +
    (salas.length ? `<section class="bc-grupo">${rotulo("Salas")}<ul>${salas.map((s) => linhaSala(s, termo)).join("")}</ul></section>` : "") +
    msgs
  );
}

export type DepsBuscaCelular = {
  bots: () => BotDaBusca[];
  salas: () => SalaDaBusca[];
  rosto: (m: MensagemAchada) => RostoDaMensagem;
  data: (iso: string) => string;
  buscar: (termo: string, cursor: string | null, signal: AbortSignal) => Promise<PaginaDaBusca>;
  abrirBot: (agenteId: string, conversaId: string) => void;
  abrirSala: (salaId: string, conversaId: string) => void;
  abrirMensagem: (m: MensagemAchada) => void;
  reduzido: () => boolean;
  /** A chave dos recentes da pessoa da sessão (chaveDosRecentes); null sem sessão, e aí nada se lê nem grava. */
  chaveRecentes: () => string | null;
  /** Se outra camada (Seu espaço, ligação, onboarding) ainda deixa a .app inerte quando a busca fecha. */
  appInerte: () => boolean;
};

const DURACAO_MS = 300;

export function criarBuscaCelular(d: DepsBuscaCelular): { abrir(): void; fechar(): void; aberta(): boolean } {
  let raiz: HTMLElement | null = null;
  let recentes: string[] = [];
  /** O que abrir depois que o voltar tirar a entrada da busca do histórico (sairPara). */
  let depois: (() => void) | null = null;
  /** Quem tinha o foco ao abrir (a lupa): volta para ele ao fechar sem abrir nada. */
  let antes: HTMLElement | null = null;
  /** Cada abertura empilha a sua entrada com um número próprio: uma entrada velha (recarregar, avançar) não segura a tela. */
  let abertura = 0;
  /** Já pediu para sair (Cancelar, um resultado): o 2º toque antes do popstate não volta o histórico de novo. */
  let saindo = false;
  const daBusca = (estado: unknown): boolean => (estado as { nodBusca?: number } | null)?.nodBusca === abertura;
  const motor = criarMotorDaBusca<MensagemAchada>({
    buscar: d.buscar,
    agendar: (fn, ms) => window.setTimeout(fn, ms),
    cancelar: (id) => window.clearTimeout(id as number),
    aoMudar: () => pintar(),
  });

  function guarda(): Storage | null {
    try { return window.localStorage; } catch { return null; }
  }
  const campo = (): HTMLInputElement | null => raiz?.querySelector<HTMLInputElement>(".bc-input") ?? null;

  function pintar(): void {
    if (!raiz) return;
    const termo = campo()?.value ?? "";
    const lista = raiz.querySelector<HTMLElement>(".bc-corpo");
    // O innerHTML troca os botões: quem tinha o foco dentro da lista o recebe de volta no botão equivalente (WCAG 2.4.3).
    const focado = lista?.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const chaveDoFoco = focado?.dataset.bc ? { bc: focado.dataset.bc, id: focado.dataset.id ?? focado.dataset.termo ?? focado.dataset.agente ?? focado.dataset.sala ?? "" } : null;
    const mensagensAntes = lista?.querySelectorAll('[data-bc="mensagem"]').length ?? 0;
    if (lista) lista.innerHTML = htmlDaBusca({ termo, recentes, bots: d.bots(), salas: d.salas(), mensagens: motor.estado(), rosto: d.rosto, data: d.data });
    // Revisão 6 do PR #551: com o foco em "Ver mais", a página que chega leva o foco à 1ª mensagem nova (WCAG 2.4.3).
    const novas = chaveDoFoco?.bc === "mais" && lista ? [...lista.querySelectorAll<HTMLElement>('[data-bc="mensagem"]')] : [];
    if (novas.length > mensagensAntes) novas[mensagensAntes]?.focus({ preventScroll: false });
    else if (lista && chaveDoFoco) {
      const iguais = [...lista.querySelectorAll<HTMLElement>(`[data-bc="${CSS.escape(chaveDoFoco.bc)}"]`)];
      const volta = iguais.find((b) => (b.dataset.id ?? b.dataset.termo ?? b.dataset.agente ?? b.dataset.sala ?? "") === chaveDoFoco.id) ?? iguais[0] ?? lista.querySelector<HTMLElement>("button");
      if (volta) volta.focus({ preventScroll: true });
      else campo()?.focus({ preventScroll: true });
    }
    const status = raiz.querySelector<HTMLElement>(".bc-status");
    const fala = falaDoStatus(motor.estado());
    if (status && status.textContent !== fala) status.textContent = fala;
    raiz.querySelector<HTMLElement>(".bc-limpar")?.toggleAttribute("hidden", termo === "");
  }

  function lembrar(termo: string): void {
    recentes = comRecente(recentes, termo);
    gravarRecentes(guarda(), d.chaveRecentes(), recentes);
  }

  function aoVoltar(ev: PopStateEvent): void {
    if (!raiz || daBusca(ev.state)) return;
    const abrirDepois = depois;
    depois = null;
    if (abrirDepois) antes = null; // abre um resultado: o foco vai para a tela nova, não para a lupa
    fecharJa();
    abrirDepois?.();
  }

  /** Fecha a tela (a animação desce) sem mexer no histórico; quem chama já cuidou dele. */
  function fecharJa(): void {
    const el = raiz;
    if (!el) return;
    raiz = null;
    motor.parar();
    window.removeEventListener("popstate", aoVoltar);
    const app = document.querySelector<HTMLElement>(".app");
    // Outra camada pode estar aberta (Seu espaço, ligação): a .app só volta a responder se nada mais a cobre.
    if (app) app.inert = appInerte({ outraCamada: d.appInerte(), buscaAberta: false });
    campo()?.blur();
    (el.querySelector(".bc-input") as HTMLInputElement | null)?.blur();
    const voltar = antes;
    antes = null;
    // O cabeçalho pode ter sido repintado com a busca aberta: aí o foco vai para a lupa visível de agora.
    const lupa = voltar?.isConnected ? voltar : [...document.querySelectorAll<HTMLElement>('[data-act="abrir-busca"]')].find((b) => b.offsetParent !== null);
    lupa?.focus({ preventScroll: true });
    if (d.reduzido()) { el.remove(); return; }
    el.classList.add("saindo");
    window.setTimeout(() => el.remove(), DURACAO_MS);
  }

  /** Cancelar e o ✕ do sistema: volta a entrada que a busca empilhou (o popstate fecha); sem ela, fecha direto. */
  function cancelar(): void {
    if (saindo || !raiz) return;
    if (daBusca(history.state)) { saindo = true; history.back(); }
    else fecharJa();
  }

  /**
   * Abrir um resultado: primeiro o voltar tira a entrada que a busca empilhou, e só depois a tela abre (empilhando a dela).
   * Assim o histórico não guarda uma entrada morta: o voltar da conversa aberta leva para onde a pessoa estava antes da busca.
   */
  function sairPara(abrir: () => void): void {
    if (saindo || !raiz) return;
    if (!daBusca(history.state)) { antes = null; fecharJa(); abrir(); return; }
    saindo = true;
    depois = abrir;
    history.back();
  }

  function aoClicar(ev: MouseEvent): void {
    const bt = (ev.target as HTMLElement).closest<HTMLElement>("[data-bc]");
    if (!bt || !raiz) return;
    const termo = termoLimpo(campo()?.value ?? "");
    switch (bt.dataset.bc) {
      case "cancelar": return cancelar();
      case "limpar": {
        const c = campo();
        if (c) { c.value = ""; c.focus(); }
        motor.digitar("");
        return pintar();
      }
      case "recente": {
        const c = campo();
        if (c) c.value = bt.dataset.termo ?? "";
        motor.digitar(c?.value ?? "");
        return pintar();
      }
      case "tirar-recente":
        recentes = semRecente(recentes, bt.dataset.termo ?? "");
        gravarRecentes(guarda(), d.chaveRecentes(), recentes);
        return pintar();
      case "limpar-recentes":
        recentes = [];
        gravarRecentes(guarda(), d.chaveRecentes(), recentes);
        return pintar();
      // Enquanto carrega o botão fica com aria-disabled (e não disabled, que tirava o foco dele).
      case "mais": return bt.getAttribute("aria-disabled") === "true" ? undefined : motor.verMais();
      case "tentar": return motor.tentarDeNovo();
      case "bot": {
        lembrar(termo);
        const { agente = "", conversa = "" } = bt.dataset;
        return sairPara(() => d.abrirBot(agente, conversa));
      }
      case "sala": {
        lembrar(termo);
        const { sala = "", conversa = "" } = bt.dataset;
        return sairPara(() => d.abrirSala(sala, conversa));
      }
      case "mensagem": {
        const e = motor.estado();
        const m = e.tipo === "pronto" ? e.itens.find((i) => i.id === bt.dataset.id) : undefined;
        if (!m) return;
        lembrar(termo);
        return sairPara(() => d.abrirMensagem(m));
      }
    }
  }

  function abrir(): void {
    if (raiz) { campo()?.focus(); return; }
    recentes = lerRecentes(guarda(), d.chaveRecentes());
    depois = null;
    antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = document.createElement("div");
    el.className = "busca-celular";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Buscar");
    el.innerHTML = `<div class="bc-topo"><label class="bc-campo">${LUPA}<input class="bc-input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="100" placeholder="Bots, salas e mensagens" aria-label="Buscar bots, salas e mensagens"><button type="button" class="bc-limpar" data-bc="limpar" aria-label="Limpar a busca" hidden>${XIS}</button></label><button type="button" class="bc-cancelar" data-bc="cancelar">Cancelar</button></div><div class="bc-corpo"></div><p class="bc-status" role="status"></p>`;
    document.body.append(el);
    raiz = el;
    const app = document.querySelector<HTMLElement>(".app");
    if (app) app.inert = true;
    // O foco ainda dentro do toque: é ele que faz o iOS abrir o teclado junto com a tela.
    const input = campo();
    input?.focus({ preventScroll: true });
    saindo = false;
    abertura = Date.now() + Math.random();
    history.pushState({ nodBusca: abertura }, "");
    window.addEventListener("popstate", aoVoltar);
    el.addEventListener("click", aoClicar);
    // Esc fecha de qualquer ponto da tela (não só com o foco no campo).
    // Revisão 7: o Esc fica na busca (o atalho global fecharia a task ou o ditado por baixo).
    el.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); if (!ev.defaultPrevented) { ev.preventDefault(); cancelar(); } } });
    input?.addEventListener("input", () => { motor.digitar(input.value); pintar(); });
    input?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); lembrar(input.value); input.blur(); }
      else if (ev.key === "Escape") { ev.preventDefault(); cancelar(); }
    });
    const corpo = el.querySelector<HTMLElement>(".bc-corpo");
    // Rolar a lista recolhe o teclado (protótipo v3); o topo ganha vidro e linha fina quando há o que passar por baixo.
    corpo?.addEventListener("touchmove", () => { if (document.activeElement === input) input?.blur(); }, { passive: true });
    corpo?.addEventListener("scroll", () => el.querySelector(".bc-topo")?.classList.toggle("rolado", (corpo.scrollTop ?? 0) > 0), { passive: true });
    pintar();
  }

  return { abrir, fechar: cancelar, aberta: () => raiz !== null };
}

/** No boot: uma entrada da busca que sobrou no histórico (recarregar com a busca aberta) vira entrada comum. */
export function limparEntradaDaBusca(): void {
  if ((history.state as { nodBusca?: unknown } | null)?.nodBusca !== undefined) history.replaceState(null, "");
}

