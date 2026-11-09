import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import {
  type AcaoEsperaDeColega,
  decidirEsperaDeColega,
  entradaDaCobranca,
  esperaVencida,
  MAX_COBRANCAS,
  MOTIVO_LIMPEZA,
  motivoDaDesistencia,
  podeCobrar,
  PRAZO_ESPERA_DE_COLEGA_MS,
  TETO_ESPERA_DE_COLEGA_MS,
} from "../domain/espera-de-colega.ts";
import { motivoEmPortugues } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import type { EsperaDeColegaLida } from "../repositories/pedidos-de-colega.repo.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { avisarFalhaDelegacao, desistirDoPedido, entregarRespostaPeer, fecharNaConversaDoPedido, fecharPedidoSemAcordar } from "./entregar-resposta-peer.ts";
import { ADIAR_PEDIDO_IGNORADO_MS, type PedidosAdiados } from "./pedidos-parados.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";

/** A regra que assina a reentrega automática (como a retomada automática do varredor de pedidos parados). */
export const REGRA_REENTREGA_AUTOMATICA = "regra:reentrega_automatica" as const;
/** O Cobrar do painel: a pessoa pediu (o turno_criado leva a pessoa na autoria). */
export const REGRA_COBRAR = "regra:cobrar_espera" as const;

export type SaidaEsperasDeColega = { reentregues: string[]; entregues: string[]; avisados: string[]; limpos: string[] };

/**
 * Revisão 2 do PR #544 (M1): o pedido que só espera (cadeia rodando, frentes, decisão, ou na fila dentro do prazo) não volta
 * por 30 min — mais que o intervalo entre passadas (5 min): com o limite de 50 por passada, os mesmos 50 que esperam não
 * tomam a vez dos outros. O ignorado e o erro voltam em 5 min, como no varredor de pedidos parados.
 */
export const ADIAR_ESPERA_MS = 30 * 60_000;

/**
 * Fechado o pedido de vez (o aviso do prazo, o Desistir), o que da cadeia ainda está na fila sai dela (revisão 2 do PR
 * #544, M5): o colega não trabalha para quem não espera mais. O que já roda segue (não se interrompe trabalho no meio);
 * o resultado dele só fica registrado (o aviso é final).
 */
/**
 * As travas de um pedido, sempre nesta ordem (revisão 5 do PR #544, M1): os trabalhos da cadeia do colega e depois a raiz
 * — a ordem do assentar do turno dele (trabalho → raiz). O pendente da cadeia é cancelado com SKIP LOCKED (revisão 4).
 */
async function travarPedido(deps: Pick<Deps, "repos">, tarefaId: string): Promise<void> {
  await deps.repos.pedidosDeColega.travarTrabalhosDaCadeia(tarefaId);
  await deps.repos.pedidosDeColega.travarTarefa(tarefaId);
}

async function cancelarPendentesDaCadeia(deps: Deps, tarefaId: string, quem: "pessoa" | "prazo"): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const agora = deps.agora();
  // Revisão 3 do PR #544 (M2): só o Desistir é da pessoa; o fecho do prazo é regra — a trilha não atribui à pessoa um
  // Parar que ela não fez, e o turno do colega sai como "vencido", não "parado por você".
  const motivo = quem === "pessoa" ? "parado_pela_pessoa" : "vencido";
  for (const id of await deps.repos.pedidosDeColega.pendentesDaCadeia(tarefaId)) {
    const turno = await deps.repos.turnos.cancelarPendente(id, motivo, { pularTravado: true });
    if (!turno) continue;
    const autoria = quem === "pessoa" ? autoriaPessoa(deps.escopo) : autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: "regra:esperas_de_colega" });
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo, estava: "pendente" } }));
    events.push(...(await sincronizarDoTurno(deps, turno)));
  }
  return events;
}

/**
 * Cada pedido na SUA transação (revisão 3 do PR #544, M1): o que lança volta sozinho e os outros saem, e as travas do
 * pedido (a raiz, o FOR UPDATE do trabalho de quem pediu) soltam no commit dele. Com um savepoint por pedido numa
 * transação só, a trava do trabalho de um pedido B ficava presa enquanto a passada esperava a raiz de um pedido A do mesmo
 * trabalho, e o assentar de A (raiz → trabalho) fechava o ciclo: deadlock. Sem `porPedido` (testes), roda tudo nas `deps`.
 * Com ele, os eventos do pedido são gravados na transação do pedido.
 */
export type PorPedido = <T>(fn: (d: Deps) => Promise<T>) => Promise<T>;

