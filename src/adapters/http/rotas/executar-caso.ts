import type { EfeitoAposCommit } from "../../../contracts/acoes.ts";
import type { Executor } from "../../../contracts/evento.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import type { Inventario } from "../../../contracts/inventario.ts";
import { criarRepos } from "../../../repositories/index.ts";
import { comPortas } from "../../../db/porta-da-dona.ts";
import type { Escopo, Relogio, Transacao } from "../../../shared/types.ts";
import type { CasoDeUso, Deps, Services, UseCasesNod } from "../../../use-cases/tipos.ts";

/**
 * O que toda rota da L6 precisa para virar Deps de caso de uso. `abrirTx` é a fábrica escopada
 * (produção: `(escopo) => abrirTxEscopada(db, escopo)`; teste: savepoint dentro do withRollback), para
 * a rota nunca segurar um pool nem saber de BEGIN. As constantes de ambiente chegam lidas pela borda.
 */
export type DepsRotas = {
  abrirTx: (escopo: Escopo) => Transacao;
  services: Services;
  useCases: UseCasesNod;
  agora?: Relogio;
  modeloPadrao?: string;
  prazoDecisaoMs?: number;
  executor?: Executor;
  /** #313: as IAs das máquinas vivas da pessoa (modo compartilhado), para a negação do envio nomear a IA do bot. */
  harnessesDaPessoa?: (pessoaId: string) => Partial<Record<IdHarness, Inventario>>;
  /** NOD-391 (ADR-135 §4): roda o efeito que o caso de uso agendou, depois do commit. Erro sobe para a rota. */
  rodarAposCommit?: (escopo: Escopo, efeito: EfeitoAposCommit) => Promise<void>;
  /** Jornada C do onboarding (NOD_ONBOARDING_TEXTO=1): sem IA, a fala da pessoa fica guardada em vez de cair. */
  guardarSemIa?: boolean;
};

export type Executar = <I, O>(escopo: Escopo, caso: CasoDeUso<I, O>, input: I) => Promise<O>;

/** Abre a tx escopada, monta Deps, roda o caso de uso e grava os eventos pelo outbox na MESMA tx (ADR-010). */
export function criarExecutor(d: DepsRotas): Executar {
  const agora = d.agora ?? (() => Date.now());
  return async (escopo, caso, input) => {
    const efeitos: EfeitoAposCommit[] = [];
    const data = await d.abrirTx(escopo)(async (trx) => {
      const montar = (e: Escopo): Deps => ({ repos: criarRepos(trx, e), services: d.services, useCases: d.useCases, tx: (fn) => fn(trx), escopo: e, agora, modeloPadrao: d.modeloPadrao, aposCommit: (x) => void efeitos.push(x) });
      const deps: Deps = comPortas(trx, escopo, montar);
      const r = await caso(deps, input);
      if (r.events?.length) await deps.repos.events.gravarComOutbox(r.events);
      return r.data;
    });
    // Só depois do commit: o efeito lê o que a transação gravou (ADR-135 §4).
    for (const e of efeitos) await d.rodarAposCommit?.(escopo, e);
    return data;
  };
}

export function corpoObjeto(corpo: unknown): Record<string, unknown> {
  return typeof corpo === "object" && corpo !== null && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : {};
}

export function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function textoOpcional(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
