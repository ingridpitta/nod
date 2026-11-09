import { randomUUID } from "node:crypto";
import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { ClasseNegacao, Negacao } from "../contracts/negacao.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import { classificarNegacao } from "../domain/parada-alcada.ts";
import type { Escopo } from "../shared/types.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Regra que decide terminal × transitória (src/domain/parada-alcada.ts), no formato do CHECK da trilha (sem hífen). */
export const REGRA_PARADA_ALCADA = "regra:parada_alcada" as const;
export const VERSAO_REGRA_PARADA_ALCADA = 1 as const;

/**
 * Autoria de AGENTE para eventos/mensagens escritos pelos casos de uso da L5 quando o plano não
 * está à mão (definido em 2026-09-16: executor catcher por default, localidade honesta desta rodada).
 */
export function autoriaDoAgente(escopo: Escopo, agenteId: string, opcoes: { executor?: Executor; machineId?: string | null; decididoPor?: `regra:${string}`; regraVersao?: number } = {}): Autoria {
  return {
    autor_tipo: "agente",
    autor_id: agenteId,
    sob_procuracao_de: null,
    conta_de_execucao: escopo.pessoaId,
    executor: opcoes.executor ?? "catcher",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: opcoes.machineId ?? null,
    decidido_por: opcoes.decididoPor ?? "regra:localidade",
    regra_versao: opcoes.regraVersao ?? 1,
  };
}

export function autoriaDaPessoa(escopo: Escopo): Autoria {
  return {
    autor_tipo: "pessoa",
    autor_id: escopo.pessoaId,
    sob_procuracao_de: null,
    conta_de_execucao: escopo.pessoaId,
    executor: "catcher",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: "pessoa",
    regra_versao: 1,
  };
}

/** Nome de ferramenta no formato do CHECK da trilha (^[A-Za-z0-9_-]+$): fora disso vira '_'. */
export function nomeParaTrilha(nome: string): string {
  const limpo = nome.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
  return limpo === "" ? "sem_nome" : limpo;
}

export type EntradaRegistrarNegacao = {
  turnoId: string;
  agenteId: string;
  conversaId: string | null;
  nome: string;
  motivo: MotivoNegacao;
  classe: ClasseNegacao;
  conectorId?: string | null;
  /** EMENDA 15: alcance_insuficiente vindo do gate de rotina é transitória. */
  viaGateDeRotina?: boolean;
  causa?: Negacao["causa"];
  autoria?: Autoria;
};

/**
 * Toda negação vira linha na trilha com horário, ferramenta, motivo e a REGRA que decidiu (E8.4,
 * ADR-004) — nunca ausência. Terminal (E5.1) pede a interrupção do turno: a próxima renovação de
 * lease devolve {ativo:false} e o executor manda SIGTERM. Devolve a Negacao renderizável (ADR-029)
 * e o evento `negacao` para a pessoa dona.
 */
export const registrarNegacao: CasoDeUso<EntradaRegistrarNegacao, Negacao> = async (deps, input) => {
  const agora = deps.agora();
  const terminal = classificarNegacao(input.motivo, agora, { viaGateDeRotina: input.viaGateDeRotina }) === "TERMINAL";
  await deps.repos.trilha.registrar({
    agenteId: input.agenteId,
    turnoId: input.turnoId,
    conectorId: input.conectorId ?? null,
    ferramenta: nomeParaTrilha(input.nome),
    kind: "negacao",
    motivo: input.motivo,
    regra: REGRA_PARADA_ALCADA,
    regraVersao: VERSAO_REGRA_PARADA_ALCADA,
    em: agora,
  });
  if (terminal) await deps.repos.turnos.pedirInterrupcao([input.turnoId], agora);
  const negacao: Negacao = { classe: input.classe, nome: input.nome, motivo: input.motivo, desde: agora, terminal, ...(input.causa ? { causa: input.causa } : {}) };
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "negacao",
    autoria: input.autoria ?? autoriaDoAgente(deps.escopo, input.agenteId, { decididoPor: REGRA_PARADA_ALCADA, regraVersao: VERSAO_REGRA_PARADA_ALCADA }),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { nome: input.nome, motivo: input.motivo, classe: input.classe, terminal, conector_id: input.conectorId ?? null },
  };
  return { data: negacao, events: [evento] };
};
