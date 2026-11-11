import { varrerRiscosDosQuadros } from "../../use-cases/risco-quadro.ts";
import { varrerAvisosDosQuadros } from "../../use-cases/avisos-quadro.ts";
import type { Executor } from "../../contracts/evento.ts";
import { cuidarDasExecucoesDoQuadro } from "../../use-cases/quadro-execucoes.ts";
import type { Decisao } from "../../contracts/decisao.ts";
import { ehErroDeDominio } from "../../domain/erro.ts";
import { redigir } from "../../domain/redacao.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import { podarLimitesConta } from "../../repositories/contas.repo.ts";
import type { Db, Escopo, Relogio, Transacao, Tx } from "../../shared/types.ts";
import { autoriaPessoa, carimbo, evento } from "../../use-cases/apoio-l7.ts";
import { vencerPedidoDaRotina } from "../../use-cases/decidir-acesso.ts";
import { expirarItensNaMaquina } from "../../use-cases/itens-na-maquina.ts";
import { registrarDesfechoRotina, TIPOS_GATE_ROTINA, TIPOS_QUE_SEGURAM_A_EXECUCAO } from "../../use-cases/disparar-rotina.ts";
import { avisarFalhaDelegacao } from "../../use-cases/entregar-resposta-peer.ts";
import { cuidarDasFrentesCaidas } from "../../use-cases/frentes-caidas.ts";
import { cuidarDasEsperasDeColega } from "../../use-cases/esperas-de-colega.ts";
import { cuidarDosPedidosParados, type PedidosAdiados } from "../../use-cases/pedidos-parados.ts";
import { cuidarDosTurnosOrfaos, type TurnosObservados } from "../../use-cases/turnos-orfaos.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "../../use-cases/autoria-evento.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import { sincronizarDasDecisoes } from "../../use-cases/trabalhos.ts";
import { recolherRevisoesVelhas } from "../../use-cases/revisar-acao.ts";
import { RECOLHER_REVISAO_MS } from "../../contracts/revisao.ts";
import { varrerTrocasDeIa } from "../../use-cases/trocas-de-ia.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: 30 s — a spec aceita "em ≤30s" para o vencimento aparecer (fluxo SUA VEZ E EXPIRAÇÃO). */
export const INTERVALO_VARREDOR_MS = 30_000;

export type OpcoesVarredor = {
  services: Services;
  useCases: UseCasesNod;
  agora: Relogio;
  metricas?: Metricas;
  /** #218: pedidos parados adiados entre as passadas (pedidos-parados.ts); o laço cria um mapa só para o processo. */
  pedidosAdiados?: PedidosAdiados;
  /** NOD-377: as esperas de colega adiadas entre as passadas (esperas-de-colega.ts), num mapa à parte do de cima. */
  esperasAdiadas?: PedidosAdiados;
  /**
   * NOD-377 (revisão do PR #544): a última passada das esperas de colega por pessoa (`tenant:pessoa`). A leitura não tem
   * janela de idade; uma a cada INTERVALO_ESPERAS_DE_COLEGA_MS basta (o prazo é de 24 h). Ausente = toda passada (testes).
   */
  esperasPassadas?: Map<string, number>;
  /** NOD-415: a última passada dos riscos de prazo dos quadros, por pessoa; uma a cada INTERVALO_RISCOS_QUADRO_MS. Ausente = toda passada (testes). */
  riscosPassados?: Map<string, number>;
  /** NOD-219: quando cada turno velho na fila foi observado (turnos-orfaos.ts); o laço cria um mapa só para o processo. */
  turnosObservados?: TurnosObservados;
  /**
   * NOD-420 (revisão 3 do PR #624): o executor configurado agora (valor vivo, como o scheduler), para o turno que a
   * cobrança do prazo de coluna abre. Ausente: o do turno anterior da tarefa, senão "local".
   */
  executor?: () => Executor;
  /** ADR-115: a idade a partir da qual a decisão `em_revisao` vira cartão; ausente = RECOLHER_REVISAO_MS (2 × o prazo). Só o teste muda. */
  recolherRevisaoMs?: number;
};

