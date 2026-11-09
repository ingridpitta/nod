// NOD-97 PR 6 (definido em 2026-10-24, revisão do #515 item 1): o Sair de todos desloga também os sites com sessão em
// storage. O perfil de uma tela FECHADA guarda Local Storage/IndexedDB no disco: ao subir com a geração nova do storage
// em comum, ele sai antes do Chrome abrir. Numa tela ABERTA, o CDP apaga cada origem conhecida, até as que não estão
// numa aba.
import { spawnSync } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readdirSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { aplicarGeracaoNoPerfil, criarTela, geracaoDoPerfil, limparOrigensNoChrome, sairDasAbas } from "../../../infra/computador/tela.mjs";

const dirs: string[] = [];
const novoDir = async () => { const d = await mkdtemp(join(tmpdir(), "nod-sair-")); dirs.push(d); return d; };
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });

describe("aplicarGeracaoNoPerfil", () => {
  async function perfilComStorage(): Promise<string> {
    const p = await novoDir();
    for (const d of ["Default/Local Storage/leveldb", "Default/Session Storage", "Default/IndexedDB/https_a.com_0.indexeddb.leveldb"]) {
      await mkdir(join(p, d), { recursive: true });
      await writeFile(join(p, d, "000003.log"), "sessao");
    }
    await writeFile(join(p, "nod-storage.json"), JSON.stringify({ "https://a.com": { em: 1, hash: "h" } }));
    await writeFile(join(p, "Default", "Cookies"), "fica (os cookies saem pelo forkDoPerfil)");
    return p;
  }

  it("perfil fechado durante o Sair de todos: a geração nova apaga o storage do disco e fica gravada", async () => {
    const p = await perfilComStorage();
    expect(await aplicarGeracaoNoPerfil(p, 1)).toBe(true);
    for (const d of ["Default/Local Storage", "Default/Session Storage", "Default/IndexedDB", "nod-storage.json"]) await expect(stat(join(p, d))).rejects.toThrow();
    await expect(stat(join(p, "Default", "Cookies"))).resolves.toBeTruthy();
    expect(await geracaoDoPerfil(p)).toBe(1);
  });

  it("a mesma geração (ou uma mais velha, ou nenhuma) não apaga o storage salvo depois", async () => {
    const p = await perfilComStorage();
    await writeFile(join(p, "nod-storage-geracao"), "2");
    expect(await aplicarGeracaoNoPerfil(p, 2)).toBe(false);
    expect(await aplicarGeracaoNoPerfil(p, 1)).toBe(false);
    expect(await aplicarGeracaoNoPerfil(p, undefined)).toBe(false);
    await expect(readFile(join(p, "Default/Local Storage/leveldb/000003.log"), "utf8")).resolves.toBe("sessao");
    expect(await aplicarGeracaoNoPerfil(p, 3)).toBe(true);
    await expect(stat(join(p, "Default/Local Storage"))).rejects.toThrow();
  });
});

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

interface Dialogo { type(): string }
interface Pagina { goto(u: string): Promise<unknown>; url(): string; evaluate<T>(js: string): Promise<T>; click(s: string): Promise<void>; on(e: "dialog", h: (d: Dialogo) => void): void; route(u: string, h: (r: { fulfill(o: Record<string, unknown>): Promise<void>; request(): { url(): string } }) => Promise<void>): Promise<void> }
interface Contexto { pages(): Pagina[]; newPage(): Promise<Pagina>; close(): Promise<void> }
type Lancar = (perfil: string, o: Record<string, unknown>) => Promise<Contexto>;

