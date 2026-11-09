import { describe, expect, it } from "vitest";
import { BinarioSemSuporte, comoRodar, type Disco } from "../../../src/adapters/executor/plataforma.ts";

// Revisão do PR #642 (médio 6): o `nod-motor entrar claude|codex` com o CLI do npm (`.cmd`) no Windows.
const SHIM = '@ECHO off\r\nnode  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
const disco = (arquivos: Record<string, string>): Disco => ({ existe: (p) => p in arquivos, ler: (p) => arquivos[p] ?? "" });

describe("comoRodar", () => {
  it("no POSIX vai como veio", () => {
    expect(comoRodar("/usr/bin/claude", { plataforma: "linux" })).toEqual({ bin: "/usr/bin/claude", args: [] });
  });
  it("no Windows o shim .cmd do npm vira node + script", () => {
    const cmd = "C:\\Users\\bia\\AppData\\Roaming\\npm\\claude.cmd";
    const alvo = comoRodar(cmd, { plataforma: "win32", env: {}, disco: disco({ [cmd]: SHIM }), node: "C:\\node\\node.exe" });
    expect(alvo).toEqual({ bin: "C:\\node\\node.exe", args: ["C:\\Users\\bia\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js"] });
  });
  it("no Windows o .exe roda direto e o .cmd que não é do npm é recusado", () => {
    const exe = "C:\\Users\\bia\\.local\\bin\\claude.exe";
    expect(comoRodar(exe, { plataforma: "win32", env: {}, disco: disco({ [exe]: "" }) })).toEqual({ bin: exe, args: [] });
    const outro = "C:\\x\\codex.cmd";
    expect(() => comoRodar(outro, { plataforma: "win32", env: {}, disco: disco({ [outro]: "@echo %PATH%" }) })).toThrow(BinarioSemSuporte);
  });
  it("no Windows o binário que sumiu dá null", () => {
    expect(comoRodar("C:\\sumiu\\claude.exe", { plataforma: "win32", env: {}, disco: disco({}) })).toBeNull();
  });
});
