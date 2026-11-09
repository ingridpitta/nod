import { esc } from "../lib/escape.ts";
import {
  ABAS, GRUPO_COMPARTILHADOS, NOME_DA_ABA, rotuloDaAba, textoDaContagem,
  type AbaDoInicio, type DestinoDaAbaQuadros, type LinhaDoPedido, type LinhaDoQuadro, type LinhaRecente,
} from "../lib/tab-bar-celular.ts";

/**
 * ADA-19 (protótipo ada-2 v2, passos 2.5–2.6): o HTML da tab bar do celular, da aba Sua vez, da aba Quadros e da folha
 * de recentes. Todo texto de fora passa por `esc()`; o mascote vem pronto de quem chama (é o `iconeAgente` do app).
 * As ações (`data-act`) são as que o main.ts liga: nenhuma ação nova de servidor (ADR-148: a forma muda, as ações não).
 */

const SVG = (corpo: string, px: number) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
export const ICONE_DA_ABA: Record<AbaDoInicio, string> = {
  conversas: SVG('<path d="M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H8z"/>', 22),
  quadros: SVG('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.2 4.5v15M14.8 4.5v15"/>', 22),
  "sua-vez": SVG('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>', 22),
};
const ICONE_BUSCA = SVG('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>', 24);

export type ContagensDaTabBar = { pedidos: number; naoLidas: boolean };

/** A pílula de vidro com as três abas (ícone + rótulo; a ativa numa pílula suave) e o botão redondo de busca. */
export function renderTabBar(aba: AbaDoInicio, c: ContagensDaTabBar): string {
  const abas = ABAS.map((a) => {
    const ativa = a === aba;
    const marca = a === "conversas" && c.naoLidas
      ? '<span class="tab-ponto" aria-hidden="true"></span>'
      : a === "sua-vez" && textoDaContagem(c.pedidos)
        ? `<span class="tab-num" aria-hidden="true">${textoDaContagem(c.pedidos)}</span>`
        : "";
    return `<button type="button" class="tab-aba" data-act="aba-do-inicio" data-aba="${a}"${ativa ? ' aria-current="page"' : ""} aria-label="${esc(rotuloDaAba(a, c))}">${ICONE_DA_ABA[a]}<span class="tab-rotulo" aria-hidden="true">${NOME_DA_ABA[a]}</span>${marca}</button>`;
  }).join("");
  return `<div class="tab-bar-celular"><nav class="tab-abas" aria-label="Navegação">${abas}</nav><button type="button" class="tab-busca" data-act="abrir-busca" aria-label="Buscar">${ICONE_BUSCA}</button></div>`;
}

/** O título grande da aba (30 px), que some quando o topo encolhe — aí o compacto aparece no topo. */
export function renderTituloGrande(aba: AbaDoInicio): string {
  return `<h1 class="inicio-titulo-grande">${NOME_DA_ABA[aba]}</h1>`;
}

/** O título compacto (16 px, centrado) que entra no topo encolhido. */
export function renderTituloCompacto(aba: AbaDoInicio): string {
  return `<span class="inicio-titulo-compacto" aria-hidden="true">${NOME_DA_ABA[aba]}</span>`;
}

export type LinhaDoPedidoNaTela = LinhaDoPedido & { mascote: string; hora: string; horaIso: string };
export type EstadoDaAbaSuaVez = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "pronta"; linhas: LinhaDoPedidoNaTela[] };

const ESQUELETO_PEDIDOS = `<div class="aba-esqueleto" role="status"><span class="sr-only">Carregando</span>${'<div class="esq-pedido"><span class="esq redondo"></span><span class="esq-txt"><span class="esq"></span><span class="esq"></span></span></div>'.repeat(3)}</div>`;

/**
 * A aba Sua vez no celular: só "Precisa de você" — quem pede, o pedido em até 2 linhas e o motivo. Tocar abre a conversa no
 * pedido; na conversa de outra pessoa (que ela não lê), abre a fila de Sua vez, onde decide (ADR-148: nenhuma ação tirada).
 */
export function renderAbaSuaVez(e: EstadoDaAbaSuaVez): string {
  if (e.tipo === "carregando") return `<section class="aba-sua-vez" aria-label="Sua vez">${ESQUELETO_PEDIDOS}</section>`;
  if (e.tipo === "erro") return `<section class="aba-sua-vez"><div class="aba-erro" role="alert"><p>Não deu para atualizar.</p><button type="button" class="bt inicio-contorno" data-act="tentar-sua-vez">Tentar de novo</button></div></section>`;
  if (!e.linhas.length) return '<section class="aba-sua-vez"><div class="aba-vazia"><p>Nada esperando por você.</p></div></section>';
  const linhas = e.linhas.map((l) => `<li><button type="button" class="aba-pedido" data-act="${l.daMinhaConversa ? "abrir-pedido" : "abrir-pedido-na-fila"}" data-decisao-id="${esc(l.decisaoId)}" data-conversa="${esc(l.conversaId)}" data-agente="${esc(l.agenteId)}" aria-label="${esc(`${l.quem}: ${l.pedido}`)}">${l.mascote}<span class="pedido-txt"><span class="pedido-quem"><b>${esc(l.quem)}</b></span><span class="pedido-texto">${esc(l.pedido)}</span><span class="pedido-motivo">${esc(l.motivo)}</span></span><time datetime="${esc(l.horaIso)}">${esc(l.hora)}</time></button></li>`).join("");
  return `<section class="aba-sua-vez"><h2 class="aba-rotulo">Precisa de você <span class="aba-cont">· ${e.linhas.length}</span></h2><ul class="aba-lista" role="list">${linhas}</ul></section>`;
}