describe.skipIf(!CHROMIUM || !playwright)("Sair de todos: storage num Chromium de verdade", () => {
  async function abrir(perfil: string): Promise<{ ctx: Contexto; p: Pagina }> {
    const { chromium } = (await import(pathToFileURL(playwright!).href)) as { chromium: { launchPersistentContext: Lancar } };
    const ctx = await chromium.launchPersistentContext(perfil, { executablePath: CHROMIUM!, headless: true });
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    for (const o of ["https://a.exemplo", "https://b.exemplo", "https://d.exemplo"]) await p.route(`${o}/**`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }));
    return { ctx, p };
  }
  const guardar = (p: Pagina) => p.evaluate("localStorage.setItem('sessao', 'logado')");
  const lido = (p: Pagina) => p.evaluate<string | null>("localStorage.getItem('sessao')");

  it("uma tela fechada reabre sem o storage depois de uma geração nova (e mantém com a mesma)", async () => {
    const perfil = await novoDir();
    let { ctx, p } = await abrir(perfil);
    await p.goto("https://a.exemplo/");
    await guardar(p);
    await ctx.close();
    // Mesma geração: o storage do site continua (a tela não desloga à toa).
    expect(await aplicarGeracaoNoPerfil(perfil, 0)).toBe(false);
    ({ ctx, p } = await abrir(perfil));
    await p.goto("https://a.exemplo/");
    expect(await lido(p)).toBe("logado");
    await ctx.close();
    // Houve um Sair de todos com a tela fechada: reabre deslogada.
    expect(await aplicarGeracaoNoPerfil(perfil, 1)).toBe(true);
    ({ ctx, p } = await abrir(perfil));
    await p.goto("https://a.exemplo/");
    expect(await lido(p)).toBeNull();
    await ctx.close();
  }, 60_000);

  it("numa tela aberta, o CDP apaga também a origem que não está em nenhuma aba", async () => {
    const perfil = await novoDir();
    const { ctx, p } = await abrir(perfil);
    await p.goto("https://a.exemplo/");
    await guardar(p);
    await p.goto("https://b.exemplo/");
    await guardar(p);
    await limparOrigensNoChrome(ctx, ["https://a.exemplo", "https://b.exemplo"]);
    expect(await lido(p)).toBeNull();
    await p.goto("https://a.exemplo/");
    expect(await lido(p)).toBeNull();
    await ctx.close();
  }, 60_000);

  // QA do #515: a aba aberta num SPA guarda o token na memória e o regrava no storage logo depois de limpo.
  it("sairDasAbas: a página viva não regrava a sessão e a aba volta ao endereço, deslogada", async () => {
    const perfil = await novoDir();
    const { ctx, p } = await abrir(perfil);
    await p.goto("https://b.exemplo/");
    await p.evaluate("new Promise((ok) => { const r = indexedDB.open('auth', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { r.result.close(); ok(); }; })");
    await p.goto("https://d.exemplo/app");
    await p.evaluate("(() => { const tok = 'D-999'; localStorage.setItem('sessao', tok); setInterval(() => localStorage.setItem('sessao', tok), 50); })()");
    await sairDasAbas(ctx, ["https://b.exemplo"]);
    await new Promise((r) => setTimeout(r, 300));
    expect(p.url()).toBe("https://d.exemplo/app");
    expect(await lido(p)).toBeNull();
    await p.goto("https://b.exemplo/");
    expect(await p.evaluate<string[]>("indexedDB.databases().then((l) => l.map((d) => d.name))")).toEqual([]);
    await ctx.close();
  }, 60_000);

  // Revisão do #518: o supervisor espera 15 s pela resposta a limpar_storage e mata a tela depois disso. Abas em sites
  // lentos (a volta ao endereço não carrega) não podem segurar o sairDasAbas: as voltas são em paralelo e com prazo curto.
  it("sairDasAbas termina em poucos segundos mesmo com várias abas em sites que demoram a responder", async () => {
    const perfil = await novoDir();
    const { ctx, p } = await abrir(perfil);
    const lentas: Pagina[] = [];
    for (const o of ["https://l1.exemplo", "https://l2.exemplo"]) {
      const q = await ctx.newPage();
      let vezes = 0;
      await q.route(`${o}/**`, async (r) => {
        if (vezes++ > 0) await new Promise((ok) => setTimeout(ok, 30_000));
        await r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }).catch(() => {});
      });
      await q.goto(`${o}/app`);
      lentas.push(q);
    }
    await p.goto("https://d.exemplo/app");
    await p.evaluate("sessionStorage.setItem('sessao', 'logado')");
    const inicio = Date.now();
    await sairDasAbas(ctx, []);
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(p.url()).toBe("https://d.exemplo/app");
    expect(await p.evaluate<string | null>("sessionStorage.getItem('sessao')")).toBeNull();
    await ctx.close();
  }, 120_000);

  // QA do #515 @2b363504: a aba num site que pede "sair da página?" (beforeunload, com gesto do usuário) ficava presa no
  // diálogo; a sessão CDP dessa aba travava e o supervisor matava a tela em 15 s, com o Sair de todos falhando.
  const SPA_COM_BEFOREUNLOAD = "<!doctype html><html><body><button id='b'>x</button><script>const tok=localStorage.getItem('sessao');if(tok)setInterval(()=>localStorage.setItem('sessao',tok),50);addEventListener('beforeunload',(e)=>{e.preventDefault();e.returnValue='';});</script></body></html>";
  it("sairDasAbas não fica preso no diálogo de beforeunload: a aba sai, deslogada, em poucos segundos", async () => {
    const perfil = await novoDir();
    const { ctx, p } = await abrir(perfil);
    await p.route("https://e.exemplo/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: r.request().url().endsWith("/app") ? SPA_COM_BEFOREUNLOAD : "<!doctype html><html></html>" }));
    const dialogos: string[] = [];
    let naTela: Dialogo | null = null;
    p.on("dialog", (d) => { dialogos.push(d.type()); naTela = d; }); // como a tela: guarda o diálogo e não o fecha
    await p.goto("https://e.exemplo/");
    await guardar(p);
    await p.goto("https://e.exemplo/app");
    await p.click("#b"); // o gesto do usuário que libera o beforeunload
    const inicio = Date.now();
    // Revisão do #521: o diálogo aceito no sairDasAbas é avisado, e a tela o tira de cena (senão fica um diálogo fantasma).
    await sairDasAbas(ctx, [], null, (d: unknown) => { if (naTela === d) naTela = null; });
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(dialogos).toContain("beforeunload");
    expect(naTela).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    expect(p.url()).toBe("https://e.exemplo/app");
    expect(await lido(p)).toBeNull();
    await ctx.close();
  }, 60_000);

  // Mesma rodada: uma aba travada (página em laço) segurava o newCDPSession; a limpeza usa outra aba ou uma temporária.
  it("sairDasAbas apaga o storage mesmo com a única aba travada num laço", async () => {
    const perfil = await novoDir();
    const { ctx, p } = await abrir(perfil);
    await p.route("https://f.exemplo/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body><button id='b' onclick='setTimeout(()=>{for(;;){}},50)'>x</button></body></html>" }));
    await p.goto("https://f.exemplo/");
    await guardar(p);
    await p.click("#b");
    await new Promise((r) => setTimeout(r, 300));
    const inicio = Date.now();
    await sairDasAbas(ctx, []);
    expect(Date.now() - inicio).toBeLessThan(14_000);
    const q = await ctx.newPage();
    await q.route("https://f.exemplo/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" }));
    await q.goto("https://f.exemplo/");
    expect(await lido(q)).toBeNull();
    await ctx.close();
  }, 60_000);
});

