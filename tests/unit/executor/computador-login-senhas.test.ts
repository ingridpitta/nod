// NOD-97 PR 5 (definido em 2026-10-24, ADR-122 emenda): as senhas salvas do Chrome em comum entre as telas. O campo de
// valor nunca é decifrado aqui: viaja como BLOB em base64 e volta byte a byte igual.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, utimes } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { chaveDaLoja, chaveDasSenhas, chaveDoStorage } from "../../../infra/computador/chaves.mjs";
import { gravarLoja } from "../../../infra/computador/loja-cookies.mjs";
import {
  chaveDaLinha, esquecerSenhas, exportarDoPerfil, fundirSenhas, importarNoPerfil, instanteDaLinha, lerSenhas, loginDataDo, realmDe, recolherSenhas, senhasVazias,
} from "../../../infra/computador/login-senhas.mjs";

const pastas: string[] = [];
afterEach(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); });
async function pasta() {
  const p = await mkdtemp(join(tmpdir(), "nod-senhas-test-"));
  pastas.push(p);
  return p;
}
const CHAVE = chaveDasSenhas("d".repeat(64));
const linha = (origem: string, usuario: string, quando: number, b64: string) => ({
  origin_url: origem, signon_realm: origem, username_element: "u", username_value: usuario, password_element: "p",
  password_value: { b64 }, date_created: quando, date_password_modified: quando,
});

describe("senhas salvas: regras puras", () => {
  it("a chave é outra que a dos cookies e a do storage", () => {
    const m = "d".repeat(64);
    expect(chaveDasSenhas(m).equals(chaveDaLoja(m))).toBe(false);
    expect(chaveDasSenhas(m).equals(chaveDoStorage(m))).toBe(false);
  });

  it("a chave da linha é o UNIQUE do Chrome; o instante é a última troca, senão a criação", () => {
    const a = linha("https://a.com/", "ana", 10, "x");
    expect(chaveDaLinha(a)).toBe(chaveDaLinha(linha("https://a.com/", "ana", 999, "y")));
    expect(chaveDaLinha(a)).not.toBe(chaveDaLinha(linha("https://a.com/", "beto", 10, "x")));
    expect(instanteDaLinha({ date_created: 5, date_password_modified: 8 })).toBe(8);
    expect(instanteDaLinha({ date_created: 5, date_password_modified: 0 })).toBe(5);
    expect(realmDe("https://a.com/x?y")).toBe("https://a.com/");
    expect(realmDe("file:///etc/passwd")).toBeNull();
  });

  it("último a trocar vence por linha; o esquema entra só quando a loja está vazia", () => {
    const loja = senhasVazias();
    const lido = { esquema: [{ type: "table", name: "logins", sql: "CREATE TABLE logins(x)" }], meta: [{ key: "version", value: "43" }], linhas: [linha("https://a.com/", "ana", 10, "v1")] };
    expect(fundirSenhas(loja, lido, 1000)).toBe(true);
    expect(loja.esquema.length).toBe(1);
    expect(Object.keys(loja.linhas).length).toBe(1);
    // o mesmo conteúdo mais velho não muda nada; o esquema não é sobrescrito
    expect(fundirSenhas(loja, { linhas: [linha("https://a.com/", "ana", 9, "velha")] }, 2000)).toBe(false);
    // uma troca mais nova vence
    expect(fundirSenhas(loja, { linhas: [linha("https://a.com/", "ana", 20, "v2")] }, 3000)).toBe(true);
    const pv = loja.linhas[chaveDaLinha(linha("https://a.com/", "ana", 20, "v2"))]!.l.password_value as { b64: string };
    expect(pv.b64).toBe("v2");
  });

  it("grava cifrado e relê; sem arquivo = vazia; chave errada lança", async () => {
    const dir = await pasta();
    const arq = join(dir, "senhas.enc");
    const loja = senhasVazias();
    fundirSenhas(loja, { esquema: [], meta: [], linhas: [linha("https://a.com/", "ana", 10, "segredo-cifrado")] }, 1000);
    // gravarLoja cifra qualquer loja (cookies ou senhas); o tipo público mira a de cookies.
    await gravarLoja(arq, CHAVE, loja as unknown as Parameters<typeof gravarLoja>[2]);
    const lida = await lerSenhas(arq, CHAVE);
    expect(Object.keys(lida.linhas).length).toBe(1);
    expect((await readFile(arq)).toString("latin1")).not.toContain("ana");
    expect((await lerSenhas(join(dir, "nao-existe.enc"), CHAVE)).linhas).toEqual({});
    await expect(lerSenhas(arq, chaveDasSenhas("e".repeat(64)))).rejects.toThrow("senhas_invalidas");
  });
});

