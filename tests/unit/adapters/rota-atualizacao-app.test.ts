import { afterEach, describe, expect, it, vi } from "vitest";
import { rotasAtualizacaoApp } from "../../../src/adapters/http/rotas/atualizacao-app.ts";

/** NOD-132 (ADR-149): a URL assinada nunca vai para log (gatilho de reversão), nem quando a assinatura falha. */
const SEGREDO = "X-Goog-Signature=SEGREDO123";
const config = { versao: "1.1.0", bucket: "b", sha256: { arm64: "a1".repeat(32), x64: "b2".repeat(32) } };

function chamar(assinar: (o: string) => Promise<string>) {
  const [rota] = rotasAtualizacaoApp({ config, assinar, versaoMinima: "1.0.0" });
  const resposta: { status?: number; corpo?: unknown } = {};
  const ctx = {
    req: { url: "/atualizacao?arch=x64", headers: { "x-nod-versao": "1.0.0" } },
    res: { setHeader: () => undefined, writeHead: (s: number) => { resposta.status = s; return { end: () => undefined }; } },
    json: (s: number, c: unknown) => { resposta.status = s; resposta.corpo = c; },
  };
  return { feito: rota!.handler(ctx as never), resposta };
}

describe("rota do feed da atualização: o log nunca leva a URL assinada", () => {
  afterEach(() => vi.restoreAllMocks());

  it("anunciada: a resposta tem a URL, o log não", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => { linhas.push(l); });
    const { feito, resposta } = chamar(async (o) => `https://storage.googleapis.com/b/${o}?${SEGREDO}`);
    await feito;
    expect(resposta.status).toBe(200);
    expect(JSON.stringify(resposta.corpo)).toContain("SEGREDO123");
    expect(linhas.some((l) => l.includes("atualizacao_app_anunciada"))).toBe(true);
    expect(linhas.join("\n")).not.toMatch(/SEGREDO123|storage\.googleapis|X-Goog/);
  });

  it("falha ao assinar: o log leva só o começo da mensagem, sem stack nem a URL que veio no erro", async () => {
    const linhas: string[] = [];
    vi.spyOn(console, "log").mockImplementation((l: string) => { linhas.push(l); });
    const { feito, resposta } = chamar(async () => { throw new Error(`sign_blob_403 ${"x".repeat(60)} https://storage.googleapis.com/b/o?${SEGREDO}`); });
    await feito;
    expect(resposta.status).toBe(503);
    const tudo = linhas.join("\n");
    expect(tudo).toContain("atualizacao_app_assinatura_falhou");
    expect(tudo).toContain("sign_blob_403");
    expect(tudo).not.toMatch(/SEGREDO123|storage\.googleapis|at .*\.ts/);
  });
});

describe("ADA-229: a rota com plataforma=windows", () => {
  const cfgWin = { ...config, sha256: { ...config.sha256, "win-x64": "c3".repeat(32) } };
  async function pedir(url: string, c: typeof cfgWin | typeof config = cfgWin) {
    const [rota] = rotasAtualizacaoApp({ config: c, assinar: async (o) => `https://s/${o}`, versaoMinima: "1.0.0" });
    const resposta: { status?: number; corpo?: unknown } = {};
    const ctx = {
      req: { url, headers: { "x-nod-versao": "1.0.0" } },
      res: { setHeader: () => undefined, writeHead: (s: number) => { resposta.status = s; return { end: () => undefined }; } },
      json: (s: number, corpo: unknown) => { resposta.status = s; resposta.corpo = corpo; },
    };
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    await rota!.handler(ctx as never);
    return resposta;
  }
  afterEach(() => vi.restoreAllMocks());

  it("anuncia o .exe assinado com o hash do Windows", async () => {
    const r = await pedir("/atualizacao?plataforma=windows&arch=x64");
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ url: "https://s/1.1.0/nod-1.1.0-win-x64.exe", name: "1.1.0", sha256: "c3".repeat(32) });
  });
  it("sem win-x64 na config: 204", async () => {
    expect((await pedir("/atualizacao?plataforma=windows&arch=x64", config)).status).toBe(204);
  });
  it("plataforma desconhecida: 400; sem plataforma segue o Mac", async () => {
    expect((await pedir("/atualizacao?plataforma=linux&arch=x64")).status).toBe(400);
    expect((await pedir("/atualizacao?arch=x64")).corpo).toMatchObject({ url: "https://s/1.1.0/nod-1.1.0-mac-x64.zip" });
  });
});
