import { randomUUID } from "node:crypto";
import { ErroBancoOcupado } from "../db/tx.ts";
import { contextoAtual, executarComContexto } from "../obs/contexto.ts";
import { log } from "../obs/log.ts";
import type { Escopo } from "../shared/types.ts";
import { concluirChamada, executarEfeito, type EfeitoPendente } from "./chamar-ferramenta.ts";
import type { LoteAutomatico } from "./pedir-aprovacao.ts";
import type { Deps, Services } from "./tipos.ts";

/** NOD-263: quantas vezes a fase 2 tenta gravar o desfecho quando o banco está ocupado, e a espera antes de cada nova tentativa. */
export const TENTATIVAS_FASE2 = 3;
const ESPERA_FASE2_MS = [100, 300] as const;

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A FASE 2 com banco ocupado (NOD-263): repete SÓ a escrita — o efeito já aconteceu e nunca é reenviado (ADR-009); a fase 2 é
 * idempotente (`desfecho is null`, mensagem só quando grava). Esgotou: loga `desfecho_nao_gravado` com o que identifica o
 * efeito e relança (a rota responde 503 como qualquer banco_ocupado). Outro erro relança na hora.
 * (Movida de rotas/interno.ts em 2026-10-19, PR 5 dos modos de aprovação: a liberação do revisor nos apps, na ponte, usa a
 * mesma.)
 */
export async function assentarComNovaTentativa<T>(gravar: () => Promise<T>, o: { correlationId: string; efeito: EfeitoPendente; dormir: (ms: number) => Promise<void> }): Promise<T> {
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await gravar();
    } catch (e) {
      if (!(e instanceof ErroBancoOcupado)) throw e;
      if (tentativa >= TENTATIVAS_FASE2) {
        log("erro", "desfecho_nao_gravado", {
          correlation_id: o.correlationId,
          tentativas: tentativa,
          tipo: o.efeito.tipo,
          ...(o.efeito.tipo === "lote" ? { decisao_id: o.efeito.lote.decisaoId, turno_id: o.efeito.lote.turnoId }
            : o.efeito.tipo === "previa_linear" ? { ferramenta: "gerir_quadro", turno_id: o.efeito.entrada.turnoId }
              : o.efeito.tipo === "importar_canvas" ? { ferramenta: "gerir_canvas", turno_id: o.efeito.entrada.turnoId }
              : { conector_id: o.efeito.conectorId, ferramenta: o.efeito.tool, turno_id: o.efeito.negacao.turnoId }),
        });
        throw e;
      }
      await o.dormir(ESPERA_FASE2_MS[tentativa - 1] ?? 300);
    }
  }
}

export type EntradaExecutarLiberacao = {
  escopo: Escopo;
  services: Pick<Services, "conectores" | "computadores" | "github">;
  lote: LoteAutomatico;
  /** Abre uma transação NOVA da dona (a fase 3 já comitou) e devolve o que `fn` devolveu. */
  dentro: <T>(fn: (d: Deps) => Promise<T>) => Promise<T>;
  dormir?: (ms: number) => Promise<void>;
};

/**
 * Os dois últimos dos quatro passos do revisor nos apps (definido em 2026-10-19, plano dos modos de aprovação, PR 5;
 * revisão de engenharia 5): a fase 1 pediu, a fase 3 FECHOU a decisão por `regra:revisor` (assentarRevisao); agora o
 * EFEITO roda fora de transação (executarItens, sob o contexto de log da dona: o `carregar` do conector precisa saber de
 * quem é a chamada) e o desfecho é ASSENTADO numa transação nova (assentarLoteAutomatico, idempotente, com nova tentativa
 * se o banco estiver ocupado) — o mesmo caminho do lote que o modo aprova sozinho (NOD-263). O proxy, parado no
 * `aguardar`, vê os desfechos e o turno segue com o resultado; a fala "Fiz sem perguntar" vai para a Atividade.
 *
 * Risco aceito (plano, "Fora do escopo" e "Falhas em produção"): se o processo cair entre a fase 3 e o assentamento, o
 * item fica liberado e sem desfecho — a mesma janela que o lote automático já tem. Nunca reenviado (ADR-009).
 */
export async function executarLiberacao(e: EntradaExecutarLiberacao): Promise<void> {
  const efeito: EfeitoPendente = { tipo: "lote", lote: e.lote };
  const correlationId = contextoAtual()?.correlationId ?? randomUUID();
  const contexto = { tenantId: e.escopo.tenantId, pessoaId: e.escopo.pessoaId, correlationId };
  const desfecho = await executarComContexto(contexto, () => executarEfeito(e.services, efeito));
  await executarComContexto(contexto, () => assentarComNovaTentativa(
    () => e.dentro(async (d) => {
      const r = await concluirChamada(d, { efeito, desfecho });
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
    }),
    { correlationId, efeito, dormir: e.dormir ?? dormirPadrao },
  ));
  log("info", "revisao_executada", { turno_id: e.lote.turnoId, decisao_id: e.lote.decisaoId, itens: e.lote.aExecutar.length });
}
