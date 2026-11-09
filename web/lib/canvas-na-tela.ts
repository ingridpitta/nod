/**
 * ADA-13 (ADR-150): a página Canvas do bot, na área de Trabalho. A lista dos canvas e a vista de um: as jornadas em
 * fileiras, cada tela no tamanho real; arrastar move, ⌘/Ctrl + roda (ou pinça) dá zoom no ponteiro, Ajustar cabe
 * tudo, 100% abre a tela no tamanho real (só aí o iframe recebe o mouse), #Jx-y no endereço leva à tela. Pinos presos
 * à tela (modo Pino) e post-its por jornada; o painel lista, responde e resolve. As decisões sem DOM moram em
 * web/lib/canvas-motor.ts; o HTML do protótipo é dado e só roda no iframe sem mesma origem, com a CSP sem rede.
 */
import type { CanvasItemDto, ComentarioCanvasDto, NovoComentarioDto, VistaCanvasDto } from "../../src/contracts/canvas.ts";
import type { Api } from "./api.ts";
import { SANDBOX_ARTEFATO } from "./artefato.ts";
import {
  abertosPorEndereco, ajustar, caixaDaFileira, documentoDaTela, escolherVivos, fatorDaRoda, fracaoNaTela, guardarRascunhos, canvasDaUrl, depoisDaBusca, hashesQueFaltam, lerHash, montarLayout, urlDoCanvas,
  ignorarPonteiro, restaurarRascunhos,
  noMundo, seloDaVersao, tamanhoReal, telaNoPonto, visiveis, zoomNoPonto, type Layout, type Vista,
} from "./canvas-motor.ts";
import { esc } from "./escape.ts";

export interface CanvasNaTela {
  /** Põe a página no host (idempotente: o mesmo host e bot só redesenham o que mudou). */
  montar(host: HTMLElement, agenteId: string, nome: string): void;
  /** `canvas.mudou` do bot à vista: relê a lista e o canvas aberto. */
  aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void;
  /** O card do chat: a próxima montagem (ou a de agora) abre este canvas. */
  querAbrir(canvasId: string): void;
}

type Rascunho = { endereco: string; tipo: "pino" | "nota"; x?: number; y?: number; rotulo: string };

const dataHora = (ms: number): string => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const enderecoDe = (c: Pick<ComentarioCanvasDto, "telaId" | "jornada">): string => c.telaId ?? c.jornada ?? "";

