import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { app, autoUpdater, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerMonitor, powerSaveBlocker, safeStorage, screen, session, shell, systemPreferences, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { driverDoPlano, iniciarLaco } from "../src/adapters/executor/laco.ts";
import { encerrarGruposVivos, executarColetando, iniciarProcesso, registrarGruposEm } from "../src/adapters/executor/processo.ts";
import { encerrarGruposOrfaos } from "../src/adapters/executor/grupos-orfaos.ts";
import { encerrarFugitivosDaInstancia } from "../src/adapters/executor/fugitivos.ts";
import { criarAcompanhanteDeTarefas } from "../src/adapters/executor/acompanhar-tarefas.ts";
import { criarAcompanhanteDeSubagentes } from "../src/adapters/executor/acompanhar-subagentes.ts";
import { iniciarPoolDeLacos, type PoolDeLacos } from "../src/adapters/executor/pool-lacos.ts";
import { criarAmostradorMemoria } from "../src/adapters/executor/amostrador-memoria.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, modoDaLimpeza, type LimpezaDasTasks } from "../src/adapters/executor/limpeza-das-tasks.ts";
import { iniciarDesfazeres, type Desfazeres } from "../src/adapters/executor/desfazeres.ts";
import { iniciarEsperas, type Esperas } from "../src/adapters/executor/esperas.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { configDosDrivers, criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { lerPathDoShell, resolverBinario, resolverBinarioDetalhado } from "../src/adapters/executor/caminho.ts";
import { compararVersoes, extrairVersao, PISO_CLI } from "../src/adapters/executor/flag-floors.ts";
import { atualizarCli } from "../src/adapters/executor/atualizar-cli.ts";
import { prazoSondaDoEnv } from "../src/adapters/executor/sonda.ts";
import type { ConfigDriver, Driver, RegistroDriver } from "../src/adapters/executor/spi.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import type { Registry } from "../src/adapters/executor/spi.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";
import { repassarAcaoDoEvento } from "../src/domain/rotulo-ferramenta.ts";
import { CANAIS_DESKTOP, IAS_DESKTOP, type AlvoAviso, type ContasNaTela, type DetalhesDasContas, type AvisoDesktop, type IaDesktop, type PreferenciasDesktop, type ResultadoIaDesktop, type TemaDesktop, type TesteDeIa } from "../src/contracts/desktop.ts";
import type { ContaDaIa, EstadoIa, LoginDaIa, ResultadoColarCodigo } from "../src/contracts/estado-ia.ts";
import { contaDoCodex } from "./conta-codex.ts";
import { ambienteNaConta, diretorioPadrao, gravarContasDoMac, iaDasContas, lerContasDoMac, prepararPastaDaConta, removerPastaDaConta } from "./contas-mac.ts";
import { criarContasDoApp } from "./contas-no-app.ts";
import { ID_CONTA_PADRAO } from "../src/domain/contas-da-ia.ts";
import { estadoDaMaquina } from "../src/domain/harness.ts";
import { criarContasLocais, inventariosComContas, type ContasLocais } from "./contas-locais.ts";
import { concluirLoginArmado } from "./login-armado.ts";
import { iniciarContasNoServidor } from "./contas-no-servidor.ts";
import { iniciarInstalacoesNoServidor } from "./instalacoes-no-servidor.ts";
import { lerIdentidadeNoCli, type ClisDoMotor } from "../motor/contas.ts";
import { estadoDaIa } from "../src/domain/estado-ia.ts";
import { ambienteDoLogin, comandoDeAtualizar, comandoDeEstadoDoLogin, comandoDeLogin, comandoDeLoginNoApp, comandoDeLogout, contaPeloStatusClaude, lerIaDesktop, logadoPeloStatus, textoDaImpressao, textoDaImpressaoComConta, URL_INSTALAR_IA } from "./ia-mac.ts";
import { criarLoginDasIas, type ProcessoDeLogin, type StatusDoLogin } from "./login-ia.ts";
import { ambienteDoNpm, criarInstaladorDeIas, PACOTE_DA_IA, scriptNodeDoNod, type ProcessoNpm } from "./instalar-ia.ts";
import { criarAtualizadorDeIas, diaLocal, fimDaInstalacao, inventarioComAtualizacao, passosPelaOrigem, type GatilhoAtualizar, type PassoAtualizar } from "./atualizador-ias.ts";
import { cabeAprovacao, criarElevador, depsReaisDoElevador } from "./elevar-mac.ts";
import { ambienteDoBinarioDoNod, ativarPrefixo, candidatosDoNod, descartarPrefixo, escolherBinario, nomeDaVersao, pastasFerramentas, prefixoAtivo, prepararPrefixoNovo, type Candidato } from "./ferramentas.ts";
import { criarVigiaDasIas, type Veredito, type VigiaDasIas } from "./vigia-ias.ts";
import { criarFilaDeepLink, criarLogAdiado, criarReceptorDeepLink, deepLinkDoArgv } from "./deep-link.ts";
import type { BarraDesktop, DecisoesBarraDesktop } from "../src/contracts/desktop-barra.ts";
import { barraDoPedido, criarFilaDeGravacao, decisoesComPedido, lerAviso, lerContador, lerDecisoesBarra, lerPreferencias, respostaSincrona, lerTemaDesktop, opcoesDoAviso, origemDe, remetenteWebValido } from "./avisos-mac.ts";
import { abreNoNavegador } from "./links-externos.ts";
import { arquivoDaMidia } from "./midia-mac.ts";
import { CANAIS_MIDIA } from "../src/contracts/midia-desktop.ts";
import { CANAIS_REMOVER, type OpcoesRemover, type ResultadoRemoverDaqui } from "../src/contracts/remover-computador.ts";
import { lerOpcoesRemover } from "../src/shared/opcoes-remover.ts";
import { removerDaquiNoMac, type DepsRemoverDaqui } from "./remover-daqui.ts";
import type { EstaMaquina } from "../src/contracts/desktop-esta-maquina.ts";
import { estaMaquinaDe } from "../src/domain/esta-maquina.ts";
import { abrirPrimeiroUsoDaVm, focarJanela, LARGURA_MINIMA, lerEstadoJanela, medirEstadoJanela, resolverEstadoJanela, type EstadoJanela } from "./janela.ts";
import { estadoDoMicrofone, lerEmLigacao, permitirChecagemDeMidia, permitirPedidoDeMidia, TEXTO_FECHAR_EM_LIGACAO } from "./permissoes-midia.ts";
import type { EstadoMicrofone } from "../src/contracts/desktop.ts";
import { criarDetectorGh, executarGithubNaMaquina } from "../src/adapters/conectores-locais/github/maquina.ts";
import { pedirProvisorio, segredoDeTroca, servidorOfereceProvisorio, trocarChaveDoApp, verificadorNovo, verificadorValido } from "./conta-provisoria.ts";
import { FalhaPareamento, parearPeloNavegador } from "./parear.ts";
import { criarGoogleNoApp } from "./google-conta.ts";
import { esteComputadorEm } from "./este-computador.ts";
import { IDIOMA_DO_APP, templateDoMenu } from "./menu.ts";
import { aoRecusarVersao, confirmarReinicio, sairAoFecharJanelas, criarAtualizacaoDoApp, servidorDeAtualizacao, linhaDaAtualizacao, linkDownloadMac, type CaixaReinicio, TEXTOS_ATUALIZACAO, type AtualizacaoDoApp, type EstadoAtualizacaoApp } from "./atualizacao.ts";
import { criarArquivoDeLog, escreverDiagnostico, instalarOuvintesDeQueda, lerCaudaDoLog, MAX_BYTES_LOG } from "./diagnostico.ts";
import { montarVmLocal, type VmLocalDoApp } from "./vm-local/ligar.ts";
import { montarDiagnostico, nomeArquivoDiagnostico, TETO_REGISTROS_BYTES, type EntradaDiagnostico } from "../src/domain/diagnostico-app.ts";
import { definirDestinoDoLog, log } from "../src/obs/log.ts";
import type { Inventario } from "../src/contracts/inventario.ts";
import type { IdDriver } from "../src/adapters/executor/spi.ts";

/** ADR-069: o endereço do servidor vem no build (scripts/desktop/build.mjs, NOD_SERVIDOR_PADRAO); vazio = a pessoa informa. */
declare const __NOD_SERVIDOR_PADRAO__: string;
const SERVIDOR_PADRAO = typeof __NOD_SERVIDOR_PADRAO__ === "string" ? __NOD_SERVIDOR_PADRAO__ : "";

/** `provisoria`: a conexão de um espaço provisório (NOD-345); só ela o "Sou da equipe" (NOD-406) pode desfazer. */
type Config = { url: string; chave: string; provisoria?: true };
const dir = dirname(fileURLToPath(import.meta.url));
const setup = join(dir, "setup.html");
const setupUrl = pathToFileURL(setup).href;
let janela: BrowserWindow | null = null;
let configuracao: Config | null = null;
let laco: PoolDeLacos | null = null;
/**
 * definido em 2026-10-07 (ADR-083 §4, #194): UM amostrador de memória para o Mac inteiro (pressão do macOS e memória
 * por grupo de processos), compartilhado por todos os laços do pool; cada renovação leva a última leitura.
 * `NOD_SIMULAR_PRESSAO=1|2|4` no ambiente do app força o nível (UAT). O timer não segura o app aberto.
 */
/** NOD-93 (ADR-127): a VM local do Mac; null sem `NOD_VM_LOCAL=1` (padrão) ou fora do Mac. */
let vmLocal: VmLocalDoApp | null = null;
let faseVmAnterior: string | null = null;
let primeiroUsoAberto = false;
/** NOD-93 (passo 10): o download do disco começou — traz a janela e abre o painel do computador, uma vez por sessão. */
function primeiroUsoDaVm(estado: string): void {
  const abrir = abrirPrimeiroUsoDaVm(faseVmAnterior, estado, primeiroUsoAberto);
  faseVmAnterior = estado;
  if (!abrir) return;
  const web = janelaWeb();
  if (!web) return;
  primeiroUsoAberto = true;
  focarJanela(web);
  web.webContents.send(CANAIS_DESKTOP.abrir, { tipo: "computador-do-bot", primeiroUso: true } satisfies AlvoAviso);
}
/**
 * NOD-136: o link `nod://` que chegou de fora (open-url no Mac, argv da segunda instância no Windows/Linux). Qualquer
 * página pode montar um: inválido só grava o motivo (nunca a URL) e traz o app para a frente (critério 6). Válido vai para a fila de um alvo,
 * traz a janela e avisa a web, que o busca quando tem sessão, frota e salas (`deepLinkPendente`), o que cobre o app
 * frio, a tela de conexão e o login, que troca de página. Passados 2 min na fila, o alvo é descartado. O log fica
 * guardado até o arquivo de log existir (o link do app frio chega antes do `ready`).
 */
// A validade (2 min) é de relógio de parede: o monotônico para com o Mac dormindo, e o link de antes da tampa fechada
// valeria ao acordar. O intervalo de 2 s do receptor segue no monotônico.
const filaDeepLink = criarFilaDeepLink(() => Date.now());
const logDeepLink = criarLogAdiado((nivel, evento, campos) => { log(nivel, evento, campos); });
const receberDeepLink = criarReceptorDeepLink({
  fila: filaDeepLink,
  log: logDeepLink.log,
  focar: () => focarJanela(janela),
  avisarWeb: () => janelaWeb()?.webContents.send(CANAIS_DESKTOP.deepLink),
  agora: () => performance.now(),
  agendar: (fn, ms) => { setTimeout(fn, ms); },
});
function entregarDeepLink(): AlvoAviso | null {
  const { alvo, expirou } = filaDeepLink.tirar();
  if (expirou) logDeepLink.log("info", "deep_link_expirado");
  return alvo;
}
// NOD-93 passo 10: a VM ligada entra como um bloco no total da memória do Mac.
const memoriaDoMac = criarAmostradorMemoria({ env: process.env, bloco: () => vmLocal?.memoriaMb() ?? 0 });
let registry: Registry | null = null;
let cliente: ReturnType<typeof criarPonteHttp> | null = null;
let mensagem = "";
let conectando = false;
let encerrando = false;
let falhando = false;
let itensGithub: ReturnType<typeof setInterval> | null = null;
/** ADR-088 (2026-10-09): a limpeza das pastas de task encerradas neste Mac (o servidor diz quais; o Mac apaga). */
let limpezaDasTasks: LimpezaDasTasks | null = null;
/** ADR-099 (parte 2, 2026-10-12): o laço das esperas de comando deste Mac; os comandos em si moram no módulo esperas.ts. */
let esperasDoMac: Esperas | null = null;
/** NOD-54 (ADR-134): o laço dos desfazeres de arquivos deste Mac. */
let desfazeresDoMac: Desfazeres | null = null;
/** Revisão do #225: os turnos rodando neste Mac — a limpeza não mexe na pasta de nenhum deles. */
const planosNoMac = new Map<string, PlanoTurno>();
/**
 * A vigia das IAs da conexão atual (vigia-ias.ts; revisto em 2026-10-05): sem IA pronta ela olha de novo a cada 3 s
 * (ADR-077), guarda o veredito do teste de verdade e reanuncia o inventário ao servidor quando ele muda.
 */
let vigiaIas: VigiaDasIas | null = null;
/** A config dos drivers da conexão atual (ambiente limpo + PATH aumentado): a sonda e o login da IA a reaproveitam. */
let cfgExecutor: ConfigDriver | null = null;
/** O que o diagnóstico (NOD-138) conta da conexão atual; `parar()` zera. */
let inventariosAtuais: Partial<Record<IdDriver, Inventario>> | null = null;
let maquinaIdAtual: string | null = null;
/**
 * ADR-102 (2026-10-13): as contas deste Mac como o servidor as vê (só a impressão), a puxada do que a tela pede (sair,
 * desconectar) e o driver de cada conta que um plano pede (`plano.conta`). Nascem com a conexão (a impressão leva a pessoa).
 */
let contasLocais: ContasLocais | null = null;
let contasNoServidor: { parar(): void } | null = null;
/** NOD-94: este Mac como instaladora por SSH (só quando o servidor diz que aceita: `instalacoes: true` na conexão). */
let instalacoesNoServidor: { parar(): Promise<void> } | null = null;
const driversPorConta = new Map<string, Promise<RegistroDriver | null>>();
let sincronizandoContas: Promise<void> = Promise.resolve();
let ghLogado: boolean | null = null;
/**
 * definido em 2026-09-24 (ADR-048): de 5 em 5 s o app puxa os itens aprovados que rodam no gh deste
 * Mac (um comentário que a pessoa aprovou no celular sai assim que o Mac estiver aberto). Um por vez.
 */
const INTERVALO_ITENS_GITHUB_MS = 5_000;
/**
 * revisto em 2026-09-25: item que já rodou neste Mac nunca roda de novo (comentar e revisar no GitHub
 * não são idempotentes). O desfecho fica guardado até o servidor aceitar o relato; a cada volta o app
 * reenvia só o relato. Limite: fechar o app entre rodar e relatar perde esta memória.
 */
const relatosPendentes = new Map<string, "executado" | "falhou_na_execucao">();
function vigiarItensGithub(c: ReturnType<typeof criarPonteHttp>) {
  let ocupado = false;
  const relatar = async (itemId: string, desfecho: "executado" | "falhou_na_execucao") => {
    relatosPendentes.set(itemId, desfecho);
    await c.resultadoItemLocal(itemId, desfecho).then(() => relatosPendentes.delete(itemId), () => undefined);
  };
  itensGithub = setInterval(() => {
    if (ocupado) return;
    ocupado = true;
    void (async () => {
      for (const [itemId, desfecho] of [...relatosPendentes]) await relatar(itemId, desfecho);
      for (const item of await c.itensLocais()) {
        const jaRodou = relatosPendentes.get(item.itemId);
        if (jaRodou) { await relatar(item.itemId, jaRodou); continue; }
        const r = await executarGithubNaMaquina({ capacidade: item.capacidade, argumentos: item.argumentos, ambiente: process.env });
        await relatar(item.itemId, r.isError ? "falhou_na_execucao" : "executado");
      }
    })().catch(() => undefined).finally(() => { ocupado = false; });
  }, INTERVALO_ITENS_GITHUB_MS);
}
const mensagens: Record<string, string> = {
  servidor_fora: "O servidor não respondeu. Confira sua conexão; o app tentará novamente.",
  chave_invalida: "Esta chave não é mais válida. Gere uma nova em Chaves no navegador.",
  atualize_app: TEXTOS_ATUALIZACAO.atualizeApp(linkDownloadMac(process.arch)),
  reconectar: "Reconectando ao servidor…",
  resposta_invalida: "Confira o endereço HTTPS do servidor do seu time.",
  sem_resposta: "O navegador não confirmou a tempo. Clique em Entrar com Google de novo.",
  recusado: "O nod não confirmou este Mac. Clique em Entrar com Google de novo.",
};
function caminhoConfig() { return join(app.getPath("userData"), "conexao.enc"); }

// ---- Avisos no Mac (definido em 2026-09-24) ----------------------------------------------------------
// A preferência mora em userData/preferencias.json: o localStorage da janela web é apagado a cada
// conexão (clearStorageData abaixo). O aviso sai daqui, do processo principal — a página continua sem
// permissão nenhuma (proteger) —, e só com a janela fora de foco.
let preferencias: Pick<PreferenciasDesktop, "avisos" | "tema" | "som"> & { barra: BarraDesktop | null; decisoesBarra: DecisoesBarraDesktop } = { avisos: true, tema: "sistema", som: true, barra: null, decisoesBarra: {} };
/** O último aviso falhou ao aparecer (o macOS bloqueou); o próximo que aparecer desfaz. */
let bloqueados = false;
let contadorAtual = 0;
/** Referência viva de cada aviso: sem ela o coletor leva o objeto e o clique se perde. */
const avisosVivos: Notification[] = [];
const MAX_AVISOS_VIVOS = 20;
function caminhoPreferencias() { return join(app.getPath("userData"), "preferencias.json"); }
function estadoPreferencias(): PreferenciasDesktop { return { avisos: preferencias.avisos, tema: preferencias.tema, som: preferencias.som, bloqueados }; }
async function carregarPreferencias() {
  const conteudo = await readFile(caminhoPreferencias(), "utf8").catch(() => null);
  preferencias = { ...lerPreferencias(conteudo), decisoesBarra: lerDecisoesBarra(conteudo) };
}
// NOD-119: as escritas entram numa fila (o arrasto da borda grava a cada passo): sem corrida no rename do .tmp, e cada
// uma grava as preferências do momento em que roda, então a última vence.
const naFilaDePreferencias = criarFilaDeGravacao();
function gravarPreferencias(): Promise<void> {
  return naFilaDePreferencias(async () => {
    await mkdir(app.getPath("userData"), { recursive: true });
    const tmp = `${caminhoPreferencias()}.tmp`;
    await writeFile(tmp, JSON.stringify(preferencias), { mode: 0o600 });
    await rename(tmp, caminhoPreferencias());
  });
}
// ---- Estado da janela web (definido em 2026-10-05, NOD-137) ---------------------------------------------------------
// Posição, tamanho e maximizada em userData/janela.json, lidos uma vez no boot e mantidos em memória: a reconexão recria a
// janela no mesmo lugar sem reler o disco. Minimizada não grava; tela cheia grava o último estado como janela normal. As
// escritas entram numa fila (sem corrida no rename) e o before-quit espera a última; escrita cortada deixa só o .tmp, e o
// janela.json anterior fica intacto.
let estadoJanela: EstadoJanela | null = null;
let gravacaoJanela: Promise<void> = Promise.resolve();
const ESPERA_ESTADO_JANELA_MS = 250;
const TAMANHO_PADRAO_JANELA = { largura: 1280, altura: 860 };
function caminhoEstadoJanela() { return join(app.getPath("userData"), "janela.json"); }
async function carregarEstadoJanela() {
  estadoJanela = lerEstadoJanela(await readFile(caminhoEstadoJanela(), "utf8").catch(() => null));
}
async function gravarEstadoJanela(estado: EstadoJanela) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoEstadoJanela()}.tmp`;
  await writeFile(tmp, JSON.stringify(estado), { mode: 0o600 });
  await rename(tmp, caminhoEstadoJanela());
}
function telas() { return { principal: screen.getPrimaryDisplay().workArea, todas: screen.getAllDisplays().map((d) => d.workArea) }; }
/** Síncrono: mede a janela agora (medirEstadoJanela) e enfileira a escrita. */
function capturarEstadoJanela(w: BrowserWindow) {
  const estado = medirEstadoJanela(w, estadoJanela);
  if (!estado) return;
  estadoJanela = estado;
  gravacaoJanela = gravacaoJanela.then(() => gravarEstadoJanela(estado)).catch(() => undefined);
}
// ---- Tema (definido em 2026-10-04, ADR-070) ------------------------------------------------------------
// O nativeTheme decide o prefers-color-scheme da página: com ele, o tema escolhido vale desde o primeiro quadro,
// mesmo com o localStorage apagado a cada conexão, e a janela já nasce com o fundo certo (sem piscar branco).
function aplicarTemaNativo() { nativeTheme.themeSource = preferencias.tema === "claro" ? "light" : preferencias.tema === "escuro" ? "dark" : "system"; }
/** Fundo da janela antes da página pintar: os valores de --surface em web/tokens.css. */
function fundoDaJanela() { return nativeTheme.shouldUseDarkColors ? "#131315" : "#ffffff"; }
async function definirTema(tema: TemaDesktop): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, tema };
  aplicarTemaNativo();
  await gravarPreferencias();
  return estadoPreferencias();
}
/** Desligado, o Dock também apaga: o número é parte dos avisos. */
function aplicarContador() { app.setBadgeCount(preferencias.avisos ? contadorAtual : 0); }
async function definirAvisos(ligado: boolean): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, avisos: ligado };
  montarMenu(); aplicarContador();
  await gravarPreferencias();
  return estadoPreferencias();
}
/** Som dos avisos (NOD-196): só muda o `silent` do próximo aviso; com os avisos desligados, a escolha fica guardada. */
async function definirSom(ligado: boolean): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, som: ligado };
  await gravarPreferencias();
  return estadoPreferencias();
}
function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(templateDoMenu({ avisos: preferencias.avisos, empacotado: app.isPackaged, atualizacao: atualizacaoApp?.estado() }, {
    conexao: () => { void parar().then(mostrarSetup); }, definirAvisos: (ligado) => { void definirAvisos(ligado); }, exportarDiagnostico: () => { void exportarDiagnostico(); }, buscar: (acao) => { janelaWeb()?.webContents.send(CANAIS_DESKTOP.buscar, acao); },
    procurarAtualizacao: () => { atualizacaoApp?.procurar(true, true); }, reiniciarParaAtualizar: () => { void atualizacaoApp?.reiniciar(); },
  })));
}
// ---- Atualização do app do Mac (NOD-132, ADR-149) --------------------------------------------------------------------
// O autoUpdater nativo (Squirrel.Mac) lê o feed do servidor com a chave da máquina; o estado aparece no menu nod, numa
// notificação quando a versão nova fica pronta e na tela de conexão. A web não sabe de nada (decisão de produto).
let atualizacaoApp: AtualizacaoDoApp | null = null;
/** O servidor e a chave da conexão atual ou da última tentativa: o app recusado com 426 ainda precisa do feed. */
let conexaoDaAtualizacao: { url: string; chave: string } | null = null;
let avisoDaAtualizacao: Notification | null = null;
function aoMudarAtualizacao(e: EstadoAtualizacaoApp) {
  montarMenu();
  const w = janela;
  if (w && !w.isDestroyed() && w !== janelaWeb()) w.webContents.send("nod:atualizacao", linhaDaAtualizacao(e, process.arch));
  if (e.fase === "pronta" && !avisoDaAtualizacao && preferencias.avisos && Notification.isSupported()) {
    const n = new Notification({ title: TEXTOS_ATUALIZACAO.avisoTitulo, body: TEXTOS_ATUALIZACAO.pronta(e.versao), silent: !preferencias.som });
    avisoDaAtualizacao = n; // referência viva: sem ela o coletor leva o objeto e o clique se perde
    n.on("click", () => { void atualizacaoApp?.reiniciar(); });
    n.show();
  }
}
/** Ligação aberta: recusa com aviso. Bot trabalhando neste Mac: confirma (reiniciar interrompe). */
async function podeReiniciarParaAtualizar(): Promise<boolean> {
  const w = janela && !janela.isDestroyed() ? janela : null;
  const caixa: CaixaReinicio = async (c) => {
    const o: Electron.MessageBoxOptions = { type: c.tipo, message: c.mensagem, detail: c.detalhe, buttons: c.botoes, defaultId: c.padrao ?? 0, cancelId: c.padrao ?? 0 };
    return (await (w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o))).response;
  };
  return confirmarReinicio({ emLigacao: () => emLigacao, turnos: () => planosNoMac.size, telas: () => vmLocal?.preparador.telasAbertas() ?? 0, caixa });
}
/** O mesmo encerramento do Cmd+Q (before-quit), antes de o Squirrel fechar o app. */
async function antesDeInstalarAtualizacao(): Promise<void> {
  encerrando = true;
  const w = janelaWeb();
  if (w) capturarEstadoJanela(w);
  await Promise.all([parar(), gravacaoJanela, vmLocal?.parar()]);
}
// ---- Diagnóstico para suporte (definido em 2026-10-05, NOD-138) -------------------------------------------------------
// Só pelo menu nativo: funciona na tela de conexão e com a janela web fora do ar, e não aumenta a ponte da página. O texto
// sai de montarDiagnostico (redigido, ~ no lugar da pasta pessoal) e fica só neste Mac: nada sobe ao servidor.
const AVISO_DIAGNOSTICO = "O arquivo traz a versão do app, o estado da conexão e da IA e os registros recentes deste Mac. Não traz chaves, senhas nem o texto das suas conversas.";
const FALHA_DIAGNOSTICO = "Não foi possível salvar o diagnóstico. Escolha outra pasta e tente de novo.";
function entradaDiagnostico(): EntradaDiagnostico {
  const conectado = cliente !== null;
  return {
    app: { versao: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, plataforma: process.platform, arquitetura: process.arch, versaoSistema: process.getSystemVersion(), empacotado: app.isPackaged, ligadoHaSegundos: process.uptime() },
    conexao: { servidor: configuracao?.url ?? null, conectado, maquinaId: maquinaIdAtual, status: mensagem },
    ia: inventariosAtuais ? Object.entries(inventariosAtuais).map(([harness, i]) => ({ harness, estado: i?.estado ?? "desconhecido", motivo: i && "motivo" in i ? i.motivo : null, versao: i && "versao" in i ? i.versao ?? null : null })) : null,
    execucao: { conectado, lacoAtivo: laco !== null, sondandoIa: vigiaIas !== null && laco === null, emLigacao, githubNoMac: ghLogado },
    preferencias: { avisos: preferencias.avisos, tema: preferencias.tema, som: preferencias.som, avisosBloqueados: bloqueados },
    registros: lerCaudaDoLog(app.getPath("logs"), TETO_REGISTROS_BYTES),
  };
}
async function exportarDiagnostico() {
  const agora = Date.now();
  const opcoes = { title: "Exportar diagnóstico", message: AVISO_DIAGNOSTICO, defaultPath: join(app.getPath("downloads"), nomeArquivoDiagnostico(agora, -new Date(agora).getTimezoneOffset())), filters: [{ name: "Texto", extensions: ["txt"] }] };
  const w = janela && !janela.isDestroyed() ? janela : null;
  const r = w ? await dialog.showSaveDialog(w, opcoes) : await dialog.showSaveDialog(opcoes);
  if (r.canceled || !r.filePath) return;
  try {
    escreverDiagnostico(r.filePath, montarDiagnostico(entradaDiagnostico(), agora));
    log("info", "diagnostico_exportado");
    shell.showItemInFolder(r.filePath);
  } catch {
    log("aviso", "diagnostico_nao_salvo");
    const erro = { type: "warning" as const, message: FALHA_DIAGNOSTICO };
    void (w ? dialog.showMessageBox(w, erro) : dialog.showMessageBox(erro));
  }
}
/** A janela aberta é a do nod web, na origem do servidor configurado (e não a tela de conexão). */
function janelaWeb(): BrowserWindow | null {
  const w = janela;
  const origem = origemDe(configuracao?.url);
  return w && !w.isDestroyed() && origem !== null && origemDe(w.webContents.getURL()) === origem ? w : null;
}
function avisar(aviso: AvisoDesktop): boolean {
  const w = janelaWeb();
  if (!preferencias.avisos || !w || w.isFocused() || !Notification.isSupported()) return false;
  const n = new Notification(opcoesDoAviso(aviso, { som: preferencias.som }));
  const soltar = () => { const i = avisosVivos.indexOf(n); if (i >= 0) avisosVivos.splice(i, 1); };
  avisosVivos.push(n);
  if (avisosVivos.length > MAX_AVISOS_VIVOS) avisosVivos.shift();
  n.on("show", () => { bloqueados = false; });
  n.on("failed", () => { bloqueados = true; soltar(); });
  n.on("close", soltar);
  n.on("click", () => {
    soltar();
    const web = janelaWeb();
    if (!web) return;
    focarJanela(web);
    const alvo: AlvoAviso = aviso.alvo;
    web.webContents.send(CANAIS_DESKTOP.abrir, alvo);
  });
  n.show();
  return true;
}
async function guardar(c: Config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("keychain_indisponivel");
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoConfig()}.tmp`;
  await writeFile(tmp, safeStorage.encryptString(JSON.stringify(c)), { mode: 0o600 });
  await rename(tmp, caminhoConfig());
}
/**
 * NOD-345 (ADR-124): o verificador desta instalação, cifrado como a conexão e guardado à parte (sobrevive a desconectar):
 * é ele que devolve o mesmo espaço provisório. Sem o safeStorage, nada de provisório (a tela de conexão de antes).
 */
