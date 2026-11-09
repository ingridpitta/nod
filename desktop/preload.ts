import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("nod", {
  estado: () => ipcRenderer.invoke("nod:estado"),
  abrirLogin: (url: string) => ipcRenderer.invoke("nod:login", url),
  parear: (url: string) => ipcRenderer.invoke("nod:parear", url),
  conectar: (dados: { url: string; chave: string }) => ipcRenderer.invoke("nod:conectar", dados),
  // NOD-132: a atualização do app na tela de conexão (a linha de estado e o botão de reiniciar).
  reiniciarParaAtualizar: () => ipcRenderer.invoke("nod:reiniciarParaAtualizar"),
  aoMudarAtualizacao: (f: (linha: string) => void) => { ipcRenderer.on("nod:atualizacao", (_e, linha: unknown) => { if (typeof linha === "string") f(linha); }); },
});
