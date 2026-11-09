import { describe, expect, it } from "vitest";
import {
  acharGitBash, BinarioSemSuporte, descendentes, lerProcessosDoCim, matarArvoreSync, matarVistos, pastasDoMotor,
  matarArvore, processosDoWindows, processosDoWindowsSync, programaDoSistema, vistosQueBatem, resolverBinario, scriptDoShimDoNpm, shellDoNod, variavel, type Disco,
} from "../../../src/adapters/executor/plataforma.ts";

/** ADA-11 (ADR-147): o Windows testado no Linux, com o disco e a plataforma injetados. */
const disco = (arquivos: Record<string, string>): Disco => {
  const m = new Map(Object.entries(arquivos).map(([k, v]) => [k.toLowerCase(), v]));
  return { existe: (p) => m.has(p.toLowerCase()), ler: (p) => m.get(p.toLowerCase()) ?? "" };
};
const SHIM = '@ECHO off\r\nSETLOCAL\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n';
const ENV = { Path: "C:\\Users\\Bia\\AppData\\Roaming\\npm;.;C:\\Program Files\\Git\\cmd;relativo", PATHEXT: ".COM;.exe;.Bat;.CMD", SystemRoot: "C:\\Windows" };
const win = { plataforma: "win32" as const, env: ENV, node: "C:\\node\\node.exe" };
const NPM = "C:\\Users\\Bia\\AppData\\Roaming\\npm";

