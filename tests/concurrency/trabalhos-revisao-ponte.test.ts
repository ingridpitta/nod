import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { criarPonteInterna, type DepsPonte } from "../../src/adapters/fundo/ponte-interna.ts";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { ResultadoTurno } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { criarInterruptor } from "../../src/services/interruptor.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { molduraFalaNaFrente } from "../../src/domain/mensagem-no-meio.ts";
import { mensagemParaTrabalho } from "../../src/use-cases/coordenar-trabalhos.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import type { Services } from "../../src/use-cases/tipos.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Revisão do épico #188 (2026-10-08) pela ponte in-process de verdade, com Postgres e transações commitadas (como
 * sessao-viva.test.ts): a rede de 2 min (S15, S17), o recado da task em duas fases (S18, S19) e os mapas da ponte
 * (S20, S21). A máquina, o relógio e o plano são do teste; o resto é o código de produção.
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const listarPessoas = async () => [{ tenantId: PESSOA.tenantId, id: PESSOA.pessoaId }];
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

const base = servicosDeTeste((t) => criarRepos(t, PESSOA), PESSOA, { interruptor: criarInterruptor() });
/** O plano do teste: o de deps-l6 (montarPlano) no papel do Claude Code (ou do harness que o teste pedir), e com `bifurcar` quando o teste pede. */
const forcar: { bifurcar: boolean; harness: IdHarness } = { bifurcar: false, harness: "claude-cli" };
const services: Services = {
  ...base,
  planos: {
    ...base.planos,
    async emitir(trx, turnoId, machineId): Promise<PlanoTurno> {
      const p = await base.planos.emitir(trx, turnoId, machineId);
      return { ...p, harness: forcar.harness, ...(forcar.bifurcar ? { entrada: { ...p.entrada, sessaoCli: p.entrada.sessaoCli ?? "sessao-da-conversa", bifurcar: true } } : {}) };
    },
  },
};
const useCases = useCasesDeTeste();

afterEach(async () => {
  forcar.bifurcar = false;
  forcar.harness = "claude-cli";
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from turno_raio_x where owner_id = ${p}`;
    await trx`delete from esperas where owner_id = ${p}`;
    await trx`delete from turno_entregas where owner_id = ${p}`;
    await trx`delete from lotes_de_frentes where owner_id = ${p}`;
    await trx`delete from turno_diagnosticos where owner_id = ${p}`;
    await trx`delete from gastos where owner_id = ${p}`;
    await trx`delete from catcher_registros where owner_id = ${p}`;
    await trx`delete from decisoes where owner_id = ${p}`;
    await trx`delete from anexos where owner_id = ${p}`;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from propostas where owner_id = ${p}`;
    await trx`delete from agente_memorias where owner_id = ${p}`;
    await trx`delete from memoria_diario where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    await trx`delete from trabalhos where owner_id = ${p}`;
    await trx`delete from inventario_motores where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

const resultado = (r: Partial<ResultadoTurno> = {}): ResultadoTurno => ({ desfecho: "sucesso", texto: "feito", sessaoCli: null, sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [], ...r });

/** Um bot com conversa, a ponte com relógio do teste e a rede de 2 min em 1 s; a máquina anuncia o que o teste disser. */
async function montar(o: { capacidades?: boolean; depoisDeAssentar?: DepsPonte["depoisDeAssentar"]; capturas?: Services["capturas"] } = {}) {
  let relogio = Date.now();
  const deps: DepsPonte = { services: o.capturas ? { ...services, capturas: o.capturas } : services, useCases, executor: "local", listarPessoas, agora: () => relogio, fezFerramenta: () => true, redeMs: 1_000, ...(o.depoisDeAssentar ? { depoisDeAssentar: o.depoisDeAssentar } : {}) };
  const ponte = criarPonteInterna(db, deps);
  const machineId = randomUUID();
  const conectar = (capacidades: boolean) => ponte.conectar({ machineId, nome: "Mac", inventario: PRONTO, versaoContrato: 1, harnesses: { "claude-cli": PRONTO }, ...(capacidades ? { capacidades: { "claude-cli": CAPACIDADES_HARNESS["claude-cli"] } } : {}) });
  await conectar(o.capacidades === true);
  const { agenteId, conversaId } = await escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services: base });
    const c = (await executar(d, criarAgente, { dono: "pessoa", nome: `Rui ${randomUUID().slice(0, 4)}` })).data;
    criados.agentes.push(c.agente.id);
    criados.conversas.push(c.conversa.id);
    await d.repos.agentes.atualizarPerfil(c.agente.id, { confirmado: true });
    return { agenteId: c.agente.id, conversaId: c.conversa.id };
  });
  const falar = (texto: string) => escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services: base }), enviarMensagem, { conversaId, texto, inventario: PRONTO, executor: "local" })).data.turno.id);
  const ler = <T>(fn: (r: ReturnType<typeof criarRepos>) => Promise<T>) => escopado((trx) => fn(criarRepos(trx, PESSOA)));
  const renovar = (turnoId: string, extra: Record<string, unknown> = {}) => ponte.renovar({ turnoId, machineId, sinais: SINAIS, eventos: [], ...extra });
  /** Uma task da pessoa com um turno na fila (o próximo puxar o pega). */
  const tarefa = (titulo: string, forma: "task" | "frente" = "task") => escopado(async (trx) => {
    const d = depsSobreTrx(trx, PESSOA, { services: base });
    const { trabalho, events } = await criarTrabalho(d, { agenteId, conversaId, titulo, origem: "pessoa", forma });
    await d.repos.events.gravarComOutbox(events);
    const t = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", trabalhoId: trabalho.id, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: titulo, entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
    return { trabalhoId: trabalho.id, turnoId: t!.id };
  });
  const recado = (trabalhoId: string, texto: string) => escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA, { services: base }), mensagemParaTrabalho, { trabalhoId, texto })).data.mensagemTurnoId);
  return { ponte, machineId, agenteId, conversaId, falar, ler, renovar, conectar, tarefa, recado, avancar: (ms: number) => (relogio += ms) };
}

