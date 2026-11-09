/**
 * ADA-13 (ADR-150): o cartão "Canvas · Do nod" do Marketplace e a gaveta dele. É um app nativo (não um conector):
 * instalar é da pessoa; o nível é por bot (Nenhum · Ver e comentar · Criar e publicar). Dar acesso fica só na tela
 * (`canvas.dar_acesso` é `falta` no chat: um bot se dar acesso seria escalada de privilégio). O estado vem de
 * GET /api/canvas/app, guardado aqui (lido uma vez quando o Marketplace aparece; cada ação devolve o novo).
 */
import type { AppCanvasDto, NivelCanvasDto } from "../../src/contracts/canvas.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { meusBots } from "./app-acesso.ts";

export const SLUG_CANVAS = "canvas";
export const ROTULO_NIVEL_CANVAS: Readonly<Record<"nenhum" | NivelCanvasDto, string>> = { nenhum: "Nenhum", ver_comentar: "Ver e comentar", criar_publicar: "Criar e publicar" };

type Situacao = { app: AppCanvasDto | null; erro: boolean };
let atual: Situacao = { app: null, erro: false };
let lendo = false;
/** null = sem sessão ainda (não lê; o próximo desenho tenta). */
let ler: (() => Promise<AppCanvasDto> | null) | null = null;
let aoMudar: () => void = () => undefined;

/** O main liga a leitura (a API) e o redesenho. */
export function configurarAppCanvas(o: { ler: () => Promise<AppCanvasDto> | null; aoMudar: () => void }): void { ler = o.ler; aoMudar = o.aoMudar; }
/** Reabrir o Marketplace tenta de novo depois de uma falha. */
export function esquecerErroDoCanvas(): void { if (atual.erro) atual = { app: null, erro: false }; }
/** A resposta de uma ação (instalar, desinstalar, nível) já é o estado novo. */
export function guardarAppCanvas(app: AppCanvasDto): void { atual = { app, erro: false }; aoMudar(); }

function lerSeFalta(): void {
  // Uma falha não relê sozinha a cada desenho (o redesenho do fim chamaria de novo): só ao reabrir o Marketplace.
  if (atual.app || atual.erro || lendo || !ler) return;
  const p = ler();
  if (!p) return;
  lendo = true;
  void p.then((app) => { atual = { app, erro: false }; }, () => { atual = { app: null, erro: true }; }).finally(() => { lendo = false; aoMudar(); });
}

const ICONE_CANVAS = '<span class="app-logo cv-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="10" height="7" rx="1.3"/><rect x="10.5" y="13" width="10" height="6.5" rx="1.3"/><path d="M8.5 12.5v3.5h2"/></svg></span>';
const DESCRICAO = "Os protótipos do Gil num canvas: as jornadas lado a lado, cada tela no tamanho real, com pinos e post-its que o bot lê.";

export function nivelCanvasDe(app: AppCanvasDto | null, agenteId: string): "nenhum" | NivelCanvasDto {
  return app?.acessos.find((a) => a.agenteId === agenteId)?.nivel ?? "nenhum";
}

export function cartaoCanvas(estado: Pick<Estado, "frota" | "sessao">, selecionado: boolean): string {
  lerSeFalta();
  const app = atual.app;
  const instalado = app?.instalado === true;
  const usam = app?.acessos.length ?? 0;
  const pil = instalado ? '<span class="pilula pilula-ok">Instalado</span>' : "";
  const acao = !app
    ? (atual.erro ? '<span class="mudo">Não deu para ler</span>' : '<span class="mudo">…</span>')
    : instalado
      ? `<span class="mkt-uso${usam ? "" : " mudo"}">${usam ? `${usam === 1 ? `${esc(meusBots(estado).find((b) => b.id === app.acessos[0]?.agenteId)?.nome ?? "1 bot")} usa` : `${usam} bots usam`}` : "Nenhum bot usa ainda"}</span>`
      : botao("instalar-canvas", "Instalar", { classe: "sm" });
  return `<article class="app-card${instalado ? " sit-conectado" : " sit-nao_conectado"}${selecionado ? " selected" : ""}" data-app-busca="canvas do nod protótipos design telas" id="app-${SLUG_CANVAS}">
    <button type="button" class="app-card-abrir" data-act="abrir-app" data-id="${SLUG_CANVAS}" aria-label="Ver Canvas"></button>
    <div class="app-card-heading">${ICONE_CANVAS}<span class="app-card-nome"><h3>Canvas</h3><small>Do nod</small></span>${pil}</div>
    <p>${esc(DESCRICAO)}</p>
    <div class="app-card-actions">${acao}</div>
  </article>`;
}