/** Um `Login Data` com o recorte do esquema do Chrome (o UNIQUE e as datas), sem precisar de um Chromium. */
const ESQUEMA = [
  { type: "table", name: "meta", sql: "CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)" },
  {
    type: "table", name: "logins",
    sql: "CREATE TABLE logins (origin_url VARCHAR NOT NULL, username_element VARCHAR, username_value VARCHAR, password_element VARCHAR, password_value BLOB, signon_realm VARCHAR NOT NULL, date_created INTEGER NOT NULL, date_password_modified INTEGER NOT NULL DEFAULT 0, id INTEGER PRIMARY KEY AUTOINCREMENT, UNIQUE (origin_url, username_element, username_value, password_element, signon_realm))",
  },
];
async function perfilSintetico() {
  const perfil = await pasta();
  await import("node:fs/promises").then((fs) => fs.mkdir(join(perfil, "Default"), { recursive: true }));
  return perfil;
}
function senhaNoPerfil(perfil: string, usuario: string): string | null {
  const db = new DatabaseSync(loginDataDo(perfil), { readOnly: true });
  try {
    const r = db.prepare("SELECT password_value FROM logins WHERE username_value = ?").get(usuario) as { password_value: Uint8Array } | undefined;
    return r ? Buffer.from(r.password_value).toString("base64") : null;
  } finally {
    db.close();
  }
}
const lojaCom = (...linhas: ReturnType<typeof linha>[]) => {
  const loja = senhasVazias();
  fundirSenhas(loja, { esquema: ESQUEMA, meta: [{ key: "version", value: "43" }], linhas }, 1000);
  return loja;
};

/** Microssegundos desde 1601, como o Chrome grava (acima de 2^53). */
const CHROME = 13_380_000_000_000_000n;
const linhaDoChrome = (usuario: string, delta: number, b64: string) => {
  const quando = (CHROME + BigInt(delta)).toString();
  return { ...linha("https://a.com/", usuario, 0, b64), date_created: { big: quando }, date_password_modified: { big: quando } } as unknown as ReturnType<typeof linha>;
};

