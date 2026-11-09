import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { ContaNuvemFalsa } from "../../src/adapters/nuvem/falso.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { ContaNuvemDto } from "../../src/contracts/provedor-nuvem.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * ADR-121 (NOD-92): as rotas da nuvem pelo app composto (commita, como chaves-maquina-http). O Google é a conta falsa e
 * um fetch falso na troca do code; a credencial cifrada e a VM conectada são linhas de verdade.
 */
const SEGREDO = "segredo-de-teste";
const ENV = { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "5" };
const OAUTH = { NOD_GOOGLE_CLIENT_ID: "cliente", NOD_GOOGLE_CLIENT_SECRET: "segredo-cliente", NOD_NUVEM_REDIRECT_URI: "http://127.0.0.1/api/nuvem/google/callback" };

describeIntegracao("nuvem: OAuth, conectar, dormir e acordar (HTTP real, commita)", () => {
  let app: App;
  let srv: ServidorDeTeste;
  let semFlag: App;
  let srvSemFlag: ServidorDeTeste;
  const conta = new ContaNuvemFalsa();
  const trocas: URLSearchParams[] = [];
  const fetchFalso = (async (_url: string | URL | Request, init?: RequestInit) => {
    trocas.push(new URLSearchParams(String(init?.body)));
    return new Response(JSON.stringify({ access_token: "token-do-google", expires_in: 3600 }), { status: 200 });
  }) as typeof fetch;
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const sessao = (e: typeof dona) => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO)}`, tenantId: e.tenantId });
  const chaves: { escopo: typeof dona; id: string }[] = [];

  beforeAll(async () => {
    app = comporApp({ db, env: { ...ENV, ...OAUTH, NOD_MAQUINA_NUVEM: "gcp" }, listarPessoas: async () => [], nuvem: { conta, fetchImpl: fetchFalso } });
    srv = await servidorDeTeste(app.rotas, { segredoSessao: SEGREDO });
    semFlag = comporApp({ db, env: { ...ENV, ...OAUTH }, listarPessoas: async () => [] });
    srvSemFlag = await servidorDeTeste(semFlag.rotas, { segredoSessao: SEGREDO });
  });

  afterAll(async () => {
    for (const e of [dona, outra]) {
      await abrirTxEscopada(db, e)(async (trx) => {
        await trx`delete from maquinas_nuvem where owner_id = ${e.pessoaId}`;
        await trx`delete from credenciais_nuvem where owner_id = ${e.pessoaId}`;
      });
    }
    for (const c of chaves) await abrirTxEscopada(db, c.escopo)((trx) => trx`delete from maquina_tokens where id = ${c.id}`);
    await srv?.close();
    await srvSemFlag?.close();
    await app?.fechar();
    await semFlag?.fechar();
  });

  async function emitir(e: typeof dona, nome: string): Promise<string> {
    const r = await srv.chamar(sessao(e), "POST", "maquinas/chaves", { nome });
    expect(r.status).toBe(201);
    const id = ((await r.json()) as { dados: { id: string } }).dados.id;
    chaves.push({ escopo: e, id });
    return id;
  }

  /** Inicia o OAuth e volta pelo callback como o navegador voltaria do Google. */
  async function oauth(e: typeof dona, corpo: unknown): Promise<Response> {
    const r = await srv.chamar(sessao(e), "POST", "nuvem/google", corpo);
    expect(r.status).toBe(200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
    const url = new URL(((await r.json()) as { url: string }).url);
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/cloud-platform");
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH.NOD_NUVEM_REDIRECT_URI);
    return fetch(`${srv.url}/api/nuvem/google/callback?code=abc&state=${encodeURIComponent(url.searchParams.get("state")!)}`, { headers: { cookie }, redirect: "manual" });
  }

  const maquinas = async (s: ServidorDeTeste, e: typeof dona) => ((await (await s.chamar(sessao(e), "GET", "maquinas")).json()) as { maquinas: MaquinaDto[] }).maquinas;

  it("sem a flag: as rotas não existem e o GET /maquinas sai sem `nuvem`", async () => {
    await emitir(dona, "vm-sem-flag");
    expect((await srvSemFlag.chamar(sessao(dona), "POST", "nuvem/google", { para: "preparar" })).status).toBe(404);
    expect((await srvSemFlag.chamar(sessao(dona), "GET", "nuvem/conta")).status).toBe(404);
    expect((await fetch(`${srvSemFlag.url}/api/nuvem/google/callback?code=x&state=y`, { redirect: "manual" })).status).toBe(404);
    for (const m of await maquinas(srvSemFlag, dona)) expect("nuvem" in m).toBe(false);
  });

  it("conectar: OAuth com PKCE → credencial cifrada, papel de ligar e a VM ligada à chave; dormir, acordar e Dormir após", async () => {
    const vm = await emitir(dona, "vm-sp");
    const volta = await oauth(dona, { para: "conectar", maquinaId: vm, projeto: "meu-projeto-1", zona: "southamerica-east1-a", nome: "minha-vm" });
    expect(volta.status).toBe(302);
    expect(volta.headers.get("location")).toBe("/maquinas?nuvem=preparando");
    expect(trocas.at(-1)?.get("code_verifier")).toMatch(/^[\w-]{43}$/);

    await vi.waitFor(async () => {
      const c = (await (await srv.chamar(sessao(dona), "GET", "nuvem/conta")).json()) as ContaNuvemDto;
      expect(c).toMatchObject({ conectada: true, projeto: "meu-projeto-1", preparando: false, motivo: null });
      expect((await maquinas(srv, dona)).find((m) => m.id === vm)?.nuvem).toBeDefined();
    });
    expect(conta.autorizadas).toContainEqual({ projeto: "meu-projeto-1", zona: "southamerica-east1-a", nome: "minha-vm" });
    const cifrada = await abrirTxEscopada(db, dona)((trx) => trx<{ chave_cifrada: string }[]>`select chave_cifrada from credenciais_nuvem where owner_id = ${dona.pessoaId}`);
    expect(cifrada[0]?.chave_cifrada).not.toContain("service_account");

    const dto = (await maquinas(srv, dona)).find((m) => m.id === vm)!;
    expect(dto.nuvem).toMatchObject({ provedor: "gcp", estado: "acordada", criadaPeloNod: false, zona: "southamerica-east1-a", dormirAposMin: 30 });

    expect((await srv.chamar(sessao(dona), "PUT", `nuvem/maquinas/${vm}/dormir-apos`, { minutos: 60 })).status).toBe(200);
    expect((await srv.chamar(sessao(dona), "PUT", `nuvem/maquinas/${vm}/dormir-apos`, { minutos: 7 })).status).toBe(400);
    expect((await srv.chamar(sessao(dona), "POST", `nuvem/maquinas/${vm}/dormir`)).status).toBe(200);
    expect((await maquinas(srv, dona)).find((m) => m.id === vm)?.nuvem).toMatchObject({ estado: "dormindo", dormirAposMin: 60 });
    expect((await srv.chamar(sessao(dona), "POST", `nuvem/maquinas/${vm}/acordar`)).status).toBe(200);

    // A VM da nuvem não perde a chave pelo "Remover" comum.
    expect((await srv.chamar(sessao(dona), "DELETE", `maquinas/chaves/${vm}`)).status).toBe(409);
    // Conectar de novo a mesma máquina: 409.
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/google", { para: "conectar", maquinaId: vm, projeto: "meu-projeto-1", zona: "southamerica-east1-a", nome: "minha-vm" })).status).toBe(409);

    // Outra pessoa não alcança a máquina (RLS + escopo): 404, e a lista dela não a traz.
    expect((await srv.chamar(sessao(outra), "POST", `nuvem/maquinas/${vm}/dormir`)).status).toBe(404);
    expect((await maquinas(srv, outra)).some((m) => m.id === vm)).toBe(false);
    expect(((await (await srv.chamar(sessao(outra), "GET", "nuvem/conta")).json()) as ContaNuvemDto).conectada).toBe(false);
  });

  it("B2: Reconectar grava a chave nova e apaga a velha no Google (só fica a gravada)", async () => {
    const antes = conta.preparos;
    expect((await oauth(dona, { para: "preparar" })).status).toBe(302);
    await vi.waitFor(() => expect(conta.preparos).toBe(antes + 1));
    await vi.waitFor(async () => expect(((await (await srv.chamar(sessao(dona), "GET", "nuvem/conta")).json()) as ContaNuvemDto).preparando).toBe(false));
    const gravada = async () => (await abrirTxEscopada(db, dona)((trx) => trx<{ chave_nome: string }[]>`select chave_nome from credenciais_nuvem where owner_id = ${dona.pessoaId}`))[0]?.chave_nome;
    await vi.waitFor(async () => expect(conta.chaves.filter((c) => c.startsWith("projects/meu-projeto-1/"))).toEqual([await gravada()]));
    const primeira = await gravada();
    expect((await oauth(dona, { para: "preparar" })).status).toBe(302);
    await vi.waitFor(async () => {
      const agora = await gravada();
      expect(agora).not.toBe(primeira);
      expect(conta.chaves.filter((c) => c.startsWith("projects/meu-projeto-1/"))).toEqual([agora]);
    });
  });

  it("callback sem o cookie, com state adulterado ou cancelado volta recusado e não troca o code", async () => {
    const antes = trocas.length;
    const r = await srv.chamar(sessao(dona), "POST", "nuvem/google", { para: "preparar" });
    const state = new URL(((await r.json()) as { url: string }).url).searchParams.get("state")!;
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
    const cb = (q: string, c?: string) => fetch(`${srv.url}/api/nuvem/google/callback?${q}`, { headers: c ? { cookie: c } : {}, redirect: "manual" });
    for (const v of [await cb(`code=a&state=${encodeURIComponent(state)}`), await cb(`code=a&state=${encodeURIComponent(state + "x")}`, cookie), await cb(`error=access_denied&state=${encodeURIComponent(state)}`, cookie)]) {
      expect(v.status).toBe(302);
      expect(v.headers.get("location")).toBe("/maquinas?nuvem=recusado");
    }
    expect(trocas.length).toBe(antes);
  });

  it("entrada inválida no conectar é 400; máquina de outra pessoa é 404", async () => {
    const vm = await emitir(dona, "vm-x");
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/google", { para: "conectar", maquinaId: vm, projeto: "X", zona: "sp", nome: "Minha VM" })).status).toBe(400);
    expect((await srv.chamar(sessao(outra), "POST", "nuvem/google", { para: "conectar", maquinaId: vm, projeto: "meu-projeto-1", zona: "southamerica-east1-a", nome: "vm" })).status).toBe(404);
  });

  it("o preparo que falha aparece na conta com o motivo fechado", async () => {
    conta.erroNoPreparo = { motivo: "cota_ou_cobranca", detalhe: "sem_faturamento" };
    try {
      expect((await oauth(outra, { para: "preparar" })).headers.get("location")).toBe("/maquinas?nuvem=preparando");
      await vi.waitFor(async () => {
        const c = (await (await srv.chamar(sessao(outra), "GET", "nuvem/conta")).json()) as ContaNuvemDto;
        expect(c).toMatchObject({ conectada: false, preparando: false, motivo: "cota_ou_cobranca", detalhe: "sem_faturamento" });
      });
    } finally {
      conta.erroNoPreparo = null;
    }
  });
});
