import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { pastaDoExecutor, pastaDoMotor } from "../../../motor/conexao.ts";
import { comandoDeParear, comandoDeReinstalar, comandoParaAbrir, conferirGitForWindows, plataformaDoMotor, servidorAceitaPlataforma } from "../../../motor/windows.ts";
import { RESPOSTA_DO_AUTOTESTE, type Disco } from "../../../src/adapters/executor/plataforma.ts";

/** ADA-11 (ADR-147): o motor no Windows, com a plataforma, o disco e o bash injetados. */
const disco = (arquivos: string[]): Disco => {
  const m = new Set(arquivos.map((a) => a.toLowerCase()));
  return { existe: (p) => m.has(p.toLowerCase()), ler: () => "" };
};
const ENV = { Path: "C:\\Program Files\\Git\\cmd", ProgramFiles: "C:\\Program Files", PATHEXT: ".EXE" };
const COM_GIT = disco(["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\cmd\\git.exe"]);
const base = { plataforma: "win32" as const, env: ENV, nodePath: "C:\\node\\node.exe", hookPath: "C:\\nod\\hook-nativas.mjs" };

describe("plataforma do motor (ADR-147)", () => {
  it("win32 vai como win32; o resto segue linux, como antes", () => {
    expect(plataformaDoMotor("win32")).toBe("win32");
    expect(plataformaDoMotor("linux")).toBe("linux");
  });
  it("pastas: %APPDATA% e %LOCALAPPDATA% no Windows; NOD_MOTOR_HOME continua valendo", () => {
    const env = { APPDATA: "C:\\U\\R", LOCALAPPDATA: "C:\\U\\L" };
    expect(pastaDoMotor(env, "win32")).toBe("C:\\U\\R\\nod-motor");
    expect(pastaDoExecutor(env, "win32").replace(/\//g, "\\")).toBe("C:\\U\\L\\nod-motor\\executor");
    expect(pastaDoMotor({ HOME: "/home/n" }, "linux")).toBe("/home/n/.config/nod-motor");
    expect(pastaDoMotor({ NOD_MOTOR_HOME: "/x", APPDATA: "C:\\U\\R" }, "win32")).toBe("/x");
  });
});

describe("Git for Windows obrigatório (ADR-147)", () => {
  it("fora do Windows não confere nada", () => {
    expect(conferirGitForWindows({ ...base, plataforma: "linux", bash: () => { throw new Error("não roda"); } })).toBeNull();
  });
  it("sem o Git Bash ou sem o git.exe no PATH, recusa", () => {
    expect(conferirGitForWindows({ ...base, disco: disco([]), bash: () => ({ status: 0, stdout: RESPOSTA_DO_AUTOTESTE }) })).toBe("sem_git_bash");
    expect(conferirGitForWindows({ ...base, disco: disco(["C:\\Program Files\\Git\\bin\\bash.exe"]), bash: () => ({ status: 0, stdout: RESPOSTA_DO_AUTOTESTE }) })).toBe("sem_git");
  });
  it("roda o autoteste do hook pelo Git Bash, com caminhos em /; resposta errada ou status ≠ 0 recusa", () => {
    const chamadas: [string, string][] = [];
    expect(conferirGitForWindows({ ...base, disco: COM_GIT, bash: (b, s) => { chamadas.push([b, s]); return { status: 0, stdout: `${RESPOSTA_DO_AUTOTESTE}\r\n` }; } })).toBeNull();
    expect(chamadas).toEqual([["C:\\Program Files\\Git\\bin\\bash.exe", "'C:/node/node.exe' 'C:/nod/hook-nativas.mjs' autoteste"]]);
    expect(conferirGitForWindows({ ...base, disco: COM_GIT, bash: () => ({ status: 127, stdout: "" }) })).toBe("hook_nao_roda");
    expect(conferirGitForWindows({ ...base, disco: COM_GIT, bash: () => ({ status: 0, stdout: "{}" }) })).toBe("hook_nao_roda");
  });
  it("o hook de verdade responde ao autoteste", () => {
    const saida = execFileSync(process.execPath, ["src/adapters/executor/hook-nativas.ts", "autoteste"], { encoding: "utf8", timeout: 20_000 });
    expect(saida.trim()).toBe(RESPOSTA_DO_AUTOTESTE);
  });
});

describe("servidor que conhece o win32 (revisão do PR #642, M4)", () => {
  it("no Windows só conecta se a sessão lista o win32; fora dele, qualquer servidor", () => {
    expect(servidorAceitaPlataforma({ plataformas: ["darwin", "linux", "win32"] }, "win32")).toBe(true);
    expect(servidorAceitaPlataforma({}, "win32")).toBe(false);
    expect(servidorAceitaPlataforma({ plataformas: ["darwin", "linux"] }, "win32")).toBe(false);
    expect(servidorAceitaPlataforma({ plataformas: "win32" }, "win32")).toBe(false);
    expect(servidorAceitaPlataforma({}, "linux")).toBe(true);
  });
});

describe("mensagens e o navegador do Windows (ADA-32, ADR-151)", () => {
  it("o comando de reinstalar e o de parear seguem a plataforma", () => {
    expect(comandoDeReinstalar("https://app.nodbot.ai", "win32")).toBe("irm https://app.nodbot.ai/windows | iex");
    expect(comandoDeReinstalar("https://app.nodbot.ai", "linux")).toBe("curl -fsSL https://app.nodbot.ai/motor | sh");
    expect(comandoDeParear("https://app.nodbot.ai", "win32")).toBe("nod parear https://app.nodbot.ai");
    expect(comandoDeParear("https://app.nodbot.ai", "linux")).toBe("nod-motor parear https://app.nodbot.ai");
  });

  it("--abrir usa o explorer.exe do SystemRoot só no Windows e só com link http(s)", () => {
    const link = "https://app.nodbot.ai/?parear-maquina=ABCD-1234";
    expect(comandoParaAbrir(link, { plataforma: "win32", env: { SystemRoot: "C:\\Windows\\" } })).toEqual({ exe: "C:\\Windows\\explorer.exe", args: [link] });
    expect(comandoParaAbrir(link, { plataforma: "win32", env: {} })?.exe).toBe("C:\\Windows\\explorer.exe");
    expect(comandoParaAbrir(link, { plataforma: "linux", env: {} })).toBeNull();
    expect(comandoParaAbrir("file:///C:/Windows/System32/calc.exe", { plataforma: "win32", env: {} })).toBeNull();
    expect(comandoParaAbrir("não é link", { plataforma: "win32", env: {} })).toBeNull();
  });
});