export function criarCanvasNaTela(doc: Document, o: { api: () => Api | null }): CanvasNaTela {
  const win = doc.defaultView;
  let host: HTMLElement | null = null;
  let agenteId: string | null = null;
  let nome = "";
  let lista: CanvasItemDto[] | null = null;
  let erroLista = false;
  let aberto: string | null = null;
  let dados: VistaCanvasDto | null = null;
  let layout: Layout | null = null;
  let v: Vista = { x: 0, y: 0, zoom: 1 };
  let real: string | null = null;
  let modoPino = false;
  let rascunho: Rascunho | null = null;
  let respondendo: string | null = null;
  let mostrarResolvidos = false;
  let enviando = false;
  let erroEnvio = "";
  const blobs = new Map<string, string>();
  const vivos = new Map<string, HTMLIFrameElement>();
  /** A tela que navegou (2º load): o iframe sai e só volta quando a pessoa pede. */
  const fechadas = new Set<string>();
  let buscando = false;
  /** O hash que o servidor não tem (não se pede de novo) e a pausa depois de uma busca que falhou. */
  const ausentes = new Set<string>();
  let pausaBlobsAte = 0;
  let quadroPedido = 0;
  let pedido: string | null = null;

  const palco = (): HTMLElement | null => host?.querySelector<HTMLElement>(".cv-palco") ?? null;
  const mundo = (): HTMLElement | null => host?.querySelector<HTMLElement>(".cv-mundo") ?? null;
  const tamPalco = (): { w: number; h: number } => { const p = palco(); return { w: p?.clientWidth ?? 0, h: p?.clientHeight ?? 0 }; };

  // -------------------------------------------------------------------------------------------------------------------
  // Dados

  async function lerLista(): Promise<void> {
    const api = o.api();
    const ag = agenteId;
    if (!api || !ag) return;
    try {
      const r = await api.canvasDoAgente(ag);
      if (ag !== agenteId) return;
      lista = r.canvas;
      erroLista = false;
      const daUrl = win ? canvasDaUrl(win.location.href) : null;
      if (!aberto && daUrl && lista.some((c) => c.id === daUrl)) void abrir(daUrl);
      else if (!aberto && lista.length === 1 && lista[0]) void abrir(lista[0].id);
    } catch { if (ag === agenteId) erroLista = true; }
    if (!aberto) desenhar();
  }

  async function abrir(id: string, o2: { manter?: boolean } = {}): Promise<void> {
    const api = o.api();
    if (!api) return;
    const trocou = aberto !== id;
    aberto = id;
    if (trocou) { dados = null; layout = null; real = null; rascunho = null; fecharVivos(); desenhar(); }
    try {
      const d = await api.verCanvas(id);
      if (aberto !== id) return;
      const mudouEstrutura = !dados || dados.canvas.versao !== d.canvas.versao || trocou;
      dados = d;
      if (mudouEstrutura) {
        layout = montarLayout(d.estrutura);
        ausentes.clear(); pausaBlobsAte = 0;
        fecharVivos();
        desenhar();
        if (!o2.manter) { const foi = irParaOHash(); if (!foi) ajustarTudo(); marcarHash(foi ? undefined : null); } else { aplicarVista(); marcarHash(); }
      } else { desenharPinos(); desenharLado(); }
    } catch {
      if (aberto === id && !dados) { const h = host?.querySelector(".cv-corpo"); if (h) h.innerHTML = '<p class="cv-vazio">Não deu para abrir este canvas. <button type="button" class="pg-link" data-cv="reabrir">Tentar de novo</button></p>'; }
    }
  }

  async function buscarBlobs(): Promise<void> {
    const api = o.api();
    if (!api || !dados || !aberto || buscando) return;
    if (Date.now() < pausaBlobsAte) return;
    const quer = hashesQueFaltam(dados.estrutura, [...alvosVivos()], new Set([...blobs.keys(), ...ausentes]));
    if (!quer.length) return;
    buscando = true;
    const id = aberto;
    const recebidos = new Set<string>();
    let falhou = false;
    try {
      for (let i = 0; i < quer.length; i += 80) {
        const r = await api.blobsCanvas(id, quer.slice(i, i + 80));
        for (const [h, c] of Object.entries(r.blobs)) { blobs.set(h, c); recebidos.add(h); }
      }
    } catch { falhou = true; }
    buscando = false;
    const d = depoisDaBusca(quer, recebidos, falhou, Date.now());
    pausaBlobsAte = d.pausaAte;
    for (const h of d.ausentes) ausentes.add(h);
    // Só redesenha (e com isso pede de novo o que falta) com algo novo na mão: falhar não vira laço (codex no #649).
    if (aberto === id && recebidos.size) { desenharMiniaturas(); atualizarVivos(); }
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Desenho

  function desenhar(): void {
    if (!host) return;
    if (!aberto) { host.innerHTML = htmlDaLista(); return; }
    const d = dados;
    const voltar = (lista?.length ?? 0) > 1 ? '<button type="button" class="cv-bt" data-cv="lista" aria-label="Todos os canvas">←</button>' : "";
    const titulo = d ? `${d.canvas.issue ? `<span class="cv-issue">${esc(d.canvas.issue)}</span>` : ""}<h2 class="cv-tit">${esc(d.canvas.titulo)}</h2><span class="cv-ver">v${d.canvas.versao}${d.estrutura.versaoTexto ? ` · ${esc(d.estrutura.versaoTexto)}` : ""}</span>${seloDaVersao(d.confiavel)}` : '<h2 class="cv-tit">Abrindo…</h2>';
    const abertos = d ? d.comentarios.filter((c) => !c.paiId && !c.resolvido && !c.arquivado).length : 0;
    // Versão nova chegando com a pessoa escrevendo: o redesenho inteiro não leva o rascunho nem o foco (M7).
    const antes = guardarRascunhos(host, doc.activeElement?.id);
    host.innerHTML =
      `<section class="cv" aria-label="Canvas">` +
      `<header class="cv-topo">${voltar}${titulo}<span class="cv-esp"></span>` +
      `<button type="button" class="cv-bt" data-cv="ajustar" title="Ajustar (0)">Ajustar</button>` +
      `<button type="button" class="cv-bt" data-cv="real" title="Tamanho real (1)">100%</button>` +
      `<span class="cv-zoom" aria-live="polite"></span>` +
      `<button type="button" class="cv-bt" data-cv="pino" aria-pressed="${modoPino}" title="Comentar numa tela (P)">Pino</button>` +
      `<span class="cv-abertos" title="Comentários abertos">${abertos}</span></header>` +
      `<div class="cv-corpo"><div class="cv-palco${modoPino ? " cv-modo-pino" : ""}" tabindex="0" aria-label="Telas do protótipo: arraste para mover, Ctrl ou ⌘ com a roda para zoom">` +
      `<div class="cv-mundo">${d && layout ? htmlDoMundo() : ""}</div></div><aside class="cv-lado" aria-label="Comentários"></aside></div></section>`;
    if (d && layout) { aplicarVista(); desenharPinos(); desenharLado(); desenharMiniaturas(); restaurarRascunhos(host, antes); }
  }

  function htmlDaLista(): string {
    if (erroLista) return '<section class="cv"><p class="cv-vazio">Não deu para ler os canvas. <button type="button" class="pg-link" data-cv="relista">Tentar de novo</button></p></section>';
    if (lista === null) return '<section class="cv"><p class="cv-vazio" aria-busy="true">Lendo os canvas…</p></section>';
    if (!lista.length) return `<section class="cv"><p class="cv-vazio">Nenhum canvas ainda. Peça a ${esc(nome)} na conversa: “Importa o protótipo da NOD-123 para o canvas”.</p></section>`;
    return `<section class="cv"><ul class="cv-itens">${lista.map((c) =>
      `<li><button type="button" class="cv-item" data-cv="abrir" data-id="${esc(c.id)}">${c.issue ? `<span class="cv-issue">${esc(c.issue)}</span>` : ""}<span class="cv-item-tit">${esc(c.titulo)}</span>` +
      `<span class="cv-item-meta">v${c.versao} · ${dataHora(c.atualizadoEm)}${c.abertos ? ` · ${c.abertos} aberto${c.abertos > 1 ? "s" : ""}` : ""}</span></button></li>`).join("")}</ul></section>`;
  }

  function htmlDoMundo(): string {
    if (!layout || !dados) return "";
    const notasPorJornada = new Map<string, string[]>();
    for (const n of dados.estrutura.notas) if (n.jornada) notasPorJornada.set(n.jornada, [...(notasPorJornada.get(n.jornada) ?? []), (n.titulo ? `${n.titulo}: ` : "") + n.texto]);
    return layout.fileiras.map((f) => {
      const cx = caixaDaFileira(f);
      const notas = (notasPorJornada.get(f.id) ?? []).map((t) => `<p class="cv-nota-proto">${esc(t)}</p>`).join("");
      const cab = `<div class="cv-fileira" style="left:0;top:${f.y}px;width:${cx.w}px"><a class="cv-jid" href="#${esc(f.id)}">${esc(f.id)}</a><h3>${esc(f.titulo)}</h3>${f.resumo ? `<p>${esc(f.resumo)}</p>` : ""}${notas}` +
        `<div class="cv-postits" data-jornada="${esc(f.id)}"></div><button type="button" class="cv-bt cv-mais-nota" data-cv="nota" data-jornada="${esc(f.id)}" title="Post-it nesta jornada">+ post-it</button></div>`;
      const telas = f.telas.map((t) =>
        `<div class="cv-tela${t.tela.hoje ? " cv-hoje" : ""}" data-tela="${esc(t.tela.id)}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px">` +
        `<div class="cv-mini"><span>${esc(t.tela.titulo)}</span></div><div class="cv-pinos"></div></div>` +
        `<div class="cv-legenda" style="left:${t.x}px;top:${t.y + t.h + 14}px;width:${t.w}px"><a href="#${esc(t.tela.id)}" class="cv-tid">${esc(t.tela.id)}</a> <b>${esc(t.tela.titulo)}</b>${t.tela.hoje ? ' <span class="cv-hoje-tag">hoje</span>' : ""}${t.tela.legenda ? `<span>${esc(t.tela.legenda)}</span>` : ""}</div>`).join("");
      return cab + telas;
    }).join("");
  }

  function desenharMiniaturas(): void {
    if (!layout) return;
    for (const t of layout.porId.values()) {
      const el = host?.querySelector<HTMLElement>(`.cv-tela[data-tela="${CSS.escape(t.tela.id)}"] .cv-mini`);
      const src = t.tela.miniatura ? blobs.get(t.tela.miniatura) : undefined;
      if (el && src && /^data:image\/(webp|png|jpeg);base64,/.test(src) && !el.querySelector("img")) el.innerHTML = `<img alt="" src="${esc(src)}" draggable="false">`;
    }
  }

  function aplicarVista(): void {
    const m = mundo();
    if (!m) return;
    m.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;
    m.style.setProperty("--cv-inv", String(1 / v.zoom));
    const z = host?.querySelector(".cv-zoom");
    if (z) z.textContent = `${Math.round(v.zoom * 100)}%`;
    for (const el of host?.querySelectorAll<HTMLElement>(".cv-tela") ?? []) el.classList.toggle("cv-real", el.dataset["tela"] === real);
    pedirVivos();
  }

  function desenharPinos(): void {
    if (!host || !dados) return;
    const abertos = abertosPorEndereco(dados.comentarios);
    const visiveisC = dados.comentarios.filter((c) => !c.paiId && !c.arquivado && (mostrarResolvidos || !c.resolvido));
    for (const el of host.querySelectorAll<HTMLElement>(".cv-tela")) {
      const id = el.dataset["tela"] ?? "";
      const pinos = visiveisC.filter((c) => c.telaId === id && c.tipo === "pino" && c.x !== null && c.y !== null);
      const box = el.querySelector(".cv-pinos");
      if (!box) continue;
      box.innerHTML = pinos.map((c, i) => `<button type="button" class="cv-pino${c.resolvido ? " cv-resolvido" : ""}" data-cv="ver" data-id="${esc(c.id)}" style="left:${(c.x ?? 0.5) * 100}%;top:${(c.y ?? 0.5) * 100}%" aria-label="Comentário ${i + 1}: ${esc(c.texto.slice(0, 80))}">${i + 1}</button>`).join("") +
        (rascunho?.tipo === "pino" && rascunho.endereco === id ? `<span class="cv-pino cv-pino-novo" style="left:${(rascunho.x ?? 0.5) * 100}%;top:${(rascunho.y ?? 0.5) * 100}%">+</span>` : "") +
        ((abertos.get(id) ?? 0) && !pinos.length ? `<span class="cv-selo">${abertos.get(id)}</span>` : "");
    }
    for (const el of host.querySelectorAll<HTMLElement>(".cv-postits")) {
      const j = el.dataset["jornada"] ?? "";
      el.innerHTML = visiveisC.filter((c) => !c.telaId && c.jornada === j).map((c) =>
        `<button type="button" class="cv-postit${c.resolvido ? " cv-resolvido" : ""}" data-cv="ver" data-id="${esc(c.id)}">${esc(c.texto.length > 140 ? `${c.texto.slice(0, 140)}…` : c.texto)}<small>${esc(autorDe(c))}</small></button>`).join("");
    }
  }

  // O comentário importado sempre diz que é importado: o nome vem do protótipo e não se passa pela pessoa (revisão 6 do #649, M1).
  const autorDe = (c: ComentarioCanvasDto): string =>
    c.autorTipo === "importado" ? (c.autorNome ? `${c.autorNome} · importado` : "Importado")
      : c.autorNome ?? (c.autorTipo === "pessoa" ? "Você" : nome);
  const seloDeFora = (c: ComentarioCanvasDto): string => c.confiavel ? ""
    : ` <span class="cv-fora" title="${c.autorTipo === "importado" ? "Veio de um protótipo importado" : "Escrito num turno com conteúdo de fora"}">de fora</span>`;

  function htmlDoComentario(c: ComentarioCanvasDto, respostas: readonly ComentarioCanvasDto[]): string {
    const corpo = (x: ComentarioCanvasDto): string => `<div class="cv-c-cab"><b>${esc(autorDe(x))}</b>${seloDeFora(x)}<time>${dataHora(x.criadoEm)}</time></div><p class="cv-c-txt">${esc(x.texto)}</p>`;
    const resp = respondendo === c.id
      ? `<form class="cv-resp" data-cv-form="resposta" data-id="${esc(c.id)}"><textarea id="cv-resp-in" rows="2" maxlength="4000" aria-label="Resposta" required></textarea><div><button type="submit" class="cv-bt cv-bt-pri"${enviando ? " disabled" : ""}>Responder</button><button type="button" class="cv-bt" data-cv="cancelar-resp">Cancelar</button></div></form>`
      : "";
    return `<li class="cv-c${c.resolvido ? " cv-resolvido" : ""}${c.arquivado ? " cv-arquivado" : ""}" data-c="${esc(c.id)}">` +
      `<button type="button" class="cv-end" data-cv="ir" data-end="${esc(enderecoDe(c))}">#${esc(enderecoDe(c))}${c.tipo === "nota" ? " · post-it" : ""}</button>${c.arquivado ? ' <span class="cv-fora">tela saiu</span>' : ""}` +
      corpo(c) + (respostas.length ? `<ul class="cv-respostas">${respostas.map((r) => `<li>${corpo(r)}</li>`).join("")}</ul>` : "") + resp +
      `<div class="cv-c-acoes"><button type="button" class="pg-link" data-cv="responder" data-id="${esc(c.id)}">Responder</button><button type="button" class="pg-link" data-cv="resolver" data-id="${esc(c.id)}" data-resolvido="${c.resolvido ? "0" : "1"}">${c.resolvido ? "Reabrir" : "Resolver"}</button></div></li>`;
  }

  function desenharLado(): void {
    const lado = host?.querySelector<HTMLElement>(".cv-lado");
    if (!lado || !dados) return;
    const antes = guardarRascunhos(lado, doc.activeElement?.id);
    const topo = dados.comentarios.filter((c) => !c.paiId && (mostrarResolvidos || !c.resolvido));
    const ordem = [...topo].sort((a, b) => Number(a.resolvido) - Number(b.resolvido) || Number(a.arquivado) - Number(b.arquivado) || a.criadoEm - b.criadoEm);
    const respostasDe = (id: string): ComentarioCanvasDto[] => dados?.comentarios.filter((c) => c.paiId === id).sort((a, b) => a.criadoEm - b.criadoEm) ?? [];
    const resolvidos = dados.comentarios.filter((c) => !c.paiId && c.resolvido).length;
    const novo = rascunho
      ? `<form class="cv-novo" data-cv-form="novo"><p class="cv-novo-onde">${esc(rascunho.rotulo)} <button type="button" class="pg-link" data-cv="cancelar-novo">cancelar</button></p><textarea id="cv-novo-in" rows="3" maxlength="4000" aria-label="Comentário" required></textarea>${erroEnvio ? `<p class="cv-erro" role="alert">${esc(erroEnvio)}</p>` : ""}<button type="submit" class="cv-bt cv-bt-pri"${enviando ? " disabled" : ""}>Comentar</button></form>`
      : `<p class="cv-dica">Ligue o <b>Pino</b> e clique numa tela, ou use <b>+ post-it</b> numa jornada.</p>`;
    lado.innerHTML = `<header class="cv-lado-cab"><h3>Comentários</h3>${resolvidos ? `<button type="button" class="pg-link" data-cv="resolvidos">${mostrarResolvidos ? "Esconder" : "Mostrar"} resolvidos (${resolvidos})</button>` : ""}</header>${novo}` +
      (ordem.length ? `<ul class="cv-cs">${ordem.map((c) => htmlDoComentario(c, respostasDe(c.id))).join("")}</ul>` : '<p class="cv-dica">Nenhum comentário aberto.</p>');
    restaurarRascunhos(lado, antes);
    const ab = host?.querySelector(".cv-abertos");
    if (ab) ab.textContent = String(dados.comentarios.filter((c) => !c.paiId && !c.resolvido && !c.arquivado).length);
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Iframes vivos (no máximo 12; fora da vista saem)

  function alvosVivos(): Set<string> {
    if (!layout) return new Set();
    const t = tamPalco();
    const ids = escolherVivos(visiveis(layout, v, t), v, t, new Set(vivos.keys()));
    if (real && !ids.includes(real)) ids.splice(Math.max(0, ids.length - 1), 1, real);
    return new Set(ids.filter((id) => !fechadas.has(id)));
  }

  function pedirVivos(): void {
    if (quadroPedido) return;
    quadroPedido = win?.requestAnimationFrame(() => { quadroPedido = 0; atualizarVivos(); }) ?? 0;
    if (!win) atualizarVivos();
  }

  function fecharVivos(): void { for (const f of vivos.values()) f.remove(); vivos.clear(); fechadas.clear(); }

  function atualizarVivos(): void {
    if (!layout || !dados || !host) return;
    const alvo = alvosVivos();
    for (const [id, f] of vivos) if (!alvo.has(id)) { f.remove(); vivos.delete(id); }
    let falta = false;
    const e = dados.estrutura;
    const comuns = [...e.css, ...e.js];
    if (comuns.some((h) => !blobs.has(h))) falta = true;
    for (const id of alvo) {
      if (vivos.has(id)) continue;
      const t = layout.porId.get(id);
      const html = t ? blobs.get(t.tela.html) : undefined;
      if (!t || html === undefined || comuns.some((h) => !blobs.has(h))) { falta = true; continue; }
      const caixa = host.querySelector<HTMLElement>(`.cv-tela[data-tela="${CSS.escape(id)}"]`);
      if (!caixa) continue;
      const f = doc.createElement("iframe");
      f.className = "cv-frame";
      f.setAttribute("sandbox", SANDBOX_ARTEFATO);
      f.setAttribute("referrerpolicy", "no-referrer");
      f.setAttribute("title", t.tela.titulo);
      f.tabIndex = -1;
      let loads = 0;
      f.addEventListener("load", () => {
        loads += 1;
        // ADR-150 §4: a tela que navega (o 2º load) fecha; a miniatura fica e a pessoa reabre se quiser.
        if (loads >= 2) { f.remove(); vivos.delete(id); fechadas.add(id); caixa.classList.add("cv-fechada"); }
      });
      f.srcdoc = documentoDaTela({ html, css: e.css.map((h) => blobs.get(h) ?? ""), js: e.js.map((h) => blobs.get(h) ?? ""), novo: t.tela.novo, tamanho: t.tela.tamanho });
      caixa.insertBefore(f, caixa.querySelector(".cv-pinos"));
      vivos.set(id, f);
    }
    if (falta || hashesQueFaltam(e, [], new Set([...blobs.keys(), ...ausentes])).length) void buscarBlobs();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Navegação

  function ajustarTudo(): void { if (layout) { real = null; v = ajustar(layout.limites, tamPalco()); aplicarVista(); } }

  function irPara(endereco: string, o2: { real?: boolean } = {}): boolean {
    if (!layout) return false;
    const alvo = lerHash(endereco);
    if (!alvo) return false;
    if ("tela" in alvo) {
      const t = layout.porId.get(alvo.tela);
      if (!t) return false;
      if (o2.real ?? true) { real = t.tela.id; v = tamanhoReal(t, tamPalco()); } else { real = null; v = ajustar(t, tamPalco()); }
    } else {
      const f = layout.fileiras.find((x) => x.id === alvo.jornada);
      if (!f) return false;
      real = null;
      v = ajustar(caixaDaFileira(f), tamPalco());
    }
    aplicarVista();
    return true;
  }

  function irParaOHash(): boolean { return irPara(win?.location.hash ?? ""); }

  function marcarHash(endereco?: string | null): void {
    if (!win) return;
    const novo = urlDoCanvas(win.location.href, aberto, endereco);
    if (novo !== win.location.pathname + win.location.search + win.location.hash) win.history.replaceState(win.history.state, "", novo);
  }

  function telaDoCentro(): string | null {
    if (!layout) return null;
    const t = tamPalco();
    const c = noMundo(v, t.w / 2, t.h / 2);
    let melhor: string | null = null;
    let dist = Infinity;
    for (const x of layout.porId.values()) {
      const d = Math.hypot(x.x + x.w / 2 - c.x, x.y + x.h / 2 - c.y);
      if (d < dist) { dist = d; melhor = x.tela.id; }
    }
    return melhor;
  }

  function sairDoReal(): void { if (real) { real = null; marcarHash(null); aplicarVista(); } }

  // -------------------------------------------------------------------------------------------------------------------
  // Comentários

  async function enviarNovo(texto: string): Promise<void> {
    const api = o.api();
    if (!api || !aberto || !rascunho || enviando) return;
    const corpo: NovoComentarioDto = { texto, endereco: rascunho.endereco, tipo: rascunho.tipo, ...(rascunho.tipo === "pino" ? { x: rascunho.x ?? 0.5, y: rascunho.y ?? 0.5 } : {}) };
    enviando = true; erroEnvio = ""; desenharLado();
    try {
      const r = await api.comentarCanvas(aberto, corpo);
      dados?.comentarios.push(r.comentario);
      rascunho = null;
      modoPino = false;
      host?.querySelector(".cv-palco")?.classList.remove("cv-modo-pino");
      host?.querySelector('[data-cv="pino"]')?.setAttribute("aria-pressed", "false");
    } catch { erroEnvio = "Não deu para comentar. Tente de novo."; }
    enviando = false;
    const lado = host?.querySelector<HTMLTextAreaElement>("#cv-novo-in");
    if (!rascunho && lado) lado.value = "";
    desenharPinos(); desenharLado();
  }

  async function enviarResposta(paiId: string, texto: string): Promise<void> {
    const api = o.api();
    if (!api || !aberto || enviando) return;
    const pai = dados?.comentarios.find((c) => c.id === paiId);
    enviando = true;
    try {
      const r = await api.comentarCanvas(aberto, { texto, pai_id: paiId, ...(pai ? { endereco: enderecoDe(pai) } : {}) });
      dados?.comentarios.push(r.comentario);
      respondendo = null;
      const in_ = host?.querySelector<HTMLTextAreaElement>("#cv-resp-in");
      if (in_) in_.value = "";
    } catch { /* fica o texto no campo */ }
    enviando = false;
    desenharLado();
  }

  async function resolver(id: string, resolvido: boolean): Promise<void> {
    const api = o.api();
    if (!api) return;
    try {
      const r = await api.resolverComentarioCanvas(id, resolvido);
      if (dados) dados.comentarios = dados.comentarios.map((c) => (c.id === r.comentario.id || c.paiId === r.comentario.id ? { ...c, resolvido: r.comentario.resolvido } : c));
    } catch { /* a próxima leitura conserta */ }
    desenharPinos(); desenharLado();
  }

  function comecarRascunho(r: Rascunho): void {
    rascunho = r; erroEnvio = "";
    desenharPinos(); desenharLado();
    host?.querySelector<HTMLTextAreaElement>("#cv-novo-in")?.focus();
  }

  // -------------------------------------------------------------------------------------------------------------------
  // Eventos (delegados no host; ligados uma vez por host)

  const ligados = new WeakSet<HTMLElement>();
  function ligar(h: HTMLElement): void {
    if (ligados.has(h)) return;
    ligados.add(h);
    let arraste: { id: number; x: number; y: number; vx: number; vy: number; moveu: boolean } | null = null;

    h.addEventListener("click", (ev) => {
      const el = (ev.target as Element | null)?.closest<HTMLElement>("[data-cv], a[href^='#J']");
      if (!el) return;
      if (el instanceof HTMLAnchorElement) { ev.preventDefault(); const e = el.getAttribute("href")?.slice(1) ?? ""; if (irPara(e)) marcarHash(e); return; }
      const act = el.dataset["cv"];
      const id = el.dataset["id"] ?? "";
      if (act === "abrir") void abrir(id);
      else if (act === "lista") { aberto = null; dados = null; layout = null; fecharVivos(); marcarHash(null); desenhar(); void lerLista(); }
      else if (act === "relista") { erroLista = false; lista = null; desenhar(); void lerLista(); }
      else if (act === "reabrir" && aberto) void abrir(aberto);
      else if (act === "ajustar") { marcarHash(null); ajustarTudo(); }
      else if (act === "real") { const t = real ?? telaDoCentro(); if (t && irPara(t)) marcarHash(t); }
      else if (act === "pino") { modoPino = !modoPino; el.setAttribute("aria-pressed", String(modoPino)); palco()?.classList.toggle("cv-modo-pino", modoPino); if (!modoPino && rascunho?.tipo === "pino") { rascunho = null; desenharPinos(); desenharLado(); } }
      else if (act === "nota") { const j = el.dataset["jornada"] ?? ""; comecarRascunho({ endereco: j, tipo: "nota", rotulo: `Post-it em #${j}` }); }
      else if (act === "ver") { const li = host?.querySelector<HTMLElement>(`.cv-c[data-c="${CSS.escape(id)}"]`); li?.scrollIntoView({ block: "nearest" }); li?.classList.add("cv-c-luz"); setTimeout(() => li?.classList.remove("cv-c-luz"), 1200); }
      else if (act === "ir") { const e = el.dataset["end"] ?? ""; if (irPara(e, { real: false })) marcarHash(e); }
      else if (act === "responder") { respondendo = id; desenharLado(); host?.querySelector<HTMLTextAreaElement>("#cv-resp-in")?.focus(); }
      else if (act === "cancelar-resp") { respondendo = null; desenharLado(); }
      else if (act === "cancelar-novo") { rascunho = null; desenharPinos(); desenharLado(); }
      else if (act === "resolver") void resolver(id, el.dataset["resolvido"] === "1");
      else if (act === "resolvidos") { mostrarResolvidos = !mostrarResolvidos; desenharPinos(); desenharLado(); }
    });

    h.addEventListener("submit", (ev) => {
      const f = ev.target as HTMLFormElement;
      ev.preventDefault();
      const texto = f.querySelector("textarea")?.value.trim() ?? "";
      if (!texto) return;
      if (f.dataset["cvForm"] === "novo") void enviarNovo(texto);
      else if (f.dataset["cvForm"] === "resposta") void enviarResposta(f.dataset["id"] ?? "", texto);
    });

    h.addEventListener("keydown", (ev) => {
      const alvo = ev.target as HTMLElement;
      if (alvo.closest("textarea, input")) {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); alvo.closest("form")?.requestSubmit(); }
        else if (ev.key === "Escape") { rascunho = null; respondendo = null; desenharPinos(); desenharLado(); }
        return;
      }
      if (!alvo.closest(".cv-palco") || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.key === "Escape") { if (real) sairDoReal(); else if (modoPino) host?.querySelector<HTMLElement>('[data-cv="pino"]')?.click(); }
      else if (ev.key === "0") { marcarHash(null); ajustarTudo(); }
      else if (ev.key === "1") host?.querySelector<HTMLElement>('[data-cv="real"]')?.click();
      else if (ev.key === "p" || ev.key === "P") host?.querySelector<HTMLElement>('[data-cv="pino"]')?.click();
      else if (ev.key === "+" || ev.key === "=" || ev.key === "-") { const t = tamPalco(); v = zoomNoPonto(v, ev.key === "-" ? 1 / 1.25 : 1.25, t.w / 2, t.h / 2); real = null; aplicarVista(); }
      else if (ev.key.startsWith("Arrow")) { const p = 80; v = { ...v, x: v.x + (ev.key === "ArrowLeft" ? p : ev.key === "ArrowRight" ? -p : 0), y: v.y + (ev.key === "ArrowUp" ? p : ev.key === "ArrowDown" ? -p : 0) }; aplicarVista(); }
      else return;
      ev.preventDefault();
    });

    h.addEventListener("wheel", (ev) => {
      const p = (ev.target as Element | null)?.closest<HTMLElement>(".cv-palco");
      if (!p || !layout) return;
      ev.preventDefault();
      const r = p.getBoundingClientRect();
      if (ev.ctrlKey || ev.metaKey) v = zoomNoPonto(v, fatorDaRoda(ev.deltaY), ev.clientX - r.left, ev.clientY - r.top);
      else v = { ...v, x: v.x - ev.deltaX, y: v.y - ev.deltaY };
      if (real && (ev.ctrlKey || ev.metaKey)) { real = null; marcarHash(null); }
      aplicarVista();
    }, { passive: false });

    h.addEventListener("pointerdown", (ev) => {
      const p = (ev.target as Element | null)?.closest<HTMLElement>(".cv-palco");
      const alvo = ev.target as Element;
      if (!p || ev.button !== 0 || ignorarPonteiro({ controle: !!alvo.closest("button, a"), noReal: !!alvo.closest(".cv-real"), modoPino })) return;
      arraste = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, vx: v.x, vy: v.y, moveu: false };
      p.setPointerCapture(ev.pointerId);
      p.classList.add("cv-arrastando");
    });
    h.addEventListener("pointermove", (ev) => {
      if (!arraste || ev.pointerId !== arraste.id) return;
      const dx = ev.clientX - arraste.x;
      const dy = ev.clientY - arraste.y;
      if (!arraste.moveu && Math.hypot(dx, dy) < 4) return;
      arraste.moveu = true;
      v = { ...v, x: arraste.vx + dx, y: arraste.vy + dy };
      aplicarVista();
    });
    const soltar = (ev: PointerEvent): void => {
      if (!arraste || ev.pointerId !== arraste.id) return;
      const a = arraste;
      arraste = null;
      palco()?.classList.remove("cv-arrastando");
      if (a.moveu || ev.type === "pointercancel" || !layout) return;
      // Um clique parado: no modo Pino vira o rascunho do pino; senão, duplo clique abre a tela no tamanho real.
      const r = palco()?.getBoundingClientRect();
      if (!r) return;
      const m = noMundo(v, ev.clientX - r.left, ev.clientY - r.top);
      const t = telaNoPonto(layout, m);
      if (modoPino && t) { const f = fracaoNaTela(t, m); comecarRascunho({ endereco: t.tela.id, tipo: "pino", ...f, rotulo: `Pino em #${t.tela.id}` }); }
    };
    h.addEventListener("pointerup", soltar);
    h.addEventListener("pointercancel", soltar);
    h.addEventListener("dblclick", (ev) => {
      if (!layout || modoPino) return;
      const r = palco()?.getBoundingClientRect();
      if (!r || !(ev.target as Element).closest(".cv-palco")) return;
      const t = telaNoPonto(layout, noMundo(v, ev.clientX - r.left, ev.clientY - r.top));
      if (t && t.tela.id !== real) { irPara(t.tela.id); marcarHash(t.tela.id); }
    });
  }

  // O Esc de dentro da tela no tamanho real (a ponte do srcdoc só posta {nod:"esc"}); vale só o iframe vivo nosso.
  win?.addEventListener("message", (ev) => {
    const d = ev.data as { nod?: unknown } | null;
    if (!d || d.nod !== "esc") return;
    for (const f of vivos.values()) if (f.contentWindow === ev.source) { sairDoReal(); palco()?.focus(); return; }
  });
  win?.addEventListener("hashchange", () => { if (host?.isConnected && aberto && layout) irParaOHash(); });
  win?.addEventListener("resize", () => { if (host?.isConnected && layout) pedirVivos(); });

  return {
    montar(h, ag, n) {
      nome = n;
      const outro = ag !== agenteId;
      const novoHost = h !== host || !h.firstElementChild;
      host = h;
      ligar(h);
      if (outro) {
        agenteId = ag; lista = null; erroLista = false; aberto = null; dados = null; layout = null; blobs.clear(); ausentes.clear(); pausaBlobsAte = 0; fecharVivos(); rascunho = null;
        desenhar();
        void lerLista();
      }
      if (pedido) { const id = pedido; pedido = null; if (id !== aberto) { void abrir(id); return; } }
      if (outro) return;
      if (novoHost) { vivos.clear(); desenhar(); if (aberto) void abrir(aberto, { manter: true }); else void lerLista(); }
    },
    querAbrir(id) {
      pedido = id;
      if (host?.isConnected && agenteId) { pedido = null; if (id !== aberto) void abrir(id); }
    },
    aoFrame(frame) {
      if (frame.tipo !== "canvas.mudou" || !host?.isConnected || frame.dados["agenteId"] !== agenteId) return;
      void lerLista();
      if (aberto && frame.dados["canvasId"] === aberto) void abrir(aberto, { manter: true });
    },
  };
}