async function verificadorDaInstalacao(): Promise<string | null> {
  if (!safeStorage.isEncryptionAvailable()) return null;
  const arquivo = join(app.getPath("userData"), "instalacao.enc");
  try {
    const v = safeStorage.decryptString(await readFile(arquivo));
    if (verificadorValido(v)) return v;
  } catch { /* primeira abertura */ }
  const novo = verificadorNovo();
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(`${arquivo}.tmp`, safeStorage.encryptString(novo), { mode: 0o600 });
  await rename(`${arquivo}.tmp`, arquivo);
  return novo;
}
/** NOD-406: a marca de "sou da equipe" desta instalação (sem ela, a primeira abertura pede um espaço provisório). */
function caminhoEquipe() { return join(app.getPath("userData"), "equipe"); }
/**
 * NOD-406: conectou pela tela de conexão (chave ou pareamento), então não é um provisório: se a conexão um dia sumir, a
 * próxima abertura volta a esta tela em vez de pedir um provisório novo. Falhar aqui não desfaz a conexão.
 */
async function marcarEquipeDoApp(): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true }).then(() => writeFile(caminhoEquipe(), "1\n", { mode: 0o600 })).catch(() => undefined);
}
/** Primeira abertura sem chave: o espaço provisório, se o servidor padrão oferece. null = segue a tela de conexão. */
async function configProvisoria(): Promise<Config | null> {
  // NOD-406 (revisões r5 a r7): conexao.enc que não se lê (Keychain negado ou resetado, outra assinatura) não vira
  // provisório sozinha, porque pode ser da equipe. A tela de conexão diz por quê; o arquivo é guardado de lado (não
  // apagado: a falha pode ser passageira) e a próxima abertura sem conectar volta ao sem conta.
  if (existsSync(caminhoConfig())) {
    await rename(caminhoConfig(), `${caminhoConfig()}.ilegivel`).catch(() => undefined);
    mensagem = "Não consegui ler a conexão guardada neste Mac (Keychain). Entre de novo, ou feche e abra o app para usar sem conta.";
    return null;
  }
  if (!SERVIDOR_PADRAO || existsSync(caminhoEquipe())) return null;
  const url = urlServidor(SERVIDOR_PADRAO, !app.isPackaged);
  if (!(await servidorOfereceProvisorio(url))) return null;
  const verificador = await verificadorDaInstalacao().catch(() => null);
  if (!verificador) return null;
  const chave = await pedirProvisorio({ servidor: url, verificador, nome: userInfo().username, versao: app.getVersion() });
  if (!chave) return null;
  log("info", "espaco_provisorio_no_app", {});
  return { url, chave, provisoria: true };
}
async function ler(): Promise<Config | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const c = JSON.parse(safeStorage.decryptString(await readFile(caminhoConfig()))) as Config;
    return { url: urlServidor(c.url, !app.isPackaged), chave: c.chave, ...(c.provisoria === true ? { provisoria: true as const } : {}) };
  } catch { return null; }
}
function proteger(w: BrowserWindow, origem?: string) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    // ADR-053: o link do bot (target=_blank) também sai para o navegador padrão; a janela nunca abre no app.
    if (origem && (url.startsWith(`${origem}/`) || abreNoNavegador(url))) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if ((!origem && url !== setupUrl) || (origem && new URL(url).origin !== origem)) e.preventDefault();
    if (origem && url.startsWith(`${origem}/api/sessao/google`)) { e.preventDefault(); void shell.openExternal(url); }
  });
  w.webContents.on("will-redirect", (e, url) => { if (!origem || new URL(url).origin !== origem) e.preventDefault(); });
  // definido em 2026-09-28 (ADR-051): o iframe do artefato (sandbox, CSP sem rede) ainda pode navegar A SI
  // MESMO — link, location, meta refresh —, a única saída que a CSP não fecha. No app, subframe nenhum sai
  // do documento que a página lhe deu (no navegador, a web fecha o iframe no segundo `load`).
  w.webContents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !/^about:(srcdoc|blank)$/.test(e.url)) e.preventDefault(); });
  // definido em 2026-10-04 (ADR-071, modo ligação): a única permissão da página é o microfone — `media` só de áudio, só na
  // origem do servidor, só no frame de topo desta janela (desktop/permissoes-midia.ts). A tela de conexão (sem origem) não
  // ganha nada. O macOS ainda pergunta antes (nod:microfone).
  w.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(!!origem && wc === w.webContents && permitirPedidoDeMidia({ permissao: permission, tiposDeMidia: "mediaTypes" in details ? details.mediaTypes : undefined, urlDoPedido: details.requestingUrl, frameDeTopo: details.isMainFrame, servidor: origem }));
  });
  w.webContents.session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => !!origem && wc === w.webContents && permitirChecagemDeMidia({ permissao: permission, tipoDeMidia: details.mediaType, origem: requestingOrigin, frameDeTopo: details.isMainFrame, servidor: origem }));
}

