import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { criarRotasTrabalhos } from "../../src/adapters/http/rotas/trabalhos.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo, Transacao, Tx } from "../../src/shared/types.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-expiracao.ts";
import { varrerPessoa as varrerLease } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import {
  ENTRADA_DA_COBRANCA,
  marcaDaCobranca,
  MOTIVO_EXCLUIDO,
  MOTIVO_LIMPEZA,
  MOTIVO_NAO_COMECOU,
  MOTIVO_PARADO,
  MOTIVO_SEM_RESPOSTA,
  MOTIVO_SEM_TEXTO,
} from "../../src/domain/espera-de-colega.ts";
import { motivoEmPortugues } from "../../src/domain/redacao.ts";
import { ENTRADA_DA_VOLTA_DA_COTA } from "../../src/domain/cota-da-ia.ts";
import { autoriaAgente } from "../../src/use-cases/autoria-evento.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { ADIAR_ESPERA_MS, cobrarEspera, cuidarDasEsperasDeColega, desistirDaEspera, limparEsperasAntigas } from "../../src/use-cases/esperas-de-colega.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-377 (definido em 2026-10-27): toda espera de colega tem fim. Em 26/10 o painel mostrava "Esperando Leonardo ·
 * Leonardo está livre · 21 d": o painel listava todo pedido sem resposta, de qualquer idade, e o varredor de pedidos
 * parados só olhava 24 h e só a cadeia que caiu. Em produção, 40 pedidos ficaram abertos para sempre com o colega já
 * terminado (concluído sem entrega, máquina caída, executor indisponível, Parar).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;
const DIA = 24 * HORA;
const SEM_EXECUTOR = {
  desfecho: "interrompido" as const,
  motivoInterrupcao: "executor_indisponivel" as const,
  texto: "",
  sessaoCli: null,
  sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false },
  custoUsd: 0,
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
  ferramentasChamadas: [],
  negacoesPermissao: [],
};

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];

