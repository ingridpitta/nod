import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, USO_VALE_MS, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarTrabalhosVivos } from "../../src/adapters/fundo/trabalhos-vivos.ts";
import type { PlataformaMaquina } from "../../src/contracts/ponte.ts";
import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { LeituraMemoria, NivelPressao, OrigemTrabalho } from "../../src/contracts/trabalho.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ESPACO_FUNDO_MS } from "../../src/domain/memoria-mac.ts";
import { definirDestinoDoLog } from "../../src/obs/log.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * ADR-085 pela ponte in-process de verdade (revisão do #209): a leitura que vem no `puxar` decide, no MESMO puxar, se
 * trabalho novo em segundo plano sai; o "uso do Mac" da pessoa vale; logo depois de um começar, o próximo espera a vez;
 * e a mudança do processador vira o evento do frame. Postgres e transações commitadas, como trabalhos-revisao-ponte.
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
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from preferencias where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const leitura = (processador: NivelPressao, memoria: NivelPressao = "verde"): LeituraMemoria => ({ nivel: memoria, totalMb: 800, porTurno: [], processador: { nivel: processador, carga: processador === "verde" ? 0.3 : processador === "amarela" ? 0.8 : 1.4 } });

async function montar(uso?: UsoDoMac, o: { plataforma?: PlataformaMaquina; fundoLinuxSoVermelha?: boolean } = {}) {
  let relogio = Date.now();
  const vivos = criarTrabalhosVivos(() => relogio);
  const deps: DepsPonte = {
    services, useCases, executor: "local", listarPessoas, agora: () => relogio,
    registrarMemoria: (p, m, l) => vivos.registrarMemoria(p, m, l),
    pressaoDaMaquina: (m) => vivos.daMaquina(m),
    desfazerMemoria: (p, m) => vivos.desfazer(p, m),
    usoTrocadoEm: (p) => vivos.usoTrocadoEm(p),
    esquecerMaquina: (m) => vivos.esquecerMaquina(m),
    ...(o.fundoLinuxSoVermelha ? { fundoLinuxSoVermelha: true } : {}),
  };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  await ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO }, ...(o.plataforma ? { plataforma: o.plataforma } : {}) });
  const { agenteId, conversaId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rui ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    if (uso) await d.repos.preferencias.gravar({ usoDoMac: uso });
    return { agenteId: c.agente.id, conversaId: c.conversa.id };
  });
  /** Um trabalho com um turno na fila. */
  const tarefa = (origem: OrigemTrabalho, titulo: string) => escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services });
    const { trabalho } = await criarTrabalho(d, { agenteId, conversaId, titulo, origem });
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: origem === "rotina" ? "rotina" : "conversa", trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: titulo, entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
    return t!.id;
  });
  const puxar = async (l?: LeituraMemoria) => (await ponte.puxar(PESSOA.pessoaId, l))?.turnoId ?? null;
  const eventosDePressao = () => escopado(async (trx) => trx<{ dados: Record<string, unknown> }[]>`select dados from events where owner_id = ${PESSOA.pessoaId} and kind = 'pressao_memoria' order by created_at`);
  return { ponte, machineId, tarefa, puxar, eventosDePressao, gravarUso: async (u: UsoDoMac, avisar = true) => {
    await escopado((trx) => criarRepos(trx, PESSOA).preferencias.gravar({ usoDoMac: u }));
    // A rota PUT preferencias avisa depois de gravar (rotas/raio-x.ts); sem o aviso, vale o cache de USO_VALE_MS.
    if (avisar) vivos.trocouUsoDoMac(PESSOA.pessoaId);
  }, avancar: (ms: number) => (relogio += ms) };
}

