import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { autorizarChaveMaquina } from "../../src/adapters/http/autorizar-chave-maquina.ts";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { desafioDe } from "../../src/services/pareamento-maquina.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * Pareamento do Mac pelo navegador (ADR-069) sobre o app composto em porta 0. Mora em
 * tests/concurrency porque COMMITA: a troca emite a chave de verdade, e a validação dela abre a
 * própria transação escopada. Pessoa aleatória por execução; ao fim, apaga as próprias chaves.
 */
describeIntegracao("pareamento do Mac: abrir com sessão, trocar só com o verificador, chave que valida (HTTP real, commita)", () => {
  let app: App;
  let srv: ServidorDeTeste;
  const SEGREDO = "segredo-de-teste";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const sessao = { cookie: `nod_sessao=${cunharCookie(dona, SEGREDO)}`, tenantId: dona.tenantId };

  beforeAll(async () => {
    app = comporApp({ db, env: { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "4" }, listarPessoas: async () => [] });
    srv = await servidorDeTeste(app.rotas, { segredoSessao: SEGREDO });
  });

  afterAll(async () => {
    await abrirTxEscopada(db, dona)((trx) => trx`delete from maquina_tokens where owner_id = ${dona.pessoaId}`);
    await srv?.close();
    await app?.fechar();
  });

  const trocar = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
    fetch(`${srv.url}/api/pareamento/trocar`, { method: "POST", headers: { "content-type": "application/json", ...cabecalhos }, body: JSON.stringify(corpo) });

  async function abrir(verificador: string): Promise<string> {
    const r = await srv.chamar(sessao, "POST", "maquinas/pareamentos", { nome: "MacBook de casa", desafio: desafioDe(verificador) });
    expect(r.status).toBe(201);
    return ((await r.json()) as { codigo: string }).codigo;
  }

  it("a troca devolve uma chave que valida no escopo da pessoa e aparece em Minhas chaves com o nome do Mac", async () => {
    const verificador = randomBytes(32).toString("base64url");
    const codigo = await abrir(verificador);
    const r = await trocar({ codigo, verificador });
    expect(r.status).toBe(201);
    const { chave } = (await r.json()) as { chave: string };
    expect(await autorizarChaveMaquina(db, chave, Date.now())).toMatchObject(dona);
    const lista = (await (await srv.chamar(sessao, "GET", "maquinas/chaves")).json()) as { chaves: { nome: string }[] };
    expect(lista.chaves.map((c) => c.nome)).toContain("MacBook de casa");
    // O código é de uso único.
    expect((await trocar({ codigo, verificador })).status).toBe(400);
  });

  it("verificador errado não emite chave e queima o código", async () => {
    const verificador = randomBytes(32).toString("base64url");
    const codigo = await abrir(verificador);
    expect((await trocar({ codigo, verificador: randomBytes(32).toString("base64url") })).status).toBe(400);
    expect((await trocar({ codigo, verificador })).status).toBe(400);
  });

  it("navegador não troca: com Origin a resposta é 403 antes de olhar o corpo, e o código continua valendo", async () => {
    const verificador = randomBytes(32).toString("base64url");
    const codigo = await abrir(verificador);
    expect((await trocar({ codigo, verificador }, { origin: "https://site-qualquer.example" })).status).toBe(403);
    expect((await trocar({ codigo, verificador })).status).toBe(201);
  });

  it("abrir exige sessão e recusa desafio ou nome fora do formato", async () => {
    const semSessao = await fetch(`${srv.url}/api/t/${dona.tenantId}/maquinas/pareamentos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome: "Mac", desafio: desafioDe("x".repeat(43)) }) });
    expect(semSessao.status).toBe(401);
    expect((await srv.chamar(sessao, "POST", "maquinas/pareamentos", { nome: "Mac", desafio: "curto" })).status).toBe(400);
    expect((await srv.chamar(sessao, "POST", "maquinas/pareamentos", { nome: "", desafio: desafioDe("x".repeat(43)) })).status).toBe(400);
  });
});
