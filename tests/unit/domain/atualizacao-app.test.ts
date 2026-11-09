import { describe, expect, it } from "vitest";
import { arquiteturaDoApp, decidirAtualizacaoDoApp, lerConfigAtualizacaoApp, objetoDoZip } from "../../../src/domain/atualizacao-app.ts";
import { compararVersoesDoApp, versaoAceita, versaoDoAppValida } from "../../../src/domain/versao-app.ts";

describe("NOD-132: decidir a atualização do app", () => {
  const sha256 = { arm64: "a".repeat(64), x64: "b".repeat(64) };
  const decidir = (atual: unknown, publicada: string | null, arch: "arm64" | "x64" = "arm64") => decidirAtualizacaoDoApp({ atual, config: publicada === null ? null : { versao: publicada, bucket: "b-ok", sha256 }, arch });
  it("anuncia só versão estritamente maior, com o ZIP da mesma arquitetura", () => {
    expect(decidir("1.0.0", "1.0.1")).toEqual({ anunciar: true, versao: "1.0.1", objeto: "1.0.1/nod-1.0.1-mac-arm64.zip", sha256: "a".repeat(64) });
    expect(decidir("1.9.9", "1.10.0", "x64")).toEqual({ anunciar: true, versao: "1.10.0", objeto: "1.10.0/nod-1.10.0-mac-x64.zip", sha256: "b".repeat(64) });
    expect(decidir("1.0.0-rc.2", "1.0.0")).toMatchObject({ anunciar: true });
    expect(decidir("1.0.0-rc.1", "1.0.0-rc.2")).toMatchObject({ anunciar: true });
  });
  it("nunca faz downgrade nem reanuncia a mesma versão", () => {
    expect(decidir("1.0.1", "1.0.1")).toEqual({ anunciar: false });
    expect(decidir("1.0.2", "1.0.1")).toEqual({ anunciar: false });
    expect(decidir("1.0.0", "1.0.0-rc.9")).toEqual({ anunciar: false });
    expect(decidir("2.0.0", "1.99.99")).toEqual({ anunciar: false });
  });
  it("falha fechado: desligada ou versão inválida não anuncia", () => {
    expect(decidir("1.0.0", null)).toEqual({ anunciar: false });
    for (const atual of [undefined, "", "v1.0.0", "1.0", "1.0.0-beta.1", ["1.0.0"], 1]) expect(decidir(atual, "9.0.0")).toEqual({ anunciar: false });
    expect(decidir("1.0.0", "lixo")).toEqual({ anunciar: false });
  });
  it("arquitetura só arm64 ou x64", () => {
    expect(arquiteturaDoApp("arm64")).toBe("arm64");
    expect(arquiteturaDoApp("x64")).toBe("x64");
    for (const a of ["", "universal", "ARM64", null, undefined, "../x64"]) expect(arquiteturaDoApp(a)).toBeNull();
    expect(objetoDoZip("1.2.3", "x64")).toBe("1.2.3/nod-1.2.3-mac-x64.zip");
  });
});

describe("NOD-132: comparar versões", () => {
  it("ordena e falha fechado", () => {
    expect(compararVersoesDoApp("1.0.1", "1.0.0")).toBe(1);
    expect(compararVersoesDoApp("1.0.0", "1.0.1")).toBe(-1);
    expect(compararVersoesDoApp("1.0.0", "1.0.0")).toBe(0);
    expect(compararVersoesDoApp("1.0.0", "x")).toBeNull();
    expect(versaoAceita("0.1.0", "0.1.0")).toBe(true);
    expect(versaoAceita("0.0.9", "0.1.0")).toBe(false);
    expect(versaoAceita(undefined, "0.1.0")).toBe(false);
    expect(versaoDoAppValida("1.2.3-rc.4")).toBe(true);
    expect(versaoDoAppValida("01.2.3")).toBe(false);
  });
});

describe("NOD-132: a flag do servidor", () => {
  const B = "nod-exemplos-atualizacoes";
  const SHA = `arm64=${"a".repeat(64)},x64=${"B".repeat(64)}`;
  it("versão vazia = desligada, mesmo com bucket e hash", () => {
    expect(lerConfigAtualizacaoApp({})).toBeNull();
    expect(lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "  ", NOD_APP_ATUALIZACAO_BUCKET: B, NOD_APP_ATUALIZACAO_SHA256: "lixo" })).toBeNull();
  });
  it("ligada com versão, bucket e o SHA-256 das duas arquiteturas (normalizado para minúsculas)", () => {
    expect(lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: " 1.2.0 ", NOD_APP_ATUALIZACAO_BUCKET: B, NOD_APP_ATUALIZACAO_SHA256: ` ${SHA} ` }))
      .toEqual({ versao: "1.2.0", bucket: B, sha256: { arm64: "a".repeat(64), x64: "b".repeat(64) } });
    expect(lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: B, NOD_APP_ATUALIZACAO_SHA256: `x64=${"c".repeat(64)}, arm64=${"d".repeat(64)}` })?.sha256)
      .toEqual({ arm64: "d".repeat(64), x64: "c".repeat(64) });
    // Espaço em volta do "=" (linha colada à mão) não derruba o boot.
    expect(lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: B, NOD_APP_ATUALIZACAO_SHA256: ` arm64 = ${"d".repeat(64)} , x64=${"c".repeat(64)}` })?.sha256)
      .toEqual({ arm64: "d".repeat(64), x64: "c".repeat(64) });
  });
  it("configuração inválida lança (o boot não sobe)", () => {
    expect(() => lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_SHA256: SHA })).toThrow(/exige NOD_APP_ATUALIZACAO_BUCKET/);
    expect(() => lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2", NOD_APP_ATUALIZACAO_BUCKET: "b-ok", NOD_APP_ATUALIZACAO_SHA256: SHA })).toThrow(/fora de x\.y\.z/);
    for (const b of ["Nod", "a", "-nod", "nod/x", "nod-", "gs://nod"]) expect(() => lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: b, NOD_APP_ATUALIZACAO_SHA256: SHA })).toThrow(/bucket válido/);
    expect(() => lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: B })).toThrow(/exige NOD_APP_ATUALIZACAO_SHA256/);
  });
  it("o SHA-256 exige as duas arquiteturas, 64 hex cada, sem repetição", () => {
    const a = "a".repeat(64);
    for (const sha of [`arm64=${a}`, `x64=${a}`, `arm64=${a},x64=${a.slice(1)}`, `arm64=${a},x64=${"g".repeat(64)}`, `arm64=${a},arm64=${a}`, `arm64=${a},x64=${a},universal=${a}`, `arm64=${a}=x,x64=${a}`, `arm64:${a},x64:${a}`]) {
      expect(() => lerConfigAtualizacaoApp({ NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: B, NOD_APP_ATUALIZACAO_SHA256: sha }), sha).toThrow(/NOD_APP_ATUALIZACAO_SHA256/);
    }
  });
});
