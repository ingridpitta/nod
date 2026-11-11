/**
 * A lateral da tarefa aberta e o chip do topo, como a issue do Multica (definido em 2026-11-10). Uma fonte só para o
 * "está trabalhando" do topo e o Registro de execução: os runs da tarefa (RunDaTarefa, lidos com os comentários).
 * Custo e tokens só quando o nod registrou (os gastos do turno); sem eles, só a duração. HTML puro, texto de fora por `esc`.
 */
import type { ComentarioDto } from "../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import { esc } from "../lib/escape.ts";
import { duracao, entregasDe, gasto, tempoDoRun, tempoRelativo, trecho } from "./linha-do-tempo.ts";
import type { AgenteDoQuadro } from "./quadro-real.ts";
import { anel } from "./quadro.ts";

const vivo = (r: RunDaTarefa): boolean => r.estado === "fila" || r.estado === "rodando";
const quem = (r: RunDaTarefa, agente: AgenteDoQuadro) => agente(r.agenteId) ?? { avatar: anel((r.agenteNome ?? "?").slice(0, 1), r.agenteNome ?? "Bot", false), nome: r.agenteNome ?? "Bot" };
const NOME_DO_ESTADO: Readonly<Record<RunDaTarefa["estado"], string>> = { fila: "na fila", rodando: "trabalhando", concluido: "concluído", falhou: "falhou", cancelado: "cancelado" };

/** "<Agente> está trabalhando", com a pilha de avatares quando são vários (só os que rodam: a fila não conta). */
export function chipTrabalhando(runs: readonly RunDaTarefa[], agente: AgenteDoQuadro): string {
  const ids = [...new Set(runs.filter((r) => r.estado === "rodando").map((r) => r.agenteId))];
  if (!ids.length) return "";
  const pessoas = ids.map((id) => quem(runs.find((r) => r.agenteId === id)!, agente));
  const pilha = pessoas.slice(0, 3).map((p) => `<span class="ta-pilha-av">${p.avatar}</span>`).join("");
  const frase = pessoas.length === 1 ? `${pessoas[0]!.nome} está trabalhando` : pessoas.length === 2 ? `${pessoas[0]!.nome} e ${pessoas[1]!.nome} estão trabalhando` : `${pessoas[0]!.nome} e mais ${pessoas.length - 1} estão trabalhando`;
  return `<button type="button" class="ta-trabalhando" data-act="runs-abrir" title="Ver os runs"><span class="ta-pilha" aria-hidden="true">${pilha}</span><span class="ta-trabalhando-txt">${esc(frase)}</span><span class="ta-pulso" aria-hidden="true"></span></button>`;
}

function linhaDoRun(r: RunDaTarefa, agente: AgenteDoQuadro, agora: number): string {
  const p = quem(r, agente);
  const g = gasto(r);
  const t = r.estado === "fila" ? "" : duracao(tempoDoRun(r, agora));
  const titulo = r.estado === "falhou" && r.motivo ? ` title="${esc(trecho(r.motivo, 300))}"` : "";
  return `<li class="ta-reg" data-estado="${r.estado}"${titulo}><span class="ta-reg-av" aria-hidden="true">${p.avatar}</span><span class="ta-reg-txt"><span class="ta-reg-nome">${esc(p.nome)}</span>` +
    `<span class="ta-reg-meta">${esc([NOME_DO_ESTADO[r.estado], t, g].filter(Boolean).join(" · "))}</span></span>` +
    `<time class="ta-reg-hora" datetime="${new Date(r.criadoEm).toISOString()}">${esc(tempoRelativo(r.criadoEm, agora))}</time></li>`;
}

/**
 * O Registro de execução: o que roda agora e o que acabou de rodar (os 4 mais novos), com duração e, se o nod registrou,
 * custo e tokens; "Runs no tempo" abre o diálogo. `trabalho` é o bloco do NOD-418 (Repetir, Cancelar, recado), que fica.
 */
export function registroDeExecucao(o: { runs: readonly RunDaTarefa[]; agente: AgenteDoQuadro; agora: number; trabalho?: string; aberto: boolean }): string {
  const vivos = o.runs.filter(vivo).reverse();
  const recentes = o.runs.filter((r) => !vivo(r)).reverse().slice(0, 4);
  const semCusto = o.runs.length > 0 && o.runs.every((r) => r.custoUsd === null && r.tokens === null);
  const lista = vivos.length || recentes.length
    ? `<ul class="ta-regs">${[...vivos, ...recentes].map((r) => linhaDoRun(r, o.agente, o.agora)).join("")}</ul>` : `<p class="qd-lado-vazio">Nenhum run ainda</p>`;
  const nota = semCusto ? `<p class="ta-lado-nota">Sem custo registrado nestes runs: só a duração.</p>` : "";
  const botao = o.runs.length ? `<button type="button" class="qd-link ta-lado-mais" data-act="runs-abrir">Runs no tempo</button>` : "";
  return secao("Registro de execução", "reg", o.aberto, `${lista}${nota}${botao}${o.trabalho ? `<div class="ta-reg-trab">${o.trabalho}</div>` : ""}`, o.runs.filter(vivo).length || null);
}

