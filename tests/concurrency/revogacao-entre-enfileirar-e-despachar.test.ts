import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { db } from "../helpers/db.ts";
import { autoriaPessoa } from "../helpers/fabricas.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";

/**
 * E6.4 (2) / ADR-013: o alcance é reverificado na borda do DESPACHO, não no enfileirar. Duas
 * conexões de verdade: a primeira enfileira o turno com a concessão viva e COMMITA; a segunda
 * REVOGA e commita; a primeira emite o plano depois → a ferramenta não está no catálogo.
 * Sem rollback: linhas commitadas e apagadas por id no afterEach (exceção documentada ao DELETE).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const criados = { agentes: [] as string[], conversas: [] as string[], turnos: [] as string[], conectores: [] as string[], mensagens: [] as string[], concessoes: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    await trx`delete from concessoes where id in ${trx(criados.concessoes)}`;
    await trx`delete from turno_raio_x where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from esperas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turno_entregas where turno_id in ${trx(criados.turnos)}`;
    await trx`delete from lotes_de_frentes where aberto_por_turno_id in ${trx(criados.turnos)} or retorno_turno_id in ${trx(criados.turnos)}`;
    await trx`delete from turnos where id in ${trx(criados.turnos)}`;
    // ADR-083 (0060): os trabalhos apontam para a conversa (e a rotina) — saem antes dela.
    await trx`delete from trabalhos where conversa_id in ${trx(criados.conversas)}`;
    await trx`delete from mensagens where id in ${trx(criados.mensagens)}`;
    await trx`delete from conectores where id in ${trx(criados.conectores)}`;
    await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    await trx`delete from agentes where id in ${trx(criados.agentes)}`;
  });
  for (const k of Object.keys(criados) as (keyof typeof criados)[]) criados[k].length = 0;
});

describeIntegracao("concorrência: revogação entre enfileirar e PUXAR", () => {
  it("a concessão revogada por outra conexão depois do enfileirar não entra no plano emitido no despacho", async () => {
    const agenteId = randomUUID();
    const conversaId = randomUUID();
    const conectorId = randomUUID();
    const turnoId = randomUUID();
    const mensagemId = randomUUID();
    const concessaoId = randomUUID();
    Object.assign(criados, { agentes: [agenteId], conversas: [conversaId], conectores: [conectorId], turnos: [turnoId], mensagens: [mensagemId], concessoes: [concessaoId] });

    // Conexão 1: tudo enfileirado com a concessão VIVA, commitado.
    await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      await repos.agentes.criar({ id: agenteId, nome: "Concorrente", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m", confirmado: true });
      await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
      await repos.conectores.criar({ id: conectorId, nome: "Exemplo", slug: `ex-${conectorId.slice(0, 8)}`, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conectorId, { ok: true, catalogo: [{ nome: "listar", descricao: "", schema: { type: "object" }, readOnlyHint: true }], agora: Date.now() });
      await repos.mensagens.criar({ id: mensagemId, conversaId, autoria: autoriaPessoa(PESSOA.pessoaId), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ id: concessaoId, agenteId, conectorId, capacidade: "listar", mensagemId });
      await repos.turnos.enfileirar({ executor: "catcher", id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    });

    // Controle positivo (conexão 1, antes da revogação): a ferramenta ENTRA.
    const antes = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      return (await emitirPlanoTurno(depsSobre(repos, PESSOA, { services: servicosDeTeste(), trx }), { turnoId, machineId: "m1" })).data;
    });
    expect(antes.catalogo.ferramentas.some((f) => f.conectorId === conectorId)).toBe(true);

    // Conexão 2: revoga e commita — entre o enfileirar e o PUXAR.
    await escopado(async (trx) => {
      expect(await criarRepos(trx, PESSOA).concessoes.revogar(concessaoId)).toBe(true);
    });

    // Conexão 1 de novo, no despacho: o plano é emitido SEM a ferramenta (alcance lido agora).
    const depois = await escopado(async (trx) => {
      const repos = criarRepos(trx, PESSOA);
      return (await emitirPlanoTurno(depsSobre(repos, PESSOA, { services: servicosDeTeste(), trx }), { turnoId, machineId: "m1" })).data;
    });
    expect(depois.catalogo.ferramentas.some((f) => f.conectorId === conectorId)).toBe(false);
    expect(depois.catalogo.servidores).toEqual([]);
    expect(depois.catalogo.ferramentas.map((f) => f.nome)).toContain("lembrar");
  });
});
