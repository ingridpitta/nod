import { describe, expect, it } from "vitest";
import { JARGAO_PROIBIDO_REMOVER, type ItemRemocao, type OpcoesRemover } from "../../../src/contracts/remover-computador.ts";
import { TAREFA_DO_MOTOR_WINDOWS } from "../../../src/adapters/http/motor-instalacao-windows.ts";
import {
  caminhosNoWindows,
  desinstalar,
  lancadorDestacado,
  lerMarcaDasIas,
  scriptDaLimpeza,
  sidDaSaida,
  TAREFA_DO_MOTOR,
  TEXTOS_REMOCAO,
  type DepsDesinstalar,
  type ModoDaRemocao,
} from "../../../motor/desinstalar.ts";

const SID = "S-1-5-21-111-222-333-1001";
const ENV = { LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local", APPDATA: "C:\\Users\\ana\\AppData\\Roaming", TEMP: "C:\\Users\\ana\\AppData\\Local\\Temp", SystemRoot: "C:\\Windows" };
const L = ENV.LOCALAPPDATA;
const R = ENV.APPDATA;

/** O perfil de uma pessoa com o nod instalado: programa, dados, conexão e as duas IAs pelo npm. */
const instalado = (marca: string | null = '{"claude":"2.1.3","codex":"0.40.0"}') => {
  const arquivos = new Map<string, string>([
    [`${L}\\nod\\node\\node.exe`, ""],
    [`${L}\\nod\\motor\\app\\nod-motor.mjs`, ""],
    [`${L}\\nod-motor\\executor\\contas-locais.json`, "{}"],
    [`${R}\\nod-motor\\conexao.json`, "{}"],
    [`${R}\\nod-motor\\maquina.json`, "{}"],
    [`${R}\\nod-motor\\ias-testadas.json`, "{}"],
    [`${R}\\npm\\claude.cmd`, ""],
    [`${R}\\npm\\claude.ps1`, ""],
    [`${R}\\npm\\claude`, ""],
    [`${R}\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, ""],
    [`${R}\\npm\\codex.cmd`, ""],
    [`${R}\\npm\\node_modules\\@openai\\codex\\bin\\codex.js`, ""],
    [`${R}\\npm\\gh.cmd`, ""],
  ]);
  if (marca !== null) arquivos.set(`${R}\\nod-motor\\ias-do-nod.json`, marca);
  return arquivos;
};

type Chamada = { exe: string; args: readonly string[] };

function falso(o: { arquivos?: Map<string, string>; modo?: ModoDaRemocao; env?: Record<string, string | undefined>; plataforma?: NodeJS.Platform; codigo?: (c: Chamada) => number | null; apagarFalha?: (c: string) => boolean } = {}) {
  const arquivos = o.arquivos ?? instalado();
  const chamadas: Chamada[] = [];
  const apagados: string[] = [];
  const debaixo = (c: string, base: string) => c.toLowerCase() === base.toLowerCase() || c.toLowerCase().startsWith(base.toLowerCase() + "\\") || c.startsWith(base + "/");
  const deps: DepsDesinstalar = {
    plataforma: o.plataforma ?? "win32",
    env: o.env ?? ENV,
    pid: 4242,
    modo: o.modo ?? "app",
    pastaDaConexao: "/home/nod/.config/nod-motor",
    disco: {
      existe: async (c) => [...arquivos.keys()].some((a) => debaixo(a, c)),
      ler: async (c) => arquivos.get(c) ?? null,
      gravar: async (c, t) => { arquivos.set(c, t); },
      apagar: async (c) => {
        apagados.push(c);
        if (o.apagarFalha?.(c)) throw new Error("EBUSY");
        for (const a of [...arquivos.keys()]) if (debaixo(a, c)) arquivos.delete(a);
      },
    },
    rodar: async (exe, args) => {
      const c = { exe, args };
      chamadas.push(c);
      if (exe.endsWith("whoami.exe")) return { codigo: 0, saida: `"pc\\ana","${SID}"\r\n` };
      const codigo = o.codigo ? o.codigo(c) : 0;
      // A limpeza do modo app (o PowerShell com -File) apaga as duas pastas, como o script de verdade.
      if (exe.endsWith("powershell.exe") && args.includes("-File") && codigo === 0) {
        for (const a of [...arquivos.keys()]) if (debaixo(a, `${L}\\nod`) || debaixo(a, `${L}\\nod-motor`)) arquivos.delete(a);
      }
      return { codigo, saida: "" };
    },
  };
  return { deps, arquivos, chamadas, apagados };
}

const estados = (itens: readonly ItemRemocao[]) => Object.fromEntries(itens.map((i) => [i.id, i.estado]));
const tem = (arquivos: Map<string, string>, c: string) => arquivos.has(c);

describe("nod-motor desinstalar (ADA-245, jornada D)", () => {
  it("usa o mesmo nome de tarefa do instalador", () => {
    expect(TAREFA_DO_MOTOR).toBe(TAREFA_DO_MOTOR_WINDOWS);
  });

  it.each<[OpcoesRemover, Record<string, string>]>([
    [{ manterConexao: false, manterIas: false }, { parou: "feito", programa: "feito", ias: "feito", conta: "feito" }],
    [{ manterConexao: true, manterIas: false }, { parou: "feito", programa: "feito", ias: "feito", conta: "mantido" }],
    [{ manterConexao: false, manterIas: true }, { parou: "feito", programa: "feito", ias: "mantido", conta: "feito" }],
    [{ manterConexao: true, manterIas: true }, { parou: "feito", programa: "feito", ias: "mantido", conta: "mantido" }],
  ])("no Windows, %j", async (opcoes, esperado) => {
    const { deps, arquivos } = falso();
    const r = await desinstalar(opcoes, deps);
    expect(r.itens.map((i) => i.id)).toEqual(["parou", "programa", "ias", "conta"]);
    expect(estados(r.itens)).toEqual(esperado);
    expect(r.programaDepois).toBe(false);
    for (const i of r.itens) expect(i.texto).not.toMatch(JARGAO_PROIBIDO_REMOVER);
    expect(tem(arquivos, `${L}\\nod\\node\\node.exe`)).toBe(false);
    expect(tem(arquivos, `${L}\\nod-motor\\executor\\contas-locais.json`)).toBe(false);
    expect(tem(arquivos, `${R}\\nod-motor\\conexao.json`)).toBe(opcoes.manterConexao);
    expect(tem(arquivos, `${R}\\npm\\claude.cmd`)).toBe(opcoes.manterIas);
    expect(tem(arquivos, `${R}\\npm\\node_modules\\@openai\\codex\\bin\\codex.js`)).toBe(opcoes.manterIas);
    // O que não é do nod nunca sai.
    expect(tem(arquivos, `${R}\\npm\\gh.cmd`)).toBe(true);
    // A marca fica enquanto as IAs ficam (uma remoção futura ainda sabe quais são do nod).
    expect(tem(arquivos, `${R}\\nod-motor\\ias-do-nod.json`)).toBe(opcoes.manterIas);
  });

  it("IA que o nod não instalou (sem marca, ou marca sem ela) fica", async () => {
    const semMarca = falso({ arquivos: instalado(null) });
    const r = await desinstalar({ manterConexao: false, manterIas: false }, semMarca.deps);
    expect(r.itens.find((i) => i.id === "ias")).toEqual({ id: "ias", estado: "mantido", texto: TEXTOS_REMOCAO.iasDaPessoa });
    expect(tem(semMarca.arquivos, `${R}\\npm\\claude.cmd`)).toBe(true);
    expect(tem(semMarca.arquivos, `${R}\\npm\\codex.cmd`)).toBe(true);

    const soClaude = falso({ arquivos: instalado('{"claude":"2.1.3","codex":null}') });
    const r2 = await desinstalar({ manterConexao: true, manterIas: false }, soClaude.deps);
    expect(r2.itens.find((i) => i.id === "ias")).toMatchObject({ estado: "feito", texto: "Claude instalado pelo nod foi removido" });
    expect(tem(soClaude.arquivos, `${R}\\npm\\claude.cmd`)).toBe(false);
    expect(tem(soClaude.arquivos, `${R}\\npm\\codex.cmd`)).toBe(true);
    expect(tem(soClaude.arquivos, `${R}\\npm\\node_modules\\@openai\\codex\\bin\\codex.js`)).toBe(true);
  });

  it("só apaga caminhos fixos, derivados de LOCALAPPDATA/APPDATA (nunca de NOD_PASTA, NOD_MOTOR_HOME)", async () => {
    const { deps, apagados, chamadas } = falso({ env: { ...ENV, NOD_PASTA: "C:\\", NOD_MOTOR_HOME: "C:\\Users\\ana\\Documents" } });
    await desinstalar({ manterConexao: false, manterIas: false }, deps);
    const permitidos = [
      `${R}\\npm\\claude`, `${R}\\npm\\claude.cmd`, `${R}\\npm\\claude.ps1`, `${R}\\npm\\node_modules\\@anthropic-ai\\claude-code`,
      `${R}\\npm\\codex`, `${R}\\npm\\codex.cmd`, `${R}\\npm\\codex.ps1`, `${R}\\npm\\node_modules\\@openai\\codex`,
      `${R}\\nod-motor`,
    ];
    for (const a of apagados) expect(permitidos).toContain(a);
    // O PowerShell da limpeza só leva as duas pastas do programa.
    const script = scriptDaLimpeza(caminhosNoWindows(ENV)!);
    expect(script).toContain(`$programa = '${L}\\nod'`);
    expect(script).toContain(`'${L}\\nod-motor')`);
    expect(script).not.toMatch(/Documents|NOD_PASTA|NOD_MOTOR_HOME|\$env:/);
    // Fora o BOM (revisão do PR #694), o texto do script é ASCII; só o caminho do perfil pode ter acento.
    expect([...script.slice(1)].every((ch) => ch.charCodeAt(0) < 0x80)).toBe(true);
    for (const c of chamadas) expect(c.exe.startsWith("C:\\Windows\\System32\\")).toBe(true);
  });

  it("sem LOCALAPPDATA/APPDATA absolutos não toca em nada", async () => {
    for (const env of [{}, { LOCALAPPDATA: "relativo", APPDATA: R }, { LOCALAPPDATA: "C:\\", APPDATA: R }, { LOCALAPPDATA: `${L}\\..\\..`, APPDATA: R }, { LOCALAPPDATA: `${L}"`, APPDATA: R }]) {
      expect(caminhosNoWindows(env)).toBeNull();
      const { deps, apagados, chamadas } = falso({ env });
      const r = await desinstalar({ manterConexao: false, manterIas: false }, deps);
      expect(estados(r.itens)).toEqual({ parou: "falhou", programa: "falhou", ias: "falhou", conta: "falhou" });
      expect(apagados).toEqual([]);
      expect(chamadas).toEqual([]);
    }
  });

  it("schtasks falhando vira 'falhou' sem abortar o resto", async () => {
    const { deps, arquivos } = falso({ codigo: (c) => (c.exe.endsWith("schtasks.exe") && c.args[0] === "/Delete" ? 1 : 0) });
    const r = await desinstalar({ manterConexao: false, manterIas: false }, deps);
    expect(estados(r.itens)).toEqual({ parou: "falhou", programa: "feito", ias: "feito", conta: "feito" });
    expect(r.itens[0]!.texto).toBe(TEXTOS_REMOCAO.naoParou);
    expect(tem(arquivos, `${R}\\nod-motor\\conexao.json`)).toBe(false);

    // O spawn estourando (schtasks ausente) também.
    const { deps: d2 } = falso();
    const rodar = d2.rodar;
    d2.rodar = async (exe, args, o) => (exe.endsWith("schtasks.exe") && args[0] === "/Delete" ? Promise.reject(new Error("ENOENT")) : rodar(exe, args, o));
    expect(estados((await desinstalar({ manterConexao: true, manterIas: true }, d2)).itens)).toMatchObject({ parou: "falhou", programa: "feito" });
  });

  it("para a tarefa e a chave Run de nod-motor-<SID>", async () => {
    const { deps, chamadas } = falso();
    await desinstalar({ manterConexao: true, manterIas: true }, deps);
    const args = chamadas.map((c) => c.args.join(" "));
    expect(args).toContain(`/End /TN \\nod-motor-${SID}`);
    expect(args).toContain(`/Delete /TN \\nod-motor-${SID} /F`);
    expect(args).toContain(`delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v nod-motor-${SID} /f`);
  });

  it("tarefa e chave ausentes: nada a apagar, e parou fica feito", async () => {
    const { deps, chamadas } = falso({ codigo: (c) => (c.args[0] === "/Query" || c.args[0] === "query" ? 1 : 0) });
    const r = await desinstalar({ manterConexao: true, manterIas: true }, deps);
    expect(r.itens[0]!.estado).toBe("feito");
    expect(chamadas.some((c) => c.args[0] === "/Delete" || c.args[0] === "delete")).toBe(false);
  });

  it("a pasta que não sai vira 'falhou' dizendo qual apagar à mão", async () => {
    const { deps } = falso({ codigo: (c) => (c.exe.endsWith("powershell.exe") ? 1 : 0) });
    const r = await desinstalar({ manterConexao: true, manterIas: true }, deps);
    expect(r.itens[1]).toMatchObject({ id: "programa", estado: "falhou" });
    expect(r.itens[1]!.texto).toBe("Não deu para apagar %LOCALAPPDATA%\\nod e a pasta de trabalho do nod (em %LOCALAPPDATA%). Reinicie o computador e apague à mão");
  });

  // Regression: os itens de falha mostravam `...\nod-motor` e `...\nod-motor\conexao.json` na tela de Fim (critério 7).
  // Found by /qa on 2026-11-08 (PR #694)
  it.each<ModoDaRemocao>(["app", "terminal", "servico"])("os itens de falha (modo %s) também ficam sem jargão", async (modo) => {
    const tudoFalha = falso({ modo, codigo: (c) => (c.args[0] === "/Query" || c.args[0] === "query" ? 0 : 1), apagarFalha: () => true });
    const r = await desinstalar({ manterConexao: false, manterIas: false }, tudoFalha.deps);
    expect(estados(r.itens)).toEqual({ parou: "falhou", programa: "falhou", ias: "falhou", conta: "falhou" });
    for (const i of r.itens) expect(i.texto, i.texto).not.toMatch(JARGAO_PROIBIDO_REMOVER);
    // A gravação do script falhando (TEMP sem escrita) também.
    const semTemp = falso({ modo });
    semTemp.deps.disco.gravar = async () => { throw new Error("EACCES"); };
    for (const i of (await desinstalar({ manterConexao: false, manterIas: false }, semTemp.deps)).itens) expect(i.texto, i.texto).not.toMatch(JARGAO_PROIBIDO_REMOVER);
    // Fora do Windows (a pasta da conexão do motor da VM).
    const linux = falso({ plataforma: "linux", apagarFalha: () => true });
    for (const i of (await desinstalar({ manterConexao: false, manterIas: false }, linux.deps)).itens) expect(i.texto, i.texto).not.toMatch(JARGAO_PROIBIDO_REMOVER);
  });

  it("IA presa vira 'falhou' e a marca fica", async () => {
    const { deps, arquivos } = falso({ apagarFalha: (c) => c.endsWith("codex.cmd") });
    const r = await desinstalar({ manterConexao: false, manterIas: false }, deps);
    expect(estados(r.itens)).toMatchObject({ ias: "falhou", conta: "feito" });
    expect(r.itens[2]!.texto).toContain("ChatGPT");
    expect(tem(arquivos, `${R}\\nod-motor\\ias-do-nod.json`)).toBe(true);
    expect(tem(arquivos, `${R}\\nod-motor\\conexao.json`)).toBe(false);
  });

  it.each<ModoDaRemocao>(["terminal", "servico"])("no modo %s a pasta sai depois, por um PowerShell fora do job", async (modo) => {
    const { deps, chamadas, arquivos } = falso({ modo });
    const r = await desinstalar({ manterConexao: false, manterIas: false }, deps);
    expect(r.programaDepois).toBe(true);
    expect(r.itens[1]).toEqual({ id: "programa", estado: "feito", texto: TEXTOS_REMOCAO.programaDepois });
    // O lançamento é a última coisa, e espera este processo sair.
    const ultima = chamadas[chamadas.length - 1]!;
    expect(ultima.exe).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    const codificado = ultima.args[ultima.args.indexOf("-EncodedCommand") + 1]!;
    const comando = Buffer.from(codificado, "base64").toString("utf16le");
    expect(comando).toContain("Invoke-CimMethod -ClassName Win32_Process -MethodName Create");
    expect(comando).toContain(`-File "${L}\\Temp\\nod-remover-4242.ps1" -EsperarPid 4242`);
    expect(arquivos.get(`${L}\\Temp\\nod-remover-4242.ps1`)).toContain("Wait-Process -Id $EsperarPid");
    expect(chamadas.some((c) => c.args[0] === "/End")).toBe(modo === "terminal");
  });

  it("o lançador escapa aspas simples do perfil", () => {
    const c = caminhosNoWindows({ LOCALAPPDATA: "C:\\Users\\O'Brien\\AppData\\Local", APPDATA: "C:\\Users\\O'Brien\\AppData\\Roaming" })!;
    expect(scriptDaLimpeza(c)).toContain("$programa = 'C:\\Users\\O''Brien\\AppData\\Local\\nod'");
    const args = lancadorDestacado(c, `${c.temp}\\x.ps1`, 7);
    expect(Buffer.from(args[args.length - 1]!, "base64").toString("utf16le")).toContain("O''Brien");
  });

  it("revisão do PR #694: o script começa com o BOM do UTF-8 (o PowerShell 5.1 lê sem BOM como ANSI e erraria C:\\Users\\José)", () => {
    const c = caminhosNoWindows({ LOCALAPPDATA: "C:\\Users\\José\\AppData\\Local", APPDATA: "C:\\Users\\José\\AppData\\Roaming" })!;
    const script = scriptDaLimpeza(c);
    expect(script.startsWith("\uFEFF")).toBe(true);
    expect(Buffer.from(script, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(script).toContain("$programa = 'C:\\Users\\José\\AppData\\Local\\nod'");
  });

  it("fora do Windows só a conexão sai", async () => {
    const { deps, apagados, chamadas } = falso({ plataforma: "linux" });
    expect((await desinstalar({ manterConexao: false, manterIas: false }, deps)).itens).toEqual([{ id: "conta", estado: "feito", texto: TEXTOS_REMOCAO.saiu }]);
    expect(apagados).toEqual(["/home/nod/.config/nod-motor/conexao.json", "/home/nod/.config/nod-motor/maquina.json"]);
    expect(chamadas).toEqual([]);
    const { deps: d2, apagados: a2 } = falso({ plataforma: "linux" });
    expect((await desinstalar({ manterConexao: true, manterIas: false }, d2)).itens).toEqual([{ id: "conta", estado: "mantido", texto: TEXTOS_REMOCAO.continua }]);
    expect(a2).toEqual([]);
  });

  it("lê a marca e o SID", () => {
    expect(lerMarcaDasIas('\uFEFF{"claude":"2.1.3","codex":null}')).toEqual(["claude"]);
    expect(lerMarcaDasIas('{"claude":"","codex":"1"}')).toEqual(["codex"]);
    expect(lerMarcaDasIas("lixo")).toEqual([]);
    expect(lerMarcaDasIas("null")).toEqual([]);
    expect(sidDaSaida(`"pc\\ana","${SID}"`)).toBe(SID);
    expect(sidDaSaida("Acesso negado")).toBeNull();
  });
});
