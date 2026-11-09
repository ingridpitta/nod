// NOD-97 PR 5 (QA, definido em 2026-10-24): o autofill DE VERDADE do Chrome entre dois perfis. A senha é salva no
// perfil A (cifrada como o Chrome cifra com --password-store=basic), recolhida para a loja comum (senhas.enc) e
// importada no perfil B, que nunca a viu. O Chrome de B tem de preencher sozinho, `temSenhaPreenchida` tem de dizer
// true (também dentro de shadow DOM aberto) e a senha marcadora não pode sair no texto, no título nem no URL que o
// bot recebe. `temSenhaPreenchida` também tem de dizer false quando o valor não veio do autofill.
import { spawnSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chaveDasSenhas } from "../../../infra/computador/chaves.mjs";
import { arquivoDasSenhas, importarNoPerfil, lerSenhas, loginDataDo, recolherSenhas } from "../../../infra/computador/login-senhas.mjs";
import { mascaraDeSenha, temSenhaPreenchida } from "../../../infra/computador/tela.mjs";

/** Um Chromium já baixado nesta máquina (na CI não há: o teste pula). */
function chromiumLocal(): string | null {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const bin = join(base, d, "chrome-linux64", "chrome");
    if (existsSync(bin) && spawnSync(bin, ["--headless", "--version"], { timeout: 10_000 }).status === 0) return bin;
  }
  return null;
}
const CHROMIUM = chromiumLocal();
const INFRA = fileURLToPath(new URL("../../../infra/computador/", import.meta.url));
let playwright: string | null = null;
try { playwright = createRequire(join(INFRA, "x.js")).resolve("playwright-core"); } catch { playwright = null; }

const MARCADORA = "MARCADORA-QA-97";
const FORM = '<form action="/ok" method="post"><input id="u" name="u" autocomplete="username"><input id="p" name="p" type="password" autocomplete="current-password"><button>Entrar</button></form>';
const PAGINA = {
  simples: `<!doctype html><html><head><title>Portal</title></head><body><h1>Entrar</h1>${FORM}</body></html>`,
  sombra: `<!doctype html><html><head><title>Portal</title></head><body><h1>Entrar</h1><div id="h"></div><script>document.getElementById("h").attachShadow({mode:"open"}).innerHTML = ${JSON.stringify(FORM)};</script></body></html>`,
};

/** O que o Chrome grava em `password_value` com --password-store=basic no Linux (v10, AES-128-CBC, "peanuts"). */
function cifradaComoOChrome(senha: string): Buffer {
  const k = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
  const c = createCipheriv("aes-128-cbc", k, Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from("v10"), c.update(senha), c.final()]);
}