describeIntegracao("revisão #188 pela ponte: a rede de 2 min", () => {
  it("S15 revisto (ADR-099, I8): a máquina que não anunciou bifurcaSessao promove a frente e a conversa larga a sessão; anunciada, a conversa fica com ela", async () => {
    for (const anunciou of [false, true]) {
      const m = await montar({ capacidades: anunciou });
      await m.ler((r) => r.conversas.atualizarSessaoCli(m.conversaId, "sessao-da-conversa", "local", "claude-cli"));
      await m.falar("monte o relatório");
      const plano = await m.ponte.puxar(PESSOA.pessoaId);
      expect(plano).toMatchObject({ harness: "claude-cli", entrada: { sessaoCli: "sessao-da-conversa" } });
      m.avancar(2_000);
      expect((await m.renovar(plano!.turnoId)).ativo).toBe(true);
      const promovido = await m.ler((r) => r.turnos.buscar(plano!.turnoId));
      expect(promovido?.trabalhoId).toBeTruthy();
      expect(await m.ler((r) => r.trabalhos.buscar(promovido!.trabalhoId!))).toMatchObject({ origem: "rede", forma: "frente", sessaoCli: "sessao-da-conversa" });
      expect((await m.ler((r) => r.conversas.buscar(m.conversaId)))?.sessaoCli).toBe(anunciou ? "sessao-da-conversa" : null);
      // A sessão nova com que o promovido termina só volta para a conversa quando a rede bifurcou (S16).
      await m.ponte.entregar({ turnoId: plano!.turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: resultado({ sessaoCli: "sessao-da-frente" }) });
      expect((await m.ler((r) => r.trabalhos.buscar(promovido!.trabalhoId!)))?.sessaoCli).toBe("sessao-da-frente");
      expect((await m.ler((r) => r.conversas.buscar(m.conversaId)))?.sessaoCli).toBe(anunciou ? "sessao-da-conversa" : null);
    }
  });

  it("ADR-099 (I8): o Codex (sem retomar sessão) é promovido a frente sem anúncio de bifurcar; a conversa não muda", async () => {
    forcar.harness = "codex-cli";
    const m = await montar();
    await m.falar("monte o relatório");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    expect(plano?.harness).toBe("codex-cli");
    m.avancar(500);
    await m.renovar(plano!.turnoId);
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId, "antes do prazo, não").toBeNull();
    m.avancar(1_500);
    await m.renovar(plano!.turnoId);
    const promovido = await m.ler((r) => r.turnos.buscar(plano!.turnoId));
    const frente = await m.ler((r) => r.trabalhos.buscar(promovido!.trabalhoId!));
    expect(frente).toMatchObject({ origem: "rede", forma: "frente", sessaoHarness: "codex-cli" });
    expect(await m.ler((r) => r.frentes.buscarLote(frente!.loteId!))).toMatchObject({ abertoPorTurnoId: plano!.turnoId, trabalhoId: null });
  });

  it("ADR-099 (I8): a retomada do dono (modo conversa) também é promovida pela ponte", async () => {
    const m = await montar();
    const original = await m.falar("revise o contrato");
    const p1 = await m.ponte.puxar(PESSOA.pessoaId);
    expect(p1?.turnoId).toBe(original);
    await m.ponte.entregar({ turnoId: original, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "aprova?" }, resultado: resultado({ texto: "aprova?" }) });
    const retomada = await escopado(async (trx) => (await criarRepos(trx, PESSOA).turnos.enfileirar({ executor: "catcher", conversaId: m.conversaId, agenteId: m.agenteId, origem: "retomada", retomaTurnoId: original, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "[nod] A pessoa aprovou.", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" }))!.id);
    const p2 = await m.ponte.puxar(PESSOA.pessoaId);
    expect(p2?.turnoId).toBe(retomada);
    expect(p2?.modoTurno).toBe("conversa");
    m.avancar(2_000);
    await m.renovar(retomada);
    const promovido = await m.ler((r) => r.turnos.buscar(retomada));
    expect(await m.ler((r) => r.trabalhos.buscar(promovido!.trabalhoId!))).toMatchObject({ forma: "frente", titulo: "Revise o contrato" }); // o título provisório (plano chat limpo, PR 5)
  });

  it("S15: o turno que devia bifurcar e voltou recusado faz a conversa largar a sessão (o próximo plano sai em sessão nova, sem bifurcar)", async () => {
    const m = await montar({ capacidades: true });
    await m.ler((r) => r.conversas.atualizarSessaoCli(m.conversaId, "sessao-da-conversa", "local", "claude-cli"));
    forcar.bifurcar = true;
    await m.falar("e agora?");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    expect(plano?.entrada.bifurcar).toBe(true);
    await m.ponte.entregar({ turnoId: plano!.turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado: resultado({ desfecho: "interrompido", motivoInterrupcao: "executor_indisponivel", texto: "" }) });
    expect((await m.ler((r) => r.conversas.buscar(m.conversaId)))?.sessaoCli).toBeNull();
  });

  it("S17: com mensagem oferecida e ainda não confirmada, a rede não promove; confirmada, promove", async () => {
    const m = await montar({ capacidades: true });
    await m.falar("monte o relatório");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    const segunda = await m.falar("inclua setembro");
    m.avancar(2_000);
    const oferta = await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    expect(oferta.mensagensIds).toEqual([segunda]);
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeNull();
    // Renovação seguinte sem a confirmação: a mensagem segue no ar, e nada de promover.
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeNull();
    // Confirmada (o CLI recebeu e vai responder neste turno): agora promove.
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [segunda] });
    expect((await m.ler((r) => r.turnos.buscar(plano!.turnoId)))?.trabalhoId).toBeTruthy();
  });
});

