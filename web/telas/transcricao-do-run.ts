/**
 * "Ver o trabalho" (definido em 2026-11-10, Passo 4 da comparação Multica × nod; o agent-transcript-dialog do Multica em
 * versão leve): o run num diálogo com os passos persistidos, a resposta final, a duração, o custo, os tokens, o gatilho, a
 * máquina e a branch, e uma busca simples nos passos. Os passos usam o mesmo desenho da linha do tempo (ícone por classe,
 * grupos), com a lista inteira. Vem com `open` (o redesenho recria o nó e um showModal se perderia). Texto de fora por `esc`, o do agente por `trecho` (redige antes de cortar).
 */
import type { RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";
import { esc } from "../lib/escape.ts";
import { NOME_DA_ORIGEM, rotuloCompletoDoRun } from "../lib/estado-do-trabalho.ts";
import { textoDoPasso, type PassosDoRun } from "../lib/passos-do-run.ts";
import { duracao, gasto, tempoDoRun, trecho } from "./linha-do-tempo.ts";
import { listaDePassos } from "./passos-do-run.ts";

export type DadosDaTranscricao = {
  run: RunDaTarefa;
  nome: string;
  passos: PassosDoRun | null;
  /** O comentário que o run deixou (a resposta), senão a última frase dele. */
  resposta: string | null;
  branch: string | null;
  maquina: string | null;
  busca: string;
  agora: number;
};

/** O miolo (a busca regrava só ele, o campo de busca fica). */
export function corpoDaTranscricao(d: DadosDaTranscricao): string {
  const termo = d.busca.trim().toLowerCase();
  const todos = d.passos?.lista ?? [];
  const lista = termo ? todos.filter((p) => textoDoPasso(p).toLowerCase().includes(termo)) : todos;
  const passos = lista.length ? listaDePassos({ turno: d.run.turnoId, lista, todos: true })
    : termo ? `<p class="ta-run-nota">Nenhum passo com “${esc(d.busca.trim())}”.</p>` : d.passos?.carregado ? `<p class="ta-run-nota">Nenhum passo gravado.</p>` : `<p class="ta-run-nota">Lendo os passos…</p>`;
  const resp = d.resposta ? `<h3 class="ta-trans-sub">Resposta</h3><p class="ta-trans-resp">${esc(trecho(d.resposta, 4000))}</p>` : "";
  const erro = d.run.estado === "falhou" && d.run.motivo ? `<h3 class="ta-trans-sub">Erro</h3><p class="ta-run-erro">${esc(trecho(d.run.motivo, 600))}</p>` : "";
  return `<h3 class="ta-trans-sub">Passos${todos.length ? ` <span class="qd-n">${todos.length}</span>` : ""}</h3>${passos}${erro}${resp}`;
}

export function dialogoDaTranscricao(d: DadosDaTranscricao | null): string {
  if (!d) return "";
  const r = d.run;
  const g = gasto(r);
  const meta = [
    rotuloCompletoDoRun(r, d.agora),
    r.estado === "fila" ? "" : `levou ${duracao(tempoDoRun(r, d.agora))}`,
    g || "sem custo registrado",
    r.origem ? `por ${NOME_DA_ORIGEM[r.origem]}` : "",
  ].filter(Boolean).join(" · ");
  const det = [d.maquina ? `máquina ${d.maquina}` : "", d.branch ? `branch ${d.branch}` : "", `começou ${new Date(r.comecouEm ?? r.criadoEm).toLocaleString("pt-BR")}`].filter(Boolean).join(" · ");
  return `<dialog open class="ta-dialogo ta-trans" id="ta-trans" aria-labelledby="ta-trans-tit" data-turno="${esc(r.turnoId)}"><div class="ta-dialogo-cab"><h2 id="ta-trans-tit">O trabalho de ${esc(d.nome)}</h2><button type="button" class="qd-link" data-act="trans-fechar">Fechar</button></div>` +
    `<p class="ta-lado-nota">${esc(meta)}</p><p class="ta-lado-nota">${esc(det)}</p>` +
    `<label class="qd-sr" for="ta-trans-busca">Buscar nos passos</label><input id="ta-trans-busca" class="ta-trans-busca" type="search" placeholder="Buscar nos passos" value="${esc(d.busca)}" data-busca="trans" autocomplete="off">` +
    `<div class="ta-trans-corpo" id="ta-trans-corpo">${corpoDaTranscricao(d)}</div></dialog>`;
}
