import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { comPath, montarAmbiente, montarAmbienteConectorNativo } from "../../../src/domain/ambiente-executor.ts";
import { camadasDoPath, diretoriosExtrasDoWindows } from "../../../src/adapters/executor/caminho.ts";
import { encerrarGruposOrfaos, gravarArquivoDeGrupos, lerArquivoDeGrupos, matarNoBootDoWindows } from "../../../src/adapters/executor/grupos-orfaos.ts";
import { encerrarGruposVivos, registrarGruposEm } from "../../../src/adapters/executor/processo.ts";

/** ADA-11 (ADR-147): o executor no Windows, com a plataforma injetada. */
describe("ambiente do filho no Windows (ADR-147)", () => {
  const fonte = { Path: "C:\\x", SYSTEMROOT: "C:\\Windows", APPDATA: "C:\\U\\R", USERPROFILE: "C:\\U", ComSpec: "C:\\Windows\\cmd.exe", PATHEXT: ".EXE", ANTHROPIC_API_KEY: "seg" };
  it("servidor no win32 passa SystemRoot, APPDATA, USERPROFILE, ComSpec e PATHEXT, lidos sem caixa; nunca a chave", () => {
    const e = montarAmbiente("servidor", fonte, "win32");
    expect(e).toMatchObject({ PATH: "C:\\x", SystemRoot: "C:\\Windows", APPDATA: "C:\\U\\R", USERPROFILE: "C:\\U", ComSpec: "C:\\Windows\\cmd.exe", PATHEXT: ".EXE" });
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(montarAmbienteConectorNativo(fonte, "win32").SystemRoot).toBe("C:\\Windows");
  });
  it("no POSIX a allowlist segue a de sempre", () => {
    expect(montarAmbiente("servidor", fonte)).toEqual({});
  });
  it("comPath não duplica PATH e Path no Windows; no POSIX são variáveis diferentes", () => {
    expect(comPath({ Path: "velho", A: "1" }, "novo", true)).toEqual({ A: "1", PATH: "novo" });
    expect(comPath({ Path: "velho" }, "novo", false)).toEqual({ Path: "velho", PATH: "novo" });
  });
});

describe("PATH no Windows (ADR-147)", () => {
  it("as pastas do npm global, do instalador do Claude, do Node e do Git, sem as do Homebrew", () => {
    const extras = diretoriosExtrasDoWindows({ APPDATA: "C:\\U\\R", USERPROFILE: "C:\\U", ProgramFiles: "C:\\PF" });
    expect(extras).toEqual(["C:\\U\\R\\npm", "C:\\U\\.local\\bin", "C:\\PF\\nodejs", "C:\\PF\\Git\\cmd"]);
    const camadas = camadasDoPath("C:\\a", "C:\\U", null, { extras, nvm: false });
    expect(camadas.map((c) => c.dir)).not.toContain("/opt/homebrew/bin");
  });
});

