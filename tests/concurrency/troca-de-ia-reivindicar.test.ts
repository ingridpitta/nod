import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { dbDono } from "../helpers/db-dono.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-277 (definido em 2026-10-15): a troca de IA reescreve o fundo pendente sob o advisory lock da pessoa, o mesmo do
 * `reivindicar`. Numa conexão de verdade ao lado, a máquina tenta pegar a rotina enquanto a troca ainda não commitou: ela
 * espera e, quando pega, o turno já está na IA nova — nunca sai na IA velha depois de a pessoa ter trocado.
 * Pessoa própria por rodada (uuid aleatório); linhas COMMITADAS e apagadas por dono no fim.
 */
const criadas: Escopo[] = [];

async function escopado<T>(escopo: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, escopo);
    await trx`set local lock_timeout = '10s'`;
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

afterEach(async () => {
  for (const escopo of criadas.splice(0)) await limparPessoaE2E(db, dbDono, escopo, { agentes: [], conversas: [] });
});

describeIntegracao("concorrência (NOD-277): troca de IA × reivindicar", () => {
  it("a máquina que reivindica durante a troca espera o commit e pega a rotina já na IA nova", async () => {
    const escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    criadas.push(escopo);
    const { agenteId, turnoId } = await escopado(escopo, async (trx) => {
      const repos = criarRepos(trx, escopo);
      const agente = await repos.agentes.criar({ nome: "Ze 1", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "sonnet", harness: "claude-cli" });
      const conversa = await repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
      const t = await repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "rotina", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "e-mails", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
      return { agenteId: agente?.id ?? "", turnoId: t?.id ?? "" };
    });

    let maquina: Promise<{ id: string; harness: string | undefined; modelo: string } | null> | null = null;
    let pegouAntes = false;
    await escopado(escopo, async (trxTroca) => {
      expect(await criarRepos(trxTroca, escopo).turnos.reescreverFundoDoBot(agenteId, { harness: "codex-cli", modelo: "gpt-5.6-luna" })).toBe(1);
      maquina = escopado(escopo, async (trxMaquina) => {
        const t = await criarRepos(trxMaquina, escopo).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
        pegouAntes = true;
        return t ? { id: t.id, harness: t.harness, modelo: t.modelo } : null;
      });
      await new Promise((r) => setTimeout(r, 300));
      // A troca ainda não commitou: a máquina está parada no lock da pessoa.
      expect(pegouAntes).toBe(false);
    });
    expect(await maquina).toEqual({ id: turnoId, harness: "codex-cli", modelo: "gpt-5.6-luna" });
  });
});
