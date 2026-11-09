import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, REOFERTA_MS } from "../../src/adapters/fundo/ponte-interna.ts";
import { iniciarLaco } from "../../src/adapters/executor/laco.ts";
import type { Adapter, Driver, Registry, SinksTurno } from "../../src/adapters/executor/spi.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { SEM_CAPACIDADES } from "../../src/contracts/harness.ts";
import { molduraMensagemNoMeio } from "../../src/domain/mensagem-no-meio.ts";

/** O driver de teste declara a sessão viva (ADR-083 §5): sem isso o laço nem pede mensagens. */
const SESSAO_VIVA = { ...SEM_CAPACIDADES, mensagemNoMeio: true };
const semMoldura = (t: string) => /«([\s\S]*)»/.exec(t)?.[1] ?? t;

/**
 * ADR-067 de ponta a ponta: laço real, ponte in-process real e Postgres (transações commitadas, como em
 * pool-lacos.test.ts). O driver imita a sessão viva do Claude Code: fala no meio do turno, fica ocioso, recebe a
 * mensagem que a pessoa mandou com ele trabalhando e responde — tudo num turno só.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const services = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
const useCases = useCasesDeTeste();

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from memoria_diario where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-083 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const esperarAte = async (cond: () => boolean, ms = 8_000) => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error("esperarAte: tempo esgotado");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describeIntegracao("sessão viva (ADR-067): fala no meio do turno e mensagem nova entram no turno vivo", () => {
  it("NOD-293 E9: criarPonteInterna.renovar reoferece após 10 s e a confirmação encerra a oferta", async () => {
    let agora = Date.parse("2026-10-20T12:00:00Z");
    const machineId = randomUUID();
    const ponte = criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, agora: () => agora, esquecerTurno: (id) => services.interruptor.esquecer(id) });
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    const { conversaId, primeiro } = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev E9" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      const t = (await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "tarefa longa", inventario: PRONTO, executor: "catcher" })).data.turno.id;
      return { conversaId: c.conversa.id, primeiro: t };
    });
    expect((await ponte.puxar(PESSOA.pessoaId))?.turnoId).toBe(primeiro);
    const segundo = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId, texto: "mensagem no meio", inventario: PRONTO, executor: "catcher" })).data.turno.id);
    const renovar = (mensagensEntregues: string[] = []) => ponte.renovar({ turnoId: primeiro, machineId, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [], aceitaMensagens: true, mensagensEntregues });

    const inicial = await renovar();
    expect(inicial.mensagensIds).toEqual([segundo]);
    expect((await renovar()).mensagensIds).toBeUndefined();
    agora += REOFERTA_MS;
    expect((await renovar()).mensagensIds).toBeUndefined();
    agora += 1;
    expect((await renovar()).mensagensIds).toEqual([segundo]);
    expect((await renovar([segundo])).mensagensIds).toBeUndefined();
    expect((await renovar()).mensagensIds).toBeUndefined();
    expect(await lerTurno(segundo)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: primeiro });
  });

  it("a fala sai na hora; a mensagem da pessoa entra no turno vivo (sai 'absorvido') e o bot responde a ela no mesmo turno", { timeout: 20_000 }, async () => {
    const machineId = randomUUID();
    const ponte = criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });

    const etapa = { falou: false, liberado: false, rodados: [] as string[] };
    const recebidas: string[] = [];
    let aberta = true;
    // X2 (revisão do épico #188): a escrita aceita avisa o laço por `mensagemEntrou`, como o stdin do Claude.
    let sinksVivos: SinksTurno | null = null;
    const driverVivo: Driver = {
      meta: { id: "catcher", locality: "ambos", capacidades: SESSAO_VIVA },
      async create() {
        return {
          sondar: async () => PRONTO,
          dispose: async () => {},
          adapter: (plano): Adapter => ({
            async rodarTurno(sinks: SinksTurno): Promise<ResultadoTurno> {
              sinksVivos = sinks;
              etapa.rodados.push(plano.turnoId);
              await sinks.sinal("attempted");
              await sinks.sinal("promptSubmitted");
              sinks.falaIntermediaria!("Disparei os testes, sigo quando terminarem.");
              etapa.falou = true;
              await esperarAte(() => etapa.liberado);
              const chegou = await sinks.ocioso!();
              const depois = await sinks.ocioso!();
              aberta = false;
              const texto = chegou && !depois ? `Recebi: ${recebidas.map(semMoldura).join(" | ")}` : "nada chegou";
              return { desfecho: "sucesso", texto, sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
            },
            async interromper() { etapa.liberado = true; },
            aceitaMensagens: () => aberta,
            receberMensagem(texto, id) {
              if (!aberta) return false;
              recebidas.push(texto);
              if (id !== undefined) sinksVivos?.mensagemEntrou?.(id);
              return true;
            },
          }),
        };
      },
    };
    const instance = await driverVivo.create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const registry: Registry = { "claude-cli": { estado: "sombra", motivo: "teste" }, catcher: { estado: "pronto", driver: driverVivo, instance } };

    const { conversaId, primeiro } = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 4" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      const t = (await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "implemente a 86akr9u9u", inventario: PRONTO, executor: "catcher" })).data.turno.id;
      return { conversaId: c.conversa.id, primeiro: t };
    });

    // A checagem periódica fica longa: quem pergunta pela mensagem aqui é o ocioso do driver.
    const laco = iniciarLaco({ ponte, registry, pessoaId: PESSOA.pessoaId, machineId, relogio: Date.now, esperaVaziaMs: 20, jitterMs: 5, renovacaoMs: 10_000, checagemMensagensMs: 10_000 });
    try {
      await esperarAte(() => etapa.falou);
      const segundo = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId, texto: "quanto é 2+2?", inventario: PRONTO, executor: "catcher" })).data.turno.id);
      etapa.liberado = true;

      const lido = async () => escopado(async (trx) => {
        const repos = criarRepos(trx, PESSOA);
        return { primeiro: await repos.turnos.buscar(primeiro), segundo: await repos.turnos.buscar(segundo), mensagens: await repos.mensagens.listarDaConversa(conversaId, 50) };
      });
      let estado = await lido();
      const fim = Date.now() + 8_000;
      while (estado.primeiro?.estado !== "concluido" && Date.now() < fim) {
        await new Promise((r) => setTimeout(r, 50));
        estado = await lido();
      }

      // ADR-083 §6: chega com a moldura; #189: só sai "absorvido" depois que o app confirma a escrita.
      expect(recebidas).toEqual([molduraMensagemNoMeio("quanto é 2+2?")]);
      expect(etapa.rodados).toEqual([primeiro]);
      expect(estado.primeiro?.estado).toBe("concluido");
      expect(estado.segundo).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: primeiro });
      const conversa = [...estado.mensagens].sort((a, b) => a.criadoEm - b.criadoEm).filter((m) => m.kind === "texto").map((m) => [m.autoria.autor_tipo, m.texto]);
      expect(conversa).toEqual([
        ["pessoa", "implemente a 86akr9u9u"],
        ["agente", "Disparei os testes, sigo quando terminarem."],
        ["pessoa", "quanto é 2+2?"],
        ["agente", "Recebi: quanto é 2+2?"],
      ]);
      // A fala intermediária saiu do mesmo turno, gravada uma vez.
      expect(estado.mensagens.filter((m) => m.turnoId === primeiro && m.autoria.autor_tipo === "agente")).toHaveLength(2);
    } finally {
      await laco.parar();
    }
  });

  /**
   * O driver dos testes abaixo: o turno longo fala, espera ser liberado e fica ocioso duas vezes; qualquer outro turno
   * (a mensagem da pessoa rodando à parte) responde na hora. `escreve` = o CLI aceita a escrita da mensagem.
   */
  function driverDeTurnoLongo(o: { longo: () => string | null; escreve: boolean }) {
    const etapa = { falou: false, liberado: false, rodados: [] as string[], ofertas: 0 };
    const recebidas: string[] = [];
    const driver: Driver = {
      meta: { id: "catcher", locality: "ambos", capacidades: SESSAO_VIVA },
      async create() {
        return {
          sondar: async () => PRONTO,
          dispose: async () => {},
          adapter: (plano): Adapter => {
            let aberta = true;
            let sinksDoTurno: SinksTurno | null = null;
            return {
              async rodarTurno(sinks: SinksTurno): Promise<ResultadoTurno> {
                sinksDoTurno = sinks;
                etapa.rodados.push(plano.turnoId);
                await sinks.sinal("attempted");
                await sinks.sinal("promptSubmitted");
                let texto = `Respondi: ${plano.entrada.texto}`;
                if (plano.turnoId === o.longo()) {
                  sinks.falaIntermediaria!("Trabalhando na rotina.");
                  etapa.falou = true;
                  await esperarAte(() => etapa.liberado);
                  await sinks.ocioso!();
                  await sinks.ocioso!();
                  texto = "Rotina feita.";
                }
                aberta = false;
                return { desfecho: "sucesso", texto, sessaoCli: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
              },
              async interromper() { etapa.liberado = true; },
              aceitaMensagens: () => aberta,
              receberMensagem(texto, id) {
                etapa.ofertas += 1;
                if (!aberta || !o.escreve) return false;
                recebidas.push(texto);
                if (id !== undefined) sinksDoTurno?.mensagemEntrou?.(id);
                return true;
              },
            };
          },
        };
      },
    };
    return { driver, etapa, recebidas };
  }

  async function rodarCenario(p: { montar: (deps: ReturnType<typeof depsSobreTrx>, agenteId: string, conversaId: string) => Promise<string>; escreve: boolean }) {
    const machineId = randomUUID();
    const ponte = criarPonteInterna(db, { services, useCases, executor: "catcher", listarPessoas, esquecerTurno: (id) => services.interruptor.esquecer(id) });
    await ponte.conectar({ machineId, nome: "teste", inventario: PRONTO, versaoContrato: 1 });
    let longo: string | null = null;
    const d = driverDeTurnoLongo({ longo: () => longo, escreve: p.escreve });
    const instance = await d.driver.create({ env: {}, cwdBase: "/tmp/nao-usado" });
    const registry: Registry = { "claude-cli": { estado: "sombra", motivo: "teste" }, catcher: { estado: "pronto", driver: d.driver, instance } };
    const { conversaId } = await escopado(async (trx) => {
      const deps = depsSobreTrx(trx, PESSOA, { services });
      const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Dev 5" })).data;
      criados.agentes.push(c.agente.id);
      criados.conversas.push(c.conversa.id);
      longo = await p.montar(deps, c.agente.id, c.conversa.id);
      return { conversaId: c.conversa.id };
    });
    const laco = iniciarLaco({ ponte, registry, pessoaId: PESSOA.pessoaId, machineId, relogio: Date.now, esperaVaziaMs: 20, jitterMs: 5, renovacaoMs: 10_000, checagemMensagensMs: 10_000 });
    return { d, conversaId, longo: longo as unknown as string, laco };
  }

  async function lerTurno(id: string) {
    return escopado(async (trx) => criarRepos(trx, PESSOA).turnos.buscar(id));
  }

  it("#189: a sessão fechou entre o pedido e a escrita — a mensagem não some: continua pendente e roda como turno próprio", { timeout: 25_000 }, async () => {
    const { d, conversaId, longo, laco } = await rodarCenario({
      escreve: false,
      montar: async (deps, _agenteId, conversaId) => (await executar(deps, enviarMensagem, { conversaId, texto: "implemente a 86akr9u9u", inventario: PRONTO, executor: "catcher" })).data.turno.id,
    });
    try {
      await esperarAte(() => d.etapa.falou);
      const segundo = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId, texto: "quanto é 2+2?", inventario: PRONTO, executor: "catcher" })).data.turno.id);
      d.etapa.liberado = true;
      await esperarAte(() => d.etapa.rodados.includes(segundo), 15_000);
      // O servidor ofereceu a mensagem, o CLI não a recebeu: ela não saiu como 'absorvido' e rodou à parte.
      expect(d.etapa.ofertas).toBeGreaterThan(0);
      expect(d.recebidas).toEqual([]);
      expect(d.etapa.rodados).toEqual([longo, segundo]);
      let t = await lerTurno(segundo);
      const fim = Date.now() + 8_000;
      while (t?.estado !== "concluido" && Date.now() < fim) {
        await new Promise((r) => setTimeout(r, 50));
        t = await lerTurno(segundo);
      }
      expect(t).toMatchObject({ estado: "concluido", motivoInterrupcao: null });
      expect(t?.absorvidoPor ?? null).toBeNull();
    } finally {
      await laco.parar();
    }
  });

  for (const caso of ["rotina", "retomada de uma rotina"] as const) {
    it(`ADR-083 §6: mensagem durante a ${caso} fica pendente e roda como turno de conversa próprio`, { timeout: 25_000 }, async () => {
      const { d, conversaId, longo, laco } = await rodarCenario({
        escreve: true,
        montar: async (deps, agenteId, conversaId) => {
          const base = { conversaId, agenteId, prazoEm: Date.now() + 3_600_000, profundidade: 0 as const, entradaTexto: "rotina das 9h", entradaConfianca: "confiavel" as const, modelo: "claude-haiku-4-5-20251001", executor: "catcher" as const };
          const rotina = await deps.repos.turnos.enfileirar({ ...base, origem: "rotina", ...(caso === "rotina" ? {} : { interrompidoCom: "sem_progresso" as const }) });
          if (caso === "rotina") return rotina!.id;
          return (await deps.repos.turnos.enfileirar({ ...base, origem: "retomada", retomaTurnoId: rotina!.id, entradaTexto: "continue a rotina" }))!.id;
        },
      });
      try {
        await esperarAte(() => d.etapa.falou);
        const segundo = await escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services }), enviarMensagem, { conversaId, texto: "e o relatório de ontem?", inventario: PRONTO, executor: "catcher" })).data.turno.id);
        // O ocioso da rotina pergunta ao servidor, que não oferece nada: a mensagem espera, pendente.
        d.etapa.liberado = true;
        await esperarAte(() => d.etapa.rodados.includes(segundo), 15_000);
        expect(d.etapa.ofertas).toBe(0);
        expect(d.recebidas).toEqual([]);
        expect(d.etapa.rodados).toEqual([longo, segundo]);
        let t = await lerTurno(segundo);
        const fim = Date.now() + 8_000;
        while (t?.estado !== "concluido" && Date.now() < fim) {
          await new Promise((r) => setTimeout(r, 50));
          t = await lerTurno(segundo);
        }
        expect(t).toMatchObject({ estado: "concluido", origem: "conversa" });
      } finally {
        await laco.parar();
      }
    });
  }
});
