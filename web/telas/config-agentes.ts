import type { Estado } from "../estado/reducer.ts";
import { rotuloDoMac } from "../lib/aparelho.ts";
import { ICONE } from "../lib/icones.ts";
import { grupoConfig, linhaConfig, listaAninhada, normalizarBusca } from "../lib/linha-config.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { PROVEDOR } from "./cartao-ia.ts";
import type { BotGerido } from "./gestao.ts";
import { maquinaDoBot } from "./maquinas.ts";
import { barraDoLote, caixaDoLote, mensagemNaLinha, topoDaSelecao } from "./agentes-lote.ts";
import { emSelecao } from "../lib/lote-agentes.ts";

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): Configurações › Agentes. Substitui o "Gerenciar agentes": a
 * busca (sem diferenciar acento e caixa, por nome, função ou time), os bots ativos por time, cada um com a função, a
 * máquina e a IA no detalhe e o mesmo "…" da barra lateral; Ocultos e Excluídos recolhidos, só quando há algum. Sem o
 * Atualizar: a lista se relê pelas ações e pelo SSE. NOD-368: a caixa antes do ícone de cada bot ativo, o "Selecionar
 * todos" (dos visíveis pela busca) e a barra de lote no pé; ocultos e excluídos ficam fora do lote.
 */

export const VAZIO_BUSCA_AGENTES = "Nenhum agente encontrado. Procure pelo nome, pela função ou pelo time.";
const SEM_TIME = "Sem time";

