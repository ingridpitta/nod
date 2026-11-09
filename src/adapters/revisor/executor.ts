import {
  DISJUNTOR_FALHAS,
  DISJUNTOR_MS,
  FILA_REVISOR_MAX,
  REVISOES_EM_VOO,
  type ConfigRevisor,
  type FalhaRevisao,
  type IndisponibilidadeRevisor,
  type ServicoRevisor,
} from "../../contracts/revisao.ts";
import { custoDaRevisao } from "../../domain/revisor.ts";
import { log } from "../../obs/log.ts";
import type { Escopo, Relogio } from "../../shared/types.ts";
import type { PedidoNaFila, ResultadoRevisao } from "../../use-cases/revisar-acao.ts";
import { contaNoDisjuntor, type ClienteRevisor } from "./cliente-anthropic.ts";

/**
 * O executor do revisor no servidor (definido em 2026-10-25, ADR-115 "Revisor no servidor"). Uma por processo. Depois do
 * commit da fase 1 a rota entrega o pedido (`enfileirar`); o executor chama a API (cliente-anthropic.ts) fora de qualquer
 * transação e entrega o texto (ou a falha) à fase 3 pela composição (`assentar`, numa transação nova da dona). Memória do
 * processo: um deploy perde a fila, e o varredor de expiração vira as decisões `em_revisao` em cartão (2 × o prazo).
 *
 * Os freios, do mais barato ao mais caro, nunca liberam: sem cliente → `sem_revisor`; fila com FILA_REVISOR_MAX
 * esperando → `fila`; disjuntor aberto (DISJUNTOR_FALHAS seguidas → DISJUNTOR_MS) → `disjuntor`; gasto do dia (UTC) de
 * todas as contas no teto → `teto_global`; prazo vencido na fila → `prazo`. No máximo REVISOES_EM_VOO chamadas ao mesmo
 * tempo. O gasto é contado pelas fichas da resposta com o preço do modelo (`custoDaRevisao`) e guardado fora do processo
 * (`gasto`, no banco: as duas cores do azul/verde e o deploy enxergam a mesma conta); sem `gasto`, só na memória.
 *
 * revisto em 2026-10-26 (revisão do #524, item 3): uma conta só não desliga o revisor das outras. O disjuntor conta só
 * as falhas do serviço (`contaNoDisjuntor`; o texto fora do esquema e a recusa não contam), e cada pessoa tem a sua cota
 * do dia em dólares (`tetoPessoaMicrodolares`), lida do banco antes de cada chamada e somada junto com o total: acima
 * dela, só as revisões dessa pessoa viram cartão (`teto_pessoa`).
 */

export type GastoDoRevisor = {
  /** O gasto do dia que começa em `inicioDoDia` (epoch ms, 00:00 UTC), em microdólares, de todas as contas. */
  ler(inicioDoDia: number): Promise<number>;
  /** O gasto do dia de uma pessoa (o id; quem guarda monta a chave). */
  lerDaPessoa(inicioDoDia: number, pessoaId: string): Promise<number>;
  /** Soma ao total e ao da pessoa e devolve os dois depois da soma. */
  somar(inicioDoDia: number, microdolares: number, pessoaId: string): Promise<{ total: number; pessoa: number }>;
};

export type DepsExecutorRevisor = {
  config: ConfigRevisor;
  /** null = sem chave (só com a chave desligada; ligada sem chave o boot não sobe): toda revisão vira cartão. */
  cliente: ClienteRevisor | null;
  agora: Relogio;
  /** A fase 3, numa transação nova da dona, mais a execução dos itens de app liberados. Nunca lança (a composição loga). */
  assentar(p: { escopo: Escopo; decisaoId: string; resultado: ResultadoRevisao }): Promise<void>;
  gasto?: GastoDoRevisor;
  /** Só o teste muda. */
  emVoo?: number;
  filaMax?: number;
};

