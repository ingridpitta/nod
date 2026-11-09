import { contextBridge, ipcRenderer } from "electron";

/** ADA-229: a ponte da tela de conexão do Windows (`window.nodWin`); o processo principal confere o remetente. */
contextBridge.exposeInMainWorld("nodWin", {
  estado: () => ipcRenderer.invoke("nodwin:estado"),
  conectar: () => ipcRenderer.invoke("nodwin:conectar"),
  tentar: () => ipcRenderer.invoke("nodwin:tentar"),
  abrirLink: () => ipcRenderer.invoke("nodwin:abrirLink"),
  baixar: () => ipcRenderer.invoke("nodwin:baixar"),
  aoMudar: (f: (tela: unknown) => void) => { ipcRenderer.removeAllListeners("nodwin:tela"); ipcRenderer.on("nodwin:tela", (_e, t: unknown) => f(t)); },
  aoMudarAtualizacao: (f: (linha: string) => void) => { ipcRenderer.removeAllListeners("nodwin:atualizacao"); ipcRenderer.on("nodwin:atualizacao", (_e, l: unknown) => { if (typeof l === "string") f(l); }); },
});
