import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cunharBilhete, cunharBilheteApp, lerBilhete, lerBilheteApp } from "../../../src/adapters/http/rotas/conta.ts";
import { listen } from "../../../src/adapters/http/server.ts";
import { CLIENT_ID, claimsBoas, googleFalso, respostaComIdToken } from "../../helpers/google-falso.ts";

/**
 * NOD-345: "Continuar com Google" para conta. O bilhete assinado vai no state (o cookie Strict não chega no callback);
 * sem `hd` na ida e sem a regra do domínio na volta: Gmail e Workspace entram, identidade por iss+sub.
 */
const SEGREDO = "segredo-de-teste-do-google-conta-com-40-chars";
const ANA = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

describe("Google para conta: servidor real, Google falso", () => {
  let base: string;
  let close: () => Promise<void>;
  let claims: Record<string, unknown> = {};
  const semBilhete: { iss: string; sub: string }[] = [];
  const voltas: { bilhete: string; g: { iss: string; sub: string; email: string; autoridade: boolean } }[] = [];
  const voltasApp: { bilhete: string; g: { iss: string; sub: string; email: string; autoridade: boolean } }[] = [];
  const google = googleFalso(() => respostaComIdToken(claims));

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", {
      segredoSessao: SEGREDO,
      sessao: {
        modo: "google",
        google: {
          clientId: CLIENT_ID,
          clientSecret: "segredo-do-cliente-oauth",
          redirectUri: "http://127.0.0.1:5274/api/sessao/google/callback",
          dominio: "acme.com.br",
          fetchImpl: google.fetchImpl,
          pessoaPorEmail: async () => null,
          conta: {
            // O real exige o cookie de sessão do mesmo sid; aqui o "navegador dono" é quem manda `dono=1`.
            bilheteDoNavegador: (b, req) => lerBilhete(SEGREDO, b, Date.now()) !== null && (req.headers.cookie ?? "").includes("dono=1"),
            // ADA-242: o bilhete do app vale sem cookie (o navegador do sistema não tem a sessão do app).
            bilheteApp: (b) => lerBilheteApp(SEGREDO, b, Date.now()) !== null,
            async aoVoltarApp(bilhete, g) {
              voltasApp.push({ bilhete, g });
              const b = lerBilheteApp(SEGREDO, bilhete, Date.now());
              return b ? `http://127.0.0.1:${b.porta}/retorno?estado=${b.estado}&codigo=codigo-guardado` : null;
            },
            async aoVoltar(bilhete, g) {
              voltas.push({ bilhete, g });
              return { setCookie: null, pagina: "<p>volte ao app</p>" };
            },
            async entrarSemBilhete(g) {
              semBilhete.push(g);
              return g.sub === "sub-ligado" ? { setCookie: "nod_sessao=conta; Path=/", pagina: "<p>entrou</p>" } : null;
            },
          },
        },
      },
    });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
  });
  afterAll(() => close());

  async function ida(bilhete: string, dono = true): Promise<{ status: number; state: string; cookie: string; hd: string | null; location: string }> {
    const r = await fetch(`${base}/api/sessao/google?conta=${encodeURIComponent(bilhete)}`, { redirect: "manual", headers: dono ? { cookie: "dono=1" } : {} });
    const location = r.headers.get("location") ? new URL(r.headers.get("location")!, base) : null;
    return { status: r.status, state: location?.searchParams.get("state") ?? "", cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "", hd: location?.searchParams.get("hd") ?? null, location: location?.toString() ?? "" };
  }

  it("com bilhete: a ida não manda hd; Gmail pessoal volta ao serviço com iss normalizado e autoridade", async () => {
    const bilhete = cunharBilhete(SEGREDO, { escopo: ANA, sid: "sid-1", t: Date.now() });
    const { status, state, cookie, hd } = await ida(bilhete);
    expect(status).toBe(302);
    expect(hd).toBeNull();
    claims = claimsBoas(Date.now(), { hd: undefined, email: "ana.pessoal@gmail.com", sub: "sub-gmail-1", iss: "accounts.google.com" });
    const r = await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("<p>volte ao app</p>");
    expect(voltas.at(-1)).toMatchObject({ bilhete, g: { iss: "https://accounts.google.com", sub: "sub-gmail-1", email: "ana.pessoal@gmail.com", autoridade: true } });
  });

  it("Workspace de outro domínio que não o NOD_GOOGLE_DOMINIO também volta (sem a regra do domínio)", async () => {
    const bilhete = cunharBilhete(SEGREDO, { escopo: ANA, sid: "sid-2", t: Date.now() });
    const { state, cookie } = await ida(bilhete);
    claims = claimsBoas(Date.now(), { hd: "outra.com.br", email: "bia@outra.com.br", sub: "sub-ws-2" });
    const r = await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie } });
    expect(r.status).toBe(200);
    expect(voltas.at(-1)?.g).toMatchObject({ email: "bia@outra.com.br", autoridade: true });
  });

  it("e-mail de domínio próprio fora do Workspace (sem hd, não-Gmail): volta SEM autoridade", async () => {
    const bilhete = cunharBilhete(SEGREDO, { escopo: ANA, sid: "sid-3", t: Date.now() });
    const { state, cookie } = await ida(bilhete);
    claims = claimsBoas(Date.now(), { hd: undefined, email: "cris@empresa.com.br", sub: "sub-3" });
    await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie } });
    expect(voltas.at(-1)?.g).toMatchObject({ email: "cris@empresa.com.br", autoridade: false });
  });

  it("bilhete adulterado ou de outro segredo não abre o Google com intenção de conta", async () => {
    const antes = voltas.length;
    const ruim = cunharBilhete("outro-segredo-qualquer-com-mais-de-32-chars", { escopo: ANA, sid: "s", t: Date.now() });
    const { status, location } = await ida(ruim);
    expect(status).toBe(302);
    expect(location).toBe(`${base}/?conta=recusado`);
    expect(voltas.length).toBe(antes);
  });

  it("bilhete válido aberto noutro navegador (sem a sessão dona) é recusado: não vira login de outra pessoa", async () => {
    const antes = voltas.length;
    const bilhete = cunharBilhete(SEGREDO, { escopo: ANA, sid: "sid-5", t: Date.now() });
    const { status, location } = await ida(bilhete, false);
    expect(status).toBe(302);
    expect(location).toBe(`${base}/?conta=recusado`);
    expect(voltas.length).toBe(antes);
  });

  it("login sem bilhete: Google já ligado a uma conta entra; os outros seguem o login de antes", async () => {
    const r0 = await fetch(`${base}/api/sessao/google`, { redirect: "manual" });
    const loc = new URL(r0.headers.get("location")!);
    expect(loc.searchParams.get("hd")).toBeNull();
    const cookie = (r0.headers.get("set-cookie") ?? "").split(";")[0]!;
    claims = claimsBoas(Date.now(), { hd: undefined, email: "ana.pessoal@gmail.com", sub: "sub-ligado" });
    const r = await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(loc.searchParams.get("state")!)}`, { redirect: "manual", headers: { cookie } });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("<p>entrou</p>");
    expect(r.headers.getSetCookie().some((c) => c.startsWith("nod_sessao=conta"))).toBe(true);
    expect(semBilhete.at(-1)).toMatchObject({ iss: "https://accounts.google.com", sub: "sub-ligado" });
  });

  it("e-mail não verificado é recusado antes do serviço", async () => {
    const antes = voltas.length;
    const bilhete = cunharBilhete(SEGREDO, { escopo: ANA, sid: "sid-4", t: Date.now() });
    const { state, cookie } = await ida(bilhete);
    claims = claimsBoas(Date.now(), { email_verified: false, email: "x@gmail.com", hd: undefined });
    const r = await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie } });
    expect(r.headers.getSetCookie().some((c) => c.startsWith("nod_sessao="))).toBe(false);
    expect(voltas.length).toBe(antes);
  });

  it("ADA-242: bilhete do app abre sem cookie e a volta vai ao loopback do app (302), sem passar por aoVoltar", async () => {
    const desafio = "d".repeat(43);
    const bilhete = cunharBilheteApp(SEGREDO, { escopo: ANA, sid: "sid-app", t: Date.now(), porta: 50_123, estado: "estado-do-loopback-01", desafio });
    const r0 = await fetch(`${base}/api/sessao/google?conta-app=${encodeURIComponent(bilhete)}`, { redirect: "manual" });
    expect(r0.status).toBe(302);
    const loc = new URL(r0.headers.get("location")!);
    const cookie = (r0.headers.get("set-cookie") ?? "").split(";")[0]!;
    const antes = voltas.length;
    claims = claimsBoas(Date.now(), { hd: undefined, email: "ana.pessoal@gmail.com", sub: "sub-app-1" });
    const r = await fetch(`${base}/api/sessao/google/callback?code=c&state=${encodeURIComponent(loc.searchParams.get("state")!)}`, { redirect: "manual", headers: { cookie } });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("http://127.0.0.1:50123/retorno?estado=estado-do-loopback-01&codigo=codigo-guardado");
    expect(r.headers.getSetCookie().some((c) => c.startsWith("nod_sessao="))).toBe(false);
    expect(voltasApp.at(-1)).toMatchObject({ bilhete, g: { sub: "sub-app-1", autoridade: true } });
    expect(voltas.length).toBe(antes);
  });

  it("ADA-242: bilhete do app adulterado não abre o Google com intenção de conta", async () => {
    const ruim = cunharBilheteApp("outro-segredo-qualquer-com-mais-de-32-chars", { escopo: ANA, sid: "s", t: Date.now(), porta: 50_123, estado: "estado-do-loopback-01", desafio: "d".repeat(43) });
    const r = await fetch(`${base}/api/sessao/google?conta-app=${encodeURIComponent(ruim)}`, { redirect: "manual" });
    expect(new URL(r.headers.get("location")!, base).toString()).toBe(`${base}/?conta=recusado`);
  });
});
