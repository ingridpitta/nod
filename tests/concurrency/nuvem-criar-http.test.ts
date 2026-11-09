import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { reconciliarPessoa } from "../../src/adapters/fundo/reconciliador-nuvem.ts";
import { ContaNuvemFalsa, ProvedorNuvemFalso } from "../../src/adapters/nuvem/falso.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { ContaNuvemDto, MaquinaCriandoDto } from "../../src/contracts/provedor-nuvem.ts";
import { chaveDe, decifrar } from "../../src/db/cifra.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { Escopo, Transacao } from "../../src/shared/types.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * ADR-121 (NOD-92, PR 2): criar a VM pelo app composto (commita). O Google é a conta e o provedor falsos; o reconciliador
 * roda à mão, com o mesmo provedor. O motor da VM é simulado pelas rotas públicas do pareamento de dispositivo.
 */
const SEGREDO = "segredo-de-teste";
const ENV = { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "7", NOD_URL_PUBLICA: "https://nod.exemplo.com.br" };
const OAUTH = { NOD_GOOGLE_CLIENT_ID: "cliente", NOD_GOOGLE_CLIENT_SECRET: "segredo-cliente", NOD_NUVEM_REDIRECT_URI: "http://127.0.0.1/api/nuvem/google/callback" };
const CHAVE = chaveDe(ENV.NOD_CREDENTIAL_KEY);

