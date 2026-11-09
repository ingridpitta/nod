import { randomUUID } from "node:crypto";
import type { Autoria, DadosEvento, Executor, KindEvento, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { MotivoLocalidade } from "../contracts/motivos.ts";
import type { Escopo } from "../shared/types.ts";

/**
 * Autoria composta e eventos dos casos de uso da L6 (ADR-023/025). Um lugar só para o formato:
 * quem escreveu, sob procuração de quem (null num turno normal), de quem é a cota, qual executor.
 * O caso de uso DEVOLVE eventos; quem os grava (rota, ponte, laço) chama gravarComOutbox na mesma tx.
 */

export { MODELO_AGENTE_PADRAO as MODELO_PADRAO } from "../contracts/modelos.ts";

/** definido em 2026-09-16: 24 h, espelho de NOD_PRAZO_DECISAO_MS no .env.example (relógio de DECISÃO, ADR-007). */
export const PRAZO_DECISAO_PADRAO_MS = 86_400_000;

/** Nome do motor no inventário por executor (ADR-019): o driver claude-cli é o motor 'claude-cli'; o catcher é ele mesmo. */
export function motorDe(executor: Executor): string {
  return executor === "local" ? "claude-cli" : "catcher";
}

/** Sem sonda registrada = ausente (fail-closed, ADR-019): nunca se presume 'pronto'. */
export function inventarioAusente(agora: number): Inventario {
  return { estado: "ausente", motivo: "sem sonda registrada para este motor", em: agora };
}

export function autoriaPessoa(escopo: Escopo, executor: Executor = "catcher"): Autoria {
  return {
    autor_tipo: "pessoa",
    autor_id: escopo.pessoaId,
    sob_procuracao_de: null,
    conta_de_execucao: escopo.pessoaId,
    executor,
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: "pessoa",
    regra_versao: 1,
  };
}

export function autoriaAgente(p: {
  agenteId: string;
  contaDeExecucao: string;
  executor: Executor;
  machineId?: string | null;
  localityReason?: MotivoLocalidade;
  decididoPor?: `regra:${string}`;
  regraVersao?: number;
}): Autoria {
  return {
    autor_tipo: "agente",
    autor_id: p.agenteId,
    sob_procuracao_de: null,
    conta_de_execucao: p.contaDeExecucao,
    executor: p.executor,
    locality: "local",
    locality_reason: p.localityReason ?? "tudo_local_nesta_rodada",
    machine_id: p.machineId ?? null,
    decidido_por: p.decididoPor ?? "regra:localidade",
    regra_versao: p.regraVersao ?? 1,
  };
}

export function evento(
  escopo: Escopo,
  p: {
    kind: KindEvento;
    autoria: Autoria;
    agora: number;
    conversaId?: string | null;
    turnoId?: string | null;
    dados?: DadosEvento;
    /** Default: a pessoa do escopo (dona do frame, ADR-016). */
    pessoaDestinoId?: string;
  },
): RuntimeEvent {
  return {
    tenantId: escopo.tenantId,
    id: randomUUID(),
    createdAt: p.agora,
    kind: p.kind,
    autoria: p.autoria,
    pessoaDestinoId: p.pessoaDestinoId ?? escopo.pessoaId,
    conversaId: p.conversaId ?? null,
    turnoId: p.turnoId ?? null,
    dados: p.dados ?? {},
  };
}