/** NOD-377: o intervalo entre duas passadas das esperas de colega da mesma pessoa. */
export const INTERVALO_ESPERAS_DE_COLEGA_MS = 5 * 60_000;
/** NOD-415 (ADR-141): o risco de prazo chega com o tempo; uma passada a cada 15 min basta (o aviso é de dias). */
export const INTERVALO_RISCOS_QUADRO_MS = 15 * 60_000;

/** ADR-115 (0093): a retenção de `acoes_pelo_modo` (o resumo da ação e o motivo do revisor são texto livre). */
export const RETENCAO_ACOES_PELO_MODO_MS = 90 * 24 * 60 * 60_000;
/**
 * definido em 2026-11-10 (ADR-165, 0170): a retenção dos passos do run (`turno_passos`, o resumo do argumento e o começo
 * de cada fala). O turno_raio_x não tem poda automática (ADR-054, "Não implementado"); vale o critério de acoes_pelo_modo.
 */
export const RETENCAO_TURNO_PASSOS_MS = 90 * 24 * 60 * 60_000;
/** definido em 2026-10-20 (NOD-293 E7, 0097): a chave de idempotência da nativa só vale durante a chamada do hook. */
export const RETENCAO_NATIVAS_IDEMPOTENCIA_MS = 24 * 60 * 60_000;
/** NOD-323 (ADR-126): a mídia do bot que nenhuma fala prendeu (turno silencioso, sem fala, caído) some depois disto. */
export const RETENCAO_MIDIA_SOLTA_MS = 24 * 60 * 60_000;
/** `pausadas` (definido em 2026-09-24, emenda da ADR-044): rotinas cujo pedido de acesso venceu. */
export type ResultadoVarredura = { vencidas: string[]; mensagens: number; passaramEmBranco: string[]; pausadas: string[] };

/**
 * definido em 2026-09-24: o que o desfecho quer dizer, em palavras — as mesmas do rótulo do card
 * vencido (web/telas/sua-vez.ts, rotuloVencido). Os VALORES da métrica (ADR-017 #2) não mudam.
 */
const DESFECHO_HUMANO: Readonly<Record<string, string>> = {
  expirou_sem_ninguem_ver: "ninguém chegou a ver",
  expirou_com_alguem_ciente: "alguém viu, mas ninguém respondeu",
};

/**
 * Varredura de UMA pessoa (E7.4, ADR-007/011): vencerPendentes escreve 'vencida' com o desfecho
 * que diz se alguém VIU (vista_em) → marcarVarrida(id, 'vencida') ON CONFLICT — só quem inseriu
 * escreve a mensagem com carimbo na conversa de origem e o evento (rodar duas vezes = uma
 * mensagem). Gate de rotina vencido (gate_rotina ou aprovacao ligada ao turno da rotina) → execução 'passou_em_branco' com motivo tipado
 * 'ninguem_respondeu_o_gate' e a frase "nada foi enviado" (E7.5), zero efeito externo. O atraso
 * (agora − prazo) vai ao log: é como se observa um varredor que ficou parado (E7.4.3).
 */