/** A passada do fundo: só o relógio de fora; toda leitura e gravação passa por `porPedido` (nenhuma transação aninhada). */
export type BaseDaPassada = Pick<Deps, "agora">;

/** Sem `porPedido` (testes, numa transação só), usa as `deps` inteiras. */
function rodarNo(deps: Deps | BaseDaPassada, porPedido: PorPedido | undefined): PorPedido {
  if (porPedido) return porPedido;
  if (!("repos" in deps)) throw new ErroDeDominio("estado_invalido", { cause: "passada sem porPedido nem repos" });
  return (fn) => fn(deps);
}

async function noPedido(deps: Deps | BaseDaPassada, porPedido: PorPedido | undefined, fn: (d: Deps) => Promise<{ ev: RuntimeEvent[]; ign: string | null }>): Promise<{ ev: RuntimeEvent[]; ign: string | null }> {
  if (!porPedido) return rodarNo(deps, undefined)(fn);
  return porPedido(async (d) => {
    const r = await fn(d);
    if (r.ev.length) await d.repos.events.gravarComOutbox(r.ev);
    return { ev: [], ign: r.ign };
  });
}

/**
 * Reentrega o pedido ao colega (a automática e o Cobrar do painel): uma retomada do último turno da cadeia, com a marca da
 * cobrança na entrada (é por ela que o repositório conta as cobranças e recomeça o prazo). Com a cadeia ainda na fila, a
 * entrada se junta à retomada que espera (enfileirarRetomada).
 */
async function reentregar(deps: Deps, e: EsperaDeColegaLida, turnoId: string, decididoPor: `regra:${string}`, pela: "regra" | "pessoa" = "regra"): Promise<RuntimeEvent[] | null> {
  const original = await deps.repos.turnos.buscar(turnoId);
  if (!original) return null;
  const agora = deps.agora();
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_ESPERA_DE_COLEGA_MS,
    entradaTexto: entradaDaCobranca(e.tarefaId, e.deNome),
    reenvios: original.reenvios + 1,
  });
  if (!turno) return null;
  const autoria = pela === "pessoa" ? autoriaPessoa(deps.escopo) : autoriaAgente({ agenteId: original.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: original.executor, decididoPor });
  const events: RuntimeEvent[] = [];
  if (nova) events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, reenvios: turno.reenvios, regra: decididoPor } }));
  events.push(...(await sincronizarDoTurno(deps, turno)));
  return events;
}

/** Fecha no teto: pela raiz e, se a entrega for ignorada por algo estrutural, direto na conversa do handoff (M2). */
async function fecharNoTeto(deps: Deps, e: EsperaDeColegaLida, resultado: string | null): Promise<{ ev: RuntimeEvent[]; fechou: boolean; ign: string | null }> {
  const r = await fecharNoTetoSemCancelar(deps, e, resultado);
  // Revisão 5 do PR #544 (M2): o fecho do teto também é final — o que da cadeia ainda está na fila sai dela.
  return r.fechou ? { ...r, ev: [...r.ev, ...(await cancelarPendentesDaCadeia(deps, e.tarefaId, "prazo"))] } : r;
}

async function fecharNoTetoSemCancelar(deps: Deps, e: EsperaDeColegaLida, resultado: string | null): Promise<{ ev: RuntimeEvent[]; fechou: boolean; ign: string | null }> {
  const f = await fecharPedidoSemAcordar(deps, { turnoId: e.tarefaId, motivo: MOTIVO_LIMPEZA, resultado });
  if ("ignorado" in f.data && f.data.ignorado === "fechado_sem_acordar") return { ev: f.events ?? [], fechou: true, ign: null };
  if ("mensagem" in f.data) return { ev: f.events ?? [], fechou: true, ign: null };
  log("aviso", "espera_fechada_na_conversa_do_pedido", { tarefa_id: e.tarefaId, ignorado: f.data.ignorado });
  const ev = await fecharNaConversaDoPedido(deps, { conversaId: e.conversaId, tarefaId: e.tarefaId, colega: { id: e.colegaId, nome: e.colegaNome }, motivo: MOTIVO_LIMPEZA });
  return { ev: [...(f.events ?? []), ...ev], fechou: ev.length > 0, ign: ev.length > 0 ? null : f.data.ignorado };
}

