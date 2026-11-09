import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { db } from "../helpers/db.ts";
import { depsSobreTrx, executar, servicosDeTeste } from "../helpers/deps-l6.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";

/**
 * NOD-293 PR5 (E9, QA): a 0097 no Postgres real. O teste da rota usa repos em memória; aqui a trava (advisory lock por
 * turno+chave), a RLS, o rollback junto do efeito e a poda rodam contra o banco de verdade.
 */
const A: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const B: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
const PRONTO = { estado: "pronto" as const, versao: "catcher", em: Date.now() };
const criados: { e: Escopo; agentes: string[]; conversas: string[] }[] = [];

async function escopado<T>(e: Escopo, fn: (trx: Tx) => Promise<T>): Promise<T> {
  const caixa: { valor?: T } = {};
  await db.begin(async (trx) => {
    await vincularEscopo(trx, e);
    caixa.valor = await fn(trx);
  });
  return caixa.valor as T;
}
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function turnoDe(e: Escopo): Promise<string> {
  const services = servicosDeTeste((t) => criarRepos(t, e), e);
  return escopado(e, async (trx) => {
    const deps = depsSobreTrx(trx, e, { services });
    const c = (await executar(deps, criarAgente, { dono: "pessoa", nome: "QA" })).data;
    criados.push({ e, agentes: [c.agente.id], conversas: [c.conversa.id] });
    return (await executar(deps, enviarMensagem, { conversaId: c.conversa.id, texto: "x", inventario: PRONTO, executor: "catcher" })).data.turno.id;
  });
}

afterAll(async () => {
  for (const c of criados) await escopado(c.e, (trx) => trx`delete from nativas_idempotencia where owner_id = ${c.e.pessoaId}`);
  for (const c of criados) {
    await escopado(c.e, async (trx) => {
      const p = c.e.pessoaId;
      await trx`delete from nativas_idempotencia where owner_id = ${p}`;
      for (const t of ["turno_raio_x", "esperas", "turno_entregas", "gastos", "catcher_registros", "decisoes", "mensagens", "turnos", "trabalhos", "events_outbox", "events"]) await trx`delete from ${trx(t)} where owner_id = ${p}`;
      await trx`delete from conversas where id in ${trx(c.conversas)}`;
      await trx`delete from agentes where id in ${trx(c.agentes)}`;
    });
  }
});

/** O que a rota faz: travar → (efeito) → registrar, na mesma transação. Conta quantos "efeitos" rodaram. */
async function tentativa(e: Escopo, turnoId: string, chave: string, efeitos: { n: number }, pausaMs: number) {
  return escopado(e, async (trx) => {
    const r = criarRepos(trx, e).nativasIdempotencia;
    const anterior = await r.travar(turnoId, chave);
    if (anterior) return { de: "guardada", resposta: anterior };
    efeitos.n += 1;
    await dormir(pausaMs);
    await r.registrar(turnoId, chave, { ok: true });
    return { de: "nova", resposta: { ok: true } };
  });
}

describeIntegracao("NOD-293 E9: a idempotência das nativas (0097) no Postgres", () => {
  it("duas tentativas concorrentes com a mesma chave: um efeito só, sem 23505", async () => {
    const turnoId = await turnoDe(A);
    const chave = randomUUID();
    const efeitos = { n: 0 };
    const rs = await Promise.allSettled([tentativa(A, turnoId, chave, efeitos, 300), tentativa(A, turnoId, chave, efeitos, 300), tentativa(A, turnoId, chave, efeitos, 300)]);
    expect(rs.every((r) => r.status === "fulfilled")).toBe(true);
    expect(efeitos.n).toBe(1);
    expect(rs.map((r) => (r.status === "fulfilled" ? r.value.de : "")).sort()).toEqual(["guardada", "guardada", "nova"]);
  });

  it("a chave da pessoa A não aparece para B (RLS) e a mesma chave não colide entre pessoas", async () => {
    const ta = await turnoDe(A);
    const tb = await turnoDe(B);
    const chave = randomUUID();
    await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.registrar(ta, chave, { aguardar: "d-a" }));
    expect(await escopado(B, (trx) => criarRepos(trx, B).nativasIdempotencia.travar(ta, chave))).toBeNull();
    await escopado(B, (trx) => criarRepos(trx, B).nativasIdempotencia.registrar(tb, chave, { ok: true }));
    expect(await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.travar(ta, chave))).toEqual({ aguardar: "d-a" });
    expect(await escopado(B, (trx) => criarRepos(trx, B).nativasIdempotencia.travar(tb, chave))).toEqual({ ok: true });
    // B tentando ler/escrever como A no SQL cru: a RLS barra.
    const cru = await escopado(B, (trx) => trx`insert into nativas_idempotencia (tenant_id, owner_id, turno_id, chave, resposta) values (${A.tenantId}, ${A.pessoaId}, ${ta}, ${randomUUID()}, '{}'::jsonb)`).then(() => "aceitou", (e: { code?: string }) => `recusou ${e.code}`);
    expect(cru).not.toBe("aceitou");
  });

  it("rollback do efeito leva a chave junto (mesma transação)", async () => {
    const turnoId = await turnoDe(A);
    const chave = randomUUID();
    await expect(escopado(A, async (trx) => {
      await criarRepos(trx, A).nativasIdempotencia.registrar(turnoId, chave, { ok: true });
      throw new Error("efeito falhou depois");
    })).rejects.toThrow("efeito falhou depois");
    expect(await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.travar(turnoId, chave))).toBeNull();
  });

  it("podar: apaga só o que passou do corte e só da própria pessoa", async () => {
    const A: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const B: Escopo = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
    const ta = await turnoDe(A);
    const tb = await turnoDe(B);
    await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.registrar(ta, randomUUID(), { ok: true }));
    await escopado(B, (trx) => criarRepos(trx, B).nativasIdempotencia.registrar(tb, randomUUID(), { ok: true }));
    expect(await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.podar(Date.now() - 24 * 60 * 60_000))).toBe(0);
    expect(await escopado(A, (trx) => criarRepos(trx, A).nativasIdempotencia.podar(Date.now() + 1_000))).toBe(1);
    const restoB = await escopado(B, async (trx) => (await trx<{ n: number }[]>`select count(*)::int as n from nativas_idempotencia where owner_id = ${B.pessoaId}`)[0]?.n);
    expect(restoB).toBe(1);
  });
});
