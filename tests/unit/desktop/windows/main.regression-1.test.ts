// Regression: QA-678 — fechar a janela de conexão no meio do pareamento a reabria com "O código venceu";
// e as guardas do main.ts (IPC, cookie, vigia, NSIS) não tinham teste: mutante nelas passava verde.
// Found by /qa on 2026-11-05
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daTelaDeSetup, telaDaFalhaDePareamento, TEXTOS_WINDOWS } from "../../../../desktop/windows/fluxo.ts";
import { cookieDaJanela, PARTITION_DA_JANELA } from "../../../../desktop/windows/sessao.ts";
import { INTERVALO_DO_VIGIA_MS, vigiar } from "../../../../desktop/windows/motor-status.ts";

const main = readFileSync(new URL("../../../../desktop/windows/main.ts", import.meta.url), "utf8");
const setupUrl = "file:///C:/nod/setup-windows.html";
const wc = { id: 1 };
const setup = { isDestroyed: () => false, webContents: wc };

describe("QA #678: o IPC só atende a tela de conexão", () => {
  it("remetente e frame da tela de conexão: atende", () => {
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, setup, setupUrl)).toBe(true);
  });
  it("outro frame, outro remetente, sem frame, janela fechada ou destruída: recusa", () => {
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: "https://evil.example/" } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: `${setupUrl}#x` } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: { id: 2 }, senderFrame: { url: setupUrl } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: null }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, null, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, { ...setup, isDestroyed: () => true }, setupUrl)).toBe(false);
  });
  it("todo ipcMain.handle do main passa pela guarda", () => {
    const handles = main.split("ipcMain.handle(").length - 1;
    const guardados = main.match(/ipcMain\.handle\("nodwin:\w+", \(e\) => \{?\s*(?:\(|if \()daTelaDeSetup\(e\)/g) ?? [];
    // 5/11: os canais da janela web (`nod:ia-*`) passam pela guarda da janela (login-ia-windows.ts `daJanelaWeb`).
    const daJanela = main.match(/ipcMain\.handle\(CANAIS_DESKTOP\.ia\w+, \(e, ia: unknown\) => \{\s*const lida = iaDaJanela\(e, ia\);\s*if \(!lida\) throw new Error\("entrada_invalida"\);/g) ?? [];
    // ADA-242: o Google no app e o "já vi" da janela web passam pela mesma guarda (`daJanela`, daJanelaWeb).
    const contaDaJanela = main.match(/ipcMain\.handle\(CANAIS_DESKTOP\.(?:desafioConta|trocarConta|google\w+|esteComputador\w+|estaMaquina), (?:async )?\(e(?:, (?:url|codigo): unknown)?\) => (?:\{ if \(!?daJanela\(e\)\)|\(daJanela\(e\) \?)/g) ?? [];
    expect(contaDaJanela).toHaveLength(8); // ADA-243: + estaMaquina
    expect(main).toMatch(/const daJanela = \(e: IpcMainInvokeEvent\) => daJanelaWeb\(e, janela, conexao \? new URL\(conexao\.url\)\.origin : null\);/);
    // ADA-245: os canais do "Remover o nod deste computador" passam pela mesma guarda da janela, antes de tudo.
    const doRemover = main.match(/ipcMain\.handle\(CANAIS_REMOVER\.\w+, (?:async )?\(e(?:, opcoes: unknown)?\)(?:: (?:Promise<[^>]+>|boolean))? => \{\s*if \(!daJanela\(e\)\) throw new Error\("origem_invalida"\);/g) ?? [];
    expect(doRemover).toHaveLength(2); // removerDaqui e fecharAposRemover (o estaMaquina é o da ADA-243)
    expect(handles).toBeGreaterThanOrEqual(10);
    expect(guardados.length + daJanela.length + contaDaJanela.length + doRemover.length).toBe(handles);
    expect(daJanela).toHaveLength(2);
    expect(main).toMatch(/const daJanela = \(e: IpcMainInvokeEvent\) => daJanelaWeb\(e, janela, conexao \? new URL\(conexao\.url\)\.origin : null\);/);
    expect(main).toMatch(/const iaDaJanela = \(e: IpcMainInvokeEvent, ia: unknown\) => \(daJanelaWeb\(e, janela, conexao \? new URL\(conexao\.url\)\.origin : null\) \? lerIaDesktop\(ia\) : null\);/);
    expect(main).toMatch(/preload: join\(dir, "preload-web-windows\.cjs"\)/);
    expect(main).toMatch(/const daTelaDeSetup = \(e: IpcMainInvokeEvent\) => daTelaDeSetupPura\(e, setup, setupUrl\);/);
    expect(main).toContain('setup.webContents.on("will-navigate", (e, url) => { if (url !== setupUrl) e.preventDefault(); });');
  });
});

describe("ADA-242: a troca de conta pela janela web do Windows (escolher → Levar para esta conta)", () => {
  // Sem `trocarConta`, `cabecalhosDoApp` lança AppDesatualizado e a conta do Google que já existe não termina no Windows.
  it("a ponte expõe trocarConta e o main troca o código pela chave com a prova do mesmo segredo do desafio", () => {
    const preload = readFileSync(new URL("../../../../desktop/windows/preload-web-windows.ts", import.meta.url), "utf8");
    expect(preload).toMatch(/trocarConta: \(codigo: string\) => ipcRenderer\.invoke\(CANAIS_DESKTOP\.trocarConta, codigo\)/);
    expect(main).toMatch(/ipcMain\.handle\(CANAIS_DESKTOP\.trocarConta, async \(e, codigo: unknown\) => \{ if \(!daJanela\(e\)\) throw new Error\("entrada_invalida"\);/);
    expect(main).toMatch(/trocarChaveDoApp\(\{ servidor: conexao\.url, codigo, prova: troca\.prova \}\)/);
    // A conexão nova é a mesma do Google no app: grava, marca a equipe e reabre.
    expect(main).toMatch(/aoEntrar: \(chave\) => trocarConexao\(chave\)/);
  });
});

// Regression: QA-691 — no Windows o "já vi Este computador" ia para app.getPath("userData") (%APPDATA%\nod, que o
// electron-builder não apaga e o aceite 6 não manda apagar): a reinstalação limpa (%LOCALAPPDATA%\nod e
// %APPDATA%\nod-motor apagados) não mostrava a tela de novo. Mora com a conexão, em %APPDATA%\nod-motor.
// Found by /qa on 2026-11-08
describe("QA #691: o 'já vi' da tela Este computador mora com a conexão (aceite 6)", () => {
  it("o main do Windows guarda o 'já vi' na pasta do motor, não no userData do Electron", () => {
    expect(main).toMatch(/const esteComputador = esteComputadorEm\(pastaMotor\(\)\);/);
    expect(main).not.toMatch(/esteComputadorEm\(app\.getPath\("userData"\)\)/);
  });
});

describe("QA #678: fechar a janela no meio do pareamento não a reabre", () => {
  it("cancelado = nenhuma tela", () => {
    expect(telaDaFalhaDePareamento("vencido", true)).toBeNull();
    expect(telaDaFalhaDePareamento("servidor_fora", true)).toBeNull();
    expect(telaDaFalhaDePareamento("vencido", false)).toEqual({ tela: "conectar", aviso: TEXTOS_WINDOWS.vencido });
  });
  it("o main passa o cancelarPareamento e só mostra a tela que veio", () => {
    expect(main).toMatch(/telaDaFalhaDePareamento\([^;]*, cancelarPareamento\)/);
    expect(main).toMatch(/if \(tela\) mostrar\(tela\);/);
    expect(main).toContain('setup.on("closed", () => { setup = null; cancelarPareamento = true; });');
  });
});

describe("QA #678: o cookie da sessão na partition nod-web", () => {
  it("o cookie é o nod_sessao, httpOnly, strict, secure só em https", () => {
    expect(PARTITION_DA_JANELA).toBe("nod-web");
    expect(cookieDaJanela("https://app.nodbot.ai", "v")).toEqual({ url: "https://app.nodbot.ai", name: "nod_sessao", value: "v", path: "/", httpOnly: true, secure: true, sameSite: "strict" });
    expect(cookieDaJanela("http://127.0.0.1:8888", "v").secure).toBe(false);
  });
  it("o main grava esse cookie nessa partition e a janela usa a mesma", () => {
    expect(main).toContain("session.fromPartition(PARTITION_DA_JANELA)");
    expect(main).toContain("web.cookies.set(cookieDaJanela(c.url, passo.abrir))");
    expect(main).toContain("partition: PARTITION_DA_JANELA");
    expect(main).not.toMatch(/"nod-web"|"nod_sessao"/);
  });
});

describe("QA #678: o vigia a cada 30 s religa pela tarefa", () => {
  it("o intervalo é 30 s e o main o usa", () => {
    expect(INTERVALO_DO_VIGIA_MS).toBe(30_000);
    // ADA-245: depois do "Remover o nod deste computador" o vigia para (senão religaria a tarefa removida).
    expect(main).toMatch(/setInterval\(\(\) => \{ if \(conexao && !removido\) void lerMotor\(\); \}, INTERVALO_DO_VIGIA_MS\)/);
  });
  it("vigiar: estado e religar a partir da saída do PowerShell", () => {
    expect(vigiar('{"tarefa":"Ready","processos":0,"instalado":true}')).toEqual({ estado: "parado", religar: true, tarefa: "Ready" });
    expect(vigiar('{"tarefa":"Running","processos":1,"instalado":true}')).toEqual({ estado: "rodando", religar: false, tarefa: "Running" });
    expect(vigiar("lixo")).toEqual({ estado: "desconhecido", religar: false, tarefa: null });
  });
  it("o main religa quando o vigia manda e roda o NSIS com os argumentos da atualização", () => {
    expect(main).toMatch(/const v = vigiar\(saida\);/);
    expect(main).toMatch(/if \(v\.religar\) \{\n\s+const c = comandoDeReligar\(systemRoot\);\n\s+execFile\(c\.arquivo, c\.args/);
    expect(main).toContain("spawn(exe, [...ARGS_DO_INSTALADOR], { detached: true");
  });
});