describeIntegracao("nuvem: criar a VM e excluir (HTTP real, commita)", () => {
  let app: App;
  let srv: ServidorDeTeste;
  let semUrl: App;
  let srvSemUrl: ServidorDeTeste;
  const conta = new ContaNuvemFalsa();
  const provedor = new ProvedorNuvemFalso();
  const fetchFalso = (async () => new Response(JSON.stringify({ access_token: "token-do-google" }), { status: 200 })) as unknown as typeof fetch;
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const terceira = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const sessao = (e: Escopo) => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO)}`, tenantId: e.tenantId });
  const publica = (caminho: string, corpo: unknown) =>
    fetch(`${srv.url}/api/${caminho}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const txDe = (e: Escopo): Transacao => (fn) => abrirTxEscopada(db, e)(fn);
  // O registrarConvite do reconciliador manual não alcança o pareamento de dentro do app: a rota já o registrou ao pedir.
  const volta = (e: Escopo, agora: number) =>
    reconciliarPessoa({ provedorDa: async () => provedor, agora: () => agora, criacao: { servidor: ENV.NOD_URL_PUBLICA, decifrar: (s) => decifrar(s, CHAVE), registrarConvite: () => undefined } }, e, txDe(e));
  const contaDe = async (e: Escopo) => (await (await srv.chamar(sessao(e), "GET", "nuvem/conta")).json()) as ContaNuvemDto;
  const maquinas = async (e: Escopo) => ((await (await srv.chamar(sessao(e), "GET", "maquinas")).json()) as { maquinas: MaquinaDto[] }).maquinas;

  beforeAll(async () => {
    app = comporApp({ db, env: { ...ENV, ...OAUTH, NOD_MAQUINA_NUVEM: "gcp" }, listarPessoas: async () => [], nuvem: { conta, fetchImpl: fetchFalso, provedor } });
    srv = await servidorDeTeste(app.rotas, { segredoSessao: SEGREDO });
    const { NOD_URL_PUBLICA: _, ...envSemUrl } = ENV;
    semUrl = comporApp({ db, env: { ...envSemUrl, ...OAUTH, NOD_MAQUINA_NUVEM: "gcp" }, listarPessoas: async () => [], nuvem: { conta, fetchImpl: fetchFalso, provedor } });
    srvSemUrl = await servidorDeTeste(semUrl.rotas, { segredoSessao: SEGREDO });
  });

  afterAll(async () => {
    for (const e of [dona, outra, terceira]) {
      await abrirTxEscopada(db, e)(async (trx) => {
        await trx`delete from maquinas_nuvem where owner_id = ${e.pessoaId}`;
        await trx`delete from credenciais_nuvem where owner_id = ${e.pessoaId}`;
        await trx`delete from maquina_tokens where owner_id = ${e.pessoaId}`;
      });
    }
    await srv?.close();
    await srvSemUrl?.close();
    await app?.fechar();
    await semUrl?.fechar();
  });

  /** Inicia o OAuth e volta pelo callback como o navegador voltaria do Google. */
  async function oauth(e: Escopo, corpo: unknown): Promise<Response> {
    const r = await srv.chamar(sessao(e), "POST", "nuvem/google", corpo);
    expect(r.status).toBe(200);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
    const state = new URL(((await r.json()) as { url: string }).url).searchParams.get("state")!;
    return fetch(`${srv.url}/api/nuvem/google/callback?code=abc&state=${encodeURIComponent(state)}`, { headers: { cookie }, redirect: "manual" });
  }

  /** O motor da VM: pede com o convite do script e o hostname; o pedido já nasce aprovado e a troca dá a chave. */
  async function motorPareia(nome: string, convite: string): Promise<Response> {
    const p = await publica("pareamento/dispositivo", { nome, plataforma: "linux", convite });
    expect(p.status).toBe(201);
    const { codigoDispositivo } = (await p.json()) as { codigoDispositivo: string };
    return publica("pareamento/dispositivo/trocar", { codigoDispositivo });
  }

  it("entrada inválida é 400; sem conta conectada é 409; sem NOD_URL_PUBLICA não cria", async () => {
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/maquinas", { regiao: "marte-1", tamanho: "padrao" })).status).toBe(400);
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "gigante" })).status).toBe(400);
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/google", { para: "criar", regiao: "marte-1", tamanho: "padrao" })).status).toBe(400);
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "padrao" })).status).toBe(409);
    expect((await srvSemUrl.chamar(sessao(dona), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "padrao" })).status).not.toBe(202);
  });

  it("Entrar com o Google + criar: intenção → o reconciliador cria uma vez → o motor pareia sem código → confirmada; excluir solta tudo", async () => {
    const volta302 = await oauth(dona, { para: "criar", regiao: "southamerica-east1", tamanho: "menor" });
    expect(volta302.headers.get("location")).toBe("/maquinas?nuvem=preparando");

    let criando!: MaquinaCriandoDto;
    await vi.waitFor(async () => {
      const c = await contaDe(dona);
      expect(c.conectada).toBe(true);
      expect(c.criando).toHaveLength(1);
      criando = c.criando![0]!;
    });
    expect(criando).toMatchObject({ estado: "criando", zona: "southamerica-east1-a", tamanho: "menor", motivo: null });
    expect(criando.nome).toMatch(/^nod-g-[0-9a-f]{6}$/);
    // Clique duplo não cria a segunda VM.
    expect((await srv.chamar(sessao(dona), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "padrao" })).status).toBe(409);
    // O convite fica cifrado no banco.
    const [linha] = await abrirTxEscopada(db, dona)((trx) => trx<{ convite_cifrado: string; request_id: string }[]>`select convite_cifrado, request_id from maquinas_nuvem where id = ${criando.id}`);
    const convite = decifrar(linha!.convite_cifrado, CHAVE);
    expect(linha!.convite_cifrado).not.toContain(convite);

    // O reconciliador cria uma vez, com o request_id fixo, sub-rede da região e o script com o convite.
    const t0 = Date.now();
    await volta(dona, t0);
    await volta(dona, t0 + 15_000);
    expect(provedor.criadas).toHaveLength(1);
    const req = provedor.criadas[0]!;
    expect(req).toMatchObject({ nome: criando.nome, zona: "southamerica-east1-a", tamanho: "menor" });
    expect(req.subrede).toMatch(/\/regions\/southamerica-east1\/subnetworks\/nod-maquinas$/);
    expect(provedor.chamadas.filter((c) => c.op === "criar").every((c) => c.requestId === linha!.request_id)).toBe(true);
    expect(req.startupScript).toContain(`${ENV.NOD_URL_PUBLICA}/motor?convite=${convite}`);

    // O motor da VM pareia sem a tela de Confirmar. Um segundo resgate antes do contato revoga a primeira chave.
    const r1 = await motorPareia(`${criando.nome}.c.projeto.internal`, convite);
    expect(r1.status).toBe(201);
    const k1 = ((await r1.json()) as { machineId: string }).machineId;
    const r2 = await motorPareia(criando.nome, convite);
    expect(r2.status).toBe(201);
    const k2 = ((await r2.json()) as { machineId: string }).machineId;
    expect(k2).not.toBe(k1);
    const revogadas = await abrirTxEscopada(db, dona)((trx) => trx<{ id: string; revogado_em: Date | null }[]>`select id, revogado_em from maquina_tokens where id in (${k1}, ${k2})`);
    expect(revogadas.find((x) => x.id === k1)?.revogado_em).not.toBeNull();
    expect(revogadas.find((x) => x.id === k2)?.revogado_em).toBeNull();
    // Outro nome com o mesmo convite não é pré-aprovado.
    const intruso = await publica("pareamento/dispositivo", { nome: "outra-maquina", plataforma: "linux", convite });
    const troca = await publica("pareamento/dispositivo/trocar", { codigoDispositivo: ((await intruso.json()) as { codigoDispositivo: string }).codigoDispositivo });
    expect(troca.status).toBe(202);

    // O motor fala (primeiro uso da chave depois de ligar): a volta confirma, tira o convite da metadata e acorda.
    await abrirTxEscopada(db, dona)((trx) => trx`update maquina_tokens set ultimo_uso_em = ${new Date(t0 + 20_000)} where id = ${k2}`);
    await volta(dona, t0 + 30_000);
    expect(provedor.script(req)).not.toContain("convite");
    expect(provedor.script(req)).toContain("conexao.json");
    expect((await contaDe(dona)).criando).toEqual([]);
    const dto = (await maquinas(dona)).find((m) => m.id === k2);
    expect(dto?.nuvem).toMatchObject({ estado: "acordada", criadaPeloNod: true, zona: "southamerica-east1-a" });
    const [depois] = await abrirTxEscopada(db, dona)((trx) => trx<{ convite_cifrado: string | null }[]>`select convite_cifrado from maquinas_nuvem where id = ${criando.id}`);
    expect(depois?.convite_cifrado).toBeNull();

    // Depois de confirmada, o convite não pareia outra máquina: conflito à vista.
    expect((await motorPareia(criando.nome, convite)).status).toBe(409);

    // Outra pessoa não exclui (404); a dona exclui: o Google apaga, a chave cai e a linha vira `excluida`.
    expect((await srv.chamar(sessao(outra), "DELETE", `nuvem/maquinas/${k2}`)).status).toBe(404);
    expect((await srv.chamar(sessao(dona), "DELETE", `nuvem/maquinas/${k2}`)).status).toBe(200);
    expect(provedor.quantas("excluir")).toBe(1);
    expect(provedor.instancias.has(`${req.projeto}/${req.zona}/${req.nome}`)).toBe(false);
    const [fim] = await abrirTxEscopada(db, dona)((trx) => trx<{ estado: string; revogado_em: Date | null }[]>`
      select mn.estado, k.revogado_em from maquinas_nuvem mn join maquina_tokens k on k.id = mn.maquina_id where mn.id = ${criando.id}`);
    expect(fim).toMatchObject({ estado: "excluida" });
    expect(fim?.revogado_em).not.toBeNull();
    expect((await srv.chamar(sessao(dona), "DELETE", `nuvem/maquinas/${k2}`)).status).toBe(404);
  });

  it("a VM conectada (não criada pelo nod) não é excluída: 409", async () => {
    const vmDela = `vm-dela-${randomUUID().slice(0, 8)}`;
    const id = await abrirTxEscopada(db, outra)(async (trx) => {
      const [cred] = await trx<{ id: string }[]>`insert into credenciais_nuvem (tenant_id, owner_id, provedor, projeto, conta_servico, chave_cifrada)
        values (${outra.tenantId}, ${outra.pessoaId}, 'gcp', 'projeto-da-outra', 'sa@x', 'cifrada') returning id`;
      const [mn] = await trx<{ id: string }[]>`insert into maquinas_nuvem (tenant_id, owner_id, credencial_id, projeto, zona, nome_instancia)
        values (${outra.tenantId}, ${outra.pessoaId}, ${cred!.id}, 'projeto-da-outra', 'us-central1-a', ${vmDela}) returning id`;
      return mn!.id;
    });
    expect((await srv.chamar(sessao(outra), "DELETE", `nuvem/maquinas/${id}`)).status).toBe(409);
    expect(provedor.chamadas.some((c) => c.op === "excluir" && c.ref.nome === vmDela)).toBe(false);
  });
  it("B3: cinco POST juntos criam uma VM só (os outros 409); B4: DELETE durante a operação reservada é 409 e não chama o Google", async () => {
    await abrirTxEscopada(db, terceira)((trx) => trx`insert into credenciais_nuvem (tenant_id, owner_id, provedor, projeto, conta_servico, chave_cifrada)
      values (${terceira.tenantId}, ${terceira.pessoaId}, 'gcp', 'projeto-da-terceira', 'sa@x', 'cifrada')`);
    const r = await Promise.all(Array.from({ length: 5 }, () => srv.chamar(sessao(terceira), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "padrao" })));
    expect(r.map((x) => x.status).sort()).toEqual([202, 409, 409, 409, 409]);
    const linhas = await abrirTxEscopada(db, terceira)((trx) => trx<{ id: string; nome_instancia: string }[]>`select id, nome_instancia from maquinas_nuvem where owner_id = ${terceira.pessoaId} and estado = 'criando'`);
    expect(linhas).toHaveLength(1);
    const id = linhas[0]!.id;

    // O reconciliador está no meio de criar (reserva viva): o DELETE espera.
    await abrirTxEscopada(db, terceira)((trx) => trx`update maquinas_nuvem set operacao_id = ${randomUUID()}, ocupado_ate = now() + interval '2 minutes' where id = ${id}`);
    const antes = provedor.quantas("excluir");
    expect((await srv.chamar(sessao(terceira), "DELETE", `nuvem/maquinas/${id}`)).status).toBe(409);
    expect(provedor.quantas("excluir")).toBe(antes);
    // Sem reserva, exclui (o Google responde 404 para a VM que nem nasceu: ok).
    await abrirTxEscopada(db, terceira)((trx) => trx`update maquinas_nuvem set operacao_id = null, ocupado_ate = null where id = ${id}`);
    expect((await srv.chamar(sessao(terceira), "DELETE", `nuvem/maquinas/${id}`)).status).toBe(200);
    const [fim] = await abrirTxEscopada(db, terceira)((trx) => trx<{ estado: string; operacao_id: string | null }[]>`select estado, operacao_id from maquinas_nuvem where id = ${id}`);
    expect(fim).toEqual({ estado: "excluida", operacao_id: null });
    // Excluída, pode pedir outra.
    expect((await srv.chamar(sessao(terceira), "POST", "nuvem/maquinas", { regiao: "us-central1", tamanho: "padrao" })).status).toBe(202);
  });
});