describe("senhas salvas: no Login Data sintético", () => {
  it("datas do Chrome acima de 2^53 são lidas, comparadas e voltam iguais", async () => {
    const perfil = await perfilSintetico();
    expect(importarNoPerfil(perfil, lojaCom(linhaDoChrome("ana", 4, "dW0=")))).toBe(1);
    const lido = await exportarDoPerfil(perfil, await pasta());
    expect(lido).not.toBeNull();
    const l = lido!.linhas[0]!;
    expect(l.date_created).toEqual({ big: (CHROME + 4n).toString() });
    expect(instanteDaLinha(l)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    // Mais nova por 2 µs ainda vence (o Number perde só a unidade).
    expect(importarNoPerfil(perfil, lojaCom(linhaDoChrome("ana", 6, "ZG9pcw==")))).toBe(1);
    expect(importarNoPerfil(perfil, lojaCom(linhaDoChrome("ana", 2, "dmVsaGE=")))).toBe(0);
    expect(senhaNoPerfil(perfil, "ana")).toBe("ZG9pcw==");
  });


  it("importar não pisa na linha local mais nova (LWW também na volta) e troca a mais velha", async () => {
    const perfil = await perfilSintetico();
    // O perfil já tem a senha da ana trocada em 50 (ainda não recolhida) e a do beto de 10.
    expect(importarNoPerfil(perfil, lojaCom(linha("https://a.com/", "ana", 50, "bG9jYWw="), linha("https://a.com/", "beto", 10, "dmVsaGE=")))).toBe(2);
    // A loja traz a ana de 40 (mais velha) e o beto de 20 (mais novo).
    const n = importarNoPerfil(perfil, lojaCom(linha("https://a.com/", "ana", 40, "bG9qYQ=="), linha("https://a.com/", "beto", 20, "bm92YQ==")));
    expect(n).toBe(1);
    expect(senhaNoPerfil(perfil, "ana")).toBe("bG9jYWw=");
    expect(senhaNoPerfil(perfil, "beto")).toBe("bm92YQ==");
    // Empate fica com a local: não reescreve à toa.
    expect(importarNoPerfil(perfil, lojaCom(linha("https://a.com/", "ana", 50, "b3V0cmE=")))).toBe(0);
    expect(senhaNoPerfil(perfil, "ana")).toBe("bG9jYWw=");
  });

  it("recolher só copia o Login Data quando o mtime ou o tamanho mudou", async () => {
    const perfil = await perfilSintetico();
    const tmp = await pasta();
    const arq = join(await pasta(), "senhas.enc");
    const marcas = new Map<string, string | null>();
    expect(await recolherSenhas(arq, CHAVE, perfil, tmp, 1000, marcas)).toBe("sem_dados");
    importarNoPerfil(perfil, lojaCom(linha("https://a.com/", "ana", 10, "dW0=")));
    expect(await recolherSenhas(arq, CHAVE, perfil, tmp, 1000, marcas)).toBe("gravou");
    // Nada mudou no arquivo: nem copia (a cópia + integrity_check saem do caminho de toda ação).
    expect(await recolherSenhas(arq, CHAVE, perfil, tmp, 2000, marcas)).toBe("parado");
    // O Chrome gravou uma senha nova: a marca muda e recolhe de novo. A marca é mtime + tamanho, e o tamanho de um
    // SQLite com uma linha a mais pode não mudar; o mtime do kernel tem granulação de alguns ms, e numa máquina
    // rápida (CI no Blacksmith, 2026-11-04) as duas gravações caíam na mesma marca. O Chrome real grava segundos
    // depois: aqui o relógio do arquivo anda 1 s de propósito.
    importarNoPerfil(perfil, lojaCom(linha("https://a.com/", "beto", 20, "ZG9pcw==")));
    await utimes(loginDataDo(perfil), new Date(), new Date(Date.now() + 1000));
    expect(await recolherSenhas(arq, CHAVE, perfil, tmp, 3000, marcas)).toBe("gravou");
    expect(Object.keys((await lerSenhas(arq, CHAVE)).linhas).length).toBe(2);
    // Sem marcas (quem chama não guarda), lê sempre, como antes.
    expect(await recolherSenhas(arq, CHAVE, perfil, tmp, 4000)).toBe("igual");
  });

  it("esquecer apaga a loja, o Login Data e o Login Data For Account (com journal) de cada perfil (NOD-97 PR 6)", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const perfis = [await pasta(), await pasta()];
    const arq = join(await pasta(), "senhas.enc");
    await writeFile(arq, "x");
    const nomes = ["Login Data", "Login Data-journal", "Login Data For Account", "Login Data For Account-journal", "Cookies"];
    for (const perfil of perfis) {
      await mkdir(join(perfil, "Default"), { recursive: true });
      for (const n of nomes) await writeFile(join(perfil, "Default", n), "x");
    }
    await esquecerSenhas(arq, perfis);
    expect(existsSync(arq)).toBe(false);
    for (const perfil of perfis) {
      for (const n of nomes.slice(0, 4)) expect(existsSync(join(perfil, "Default", n)), n).toBe(false);
      // Os cookies ficam: só as senhas são esquecidas.
      expect(existsSync(join(perfil, "Default", "Cookies"))).toBe(true);
    }
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

interface Contexto { pages(): unknown[]; close(): Promise<void> }
interface Playwright { chromium: { launchPersistentContext(dir: string, o: Record<string, unknown>): Promise<Contexto> } }

describe.skipIf(!CHROMIUM || !playwright)("senhas salvas: no Login Data de verdade", () => {
  it("exporta de um perfil, cria o Login Data noutro pelo esquema e o BLOB cifrado volta byte a byte igual", async () => {
    const { chromium } = (await import(pathToFileURL(playwright!).href)) as Playwright;
    // Um perfil real: o Chromium cria o Default/Login Data com o esquema e a meta (version) de verdade.
    const perfilA = await pasta();
    const ctx = await chromium.launchPersistentContext(perfilA, { executablePath: CHROMIUM!, headless: true });
    await ctx.close();
    // Insere uma linha com um valor "cifrado" sintético direto no Login Data real (como o Safe Storage faria: um BLOB).
    const blob = Buffer.from([0x76, 0x31, 0x30, 0, 1, 2, 3, 255, 254, 0, 42]);
    const arqA = loginDataDo(perfilA);
    const dbA = new DatabaseSync(arqA);
    const cols = new Set(dbA.prepare("PRAGMA table_info(logins)").all().map((c: Record<string, unknown>) => c.name as string));
    // As colunas NOT NULL sem default do Chrome (blacklisted_by_user, scheme) entram como o Chrome grava um login comum.
    const valores: Record<string, unknown> = {
      origin_url: "https://site.exemplo/", signon_realm: "https://site.exemplo/", username_element: "u", username_value: "ana",
      password_element: "p", password_value: blob, date_created: 13000000000000000n, date_password_modified: 13000000000000000n,
      blacklisted_by_user: 0, scheme: 0,
    };
    const campos = Object.keys(valores).filter((c) => cols.has(c));
    dbA.prepare(`INSERT INTO logins (${campos.join(", ")}) VALUES (${campos.map(() => "?").join(", ")})`).run(...campos.map((c) => valores[c] as never));
    dbA.close();

    const lido = await exportarDoPerfil(perfilA, await pasta());
    expect(lido).not.toBeNull();
    expect(lido!.linhas.length).toBe(1);
    expect(lido!.esquema.some((o) => o.name === "logins")).toBe(true);

    const loja = senhasVazias();
    expect(fundirSenhas(loja, lido!, Date.now())).toBe(true);

    // Perfil novo, sem Login Data: importar cria o arquivo pelo esquema guardado.
    const perfilB = await pasta();
    const dirB = join(perfilB, "Default");
    await import("node:fs/promises").then((fs) => fs.mkdir(dirB, { recursive: true }));
    expect(importarNoPerfil(perfilB, loja)).toBe(1);

    const voltou = await exportarDoPerfil(perfilB, await pasta());
    expect(voltou!.linhas.length).toBe(1);
    const v = voltou!.linhas[0] as Record<string, unknown>;
    expect(v.username_value).toBe("ana");
    // O ponto do PR: ninguém decifra; o BLOB volta idêntico.
    const pv = v.password_value as { b64: string };
    expect(Buffer.from(pv.b64, "base64").equals(blob)).toBe(true);
  });
});