/** Executa a ação decidida para um pedido (já sob a trava da raiz). */
async function agir(deps: Deps, e: EsperaDeColegaLida, acao: AcaoEsperaDeColega, saida: SaidaEsperasDeColega): Promise<{ ev: RuntimeEvent[]; ign: string | null }> {
  if (acao.tipo === "esperar") return { ev: [], ign: "esperando" };
  if (acao.tipo === "reentregar") {
    const ev = await reentregar(deps, e, acao.turnoId, REGRA_REENTREGA_AUTOMATICA);
    if (ev) saida.reentregues.push(e.tarefaId);
    return { ev: ev ?? [], ign: ev ? null : "reentrega_sem_efeito" };
  }
  if (acao.tipo === "limpar") {
    const f = await fecharNoTeto(deps, e, acao.resultado);
    if (f.fechou) saida.limpos.push(e.tarefaId);
    return { ev: f.ev, ign: f.ign };
  }
  if (acao.tipo === "entregar") {
    const f = await entregarRespostaPeer(deps, { tarefaId: acao.turnoId, texto: acao.texto });
    if ("mensagem" in f.data) {
      saida.entregues.push(e.tarefaId);
      return { ev: f.events ?? [], ign: null };
    }
    // Revisão do PR #544 (A1): a entrega ainda espera algo da cadeia (frentes da triagem, a pessoa, outro colega, uma
    // volta). Não é "sem resposta": espera — o teto fecha o que nunca acabar.
    return { ev: f.events ?? [], ign: f.data.ignorado };
  }
  // Os avisos do prazo (sem resposta, não começou) são finais, como o Desistir (M7): um resultado tardio só registra, e o
  // que da cadeia ainda espera na fila sai dela (M5).
  const f = acao.final
    ? await desistirDoPedido(deps, { turnoId: acao.turnoId, motivo: acao.motivo })
    : await avisarFalhaDelegacao(deps, { turnoId: acao.turnoId, motivo: acao.motivo, semEsperar: true });
  const avisou = "mensagem" in f.data || f.data.ignorado === "quem_pediu_parado";
  if (!avisou) return { ev: f.events ?? [], ign: "ignorado" in f.data ? f.data.ignorado : null };
  saida.avisados.push(e.tarefaId);
  const canceladas = acao.final ? await cancelarPendentesDaCadeia(deps, e.tarefaId, "prazo") : [];
  return { ev: [...(f.events ?? []), ...canceladas], ign: null };
}

/**
 * NOD-377 (definido em 2026-10-27): toda espera de colega tem fim. O varredor de expiração chama isto a cada passada, numa
 * transação própria, depois do varredor de pedidos parados (que segue com as quedas recentes, ADR-084). Sem janela de
 * idade: cada pedido aberto passa pela regra pura (src/domain/espera-de-colega.ts) e vira reentrega, entrega do resultado
 * que ficou para trás, aviso a quem pediu ou, depois de 7 dias, fecho em silêncio.
 */
export async function cuidarDasEsperasDeColega(deps: Deps, o?: { adiados?: PedidosAdiados; porPedido?: PorPedido }): Promise<{ data: SaidaEsperasDeColega; events: RuntimeEvent[] }>;
export async function cuidarDasEsperasDeColega(deps: BaseDaPassada, o: { adiados?: PedidosAdiados; porPedido: PorPedido }): Promise<{ data: SaidaEsperasDeColega; events: RuntimeEvent[] }>;
export async function cuidarDasEsperasDeColega(deps: Deps | BaseDaPassada, o: { adiados?: PedidosAdiados; porPedido?: PorPedido } = {}): Promise<{ data: SaidaEsperasDeColega; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const saida: SaidaEsperasDeColega = { reentregues: [], entregues: [], avisados: [], limpos: [] };
  const events: RuntimeEvent[] = [];
  if (o.adiados) for (const [id, ate] of o.adiados) if (ate <= agora) o.adiados.delete(id);
  const adiados = o.adiados ? [...o.adiados.keys()] : [];
  const esperas = await rodarNo(deps, o.porPedido)((d) => d.repos.pedidosDeColega.esperasDeColega(agora, { adiados }));
  for (const lida of esperas) {
    let acao: AcaoEsperaDeColega = decidirEsperaDeColega(lida, agora, motivoEmPortugues);
    let ignorado: string | null = null;
    try {
      const r = acao.tipo === "esperar" ? { ev: [], ign: "esperando" } : await noPedido(deps, o.porPedido, async (d) => {
        // Revisão 2 do PR #544 (M4): a decisão se refaz sob a trava da raiz, com o pedido relido — entre a leitura da passada
        // e aqui o despachante pode ter pegado o turno, ou o assentar ter entregado.
        await travarPedido(d, lida.tarefaId);
        const [e] = await d.repos.pedidosDeColega.esperasDeColega(agora, { tarefaId: lida.tarefaId, limite: 1 });
        if (!e) return { ev: [], ign: null };
        acao = decidirEsperaDeColega(e, agora, motivoEmPortugues);
        return agir(d, e, acao, saida);
      });
      events.push(...r.ev);
      ignorado = r.ign;
    } catch (erro) {
      ignorado = "erro";
      log("erro", "espera_de_colega_falhou", { tarefa_id: lida.tarefaId, acao: acao.tipo, erro: erro instanceof ErroDeDominio ? erro.codigo : erro instanceof Error ? erro.name : "desconhecido" });
    }
    // #218: o que ficou não volta logo — a consulta tem limite, e os mais velhos na frente não podem tomar a vez dos outros.
    if (ignorado) o.adiados?.set(lida.tarefaId, agora + (ignorado === "esperando" ? ADIAR_ESPERA_MS : ADIAR_PEDIDO_IGNORADO_MS));
    if (acao.tipo !== "esperar") log("info", "espera_de_colega_tratada", { tarefa_id: lida.tarefaId, acao: acao.tipo, ignorado, idade_ms: agora - lida.criadoEm, cobrancas: lida.cobrancas });
  }
  return { data: saida, events };
}

