import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { readFileSync } from "node:fs";
// NOD-93 (28/10): a lista esperada mora num JSON que o teste unitário confere contra desktop/preload-web.ts,
// para a ponte nova quebrar já na CI do PR e não só no release do Mac.
const PONTE = JSON.parse(readFileSync(resolve("scripts/desktop/ponte-web-esperada.json"), "utf8"));
const scratch = await mkdtemp(join(tmpdir(), "nod-ui-smoke-"));
app.setPath("userData", scratch);
const isolada = { sandbox: true, contextIsolation: true, nodeIntegration: false };
/**
 * definido em 2026-09-24 ("aviso no Mac"): a janela web recebe SÓ `nodDesktop` (as doze de `desktop/preload-web.ts`,
 * com o microfone, o aviso de ligação aberta e as ações da IA do Mac), sem
 * `require`, `process` nem a ponte da tela de conexão (`window.nod`, que entrega `conectar`); a chamada
 * chega ao processo principal e o clique no aviso volta pela `aoAbrir`. revisto em 2026-10-09 (ADR-093): mais o objeto
 * `ias` (estado único, instalar, entrar, link, código, cancelar, verificar e o evento `aoMudar`).
 */
async function janelaWeb() {
  const recebidos = [];
  ipcMain.handle("nod:contador", (_e, n) => { recebidos.push(n); });
  ipcMain.handle("nod:ia-estados", () => [{ ia: "codex-cli", estado: "procurando" }]);
  // NOD-119 (#597): o preload da web pede a densidade da barra e as decisões do card de forma SÍNCRONA ao carregar.
  // Um sendSync sem resposta trava o renderer para sempre: o loadURL abaixo nunca voltava e o smoke estourava os
  // 5 min (release v1.0.0-rc.3, 2026-11-04, os dois Macs). Toda chamada síncrona nova do preload precisa de resposta aqui.
  ipcMain.on("nod:barra-inicial", (e) => { e.returnValue = null; });
  ipcMain.on("nod:decisoes-barra-iniciais", (e) => { e.returnValue = {}; });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: resolve("dist/desktop/preload-web.cjs"), partition: "nod-web-smoke", ...isolada } });
  try {
    await w.loadURL("data:text/html;charset=utf-8,<!doctype html><title>nod</title><body>web</body>");
    const estado = await w.webContents.executeJavaScript(`({ node: typeof require, processo: typeof process, nod: typeof window.nod, ponte: Object.keys(window.nodDesktop ?? {}).sort().join(","), ias: Object.keys(window.nodDesktop?.ias ?? {}).sort().join(","), midia: Object.keys(window.nodDesktop?.midia ?? {}).sort().join(","), ipc: typeof window.ipcRenderer })`);
    const esperado = PONTE.nodDesktop.join(",");
    const esperadoIas = PONTE.ias.join(",");
    if (estado.node !== "undefined" || estado.processo !== "undefined" || estado.nod !== "undefined" || estado.ipc !== "undefined" || estado.ponte !== esperado || estado.ias !== esperadoIas || estado.midia !== PONTE.midia.join(",")) throw new Error(`Janela web expõe mais que nodDesktop: ${JSON.stringify(estado)}`);
    // O evento do processo principal chega à página pelo `aoMudar`, e o pedido de estados volta do processo principal.
    await w.webContents.executeJavaScript(`window.nodDesktop.ias.aoMudar((e) => { window.iaMudou = e; })`);
    w.webContents.send("nod:ia-mudou", { ia: "claude-cli", estado: "entrando" });
    const estados = await w.webContents.executeJavaScript("window.nodDesktop.ias.estados()");
    await esperar(100);
    const mudou = await w.webContents.executeJavaScript("window.iaMudou ?? null");
    if (estados?.[0]?.estado !== "procurando" || mudou?.estado !== "entrando") throw new Error(`Ponte das IAs não funcionou: ${JSON.stringify({ estados, mudou })}`);
    await w.webContents.executeJavaScript(`window.nodDesktop.aoAbrir((alvo) => { window.alvoAberto = alvo; }); window.nodDesktop.contador(3)`);
    w.webContents.send("nod:abrir", { tipo: "sua-vez" });
    await esperar(200);
    const alvo = await w.webContents.executeJavaScript("window.alvoAberto ?? null");
    if (recebidos[0] !== 3 || alvo?.tipo !== "sua-vez") throw new Error(`Ponte da janela web não chegou ao processo principal: ${JSON.stringify({ recebidos, alvo })}`);
    // NOD-136: o aviso do deep link chega sem dado nenhum (a URL nunca vai à página); o alvo vem pelo invoke.
    ipcMain.handle("nod:deep-link-pendente", () => ({ tipo: "sua-vez" }));
    await w.webContents.executeJavaScript(`window.nodDesktop.aoDeepLink((...args) => { window.deepLinkArgs = args.length; })`);
    w.webContents.send("nod:deep-link", "nod://nao-deveria-chegar");
    await esperar(200);
    const deepLink = await w.webContents.executeJavaScript("Promise.all([window.deepLinkArgs ?? null, window.nodDesktop.deepLinkPendente()])");
    if (deepLink[0] !== 0 || deepLink[1]?.tipo !== "sua-vez") throw new Error(`Ponte do deep link não funcionou: ${JSON.stringify(deepLink)}`);
    return { ...estado, contador: recebidos[0], alvo: alvo.tipo, deepLink: deepLink[1].tipo };
  } finally { w.destroy(); }
}
// medido em 2026-10-06 (NOD-187): sem este ouvinte, destruir a última janela dispara o `app.quit()` padrão durante o
// `await rm` do `finally`, o processo sai com 0 antes do `app.exit(codigo)`, e um smoke quebrado passava.
app.on("window-all-closed", () => {});
// medido em 2026-10-07 (NOD-187, QA): sob carga, o Chromium ainda grava `Session Storage` depois do `destroy()`, o
// `rm` dava ENOTEMPTY no `finally`, e um smoke que passou saía com 1, sem chegar ao `app.exit(codigo)`. A limpeza da
// pasta temporária não decide o resultado: tenta de novo e, se ainda falhar, só avisa.
async function limpar() {
  try { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (erro) { process.stderr.write(`aviso: pasta temporária não apagada (${scratch}): ${String(erro)}\n`); }
}
void app.whenReady().then(async () => {
ipcMain.handle("nod:estado", () => ({ url: "", mensagem: "" }));
const w = new BrowserWindow({ show: false, width: 580, height: 850, webPreferences: { preload: resolve("dist/desktop/preload.cjs"), ...isolada } });
// definido em 2026-09-24: o código de saída vem do resultado — antes o `finally` saía com 0 antes de o
// `.catch` ver a falha, e um smoke quebrado passava.
let codigo = 0;
try {
  await w.loadFile(resolve("dist/desktop/setup.html"));
  const estado = await w.webContents.executeJavaScript(`({ node: typeof require, ponte: typeof window.nod?.conectar, desktop: typeof window.nodDesktop, titulo: document.querySelector('h1')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth })`);
  if (estado.node !== "undefined" || estado.ponte !== "function" || estado.desktop !== "undefined" || estado.overflow) throw new Error("Isolamento, preload ou layout inválido");
  const screenshot = await w.webContents.capturePage();
  await writeFile("/private/tmp/nod-desktop-setup.png", screenshot.toPNG());
  process.stdout.write(JSON.stringify(estado) + "\n");
  process.stdout.write(JSON.stringify(await janelaWeb()) + "\n");
} catch (erro) { codigo = 1; process.stderr.write(`${String(erro)}\n`); }
finally { w.destroy(); await limpar(); app.exit(codigo); }
}).catch((erro) => { process.stderr.write(`${String(erro)}\n`); app.exit(1); });