/** As Entregas: os links que os comentários do agente entregaram, os mais novos; "ver todos" abre o resto. */
export function entregas(o: { comentarios: readonly ComentarioDto[]; todas: boolean; aberto: boolean }): string {
  const lista = entregasDe(o.comentarios);
  const vis = o.todas ? lista : lista.slice(0, 4);
  const corpo = lista.length
    ? `<ul class="ta-ents">${vis.map((e) => `<li><a class="qd-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer" title="${esc(e.url)}">${esc(e.rotulo)}</a>${e.autor ? `<span class="ta-ent-de"> · ${esc(e.autor)}</span>` : ""}</li>`).join("")}</ul>` +
      (lista.length > 4 ? `<button type="button" class="qd-link ta-lado-mais" data-act="entregas-todas" aria-expanded="${o.todas}">${o.todas ? "ver menos" : `ver todos (${lista.length})`}</button>` : "")
    : `<p class="qd-lado-vazio">Nada entregue ainda</p>`;
  return secao("Entregas", "ent", o.aberto, corpo, lista.length || null);
}

/** Uma seção recolhível da lateral (o estado de cada uma fica na tela, por chave). */
export function secao(titulo: string, chave: string, aberto: boolean, corpo: string, n: number | null = null): string {
  return `<section class="qd-lado-sec ta-lado-sec" data-sec="${esc(chave)}"><h2 class="qd-rotulo"><button type="button" class="ta-sec-tg" data-act="lado-sec" data-sec="${esc(chave)}" aria-expanded="${aberto}">` +
    `<span class="ta-sec-seta" aria-hidden="true">${aberto ? "▾" : "▸"}</span>${esc(titulo)}${n ? ` <span class="qd-n">${n}</span>` : ""}</button></h2>${aberto ? corpo : ""}</section>`;
}

/** O diálogo "Runs no tempo": uma barra por run na janela do primeiro ao último (ou agora) e a lista embaixo. */
export function dialogoDosRuns(o: { runs: readonly RunDaTarefa[]; agente: AgenteDoQuadro; agora: number }): string {
  if (!o.runs.length) return "";
  const inicio = Math.min(...o.runs.map((r) => r.criadoEm));
  const fim = Math.max(...o.runs.map((r) => r.terminouEm ?? o.agora), inicio + 60_000);
  const pct = (em: number) => ((em - inicio) / (fim - inicio)) * 100;
  const barras = o.runs.map((r) => {
    const p = quem(r, o.agente);
    const fila = Math.max(0, pct(r.comecouEm ?? r.terminouEm ?? o.agora) - pct(r.criadoEm));
    const de = pct(r.comecouEm ?? r.criadoEm);
    const larg = Math.max(0.8, pct(r.terminouEm ?? o.agora) - de);
    return `<li class="ta-bar-l" data-estado="${r.estado}"><span class="ta-bar-nome">${esc(p.nome)}</span><span class="ta-bar-trilho">` +
      (r.comecouEm ? `<span class="ta-bar-fila" style="left:${pct(r.criadoEm).toFixed(2)}%;width:${fila.toFixed(2)}%"></span>` : "") +
      `<span class="ta-bar" style="left:${de.toFixed(2)}%;width:${larg.toFixed(2)}%" title="${esc(`${p.nome} · ${NOME_DO_ESTADO[r.estado]} · ${duracao(tempoDoRun(r, o.agora))}`)}"></span></span></li>`;
  }).join("");
  const lista = [...o.runs].reverse().map((r) => linhaDoRun(r, o.agente, o.agora)).join("");
  const de = new Date(inicio).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `<dialog class="ta-dialogo" id="ta-runs" aria-labelledby="ta-runs-tit"><div class="ta-dialogo-cab"><h2 id="ta-runs-tit">Runs no tempo</h2><button type="button" class="qd-link" data-act="runs-fechar">Fechar</button></div>` +
    `<p class="ta-lado-nota">De ${esc(de)} até ${esc(o.runs.some(vivo) ? "agora" : new Date(fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))} · a parte clara é a fila</p>` +
    `<ol class="ta-barras">${barras}</ol><ul class="ta-regs">${lista}</ul></dialog>`;
}
