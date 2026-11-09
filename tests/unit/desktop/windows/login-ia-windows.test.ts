import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { Disco } from "../../../../src/adapters/executor/plataforma.ts";
import { abrirInstalacao, alvoDoLogin, ambienteDoLoginNoWindows, daJanelaWeb, entrarNaIa, nodeDoMotor, pastasDasIas, type DepsLogin } from "../../../../desktop/windows/login-ia-windows.ts";

/**
 * ADA-229 (5/11/2026): o "Entrar" dos cartões de IA na janela do Windows. Sem Electron e sem Windows: o disco e o
 * spawn são falsos, e a plataforma é forçada para win32 dentro do módulo.
 */
const ENV = { APPDATA: "C:\\Users\\ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local", USERPROFILE: "C:\\Users\\ana", Path: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd", SystemRoot: "C:\\Windows", ANTHROPIC_API_KEY: "sk-x", OPENAI_API_KEY: "sk-y", NOD_HOME: "x" };
const NPM = "C:\\Users\\ana\\AppData\\Roaming\\npm";
const SHIM_NODE = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js"   %*\r\n';
const SHIM_EXE = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.exe"   %*\r\n';

function disco(arquivos: Record<string, string>): Disco {
  return { existe: (p) => p in arquivos, ler: (p) => arquivos[p] ?? "" };
}

describe("ADA-229: onde as IAs estão no Windows", () => {
  it("as pastas do instalador do motor: o prefixo do npm e o bin do nod", () => {
    expect(pastasDasIas(ENV)).toEqual([NPM, "C:\\Users\\ana\\AppData\\Local\\nod\\bin"]);
    expect(pastasDasIas({})).toEqual([]);
  });
  it("o ambiente do login: limpo como no Mac e com as pastas das IAs na frente do Path, sem repetir", () => {
    const env = ambienteDoLoginNoWindows(ENV);
    expect(env.Path).toBe(`${NPM};C:\\Users\\ana\\AppData\\Local\\nod\\bin;C:\\Windows\\System32;C:\\Program Files\\Git\\cmd`);
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("NOD_HOME");
    expect(env.SystemRoot).toBe("C:\\Windows");
    const deNovo = ambienteDoLoginNoWindows({ ...ENV, Path: `${NPM.toLowerCase()};C:\\x` });
    expect(deNovo.Path).toBe(`C:\\Users\\ana\\AppData\\Local\\nod\\bin;${NPM.toLowerCase()};C:\\x`);
    expect(ambienteDoLoginNoWindows({ APPDATA: ENV.APPDATA }).Path).toBe(NPM);
  });
  it("o Node do motor só quando está lá", () => {
    const node = "C:\\Users\\ana\\AppData\\Local\\nod\\node\\node.exe";
    expect(nodeDoMotor(ENV, disco({ [node]: "" }))).toBe(node);
    expect(nodeDoMotor(ENV, disco({}))).toBeNull();
    expect(nodeDoMotor({}, disco({ [node]: "" }))).toBeNull();
  });
});

describe("ADA-229: como rodar o login sem o cmd.exe", () => {
  const env = ambienteDoLoginNoWindows(ENV);
  it("o .cmd do npm que chama um script vira node + script + os argumentos do login", () => {
    const a = alvoDoLogin("codex-cli", { env, disco: disco({ [`${NPM}\\codex.cmd`]: SHIM_NODE }), node: "C:\\nod\\node.exe" });
    expect(a).toEqual({ bin: "C:\\nod\\node.exe", args: [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, "login"] });
  });
  it("o .cmd do npm que chama um .exe roda o .exe", () => {
    const exe = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.exe`;
    const a = alvoDoLogin("claude-cli", { env, disco: disco({ [`${NPM}\\claude.cmd`]: SHIM_EXE, [exe]: "" }) });
    expect(a).toEqual({ bin: exe, args: ["auth", "login"] });
  });
  it("um claude.exe no Path ganha do .cmd ao lado", () => {
    const a = alvoDoLogin("claude-cli", { env, disco: disco({ [`${NPM}\\claude.exe`]: "", [`${NPM}\\claude.cmd`]: SHIM_NODE }) });
    expect(a).toEqual({ bin: `${NPM}\\claude.exe`, args: ["auth", "login"] });
  });
  it("sem a IA, ou com um .cmd que o nod não roda: null (a tela diz para instalar)", () => {
    expect(alvoDoLogin("claude-cli", { env, disco: disco({}) })).toBeNull();
    expect(alvoDoLogin("claude-cli", { env, disco: disco({ [`${NPM}\\claude.cmd`]: "@echo off\r\ncall outra-coisa %*\r\n" }) })).toBeNull();
  });
});

type Filho = EventEmitter & { unref(): void; unrefs: number };
function gerarFalso(o: { erro?: Error; lancar?: boolean; codigo?: number | null } = {}) {
  const chamadas: { bin: string; args: string[]; opcoes: Record<string, unknown> }[] = [];
  const gerar: DepsLogin["gerar"] = (bin, args, opcoes) => {
    if (o.lancar) throw new Error("EACCES");
    chamadas.push({ bin, args, opcoes: opcoes as Record<string, unknown> });
    const filho = new EventEmitter() as Filho;
    filho.unrefs = 0;
    filho.unref = () => { filho.unrefs++; };
    setImmediate(() => {
      if (o.erro) { filho.emit("error", o.erro); return; }
      filho.emit("spawn");
      setImmediate(() => filho.emit("exit", o.codigo ?? 0));
    });
    return filho as unknown as ReturnType<DepsLogin["gerar"]>;
  };
  return { gerar, chamadas };
}
const registros: { evento: string; campos: Record<string, unknown> }[] = [];
const registrar: DepsLogin["registrar"] = (evento, campos) => { registros.push({ evento, campos }); };

describe("ADA-229: entrarNaIa", () => {
  it("abre o login desanexado, sem janela, com o Node do motor, e responde ok no spawn", async () => {
    registros.length = 0;
    const node = "C:\\Users\\ana\\AppData\\Local\\nod\\node\\node.exe";
    const { gerar, chamadas } = gerarFalso();
    const r = await entrarNaIa("codex-cli", { env: ENV, execPath: "C:\\Electron\\nod.exe", gerar, disco: disco({ [node]: "", [`${NPM}\\codex.cmd`]: SHIM_NODE }), registrar });
    expect(r).toEqual({ ok: true });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]!.bin).toBe(node);
    expect(chamadas[0]!.args).toEqual([`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, "login"]);
    const opcoes = chamadas[0]!.opcoes;
    expect(opcoes).toMatchObject({ detached: true, stdio: "ignore", windowsHide: true, shell: false, cwd: "C:\\Users\\ana" });
    const env = opcoes.env as Record<string, string>;
    expect(env.Path?.startsWith(`${NPM};`)).toBe(true);
    expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    await new Promise((r2) => setTimeout(r2, 5));
    expect(registros.map((x) => x.evento)).toEqual(["login_ia_aberto", "login_ia_terminou"]);
    expect(registros[1]!.campos).toEqual({ ia: "codex-cli", codigo: 0 });
  });
  it("sem o Node do motor, o Electron vira node (ELECTRON_RUN_AS_NODE=1)", async () => {
    const { gerar, chamadas } = gerarFalso();
    const r = await entrarNaIa("codex-cli", { env: ENV, execPath: "C:\\Electron\\nod.exe", gerar, disco: disco({ [`${NPM}\\codex.cmd`]: SHIM_NODE }), registrar });
    expect(r).toEqual({ ok: true });
    expect(chamadas[0]!.bin).toBe("C:\\Electron\\nod.exe");
    expect((chamadas[0]!.opcoes.env as Record<string, string>).ELECTRON_RUN_AS_NODE).toBe("1");
  });
  it("um .exe não precisa de node nem da variável do Electron", async () => {
    const { gerar, chamadas } = gerarFalso();
    await entrarNaIa("claude-cli", { env: ENV, execPath: "C:\\Electron\\nod.exe", gerar, disco: disco({ [`${NPM}\\claude.exe`]: "" }), registrar });
    expect(chamadas[0]!.bin).toBe(`${NPM}\\claude.exe`);
    expect(chamadas[0]!.args).toEqual(["auth", "login"]);
  });
  it("IA ausente: nao_instalado, sem spawn", async () => {
    registros.length = 0;
    const { gerar, chamadas } = gerarFalso();
    expect(await entrarNaIa("claude-cli", { env: ENV, execPath: "C:\\Electron\\nod.exe", gerar, disco: disco({}), registrar })).toEqual({ ok: false, motivo: "nao_instalado" });
    expect(chamadas).toHaveLength(0);
    expect(registros[0]).toEqual({ evento: "login_ia_sem_binario", campos: { ia: "claude-cli" } });
  });
  it("o spawn falha (erro ou lança): falhou", async () => {
    const d = disco({ [`${NPM}\\claude.exe`]: "" });
    expect(await entrarNaIa("claude-cli", { env: ENV, execPath: "x", gerar: gerarFalso({ erro: new Error("ENOENT") }).gerar, disco: d, registrar })).toEqual({ ok: false, motivo: "falhou" });
    expect(await entrarNaIa("claude-cli", { env: ENV, execPath: "x", gerar: gerarFalso({ lancar: true }).gerar, disco: d, registrar })).toEqual({ ok: false, motivo: "falhou" });
  });
});

