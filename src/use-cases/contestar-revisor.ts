import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O que a tela recebe: quando a contestação ficou gravada e se já estava (o segundo clique não regrava). */
export type SaidaContestarRevisor = { contestadaEm: number; jaContestada: boolean };

/**
 * "Devia ter perguntado" (definido em 2026-10-26, plano dos modos de aprovação, PR 4; 3g): a dona marca, na Atividade do
 * bot, uma ação que o revisor do Automático liberou. Grava `acoes_pelo_modo.contestada_em` (0093) e não desfaz nada — é a
 * medida da meta da fase ("nenhuma liberada contestada que não se desfaz") e do gatilho de reversão da ADR-115. Só a
 * dona (RLS da `nod_escopar_tabela`): o id de outra pessoa ou de uma ação que o revisor não liberou é 404.
 *
 * O log `revisor_contestado` leva só ids, o tipo, o gatilho e as horas desde a liberação — nunca o comando nem o motivo.
 */
export const contestarRevisor: CasoDeUso<{ acaoId: string }, SaidaContestarRevisor> = async (deps, { acaoId }) => {
  const r = await deps.repos.acoesPeloModo.contestar(acaoId);
  if (!r) throw new ErroDeDominio("nao_encontrado");
  const contestadaEm = r.acao.contestada_em.getTime();
  if (!r.jaContestada) {
    const horas = Math.max(0, Math.round((contestadaEm - r.acao.criado_em.getTime()) / 3_600_000));
    log("info", "revisor_contestado", { acao_id: r.acao.id, agente_id: r.acao.agente_id, tipo: r.acao.tipo, gatilho: r.acao.gatilho, horas_depois: horas });
  }
  return { data: { contestadaEm, jaContestada: r.jaContestada } };
};
