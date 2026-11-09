import type { ArtefatoDto } from "../../src/contracts/artefato.ts";
import { ALTURA_INICIAL, documentoDoArtefato, iframeDoArtefato, lerMensagemDoArtefato, nomeDoArquivo } from "../lib/artefato.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * O lado VIVO do artefato do nod (ADR-051), só no navegador (main.ts): o card é uma string da timeline
 * (card-artefato.ts) e o iframe entra aqui, depois de cada render.
 */

type Conteudo = { titulo: string; html: string };
type Quadro = { artefatoId: string; versao: number; mensagemId: string; telaCheia: boolean; estadoUsado: unknown; cargas: number };

export type DepsArtefatos = {
  carregar(artefatoId: string, versao: number): Promise<ArtefatoDto>;
  salvar(artefatoId: string, dados: unknown): Promise<unknown>;
  salvarAoSair(artefatoId: string, dados: unknown): void;
  /** definido em 2026-09-28: 600 ms juntam uma rajada de cliques numa gravação só. */
  esperaMs?: number;
};

type ComMoveBefore = { moveBefore?: (no: Node, antes: Node | null) => void };

/** definido em 2026-09-28: depois de uma falha ao abrir, 30 s antes de pedir o mesmo artefato de novo. */
const ESPERA_APOS_FALHA_MS = 30_000;

