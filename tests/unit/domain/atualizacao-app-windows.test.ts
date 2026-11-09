import { describe, expect, it } from "vitest";
import { decidirAtualizacaoDoApp, lerConfigAtualizacaoApp, objetoDoExe, plataformaDoApp } from "../../../src/domain/atualizacao-app.ts";

/** ADA-229 (ADR-152): o mesmo feed serve o instalador do Windows, só com o hash `win-x64=`. */
describe("ADA-229: atualização do app do Windows", () => {
  const mac = { arm64: "a".repeat(64), x64: "b".repeat(64) };
  const comWin = { ...mac, "win-x64": "c".repeat(64) };
  const cfg = (sha256: typeof mac | typeof comWin) => ({ versao: "1.2.0", bucket: "b-ok", sha256 });

  it("anuncia o .exe com o hash do Windows", () => {
    expect(decidirAtualizacaoDoApp({ atual: "1.1.0", config: cfg(comWin), arch: "x64", plataforma: "windows" }))
      .toEqual({ anunciar: true, versao: "1.2.0", objeto: "1.2.0/nod-1.2.0-win-x64.exe", sha256: "c".repeat(64) });
  });
  it("sem o hash win-x64 a versão não saiu para o Windows: 204", () => {
    expect(decidirAtualizacaoDoApp({ atual: "1.1.0", config: cfg(mac), arch: "x64", plataforma: "windows" })).toEqual({ anunciar: false });
  });
  it("Windows arm64 não é publicado; downgrade continua barrado", () => {
    expect(decidirAtualizacaoDoApp({ atual: "1.1.0", config: cfg(comWin), arch: "arm64", plataforma: "windows" })).toEqual({ anunciar: false });
    expect(decidirAtualizacaoDoApp({ atual: "1.2.0", config: cfg(comWin), arch: "x64", plataforma: "windows" })).toEqual({ anunciar: false });
  });
  it("o Mac não muda: sem plataforma ou mac, o ZIP", () => {
    expect(decidirAtualizacaoDoApp({ atual: "1.1.0", config: cfg(comWin), arch: "x64" })).toMatchObject({ objeto: "1.2.0/nod-1.2.0-mac-x64.zip", sha256: "b".repeat(64) });
    expect(decidirAtualizacaoDoApp({ atual: "1.1.0", config: cfg(comWin), arch: "x64", plataforma: "mac" })).toMatchObject({ objeto: "1.2.0/nod-1.2.0-mac-x64.zip" });
  });
  it("plataforma: ausente = mac, desconhecida = null", () => {
    expect(plataformaDoApp(null)).toBe("mac");
    expect(plataformaDoApp("")).toBe("mac");
    expect(plataformaDoApp("windows")).toBe("windows");
    for (const p of ["win32", "Windows", "linux", "../mac"]) expect(plataformaDoApp(p)).toBeNull();
    expect(objetoDoExe("1.0.0-rc.1")).toBe("1.0.0-rc.1/nod-1.0.0-rc.1-win-x64.exe");
  });
  it("a flag aceita win-x64 opcional, com as mesmas regras de hex e sem repetir", () => {
    const base = { NOD_APP_VERSAO_PUBLICADA: "1.2.0", NOD_APP_ATUALIZACAO_BUCKET: "b-ok" };
    const a = "a".repeat(64);
    expect(lerConfigAtualizacaoApp({ ...base, NOD_APP_ATUALIZACAO_SHA256: `arm64=${a},x64=${a},win-x64=${"E".repeat(64)}` })?.sha256)
      .toEqual({ arm64: a, x64: a, "win-x64": "e".repeat(64) });
    expect(lerConfigAtualizacaoApp({ ...base, NOD_APP_ATUALIZACAO_SHA256: `arm64=${a},x64=${a}` })?.sha256).not.toHaveProperty("win-x64");
    for (const sha of [`win-x64=${a}`, `arm64=${a},x64=${a},win-x64=${a.slice(1)}`, `arm64=${a},x64=${a},win-x64=${a},win-x64=${a}`, `arm64=${a},x64=${a},win-arm64=${a}`]) {
      expect(() => lerConfigAtualizacaoApp({ ...base, NOD_APP_ATUALIZACAO_SHA256: sha }), sha).toThrow(/NOD_APP_ATUALIZACAO_SHA256/);
    }
  });
});
