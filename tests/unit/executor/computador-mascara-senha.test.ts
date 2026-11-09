// NOD-97 PR 5 (definido em 2026-10-24, ADR-122 emenda): a máscara do campo de senha num Chromium de verdade. O bot vê a
// tela pelo screenshot e pelo texto da página; a senha que o Chrome preenche não pode sair em nenhum dos dois — nem
// depois de o site trocar o `type` do campo, nem dentro de shadow DOM (aberto ou fechado).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const MARCADORA = "MARCADORA1";
const OUTRA = "OUTRA-COIS"; // mesmo tamanho: com a máscara, os dois campos têm de sair iguais no screenshot

interface Elemento { screenshot(): Promise<Buffer> }
interface Pagina {
  goto(url: string): Promise<unknown>;
  evaluate<T>(f: string | ((a: never) => T), a?: unknown): Promise<T>;
  title(): Promise<string>;
  locator(s: string): Elemento;
  route(u: string, h: (r: { fulfill(o: Record<string, unknown>): Promise<void> }) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}
interface Contexto { newPage(): Promise<Pagina>; addInitScript(f: () => void): Promise<void>; close(): Promise<void> }
interface Navegador { newContext(): Promise<Contexto>; close(): Promise<void> }

const HTML = `<!doctype html><html><head><title>Portal</title><style>input{font:16px monospace;width:200px;border:0;outline:0;caret-color:transparent}</style></head>
<body><h1>Entrar</h1><form><input id="u" value="ana"><input id="p" type="password"></form></body></html>`;

describe.skipIf(!CHROMIUM || !playwright)("máscara de senha: num Chromium de verdade", () => {
  let navegador: Navegador;
  beforeAll(async () => {
    const { chromium } = (await import(pathToFileURL(playwright!).href)) as { chromium: { launch(o: Record<string, unknown>): Promise<Navegador> } };
    navegador = await chromium.launch({ executablePath: CHROMIUM!, headless: true });
  });
  afterAll(async () => { await navegador?.close(); });

  async function abrir(mascara = true): Promise<{ p: Pagina; fechar: () => Promise<void> }> {
    const ctx = await navegador.newContext();
    if (mascara) await ctx.addInitScript(mascaraDeSenha);
    const p = await ctx.newPage();
    await p.route("https://portal.exemplo/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: HTML }));
    await p.goto("https://portal.exemplo/");
    return { p, fechar: () => ctx.close() };
  }
  const seguranca = (p: Pagina, js: string) => p.evaluate<string>(js);

  it("cobre o campo de senha e continua cobrindo depois de o site trocar o type para text", async () => {
    const { p, fechar } = await abrir();
    expect(await seguranca(p, "getComputedStyle(document.getElementById('p')).webkitTextSecurity")).toBe("disc");
    await p.evaluate("(() => { const e = document.getElementById('p'); e.value = 'x'; e.type = 'text'; })()");
    expect(await seguranca(p, "getComputedStyle(document.getElementById('p')).webkitTextSecurity")).toBe("disc");
    // O campo comum não é coberto.
    expect(await seguranca(p, "getComputedStyle(document.getElementById('u')).webkitTextSecurity")).toBe("none");
    await fechar();
  });

  it("cobre o campo de senha que o site cria depois de carregar, e repõe o <style> se o site o tirar", async () => {
    const { p, fechar } = await abrir();
    await p.evaluate("(() => { const e = document.createElement('input'); e.id = 'novo'; e.type = 'password'; document.body.appendChild(e); })()");
    await p.evaluate("new Promise((r) => setTimeout(r, 50))");
    expect(await seguranca(p, "getComputedStyle(document.getElementById('novo')).webkitTextSecurity")).toBe("disc");
    await p.evaluate("(() => { document.getElementById('nod-mascara-senha').remove(); document.body.appendChild(document.createElement('div')); })()");
    await p.evaluate("new Promise((r) => setTimeout(r, 50))");
    expect(await seguranca(p, "getComputedStyle(document.getElementById('novo')).webkitTextSecurity")).toBe("disc");
    await fechar();
  });

  it("cobre o campo dentro de shadow DOM aberto e fechado, mesmo depois de o site trocar o conteúdo do root", async () => {
    const { p, fechar } = await abrir();
    const estilo = await p.evaluate<string[]>(`(async () => {
      const espera = () => new Promise((r) => setTimeout(r, 50));
      const aberto = document.createElement('div'); document.body.appendChild(aberto);
      const ra = aberto.attachShadow({ mode: 'open' });
      ra.innerHTML = '<input id="s" type="password">';
      const fechado = document.createElement('div'); document.body.appendChild(fechado);
      const rf = fechado.attachShadow({ mode: 'closed' });
      rf.innerHTML = '<input id="s" type="password">';
      await espera();
      const antes = [getComputedStyle(ra.getElementById('s')).webkitTextSecurity, getComputedStyle(rf.getElementById('s')).webkitTextSecurity];
      ra.innerHTML = '<input id="s" type="password">';
      rf.getElementById('s').type = 'text';
      await espera();
      return [...antes, getComputedStyle(ra.getElementById('s')).webkitTextSecurity, getComputedStyle(rf.getElementById('s')).webkitTextSecurity];
    })()`);
    expect(estilo).toEqual(["disc", "disc", "disc", "disc"]);
    expect(typeof (await p.evaluate(temSenhaPreenchida as never))).toBe("boolean");
    await fechar();
  });

  it("o bot nunca recebe a senha: nem no texto da página, nem no título, nem no screenshot", async () => {
    const preencher = (p: Pagina, valor: string) =>
      p.evaluate(`(() => { const e = document.getElementById('p'); e.value = ${JSON.stringify(valor)}; e.type = 'text'; e.blur(); })()`);
    const { p, fechar } = await abrir();
    await preencher(p, MARCADORA);
    const texto = await p.evaluate<string>("document.body.innerText");
    expect(texto).not.toContain(MARCADORA);
    expect(await p.title()).not.toContain(MARCADORA);
    const comMarcadora = await p.locator("#p").screenshot();
    await preencher(p, OUTRA);
    const comOutra = await p.locator("#p").screenshot();
    // Com a máscara, o campo sai igual qualquer que seja o valor: a senha não está nos pixels.
    expect(Buffer.compare(comMarcadora, comOutra)).toBe(0);
    await fechar();

    // Controle: sem a máscara, os dois valores saem diferentes (o screenshot de fato mostraria a senha).
    const sem = await abrir(false);
    await preencher(sem.p, MARCADORA);
    const semA = await sem.p.locator("#p").screenshot();
    await preencher(sem.p, OUTRA);
    const semB = await sem.p.locator("#p").screenshot();
    expect(Buffer.compare(semA, semB)).not.toBe(0);
    await sem.fechar();
  });
});