export type ExecutorRevisor = ServicoRevisor & {
  /** Depois do commit da fase 1. Nunca lança; o que não cabe vira cartão pela fase 3. */
  enfileirar(p: PedidoNaFila): void;
  /** Resolve quando nada está esperando nem em voo (testes e o encerramento). */
  ocioso(): Promise<void>;
  /** Lê o gasto do dia do armazenamento (o boot aquece a leitura que `indisponivel` usa). */
  atualizarGasto(): Promise<void>;
  emMemoria(): { esperando: number; emVoo: number; gastoHoje: number | null; disjuntorAte: number | null; pessoasNoDia: number };
};

const DIA_MS = 24 * 60 * 60_000;
/**
 * definido em 2026-10-26 (QA do #524): o prazo vencido em voo conta no disjuntor só quando a chamada saiu com pelo menos
 * esta fração do prazo da revisão. Abaixo disso, o tempo foi gasto na fila (a fila longa de uma conta), não no serviço.
 */
export const FRACAO_DO_PRAZO_QUE_CONTA = 0.5;
/** O gasto lido vale isto antes de reler (a outra cor também gasta); a soma do próprio processo atualiza na hora. */
const GASTO_VALE_MS = 30_000;

export function criarExecutorRevisor(deps: DepsExecutorRevisor): ExecutorRevisor {
  const limiteEmVoo = deps.emVoo ?? REVISOES_EM_VOO;
  const filaMax = deps.filaMax ?? FILA_REVISOR_MAX;
  const esperando: PedidoNaFila[] = [];
  const correndo = new Set<Promise<void>>();
  let falhasSeguidas = 0;
  let abertoAte = 0;
  let gasto: { dia: number; microdolares: number; lidoEm: number } | null = null;
  /** O gasto do dia por pessoa que este processo viu (a releitura do banco, antes de cada chamada, é quem vale). */
  const gastoPorPessoa = new Map<string, { dia: number; microdolares: number }>();

  const inicioDoDia = (t: number) => Math.floor(t / DIA_MS) * DIA_MS;
  const gastoDeHoje = (): number | null => (gasto && gasto.dia === inicioDoDia(deps.agora()) ? gasto.microdolares : null);
  const tetoBatido = () => (gastoDeHoje() ?? 0) >= deps.config.tetoGlobalMicrodolares;
  const daPessoaHoje = (pessoaId: string): number => {
    const g = gastoPorPessoa.get(pessoaId);
    return g && g.dia === inicioDoDia(deps.agora()) ? g.microdolares : 0;
  };
  const cotaBatida = (pessoaId: string) => daPessoaHoje(pessoaId) >= deps.config.tetoPessoaMicrodolares;
  function guardarDaPessoa(pessoaId: string, dia: number, microdolares: number): void {
    // As linhas de outro dia saem quando a primeira do dia novo entra: o mapa não cresce além das pessoas de um dia.
    for (const [id, g] of gastoPorPessoa) if (g.dia !== dia) gastoPorPessoa.delete(id);
    gastoPorPessoa.set(pessoaId, { dia, microdolares });
  }

  function disjuntor(ok: boolean): void {
    if (ok) {
      falhasSeguidas = 0;
      return;
    }
    falhasSeguidas += 1;
    if (falhasSeguidas < DISJUNTOR_FALHAS) return;
    log("aviso", "revisor_disjuntor_aberto", { falhas: falhasSeguidas, por_ms: DISJUNTOR_MS });
    falhasSeguidas = 0;
    abertoAte = deps.agora() + DISJUNTOR_MS;
  }

  function indisponivel(pessoaId?: string): IndisponibilidadeRevisor | null {
    if (!deps.cliente) return "sem_revisor";
    if (abertoAte > deps.agora()) return "disjuntor";
    if (tetoBatido()) return "teto_global";
    if (pessoaId !== undefined && cotaBatida(pessoaId)) return "teto_pessoa";
    if (esperando.length >= filaMax) return "fila";
    return null;
  }

  async function lerGasto(forcar: boolean): Promise<void> {
    const agora = deps.agora();
    const dia = inicioDoDia(agora);
    if (!forcar && gasto && gasto.dia === dia && agora - gasto.lidoEm < GASTO_VALE_MS) return;
    if (!deps.gasto) {
      if (!gasto || gasto.dia !== dia) gasto = { dia, microdolares: 0, lidoEm: agora };
      return;
    }
    gasto = { dia, microdolares: await deps.gasto.ler(dia), lidoEm: agora };
  }

  async function contarGasto(pessoaId: string, modelo: string, fichas: { entrada: number; saida: number }): Promise<void> {
    const custo = custoDaRevisao(modelo, fichas);
    if (custo <= 0) return;
    const agora = deps.agora();
    const dia = inicioDoDia(agora);
    const antes = gasto && gasto.dia === dia ? gasto.microdolares : 0;
    const antesDaPessoa = daPessoaHoje(pessoaId);
    try {
      const somado = deps.gasto ? await deps.gasto.somar(dia, custo, pessoaId) : { total: antes + custo, pessoa: antesDaPessoa + custo };
      gasto = { dia, microdolares: somado.total, lidoEm: agora };
      guardarDaPessoa(pessoaId, dia, somado.pessoa);
    } catch (e) {
      // O gasto não foi gravado: a memória soma assim mesmo (o teto chega antes, nunca depois).
      gasto = { dia, microdolares: antes + custo, lidoEm: gasto?.lidoEm ?? agora };
      guardarDaPessoa(pessoaId, dia, antesDaPessoa + custo);
      log("erro", "revisor_gasto_nao_gravado", { microdolares: custo, erro: e instanceof Error ? e.name : "desconhecido" });
    }
    if (antes < deps.config.tetoGlobalMicrodolares && (gasto?.microdolares ?? 0) >= deps.config.tetoGlobalMicrodolares) {
      log("aviso", "revisor_teto_global", { microdolares: gasto?.microdolares ?? null, teto: deps.config.tetoGlobalMicrodolares });
    }
    if (antesDaPessoa < deps.config.tetoPessoaMicrodolares && daPessoaHoje(pessoaId) >= deps.config.tetoPessoaMicrodolares) {
      log("aviso", "revisor_teto_pessoa", { microdolares: daPessoaHoje(pessoaId), teto: deps.config.tetoPessoaMicrodolares });
    }
  }

  /** A cota da pessoa, relida do banco (a outra cor também soma). Sem conseguir ler: a cota conta como batida (cartão). */
  async function cotaDaPessoaBatida(pessoaId: string): Promise<boolean> {
    if (deps.gasto) {
      const dia = inicioDoDia(deps.agora());
      try {
        guardarDaPessoa(pessoaId, dia, await deps.gasto.lerDaPessoa(dia, pessoaId));
      } catch (e) {
        log("erro", "revisor_gasto_ilegivel", { pessoa: true, erro: e instanceof Error ? e.name : "desconhecido" });
        return true;
      }
    }
    return cotaBatida(pessoaId);
  }

  async function entregar(p: PedidoNaFila, resultado: ResultadoRevisao): Promise<void> {
    try {
      await deps.assentar({ escopo: p.escopo, decisaoId: p.pedido.decisaoId, resultado });
    } catch (e) {
      // A decisão fica `em_revisao`: o varredor de expiração a recolhe em até 2 × o prazo.
      log("erro", "revisao_assentar_falhou", { decisao_id: p.pedido.decisaoId, erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  const falhar = (p: PedidoNaFila, falha: FalhaRevisao, extra: Omit<Extract<ResultadoRevisao, { tipo: "falha" }>, "tipo" | "falha"> = {}) =>
    entregar(p, { tipo: "falha", falha, ...extra });

  async function rodar(p: PedidoNaFila): Promise<void> {
    const { pedido } = p;
    const cliente = deps.cliente;
    if (!cliente) return falhar(p, "sem_revisor");
    if (abertoAte > deps.agora()) return falhar(p, "disjuntor");
    try {
      await lerGasto(false);
    } catch (e) {
      // Sem saber o gasto do dia, o lado seguro é o cartão.
      log("erro", "revisor_gasto_ilegivel", { erro: e instanceof Error ? e.name : "desconhecido" });
      return falhar(p, "teto_global");
    }
    if (tetoBatido()) return falhar(p, "teto_global");
    const pessoaId = p.escopo.pessoaId;
    if (await cotaDaPessoaBatida(pessoaId)) return falhar(p, "teto_pessoa");
    const restante = pedido.expiraEm - deps.agora();
    if (restante <= 0) {
      // O prazo vencido NA FILA não conta no disjuntor (revisão do #524, item 3): a fila cheia de uma conta não é a API
      // fora; as chamadas lentas de verdade já contam como `prazo` quando vencem em voo.
      log("aviso", "revisao_prazo", { decisao_id: pedido.decisaoId, turno_id: pedido.turnoId, na_fila: true });
      return falhar(p, "prazo");
    }
    const entregueEm = deps.agora();
    const r = await cliente.revisar({ modelo: pedido.modelo, sistema: pedido.prompt, entrada: pedido.entrada, prazoMs: restante });
    if (r.fichasEntrada !== undefined || r.fichasSaida !== undefined) await contarGasto(pessoaId, pedido.modelo, { entrada: r.fichasEntrada ?? 0, saida: r.fichasSaida ?? 0 });
    if (!r.ok) {
      // Só a falha do serviço conta; a recusa e o 400 (o conteúdo do pedido pode provocá-los) nem contam nem zeram.
      // QA do #524: o prazo vencido EM VOO só conta quando a chamada saiu com pelo menos metade do prazo. A que saiu da
      // fila com o prazo quase no fim vence por causa da fila, não do serviço: uma rajada de uma conta só (4 turnos × 20)
      // contra a API saudável (2,5 s por resposta) abria o disjuntor de todas por 2 min.
      const prazoDaFila = r.falha === "prazo" && restante < deps.config.prazoMs * FRACAO_DO_PRAZO_QUE_CONTA;
      if (contaNoDisjuntor(r) && !prazoDaFila) disjuntor(false);
      log("aviso", r.falha === "prazo" ? "revisao_prazo" : "revisao_api_falhou", { decisao_id: pedido.decisaoId, turno_id: pedido.turnoId, motivo: r.motivo, status: r.status ?? null, ms: r.ms });
      return falhar(p, r.falha, { ms: r.ms, entregueEm });
    }
    // A API respondeu: o serviço está de pé, e o disjuntor zera mesmo que o texto saia fora do esquema (o cartão `saida`
    // vem da fase 3). Antes, o texto fora do esquema contava, e uma conta abria o disjuntor de todas por injeção.
    disjuntor(true);
    return entregar(p, { tipo: "saida", saida: r.texto, ms: r.ms, fichasEntrada: r.fichasEntrada, fichasSaida: r.fichasSaida, entregueEm });
  }

  function bombear(): void {
    while (correndo.size < limiteEmVoo && esperando.length > 0) {
      const p = esperando.shift()!;
      const t: Promise<void> = rodar(p)
        .catch((e: unknown) => {
          log("erro", "revisao_executor_falhou", { decisao_id: p.pedido.decisaoId, erro: e instanceof Error ? e.name : "desconhecido" });
        })
        .finally(() => {
          correndo.delete(t);
          bombear();
        });
      correndo.add(t);
    }
  }

  return {
    config: deps.config,
    indisponivel,

    enfileirar(p) {
      if (esperando.length >= filaMax) {
        log("aviso", "revisao_fila_cheia", { decisao_id: p.pedido.decisaoId, esperando: esperando.length });
        const t: Promise<void> = falhar(p, "fila").finally(() => {
          correndo.delete(t);
          bombear();
        });
        correndo.add(t);
        return;
      }
      esperando.push(p);
      bombear();
    },

    async ocioso() {
      while (correndo.size > 0 || esperando.length > 0) await Promise.allSettled([...correndo]);
    },

    async atualizarGasto() {
      try {
        await lerGasto(true);
      } catch (e) {
        log("aviso", "revisor_gasto_ilegivel", { erro: e instanceof Error ? e.name : "desconhecido" });
      }
    },

    emMemoria() {
      return { esperando: esperando.length, emVoo: correndo.size, gastoHoje: gastoDeHoje(), disjuntorAte: abertoAte > deps.agora() ? abertoAte : null, pessoasNoDia: gastoPorPessoa.size };
    },
  };
}