export async function varrerPessoa(escopo: Escopo, tx: Transacao, opcoes: OpcoesVarredor): Promise<ResultadoVarredura> {
  const resultado = await varrerDecisoes(escopo, tx, opcoes);
  // definido em 2026-10-08: os pedidos a colega que pararam sem voltar (pedidos-parados.ts), em transação própria — um
  // erro neles não desfaz o vencimento das decisões, e o próximo tique tenta de novo.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const r = await cuidarDosPedidosParados(deps, { adiados: opcoes.pedidosAdiados });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "pedidos_parados_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-10-27 (NOD-377): toda espera de colega tem fim — sem janela de idade, depois das quedas recentes de
  // cima. Cada pedido na sua transação (revisão 3 do PR #544, M1): o que lança volta sozinho, os outros saem, e as travas
  // de um pedido não ficam presas enquanto a passada trava o próximo (o impasse com o assentar do colega).
  const chaveEsperas = `${escopo.tenantId}:${escopo.pessoaId}`;
  const ultimaEsperas = opcoes.esperasPassadas?.get(chaveEsperas);
  const vezDasEsperas = ultimaEsperas === undefined || opcoes.agora() - ultimaEsperas >= INTERVALO_ESPERAS_DE_COLEGA_MS;
  if (vezDasEsperas) try {
    opcoes.esperasPassadas?.set(chaveEsperas, opcoes.agora());
    const depsDe = (trx: Tx): Deps => ({ repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora });
    const porPedido = <T>(fn: (d: Deps) => Promise<T>): Promise<T> => tx((trx) => fn(depsDe(trx)));
    // A leitura da passada também numa transação própria e curta; cada pedido relê sob a trava dele e grava os eventos
    // na transação dele. Nenhuma transação fica aberta esperando outra (o pool não se esgota).
    const inicio = performance.now();
    const r = await cuidarDasEsperasDeColega({ agora: opcoes.agora }, { adiados: opcoes.esperasAdiadas, porPedido });
    // ADR-132 (gatilho de reversão, revisão 5 do PR #544): a passada que passa de 1 s por pessoa fica registrada.
    const duracaoMs = Math.round(performance.now() - inicio);
    if (duracaoMs > 1_000) log("aviso", "esperas_de_colega_lenta", { tenant_id: escopo.tenantId, duracao_ms: duracaoMs, entregues: r.data.entregues.length, avisados: r.data.avisados.length, limpos: r.data.limpos.length });
  } catch (e) {
    log("erro", "esperas_de_colega_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // NOD-415 (ADR-141): o risco de prazo dos quadros, em transação própria; o aviso sai uma vez por (quadro, meta, prazo).
  const ultimaRiscos = opcoes.riscosPassados?.get(chaveEsperas);
  if (ultimaRiscos === undefined || opcoes.agora() - ultimaRiscos >= INTERVALO_RISCOS_QUADRO_MS) try {
    opcoes.riscosPassados?.set(chaveEsperas, opcoes.agora());
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const r = await varrerRiscosDosQuadros(deps);
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "riscos_quadro_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // NOD-420: as decisões pendentes (janela curta) e o prazo das colunas, a cada passada, em transação própria. O `tx` dos
  // deps é esta mesma transação: cada quadro e cada cobrança vão num SAVEPOINT dela (revisão do PR #624).
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx: (fn) => fn(trx), escopo, agora: opcoes.agora };
      const r = await varrerAvisosDosQuadros(deps, { executor: opcoes.executor?.() });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "avisos_quadro_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-11-02 (NOD-418): o fim de cada trabalho de tarefa do quadro (nova tentativa, Bloqueado, o recado que
  // a sessão não leu), em transação própria; cada tarefa decide com o quadro travado. O trabalho novo roda onde o
  // anterior rodou (o executor vem do turno). Revisão 3 do PR #625: cada tarefa num SAVEPOINT desta tx (o padrão dos
  // órfãos): a que lança volta sozinha, vai ao log com o id, e as outras saem.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const isolar = async <T>(fn: () => Promise<T>): Promise<T> => {
        const caixa: { valor?: T } = {};
        await trx.savepoint(async () => {
          caixa.valor = await fn();
        });
        return caixa.valor as T;
      };
      const r = await cuidarDasExecucoesDoQuadro(deps, { isolar });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "execucoes_quadro_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-10-12 (ADR-099, I9): as frentes de lote que caíram (frentes-caidas.ts), também em transação própria.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const r = await cuidarDasFrentesCaidas(deps, { adiados: opcoes.pedidosAdiados });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "frentes_caidas_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-10-13 (NOD-219): os turnos pendentes órfãos (turnos-orfaos.ts), em transação própria — encerra o que
  // nenhuma máquina pode pegar e observa o que passou do prazo da fila. Um erro aqui não desfaz os blocos de cima.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      // Cada candidato num SAVEPOINT desta tx: o que lança volta sozinho, e os outros saem (revisão do PR #307).
      const isolar = async <T>(fn: () => Promise<T>): Promise<T> => {
        const caixa: { valor?: T } = {};
        await trx.savepoint(async () => {
          caixa.valor = await fn();
        });
        return caixa.valor as T;
      };
      const r = await cuidarDosTurnosOrfaos(deps, { observados: opcoes.turnosObservados, metricas: opcoes.metricas ?? registroPadrao, isolar });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "turnos_orfaos_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-10-18 (ADR-115, plano dos modos de aprovação 3d): a decisão `em_revisao` mais velha que 2 × o prazo
  // vira cartão (a caixa do turno se perdeu num deploy) e a dona poda `acoes_pelo_modo` com mais de 90 dias. Em transação
  // própria: um erro aqui não desfaz os blocos de cima, e o próximo tique tenta de novo.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const r = await recolherRevisoesVelhas(deps, { recolherMs: opcoes.recolherRevisaoMs ?? RECOLHER_REVISAO_MS });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
      await deps.repos.acoesPeloModo.podar(opcoes.agora() - RETENCAO_ACOES_PELO_MODO_MS);
    });
  } catch (e) {
    log("erro", "revisoes_velhas_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // ADR-165 (0170): os passos do run com mais de 90 dias, em transação própria (índice turno_passos_por_dona).
  try {
    await tx(async (trx) => {
      await criarRepos(trx, escopo).turnoPassos.podar(opcoes.agora() - RETENCAO_TURNO_PASSOS_MS);
    });
  } catch (e) {
    log("erro", "turno_passos_poda_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // NOD-293 E7 (0097): a poda das chaves de idempotência das nativas, em transação própria.
  try {
    await tx(async (trx) => {
      await criarRepos(trx, escopo).nativasIdempotencia.podar(opcoes.agora() - RETENCAO_NATIVAS_IDEMPOTENCIA_MS);
    });
  } catch (e) {
    log("erro", "nativas_idempotencia_poda_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // NOD-408/LGPD: remove contadores globais vencidos mesmo sem novo cadastro/recuperação; a própria função limita a
  // uma execução por hora no processo, embora este varredor passe por cada pessoa.
  try {
    await tx((trx) => podarLimitesConta(trx, opcoes.agora()));
  } catch (e) {
    log("erro", "limites_conta_poda_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
  }
  // NOD-323 (ADR-126): a mídia do bot solta há mais de um dia (nenhuma fala a prendeu), em transação própria.
  try {
    await tx(async (trx) => {
      await criarRepos(trx, escopo).anexos.apagarSoltosDoBot(new Date(opcoes.agora() - RETENCAO_MIDIA_SOLTA_MS));
    });
  } catch (e) {
    log("erro", "midia_solta_poda_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  // definido em 2026-10-16 (ADR-108 R4/R6): os avisos de troca de IA (trocas-de-ia.ts), em transação própria — aplica o
  // "levar" vencido, fecha o aviso quando a conta volta e devolve o bot fixo que seguiu noutra IA até a volta. Revisão do
  // PR 2 (I5): cada aviso num SAVEPOINT desta tx (o padrão dos órfãos) — o que lança volta sozinho e os outros saem.
  try {
    await tx(async (trx) => {
      const deps: Deps = { repos: criarRepos(trx, escopo), services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
      const isolar = async <T>(fn: () => Promise<T>): Promise<T> => {
        const caixa: { valor?: T } = {};
        await trx.savepoint(async () => {
          caixa.valor = await fn();
        });
        return caixa.valor as T;
      };
      const r = await varrerTrocasDeIa(deps, { isolar });
      if (r.events.length) await deps.repos.events.gravarComOutbox(r.events);
    });
  } catch (e) {
    log("erro", "trocas_de_ia_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
  }
  return resultado;
}

async function varrerDecisoes(escopo: Escopo, tx: Transacao, opcoes: OpcoesVarredor): Promise<ResultadoVarredura> {
  const agora = opcoes.agora();
  return tx(async (trx) => {
    const repos = criarRepos(trx, escopo);
    const deps: Deps = { repos, services: opcoes.services, useCases: opcoes.useCases, tx, escopo, agora: opcoes.agora };
    const resultado: ResultadoVarredura = { vencidas: [], mensagens: 0, passaramEmBranco: [], pausadas: [] };
    const vencidas: Decisao[] = await repos.decisoes.vencerPendentes(agora);
    for (const d of vencidas) {
      resultado.vencidas.push(d.id);
      if (!(await repos.decisoes.marcarVarrida(d.id, "vencida"))) continue;
      // ADR-115: o cartão que a revisão deixou venceu (a linha em acoes_pelo_modo, quando há, guarda o desfecho).
      if (d.tipo === "aprovacao") await repos.acoesPeloModo.registrarDesfechoPessoa(d.id, "venceu");
      const tipoDesfecho = d.desfecho?.tipo ?? "expirou_sem_ninguem_ver";
      // ADR-017 #2: uma expiração por decisão vencida, rotulada pela causa que o repo devolveu (pendência L8 §4).
      if (tipoDesfecho === "expirou_sem_ninguem_ver" || tipoDesfecho === "expirou_com_alguem_ciente") {
        (opcoes.metricas ?? registroPadrao).incrementar({ metrica: "expiracao", causa: tipoDesfecho, tenant_id: escopo.tenantId });
      }
      const autoria = autoriaPessoa(escopo.pessoaId, "regra:varredor-expiracao");
      // definido em 2026-09-24 (emenda da ADR-044): o pedido de acesso de uma rotina que vence pausa a
      // rotina, e a linha da pausa ("ninguém liberou o acesso ao Gmail em 24h") substitui a de vencimento.
      const pedidoDaRotina = await vencerPedidoDaRotina(deps, d);
      if (pedidoDaRotina.pausada) {
        resultado.pausadas.push(pedidoDaRotina.pausada.id);
      } else if (!pedidoDaRotina.atendido) {
        // NOD-270 (I4): atendido = o acesso já tinha sido dado e o card fechou por regra; não há vencimento a contar.
        await repos.mensagens.criar({
          conversaId: d.conversaId,
          turnoId: d.turnoId,
          autoria,
          kind: "sistema",
          assunto: "decisao.vencida",
          texto: redigir("decisao-vencida", agora, { quando: carimbo(agora), desfecho: DESFECHO_HUMANO[tipoDesfecho] ?? tipoDesfecho }),
          confianca: "confiavel",
        });
      }
      if (!pedidoDaRotina.atendido) resultado.mensagens += 1;
      const events = [evento(deps, "decisao_vencida", autoria, { decisaoId: d.id, tipo: d.tipo, desfecho: tipoDesfecho, atrasoMs: agora - Date.parse(d.prazoDecisaoEm) }, { conversaId: d.conversaId, turnoId: d.turnoId }), ...pedidoDaRotina.events];
      // Gate de rotina = gate_rotina OU aprovacao ligada a um turno de rotina (TIPOS_GATE_ROTINA); se o
      // turno não é de rotina, registrarDesfechoRotina devolve 'nao_e_rotina' e nada mais acontece.
      // definido em 2026-09-24 (fio da pergunta): a pergunta vencida também fecha a janela — a execução
      // esperava por ela (TIPOS_QUE_SEGURAM_A_EXECUCAO) e não entregou.
      if (TIPOS_QUE_SEGURAM_A_EXECUCAO.has(d.tipo) && d.turnoId) {
        const motivo = TIPOS_GATE_ROTINA.has(d.tipo) ? "ninguem_respondeu_o_gate" : "pergunta_sem_resposta";
        const r = await registrarDesfechoRotina(deps, { turnoId: d.turnoId, desfecho: "passou_em_branco", motivo });
        if ("execucao" in r.data) {
          resultado.passaramEmBranco.push(r.data.rotina.id);
          resultado.mensagens += 1;
          events.push(...(r.events ?? []));
        }
      }
      // Revisão da ADR-047: venceu uma decisão de que a tarefa delegada dependia (acesso, aprovação, pergunta,
      // ou o "Retomar" de um turno que caiu com o Mac) — avisa o remetente. Turno fora de delegação: ignorado.
      if (d.turnoId) {
        const motivo = d.tipo === "acesso" ? "o pedido de acesso venceu sem resposta" : d.tipo === "retomar_turno" ? "o turno parou e ninguém retomou" : "a decisão pedida à pessoa venceu sem resposta";
        const r = await avisarFalhaDelegacao(deps, { turnoId: d.turnoId, motivo });
        events.push(...(r.events ?? []));
      }
      // Revisão do épico (S2, 2026-10-08): vencida, a decisão não segura mais a task do turno dela (nem o depois_de).
      events.push(...(await sincronizarDasDecisoes(deps, [d])));
      await repos.events.gravarComOutbox(events);
      log("info", "decisao_vencida_varrida", { decisao_id: d.id, tipo: d.tipo, desfecho: tipoDesfecho, atraso_ms: agora - Date.parse(d.prazoDecisaoEm) });
    }
    // Revisão da ADR-047: o card de CONEXÃO não tem decisão e nunca vence sozinho. Passado o prazo dele,
    // a tarefa delegada que esperava por ele avisa o remetente. Janela de um prazo depois do vencimento:
    // o aviso é uma vez por raiz, e a janela só limita quantas vezes o varredor pergunta.
    for (const p of await repos.propostas.acessosPendentesCriadosEntre(agora - 2 * PRAZO_DECISAO_PADRAO_MS, agora - PRAZO_DECISAO_PADRAO_MS)) {
      if (p.payload.kind !== "acesso" || typeof p.payload.turnoId !== "string" || (await repos.decisoes.buscar(p.id))) continue;
      const r = await avisarFalhaDelegacao(deps, { turnoId: p.payload.turnoId, motivo: "o pedido de conexão venceu sem resposta" });
      if (r.events?.length) await repos.events.gravarComOutbox(r.events);
    }
    // ADR-048: item aprovado que o Mac da dona não buscou no prazo vira falha e a decisão fecha.
    const noMac = await expirarItensNaMaquina(deps);
    if (noMac.events.length) await repos.events.gravarComOutbox(noMac.events);
    if (noMac.expirados > 0) log("info", "itens_na_maquina_expirados", { quantos: noMac.expirados });
    return resultado;
  });
}

export async function varrer(db: Db, opcoes: OpcoesVarredor, laco: OpcoesLaco = {}): Promise<void> {
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      try {
        await varrerPessoa(escopo, tx, opcoes);
      } catch (e) {
        log("erro", "varredura_falhou", { erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
        throw e;
      }
    },
    laco,
  );
}

export function iniciarVarredorExpiracao(db: Db, opcoesIniciais: OpcoesVarredor & { intervaloMs?: number }, laco: OpcoesLaco = {}): { parar(): Promise<void> } {
  const opcoes = { ...opcoesIniciais, pedidosAdiados: opcoesIniciais.pedidosAdiados ?? new Map<string, number>(), esperasAdiadas: opcoesIniciais.esperasAdiadas ?? new Map<string, number>(), esperasPassadas: opcoesIniciais.esperasPassadas ?? new Map<string, number>(), riscosPassados: opcoesIniciais.riscosPassados ?? new Map<string, number>(), turnosObservados: opcoesIniciais.turnosObservados ?? new Map<string, number>() };
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  const timer = setInterval(() => {
    if (rodando) return;
    rodando = true;
    emVoo = varrer(db, opcoes, laco)
      .catch((e: unknown) => log("erro", "varredor_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        rodando = false;
        emVoo = null;
      });
  }, opcoes.intervaloMs ?? INTERVALO_VARREDOR_MS);
  timer.unref();
  // NOD-218: `parar()` espera o tick em voo — a drenagem do deploy azul/verde não deixa um tick pela metade quando a
  // outra cor já assumiu.
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
