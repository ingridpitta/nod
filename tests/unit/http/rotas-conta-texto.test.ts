import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { segredoDeTroca } from "../../../desktop/conta-provisoria.ts";
import { contaNoGoogle, cunharBilhete, cunharBilheteApp, lerBilhete, lerBilheteApp, rotasConta } from "../../../src/adapters/http/rotas/conta.ts";
import { listen } from "../../../src/adapters/http/server.ts";
import { cunharCookie } from "../../../src/adapters/http/sessao-cookie.ts";
import type { GuardaSessao } from "../../../src/adapters/http/sessao-revogavel.ts";
import type { Escopo } from "../../../src/shared/types.ts";
import type { Quem, ServicoConta } from "../../../src/use-cases/conta.ts";

/**
 * ADA-242 (ADR-157): a camada HTTP do onboarding por texto, com a flag ligada e desligada. O serviço é falso (o real tem
 * o teste no Postgres em tests/integration/conta.test.ts). Prova: 404 sem a flag, o modo anuncia a flag, o bilhete do
 * app amarrado ao desafio, a troca só sem Origin e a volta ao loopback.
 */
const SEGREDO = "segredo-de-teste-das-contas-com-mais-de-32";
const ANA: Escopo = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const APP = segredoDeTroca();
const ESTADO = "estado-do-loopback-0123456789";

type Servidor = { base: string; close: () => Promise<void>; vivas: Set<string>; pedidos: unknown[]; guarda: GuardaSessao };

async function subir(onboardingTexto: boolean): Promise<Servidor> {
  const vivas = new Set<string>();
  const pedidos: unknown[] = [];
  const guarda: GuardaSessao = {
    conferir: async (_e, sid) => sid !== null && vivas.has(sid),
    criar: async () => { const s = crypto.randomUUID(); vivas.add(s); return s; },
    revogar: async (_e, sid) => vivas.delete(sid),
    revogarOutras: async () => 0,
  };
  const servico = {
    pedirCodigo: async (q: Quem, e: { email: unknown }) => { pedidos.push({ q, e }); return { enviado: true, email: e.email }; },
    trocarGoogleApp: async (_q: Quem, e: { codigo: unknown; prova: unknown }) => (e.codigo === "codigo-do-loopback-0123456789" && e.prova === APP.prova ? { resultado: "convertida" } : null),
  } as unknown as ServicoConta;
  const rotas = rotasConta({ servico, guarda, segredo: SEGREDO, seguro: false, bootstrap: true, google: true, agora: () => Date.now(), onboardingTexto });
  const srv = await listen(0, "127.0.0.1", { segredoSessao: SEGREDO, contas: { guarda, google: true, bootstrap: true, onboardingTexto, rotas } });
  return { base: `http://127.0.0.1:${srv.port}`, close: srv.close, vivas, pedidos, guarda };
}

const json = { "content-type": "application/json" };

describe("onboarding por texto desligado (o padrão)", () => {
  let s: Servidor;
  beforeAll(async () => { s = await subir(false); });
  afterAll(async () => s.close());

  it("o modo não anuncia a flag; /codigo e /google/trocar respondem 404; o Google do app segue recusado", async () => {
    const modo = await (await fetch(`${s.base}/api/sessao/modo`)).json() as { contas: Record<string, unknown> };
    expect(modo.contas.onboardingTexto).toBeUndefined();
    const sid = await s.guarda.criar(ANA, "web", "x");
    const cookie = `nod_sessao=${cunharCookie(ANA, SEGREDO, sid)}`;
    expect((await fetch(`${s.base}/api/conta/codigo`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ email: "ana@exemplo.com" }) })).status).toBe(404);
    expect((await fetch(`${s.base}/api/conta/google/trocar`, { method: "POST", headers: json, body: JSON.stringify({ codigo: "codigo-do-loopback-0123456789", prova: APP.prova }) })).status).toBe(404);
    const app = await fetch(`${s.base}/api/conta/google`, { method: "POST", headers: { ...json, cookie, "x-nod-app-desafio": APP.desafio }, body: JSON.stringify({ app: true, porta: 50_000, estado: ESTADO }) });
    expect(app.status).toBeGreaterThanOrEqual(400);
    expect(s.pedidos).toEqual([]);
  });
});

