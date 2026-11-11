import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * Terceiro modo (ADR-011 refinado): DUAS conexões disputam UM turno pendente ao mesmo tempo.
 * Reivindicar = pg_advisory_xact_lock por pessoa + UPDATE condicional com FOR UPDATE SKIP LOCKED
 * (ADR-010; ver o comentário medido em turnosRepo.reivindicar): exatamente uma vence; a outra
 * ESPERA o commit da primeira e recebe null, sem erro. Sem rollback: linhas COMMITADAS e apagadas
 * por id no afterEach (única exceção documentada ao DELETE em teste).
 */
// Pessoa PRÓPRIA deste arquivo (uuid aleatório, sem linha em pessoas — não há FK): a fila de turnos é
// por pessoa, então dois arquivos de concurrency nunca disputam as mesmas linhas, rode o vitest como rodar.
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], turnos: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, MARLON);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function fixture(): Promise<{ turnoId: string }> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const turnoId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, MARLON);
    await repos.agentes.criar({ id: agenteId, nome: "Concorrente", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
    await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  criados.turnos.push(turnoId);
  return { turnoId };
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from turno_raio_x where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from esperas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turno_entregas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from lotes_de_frentes where aberto_por_turno_id in ${trx(criados.turnos)} or retorno_turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turnos where id in ${trx(criados.turnos)}`;
    // ADR-083 (0060): os trabalhos apontam para a conversa (e a rotina) — saem antes dela.
    await trx`delete from trabalhos where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  criados.agentes.length = criados.conversas.length = criados.turnos.length = 0;
});

describeIntegracao("concorrência: reivindicação de turno (advisory lock por pessoa + SKIP LOCKED)", () => {
  it("duas conexões disputam o mesmo turno ao mesmo tempo: exatamente uma vence e a outra recebe null", async () => {
    const { turnoId } = await fixture();
    const [a, b] = await Promise.all([
      escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })),
      escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })),
    ]);
    const ids = [a?.id ?? null, b?.id ?? null];
    expect(ids.filter((id) => id === turnoId)).toHaveLength(1);
    expect(ids.filter((id) => id === null)).toHaveLength(1);
  });

  it("a segunda ESPERA a primeira commitar (trava por pessoa) e só então recebe null — nunca reivindica por cima", async () => {
    const { turnoId } = await fixture();
    let primeiraDentro = () => undefined as void;
    const primeiraReivindicou = new Promise<void>((r) => {
      primeiraDentro = r;
    });
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => {
      liberar = r;
    });
    const primeira = escopado(async (trx) => {
      const t = await criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      primeiraDentro();
      await podeCommitar;
      return t;
    });
    await primeiraReivindicou;
    const segunda = escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    const apressada = await Promise.race([segunda.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 100))]);
    expect(apressada).toBe("esperando");
    liberar();
    expect((await primeira)?.id).toBe(turnoId);
    expect(await segunda).toBeNull();
  });

  it("commitada, a reivindicação vale para a outra conexão; renovar de outra máquina é {ativo:false}; sobre o POOL abre a própria tx escopada", async () => {
    const { turnoId } = await fixture();
    const maquinaA = randomUUID();
    // Direto no pool (sem transação aberta): reivindicar abre a tx curta por conta própria. definido em 2026-10-15
    // (NOD-266): ela é a escopada (abrirTxEscopada — escopo, prazo de conexão e timeouts), então reivindica de verdade.
    // Antes era um `begin` cru: sem escopo, a policy falhava fechado; sem prazo, pendurava com o pool cheio.
    const ganho = await criarRepos(db, MARLON).turnos.reivindicar({ machineId: maquinaA, agora: Date.now() });
    expect(ganho?.id).toBe(turnoId);
    expect(await criarRepos(db, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
    expect(await escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))).toBeNull();
    expect(await escopado(async (trx) => criarRepos(trx, MARLON).turnos.renovarLease(turnoId, randomUUID(), {}, Date.now()))).toEqual({ ativo: false, motivo: "lease_vencido" });
    expect(await escopado(async (trx) => criarRepos(trx, MARLON).turnos.renovarLease(turnoId, maquinaA, { promptSubmitted: true }, Date.now()))).toEqual({ ativo: true });
  });

  it("ADR-083: dois turnos do MESMO trabalho, duas conexões ao mesmo tempo — sai um só; o do trabalho não espera a conversa", async () => {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const trabalhoId = randomUUID();
    const doTrabalho = [randomUUID(), randomUUID()];
    const daConversa = randomUUID();
    await escopado(async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.agentes.criar({ id: agenteId, nome: "Faixas", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      await repos.trabalhos.criar({ id: trabalhoId, agenteId, conversaId, titulo: "Login do app", origem: "pessoa" });
      for (const id of doTrabalho) await repos.turnos.enfileirar({ executor: "catcher", id, conversaId, agenteId, origem: "conversa", trabalhoId, prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    });
    criados.agentes.push(agenteId);
    criados.conversas.push(conversaId);
    criados.turnos.push(...doTrabalho);
    const disputa = () => escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }));
    const ganhos = (await Promise.all([disputa(), disputa()])).flatMap((t) => (t ? [t.id] : []));
    expect(ganhos).toHaveLength(1);
    expect(doTrabalho).toContain(ganhos[0]);
    // Com o trabalho rodando, a mensagem da conversa do mesmo bot sai na hora.
    await escopado(async (trx) => criarRepos(trx, MARLON).turnos.enfileirar({ executor: "catcher", id: daConversa, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "m" }));
    criados.turnos.push(daConversa);
    expect((await disputa())?.id).toBe(daConversa);
    expect(await disputa()).toBeNull();
  });

  // Regression: pedido do Marlon (2026-11-10, "não quero limites"): o quadro não tem mais teto próprio (ADR-163 §4).
  // Duas tarefas do mesmo bot em duas conexões ao mesmo tempo saem as duas; a segunda só espera o advisory lock da pessoa.
  it("ADR-163: sem teto, duas tarefas do quadro do mesmo bot disputadas em duas conexões saem as duas", async () => {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const turnos = [randomUUID(), randomUUID()];
    await escopado(async (trx) => {
      const repos = criarRepos(trx, MARLON);
      await repos.agentes.criar({ id: agenteId, nome: "Sem teto", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      for (const id of turnos) {
        const w = (await repos.trabalhos.criar({ agenteId, conversaId, titulo: `Tarefa ${id.slice(0, 4)}`, origem: "quadro" }))!;
        await repos.turnos.enfileirar({ executor: "catcher", id, conversaId, agenteId, origem: "delegacao", trabalhoId: w.id, prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      }
    });
    criados.agentes.push(agenteId);
    criados.conversas.push(conversaId);
    criados.turnos.push(...turnos);
    const maquina = randomUUID();
    const pegos = await Promise.all([0, 1].map(() => escopado(async (trx) => criarRepos(trx, MARLON).turnos.reivindicar({ machineId: maquina, agora: Date.now() }))));
    expect(pegos.map((t) => t?.id).sort()).toEqual([...turnos].sort());
  });
});
