import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { conferirGitForWindows } from "../../motor/windows.ts";
import { invocarDoHook } from "../../src/adapters/executor/drivers/claude-cli.ts";
import { processosDoWindows, resolverBinario, shellDoNod } from "../../src/adapters/executor/plataforma.ts";
import { iniciarProcesso, VIGIA_DE_DESCENDENTES_MS } from "../../src/adapters/executor/processo.ts";

/**
 * ADA-11 (ADR-147): o smoke do motor no Windows de verdade (job `windows` da CI, windows-latest com o Git for Windows).
 * Fora do Windows o arquivo inteiro pula: o comportamento com a plataforma injetada mora em tests/unit.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 60_000 });
const noWindows = process.platform === "win32";
const env = (): Record<string, string> => Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined));
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarAte = async (cond: () => boolean, ms = ESPERA_MS) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 50));
  return cond();
};
const pasta = mkdtempSync(join(tmpdir(), "nod-win-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

// O filho abre um neto que ignora tudo e escreve o pid dele (como o CLI que abre o Bash do modelo).
const FILHO = `
const { spawn } = require("node:child_process");
const neto = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.stdout.write("neto " + neto.pid + "\\n");
setInterval(() => {}, 1000);
`;

const filhoQueSai = (ms: number) => FILHO.replace(/setInterval\(\(\) => \{\}, 1000\);\n$/, `setTimeout(() => process.exit(0), ${ms});\n`);

describe.runIf(noWindows)("processo no Windows (ADR-147)", () => {
  it("o Parar mata o CLI e o neto já visto em até 7 s (critério 3)", async () => {
    const linhas: string[] = [];
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", FILHO], env: env(), cwd: pasta, aoLinha: (l) => linhas.push(l), sigtermParaSigkillMs: 2_000 });
    expect(await esperarAte(() => linhas.some((l) => l.startsWith("neto ")))).toBe(true);
    const pid = p.pid!;
    const neto = Number(linhas.find((l) => l.startsWith("neto "))!.slice(5));
    // A vigia fotografa os descendentes a cada VIGIA_DE_DESCENDENTES_MS: espera uma batida e meia para o neto ser visto.
    await new Promise((r) => setTimeout(r, VIGIA_DE_DESCENDENTES_MS * 1.5));
    const t0 = Date.now();
    await p.interromper();
    expect(await esperarAte(() => !vivo(neto) && !vivo(pid), 7_000)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(7_000);
  });

  it("o neto já visto morre quando o CLI sai sozinho antes (o órfão não fica)", async () => {
    const linhas: string[] = [];
    // O filho vive uma batida e meia da vigia (o neto é visto) e sai, deixando o neto órfão.
    const fim = Math.round(VIGIA_DE_DESCENDENTES_MS * 1.5);
    const p = iniciarProcesso({ bin: process.execPath, args: ["-e", filhoQueSai(fim)], env: env(), cwd: pasta, aoLinha: (l) => linhas.push(l) });
    expect(await esperarAte(() => linhas.some((l) => l.startsWith("neto ")))).toBe(true);
    const neto = Number(linhas.find((l) => l.startsWith("neto "))!.slice(5));
    await p.fim;
    expect(await esperarAte(() => !vivo(neto), 7_000)).toBe(true);
  });

  it("a foto do CIM traz o próprio processo com o pai e o início", async () => {
    const foto = await processosDoWindows();
    const eu = foto.find((p) => p.pid === process.pid);
    expect(eu?.ppid).toBe(process.ppid);
    expect(eu?.inicioMs).toBeGreaterThan(0);
  });

  it("o shim .cmd do npm vira node + script, sem cmd.exe, e roda", () => {
    const npm = join(pasta, "npm");
    mkdirSync(join(npm, "node_modules", "falso"), { recursive: true });
    writeFileSync(join(npm, "node_modules", "falso", "cli.js"), "process.stdout.write('ok ' + process.argv.slice(2).join(' '))");
    writeFileSync(join(npm, "falso.cmd"), '@ECHO off\r\nSETLOCAL\r\n"%_prog%"  "%dp0%\\node_modules\\falso\\cli.js" %*\r\n');
    // O runner pode ter `PATH` e `Path` ao mesmo tempo: tira as duas antes de pôr só a pasta do shim.
    const semPath = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
    const alvo = resolverBinario("falso", { env: { ...semPath, Path: npm } });
    expect(alvo?.bin.toLowerCase()).toBe(process.execPath.toLowerCase());
    expect(execFileSync(alvo!.bin, [...alvo!.args, "a&b", "%PATH%"], { encoding: "utf8" })).toBe("ok a&b %PATH%");
  });

  it("a espera roda no Git Bash e devolve a saída (critério 4)", () => {
    const shell = shellDoNod();
    expect(shell.tipo).toBe("bash");
    const r = spawnSync(shell.bin, shell.args("echo $((1+2)); pwd"), { encoding: "utf8", cwd: pasta, windowsHide: true });
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe("3");
  });
});

describe.runIf(noWindows)("hook no Git Bash (ADR-147)", () => {
  const hookPath = join(process.cwd(), "src", "adapters", "executor", "hook-nativas.ts");

  it("o motor sobe: Git Bash, git.exe e o autoteste do hook pelo bash", () => {
    expect(conferirGitForWindows({ nodePath: process.execPath, hookPath })).toBeNull();
  });

  it("um PreToolUse real pelo bash.exe nega o git fora da pasta do bot com caminho C:\\ (critério 2)", () => {
    const bot = join(pasta, "nod", "Ada");
    mkdirSync(bot, { recursive: true });
    const config = join(pasta, "hook.json");
    writeFileSync(config, JSON.stringify({ url: "http://127.0.0.1:9", token: "t", pastaDoBot: bot, home: pasta, daTask: false, prazoMs: 5_000 }));
    const shell = shellDoNod();
    const comando = `${invocarDoHook({ nodePath: process.execPath, hookPath, windows: true })} '${config.replace(/\\/g, "/")}'`;
    const evento = (cmd: string) => JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd }, cwd: bot });
    const rodar = (cmd: string) => {
      const r = spawnSync(shell.bin, shell.args(comando), { input: evento(cmd), encoding: "utf8", windowsHide: true });
      return JSON.parse(r.stdout) as { hookSpecificOutput: { permissionDecision: string } };
    };
    // Dentro da pasta a cerca não nega: a negação aqui é só do servidor falso (127.0.0.1:9), não a da cerca.
    // (status e log não passam pela cerca: só o que mexe no repositório.)
    const dentro = rodar(`git -C "${bot}" commit -m x`).hookSpecificOutput as { permissionDecision: string; permissionDecisionReason?: string };
    expect(dentro.permissionDecisionReason ?? "").not.toMatch(/fora da sua pasta|não deu para conferir/);
    for (const fora of [`git -C "C:\\Windows" commit -m x`, `git -C "${bot}\\..\\.." checkout main`, `"C:\\Program Files\\Git\\cmd\\git.exe" -C C:/Windows clean -fd`, `cmd /c git -C C:\\Windows add .`]) {
      const r = rodar(fora).hookSpecificOutput as { permissionDecision: string; permissionDecisionReason?: string };
      expect(r.permissionDecision, fora).toBe("deny");
      // O `cmd /c` nega pela falha fechada do subconjunto simples (revisão 27), com a mensagem dela.
      expect(r.permissionDecisionReason, fora).toMatch(/fora da sua pasta|não deu para conferir|só passa na forma simples/);
    }
  });
});