describe("órfãos no boot do Windows (ADR-147)", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const preparar = (conteudo: Parameters<typeof gravarArquivoDeGrupos>[1]) => {
    dir = mkdtempSync(join(tmpdir(), "orfaos-win-"));
    const arquivo = join(dir, "grupos.json");
    gravarArquivoDeGrupos(arquivo, conteudo);
    return arquivo;
  };

  it("mata o líder e os vistos com o início batendo, e nada além da lista", async () => {
    const arquivo = preparar({ dono: { pid: 900, inicioMs: 1 }, grupos: [{ pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "", vistos: [{ pid: 11, inicioMs: 6_000 }, { pid: 12, inicioMs: 7_000 }] }] });
    const mortos: number[] = [];
    const foto = [
      { pid: 10, ppid: 1, inicioMs: 5_050 },
      { pid: 11, ppid: 10, inicioMs: 6_000 },
      { pid: 12, ppid: 10, inicioMs: 60_000 }, // pid reaproveitado: fica
      { pid: 13, ppid: 10, inicioMs: 8_000 }, // não foi visto: fica
    ];
    const r = await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => foto, matarNoWindows: (p) => mortos.push(p) });
    expect(r.assumiu).toBe(true);
    expect(mortos).toEqual([10, 11]);
  });

  it("líder vivo só com o início dentro da janela do grupo (± folga): fora dela o pid é de outro e fica", async () => {
    const grupo = (pid: number) => ({ pid, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "" });
    const arquivo = preparar({ dono: null, grupos: [grupo(20), grupo(21), grupo(22), grupo(23)] });
    const mortos: number[] = [];
    const foto = [
      { pid: 20, ppid: 1, inicioMs: 5_000 - 2_000 }, // na borda de baixo da folga: vivo
      { pid: 21, ppid: 1, inicioMs: 5_100 + 2_000 }, // na borda de cima: vivo
      { pid: 22, ppid: 1, inicioMs: 5_000 - 2_001 }, // antes da janela: reaproveitado
      { pid: 23, ppid: 1, inicioMs: 5_100 + 2_001 }, // depois da janela: reaproveitado
    ];
    const r = await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => foto, matarNoWindows: (p) => mortos.push(p) });
    expect(mortos).toEqual([20, 21]);
    expect(r.encerrados.map((e) => e.lider)).toEqual([true, true]);
  });

  it("no boot cada pid da lista morre sozinho: taskkill sem /T (o /T no líder levaria quem não foi visto)", () => {
    const chamadas: (readonly string[])[] = [];
    matarNoBootDoWindows(10, (_b, a) => { chamadas.push(a); });
    expect(chamadas).toEqual([["/F", "/PID", "10"]]);
  });

  it("dono anotado vivo (pid + início): não mata nada e não assume", async () => {
    const arquivo = preparar({ dono: { pid: 900, inicioMs: 1_000 }, grupos: [{ pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "" }] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => [{ pid: 900, ppid: 1, inicioMs: 1_500 }, { pid: 10, ppid: 900, inicioMs: 5_050 }], matarNoWindows: (p) => mortos.push(p) });
    expect(r.assumiu).toBe(false);
    expect(mortos).toEqual([]);
  });

  it("visto com pid reaproveitado menos de 2 s depois não morre no boot (revisão do PR #642, médio 4)", async () => {
    const arquivo = preparar({ dono: null, grupos: [{ pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "", vistos: [{ pid: 11, inicioMs: 6_000 }] }] });
    const mortos: number[] = [];
    await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => [{ pid: 11, ppid: 4, inicioMs: 7_500 }], matarNoWindows: (p) => mortos.push(p) });
    expect(mortos).toEqual([]);
  });

  it("dono vivo com o início do Node 30 s longe do CIM (carga, Defender) continua dono (revisão do PR #642, médio 5)", async () => {
    const arquivo = preparar({ dono: { pid: 900, inicioMs: 1_000 }, grupos: [{ pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "" }] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => [{ pid: 900, ppid: 1, inicioMs: 31_000 }, { pid: 10, ppid: 900, inicioMs: 5_050 }], matarNoWindows: (p) => mortos.push(p) });
    expect(r.assumiu).toBe(false);
    expect(mortos).toEqual([]);
  });

  it("sem foto (PowerShell falhou): ninguém morre", async () => {
    const arquivo = preparar({ dono: null, grupos: [{ pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "" }] });
    const mortos: number[] = [];
    await encerrarGruposOrfaos({ arquivo, plataforma: "win32", listarNoWindows: async () => [], matarNoWindows: (p) => mortos.push(p) });
    expect(mortos).toEqual([]);
  });

  it("revisão 14b do PR #642 (M2): o boot sem foto não apaga o arquivo; o boot seguinte com foto mata o que sobrou", async () => {
    const grupo = { pid: 10, desdeMs: 5_000, ateMs: 5_100, programa: "claude", marca: "", vistos: [{ pid: 11, inicioMs: 6_000 }] };
    const arquivo = preparar({ dono: null, grupos: [grupo] });
    const semFoto = await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => [], matarNoWindows: () => undefined });
    expect(semFoto).toMatchObject({ assumiu: true, herdados: [grupo] });
    // Esta vida liga o registro (que anota na hora) e encerra sem nenhum turno: o grupo antigo continua no arquivo.
    registrarGruposEm(arquivo, semFoto.herdados);
    encerrarGruposVivos();
    registrarGruposEm(null);
    expect(lerArquivoDeGrupos(arquivo).grupos).toEqual([grupo]);
    const mortos: number[] = [];
    await encerrarGruposOrfaos({ arquivo, plataforma: "win32", pidAtual: 1, listarNoWindows: async () => [{ pid: 10, ppid: 1, inicioMs: 5_050 }, { pid: 11, ppid: 10, inicioMs: 6_000 }], matarNoWindows: (p) => mortos.push(p) });
    expect(mortos).toEqual([10, 11]);
  });
});
