import type { ChamadaRevisor, ResultadoCliente } from "../../src/adapters/revisor/cliente-anthropic.ts";
import { criarExecutorRevisor, type ExecutorRevisor } from "../../src/adapters/revisor/executor.ts";
import { PRAZO_REVISAO_MS, TETO_GLOBAL_USD_PADRAO, TETO_PESSOA_USD_PADRAO, type ConfigRevisor } from "../../src/contracts/revisao.ts";
import type { Escopo } from "../../src/shared/types.ts";
import type { ResultadoRevisao } from "../../src/use-cases/revisar-acao.ts";

/**
 * O revisor no servidor nos testes de integração (ADR-115, 2026-10-25): o EXECUTOR de verdade (fila, disjuntor, teto
 * global, entrega à fase 3) com um cliente falso que segura cada chamada até o teste responder (`revisar`). Nenhuma
 * chamada sai da máquina. `emVoo: 1` por padrão: a fase 3 roda na transação do teste (`withRollback`), uma de cada vez.
 */
export const MODELO_DE_TESTE = "claude-haiku-4-5-20251001";

export const configDeTeste = (extra: Partial<ConfigRevisor> = {}): ConfigRevisor => ({
  ligado: true,
  modelo: MODELO_DE_TESTE,
  tetoDia: 300,
  tetoGlobalMicrodolares: TETO_GLOBAL_USD_PADRAO * 1_000_000,
  tetoPessoaMicrodolares: TETO_PESSOA_USD_PADRAO * 1_000_000,
  prazoMs: PRAZO_REVISAO_MS,
  ...extra,
});

/** O texto do modelo, como a API devolve (com as fichas e o tempo). */
export const texto = (t: string, extra: Partial<Extract<ResultadoCliente, { ok: true }>> = {}): ResultadoCliente => ({ ok: true, texto: t, fichasEntrada: 2_100, fichasSaida: 30, ms: 3_200, ...extra });
export const falhaDaApi = (status = 500): ResultadoCliente => ({ ok: false, falha: "api", motivo: `http_${status}`, status, ms: 40 });

type Pendente = { chamada: ChamadaRevisor; soltar: (r: ResultadoCliente) => void };

export function revisorDeTeste(o: {
  config?: Partial<ConfigRevisor>;
  /** A fase 3 do teste (na transação dele). */
  assentar(p: { escopo: Escopo; decisaoId: string; resultado: ResultadoRevisao }): Promise<void>;
  /** false = sem chave (cliente nulo). */
  comCliente?: boolean;
  emVoo?: number;
}): { executor: ExecutorRevisor; revisar(responder: (c: ChamadaRevisor) => ResultadoCliente): Promise<ChamadaRevisor[]>; chamadas: ChamadaRevisor[] } {
  const pendentes: Pendente[] = [];
  const chamadas: ChamadaRevisor[] = [];
  let aviso: (() => void) | null = null;
  const executor = criarExecutorRevisor({
    config: configDeTeste(o.config),
    cliente: o.comCliente === false ? null : {
      revisar: (chamada) => new Promise<ResultadoCliente>((soltar) => {
        chamadas.push(chamada);
        pendentes.push({ chamada, soltar });
        aviso?.();
      }),
    },
    agora: () => Date.now(),
    assentar: o.assentar,
    emVoo: o.emVoo ?? 1,
  });
  const chegou = () => new Promise<void>((r) => {
    if (pendentes.length > 0) r();
    else aviso = r;
  });
  return {
    executor,
    chamadas,
    /** Responde cada chamada que chegar (as que já esperam e as que a fila soltar) até o executor ficar ocioso. */
    async revisar(responder) {
      const respondidas: ChamadaRevisor[] = [];
      for (;;) {
        await Promise.race([chegou(), executor.ocioso()]);
        const p = pendentes.shift();
        if (!p) break;
        respondidas.push(p.chamada);
        p.soltar(responder(p.chamada));
      }
      aviso = null;
      return respondidas;
    },
  };
}