function seletor(agenteId: string, nome: string, n: "nenhum" | NivelCanvasDto): string {
  const op = (x: "nenhum" | NivelCanvasDto): string => `<button type="button" class="seg${x === n ? " ativo" : ""}" data-act="nivel-canvas" data-id="${esc(agenteId)}" data-nivel="${x}" aria-pressed="${x === n}">${esc(ROTULO_NIVEL_CANVAS[x])}</button>`;
  return `<div class="segmentado" role="group" aria-label="${esc(`Acesso de ${nome} ao Canvas`)}">${op("nenhum")}${op("ver_comentar")}${op("criar_publicar")}</div>`;
}

export function gavetaCanvas(estado: Pick<Estado, "frota" | "sessao">): string {
  lerSeFalta();
  const app = atual.app;
  const instalado = app?.instalado === true;
  const niveis = `<section class="gaveta-secao"><h3>O que os bots podem fazer</h3>
    <div class="nivel-caixa"><b>Ver e comentar</b><p>Listar e ler os canvas, comentar com pino ou post-it e resolver.</p></div>
    <div class="nivel-caixa"><b>Criar e publicar</b><p>Também publicar versões novas e importar um protótipo do nod-prototipos.</p></div></section>`;
  let corpo: string;
  let rodape: string;
  if (!app) {
    corpo = `<p class="gaveta-desc">${atual.erro ? "Não deu para ler o Canvas agora." : "Lendo…"}</p>`;
    rodape = "";
  } else if (!instalado) {
    corpo = `<p class="gaveta-desc">${esc(DESCRICAO)}</p>${niveis}<section class="gaveta-secao"><h3>Como funciona</h3><ol class="como"><li>Instale o Canvas: os dados ficam no nod, nada sai para outro serviço.</li><li>Escolha quais bots podem usar, e com qual nível.</li><li>O bot ganha a página Canvas na pílula e a ferramenta no chat.</li></ol></section>`;
    rodape = botao("instalar-canvas", "Instalar Canvas", { classe: "pri largo" });
  } else {
    const bots = meusBots(estado);
    const linhas = bots.map((a) => `<div class="quem-linha">${iconeAgente(a, "sm")}<div class="quem-nome"><b>${esc(a.nome)}</b><small>${esc(a.titulo || "Seu bot")}</small></div>${seletor(a.id, a.nome, nivelCanvasDe(app, a.id))}</div>`).join("");
    corpo = `<div class="gaveta-status"><span class="bolinha-ok" aria-hidden="true"></span><div><b>Instalado</b><small>Os canvas e os comentários ficam no nod</small></div></div>` +
      `<section class="gaveta-secao"><h3>Quem usa</h3>${bots.length ? `<div class="quem-lista">${linhas}</div>` : '<p class="mudo">Você ainda não tem bots.</p>'}<p class="mudo">Dar acesso é só aqui: um bot não se dá acesso pelo chat.</p></section>${niveis}`;
    rodape = botao("desinstalar-canvas", "Desinstalar Canvas", { classe: "link perigo" });
  }
  return `<div class="gaveta-fundo" data-act="fechar-gaveta"></div>
  <aside class="gaveta" role="dialog" aria-modal="true" aria-label="Canvas">
    <div class="gaveta-cab">${ICONE_CANVAS}<div><h2>Canvas</h2><small>Do nod</small></div>${botao("fechar-gaveta", "×", { classe: "gaveta-fechar", aria: "Fechar" })}</div>
    <div class="gaveta-corpo">${corpo}</div>
    <div class="gaveta-rodape">${rodape}</div>
  </aside>`;
}
