import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { criarFonteDeToken, URL_METADATA_TOKEN, VALIDADE_GCLOUD_MS, type ExecFileTexto } from "../../../src/adapters/voz/token-google.ts";

describe("voz: token do Google", () => {
  let saidaLog: MockInstance;
  const linhasLog = () => saidaLog.mock.calls.map((c) => String(c[0])).join("\n");
  beforeEach(() => {
    saidaLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("em produção usa o metadata server com Metadata-Flavor e guarda até 60 s antes de vencer", async () => {
    let agora = 1_000_000;
    const f = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600, token_type: "Bearer" })));
    const fonte = criarFonteDeToken({ env: { NODE_ENV: "production", NOD_VOZ_PROJETO: "meu-projeto" }, fetchImpl: f, agora: () => agora });
    expect(fonte.origem).toBe("metadata");
    expect(fonte.projeto).toBe("meu-projeto");
    expect(await fonte.token()).toBe("tok-1");
    expect(f).toHaveBeenCalledWith(URL_METADATA_TOKEN, expect.objectContaining({ headers: { "Metadata-Flavor": "Google" } }));
    agora += 3600_000 - 61_000;
    expect(await fonte.token()).toBe("tok-1");
    expect(f).toHaveBeenCalledTimes(1);
    agora += 2_000; // dentro da margem de 60 s
    await fonte.token();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("pedidos simultâneos dividem uma busca só", async () => {
    let resolver: (r: Response) => void = () => {};
    const f = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>((r) => (resolver = r)));
    const fonte = criarFonteDeToken({ env: {}, origem: "metadata", fetchImpl: f });
    const a = fonte.token();
    const b = fonte.token();
    await new Promise((r) => setTimeout(r, 0));
    resolver(new Response(JSON.stringify({ access_token: "t", expires_in: 100 })));
    expect(await Promise.all([a, b])).toEqual(["t", "t"]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("metadata fora do ar é configuração; resposta ruim é autenticação", async () => {
    const fora = criarFonteDeToken({ env: {}, origem: "metadata", fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")) });
    await expect(fora.token()).rejects.toThrow("integracao_nao_configurada");
    const ruim = criarFonteDeToken({ env: {}, origem: "metadata", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 403 })) });
    await expect(ruim.token()).rejects.toThrow("integracao_autenticacao");
  });

  it("em dev usa gcloud auth print-access-token sem shell e guarda por 10 min", async () => {
    let agora = 0;
    const exec = vi.fn<ExecFileTexto>().mockResolvedValue("ya29.token-dev\n");
    const fonte = criarFonteDeToken({ env: { NODE_ENV: "development" }, execFileImpl: exec, agora: () => agora });
    expect(fonte.origem).toBe("gcloud");
    expect(fonte.projeto).toBeNull();
    expect(await fonte.token()).toBe("ya29.token-dev");
    expect(exec).toHaveBeenCalledWith("gcloud", ["auth", "print-access-token"], expect.objectContaining({ timeout: expect.any(Number) }));
    agora = VALIDADE_GCLOUD_MS - 61_000;
    await fonte.token();
    expect(exec).toHaveBeenCalledTimes(1);
    agora = VALIDADE_GCLOUD_MS;
    await fonte.token();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it("gcloud ausente é configuração; gcloud que falha ou imprime lixo é autenticação; o token não vai ao log", async () => {
    const enoent = Object.assign(new Error("spawn gcloud ENOENT"), { code: "ENOENT" });
    await expect(criarFonteDeToken({ env: {}, execFileImpl: vi.fn<ExecFileTexto>().mockRejectedValue(enoent) }).token()).rejects.toThrow("integracao_nao_configurada");
    await expect(criarFonteDeToken({ env: {}, execFileImpl: vi.fn<ExecFileTexto>().mockRejectedValue(new Error("exit 1")) }).token()).rejects.toThrow("integracao_autenticacao");
    await expect(criarFonteDeToken({ env: {}, execFileImpl: vi.fn<ExecFileTexto>().mockResolvedValue("ERROR: (gcloud) reauth") }).token()).rejects.toThrow("integracao_autenticacao");
    const saida = linhasLog();
    expect(saida).toContain("voz_token_falhou");
    expect(saida).not.toContain("ya29");
  });
});