describe("onboarding por texto ligado", () => {
  let s: Servidor;
  beforeAll(async () => { s = await subir(true); });
  afterAll(async () => s.close());
  const sessao = async () => { const sid = await s.guarda.criar(ANA, "web", "x"); return { sid, cookie: `nod_sessao=${cunharCookie(ANA, SEGREDO, sid)}` }; };

  it("o modo anuncia `contas.onboardingTexto`", async () => {
    const modo = await (await fetch(`${s.base}/api/sessao/modo`)).json();
    expect(modo).toMatchObject({ contas: { onboardingTexto: true } });
  });

  it("POST /codigo chama o serviço com a sessão do cookie", async () => {
    const { sid, cookie } = await sessao();
    const r = await fetch(`${s.base}/api/conta/codigo`, { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ email: "ana@exemplo.com" }) });
    expect(await r.json()).toEqual({ enviado: true, email: "ana@exemplo.com" });
    expect(s.pedidos.at(-1)).toMatchObject({ q: { escopo: ANA, sid }, e: { email: "ana@exemplo.com" } });
  });

  it("Google do app: bilhete leva sessão, porta, estado e o desafio do cabeçalho; sem desafio, porta ou estado ruins → recusa", async () => {
    const { sid, cookie } = await sessao();
    const pedir = (corpo: unknown, desafio: string | null = APP.desafio) =>
      fetch(`${s.base}/api/conta/google`, { method: "POST", headers: { ...json, cookie, ...(desafio ? { "x-nod-app-desafio": desafio } : {}) }, body: JSON.stringify(corpo) });
    const r = await (await pedir({ app: true, porta: 50_000, estado: ESTADO })).json() as { url: string };
    expect(r.url).toMatch(/^\/api\/sessao\/google\?conta-app=/);
    const b = lerBilheteApp(SEGREDO, decodeURIComponent(r.url.split("conta-app=")[1]!), Date.now());
    expect(b).toMatchObject({ escopo: ANA, sid, porta: 50_000, estado: ESTADO, desafio: APP.desafio });
    expect((await pedir({ app: true, porta: 50_000, estado: ESTADO }, null)).status).toBe(403);
    expect((await pedir({ app: true, porta: 80, estado: ESTADO })).status).toBe(400);
    expect((await pedir({ app: true, porta: 50_000, estado: "curto" })).status).toBe(400);
    expect((await pedir({ app: true, porta: "50000", estado: ESTADO })).status).toBe(400);
  });

  it("troca do Google do app: só sem Origin; código ou prova errados → 403", async () => {
    const corpo = (prova: string) => JSON.stringify({ codigo: "codigo-do-loopback-0123456789", prova });
    const ok = await fetch(`${s.base}/api/conta/google/trocar`, { method: "POST", headers: json, body: corpo(APP.prova) });
    expect(await ok.json()).toEqual({ resultado: "convertida" });
    expect((await fetch(`${s.base}/api/conta/google/trocar`, { method: "POST", headers: { ...json, origin: s.base }, body: corpo(APP.prova) })).status).toBe(403);
    expect((await fetch(`${s.base}/api/conta/google/trocar`, { method: "POST", headers: json, body: corpo(segredoDeTroca().prova) })).status).toBe(403);
  });
});