describe("resolverBinario no Windows (ADR-147)", () => {
  it(".exe ganha do .cmd na mesma pasta (ordem do PATHEXT, com caixa mista)", () => {
    const d = disco({ [`${NPM}\\claude.cmd`]: SHIM, [`${NPM}\\claude.exe`]: "" });
    expect(resolverBinario("claude", { ...win, disco: d })).toEqual({ bin: `${NPM}\\claude.exe`, args: [] });
  });
  it("o shim do npm vira node + script, nunca cmd.exe; com node.exe ao lado, usa ele", () => {
    const d = disco({ [`${NPM}\\claude.cmd`]: SHIM });
    expect(resolverBinario("claude", { ...win, disco: d })).toEqual({ bin: "C:\\node\\node.exe", args: [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`] });
    const d2 = disco({ [`${NPM}\\claude.cmd`]: SHIM, [`${NPM}\\node.exe`]: "" });
    expect(resolverBinario("claude", { ...win, disco: d2 })?.bin).toBe(`${NPM}\\node.exe`);
  });
  it("caminho com espaço; a pasta atual (.) e pasta relativa do PATH são ignoradas", () => {
    const d = disco({ "C:\\Program Files\\Git\\cmd\\git.exe": "", ".\\git.exe": "", "relativo\\git.exe": "" });
    expect(resolverBinario("git", { ...win, disco: d })?.bin).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(resolverBinario("git", { ...win, disco: disco({ "relativo\\git.exe": "" }) })).toBeNull();
    // QA do PR #642 (mutante f2): as duas grafias que o `.` do PATH daria também não valem.
    expect(resolverBinario("git", { ...win, disco: disco({ ".\\git.exe": "", "git.exe": "", "relativo/git.exe": "" }) })).toBeNull();
  });
  it(".ps1 vai pelo PowerShell do sistema; .cmd que não é do npm dá erro claro", () => {
    const d = disco({ [`${NPM}\\codex.ps1`]: "" });
    expect(resolverBinario("codex", { ...win, disco: d })).toEqual({
      bin: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", `${NPM}\\codex.ps1`],
    });
    const ruim = disco({ [`${NPM}\\x.cmd`]: "@echo %PATH%" });
    expect(() => resolverBinario("x", { ...win, disco: ruim })).toThrow(BinarioSemSuporte);
  });
  it("caminho absoluto sem extensão ganha a do PATHEXT; no POSIX o nome volta igual", () => {
    expect(resolverBinario("C:\\Tools\\claude", { ...win, disco: disco({ "C:\\Tools\\claude.EXE": "" }) })?.bin).toBe("C:\\Tools\\claude.exe");
    expect(resolverBinario("claude", { plataforma: "linux" })).toEqual({ bin: "claude", args: [] });
  });
  it("o script do shim: %~dp0 também, e o que não é shim dá null", () => {
    expect(scriptDoShimDoNpm('"%~dp0\\..\\pkg\\bin\\x.js" %*', "C:\\a\\b")).toBe("C:\\a\\pkg\\bin\\x.js");
    expect(scriptDoShimDoNpm("@echo off", "C:\\a")).toBeNull();
  });
  // Revisão 6 do PR #642 (alto 1): o `@anthropic-ai/claude-code` atual tem `bin: bin/claude.exe`, e o cmd-shim grava um
  // `.cmd` que chama o .exe direto, sem node.
  const SHIM_EXE = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
  const EXE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
  it("o shim do npm que aponta para um .exe roda o .exe direto, sem node nem cmd.exe", () => {
    expect(resolverBinario("claude", { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: SHIM_EXE, [EXE]: "" }) })).toEqual({ bin: EXE, args: [] });
    expect(resolverBinario(`${NPM}\\claude.cmd`, { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: SHIM_EXE, [EXE]: "" }) })).toEqual({ bin: EXE, args: [] });
  });
  it("o shim de script não vira o node.exe do IF EXIST; .exe do shim que não existe não vale", () => {
    expect(resolverBinario("claude", { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: SHIM, [`${NPM}\\node.exe`]: "" }) })?.args).toEqual([`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]);
    expect(() => resolverBinario("claude", { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: SHIM_EXE }) })).toThrow(BinarioSemSuporte);
  });
  it("revisão 7 (médio 10): só o formato exato do cmd-shim; argumento fixo, SET ou shim de shell dão erro", () => {
    const fixo = SHIM_EXE.replace('"   %*', '" --config "%dp0%\\cfg.json" %*');
    expect(() => resolverBinario("claude", { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: fixo, [EXE]: "" }) })).toThrow(BinarioSemSuporte);
    const comSet = SHIM_EXE.replace("CALL :find_dp0", "CALL :find_dp0\r\nSET NODE_OPTIONS=--max-old-space-size=8000");
    expect(() => resolverBinario("claude", { ...win, disco: disco({ [`${NPM}\\claude.cmd`]: comSet, [EXE]: "" }) })).toThrow(BinarioSemSuporte);
    const SH = `${NPM}\\sh.exe`;
    const deShell = '@ECHO off\r\nSETLOCAL\r\nIF EXIST "%dp0%\\sh.exe" (\r\n  SET "_prog=%dp0%\\sh.exe"\r\n)\r\n"%_prog%"  "%dp0%\\node_modules\\x\\run.sh" %*\r\n';
    expect(() => resolverBinario("x", { ...win, disco: disco({ [`${NPM}\\x.cmd`]: deShell, [SH]: "" }) })).toThrow(BinarioSemSuporte);
  });
  it("revisão 7 (médio 11): com soExe, um git.ps1 antes no PATH não vira o git", () => {
    const d = disco({ [`${NPM}\\git.cmd`]: "@echo %PATH%", [`${NPM}\\git.ps1`]: "", "C:\\Program Files\\Git\\cmd\\git.exe": "" });
    expect(resolverBinario("git", { ...win, disco: d, soExe: true })?.bin).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(acharGitBash({ env: ENV, disco: disco({ ...Object.fromEntries([[`${NPM}\\git.ps1`, ""]]), "C:\\Program Files\\Git\\cmd\\git.exe": "", "C:\\Program Files\\Git\\bin\\bash.exe": "" }) })).toBe("C:\\Program Files\\Git\\bin\\bash.exe");
  });
  it(".cmd que o nod não roda não para a busca: segue para o .ps1 e as outras pastas", () => {
    const ps1 = disco({ [`${NPM}\\claude.cmd`]: "@echo %PATH%", [`${NPM}\\claude.ps1`]: "" });
    expect(resolverBinario("claude", { ...win, disco: ps1 })?.args.at(-1)).toBe(`${NPM}\\claude.ps1`);
    const outra = disco({ [`${NPM}\\git.cmd`]: "@echo %PATH%", "C:\\Program Files\\Git\\cmd\\git.exe": "" });
    expect(resolverBinario("git", { ...win, disco: outra })?.bin).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
  });
});