/** A Ada pede ao Leonardo (a triagem dele, ADR-099) e o turno dela termina esperando. */
async function montar(trx: Trx, nomes = { de: "Ada", para: "Leonardo" }) {
  const ada = await agenteComConversa(trx, MARLON, { nome: nomes.de });
  const leo = await agenteComConversa(trx, MARLON, { nome: nomes.para });
  const { deps, repos } = depsSobre(trx, MARLON);
  for (const a of [ada, leo]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const t = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Leonardo", entradaConfianca: "confiavel", modelo: "m" }))!;
  await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${t.id}`;
  const pedido = await pedirABot(deps, { turnoId: t.id, agenteId: ada.agenteId, conversaId: ada.conversaId, agente: nomes.para, pedido: "priorize o backlog" });
  if (!pedido.data.ok) throw new Error("pedido");
  await repos.turnos.assentar(t.id, { estado: "concluido" });
  const tarefaId = pedido.data.tarefa_id;

  /** O pedido foi feito há `ms` (o handoff e o turno do Leonardo nasceram então). */
  const envelhecer = async (ms: number) => {
    await trx`update mensagens set criado_em = now() - ${ms / 1000} * interval '1 second' where conversa_id = ${ada.conversaId} and kind = 'handoff'`;
    await trx`update turnos set criado_em = now() - ${ms / 1000} * interval '1 second' where id = ${tarefaId}`;
  };
  /** O turno do Leonardo terminou há `ms`, do jeito dado, sem a entrega (o caminho de sempre não entregou). */
  const terminou = async (estado: "concluido" | "interrompido", o: { motivo?: string; ms?: number; rodou?: boolean; texto?: string } = {}) => {
    if (o.texto) {
      await repos.mensagens.criar({ conversaId: leo.conversaId, turnoId: tarefaId, autoria: autoriaAgente({ agenteId: leo.agenteId, contaDeExecucao: PESSOA_MARLON, executor: "catcher" }), kind: "texto", texto: o.texto, confianca: "confiavel" });
    }
    const fim = (o.ms ?? 2 * DIA) / 1000;
    await trx`update turnos set estado = ${estado}, motivo_interrupcao = ${o.motivo ?? null}, attempted = ${o.rodou ?? true},
      despachado_em = case when ${o.rodou ?? true} then now() - ${fim} * interval '1 second' else null end,
      ultimo_sinal_em = now() - ${fim} * interval '1 second', lease_ate = null where id = ${tarefaId}`;
  };
  const avisos = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((x) => x.kind === "peer_ask");
  /** Continuações da Ada (ela foi acordada): retomadas do turno dela na fila. */
  const acordadas = async () => (await repos.turnos.listarDaConversa(ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.retomaTurnoId === t.id);
  const esperaNoPainel = async () => (await listarTrabalhos(deps, {})).data.donos?.find((d) => d.estado.agenteId === ada.agenteId)?.esperas.find((e) => e.tipo === "colega") ?? null;
  const varrer = (agora = Date.now()) => cuidarDasEsperasDeColega({ ...deps, agora: () => agora });
  return { ada, leo, deps, repos, t, tarefaId, envelhecer, terminou, avisos, acordadas, esperaNoPainel, varrer };
}

describeIntegracao("NOD-377: toda espera de colega tem fim", () => {
  it("o bug: pedido de 30 d com o Leonardo terminado aparece no painel; depois da passada do varredor, sai — fechado em silêncio", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * DIA);
      await m.terminou("concluido", { ms: 30 * DIA });
      expect(await m.esperaNoPainel()).toMatchObject({ motivo: "Leonardo", colega: { tarefaId: m.tarefaId, vencida: true } });

      // A passada real (varrerPessoa), não só o use-case: o bloco novo está ligado.
      await varrerPessoa(MARLON, (fn) => fn(trx), { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() });
      expect(await m.esperaNoPainel()).toBeNull();
      const [aviso] = await m.avisos();
      expect(aviso?.texto).toBe(`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`);
      expect(aviso?.payload).toMatchObject({ tarefaId: m.tarefaId, falhou: true, paradoPelaPessoa: true });
      // Silêncio: ninguém acordou a Ada para um pedido de um mês atrás.
      expect(await m.acordadas()).toEqual([]);
      // Uma vez só.
      await m.varrer();
      expect(await m.avisos()).toHaveLength(1);
    });
  });

  it("CA1: concluído sem entrega há 2 dias: a Ada recebe a última fala do Leonardo, uma vez, e a espera sai do painel", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * DIA);
      await m.terminou("concluido", { texto: "Backlog priorizado: NOD-1, NOD-2." });
      const r = await m.varrer();
      expect(r.data.entregues).toEqual([m.tarefaId]);
      const [aviso] = await m.avisos();
      expect(aviso).toMatchObject({ texto: "Backlog priorizado: NOD-1, NOD-2." });
      expect(aviso?.payload).not.toHaveProperty("falhou");
      expect(await m.acordadas()).toHaveLength(1);
      expect(await m.esperaNoPainel()).toBeNull();
      await m.varrer();
      expect(await m.avisos()).toHaveLength(1);
    });
  });

  it("CA1: concluído sem fala: avisa 'terminou sem resposta' e acorda a Ada uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * DIA);
      await m.terminou("concluido");
      await m.varrer();
      await m.varrer();
      const avisos = await m.avisos();
      expect(avisos.map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_SEM_TEXTO}`]);
      expect(await m.acordadas()).toHaveLength(1);
    });
  });

  it("CA4: máquina caída e executor indisponível (fora das 24 h do varredor antigo): aviso com o motivo legível gravado", async () => {
    for (const motivo of ["maquina_sem_contato", "executor_indisponivel"] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        // Revisão 6 do PR #544 (M2): a queda pelo caminho real — uma máquina pega o turno do Leonardo; o lease vence e o
        // varredor de lease o derruba, ou o executor devolve "indisponível" pelo assentarTurno. Só o relógio anda.
        const machineId = randomUUID();
        for (let i = 0; i < 10; i++) {
          const r = await m.repos.turnos.reivindicar({ machineId, agora: Date.now() });
          if (!r || r.id === m.tarefaId) break;
        }
        expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ machineId });
        if (motivo === "maquina_sem_contato") await varrerLease(m.deps.tx, MARLON, Date.now() + LEASE_MS + 1);
        else await assentarTurno(m.deps, { turnoId: m.tarefaId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: { ...SEM_EXECUTOR }, executor: "catcher" });
        expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: motivo });
        // A máquina caída já ganha a volta automática (ADR-084, fundo_retomado): a espera continua, sem aviso.
        const voltas = (await m.repos.turnos.listarDaConversa(m.leo.conversaId, 50)).filter((x) => x.origem === "retomada" && x.estado === "pendente");
        if (motivo === "maquina_sem_contato") {
          expect(voltas).toHaveLength(1);
          await m.varrer();
          expect(await m.avisos()).toEqual([]);
        }
        await m.envelhecer(3 * DIA);
        // O relógio anda 2 dias: a queda e a volta (marcada para +90 s, o recuo da retomada) ficam velhas, ninguém pegou.
        await trx`update turnos set ultimo_sinal_em = now() - interval '2 days', criado_em = now() - interval '2 days',
          acordar_em = case when acordar_em is null then null else now() - interval '2 days' end where id = any(${[m.tarefaId, ...voltas.map((v) => v.id)]})`;
        await m.varrer();
        // A volta que ninguém pegou em 24 h é "sem resposta"; a queda sem volta, o motivo dela.
        const esperado = voltas.length ? MOTIVO_SEM_RESPOSTA : motivoEmPortugues(motivo);
        expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${esperado}`]);
        expect(await m.acordadas()).toHaveLength(1);
        expect(await m.esperaNoPainel()).toBeNull();
      });
    }
  });

  it("CA4 pelo caminho real (revisão 3 do PR #544, M3): o Parar no chat do Leonardo e a exclusão dele — um aviso só, e nada fica aberto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await parar(m.deps, { conversaId: m.leo.conversaId });
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      // Revisão 6 do PR #544 (M3): o aviso sai NA HORA do Parar, antes de qualquer passada do varredor.
      const naHora = await m.avisos();
      expect(naHora).toHaveLength(1);
      expect(naHora[0]).toMatchObject({ texto: `Leonardo não concluiu: ${motivoEmPortugues("parado_pela_pessoa")}`, payload: { tarefaId: m.tarefaId, falhou: true } });
      await m.varrer();
      await m.varrer();
      const avisos = await m.avisos();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.payload).toMatchObject({ tarefaId: m.tarefaId, falhou: true });
      expect(await m.esperaNoPainel()).toBeNull();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await gerirAgente(m.deps, { agenteId: m.leo.agenteId, acao: "excluir" });
      // (M3): na hora da exclusão, antes do varredor.
      const naHora = await m.avisos();
      expect(naHora).toHaveLength(1);
      expect(naHora[0]?.payload).toMatchObject({ tarefaId: m.tarefaId, falhou: true });
      await m.varrer();
      await m.varrer();
      // A exclusão já avisa (G9); o varredor não grava um segundo aviso.
      const avisos = await m.avisos();
      expect(avisos).toHaveLength(1);
      expect(avisos[0]?.payload).toMatchObject({ tarefaId: m.tarefaId, falhou: true });
      expect(await m.esperaNoPainel()).toBeNull();
    });
  });

  it("CA4: Parar da pessoa e colega excluído: aviso na hora, gravado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.terminou("interrompido", { motivo: "parado_pela_pessoa", ms: HORA });
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_PARADO}`]);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await trx`update agentes set excluido_em = now() where id = ${m.leo.agenteId}`;
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_EXCLUIDO}`]);
    });
  });

  it("CA2: na fila sem ninguém pegar: espera até 24 h; vencido, fecha com 'sem resposta em 24 h' e acorda a Ada uma vez", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(23 * HORA);
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });

      await m.envelhecer(25 * HORA);
      // Revisão 2 do PR #544 (A1): vencida ("sem resposta"), mas com o turno do Leonardo na fila o painel não oferece
      // Cobrar — o servidor recusaria (só duplicaria o pedido).
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: true, podeCobrar: false } });
      const passada = await m.varrer();
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_SEM_RESPOSTA}`]);
      expect(await m.acordadas()).toHaveLength(1);
      expect(await m.esperaNoPainel()).toBeNull();
      // Revisão 2 do PR #544 (M5): o aviso é final — o turno do Leonardo sai da fila (ele não trabalha para ninguém). Revisão
      // 3 (M2): por regra, "vencido" — não um Parar que a pessoa não fez.
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "vencido" });
      const interrompido = passada.events.find((ev) => ev.kind === "turno_interrompido" && ev.turnoId === m.tarefaId);
      expect(interrompido).toMatchObject({ autoria: { autor_tipo: "agente", decidido_por: "regra:esperas_de_colega" }, dados: { motivo: "vencido" } });
    });
  });

  it("revisão 8 do PR #544 (A1): pedido de 30 h, o Leonardo rodou e uma retomada acabou de entrar na fila — espera; parada 24 h, 'sem resposta'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      await m.terminou("concluido", { ms: 2 * HORA, texto: "Preciso da sua decisão." });
      // A pessoa aprovou uma decisão agora: a retomada da cadeia do Leonardo entra na fila.
      const volta = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "aprovado", entradaConfianca: "confiavel", modelo: "m" }))!;
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.repos.turnos.buscar(volta.id)).toMatchObject({ estado: "pendente" });
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
      // Ninguém pegou a retomada em 24 h: aí sim, "sem resposta".
      await trx`update turnos set criado_em = now() - interval '25 hours' where id = ${volta.id}`;
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: true, podeCobrar: false } });
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_SEM_RESPOSTA}`]);
    });
  });

  it("revisão 9 do PR #544 (A1): a volta da cota acordada pela pessoa (Seguir com/conta nova) não vira 'sem resposta'", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(3 * DIA);
      await m.terminou("interrompido", { motivo: "executor_indisponivel", ms: 2 * DIA });
      const volta = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: `${ENTRADA_DA_VOLTA_DA_COTA}Claude acabou.`, entradaConfianca: "confiavel", modelo: "m", acordarEm: Date.now() + DIA }))!;
      await trx`update turnos set criado_em = now() - interval '2 days' where id = ${volta.id}`;
      // A pessoa acordou a espera (acordar_em vira null; o criado_em continua o da queda).
      expect(await m.repos.turnos.anteciparEsperasDaCota(null)).toContain(volta.id);
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.repos.turnos.buscar(volta.id)).toMatchObject({ estado: "pendente" });
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
    });
  });

  it("revisão 9 do PR #544 (M1): retomada criada há 2 dias que acordou há 1 h conta da hora em que acordou — espera", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(3 * DIA);
      await m.terminou("concluido", { ms: 2 * DIA, texto: "volto amanhã" });
      const volta = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "volta marcada", entradaConfianca: "confiavel", modelo: "m" }))!;
      await trx`update turnos set criado_em = now() - interval '2 days', acordar_em = now() - interval '1 hour' where id = ${volta.id}`;
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.repos.turnos.buscar(volta.id)).toMatchObject({ estado: "pendente" });
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false } });
    });
  });

  it("revisão 9 do PR #544 (M2): pedido de 30 h com uma decisão da pessoa em aberto na cadeia — espera, sem Cobrar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      await m.terminou("concluido", { ms: 29 * HORA });
      await trx`insert into decisoes (tenant_id, owner_id, decisor_id, agente_id, conversa_id, turno_id, tipo, prazo_decisao_em, frase)
        values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${PESSOA_MARLON}, ${m.leo.agenteId}, ${m.leo.conversaId}, ${m.tarefaId}, 'pergunta', now() + interval '1 day', 'qual prioridade?')`;
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
    });
  });

  it("revisão 9 do PR #544 (M2): pedido de 30 h com o Leonardo em esperar_comando (espera rodando) — espera, sem Cobrar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      await m.terminou("concluido", { ms: 29 * HORA });
      const e = await m.repos.esperas.criar({ agenteId: m.leo.agenteId, conversaId: m.leo.conversaId, trabalhoId: null, turnoId: m.tarefaId, maquinaId: randomUUID(), pasta: "/tmp", comando: "npm test", motivo: "a suíte" });
      expect(e).not.toBeNull();
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
    });
  });

  it("revisão 10 do PR #544 (M1): fala num turno anterior e a reentrega concluída calada — 'sem resposta', não a fala velha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(3 * DIA);
      await m.terminou("concluido", { ms: 2 * DIA, texto: "Começando: vou olhar o backlog." });
      const volta = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: `${ENTRADA_DA_COBRANCA}${m.tarefaId}`, entradaConfianca: "confiavel", modelo: "m" }))!;
      await trx`update turnos set estado = 'concluido', attempted = true, despachado_em = now() - interval '2 hours', ultimo_sinal_em = now() - interval '1 hour', criado_em = now() - interval '3 hours' where id = ${volta.id}`;
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_SEM_TEXTO}`]);
    });
  });

  it("revisão 10 do PR #544 (M2): o painel lê numa vez só as vencidas de vários bots e acerta cada uma", async () => {
    await withRollback(MARLON, async (trx) => {
      const a = await montar(trx);
      const b = await montar(trx, { de: "Bia", para: "Caio" });
      for (const m of [a, b]) {
        await m.envelhecer(30 * HORA);
        await m.terminou("concluido", { ms: 29 * HORA });
      }
      // A do Caio tem uma retomada recém-entrada na fila (ocupada); a do Leonardo, nada.
      await b.repos.turnos.enfileirar({ executor: "catcher", conversaId: b.leo.conversaId, agenteId: b.leo.agenteId, origem: "retomada", retomaTurnoId: b.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "aprovado", entradaConfianca: "confiavel", modelo: "m" });
      const lidas = vi.spyOn(a.repos.pedidosDeColega, "esperasDeColega");
      const donos = (await listarTrabalhos(a.deps, {})).data.donos ?? [];
      const colega = (agenteId: string) => donos.find((d) => d.estado.agenteId === agenteId)?.esperas.find((e) => e.tipo === "colega");
      expect(colega(a.ada.agenteId)).toMatchObject({ colega: { vencida: true, podeCobrar: true } });
      expect(colega(b.ada.agenteId)).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
      expect(lidas.mock.calls.length).toBeLessThanOrEqual(1);
    });
  });

  it("QA do PR #544 (bug 1): no teto, com um turno da cadeia vivo agora, nem o varredor nem a limpeza fecham em silêncio", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(8 * DIA);
      await trx`update turnos set estado = 'despachando', attempted = true, despachado_em = now() - interval '1 hour', ultimo_sinal_em = now(), lease_ate = now() + interval '5 minutes' where id = ${m.tarefaId}`;
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      const r = (await limparEsperasAntigas(m.deps, { dryRun: false })).data;
      expect(r).toMatchObject({ pedidos: [{ tarefaId: m.tarefaId, fechado: false, situacao: "vivo" }], fechados: 0, falhas: 0 });
      expect(await m.avisos()).toEqual([]);
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "despachando" });
      // Acabou: a passada seguinte fecha no teto.
      await m.terminou("concluido", { ms: HORA, texto: "Feito." });
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual(["Feito."]);
    });
  });

  it("QA do PR #544 (bug 2): concluído com fala e ainda não entregue — o painel não mostra 'sem resposta' nem oferece Cobrar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      await m.terminou("concluido", { ms: 60_000, texto: "Backlog priorizado." });
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
    });
  });

  it("QA do PR #544 (R14): o pedido de outra pessoa do mesmo tenant não entra nas esperas de quem varre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      await m.terminou("concluido", { ms: 29 * HORA });
      expect((await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId)).toContain(m.tarefaId);
      // A Ana, no mesmo tenant, varre: o pedido do Marlon não é dela (a RLS de mensagens libera o tenant/equipe).
      const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
      await vincularEscopo(trx, ANA);
      const daAna = depsSobre(trx, ANA).repos;
      expect((await daAna.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId)).not.toContain(m.tarefaId);
      await vincularEscopo(trx, MARLON);
    });
  });

  it("QA do PR #544 (R3, R2): quem pediu excluído, ou a task de colega de antes já acabada, não é espera", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(30 * HORA);
      const ids = async () => (await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId);
      expect(await ids()).toContain(m.tarefaId);
      const w = (await m.repos.trabalhos.criar({ agenteId: m.leo.agenteId, conversaId: m.leo.conversaId, titulo: "task", origem: "pessoa" }))!;
      await trx`update mensagens set payload = payload || ${trx.json({ trabalhoId: w.id })} where conversa_id = ${m.ada.conversaId} and kind = 'handoff'`;
      expect(await ids()).toContain(m.tarefaId);
      await trx`update trabalhos set estado = 'terminado', terminado_em = now() where id = ${w.id}`;
      expect(await ids()).not.toContain(m.tarefaId);
      await trx`update mensagens set payload = payload - 'trabalhoId' where conversa_id = ${m.ada.conversaId} and kind = 'handoff'`;
      expect(await ids()).toContain(m.tarefaId);
      await trx`update agentes set excluido_em = now() where id = ${m.ada.agenteId}`;
      expect(await ids()).not.toContain(m.tarefaId);
    });
  });

  it("QA do PR #544 (R4, R20): nunca rodou com o Leonardo ocupado em outro turno (rodando ou pronto na fila) — sem reentrega", async () => {
    for (const ocupado of ["despachando", "pendente"] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        await m.envelhecer(26 * HORA);
        await m.terminou("interrompido", { motivo: "executor_indisponivel", ms: 25 * HORA, rodou: false });
        const outro = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "outra coisa", entradaConfianca: "confiavel", modelo: "m" }))!;
        if (ocupado === "despachando") await trx`update turnos set estado = 'despachando', attempted = true, lease_ate = now() + interval '5 minutes' where id = ${outro.id}`;
        expect((await m.varrer()).data.reentregues, ocupado).toEqual([]);
      });
    }
  });

  it("o Leonardo trabalhando agora: a espera continua (dentro do teto), sem aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(3 * DIA);
      await trx`update turnos set estado = 'despachando', attempted = true, lease_ate = now() + interval '5 minutes' where id = ${m.tarefaId}`;
      const adiados = new Map<string, number>();
      const agora = Date.now();
      await cuidarDasEsperasDeColega({ ...m.deps, agora: () => agora }, { adiados });
      expect(await m.avisos()).toEqual([]);
      // Revisão 2 do PR #544 (A1): trabalhando, não é "sem resposta" no painel, nem cabe Cobrar.
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
      // (M1): o que só espera volta em 30 min, mais que o intervalo entre passadas — não toma a vez dos outros.
      expect(adiados.get(m.tarefaId)).toBe(agora + ADIAR_ESPERA_MS);
    });
  });

  it("CA3: nunca rodou e o Leonardo livre: uma reentrega automática; na segunda vez, falha com aviso", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      // Nas primeiras 24 h da queda, quem cuida é o varredor de pedidos parados (ADR-084): a regra nova não reentrega.
      await m.envelhecer(2 * HORA);
      await m.terminou("interrompido", { motivo: "executor_indisponivel", ms: HORA, rodou: false });
      expect((await m.varrer()).data.reentregues).toEqual([]);
      await m.envelhecer(26 * HORA);
      await m.terminou("interrompido", { motivo: "executor_indisponivel", ms: 25 * HORA, rodou: false });
      // A passada real (varrerPessoa).
      await varrerPessoa(MARLON, (fn) => fn(trx), { services: m.deps.services, useCases: m.deps.useCases, agora: () => Date.now() });
      const reentrega = (await m.repos.turnos.listarDaConversa(m.leo.conversaId, 50)).find((x) => x.retomaTurnoId === m.tarefaId);
      expect(reentrega?.entradaTexto.startsWith(`${ENTRADA_DA_COBRANCA}${m.tarefaId}`)).toBe(true);
      expect(await m.avisos()).toEqual([]);
      expect(await m.esperaNoPainel()).not.toBeNull();

      // A reentrega também não começa.
      await trx`update turnos set estado = 'interrompido', motivo_interrupcao = 'executor_indisponivel', attempted = false, ultimo_sinal_em = now() - interval '1 hour' where id = ${reentrega!.id}`;
      await m.varrer();
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_NAO_COMECOU}`]);
      expect((await m.repos.turnos.listarDaConversa(m.leo.conversaId, 50)).filter((x) => x.retomaTurnoId === m.tarefaId || x.retomaTurnoId === reentrega!.id)).toHaveLength(1);
    });
  });

  it("CA8: um peer_ask do mesmo pedido em OUTRA conversa não fecha a espera (nem no painel, nem no varredor)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * HORA);
      await m.repos.mensagens.criar({
        conversaId: m.leo.conversaId, turnoId: null, kind: "peer_ask", texto: "fora do lugar", confianca: "nao_confiavel",
        autoria: autoriaAgente({ agenteId: m.leo.agenteId, contaDeExecucao: PESSOA_MARLON, executor: "catcher" }),
        payload: { kind: "peer_ask", agenteId: m.leo.agenteId, nome: "Leonardo", naoSupervisionado: true, tarefaId: m.tarefaId },
      });
      expect(await m.esperaNoPainel()).not.toBeNull();
      expect((await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId)).toContain(m.tarefaId);
    });
  });

  it("revisão 7 do PR #544 (M1, CA5): `abertos` (pedir_a_bot/rotina) e `esperasDeColega` (painel/varredor) concordam sobre o pedido aberto", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * HORA);
      const abertos = async () => (await m.repos.pedidosDeColega.abertos(Date.now() - DIA)).map((p) => p.tarefaId).includes(m.tarefaId);
      const esperas = async () => (await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId).includes(m.tarefaId);
      expect([await abertos(), await esperas()]).toEqual([true, true]);
      // O peer_ask em OUTRA conversa não fecha em nenhum dos dois (a mesma `pedidoAbertoSql`).
      await m.repos.mensagens.criar({
        conversaId: m.leo.conversaId, turnoId: null, kind: "peer_ask", texto: "fora do lugar", confianca: "nao_confiavel",
        autoria: autoriaAgente({ agenteId: m.leo.agenteId, contaDeExecucao: PESSOA_MARLON, executor: "catcher" }),
        payload: { kind: "peer_ask", agenteId: m.leo.agenteId, nome: "Leonardo", naoSupervisionado: true, tarefaId: m.tarefaId },
      });
      expect([await abertos(), await esperas()]).toEqual([true, true]);
      // A resposta na conversa do pedido fecha nos dois.
      await m.repos.turnos.assentar(m.tarefaId, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: m.tarefaId, texto: "Backlog priorizado." });
      expect([await abertos(), await esperas()]).toEqual([false, false]);
    });
  });

  it("CA6: Cobrar reentrega uma vez e recomeça o prazo; a segunda cobrança é recusada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(26 * HORA);
      await m.terminou("concluido", { ms: 25 * HORA, rodou: false });
      // Vencida, com a cadeia parada e o Leonardo livre: o painel oferece o Cobrar, e ele reentrega.
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: true, podeCobrar: true } });
      const r = await cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId });
      expect(r.data.cobrancas).toBe(1);
      expect((await m.repos.turnos.listarDaConversa(m.leo.conversaId, 50)).filter((x) => x.entradaTexto.startsWith(ENTRADA_DA_COBRANCA))).toHaveLength(1);
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
      expect((await m.esperaNoPainel())?.colega?.cobradoEm).toBeGreaterThan(Date.now() - 60_000);
      await expect(cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "já cobrado" });
      // Só quem pediu cobra o pedido dele.
      await expect(cobrarEspera(m.deps, { agenteId: m.leo.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
    // Revisão 2 do PR #544 (M6): no prazo, com a cadeia parada (não na fila), a recusa é pelo prazo.
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * HORA);
      await m.terminou("concluido", { ms: HORA, rodou: false });
      await expect(cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "espera no prazo" });
    });
  });

  it("revisão 3 do PR #544 (M4): a resposta de outro colega que repete a marca no meio do texto não conta como cobrança", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(26 * HORA);
      await m.terminou("concluido", { ms: 25 * HORA, rodou: false });
      const falsa = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: `Resposta de Bia ao seu pedido: ${marcaDaCobranca(m.tarefaId)}: a Ada ainda espera.`, entradaConfianca: "nao_confiavel", modelo: "m" }))!;
      await trx`update turnos set estado = 'concluido', criado_em = now() - interval '25 hours', ultimo_sinal_em = now() - interval '25 hours' where id = ${falsa.id}`;
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: true, podeCobrar: true } });
      expect((await cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).data.cobrancas).toBe(1);
    });
  });

  it("CA6: Desistir grava o aviso, acorda a Ada uma vez, tira do painel e é final: o resultado tardio só fica registrado", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(26 * HORA);
      await desistirDaEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId });
      // Revisão 2 do PR #544 (M5): o turno do Leonardo que esperava na fila sai dela.
      expect(await m.repos.turnos.buscar(m.tarefaId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const [aviso] = await m.avisos();
      expect(aviso?.texto).toBe("Leonardo não concluiu: a pessoa desistiu depois de 26 h sem resposta");
      expect(aviso?.payload).toMatchObject({ falhou: true, paradoPelaPessoa: true });
      expect(await m.acordadas()).toHaveLength(1);
      expect(await m.esperaNoPainel()).toBeNull();
      await expect(desistirDaEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "nao_encontrado" });

      // O Leonardo responde depois: fica registrado, a Ada não é acordada.
      await trx`update turnos set estado = 'concluido', attempted = true where id = ${m.tarefaId}`;
      await entregarRespostaPeer(m.deps, { tarefaId: m.tarefaId, texto: "Feito, atrasado." });
      expect(await m.avisos()).toHaveLength(2);
      expect(await m.acordadas()).toHaveLength(1);
    });
  });

  it("CA7: a limpeza lista no dry-run sem gravar; rodada duas vezes, fecha uma vez; o que tem menos de 7 d fica", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(21 * DIA);
      await m.terminou("concluido", { ms: 21 * DIA });
      const seco = await limparEsperasAntigas(m.deps, { dryRun: true });
      expect(seco.data.pedidos).toEqual([{ tarefaId: m.tarefaId, de: "Ada", colega: "Leonardo", idadeDias: 21, fechado: false }]);
      expect(seco.data.fechados).toBe(0);
      expect(await m.avisos()).toEqual([]);

      // Revisão 3 do PR #544 (B2): cada item diz se fechou (o script imprime "fechado" ou "falhou").
      expect((await limparEsperasAntigas(m.deps, { dryRun: false })).data).toMatchObject({ pedidos: [{ tarefaId: m.tarefaId, fechado: true }], fechados: 1, falhas: 0 });
      expect((await limparEsperasAntigas(m.deps, { dryRun: false })).data).toEqual({ pedidos: [], fechados: 0, falhas: 0 });
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`]);
      expect(await m.acordadas()).toEqual([]);
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(6 * DIA);
      expect((await limparEsperasAntigas(m.deps, { dryRun: false })).data).toEqual({ pedidos: [], fechados: 0, falhas: 0 });
    });
  });

  it("revisão 6 do PR #544 (M1): cadeia de 12 retomadas com a última rodando — espera, sem aviso (o corte de 10 lia o 'último' errado)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(2 * DIA);
      await m.terminou("interrompido", { motivo: "maquina_sem_contato", ms: 2 * DIA });
      let anterior = m.tarefaId;
      for (let i = 0; i < 12; i++) {
        const r = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: anterior, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "m" }))!;
        const ultima = i === 11;
        await trx`update turnos set estado = ${ultima ? "despachando" : "interrompido"}, motivo_interrupcao = ${ultima ? null : "maquina_sem_contato"}, attempted = true,
          despachado_em = now() - interval '1 hour', ultimo_sinal_em = ${ultima ? new Date() : new Date(Date.now() - 2 * DIA)},
          lease_ate = ${ultima ? new Date(Date.now() + 300_000) : null}, machine_id = ${ultima ? randomUUID() : null} where id = ${r.id}`;
        anterior = r.id;
      }
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      // Trabalhando, não é "sem resposta" (como o caso do Leonardo trabalhando agora).
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { vencida: false, podeCobrar: false } });
    });
  });

  it("revisão 6 do PR #544 (M5): pedido de 10 d cobrado há 3 d — a limpeza fecha (7 d contam do pedido, não da cobrança)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(10 * DIA);
      await m.terminou("concluido", { ms: 9 * DIA, rodou: false });
      await cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId });
      await trx`update turnos set criado_em = now() - interval '3 days' where conversa_id = ${m.leo.conversaId} and starts_with(entrada_texto, ${ENTRADA_DA_COBRANCA})`;
      expect((await m.esperaNoPainel())?.colega?.cobradoEm).toBeLessThan(Date.now() - 2 * DIA);
      expect((await limparEsperasAntigas(m.deps, { dryRun: false })).data).toMatchObject({ pedidos: [{ tarefaId: m.tarefaId, idadeDias: 10, fechado: true }], fechados: 1 });
      expect(await m.esperaNoPainel()).toBeNull();
      // O varredor (teto de 7 d desde a cobrança) não fecharia: ainda há 4 d de prazo.
    });
  });

  it("revisão do PR #544 (A1): a triagem do Leonardo com frentes abertas não é 'sem resposta' — espera, sem aviso e sem Cobrar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(3 * DIA);
      await m.terminou("concluido", { ms: 2 * DIA, texto: "Abri 3 frentes; volto com o resultado." });
      await trx`insert into lotes_de_frentes (tenant_id, owner_id, agente_id, aberto_por_turno_id) values (${TENANT_PADRAO}, ${PESSOA_MARLON}, ${m.leo.agenteId}, ${m.tarefaId})`;
      await m.varrer();
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.acordadas()).toEqual([]);
      await expect(cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      // Passado o teto, fecha em silêncio como qualquer outro.
      await m.envelhecer(8 * DIA);
      await m.varrer();
      // Revisão 2 do PR #544 (M6): a fala da triagem ("abri 3 frentes") é intermediária — o fecho é o aviso, não resultado.
      const avisos = await m.avisos();
      expect(avisos.map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`]);
      expect(avisos[0]?.payload).toMatchObject({ falhou: true });
      expect(await m.acordadas()).toEqual([]);
    });
  });

  it("revisão 5 do PR #544 (M2): no teto, o fecho também tira da fila a volta marcada do Leonardo (varredor e limpeza)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(8 * DIA);
      await m.terminou("concluido", { ms: 7 * DIA, texto: "Vou esperar o CI e volto." });
      const volta = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "retomada", retomaTurnoId: m.tarefaId, prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "volta do CI", entradaConfianca: "confiavel", modelo: "m", acordarEm: Date.now() + DIA }))!;
      const r = await limparEsperasAntigas(m.deps, { dryRun: false });
      expect(r.data.pedidos.map((p) => p.fechado)).toEqual([true]);
      expect((await m.avisos()).map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`]);
      expect(await m.repos.turnos.buscar(volta.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "vencido" });
      expect(r.events.find((ev) => ev.kind === "turno_interrompido" && ev.turnoId === volta.id)).toMatchObject({ autoria: { decidido_por: "regra:esperas_de_colega" } });
    });
  });

  it("revisão 4 do PR #544 (M2): o Leonardo pediu à Bia e espera a resposta dela — não é 'sem resposta': sem aviso e sem Cobrar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      await m.repos.agentes.atualizarPerfil(bia.agenteId, { confirmado: true });
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${m.tarefaId}`;
      const aninhado = await pedirABot(m.deps, { turnoId: m.tarefaId, agenteId: m.leo.agenteId, conversaId: m.leo.conversaId, agente: "Bia", pedido: "levante os números" });
      if (!aninhado.data.ok) throw new Error("pedido aninhado");
      await m.envelhecer(3 * DIA);
      await m.terminou("concluido", { ms: 2 * DIA, texto: "Pedi à Bia; volto com o resultado." });
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { podeCobrar: false } });
      await m.varrer();
      await m.varrer();
      expect(await m.avisos()).toEqual([]);
      expect(await m.acordadas()).toEqual([]);
      await expect(cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      // No teto, a fala intermediária ("pedi à Bia") não sai como resultado: o fecho é o aviso.
      await m.envelhecer(8 * DIA);
      await m.varrer();
      const avisos = await m.avisos();
      expect(avisos.map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`]);
      expect(avisos[0]?.payload).toMatchObject({ falhou: true });
    });
  });

  it("revisão do PR #544 (M6): no teto, o colega que concluiu com fala e ninguém entregou — sai o resultado, sem acordar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(10 * DIA);
      await m.terminou("concluido", { ms: 9 * DIA, texto: "Backlog priorizado." });
      // A entrega normal (CA1) esperaria a triagem; aqui o teto já passou: o fecho registra o resultado.
      await m.varrer();
      const [aviso] = await m.avisos();
      expect(aviso?.texto).toBe("Backlog priorizado.");
      expect(aviso?.payload).not.toHaveProperty("falhou");
      expect(await m.acordadas()).toEqual([]);
      expect(await m.esperaNoPainel()).toBeNull();
    });
  });

  it("revisão do PR #544 (M8, B16): Cobrar com o Leonardo na fila e Desistir no prazo são recusados", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.envelhecer(26 * HORA);
      // O turno do Leonardo ainda está na fila (montar não o tirou de lá).
      await expect(cobrarEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "colega trabalhando" });
      await m.envelhecer(2 * HORA);
      await expect(desistirDaEspera(m.deps, { agenteId: m.ada.agenteId, tarefaId: m.tarefaId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(await m.avisos()).toEqual([]);
    });
  });

  it("CA8: dois pedidos ao Leonardo de conversas diferentes — a resposta a um não fecha o outro", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      await m.repos.agentes.atualizarPerfil(bia.agenteId, { confirmado: true });
      const tb = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: bia.conversaId, agenteId: bia.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pergunte ao Leonardo", entradaConfianca: "confiavel", modelo: "m" }))!;
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = now() + interval '5 minutes' where id = ${tb.id}`;
      const pb = await pedirABot(m.deps, { turnoId: tb.id, agenteId: bia.agenteId, conversaId: bia.conversaId, agente: "Leonardo", pedido: "revise o PR" });
      if (!pb.data.ok) throw new Error("pedido da Bia");
      await m.repos.turnos.assentar(tb.id, { estado: "concluido" });
      await trx`update turnos set estado = 'concluido', attempted = true where id = ${pb.data.tarefa_id}`;
      await entregarRespostaPeer(m.deps, { tarefaId: pb.data.tarefa_id, texto: "PR revisado." });

      const abertas = (await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId);
      expect(abertas).toContain(m.tarefaId);
      expect(abertas).not.toContain(pb.data.tarefa_id);
      expect(await m.esperaNoPainel()).toMatchObject({ colega: { tarefaId: m.tarefaId } });
      expect(await m.avisos()).toEqual([]);
    });
  });

  it("revisão 2 do PR #544 (M2): no teto, um handoff que aponta um turno que não é tarefa de colega fecha na conversa do pedido (varredor e limpeza)", async () => {
    for (const via of ["varredor", "limpeza"] as const) {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx);
        // Um turno do Leonardo que não é delegação (legado): a entrega pela raiz devolve nao_e_tarefa_peer.
        const solto = (await m.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.leo.conversaId, agenteId: m.leo.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "outra coisa", entradaConfianca: "confiavel", modelo: "m" }))!;
        await trx`update turnos set estado = 'concluido', attempted = true, criado_em = now() - interval '10 days', ultimo_sinal_em = now() - interval '10 days' where id = ${solto.id}`;
        await trx`update mensagens set payload = jsonb_set(payload, '{tarefaId}', to_jsonb(${solto.id}::text)), criado_em = now() - interval '10 days' where conversa_id = ${m.ada.conversaId} and kind = 'handoff'`;
        if (via === "varredor") expect((await m.varrer()).data.limpos).toEqual([solto.id]);
        else expect((await limparEsperasAntigas(m.deps, { dryRun: false })).data).toMatchObject({ fechados: 1, falhas: 0 });
        const avisos = await m.avisos();
        expect(avisos.map((a) => a.texto)).toEqual([`Leonardo não concluiu: ${MOTIVO_LIMPEZA}`]);
        expect(avisos[0]?.payload).toMatchObject({ tarefaId: solto.id, falhou: true });
        expect(await m.acordadas()).toEqual([]);
        expect((await m.repos.pedidosDeColega.esperasDeColega(Date.now())).map((e) => e.tarefaId)).not.toContain(solto.id);
      });
    }
  });

  describeRotas();
});

let trxAtual: Tx | null = null;
const txPara = (escopo: Escopo): Transacao => async (fn) => {
  if (!trxAtual) throw new Error("teste sem transação aberta");
  await vincularEscopo(trxAtual, escopo);
  return fn(trxAtual);
};

function describeRotas() {
  let srv: ServidorDeTeste;
  let sessao: { cookie: string; tenantId: string; pessoaId: string };
  beforeAll(async () => {
    const semTrx = depsSobre({} as never, MARLON);
    srv = await servidorDeTeste(criarRotasTrabalhos({ abrirTx: txPara, services: semTrx.deps.services, useCases: semTrx.deps.useCases, agora: () => Date.now() }));
    sessao = await srv.entrar("marlon");
  });
  afterAll(() => srv.close());

  it("rotas: POST …/esperas-de-colega/:tarefa/cobrar e /desistir; id que não é uuid ou de outro bot = 404; cobrar duas vezes = erro", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      await m.envelhecer(2 * HORA);
      const url = (agente: string, tarefa: string, acao: string) => `agentes/${agente}/esperas-de-colega/${tarefa}/${acao}`;
      // No prazo: 409 nas duas ações.
      expect((await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "cobrar"))).status).toBe(409);
      expect((await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "desistir"))).status).toBe(409);
      await m.envelhecer(26 * HORA);
      await m.terminou("interrompido", { motivo: "executor_indisponivel", ms: 25 * HORA, rodou: false });
      expect((await srv.chamar(sessao, "POST", url("nao-e-uuid", m.tarefaId, "cobrar"))).status).toBe(404);
      expect((await srv.chamar(sessao, "POST", url(m.leo.agenteId, m.tarefaId, "cobrar"))).status).toBe(404);
      // Revisão 3 do PR #544 (M3): outra pessoa do mesmo tenant, com os ids certos, não cobra nem desiste do pedido do Marlon.
      const ana = await srv.entrar("ana");
      expect((await srv.chamar(ana, "POST", url(m.ada.agenteId, m.tarefaId, "cobrar"))).status).toBe(404);
      expect((await srv.chamar(ana, "POST", url(m.ada.agenteId, m.tarefaId, "desistir"))).status).toBe(404);
      const cobrou = await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "cobrar"));
      expect(cobrou.status).toBe(200);
      expect(await cobrou.json()).toMatchObject({ ok: true, cobrancas: 1 });
      expect((await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "cobrar"))).status).toBe(409);
      const desistiu = await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "desistir"));
      expect(desistiu.status).toBe(200);
      expect((await m.avisos()).map((a) => a.payload)).toEqual([expect.objectContaining({ falhou: true, paradoPelaPessoa: true })]);
      expect((await srv.chamar(sessao, "POST", url(m.ada.agenteId, m.tarefaId, "desistir"))).status).toBe(404);
      trxAtual = null;
    });
  });
}