describe("bilhete do app", () => {
  const base = { escopo: ANA, sid: "s1", t: 1_000, porta: 50_000, estado: ESTADO, desafio: APP.desafio };
  it("vence em 10 min, não troca de tipo com o bilhete da web e recusa campos fora do formato", () => {
    const b = cunharBilheteApp(SEGREDO, base);
    expect(lerBilheteApp(SEGREDO, b, 1_000 + 599_000)).toEqual(base);
    expect(lerBilheteApp(SEGREDO, b, 1_000 + 601_000)).toBeNull();
    expect(lerBilheteApp("outro-segredo-com-mais-de-32-caracteres!", b, 1_000)).toBeNull();
    expect(lerBilheteApp(SEGREDO, `x${b}`, 1_000)).toBeNull();
    // Um não passa pelo outro.
    expect(lerBilhete(SEGREDO, b, 1_000)).toBeNull();
    expect(lerBilheteApp(SEGREDO, cunharBilhete(SEGREDO, { escopo: ANA, sid: "s1", t: 1_000 }), 1_000)).toBeNull();
    expect(lerBilheteApp(SEGREDO, cunharBilheteApp(SEGREDO, { ...base, porta: 80 }), 1_000)).toBeNull();
    expect(lerBilheteApp(SEGREDO, cunharBilheteApp(SEGREDO, { ...base, estado: "a/b" }), 1_000)).toBeNull();
    expect(lerBilheteApp(SEGREDO, cunharBilheteApp(SEGREDO, { ...base, desafio: "curto" }), 1_000)).toBeNull();
  });
});

describe("volta do Google ao loopback do app", () => {
  const g = { iss: "https://accounts.google.com", sub: "sub-1", email: "ana@exemplo.com", autoridade: true };
  const montar = (onboardingTexto: boolean, viva: boolean) => {
    const guardados: unknown[] = [];
    const servico = { guardarGoogleApp: async (b: unknown, gg: unknown) => { guardados.push({ b, gg }); return "codigo-guardado-0123456789"; } } as unknown as ServicoConta;
    const guarda = { conferir: async () => viva } as unknown as GuardaSessao;
    return { c: contaNoGoogle({ servico, guarda, segredo: SEGREDO, seguro: false, agora: () => 2_000, onboardingTexto }), guardados };
  };
  const bilhete = cunharBilheteApp(SEGREDO, { escopo: ANA, sid: "s1", t: 1_000, porta: 50_000, estado: ESTADO, desafio: APP.desafio });

  it("sessão viva: guarda a identidade amarrada ao desafio e manda ao 127.0.0.1 com o código e o estado", async () => {
    const { c, guardados } = montar(true, true);
    expect(c.bilheteApp(bilhete)).toBe(true);
    const url = new URL((await c.aoVoltarApp(bilhete, g))!);
    expect(url.origin).toBe("http://127.0.0.1:50000");
    expect(url.pathname).toBe("/retorno");
    expect(url.searchParams.get("estado")).toBe(ESTADO);
    expect(url.searchParams.get("codigo")).toBe("codigo-guardado-0123456789");
    expect(guardados).toEqual([{ b: { escopo: ANA, sid: "s1", desafio: APP.desafio }, gg: g }]);
  });

  it("sessão morta: o loopback recebe erro=sessao e nada é guardado", async () => {
    const { c, guardados } = montar(true, false);
    const url = new URL((await c.aoVoltarApp(bilhete, g))!);
    expect(url.searchParams.get("erro")).toBe("sessao");
    expect(url.searchParams.get("codigo")).toBeNull();
    expect(guardados).toEqual([]);
  });

  it("flag desligada ou bilhete da web: não é a volta do app", async () => {
    const { c } = montar(false, true);
    expect(c.bilheteApp(bilhete)).toBe(false);
    expect(await c.aoVoltarApp(bilhete, g)).toBeNull();
    const { c: ligado } = montar(true, true);
    expect(await ligado.aoVoltarApp(cunharBilhete(SEGREDO, { escopo: ANA, sid: "s1", t: 1_000 }), g)).toBeNull();
  });
});
