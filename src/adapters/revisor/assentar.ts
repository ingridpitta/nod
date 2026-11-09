import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import { executarLiberacao } from "../../use-cases/liberar-no-app.ts";
import { assentarRevisao, type ResultadoRevisao } from "../../use-cases/revisar-acao.ts";
import type { Deps, Services } from "../../use-cases/tipos.ts";

/**
 * A entrega do executor à fase 3 (definido em 2026-10-25, ADR-115 "Revisor no servidor"): o mesmo caminho que o relato da
 * máquina usava, sem a prova (o executor é interno). Os passos do PR 5: a fase 3 FECHA (ou abre o cartão) numa
 * transação nova da dona, sob a trava do turno, com os eventos no outbox; o item de app liberado roda FORA dela e o
 * desfecho entra numa terceira (`executarLiberacao`). Nunca lança: a fase 3 que falha deixa a decisão `em_revisao` (o
 * varredor a recolhe em 2 × o prazo); a liberação que falha depois do fechamento deixa o item sem desfecho (o risco aceito
 * do PR 5). Mora aqui, e não na composição, para os testes de ponta a ponta rodarem o mesmo código.
 */
export type DentroDaDona = <T>(escopo: Escopo, fn: (deps: Deps) => Promise<T>) => Promise<T>;

export function assentarPeloExecutor(p: { dentro: DentroDaDona; services: Services }) {
  return async ({ escopo, decisaoId, resultado }: { escopo: Escopo; decisaoId: string; resultado: ResultadoRevisao }): Promise<void> => {
    try {
      const lote = await p.dentro(escopo, async (d) => {
        const s = await assentarRevisao(d, { decisaoId, resultado });
        if (s.events?.length) await d.repos.events.gravarComOutbox(s.events);
        return s.data.lote ?? null;
      });
      if (lote) await executarLiberacao({ escopo, services: p.services, lote, dentro: (fn) => p.dentro(escopo, fn) });
    } catch (e) {
      log("erro", "revisao_assentar_falhou", { decisao_id: decisaoId, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  };
}