/** A espera que a pessoa vê no painel do bot `agenteId` (quem pediu). Não achada = já fechou ou não é deste bot. */
async function esperaDoPainel(deps: Deps, agenteId: string, tarefaId: string): Promise<EsperaDeColegaLida> {
  const [e] = await deps.repos.pedidosDeColega.esperasDeColega(deps.agora(), { tarefaId, de: agenteId, limite: 1 });
  if (!e) throw new ErroDeDominio("nao_encontrado", { cause: "espera de colega" });
  return e;
}

export type SaidaCobrar = { cobradoEm: number; cobrancas: number };

/**
 * Cobrar (painel, NOD-377): a pessoa reentrega o pedido vencido ao colega, uma vez. O relógio do prazo recomeça; se o
 * colega de novo não responder em 24 h, o varredor fecha com o aviso.
 */
export async function cobrarEspera(deps: Deps, input: { agenteId: string; tarefaId: string }): Promise<{ data: SaidaCobrar; events: RuntimeEvent[] }> {
  // Revisão 2 do PR #544 (B1): a trava da raiz, a mesma do varredor e do assentar — não a do pedir_a_bot do tenant.
  await travarPedido(deps, input.tarefaId);
  const e = await esperaDoPainel(deps, input.agenteId, input.tarefaId);
  const agora = deps.agora();
  const ocupada = e.rodando || e.naFila || e.aguardando;
  if (!podeCobrar({ ...e, ocupada }, agora)) throw new ErroDeDominio("estado_invalido", { cause: e.cobrancas >= MAX_COBRANCAS ? "já cobrado" : ocupada ? "colega trabalhando" : "espera no prazo" });
  const events = await reentregar(deps, e, e.retomarDe ?? e.tarefaId, REGRA_COBRAR, "pessoa");
  if (!events) throw new ErroDeDominio("estado_invalido", { cause: "reentrega sem efeito" });
  return { data: { cobradoEm: agora, cobrancas: e.cobrancas + 1 }, events };
}

/**
 * Desistir (painel, NOD-377): a pessoa fecha a espera. O aviso fica gravado na conversa de quem pediu
 * ("<colega> não concluiu: a pessoa desistiu depois de X sem resposta") e o bot é acordado uma vez: segue com o que tem e
 * oferece pedir de novo (protótipo aprovado). É final: um resultado tardio do colega só fica registrado.
 */
export async function desistirDaEspera(deps: Deps, input: { agenteId: string; tarefaId: string }): Promise<{ data: { fechado: true }; events: RuntimeEvent[] }> {
  await travarPedido(deps, input.tarefaId);
  const e = await esperaDoPainel(deps, input.agenteId, input.tarefaId);
  // Revisão do PR #544 (B16): o painel só oferece o Desistir na espera vencida ou já cobrada.
  if (!esperaVencida(e, deps.agora()) && e.cobrancas === 0) throw new ErroDeDominio("estado_invalido", { cause: "espera no prazo" });
  const f = await desistirDoPedido(deps, { turnoId: e.tarefaId, motivo: motivoDaDesistencia(e.criadoEm, deps.agora()) });
  // Quem pediu parado (o Parar da pessoa no bot): o aviso fica registrado sem continuação — também fecha.
  if (!("mensagem" in f.data) && f.data.ignorado !== "quem_pediu_parado") throw new ErroDeDominio("estado_invalido", { cause: f.data.ignorado });
  return { data: { fechado: true }, events: [...(f.events ?? []), ...(await cancelarPendentesDaCadeia(deps, e.tarefaId, "pessoa"))] };
}

