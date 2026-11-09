import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type IaDesktop, type NodDesktop } from "../../src/contracts/desktop.ts";
import { CANAIS_REMOVER, type OpcoesRemover } from "../../src/contracts/remover-computador.ts";

/**
 * ADA-229 (5/11/2026): a ponte da JANELA WEB do Windows, a menor possível. A web só confere `window.nodDesktop.iaEntrar`
 * / `iaInstalar` (os cartões de IA do onboarding e a ligação sem IA); o resto da ponte do Mac (avisos, contas, mídia,
 * teste das IAs) continua opcional no contrato e a web confere antes de chamar. O processo principal valida o remetente
 * e o argumento de novo (login-ia-windows.ts `daJanelaWeb`, ia-mac.ts `lerIaDesktop`).
 * ADA-245 (jornada D): o "Remover o nod deste computador" (estaMaquina, removerDaqui e o Fechar da tela de Fim, que
 * encerra o app e o tira de Aplicativos).
 */
const ponte: Pick<NodDesktop, "iaEntrar" | "iaInstalar" | "desafioConta" | "trocarConta" | "googleConta" | "esteComputador" | "estaMaquina" | "removerDaqui" | "fecharAposRemover"> = {
  iaEntrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrar, ia),
  iaInstalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalar, ia),
  // ADA-242 (ADR-157): o Google para conta dentro do app, como no Mac (desafio do segredo de troca + loopback).
  desafioConta: () => ipcRenderer.invoke(CANAIS_DESKTOP.desafioConta),
  // A conta que já existe ("escolher" → Levar para esta conta): sem isto, `cabecalhosDoApp` recusa no Windows.
  trocarConta: (codigo: string) => ipcRenderer.invoke(CANAIS_DESKTOP.trocarConta, codigo),
  googleConta: {
    abrir: () => ipcRenderer.invoke(CANAIS_DESKTOP.googleAbrir),
    ir: (url: string) => ipcRenderer.invoke(CANAIS_DESKTOP.googleIr, url),
    cancelar: () => ipcRenderer.invoke(CANAIS_DESKTOP.googleCancelar),
  },
  esteComputador: {
    jaViu: () => ipcRenderer.invoke(CANAIS_DESKTOP.esteComputadorJaViu),
    marcar: () => ipcRenderer.invoke(CANAIS_DESKTOP.esteComputadorMarcar),
  },
  estaMaquina: () => ipcRenderer.invoke(CANAIS_DESKTOP.estaMaquina), // ADA-243: o motor gravou o id ao conectar
  removerDaqui: (opcoes: OpcoesRemover) => ipcRenderer.invoke(CANAIS_REMOVER.removerDaqui, { manterIas: opcoes?.manterIas === true, manterConexao: opcoes?.manterConexao === true }),
  fecharAposRemover: () => ipcRenderer.invoke(CANAIS_REMOVER.fecharAposRemover),
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
