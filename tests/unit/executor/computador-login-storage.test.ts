// NOD-97 PR 4 (definido em 2026-10-24, ADR-122 emenda): o storage por origem em comum entre as telas.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chaveDaLoja, chaveDoStorage } from "../../../infra/computador/chaves.mjs";
import {
  arquivoDaOrigem, coletarNaPagina, decidir, estadoVazio, gravarOrigem, hashDosDados, hostCasa, lerEstado, lerTudo, limparStorage,
  comPrazo, origemDe, origemTemLogin, restaurarOrigem, ritmoDeColeta, TETO_STORAGE_BYTES,
} from "../../../infra/computador/login-storage.mjs";

const pastas: string[] = [];
afterEach(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); });
async function pasta() {
  const p = await mkdtemp(join(tmpdir(), "nod-storage-test-"));
  pastas.push(p);
  return p;
}
const CHAVE = chaveDoStorage("b".repeat(64));
const dados = (v: string) => ({ localStorage: [["token", v]], indexedDB: [], pulados: [] });
const item = (origem: string, em: number, v: string) => ({ origem, em, hash: hashDosDados(dados(v)), dados: dados(v) });

describe("storage por origem: regras", () => {
  it("a chave é outra que a dos cookies", () => {
    expect(chaveDoStorage("b".repeat(64)).equals(chaveDaLoja("b".repeat(64)))).toBe(false);
  });

  it("origem com login = cookie httpOnly vivo que vai para o host", () => {
    const agora = 1_800_000_000_000;
    const ck = (o: Record<string, unknown>) => ({ name: "sid", value: "x", domain: ".exemplo.com", path: "/", httpOnly: true, expires: -1, ...o });
    expect(origemTemLogin("https://mail.exemplo.com", [ck({})], agora)).toBe(true);
    expect(origemTemLogin("https://exemplo.com", [ck({})], agora)).toBe(true);
    expect(origemTemLogin("https://mail.exemplo.com", [ck({ httpOnly: false })], agora)).toBe(false);
    expect(origemTemLogin("https://mail.exemplo.com", [ck({ expires: agora / 1000 - 1 })], agora)).toBe(false);
    expect(origemTemLogin("https://outroexemplo.com", [ck({})], agora)).toBe(false);
    expect(hostCasa("a.b.com", "b.com")).toBe(true);
    expect(hostCasa("ab.com", "b.com")).toBe(false);
    expect(origemDe("https://a.com/x?y")).toBe("https://a.com");
    expect(origemDe("file:///etc/passwd")).toBeNull();
    expect(origemDe("about:blank")).toBeNull();
  });

  it("último a escrever vence, por origem; o mesmo conteúdo não regrava", () => {
    const e = estadoVazio();
    expect(decidir(e, "https://a.com", 10, "h1")).toBe("gravar");
    e.versoes["https://a.com"] = { em: 10, hash: "h1" };
    expect(decidir(e, "https://a.com", 20, "h1")).toBe("igual");
    expect(decidir(e, "https://a.com", 5, "h2")).toBe("velho");
    expect(decidir(e, "https://a.com", 11, "h2")).toBe("gravar");
    expect(decidir(e, "https://b.com", 1, "h1")).toBe("gravar");
  });

  it("o hash ignora `pulados` (o que fica em cada perfil): o mesmo conteúdo dá o mesmo hash em bots diferentes", () => {
    const comBlob = { ...dados("x"), pulados: ["com-blob"] };
    expect(hashDosDados(comBlob)).toBe(hashDosDados(dados("x")));
    expect(hashDosDados(dados("y"))).not.toBe(hashDosDados(dados("x")));
  });

  it("grava cifrado, lê tudo, recusa o velho e o acima do teto, e limpar sobe a geração", async () => {
    const dir = await pasta();
    expect(await gravarOrigem(dir, CHAVE, item("https://a.com", 10, "1"))).toBe("gravou");
    expect(await gravarOrigem(dir, CHAVE, item("https://a.com", 9, "0"))).toBe("velho");
    expect(await gravarOrigem(dir, CHAVE, item("https://a.com", 11, "1"))).toBe("igual");
    expect(await gravarOrigem(dir, CHAVE, item("https://b.com", 12, "b"))).toBe("gravou");
    expect(await gravarOrigem(dir, CHAVE, item("https://a.com/caminho", 30, "x"))).toBe("velho");
    const grande = { origem: "https://c.com", em: 1, hash: "h", dados: { localStorage: [["x", "y".repeat(TETO_STORAGE_BYTES)]] } };
    expect(await gravarOrigem(dir, CHAVE, grande)).toBe("grande");
    const tudo = await lerTudo(dir, CHAVE);
    expect(tudo.itens.map((i) => [i.origem, i.dados.localStorage[0]?.[1]]).sort()).toEqual([["https://a.com", "1"], ["https://b.com", "b"]]);
    expect((await readFile(arquivoDaOrigem(dir, "https://a.com"))).toString("latin1")).not.toContain("token");
    await expect(lerEstado(dir, chaveDoStorage("c".repeat(64)))).rejects.toThrow("storage_invalido");
    expect(await limparStorage(dir, CHAVE)).toBe(1);
    expect((await lerTudo(dir, CHAVE)).itens).toEqual([]);
    expect((await readdir(dir)).filter((n) => n.endsWith(".enc"))).toEqual(["estado.enc"]);
    expect((await lerEstado(dir, CHAVE)).geracao).toBe(1);
  });
});