describe("pastas, variáveis e programas do sistema (ADR-147)", () => {
  it("Windows: %APPDATA% e %LOCALAPPDATA%; POSIX: ~/.config e ~/.local/share", () => {
    expect(pastasDoMotor({ APPDATA: "C:\\U\\R", LOCALAPPDATA: "C:\\U\\L" }, "win32")).toEqual({ config: "C:\\U\\R\\nod-motor", dados: "C:\\U\\L\\nod-motor" });
    expect(pastasDoMotor({ USERPROFILE: "C:\\U" }, "win32")).toEqual({ config: "C:\\U\\AppData\\Roaming\\nod-motor", dados: "C:\\U\\AppData\\Local\\nod-motor" });
    expect(pastasDoMotor({ HOME: "/home/x" }, "linux")).toEqual({ config: "/home/x/.config/nod-motor", dados: "/home/x/.local/share/nod-motor" });
  });
  it("variável sem caixa no Windows e com caixa no POSIX; programas do System32 pelo caminho absoluto", () => {
    expect(variavel({ PATH: "a" }, "Path", "win32")).toBe("a");
    expect(variavel({ PATH: "a" }, "Path", "linux")).toBeUndefined();
    expect(programaDoSistema("tasklist", { SYSTEMROOT: "D:\\Win" })).toBe("D:\\Win\\System32\\tasklist.exe");
  });
});

describe("shell do nod (ADR-147)", () => {
  it("Git Bash ganha do PowerShell; acha ao lado do git.exe; sem nenhum, PowerShell", () => {
    expect(shellDoNod({ plataforma: "win32", env: { ProgramFiles: "C:\\PF" }, disco: disco({ "C:\\PF\\Git\\bin\\bash.exe": "" }) })).toMatchObject({ tipo: "bash", bin: "C:\\PF\\Git\\bin\\bash.exe" });
    expect(acharGitBash({ env: { Path: "D:\\Git\\cmd" }, disco: disco({ "D:\\Git\\cmd\\git.exe": "", "D:\\Git\\bin\\bash.exe": "" }) })).toBe("D:\\Git\\bin\\bash.exe");
    const ps = shellDoNod({ plataforma: "win32", env: { SystemRoot: "C:\\Windows" }, disco: disco({}) });
    expect(ps.tipo).toBe("powershell");
    expect(ps.args("echo 1")).toEqual(["-NoProfile", "-NonInteractive", "-Command", "echo 1"]);
  });
  it("POSIX: bash, senão sh", () => {
    expect(shellDoNod({ plataforma: "linux", disco: disco({ "/usr/bin/bash": "" }) }).bin).toBe("/usr/bin/bash");
    expect(shellDoNod({ plataforma: "linux", disco: disco({}) }).tipo).toBe("sh");
  });
});

