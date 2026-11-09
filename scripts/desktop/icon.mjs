import { app, BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
app.setPath("userData", "/private/tmp/nod-icon-electron");
void app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1024, height: 1024, useContentSize: true, transparent: true, frame: false, webPreferences: { sandbox: true, nodeIntegration: false } });
  const svg = await readFile("desktop/resources/icon.svg", "utf8");
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`)}`);
  const imagem = await w.webContents.capturePage();
  await writeFile("desktop/resources/icon.png", imagem.toPNG());
  app.exit(0);
}).catch((e) => { process.stderr.write(String(e)); app.exit(1); });
