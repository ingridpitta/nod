/**
 * Uma fonte só para o estado do trabalho da tarefa (pedido do Marlon, 2026-11-10: o card dizia "começando" e a tarefa
 * aberta "está trabalhando" ao mesmo tempo). O card, o chip do topo, o bloco do run na linha do tempo, o Registro de
 * execução e as Execuções passam por aqui e mostram o mesmo rótulo:
 * - trabalhando: o turno da cadeia está despachando (rodando de verdade);
 * - na fila: o turno existe e ainda não despachou, com o motivo quando o servidor sabe (a mesma tarefa, o portão);
 * - esperando: o trabalho está aberto sem turno vivo (a CI, um colega, a pessoa, a volta marcada);
 * - começando: só o card otimista do mover, antes da resposta do servidor (some quando o quadro real chega).
 */
import type { TarefaDto } from "../../src/contracts/quadro.ts";
import type { EsperaDoRun, OrigemDoRun, RunDaTarefa } from "../../src/contracts/quadro-comentarios.ts";

export type SituacaoDoTrabalho = "trabalhando" | "fila" | "esperando" | "comecando";
export type MotivoDaFila = NonNullable<TarefaDto["motivoFila"]>;

export const MOTIVO_DA_FILA: Readonly<Record<MotivoDaFila, string>> = {
  mesma_tarefa: "termina a etapa anterior desta tarefa",
  memoria: "a máquina está sem memória livre",
  processador: "o processador da máquina está ocupado",
  disco: "o disco da máquina está cheio",
};

/** A marca do card otimista do mover (só na cópia local; o quadro do servidor não a traz). */
export type ComOtimista = { otimista?: true };

/** O estado do card, pela execução que o servidor calculou (ou "começando", no otimista). */
export function situacaoDoCard(t: Pick<TarefaDto, "execucao"> & ComOtimista): SituacaoDoTrabalho | null {
  if (t.otimista) return "comecando";
  if (t.execucao === "rodando") return "trabalhando";
  if (t.execucao === "fila") return "fila";
  if (t.execucao === "esperando") return "esperando";
  return null;
}

/** O estado de um run (ou de uma execução) da tarefa aberta: o mesmo critério do card. */
export function situacaoDoRun(r: { estado: string; esperando?: boolean }): SituacaoDoTrabalho | null {
  if (r.estado === "rodando") return r.esperando ? "esperando" : "trabalhando";
  if (r.estado === "fila") return "fila";
  return null;
}

const haQuanto = (desde: number, agora: number): string => {
  const min = Math.max(1, Math.round((agora - desde) / 60_000));
  return min < 60 ? `há ${min} min` : `há ${Math.round(min / 60)} h`;
};

/**
 * O rótulo curto, igual nas duas superfícies: "trabalhando", "na fila · <motivo>" (com "há N min" depois de um minuto; T4,
 * 2026-11-10: também sem motivo, para o relógio mostrar que a fila anda), "esperando", "começando".
 */
export function rotuloDaSituacao(s: SituacaoDoTrabalho, o: { motivoFila?: MotivoDaFila | null; naFilaDesde?: number | null; agora?: number } = {}): string {
  if (s === "trabalhando") return "trabalhando";
  if (s === "esperando") return "esperando";
  if (s === "comecando") return "começando";
  const ha = o.naFilaDesde && o.agora && o.agora - o.naFilaDesde >= 60_000 ? ` ${haQuanto(o.naFilaDesde, o.agora)}` : "";
  return `na fila${ha}${o.motivoFila ? ` · ${MOTIVO_DA_FILA[o.motivoFila]}` : ""}`;
}

/* ---------- 2026-11-10 (Passo 1): a espera, a falha e o gatilho do run, nas mesmas palavras em todo lugar ---------- */


/** A unidade: "run" em todo lugar (o Registro, o chip, o diálogo); "trabalho" fica só no verbo ("Ver o trabalho"). */
export const UNIDADE = "run";

const hh = (em: number): string => { const d = new Date(em); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** "esperando a CI do PR #12", "volta às 14:00", "esperando sua resposta". */
export function fraseDaEsperaDoRun(e: EsperaDoRun, agora: number): string {
  if (e.tipo === "hora" && e.em !== null) {
    const outroDia = new Date(agora).toDateString() !== new Date(e.em).toDateString();
    const d = new Date(e.em);
    return `volta ${outroDia ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ` : ""}às ${hh(e.em)}`;
  }
  return `esperando ${e.texto}`;
}

/** O "Volto quando…" que sobe para o bloco do run (o que o bloco antigo de Execuções dizia). */
export function voltaDoRun(e: EsperaDoRun, agora: number): string | null {
  if (e.tipo === "ci") return `Volto quando ${e.texto} terminar`;
  if (e.tipo === "hora" && e.em !== null) return `Volto ${fraseDaEsperaDoRun(e, agora).replace(/^volta /, "")}${e.texto !== "a hora marcada" ? ` · ${e.texto}` : ""}`;
  return null;
}

export const NOME_DA_ORIGEM: Readonly<Record<OrigemDoRun, string>> = {
  comentario: "comentário",
  repetir: "Repetir",
  automatica: "nova tentativa",
  recado: "recado",
  passagem: "passagem de etapa",
  inicio: "início",
  resposta: "sua resposta",
};

/** O estado do run em uma palavra (o mesmo em todo lugar): trabalhando, na fila, esperando, falhou, cancelado, concluído. */
export function palavraDoRun(r: Pick<RunDaTarefa, "estado" | "esperando">): string {
  const s = situacaoDoRun(r);
  if (s) return s === "fila" ? "na fila" : s === "comecando" ? "começando" : s;
  return r.estado === "falhou" ? "falhou" : r.estado === "cancelado" ? "cancelado" : "concluído";
}

/**
 * O rótulo do run com o detalhe: "na fila · a máquina está sem memória livre", "esperando a CI do PR #12",
 * "falhou · Limite do plano da IA", "trabalhando". O tempo fica com quem desenha (o tick troca só ele).
 */
export function rotuloCompletoDoRun(r: Pick<RunDaTarefa, "estado" | "esperando" | "espera" | "motivoFila" | "rotuloFalha" | "criadoEm">, agora: number): string {
  const s = situacaoDoRun(r);
  if (s === "esperando") return r.espera ? fraseDaEsperaDoRun(r.espera, agora) : "esperando";
  if (s === "fila") return rotuloDaSituacao("fila", { motivoFila: r.motivoFila ?? null, naFilaDesde: r.criadoEm, agora });
  if (s) return rotuloDaSituacao(s);
  if (r.estado === "falhou") return r.rotuloFalha ? `falhou · ${r.rotuloFalha}` : "falhou";
  return palavraDoRun(r);
}
