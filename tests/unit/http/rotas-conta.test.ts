import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cunharBilhete, ipDe, lerBilhete, rotasConta } from "../../../src/adapters/http/rotas/conta.ts";
import { listen } from "../../../src/adapters/http/server.ts";
import { cunharCookie, lerSessaoDoCookie } from "../../../src/adapters/http/sessao-cookie.ts";
import type { GuardaSessao } from "../../../src/adapters/http/sessao-revogavel.ts";
import type { Escopo } from "../../../src/shared/types.ts";
import type { Quem, ServicoConta } from "../../../src/use-cases/conta.ts";

/**
 * NOD-345: a camada HTTP das contas sobre o servidor real em porta 0, com o serviço e o guarda falsos (o serviço tem o
 * próprio teste no Postgres: tests/integration/conta.test.ts). Prova o que só o HTTP faz: Origin, cookie com sid,
 * sessão revogada que deixa de valer, troca do app sem Origin e o bilhete do Google.
 */
const SEGREDO = "segredo-de-teste-das-contas-com-mais-de-32";
const ANA: Escopo = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };
const OUTRA: Escopo = { tenantId: "00000000-0000-4000-8000-0000000000a2", pessoaId: "00000000-0000-4000-8000-0000000000b2" };

describe("rotas de conta (HTTP)", () => {
  let base: string;
  let close: () => Promise<void>;
  const vivas = new Set<string>();
  const vistos: Quem[] = [];
  let aceitaSemSid = false;
  const guarda: GuardaSessao = {
    conferir: async (_e, sid) => (sid === null ? aceitaSemSid : vivas.has(sid)),
    criar: async () => { const s = crypto.randomUUID(); vivas.add(s); return s; },
    revogar: async (_e, sid) => vivas.delete(sid),
    revogarOutras: async (_e, manter) => { let n = 0; for (const s of [...vivas]) if (s !== manter) { vivas.delete(s); n++; } return n; },
  };
  const servico = {
    estado: async (q: Quem) => { vistos.push(q); return { conta: null, escolha: null, verificando: null }; },
    entrar: async (_q: Quem, e: { email: unknown }) => {
      if (e.email !== "ana@exemplo.com") return { resultado: "recusado" };
      const sid = crypto.randomUUID();
      vivas.add(sid);
      return { resultado: "entrou", sessao: { escopo: OUTRA, sid }, trocaApp: "troca-de-uso-unico-0123456789" };
    },
    trocarApp: async (_q: Quem, e: { codigo: unknown }) => (e.codigo === "troca-de-uso-unico-0123456789" ? { chave: "nodm_x" } : null),
    provisorio: async () => ({ escopo: ANA, chave: "nodm_prov", sessao: null, novo: true }),
  } as unknown as ServicoConta;

  beforeAll(async () => {
    const rotas = rotasConta({ servico, guarda, segredo: SEGREDO, seguro: false, bootstrap: true, google: true, agora: () => Date.now() });
    const srv = await listen(0, "127.0.0.1", { segredoSessao: SEGREDO, contas: { guarda, google: true, bootstrap: true, rotas } });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
  });
  afterAll(async () => close());

  const cookieDe = (sid: string, e: Escopo = ANA) => `nod_sessao=${cunharCookie(e, SEGREDO, sid)}`;

  it("o modo anuncia as contas (a web decide por ele, não por 404)", async () => {
    const r = await (await fetch(`${base}/api/sessao/modo`)).json();
    expect(r).toMatchObject({ contas: { google: true, bootstrap: true } });
  });

  it("cookie com sid vivo vale; revogado deixa de valer na hora (sair desta sessão)", async () => {
    const sid = await guarda.criar(ANA, "web", "x");
    expect((await fetch(`${base}/api/sessao`, { headers: { cookie: cookieDe(sid) } })).status).toBe(200);
    const sair = await fetch(`${base}/api/sessao/sair`, { method: "POST", headers: { cookie: cookieDe(sid) } });
    expect(sair.status).toBeLessThan(400);
    expect(vivas.has(sid)).toBe(false);
    expect((await fetch(`${base}/api/sessao`, { headers: { cookie: cookieDe(sid) } })).status).toBe(401);
  });

  it("sair das outras mantém a atual", async () => {
    const atual = await guarda.criar(ANA, "web", "x");
    const outra = await guarda.criar(ANA, "web", "y");
    const r = await fetch(`${base}/api/conta/sair-das-outras`, { method: "POST", headers: { cookie: cookieDe(atual) } });
    expect(await r.json()).toMatchObject({ encerradas: expect.any(Number) });
    expect(vivas.has(atual)).toBe(true);
    expect(vivas.has(outra)).toBe(false);
  });

  it("POST com Origin de outro host → 403; do mesmo host passa", async () => {
    const corpo = JSON.stringify({ email: "ana@exemplo.com", senha: "x" });
    const fora = await fetch(`${base}/api/conta/entrar`, { method: "POST", headers: { origin: "https://malicioso.example", "content-type": "application/json" }, body: corpo });
    expect(fora.status).toBe(403);
    const dentro = await fetch(`${base}/api/conta/entrar`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: corpo });
    expect(dentro.status).toBe(200);
  });

  it("entrar põe o cookie da pessoa nova com sid; a resposta não leva a sessão, só o troca do app", async () => {
    const r = await fetch(`${base}/api/conta/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ana@exemplo.com", senha: "x" }) });
    const corpo = await r.json();
    expect(corpo).toEqual({ resultado: "entrou", trocaApp: "troca-de-uso-unico-0123456789" });
    const valor = /nod_sessao=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
    const lido = lerSessaoDoCookie(valor, SEGREDO);
    expect(lido?.escopo).toEqual(OUTRA);
    expect(lido?.sid && vivas.has(lido.sid)).toBe(true);
    expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("recusa não põe cookie", async () => {
    const r = await fetch(`${base}/api/conta/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@y.com", senha: "x" }) });
    expect(await r.json()).toEqual({ resultado: "recusado" });
    expect(r.headers.get("set-cookie")).toBeNull();
  });

  it("troca do app: só sem Origin; código errado → 403", async () => {
    const ok = await fetch(`${base}/api/conta/troca-app`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: "troca-de-uso-unico-0123456789" }) });
    expect(await ok.json()).toEqual({ chave: "nodm_x" });
    const comOrigem = await fetch(`${base}/api/conta/troca-app`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ codigo: "troca-de-uso-unico-0123456789" }) });
    expect(comOrigem.status).toBe(403);
    const errado = await fetch(`${base}/api/conta/troca-app`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo: "x".repeat(30) }) });
    expect(errado.status).toBe(403);
  });

  it("provisório do app: chave só sem Origin (uma página não pega chave de máquina)", async () => {
    const ok = await fetch(`${base}/api/conta/provisorio`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verificador: "v".repeat(40), forma: "app" }) });
    expect(await ok.json()).toMatchObject({ chave: "nodm_prov" });
    const pagina = await fetch(`${base}/api/conta/provisorio`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ verificador: "v".repeat(40), forma: "app" }) });
    expect(pagina.status).toBe(403);
  });

  it("o Google para conta devolve a URL com o bilhete da sessão; sem sessão → 403", async () => {
    const sid = await guarda.criar(ANA, "web", "x");
    const r = await (await fetch(`${base}/api/conta/google`, { method: "POST", headers: { cookie: cookieDe(sid), "content-type": "application/json" }, body: "{}" })).json() as { url: string };
    const bilhete = decodeURIComponent(r.url.split("conta=")[1]!);
    expect(lerBilhete(SEGREDO, bilhete, Date.now())).toMatchObject({ escopo: ANA, sid });
    expect((await fetch(`${base}/api/conta/google`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    // Google para conta ainda não vale no app (a volta não tem como chegar ao app com segurança).
    const app = await fetch(`${base}/api/conta/google`, { method: "POST", headers: { cookie: cookieDe(sid), "content-type": "application/json" }, body: JSON.stringify({ app: true }) });
    expect(app.status).toBeGreaterThanOrEqual(400);
  });

  it("GET /api/conta lê o sid do cookie, e sid revogado chega como sem sessão", async () => {
    const sid = await guarda.criar(ANA, "web", "x");
    await fetch(`${base}/api/conta`, { headers: { cookie: cookieDe(sid) } });
    expect(vistos.at(-1)).toMatchObject({ escopo: ANA, sid });
    vivas.delete(sid);
    await fetch(`${base}/api/conta`, { headers: { cookie: cookieDe(sid) } });
    expect(vistos.at(-1)).toMatchObject({ escopo: null, sid: null });
  });

  it("cookie antigo sem sid, ainda aceito: vira uma sessão registrada e volta com cookie novo (com sid)", async () => {
    aceitaSemSid = true;
    try {
      const r = await fetch(`${base}/api/conta`, { headers: { cookie: `nod_sessao=${cunharCookie(ANA, SEGREDO)}` } });
      const lido = lerSessaoDoCookie(/nod_sessao=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1], SEGREDO);
      expect(lido?.escopo).toEqual(ANA);
      expect(lido?.sid && vivas.has(lido.sid)).toBe(true);
      expect(vistos.at(-1)).toMatchObject({ escopo: ANA, sid: lido?.sid });
    } finally {
      aceitaSemSid = false;
    }
    // Sem sid e não aceito: sem sessão, sem cookie.
    const r = await fetch(`${base}/api/conta`, { headers: { cookie: `nod_sessao=${cunharCookie(ANA, SEGREDO)}` } });
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(vistos.at(-1)).toMatchObject({ escopo: null, sid: null });
  });
});