describe("árvore de processos (ADR-147)", () => {
  const foto = [
    { pid: 10, ppid: 1, inicioMs: 5_000 },
    { pid: 11, ppid: 10, inicioMs: 6_000 },
    { pid: 12, ppid: 11, inicioMs: 7_000 },
    { pid: 13, ppid: 10, inicioMs: 500 }, // nasceu antes do pai: pid reaproveitado
    { pid: 14, ppid: 99, inicioMs: 2_000 },
  ];
  it("descendentes pega filho e neto e pula o pid reaproveitado", () => {
    expect(descendentes(10, foto).map((p) => p.pid)).toEqual([11, 12]);
  });
  it("matarVistos mata a raiz e os vistos cujo início bate; pid com outro início fica vivo", () => {
    const mortos: number[] = [];
    const vistos = [{ pid: 11, ppid: 10, inicioMs: 2_000 }, { pid: 12, ppid: 11, inicioMs: 3_000 }, { pid: 15, ppid: 10, inicioMs: 4_000 }];
    const agora = [{ pid: 11, ppid: 1, inicioMs: 2_000 }, { pid: 12, ppid: 1, inicioMs: 9_000 }];
    expect(matarVistos(10, vistos, agora, (p) => mortos.push(p))).toEqual([10, 11]);
    expect(mortos).toEqual([10, 11]);
  });
  it("vistosQueBatem: só pid presente com o início exato (o visto veio do próprio CIM)", () => {
    const foto = [{ pid: 1, ppid: 0, inicioMs: 1_000 }, { pid: 2, ppid: 0, inicioMs: 90_000 }, { pid: 4, ppid: 0, inicioMs: 5_000 }];
    expect(vistosQueBatem([{ pid: 1, inicioMs: 1_000 }, { pid: 2, inicioMs: 2_000 }, { pid: 3, inicioMs: 1_000 }, { pid: 4, inicioMs: 3_500 }], foto)).toEqual([1]);
  });
  it("vistosQueBatem: pid reaproveitado 1,5 s depois do visto não é nosso (revisão do PR #642, médio 4)", () => {
    expect(vistosQueBatem([{ pid: 7, inicioMs: 10_000 }], [{ pid: 7, ppid: 0, inicioMs: 11_500 }])).toEqual([]);
    expect(vistosQueBatem([{ pid: 7, inicioMs: 10_000 }], [{ pid: 7, ppid: 0, inicioMs: 10_001 }])).toEqual([7]);
  });
  it("processosDoWindowsSync lê o CIM pelo PowerShell; falha vira lista vazia", () => {
    const json = JSON.stringify([{ ProcessId: 5, ParentProcessId: 4, CreationDate: "/Date(1730000000000)/" }]);
    expect(processosDoWindowsSync({ executar: (_b, a) => { expect(a.at(-1)).toContain("Win32_Process"); return json; } })).toEqual([{ pid: 5, ppid: 4, inicioMs: 1730000000000 }]);
    expect(processosDoWindowsSync({ executar: () => { throw new Error("sem powershell"); } })).toEqual([]);
  });
  it("matarArvoreSync no Windows monta /T /F /PID no programa do System32", () => {
    const chamadas: [string, readonly string[]][] = [];
    matarArvoreSync(42, { plataforma: "win32", env: { SystemRoot: "C:\\Windows" }, executar: (b, a) => { chamadas.push([b, a]); } });
    expect(chamadas).toEqual([[programaDoSistema("taskkill", { SystemRoot: "C:\\Windows" }), ["/T", "/F", "/PID", "42"]]]);
    expect(() => matarArvoreSync(42, { plataforma: "win32", executar: () => { throw new Error("128"); } })).not.toThrow();
    const semArvore: (readonly string[])[] = [];
    matarArvoreSync(43, { plataforma: "win32", arvore: false, executar: (_b, a) => { semArvore.push(a); } });
    expect(semArvore).toEqual([["/F", "/PID", "43"]]);
  });
  it("lê o JSON do CIM do PowerShell 5.1 (/Date()/) e do 7 (ISO); um objeto só e lixo não quebram", async () => {
    const json = JSON.stringify([
      { ProcessId: 4, ParentProcessId: 0, CreationDate: "/Date(1730000000000)/", Name: "System" },
      { ProcessId: 5, ParentProcessId: 4, CreationDate: "2024-10-27T03:33:20.000Z" },
      { ProcessId: "x", ParentProcessId: 4, CreationDate: "/Date(1)/" },
    ]);
    expect(lerProcessosDoCim(json)).toEqual([{ pid: 4, ppid: 0, inicioMs: 1_730_000_000_000, nome: "System" }, { pid: 5, ppid: 4, inicioMs: 1_730_000_000_000 }]);
    expect(lerProcessosDoCim('{"ProcessId":7,"ParentProcessId":1,"CreationDate":{"value":"/Date(5)/"}}')).toEqual([{ pid: 7, ppid: 1, inicioMs: 5 }]);
    expect(lerProcessosDoCim("não é json")).toEqual([]);
    expect(await processosDoWindows({ executar: async () => { throw new Error("sem powershell"); } })).toEqual([]);
  });
});