/** Um Chromium já baixado nesta máquina (na CI não há: o teste pula). */
function chromiumLocal(): string | null {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
    const bin = join(base, d, "chrome-linux64", "chrome");
    // Abre de verdade: sem as bibliotecas do sistema o binário existe mas não sobe.
    if (existsSync(bin) && spawnSync(bin, ["--headless", "--version"], { timeout: 10_000 }).status === 0) return bin;
  }
  return null;
}
const CHROMIUM = chromiumLocal();
const INFRA = fileURLToPath(new URL("../../../infra/computador/", import.meta.url));
let playwright: string | null = null;
try { playwright = createRequire(join(INFRA, "x.js")).resolve("playwright-core"); } catch { playwright = null; }

// Só o que o teste usa do playwright-core (ele mora em infra/computador/node_modules, fora dos tipos da raiz).
interface Pagina {
  evaluate<R, A>(f: (a: A) => R | Promise<R>, arg: A): Promise<R>;
  evaluate<R>(f: () => R | Promise<R>): Promise<R>;
  route(url: string, h: (r: { fulfill(o: Record<string, unknown>): Promise<void> }) => unknown): Promise<void>;
  goto(url: string): Promise<unknown>;
}
interface Contexto { pages(): Pagina[]; newPage(): Promise<Pagina>; newCDPSession(p: Pagina): Promise<{ send(m: string, a: unknown): Promise<unknown> }>; close(): Promise<void> }
// Os scripts de página abaixo rodam no Chromium; o tsconfig do servidor não tem a lib "dom".
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const indexedDB: any;
type IDBDatabase = any;
type IDBValidKey = any;
/* eslint-enable @typescript-eslint/no-explicit-any */
interface Playwright { chromium: { launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<Contexto> } }

describe("storage por origem: ritmo e prazo da coleta", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("coleta segurada pelo ritmo agenda a rodada do fim da janela (o login gravado logo depois não se perde)", async () => {
    vi.useFakeTimers();
    const rodadas: number[] = [];
    const ritmo = ritmoDeColeta({ intervalo: 10_000, aoVencer: () => rodadas.push(Date.now()), agora: () => Date.now() });
    const inicio = Date.now();
    expect(ritmo.liberar("https://a.example")).toBe(true);
    vi.advanceTimersByTime(3_000);
    expect(ritmo.liberar("https://a.example")).toBe(false); // dentro da janela: segura e agenda
    expect(ritmo.liberar("https://a.example")).toBe(false); // não agenda duas vezes
    expect(ritmo.liberar("https://b.example")).toBe(true); // outra origem tem a própria janela
    vi.advanceTimersByTime(6_999);
    expect(rodadas).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(rodadas).toEqual([inicio + 10_000]);
    expect(ritmo.liberar("https://a.example")).toBe(true); // a rodada agendada já pode coletar
    vi.advanceTimersByTime(60_000);
    expect(rodadas).toHaveLength(1);
  });

  it("forçar (antes de navegar e ao fechar) passa por cima do ritmo; parar cancela a rodada agendada", () => {
    vi.useFakeTimers();
    const aoVencer = vi.fn();
    const ritmo = ritmoDeColeta({ intervalo: 10_000, aoVencer });
    expect(ritmo.liberar("https://a.example")).toBe(true);
    expect(ritmo.liberar("https://a.example", true)).toBe(true);
    expect(ritmo.liberar("https://a.example")).toBe(false);
    ritmo.parar();
    vi.advanceTimersByTime(20_000);
    expect(aoVencer).not.toHaveBeenCalled();
  });

  it("coleta sem prazo não trava: a página que nunca responde vira null depois do prazo", async () => {
    vi.useFakeTimers();
    const nunca = new Promise<string>(() => {});
    const r = comPrazo(nunca, 5_000);
    vi.advanceTimersByTime(5_000);
    expect(await r).toBeNull();
    expect(await comPrazo(Promise.resolve("ok"), 5_000)).toBe("ok");
  });
});

