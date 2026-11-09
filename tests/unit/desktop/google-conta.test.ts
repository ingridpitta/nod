import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { segredoDeTroca } from "../../../desktop/conta-provisoria.ts";
import { esteComputadorEm } from "../../../desktop/este-computador.ts";
import { criarGoogleNoApp, urlDoGoogleApp } from "../../../desktop/google-conta.ts";
import { abrirLoopback, FalhaLoopback } from "../../../desktop/loopback.ts";

/**
 * ADA-242 (ADR-157 §3): o Google para conta dentro do app, lado do processo principal. O "navegador" do teste chama o
 * loopback como o servidor redirecionaria; o servidor é um fetch falso que confere a prova.
 */
const SERVIDOR = "https://nod.acme.com.br";
const APP = segredoDeTroca();
const URL_BOA = "/api/sessao/google?conta-app=bilhete.assinado";

function servidorFalso(resposta: (corpo: { codigo: string; prova: string }) => Response) {
  const pedidos: { url: string; corpo: { codigo: string; prova: string }; origem: string | null }[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    const corpo = JSON.parse(String(init.body)) as { codigo: string; prova: string };
    pedidos.push({ url: String(url), corpo, origem: new Headers(init.headers).get("origin") });
    return resposta(corpo);
  }) as typeof fetch;
  return { pedidos, fetchImpl };
}

/** Abre o "navegador": devolve ao loopback o que o servidor devolveria (porta e estado lidos de `abrir()`). */
function navegador(volta: (estado: string) => string) {
  let alvo: { porta: number; estado: string } | null = null;
  const abertas: string[] = [];
  return {
    abertas,
    definir: (a: { porta: number; estado: string }) => { alvo = a; },
    abrirExterno: async (url: string) => {
      abertas.push(url);
      const r = await fetch(`http://127.0.0.1:${alvo!.porta}/retorno?${volta(alvo!.estado)}`);
      await r.arrayBuffer();
    },
  };
}

describe("urlDoGoogleApp", () => {
  it("só a ida do Google com o bilhete do app, no servidor conectado", () => {
    expect(urlDoGoogleApp(SERVIDOR, URL_BOA)).toBe(`${SERVIDOR}${URL_BOA}`);
    expect(urlDoGoogleApp(SERVIDOR, `${SERVIDOR}${URL_BOA}`)).toBe(`${SERVIDOR}${URL_BOA}`);
    expect(urlDoGoogleApp(SERVIDOR, `https://malicioso.example${URL_BOA}`)).toBeNull();
    expect(urlDoGoogleApp(SERVIDOR, "/api/sessao/google?conta=bilhete")).toBeNull();
    expect(urlDoGoogleApp(SERVIDOR, `${URL_BOA}&redirect=x`)).toBeNull();
    expect(urlDoGoogleApp(SERVIDOR, "/outra?conta-app=b")).toBeNull();
    expect(urlDoGoogleApp(SERVIDOR, 42)).toBeNull();
    expect(urlDoGoogleApp(SERVIDOR, "javascript:alert(1)")).toBeNull();
  });
});