/** Move sem recarregar (Element.moveBefore, Chromium 133+); sem suporte, devolve false e o iframe é recriado. */
function moverSemRecarregar(pai: Element, no: Element): boolean {
  const mover = (pai as Element & ComMoveBefore).moveBefore;
  if (typeof mover !== "function") return false;
  try {
    mover.call(pai, no, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * O lado VIVO dos artefatos (DOM): cria os iframes nos slots, guarda HTML/estado/altura em memória,
 * escuta o postMessage de cada iframe (filtrado por lerMensagemDoArtefato), junta as marcações e as
 * grava por PUT, abre a tela cheia e baixa o .html. Um por página.
 */
export function criarArtefatosVivos(deps: DepsArtefatos) {
  const espera = deps.esperaMs ?? 600;
  const conteudos = new Map<string, Conteudo>();
  const carregando = new Map<string, Promise<Conteudo>>();
  const estados = new Map<string, unknown>();
  const atuais = new Map<string, number>();
  const alturas = new Map<string, number>();
  const quadros = new Map<HTMLIFrameElement, Quadro>();
  const pendentes = new Map<string, { dados: unknown; timer: number }>();
  const falhas = new Map<string, number>();
  let estacionamento: HTMLDivElement | null = null;

  const chave = (artefatoId: string, versao: number) => `${artefatoId}:${versao}`;
  const versaoAtual = (artefatoId: string) => atuais.get(artefatoId) ?? 0;
  const conhecer = (artefatoId: string, versao: number) => {
    if (versao > versaoAtual(artefatoId)) atuais.set(artefatoId, versao);
  };

  function status(artefatoId: string, texto: string): void {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-artefato="${CSS.escape(artefatoId)}"] .artefato-status`)) el.textContent = texto;
  }

  function gravar(artefatoId: string, dados: unknown): void {
    deps.salvar(artefatoId, dados).then(() => status(artefatoId, ""), () => status(artefatoId, "Não foi possível salvar o que você marcou."));
  }

  function agendar(artefatoId: string, dados: unknown): void {
    const antes = pendentes.get(artefatoId);
    if (antes) window.clearTimeout(antes.timer);
    const timer = window.setTimeout(() => {
      pendentes.delete(artefatoId);
      gravar(artefatoId, dados);
    }, espera);
    pendentes.set(artefatoId, { dados, timer });
  }

  function carregar(artefatoId: string, versao: number): Promise<Conteudo> {
    const k = chave(artefatoId, versao);
    const pronto = conteudos.get(k);
    if (pronto) return Promise.resolve(pronto);
    const emCurso = carregando.get(k);
    if (emCurso) return emCurso;
    const p = deps.carregar(artefatoId, versao).then((dto) => {
      const c = { titulo: dto.artefato.titulo, html: dto.versao.html };
      conteudos.set(k, c);
      conhecer(artefatoId, dto.artefato.versaoAtual);
      // O estado local (marcado nesta aba) é mais novo que o lido: só o lido entra se não houver local.
      if (!estados.has(artefatoId)) estados.set(artefatoId, dto.estado?.dados ?? null);
      return c;
    });
    carregando.set(k, p);
    p.catch(() => undefined).finally(() => carregando.delete(k));
    return p;
  }

  /** O iframe dentro do slot (ou da tela cheia), registrado para o postMessage e para o 2º `load`. */
  function montar(alvo: Element, q: Omit<Quadro, "estadoUsado" | "cargas">, conteudo: Conteudo, classe?: string): HTMLIFrameElement | null {
    const estado = estados.get(q.artefatoId) ?? null;
    alvo.innerHTML = iframeDoArtefato({ documento: documentoDoArtefato(conteudo.html, estado), titulo: conteudo.titulo, chave: q.mensagemId, ...(q.telaCheia ? {} : { altura: alturas.get(q.mensagemId) ?? ALTURA_INICIAL }), ...(classe ? { classe } : {}) });
    const quadro = alvo.querySelector("iframe");
    if (!quadro) return null;
    const registro: Quadro = { ...q, estadoUsado: estado, cargas: 0 };
    quadros.set(quadro, registro);
    // O srcdoc carrega UMA vez. Um segundo `load` é a página indo para outro endereço (link, location,
    // meta refresh) — o sandbox não impede o iframe de navegar a si mesmo. Fecha na hora, sem mostrar
    // a página de fora (ADR-051: o pedido já saiu; o fechamento impede que ela fique no card).
    quadro.addEventListener("load", () => {
      registro.cargas += 1;
      if (registro.cargas > 1) {
        quadros.delete(quadro);
        const aviso = document.createElement("p");
        aviso.className = "artefato-bloqueado";
        aviso.textContent = "O artefato tentou abrir outra página e foi fechado.";
        quadro.replaceWith(aviso);
      }
    });
    return quadro;
  }

  function hidratarSlot(slot: HTMLElement): void {
    const card = slot.closest<HTMLElement>("[data-artefato]");
    const artefatoId = card?.dataset.artefato;
    const versao = Number(card?.dataset.versao);
    const mensagemId = slot.dataset.artefatoSlot;
    if (!card || !artefatoId || !mensagemId || !Number.isInteger(versao)) return;
    const recolhido = slot.closest("details");
    if (recolhido && !recolhido.open) return;
    if (slot.querySelector("iframe, .artefato-bloqueado")) return;
    // O iframe estacionado antes do render volta sem recarregar (estado, foco e rolagem preservados).
    for (const [quadro, q] of quadros) {
      if (q.mensagemId === mensagemId && !q.telaCheia && quadro.parentElement === estacionamento && moverSemRecarregar(slot, quadro)) return;
    }
    const k = chave(artefatoId, versao);
    const pronto = conteudos.get(k);
    if (pronto) {
      // montar troca o "Abrindo…" (ou o aviso de falha) pelo iframe.
      montar(slot, { artefatoId, versao, mensagemId, telaCheia: false }, pronto);
      return;
    }
    // Falhou há pouco: não pede de novo a cada render (cada frame SSE regrava a timeline).
    const falhou = falhas.get(k);
    if (falhou !== undefined && Date.now() - falhou < ESPERA_APOS_FALHA_MS) {
      slot.innerHTML = '<p class="artefato-carregando">Não foi possível abrir o artefato.</p>';
      return;
    }
    if (!slot.hasChildNodes()) slot.innerHTML = '<p class="artefato-carregando">Abrindo artefato…</p>';
    carregar(artefatoId, versao).then(
      () => hidratar(document),
      () => {
        falhas.set(k, Date.now());
        hidratar(document);
      },
    );
  }

  /** Depois de cada render da timeline: iframes nos slots vazios, estacionados de volta, órfãos esquecidos. */
  function hidratar(raiz: ParentNode): void {
    for (const card of raiz.querySelectorAll<HTMLElement>("[data-artefato]")) conhecer(card.dataset.artefato ?? "", Number(card.dataset.versao) || 0);
    for (const slot of raiz.querySelectorAll<HTMLElement>("[data-artefato-slot]")) hidratarSlot(slot);
    for (const [quadro] of quadros) {
      if (!quadro.isConnected || quadro.parentElement === estacionamento) {
        quadros.delete(quadro);
        if (quadro.isConnected) quadro.remove();
      }
    }
  }

  /**
   * Antes de a timeline ser regravada: os iframes vivos vão para um canto escondido SEM recarregar
   * (moveBefore) e hidratar() os devolve aos slots novos. Sem moveBefore não há o que fazer — o iframe
   * será recriado a partir do cache, com o estado mais novo.
   */
  function estacionar(): void {
    if (!estacionamento) {
      estacionamento = document.createElement("div");
      estacionamento.hidden = true;
      estacionamento.className = "artefatos-estacionados";
      document.body.append(estacionamento);
    }
    for (const [quadro, q] of quadros) if (!q.telaCheia && quadro.isConnected && quadro.parentElement !== estacionamento) moverSemRecarregar(estacionamento, quadro);
  }

  function aoReceber(ev: MessageEvent): void {
    for (const [quadro, q] of quadros) {
      const m = lerMensagemDoArtefato(ev, quadro.contentWindow);
      if (!m) continue;
      if (m.tipo === "altura") {
        if (q.telaCheia) return;
        alturas.set(q.mensagemId, m.px);
        quadro.style.height = `${m.px}px`;
        return;
      }
      // Só a versão ATUAL grava: a anterior, recolhida, não sobrescreve o que a nova marcou.
      if (q.versao !== versaoAtual(q.artefatoId)) return;
      estados.set(q.artefatoId, m.dados);
      agendar(q.artefatoId, m.dados);
      return;
    }
  }
  window.addEventListener("message", aoReceber);
  window.addEventListener("pagehide", () => {
    for (const [artefatoId, p] of pendentes) {
      window.clearTimeout(p.timer);
      deps.salvarAoSair(artefatoId, p.dados);
    }
    pendentes.clear();
  });

  function doCard(mensagemId: string): { artefatoId: string; versao: number; titulo: string } | null {
    const card = document.querySelector<HTMLElement>(`[data-mensagem-artefato="${CSS.escape(mensagemId)}"]`);
    const versao = Number(card?.dataset.versao);
    if (!card?.dataset.artefato || !Number.isInteger(versao)) return null;
    return { artefatoId: card.dataset.artefato, versao, titulo: card.dataset.titulo ?? "artefato" };
  }

  /** Recria os iframes EM LINHA de um artefato cujo estado mudou por outro caminho (tela cheia). */
  function renovar(artefatoId: string): void {
    for (const [quadro, q] of [...quadros]) {
      if (q.artefatoId !== artefatoId || q.telaCheia || q.estadoUsado === estados.get(artefatoId)) continue;
      const slot = quadro.parentElement;
      const conteudo = conteudos.get(chave(q.artefatoId, q.versao));
      quadros.delete(quadro);
      if (slot && conteudo) montar(slot, q, conteudo);
    }
  }

  async function telaCheia(mensagemId: string): Promise<void> {
    const alvo = doCard(mensagemId);
    if (!alvo) return;
    const conteudo = await carregar(alvo.artefatoId, alvo.versao);
    const dialog = document.createElement("dialog");
    dialog.className = "artefato-dialogo";
    dialog.setAttribute("aria-label", conteudo.titulo);
    dialog.innerHTML = `<header class="artefato-cab"><span class="artefato-marca" aria-hidden="true">▣</span><b class="artefato-titulo">${esc(conteudo.titulo)}</b><span class="artefato-meta">v${alvo.versao}</span><span class="artefato-acoes">${botao("artefato-baixar", "Baixar .html", { classe: "link sm", dados: { mensagem: mensagemId } })}<button type="button" class="bt sm" data-fechar aria-label="Fechar tela cheia">✕</button></span></header><div class="artefato-dialogo-corpo"></div>`;
    document.body.append(dialog);
    const corpo = dialog.querySelector(".artefato-dialogo-corpo");
    const quadro = corpo ? montar(corpo, { artefatoId: alvo.artefatoId, versao: alvo.versao, mensagemId, telaCheia: true }, conteudo, "artefato-quadro tela-cheia") : null;
    dialog.querySelector("[data-fechar]")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      if (quadro) quadros.delete(quadro);
      dialog.remove();
      renovar(alvo.artefatoId);
    });
    dialog.showModal();
  }

  async function baixar(mensagemId: string): Promise<void> {
    const alvo = doCard(mensagemId);
    if (!alvo) return;
    const conteudo = await carregar(alvo.artefatoId, alvo.versao);
    const url = URL.createObjectURL(new Blob([documentoDoArtefato(conteudo.html, estados.get(alvo.artefatoId) ?? null)], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeDoArquivo(conteudo.titulo);
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /**
   * "Abrir em nova aba" (definido em 2026-10-03, canvas "Uma conversa de verdade · depois"). ADR-051 continua: o HTML
   * do bot nunca vira página desta origem. A aba nova é um invólucro NOSSO (sem script) com o mesmo iframe sandbox da
   * conversa — o artefato roda na origem opaca, como aqui. O blob tem a origem do Nod, mas só o invólucro mora nele.
   * Na aba, o estado não é gravado (não há ninguém ouvindo a ponte); é para olhar grande, não para editar.
   */
  async function novaAba(mensagemId: string): Promise<void> {
    const alvo = doCard(mensagemId);
    if (!alvo) return;
    const conteudo = await carregar(alvo.artefatoId, alvo.versao);
    const quadro = iframeDoArtefato({ documento: documentoDoArtefato(conteudo.html, estados.get(alvo.artefatoId) ?? null), titulo: conteudo.titulo, chave: `${alvo.artefatoId}:${alvo.versao}:aba`, classe: "quadro" });
    const pagina = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${esc(conteudo.titulo)}</title><style>html,body{margin:0;height:100%;background:#fff}.quadro{display:block;width:100%;height:100%;border:0}</style></head><body>${quadro}</body></html>`;
    const url = URL.createObjectURL(new Blob([pagina], { type: "text/html;charset=utf-8" }));
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // <details> de versão anterior aberto: o slot dele ganha o iframe só agora (toggle não borbulha).
  document.addEventListener("toggle", (ev) => {
    const el = ev.target;
    if (el instanceof HTMLDetailsElement && el.open && el.classList.contains("artefato-anterior")) hidratar(el);
  }, true);

  return { hidratar, estacionar, telaCheia, baixar, novaAba };
}