describe("bilhete do Google", () => {
  it("vence em 10 min, não aceita outro segredo nem adulteração", () => {
    const b = cunharBilhete(SEGREDO, { escopo: ANA, sid: "s1", t: 1_000 });
    expect(lerBilhete(SEGREDO, b, 1_000 + 599_000)).toMatchObject({ sid: "s1" });
    expect(lerBilhete(SEGREDO, b, 1_000 + 601_000)).toBeNull();
    expect(lerBilhete("outro-segredo-com-mais-de-32-caracteres!", b, 1_000)).toBeNull();
    expect(lerBilhete(SEGREDO, `x${b}`, 1_000)).toBeNull();
  });
});

describe("ipDe", () => {
  const req = (remoto: string, xff?: string) => ({ socket: { remoteAddress: remoto }, headers: xff ? { "x-forwarded-for": xff } : {} }) as never;
  it("atrás do Caddy (container na rede privada) usa o ÚLTIMO salto do X-Forwarded-For; de fora, ignora o cabeçalho", () => {
    expect(ipDe(req("127.0.0.1", "203.0.113.5"))).toBe("203.0.113.5");
    expect(ipDe(req("::ffff:172.18.0.3", "203.0.113.5"))).toBe("203.0.113.5");
    expect(ipDe(req("10.0.0.4", "1.2.3.4, 203.0.113.5"))).toBe("203.0.113.5");
    expect(ipDe(req("198.51.100.7", "203.0.113.5"))).toBe("198.51.100.7");
    expect(ipDe(req("172.32.0.1", "203.0.113.5"))).toBe("172.32.0.1");
  });
  it("IPv6 conta pelo /64", () => {
    expect(ipDe(req("172.18.0.3", "2001:db8:a:b:1:2:3:4"))).toBe("2001:db8:a:b::/64");
    expect(ipDe(req("172.18.0.3", "2001:db8:a:b::9"))).toBe(ipDe(req("172.18.0.3", "2001:db8:a:b:ffff::1")));
    expect(ipDe(req("172.18.0.3", "2001:db8::1"))).toBe("2001:db8:0:0::/64");
  });
});
