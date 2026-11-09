import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decidirHook, type Confirmar, type SaidaHook } from "../../../src/adapters/executor/hook-nativas.ts";
import { pastaValidaNoWindows } from "../../../src/domain/caminhos.ts";

/** ADA-11 (ADR-147), QA do PR #642: o hook decidindo como no Windows, a falha fechada e a pasta que o NTFS não aceita. */
const BOT = "C:\\Users\\Bia\\nod\\ze-1";
const HOME = "C:\\Users\\Bia";
const evento = (command: string) => ({ tool_name: "Bash", tool_input: { command }, cwd: BOT });

describe("hook no Windows (ADR-147)", () => {
  it("decide com a plataforma win32: o git em C:\\ fora da pasta nega sem perguntar ao servidor (no POSIX seria pasta relativa)", async () => {
    const pedidos: string[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p.comando ?? ""); return { permitir: true }; };
    const comando = 'git -C "C:\\Windows" commit -m x';
    const win = await decidirHook(evento(comando), confirmar, { pastaDoBot: BOT, home: HOME, plataforma: "win32" });
    expect(win.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(win.hookSpecificOutput.permissionDecisionReason).toMatch(/fora da sua pasta/);
    expect(pedidos).toEqual([]);
    const posix = await decidirHook({ ...evento(comando), cwd: "/home/n/nod/ze-1" }, confirmar, { pastaDoBot: "/home/n/nod/ze-1", home: "/home/n", plataforma: "linux" });
    expect(posix.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(pedidos).toEqual([comando]);
  });

  it.each([
    'cmd /c "git -C C:\\code reset --hard"',
    'powershell -c "git -C C:/code reset --hard"',
    "pwsh -EncodedCommand ZwBpAHQAIAByAGUAcwBlAHQA",
    "cd C:/code ; $'\\147it' reset --hard",
  ])("QA do PR #642 (M16): com a plataforma win32 o hook nega %s sem perguntar ao servidor", async (comando) => {
    const pedidos: string[] = [];
    const confirmar: Confirmar = async (p) => { pedidos.push(p.comando ?? ""); return { permitir: true }; };
    const win = await decidirHook(evento(comando), confirmar, { pastaDoBot: BOT, home: HOME, plataforma: "win32" });
    expect(win.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(pedidos).toEqual([]);
  });

  it("QA 3 do PR #642 (M1): o Write fora da pasta no win32 vai ao servidor e ao checkpoint como c:/…, não como /c/… (MSYS)", async () => {
    const arquivos: string[] = [];
    const guardados: string[][] = [];
    const confirmar: Confirmar = async (p) => { arquivos.push(p.arquivo ?? ""); return { permitir: true }; };
    const ev = { tool_name: "Write", tool_input: { file_path: "C:\\Users\\Bia\\code\\x.ts", content: "x" }, cwd: BOT };
    const r = await decidirHook(ev, confirmar, { pastaDoBot: BOT, home: HOME, plataforma: "win32" }, undefined, async (g) => { guardados.push(g); });
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(arquivos).toEqual(["c:/Users/Bia/code/x.ts"]);
    expect(guardados).toEqual([["c:/Users/Bia/code/x.ts"]]);
  });

  it("o hook de verdade nega quando não consegue decidir (config ilegível): falha fechada", () => {
    const saida = execFileSync(process.execPath, ["src/adapters/executor/hook-nativas.ts", "/nao/existe/hook.json"], { input: JSON.stringify(evento("ls")), encoding: "utf8", timeout: 20_000 });
    const r = JSON.parse(saida) as SaidaHook;
    expect(r.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("pasta do turno: nomes reservados, `<>:\"|?*`, controles e ponto ou espaço no fim não existem no Windows", () => {
    for (const ok of ["Ada", "Ze 1", "Orquestrador de Sites", "Ada/nod-no-windows-fase-1-beb2a4", "Cecília", "con-sultor", "Console"]) expect(pastaValidaNoWindows(ok), ok).toBe(true);
    for (const ruim of ["CON", "nul", "Com1", "LPT9.txt", "aux.md", "Quem?", "a*b", "a<b", 'a"b', "a|b", "Ana Jr.", "Ada ", "a\u0001b", "", "Ada/", "Ada/..", "Ada/NUL"]) expect(pastaValidaNoWindows(ruim), JSON.stringify(ruim)).toBe(false);
  });
});