// ---- Modo ligação (definido em 2026-10-04, ADR-071) -----------------------------------------------------------------
// A página avisa que abriu uma ligação (nodDesktop.emLigacao): o app não é suspenso, a janela não é estrangulada em
// segundo plano (a voz continua com o nod atrás de outra janela) e fechar pergunta antes. Exceção à ADR-045 registrada na
// ADR-071: só com a ligação aberta pela pessoa.
let emLigacao = false;
let bloqueioDeSuspensao: number | null = null;
function definirEmLigacao(ativa: boolean) {
  emLigacao = ativa;
  // NOD-9: a ligação acabou — a brecha para atualizar o CLI pode ter chegado.
  if (!ativa) void atualizador.verificar().catch(() => undefined);
  const w = janelaWeb();
  if (ativa && bloqueioDeSuspensao === null) bloqueioDeSuspensao = powerSaveBlocker.start("prevent-app-suspension");
  if (!ativa && bloqueioDeSuspensao !== null) { powerSaveBlocker.stop(bloqueioDeSuspensao); bloqueioDeSuspensao = null; }
  w?.webContents.setBackgroundThrottling(!ativa);
}
/** O macOS pergunta pelo microfone uma vez; depois responde do que a pessoa escolheu (Ajustes do Sistema › Privacidade). */
async function acessoAoMicrofone(): Promise<EstadoMicrofone> {
  if (process.platform !== "darwin") return "concedido";
  const estado = estadoDoMicrofone(systemPreferences.getMediaAccessStatus("microphone"));
  if (estado) return estado;
  return (await systemPreferences.askForMediaAccess("microphone")) ? "concedido" : "negado";
}
/** Fechar com a ligação aberta: confirma; confirmado, a janela fecha e o servidor encerra pela queda da mídia. */
async function confirmarFecharEmLigacao(w: BrowserWindow): Promise<boolean> {
  const r = await dialog.showMessageBox(w, { type: "question", message: TEXTO_FECHAR_EM_LIGACAO.mensagem, detail: TEXTO_FECHAR_EM_LIGACAO.detalhe, buttons: [TEXTO_FECHAR_EM_LIGACAO.encerrar, TEXTO_FECHAR_EM_LIGACAO.continuar], defaultId: 1, cancelId: 1 });
  return r.response === 0;
}
async function mostrarSetup() {
  const anterior = janela;
  // Sem a janela web, o número do Dock ficaria parado no último valor.
  contadorAtual = 0; aplicarContador();
  const nova = new BrowserWindow({ width: 580, height: 850, minWidth: 500, title: "Conectar ao nod", backgroundColor: fundoDaJanela(), webPreferences: { preload: join(dir, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  janela = nova; proteger(nova);
  nova.on("closed", () => { if (janela === nova) janela = null; });
  await nova.loadFile(setup);
  anterior?.close();
}
async function parar() {
  atualizacaoApp?.desconectado(); // NOD-132: o ciclo de 4 h volta só no próximo conectado()
  if (itensGithub) clearInterval(itensGithub);
  itensGithub = null;
  limpezaDasTasks?.parar();
  limpezaDasTasks = null;
  esperasDoMac?.parar();
  esperasDoMac = null;
  desfazeresDoMac?.parar();
  desfazeresDoMac = null;
  vigiaIas?.parar();
  vigiaIas = null;
  contasNoServidor?.parar();
  contasNoServidor = null;
  // NOD-344: a limpeza das instalações em curso (o ssh-agent com a chave morto, a mestre encerrada, teto de 10 s) começa
  // já e é esperada no fim. A referência sai ANTES de qualquer await: um conectar() no meio grava a instaladora nova, e
  // este parar() não a zera por engano (revisão do PR #579).
  const instalacoesQueParam = instalacoesNoServidor;
  instalacoesNoServidor = null;
  const fimDasInstalacoes = instalacoesQueParam?.parar();
  // Revisão do PR #579: o cliente que sai é o de agora; um conectar() durante a espera (até 10 s) não é desligado por este.
  const clienteQueSai = cliente;
  vmLocal?.desconectar();
  const anterior = laco; laco = null;
  cliente?.cancelar();
  if (anterior) await anterior.parar().catch(() => undefined);
  for (const r of Object.values(registry ?? {})) if (r?.estado === "pronto") await r.instance.dispose();
  for (const chave of [...driversPorConta.keys()]) await descartarDriverDaConta(chave);
  contasLocais = null;
  // O aviso final das instalações paradas (instalacoes/progresso) exige a conexão viva: espera antes do desconectar,
  // como o motor (codex no PR #579).
  await fimDasInstalacoes;
  if (clienteQueSai) await clienteQueSai.ponte.desconectar("").catch(() => undefined);
  if (cliente === clienteQueSai) { registry = null; cliente = null; }
  inventariosAtuais = null; maquinaIdAtual = null; ghLogado = null;
  // definido em 2026-10-09: um login aberto pelo app morre com a conexão (a janela que mostrava o código fechou).
  await loginIas.parar().catch(() => undefined);
  inventariosDaVigia = null; testandoAgora = [];
}
/** definido em 2026-10-05: entre dois reanúncios depois de um 409 (o laço puxa a cada segundo e cada um falharia igual). */
const ESPERA_REANUNCIO_MS = 10_000;
let ultimoReanuncio = 0;
function falha(codigo: FalhaPonte["codigo"]) {
  mensagem = mensagens[codigo] ?? mensagens.servidor_fora!;
  // medido em produção em 2026-10-05: o servidor reiniciou num deploy, esqueceu a máquina e respondeu 409 a todo
  // `puxar`; o app só trocava a mensagem e a fila da pessoa ficou parada até ela reabrir o app. Agora se reanuncia.
  if (codigo === "reconectar" && vigiaIas && Date.now() - ultimoReanuncio >= ESPERA_REANUNCIO_MS) {
    ultimoReanuncio = Date.now();
    void vigiaIas.reanunciar().then(() => { if (mensagem === mensagens.reconectar) mensagem = "Conectado."; }).catch(() => undefined);
  }
  if (codigo === "atualize_app") atualizacaoApp?.procurar(true);
  if (codigo === "chave_invalida") conexaoDaAtualizacao = null; // chave revogada: o feed daria 401 calado
  if (!["chave_invalida", "atualize_app"].includes(codigo) || falhando || encerrando) return;
  falhando = true;
  setTimeout(() => {
    void parar()
      // NOD-132: abaixo da mínima o app fica na tela de conexão; o ciclo de procura segue (a flag pode ligar depois).
      .then(() => { if (codigo === "atualize_app") atualizacaoApp?.conectado(); return mostrarSetup(); })
      .finally(() => { falhando = false; });
  }, 0);
}
/**
 * ADR-089 (#217): os grupos dos turnos que a vida anterior do app deixou (Forçar Encerrar, queda, SIGKILL) morrem antes
 * do primeiro turno desta — só os que ainda são os processos anotados. Uma vez por processo; `conectar` espera.
 */
let limpezaDeOrfaos: Promise<void> | null = null;
function limparOrfaosUmaVez(): Promise<void> {
  limpezaDeOrfaos ??= (async () => {
    const arquivo = join(app.getPath("userData"), "executor", "grupos-vivos.json");
    const r = await encerrarGruposOrfaos({ arquivo }).catch(() => ({ assumiu: true }));
    if (!r.assumiu) return;
    // ADR-097: o que saiu dos grupos com a marca do app (o Postgres de teste de uma task) e ficou de outra vida.
    await encerrarFugitivosDaInstancia(arquivo);
    registrarGruposEm(arquivo);
  })();
  return limpezaDeOrfaos;
}
async function conectar(c: Config) {
  conexaoDaAtualizacao = { url: c.url, chave: c.chave };
  await limparOrfaosUmaVez();
  await parar();
  const r = await fetch(`${c.url}/api/maquina/sessao`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": app.getVersion(), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  const minima = r.headers.get("x-nod-versao-minima");
  if (r.status === 426 || (minima && !versaoAceita(app.getVersion(), minima))) {
    aoRecusarVersao(atualizacaoApp); // NOD-132: procura na hora e arma o ciclo (o feed fica fora do 426)
    throw new FalhaPonte("atualize_app");
  }
  if (r.status === 401 || r.status === 403) { conexaoDaAtualizacao = null; throw new FalhaPonte("chave_invalida"); }
  if (!r.ok) throw new FalhaPonte("servidor_fora");
  const dados = await r.json() as { escopo: { pessoaId: string }; machineId: string; instalacoes?: unknown };
  const cookie = r.headers.get("set-cookie")?.match(/(?:^|;\s*)nod_sessao=([^;]+)/)?.[1];
  if (!cookie || !dados.escopo?.pessoaId || !dados.machineId) throw new FalhaPonte("resposta_invalida");
  const web = session.fromPartition("nod-web");
  await web.clearStorageData();
  await web.cookies.set({ url: c.url, name: "nod_sessao", value: cookie, path: "/", httpOnly: true, secure: c.url.startsWith("https:"), sameSite: "strict" });
  await guardar(c); configuracao = c;
  // ADR-052: o hook do nod vai empacotado ao lado do proxy; sem ele o kit do terminal não liga.
  const lig = { urlNod: c.url, proxyPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "proxy.mjs") : join(dir, "proxy.mjs"), hookPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "hook-nativas.mjs") : join(dir, "hook-nativas.mjs"), nodePath: process.execPath, electronComoNode: true, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(process.env), filaDoForno: process.env.NOD_FILA_DO_FORNO !== "0" };
  const envExecutor = { ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") };
  // NOD-9: o turno do Claude espera o portão da atualização e pede a versão que o modelo exige.
  const drivers: Driver[] = [criarClaudeCliDriver({ ...lig, aguardarAtualizacao: () => atualizador.aguardar("claude-cli"), aoPrecisarDeVersao: (m) => atualizador.pedirVersao("claude-cli", m) }), criarCodexCliDriver(lig)];
  const cfg = await montarCfg(envExecutor);
  cfgExecutor = cfg;
  const criado = await criarRegistryDetalhado(envExecutor, drivers, { cfg });
  contasDoApp.registryRefeito(IAS_DESKTOP);
  // Um objeto só, atualizado no lugar a cada sondagem: o laço lê `registry[driver]` a cada turno, então uma IA que
  // fica pronta depois (ou um driver recriado) passa a valer sem reiniciar o laço.
  const registryDoLaco: Registry = criado.registry;
  registry = registryDoLaco;
  inventariosAtuais = criado.inventarios; maquinaIdAtual = dados.machineId;
  // ADR-099 (I5): a frente que terminou sem trabalho sai na hora (a resposta do entregar traz a pasta).
  const ponteHttp = criarPonteHttp({ url: c.url, chave: c.chave, versao: app.getVersion(), aoFalhar: falha, aoLimparAgora: (pastas) => void limpezaDasTasks?.limparAgora(pastas) });
  cliente = ponteHttp;
  // ADR-048: o gh já logado neste Mac vira o jeito de conectar o GitHub da pessoa, sem ela configurar nada.
  const gh = await criarDetectorGh({ ambiente: process.env }).logado();
  if (cliente === ponteHttp) ghLogado = gh; // um parar() durante o await já zerou: não ressuscita o valor velho
  const anuncio = { machineId: dados.machineId, nome: hostname(), versaoContrato: 1, github: { gh }, ligacao: true } as const;
  if (gh) vigiarItensGithub(ponteHttp);
  // NOD-93 (ADR-127 §3): com a VM local, o Mac também puxa os comandos do computador e os passa à VM.
  if (cliente === ponteHttp) vmLocal?.conectar(ponteHttp.computador);
  if (cliente === ponteHttp) {
    // ADR-088: o PATH do shell de login (o mesmo dos drivers) — as ferramentas de onde a pessoa as instalou.
    limpezaDasTasks?.parar();
    const homeDoMac = cfg.env.HOME ?? homedir();
    const modo = modoDaLimpeza(process.env);
    log("info", "limpeza_modo", { modo, onde: "app_do_mac" });
    limpezaDasTasks = modo === "desligada" ? null : iniciarLimpezaDasTasks({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, home: homeDoMac, executar: criarExecutarComando(cfg.env, homeDoMac), simular: modo === "simular", emUso: (pasta) => [...planosNoMac.values()].some((p) => p.pastaDoBot === pasta || p.pastaDoBot?.startsWith(`${pasta}/`) === true) });
    // ADR-099 (parte 2): as esperas de comando deste Mac (o puxar, a cada 5 s), com o ambiente dos drivers.
    esperasDoMac?.parar();
    esperasDoMac = iniciarEsperas({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, home: homeDoMac, env: cfg.env });
    desfazeresDoMac?.parar();
    desfazeresDoMac = iniciarDesfazeres({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, home: homeDoMac });
  }
  // ADR-102 (2026-10-13): as contas deste Mac, lidas pelo CLI na pasta de cada uma (impressão = e-mail + organização +
  // pessoa, nunca em claro ao servidor). A lista segue a do app (contas.json); a primeira leitura é inteira (a pessoa
  // conectada pode ser outra).
  const locais = criarContasLocais({ base: pastaDasContas, arquivo: join(app.getPath("userData"), "contas-locais.json"), pessoaId: dados.escopo.pessoaId, padrao: (ia) => diretorioPadrao(ia, process.env, homedir()), lerIdentidade: (ia, env) => lerIdentidadeNoCli(clisDaIa(ia), ia, env), logout: (ia, env) => logoutDaConta(ia, env), agora: Date.now });
  await locais.carregar();
  if (cliente === ponteHttp) { contasLocais = locais; await sincronizarContas({ todas: true }); }
  /** ADR-102: o driver da conta que o plano pede (na pasta dela); "ausente" = a conta não está logada neste Mac. */
  const registroDaConta = async (plano: PlanoTurno): Promise<RegistroDriver | "ausente" | null> => {
    const local = plano.conta && contasLocais ? contasLocais.porImpressao(plano.conta.impressao) : null;
    if (!local || local.estado !== "pronta" || !contasLocais) return "ausente";
    const base = cfgExecutor ?? cfg;
    const chave = `${local.ia}:${local.id}:${binConfigurado(local.ia, base) ?? ""}`;
    let pronto = driversPorConta.get(chave);
    if (!pronto) {
      // O binário mudou (atualização da IA): o driver velho desta conta sai.
      for (const k of [...driversPorConta.keys()]) if (k.startsWith(`${local.ia}:${local.id}:`)) void descartarDriverDaConta(k);
      const driver = drivers.find((x) => x.meta.id === local.ia);
      const env = ambienteNaConta(local.ia, process.env, base.envPorDriver?.[local.ia] ?? {}, contasLocais.ambiente(local));
      const criando: Promise<RegistroDriver | null> = driver ? driver.create({ ...base, envPorDriver: { ...base.envPorDriver, [local.ia]: env } }).then((instance): RegistroDriver => ({ estado: "pronto", driver, instance })) : Promise.resolve(null);
      pronto = criando;
      driversPorConta.set(chave, criando);
      criando.catch(() => { if (driversPorConta.get(chave) === criando) driversPorConta.delete(chave); });
    }
    // Revisão do PR #306: falhar ao criar o driver é erro do turno, não conta ausente (o servidor apagaria o vínculo e o
    // reanúncio o traria de volta, num laço de turnos refeitos).
    return (await pronto) ?? "ausente";
  };
  // A lista de tarefas do bot (definido em 2026-09-28) vai como trecho vivo, como o nome das ferramentas.
  const subirLaco = (reg: Registry) => {
    const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => cliente?.tarefas(turnoId, tarefas));
    // NOD-350: a ponte já junta os trechos até a renovação (1 s), então aqui toda mudança vai para ela.
    const subagentesVivos = criarAcompanhanteDeSubagentes((turnoId, lista, ocioso) => cliente?.subagentes(turnoId, lista, ocioso), { intervaloMs: 0 });
    laco = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry: reg, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, memoria: memoriaDoMac, registroDaConta, urlNod: lig.urlNod, aoDelta: (p, t) => cliente?.delta(p.turnoId, t), aoEvento: (p, ev) => { if (cliente) repassarAcaoDoEvento(cliente, p.turnoId, ev); tarefasVivas.evento(p.turnoId, ev); subagentesVivos.evento(p.turnoId, ev); }, aoIniciarTurno: (p) => { planosNoMac.set(p.turnoId, p); }, aoTerminarTurno: (p) => { tarefasVivas.esquecer(p.turnoId); subagentesVivos.parar(p.turnoId); subagentesVivos.esquecer(p.turnoId); planosNoMac.delete(p.turnoId); void atualizador.verificar().catch(() => undefined); },
      // NOD-73: o vigia do turno só avisa — o aviso vai como trecho vivo, só nome e números (os argumentos ficam no Mac).
      aoVigia: (p, aviso) => cliente?.vigia(p.turnoId, aviso),
      // definido em 2026-10-05: o turno disse que a conta desta IA não serve — o veredito fica guardado e o Mac reanuncia.
      aoResultado: (p, r) => {
        const ia = lerIaDesktop(driverDoPlano(p));
        // ADR-102: o turno rodou numa conta escolhida pelo servidor — o limite é dela e quem decide é o servidor; a conta
        // que perdeu o login é relida (não reprova a IA inteira).
        // NOD-283: "sem acesso" com o login de pé — a conta fica `sem_acesso` (até um login novo) e é reanunciada.
        if (p.conta) { if (ia && r.causaSemIa) void sincronizarContas({ ia, semAcesso: p.conta.impressao }); return undefined; }
        if (ia && r.causaSemIa) void vigia.reprovar(ia, r.causaSemIa).catch(() => undefined);
        // ADR-101 (2026-10-12): no limite, com mais de uma conta, o Mac decide qual segue e anota só as posições.
        const anotado = ia && !r.causaSemIa ? contasDoApp.aoResultado(ia, r) : undefined;
        // QA do NOD-211: o turno repetido só pode sair depois que o registry já roda na conta nova.
        return ia && anotado?.contaNoLimite?.tipo === "trocou" ? contasDoApp.esperarTroca(ia).then(() => anotado) : anotado;
      } }), ponteHttp.ponte);
  };
  // definido em 2026-10-04 (ADR-077) e revisto em 2026-10-05: sem IA pronta a janela abre do mesmo jeito — a web mostra
  // os cards de IA — e a vigia olha de novo a cada 3 s, com um registry novo a cada volta (os drivers recriados não
  // guardam o cache de 5 min da sonda do Codex). O que vai ao servidor é a conferência de login JÁ com o veredito do
  // teste de verdade aplicado: IA logada e reprovada é anunciada como fora, com a causa.
  let lacoNoAr = false;
  const arquivoVereditos = join(app.getPath("userData"), "ias-testadas.json");
  // NOD-199: o anúncio vai pela rota só de inventário — não recusa nem limpa um turno que roda. O primeiro anúncio e o
  // que segue um 409 (`reconectar`) vão pelo `conectar`; quem decide é o cliente da ponte (`anunciarInventario`).
  const vigia = criarVigiaDasIas({
    // revisto em 2026-10-09: a config é montada de novo a cada passada — o PATH do shell que chegou depois, a IA que o app
    // acabou de instalar e uma versão nova do nvm entram sem reabrir o app. Com `ias`, só essas são sondadas.
    sondar: async (ias) => {
      const novo = await montarCfg(envExecutor);
      if (cliente === ponteHttp) cfgExecutor = novo;
      const refeito = await criarRegistryDetalhado(envExecutor, ias ? drivers.filter((d) => ias.some((ia) => ia === d.meta.id)) : drivers, { cfg: novo });
      // QA do NOD-211: só as IAs sondadas ganharam driver com o ambiente da conta em uso.
      if (cliente === ponteHttp) contasDoApp.registryRefeito(ias ?? IAS_DESKTOP);
      return refeito;
    },
    impressao: (ia) => impressaoDoLogin(ia, cfgExecutor ?? cfg),
    aoInventarios: (inventarios) => { if (cliente !== ponteHttp) return; inventariosDaVigia = inventarios; emitirEstados(); conferirContas(inventarios); void sincronizarContas(); void atualizador.verificar().catch(() => undefined); },
    aoTestando: (ias) => { if (cliente !== ponteHttp) return; testandoAgora = ias; emitirEstados(); },
    anunciar: async (inventarios, principal, semLacoDeVoz, capacidades) => { if (cliente !== ponteHttp) return; inventariosAtuais = inventarios; const contas = contasLocais?.anuncio() ?? []; const comContas = inventariosComContas(comAtualizacao(inventarios), contas, contasLocais?.impressoesDaPadrao()); await ponteHttp.ponte.anunciarInventario({ ...anuncio, ...(vmLocal?.anuncio() ?? {}), inventario: estadoDaMaquina(principal, comContas), harnesses: comContas, semLacoDeVoz, capacidades, contas }); if (!lacoNoAr && contas.some((c) => c.estado === "pronta")) { lacoNoAr = true; subirLaco(registryDoLaco); } },
    aoRegistry: (novo, algumaPronta) => {
      if (cliente !== ponteHttp) return;
      Object.assign(registryDoLaco, novo);
      if (algumaPronta && !lacoNoAr) { lacoNoAr = true; subirLaco(registryDoLaco); }
    },
    ler: async () => JSON.parse(await readFile(arquivoVereditos, "utf8")) as unknown,
    gravar: (vereditos: Veredito[]) => writeFile(arquivoVereditos, `${JSON.stringify(vereditos)}\n`, { mode: 0o600 }),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; },
  });
  vigiaIas = vigia;
  await vigia.iniciar(criado);
  // ADR-102: o que a tela pede a este Mac sobre as contas ("Sair do Mac", "Desconectar e sair das contas"), a cada 3 s.
  if (cliente === ponteHttp) {
    contasNoServidor?.parar();
    contasNoServidor = iniciarContasNoServidor({
      ponte: ponteHttp.contas,
      sair: sairDaContaNoMac,
      todas: () => (contasLocais?.anuncio() ?? []).map((c) => c.impressao),
      desconectar: async (remover?: OpcoesRemover) => {
        log("info", "mac_desconectado_pela_tela", {});
        // ADA-245: removido por outro lugar. O logout das contas já veio da puxada (contas-no-servidor.ts).
        if (remover) await removerDaquiNoMac(remover, depsRemoverNoMac(false));
        await parar();
        if (!remover || remover.manterConexao) mensagem = "Este Mac foi desconectado pela tela do Nod.";
        await mostrarSetup();
      },
      agendar: agendarTimer,
      registrar: (evento, campos) => log("aviso", evento, campos),
    });
    // NOD-94: a instalação por SSH de uma máquina "só computador", feita daqui (inclusive pelo apelido do ~/.ssh/config).
    // O parar() do começo do conectar já a zerou; sem await aqui (revisão do PR #579), para um parar() no meio não
    // deixar uma instaladora nova viva depois do desligamento.
    void instalacoesNoServidor?.parar();
    instalacoesNoServidor = dados.instalacoes === true ? iniciarInstalacoesNoServidor({ ponte: ponteHttp.instalacoes, env: cfg.env, agendar: agendarTimer, servidor: c.url }) : null;
  }
  const anterior = janela;
  // definido em 2026-09-24 ("aviso no Mac"): preload próprio da janela web — só `nodDesktop` (preload-web.ts).
  // NOD-137: nasce onde a pessoa deixou, inteira numa tela que existe; o mínimo de 900 cede numa tela mais estreita.
  const bounds = resolverEstadoJanela(estadoJanela, telas(), TAMANHO_PADRAO_JANELA);
  // Os bounds normais da janela maximizada vêm da memória (medirEstadoJanela): valem os da criação, já ajustados à tela.
  estadoJanela = bounds;
  const nova = new BrowserWindow({ x: bounds.x, y: bounds.y, width: bounds.largura, height: bounds.altura, minWidth: Math.min(LARGURA_MINIMA, bounds.largura), title: "nod", backgroundColor: fundoDaJanela(), webPreferences: { partition: "nod-web", preload: join(dir, "preload-web.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  if (bounds.maximizada) nova.maximize();
  janela = nova; proteger(nova, c.url);
  // A checagem de tela cheia é no disparo do timer; no Electron 43 isFullScreen() já é true desde o 1º resize da animação.
  let esperaEstado: ReturnType<typeof setTimeout> | null = null;
  const cancelarEstado = () => { if (esperaEstado) clearTimeout(esperaEstado); esperaEstado = null; };
  const agendarEstado = () => { cancelarEstado(); esperaEstado = setTimeout(() => { esperaEstado = null; capturarEstadoJanela(nova); }, ESPERA_ESTADO_JANELA_MS); };
  nova.on("move", agendarEstado);
  nova.on("resize", agendarEstado);
  nova.on("maximize", agendarEstado);
  nova.on("unmaximize", agendarEstado);
  nova.on("enter-full-screen", () => { cancelarEstado(); capturarEstadoJanela(nova); });
  nova.on("close", (e) => {
    cancelarEstado(); capturarEstadoJanela(nova);
    // Saindo (Cmd+Q já confirmado, ou o reinício da atualização): a pergunta da ligação seguraria o quitAndInstall.
    if (!emLigacao || encerrando) return;
    e.preventDefault();
    void confirmarFecharEmLigacao(nova).then((sim) => { if (sim) { definirEmLigacao(false); nova.close(); } });
  });
  nova.on("closed", () => { cancelarEstado(); if (janela === nova) { janela = null; definirEmLigacao(false); } });
  nova.webContents.on("did-fail-load", (_e, code, _description, _url, main) => { if (main && code !== -3) { mensagem = mensagens.servidor_fora!; void mostrarSetup(); } });
  await nova.loadURL(c.url);
  anterior?.close(); mensagem = "Conectado.";
  atualizacaoApp?.conectado();
}
/**
 * "Entrar" num card de IA (ADR-077): o login do próprio CLI, sem shell, desanexado e com o ambiente limpo dos drivers
 * (ia-mac.ts). Ele abre o navegador; o nod nunca lê o token — a sonda de 3 s percebe quando ficou pronto.
 */
/**
 * NOD-293 C10 (definido em 2026-10-20): o login aberto pelo app conta da hora do pedido (R4: a conta removida volta).
 * Sem isso, no Mac (Keychain, sem arquivo de credencial) o login novo ficaria com logadaEm 0 e a conta seguiria removida.
 */
async function armarLogin(ia: IaDesktop): Promise<void> {
  await contasLocais?.armar(ia).catch(() => undefined);
}
/** O marcador vale para uma tentativa: sai em todo término (sucesso depois da leitura; falha na hora). */
async function desarmarLogin(ia: IaDesktop): Promise<void> {
  await contasLocais?.desarmar(ia).catch(() => undefined);
}

async function entrarNaIa(ia: IaDesktop): Promise<ResultadoIaDesktop> {
  const cfg = await cfgAtual();
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  // NOD-293 C10 (revisor do PR #429): o `iaEntrar` armou o marcador; sem login (não instalado, erro, saída ≠ 0) ele sai.
  if (!bin) { await desarmarLogin(ia); return { ok: false, motivo: "nao_instalado" }; }
  return new Promise((resolver) => {
    const falhou = (): void => { void desarmarLogin(ia); resolver({ ok: false, motivo: "falhou" }); };
    try {
      const filho = spawn(bin, args, { cwd: home || undefined, env: ambienteDaIa(ia, cfg), detached: true, stdio: "ignore", shell: false });
      filho.once("spawn", () => { filho.unref(); resolver({ ok: true }); });
      // definido em 2026-10-05: o login terminou bem — se esta IA estava reprovada, a conta nova é testada agora.
      filho.once("exit", (codigo) => {
        if (codigo === 0) void vigiaIas?.contaMudou(ia).catch(() => undefined);
        else void desarmarLogin(ia);
      });
      filho.once("error", falhou);
    } catch { falhou(); }
  });
}
/**
 * A impressão da conta logada numa IA (definido em 2026-10-05): o hash do que o CLI diz sobre o login. Fica só neste
 * Mac, junto do veredito do teste (vigia-ias.ts); null quando o CLI não responde. revisto em 2026-10-12 (NOD-209): no
 * Codex, o `login status` não diz a conta, então o e-mail e o plano do `account/read` entram no texto — a troca de conta
 * no Codex agora muda a impressão (a lacuna da ADR-019). Se o app-server não responder, vale a última conta lida
 * (textoDaImpressaoComConta): uma falha passageira não muda a impressão nem gasta um reteste.
 */
async function impressaoDoLogin(ia: IaDesktop, cfg: ConfigDriver): Promise<string | null> {
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeEstadoDoLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  if (!bin) return null;
  const r = await executarColetando({ bin, args, env: ambienteDaIa(ia, cfg), cwd: home || tmpdir(), timeoutMs: 10_000 });
  if (r.exitCode !== 0) return null;
  const texto = textoDaImpressao(ia, r.stdout, r.stderr);
  if (ia === "claude-cli") {
    const conta = contaPeloStatusClaude(r.stdout);
    if (conta) guardarConta(ia, conta);
    return createHash("sha256").update(texto).digest("hex");
  }
  const conta = await contaDoCodex({ bin, env: ambienteDaIa(ia, cfg), cwd: home || tmpdir(), versao: app.getVersion() });
  if (conta !== undefined) guardarConta(ia, conta);
  return createHash("sha256").update(textoDaImpressaoComConta(texto, conta, contasDasIas.get(ia) ?? null)).digest("hex");
  return createHash("sha256").update(texto).digest("hex");
}

// ---- As IAs dentro do app (definido em 2026-10-09, plano "IAs", PR 1) ------------------------------------------------
// Instalar com um clique (instalar-ia.ts), entrar sem sair do app (login-ia.ts) e o estado único de cada IA
// (src/domain/estado-ia.ts), que vai à janela web por `nod:ia-mudou`. revisto em 2026-10-09 (revisão do PR 1, ADR-093):
// nada do nod entra no PATH dos bots. O binário que o nod instalou (userData/ferramentas/<ia>/atual) disputa com o
// primeiro achado fora pela versão (ferramentas.ts) e, quando ganha, vai ao driver pelo caminho (cfg.bin / cfg.bins);
// o node do nod (o Electron como node) só serve ao npm.
const pastasDoNod = pastasFerramentas(join(app.getPath("userData"), "ferramentas"));
/** A config dos drivers com o binário escolhido de cada IA. */
async function montarCfg(env: Record<string, string | undefined>): Promise<ConfigDriver> {
  return escolherBinarios(await configDosDrivers(env));
}
/** A config dos drivers da conexão atual; sem conexão, uma nova. */
async function cfgAtual(): Promise<ConfigDriver> {
  return cfgExecutor ?? await montarCfg({ ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") });
}
const binConfigurado = (ia: IaDesktop, cfg: ConfigDriver) => (ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"]);
/** O ambiente dos processos de login e status de uma IA: o dos drivers, mais o que só ela recebe (o Codex do nod). */
const ambienteDaIa = (ia: IaDesktop, cfg: ConfigDriver) => ambienteDoLogin({ ...cfg.env, ...(cfg.envPorDriver?.[ia] ?? {}) });
/**
 * ADR-101: o login, o status do login e a leitura da conta rodam na conta que está entrando — a nova, enquanto ela é
 * adicionada; a em uso, no resto. Os turnos e a sonda seguem em `ambienteDaIa` (a conta em uso, pelo envPorDriver).
 */
const ambienteDoLoginDaIa = (ia: IaDesktop, cfg: ConfigDriver) => ambienteNaConta(ia, process.env, ambienteDaIa(ia, cfg), contasDoApp.ambienteDoLogin(ia));
/** O "node do nod" (instalar-ia.ts): reescrito a cada abertura, porque o caminho do app muda quando ele é movido. */
async function garantirNodeDoNod(): Promise<void> {
  const arquivo = join(pastasDoNod.nodeDoNod, "node");
  const conteudo = scriptNodeDoNod(process.execPath);
  if ((await readFile(arquivo, "utf8").catch(() => null)) === conteudo) return;
  await mkdir(pastasDoNod.nodeDoNod, { recursive: true });
  await writeFile(`${arquivo}.tmp`, conteudo, { mode: 0o755 });
  await rename(`${arquivo}.tmp`, arquivo);
}
/** O npm que o app leva (Contents/Resources/npm; em desenvolvimento, o node_modules do repositório). */
function npmDoApp(): string {
  return app.isPackaged ? join(process.resourcesPath, "npm", "bin", "npm-cli.js") : join(app.getAppPath(), "node_modules", "npm", "bin", "npm-cli.js");
}
const comTil = (caminho: string) => { const h = homedir(); return caminho === h || caminho.startsWith(`${h}/`) ? `~${caminho.slice(h.length)}` : caminho; };
/** O primeiro caminho que existe e é executável. */
async function primeiroExecutavel(caminhos: readonly string[]): Promise<string | null> {
  for (const c of caminhos) if (await resolverBinario(c, "", homedir())) return c;
  return null;
}
/** `--version` de um binário, guardado por caminho, tamanho e data (um `claude update` muda a chave). Lento não fica. */
const versoesEmCache = new Map<string, string | null>();
async function versaoDe(caminho: string, env: Record<string, string>): Promise<string | null> {
  const st = await stat(caminho).catch(() => null);
  if (!st) return null;
  const chave = `${caminho}:${st.size}:${st.mtimeMs}`;
  if (versoesEmCache.has(chave)) return versoesEmCache.get(chave) ?? null;
  const r = await executarColetando({ bin: caminho, args: ["--version"], env, cwd: tmpdir(), timeoutMs: 15_000 }).catch(() => null);
  const versao = r && r.exitCode === 0 ? extrairVersao(r.stdout) : null;
  if (r && !r.estourouTempo) versoesEmCache.set(chave, versao);
  return versao;
}

let inventariosDaVigia: Partial<Record<IdDriver, Inventario>> | null = null;
let testandoAgora: IaDesktop[] = [];
/** A escolha de cada IA (o binário usado e o que perdeu), para o log e o "detalhe" do suporte. */
const escolhaDasIas = new Map<IaDesktop, { escolhido: Candidato | null; alternativa: Candidato | null }>();
/**
 * Para cada IA sem caminho configurado (NOD_CLAUDE_BIN / NOD_CODEX_BIN): o do nod contra o primeiro achado fora, pela
 * versão. Ganhando o do nod, o caminho e o ambiente dele vão na config; ganhando o de fora, o PATH já o acha primeiro.
 */
async function escolherBinarios(cfg: ConfigDriver): Promise<ConfigDriver> {
  const home = cfg.env.HOME ?? homedir();
  const saida: ConfigDriver = { ...cfg, bins: { ...cfg.bins }, envPorDriver: { ...cfg.envPorDriver } };
  let mudou = false;
  for (const ia of IAS_DESKTOP) {
    const configurado = binConfigurado(ia, cfg);
    let escolhido: Candidato | null = null;
    let alternativa: Candidato | null = null;
    if (configurado) {
      const r = await resolverBinarioDetalhado(configurado, "", home);
      escolhido = r ? { caminho: r.caminho, origem: "configurado", versao: null } : null;
    } else {
      const fora = await resolverBinarioDetalhado(undefined, cfg.env.PATH ?? "", home, comandoDeLogin(ia).nome, cfg.camadas ?? []).catch(() => null);
      const deFora: Candidato | null = fora ? { ...fora, versao: await versaoDe(fora.caminho, ambienteDoLogin(cfg.env)) } : null;
      const prefixo = prefixoAtivo(pastasDoNod.base, ia);
      const envNod = ambienteDoBinarioDoNod(ia, prefixo);
      const caminhoNod = await primeiroExecutavel(candidatosDoNod(ia, prefixo, process.platform, process.arch));
      const doNod: Candidato | null = caminhoNod ? { caminho: caminhoNod, origem: "nod", versao: await versaoDe(caminhoNod, ambienteDoLogin({ ...cfg.env, ...envNod })) } : null;
      escolhido = escolherBinario(doNod, deFora);
      alternativa = escolhido === doNod ? deFora : doNod;
      if (escolhido && escolhido === doNod) {
        if (ia === "claude-cli") saida.bin = escolhido.caminho;
        else saida.bins = { ...saida.bins, "codex-cli": escolhido.caminho };
        if (Object.keys(envNod).length > 0) saida.envPorDriver = { ...saida.envPorDriver, [ia]: envNod };
      }
    }
    const antes = escolhaDasIas.get(ia)?.escolhido;
    if (antes?.caminho !== escolhido?.caminho || antes?.versao !== escolhido?.versao || !escolhaDasIas.has(ia)) {
      log("info", "ia_binario", { ia, caminho: escolhido ? comTil(escolhido.caminho) : null, origem: escolhido?.origem ?? null, versao: escolhido?.versao ?? null, alternativa: alternativa ? `${alternativa.origem} ${alternativa.versao ?? "?"}` : null });
      mudou = true;
    }
    escolhaDasIas.set(ia, { escolhido, alternativa });
  }
  if (mudou) emitirEstados();
  // ADR-101 (2026-10-12): a conta em uso de cada IA vai aos drivers pela variável dela (nada para a conta 1).
  for (const ia of IAS_DESKTOP) {
    const daConta = contasDoApp.ambienteDoTurno(ia);
    if (Object.keys(daConta).length > 0) saida.envPorDriver = { ...saida.envPorDriver, [ia]: { ...(saida.envPorDriver?.[ia] ?? {}), ...daConta } };
  }
  return saida;
}
function estadoAtual(ia: IaDesktop): EstadoIa {
  const b = escolhaDasIas.get(ia)?.escolhido;
  return estadoDaIa({ ia, inventario: inventariosDaVigia?.[ia] ?? null, instalacao: instalador.estado(ia), login: loginIas.estado(ia), testando: testandoAgora.includes(ia), binario: b ? { caminho: comTil(b.caminho), origem: b.origem } : null, conta: contaPendente.has(ia) ? null : contasDasIas.get(ia) ?? null, atualizacao: atualizador.estado(ia), agora: Date.now() });
}
const ultimosEstados = new Map<IaDesktop, string>();
/** Manda à janela web o estado de cada IA que mudou (o instante da montagem não conta como mudança). */
function emitirEstados(): void {
  const w = janelaWeb();
  for (const ia of IAS_DESKTOP) {
    const e = estadoAtual(ia);
    const chave = JSON.stringify({ ...e, em: 0 });
    if (ultimosEstados.get(ia) === chave) continue;
    ultimosEstados.set(ia, chave);
    w?.webContents.send(CANAIS_DESKTOP.iaMudou, e);
  }
}
const agendarTimer = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; };

/**
 * O processo do login: o stdout (por linha) e o stderr chegam a quem ouvir; o que veio antes do ouvinte fica guardado.
 * O stderr importa: o "Successfully logged in." do Codex pode sair por ele.
 */
async function iniciarLogin(ia: IaDesktop): Promise<ProcessoDeLogin | null> {
  const cfg = await cfgAtual();
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeLoginNoApp(ia);
  const bin = await resolverBinario(binConfigurado(ia, cfg), cfg.env.PATH ?? "", home, nome);
  if (!bin) return null;
  const pendentes: string[] = [];
  let ouvinte: ((t: string) => void) | null = null;
  const entregar = (t: string) => { if (ouvinte) ouvinte(t); else pendentes.push(t); };
  const p = iniciarProcesso({ bin, args, env: ambienteDoLoginDaIa(ia, cfg), cwd: home || tmpdir(), stdin: ia === "claude-cli" ? "pipe" : "ignore", aoLinha: (l) => entregar(`${l}\n`), aoStderr: entregar });
  return {
    aoSair: (fn) => { ouvinte = fn; for (const t of pendentes.splice(0)) fn(t); },
    escrever: (t) => p.escrever(t),
    fim: p.fim.then((r) => ({ codigo: r.exitCode, stderr: "" })),
    matar: () => p.interromper(),
  };
}
async function statusDoLogin(ia: IaDesktop): Promise<StatusDoLogin> {
  const cfg = await cfgAtual();
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeEstadoDoLogin(ia);
  const bin = await resolverBinario(binConfigurado(ia, cfg), cfg.env.PATH ?? "", home, nome);
  if (!bin) return { logado: false, impressao: null };
  const r = await executarColetando({ bin, args, env: ambienteDoLoginDaIa(ia, cfg), cwd: home || tmpdir(), timeoutMs: 10_000 });
  const logado = !r.estourouTempo && logadoPeloStatus(ia, r.exitCode, r.stdout, r.stderr);
  return { logado, impressao: logado ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null };
}

// ---- A conta logada em cada IA (definido em 2026-10-12, NOD-209) ----------------------------------------------------
// O cartão mostra QUAL conta está logada (e-mail · organização · plano), como o CLI diz: `claude auth status` e o
// `account/read` de um `codex app-server` curto. Nada de arquivo de credencial nem turno pago. ADR-019: nunca vai ao log
// nem ao inventário; o servidor só recebe o e-mail e a organização pelo anúncio das contas (ADR-105).
/** definido em 2026-10-12: a conta é lida de novo depois de 10 min (pega a troca feita no terminal, fora do nod). */
const VALIDADE_CONTA_MS = 10 * 60_000;
const contasDasIas = new Map<IaDesktop, ContaDaIa>();
const contaLidaEm = new Map<IaDesktop, number>();
const lendoConta = new Map<IaDesktop, Promise<void>>();
/** O login acabou de dar certo e a conta nova ainda não foi lida: o estado vai sem conta (a tela não mostra a antiga). */
const contaPendente = new Set<IaDesktop>();
function guardarConta(ia: IaDesktop, conta: ContaDaIa | null): void {
  contaLidaEm.set(ia, Date.now());
  if (conta) contasDasIas.set(ia, conta);
  else contasDasIas.delete(ia);
}
/**
 * A conta que o CLI diz agora: null = sem conta; undefined = não deu para saber (CLI lento ou sem resposta). Lê a conta em
 * uso; `naContaNova` lê a que está sendo adicionada (QA do NOD-211: a releitura de 10 min no meio de uma adição lia a
 * pasta nova, ainda sem login, e a conta 1 sumia do cartão).
 */
async function lerConta(ia: IaDesktop, o: { naContaNova?: boolean } = {}): Promise<ContaDaIa | null | undefined> {
  const cfg = await cfgAtual();
  const env = o.naContaNova ? ambienteDoLoginDaIa(ia, cfg) : ambienteNaConta(ia, process.env, ambienteDaIa(ia, cfg), contasDoApp.ambienteDaContaEmUso(ia));
  const home = cfg.env.HOME ?? "";
  const cwd = home || tmpdir();
  const bin = await resolverBinario(binConfigurado(ia, cfg), cfg.env.PATH ?? "", home, comandoDeLogin(ia).nome);
  if (!bin) return null;
  if (ia === "claude-cli") {
    const r = await executarColetando({ bin, args: comandoDeEstadoDoLogin(ia).args, env, cwd, timeoutMs: 10_000 }).catch(() => null);
    if (!r || r.estourouTempo) return undefined;
    return contaPeloStatusClaude(r.stdout);
  }
  return contaDoCodex({ bin, env, cwd, versao: app.getVersion() });
}
/**
 * Lê a conta e manda o estado. `depoisDoLogin`: a pessoa acabou de entrar (talvez com outra conta) — uma leitura já em
 * curso pode ser da conta antiga, então espera ela e lê de novo; sem resposta, a conta antiga não fica no cartão.
 */
function atualizarConta(ia: IaDesktop, depoisDoLogin = false): Promise<void> {
  const emCurso = lendoConta.get(ia);
  if (emCurso) return depoisDoLogin ? emCurso.then(() => atualizarConta(ia, true)) : emCurso;
  const leitura = (async () => {
    try {
      const conta = await lerConta(ia).catch(() => undefined);
      if (conta !== undefined) guardarConta(ia, conta);
      else if (depoisDoLogin) {
        // revisto em 2026-10-12 (revisão do PR #266): sem resposta depois do login, a próxima sondagem tenta de novo —
        // antes a troca ficava sem conta e sem nota até a validade de 10 min vencer.
        contasDasIas.delete(ia);
        contaLidaEm.delete(ia);
      }
    } finally {
      lendoConta.delete(ia);
      if (depoisDoLogin) contaPendente.delete(ia);
      emitirEstados();
    }
  })();
  lendoConta.set(ia, leitura);
  return leitura;
}
/** A cada sondagem: IA logada com a conta velha (ou nunca lida) é lida; IA sem login perde a conta. */
function conferirContas(inventarios: Partial<Record<IdDriver, Inventario>>): void {
  for (const ia of IAS_DESKTOP) {
    const inv = inventarios[ia];
    if (!inv || (inv.estado === "nao_autenticado" && inv.causa === "sonda_lenta")) continue;
    const logada = inv.estado === "pronto" || (inv.estado === "nao_autenticado" && inv.causa !== undefined);
    if (!logada) { if (contasDasIas.delete(ia)) emitirEstados(); continue; }
    if (Date.now() - (contaLidaEm.get(ia) ?? 0) > VALIDADE_CONTA_MS) void atualizarConta(ia);
  }
}
/** O login mudou: no sucesso, a conta (talvez outra) é lida antes de voltar ao cartão. */
function aoMudarLogin(ia: IaDesktop, login: LoginDaIa): void {
  if (login.fase === "sucesso" && contasDoApp.adicionando(ia)) {
    // ADR-101: a conta nova entrou — lida NA pasta dela, entra no fim da lista; depois o cartão volta à conta em uso.
    contaPendente.add(ia);
    // NOD-293 C10 (revisor do PR #429): a sincronização lê a conta nova com o marcador armado; só depois ele sai.
    void concluirLoginArmado({
      antes: async () => {
        const conta = await lerConta(ia, { naContaNova: true }).catch(() => undefined);
        await contasDoApp.concluirAdicao(ia, conta ?? null);
        contaLidaEm.delete(ia);
        await atualizarConta(ia, true);
      },
      sincronizar: () => sincronizarContas({ ia }),
      desarmar: () => desarmarLogin(ia),
    }).catch(() => undefined);
  } else if (login.fase === "sucesso") {
    contaPendente.add(ia);
    void concluirLoginArmado({ antes: () => atualizarConta(ia, true), sincronizar: () => sincronizarContas({ ia }), desarmar: () => desarmarLogin(ia) }).catch(() => undefined);
  } else if ((login.fase === "falhou" || login.fase === "expirou" || login.fase === "cancelado") && contasDoApp.adicionando(ia)) {
    // QA do NOD-211: falhou ou expirou fica na tela com "Tentar de novo"; cancelado pela pessoa, não.
    void contasDoApp.cancelarAdicao(ia, { falhou: login.fase !== "cancelado" }).then(() => atualizarConta(ia, true));
    void desarmarLogin(ia);
  } else if (login.fase === "falhou" || login.fase === "expirou" || login.fase === "cancelado") {
    void desarmarLogin(ia);
  }
  emitirEstados();
}

// ---- As várias contas de cada IA (definido em 2026-10-12, ADR-101, NOD-211) -----------------------------------------
const pastaDasContas = join(app.getPath("userData"), "contas");
const arquivoDasContas = join(app.getPath("userData"), "contas.json");
/** O logout do CLI com a variável da conta (apaga só a credencial dela); 15 s e desiste. */
async function logoutDaConta(ia: IaDesktop, envDaConta: Record<string, string>): Promise<boolean> {
  const cfg = await cfgAtual();
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeLogout(ia);
  const bin = await resolverBinario(binConfigurado(ia, cfg), cfg.env.PATH ?? "", home, nome);
  if (!bin) return false;
  const r = await executarColetando({ bin, args, env: ambienteNaConta(ia, process.env, ambienteDaIa(ia, cfg), envDaConta), cwd: home || tmpdir(), timeoutMs: 15_000 }).catch(() => null);
  return r !== null && !r.estourouTempo && r.exitCode === 0;
}
/** O CLI de uma IA no ambiente dela (o do binário do nod, se for ele), sem a variável de outra conta. */
function clisDaIa(ia: IaDesktop): ClisDoMotor {
  return {
    bin: async (x) => { const c = cfgExecutor; return c ? resolverBinario(binConfigurado(x, c), c.env.PATH ?? "", c.env.HOME ?? homedir(), comandoDeLogin(x).nome) : null; },
    envBase: () => (cfgExecutor ? ambienteNaConta(ia, process.env, ambienteDaIa(ia, cfgExecutor), {}) : {}),
    home: cfgExecutor?.env.HOME ?? homedir(),
    versao: app.getVersion(),
  };
}
async function descartarDriverDaConta(chave: string): Promise<void> {
  const p = driversPorConta.get(chave);
  driversPorConta.delete(chave);
  const reg = await p?.catch(() => null);
  if (reg?.estado === "pronto") await reg.instance.dispose().catch(() => undefined);
}
/**
 * ADR-102 (2026-10-13): a lista que vai ao servidor segue a do app. Conta nova é lida pelo CLI (a impressão); a que saiu
 * perde o driver dela; `ia` relê as contas dessa IA (login novo, turno sem login); `todas` relê tudo. Mudou → reanuncia.
 */
function sincronizarContas(o: { ia?: IaDesktop; todas?: boolean; semAcesso?: string } = {}): Promise<void> {
  const vez = sincronizandoContas.then(async () => {
    const locais = contasLocais;
    if (!locais || !contasDoApp.carregadas()) return;
    const sairam = await locais.sincronizar(contasDoApp.contasPorId());
    for (const c of sairam) for (const k of [...driversPorConta.keys()]) if (k.startsWith(`${c.ia}:${c.id}:`)) await descartarDriverDaConta(k);
    let mudou = sairam.length > 0;
    if (o.todas) mudou = (await locais.ler({ forcar: true })) || mudou;
    else if (o.ia) for (const c of locais.listar().filter((x) => x.ia === o.ia)) mudou = (await locais.ler({ forcar: true, id: c.id })) || mudou;
    mudou = (await locais.ler()) || mudou;
    if (o.semAcesso) mudou = (await locais.marcarSemAcesso(o.semAcesso)) || mudou;
    if (mudou && contasLocais === locais) await vigiaIas?.reanunciar().catch(() => undefined);
  }).catch((e: unknown) => { log("erro", "contas_sincronizar_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); });
  sincronizandoContas = vez;
  return vez;
}
/** "Sair do Mac" pedido pela tela: a conta extra sai como no "Remover" do app; a de sempre só faz o logout. */
async function sairDaContaNoMac(impressao: string): Promise<boolean> {
  const local = contasLocais?.porImpressao(impressao);
  if (!local) return false;
  // Red team do PR #306: pela identidade da conta, não pela posição (a lista da ADR-101 se reordena).
  const posicao = local.id === ID_CONTA_PADRAO ? null : contasDoApp.posicaoDe(local.ia, local.id);
  if (local.id !== ID_CONTA_PADRAO) {
    if (posicao === null) return false;
    await contasDoApp.remover(local.ia, posicao);
  } else {
    if (!(await logoutDaConta(local.ia, {}))) throw new Error("logout_falhou");
    contaLidaEm.delete(local.ia);
    void atualizarConta(local.ia, true);
  }
  await sincronizarContas({ ia: local.ia });
  return true;
}
/**
 * ADA-245 (jornada D): o disco e as ações da limpeza deste Mac (remover-daqui.ts). `comLogout` false = as contas já
 * saíram pela puxada. O desligar não troca a janela: a tela de Fim da página ainda vai ao servidor e mostra o resultado;
 * a tela de conectar volta na próxima abertura do app.
 */
function depsRemoverNoMac(comLogout: boolean): DepsRemoverDaqui {
  return {
    baseDasIas: pastasDoNod.base,
    existe: async (caminho) => existsSync(caminho),
    apagar: (caminho) => rm(caminho, { recursive: true, force: true }),
    sairDasContas: async () => {
      if (!comLogout) return true;
      await sincronizandoContas;
      let ok = true;
      // Exceção = o logout falhou; false = a conta não estava aqui (nada a sair).
      for (const c of contasLocais?.anuncio() ?? []) ok = (await sairDaContaNoMac(c.impressao).then(() => true, () => false)) && ok;
      return ok;
    },
    desligar: async () => {
      await parar();
      await rm(caminhoConfig(), { force: true });
      configuracao = null;
      mensagem = "Este Mac saiu da sua conta. Conecte de novo para usar o nod aqui.";
    },
    // "Continuar ligado": para aqui e a conexão fica (conexao.enc); a próxima abertura do app conecta sem login.
    parar: () => parar(),
  };
}
function emitirContas(): void {
  janelaWeb()?.webContents.send(CANAIS_DESKTOP.contasMudaram, contasDoApp.listar() satisfies ContasNaTela[]);
}
const contasDoApp = criarContasDoApp({
  base: pastaDasContas,
  padrao: (ia) => diretorioPadrao(ia, process.env, homedir()),
  ler: () => lerContasDoMac(arquivoDasContas),
  gravar: (c) => gravarContasDoMac(arquivoDasContas, c),
  preparar: async (ia, id) => { await prepararPastaDaConta({ base: pastaDasContas, ia, id, padrao: diretorioPadrao(ia, process.env, homedir()) }); },
  remover: (ia, id) => removerPastaDaConta({ base: pastaDasContas, ia, id, logout: (env) => logoutDaConta(ia, env) }),
  // A conta em uso mudou: a vigia sonda de novo (refaz o registry com o ambiente dela) e o cartão relê a conta.
  aoMudarConta: (ia) => {
    log("info", "conta_em_uso_mudou", { ia });
    contaLidaEm.delete(ia);
    void atualizarConta(ia, true);
    return vigiaIas?.contaMudou(ia).catch(() => undefined);
  },
  aoMudar: () => { emitirContas(); void sincronizarContas(); },
  agora: Date.now,
  // A conta 1 renovou: volta a ela sem esperar outra sondagem (QA do NOD-211).
  agendar: agendarTimer,
});

const loginIas = criarLoginDasIas({
  iniciar: iniciarLogin,
  status: statusDoLogin,
  agora: Date.now,
  agendar: agendarTimer,
  aoMudar: aoMudarLogin,
  // O login terminou bem: a conta nova é testada se estava reprovada (regra da vigia) e a IA é anunciada.
  aoSucesso: (ia) => { void vigiaIas?.contaMudou(ia).catch(() => undefined); },
  registrar: (evento, campos) => log("info", evento, campos),
});

/** O npm rodando com o Node do Electron; sem o npm do app, o `npm` do Mac (que precisa de um node no PATH). */
async function rodarNpm(args: string[]): Promise<ProcessoNpm | null> {
  const cfg = await cfgAtual();
  // O node do nod vem PRIMEIRO, e só aqui: os scripts de instalação rodam no Node que o app conhece (o do Electron).
  const path = `${pastasDoNod.nodeDoNod}:${cfg.env.PATH ?? ""}`;
  const npmCli = npmDoApp();
  let bin: string;
  let argv: string[];
  if (existsSync(npmCli)) { bin = process.execPath; argv = [npmCli, ...args]; }
  else {
    const doMac = await resolverBinario(undefined, cfg.env.PATH ?? "", cfg.env.HOME ?? homedir(), "npm");
    if (!doMac) return null;
    log("aviso", "ia_instalacao_npm_do_mac", { caminho: comTil(doMac) });
    bin = doMac; argv = args;
  }
  await mkdir(pastasDoNod.base, { recursive: true });
  const pendentes: string[] = [];
  let ouvinte: ((t: string) => void) | null = null;
  const entregar = (t: string) => { if (ouvinte) ouvinte(t); else pendentes.push(t); };
  const p = iniciarProcesso({ bin, args: argv, env: ambienteDoNpm(ambienteDoLogin(cfg.env), path), cwd: pastasDoNod.base, stdin: "ignore", aoLinha: (l) => entregar(`${l}\n`), aoStderr: entregar });
  return {
    aoSair: (fn) => { ouvinte = fn; for (const t of pendentes.splice(0)) fn(t); },
    fim: p.fim.then((r) => ({ codigo: r.erroSpawn ? null : r.exitCode })),
    matar: () => p.interromper(),
  };
}
const instalador = criarInstaladorDeIas({
  rodarNpm,
  pastas: pastasDoNod,
  novoPrefixo: (ia) => prepararPrefixoNovo(pastasDoNod, ia, nomeDaVersao(Date.now(), randomBytes(3).toString("hex"))),
  binarioInstalado: async (ia, prefixo) => {
    const caminho = await primeiroExecutavel(candidatosDoNod(ia, prefixo, process.platform, process.arch));
    return caminho ? { caminho, env: ambienteDoBinarioDoNod(ia, prefixo) } : null;
  },
  // Sem o node do nod no PATH: o binário instalado tem de responder sozinho, como vai rodar nos bots.
  versao: async (binario, env) => {
    const cfg = await cfgAtual();
    const r = await executarColetando({ bin: binario, args: ["--version"], env: ambienteDoLogin({ ...cfg.env, ...env }), cwd: cfg.env.HOME || tmpdir(), timeoutMs: 30_000 });
    return { codigo: r.erroSpawn ? null : r.exitCode, saida: `${r.stdout}\n${r.stderr}` };
  },
  ativar: (ia, prefixo) => ativarPrefixo(pastasDoNod, ia, prefixo),
  descartar: (ia, prefixo) => descartarPrefixo(pastasDoNod, ia, prefixo),
  abrirRegistro: async (ia) => {
    const pasta = app.getPath("logs");
    await mkdir(pasta, { recursive: true });
    const nome = `instalar-${ia}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    const s = createWriteStream(join(pasta, nome), { flags: "a", mode: 0o600 });
    s.on("error", () => undefined);
    return { nome, escrever: (t) => { s.write(t); }, fechar: () => new Promise<void>((r) => s.end(() => r())) };
  },
  aoMudar: () => emitirEstados(),
  aoInstalar: () => { void vigiaIas?.sondarAgora().catch(() => undefined); },
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: Date.now,
  registrar: (evento, campos) => log("info", evento, campos),
});
// NOD-9 (plano do Arquiteto de 20/10, passos 7′ e 8′): a atualização dos CLIs no Mac. O binário é o escolhido
// (escolhaDasIas); o do nod só se atualiza pela reserva (o instalador, ADR-093); o de fora tenta o atualizador oficial
// primeiro e a reserva depois. Enquanto atualiza, a IA é anunciada como `ausente` + `atualizando`.
const arquivoAtualizacoes = () => join(app.getPath("userData"), "atualizacoes-ia.json");
// NOD-9 PR3: a janela de senha do macOS, último passo de um clique (só binário de root, só com a janela do nod em foco).
const elevador = criarElevador(depsReaisDoElevador({
  home: homedir(),
  lerVersao: async (bin) => {
    const cfg = await cfgAtual();
    return versaoDe(bin, ambienteDoLogin(cfg.env));
  },
  registrar: (evento, campos) => log("info", evento, campos),
}));
async function passosDaAtualizacao(ia: IaDesktop, gatilho: GatilhoAtualizar): Promise<PassoAtualizar[]> {
  const escolhido = escolhaDasIas.get(ia)?.escolhido ?? null;
  const cfg = await cfgAtual();
  const envVersao = ambienteDoLogin({ ...cfg.env, ...(cfg.envPorDriver?.[ia] ?? {}) });
  const reserva: PassoAtualizar = {
    tipo: "reserva",
    rodar: async (alvo) => {
      const antes = escolhido ? await versaoDe(escolhido.caminho, envVersao) : null;
      return fimDaInstalacao(await instalador.instalar(ia), antes, alvo, compararVersoes);
    },
  };
  const args = comandoDeAtualizar(ia);
  // A origem `nod` (sem binário de fora) e a IA sem atualizador próprio: só a reserva (passosPelaOrigem).
  const base = passosPelaOrigem({
    origem: escolhido?.origem ?? null,
    args,
    reserva,
    oficial: (a) => ({
      tipo: "oficial",
      rodar: (alvo) => atualizarCli({ bin: escolhido?.caminho ?? "", args: a, env: { ...process.env, ...cfg.env }, alvo, lerVersao: (bin) => versaoDe(bin, envVersao) }),
    }),
  });
  if (base.length === 1 || !escolhido || !args || gatilho !== "clique" || process.platform !== "darwin") return base;
  const aprovacao: PassoAtualizar = {
    tipo: "aprovacao",
    cabe: (anteriores) => cabeAprovacao(anteriores) && !elevador.aberta() && janela?.isFocused() === true,
    rodar: (alvo) => elevador.atualizar({ ia, bin: escolhido.caminho, args, alvo }),
  };
  return [...base, aprovacao];
}
const passosPreparados = new Map<IaDesktop, PassoAtualizar[]>();
const atualizador = criarAtualizadorDeIas({
  binario: async (ia, gatilho) => {
    const escolhido = escolhaDasIas.get(ia)?.escolhido ?? null;
    if (!escolhido) return { versao: null, origem: null };
    const cfg = await cfgAtual();
    // Os passos são montados aqui (a função `passos` é síncrona): a mesma leitura do binário que decidiu.
    passosPreparados.set(ia, await passosDaAtualizacao(ia, gatilho));
    return { versao: await versaoDe(escolhido.caminho, ambienteDoLogin({ ...cfg.env, ...(cfg.envPorDriver?.[ia] ?? {}) })), origem: escolhido.origem };
  },
  piso: (ia) => PISO_CLI[ia],
  comparar: compararVersoes,
  turnos: (ia) => [...planosNoMac.values()].filter((p) => lerIaDesktop(driverDoPlano(p)) === ia).length,
  emLigacao: () => emLigacao,
  passos: (ia) => passosPreparados.get(ia) ?? [],
  depois: () => { void vigiaIas?.sondarAgora().catch(() => undefined); },
  aoMudar: () => {
    emitirEstados();
    void vigiaIas?.reanunciar().catch(() => undefined);
  },
  ler: async () => JSON.parse(await readFile(arquivoAtualizacoes(), "utf8")) as unknown,
  gravar: async (disco) => {
    await mkdir(app.getPath("userData"), { recursive: true });
    const tmp = `${arquivoAtualizacoes()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(disco)}\n`, { mode: 0o600 });
    await rename(tmp, arquivoAtualizacoes());
  },
  agora: Date.now,
  hoje: diaLocal,
  agendar: agendarTimer,
  // Um erro (o disco ilegível, um passo que lançou) sai como aviso; o resto, como info.
  registrar: (evento, campos) => log(campos.erro !== undefined || campos.venceu === true ? "aviso" : "info", evento, campos),
});
/** O inventário de cada IA com a fase da atualização (enquanto atualiza, `ausente` + `atualizando`). */
function comAtualizacao(inventarios: Partial<Record<IdDriver, Inventario>>): Partial<Record<IdDriver, Inventario>> {
  const saida: Partial<Record<IdDriver, Inventario>> = { ...inventarios };
  for (const ia of IAS_DESKTOP) {
    const inv = inventarios[ia];
    if (inv) saida[ia] = inventarioComAtualizacao(inv, atualizador.estado(ia), PACOTE_DA_IA[ia].nome);
  }
  return saida;
}
function validarRemetente(event: IpcMainInvokeEvent) {
  if (event.senderFrame?.url !== setupUrl || event.sender !== janela?.webContents) throw new Error("origem_invalida");
}
/** A janela web: a principal, frame de topo, na origem do servidor configurado. */
function validarRemetenteWeb(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (event.sender !== janela?.webContents || !remetenteWebValido({ frameUrl: frame?.url, frameDeTopo: !!frame && frame.parent === null, servidor: configuracao?.url })) throw new Error("origem_invalida");
}
// NOD-174: menu de contexto, diálogos nativos e validação da página em pt-BR mesmo num Mac em inglês. Só vale antes do
// `ready`: depois disso o Chromium ignora a troca em silêncio.
app.commandLine.appendSwitch("lang", IDIOMA_DO_APP);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // NOD-137: abrir de novo (segunda cópia, Dock) traz a janela atual, inclusive minimizada. Sem janela (boot ou troca em
  // curso), o activate não faz nada: fechar a última janela sai do app (window-all-closed).
  // NOD-136: no Mac o link chega pelo open-url, que no app frio dispara entre o will-finish-launching e o `ready`. O
  // ouvinte entra aqui, síncrono: medido em 2026-10-28 (Electron 43.7, main ESM), o corpo do main roda inteiro antes
  // do will-finish-launching, mesmo depois de um `await`. No Windows/Linux o link vem no argv (o da segunda instância
  // ou o desta, se abriu fria).
  app.on("open-url", (event, url) => { event.preventDefault(); receberDeepLink(url); });
  app.on("second-instance", (_event, argv) => {
    const url = deepLinkDoArgv(argv);
    if (url) receberDeepLink(url); // foca também
    else focarJanela(janela);
  });
  const deepLinkInicial = deepLinkDoArgv(process.argv);
  if (deepLinkInicial) receberDeepLink(deepLinkInicial);
  app.on("activate", () => focarJanela(janela));
  // NOD-132: durante o reinício da atualização o Squirrel relança no OnWindowAllClosed; um app.quit() aqui correria com ele.
  app.on("window-all-closed", () => { if (sairAoFecharJanelas(atualizacaoApp)) app.quit(); });
  app.on("before-quit", (event) => {
    if (encerrando) return;
    event.preventDefault();
    // Cmd+Q com a ligação aberta pergunta como o fechar da janela; "Continuar" cancela a saída.
    const w = janelaWeb();
    if (emLigacao && w) {
      void confirmarFecharEmLigacao(w).then((sim) => { if (sim) { definirEmLigacao(false); app.quit(); } });
      return;
    }
    encerrando = true;
    // Cmd+Q: as janelas só fecham depois deste evento, então o estado é capturado aqui e a gravação entra na espera.
    if (w) capturarEstadoJanela(w);
    void Promise.all([parar(), gravacaoJanela, vmLocal?.parar()]).finally(() => app.quit());
  });
  // ADR-089: o `exit` do Node também leva os grupos, mas o will-quit é o fim garantido do app (Cmd+Q, SIGTERM, SIGHUP).
  // NOD-137/NOD-132: o Squirrel reabre o app logo depois de trocar o pacote; com o lock ainda preso, a cópia nova sairia
  // como segunda instância. Solta SÓ aqui: no before-quit comum o lock segura um segundo clique no Dock durante a saída.
  if (process.platform === "darwin") autoUpdater.on("before-quit-for-update", () => { app.releaseSingleInstanceLock(); });
  app.on("will-quit", () => { atualizador.parar(); encerrarGruposVivos(); });
  void app.whenReady().then(async () => {
    // ADR-101: o contas.json antes de qualquer config dos drivers (a conta em uso vai no ambiente deles).
    await contasDoApp.iniciar().catch((erro: unknown) => log("erro", "contas_ler_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" }));
    // NOD-138: o log() do app passa a gravar em ~/Library/Logs/nod antes de qualquer outra coisa, e as quedas viram linha.
    definirDestinoDoLog(criarArquivoDeLog({ dir: app.getPath("logs"), maxBytes: MAX_BYTES_LOG }));
    logDeepLink.liberar();
    instalarOuvintesDeQueda({ app, processo: process, registrar: (campos) => log("erro", "app_processo_caiu", campos), encerrando: () => encerrando, ehJanelaPrincipal: (conteudo) => !!janela && !janela.isDestroyed() && conteudo === janela.webContents });
    log("info", "app_iniciado", { versao: app.getVersion(), empacotado: app.isPackaged, arquitetura: process.arch });
    // NOD-93 (ADR-127): a VM local (só com NOD_VM_LOCAL=1 num Mac). A fase vai no anúncio, no máximo 1/s.
    vmLocal = montarVmLocal({ ambiente: process.env, plataforma: process.platform, arch: process.arch, versaoApp: app.getVersion(), macos: process.getSystemVersion(), dadosApp: app.getPath("userData"), recursos: process.resourcesPath, leitura: () => memoriaDoMac.daMaquina?.(), aoMudar: (v) => { void vigiaIas?.reanunciar().catch(() => undefined); primeiroUsoDaVm(v.estado); } });
    if (vmLocal) powerMonitor.on("resume", () => void vmLocal?.aoAcordarDoMac().catch(() => undefined));
    void limparOrfaosUmaVez();
    // definido em 2026-10-09: o PATH do shell real começa a ser lido já (em segundo plano, até 10 s), e o "node do nod"
    // é reescrito com o caminho atual do app, antes da primeira sonda.
    void lerPathDoShell(process.env.SHELL, 0);
    await garantirNodeDoNod().catch((erro: unknown) => log("aviso", "node_do_nod_falhou", { erro: erro instanceof Error ? erro.name : "desconhecido" }));
    // NOD-9: o registro do dia das atualizações e o timer de 1 min (a brecha, o aviso e o segurar).
    await atualizador.carregar().catch(() => undefined);
    atualizador.iniciar();
    await carregarPreferencias();
    await carregarEstadoJanela();
    aplicarTemaNativo();
    atualizacaoApp = criarAtualizacaoDoApp({
      updater: autoUpdater, empacotado: app.isPackaged, plataforma: process.platform, arquitetura: process.arch,
      naPastaAplicativos: () => { try { return app.isInApplicationsFolder(); } catch { return false; } },
      versao: app.getVersion(), conexao: () => (conexaoDaAtualizacao && servidorDeAtualizacao(conexaoDaAtualizacao.url, SERVIDOR_PADRAO) ? conexaoDaAtualizacao : null),
      agendar: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return () => clearTimeout(t); },
      agora: Date.now,
      registrar: (evento, campos) => log(evento === "atualizacao_app_erro" || evento === "atualizacao_app_prazo" ? "aviso" : "info", evento, campos),
      aoMudar: aoMudarAtualizacao,
      podeReiniciar: podeReiniciarParaAtualizar,
      antesDeInstalar: antesDeInstalarAtualizacao,
      // O vigia do reinício chega aqui com o app ainda aberto: tenta sair; se nem isso fechar em 10 s, sai à força.
      sair: () => { app.quit(); setTimeout(() => app.exit(0), 10_000).unref(); },
      avisar: (texto) => {
        const w = janela && !janela.isDestroyed() ? janela : null;
        const o: Electron.MessageBoxOptions = { type: "info", message: texto, buttons: ["OK"] };
        void (w ? dialog.showMessageBox(w, o) : dialog.showMessageBox(o));
      },
    });
    montarMenu();
    ipcMain.handle(CANAIS_DESKTOP.avisar, (e, dados: unknown) => {
      validarRemetenteWeb(e);
      const aviso = lerAviso(dados);
      return aviso ? avisar(aviso) : false;
    });
    ipcMain.handle(CANAIS_DESKTOP.contador, (e, n: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerContador(n);
      if (lido !== null) { contadorAtual = lido; aplicarContador(); }
    });
    ipcMain.handle(CANAIS_DESKTOP.preferencias, (e) => { validarRemetenteWeb(e); return estadoPreferencias(); });
    // NOD-136: a web busca o link `nod://` da fila quando tem sessão e frota; só a janela web, na origem do servidor.
    ipcMain.handle(CANAIS_DESKTOP.deepLinkPendente, (e) => { validarRemetenteWeb(e); return entregarDeepLink(); });
    // NOD-136: o esquema `nod://` é registrado só pelo Info.plist (electron-builder.yml, mac.protocols); sem
    // setAsDefaultProtocolClient, que reafirmaria a cada abertura e registraria no Windows/Linux (fora do escopo).
    // NOD-93 (ADR-127): o "tentar agora" do download pausado; sem a VM local (flag desligada), não faz nada.
    ipcMain.handle(CANAIS_DESKTOP.vmTentarAgora, (e) => { validarRemetenteWeb(e); vmLocal?.preparador.tentarAgora(); });
    ipcMain.handle(CANAIS_DESKTOP.definirAvisos, (e, ligado: unknown) => {
      validarRemetenteWeb(e);
      if (typeof ligado !== "boolean") throw new Error("entrada_invalida");
      return definirAvisos(ligado);
    });
    ipcMain.handle(CANAIS_DESKTOP.definirSom, (e, ligado: unknown) => {
      validarRemetenteWeb(e);
      if (typeof ligado !== "boolean") throw new Error("entrada_invalida");
      return definirSom(ligado);
    });
    ipcMain.handle(CANAIS_DESKTOP.definirTema, (e, tema: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerTemaDesktop(tema);
      if (!lido) throw new Error("entrada_invalida");
      return definirTema(lido);
    });
    // NOD-119: a densidade da barra. O preload pede o valor de forma síncrona e o repõe no localStorage antes da página
    // (apagado a cada conexão), para a barra abrir sem piscar. Remetente fora da janela web recebe null.
    ipcMain.on(CANAIS_DESKTOP.barraInicial, (e) => {
      e.returnValue = respostaSincrona(() => validarRemetenteWeb(e), () => preferencias.barra, null);
    });
    ipcMain.handle(CANAIS_DESKTOP.definirBarra, async (e, barra: unknown) => {
      validarRemetenteWeb(e);
      preferencias = { ...preferencias, barra: barraDoPedido(barra) };
      await gravarPreferencias();
    });
    // NOD-119 (revisão 4): a decisão do card da barra, que o preload repõe no localStorage junto com a barra.
    ipcMain.on(CANAIS_DESKTOP.decisoesBarraIniciais, (e) => {
      e.returnValue = respostaSincrona(() => validarRemetenteWeb(e), () => preferencias.decisoesBarra, {});
    });
    ipcMain.handle(CANAIS_DESKTOP.definirDecisaoBarra, async (e, mensagemId: unknown, decisao: unknown) => {
      validarRemetenteWeb(e);
      preferencias = { ...preferencias, decisoesBarra: decisoesComPedido(preferencias.decisoesBarra, mensagemId, decisao) };
      await gravarPreferencias();
    });
    ipcMain.handle(CANAIS_DESKTOP.microfone, (e) => { validarRemetenteWeb(e); return acessoAoMicrofone(); });
    ipcMain.handle(CANAIS_DESKTOP.emLigacao, (e, ativa: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerEmLigacao(ativa);
      if (lido === null) throw new Error("entrada_invalida");
      definirEmLigacao(lido);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaEntrar, (e, ia: unknown) => {
      validarRemetenteWeb(e);
      const lida = lerIaDesktop(ia);
      if (!lida) throw new Error("entrada_invalida");
      return armarLogin(lida).then(() => entrarNaIa(lida));
    });
    ipcMain.handle(CANAIS_DESKTOP.iaInstalar, async (e, ia: unknown): Promise<ResultadoIaDesktop> => {
      validarRemetenteWeb(e);
      const lida = lerIaDesktop(ia);
      if (!lida) throw new Error("entrada_invalida");
      try { await shell.openExternal(URL_INSTALAR_IA[lida]); return { ok: true }; } catch { return { ok: false, motivo: "falhou" }; }
    });
    // definido em 2026-10-05: o teste de verdade das IAs. O pedido vem de uma página remota: a vigia só aceita os ids
    // conhecidos e um nome com forma de nome (src/domain/conta-da-ia.ts). Sem conexão não há o que testar.
    ipcMain.handle(CANAIS_DESKTOP.iaTestar, (e, pedido: unknown): Promise<TesteDeIa[]> => {
      validarRemetenteWeb(e);
      return vigiaIas ? vigiaIas.testar(pedido) : Promise.resolve([]);
    });
    // definido em 2026-10-09 (PonteIas): as IAs dentro do app. A página só escolhe QUAL IA (lerIaDesktop); o que roda,
    // com que argumentos e qual link abre é decidido aqui. O único texto da página que chega a um processo é o código
    // colado, pelo stdin, e só com a forma de um código (login-ia.ts).
    const iaDoPedido = (e: IpcMainInvokeEvent, ia: unknown): IaDesktop => {
      validarRemetenteWeb(e);
      const lida = lerIaDesktop(ia);
      if (!lida) throw new Error("entrada_invalida");
      return lida;
    };
    ipcMain.handle(CANAIS_DESKTOP.iaEstados, (e): EstadoIa[] => {
      validarRemetenteWeb(e);
      // A página abriu (ou recarregou): a conta é conferida de novo, para mostrar uma troca feita no terminal.
      if (inventariosDaVigia) for (const ia of IAS_DESKTOP) contaLidaEm.delete(ia);
      if (inventariosDaVigia) conferirContas(inventariosDaVigia);
      return IAS_DESKTOP.map(estadoAtual);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaInstalarNoApp, async (e, ia: unknown): Promise<EstadoIa> => {
      const lida = iaDoPedido(e, ia);
      await instalador.instalar(lida);
      return estadoAtual(lida);
    });
    // NOD-9: o "Atualizar" da tela. A página só escolhe a IA e se é agora; o binário e o comando são decididos aqui.
    ipcMain.handle(CANAIS_DESKTOP.iaAtualizar, async (e, ia: unknown, opcoes: unknown): Promise<EstadoIa> => {
      const lida = iaDoPedido(e, ia);
      const agora = typeof opcoes === "object" && opcoes !== null && "agora" in opcoes && opcoes.agora === true;
      await atualizador.atualizar(lida, { agora });
      return estadoAtual(lida);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaEntrarNoApp, async (e, ia: unknown): Promise<EstadoIa> => {
      const lida = iaDoPedido(e, ia);
      await armarLogin(lida);
      await loginIas.entrar(lida);
      return estadoAtual(lida);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaAbrirLink, async (e, ia: unknown): Promise<boolean> => {
      const url = loginIas.link(iaDoPedido(e, ia));
      if (!url) return false;
      try { await shell.openExternal(url); return true; } catch { return false; }
    });
    ipcMain.handle(CANAIS_DESKTOP.iaColarCodigo, (e, ia: unknown, codigo: unknown): ResultadoColarCodigo => loginIas.colarCodigo(iaDoPedido(e, ia), codigo));
    ipcMain.handle(CANAIS_DESKTOP.iaCancelar, async (e, ia: unknown): Promise<EstadoIa> => {
      const lida = iaDoPedido(e, ia);
      await Promise.all([loginIas.cancelar(lida), instalador.cancelar(lida)]);
      return estadoAtual(lida);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaVerificar, async (e, ia: unknown): Promise<EstadoIa> => {
      const lida = iaDoPedido(e, ia);
      if (loginIas.estado(lida)?.fase === "aguardando") await loginIas.verificar(lida);
      else {
        contaLidaEm.delete(lida);
        await vigiaIas?.sondarAgora().catch(() => undefined);
      }
      return estadoAtual(lida);
    });
    // NOD-323 (J5, ADR-126): a mídia do bot que ficou neste Mac. O caminho vem da página (dado de fora): arquivoDaMidia
    // confere tudo de novo contra ~/nod/<pasta do bot>; o Finder só abre com o arquivo selecionado (nada é executado).
    const homeDaMidia = () => cfgExecutor?.env.HOME ?? homedir();
    ipcMain.handle(CANAIS_MIDIA.maquina, (e): string | null => { validarRemetenteWeb(e); return maquinaIdAtual; });
    ipcMain.handle(CANAIS_DESKTOP.estaMaquina, (e): EstaMaquina | null => { validarRemetenteWeb(e); return estaMaquinaDe({ id: maquinaIdAtual, nome: hostname(), plataforma: process.platform }); }); // ADA-243
    // ADA-245 (jornada D): "Remover o nod deste computador". Qual é este Mac vem do estaMaquina da ADA-243 (acima); o
    // removerDaqui faz a limpeza local (remover-daqui.ts) com as opções validadas de novo. Sem fecharAposRemover no Mac.
    ipcMain.handle(CANAIS_REMOVER.removerDaqui, async (e, opcoes: unknown): Promise<ResultadoRemoverDaqui> => {
      validarRemetenteWeb(e);
      const o = lerOpcoesRemover(opcoes);
      if (!o) throw new Error("entrada_invalida");
      if (conectando) throw new Error("ocupado");
      conectando = true;
      try {
        log("info", "mac_removido_pela_tela", { manter_ias: String(o.manterIas), manter_conexao: String(o.manterConexao) });
        return await removerDaquiNoMac(o, depsRemoverNoMac(true));
      } finally { conectando = false; }
    });
    ipcMain.handle(CANAIS_MIDIA.existe, async (e, caminho: unknown): Promise<boolean> => { validarRemetenteWeb(e); return (await arquivoDaMidia(caminho, homeDaMidia())) !== null; });
    ipcMain.handle(CANAIS_MIDIA.mostrarNoFinder, async (e, caminho: unknown): Promise<boolean> => {
      validarRemetenteWeb(e);
      const real = await arquivoDaMidia(caminho, homeDaMidia());
      if (real) shell.showItemInFolder(real);
      return real !== null;
    });
    // definido em 2026-10-12 (ADR-101): as várias contas. A página escolhe a IA e a posição; o resto é validado aqui.
    ipcMain.handle(CANAIS_DESKTOP.contasListar, (e): ContasNaTela[] => { validarRemetenteWeb(e); return contasDoApp.listar(); });
    // ADR-102: e-mail e organização das contas deste Mac, só para a página do app (nunca ao servidor).
    ipcMain.handle(CANAIS_DESKTOP.contasDetalhes, async (e): Promise<DetalhesDasContas> => { validarRemetenteWeb(e); await sincronizandoContas; return { maquinaId: maquinaIdAtual, contas: contasLocais?.detalhes() ?? [] }; });
    const iaDasContasDoPedido = (e: IpcMainInvokeEvent, ia: unknown): IaDesktop => {
      validarRemetenteWeb(e);
      const lida = iaDasContas(ia);
      if (!lida || !contasDoApp.carregadas()) throw new Error("entrada_invalida");
      return lida;
    };
    ipcMain.handle(CANAIS_DESKTOP.contasUsar, (e, ia: unknown, posicao: unknown) => contasDoApp.usar(iaDasContasDoPedido(e, ia), posicao));
    ipcMain.handle(CANAIS_DESKTOP.contasAdicionar, async (e, ia: unknown, apelido: unknown): Promise<boolean> => {
      const lida = iaDasContasDoPedido(e, ia);
      if (loginIas.estado(lida)?.fase === "aguardando") return false;
      if (!(await contasDoApp.comecarAdicao(lida, apelido))) return false;
      contaPendente.add(lida);
      await armarLogin(lida);
      await loginIas.entrar(lida);
      return true;
    });
    ipcMain.handle(CANAIS_DESKTOP.contasRemover, (e, ia: unknown, posicao: unknown) => contasDoApp.remover(iaDasContasDoPedido(e, ia), posicao));
    ipcMain.handle(CANAIS_DESKTOP.contasFecharFalha, (e, ia: unknown) => contasDoApp.fecharFalha(iaDasContasDoPedido(e, ia)));
    ipcMain.handle(CANAIS_DESKTOP.contasMover, (e, ia: unknown, de: unknown, para: unknown) => contasDoApp.mover(iaDasContasDoPedido(e, ia), de, para));
    ipcMain.handle(CANAIS_DESKTOP.contasRenomear, (e, ia: unknown, posicao: unknown, apelido: unknown) => contasDoApp.renomear(iaDasContasDoPedido(e, ia), posicao, apelido));
    ipcMain.handle(CANAIS_DESKTOP.contasDefinirModo, (e, ia: unknown, modo: unknown) => contasDoApp.definirModo(iaDasContasDoPedido(e, ia), modo));
    ipcMain.handle(CANAIS_DESKTOP.contasDefinirTroca, (e, ia: unknown, posicao: unknown, ligado: unknown) => contasDoApp.definirTrocaAutomatica(iaDasContasDoPedido(e, ia), posicao, ligado));
    ipcMain.handle("nod:estado", (e) => { validarRemetente(e); return { url: configuracao?.url ?? SERVIDOR_PADRAO, mensagem, atualizacao: atualizacaoApp ? linhaDaAtualizacao(atualizacaoApp.estado(), process.arch) : "", prontaParaReiniciar: atualizacaoApp?.estado().fase === "pronta" }; });
    // NOD-132: o botão "Reiniciar para atualizar" da tela de conexão.
    ipcMain.handle("nod:reiniciarParaAtualizar", (e) => { validarRemetente(e); return atualizacaoApp?.reiniciar() ?? false; });
    // ADR-069: entrar pelo navegador e voltar com a chave, sem copiar nada. A invocação dura até a pessoa confirmar (ou o prazo vencer).
    ipcMain.handle("nod:parear", async (e, valor: unknown) => {
      validarRemetente(e);
      if (conectando) return { mensagem: "Conexão em andamento…" };
      conectando = true;
      mensagem = ""; // NOD-406: a dica do "Sou da equipe" não esconde o erro desta tentativa.
      try {
        const url = urlServidor(valor, !app.isPackaged);
        const chave = await parearPeloNavegador({ servidor: url, nome: hostname(), abrir: (u) => shell.openExternal(u) });
        await conectar({ url, chave });
        await marcarEquipeDoApp();
      } catch (erro) {
        if (erro instanceof FalhaPareamento) mensagem = mensagens[erro.codigo] ?? mensagens.servidor_fora!;
        else if (erro instanceof FalhaPonte) mensagem = mensagens[erro.codigo]!;
        else if (!mensagem || mensagem === "Conectado.") mensagem = "Não foi possível conectar. Confira o endereço e sua conta de IA.";
      } finally { conectando = false; }
      return { mensagem };
    });
    ipcMain.handle("nod:login", async (e, valor: unknown) => {
      validarRemetente(e);
      try { await shell.openExternal(urlServidor(valor, !app.isPackaged)); return { mensagem: "No navegador, entre e gere uma chave em Chaves." }; }
      catch { return { mensagem: mensagens.resposta_invalida }; }
    });
    ipcMain.handle("nod:conectar", async (e, dados: unknown) => {
      validarRemetente(e);
      if (conectando) return { mensagem: "Conexão em andamento…" };
      conectando = true;
      mensagem = ""; // NOD-406: a dica do "Sou da equipe" não esconde o erro desta tentativa.
      try {
        if (!dados || typeof dados !== "object" || !("url" in dados) || !("chave" in dados) || typeof dados.chave !== "string" || dados.chave.length > 1024 || !dados.chave) throw new FalhaPonte("resposta_invalida");
        await conectar({ url: urlServidor(dados.url, !app.isPackaged), chave: dados.chave });
        await marcarEquipeDoApp();
      } catch (erro) { if (erro instanceof FalhaPonte) mensagem = mensagens[erro.codigo]!; else if (!mensagem) mensagem = "Não foi possível conectar. Confira sua conta de IA e o acesso ao Keychain."; }
      finally { conectando = false; }
      return { mensagem };
    });
    // NOD-345: a troca de espaço depois de entrar numa conta pela janela do app (o código é de uso único). A página só
    // vê o desafio; a prova fica aqui.
    const troca = segredoDeTroca();
    ipcMain.handle(CANAIS_DESKTOP.desafioConta, (e): string => {
      validarRemetenteWeb(e);
      return troca.desafio;
    });
    ipcMain.handle(CANAIS_DESKTOP.trocarConta, async (e, codigo: unknown): Promise<boolean> => {
      validarRemetenteWeb(e);
      if (!configuracao || conectando) return false;
      const chave = await trocarChaveDoApp({ servidor: configuracao.url, codigo, prova: troca.prova });
      if (!chave) return false;
      conectando = true;
      try { await conectar({ url: configuracao.url, chave }); return true; }
      catch (erro) { mensagem = erro instanceof FalhaPonte ? mensagens[erro.codigo]! : "Conecte novamente para continuar."; await mostrarSetup(); return false; }
      finally { conectando = false; }
    });
    // ADA-242 (ADR-157 §3): o Google para conta dentro do app. A prova é a mesma do segredo de troca acima.
    const google = criarGoogleNoApp({
      servidor: () => configuracao?.url ?? null,
      prova: troca.prova,
      abrirExterno: (u) => shell.openExternal(u),
      aoEntrar: async (chave) => {
        if (!configuracao) return;
        conectando = true;
        try { await conectar({ url: configuracao.url, chave }); }
        catch (erro) { mensagem = erro instanceof FalhaPonte ? mensagens[erro.codigo]! : "Conecte novamente para continuar."; await mostrarSetup(); }
        finally { conectando = false; }
      },
      registrar: (evento, dados) => log("aviso", evento, dados),
    });
    ipcMain.handle(CANAIS_DESKTOP.googleAbrir, (e) => { validarRemetenteWeb(e); return google.abrir(); });
    ipcMain.handle(CANAIS_DESKTOP.googleIr, (e, url: unknown) => { validarRemetenteWeb(e); return google.ir(url); });
    ipcMain.handle(CANAIS_DESKTOP.googleCancelar, (e) => { validarRemetenteWeb(e); google.cancelar(); });
    // ADA-242 (ADR-157 §4): o "já vi" da tela Este computador, nesta máquina.
    const esteComputador = esteComputadorEm(app.getPath("userData"));
    ipcMain.handle(CANAIS_DESKTOP.esteComputadorJaViu, (e) => { validarRemetenteWeb(e); return esteComputador.jaViu(); });
    ipcMain.handle(CANAIS_DESKTOP.esteComputadorMarcar, (e) => { validarRemetenteWeb(e); return esteComputador.marcar(); });
    // NOD-406: quem é da equipe sai do provisório e conecta com a chave de Chaves (a tela de conexão de antes).
    // Só desfaz uma conexão provisória, com confirmação. A conexão salva some (fechar o app antes de conectar devolve o
    // mesmo provisório: o verificador da instalação fica); a marca só nasce quando a conexão pela tela der certo.
    ipcMain.handle(CANAIS_DESKTOP.souDaEquipe, async (e): Promise<boolean> => {
      validarRemetenteWeb(e);
      if (conectando || !configuracao?.provisoria || !janela) return false;
      const r = await dialog.showMessageBox(janela, { type: "question", message: "Entrar como alguém da equipe?", detail: "Este espaço provisório sai deste app e aparece a tela de conexão: entre com o Google da equipe ou cole a chave de Chaves. Uma ligação em andamento é encerrada. Se fechar o app antes de conectar, o espaço provisório volta.", buttons: ["Ir para a conexão", "Cancelar"], defaultId: 1, cancelId: 1 });
      if (r.response !== 0 || conectando || !configuracao?.provisoria) return false;
      conectando = true;
      try {
        log("info", "app_sou_da_equipe", {});
        await parar();
        await rm(caminhoConfig(), { force: true });
        configuracao = null;
        mensagem = "Entre com o Google da equipe ou cole a chave de Chaves.";
        await mostrarSetup();
        return true;
      } finally { conectando = false; }
    });
    configuracao = await ler() ?? await configProvisoria().catch(() => null);
    await mostrarSetup();
    if (configuracao) {
      conectando = true;
      try { await conectar(configuracao); }
      catch (erro) { mensagem = erro instanceof FalhaPonte ? mensagens[erro.codigo]! : mensagem || "Conecte novamente para continuar."; await mostrarSetup(); }
      finally { conectando = false; }
    }
  });
}
