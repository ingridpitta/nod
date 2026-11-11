/**
 * O trabalho preso à etapa (2026-11-10, ADR-142; regra em src/domain/etapa-presa.ts): qual tarefa o turno trabalhava,
 * se ela foi movida por outro depois que o trabalho nasceu, e por quem e para onde (os nomes para a recusa e o aviso).
 */
import type { Deps } from "./tipos.ts";
import { colunasDe } from "../domain/colunas.ts";
import { avisoDaEtapaMovida, mudancaQuePrende } from "../domain/etapa-presa.ts";

export type EtapaPresa = { tarefaId: string; titulo: string; quem: string; coluna: string; execucaoId: string };

export async function etapaPresaDoTurno(deps: Pick<Deps, "repos" | "escopo">, turnoId: string, agenteId: string): Promise<EtapaPresa | null> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  const e = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!e?.etapa || e.canceladaEm !== null) return null;
  const t = await deps.repos.quadros.tarefa(e.tarefaId);
  if (!t || t.status === e.etapa) return null;
  const m = mudancaQuePrende({ etapa: e.etapa, statusAgora: t.status, desde: e.criadoEm, agenteId, historico: await deps.repos.quadros.historico(t.id) });
  if (!m) return null;
  const q = await deps.repos.quadros.buscar(t.quadroId);
  const coluna = (q ? colunasDe(q) : []).find((c) => c.id === t.status)?.nome ?? t.status;
  const quem = m.autor === "agente" && m.autorAgenteId
    ? (await deps.repos.agentes.buscar(m.autorAgenteId))?.nome ?? "outro bot"
    : (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome?.split(/\s+/)[0] ?? "a pessoa";
  return { tarefaId: t.id, titulo: t.titulo, quem, coluna, execucaoId: e.id };
}

/**
 * O aviso para a sessão viva do trabalho preso (a renovação da ponte o põe no próximo passo, uma vez por `chave`). Só o
 * turno de um trabalho do quadro (delegação ou retomada) consulta; a conversa, a rotina e o colega saem cedo.
 */
export async function avisoDaEtapaNaSessao(deps: Pick<Deps, "repos" | "escopo">, turnoId: string): Promise<{ chave: string; texto: string } | null> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || (turno.origem !== "delegacao" && turno.origem !== "retomada")) return null;
  const presa = await etapaPresaDoTurno(deps, turnoId, turno.agenteId);
  return presa ? { chave: `${presa.execucaoId}:${presa.coluna}`, texto: avisoDaEtapaMovida(presa.titulo, presa.quem, presa.coluna) } : null;
}