describe("revisão 16 do PR #642 (médio 5): o Parar não trava o event loop nem deixa PowerShell solto", () => {
  it("a foto leva o prazo ao execFile (o PowerShell que estoura morre); sem prazo, 15 s", async () => {
    const prazos: number[] = [];
    await processosDoWindows({ prazoMs: 2_000, executar: async (_b, _a, t) => { prazos.push(t); return "[]"; } });
    await processosDoWindows({ executar: async (_b, _a, t) => { prazos.push(t); return "[]"; } });
    expect(prazos).toEqual([2_000, 15_000]);
  });
  it("matarArvore: taskkill assíncrono pelo caminho absoluto, com prazo; /T só na raiz; falha não estoura", async () => {
    const chamadas: [string, readonly string[], number][] = [];
    const executar = async (b: string, a: readonly string[], t: number) => { chamadas.push([b, a, t]); return ""; };
    await matarArvore(42, { plataforma: "win32", env: { SystemRoot: "C:\\Windows" }, prazoMs: 1_500, executar });
    await matarArvore(43, { plataforma: "win32", env: { SystemRoot: "C:\\Windows" }, arvore: false, executar });
    expect(chamadas[0]![0]).toMatch(/System32[\\/]taskkill\.exe$/i);
    expect(chamadas.map((c) => [c[1], c[2]])).toEqual([[["/T", "/F", "/PID", "42"], 1_500], [["/F", "/PID", "43"], 2_000]]);
    await expect(matarArvore(44, { plataforma: "win32", executar: async () => { throw new Error("128"); } })).resolves.toBeUndefined();
  });
});

describe("revisão 27 do PR #642 (médio): o npx.cmd que vem com o Node vira node + npx-cli.js, não o .ps1", () => {
  const NODE = "C:\\Program Files\\nodejs";
  const NPX_CMD = [
    ":: Created by npm, please don't edit manually.", "@ECHO OFF", "", "SETLOCAL", "",
    'SET "NODE_EXE=%~dp0\\node.exe"', 'IF NOT EXIST "%NODE_EXE%" (', '  SET "NODE_EXE=node"', ")", "",
    'SET "NPM_PREFIX_JS=%~dp0\\node_modules\\npm\\bin\\npm-prefix.js"',
    'SET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"',
    'FOR /F "delims=" %%F IN (\'CALL "%NODE_EXE%" "%NPM_PREFIX_JS%"\') DO (', '  SET "NPM_PREFIX_NPX_CLI_JS=%%F\\node_modules\\npm\\bin\\npx-cli.js"', ")",
    'IF EXIST "%NPM_PREFIX_NPX_CLI_JS%" (', '  SET "NPX_CLI_JS=%NPM_PREFIX_NPX_CLI_JS%"', ")", "",
    '"%NODE_EXE%" "%NPX_CLI_JS%" %*', "",
  ].join("\r\n");
  it("o npx do PATH roda pelo node.exe ao lado, com o npx-cli.js", () => {
    const env = { Path: NODE, PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: "C:\\Windows" };
    const d = disco({ [`${NODE}\\npx.cmd`]: NPX_CMD, [`${NODE}\\npx.ps1`]: "", [`${NODE}\\node.exe`]: "" });
    expect(resolverBinario("npx", { plataforma: "win32", env, disco: d })).toEqual({ bin: `${NODE}\\node.exe`, args: [`${NODE}\\node_modules\\npm\\bin\\npx-cli.js`] });
  });
});
