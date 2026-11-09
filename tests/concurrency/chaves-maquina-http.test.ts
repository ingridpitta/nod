import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { autorizarChaveMaquina } from "../../src/adapters/http/autorizar-chave-maquina.ts";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import type { ChaveEmitidaDto, ChaveMaquinaDto } from "../../src/contracts/api.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";

/**
 * Chaves de máquina de ponta a ponta (E1.3, ADR-031) pelo app composto em porta 0. Mora em
 * tests/concurrency porque COMMITA: a validação (`autorizarChaveMaquina`) abre a PRÓPRIA transação
 * escopada, como fará em produção, então a linha precisa existir de verdade. Pessoas aleatórias por
 * execução; ao fim, cada pessoa apaga as próprias linhas por id.
 */
describeIntegracao("chaves de máquina: emitir, listar, validar, revogar (HTTP real, commita)", () => {
  let app: App;
  let srv: ServidorDeTeste;
  const SEGREDO = "segredo-de-teste";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const sessao = (e: typeof dona) => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO)}`, tenantId: e.tenantId });
  const criadas: { escopo: typeof dona; id: string }[] = [];

  beforeAll(async () => {
    app = comporApp({ db, env: { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "4" }, listarPessoas: async () => [] });
    srv = await servidorDeTeste(app.rotas, { segredoSessao: SEGREDO });
  });

  afterAll(async () => {
    for (const c of criadas) await abrirTxEscopada(db, c.escopo)((trx) => trx`delete from maquina_tokens where id = ${c.id}`);
    await srv?.close();
    await app?.fechar();
  });

  async function emitir(e: typeof dona, nome: string): Promise<ChaveEmitidaDto> {
    const r = await srv.chamar(sessao(e), "POST", "maquinas/chaves", { nome });
    expect(r.status).toBe(201);
    const corpo = (await r.json()) as ChaveEmitidaDto;
    criadas.push({ escopo: e, id: corpo.dados.id });
    return corpo;
  }

  it("a chave crua aparece só na emissão; a lista nunca a traz; ela valida e marca o último uso", async () => {
    const saida = vi.spyOn(console, "log");
    try {
      const { chave, dados } = await emitir(dona, "MacBook do trabalho");
      const outraChave = await emitir(dona, "Linux de casa");
      expect(outraChave.chave).not.toBe(chave);

      const lista = await srv.chamar(sessao(dona), "GET", "maquinas/chaves");
      const textoLista = await lista.text();
      expect(textoLista).not.toContain(chave);
      expect(textoLista).not.toContain(chave.split(".")[1]);
      expect(textoLista).not.toContain("hash");
      const { chaves } = JSON.parse(textoLista) as { chaves: ChaveMaquinaDto[] };
      expect(chaves.map((c) => c.nome).sort()).toEqual(["Linux de casa", "MacBook do trabalho"]);

      const agora = Date.now();
      expect(await autorizarChaveMaquina(db, chave, agora)).toEqual({ ...dona, chaveId: dados.id });
      const depois = (await (await srv.chamar(sessao(dona), "GET", "maquinas/chaves")).json()) as { chaves: ChaveMaquinaDto[] };
      expect(depois.chaves.find((c) => c.id === dados.id)?.ultimoUsoEm).toBe(agora);

      // Só é prova forte porque src/obs/log.ts é o ÚNICO console do processo (no-console sem exceção,
      // provado em tests/conformidade/fronteiras.test.ts): nada mais pode ter escrito a chave em outro canal.
      const log = saida.mock.calls.map((c) => String(c[0])).join("\n");
      expect(log).not.toContain(chave);
      expect(log).not.toContain(dados.prefixo);
    } finally {
      saida.mockRestore();
    }
  });

  it("chave adulterada, reapontada para outra pessoa, de outra pessoa na rota errada ou lixo não valida", async () => {
    const { chave } = await emitir(dona, "adulterar");
    const [alegado, segredo] = chave.split(".");
    const ultimo = segredo?.at(-1) === "A" ? "B" : "A";
    expect(await autorizarChaveMaquina(db, `${alegado}.${segredo?.slice(0, -1)}${ultimo}`, Date.now())).toBeNull();
    const paraOutra = Buffer.from(JSON.stringify({ t: outra.tenantId, p: outra.pessoaId })).toString("base64url");
    expect(await autorizarChaveMaquina(db, `${paraOutra}.${segredo}`, Date.now())).toBeNull();
    for (const lixo of [undefined, "", "a.b", `${alegado}`, 123]) expect(await autorizarChaveMaquina(db, lixo, Date.now())).toBeNull();
  });

  it("revogar derruba a chave na hora; outra pessoa não revoga nem vê; revogar de novo é idempotente", async () => {
    const { chave, dados } = await emitir(dona, "notebook roubado");
    expect(await autorizarChaveMaquina(db, chave, Date.now())).not.toBeNull();

    expect((await srv.chamar(sessao(outra), "DELETE", `maquinas/chaves/${dados.id}`)).status).toBe(404);
    expect(await autorizarChaveMaquina(db, chave, Date.now())).not.toBeNull();
    const daOutra = (await (await srv.chamar(sessao(outra), "GET", "maquinas/chaves")).json()) as { chaves: ChaveMaquinaDto[] };
    expect(daOutra.chaves).toEqual([]);

    const r = await srv.chamar(sessao(dona), "DELETE", `maquinas/chaves/${dados.id}`);
    expect(r.status).toBe(200);
    expect(await autorizarChaveMaquina(db, chave, Date.now())).toBeNull();
    expect((await srv.chamar(sessao(dona), "DELETE", `maquinas/chaves/${dados.id}`)).status).toBe(200);
    expect((await srv.chamar(sessao(dona), "DELETE", "maquinas/chaves/nao-e-uuid")).status).toBe(404);
  });

  it("nome inválido é 400 e não grava; sem sessão é 401", async () => {
    const r = await srv.chamar(sessao(dona), "POST", "maquinas/chaves", { nome: "   " });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ codigo: "entrada_invalida", mensagem: "Algum dado do pedido não está certo. Confira e tente de novo." });
    expect((await fetch(`${srv.url}/api/t/${TENANT_PADRAO}/maquinas/chaves`)).status).toBe(401);
  });
});