/** Um pedido da limpeza: `fechado` é false no dry-run, no que falhou e no que já tinha fechado sozinho. */
/** `situacao`: fechado agora, já fechado por outro caminho, vivo (um turno da cadeia roda agora; fica para a passada) ou falhou. */
export type PedidoDaLimpeza = { tarefaId: string; de: string; colega: string; idadeDias: number; fechado: boolean; situacao?: "fechado" | "ja_fechado" | "vivo" | "falhou" };

/**
 * Limpeza única (scripts/limpar-esperas-nod-377.ts): fecha em silêncio os pedidos abertos com mais de 7 dias (o teto),
 * com o motivo "pedido antigo sem resposta (limpeza NOD-377)". Idempotente: fechar grava o peer_ask, que tira o pedido de
 * "aberto"; a segunda rodada não acha nada. `dryRun` só lista.
 */
export async function limparEsperasAntigas(deps: Deps | BaseDaPassada, o: { dryRun: boolean; porPedido?: PorPedido }): Promise<{ data: { pedidos: PedidoDaLimpeza[]; fechados: number; falhas: number }; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const pedidos: PedidoDaLimpeza[] = [];
  const events: RuntimeEvent[] = [];
  let fechados = 0;
  let falhas = 0;
  const vistos = new Set<string>();
  for (;;) {
    const jaVistos = [...vistos];
    const lote = (await rodarNo(deps, o.porPedido)((d) => d.repos.pedidosDeColega.esperasDeColega(agora, { adiados: jaVistos, limite: 200 }))).filter((e) => !vistos.has(e.tarefaId));
    if (lote.length === 0) break;
    for (const e of lote) {
      vistos.add(e.tarefaId);
      // Revisão 6 do PR #544 (M5): o CA7 é "0 esperas com mais de 7 d" — a limpeza única conta da idade do PEDIDO, não da
      // última cobrança (o teto do varredor, que recomeça na cobrança, segue em inicioDoPrazo).
      if (agora - e.criadoEm < TETO_ESPERA_DE_COLEGA_MS) continue;
      const item: PedidoDaLimpeza = { tarefaId: e.tarefaId, de: e.deNome, colega: e.colegaNome, idadeDias: Math.floor((agora - e.criadoEm) / 86_400_000), fechado: false };
      pedidos.push(item);
      if (o.dryRun) continue;
      // Revisão do PR #544 (M11): um pedido que lança volta sozinho (transação própria) e não derruba a limpeza da pessoa.
      try {
        let fechou = false;
        const r = await noPedido(deps, o.porPedido, async (d) => {
          // Revisão 3 do PR #544 (B2): sob a trava da raiz e relido, como no varredor — o assentar pode ter entregado.
          await travarPedido(d, e.tarefaId);
          const [atual] = await d.repos.pedidosDeColega.esperasDeColega(agora, { tarefaId: e.tarefaId, limite: 1 });
          if (!atual || agora - atual.criadoEm < TETO_ESPERA_DE_COLEGA_MS) {
            item.situacao = "ja_fechado";
            return { ev: [], ign: null };
          }
          // QA do PR #544 (bug 1): um turno da cadeia vivo agora não é cortado em silêncio; a passada fecha quando ele acabar.
          if (atual.vivo) {
            item.situacao = "vivo";
            return { ev: [], ign: null };
          }
          const acao = decidirEsperaDeColega(atual, agora, motivoEmPortugues);
          // Revisão 2 do PR #544 (M2): o mesmo fecho do teto do varredor, com o último recurso na conversa do handoff.
          const f = await fecharNoTeto(d, atual, acao.tipo === "limpar" ? acao.resultado : null);
          fechou = f.fechou;
          return { ev: f.ev, ign: f.fechou ? null : "nao_fechou" };
        });
        item.fechado = fechou;
        if (fechou) {
          fechados++;
          item.situacao = "fechado";
        } else if (r.ign) {
          falhas++;
          item.situacao = "falhou";
        }
        events.push(...r.ev);
      } catch (erro) {
        falhas++;
        item.situacao = "falhou";
        log("erro", "limpar_espera_falhou", { tarefa_id: e.tarefaId, erro: erro instanceof ErroDeDominio ? erro.codigo : erro instanceof Error ? erro.name : "desconhecido" });
      }
    }
  }
  return { data: { pedidos, fechados, falhas }, events };
}