export type EstadoDaAbaQuadros = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "pronta"; destino: DestinoDaAbaQuadros; nomeDoBot: (agenteId: string) => string; mascote: (agenteId: string) => string };

function linhaDoQuadro(q: LinhaDoQuadro, e: Extract<EstadoDaAbaQuadros, { tipo: "pronta" }>, destaque = false): string {
  const sub = q.compartilhado ? `de ${q.dona}` : e.nomeDoBot(q.agenteId);
  const atributos = q.compartilhado ? `data-act="abrir-quadro-compartilhado" data-quadro="${esc(q.id)}"` : `data-act="abrir-quadro-do-bot" data-agente="${esc(q.agenteId)}" data-id="${esc(q.id)}"`;
  return `<li><button type="button" class="aba-quadro${destaque ? " destaque" : ""}" ${atributos} aria-label="${esc(`${q.nome}, ${sub}`)}">${e.mascote(q.agenteId)}<span class="quadro-txt"><b>${esc(q.nome)}</b><small>${esc(sub)}</small></span></button></li>`;
}

/** A aba Quadros: 0 → vazio calmo; 1 → o quadro em destaque; N → agrupada por bot; os compartilhados no fim. */
export function renderAbaQuadros(e: EstadoDaAbaQuadros): string {
  if (e.tipo === "carregando") return `<section class="aba-quadros" aria-label="Quadros">${ESQUELETO_PEDIDOS}</section>`;
  if (e.tipo === "erro") return '<section class="aba-quadros"><div class="aba-erro" role="alert"><p>Não deu para carregar os quadros.</p><button type="button" class="bt inicio-contorno" data-act="tentar-quadros">Tentar de novo</button></div></section>';
  const d = e.destino;
  if (d.tipo === "vazio") return '<section class="aba-quadros"><div class="aba-vazia"><p>Ainda não há quadros. Peça a um bot para criar um.</p><button type="button" class="bt inicio-contorno" data-act="aba-do-inicio" data-aba="conversas">Ir para Conversas</button></div></section>';
  if (d.tipo === "direto") return `<section class="aba-quadros"><ul class="aba-lista" role="list">${linhaDoQuadro(d.quadro, e, true)}</ul></section>`;
  const grupos = d.grupos.map((g) => `<h2 class="aba-rotulo${g.titulo === GRUPO_COMPARTILHADOS ? " compartilhados" : ""}">${esc(g.titulo)}</h2><ul class="aba-lista" role="list">${g.quadros.map((q) => linhaDoQuadro(q, e)).join("")}</ul>`).join("");
  return `<section class="aba-quadros">${grupos}</section>`;
}

export type LinhaRecenteNaTela = LinhaRecente & { mascote: string; hora: string; horaIso: string };

/** A folha de recentes (segurar o ‹): linhas de 60 px; a conversa aberta vai marcada. */
export function renderFolhaRecentes(linhas: readonly LinhaRecenteNaTela[]): string {
  const corpo = linhas.length
    ? `<ul class="recentes-lista" role="list">${linhas.map((l) => `<li><button type="button" class="recente" data-act="abrir-recente" data-conversa="${esc(l.conversaId)}" data-agente="${esc(l.agenteId)}"${l.aberta ? ' aria-current="true"' : ""} aria-label="${esc(`${l.nome}${l.aberta ? " (aberta)" : ""}: ${l.previa}`)}">${l.mascote}<span class="recente-txt"><b>${esc(l.nome)}</b><small>${esc(l.previa)}</small></span><time datetime="${esc(l.horaIso)}">${esc(l.hora)}</time></button></li>`).join("")}</ul>`
    : '<p class="recentes-vazio">Sem conversas recentes.</p>';
  return `<div class="folha-recentes-fundo" data-act="fechar-recentes"></div><div class="folha-recentes" role="dialog" aria-modal="true" aria-labelledby="titulo-recentes" tabindex="-1"><span class="folha-pega" aria-hidden="true"></span><h3 id="titulo-recentes">Conversas recentes</h3>${corpo}</div>`;
}
