import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type ContasNaTela, type IaDesktop, type NodDesktop, type PonteContas, type PonteIas, type TemaDesktop } from "../src/contracts/desktop.ts";
import type { BarraDesktop, DecisaoBarraDesktop } from "../src/contracts/desktop-barra.ts";
import type { AcaoDeBusca } from "./menu.ts";
import type { EstadoIa } from "../src/contracts/estado-ia.ts";
import { CANAIS_MIDIA, type PonteMidia } from "../src/contracts/midia-desktop.ts";
import { CANAIS_REMOVER, type OpcoesRemover } from "../src/contracts/remover-computador.ts";

/**
 * Preload da JANELA WEB (definido em 2026-09-24, "aviso no Mac"): a página é remota, então a ponte é a
 * menor possível — funções nomeadas em `window.nodDesktop`, nenhum `ipcRenderer`, nenhum canal genérico.
 * A ponte da tela de conexão (preload.ts, `window.nod`) entrega `conectar` e a chave da máquina e nunca
 * chega aqui; a web usa `window.nod` para outra coisa. O processo principal valida remetente e argumentos.
 */
/** definido em 2026-10-09: as IAs dentro do app (PonteIas); cada argumento é validado de novo no processo principal. */
const ias: PonteIas = {
  estados: () => ipcRenderer.invoke(CANAIS_DESKTOP.iaEstados),
  instalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalarNoApp, ia),
  entrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrarNoApp, ia),
  abrirLink: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaAbrirLink, ia),
  colarCodigo: (ia: IaDesktop, codigo: string) => ipcRenderer.invoke(CANAIS_DESKTOP.iaColarCodigo, ia, codigo),
  cancelar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaCancelar, ia),
  verificar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaVerificar, ia),
  // NOD-9: o "Atualizar" (só a IA e se é agora; o comando é do processo principal).
  atualizar: (ia: IaDesktop, opcoes?: { agora?: boolean }) => ipcRenderer.invoke(CANAIS_DESKTOP.iaAtualizar, ia, { agora: opcoes?.agora === true }),
  aoMudar: (fn: (estado: EstadoIa) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.iaMudou);
    ipcRenderer.on(CANAIS_DESKTOP.iaMudou, (_evento, estado: EstadoIa) => fn(estado));
  },
};
/** definido em 2026-10-12 (ADR-101): as várias contas; o processo principal valida cada argumento. */
const contas: PonteContas = {
  listar: () => ipcRenderer.invoke(CANAIS_DESKTOP.contasListar),
  usar: (ia: IaDesktop, posicao: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasUsar, ia, posicao),
  adicionar: (ia: IaDesktop, apelido: string) => ipcRenderer.invoke(CANAIS_DESKTOP.contasAdicionar, ia, apelido),
  remover: (ia: IaDesktop, posicao: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasRemover, ia, posicao),
  fecharFalha: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.contasFecharFalha, ia),
  mover: (ia: IaDesktop, de: number, para: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasMover, ia, de, para),
  renomear: (ia: IaDesktop, posicao: number, apelido: string) => ipcRenderer.invoke(CANAIS_DESKTOP.contasRenomear, ia, posicao, apelido),
  definirModo: (ia: IaDesktop, modo: "perguntar" | "automatico") => ipcRenderer.invoke(CANAIS_DESKTOP.contasDefinirModo, ia, modo),
  definirTrocaAutomatica: (ia: IaDesktop, posicao: number, ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.contasDefinirTroca, ia, posicao, ligado),
  detalhes: () => ipcRenderer.invoke(CANAIS_DESKTOP.contasDetalhes),
  aoMudar: (fn: (lista: ContasNaTela[]) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.contasMudaram);
    ipcRenderer.on(CANAIS_DESKTOP.contasMudaram, (_evento, lista: ContasNaTela[]) => fn(lista));
  },
};
/** NOD-323 (J5): a mídia do bot que ficou neste Mac; o processo principal confere o caminho de novo. */
const midia: PonteMidia = {
  maquina: () => ipcRenderer.invoke(CANAIS_MIDIA.maquina),
  existe: (caminhoRelativo: string) => ipcRenderer.invoke(CANAIS_MIDIA.existe, caminhoRelativo),
  mostrarNoFinder: (caminhoRelativo: string) => ipcRenderer.invoke(CANAIS_MIDIA.mostrarNoFinder, caminhoRelativo),
};
// NOD-119: o localStorage da janela web é apagado a cada conexão; a densidade da barra volta dele antes do script inline
// do index.html (mesma chave de web/lib/densidade.ts), senão a barra abriria larga e depois encolheria.
try {
  const barra: unknown = ipcRenderer.sendSync(CANAIS_DESKTOP.barraInicial);
  if (typeof barra === "string") localStorage.setItem("nod.densidade", barra);
  else localStorage.removeItem("nod.densidade");
} catch {
  // sem preferência ou sem armazenamento: a barra abre no padrão
}
// NOD-119 (revisão 4): as decisões do card da barra também voltam (mesma chave de web/telas/card-barra.ts), senão o card
// já decidido voltaria a pedir clique a cada conexão.
try {
  const decisoes: unknown = ipcRenderer.sendSync(CANAIS_DESKTOP.decisoesBarraIniciais);
  if (typeof decisoes === "object" && decisoes !== null) {
    for (const [id, d] of Object.entries(decisoes)) if (d === "aplicada" || d === "recusada") localStorage.setItem(`nod.barra.decisao.${id}`, d);
  }
} catch {
  // sem decisões guardadas: os cards pedem o clique
}
const ponte: NodDesktop = {
  avisar: (aviso: AvisoDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.avisar, aviso),
  contador: (n: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contador, n),
  preferencias: () => ipcRenderer.invoke(CANAIS_DESKTOP.preferencias),
  definirAvisos: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirAvisos, ligado),
  definirTema: (tema: TemaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.definirTema, tema),
  // NOD-196: o som dos avisos; o processo principal valida o booleano.
  definirSom: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirSom, ligado),
  // NOD-119: a densidade da barra lateral; o processo principal valida o valor.
  definirBarra: (barra: BarraDesktop | null) => ipcRenderer.invoke(CANAIS_DESKTOP.definirBarra, barra),
  definirDecisaoBarra: (mensagemId: string, decisao: DecisaoBarraDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.definirDecisaoBarra, mensagemId, decisao),
  // Modo ligação (definido em 2026-10-04, ADR-071): o acesso do macOS ao microfone e o aviso de ligação aberta.
  microfone: () => ipcRenderer.invoke(CANAIS_DESKTOP.microfone),
  emLigacao: (ativa: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.emLigacao, ativa),
  // Onboarding (definido em 2026-10-04, ADR-077): os cards de IA — login do CLI e página oficial de instalação.
  iaEntrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrar, ia),
  iaInstalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalar, ia),
  // definido em 2026-10-05: o teste de verdade das IAs (um turno de uma frase); o processo principal valida o pedido.
  iaTestar: (pedido?: { nome?: string; ia?: IaDesktop }) => ipcRenderer.invoke(CANAIS_DESKTOP.iaTestar, pedido),
  ias,
  contas,
  midia,
  // NOD-345: o código de troca vai ao processo principal, que fala com o servidor sem Origin.
  trocarConta: (codigo: string) => ipcRenderer.invoke(CANAIS_DESKTOP.trocarConta, codigo),
  desafioConta: () => ipcRenderer.invoke(CANAIS_DESKTOP.desafioConta),
  souDaEquipe: () => ipcRenderer.invoke(CANAIS_DESKTOP.souDaEquipe),
  // ADA-242: o Google para conta dentro do app e o "já vi" da tela Este computador; o processo principal valida tudo.
  googleConta: {
    abrir: () => ipcRenderer.invoke(CANAIS_DESKTOP.googleAbrir),
    ir: (url: string) => ipcRenderer.invoke(CANAIS_DESKTOP.googleIr, url),
    cancelar: () => ipcRenderer.invoke(CANAIS_DESKTOP.googleCancelar),
  },
  esteComputador: {
    jaViu: () => ipcRenderer.invoke(CANAIS_DESKTOP.esteComputadorJaViu),
    marcar: () => ipcRenderer.invoke(CANAIS_DESKTOP.esteComputadorMarcar),
  },
  // NOD-93 (ADR-127): o "tentar agora" do download pausado da VM local.
  vmTentarAgora: () => ipcRenderer.invoke(CANAIS_DESKTOP.vmTentarAgora),
  estaMaquina: () => ipcRenderer.invoke(CANAIS_DESKTOP.estaMaquina), // ADA-243
  // ADA-245 (jornada D): "Remover o nod deste computador"; o processo principal valida as opções. No Mac o app fica
  // (sem fecharAposRemover): a tela de Fim volta a Computadores.
  removerDaqui: (opcoes: OpcoesRemover) => ipcRenderer.invoke(CANAIS_REMOVER.removerDaqui, { manterIas: opcoes?.manterIas === true, manterConexao: opcoes?.manterConexao === true }),
  aoAbrir: (fn: (alvo: AlvoAviso) => void) => {
    // Um ouvinte só (a página registra uma vez; recarregar recria o preload). O evento do IPC não vai à página.
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.abrir);
    ipcRenderer.on(CANAIS_DESKTOP.abrir, (_evento, alvo: AlvoAviso) => fn(alvo));
  },
  // NOD-136: o link `nod://` na fila do processo principal. O aviso não leva nada; o alvo vem do invoke, já validado.
  aoDeepLink: (fn: () => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.deepLink);
    ipcRenderer.on(CANAIS_DESKTOP.deepLink, () => fn());
  },
  deepLinkPendente: () => ipcRenderer.invoke(CANAIS_DESKTOP.deepLinkPendente),
  aoBuscar: (fn: (acao: AcaoDeBusca) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.buscar);
    ipcRenderer.on(CANAIS_DESKTOP.buscar, (_evento, acao: AcaoDeBusca) => {
      if (acao === "abrir" || acao === "proxima" || acao === "anterior") fn(acao);
    });
  },
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