interface Pagina {
  route(u: string, h: (r: { fulfill(o: Record<string, unknown>): Promise<void> }) => Promise<void>): Promise<void>;
  goto(url: string): Promise<unknown>;
  evaluate<T>(f: string | (() => T)): Promise<T>;
  waitForTimeout(ms: number): Promise<void>;
  title(): Promise<string>;
  url(): string;
  locator(s: string): { innerText(): Promise<string> };
}
interface Contexto { pages(): Pagina[]; newPage(): Promise<Pagina>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Playwright { chromium: { launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<Contexto> } }

describe.skipIf(!CHROMIUM || !playwright)("senha salva: autofill de verdade entre dois perfis", () => {
  let pw: Playwright;
  const pastas: string[] = [];
  const pasta = async () => { const p = await mkdtemp(join(tmpdir(), "nod-autofill-test-")); pastas.push(p); return p; };
  const opcoes = () => ({ executablePath: CHROMIUM!, headless: true, args: ["--password-store=basic"] });
  let perfilB = "";

  /** Cria o perfil (o Chrome faz o Login Data com o esquema real) e fecha. */
  async function perfilNovo(): Promise<string> {
    const p = await pasta();
    await (await pw.chromium.launchPersistentContext(p, opcoes())).close();
    return p;
  }

  async function abrir(perfil: string, html: string): Promise<{ ctx: Contexto; p: Pagina; tem: boolean }> {
    const ctx = await pw.chromium.launchPersistentContext(perfil, opcoes());
    await ctx.addInitScript(mascaraDeSenha);
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    await p.route("https://portal.exemplo/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: html }));
    await p.goto("https://portal.exemplo/login");
    let tem = false;
    // O autofill chega um pouco depois do load; espera até 6 s.
    for (let i = 0; i < 30 && !tem; i++) { await p.waitForTimeout(200); tem = await p.evaluate(temSenhaPreenchida); }
    return { ctx, p, tem };
  }

  beforeAll(async () => {
    pw = (await import(pathToFileURL(playwright!).href)) as Playwright;
    // A salva a senha marcadora, como o Chrome dela salvaria.
    const perfilA = await perfilNovo();
    const db = new DatabaseSync(loginDataDo(perfilA));
    const cols = new Set(db.prepare("PRAGMA table_info(logins)").all().map((c: Record<string, unknown>) => c.name as string));
    const agora = BigInt(Date.now()) * 1000n + 11_644_473_600_000_000n;
    const v: Record<string, unknown> = {
      origin_url: "https://portal.exemplo/login", action_url: "https://portal.exemplo/ok", signon_realm: "https://portal.exemplo/",
      username_element: "u", username_value: "ana", password_element: "p", password_value: cifradaComoOChrome(MARCADORA),
      date_created: agora, date_password_modified: agora, date_last_used: agora, blacklisted_by_user: 0, scheme: 0, times_used: 1,
    };
    const campos = Object.keys(v).filter((c) => cols.has(c));
    db.prepare(`INSERT INTO logins (${campos.join(", ")}) VALUES (${campos.map(() => "?").join(", ")})`).run(...campos.map((c) => v[c] as never));
    db.close();
    // A loja comum leva de A para B (B nunca viu a senha).
    const logins = await pasta();
    const arq = arquivoDasSenhas(logins);
    await mkdir(join(logins, "principal"), { recursive: true });
    const chave = chaveDasSenhas("e".repeat(64));
    expect(await recolherSenhas(arq, chave, perfilA, await pasta())).toBe("gravou");
    perfilB = await perfilNovo();
    expect(importarNoPerfil(perfilB, await lerSenhas(arq, chave))).toBe(1);
  }, 60_000);
  afterAll(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); });

  for (const [nome, html, campo] of [
    ["num formulário comum", PAGINA.simples, "document.getElementById('p')"],
    ["dentro de shadow DOM aberto", PAGINA.sombra, "document.getElementById('h').shadowRoot.getElementById('p')"],
  ] as const) {
    it(`o Chrome do bot B preenche a senha que o bot A salvou, ${nome}, e o bot não recebe o valor`, async () => {
      const { ctx, p, tem } = await abrir(perfilB, html);
      try {
        expect(tem).toBe(true);
        // A máscara está no campo que o Chrome preencheu. Com type=password o Chrome já mostra bolinhas sozinho; a
        // máscara do nod é o que segura quando o site troca para type=text ("mostrar senha").
        expect(await p.evaluate<string>(`getComputedStyle(${campo}).webkitTextSecurity`)).toBe("disc");
        await p.evaluate(`(() => { ${campo}.type = "text"; })()`);
        await p.waitForTimeout(100);
        expect(await p.evaluate<string>(`getComputedStyle(${campo}).webkitTextSecurity`)).toBe("disc");
        // O que vai ao bot (observar: texto, título, URL) não tem a marcadora.
        expect(await p.locator("body").innerText()).not.toContain(MARCADORA);
        expect(await p.title()).not.toContain(MARCADORA);
        expect(p.url()).not.toContain(MARCADORA);
      } finally { await ctx.close(); }
    }, 60_000);
  }

  it("temSenhaPreenchida diz false quando o valor não veio do autofill (perfil sem a senha, ou digitado pelo site)", async () => {
    const vazio = await perfilNovo();
    const { ctx, p, tem } = await abrir(vazio, PAGINA.simples);
    try {
      expect(tem).toBe(false);
      await p.evaluate("(() => { document.getElementById('p').value = 'x'; })()");
      expect(await p.evaluate(temSenhaPreenchida)).toBe(false);
    } finally { await ctx.close(); }
  }, 60_000);
});