describeIntegracao("revisão #188 pela ponte: o recado da task em duas fases", () => {
  it("S18: o recado é oferecido sem sair da fila, vem em mensagensIds e mensagensSemMoldura, e só sai absorvido na confirmação", async () => {
    const m = await montar();
    const { trabalhoId } = await m.tarefa("Relatório", "frente");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    const recado = await m.recado(trabalhoId, "inclua setembro");
    const r = await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    // NOD-376: a fala da pessoa vem já com a moldura dela; o id segue em mensagensSemMoldura (o laço não embrulha de novo).
    expect(r).toMatchObject({ mensagens: [molduraFalaNaFrente("inclua setembro")], mensagensIds: [recado], mensagensSemMoldura: [recado] });
    expect((await m.ler((x) => x.turnos.buscar(recado)))?.estado).toBe("pendente");
    // Já oferecido: não vai de novo enquanto a confirmação não volta.
    expect((await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] })).mensagens).toBeUndefined();
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [recado] });
    expect(await m.ler((x) => x.turnos.buscar(recado))).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: plano!.turnoId });
  });

  it("S18: o app antigo (sem confirmação) recebe o recado absorvido na hora, com o id alinhado ao texto", async () => {
    const m = await montar();
    const { trabalhoId } = await m.tarefa("Relatório", "frente");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    const recado = await m.recado(trabalhoId, "inclua setembro");
    const r = await m.renovar(plano!.turnoId, { aceitaMensagens: true });
    expect(r).toMatchObject({ mensagens: [molduraFalaNaFrente("inclua setembro")], mensagensIds: [recado] });
    expect((await m.ler((x) => x.turnos.buscar(recado)))?.motivoInterrupcao).toBe("absorvido");
  });

  it("S19: a entrega confirma as mensagens que a última renovação não confirmou, antes de assentar", async () => {
    const m = await montar();
    await m.falar("monte o relatório");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    const segunda = await m.falar("inclua setembro");
    expect((await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] })).mensagensIds).toEqual([segunda]);
    await m.ponte.entregar({ turnoId: plano!.turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto", texto: "feito, com setembro" }, resultado: resultado({ texto: "feito, com setembro" }), mensagensEntregues: [segunda] });
    expect(await m.ler((x) => x.turnos.buscar(segunda))).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: plano!.turnoId });
    expect((await m.ler((x) => x.turnos.buscar(plano!.turnoId)))?.estado).toBe("concluido");
  });
});