describe("Google no app (processo principal)", () => {
  it("abre o loopback, recebe o código e troca com a prova (sem Origin); convertida volta à página", async () => {
    const nav = navegador((estado) => `estado=${estado}&codigo=codigo-do-servidor-0123456789`);
    const srv = servidorFalso((c) => new Response(JSON.stringify({ resultado: c.prova === APP.prova ? "convertida" : "x" }), { status: 200 }));
    const g = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: nav.abrirExterno, aoEntrar: async () => undefined, fetchImpl: srv.fetchImpl });
    const a = await g.abrir();
    expect(a!.porta).toBeGreaterThan(1023);
    expect(a!.estado).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    nav.definir(a!);
    expect(await g.ir(URL_BOA)).toEqual({ resultado: "convertida" });
    expect(nav.abertas).toEqual([`${SERVIDOR}${URL_BOA}`]);
    expect(srv.pedidos).toEqual([{ url: `${SERVIDOR}/api/conta/google/trocar`, corpo: { codigo: "codigo-do-servidor-0123456789", prova: APP.prova }, origem: null }]);
  });

  it("entrou: reconecta com a chave do destino (aoEntrar) e a página vê convertida", async () => {
    const nav = navegador((estado) => `estado=${estado}&codigo=codigo-do-servidor-0123456789`);
    const srv = servidorFalso(() => new Response(JSON.stringify({ resultado: "entrou", chave: "nodm_destino" }), { status: 200 }));
    const chaves: string[] = [];
    const g = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: nav.abrirExterno, aoEntrar: async (c) => { chaves.push(c); }, fetchImpl: srv.fetchImpl });
    nav.definir((await g.abrir())!);
    expect(await g.ir(URL_BOA)).toEqual({ resultado: "convertida" });
    expect(chaves).toEqual(["nodm_destino"]);
  });

  it("sessão morta na volta, troca recusada (403) e URL de fora não ligam nada", async () => {
    const srv = servidorFalso(() => new Response("{}", { status: 403 }));
    const morta = navegador((estado) => `estado=${estado}&erro=sessao`);
    const g1 = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: morta.abrirExterno, aoEntrar: async () => undefined, fetchImpl: srv.fetchImpl });
    morta.definir((await g1.abrir())!);
    expect(await g1.ir(URL_BOA)).toEqual({ resultado: "sessao" });
    expect(srv.pedidos).toEqual([]);

    const boa = navegador((estado) => `estado=${estado}&codigo=codigo-do-servidor-0123456789`);
    const g2 = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: boa.abrirExterno, aoEntrar: async () => undefined, fetchImpl: srv.fetchImpl });
    boa.definir((await g2.abrir())!);
    expect(await g2.ir(URL_BOA)).toEqual({ resultado: "recusado" });

    const fora = navegador(() => "");
    const g3 = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: fora.abrirExterno, aoEntrar: async () => undefined, fetchImpl: srv.fetchImpl });
    await g3.abrir();
    expect(await g3.ir("https://malicioso.example/api/sessao/google?conta-app=b")).toEqual({ resultado: "falhou" });
    expect(fora.abertas).toEqual([]);
    // Sem abrir antes: nada abre.
    const g4 = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: fora.abrirExterno, aoEntrar: async () => undefined, fetchImpl: srv.fetchImpl });
    expect(await g4.ir(URL_BOA)).toEqual({ resultado: "falhou" });
    // Sem conexão: abrir devolve null.
    const g5 = criarGoogleNoApp({ servidor: () => null, prova: APP.prova, abrirExterno: fora.abrirExterno, aoEntrar: async () => undefined });
    expect(await g5.abrir()).toBeNull();
  });

  it("cancelar fecha a porta: a espera termina em sem_resposta", async () => {
    const g = criarGoogleNoApp({ servidor: () => SERVIDOR, prova: APP.prova, abrirExterno: async () => undefined, aoEntrar: async () => undefined });
    await g.abrir();
    const espera = g.ir(URL_BOA);
    g.cancelar();
    expect(await espera).toEqual({ resultado: "sem_resposta" });
  });
});

describe("loopback", () => {
  it("estado errado recebe 400 e não conta; o prazo fecha a porta", async () => {
    const l = await abrirLoopback({ prazoMs: 200, paginaOk: "ok", paginaErro: "erro" });
    const r = await fetch(`http://127.0.0.1:${l.porta}/retorno?estado=outro&codigo=x`);
    expect(r.status).toBe(400);
    await expect(l.retorno).rejects.toBeInstanceOf(FalhaLoopback);
  });
});

describe("este computador (já vi)", () => {
  const pastas: string[] = [];
  afterAll(async () => { for (const p of pastas) await rm(p, { recursive: true, force: true }); });
  it("começa em false, marca e lembra; pasta nova (reinstalação limpa) volta a false", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-este-"));
    pastas.push(pasta);
    const e = esteComputadorEm(join(pasta, "app"));
    expect(await e.jaViu()).toBe(false);
    await e.marcar();
    expect(await esteComputadorEm(join(pasta, "app")).jaViu()).toBe(true);
    expect(await esteComputadorEm(join(pasta, "outra")).jaViu()).toBe(false);
  });
});