describeIntegracao("uso do Mac pela ponte (ADR-085, revisão do #209)", () => {
  it("processador cheio no puxar, no 'Pouco': a task da pessoa sai, a rotina espera e sai quando o Mac alivia; no equilibrado, nada espera por ele (ADR-097)", async () => {
    const m = await montar("pouco");
    const rotina = await m.tarefa("rotina", "Verificar o Slack");
    const daPessoa = await m.tarefa("pessoa", "Liberar espaço");
    expect(await m.puxar(leitura("vermelha"))).toBe(daPessoa);
    expect(await m.puxar(leitura("vermelha"))).toBeNull();
    expect(await m.puxar(leitura("verde"))).toBe(rotina);

    await m.gravarUso("equilibrado");
    m.avancar(ESPACO_FUNDO_MS + 1);
    const outra = await m.tarefa("rotina", "Verificar o e-mail");
    expect(await m.puxar(leitura("vermelha"))).toBe(outra);
  });

  it("'O quanto precisar' não segura nada (nem com a memória crítica); 'Pouco' segura já no processador apertando", async () => {
    const livre = await montar("livre");
    const r1 = await livre.tarefa("rotina", "Rotina A");
    // #219: só o disco crítico segura em "O quanto precisar" (o teste do disco, abaixo).
    expect(await livre.puxar(leitura("vermelha", "vermelha"))).toBe(r1);

    const pouco = await montar("pouco");
    const r2 = await pouco.tarefa("rotina", "Rotina B");
    expect(await pouco.puxar(leitura("amarela"))).toBeNull();
    // Gravada por fora da rota (sem aviso), a troca espera o cache de USO_VALE_MS…
    await pouco.gravarUso("equilibrado", false);
    expect(await pouco.puxar(leitura("amarela"))).toBeNull();
    pouco.avancar(USO_VALE_MS + 1);
    expect(await pouco.puxar(leitura("amarela"))).toBe(r2);
  });

  it("a troca pela rota (o aviso trocouUsoDoMac) vale no puxar na hora, sem esperar o cache", async () => {
    const m = await montar("pouco");
    const r = await m.tarefa("rotina", "Rotina C");
    expect(await m.puxar(leitura("amarela"))).toBeNull();
    await m.gravarUso("equilibrado");
    expect(await m.puxar(leitura("amarela"))).toBe(r);
  });

  it("o espaço: com o Mac folgado, duas rotinas não começam na mesma leitura — a segunda espera ESPACO_FUNDO_MS", async () => {
    const m = await montar();
    const a = await m.tarefa("rotina", "Rotina A");
    const b = await m.tarefa("rotina", "Rotina B");
    const daPessoa = await m.tarefa("pessoa", "Responder o e-mail");
    // A da pessoa passa na frente (a ordem de sempre) e não conta como trabalho em segundo plano.
    expect(await m.puxar(leitura("verde"))).toBe(daPessoa);
    expect(await m.puxar(leitura("verde"))).toBe(a);
    expect(await m.puxar(leitura("verde"))).toBeNull();
    m.avancar(ESPACO_FUNDO_MS + 1);
    expect(await m.puxar(leitura("verde"))).toBe(b);
  });

  it("sem leitura do Mac (app antigo), nada é segurado nem espaçado", async () => {
    const m = await montar();
    const a = await m.tarefa("rotina", "Rotina A");
    const b = await m.tarefa("rotina", "Rotina B");
    expect(await m.puxar()).toBe(a);
    expect(await m.puxar()).toBe(b);
  });

  it("a mudança só do processador vira o evento do frame (com o processador); o Mac desconectado não segura mais", async () => {
    const m = await montar("pouco");
    const rotina = await m.tarefa("rotina", "Rotina A");
    expect(await m.puxar(leitura("verde"))).toBe(rotina);
    m.avancar(ESPACO_FUNDO_MS + 1);
    await m.puxar(leitura("vermelha"));
    const eventos = await m.eventosDePressao();
    expect(eventos.at(-1)?.dados).toMatchObject({ nivel: "verde", processador: "vermelha" });

    const outra = await m.tarefa("rotina", "Rotina B");
    expect(await m.puxar()).toBeNull();
    await m.ponte.desconectar(m.machineId);
    await m.ponte.conectar({ machineId: m.machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO } });
    expect(await m.puxar()).toBe(outra);
  });
  it("#219: disco crítico (< 3 GB) no puxar — nem a task da pessoa começa, até em 'O quanto precisar'; em alerta (< 10 GB), ela sai; o evento leva o nível", async () => {
    const m = await montar("livre");
    const daPessoa = await m.tarefa("pessoa", "Liberar espaço");
    const critico: LeituraMemoria = { ...leitura("verde"), disco: { livreMb: 2 * 1024, totalMb: 500 * 1024 } };
    expect(await m.puxar(critico)).toBeNull();
    expect((await m.eventosDePressao()).at(-1)?.dados).toMatchObject({ nivel: "verde", disco: "vermelha" });
    // O relógio do teste não anda: os dois eventos têm o mesmo instante, então a ordem não serve — conta os dois.
    expect(await m.puxar({ ...critico, disco: { livreMb: 8 * 1024, totalMb: 500 * 1024 } })).toBe(daPessoa);
    expect((await m.eventosDePressao()).map((e) => e.dados.disco).sort()).toEqual(["amarela", "vermelha"]);
  });

  it("#219: disco em alerta e memória crítica (em 'Equilibrado') seguram só o segundo plano; a task da pessoa sai; sem disco (app anterior), nada", async () => {
    const m = await montar();
    const rotina = await m.tarefa("rotina", "Verificar o Slack");
    const daPessoa = await m.tarefa("pessoa", "Responder o e-mail");
    expect(await m.puxar(leitura("verde", "vermelha"))).toBe(daPessoa);
    expect(await m.puxar({ ...leitura("verde"), disco: { livreMb: 8 * 1024, totalMb: 500 * 1024 } })).toBeNull();
    expect(await m.puxar(leitura("verde", "verde"))).toBe(rotina);
  });

  it("NOD-279 (C15): fundo_comecou traz a plataforma; com NOD_FUNDO_LINUX_SO_VERMELHA, a VM linux em amarela não segura a rotina e a vermelha segura", async () => {
    const linhas: string[] = [];
    definirDestinoDoLog((l) => linhas.push(l));
    try {
      const vm = await montar("equilibrado", { plataforma: "linux", fundoLinuxSoVermelha: true });
      const rotina = await vm.tarefa("rotina", "Verificar o Slack");
      expect(await vm.puxar(leitura("verde", "amarela"))).toBe(rotina);
      const comecou = linhas.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === "fundo_comecou" && l.machine_id === vm.machineId);
      expect(comecou).toMatchObject({ plataforma: "linux", origem: "rotina" });
      vm.avancar(ESPACO_FUNDO_MS + 1);
      const outra = await vm.tarefa("rotina", "Verificar o e-mail");
      expect(await vm.puxar(leitura("verde", "vermelha"))).toBeNull();
      expect(await vm.puxar(leitura("verde", "verde"))).toBe(outra);

      // O Mac sem plataforma anunciada é darwin: a amarela segura como antes, mesmo com a regra ligada.
      const mac = await montar("equilibrado", { fundoLinuxSoVermelha: true });
      const r = await mac.tarefa("rotina", "Rotina do Mac");
      expect(await mac.puxar(leitura("verde", "amarela"))).toBeNull();
      expect(await mac.puxar(leitura("verde", "verde"))).toBe(r);
      expect(linhas.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evento === "fundo_comecou" && l.machine_id === mac.machineId)).toMatchObject({ plataforma: "darwin" });
    } finally {
      definirDestinoDoLog(null);
    }
  });
});