describeIntegracao("revisão #188 pela ponte: os mapas da ponte", () => {
  it("S20: o assentar vítima de impasse é repetido; a falha que sobra deixa o escopo para a entrega repetida assentar", async () => {
    const impasse = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
    let falhas = 1;
    const m = await montar({ depoisDeAssentar: async () => { if (falhas-- > 0) throw impasse(); return []; } });
    await m.falar("primeira");
    const p1 = await m.ponte.puxar(PESSOA.pessoaId);
    const entrega = (turnoId: string) => ({ turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto" as const, texto: "feito" }, resultado: resultado() });
    await m.ponte.entregar(entrega(p1!.turnoId));
    expect((await m.ler((r) => r.turnos.buscar(p1!.turnoId)))?.estado).toBe("concluido");
    expect(m.ponte.emMemoria?.()).toEqual({ escopos: 0, oferecidas: 0, despachados: 0 });

    // Três impasses seguidos: a entrega falha, mas o escopo fica — a entrega repetida pelo app assenta.
    falhas = 3;
    await m.falar("segunda");
    const p2 = await m.ponte.puxar(PESSOA.pessoaId);
    await expect(m.ponte.entregar(entrega(p2!.turnoId))).rejects.toMatchObject({ code: "40P01" });
    expect(m.ponte.escopoDoTurno(p2!.turnoId)).not.toBeNull();
    await m.ponte.entregar(entrega(p2!.turnoId));
    expect((await m.ler((r) => r.turnos.buscar(p2!.turnoId)))?.estado).toBe("concluido");
    expect(m.ponte.escopoDoTurno(p2!.turnoId)).toBeNull();
  });

  it("S21: o turno que some sem entregar sai de oferecidas e despachados quando o lease vence (o escopo fica para a entrega tardia)", async () => {
    const m = await montar();
    await m.falar("primeira");
    const plano = await m.ponte.puxar(PESSOA.pessoaId);
    await m.falar("segunda");
    await m.renovar(plano!.turnoId, { aceitaMensagens: true, mensagensEntregues: [] });
    expect(m.ponte.emMemoria?.()).toEqual({ escopos: 1, oferecidas: 1, despachados: 1 });
    m.avancar(LEASE_MS + 1_000);
    expect(await m.ponte.puxar(PESSOA.pessoaId)).toBeNull();
    expect(m.ponte.emMemoria?.()).toEqual({ escopos: 1, oferecidas: 0, despachados: 0 });
  });
});

describeIntegracao("NOD-200 pela ponte: a captura do turno", () => {
  it("o assentar repetido por impasse acha a mesma captura; ela só é esquecida depois do assentar confirmado", async () => {
    const impasse = () => Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const telas = new Map<string, Uint8Array>();
    const capturas = { ler: (id: string) => telas.get(id) ?? null, esquecer: (id: string) => { telas.delete(id); } };
    let falhas = 1;
    const m = await montar({ capturas, depoisDeAssentar: async () => { if (falhas-- > 0) throw impasse(); return []; } });
    const entrega = (turnoId: string) => ({ turnoId, machineId: m.machineId, seqLocal: 1, fala: { tipo: "texto" as const, texto: "feito" }, resultado: resultado() });
    const anexos = () => escopado((trx) => trx<{ mensagem_id: string | null }[]>`select mensagem_id from anexos where conversa_id = ${m.conversaId}`);

    // Um impasse: a 2ª tentativa assenta com a mesma tela, e a ponte a esquece.
    await m.falar("primeira");
    const p1 = await m.ponte.puxar(PESSOA.pessoaId);
    telas.set(p1!.turnoId, new Uint8Array([1, 2, 3]));
    await m.ponte.entregar(entrega(p1!.turnoId));
    expect(await anexos()).toHaveLength(1);
    expect(telas.has(p1!.turnoId)).toBe(false);

    // Três impasses: a entrega falha e a tela fica, como o escopo; a entrega repetida pelo app a grava e a esquece.
    falhas = 3;
    await m.falar("segunda");
    const p2 = await m.ponte.puxar(PESSOA.pessoaId);
    telas.set(p2!.turnoId, new Uint8Array([4, 5, 6]));
    await expect(m.ponte.entregar(entrega(p2!.turnoId))).rejects.toMatchObject({ code: "40P01" });
    expect(telas.has(p2!.turnoId)).toBe(true);
    await m.ponte.entregar(entrega(p2!.turnoId));
    expect(await anexos()).toHaveLength(2);
    expect(telas.has(p2!.turnoId)).toBe(false);
  });
});