describe("ADA-229: instalar e a guarda da janela", () => {
  it("instalar só abre a página oficial; falha ao abrir = falhou", async () => {
    const abertos: string[] = [];
    expect(await abrirInstalacao("claude-cli", async (u) => { abertos.push(u); })).toEqual({ ok: true });
    expect(abertos).toEqual(["https://docs.anthropic.com/en/docs/claude-code/setup"]);
    expect(await abrirInstalacao("codex-cli", async () => { throw new Error("x"); })).toEqual({ ok: false, motivo: "falhou" });
  });
  it("só a janela web, na origem do servidor conectado", () => {
    const wc = { id: 7 };
    const janela = { isDestroyed: () => false, webContents: wc };
    const origem = "https://app.nodbot.ai";
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: "https://app.nodbot.ai/conversa?x=1" } }, janela, origem)).toBe(true);
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: "https://evil.example/" } }, janela, origem)).toBe(false);
    expect(daJanelaWeb({ sender: { id: 8 }, senderFrame: { url: `${origem}/` } }, janela, origem)).toBe(false);
    expect(daJanelaWeb({ sender: wc, senderFrame: null }, janela, origem)).toBe(false);
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: "nada" } }, janela, origem)).toBe(false);
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: `${origem}/` } }, null, origem)).toBe(false);
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: `${origem}/` } }, { ...janela, isDestroyed: () => true }, origem)).toBe(false);
    expect(daJanelaWeb({ sender: wc, senderFrame: { url: `${origem}/` } }, janela, null)).toBe(false);
  });
});
