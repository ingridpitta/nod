import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-156, critério 2: duas transações REAIS mandam a mesma fala com a mesma chave ao mesmo tempo. O índice único
 * parcial da 0057 resolve a corrida: a segunda espera o commit da primeira no `on conflict do nothing`, não recebe
 * linha e devolve a mensagem e o turno da vencedora — sem erro de banco. Pegar a violação do índice não serviria: no
 * Postgres ela aborta a transação inteira. Linhas commitadas; limpeza própria por pessoa (uuid deste arquivo).
 */
const PESSOA = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const criados = { agentes: [] as string[], conversas: [] as string[] };

async function escopado<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, PESSOA);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}

async function conversaCommitada(): Promise<string> {
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  await escopado(async (trx) => {
    const repos = criarRepos(trx, PESSOA);
    await repos.agentes.criar({ id: agenteId, nome: "Idempotente", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
  });
  criados.agentes.push(agenteId);
  criados.conversas.push(conversaId);
  return conversaId;
}

afterEach(async () => {
  await escopado(async (trx) => {
    await trx`set local lock_timeout = '2s'`;
    const p = PESSOA.pessoaId;
    await trx`delete from mensagens where owner_id = ${p}`;
    await trx`delete from paradas where owner_id = ${p}`;
    await trx`delete from turnos where owner_id = ${p}`;
    // ADR-083 (0060): o trabalho aponta para agente, conversa e rotina, e os turnos apontam para ele — sai entre os dois.
    await trx`delete from trabalhos where owner_id = ${p}`;
    if (criados.conversas.length) await trx`delete from conversas where id in ${trx(criados.conversas)}`;
    if (criados.agentes.length) await trx`delete from agentes where id in ${trx(criados.agentes)}`;
    await trx`delete from events_outbox where owner_id = ${p}`;
    await trx`delete from events where owner_id = ${p}`;
  });
  criados.agentes.length = criados.conversas.length = 0;
});

describeIntegracao("concorrência: envio idempotente entre duas transações (NOD-156)", () => {
  it("Promise.all com a mesma chave → 1 mensagem, 1 turno, as duas devolvem os mesmos ids e nenhuma rejeita", async () => {
    const conversaId = await conversaCommitada();
    const idEnvio = randomUUID();
    const enviar = () =>
      escopado(async (trx) => {
        const r = await executar(depsSobreTrx(trx, PESSOA), enviarMensagem, { conversaId, texto: "oi", idEnvio, inventario: PRONTO });
        return { mensagem: r.data.mensagem.id, turno: r.data.turno.id, eventos: r.events.length };
      });

    const resultados = await Promise.allSettled([enviar(), enviar()]);
    expect(resultados.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const [a, b] = resultados.map((r) => (r.status === "fulfilled" ? r.value : null));
    expect(b?.mensagem).toBe(a?.mensagem);
    expect(b?.turno).toBe(a?.turno);
    // Só a vencedora emite eventos.
    expect([a?.eventos, b?.eventos].filter((n) => (n ?? 0) > 0)).toHaveLength(1);

    const contagem = await escopado(async (trx) => {
      const [m] = await trx<{ n: number }[]>`select count(*)::int as n from mensagens where conversa_id = ${conversaId} and autor_tipo = 'pessoa'`;
      const [t] = await trx<{ n: number }[]>`select count(*)::int as n from turnos where conversa_id = ${conversaId}`;
      return { mensagens: m?.n, turnos: t?.n };
    });
    expect(contagem).toEqual({ mensagens: 1, turnos: 1 });
  });

  it("a segunda transação chega com a primeira ainda aberta: espera o commit e devolve a da vencedora", async () => {
    const conversaId = await conversaCommitada();
    const idEnvio = randomUUID();
    let primeiraInseriu = () => undefined as void;
    const inseriu = new Promise<void>((r) => {
      primeiraInseriu = r;
    });
    let liberar = () => undefined as void;
    const podeCommitar = new Promise<void>((r) => {
      liberar = r;
    });

    const primeira = escopado(async (trx) => {
      const r = await executar(depsSobreTrx(trx, PESSOA), enviarMensagem, { conversaId, texto: "oi", idEnvio, inventario: PRONTO });
      primeiraInseriu();
      await podeCommitar; // segura a tx aberta enquanto a segunda tenta
      return r.data;
    });
    await inseriu;
    const segunda = escopado(async (trx) => (await executar(depsSobreTrx(trx, PESSOA), enviarMensagem, { conversaId, texto: "oi", idEnvio, inventario: PRONTO })).data);
    const apressada = await Promise.race([segunda.then(() => "resolveu"), new Promise<string>((r) => setTimeout(() => r("esperando"), 100))]);
    expect(apressada).toBe("esperando");
    liberar();
    const [p, s] = await Promise.all([primeira, segunda]);
    expect(s.mensagem.id).toBe(p.mensagem.id);
    expect(s.turno.id).toBe(p.turno.id);
  });
});