describe.skipIf(!CHROMIUM || !playwright)("storage por origem: no Chromium de verdade", () => {
  it("coleta numa aba e restaura noutro perfil: localStorage e IndexedDB com tipos ricos; troca só os bancos que vieram", async () => {
    const { chromium } = (await import(pathToFileURL(playwright!).href)) as Playwright;
    const ORIGEM = "https://app.nod-teste.example";
    const vazia = (r: { fulfill(o: Record<string, unknown>): Promise<void> }) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" });
    const abrir = async () => {
      const ctx = await chromium.launchPersistentContext(await pasta(), { executablePath: CHROMIUM!, headless: true });
      const p = ctx.pages()[0] ?? (await ctx.newPage());
      const cdp = await ctx.newCDPSession(p);
      await cdp.send("Network.setBypassServiceWorker", { bypass: true });
      await p.route("**/*", vazia);
      await p.goto(`${ORIGEM}/`);
      return { ctx, p };
    };
    const a = await abrir();
    let coletado: Awaited<ReturnType<typeof coletarNaPagina>>;
    try {
      await a.p.evaluate(async () => {
        localStorage.setItem("token", "abc");
        localStorage.setItem("vazio", "");
        const db = await new Promise<IDBDatabase>((ok) => {
          const r = indexedDB.open("auth", 3);
          r.onupgradeneeded = () => {
            const s = r.result.createObjectStore("usuarios", { keyPath: "id" });
            s.createIndex("email", "email", { unique: true });
            r.result.createObjectStore("solta", { autoIncrement: true });
          };
          r.onsuccess = () => ok(r.result);
        });
        const tx = db.transaction(["usuarios", "solta"], "readwrite");
        tx.objectStore("usuarios").put({ id: 1, email: "a@b.c", criado: new Date(5), bytes: new Uint8Array([1, 2, 3]), tags: new Set(["x"]), mapa: new Map([["k", 1n]]), nada: undefined });
        tx.objectStore("solta").put("valor", ["chave", 2]);
        await new Promise((ok) => { tx.oncomplete = ok; });
        db.close();
        const ruim = await new Promise<IDBDatabase>((ok) => {
          const r = indexedDB.open("com-blob", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("b");
          r.onsuccess = () => ok(r.result);
        });
        const t2 = ruim.transaction("b", "readwrite");
        t2.objectStore("b").put(new Blob(["x"]), 1);
        await new Promise((ok) => { t2.oncomplete = ok; });
        ruim.close();
      });
      coletado = await a.p.evaluate(coletarNaPagina);
    } finally {
      await a.ctx.close();
    }
    expect(coletado.pulados).toEqual(["com-blob"]);
    expect(coletado.localStorage).toEqual([["token", "abc"], ["vazio", ""]]);
    // Ida e volta pelo JSON (é assim que vai por IPC e para o disco).
    const viaJson = JSON.parse(JSON.stringify(coletado));
    const b = await abrir();
    try {
      // A restauração roda em página vazia (subida ou origem sem aba): nenhuma conexão aberta segura o banco velho.
      await b.p.evaluate(async () => {
        localStorage.setItem("velho", "1");
        await new Promise((ok) => { const r = indexedDB.open("velho", 1); r.onsuccess = () => { r.result.close(); ok(null); }; });
        // O banco com Blob deste perfil (pulado na coleta do outro bot) não é apagado na restauração.
        // Com um Blob dentro, como no outro perfil: senão a coleta deste o levaria (vazio) e o hash não bateria.
        await new Promise((ok) => {
          const r = indexedDB.open("com-blob", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("b");
          r.onsuccess = () => { const t = r.result.transaction("b", "readwrite"); t.objectStore("b").put(new Blob(["y"]), 1); t.oncomplete = () => { r.result.close(); ok(null); }; };
        });
      });
      const hashFicou = await restaurarOrigem(b.p, viaJson);
      const lido = await b.p.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((ok) => { const r = indexedDB.open("auth"); r.onsuccess = () => ok(r.result); });
        const pegar = <T,>(s: string, k: IDBValidKey) => new Promise<T>((ok) => { const r = db.transaction(s).objectStore(s).get(k); r.onsuccess = () => ok(r.result as T); });
        const u = await pegar<Record<string, unknown>>("usuarios", 1);
        const solta = await pegar<string>("solta", ["chave", 2]);
        const porEmail = await new Promise((ok) => { const r = db.transaction("usuarios").objectStore("usuarios").index("email").get("a@b.c"); r.onsuccess = () => ok(Boolean(r.result)); });
        const versao = db.version;
        db.close();
        return {
          ls: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
          bancos: (await indexedDB.databases()).map((d: { name: string }) => d.name).sort(),
          versao, solta, porEmail,
          criado: (u.criado as Date).getTime(), bytes: [...(u.bytes as Uint8Array)], tags: [...(u.tags as Set<string>)],
          mapa: String((u.mapa as Map<string, bigint>).get("k")), temNada: "nada" in u,
        };
      });
      expect(lido).toEqual({
        // "velho" não veio no snapshot: fica (a restauração só troca os bancos que vieram).
        ls: { token: "abc", vazio: "" }, bancos: ["auth", "com-blob", "velho"], versao: 3, solta: "valor", porEmail: true,
        criado: 5, bytes: [1, 2, 3], tags: ["x"], mapa: "1", temNada: true,
      });
      // O hash devolvido é o do que ficou na aba (com o "velho" daqui): a próxima coleta não parece mudança (sem ping-pong).
      expect(hashDosDados(await b.p.evaluate(coletarNaPagina))).toBe(hashFicou);
      expect(hashFicou).not.toBe(hashDosDados(viaJson));
    } finally {
      await b.ctx.close();
    }
  }, 60_000);
  it("a restauração não apaga nem troca banco do receptor: o que não veio fica, e o banco com Blob daqui ganha do de mesmo nome", async () => {
    // Cenário do Revisor (#515): A tem só "app" sem Blob; B tem "media" e "app" com Blob. Antes, B ficava só com "app"
    // e o Blob dele virava o "token" de A: perda silenciosa de dados de outro bot.
    const { chromium } = (await import(pathToFileURL(playwright!).href)) as Playwright;
    const ORIGEM = "https://app.nod-teste.example";
    const vazia = (r: { fulfill(o: Record<string, unknown>): Promise<void> }) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html></html>" });
    const abrir = async () => {
      const ctx = await chromium.launchPersistentContext(await pasta(), { executablePath: CHROMIUM!, headless: true });
      const p = ctx.pages()[0] ?? (await ctx.newPage());
      await p.route("**/*", vazia);
      await p.goto(`${ORIGEM}/`);
      return { ctx, p };
    };
    const gravar = (p: Pagina, banco: string, valor: "blob" | string) => p.evaluate(async ([banco, valor]) => {
      await new Promise((ok) => {
        const r = indexedDB.open(banco, 1);
        r.onupgradeneeded = () => r.result.createObjectStore("s");
        r.onsuccess = () => {
          const t = r.result.transaction("s", "readwrite");
          t.objectStore("s").put(valor === "blob" ? new Blob(["meu"]) : valor, "k");
          t.oncomplete = () => { r.result.close(); ok(null); };
        };
      });
    }, [banco, valor] as const);
    const a = await abrir();
    let deA: Awaited<ReturnType<typeof coletarNaPagina>>;
    try {
      await gravar(a.p, "app", "token");
      deA = JSON.parse(JSON.stringify(await a.p.evaluate(coletarNaPagina)));
    } finally {
      await a.ctx.close();
    }
    expect(deA.pulados).toEqual([]);
    const b = await abrir();
    try {
      await gravar(b.p, "media", "foto");
      await gravar(b.p, "app", "blob");
      await restaurarOrigem(b.p, deA);
      const lido = await b.p.evaluate(async () => {
        const ler = (banco: string) => new Promise<unknown>((ok) => {
          const r = indexedDB.open(banco);
          r.onsuccess = () => { const g = r.result.transaction("s").objectStore("s").get("k"); g.onsuccess = () => { r.result.close(); ok(g.result); }; };
        });
        const app = await ler("app");
        return {
          bancos: (await indexedDB.databases()).map((d: { name: string }) => d.name).sort(),
          media: await ler("media"),
          appEhBlob: app instanceof Blob,
          appTexto: app instanceof Blob ? await app.text() : app,
        };
      });
      expect(lido).toEqual({ bancos: ["app", "media"], media: "foto", appEhBlob: true, appTexto: "meu" });
    } finally {
      await b.ctx.close();
    }
  }, 60_000);
});