/** O Xvfb no PATH (na CI não há: o teste pula). */
const XVFB = spawnSync("sh", ["-c", "command -v Xvfb"], { encoding: "utf8" }).stdout.trim() || null;

// QA do #515: o Sair de todos numa tela REAL aberta (criarTela + Xvfb + Chromium). O site que guarda a sessão só no
// IndexedDB, sem cookie de login, não entra no índice do storage em comum: sai porque a tela anotou a origem visitada.
describe.skipIf(!CHROMIUM || !playwright || !XVFB)("Sair de todos numa tela aberta de verdade", () => {
  const pagina = (js: string) => `<!doctype html><html><head><title>t</title></head><body><pre id="e">...</pre><script>${js}</script></body></html>`;
  const mostrar = "document.getElementById('e').textContent=";
  const SITES: Record<string, Record<string, [string, string?]>> = {
    "127.0.0.2": {
      "/login": [pagina(`localStorage.setItem('tok','A');${mostrar}'estado=logado';`), "sid=a1; HttpOnly; Path=/; Max-Age=3600"],
      "/": [pagina(`${mostrar}'estado='+(localStorage.getItem('tok')?'logado':'deslogado');`)],
    },
    "127.0.0.3": {
      "/login": [pagina(`const r=indexedDB.open('auth',1);r.onupgradeneeded=()=>r.result.createObjectStore('s');r.onsuccess=()=>{const t=r.result.transaction('s','readwrite');t.objectStore('s').put('B','user');t.oncomplete=()=>{${mostrar}'estado=logado';};};`)],
      "/": [pagina(`indexedDB.databases().then((l)=>{${mostrar}'estado='+(l.some((d)=>d.name==='auth')?'logado':'deslogado');});`)],
    },
    "127.0.0.4": { "/": [pagina(`${mostrar}'neutra';`)] },
    "127.0.0.5": {
      "/login": [pagina(`history.replaceState(null,'','/');const tok='D';setInterval(()=>localStorage.setItem('tok',tok),100);${mostrar}'estado=logado';`), "sid=d1; HttpOnly; Path=/; Max-Age=3600"],
      "/": [pagina(`${mostrar}'estado='+(localStorage.getItem('tok')?'logado':'deslogado');`)],
    },
  };

  it("desloga o site rastreado, o de sessão só em IndexedDB e o SPA aberto que regrava o token", async () => {
    const srv = http.createServer((req, res) => {
      const r = SITES[(req.headers.host ?? "").split(":")[0] ?? ""]?.[new URL(req.url ?? "/", "http://x").pathname];
      if (!r) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": "text/html", ...(r[1] ? { "set-cookie": r[1] } : {}) });
      res.end(r[0]);
    });
    await new Promise<void>((ok) => srv.listen(0, "0.0.0.0", ok));
    const porta = (srv.address() as AddressInfo).port;
    const raiz = await novoDir();
    for (const d of ["perfis", "base", "ws/bot1", "logins", "run/telas/bot1", "bin"]) await mkdir(join(raiz, d), { recursive: true });
    const nada = join(raiz, "bin", "nada");
    const scrot = join(raiz, "bin", "scrot");
    await writeFile(nada, "#!/bin/sh\nexit 0\n");
    await writeFile(scrot, "#!/bin/sh\nfor a; do f=$a; done\nprintf '\\211PNG\\r\\n\\032\\n' > \"$f\"\n");
    await chmod(nada, 0o755);
    await chmod(scrot, 0o755);
    const bin = { xvfb: XVFB, openbox: nada, chromium: CHROMIUM, xdotool: nada, scrot, xclip: nada };
    const tela = criarTela({
      agenteId: "bot1", display: 90 + (process.pid % 100), raiz, run: join(raiz, "run"), ocultar: [], perfil: join(raiz, "perfis", "bot1"),
      perfilBase: join(raiz, "base"), workspace: join(raiz, "ws", "bot1"), logins: join(raiz, "logins"), tmp: join(raiz, "run/telas/bot1"),
      x11: "/tmp/.X11-unix", sandbox: false, xvfbArgs: ["-noreset"], cookies: [], storage: [], geracao: 0, bin,
    }, () => {});
    const ver = async (host: string, caminho = "/") => {
      await tela.executar({ tipo: "navegar", url: `http://${host}:${porta}${caminho}` });
      await new Promise((r) => setTimeout(r, 500));
      return ((await tela.executar({ tipo: "observar" })) as { tela: { texto: string } }).tela.texto.trim();
    };
    // QA do #515 @3c77fab4: o temporário que uma tela morta por SIGKILL deixou no perfil sai ao subir a tela.
    const orfao = join(raiz, "perfis", "bot1", "nod-origens.json.4242.7.tmp");
    await mkdir(join(raiz, "perfis", "bot1"), { recursive: true, mode: 0o700 });
    await writeFile(orfao, '["https://visitada.example"]');
    try {
      await tela.subir();
      await expect(stat(orfao)).rejects.toThrow();
      expect(await ver("127.0.0.2", "/login")).toBe("estado=logado");
      expect(await ver("127.0.0.3", "/login")).toBe("estado=logado");
      expect(await ver("127.0.0.4")).toBe("neutra");
      await tela.limparCookies();
      await tela.limparStorage(1);
      expect(await ver("127.0.0.2")).toBe("estado=deslogado");
      expect(await ver("127.0.0.3")).toBe("estado=deslogado");
      expect(await ver("127.0.0.5", "/login")).toBe("estado=logado");
      await tela.limparCookies();
      await tela.limparStorage(2);
      await new Promise((r) => setTimeout(r, 500));
      expect(await ver("127.0.0.5")).toBe("estado=deslogado");
      // Revisão do #518: um Sair de todos que falha (o Chrome caiu no meio) não pode esquecer as origens visitadas,
      // senão o próximo Sair de todos já não apaga o site de sessão só em IndexedDB.
      expect(await ver("127.0.0.3", "/login")).toBe("estado=logado");
      const origens = join(raiz, "perfis", "bot1", "nod-origens.json");
      expect(JSON.parse(await readFile(origens, "utf8"))).toContain(`http://127.0.0.3:${porta}`);
      // PR #600 (revisão rodada 3): a pessoa fecha o Chrome (dock) e clica Sair de todos. Antes, sem context, nada era
      // apagado e a geração ficava gravada como feita; agora o Chrome volta e o storage sai de verdade.
      spawnSync("pkill", ["-KILL", "-f", `user-data-dir=${join(raiz, "perfis", "bot1")}`]);
      await new Promise((r) => setTimeout(r, 1000));
      await tela.limparCookies();
      await tela.limparStorage(3);
      expect(await ver("127.0.0.3")).toBe("estado=deslogado");
      expect(await ver("127.0.0.3", "/login")).toBe("estado=logado");
      // E se o Chrome não volta, o Sair de todos falha sem esquecer as origens visitadas.
      spawnSync("pkill", ["-KILL", "-f", `user-data-dir=${join(raiz, "perfis", "bot1")}`]);
      await new Promise((r) => setTimeout(r, 1000));
      bin.chromium = nada;
      await expect(tela.limparStorage(4)).rejects.toThrow();
      expect(JSON.parse(await readFile(origens, "utf8"))).toContain(`http://127.0.0.3:${porta}`);
      bin.chromium = CHROMIUM;
    } finally {
      await tela.fechar();
      srv.close();
    }
  }, 120_000);

  // Re-QA do #515 @b9e0c2db: o olharSenha (PR 5) fazia evaluate na página com o diálogo aberto e o observar só voltava
  // quando o diálogo fechasse: o bot nunca via o diálogo para respondê-lo. O alert abre sem gesto, como o beforeunload.
  it("observar com um diálogo aberto mostra o diálogo na hora e o bot consegue respondê-lo", async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(pagina(`${mostrar}'pronta';setTimeout(()=>alert('oi'),200);`));
    });
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    const porta = (srv.address() as AddressInfo).port;
    const raiz = await novoDir();
    for (const d of ["perfis", "base", "ws/bot1", "logins", "run/telas/bot1", "bin"]) await mkdir(join(raiz, d), { recursive: true });
    const nada = join(raiz, "bin", "nada");
    const scrot = join(raiz, "bin", "scrot");
    await writeFile(nada, "#!/bin/sh\nexit 0\n");
    await writeFile(scrot, "#!/bin/sh\nfor a; do f=$a; done\nprintf '\\211PNG\\r\\n\\032\\n' > \"$f\"\n");
    await chmod(nada, 0o755);
    await chmod(scrot, 0o755);
    const tela = criarTela({
      agenteId: "bot1", display: 190 + (process.pid % 50), raiz, run: join(raiz, "run"), ocultar: [], perfil: join(raiz, "perfis", "bot1"),
      perfilBase: join(raiz, "base"), workspace: join(raiz, "ws", "bot1"), logins: join(raiz, "logins"), tmp: join(raiz, "run/telas/bot1"),
      x11: "/tmp/.X11-unix", sandbox: false, xvfbArgs: ["-noreset"], cookies: [], storage: [], geracao: 0,
      bin: { xvfb: XVFB, openbox: nada, chromium: CHROMIUM, xdotool: nada, scrot, xclip: nada },
    }, () => {});
    type Obs = { tela: { dialogo?: { tipo: string }; texto: string } };
    const comPrazo = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<"preso">((r) => setTimeout(() => r("preso"), ms))]);
    try {
      await tela.subir();
      await tela.executar({ tipo: "navegar", url: `http://127.0.0.1:${porta}/` });
      await new Promise((r) => setTimeout(r, 600));
      const r = await comPrazo(tela.executar({ tipo: "observar" }) as Promise<Obs>, 5000);
      expect(r).not.toBe("preso");
      expect((r as Obs).tela.dialogo?.tipo).toBe("alert");
      await tela.executar({ tipo: "dialogo", aceitar: true });
      const depois = (await comPrazo(tela.executar({ tipo: "observar" }) as Promise<Obs>, 5000)) as Obs;
      expect(depois.tela.dialogo).toBeUndefined();
      expect(depois.tela.texto.trim()).toBe("pronta");
    } finally {
      await tela.fechar();
      srv.close();
    }
  }, 60_000);
});