const LUPA = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>`;

/** "Claude", "ChatGPT" ou "Automático" (a IA escolhida na ficha). */
function iaDoBot(a: BotGerido): string {
  const h = a.inteligencia ? (a.inteligencia.modo === "fixa" ? a.inteligencia.fixa : null) : a.harness;
  return h === "claude-cli" || h === "codex-cli" ? PROVEDOR[h].nome : "Automático";
}

/** "Design · vm-trabalho · Claude": a função, a máquina (ou a padrão) e a IA. */
export function detalheDoBot(estado: Pick<Estado, "maquinas">, a: BotGerido): string {
  const maquina = maquinaDoBot(estado as Estado, a)?.nome ?? (estado.maquinas?.servidorNoMac ? rotuloDoMac() : "Qualquer uma");
  return [a.titulo || "Sem título", maquina, iaDoBot(a)].join(" · ");
}

/** A busca acha pelo nome, pela função ou pelo time, sem acento e sem caixa. */
export function botCasaComBusca(a: Pick<BotGerido, "nome" | "titulo" | "secao">, busca: string): boolean {
  const q = normalizarBusca(busca);
  return !q || normalizarBusca(`${a.nome} ${a.titulo} ${a.secao ?? ""}`).includes(q);
}

function linhaDoBot(estado: Estado, a: BotGerido, comLote = false): string {
  const mais = `<div class="cl-mais"><button type="button" class="cl-mais-bt" data-act="menu-agente" data-id="${esc(a.id)}" aria-haspopup="menu" aria-label="Mais ações de ${esc(a.nome)}">${ICONE.pontos}</button></div>`;
  if (!comLote) return linhaConfig({ titulo: a.nome, detalhe: detalheDoBot(estado, a), icone: iconeAgente(a), classe: "cfg-bot", controle: { tipo: "html", html: mais } });
  const lote = estado.configUi.lote;
  const marcada = lote.selecionados.includes(a.id);
  const msg = mensagemNaLinha(lote.resultados[a.id], a);
  return linhaConfig({
    titulo: a.nome,
    detalheHtml: `<span>${esc(detalheDoBot(estado, a))}</span>${msg}`,
    icone: iconeAgente(a),
    antes: caixaDoLote(marcada ? "true" : "false", `Selecionar ${a.nome}`, "lote-marcar", a.id),
    classe: `cfg-bot lote-linha${marcada ? " lote-marcada" : ""}`,
    attrs: `data-lote-id="${esc(a.id)}"`,
    controle: { tipo: "html", html: mais },
  });
}

function linhaExcluido(a: BotGerido): string {
  return linhaConfig({ titulo: a.nome, detalhe: a.titulo || "Sem título", icone: iconeAgente(a), classe: "cfg-bot", controle: { tipo: "html", html: botao("restaurar-agente", "Restaurar", { id: a.id, aria: `Restaurar ${a.nome}` }) } });
}

/** Os grupos por time: "Sem time" primeiro, os outros em ordem alfabética. */
function porTime(estado: Estado, bots: readonly BotGerido[]): string {
  const times = new Map<string, BotGerido[]>();
  for (const a of bots) {
    const t = a.secao?.trim() || SEM_TIME;
    times.set(t, [...(times.get(t) ?? []), a]);
  }
  const ordem = [...times.keys()].sort((x, y) => (x === SEM_TIME ? -1 : y === SEM_TIME ? 1 : x.localeCompare(y, "pt-BR")));
  return ordem.map((t) => grupoConfig(t, times.get(t)!.map((a) => linhaDoBot(estado, a, true)), { contagem: times.get(t)!.length })).join("");
}

export function renderAgentes(estado: Estado): string {
  const dados = estado.gestao ?? null;
  const pessoaId = estado.sessao?.pessoaId;
  const busca = estado.configUi.busca;
  const cab = `<h2>Agentes</h2><p class="intro">Sua equipe, por time. Selecione vários para mudar a máquina ou a IA de uma vez.</p>`;
  if (!dados) return `<section class="espaco-secao cfg-secao cfg-agentes">${cab}<p class="lc-nota" role="status">Verificando…</p></section>`;
  const meus = dados.agentes.filter((a) => a.ownerId === pessoaId);
  const ativos = meus.filter((a) => !a.excluidoEm && !a.oculto);
  const ocultos = meus.filter((a) => !a.excluidoEm && a.oculto);
  const excluidos = meus.filter((a) => a.excluidoEm);
  const achados = ativos.filter((a) => botCasaComBusca(a, busca));
  const caixa = `<label class="cfg-busca">${LUPA}<input type="search" role="searchbox" data-config-busca data-manter-foco="config-busca" placeholder="Buscar por nome, função ou time" aria-label="Buscar agentes" aria-controls="lista-agentes" value="${esc(busca)}" autocomplete="off" spellcheck="false"></label>`;
  // O resultado da busca aparece aqui e é DITO pelo nó fixo #anuncio-config (main.ts buscarAgentes): este parágrafo é
  // recriado a cada tecla e um role=status recém-inserido não é anunciado com confiança (revisão 3).
  const contagem = `<p class="lc-nota" data-contagem-busca>${normalizarBusca(busca) ? `${achados.length} de ${ativos.length} ${ativos.length === 1 ? "agente" : "agentes"}` : ""}</p>`;
  const lista = ativos.length === 0
    ? `<p class="lc-vazio">Nenhum agente ainda. Crie o primeiro pela barra lateral.</p>`
    : achados.length === 0 ? `<p class="lc-vazio">${VAZIO_BUSCA_AGENTES}</p>` : porTime(estado, achados);
  const abertos = estado.configUi.abertos;
  const ligado = emSelecao(estado.configUi.lote);
  const topo = topoDaSelecao(estado.configUi.lote, achados.map((a) => a.id));
  const barra = barraDoLote(estado, ativos);
  const finais: string[] = [];
  if (ocultos.length > 0) {
    finais.push(linhaConfig({
      titulo: `Ocultos (${ocultos.length})`,
      detalhe: "Fora da barra lateral. Ocultar não pausa o bot nem as rotinas dele.",
      controle: { tipo: "recolhe", id: "agentes-ocultos", acao: "config-recolhe", aberto: abertos.includes("agentes-ocultos"), conteudo: listaAninhada(ocultos.map((a) => linhaDoBot(estado, a))) },
    }));
  }
  if (excluidos.length > 0) {
    finais.push(linhaConfig({
      titulo: `Excluídos (${excluidos.length})`,
      detalhe: "Restaurar recupera o perfil e o histórico. As rotinas voltam pausadas e os acessos precisam ser concedidos de novo.",
      controle: { tipo: "recolhe", id: "agentes-excluidos", acao: "config-recolhe", aberto: abertos.includes("agentes-excluidos"), conteudo: listaAninhada(excluidos.map(linhaExcluido)) },
    }));
  }
  return `<section class="espaco-secao cfg-secao cfg-agentes${ligado ? " lote-ligado" : ""}">
    ${cab}
    ${caixa}
    ${contagem}
    ${topo}
    <div id="lista-agentes" class="cfg-lista-agentes">${lista}</div>
    ${finais.length ? grupoConfig(null, finais) : ""}
    ${barra}
  </section>`;
}
