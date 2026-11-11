/**
 * A prévia do mover (2026-11-10, ADR-142): o diálogo de handoff da tela lê aqui, sem gravar nada, o que soltar a tarefa
 * na coluna faz — pela mesma regra do lote (previaDeMover) e com o mesmo pedido que o turno receberia (entradaDaTarefa).
 */
import type { CasoDeUso } from "./tipos.ts";
import type { PreviaDoMoverDto } from "../contracts/previa-mover.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { previaDeMover } from "../domain/acionamento.ts";
import { colunasDe } from "../domain/colunas.ts";
import { entradaDaTarefa, etapaDaTarefa } from "../domain/quadro.ts";
import { labelsDaTarefa } from "../domain/quadro-labels.ts";
import { ehUuid } from "./apoio-l7.ts";
import { exigirQuadroLigado } from "./quadro.ts";

export const previaDoMover: CasoDeUso<{ agenteId: string; tarefaId: string; coluna: string }, PreviaDoMoverDto> = async (deps, input) => {
  await exigirQuadroLigado(deps);
  const repo = deps.repos.quadros;
  const t = ehUuid(input.tarefaId) ? await repo.tarefa(input.tarefaId) : null;
  const q = t ? await repo.doBot(input.agenteId, t.quadroId) : null;
  if (!q || !t || t.quadroId !== q.id) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora deste quadro" });
  const colunas = colunasDe(q);
  if (!colunas.some((c) => c.id === input.coluna)) throw new ErroDeDominio("nao_encontrado", { cause: "coluna fora deste quadro" });
  const nomes = new Map((await deps.repos.agentes.listar({ incluirOcultos: true })).map((a) => [a.id, a.nome]));
  // O run de quem estava: o vivo da cadeia do turno da tarefa (a retomada conta).
  const cadeia = t.turnoId ? await repo.cadeiaDoTurno(t.turnoId) : [];
  const vivo = cadeia.find((x) => x.estado === "despachando") ?? cadeia.find((x) => x.estado === "pendente");
  const turno = vivo ? await deps.repos.turnos.buscar(vivo.id) : null;
  const anterior = turno && t.agenteId ? { agenteNome: nomes.get(t.agenteId) ?? "o responsável", estado: vivo!.estado === "despachando" ? "rodando" as const : "fila" as const, desde: turno.despachadoEm ?? turno.criadoEm } : null;
  const p = previaDeMover({ status: t.status, agenteId: t.agenteId }, input.coluna, { colunas, autorAgenteId: null, viva: anterior !== null });
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const texto = p.aciona && p.agenteId
    ? entradaDaTarefa({
      quadroId: q.id, meta: q.meta, prazo: q.prazo, tarefa: t, pessoaNome, deQuem: null,
      labels: labelsDaTarefa(t.labelIds, await repo.labels(q.id)).map((l) => l.nome),
      etapa: etapaDaTarefa(colunas, input.coluna, { agenteId: p.agenteId, nomes, quemFecha: q.quemFecha ?? "bot" }),
    })
    : null;
  return { data: { ...p, deNome: t.agenteId ? nomes.get(t.agenteId) ?? null : null, paraNome: p.agenteId ? nomes.get(p.agenteId) ?? null : null, anterior, texto } };
};
