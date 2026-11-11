/**
 * A lateral da tarefa aberta e o chip do topo, como a issue do Multica (definido em 2026-11-10). Uma fonte só para o
 * "está trabalhando" do topo e o Registro de execução: os runs da tarefa (RunDaTarefa, lidos com os comentários).
 * Custo e tokens só quando o nod registrou (os gastos do turno); sem eles, só a duração. HTML puro, texto de fora por `esc`.
 */
import type { ComentarioDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import { NOME_DA_ORIGEM, palavraDoRun, rotuloCompletoDoRun, rotuloDaSituacao, situacaoDoRun, type MotivoDaFila } from "../lib/estado-do-trabalho.ts";
import { fraseDaEspera } from "../lib/quadro-dados.ts";
import { esc } from "../lib/escape.ts";
import { duracao, entregasDe, gasto, tempoDoRun, tempoRelativo, trecho } from "./linha-do-tempo.ts";
import type { AgenteDoQuadro } from "./quadro-real.ts";
import { anel } from "./quadro.ts";

const vivo = (r: RunDaTarefa): boolean => r.estado === "fila" || r.estado === "rodando";
const quem = (r: RunDaTarefa, agente: AgenteDoQuadro) => agente(r.agenteId) ?? { avatar: anel((r.agenteNome ?? "?").slice(0, 1), r.agenteNome ?? "Bot", false), nome: r.agenteNome ?? "Bot" };
const NOME_DO_ESTADO: Readonly<Record<RunDaTarefa["estado"], string>> = { fila: "na fila", rodando: "trabalhando", concluido: "concluído", falhou: "falhou", cancelado: "cancelado" };

/** O rótulo do run: o da fonte única enquanto vive; o nome do fim depois. */
export function rotuloDoRun(r: Pick<RunDaTarefa, "estado" | "esperando">, motivoFila: MotivoDaFila | null = null): string {
  const s = situacaoDoRun(r);
  return s ? rotuloDaSituacao(s, { motivoFila }) : NOME_DO_ESTADO[r.estado];
}

/**
 * O chip do topo, como o do Multica: "Ada está trabalhando" (com o pulso), "Ada está na fila", "Ada está esperando", ou "N
 * agentes ativos". O clique abre um popover com uma linha por run vivo: o estado, "ir até o run" e Parar (com confirmação).
 */
export function chipTrabalhando(runs: readonly RunDaTarefa[], agente: AgenteDoQuadro, o: { aberto?: boolean; parando?: string | null; agora?: number } = {}): string {
  const vivos = runs.filter(vivo);
  if (!vivos.length) return "";
  const agora = o.agora ?? Date.now();
  const ids = [...new Set(vivos.map((r) => r.agenteId))];
  const pessoas = ids.map((id) => quem(vivos.find((r) => r.agenteId === id)!, agente));
  const trabalhando = vivos.some((r) => situacaoDoRun(r) === "trabalhando");
  const so = (s: string) => vivos.every((r) => situacaoDoRun(r) === s);
  const estado = trabalhando ? "trabalhando" : so("fila") ? "na fila" : so("esperando") ? "esperando" : "ativo";
  const pilha = pessoas.slice(0, 3).map((p) => `<span class="ta-pilha-av">${p.avatar}</span>`).join("");
  const frase = pessoas.length === 1 ? `${pessoas[0]!.nome} está ${estado}` : `${pessoas.length} agentes ${trabalhando ? "trabalhando" : "ativos"}`;
  const linhas = vivos.map((r) => {
    const p = quem(r, agente);
    const parar = o.parando === r.turnoId
      ? `<button type="button" class="qd-link ta-com-ac-perigo" data-act="run-parar" data-turno="${esc(r.turnoId)}">Confirmar parar</button>`
      : `<button type="button" class="qd-link" data-act="run-parar" data-turno="${esc(r.turnoId)}">Parar</button>`;
    return `<li class="ta-pop-l"><span class="ta-reg-av" aria-hidden="true">${p.avatar}</span><span class="ta-pop-txt"><b>${esc(p.nome)}</b> <span class="ta-reg-meta">${esc(rotuloCompletoDoRun(r, agora))}</span></span>` +
      `<span class="ta-pop-ac"><button type="button" class="qd-link" data-act="run-ir" data-turno="${esc(r.turnoId)}">ir até o run</button><span aria-hidden="true"> · </span>${parar}</span></li>`;
  }).join("");
  const pop = o.aberto ? `<div class="ta-pop" role="dialog" aria-label="Runs ativos"><ul class="ta-pop-lista">${linhas}</ul><button type="button" class="qd-link ta-lado-mais" data-act="runs-abrir">Runs no tempo</button></div>` : "";
  return `<span class="ta-chip-topo"><button type="button" class="ta-trabalhando" data-estado="${trabalhando ? "trabalhando" : "parado"}" data-act="chip-runs" aria-expanded="${!!o.aberto}" aria-haspopup="dialog">` +
    `<span class="ta-pilha" aria-hidden="true">${pilha}</span><span class="ta-trabalhando-txt">${esc(frase)}</span>${trabalhando ? '<span class="ta-pulso" aria-hidden="true"></span>' : ""}</button>${pop}</span>`;
}

/**
 * Um chip único de espera no topo (definido em 2026-11-10, o wakeup do Multica): você ("Esperando você responder", leva à
 * pergunta), a CI ou a hora marcada (leva ao run que espera). A mesma frase do card (fraseDaEspera).
 */
export function chipDaEspera(t: Pick<TarefaDto, "esperaPessoa" | "decide" | "estadoLinha">, runs: readonly RunDaTarefa[], agora: number): string {
  const f = fraseDaEspera(t, agora);
  if (!f) return "";
  if (f.voce) return `<button type="button" class="ta-espera" data-act="ir-pergunta"><span aria-hidden="true">🔔</span>${esc(f.texto)}</button>`;
  const r = [...runs].reverse().find((x) => x.esperando);
  return `<button type="button" class="ta-espera ta-espera-bot"${r ? ` data-act="run-ir" data-turno="${esc(r.turnoId)}"` : ""}><span aria-hidden="true">🔔</span>${esc(f.texto)}</button>`;
}

/** O gatilho da linha do Registro: "pelo comentário “…”", "pelo Repetir", "por nova tentativa". */
function gatilhoDoRun(r: RunDaTarefa, comentarios: readonly ComentarioDto[]): string {
  if (r.origem === "comentario" || (!r.origem && r.comentarioId)) {
    const c = comentarios.find((x) => x.id === r.comentarioId);
    const n = r.comentariosJuntos?.length ?? 0;
    return c ? `“${trecho(c.texto, 40)}”${n >= 2 ? ` · inclui ${n} comentários` : ""}` : "comentário";
  }
  return r.origem ? NOME_DA_ORIGEM[r.origem] : "";
}

function linhaDoRun(r: RunDaTarefa, agente: AgenteDoQuadro, agora: number, motivoFila: MotivoDaFila | null = null, comentarios: readonly ComentarioDto[] = [], acoes = false): string {
  const p = quem(r, agente);
  const g = gasto(r);
  const s = situacaoDoRun(r);
  const t = r.estado === "fila" || s === "esperando" ? "" : s === "trabalhando" ? `<span class="ta-run-tempo" data-run-desde="${r.comecouEm ?? r.criadoEm}">${esc(duracao(agora - (r.comecouEm ?? r.criadoEm)))}</span>` : esc(duracao(tempoDoRun(r, agora)));
  const titulo = r.estado === "falhou" && r.motivo ? ` title="${esc(trecho(r.motivo, 300))}"` : "";
  const rot = r.motivoFila === undefined && motivoFila ? rotuloDoRun(r, motivoFila) : rotuloCompletoDoRun(r, agora);
  const gat = gatilhoDoRun(r, comentarios);
  const bts = acoes ? `<span class="ta-reg-ac">${vivo(r) ? `<button type="button" class="qd-link" data-act="run-parar" data-turno="${esc(r.turnoId)}">Parar</button>` : `<button type="button" class="qd-link" data-act="run-repetir" data-turno="${esc(r.turnoId)}">Repetir</button>`}</span>` : "";
  return `<li class="ta-reg" data-estado="${r.estado}"${titulo}><span class="ta-reg-av" aria-hidden="true">${p.avatar}</span><span class="ta-reg-txt"><span class="ta-reg-nome">${esc(p.nome)}</span>` +
    `<span class="ta-reg-meta">${[esc(rot), t, esc(g)].filter(Boolean).join(" · ")}</span>${gat ? `<span class="ta-reg-gat">${esc(gat)}</span>` : ""}</span>` +
    `<time class="ta-reg-hora" datetime="${new Date(r.criadoEm).toISOString()}">${esc(tempoRelativo(r.criadoEm, agora))}</time>${bts}</li>`;
}

/**
 * O Registro de execução, o lugar único dos runs (o bloco antigo "Execuções" saiu daqui: Repetir, Parar e o "Volto
 * quando…" estão no bloco do run e no chip): o que roda agora e os 4 mais novos, com o gatilho de cada linha, a duração e,
 * se o nod registrou, custo e tokens; "Runs no tempo" abre o diálogo. `trabalho` fica só para quem ainda o passa.
 */
export function registroDeExecucao(o: { runs: readonly RunDaTarefa[]; agente: AgenteDoQuadro; agora: number; trabalho?: string; aberto: boolean; motivoFila?: MotivoDaFila | null; comentarios?: readonly ComentarioDto[] }): string {
  const vivos = o.runs.filter(vivo).reverse();
  const recentes = o.runs.filter((r) => !vivo(r)).reverse().slice(0, 4);
  const semCusto = o.runs.length > 0 && o.runs.every((r) => r.custoUsd === null && r.tokens === null);
  const lista = vivos.length || recentes.length
    ? `<ul class="ta-regs">${[...vivos, ...recentes].map((r, i) => linhaDoRun(r, o.agente, o.agora, o.motivoFila ?? null, o.comentarios ?? [], vivo(r) || i === vivos.length)).join("")}</ul>` : `<p class="qd-lado-vazio">Nenhum run ainda</p>`;
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
      `<span class="ta-bar" style="left:${de.toFixed(2)}%;width:${larg.toFixed(2)}%" title="${esc(`${p.nome} · ${palavraDoRun(r)} · ${duracao(tempoDoRun(r, o.agora))}`)}"></span></span></li>`;
  }).join("");
  const lista = [...o.runs].reverse().map((r) => linhaDoRun(r, o.agente, o.agora)).join("");
  const de = new Date(inicio).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `<dialog class="ta-dialogo" id="ta-runs" aria-labelledby="ta-runs-tit"><div class="ta-dialogo-cab"><h2 id="ta-runs-tit">Runs no tempo</h2><button type="button" class="qd-link" data-act="runs-fechar">Fechar</button></div>` +
    `<p class="ta-lado-nota">De ${esc(de)} até ${esc(o.runs.some(vivo) ? "agora" : new Date(fim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))} · a parte clara é a fila</p>` +
    `<ol class="ta-barras">${barras}</ol><ul class="ta-regs">${lista}</ul></dialog>`;
}
