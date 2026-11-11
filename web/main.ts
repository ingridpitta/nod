import { botaoDaBarraSemIa, conversaAguardandoIa, dicaDoComposerSemIa, iasNoCard, idDoCardSemIa, turnosVivosDe } from "./telas/sem-ia-conversa.ts";
import { escNoEspaco, focoAoAbrirEspaco, voltarParaLista } from "./lib/navegacao-config.ts";
import { perfilMudou } from "./lib/perfil-mudou.ts";
import "./lib/mascote-elemento.ts";
import { ligarModoDeFoco } from "./lib/modo-de-foco.ts";
import { alternarExplicacao, detailsParaFecharComEsc } from "./lib/recomeco.ts";
import { abrirCapturaAmpliada } from "./telas/captura-ampliada.ts";
import { abrirPreviaArquivo } from "./telas/previa-arquivo.ts";
import { abrirComputador, aplicarModoDevNoComputador } from "./telas/computador.ts";
import { abrirTelaCheia } from "./telas/tela-cheia.ts";
import { criarAcoesDaEspera } from "./lib/esperas-de-colega.ts";
import { avisoDoComputador, OPERACOES_PESSOA, type OperacaoPessoa } from "./lib/computador-pessoa.ts";
import { CHAVE_AVISO_RECRIADO } from "./telas/espaco.ts";
import { marcarTelaFechadaNaAjuda } from "./lib/computador.ts";
import { anunciarEm, criarFocoPendente, guardarPosicao, planejarSaidaDaLista, reporPosicao, type ElDaLista, type RaizDaLista } from "./lib/posicao-da-lista.ts";
import { criarUltimaLeitura } from "./lib/ultima-leitura.ts";
import { aoVerComputador, definirTelaDoBot } from "./telas/tela-do-bot.ts";
import { abrirWorkspace } from "./telas/workspace.ts";
import { listaDoQuePodem, rotuloPermitir, type EscolhaLiberar } from "./telas/card-liberar.ts";
import { CURTA } from "./telas/card-pasta.ts";
import { erroDaResposta as erroDoCartao, faseDoCartao, marcarFase, versaoDasFases } from "./telas/card-credencial.ts";
import { abrirReportarBug } from "./telas/reportar-bug.ts";
import { destinoDoFeedback } from "./telas/relatos.ts";
import { proximoItemDoMenu } from "./lib/linha-config.ts";
import { abrirRaioX } from "./telas/raio-x.ts";
import { ondeDoTurno } from "./telas/modo-dev.ts";
import { iasDaTela, mudarRascunho, ordemDaPessoa, destinoDoPedido, mudaAIaDoBot, pedidoDoMenu, pedidoDoRascunho, rascunhoDe, type MudancaRascunho, type RascunhoInteligencia } from "./telas/inteligencia.ts";
import { abrirPreviaDaTroca } from "./telas/previa-troca-dialogo.ts";
import { htmlEscolherTarefa } from "./telas/escolher-tarefa.ts";
import type { OpcaoDeTarefaDto } from "../src/contracts/quadro.ts";
import { ehIaMac, type UiIas } from "./telas/cartao-ia.ts";
import { abrirAvisoDosTermos } from "./telas/aviso-termos-dialogo.ts";
import { abrirRodarMaisUma } from "./telas/rodar-mais-uma-dialogo.ts";
import { criarContasDoMac } from "./lib/contas-do-mac.ts";
import { criarContasDaPessoa } from "./lib/contas-da-pessoa.ts";
import { cifrarCodigo } from "./lib/cifra.ts";
import { criarInstalarSsh, type CampoSegredo } from "./lib/instalar-ssh.ts";
import type { ContasIaDto } from "../src/contracts/contas-ia.ts";
import type { Mensagem } from "../src/contracts/mensagem.ts";
import type { TipoMemoria } from "../src/contracts/memoria.ts";
import { criarIasDoMac } from "./lib/ias-do-mac.ts";
import { instalarOrdemArrastavel } from "./lib/ordem-arrastavel.ts";
import { chaveDoMenuDaIa, ordemDoPasso } from "./lib/ordem.ts";
import { abrirFolhaCompartilhar, abrirMenu, abrirMenuCompartilhar, abrirMenuConta, confirmarExclusaoNaFolha, dialogo, pedirGestao, textoDuplicar, type BotGerido, type AcaoGestao } from "./telas/gestao-agentes.ts";
import { perfilAoAbrir, perfilAoAbrirNivel, saidaDoPerfil } from "./telas/perfil-celular.ts";
import { criarMarcaDoPerfil, planoDaSaida } from "./lib/lista-apos-saida.ts";
import { rascunhoMudou } from "./telas/memoria.ts";
import { abrirLuz } from "./telas/luz.ts";
import { baixarUrl } from "./telas/luz-html.ts";
import { desmarcarIrCarregando, htmlDaNotaDoMenu, htmlDoMenuDaBiblioteca, marcarIrCarregando, NOTA_FALA_DEMOROU, NOTA_FALA_FORA, TEXTO_IR_CARREGANDO } from "./telas/biblioteca.ts";
import { abrirDetalhesAcima, criarMenuDoIr, criarMundoDaFala, irParaFalaDaBiblioteca, levarAFalaComAte, notarVeio, soltarAlvoNaoDesenhado, type AlvoDaFala } from "./lib/ir-para-a-fala.ts";
import { lerSeAindaVale } from "./lib/biblioteca.ts";
import { acaoDoAlvo, indiceNaLuz } from "./lib/link-anexo.ts";
import { alternarAudio, alternarGif, instalarMidiaDom, irNoAudio, mostrarNoFinder, tentarDeNovo, velocidadeDoAudio, type OpcoesMidiaDom } from "./lib/midia-dom.ts";
import { baixaveis } from "./lib/midia.ts";
import { botDaFala, citacaoDaFala, htmlMenuDaFala, htmlSeletorDeReacao, linhaDeEmojis, reacoesDaFala, textoAbrirTask, textoParaLembrar } from "./telas/acoes-da-fala.ts";
import { podeAbrirCartao, TEXTO_DA_RECUSA } from "./telas/desfazer.ts";
import { renderChipModo } from "./telas/aprovacoes.ts";
import { controleDaFolha, linhasDoBot, linhasVisiveis, renderFolhaMais, rotuloDoMais, travarToqueDuploEm, type EscolhaDaFolhaMais, type LinhasDaFolhaMais } from "./telas/folha-mais.ts";
import { abrirMenuModo } from "./lib/menu-modo.ts";
import { abrirMenuIa } from "./lib/menu-ia.ts";
import { dadosDoSeletor, mioloDoSeletor, pedidoDoSeletor, renderMenuIa, rotuloDoSeletor } from "./telas/seletor-ia.ts";
import type { FormaAgente, CorAgente } from "../src/contracts/agente.ts";
import type { AmbienteBancoDto, ModoSessaoDto } from "../src/contracts/api.ts";
import type { PedidoInteligencia } from "../src/contracts/inteligencia.ts";
import { abrir as abrirLote, cancelar as cancelarLote, marcar as marcarLote, marcarTodos as marcarTodosLote, previaDoLote, valorComum as valorComumLote, type AcaoLote, type IaDoLote, type LoteAgentes } from "./lib/lote-agentes.ts";
import { executarLote, pedidoDaIa, type DepsDoLote } from "./lib/lote-executar.ts";
import { botsDoLote, motivoDoDestinoIndisponivel, textoDaContagem, textoDoResultado as textoDoResultadoLote, textoMudando as textoMudandoLote } from "./telas/agentes-lote.ts";
import { botCasaComBusca } from "./telas/config-agentes.ts";
import type { AlvoAviso, IaDesktop } from "../src/contracts/desktop.ts";
import type { Experimentos } from "../src/contracts/raio-x.ts";
import type { Escopo } from "../src/shared/types.ts";
import type { FrameSse } from "../src/contracts/frame.ts";
import type { AnexoDaConversa } from "../src/contracts/anexo.ts";
import { confirmacaoCaducou, HISTORICO_INICIAL, type HistoricoDoBot } from "./lib/historico-perfil.ts";
import { agenteDaTela, bibliotecaAberta, conversaAbertaTemNotaDeContas, conversaDaTela, estadoInicial, acoesAoMudarConexao, invalidacoesAoRetomar, sempreRelevante, invalidacoesDaTela, mudouNaTela, reduzir, secaoAberta, secaoDoPedido, type Acao, type Estado, type FalaPendente, type Invalidacao, type NivelGaveta, type PedidoSecao, type PerfilCelular, type SecaoEspaco, type Tela } from "./estado/reducer.ts";
import { mascararDormindo, RetryDoAcordar, type PassosDoRetry } from "./lib/retry-computador.ts";
import { contaApi, criarApi, minhaContaApi, ErroApi, observarRede, sessao as sessaoApi, type Api } from "./lib/api.ts";
import { reagirACota } from "./lib/cota-provisorio.ts";
import { resolverProvaNoNavegador } from "./lib/prova-trabalho.ts";
import { abreProvisorio, CHAVE_EQUIPE, decidirPareamento, criarContaNoChat, equipeNoApp, fraseDoErro as fraseDoErroDeConta, linkDaEquipe, type PassoPareamento } from "./telas/conta-no-chat.ts";
import { criarMinhaConta } from "./telas/minha-conta.ts";
import { reduzirFoto } from "./lib/reduzir-foto.ts";
import { deveLembrar, htmlLembrete, jaFalou, marcarFalou } from "./telas/lembrete-conta.ts";
import type { EstadoContaDto } from "../src/contracts/conta.ts";
import { acaoDoErro, criarRegistroDeErros, detalhesDoErro, ehErroDeRede, erroDaAcao, erroDe as traduzirErro, erroParaRelatar, type ErroNaTela } from "./lib/erro-da-tela.ts";
import { criarSondaDeRede } from "./lib/sonda-de-rede.ts";
import { criarReleituraAdiada } from "./lib/releitura-adiada.ts";
import { tabelaComo } from "./lib/texto-formatado.ts";
import { CHAVE_GUARDADA, lerGuardado, lerPedido, PARAMETROS_DO_PEDIDO, type PedidoPareamento } from "./lib/parear-mac.ts";
import { abrirPareamento } from "./telas/parear-mac.ts";
import { abrirOiDeNovo, mostrarEsteComputador } from "./telas/oi-de-novo.ts";
import { criarAvisador } from "./lib/avisador.ts";
import { criarCanalAvisos } from "./lib/canal-avisos.ts";
import { criarPuxadorDeepLink, destinoDoAlvo, leituraConta } from "./lib/deep-link.ts";
import { criarLiveEvents, type LiveEvents } from "./lib/live-events.ts";
import { ehCelular } from "./lib/celular.ts";
import { contextoDaPilula, executarNaPilula } from "./lib/setas-da-pilula.ts";
import { alvoDoAtalho, atalhoDoNovoBot, atalhoDoTeclado, lugarAtual, SELETOR_CAMPO, SELETOR_MODAL, type AcaoAtalho } from "./lib/atalhos.ts";
import { rotuloDoMac } from "./lib/aparelho.ts";
import { criarCelular, SELETOR_INTERATIVO } from "./lib/gaveta-bots.ts";
import { tentarFrotaAgora } from "./lib/tentar-frota.ts";
import { listaVaziaDaBarra } from "./lib/lista-vazia-da-barra.ts";
import { criarToqueLongo, dicaJaVista, alturaDaLista, escolherRedesenhada, lugarDoMenuSegurado, marcarDicaVista, MS_DICA } from "./lib/toque-longo.ts";
import { escondidosNoCelular, estadoDaLista, FAVORITOS_VISIVEIS, gruposSemResultado, horaDaLinha, PREFIXO_DO_PEDIDO } from "./lib/inicio-celular.ts";
import "./pwa.ts";
import { avatar, botao, dataHora, esc, hora as horaDaFala, iconeAgente } from "./lib/render.ts";
import { COPIADO_MS, mostrarCopia, ROTULO_COPIADO, type RelogioDoCopiar } from "./lib/copiar.ts";
import { avisoDeEstado } from "./lib/aviso-estado.ts";
import { aplicarTema, lerTema, type EscolhaTema } from "./lib/tema.ts";
import { adiar, aplicarBarra, escolherDensidade, lerBarra, pedidoDoChat, pintarBarra, serializar, type Barra, type PedidoBarra } from "./lib/densidade.ts";
import type { BarraDesktop } from "../src/contracts/desktop-barra.ts";
import { gravarDecisao, versaoDasDecisoesDaBarra } from "./telas/card-barra.ts";
import { atualizarBorda, ligarBorda, ligarEtiqueta } from "./lib/borda-barra.ts";
import { proximoDoSegmentado } from "./lib/linha-config.ts";
import { conversaAVista, ehChaveDeExperimento, quadroDoEstado } from "./lib/quadro.ts";
import { caixaComFrase, FRASE_DE_PEDIR_APP, fraseDeEditarApp, fraseDeReconectar, idDoApp, type Pagina } from "./lib/paginas.ts";
import { aoGuardarOrdem, definirPaginas, ordemDoAgente, paginasDoAgente, paginasDtoDe } from "./lib/ordem-das-paginas.ts";
import { criarPaginasDoServidor } from "./lib/paginas-do-servidor.ts";
import { criarQuadroNaTela } from "./lib/quadro-na-tela.ts";
import { criarCanvasNaTela } from "./lib/canvas-na-tela.ts";
import { configurarAppCanvas, esquecerErroDoCanvas, guardarAppCanvas } from "./telas/marketplace-canvas.ts";
import { conversaDaTrilha, criarTrilhaDaConversa } from "./lib/trilha-conversa.ts";
import { criarQuadroCompartilhadoNaTela } from "./lib/quadro-compartilhado-na-tela.ts";
import { caminhoDoQuadro, quadroDaUrl, releListaDosCompartilhados } from "./lib/quadro-compartilhado.ts";
import { secaoDosCompartilhados } from "./telas/quadro-compartilhado.ts";
import type { QuadroCompartilhadoDto } from "../src/contracts/quadro-pessoas.ts";
import { PARAMETRO_TAREFA, botDoLink, responsaveisDaTarefa } from "./lib/quadro-dados.ts";
import { anel, confiar as confiarHtml } from "./telas/quadro.ts";
import type { DadosConta } from "./telas/config-conta.ts";
import { estadoMascoteNaConversa, mascoteComAviso, proximaViradaDoMascote } from "./lib/mascote.ts";
import { lembrar } from "./lib/lembrar.ts";
import { atualizarGaveta } from "./lib/gaveta-render.ts";
import { blocosMudariam, esquecerRegiao, regiao, regiaoEmVoltaDe, regiaoMudaria, regiaoPorBlocos } from "./lib/regioes.ts";
import { mudancaSujaAGaveta, reporSeletor, salvarOuRepor } from "./lib/salvar-ou-repor.ts";
import { criarAnunciador, criarRelogioDaFala, escreverEstados, escreverTempos, lerFalasNaTela, TICK_CURTO_MS, type FalaNaTela } from "./lib/fala-viva.ts";
import { criarRascunhos } from "./lib/rascunhos.ts";
import { juntarSugestao, planoNovaRotina } from "./lib/rotina-no-chat.ts";
import { criarRolagem } from "./lib/rolagem-na-tela.ts";
import { rolaAoTopoAoNavegar } from "./lib/rolagem.ts";
import { anunciosDeFim, aoEsconder, aoSumir, SEM_PROGRESSO, teclaNaPilula, type ProgressoNaTela } from "./lib/pilula.ts";
import { criarPilulaNaTela } from "./lib/pilula-na-tela.ts";
import { memoriaNaPilula, pilulaNaConversa, type Pilula } from "./telas/pilula-do-bot.ts";
import { guardarCampo, restaurarCampo } from "./lib/campos-de-decisao.ts";
import { renderNovoBot } from "./telas/novo-bot.ts";
import { renderNovaRotina } from "./telas/nova-rotina.ts";
import { contextoInteligencia, nivelDaGaveta, paiDoNivel } from "./telas/detalhes.ts";
import { avisarNaIdentidade, criarFilaDePerfil, criarSalvarAvatar, ERRO_AO_SALVAR, instalarIdentidade, sobreporPendentes } from "./lib/gaveta-identidade.ts";
import { renderEspaco } from "./telas/espaco.ts";
import { diaDe, inicioDoDia } from "./lib/agenda.ts";
import { agendaPorLer, escNaAgenda } from "./estado/agenda.ts";
import { diaParaFocarNoMes } from "./telas/agenda-rotinas.ts";
import { confirmarCriarBot, criarRapido } from "./telas/confirmar-criar-bot.ts";
import { USOS } from "./telas/este-mac.ts";
import { botsDaPessoa, lerEstaMaquina, maquinaNova, maquinasDeTrabalho, nomeDeInstanciaSugerido, soComputador } from "./telas/maquinas.ts";
import { appEncerraNoFim, ITEM_PONTE_FALHOU, itensDaPonte, itensDoServidor, textoDeRemover, type ItemDoFim } from "./telas/remover-computador.ts";
import { erroDoConectar, erroDoCriar, erroDoExcluir, recusaDoDormir, REGIAO_PADRAO, relerEnquantoCria, ZONA_PADRAO } from "./lib/maquina-nuvem.ts";
import type { DormirAposMin, TamanhoMaquinaNuvem } from "../src/contracts/provedor-nuvem.ts";
import { voltaDaTela } from "./lib/volta.ts";
import { cabecalhoSecao, CHAVE_SECOES_RECOLHIDAS, chaveDaSecao, definirSecaoRecolhida, ESPERA, estadoDaSecao, gruposDaBarra, lerSecoesRecolhidas, type AvisoBot } from "./lib/secoes.ts";
import { faixaDeConectores, faixaDoUso, type AvisoDoUso, type DadosMenuConta } from "./telas/menu-conta.ts";
import { renderConectores } from "./telas/conectores.ts";
import { appsQueFaltam } from "./telas/rotina-precisa.ts";
import { criarConexoes } from "./lib/conexao.ts";
import type { Proposta } from "../src/contracts/conversa.ts";
import { criarProgressoNaTela } from "./telas/progresso-na-fala.ts";
import { blocosAoVivo, blocosDoHistorico, botoesDoCampo, htmlComposer, pararNoCampoDaTela, renderCabecalhoConversa, renderTimeline, rotuloDoParar, tituloDoParar, type BlocoDaTimeline } from "./telas/conversa.ts";
import { criarArtefatosVivos } from "./telas/artefatos-vivos.ts";
import { criarDiagramasVivos } from "./telas/diagramas-vivos.ts";
import { instalarDicaDeLink } from "./lib/dica-link.ts";
import { inventarioEmUso, motorDesatualizado, situacaoMotorFora } from "./telas/frota.ts";
import { ehIa, fraseDoMotivoDaNota, inventarioDaIa, pedeInstalar } from "./telas/ia-fora.ts";
import { renderRotinas } from "./telas/rotinas.ts";
import { nomesDosMembros, renderCabecalhoSala, renderNovaSala } from "./telas/sala.ts";
import { abertasPorAgente, perguntasPorAgente, renderChamada, renderIncidentes, renderSuaVez, rotinasParadasPorAgente, SUBTITULO_ESPERANDO, SUBTITULO_ROTINA_PARADA } from "./telas/sua-vez.ts";
import { aparenciaDoComposer } from "./telas/pergunta.ts";
import { BANDEJA, naoLidaDe, nomeDaConversa, renderNaoLidos, rotuloNaoLidos } from "./telas/nao-lidos.ts";
import { mostrarAvisoDesfazer } from "./lib/aviso-desfazer.ts";
import { acessosNaTela, chaveDoClique } from "./lib/acessos-otimistas.ts";
import { gavetaDeAcessos, loteDeEscritaPedeConfirmacao, ROTULO } from "./telas/acessos-do-app.ts";
import { conectorDoApp, meusBots, nivelReal } from "./telas/app-acesso.ts";
import type { LoteDeAcessosDto } from "./lib/api.ts";
import type { Conector } from "../src/contracts/conector.ts";
import { ACTS_COBERTOS, htmlMenuSegurado, tarefaDaFala, type ExtraDaBarra } from "./lib/menu-segurado-da-fala.ts";
import { tentarNoApp } from "./lib/recusa-de-app.ts";
import { criarRecolherAdiado } from "./lib/recolher-adiado.ts";
import { atalhoDoCabecalho, avisoDoNome, cabecalhoDoTime, campoDoNome, chaveDoTime, comCabecalho, destinoAoMover, ehCliqueDuplo, fraseDoExcluido, fraseDoMovido, itensDoMenuDoTime, juntarNomes, nomeDoTime, nomeLimpo, NOTA_SEM_TIME, ordemAoSoltarTime, recolhidosParaMigrar, selecionar, textoDaSelecao, textoDoVazio, timesComBots, type AcaoDoTime, type TimeDaBarra } from "./lib/times-da-barra.ts";
import type { TimeNaLista } from "../src/contracts/time.ts";
import { instalarDeslizeLida } from "./lib/deslize-lida-dom.ts";
import { teclaNaoLidos } from "./lib/teclado-nao-lidos.ts";
import { fraseDaContagemNoAviso, fraseDoAviso } from "./lib/frase-leitura.ts";
import { frotaAoSoltar, ordemAoSoltar, velocidadeAutoRolagem, type Destino } from "./lib/arrastar.ts";
import { rolagemDaBarra, type Faixa } from "./lib/rolagem-barra.ts";
import { comandoNoTexto, recentesDaConversa } from "./lib/barra.ts";
import { ajustarAltura, arquivosDaColagem, criarBarra, escolherMencao, htmlSugestoes, sugestoesDaMencao, teclaDoCampo, type ContextoDaBarra } from "./lib/composer.ts";
import type { ComandosDto } from "../src/contracts/comandos.ts";
import { destinoDoEnvio, enviarPeloComposer, idsDaResposta, modoDoComposer, opcoesDaPergunta, proximaDoComposer, textoDaLetra } from "./lib/perguntas.ts";
import { acharBotao, aplicarFocoDaFila, botaoEmFoco, proximoDaFila, VALIDADE_DO_FOCO_MS, type FocoDaFila } from "./lib/foco-da-fila.ts";
import { aplicarEncolhidos, decididaNaConversa, type DecididaNestaAba } from "./lib/foco-do-encolhido.ts";
import { seletorDoFocoNaRegiao } from "./lib/foco-do-bloco.ts";
import { itensDaRecusa } from "./lib/recusa-da-aprovacao.ts";
import { criarEnvios, enviarUmaVez } from "./lib/envio-idempotente.ts";
import { iniciarMotorLigacao } from "./lib/ligacao.ts";
import { ICONE_LIGACAO, VELOCIDADES, VERSAO_CONSENTIMENTO, VOZES } from "./telas/ligacao.ts";
import { criarTelaLigacao } from "./telas/ligacao-controle.ts";
import { pedirConsentimentoVoz } from "./telas/consentimento-voz.ts";
import { anuncioDaLeitura, criarTocadorDeLeitura, TEXTO_FALHA_LEITURA, type LeituraAtual, type MotivoParada } from "./lib/ouvir.ts";
import { criarControleDitado } from "./telas/ditado-controle.ts";
import { ditadoNaPilula, juntarAoCampo, textoDaFalha } from "./telas/ditado.ts";
import { nomeDoEmail } from "./telas/conversa-texto.ts";
import { criarTelaOnboarding, guardarFocoDaCamada } from "./telas/onboarding-controle.ts";
import { movimentoReduzido } from "./lib/movimento.ts";
import { alvoDoQueEspera, levarAoAlvo, passoDoAtalho, type AlvoDoAtalho } from "./lib/levar-ao-alvo.ts";
import { criarBuscaCelular, limparEntradaDaBusca } from "./telas/busca-celular.ts";
import { alvoDepoisDeFalar, alvoNoFimDaConversa, apagarTodosOsRecentes, appInerte, buscarSemOcupado, chaveDosRecentes, dataCurta } from "./lib/busca-celular.ts";
import type { MensagemAchada } from "../src/contracts/busca.ts";
import { gavetaPrendeFoco, irmaosAteARaiz, seletoresDaOrigem, voltaDoTab } from "./lib/foco-gaveta.ts";
import type { Ligacao } from "../src/contracts/ligacao.ts";
import type { MotivoAvaliacaoLigacao } from "./lib/api.ts";
import { aceitaDoBot } from "./lib/capacidades.ts";
import { mimeDe, motivoRecusa, POR_MENSAGEM, renderItens as renderItensAnexo, resumo as resumoAnexos, retirarDaFila, contarNaFila, prontosDaFila, soltarEhDoChat, seletorDoClipe, type Aceita, type ItemAnexo } from "./lib/anexos.ts";
import type { EstadoTrabalho, TipoLinha } from "../src/contracts/trabalho.ts";
import { aberto, abertosDoBot, leituraDoMac, listaPararTasks, telaAoFechar, telaDaTask, textoPararTasks, trabalhoPorId, trabalhosConhecidos } from "./lib/trabalhos.ts";
import type { EventoTrilhaQuadro } from "../src/contracts/trilha-quadro.ts";
import { criarTelemetria } from "./lib/telemetria-linhas.ts";
import { chaveDaAtividade, criarVigiaDaAtividade, diaLocal, ehFiltroAtividade, fusoLocal, rotuloDoDia } from "./lib/atividade-do-bot.ts";
import { anuncioDoFiltro, chaveDasDecisoes, diaDoDeslize, ehFiltroDecisoes, ehPeriodoDoCsv, periodoDoCsv, totalDoFiltro, type ExportarCsv } from "./lib/decisoes-do-bot.ts";
import { anuncioDosSubagentes, blocosAoVivoDaTask, blocosDoHistoricoDaTask, htmlAcoesDaTask, renderIconeTrabalhos, renderTelaLinha, renderTodosOsTrabalhos, renderTopoTrabalho } from "./telas/trabalhos.ts";
import { renderTrabalhosPorBot, sinalDoBot } from "./telas/linha-do-dono.ts";
import { temDonos } from "./lib/dono.ts";
import { executarRotinaComConfirmacao } from "./lib/executar-rotina.ts";
import { copiarPorSelecao, type DocParaCopiar } from "./lib/copiar-por-selecao.ts";
import { criarBuscaNaConversa } from "./telas/busca-na-conversa.ts";
import { ligarTopoEncolhe, ROLAVEIS_DO_TOPO } from "./lib/topo-encolhe.ts";
import { abaDoDestino, alvoDoFocoNaTabBar, contagemDaAbaSuaVez, criarHistoricoDaFolha, ficaAoEscolherRecente, destinoDaAbaQuadros, ehAba, itensDaAbaSuaVez, lerListaDaAbaQuadros, recentes, type AbaDoInicio, type QuadroDaLista } from "./lib/tab-bar-celular.ts";
import { renderAbaQuadros, renderAbaSuaVez, renderFolhaRecentes, renderTabBar, renderTituloCompacto, renderTituloGrande } from "./telas/tab-bar-celular.ts";
import { ligarTecladoVisivel } from "./lib/teclado-visivel.ts";
import type { ItemDoMenuDaPilula } from "./lib/gesto-da-pilula.ts";
import { DICA_MS, MARCA_CUTUCAO, MARCA_DICA, deveCutucar, criarFiltroDeEco, deveMostrarDica, escFechaABusca, gravarMarca, lerMarca, type Marcas, type ViaDaBusca } from "./lib/descoberta-da-busca.ts";
// NOD-117: as teclas dos atalhos mudam com o lugar (app do Mac, navegador no Mac, Windows/Linux): web/lib/atalhos.ts.
const LUGAR_TECLADO = lugarAtual();
const ATALHO_NOVO_BOT = atalhoDoNovoBot(LUGAR_TECLADO);

/**
 * main.ts: sessão → hidratar → SSE (ADR-016) → laço "dispatch → reidratar o que o reducer invalidou →
 * render por regiões". A web DECIDE e pede por REST; nunca executa (ADR-020). Nenhuma decisão do produto
 * exige o app aberto: sem executor a tela continua respondendo (web-sem-app).
 */
let estado: Estado = estadoInicial;
/** Janela do Desfazer ao cancelar uma mensagem da fila. */
const CANCELAR_DESFAZER_MS = 5_000;
let api: Api | null = null;
let live: LiveEvents | null = null;
let composerDe: string | null = null;
/** O pedido de foco depois de responder em "Sua vez" (web/lib/foco-da-fila.ts); null sem pedido. */
let focoDaFila: FocoDaFila | null = null;
/** Chat limpo (PR 4): os pedidos decididos por um clique nesta conversa, à espera do cartão encolhido (foco e anúncio). */
let encolhidosPendentes: DecididaNestaAba[] = [];

/** Guarda o pedido decidido pelo clique na conversa; o de "Sua vez" e o de outra tela não contam (web/lib/foco-do-encolhido.ts). */
function marcarDecidida(el: HTMLElement, id: string | undefined): void {
  const d = decididaNaConversa(el, id, Date.now());
  if (d) encolhidosPendentes = [...encolhidosPendentes.filter((x) => x.id !== d.id), d];
}
/**
 * O que estava digitado em cada conversa (definido em 2026-09-30): trocar de conversa recriava o campo vazio e a pessoa
 * perdia o texto. Agora ele fica com a conversa de onde ela saiu e volta quando ela volta — também depois de recarregar.
 */
// NOD-156: a chave de idempotência da fala nasce aqui, uma por fala, e sobrevive ao reenvio depois de uma falha.
const envios = criarEnvios();
const rascunhos = criarRascunhos(() => { try { return localStorage; } catch { return null; } });
/**
 * O progresso na fala que a timeline mostra agora (chat limpo, PR 8): medido pela rolagem; a pílula do bot some com ele à
 * vista (web/lib/pilula.ts).
 */
let progressoDaFala: ProgressoNaTela = SEM_PROGRESSO;
// ADA-2 (ADR-148): rolado, o topo da conversa, do quadro e da tarefa vira vidro (só pinta no celular: web/celular-base.css).
const topoEncolhe = ligarTopoEncolhe(() => document.getElementById("cabecalho"),
  ROLAVEIS_DO_TOPO.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => e !== null));
// ADA-17 (ADR-148): quanto o teclado cobre, em --teclado; a folha da tarefa no celular fica acima dele.
ligarTecladoVisivel(window);
/** A conversa acompanha o fim e a pílula da base sobe às não lidas (definido em 2026-10-05, web/lib/rolagem-na-tela.ts). */
const rolagem = criarRolagem(document.getElementById("timeline") as HTMLElement, document.getElementById("pilula-novas") as HTMLElement, () => !movimentoReduzido(), (p) => {
  progressoDaFala = p;
  desenharPilula();
});
/** A pílula do bot acima do campo (chat limpo, PR 8; web/telas/pilula-do-bot.ts): no lugar da linha do dono. */
const pilula = criarPilulaNaTela(document.getElementById("faixa-trabalhos") as HTMLElement, document.querySelector(".stage") as HTMLElement, {
  reduzido: movimentoReduzido,
  agendar: (fn, ms) => window.setTimeout(fn, ms),
  cancelar: (id) => window.clearTimeout(id),
});
/** A pílula desenhada por último (o clique conta na telemetria com a chave dela e o "Parar" para as frentes dela). */
let pilulaAtual: { pilula: Pilula; telemetria: string | null } | null = null;
/** O estado de cada frente do bot na última olhada (a região viva diz quando uma termina); null = conversa nova. */
let frentesVistas: { conversaId: string; estados: Map<string, EstadoTrabalho> } | null = null;
let reidratando = false;
let ambienteBanco: AmbienteBancoDto | null = null;
/**
 * Telemetria das linhas do chat (definido em 2026-10-07, #191): cada linha mostrada conta uma vez por carga da página e
 * cada clique conta; o lote vai para `POST telemetria/linhas` e a falha some (web/lib/telemetria-linhas.ts).
 */
const telemetria = criarTelemetria((eventos) => api?.telemetriaLinhas(eventos) ?? Promise.resolve(), (fn, ms) => window.setTimeout(fn, ms));
window.addEventListener("pagehide", () => telemetria.descarregar());
// ADR-114 (chat limpo, PR 2): o gatilho da Atividade — cada abertura da conversa própria e a Atividade aberta até 60 s depois.
const vigiaAtividade = criarVigiaDaAtividade(telemetria);
const tipoLinha = (v: string | undefined): TipoLinha | null => (v === "rotina" || v === "bots" || v === "task" || v === "troca" || v === "frentes" || v === "revisor" ? v : null);

/** As linhas que o histórico desenhou entram na telemetria (cada chave uma vez por carga). */
function contarLinhasMostradas(): void {
  for (const el of document.querySelectorAll<HTMLElement>("#timeline [data-linha-chave]")) {
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.mostrada({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
  }
}

/**
 * A tela da task sobrevive a recarregar a página (definido em 2026-10-07, #195): o id e a tela de volta ficam na
 * sessionStorage desta aba e, na próxima sessão, a task abre de novo. As outras telas abrem como sempre.
 */
const CHAVE_TASK_ABERTA = "nod.taskAberta";
function lembrarTaskAberta(tela: Tela): void {
  try {
    if (tela.tipo === "trabalho") window.sessionStorage.setItem(CHAVE_TASK_ABERTA, JSON.stringify({ id: tela.id, voltar: tela.voltar.tipo === "conversa" || tela.voltar.tipo === "trabalhos" ? tela.voltar : { tipo: "inicio" } }));
    else window.sessionStorage.removeItem(CHAVE_TASK_ABERTA);
  } catch { /* sem storage, a task não volta sozinha */ }
}
function taskLembrada(): Extract<Tela, { tipo: "trabalho" }> | null {
  try {
    const v = JSON.parse(window.sessionStorage.getItem(CHAVE_TASK_ABERTA) ?? "null") as { id?: unknown; voltar?: { tipo?: unknown; conversaId?: unknown; agenteId?: unknown } } | null;
    if (!v || typeof v.id !== "string") return null;
    const w = v.voltar;
    const voltar: Tela = w?.tipo === "conversa" && typeof w.conversaId === "string" && typeof w.agenteId === "string" ? { tipo: "conversa", conversaId: w.conversaId, agenteId: w.agenteId } : w?.tipo === "trabalhos" ? { tipo: "trabalhos" } : { tipo: "inicio" };
    return { tipo: "trabalho", id: v.id, voltar };
  } catch {
    return null;
  }
}
/** Tela de entrada (ADR-030): o modo vem do servidor; `recusado` vem do redirect do callback do Google. */
let entrada: {
  modo: ModoSessaoDto | null;
  recusado: boolean;
  /** NOD-345: entrar com e-mail (ou pedir o link) sem sessão; os valores digitados ficam só no DOM. */
  conta?: { etapa: "entrar" | "recuperar"; erro: string | null; enviadoPara: string | null; ocupado: boolean };
  /** NOD-345: a página do link de recuperação (`#redefinir=<token>`); o token sai da URL na hora. */
  redefinir?: { token: string; erro: string | null; vencido: boolean; ocupado: boolean } | null;
} = { modo: null, recusado: false };

// definido em 2026-09-24 (revisão da interface): a tela principal é o chat; quem esconde o painel do
// bot espera achá-lo escondido na próxima conversa e no próximo carregamento.
// definido em 2026-10-05 ("direto eu me vejo fechando a gaveta"): a gaveta nasce FECHADA e só fica aberta quando a
// pessoa a abre pelo ícone do painel. Antes, sem nada guardado, ela nascia aberta (o app do Mac apaga o localStorage
// a cada conexão), e abrir um nível pelo menu ou pela barra gravava "aberta" para sempre. Agora abrir um nível mostra
// a gaveta só até a pessoa trocar de conversa. A chave mudou de nome para que ninguém herde o "aberta" antigo.
const CHAVE_PAINEL_ABERTO = "nod.painelAberto";
let painelAberto = ((): boolean => { try { return localStorage.getItem(CHAVE_PAINEL_ABERTO) === "1"; } catch { return false; } })();
/** Aberta para mostrar um nível (abrirNivel), sem virar preferência: fecha de novo ao trocar de conversa. */
let painelAbertoNaHora = false;
// ADR-094 (definido em 2026-10-10): no celular a barra de bots vira gaveta, aberta pelo ☰ do cabeçalho.
// NOD-379 (emenda da ADR-094): a gaveta virou a tela inicial do celular; o ☰ virou o ‹ que volta a ela.
// A pílula da conversa diz se a gaveta do bot está aberta; mostrar a inicial fecha a gaveta (gaveta-bots.ts).
// Revisão 3 do PR #630: a inicial à vista (o ‹ ou o voltar do sistema) fecha o perfil do bot também no estado; sem isto,
// o perfil guardado voltava "encobrindo" a conversa do mesmo bot e a trilha não contava mais a abertura dela.
const celular = criarCelular(() => {
  if (celular.botsAbertos() && estado.perfilCelular) dispatch({ tipo: "perfil-celular", perfil: null });
  else render();
  marcarPainelNaPilula();
});
// A busca do celular aberta a partir da inicial: a conversa escolhida nela é uma escolha nova (NOD-422).
let buscaDaInicial = false;
// NOD-119: a densidade e a largura da barra (web/lib/densidade.ts). O index.html já pintou antes do primeiro quadro;
// mudarBarra é o caminho único da escolha em Configurações, da borda e do card do chat.
let barraAtual: Barra = lerBarra();
// A conversa depende da barra só pelo card do chat: ela lê `barraNaConversa`, que acompanha a barra quando o arrasto para.
let barraNaConversa = serializar(barraAtual);
const acompanharNaConversa = adiar<null>(250, () => { barraNaConversa = serializar(barraAtual); render(); });
const gravarNoMac = adiar<BarraDesktop | null>(250, (v) => { void window.nodDesktop?.definirBarra?.(v).catch(() => undefined); });
function mudarBarra(nova: Barra, naHora = false): void {
  const gravarFora = naHora ? gravarNoMac.agora : gravarNoMac;
  barraAtual = aplicarBarra(nova, document.documentElement, celular.ativo(), undefined, gravarFora);
  acompanharNaConversa(null);
  const borda = document.getElementById("borda-barra");
  if (borda) atualizarBorda(borda, barraAtual);
  etiquetaDaBarra?.esconder();
  render();
}
// A etiqueta só vale com a barra desenhada recolhida (com a busca por cima, a barra está aberta).
const recolhida = () => document.documentElement.dataset.largura === "recolhida";
let etiquetaDaBarra: { esconder(): void } | null = null;
{
  const borda = document.getElementById("borda-barra");
  const sidebar = document.getElementById("sidebar");
  const etiqueta = document.getElementById("etiqueta-barra");
  if (borda) ligarBorda(borda, { obter: () => barraAtual, mudar: mudarBarra });
  if (sidebar && etiqueta) etiquetaDaBarra = ligarEtiqueta(sidebar, etiqueta, recolhida);
}
// NOD-379: a barra que ficou sem redesenhar enquanto a busca do celular tinha o foco. Ela é refeita um pouco depois do
// focusout, para não trocar o DOM entre o toque e o clique na linha que a pessoa foi abrir.
let sidebarAdiada = false;
function redesenharAdiada(): void {
  if (!sidebarAdiada) return;
  window.setTimeout(() => { if (sidebarAdiada) { sidebarAdiada = false; if (!arrastandoBot) redesenharSidebar(); } }, MS_REDESENHO_ADIADO);
}
// definido em 2026-10-28 (NOD-379): mais que um toque comum (~150 ms entre o focusout e o click).
const MS_REDESENHO_ADIADO = 500;
// NOD-379: o último toque longo (o contextmenu do Android que vem junto é ignorado) e o timer da dica dele.
let ultimoToqueLongo = 0;
// definido em 2026-10-28 (NOD-379): o contextmenu do Android chega junto do gesto, bem antes de 1 s.
const MS_CONTEXTMENU_DO_GESTO = 1000;
let timerDica = 0;
/** NOD-379: a última leitura da frota falhou — a inicial do celular diz "Não deu para carregar seus bots · Tentar de novo". */
let frotaFalhou = false;
/** NOD-379: o onboarding já estava aberto na última ação (abrir agora esconde a inicial uma vez, para o guia ficar à vista). */
let onboardingVisto = false;
/** NOD-379: o + do topo da inicial (24 px, como os outros ícones do topo no protótipo v3). */
const MAIS = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
/** NOD-379: "Ver todos" abriu os favoritos além dos 8 primeiros (vale até recarregar). */
let favoritosTodos = false;

/** NOD-379: os favoritos da inicial do celular — o rótulo, "Ver todos" acima de 8 e a grade de 4. */
function gradeDoCelular(blocos: string, total: number): string {
  if (!total) return "";
  const ver = total > FAVORITOS_VISIVEIS ? `<button type="button" class="inicio-ver" data-act="ver-favoritos" aria-expanded="${favoritosTodos}">${favoritosTodos ? "Ver menos" : "Ver todos"}</button>` : "";
  return `<div class="inicio-favoritos"><div class="inicio-rotulo"><h2>Favoritos</h2>${ver}</div><section class="fixados" aria-label="Favoritos">${blocos}</section></div>`;
}

/** NOD-379: a inicial carregando — 4 favoritos e 6 linhas em esqueleto, sem texto (o leitor de tela ouve "Carregando"). */
const ESQUELETO_DO_INICIO = `<div class="inicio-esqueleto" role="status"><span class="sr-only">Carregando seus bots</span><div class="esq-grade">${'<span class="esq redondo"></span>'.repeat(4)}</div>${'<div class="esq-linha"><span class="esq redondo"></span><span class="esq-txt"><span class="esq"></span><span class="esq"></span></span></div>'.repeat(6)}</div>`;

/** NOD-379: sem nenhum bot — o mascote, uma frase e o botão de contorno; a barra de Buscar continua. */
const INICIO_VAZIO = `<div class="inicio-vazio">${iconeAgente({ nome: "Nod", cor: "c-black", forma: "shape-pebble" }, "lg")}<h2>Crie seu primeiro bot</h2><p>Diga o que ele faz e ele começa a trabalhar.</p><button type="button" class="bt inicio-contorno" data-act="navegar" data-tela="novo-bot">Criar bot</button></div>`;

// ADA-19 (F4 do celular, protótipo ada-2 v2): a inicial do celular tem três abas — Conversas, Quadros e Sua vez — na
// tab bar de vidro. A aba vive aqui (fora do reducer, como a busca): no computador nada disso existe.
let abaDoInicio: AbaDoInicio = "conversas";
/** A leitura de Sua vez falhou (a aba mostra "Não deu para atualizar" + Tentar de novo). */
let suaVezFalhou = false;
/** A lista da aba Quadros (`GET /quadros`), lida ao abrir a aba, com cache curto. */
let quadrosDaAba: { tipo: "carregando" } | { tipo: "erro" } | { tipo: "pronto"; quadros: QuadroDaLista[]; em: number } = { tipo: "carregando" };
let lendoQuadros = 0;
/** Cache da aba Quadros: abrir de novo em menos que isso não relê. */
const CACHE_QUADROS_MS = 30_000;
async function lerQuadrosDaAba(forcar = false): Promise<void> {
  if (!api || !estado.sessao) return;
  if (!forcar && quadrosDaAba.tipo === "pronto" && Date.now() - quadrosDaAba.em < CACHE_QUADROS_MS) return;
  const n = ++lendoQuadros;
  if (quadrosDaAba.tipo !== "pronto") quadrosDaAba = { tipo: "carregando" };
  try {
    const cliente = api;
    const quadros = await lerListaDaAbaQuadros(estado.experimentos.quadro, () => cliente.quadros());
    if (n !== lendoQuadros) return;
    quadrosDaAba = { tipo: "pronto", quadros, em: Date.now() };
  } catch {
    if (n !== lendoQuadros) return;
    quadrosDaAba = { tipo: "erro" };
  }
  render();
}
/** Troca a aba da inicial do celular; tocar na aba que já está ativa rola a lista ao topo. */
function trocarAbaDoInicio(aba: AbaDoInicio): void {
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  if (aba === abaDoInicio) { lista?.scrollTo({ top: 0, behavior: movimentoReduzido() ? "auto" : "smooth" }); return; }
  abaDoInicio = aba;
  if (aba === "quadros") void lerQuadrosDaAba();
  if (aba === "sua-vez" && !estado.suaVez) dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  render();
  document.querySelector<HTMLElement>("#sidebar .list")?.scrollTo({ top: 0 });
  topoDoInicio?.reavaliar();
}
/** A folha de recentes (segurar o ‹): fica fora do render(), presa no <body>; o foco fica nela e volta ao ‹ ao fechar. */
let folhaRecentes: { camada: HTMLElement; volta: HTMLElement | null } | null = null;
// Revisão do #704: a folha empilha uma entrada no histórico; o voltar do sistema com ela aberta só a fecha.
const historicoDaFolha = criarHistoricoDaFolha(window.history);
function abrirRecentes(volta: HTMLElement | null): void {
  if (folhaRecentes || historicoDaFolha.ocupado() || !celular.ativo()) return;
  const t = estado.tela;
  const agora = Date.now();
  const linhas = recentes(estado.frota?.agentes ?? [], t.tipo === "conversa" ? t.conversaId : null).map((l) => {
    const bot = botGerido(l.agenteId);
    return { ...l, mascote: bot ? iconeAgente(bot, "sm") : iconeAgente({ nome: l.nome, cor: "c-black", forma: "shape-pebble" }, "sm"), hora: horaDaLinha(l.em, agora, fusoLocal()), horaIso: new Date(l.em).toISOString() };
  });
  const camada = document.createElement("div");
  camada.className = "recentes-camada";
  camada.innerHTML = renderFolhaRecentes(linhas);
  document.body.append(camada);
  folhaRecentes = { camada, volta };
  historicoDaFolha.abrir();
  pintarInerciaDoApp();
  camada.querySelector<HTMLElement>(".folha-recentes")?.focus({ preventScroll: true });
}
function fecharRecentes(devolverFoco = true): void {
  if (!folhaRecentes) return;
  const { camada, volta } = folhaRecentes;
  folhaRecentes = null;
  camada.remove();
  // Solta a .app antes de devolver o foco: num elemento inerte o focus() não pega.
  pintarInerciaDoApp();
  if (devolverFoco) (volta?.isConnected ? volta : document.querySelector<HTMLElement>("#cabecalho .voltar-bots"))?.focus({ preventScroll: true });
}
/** Fecha por dentro (Esc, fundo, escolher): some na hora e tira a entrada do histórico; `depois` roda quando ela sair. */
function sairDasRecentes(devolverFoco = true, depois?: () => void): void {
  if (!folhaRecentes) return;
  fecharRecentes(devolverFoco);
  historicoDaFolha.sair(depois);
}
// Esc fecha a folha antes de qualquer outro Esc (na janela, em captura: antes dos ouvintes do document); o Tab fica
// preso nela (role=dialog, aria-modal).
window.addEventListener("keydown", (ev) => {
  if (!folhaRecentes) return;
  if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); sairDasRecentes(); return; }
  if (ev.key !== "Tab") return;
  const folha = folhaRecentes.camada.querySelector<HTMLElement>(".folha-recentes");
  const focaveis = [...folhaRecentes.camada.querySelectorAll<HTMLElement>("button")];
  if (!folha || !focaveis.length) { ev.preventDefault(); folha?.focus(); return; }
  const primeiro = focaveis[0]!, ultimo = focaveis[focaveis.length - 1]!;
  const ativo = document.activeElement;
  if (ev.shiftKey && (ativo === primeiro || ativo === folha)) { ev.preventDefault(); ultimo.focus(); }
  else if (!ev.shiftKey && (ativo === ultimo || !folhaRecentes.camada.contains(ativo))) { ev.preventDefault(); primeiro.focus(); }
}, true);
// O voltar do navegador com a folha aberta só a fecha (a entrada era dela; a gaveta não sai da conversa). O voltar que a
// própria folha pediu é engolido e só então abre a conversa escolhida. Em captura: antes da gaveta e da busca.
window.addEventListener("popstate", (ev) => {
  const r = historicoDaFolha.aoVoltar();
  if (r.tipo === "seguir") return;
  ev.stopImmediatePropagation();
  if (r.tipo === "fechar") fecharRecentes();
  else r.depois?.();
}, true);

/** O título grande encolhe quando a lista da aba rola: a lista é refeita a cada redesenho, então a escuta é religada. */
let topoDoInicio: ReturnType<typeof ligarTopoEncolhe> | null = null;
let listaDoTopoDoInicio: HTMLElement | null = null;
function religarTopoDoInicio(): void {
  const lista = celular.ativo() ? document.querySelector<HTMLElement>("#sidebar .list") : null;
  if (lista !== listaDoTopoDoInicio) {
    topoDoInicio?.desligar();
    topoDoInicio = lista ? ligarTopoEncolhe(() => document.querySelector<HTMLElement>("#sidebar .inicio-topo"), [lista]) : null;
    listaDoTopoDoInicio = lista;
  }
  topoDoInicio?.reavaliar();
}

// A busca da sidebar fica fechada até ser pedida (ícone ou ⌘K); aberta, fecha no Esc ou ao perder o foco vazia.
let buscaAberta = false;
const termoBusca = (): string => (document.getElementById("busca-bots") as HTMLInputElement | null)?.value ?? "";
function abrirBusca(): void {
  // NOD-380: no celular a busca é a tela cheia (bots, salas e mensagens); no computador continua o filtro da barra.
  if (celular.ativo()) {
    buscaDaInicial = celular.botsAbertos();
    celular.fecharBots();
    buscaCelular.abrir();
    return;
  }
  celular.abrirBots();
  buscaAberta = true;
  render();
  document.getElementById("busca-bots")?.focus();
}
function fecharBusca(): void {
  const campo = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (campo) campo.value = "";
  buscaAberta = false;
  filtrarBots("");
  render();
}
/** definido em 2026-10-07 (ADR-081): o logo do nod (os olhos num quadrado) — o Nod discreto, na barra de cima. */
const LOGO_NOD = '<svg class="logo-nod" width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><rect class="logo-fundo" width="32" height="32" rx="7.5"/><g class="logo-olhos" transform="rotate(14 16 16)"><rect x="8.6" y="8.5" width="5.6" height="15" rx="2.8"/><rect x="17.8" y="8.5" width="5.6" height="15" rx="2.8"/></g></svg>';
const LUPA = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg>';
const LOJA = '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5 4.5 3h11L17 7.5"/><path d="M3 7.5a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0"/><path d="M4.2 10v7h11.6v-7"/><path d="M8 17v-4h4v4"/></svg>';

// definido em 2026-10-04: as seções recolhidas da barra (web/lib/secoes.ts); um conjunto novo a cada troca.
let secoesRecolhidas: ReadonlySet<string> = lerSecoesRecolhidas();
// NOD-437: o time em edição na barra ("novo" ou o id do time), a multisseleção de bots e se os recolhidos de antes
// (localStorage) já foram levados para a conta.
let edicaoTime: { alvo: string; valor: string } | null = null;
let selecaoBots: ReadonlySet<string> = new Set();
let ancoraSelecao: string | null = null;
let migrouRecolhidos = false;

function painelOculto(): boolean {
  return !painelAberto && !painelAbertoNaHora;
}

/** O painel do bot está à vista? Estreita, ele é sobreposto (`detalhes-abertos`); larga, é a preferência guardada. */
function painelVisivel(): boolean {
  if (window.matchMedia("(max-width: 1099px)").matches) return document.querySelector(".app")?.classList.contains("detalhes-abertos") ?? false;
  return !painelOculto();
}

/** NOD-429: o par Conversa | Quadro aparece na conversa com um bot da pessoa, com o experimento Quadro ligado. */
/**
 * NOD-430: os bots cujo quadro foi excluído nesta sessão (o frame quadro.mudou com `removido`). Continuam na barra, e a linha
 * diz "Sem quadro" no lugar da prévia até a próxima mensagem dele (a conversa e a memória ficam).
 */
const semQuadroAgora = new Map<string, number | null>();

function previaDoBot(a: { id: string; ultimaMensagem?: { em?: number; previa?: string } | null; descricaoEstado?: string | null }): string {
  if (semQuadroAgora.has(a.id) && semQuadroAgora.get(a.id) === (a.ultimaMensagem?.em ?? null)) return "Sem quadro";
  return a.ultimaMensagem?.previa || a.descricaoEstado || "acabamos de nos conhecer";
}

function comQuadro(agenteId: string): boolean {
  return quadroDoEstado(estado, botGerido(agenteId)?.ownerId);
}

/**
 * NOD-445 (ADR-146): as páginas da pílula vêm do servidor (`GET /agentes/:id/paginas`), com a ordem que vale em todos
 * os aparelhos. Lidas ao abrir a conversa e de novo a cada `paginas.mudaram` (um app chegou, saiu, mudou o retrato ou a
 * ordem) e `quadro.mudou` (Tarefas liga sozinho com a primeira tarefa). Sem resposta ainda, só a conversa.
 */
const tarefasQuePedem = new Set<string>();
const paginasDaPilula = (agenteId: string): Pagina[] => paginasDoAgente(agenteId, { tarefasPedem: tarefasQuePedem.has(agenteId) });
// A conversa com o servidor (leituras, PUT da ordem e as respostas fora de ordem) mora em web/lib/paginas-do-servidor.ts.
const paginasDoServidor = criarPaginasDoServidor({
  ler: (agenteId) => (api ? api.paginas(agenteId) : Promise.reject(new Error("sem api"))),
  ordenar: (agenteId, ids) => (api ? api.ordenarPaginas(agenteId, ids) : Promise.reject(new Error("sem api"))),
  aoLer: (_agenteId, chegaram) => {
    render();
    for (const id of chegaram) quadroNaTela.marcarChegada(idDoApp(id));
  },
  aoGuardar: () => render(),
  // Revisão 6 do #626: o PUT da ordem nunca recusa por limite, nome ou Conversa (ordenarPaginas só falha com entrada
  // inválida, página que não existe ou o experimento desligado): a falha vai para o aviso de erro de sempre.
  aoFalharOrdem: (_agenteId, e) => mostrarErro(e),
});
function lerPaginas(agenteId: string, forcar = false): void {
  if (api) paginasDoServidor.ler(agenteId, forcar);
}
aoGuardarOrdem((agenteId, ids) => {
  if (api) void paginasDoServidor.guardar(agenteId, ids);
});

/**
 * A frase começada na caixa da conversa (padrão da NOD-444): nada é enviado. O rascunho que a pessoa escreveu fica (a
 * frase vai depois dele); uma frase pré-preenchida antes é trocada pela nova (caixaComFrase).
 */
function fraseNaConversa(frase: string): void {
  quadroNaTela.trocar("conversa");
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!ta) return;
  frasePedeAssuntoNovo();
  escreverNaCaixa(ta, caixaComFrase(ta.value, frase));
}

/** Remover pelo menu do ícone: sai na hora, com um Desfazer sutil (restaurar devolve no mesmo lugar). O dado fica. */
function removerAppDaPilula(p: Pagina): void {
  const t = telaDeOrigem();
  if (!api || !p.app || t.tipo !== "conversa") return;
  const agenteId = t.agenteId;
  const appId = p.app.id;
  // QA do #626: a recusa de uma regra (o limite no Desfazer, o nome já em uso, a Conversa) diz a frase dela num aviso
  // neutro (web/lib/recusa-de-app.ts), não o vermelho genérico do estado_invalido.
  const avisar = (texto: string) => void mostrarAvisoDesfazer({ texto });
  void agir(() => tentarNoApp(async () => {
    const r = await api!.removerApp(agenteId, appId);
    definirPaginas(r.paginas);
    render();
    mostrarAvisoDesfazer({ texto: `${p.nome} saiu da pílula`, aoDesfazer: () => agir(() => tentarNoApp(async () => { const v = await api!.restaurarApp(agenteId, appId); definirPaginas(v.paginas); render(); }, avisar)) });
  }, avisar));
}

/**
 * A pílula do cabeçalho diz se o painel está aberto. O HTML dela não depende do painel (revisão do PR 1, 2026-10-16): o
 * atributo é posto aqui depois de cada desenho do cabeçalho, a cada clique que muda as classes sem redesenhar e quando a
 * janela cruza a largura em que o painel passa de lado a sobreposto.
 */
function marcarPainelNaPilula(): void {
  const aberto = painelVisivel();
  document.querySelector<HTMLElement>("#cabecalho .pilula-bot")?.setAttribute("aria-expanded", String(aberto));
}
window.matchMedia("(max-width: 1099px)").addEventListener("change", marcarPainelNaPilula);

// NOD-429: Conversa | Quadro na pílula, só com o experimento Quadro ligado (Configurações › Geral › Avançado) e no bot da própria pessoa (web/lib/quadro.ts).
// NOD-429: de volta à Conversa, a conversa passa a estar "na tela" de novo e é lida.
// ADA-13 (ADR-150): a página Canvas do bot (a pílula a mostra quando o bot tem acesso ao app).
const canvasNaTela = criarCanvasNaTela(document, { api: () => api });
configurarAppCanvas({ ler: () => (api ? api.appCanvas() : null), aoMudar: () => render() });
const quadroNaTela = criarQuadroNaTela(document, {
  // ADA-8: a pílula tem um dono só para o dedo (web/lib/gesto-da-pilula-na-tela.ts); a busca e o menu entram por aqui.
  busca: {
    ativa: () => celular.ativo() && chaveDaTelaDeBusca() !== null,
    aberta: () => buscaNaConversa.aberta(),
    pode: () => podeBuscarNaConversa(),
    abrir: () => abrirBuscaNaConversa(),
    fechar: () => buscaNaConversa.fechar(false),
  },
  menuDaPilula: (ancora, itens, irPara) => abrirMenuDaPilula(ancora, itens, irPara),
  aoTrocar: (m) => {
    // Revisão 3 do PR #630: voltar do Quadro à Conversa é escolher a conversa, também a que o app abriu sozinho.
    if (m === "conversa") { if (estado.tela.tipo === "conversa") conversaEscolhida = estado.tela.conversaId; lerConversaDaTela(); render(); } else trilhaDaConversa.observar();
  },
  // A pessoa arrastou um ícone da pílula: a doca é redesenhada na ordem nova.
  aoMudarOrdem: () => render(),
  aoTarefasPedirem: (pedem) => {
    const t = telaDeOrigem();
    if (t.tipo !== "conversa") return;
    if (pedem) tarefasQuePedem.add(t.agenteId); else tarefasQuePedem.delete(t.agenteId);
    render();
  },
  paginas: {
    pedirApp: () => fraseNaConversa(FRASE_DE_PEDIR_APP),
    editarApp: (p) => fraseNaConversa(fraseDeEditarApp(p.nome)),
    removerApp: (p) => removerAppDaPilula(p),
    reconectar: (p) => fraseNaConversa(fraseDeReconectar(p.nome)),
    lendo: (agenteId) => paginasDoServidor.lendo(agenteId),
    canvas: { montar: (host, agenteId, nome) => canvasNaTela.montar(host, agenteId, nome) },
  },
  // NOD-442: o quadro de verdade (busca, frames, a pílula). O avatar é o mascote do próprio nod (HTML que o nod gera).
  dados: {
    api: () => api,
    agente: (id) => { const b = botGerido(id); return b ? { avatar: confiarHtml(iconeAgente(b, "sm")), nome: b.nome } : null; },
    hora: horaDaFala,
    // Os bots da pessoa: quem recebe a passagem de uma coluna (ADR-142) e quem pode ser o Responsável da tarefa aberta
    // (NOD-416). O código da tarefa aberta vai para a URL.
    agentes: () => responsaveisDaTarefa(estado.frota?.agentes ?? [], estado.sessao?.pessoaId),
    naUrl: (codigo) => {
      const u = new URL(window.location.href);
      if (codigo) u.searchParams.set(PARAMETRO_TAREFA, codigo); else u.searchParams.delete(PARAMETRO_TAREFA);
      const novo = u.pathname + u.search + u.hash;
      if (novo !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, "", novo);
    },
    // NOD-422 (PR 2): a trilha do quadro (só ids); fundo, a falha some em silêncio.
    trilha: (e) => trilharQuadro(e),
    // QA do PR #623 (D4): depois de mover, a conversa do bot destino com a tarefa aberta no Quadro (o caminho do link).
    irParaTarefa: (agenteId, tarefaId, quadroId) => {
      const bot = botGerido(agenteId);
      if (!bot) return false;
      navegar({ tipo: "conversa", conversaId: bot.conversaId, agenteId: bot.id });
      quadroNaTela.abrirTarefa(bot.id, tarefaId, quadroId);
      return true;
    },
    // ADA-5 (definido em 2026-11-04): a pílula é o composer do chat: a mesma lista "/", os mesmos rascunhos e a mesma fila de
    // anexos da conversa (a do quadro é a conversa da tela), o Parar do chat e o ditado.
    composer: {
      celular: () => celular.ativo(),
      sugestoes: () => {
        const t = estado.tela;
        return (estado.frota?.agentes ?? []).filter((a) => (t.tipo !== "conversa" || a.id !== t.agenteId) && a.ownerId === estado.sessao?.pessoaId && a.confirmado).map((a) => a.nome);
      },
      barra: { contexto: () => contextoDaBarra(), recarregar: () => recarregarComandos() },
      rascunhos: { ler: (chave) => rascunhos.ler(chave), guardar: (chave, texto) => rascunhos.guardar(chave, texto) },
      anexos: {
        aceita: () => (estado.tela.tipo === "conversa" ? aceitaDo(botGerido(estado.tela.agenteId)?.harness) : undefined),
        adicionar: (arquivos) => {
          const t = estado.tela;
          const aceita = t.tipo === "conversa" ? aceitaDo(botGerido(t.agenteId)?.harness) : undefined;
          if (aceita) adicionarArquivos(arquivos, aceita);
        },
        // Por conversa (revisão 1): o envio limpa a fila da conversa enviada, mesmo que a tela já esteja noutro bot.
        prontos: (conversa) => prontosDaFila(anexosPendentes.get(conversa) ?? []),
        // Revisão 3: o chip com erro não conta (ele não vai no envio e não pode esconder o Parar).
        quantos: (conversa) => contarNaFila(anexosPendentes.get(conversa) ?? []),
        retirar: (conversa, ids) => {
          const r = retirarDaFila(anexosPendentes, conversa, ids);
          redesenharAnexos();
          return {
            confirmar: () => { for (const i of r.saem) if (i.previa) URL.revokeObjectURL(i.previa); },
            devolver: () => { r.devolver(); redesenharAnexos(); },
          };
        },
      },
      comando: (texto, conversa) => comandoDoNod(texto, { conversaId: conversa }),
      // O mesmo Parar do chat (a ação e o critério do turno vivo), com outro botão.
      parar: async () => { await ACOES["parar-conversa"]?.(document.body); },
      trabalhando: () => pararNoCampoDaTela(estado),
      // ADR-095: a troca de vista (pílula ⇄ chat) descarta a gravação aberta (quadro-na-tela, revisão 5 do ADA-5).
      ditado: { ativo: () => ditado.ativo(), concluirEnviando: () => ditado.concluir("enviar"), descartar: () => ditado.descartar() },
      aoCriarPilula: () => { redesenharAnexos(); ditado.atualizar(); },
    },
  },
});

// NOD-455 (ADR-143): os quadros de outras donas em que a pessoa participa ("Compartilhados com você", na barra) e a
// tela que abre um deles (/quadros/:qid). Só lê as rotas /quadros/:qid… (nunca as /agentes/:id/… da dona).
let compartilhados: QuadroCompartilhadoDto[] = [];
let lendoCompartilhados = 0;
let compartilhadosAgendado = false;
/** A rajada de quadro.mudou de outras donas vira uma leitura só (250 ms, como a releitura do quadro). */
function relerCompartilhados(): void {
  if (compartilhadosAgendado) return;
  compartilhadosAgendado = true;
  setTimeout(() => { compartilhadosAgendado = false; void lerCompartilhados(); }, 250);
}
async function lerCompartilhados(): Promise<void> {
  if (!api || !estado.sessao) return;
  const n = ++lendoCompartilhados;
  try {
    const r = await api.compartilhados();
    if (n !== lendoCompartilhados) return;
    compartilhados = r.quadros;
    render();
  } catch { /* a barra fica com a lista que tinha; o próximo quadro.mudou relê */ }
}
const quadroCompartilhado = criarQuadroCompartilhadoNaTela(document, {
  api: () => {
    if (!api) throw new ErroApi(0, "sem_sessao", "Sem sessão");
    return api;
  },
  agente: (id) => {
    const b = botGerido(id);
    if (b) return { avatar: confiarHtml(iconeAgente(b, "sm")), nome: b.nome };
    const c = compartilhados.find((x) => x.agenteId === id);
    return c ? { avatar: anel((c.agenteNome.trim()[0] ?? "?").toUpperCase(), c.agenteNome), nome: c.agenteNome } : null;
  },
  hora: horaDaFala,
  aoSair: () => navegar({ tipo: "inicio" }),
  aoPerderAcesso: (qid) => { compartilhados = compartilhados.filter((c) => c.id !== qid); render(); void lerCompartilhados(); },
});

/**
 * NOD-422 (revisão do PR #630): "conversa de membro aberta" conta a Conversa do bot à vista, nunca o Quadro dele (a aba, o
 * link da tarefa ou o código num chat, que passam pela conversa a caminho do Quadro).
 */
/** A conversa que a pessoa escolheu (o último `navegar` até uma conversa); a que o reducer escolhe ao abrir o app não conta. */
let conversaEscolhida: string | null = null;
const trilhaDaConversa = criarTrilhaDaConversa({
  aVista: () => conversaDaTrilha({ tela: estado.tela, escolhida: conversaEscolhida, botsAbertos: celular.botsAbertos(), espaco: !!estado.espaco, perfil: !!estado.perfilCelular, modo: quadroNaTela.modo(), aCaminhoDoQuadro: (a) => quadroNaTela.aCaminhoDoQuadro(a) }),
  emitir: (e) => trilharQuadro(e),
});

/**
 * Avisos (definido em 2026-09-24, "aviso no Mac"): depois de cada leitura de "Sua vez" o avisador decide
 * se chama a pessoa (web/lib/avisador.ts) e o canal mostra — notificação do macOS e Dock no app,
 * Notification API e título da aba no navegador (web/lib/canal-avisos.ts).
 */
const canalAvisos = criarCanalAvisos((alvo) => abrirAlvoDoAviso(alvo), () => { if (estado.sessao) render(); });
// NOD-136: o link `nod://` que abriu o app do Mac vai para o mesmo lugar do clique no aviso, quando há sessão, frota e salas.
const deepLink = criarPuxadorDeepLink(window.nodDesktop, () => !!estado.sessao, (alvo) => abrirAlvoDoAviso(alvo));
// definido em 2026-10-04 (ADR-070): no app do Mac, a escolha de tema mora em preferencias.json (o localStorage é apagado a
// cada conexão); ao abrir, ela volta para o localStorage e para o data-theme, e Preferências mostra o botão certo.
/**
 * ADA-243: pergunta à ponte qual é esta máquina (no Windows o motor só grava o id ao conectar, então relê junto com as
 * máquinas). Web pura ou app antigo: fica null, e o aviso por máquina não chuta.
 */
function relerEstaMaquina(): void {
  const ponte = window.nodDesktop?.estaMaquina;
  if (!ponte) return;
  void ponte().then((v) => {
    const m = lerEstaMaquina(v);
    if (m?.id !== estado.estaMaquina?.id || m?.nome !== estado.estaMaquina?.nome) dispatch({ tipo: "esta-maquina", maquina: m });
  }, () => undefined);
}
void window.nodDesktop?.preferencias?.().then((p) => { if (p.tema) aplicarTema(p.tema, document.documentElement); }, () => undefined);
const avisador = criarAvisador({
  relogio: { agora: () => Date.now(), esperar: (ms, fn) => { const t = window.setTimeout(fn, ms); return () => window.clearTimeout(t); } },
  temFoco: () => document.hasFocus(),
  ligado: () => canalAvisos.ligado(),
  pessoaId: () => estado.sessao?.pessoaId ?? null,
  mostrar: (aviso) => canalAvisos.mostrar(aviso),
  nomeDoBot: (id) => [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id)?.nome ?? null,
});
/**
 * Artefatos do nod (ADR-051, definido em 2026-09-28): o card vem na timeline; o iframe sandbox, o estado
 * e a gravação moram aqui, fora do render por regiões.
 */
const artefatos = criarArtefatosVivos({
  carregar: (id, versao) => (api ? api.versaoArtefato(id, versao) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  salvar: (id, dados) => (api ? api.salvarEstadoArtefato(id, dados) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  salvarAoSair: (id, dados) => api?.salvarEstadoArtefatoAoSair(id, dados),
});
/**
 * Diagrama mermaid no balão do bot (NOD-328): o renderizador é um iframe sandbox de origem opaca que importa o módulo
 * daqui (CORS `*` em /assets e /diagrama, estatico.ts). No build ele sai em /diagrama/sandbox.js (vite.config.ts); no
 * dev, o Vite serve o .ts e só aceita a origem "null" com NOD_DIAGRAMA_DEV=1.
 */
const diagramas = criarDiagramasVivos(import.meta.env.PROD
  ? { urlModulo: `${location.origin}/diagrama/sandbox.js`, fontes: [`${location.origin}/diagrama/`, `${location.origin}/assets/`] }
  : { urlModulo: `${location.origin}/sandbox/diagrama.ts`, fontes: [`${location.origin}/`] });
/**
 * Modo ligação (definido em 2026-10-04, ADR-071): a tela e o motor moram fora do reducer, como os artefatos — o áudio,
 * o WebSocket e a legenda mudam muitas vezes por segundo. O reducer só sabe QUAL ligação está viva (`ligacaoViva`), para
 * a barra lateral, o cabeçalho e a linha "Chat de voz".
 */
const telaLigacao = criarTelaLigacao({
  api: () => api,
  tenantId: () => estado.sessao?.tenantId ?? null,
  iniciarMotor: iniciarMotorLigacao,
  agente: (id) => botGerido(id),
  suaVez: () => estado.suaVez,
  aoMudar: () => sincronizarLigacao(),
  pararLeitura: () => tocador.parar("ligacao"),
  decidirPeloClique: (id, aprovar) => decidirPelaLigacao(id, aprovar),
  aoEncerrar: (l) => {
    dispatch({ tipo: "esquecer-disponibilidade-ligacao", agenteId: l.agenteId });
    dispatch({ tipo: "invalidar", quais: [`conversa:${l.conversaId}`, "ligacao"] });
    void telaOnboarding.aoLigacaoEncerrada();
  },
  aoOnboarding: (etapa, campos) => telaOnboarding.aoOnboarding(etapa, campos),
  // Rede de segurança da ligação (2026-10-05): o "Configurar sem voz" do aviso é o mesmo do onboarding.
  configurarSemVoz: () => telaOnboarding.acoes["onboarding-sem-voz"]?.(document.body),
});
/**
 * Ouvir uma resposta (definido em 2026-10-17, NOD-106): o tocador mora fora do reducer (o áudio), mas a fase vai para
 * `estado.leitura` a cada mudança, para o re-render do SSE manter o "Parar". A região `#anuncio-leitura` diz ao leitor
 * de tela o que mudou; o foco volta ao botão da mesma resposta quando o clique estava nele.
 */
const tocador = criarTocadorDeLeitura({
  fetch: (url, init) => window.fetch(url, { ...init, credentials: "same-origin" }),
  criarContexto: () => new AudioContext({ latencyHint: "interactive" }),
  aoMudar: (atual, motivo) => aoMudarLeitura(atual, motivo),
});
let falhaLeituraTimer: number | null = null;
function aoMudarLeitura(atual: LeituraAtual | null, motivo?: MotivoParada): void {
  const focoNoOuvir = document.activeElement instanceof HTMLElement && document.activeElement.dataset.act === "ouvir-mensagem" ? document.activeElement.dataset.id : undefined;
  dispatch({ tipo: "leitura-mudou", leitura: atual });
  const anuncio = document.getElementById("anuncio-leitura");
  const texto = anuncioDaLeitura(atual, motivo);
  if (anuncio && texto !== null) anuncio.textContent = texto;
  if (focoNoOuvir && document.activeElement !== document.querySelector(`[data-act="ouvir-mensagem"][data-id="${CSS.escape(focoNoOuvir)}"]`)) {
    document.querySelector<HTMLElement>(`[data-act="ouvir-mensagem"][data-id="${CSS.escape(focoNoOuvir)}"]`)?.focus();
  }
}
function limparFalhaLeitura(): void {
  if (falhaLeituraTimer !== null) window.clearTimeout(falhaLeituraTimer);
  falhaLeituraTimer = null;
  if (estado.falhaLeitura) dispatch({ tipo: "leitura-mudou", leitura: estado.leitura, falha: null });
}
/** "Não deu para ouvir agora." embaixo do balão por 6 s (plano da Ada); o próximo clique também tira. */
function mostrarFalhaLeitura(mensagemId: string): void {
  if (falhaLeituraTimer !== null) window.clearTimeout(falhaLeituraTimer);
  // O leitor de tela ouve a falha pela região viva: o role="status" do aviso nasce já preenchido e pode não ser lido.
  const anuncio = document.getElementById("anuncio-leitura");
  if (anuncio) anuncio.textContent = TEXTO_FALHA_LEITURA;
  dispatch({ tipo: "leitura-mudou", leitura: estado.leitura, falha: { mensagemId } });
  falhaLeituraTimer = window.setTimeout(() => {
    falhaLeituraTimer = null;
    if (estado.falhaLeitura?.mensagemId === mensagemId) dispatch({ tipo: "leitura-mudou", leitura: estado.leitura, falha: null });
  }, 6000);
}
async function ouvirMensagem(mensagemId: string): Promise<void> {
  const tenantId = estado.sessao?.tenantId;
  if (!tenantId) return;
  const r = await tocador.ouvir(tenantId, mensagemId);
  if (r.ok) return;
  if (r.motivo === "falha") return mostrarFalhaLeitura(mensagemId);
  // Sem o aviso de voz v3: o mesmo diálogo da ligação e do ditado. O AudioContext destrava dentro do clique em "Concordo".
  const concordou = await pedirConsentimentoVoz({ titulo: "Antes de ouvir", confirmar: "Concordo e ouvir", aoConcordar: () => tocador.destravar() });
  if (!concordou || !api) return;
  try {
    await api.consentirVoz(VERSAO_CONSENTIMENTO);
  } catch {
    return mostrarFalhaLeitura(mensagemId);
  }
  // Entre o diálogo e o aceite gravado, a ligação pode ter começado (outro aparelho) ou a sessão ter mudado: não lê.
  if (estado.ligacaoViva || estado.sessao?.tenantId !== tenantId) return;
  const depois = await tocador.ouvir(tenantId, mensagemId);
  if (!depois.ok) mostrarFalhaLeitura(mensagemId);
}
window.addEventListener("pagehide", () => tocador.parar("saiu"));
/**
 * Ditado no campo de mensagem (definido em 2026-10-11, ADR-095): o 🎤 do composer. Como a ligação, mora fora do
 * reducer (o microfone e o canal mudam muitas vezes por segundo); o texto entra no campo pelo caminho do rascunho.
 */
const ditado = criarControleDitado({
  tenantId: () => estado.sessao?.tenantId ?? null,
  disponibilidade: () => (api ? api.disponibilidadeDitado() : Promise.resolve(null)),
  consentir: (versao) => (api ? api.consentirVoz(versao) : Promise.reject(new ErroApi(401, "nao_permitido", "sem sessão"))),
  // ADA-5: com o Quadro na tela, o 🎤 é o da pílula; o texto entra nela (o "input" liga altura, rascunho e Enviar⇄Parar).
  raiz: () => (quadroNaTela.modo() === "quadro" ? quadroNaTela.pilula() : document.getElementById("composer")),
  aoParar: () => quadroNaTela.atualizarPilula(),
  aoTexto: (texto, destino, campo) => {
    if (campo?.closest("#quadro")) return ditadoNaPilula(campo, texto, destino);
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (!ta) return;
    escreverNoCampo(ta, juntarAoCampo(ta.value, texto));
    ajustarAltura(ta);
    if (composerDe) rascunhos.guardar(composerDe, ta.value);
    if (destino === "enviar") return void enviarComposer();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  },
  avisar: (texto) => dispatch({ tipo: "erro", erro: { codigo: "ditado", mensagem: texto } }),
  noApp: () => window.nodDesktop !== undefined,
});
function avisarDitado(f: Parameters<typeof textoDaFalha>[0]): void {
  dispatch({ tipo: "erro", erro: { codigo: "ditado", mensagem: textoDaFalha(f, window.nodDesktop !== undefined) } });
}
/**
 * Onboarding por ligação (definido em 2026-10-04, ADR-077): a camada `#onboarding` (olá, a IA do Mac, "está te
 * ligando", o painel da entrevista) e os cards guiados na conversa da guia. O que vem do servidor mora no reducer.
 */
const telaOnboarding = criarTelaOnboarding({
  api: () => api,
  iasMac: () => estado.iasMac,
  // ADA-242: a jornada A (texto, sem ligação) só com NOD_ONBOARDING_TEXTO.
  texto: () => contas?.onboardingTexto === true,
  nomeSugerido: () => nomeDoEmail(quemEsta()?.email),
  dados: () => estado.onboarding,
  aberto: () => estado.onboardingAberto,
  hidratar: (o) => dispatch({ tipo: "hidratar-onboarding", onboarding: o }),
  abrir: (aberto) => dispatch({ tipo: "onboarding-aberto", aberto }),
  ligacao: { ativa: () => telaLigacao.ativa(), cheia: () => telaLigacao.cheia(), atenderOnboarding: (l) => telaLigacao.atenderOnboarding(l) },
  garantirAgente: async (agenteId) => {
    for (let i = 0; i < 6 && api; i++) {
      if (botGerido(agenteId)) return true;
      const lida = await buscarFrota();
      if (lida) dispatch(lida);
      if (botGerido(agenteId)) return true;
      await new Promise((r) => window.setTimeout(r, 400));
    }
    return !!botGerido(agenteId);
  },
  irParaConversa: (conversaId, agenteId) => navegar({ tipo: "conversa", conversaId, agenteId }),
  iniciarConexao: (slug, depois) => iniciarConexao(slug, depois),
  conectando: (slug) => slug in estado.conectando,
  conectorHabilitado: async (slug) => {
    const achar = () => estado.conectores.find((c) => c.slug === slug && c.habilitado)?.id ?? null;
    if (achar() || !api) return achar();
    dispatch({ tipo: "hidratar-conectores", ...(await api.conectores()) });
    return achar();
  },
  invalidar: () => dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "rotinas", "conectores", ...(conversaDaTela(estado) ? [`conversa:${conversaDaTela(estado)?.conversa.id}` as Invalidacao] : [])] }),
  erro: (e) => mostrarErro(e),
  aoMudar: () => render(),
});

/**
 * NOD-345 (ADR-124): a conta no nod como cartões na conversa. `contas` vem de /api/sessao/modo (ausente = servidor sem
 * contas: nada disto aparece); `contaAtual` é o GET /api/conta (null = não lido). Nenhum dos dois guarda senha nem código.
 */
/** O app não conseguiu trocar a chave de máquina: não recarrega com a conta nova na tela e o executor na antiga. */
const FALHA_TROCA_APP = "O app não conseguiu trocar de conta. Feche e abra o nod para tentar de novo.";
let contas: { google: boolean; bootstrap: boolean; minhaConta?: boolean; onboardingTexto?: boolean } | null = null;
/** NOD-406: o servidor entra pelo Google (modo "google" de /api/sessao/modo); lido junto com `contas`. */
let loginGoogle = false;
let contaAtual: EstadoContaDto | null = null;
const conversaDoNod = () => {
  const nod = (estado.frota?.agentes ?? []).find((a) => a.papel === "nod" && a.ownerId === estado.sessao?.pessoaId);
  return nod ? { conversaId: nod.conversaId, agenteId: nod.id } : null;
};
const telaConta = criarContaNoChat({
  api: () => contaApi,
  conversaDoNod,
  conversaDaTela: () => conversaDaTela(estado)?.conversa.id ?? null,
  irParaConversa: (conversaId, agenteId) => navegar({ tipo: "conversa", conversaId, agenteId }),
  aoMudar: () => render(),
  // No app, o Google abre no navegador do sistema, sem a sessão do app: só vale com o loopback do processo principal
  // (ADA-242, NOD_ONBOARDING_TEXTO e a ponte googleConta); sem isso, fica só na web, como antes.
  google: () => (contas?.google ?? false) && (window.nodDesktop === undefined || (contas?.onboardingTexto === true && !!window.nodDesktop.googleConta)),
  texto: () => contas?.onboardingTexto === true,
  googleNoApp: () => window.nodDesktop?.googleConta ?? null,
  // NOD-406: sem o Google para conta, a equipe ainda entra pelo Google de antes (o cookie da equipe troca o do provisório).
  // Só na web: no app, o Google abre no navegador do sistema, sem a sessão do app.
  equipe: () => linkEquipe(),
  noApp: () => window.nodDesktop !== undefined,
  async entrou(trocaApp) {
    // O app troca a chave de máquina pela do espaço novo e se reconecta; a web já tem o cookie novo e só recarrega.
    if (trocaApp && window.nodDesktop?.trocarConta) {
      if (await window.nodDesktop.trocarConta(trocaApp).catch(() => false)) return;
      mostrarErro(new Error(FALHA_TROCA_APP));
      return;
    }
    window.location.reload();
  },
  // NOD-406 (revisão r6): o provisório que vira conta pelo código (sem recarregar) segue para o pedido do Mac guardado.
  contaMudou: (e) => { contaAtual = e; render(); if (decidirPareamento({ modoLido: true, contas: true, estado: e }) === "abrir") seguirPareamento("abrir"); },
  abrirUrl: (url) => { if (window.nodDesktop) window.open(url, "_blank", "noopener"); else window.location.assign(url); },
  agora: () => Date.now(),
  digitado: () => [...document.querySelectorAll<HTMLInputElement>(".cc-bloco form input")].some((i) => i.value !== ""),
  campo: (form, nome) => String(new FormData(form as HTMLFormElement).get(nome) ?? ""),
});
/** NOD-346: Minha conta em Seu espaço (só com NOD_MINHA_CONTA: o modo da sessão diz `contas.minhaConta`). */
const telaMinhaConta = criarMinhaConta({
  api: () => minhaContaApi,
  aoMudar: () => render(),
  agora: () => Date.now(),
  campo: (form, nome) => String(new FormData(form as HTMLFormElement).get(nome) ?? ""),
  lerFoto: async (el) => {
    const input = el as unknown as HTMLInputElement;
    const arquivo = input.files?.[0];
    input.value = "";
    return arquivo ? reduzirFoto(arquivo) : null;
  },
  agendar: (fn, ms) => { const id = window.setInterval(fn, ms); return () => window.clearInterval(id); },
  focar: (seletor) => document.querySelector<HTMLElement>(seletor.split(",").map((x) => `#espaco ${x.trim()}`).join(", "))?.focus(),
});
/** A fala única do lembrete (opção 2 do Gil): na conversa do Nod, uma vez por instalação, depois da primeira rotina. */
function blocoDoLembrete(conversaId: string): string | null {
  if (conversaDoNod()?.conversaId !== conversaId) return null;
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  const lembrar = deveLembrar({ contas: contas !== null, temConta: contaAtual ? contaAtual.conta !== null || !!contaAtual.legado : null, rotinas: estado.rotinas.length, jaFalou: jaFalou(storage) });
  return lembrar ? htmlLembrete() : null;
}
/** A ligação viva que a página achou ao abrir (recarregada no meio dela): volta como pílula quando o bot chegar na frota. */
let ligacaoParaRetomar: Ligacao | null = null;

function sincronizarLigacao(): void {
  const a = telaLigacao.ativa();
  dispatch({ tipo: "ligacao-viva", viva: a ? { ligacaoId: a.ligacaoId, agenteId: a.agenteId, conversaId: a.conversaId, local: true } : estado.ligacaoViva?.local ? null : estado.ligacaoViva });
}

/**
 * O clique em Aprovar/Recusar no card da ligação usa o fluxo normal de decisão (plano, "Aprovação por voz" §5): na
 * aprovação em lista, aprovar = a seleção padrão e recusar = todos os itens desmarcados; o "Retomar" retoma ou dispensa;
 * os outros tipos decidem ou recusam inteiros.
 */
async function decidirPelaLigacao(decisaoId: string, aprovar: boolean): Promise<void> {
  if (!api) return;
  const item = estado.suaVez?.itens.find((i) => i.decisao.id === decisaoId);
  const tipo = item?.decisao.tipo;
  if (tipo === "aprovacao" || tipo === "gate_rotina") await api.decidir(decisaoId, { itens: (item?.itensAprovacao ?? []).map((i) => ({ id: i.id, selecionado: aprovar && i.selecionado })) });
  else if (tipo === "retomar_turno") await (aprovar ? api.retomar(decisaoId) : api.dispensar(decisaoId));
  else await api.decidir(decisaoId, aprovar ? {} : { recusar: true });
  dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota", ...(item?.decisao.conversaId ? [`conversa:${item.decisao.conversaId}` as Invalidacao] : [])] });
}

/** A última leitura de "Sua vez" foi com a janela atrás (`?ver=0`): ao voltar, relê para carimbar vista_em. */
let suaVezSemVer = false;
/** A decisora designada que não é dona não recebe frames (ADR-016): a cada 4 ticks (60 s) "Sua vez" é relida. */
const TICKS_POR_RELEITURA = 4;

/** A janela está na frente da pessoa: visível E com foco. */
function naFrente(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * Não lidos (definido em 2026-09-29, 0039): a conversa na tela, com a janela na frente, é lida. A linha "Novas"
 * só entra quando a pessoa acabou de abrir a conversa, voltou para a janela ou abriu o Nod (`linhaEm`); a fala que
 * chega enquanto ela olha é lida sem linha. Voltar com outra leva de novas muda a linha de lugar se a pessoa já viu a
 * linha de antes (2026-10-05): antes ela ficava na primeira leva da visita, e a pílula da base levava a um ponto já
 * lido. Sem ter visto, a linha fica onde estava e soma as novas, para a pílula levar ao começo de tudo.
 */
let linhaEm: string | null = null;
/** A leva de não lidas (a primeiraId dela) já contada na linha de cada conversa: a mesma leva nunca soma duas vezes. */
const levaContada = new Map<string, string>();
let primeiraLeitura = true;
/** A conversa que a pessoa marcou como não lida com ela aberta: continua não lida até ela sair. */
let deixarNaoLida: string | null = null;
const lendo = new Set<string>();

function lerConversaDaTela(): void {
  const t = estado.tela;
  if (!api || !estado.naoLidos || (t.tipo !== "conversa" && t.tipo !== "sala") || estado.espaco || !conversaAVista({ naFrente: naFrente(), botsAbertos: celular.botsAbertos(), modo: quadroNaTela.modo() })) return;
  const conversaId = t.conversaId;
  const comLinha = linhaEm === conversaId || primeiraLeitura;
  linhaEm = null;
  primeiraLeitura = false;
  const nova = naoLidaDe(estado, conversaId);
  if (!nova || deixarNaoLida === conversaId || lendo.has(conversaId)) return;
  const atual = estado.novasDesde[conversaId];
  if (comLinha && atual?.mensagemId !== nova.primeiraId && levaContada.get(conversaId) !== nova.primeiraId) {
    levaContada.set(conversaId, nova.primeiraId);
    const linha = !atual || rolagem.jaViu(atual.mensagemId) ? { mensagemId: nova.primeiraId, em: nova.desde, total: nova.total } : { ...atual, total: atual.total + nova.total };
    dispatch({ tipo: "novas-desde", conversaId, ...linha });
  }
  lendo.add(conversaId);
  void api
    .marcarLida(conversaId)
    .then(() => dispatch({ tipo: "invalidar", quais: ["nao-lidos"] }), () => undefined)
    .finally(() => lendo.delete(conversaId));
}

/** O ponto de não lido: a conversa aberta, com a pessoa olhando, nunca pisca como nova enquanto a leitura vai ao servidor. */
function temNovas(conversaId: string, e: Estado = estado): boolean {
  if (!naoLidaDe(e, conversaId)) return false;
  const t = e.tela;
  const aberta = (t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId;
  // NOD-379: com a inicial do celular por cima, a conversa de baixo não está sendo lida.
  // NOD-429: no modo Quadro a conversa fica por baixo, invisível: também não está sendo lida.
  return !(aberta && conversaAVista({ naFrente: naFrente(), botsAbertos: celular.botsAbertos(), modo: quadroNaTela.modo() }) && deixarNaoLida !== conversaId);
}

/**
 * NOD-260 (definido em 2026-10-15, J1): os frames de turno pedem `GET trabalhos`; a releitura sai uma vez por segundo, no
 * fim da janela (web/lib/releitura-adiada.ts). Enquanto a janela está aberta, `reidratar` deixa "trabalhos" para ela.
 */
const JANELA_TRABALHOS_MS = 1000;
const releituraTrabalhos = criarReleituraAdiada(JANELA_TRABALHOS_MS, (fn, ms) => {
  const t = window.setTimeout(fn, ms);
  return () => window.clearTimeout(t);
}, () => void reidratar());

/**
 * ADR-114 (chat limpo, PR 2): o "N hoje" e a página aberta da Atividade, relidos pelos frames do bot, saem juntos uma vez
 * por segundo (uma rajada de mensagens e negações vira uma releitura só).
 */
const JANELA_ATIVIDADE_MS = 1000;
const releituraAtividade = criarReleituraAdiada(JANELA_ATIVIDADE_MS, (fn, ms) => {
  const t = window.setTimeout(fn, ms);
  return () => window.clearTimeout(t);
}, () => void reidratar());
// NOD-326: a releitura ao vivo da Biblioteca vai na mesma janela (a rajada de falas de um turno vira uma leitura só).
const daAtividade = (q: Invalidacao): boolean => q.startsWith("atividade:") || q.startsWith("atividade-hoje:") || q.startsWith("decisoes:") || q.startsWith("biblioteca:");

/**
 * NOD-370: o destino do foco depois de excluir ou ocultar (web/lib/posicao-da-lista.ts); um clique ou uma tecla o descartam.
 * Declarado antes do `dispatch` (o `render` o aplica e o boot já desenha).
 */
const focoPendente = criarFocoPendente({ get activeElement() { return document.activeElement; }, get body() { return document.body; }, querySelector: (s) => document.querySelector<HTMLElement>(s) as unknown as ElDaLista | null }, () => Date.now());
document.addEventListener("pointerdown", () => focoPendente.descartar(), true);
document.addEventListener("keydown", () => focoPendente.descartar(), true);
// O contorno de foco só para quem navega pelo teclado (web/lib/modo-de-foco.ts).
ligarModoDeFoco(document as never);

/**
 * ADR-125: o que foi escolhido e ainda não voltou confirmado, por bot: a frota relida no meio não desfaz na tela.
 * Declarado antes do `dispatch` (QA da NOD-349): o carregamento já despacha (as abas lidas) e o `let` mais abaixo caía
 * na zona morta temporal, derrubando o app no boot.
 */
let perfilPendente: Record<string, MudancaDePerfil> = {};

const marcaDoPerfil = criarMarcaDoPerfil();
/**
 * ADA-243 (jornada B, atrás de NOD_ONBOARDING_TEXTO): "Oi de novo · este computador" uma vez por máquina para quem já
 * concluiu o onboarding. Só pergunta à ponte o "já vi" quando o resto já permite (flag, esta máquina, onboarding lido).
 */
let oiDeNovoPedido = false;
function talvezAbrirOiDeNovo(): void {
  const ponte = window.nodDesktop;
  const aqui = estado.estaMaquina;
  if (oiDeNovoPedido || !estado.sessao || !estado.maquinas || !estado.onboarding) return;
  const conectadaAqui = !!aqui && (estado.maquinas.maquinas ?? []).some((m) => m.id === aqui.id && m.conectada);
  if (!mostrarEsteComputador({ flag: contas?.onboardingTexto === true, temPonte: !!ponte?.esteComputador, estaMaquina: !!aqui, maquinaConectada: conectadaAqui, onboardingConcluido: estado.onboarding.concluidoEm !== null, vistoAqui: false })) return;
  if (!ponte?.esteComputador || !aqui) return;
  oiDeNovoPedido = true;
  const visto = ponte.esteComputador;
  void visto.jaViu().then((jaViu) => {
    if (jaViu) return;
    const pi = ponte.ias;
    const ent = ponte.iaEntrar, inst = ponte.iaInstalar;
    const ias = pi ? { entrar: (ia: IaDesktop) => pi.entrar(ia), instalar: (ia: IaDesktop) => pi.instalar(ia) } : ent && inst ? { entrar: (ia: IaDesktop) => ent(ia), instalar: (ia: IaDesktop) => inst(ia) } : undefined;
    abrirOiDeNovo({
      nome: estado.onboarding?.campos.apelido ?? "",
      estaMaquina: aqui,
      maquinaAqui: () => (estado.maquinas?.maquinas ?? []).find((m) => m.id === aqui.id),
      padrao: () => {
        const p = (estado.maquinas?.maquinas ?? []).find((m) => m.id === estado.maquinas?.padraoId && m.papel !== "computador");
        return p ? { id: p.id, nome: p.nome, conectada: p.conectada } : null;
      },
      ...(ias ? { ias } : {}),
      relerMaquinas: async () => { await chavesAtuais(); },
      definirPadrao: async (id) => {
        await api!.maquinaPadrao(id);
        dispatch({ tipo: "invalidar", quais: ["maquinas", "frota"] });
      },
      marcarVisto: () => visto.marcar(),
    });
  }, () => undefined);
}

function dispatch(acao: Acao): void {
  // Abrir Trabalhos relê agora, sem esperar a janela de algum frame de turno.
  if (acao.tipo === "navegar" && acao.tela.tipo === "trabalhos") releituraTrabalhos.cancelar();
  // NOD-106: a ligação que aparece (até a de outro aparelho) para a leitura; o botão passa a explicar por que não lê.
  if (acao.tipo === "ligacao-viva" && acao.viva && tocador.atual()) tocador.parar("ligacao");
  const saiu = reduzirVendoSaida(acao);
  render();
  if (saiu) depoisDeSair();
  void reidratar();
  talvezAbrirOiDeNovo();
}

/**
 * NOD-370: aplica a ação e, se a frota ou a gestão tirou a pessoa da conversa (o bot dela saiu), faz o que `navegar` faria
 * fora do reducer. Devolve se trocou, para quem chama ler a conversa nova depois de desenhar.
 */
function reduzirVendoSaida(acao: Acao): boolean {
  const antes = estado.tela;
  estado = reduzir(estado, sobreporPendentes(acao, perfilPendente));
  // NOD-379: o onboarding pendente continua abrindo no guia, não na inicial do celular.
  if (estado.onboardingAberto && !onboardingVisto) celular.fecharBots();
  onboardingVisto = !!estado.onboardingAberto;
  if (acao.tipo !== "hidratar-frota" && acao.tipo !== "hidratar-gestao") return false;
  const saiu = antes.tipo === "conversa" && estado.tela !== antes && !(estado.tela.tipo === "conversa" && estado.tela.conversaId === antes.conversaId);
  if (!saiu) return false;
  // NOD-379: a inicial do celular, se estava à vista, continua: a troca é da conversa de baixo.
  aoTrocarDeTela(antes, estado.tela);
  lembrarTaskAberta(estado.tela);
  return true;
}

/** NOD-370: depois de desenhar a tela para onde a saída do bot levou, o mesmo que `navegar` faz depois do dispatch. */
function depoisDeSair(): void {
  lerConversaDaTela();
  if (rolaAoTopoAoNavegar(estado.tela.tipo)) document.getElementById("timeline")?.scrollTo({ top: 0 });
}

/**
 * Frames do SSE (definido em 2026-09-30): o estado muda na hora, mas a tela é redesenhada no máximo uma vez
 * por quadro, e só quando o frame mudou algo que ela mostra (`mudouNaTela`). Cada pedaço de texto de cada
 * bot é um frame: vários bots escrevendo são centenas por segundo. As ações da pessoa continuam
 * redesenhando na hora (dispatch), porque quem clica espera o DOM novo na linha seguinte (foco, rolagem).
 */
let quadroPendente = 0;
function renderNoQuadro(): void {
  if (quadroPendente) return;
  quadroPendente = window.requestAnimationFrame(() => {
    quadroPendente = 0;
    render();
  });
}

/**
 * NOD-348: o relógio da linha viva (1 s, só o texto de `[data-desde]`) e o anúncio do turno ao leitor de tela, em
 * `#anuncio-turno` — separado do `#anuncio-pergunta`, para um não apagar o outro.
 */
const agendarNaJanela = (fn: () => void, ms: number): (() => void) => {
  const t = window.setTimeout(fn, ms);
  return () => window.clearTimeout(t);
};
// Parte 2 do plano "o pensamento no chat": o mesmo tick escreve a troca pendente do cabeçalho quando a permanência deu; e,
// enquanto alguma espera, o relógio bate a cada TICK_CURTO_MS (revisão de engenharia, 27/10) — no segundo inteiro a troca
// atrasava até 1 s além dos 600 ms, e o plano pedia 200 ms.
let trocasPendentes = 0;
const relogioDaFala = criarRelogioDaFala(() => {
  const aoVivo = document.getElementById("timeline-ao-vivo");
  const agora = Date.now();
  trocasPendentes = escreverEstados(aoVivo, agora);
  return escreverTempos(aoVivo, agora) + trocasPendentes;
}, agendarNaJanela, () => document.hidden, () => (trocasPendentes > 0 ? TICK_CURTO_MS : 1000));
let anuncioPendente = 0;
const anunciadorDoTurno = criarAnunciador((texto) => {
  const anuncio = document.getElementById("anuncio-turno");
  if (!anuncio) return;
  // Duas falas em menos de 60 ms: a segunda substitui a primeira, sem a primeira apagar a segunda depois.
  window.clearTimeout(anuncioPendente);
  anuncio.textContent = "";
  anuncioPendente = window.setTimeout(() => { anuncio.textContent = texto; }, 60);
}, agendarNaJanela);
document.addEventListener("visibilitychange", () => relogioDaFala.tocar());

/** As falas vivas à vista (o que o anunciador acompanha). */
function falasNaTela(): FalaNaTela[] {
  return lerFalasNaTela(document.getElementById("timeline-ao-vivo"));
}

function receberFrame(frame: FrameSse): void {
  // Antes do reducer: no fim, o anunciador ainda sabe quem falava (o turno sai do estado no mesmo frame).
  anunciadorDoTurno.frame(frame.tipo, frame.dados);
  // NOD-351: um bot abriu um cartão de conta nesta conversa; o controlador confere a etapa e a conversa do frame.
  if (frame.tipo === "conta.abrir") void telaConta.abrirPeloChat(frame.dados.etapa, frame.dados.conversaId).catch(() => undefined);
  const antes = estado;
  estado = reduzir(estado, { tipo: "frame", frame, agora: Date.now() });
  if (mudouNaTela(antes, estado)) renderNoQuadro();
  quadroNaTela.aoFrame(frame);
  canvasNaTela.aoFrame(frame);
  quadroCompartilhado.aoFrame(frame);
  // NOD-455: o quadro de outra dona mudou (alguém entrou, saiu, o modo mudou): a barra relê os compartilhados.
  if (frame.tipo === "quadro.mudou" && typeof frame.dados["agenteId"] === "string" && !botGerido(frame.dados["agenteId"]) && releListaDosCompartilhados(frame, compartilhados.map((c) => c.id))) relerCompartilhados();
  // NOD-445: um app chegou, saiu ou mudou (ou a ordem), ou o quadro nasceu: relê as páginas do bot.
  if (frame.tipo === "paginas.mudaram" || frame.tipo === "quadro.mudou") {
    const ag = (frame.dados as { agenteId?: unknown }).agenteId;
    if (typeof ag === "string" && paginasDoServidor.conhece(ag)) lerPaginas(ag, true);
  }
  if (frame.tipo === "quadro.mudou" && typeof frame.dados["agenteId"] === "string") {
    const ag = frame.dados["agenteId"];
    if (frame.dados["removido"] === true) semQuadroAgora.set(ag, botGerido(ag)?.ultimaMensagem?.em ?? null);
    else if (frame.dados["loteId"]) semQuadroAgora.delete(ag);
    renderNoQuadro();
  }
  telaOnboarding.aoFrame();
  // Só quem marcou algo para buscar precisa do REST; um pedaço de texto nunca marca.
  if (estado.invalidacoes === antes.invalidacoes) return;
  // NOD-300: o `inventario.mudou` (a presença das máquinas) também relê Trabalhos pela janela de 1 s.
  if ((frame.tipo.startsWith("turno.") || frame.tipo === "inventario.mudou") && estado.invalidacoes.includes("trabalhos")) releituraTrabalhos.pedir();
  if (estado.invalidacoes.some((q) => daAtividade(q) && !antes.invalidacoes.includes(q))) releituraAtividade.pedir();
  void reidratar();
}

/**
 * NOD-215: exceção da própria web (não ErroApi) é registrada uma vez por origem, com limite por minuto e por carga.
 * `reportError` põe o registro no console do navegador e no log do renderer do app do Mac (sem `console.*`, AGENTS.md);
 * não há rota de log do cliente no servidor. Revisão: vai um Error NOVO só com nome, origem e pilha curta sem query —
 * nunca a exceção original, cuja mensagem pode trazer texto da pessoa, token ou URL com segredo.
 */
const registrarErroDaTela = criarRegistroDeErros((r) => globalThis.reportError?.(erroParaRelatar(r)));

/**
 * O correlation_id atravessa para o relato e para "Detalhes" (ADR-041); a frase nunca é err.message (ADR-002).
 * Exceção que não é ErroApi vira `erro_da_tela` (frase de erro interno + Relatar), nunca "confira a conexão" (NOD-215).
 */
function erroDe(e: unknown): ErroNaTela | null {
  return traduzirErro(e, registrarErroDaTela, estado.tela.tipo);
}

/**
 * Mostra o erro de uma AÇÃO da pessoa (agir, gestão, conexão, onboarding); o AbortError não mostra nada. Revisão
 * NOD-215: a falha de rede que chega aqui não vai mais ser repetida (mutação sem chave, ou esgotou as tentativas), então
 * vira `acao_nao_concluida` no banner — antes virava o "Reconectando… Tentamos de novo sozinhos", que sumia na próxima
 * leitura e deixava a pessoa achando que a ação tinha sido refeita.
 */
/** NOD-284: o passo da nota não refez a fala — o banner diz por quê, sem jogar exceção (não é falha de rede nem bug). */
function avisarMotivoDaNota(motivo: Parameters<typeof fraseDoMotivoDaNota>[0]): void {
  const mensagem = fraseDoMotivoDaNota(motivo);
  if (mensagem !== null) dispatch({ tipo: "erro", erro: { codigo: `nota_${motivo}`, mensagem } });
}

/** QA do NOD-314: o motivo do "Rodar em <outra> desta vez" da task (200 sem mover nada). */
function avisarMotivoDaTask(motivo: string | null | undefined): void {
  if (motivo === "ja_refeito") dispatch({ tipo: "erro", erro: { codigo: "task_ja_refeito", mensagem: "Esta task já foi mandada para essa máquina; nada foi repetido." } });
}

function mostrarErro(e: unknown): void {
  const erro = erroDe(e);
  if (erro === null) return;
  dispatch({ tipo: "erro", erro: erroDaAcao(erro) });
}

/**
 * O que reidratar deixou de buscar porque a rede caiu (revisão NOD-215): as invalidações já tinham sido consumidas e
 * se perdiam — a tela parecia sã com dado velho. Voltam para a fila quando o nod responder de novo.
 */
const pendentesDeRede = new Set<Invalidacao>();
/** O boot caiu por rede (sem sessão): quando o nod voltar, a página recarrega em vez de ficar em branco. */
let bootCaiuPorRede = false;

/** Acende o "Reconectando…" (se não houver outro erro na tela) e garante a sonda que o apaga quando o nod voltar. */
function redeCaiu(erro: ErroNaTela): void {
  if (estado.erro !== null && (!ehErroDeRede(estado.erro) || estado.erro.codigo === erro.codigo)) {
    sonda.lembrar();
    return;
  }
  dispatch({ tipo: "rede-caiu", erro });
  sonda.lembrar();
}

const sonda = criarSondaDeRede({
  sondar: () => sessaoApi.atual(),
  precisa: () => ehErroDeRede(estado.erro) || pendentesDeRede.size > 0 || bootCaiuPorRede,
  agendar: (fn, ms) => window.setTimeout(fn, ms),
});

// NOD-215: cada falha de transporte (mesmo a que ainda vai repetir) acende o "Reconectando…"; qualquer resposta do nod
// o apaga. Só despacha quando muda algo: `voltou` chega a cada chamada que dá certo, e `falhou` com outro erro na tela
// (ou o mesmo aviso já aceso) não redesenha a cada tentativa.
observarRede({
  falhou: (e) => {
    const erro = erroDe(e);
    if (erro) redeCaiu(erro);
  },
  voltou: () => {
    if (bootCaiuPorRede) {
      bootCaiuPorRede = false;
      window.location.reload();
      return;
    }
    const devolver = [...pendentesDeRede];
    pendentesDeRede.clear();
    if (ehErroDeRede(estado.erro)) dispatch({ tipo: "rede-voltou" });
    if (devolver.length > 0) dispatch({ tipo: "invalidar", quais: devolver });
  },
});

/**
 * ADR-108 (R5, canvas D1): trocar a IA de um bot com tasks em andamento pergunta antes se elas vão junto ("Só daqui em
 * diante" é o padrão). Fechar a prévia sem escolher não grava nada.
 */
async function gravarInteligenciaComPrevia(a: NonNullable<Estado["frota"]>["agentes"][number], pedido: PedidoInteligencia, depois?: () => void): Promise<void> {
  const tasks = abertosDoBot(estado, a.id).length;
  let levarTasks = false;
  if (tasks > 0 && mudaAIaDoBot(a, pedido)) {
    const escolha = await abrirPreviaDaTroca({ nomeDoBot: a.nome, destino: destinoDoPedido(pedido), tasks });
    if (escolha === null) return;
    levarTasks = escolha;
  }
  await agir(async () => {
    await api!.gravarInteligencia(a.id, levarTasks ? { ...pedido, levarTasks: true } : pedido);
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao", ...(levarTasks ? (["trabalhos"] as const) : [])] });
    depois?.();
  });
}

// ---- NOD-368: a seleção e a troca em lote de Configurações › Agentes ------------------------------------------------

/** Os bots ativos da pessoa (os da lista por time); ocultos, excluídos e os de outra pessoa ficam fora do lote. */
function botsAtivosDoLote(): BotGerido[] {
  const pessoaId = estado.sessao?.pessoaId;
  return (estado.gestao?.agentes ?? []).filter((a) => a.ownerId === pessoaId && !a.excluidoEm && !a.oculto);
}
/** Os visíveis pela busca: o "Selecionar todos" vale só para eles. */
const visiveisDoLote = (): string[] => botsAtivosDoLote().filter((a) => botCasaComBusca(a, estado.configUi.busca)).map((a) => a.id);
const gravarLote = (lote: LoteAgentes): void => dispatch({ tipo: "config-ui", mudanca: { lote } });

const depsDoLote: DepsDoLote = {
  lote: () => estado.configUi.lote,
  gravarLote,
  gravar: (id, acao) => (acao.tipo === "maquina" ? api!.maquinaDoBot(id, acao.destino || null) : api!.gravarInteligencia(id, pedidoDaIa(acao.destino))),
  // Revisão 1 (#7): a falha de rede vira a frase de ação não concluída (como no banner), não o "Reconectando…".
  fraseDoErro: (e) => { const erro = erroDe(e); return erro ? erroDaAcao(erro).mensagem : null; },
  textoMudando: (acao) => textoMudandoLote(estado, acao),
  textoDoResultado: (acao, ocupado) => textoDoResultadoLote(estado, acao, ocupado),
  invalidar: () => dispatch({ tipo: "invalidar", quais: ["frota", "gestao", "maquinas"] }),
  anunciar: (texto) => { const vivo = document.getElementById("anuncio-config"); if (vivo) vivo.textContent = texto; },
};

/**
 * Depois de fechar a barra, o foco não cai no <body>. Revisão 4: no computador vai à busca; no celular, a busca abriria o
 * teclado por cima das linhas (como em main.ts › "o campo espera o toque"), então vai ao "Selecionar" do topo. Sem rolar:
 * a pessoa continua vendo as linhas com "Mudando…" e o resultado.
 */
function focarDepoisDoLote(): void {
  requestAnimationFrame(() => {
    const alvo = ehCelular() ? "#espaco .cfg-agentes .lote-selecionar" : "#espaco .cfg-agentes [data-config-busca]";
    (document.querySelector<HTMLElement>(alvo) ?? document.querySelector<HTMLElement>("#espaco .cfg-agentes .lote-todos"))?.focus({ preventScroll: true });
  });
}

/**
 * Revisão 1 (#3): no fim da troca, se algo falhou e a pessoa não levou o foco a outro lugar (ele ficou na busca, onde o
 * confirmar o deixou, ou caiu no <body>), o foco vai ao primeiro "Tentar de novo".
 */
function focarFalhaDoLote(): void {
  requestAnimationFrame(() => {
    const ativo = document.activeElement;
    const parado = !ativo || ativo === document.body || (ativo as HTMLElement).matches?.("#espaco .cfg-agentes :is([data-config-busca], .lote-selecionar, .lote-todos)");
    if (parado) document.querySelector<HTMLElement>("#espaco .cfg-agentes .lote-tentar")?.focus({ preventScroll: true });
  });
}

/** Revisão 1 (#4): a contagem da barra é dita pelo nó fixo #anuncio-config a cada marca e desmarca. */
function anunciarSelecaoDoLote(): void {
  const ativos = new Set(botsAtivosDoLote().map((a) => a.id));
  const vivo = document.getElementById("anuncio-config");
  if (vivo) vivo.textContent = textoDaContagem(estado.configUi.lote.selecionados.filter((id) => ativos.has(id)).length);
}

function abrirSeletorDoLote(el: HTMLElement): void {
  if (el.getAttribute("aria-disabled") === "true") return;
  const qual = el.dataset.qual === "ia" ? "ia" : "maquina";
  const comum = valorComumLote(botsDoLote(estado, botsAtivosDoLote(), qual).map((b) => b.valor));
  gravarLote(abrirLote(estado.configUi.lote, qual, comum));
  // O foco entra no seletor (no marcado, ou na primeira opção que se pode escolher).
  if (estado.configUi.lote.aberto) requestAnimationFrame(() => (document.querySelector<HTMLElement>('.lote-pop [role="radio"][aria-checked="true"]') ?? document.querySelector<HTMLElement>('.lote-pop [role="radio"]:not([aria-disabled="true"])'))?.focus());
}

function fecharSeletorDoLote(): void {
  const qual = estado.configUi.lote.aberto;
  if (!qual) return;
  gravarLote({ ...estado.configUi.lote, aberto: null, escolha: null });
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`.lote-bt-${qual}`)?.focus());
}

/** Confirmar: só os que não estão no destino; a opção que ficou indisponível (máquina caiu) não grava. */
async function confirmarLote(): Promise<void> {
  const { aberto, escolha } = estado.configUi.lote;
  if (!aberto || escolha === null) return;
  const acao: AcaoLote = aberto === "maquina" ? { tipo: "maquina", destino: escolha } : { tipo: "ia", destino: escolha as IaDoLote };
  if (motivoDoDestinoIndisponivel(estado, acao) !== null) return;
  const { mudam } = previaDoLote(botsDoLote(estado, botsAtivosDoLote(), aberto), escolha);
  avisador.acaoPropria();
  const fim = executarLote(depsDoLote, mudam, acao);
  // Revisão 2/4: ao confirmar, o foco vai a um lugar estável (busca no computador, Selecionar no celular); o fim decide.
  focarDepoisDoLote();
  if ((await fim).erros > 0) focarFalhaDoLote();
}

/** Tentar de novo: refaz só aquele bot, com a mesma ação. */
async function tentarDeNovoNoLote(id: string): Promise<void> {
  const r = estado.configUi.lote.resultados[id];
  const a = botsAtivosDoLote().find((x) => x.id === id);
  if (r?.estado !== "erro" || !a || estado.configUi.lote.mudando) return;
  // Revisão 1 (#6): o destino guardado pode ter caído desde a falha; aí não manda o PUT e a linha diz o motivo de agora.
  const motivo = motivoDoDestinoIndisponivel(estado, r.acao);
  if (motivo !== null) {
    gravarLote({ ...estado.configUi.lote, resultados: { ...estado.configUi.lote.resultados, [id]: { estado: "erro", texto: `Não mudou: ${motivo}`, acao: r.acao } } });
    depsDoLote.anunciar(`${a.nome} não mudou: ${motivo}`);
    return;
  }
  avisador.acaoPropria();
  await executarLote(depsDoLote, [{ id, nome: a.nome, valor: "", ocupado: abertosDoBot(estado, id).length > 0 }], r.acao, { fecharSelecao: false });
  requestAnimationFrame(() => {
    const tentar = document.querySelector<HTMLElement>(`#espaco .cfg-agentes .lote-tentar[data-id="${CSS.escape(id)}"]`);
    (tentar ?? document.querySelector<HTMLElement>(`#espaco .cfg-agentes [data-act="lote-marcar"][data-id="${CSS.escape(id)}"]`))?.focus();
  });
}

/** ADR-108: a escolha no aviso de troca de IA; a linha relê pela conversa (o servidor grava o desfecho nela). */
function decidirTroca(el: HTMLElement, decisao: "esperar" | "levar" | "outra_ia"): Promise<void> {
  return agir(async () => {
    await api!.decidirTrocaDeIa(el.dataset.id ?? "", decisao, el.dataset.troca || undefined);
    const conversaId = el.dataset.conversa;
    dispatch({ tipo: "invalidar", quais: [...(conversaId ? [`conversa:${conversaId}` as Invalidacao] : []), "trabalhos", "frota"] });
  });
}

/** NOD-94: o controlador SSH só existe depois de criado (o primeiro render vem antes). */
let instalarSshPronto = false;

const OPCOES_DO_CARD_RITMO = ["espacar", "uteis", "pausar", "deixar", "desfazer"] as const;
function decidirRitmo(el: HTMLElement): Promise<void> {
  return agir(async () => {
    const opcao = OPCOES_DO_CARD_RITMO.find((o) => o === el.dataset.opcao);
    if (!opcao) return;
    await api!.decidirRitmoRotina(el.dataset.rotina ?? "", el.dataset.mensagem ?? "", opcao);
    const conversaId = el.dataset.conversa;
    dispatch({ tipo: "invalidar", quais: [...(conversaId ? [`conversa:${conversaId}` as Invalidacao] : []), "rotinas"] });
  });
}

/** NOD-449: depois de marcar ou desfazer, a lista, os pontos da barra e a conversa aberta (o card e o recibo do chat). */
function invalidarLeitura(): void {
  const t = estado.tela;
  const aberta = t.tipo === "conversa" || t.tipo === "sala" ? [`conversa:${t.conversaId}` as Invalidacao] : [];
  dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota", ...aberta] });
}

/** NOD-449: marca uma conversa como lida e mostra "X marcada como lida · Desfazer" (o Desfazer volta o "lido até" de antes). */
function marcarComDesfazer(conversaId: string, nome: string): Promise<void> {
  document.querySelector(`.nl-item[data-conversa="${CSS.escape(conversaId)}"]`)?.classList.add("nl-sai");
  return agir(async () => {
    try {
      const r = await api!.marcarLida(conversaId);
      mostrarAvisoDesfazer({ texto: fraseDoAviso([nome || "Conversa"]), aoDesfazer: () => agir(async () => { await api!.desfazerLeitura(r.leituras); invalidarLeitura(); }) });
    } finally {
      invalidarLeitura();
    }
  });
}

function marcarTudoComDesfazer(): Promise<void> {
  const nomePorId = new Map((estado.naoLidos?.conversas ?? []).map((c) => [c.conversaId, nomeDaConversa(c, estado)]));
  return agir(async () => {
    try {
      const r = await api!.marcarTudoLido();
      // Os nomes saem das leituras que o servidor marcou (revisão 2 do PR #616): se alguma não está na lista da tela, só a contagem.
      const nomes = r.leituras.map((l) => nomePorId.get(l.conversaId));
      if (r.leituras.length) mostrarAvisoDesfazer({ texto: nomes.every((n): n is string => Boolean(n)) ? fraseDoAviso(nomes as string[]) : fraseDaContagemNoAviso(r.leituras.length), aoDesfazer: () => agir(async () => { await api!.desfazerLeitura(r.leituras); invalidarLeitura(); }) });
    } finally {
      invalidarLeitura();
    }
  });
}

/** Roda uma mutação: marca ocupado, traduz o erro em código fechado (nunca err.message cru). */
// ------------------------------------------------------------------------------------------- ADA-241: acessos em lote

/** O conector aberto na gaveta do marketplace (ou null). */
function conectorDaGaveta(): Conector | null {
  const t = estado.tela;
  if (t.tipo !== "conectores" || !t.gaveta) return null;
  return conectorDoApp(estado, t.gaveta.slug) ?? null;
}

/** Busca o padrão do app e quem segue o padrão quando a gaveta abre (ou depois de um lote, do padrão, do Desfazer). */
function garantirAcessosDoApp(): void {
  // A caixa "Selecionar todos" com só parte marcada fica no estado misto (o HTML não tem atributo para isso).
  for (const i of document.querySelectorAll<HTMLInputElement>(".acessos-todos input[data-misto]")) i.indeterminate = true;
  const c = conectorDaGaveta();
  gavetaDeAcessos.abrir(c?.id ?? null);
  if (!c || !api || !gavetaDeAcessos.precisaCarregar(c.id)) return;
  void api.acessosDoApp(c.id).then(
    (r) => { gavetaDeAcessos.guardar(c.id, { padrao: r.padrao, seguePadrao: new Set(r.bots.filter((b) => b.segue_padrao).map((b) => b.agenteId)) }); render(); },
    () => gavetaDeAcessos.guardar(c.id, { padrao: "nenhum", seguePadrao: new Set() }),
  );
}

function recarregarAcessos(conectorId: string, agentes: readonly string[]): void {
  gavetaDeAcessos.esquecer(conectorId);
  dispatch({ tipo: "invalidar", quais: [...new Set(agentes)].map((id) => `concessoes:${id}` as Invalidacao).concat(["frota"]) });
}

/**
 * Critério 3: o nível dos pares aparece já no próximo desenho (síncrono, bem abaixo de 100 ms) e o pedido sai em seguida.
 * Erro: só os pares que ainda são deste clique voltam (o último clique vence) e o aviso diz o que houve.
 */
async function mudarNivelOtimista(pares: { agenteId: string; conectorId: string }[], nivel: "nenhum" | "leitura" | "escrita", pedir: () => Promise<unknown>): Promise<void> {
  avisador.acaoPropria();
  const seq = acessosNaTela.marcar(pares, nivel);
  render();
  try {
    // Na ordem dos cliques por par: o servidor aplica o último por último (revisão independente do PR #706).
    await acessosNaTela.emOrdem(pares, pedir);
    acessosNaTela.confirmar(pares, seq, Date.now());
    recarregarAcessos(pares[0]?.conectorId ?? "", pares.map((p) => p.agenteId));
  } catch (e) {
    if (acessosNaTela.reverter(pares, seq)) {
      render();
      const erro = erroDe(e);
      mostrarAvisoDesfazer({ texto: `Não deu para mudar o acesso${erro?.mensagem ? `: ${erro.mensagem}` : ""}. Voltou ao que era.` });
    }
  }
}

/** O lote: otimista em todos os alvos; no fim, o aviso com a frase do servidor e Desfazer (24 h no servidor). */
async function aplicarLoteDeAcessos(conectorId: string, nivel: "nenhum" | "leitura" | "escrita", bots: "todos" | string[], confirmado: boolean): Promise<void> {
  const c = estado.conectores.find((x) => x.id === conectorId);
  if (!c || !api) return;
  // "Todos" com Ler não rebaixa quem tem Ler e alterar ou personalizado (o servidor mantém, alvosDoLote); a tela também não.
  const alvos = (bots === "todos" ? meusBots(estado).map((a) => a.id) : bots).filter((id) => !(bots === "todos" && nivel === "leitura" && ["escrita", "personalizado"].includes(nivelReal(estado, id, c))));
  const pares = alvos.map((agenteId) => ({ agenteId, conectorId }));
  const chave = chaveDoClique();
  let lote: LoteDeAcessosDto | null = null;
  await mudarNivelOtimista(pares, nivel, async () => { lote = await api!.acessosEmLote(conectorId, { nivel, bots, chave, confirmado }); });
  const feito = lote as LoteDeAcessosDto | null;
  if (!feito) return;
  gavetaDeAcessos.limpar(conectorId);
  render();
  const loteId = feito.lote_id;
  mostrarAvisoDesfazer({ texto: feito.frase, ...(loteId ? { aoDesfazer: () => desfazerLoteDeAcessos(conectorId, loteId, alvos) } : {}) });
}

async function desfazerLoteDeAcessos(conectorId: string, loteId: string, alvos: readonly string[]): Promise<void> {
  try {
    const r = await api!.desfazerLoteDeAcessos(loteId);
    recarregarAcessos(conectorId, alvos);
    if (r.mudaram_depois.length) mostrarAvisoDesfazer({ texto: `Desfeito. ${r.mudaram_depois.map((b) => b.nome).join(", ")} ${r.mudaram_depois.length === 1 ? "mudou" : "mudaram"} depois e ${r.mudaram_depois.length === 1 ? "ficou" : "ficaram"} como está.` });
  } catch (e) {
    mostrarErro(e);
  }
}

async function definirPadraoDoApp(conectorId: string, nivel: "nenhum" | "leitura" | "escrita", confirmado: boolean): Promise<void> {
  const antes = gavetaDeAcessos.acessos(conectorId);
  // Otimista também: o segmentado do padrão acende na hora; erro volta ao de antes.
  gavetaDeAcessos.guardar(conectorId, { padrao: nivel, seguePadrao: antes?.seguePadrao ?? new Set() });
  render();
  try {
    const r = await api!.padraoDoApp(conectorId, { nivel, confirmado });
    recarregarAcessos(conectorId, r.aplicados.map((a) => a.agenteId));
    const n = r.aplicados.length;
    mostrarAvisoDesfazer({ texto: `Bots novos começam com ${ROTULO[nivel]}${n ? ` · ${n === 1 ? "1 bot passou" : `${n} bots passaram`} junto` : ""}` });
  } catch (e) {
    if (antes) gavetaDeAcessos.guardar(conectorId, antes);
    else gavetaDeAcessos.esquecer(conectorId);
    render();
    mostrarErro(e);
  }
}

function focarConfirmacao(): void {
  queueMicrotask(() => document.querySelector<HTMLElement>(".acessos-confirma [data-foco-inicial]")?.focus());
}

async function agir(fn: () => Promise<void>): Promise<void> {
  // O que nasce do próprio clique ela já sabe: nenhum aviso nos próximos 5 s (web/lib/avisador.ts).
  avisador.acaoPropria();
  dispatch({ tipo: "erro", erro: null });
  dispatch({ tipo: "ocupado", valor: true });
  try {
    await fn();
  } catch (e) {
    mostrarErro(e);
  } finally {
    // definido em 2026-09-21: 'ocupado' saía do catch ligado e travava os botões da tela até a próxima
    // ação bem-sucedida (visto no 409 do card de acesso: "Permitir acesso" ficava inerte depois do erro).
    dispatch({ tipo: "ocupado", valor: false });
  }
}

// ---------------------------------------------------------------------------------------------
// Reidratação: o reducer diz O QUE mudou; aqui busca-se por REST e despacha o hidratar.

/**
 * A última leitura de contas que falhou na conversa (revisão do PR 1, 2026-10-16). Sem ela, a falta de `contasIa` voltaria
 * a pedir a cada frame. definido em 2026-10-16: 60 s entre tentativas — o cabeçalho do menu fica sem a conta enquanto isso.
 */
let contasFalharamEm: number | null = null;
const ESPERA_CONTAS_MS = 60_000;

/**
 * NOD-370: a frota e a gestão lidas fora de ordem. A frota de uma leitura que começou antes da última aplicada é velha:
 * aplicá-la tiraria da tela o bot recém-criado (e, com a saída da conversa, levaria a pessoa para Início).
 */
const leituraDaFrota = criarUltimaLeitura();
const leituraDaGestao = criarUltimaLeitura();
async function buscarFrota(): Promise<Acao | null> {
  if (!api) return null;
  const vez = leituraDaFrota.comecar();
  let frota: Awaited<ReturnType<Api["frota"]>>;
  try {
    frota = await api.frota();
  } catch (e) {
    // Só a leitura mais nova mexe no aviso: uma antiga que falha depois de uma nova que deu certo não o liga.
    if (vez()) frotaFalhou = true;
    throw e;
  }
  if (!vez()) return null;
  frotaFalhou = false;
  // NOD-437: os recolhidos de antes vão para a conta (uma vez) e quem mudou de time pisca de leve na barra.
  if (frota.times) frota = { ...frota, times: migrarRecolhidos(frota) };
  sincronizarTimesSePreciso(frota);
  destacarMovidos(estado.frota?.agentes, frota.agentes);
  // NOD-20 (revisão 2 M6): o perfil do bot da gaveta mudou por fora com o Histórico aberto: a lista e o detalhe releem.
  const g = estado.gaveta;
  if (g && (g.nivel.tipo === "historico" || g.nivel.tipo === "versao" || g.nivel.tipo === "ajustes")) {
    const id = g.agenteId;
    if (perfilMudou(estado.frota?.agentes.find((a) => a.id === id), frota.agentes.find((a) => a.id === id))) {
      const nivel = g.nivel;
      setTimeout(() => { if (estado.gaveta?.agenteId === id && estado.gaveta.nivel.tipo === nivel.tipo) carregarAoAbrirNivel(id, estado.gaveta.nivel); }, 0);
    }
  }
  return { tipo: "hidratar-frota", frota };
}

async function buscar(q: Invalidacao): Promise<Acao | null> {
  if (!api) return null;
  const agora = Date.now();
  if (q === "gestao") { const vez = leituraDaGestao.comecar(); const gestao = await api.gestaoAgentes(); return vez() ? { tipo: "hidratar-gestao", gestao } : null; }
  if (q === "frota") return buscarFrota();
  if (q === "inventario") return { tipo: "hidratar-inventario", inventario: await api.inventario() };
  if (q === "executor") return { tipo: "hidratar-executor", executor: await api.executor() };
  // Plano das IAs (2026-10-10): servidor sem a rota (404, versão anterior) fica sem `ias`; a tela usa o catálogo do executor.
  if (q === "ias") return { tipo: "hidratar-ias", ias: await api.ias().catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return null; throw e; }) };
  // Plano "tela limpa" (2026-10-16, E6): o anel é informativo — falha fechada, como o onboarding (revisão do PR 1): servidor
  // sem a rota (404) ou erro fica sem o anel (o seletor mostra só o logo), sem faixa vermelha; com null os frames não
  // pedem de novo (reducer.ts, `usoPlano`), só a volta da janela ou da rede.
  if (q === "uso-plano") return { tipo: "hidratar-uso-plano", usoDoPlano: await api.usoDoPlano().catch(() => null) };
  if (q === "sua-vez") {
    // definido em 2026-09-24 ("aviso no Mac"): atrás, a leitura serve ao Dock e ao aviso, e não conta como vista.
    const ver = naFrente();
    // ADA-19: a falha fica marcada para a aba Sua vez do celular mostrar o erro com Tentar de novo.
    const suaVez = await api.suaVez(ver).catch((e: unknown) => { suaVezFalhou = true; if (celular.ativo() && abaDoInicio === "sua-vez") render(); throw e; });
    suaVezFalhou = false;
    suaVezSemVer = !ver;
    return { tipo: "hidratar-sua-vez", suaVez };
  }
  // NOD-382: a falha fica no estado, para o perfil do celular mostrar "—" e "As rotinas não carregaram · Tentar de novo".
  if (q === "rotinas") return { tipo: "hidratar-rotinas", rotinas: (await api.rotinas().catch((e: unknown) => { dispatch({ tipo: "rotinas-falharam" }); throw e; })).rotinas };
  if (q === "conectores") return { tipo: "hidratar-conectores", ...(await api.conectores()) };
  if (q === "salas") return { tipo: "hidratar-salas", salas: (await api.salas()).salas };
  if (q === "nao-lidos") return { tipo: "hidratar-nao-lidos", naoLidos: await api.naoLidos() };
  // ADR-083: servidor sem a rota (404) fica sem trabalhos — sem faixa, sem chip, sem ícone; nenhum erro sobe.
  if (q === "trabalhos") return { tipo: "hidratar-trabalhos", trabalhos: await api.trabalhos().catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return { trabalhos: [], pressao: null, memoriaTotalMb: null }; throw e; }), agora };
  if (q.startsWith("trabalho:")) {
    // Revisão W2 (2026-10-08): a task que sumiu (404) fecha a tela em vez de ficar "carregando" e pedir de novo.
    const id = q.slice(9);
    const detalhe = await api.trabalho(id).catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return null; throw e; });
    return detalhe ? { tipo: "hidratar-trabalho", detalhe, agora } : { tipo: "trabalho-sumiu", id };
  }
  if (q === "chaves") return { tipo: "hidratar-chaves", chaves: (await api.chaves()).chaves };
  // ADR-090: servidor sem a rota (404, versão anterior) fica sem máquinas; nenhum erro sobe.
  if (q === "maquinas") {
    relerEstaMaquina();
    return { tipo: "hidratar-maquinas", maquinas: await api.maquinas().catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return { maquinas: [], padraoId: null }; throw e; }) };
  }
  // NOD-367: a falha vira a linha "Tentar de novo" em Feedback, sem a faixa vermelha e sem pedir de novo a cada quadro.
  if (q === "agenda") {
    // NOD-85: lê a janela do estado; a resposta de uma janela que já mudou é ignorada no reducer.
    const janela = estado.agenda.janela;
    if (!janela) return null;
    const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return await api.agenda(inicioDoDia(janela.de), inicioDoDia(janela.ate), fuso).then((dto): Acao => ({ tipo: "hidratar-agenda", janela, dto }), (): Acao => ({ tipo: "agenda-falhou", janela }));
  }
  if (q === "relatos") return await api.relatos().then((r): Acao => ({ tipo: "hidratar-relatos", relatos: r.relatos }), (): Acao => ({ tipo: "hidratar-relatos", relatos: null, erro: true }));
  // ADR-121 (NOD-92): sem NOD_MAQUINA_NUVEM a rota dá 404 e a seção fica como antes. Outra falha mantém a última leitura
  // (ou fecha, se não havia): a nuvem é um extra da seção, nunca a quebra.
  if (q === "nuvem") {
    const anterior = estado.nuvem.conta;
    // Revisão NOD-92 (item 17): só o 404 desliga. Rede ou 5xx na primeira leitura deixa a conta por ler (null) e a seção
    // tenta de novo na próxima hidratação, em vez de esconder a nuvem até recarregar a página.
    const conta = await api.contaNuvem().catch((e: unknown) => (e instanceof ErroApi && e.status === 404) ? "desligada" as const : anterior);
    return { tipo: "nuvem-ui", mudanca: { conta } };
  }
  // ADR-102: servidor sem a rota (404, versão anterior) fica com a tela de antes.
  if (q === "contas") {
    // Revisão do PR 1 (2026-10-16): na conversa a lista só serve ao cabeçalho do seletor de IA (informativo) — a falha fica
    // fechada, sem faixa vermelha, e a conversa só tenta de novo depois de ESPERA_CONTAS_MS (`relevante`). Em Máquinas e
    // em Provedores de IA o erro continua aparecendo.
    const naTelaDeContas = secaoAberta(estado) === "maquinas" || secaoAberta(estado) === "conexao";
    const contas = await api.contasIa().catch((e: unknown): ContasIaDto | null => {
      if (e instanceof ErroApi && e.status === 404) return { disponivel: false, modo: "perguntar", contas: [] };
      if (naTelaDeContas) throw e;
      return null;
    });
    if (!contas) { contasFalharamEm = Date.now(); return null; }
    contasFalharamEm = null;
    const ponte = window.nodDesktop?.contas;
    const detalhes = ponte?.detalhes ? await ponte.detalhes().catch(() => null) : null;
    window.setTimeout(() => contasDaPessoa.aoHidratar(contas), 0);
    return { tipo: "hidratar-contas", contas, detalhes };
  }
  // ADR-077: falha fechada — sem a rota (ou com erro), o onboarding não abre e o app segue normal.
  if (q === "onboarding") return { tipo: "hidratar-onboarding", onboarding: await api.onboarding().catch(() => null) };
  if (q === "ligacao") {
    const local = telaLigacao.ativa();
    if (local) return { tipo: "ligacao-viva", viva: { ligacaoId: local.ligacaoId, agenteId: local.agenteId, conversaId: local.conversaId, local: true } };
    const { ligacao } = await api.ligacaoViva();
    const viva = ligacao && (ligacao.estado === "chamando" || ligacao.estado === "em_curso");
    return { tipo: "ligacao-viva", viva: viva ? { ligacaoId: ligacao.id, agenteId: ligacao.agenteId, conversaId: ligacao.conversaId, local: false } : null };
  }
  if (q.startsWith("disponibilidade:")) {
    const agenteId = q.slice(16);
    // Falha fechada: sem a resposta (rota ausente, erro), o botão "Ligar" não aparece — e nenhum erro sobe para a faixa.
    const disponibilidade = await api.disponibilidadeLigacao(agenteId).catch(() => null);
    return { tipo: "hidratar-disponibilidade-ligacao", agenteId, disponibilidade };
  }
  if (q.startsWith("conversa:")) {
    // Modo dev (0036): a faixa de cada resposta acompanha a conversa — o turno que acabou de assentar já tem Raio-X.
    void carregarRaioX(q.slice(9));
    const ate = ateDaBusca(q.slice(9));
    return { tipo: "hidratar-conversa", conversa: notarAlvoDaBusca(q.slice(9), ate, await api.conversa(q.slice(9), ate)), agora };
  }
  // QA do PR #302 (NOD-216): a conversa do bot que o dono diz trabalhando, lida fora da tela para a barra animar.
  if (q.startsWith("vivos:")) {
    const ate = ateDaBusca(q.slice(6));
    return { tipo: "hidratar-conversa", conversa: notarAlvoDaBusca(q.slice(6), ate, await api.conversa(q.slice(6), ate)), agora };
  }
  if (q.startsWith("memoria:")) {
    const r = await api.memorias(q.slice(8));
    return { tipo: "hidratar-memorias", agenteId: q.slice(8), memorias: r.memorias, ...(r.aRevisar === undefined ? {} : { aRevisar: r.aRevisar }) };
  }
  if (q.startsWith("diario:")) return { tipo: "hidratar-diario", agenteId: q.slice(7), pagina: await api.diarioMemoria(q.slice(7)) };
  if (q.startsWith("concessoes:")) return { tipo: "hidratar-concessoes", agenteId: q.slice(11), ...(await api.concessoes(q.slice(11))) };
  if (q.startsWith("execucoes:")) return { tipo: "hidratar-execucoes", rotinaId: q.slice(10), execucoes: (await api.execucoes(q.slice(10))).execucoes };
  // ADR-114 (chat limpo, PR 2): a página do dia da Atividade (404: servidor de antes ou bot de outra pessoa — fica
  // indisponível, sem faixa de erro) e o "N hoje", que é informativo: qualquer falha deixa a linha sem número.
  if (q.startsWith("atividade:")) {
    const [agenteId = "", dia = ""] = q.slice(10).split(":");
    const atividade = await api.atividade(agenteId, dia, fusoLocal()).catch((e: unknown) => { if (e instanceof ErroApi && e.status === 404) return null; throw e; });
    return { tipo: "hidratar-atividade", agenteId, dia, atividade };
  }
  if (q.startsWith("atividade-hoje:")) {
    const agenteId = q.slice(15);
    const dia = diaLocal(Date.now());
    // NOD-70: o "· N negadas" de Ajustes vem da contagem das Decisões de hoje (só do bot da pessoa; a rota é dela).
    const dono = estado.frota?.agentes.some((a) => a.id === agenteId && a.ownerId === estado.sessao?.pessoaId) ?? false;
    const [total, negadas] = await Promise.all([
      api.contagemAtividade(agenteId, dia, fusoLocal()).then((c) => c.total, () => null),
      dono ? api.decisoes(agenteId, { de: dia, fuso: fusoLocal(), limite: 1 }).then((d) => d.contagem.negada, () => null) : Promise.resolve(null),
    ]);
    return { tipo: "hidratar-atividade-hoje", agenteId, dia, total, negadas };
  }
  // NOD-70: a 1ª página da aba Decisões (404: indisponível, sem faixa; outra falha: o erro da aba, com Tentar de novo).
  if (q.startsWith("decisoes:")) {
    const chave = q.slice(9);
    const [agenteId = "", dia = "", filtro = "tudo"] = chave.split(":");
    const pagina = await api.decisoes(agenteId, { de: dia, fuso: fusoLocal(), desfecho: filtro }).catch((e: unknown) => (e instanceof ErroApi && e.status === 404 ? null : ("erro" as const)));
    return { tipo: "hidratar-decisoes", chave, pagina };
  }
  // NOD-326: a 1ª página da Biblioteca. Qualquer falha vira o estado de erro da aba (com Tentar de novo), sem faixa vermelha.
  if (q.startsWith("biblioteca:")) {
    const conversaId = q.slice(11);
    const sessao = estado.sessao;
    const cliente = api;
    // Revisão 1: a resposta de outra sessão (trocou a pessoa no caminho) não entra.
    const r = await lerSeAindaVale(() => cliente.biblioteca(conversaId), () => estado.sessao === sessao && api === cliente);
    return r.vale ? { tipo: "hidratar-biblioteca", conversaId, pagina: r.valor, seguinte: false } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Modo dev (definido em 2026-09-28, 0036). A preferência mora no servidor: o app desktop limpa o localStorage.

/** A meia-noite de hoje no relógio da pessoa: o "Hoje com o bot" do cabeçalho. */
function meiaNoite(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

async function carregarRaioX(conversaId: string): Promise<void> {
  if (!api || !estado.modoDev.ligado) return;
  try {
    dispatch({ tipo: "hidratar-raio-x", conversaId, raioX: await api.raioXDaConversa(conversaId, meiaNoite()) });
  } catch {
    // Telemetria: sem o Raio-X, a conversa segue igual e a faixa só não aparece.
  }
  // #191: a taxa de abertura das linhas do chat, por tipo, junto do custo (só no Modo dev; sem a rota, nada aparece).
  try {
    dispatch({ tipo: "hidratar-taxas-linhas", taxas: await api.taxasLinhas() });
  } catch {
    // Sem a taxa, o selo do Modo dev mostra só o custo.
  }
}

async function alternarModoDev(): Promise<void> {
  if (!api) return;
  const p = await api.gravarPreferencias({ modoDev: !estado.modoDev.ligado });
  dispatch({ tipo: "modo-dev", ligado: p.modoDev });
  aplicarModoDevNoComputador(p.modoDev);
  const c = conversaDaTela(estado);
  if (p.modoDev && c) await carregarRaioX(c.conversa.id);
}

/** ADR-111: liga ou desliga uma chave de experimento; vale a partir do próximo turno de qualquer bot da pessoa. */
async function alternarExperimento(chave: keyof Experimentos): Promise<void> {
  if (!api) return;
  const p = await api.gravarPreferencias({ experimentos: { [chave]: !estado.experimentos[chave] } });
  if (p.experimentos) dispatch({ tipo: "experimentos", experimentos: p.experimentos, quadroLiberado: p.quadroLiberado ?? false });
}

async function reidratar(): Promise<void> {
  if (!api || reidratando) return;
  const pendentes = [...new Set([...estado.invalidacoes, ...invalidacoesDaTela(estado)])];
  // Só o que a tela atual olha entra agora; o resto fica marcado para quando a tela abrir.
  const relevantes = pendentes.filter((q) => relevante(q) && !(q === "trabalhos" && releituraTrabalhos.pendente()) && !(daAtividade(q) && releituraAtividade.pendente()));
  // definido em 2026-09-30: nada relevante, nada a buscar nem a redesenhar. A conversa de outro bot fica marcada
  // até ser aberta, e antes cada frame caía aqui e redesenhava a tela inteira de forma síncrona.
  if (relevantes.length === 0) return;
  const telaAntes = estado.tela;
  // NOD-136: a leitura que voltou depois de outra sessão começar não conta para o link desta.
  const lerParaDeepLink = deepLink.leitor();
  reidratando = true;
  let lerDepois = false;
  let saiu = false;
  try {
    // definido em 2026-09-17: consumir antes do GET preserva frames recebidos durante a busca.
    estado = reduzir(estado, { tipo: "invalidacoes-tratadas", quais: relevantes });
    for (const [i, q] of relevantes.entries()) {
      try {
        const acao = await buscar(q);
        if (acao && reduzirVendoSaida(acao)) saiu = true;
        // NOD-136: o link `nod://` espera a frota e as salas da sessão (a conversa pode ser de uma sala).
        const lida = acao ? leituraConta(q, { acao: acao.tipo }) : null;
        if (lida) lerParaDeepLink(lida);
        if (acao?.tipo === "hidratar-sua-vez") canalAvisos.contador(avisador.atualizar(acao.suaVez));
        if (acao?.tipo === "hidratar-nao-lidos") {
          lerDepois = true;
          avisador.atualizarNaoLidos(acao.naoLidos);
        }
        if (acao?.tipo === "trabalho-sumiu") lembrarTaskAberta(estado.tela);
      } catch (e) {
        if (!(e instanceof ErroApi && e.status === 404)) {
          const erro = erroDe(e);
          if (erro && ehErroDeRede(erro)) {
            // NOD-136: falha de rede não conta para o link (leituraConta); a leitura volta com a rede.
            // Revisão NOD-215: a rede caiu depois das tentativas desta leitura. O resto da passada também cairia (cada
            // GET esperaria mais 8,5 s com `reidratando` preso): guarda esta e as que faltam para quando o nod voltar.
            for (const resto of relevantes.slice(i)) pendentesDeRede.add(resto);
            if (estado.erro === null || ehErroDeRede(estado.erro)) estado = reduzir(estado, acaoDoErro(erro));
            sonda.lembrar();
            break;
          }
          if (erro) estado = reduzir(estado, acaoDoErro(erro));
        }
        // Servidor sem salas (404) ou com erro que não é de rede: sem salas nesta sessão, o link não espera mais por elas.
        const lida = leituraConta(q, { erroDeRede: false });
        if (lida) lerParaDeepLink(lida);
      }
    }
    render();
  } finally {
    reidratando = false;
  }
  if (saiu) depoisDeSair();
  else if (lerDepois) lerConversaDaTela();
  // definido em 2026-09-28: a tela que mudou DURANTE a busca (clicar num bot com a primeira carga em andamento) também
  // pede o que lhe falta; antes a conversa esperava o próximo tique (15 s). Só quando a tela mudou: há falta que não se
  // resolve buscando (sem nenhuma sala, "salas" continua faltando) e voltaria a buscar sem parar.
  const telaMudou = estado.tela !== telaAntes && invalidacoesDaTela(estado).some((q) => relevante(q));
  // NOD-85 (Codex no PR 595): ir a um dia fora da janela durante a leitura troca a janela; a resposta velha é descartada
  // e a nova janela precisa ser lida já, não no próximo tique. agendaPorLer é falso depois de ler ou falhar: não gira.
  const agendaNova = agendaPorLer(estado.agenda) && invalidacoesDaTela(estado).includes("agenda");
  if (telaMudou || agendaNova || estado.invalidacoes.some((q) => relevante(q))) void reidratar();
}

function relevante(q: Invalidacao): boolean {
  const t = estado.tela;
  if (q === "uso-plano") return t.tipo === "conversa";
  if (sempreRelevante(q)) return true;
  if (q.startsWith("trabalho:")) return t.tipo === "trabalho" && t.id === q.slice(9);
  if (q.startsWith("disponibilidade:")) return t.tipo === "conversa" && t.agenteId === q.slice(16);
  const secao = secaoAberta(estado);
  if (q === "gestao") return secao === "agentes";
  if (q === "rotinas") return t.tipo === "rotinas" || t.tipo === "conversa" || secao === "rotinas";
  if (q === "agenda") return secao === "rotinas";
  if (q === "conectores") return t.tipo === "conectores" || t.tipo === "conversa" || t.tipo === "sala";
  if (q === "chaves") return secao === "maquinas";
  if (q === "maquinas") return secao === "maquinas" || secao === "agentes" || secao === "conexao" || t.tipo === "conversa" || t.tipo === "trabalho";
  if (q === "nuvem") return secao === "maquinas";
  if (q === "contas") return secao === "maquinas" || secao === "conexao" || ((t.tipo === "conversa" || t.tipo === "trabalho" || conversaAbertaTemNotaDeContas(estado)) && (contasFalharamEm === null || Date.now() - contasFalharamEm > ESPERA_CONTAS_MS));
  if (q === "relatos") return secao === "feedback";
  if (q.startsWith("conversa:")) return (t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha") && t.conversaId === q.slice(9);
  // NOD-58: a lista também com Ajustes aberto (o "N para revisar" da linha Memória); o histórico, só com a aba dele.
  if (q.startsWith("memoria:")) return t.tipo === "conversa" && estado.gaveta?.agenteId === q.slice(8) && (estado.gaveta.nivel.tipo === "memoria" || estado.gaveta.nivel.tipo === "ajustes");
  if (q.startsWith("diario:")) return t.tipo === "conversa" && estado.gaveta?.agenteId === q.slice(7) && estado.gaveta.nivel.tipo === "memoria" && estado.gaveta.nivel.aba === "historico" && (estado.frota?.agentes.some((a) => a.id === q.slice(7) && a.ownerId === estado.sessao?.pessoaId) ?? false);
  if (q.startsWith("concessoes:")) return t.tipo === "conversa" && t.agenteId === q.slice(11) ? true : t.tipo === "conectores";
  // 2026-09-21: o painel de detalhes (tela conversa) também mostra o histórico — é onde a pessoa
  // confere que uma rotina silenciosa (desfecho sem_novidade, que não escreve no chat) rodou.
  if (q.startsWith("execucoes:")) return t.tipo === "rotinas" || t.tipo === "conversa";
  // ADR-114: o "N hoje" só com o painel do bot à vista; a página, só com a Atividade dele aberta naquele dia.
  if (q.startsWith("atividade-hoje:")) return t.tipo === "conversa" && t.agenteId === q.slice(15) && painelVisivel();
  // NOD-326: só com a aba Biblioteca aberta, na visão geral da gaveta deste bot, e o painel à vista.
  if (q.startsWith("biblioteca:")) return t.tipo === "conversa" && t.conversaId === q.slice(11) && bibliotecaAberta(estado) && painelVisivel();
  if (q.startsWith("atividade:")) {
    const v = estado.atividadeVista;
    return t.tipo === "conversa" && estado.gaveta?.nivel.tipo === "atividade" && !!v && q.slice(10) === chaveDaAtividade(v.agenteId, v.dia);
  }
  if (q.startsWith("decisoes:")) {
    const v = estado.atividadeVista;
    return t.tipo === "conversa" && estado.gaveta?.nivel.tipo === "atividade" && v?.aba === "decisoes" && q.slice(9) === chaveDasDecisoes(v.agenteId, v.dia, v.desfecho);
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Render por regiões: sidebar | cabeçalho | timeline/tela | composer | rodapé.
//
// O rail (coluna de ícones Frota/Sua vez/Rotinas/Marketplace/Chaves) foi removido em 2026-09-18: era
// uma SEGUNDA navegação sobre a sidebar, contra o modelo de contatos do ADR-032. Nenhuma das cinco
// entradas era um lugar — Frota duplicava a sidebar, Sua vez já decide dentro da conversa, Rotinas e
// Marketplace são do bot (painel Detalhes) e Chaves é da conta ("Seu espaço"). As telas continuam
// existindo e roteáveis; o que saiu foi a entrada fixa.

/**
 * A barra lateral lê o estado pelo PARÂMETRO (que encobre o `estado` do módulo de propósito): ela é desenhada
 * por `lembrar` (web/lib/lembrar.ts), que só enxerga o que passa pelo parâmetro. O que ela lê de fora do
 * estado entra nos extras de `redesenharSidebar`.
 */
/** ADA-19: a aba Sua vez do celular — só "Precisa de você", com a mesma conta do sino (pedidosAbertos). */
function conteudoDaAbaSuaVez(estado: Estado): string {
  if (!estado.suaVez) return renderAbaSuaVez({ tipo: suaVezFalhou ? "erro" : "carregando" });
  const agora = Date.now();
  const linhas = itensDaAbaSuaVez(estado.suaVez, agora, estado.sessao?.pessoaId ?? "").map((l) => {
    const bot = botGerido(l.agenteId);
    return { ...l, mascote: bot ? iconeAgente(bot, "", "disponivel") : iconeAgente({ nome: l.quem, cor: "c-black", forma: "shape-pebble" }), hora: horaDaLinha(l.desde, agora, fusoLocal()), horaIso: new Date(l.desde).toISOString() };
  });
  return renderAbaSuaVez({ tipo: "pronta", linhas });
}

/** ADA-19: a aba Quadros do celular — os quadros da pessoa (GET /quadros) e os compartilhados com ela. */
function conteudoDaAbaQuadros(): string {
  if (quadrosDaAba.tipo !== "pronto") return renderAbaQuadros(quadrosDaAba);
  const { quadros } = quadrosDaAba;
  return renderAbaQuadros({
    tipo: "pronta",
    destino: destinoDaAbaQuadros(quadros, compartilhados),
    nomeDoBot: (id) => botGerido(id)?.nome ?? quadros.find((q) => q.agenteId === id)?.agenteNome ?? "",
    mascote: (id) => { const b = botGerido(id); return b ? iconeAgente(b) : iconeAgente({ nome: "?", cor: "c-black", forma: "shape-pebble" }); },
  });
}

function renderSidebar(estado: Estado): string {
  // NOD-379: no celular a barra é a tela inicial (topo do web, favoritos em grade, conversas como num mensageiro e a barra
  // flutuante de Buscar). O HTML do computador não muda.
  const ehCelular = celular.ativo();
  // NOD-119: na barra recolhida a etiqueta própria (web/lib/borda-barra.ts) substitui o title.
  const semTitle = !ehCelular && barraAtual.largura === "recolhida" && !(buscaAberta || termoBusca() !== "");
  const agentes = estado.frota?.agentes ?? [];
  const abertas = abertasPorAgente(estado);
  const perguntas = perguntasPorAgente(estado);
  const paradas = rotinasParadasPorAgente(estado);
  const t = estado.tela;
  const atual = (conversaId: string) => ((t.tipo === "conversa" || t.tipo === "sala") && t.conversaId === conversaId ? ' aria-current="true"' : "");
  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): os bots da pessoa se arrastam — para a grade (fixa), entre
  // seções ou para uma seção nova. Os da equipe não: fixar e seção são da dona.
  // ADR-081: o Nod não se arrasta — ele não entra em seção; topo e discreto são pelo menu dele.
  // NOD-379: no celular nada se arrasta (o iOS arrastaria no toque longo, que abre o menu).
  const arrastavel = (a: (typeof agentes)[number]) => (ehCelular ? "" : a.ownerId === estado.sessao?.pessoaId && a.papel !== "nod" ? ` draggable="true" data-arrastavel="${esc(a.id)}"` : "");
  const avisos = new Map(agentes.map((a): [string, AvisoBot] => [a.id, (abertas.get(a.id) ?? 0) > 0 ? "decisao" : perguntas.get(a.id) ? "pergunta" : temNovas(a.conversaId, estado) ? "nao-lido" : ""]));
  const avisoDe = (a: (typeof agentes)[number]): AvisoBot => avisos.get(a.id) ?? "";
  const linha = (a: (typeof agentes)[number], escondida = false) => {
    // definido em 2026-09-24 (revisão da interface): a linha só tem UM sinal, o ponto do próprio mascote.
    // A cor diz o tipo — âmbar decisão, azul pergunta, cinza mensagem não lida —; o mascote animado já
    // diz quando o bot trabalha. Selos ⚑, estrela de fixado e pontos soltos saíram.
    const perguntando = perguntas.get(a.id) ?? 0;
    // definido em 2026-09-24 (emenda da ADR-044): "rotina parada" (âmbar) quando uma rotina dele espera acesso.
    const nova = temNovas(a.conversaId, estado);
    const aviso = avisoDe(a);
    const rotuloAviso = aviso ? ` (${ESPERA[aviso]})` : "";
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    // NOD-216: a fila parada não esconde o aviso — ela é tão "parada" quanto o disponível.
    const estadoVisual = mascoteComAviso(mascote, aviso);
    // definido em 2026-09-24 (sidebar no estilo do Grok): o título vira um chip ao lado do nome e a linha de
    // baixo é a última mensagem; os estados que pedem ação (fora do ar, pergunta, rotina parada) ganham dela.
    // definido em 2026-10-04 (ADR-071): "Em ligação" ganha da última mensagem, discreto, com o fone.
    const emLigacao = estado.ligacaoViva?.agenteId === a.id;
    const subtitulo = emLigacao ? `<span class="sub-em-ligacao">${ICONE_LIGACAO.fone(12)}Em ligação</span>` : a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId ? '<span class="sub-fora-do-ar">computador fora do ar</span>' : perguntando ? SUBTITULO_ESPERANDO : paradas.has(a.id) ? SUBTITULO_ROTINA_PARADA : `<span${nova ? ' class="previa-nova"' : ""}>${esc(previaDoBot(a))}</span>`;
    // ADR-083 (#196, K8 variante 3): com trabalho aberto, o chip com o número e o ponto na cor do bot ao lado do nome.
    const chip = (a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : "") + sinalDoBot(estado, a);
    if (ehCelular) return linhaDoCelular(a, { escondida, aviso, nova, emLigacao, chip, estadoVisual, rotuloAviso, perguntando: perguntando > 0 });
    // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): sem ••• na linha nem no fixado — o menu do bot abre no
    // clique direito (ou Shift+F10). O nome inteiro, com o título, fica no title. ADR-125 (NOD-349): o ⋯ saiu do topo da
    // gaveta e mora aqui, à vista só no toque (sem clique direito); no mouse ele segue escondido.
    // NOD-119: na barra recolhida o chip vira anel ou ponto (data-estado-barra) e o resto do que a linha diz vai no aria-label.
    const foraDoAr = !!a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId;
    const estadoBarra = emLigacao ? "ligacao" : foraDoAr ? "fora" : paradas.has(a.id) ? "parada" : "";
    const extraAria = `${foraDoAr ? ", computador fora do ar" : ""}${!foraDoAr && paradas.has(a.id) ? ", rotina parada" : ""}${rotuloDoSinal(chip)}`;
    const nomeCompleto = a.titulo ? `${a.nome} · ${a.titulo}` : a.nome;
    const selecionado = selecaoBots.has(a.id);
    return `<div class="bot-row${escondida ? " escondida" : ""}${selecionado ? " selecionado" : ""}" data-bot-contexto="${esc(a.id)}"${selecionado ? ' aria-selected="true"' : ""}${arrastavel(a)}${estadoBarra ? ` data-estado-barra="${estadoBarra}"` : ""} data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="row"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}" data-etiqueta="${esc(nomeCompleto)}" aria-label="Abrir conversa com ${esc(a.nome)}${emLigacao ? " (em ligação)" : ""}${rotuloAviso}${esc(extraAria)}${selecionado ? ", selecionado" : ""}"${semTitle ? "" : ` title="${esc(nomeCompleto)}"`}>${iconeAgente(a, "", estadoVisual, aviso ? `data-aviso="${aviso}"` : "")}<span class="txt"><span class="nome-linha"><b>${esc(a.nome)}</b>${chip}</span>${subtitulo}</span></button><button type="button" class="bot-mais" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}" aria-haspopup="menu">⋯</button></div>`;
  };
  /**
   * NOD-379 (protótipo v3): a linha de mensageiro — mascote de 48, nome e título, a hora à direita e a prévia embaixo. Quando
   * o bot pede algo, a prévia ganha o prefixo ("Decisão:", "Pergunta:") e a linha fica em destaque; mensagem nova também.
   * O ⋯ fica só para o leitor de tela: o menu abre no toque longo.
   */
  const linhaDoCelular = (a: (typeof agentes)[number], o: { escondida: boolean; aviso: AvisoBot; nova: boolean; emLigacao: boolean; chip: string; estadoVisual: ReturnType<typeof mascoteComAviso>; rotuloAviso: string; perguntando: boolean }) => {
    const prefixo = PREFIXO_DO_PEDIDO[o.aviso];
    const previa = `<span class="inicio-previa">${prefixo ? `<i>${prefixo}</i> ` : ""}${esc(previaDoBot(a))}</span>`;
    const sub = o.emLigacao ? `<span class="sub-em-ligacao">${ICONE_LIGACAO.fone(12)}Em ligação</span>` : a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId ? '<span class="sub-fora-do-ar">computador fora do ar</span>' : !prefixo && paradas.has(a.id) ? SUBTITULO_ROTINA_PARADA : !prefixo && o.perguntando ? SUBTITULO_ESPERANDO : previa;
    const em = a.ultimaMensagem?.em;
    const hora = em ? `<time class="inicio-hora" datetime="${new Date(em).toISOString()}">${horaDaLinha(em, Date.now(), fusoLocal())}</time>` : "";
    const tom = prefixo ? " pede" : o.nova ? " nao-lida" : "";
    const busca = esc(`${a.nome} ${a.titulo}`.toLowerCase());
    return `<div class="bot-row inicio-linha${tom}${o.escondida ? " escondida" : ""}" data-bot-contexto="${esc(a.id)}" data-busca="${busca}"><button class="row" data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-busca="${busca}" aria-label="Abrir conversa com ${esc(a.nome)}${o.emLigacao ? " (em ligação)" : ""}${o.rotuloAviso}">${iconeAgente(a, "", o.estadoVisual, o.aviso ? `data-aviso="${o.aviso}"` : "")}<span class="txt"><span class="nome-linha"><b>${esc(a.nome)}</b>${o.chip}${hora}</span>${sub}</span></button><button type="button" class="bot-mais" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}" aria-haspopup="menu">⋯</button></div>`;
  };
  // definido em 2026-10-04 (web/lib/secoes.ts): a seção recolhe pelo título. Recolhida, ficam à vista o bot da conversa
  // aberta e os com problema (computador fora do ar, em ligação); os outros continuam no HTML, escondidos pelo CSS — a
  // busca os mostra (data-buscando, em filtrarBots) e o arrasto abre a seção para medir a posição deles.
  const pessoaId = estado.sessao?.pessoaId ?? "";
  const conversaAberta = t.tipo === "conversa" ? t.conversaId : null;
  const alertaDe = (a: (typeof agentes)[number]) => (!!a.computadorForaDoAr && a.ownerId === pessoaId) || estado.ligacaoViva?.agenteId === a.id;
  const secaoDeBots = (nome: string, chave: string, lista: typeof agentes, atributos: string) => {
    const bots = lista.map((a) => ({ conversaId: a.conversaId, aviso: avisoDe(a), alerta: alertaDe(a) }));
    const s = estadoDaSecao({ chave, recolhidas: secoesRecolhidas, conversaAberta, bots });
    // NOD-379: no celular a seção recolhida deixa à vista quem pede algo (o aviso fica na linha, não sobe para o título).
    const escondidos = ehCelular ? escondidosNoCelular(s.recolhida, bots) : s.escondidos;
    return `<section class="section"${atributos}${s.recolhida ? " data-recolhida" : ""}>${cabecalhoSecao(nome, chave, { recolhida: s.recolhida, total: lista.length, aviso: ehCelular ? "" : s.aviso })}${lista.map((a, i) => linha(a, escondidos[i])).join("")}</section>`;
  };
  // definido em 2026-09-24 (sidebar no estilo do Grok): fixados em grade de 4 — avatar grande, nome e o
  // título num chip. Mesmo aviso no mascote e o mesmo menu (clique direito / •••) da linha.
  const bloco = (a: (typeof agentes)[number], i: number) => {
    const aviso = avisoDe(a);
    // NOD-379: no celular, além dos 8 primeiros, só com "Ver todos" (ou buscando).
    const alem = ehCelular && i >= FAVORITOS_VISIVEIS && !favoritosTodos ? " alem-dos-visiveis" : "";
    const mascote = estadoMascoteNaConversa(estado, a.conversaId);
    const rotulo = aviso ? ` (${ESPERA[aviso]})` : "";
    const emLigacao = estado.ligacaoViva?.agenteId === a.id;
    const foraDoAr = !ehCelular && !!a.computadorForaDoAr && a.ownerId === estado.sessao?.pessoaId;
    const estadoBarra = ehCelular ? "" : emLigacao ? "ligacao" : foraDoAr ? "fora" : paradas.has(a.id) ? "parada" : "";
    const extraAria = ehCelular ? "" : `${emLigacao ? " (em ligação)" : ""}${foraDoAr ? ", computador fora do ar" : ""}${!foraDoAr && paradas.has(a.id) ? ", rotina parada" : ""}${rotuloDoSinal(sinalDoBot(estado, a))}`;
    const nomeCompleto = a.titulo ? `${a.nome} · ${a.titulo}` : a.nome;
    return `<div class="fixado${emLigacao ? " em-ligacao" : ""}${alem}" data-bot-contexto="${esc(a.id)}"${arrastavel(a)}${estadoBarra ? ` data-estado-barra="${estadoBarra}"` : ""} data-busca="${esc(`${a.nome} ${a.titulo}`.toLowerCase())}"><button class="fixado-bt"${atual(a.conversaId)} data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}" data-etiqueta="${esc(nomeCompleto)}" aria-label="Abrir conversa com ${esc(a.nome)}${rotulo}${esc(extraAria)}"${semTitle ? "" : ` title="${esc(nomeCompleto)}"`}>${iconeAgente(a, "lg", mascoteComAviso(mascote, aviso), aviso ? `data-aviso="${aviso}"` : "")}<b>${esc(a.nome)}</b>${emLigacao ? `<i class="chip chip-em-ligacao">${ICONE_LIGACAO.fone(11)}Em ligação</i>` : sinalDoBot(estado, a) || (a.titulo ? `<i class="chip">${esc(a.titulo)}</i>` : "")}</button><button type="button" class="bot-mais bot-mais-fixado" data-act="menu-agente" data-id="${esc(a.id)}" aria-label="Ações de ${esc(a.nome)}" aria-haspopup="menu">⋯</button></div>`;
  };
  // definido em 2026-10-07 (ADR-081): o Nod nunca entra numa seção. Fixado, é o primeiro da grade; desafixado (discreto),
  // vira o botão com o logo e o nome na barra de cima, à esquerda da lupa (canvas "Nod — bot fixo", Alt E).
  // NOD-450: a regra de onde cada bot mora é pura (web/lib/secoes.ts, gruposDaBarra), para o teste provar a barra.
  // NOD-379 (suposição registrada no PR): no celular não há barra de cima para o Nod discreto; ele é sempre o primeiro favorito.
  const { meus, nod, comuns, fixados, equipe: daEquipe } = gruposDaBarra(agentes, pessoaId, ehCelular);
  const grade = !meus.length ? "" : ehCelular
    ? gradeDoCelular(fixados.map(bloco).join(""), fixados.length)
    : `<section class="fixados" aria-label="Fixados" data-grupo="fixados"${fixados.length ? "" : " data-vazio"}>${fixados.map(bloco).join("")}${fixados.length ? "" : '<p class="fixados-vazio">Solte aqui para fixar</p>'}</section>`;
  // NOD-437 (protótipo aprovado): as seções viraram times, na ordem da conta; o Sem time é um deles (sozinho, sem
  // cabeçalho). Cada time é um alvo de soltar (data-grupo); o "+ Novo time" fica sempre à vista, no fim, e também recebe
  // o bot arrastado (cria o time com ele).
  const times = timesComBots(comuns.filter((a) => !a.fixado), estado.frota?.times);
  const blocoDoTime = (tm: TimeDaBarra<(typeof agentes)[number]>, i: number) => {
    const lista = tm.bots.map((a) => ({ conversaId: a.conversaId, aviso: avisoDe(a), alerta: alertaDe(a) }));
    const s = estadoDaSecao({ chave: "t", recolhidas: tm.recolhido ? new Set(["t"]) : new Set(), conversaAberta, bots: lista });
    const escondidos = ehCelular ? escondidosNoCelular(s.recolhida, lista) : s.escondidos;
    const cab = tm.id && edicaoTime?.alvo === tm.id
      ? campoDoNome({ alvo: edicaoTime.alvo, valor: edicaoTime.valor, aviso: avisoDoNome(edicaoTime.valor, times, tm.id)?.texto ?? null })
      : comCabecalho(tm, times.length) ? cabecalhoDoTime(tm, { indice: i, total: times.length, bots: tm.bots.length, aviso: ehCelular ? "" : s.aviso, arrastavel: !ehCelular }) : "";
    const vazio = !tm.bots.length && !tm.semTime ? `<p class="time-vazio">${esc(textoDoVazio(ehCelular))}</p>` : "";
    const rotulo = comCabecalho(tm, times.length) ? "" : ` aria-label="${esc(nomeDoTime(tm))}"`;
    return `<section class="section time" data-grupo="secao" data-secao="${esc(tm.semTime ? "" : tm.nome)}"${tm.id ? ` data-time-id="${esc(tm.id)}"` : ""}${tm.semTime && !tm.bots.length ? " data-vazio" : ""}${s.recolhida ? " data-recolhida" : ""}${rotulo}>${cab}${vazio}${tm.bots.map((a, j) => linha(a, escondidos[j])).join("")}</section>`;
  };
  const novoTime = edicaoTime?.alvo === "novo" ? `<section class="section time time-novo">${campoDoNome({ alvo: "novo", valor: edicaoTime.valor, aviso: avisoDoNome(edicaoTime.valor, times)?.texto ?? null })}</section>` : "";
  const selecao = selecaoBots.size && !ehCelular ? `<div class="selecao-rodape" role="toolbar" aria-label="Bots selecionados"><span>${textoDaSelecao(selecaoBots.size)}</span><button type="button" data-act="mudar-time-selecao" aria-haspopup="menu">Mudar de time…</button><button type="button" class="selecao-limpar" data-act="limpar-selecao" aria-label="Limpar seleção">✕</button></div>` : "";
  const bots = meus.length ? times.map(blocoDoTime).join("") + novoTime + `<button type="button" class="novo-time nova-secao-alvo" data-act="novo-time" data-grupo="nova-secao"${novoTime ? " hidden" : ""}>+ Novo time</button>` + selecao : "";
  const avisoNod = nod ? avisoDe(nod) : "";
  const nodDiscreto = nod && !nod.fixado && !ehCelular
    ? `<button class="nod-topo" data-bot-contexto="${esc(nod.id)}"${atual(nod.conversaId)} data-act="abrir-conversa" data-conversa="${esc(nod.conversaId)}" data-agente="${esc(nod.id)}" aria-label="Abrir o Nod${avisoNod ? ` (${ESPERA[avisoNod]})` : ""}" title="Nod">${LOGO_NOD}<span>Nod</span>${avisoNod ? `<span class="nod-topo-aviso" data-aviso="${avisoNod}" aria-hidden="true"></span>` : ""}</button>`
    : "";
  const deOutras = secaoDosCompartilhados(compartilhados, { aberto: t.tipo === "quadro-compartilhado" ? t.quadroId : null, celular: ehCelular });
  const equipe = (daEquipe.length ? secaoDeBots("Agentes da equipe", chaveDaSecao(pessoaId, null), daEquipe, "") : "") + deOutras;
  // definido em 2026-10-04: a seção Salas saiu da barra — só poluía. As salas voltam como uma feature pensada na
  // jornada inteira; até lá, a tela da sala continua existindo e abre por Não lidos e pelos avisos.

  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): o banco persistente é o de todo dia e foi para o rodapé do
  // menu da conta; o efêmero e o não identificado continuam na barra, porque pedem atenção.
  const ambiente = ambienteBanco && ambienteBanco.regime !== "persistente"
    ? `<div class="ambiente-banco ambiente-${esc(ambienteBanco.regime)}" role="status" title="Banco usado por esta instância do Nod"><span></span>${ambienteBanco.regime === "efemero" ? "Efêmero" : "Banco não identificado"}${ambienteBanco.porta ? ` · DB ${ambienteBanco.porta}` : ""}</div>`
    : "";
  // Sem o rail e sem o inventário na tela inicial, o rodapé é o ÚNICO lugar sempre visível que pode
  // avisar que o motor não está pronto (ADR-029: falha vira estado escrito, nunca só um ícone).
  const inv = inventarioEmUso(estado);
  const falhaMotor = !!inv && inv.estado !== "pronto";
  const avisoUso = avisoDoUso();
  // Jornada C: com mensagem guardada sem IA (NOD_ONBOARDING_TEXTO=1), o aviso é um botão que leva ao card na conversa
  // (a do Nod primeiro); sem ela, o aviso de sempre.
  const aguardando = conversaAguardandoIa(Object.fromEntries(Object.entries(estado.conversas).map(([k, c]) => [k, c ? { mensagens: c.mensagens } : undefined])), iasNoCard(estado), turnosVivosDe(estado), nod?.conversaId);
  const agenteAguardando = aguardando ? (estado.frota?.agentes ?? []).find((a) => a.conversaId === aguardando.conversaId) : undefined;
  const situacaoMotor = !estado.executor
    ? "Verificando conexão…"
    : falhaMotor
      ? situacaoMotorFora(inv, estado.executor.atual)
      : estado.executor.atual === "catcher"
        ? "Modo de simulação"
        : "Sua IA conectada";
  const avisoDoMotor = agenteAguardando && aguardando
    ? botaoDaBarraSemIa(aguardando.conversaId, agenteAguardando.id)
    : falhaMotor ? avisoDeEstado({ tom: "alerta", texto: situacaoMotor, papel: "status", classe: "aviso-compacto", acao: botao("secao-espaco", motorDesatualizado(estado) ? "Atualizar" : "Conectar", { classe: "pri sm", dados: { secao: "conexao" } }) }) : "";
  // definido em 2026-09-24 (sidebar no estilo do Grok): sem marca e sem título — o topo tem só busca,
  // sino e +. A busca é um ícone; o campo aparece ao clicar, com ⌘K, ou enquanto tem texto.
  const buscando = buscaAberta || termoBusca() !== "";
  // definido em 2026-09-29 (0039, canvas "Não lidos"): o ícone só existe com algo não lido (ou com a tela aberta).
  const comNovas = (estado.naoLidos?.conversas ?? []).some((c) => temNovas(c.conversaId, estado));
  const naoLidos = comNovas || t.tipo === "nao-lidos"
    ? `<button class="icone-topo nao-lidos-bt" data-act="navegar" data-tela="nao-lidos" aria-current="${t.tipo === "nao-lidos" ? "page" : "false"}" aria-label="${esc(rotuloNaoLidos(estado))}" title="Não lidos">${BANDEJA}${comNovas ? '<span class="ponto-novo" aria-hidden="true"></span>' : ""}</button>`
    : "";
  if (ehCelular) {
    // O Nod está sempre lá: "vazio" é não ter nenhum outro bot (ele fica na grade, acima do convite).
    const lista = estadoDaLista({ temFrota: !!estado.frota, falhou: frotaFalhou, bots: comuns.length + daEquipe.length });
    const meio = lista === "carregando" ? ESQUELETO_DO_INICIO
      : lista === "vazia" ? `${grade}${INICIO_VAZIO}${deOutras}`
      : lista === "erro" ? ""
      : `${grade}${bots}${equipe}`;
    // O erro com cache fica acima da lista; sem cache, é tudo o que há.
    const erroFrota = frotaFalhou ? '<p class="inicio-aviso" role="status">Não deu para carregar seus bots · <button type="button" class="inicio-link" data-act="tentar-frota">Tentar de novo</button></p>' : "";
    return `<div class="inicio-topo">
      <button class="me me-topo${falhaMotor ? " me-falha" : ""}" data-act="menu-conta" aria-haspopup="menu" aria-expanded="${estado.espaco ? "true" : "false"}" aria-label="Menu da conta: ${esc(situacaoMotor)}${avisoUso ? ` · ${esc(avisoUso.resumo)}` : ""}"><span class="av-me">eu</span>${avisoUso ? '<span class="me-ponto" aria-hidden="true"></span>' : ""}</button>
      ${renderTituloCompacto(abaDoInicio)}
      <span class="inicio-topo-acoes">${renderIconeTrabalhos(estado)}<button class="create-trigger" data-act="navegar" data-tela="novo-bot" aria-label="Nova conversa">${MAIS}</button></span>
    </div>
    ${renderIncidentes(estado)}
    ${ambiente}
    ${avisoDoMotor}
    <div class="list" data-aba="${abaDoInicio}">
      ${renderTituloGrande(abaDoInicio)}
      ${abaDoInicio === "sua-vez" ? conteudoDaAbaSuaVez(estado) : abaDoInicio === "quadros" ? conteudoDaAbaQuadros() : `${erroFrota}${meio}`}
    </div>
    ${renderTabBar(abaDoInicio, { pedidos: contagemDaAbaSuaVez(estado.suaVez), naoLidas: comNovas })}`;
  }
  const html = `<div class="search-wrap">
      <div class="sh">${nodDiscreto}<button class="icone-topo" data-act="abrir-busca" aria-label="Buscar agentes" aria-keyshortcuts="Meta+K Control+K" title="Buscar (⌘K)">${LUPA}</button>${naoLidos}${renderIconeTrabalhos(estado)}${renderChamada(estado)}<span class="create-actions"><button class="create-trigger" data-act="navegar" data-tela="novo-bot" data-segurar="segurar-mais" aria-label="Nova conversa (segure para criar um bot direto)" aria-keyshortcuts="${ATALHO_NOVO_BOT.aria} Shift+Enter Shift+Space" title="Nova conversa (${ATALHO_NOVO_BOT.texto})"><span class="segurar-anel" aria-hidden="true"></span>+</button></span></div>
      <label class="search"${buscando ? "" : " hidden"}><span>⌕</span><input id="busca-bots" placeholder="Buscar agentes…" aria-label="Buscar agentes" autocomplete="off" /><kbd>esc</kbd></label>
    </div>
    ${renderIncidentes(estado)}
    <div class="list">
      ${grade}
      ${bots || listaVaziaDaBarra({ falhou: frotaFalhou, temFrota: !!estado.frota, botsDaEquipe: daEquipe.length }, SILHUETAS_DA_BARRA)}
      ${equipe}
    </div>
    ${ambiente}
    ${avisoDoMotor}
    <div class="rodape">
      <button class="me${falhaMotor ? " me-falha" : ""}" data-act="menu-conta" aria-haspopup="menu" aria-expanded="${estado.espaco ? "true" : "false"}"${falhaMotor ? ' data-etiqueta="Sua IA não está conectada"' : ""} aria-label="Menu da conta: ${esc(situacaoMotor)}${avisoUso ? ` · ${esc(avisoUso.resumo)}` : ""}" title="Menu da conta · ${esc(situacaoMotor)}${avisoUso ? ` · ${esc(avisoUso.resumo)}` : ""}"><span class="av-me">eu</span>${falhaMotor ? '<span class="me-fora" aria-hidden="true">!</span>' : avisoUso ? '<span class="me-ponto" aria-hidden="true"></span>' : ""}<span class="me-conexao conexao-${esc(estado.conexao.estado)}" title="eventos ao vivo: ${esc(estado.conexao.estado)}"></span></button>
      <button class="marketplace-bt" data-act="navegar" data-tela="conectores" aria-current="${t.tipo === "conectores" ? "true" : "false"}" data-etiqueta="Marketplace">${LOJA}<span class="marketplace-nome">Marketplace</span></button>
    </div>`;
  // NOD-119: na barra recolhida nenhum title nativo (a etiqueta escura o substitui; dois balões juntos confundem).
  return semTitle ? html.replace(/ title="[^"]*"/g, "") : html;
}

/** NOD-119: o que o chip de trabalhos diz (o aria-label dele), para o aria-label do bot quando a barra está recolhida. */
function rotuloDoSinal(html: string): string {
  const m = /class="chip-trab[^"]*"[^>]*aria-label="([^"]*)"/.exec(html) ?? /aria-label="([^"]*)"/.exec(html);
  return m ? `, ${m[1]}` : "";
}

/** NOD-119: o carregando da barra — silhuetas de mascote no tamanho da densidade, nunca "Nenhum agente visível". */
const SILHUETAS_DA_BARRA = `<div class="silhuetas-barra" role="status" aria-label="Carregando seus bots">${'<span class="silhueta-barra" aria-hidden="true"><i></i><b></b></span>'.repeat(6)}</div>`;

// NOD-379: o ‹ da conversa volta à inicial do celular (era o ☰ da gaveta).
const MENU = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

/** NOD-380: a lupa do topo da conversa no celular abre a busca em tela cheia. No computador o CSS a esconde. */
function botaoBuscarCelular(): string {
  return `<button type="button" class="buscar-celular" data-act="abrir-busca" aria-label="Buscar bots, salas e mensagens">${LUPA}</button>`;
}

// O ‹ da pílula é o do protótipo nod-381 (22 px, traço 2).
const VOLTAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';

/**
 * NOD-381 + NOD-379: na conversa o ‹ é o círculo de vidro à esquerda da pílula (`voltar-bots`); no celular ele volta à
 * tela inicial (era o ☰ da gaveta). No computador não aparece (`.abrir-bots` é escondido fora do celular, web/mobile.css).
 */
function botaoAbrirBots(naConversa = false): string {
  // ADA-19: na conversa, segurar o ‹ abre as recentes (Shift+Enter ou o menu de contexto também); o leitor de tela tem o
  // botão "Recentes" logo depois, só para ele.
  if (!naConversa) return `<button type="button" class="abrir-bots" data-act="abrir-bots" aria-label="Voltar ao início">${MENU}</button>`;
  return `<button type="button" class="abrir-bots voltar-bots" data-act="abrir-bots" aria-label="Voltar para Conversas (segure para as recentes)" aria-keyshortcuts="Shift+Enter">${VOLTAR}</button>${celular.ativo() ? '<button type="button" class="sr-only abrir-recentes-leitor" data-act="abrir-recentes">Recentes</button>' : ""}`;
}

/**
 * NOD-215: o erro de rede é um aviso discreto "Reconectando…" (tom neutro, sem ×: some sozinho quando o SSE volta a
 * `aberto` ou a próxima chamada dá certo). Os outros seguem no banner; o `erro_da_tela` ganha "Relatar", que abre a
 * conversa com o Nod (é ele quem registra relato sem mensagem apontada, 0062). "Detalhes" traz tipo, rota, status e
 * correlation_id (ADR-041), nunca err.message.
 */
function htmlDoErro(e: ErroNaTela): string {
  const detalhes = `<details class="erro-detalhe"><summary>Detalhes</summary><code>${esc(detalhesDoErro(e))}</code></details>`;
  if (ehErroDeRede(e)) {
    return avisoDeEstado({ tom: "info", titulo: "Reconectando…", texto: e.mensagem, extra: detalhes, papel: "status", classe: "aviso-compacto aviso-reconectando" });
  }
  const nod = e.codigo === "erro_da_tela" ? (estado.frota?.agentes ?? []).find((a) => a.papel === "nod" && a.ownerId === estado.sessao?.pessoaId) : undefined;
  const relatar = nod ? ` ${botao("abrir-conversa", "Relatar", { classe: "sm", dados: { conversa: nod.conversaId, agente: nod.id } })}` : "";
  return `<div class="erro" role="alert">${esc(e.mensagem)}${relatar} ${botao("fechar-erro", "×", { classe: "sm" })}${detalhes}</div>`;
}

/**
 * NOD-42 (definido em 2026-10-28): a busca na conversa (⌘F) mora na pílula do topo (web/telas/busca-na-conversa.ts). Só
 * na conversa, na sala e na task; trocar de tela fecha. O "desde" é a mensagem mais antiga carregada (a janela de 200).
 */
const buscaNaConversa = criarBuscaNaConversa({
  raiz: () => document.getElementById("timeline"),
  desde: desdeDaBusca,
  reduzido: movimentoReduzido,
  // No celular o foco abriria o teclado: lá o foco não vai ao campo de mensagem.
  // No celular o foco volta à pílula do bot (não abre o teclado, e o leitor de tela não perde a posição).
  aoFechar: () => {
    const alvo = celular.ativo() ? document.querySelector<HTMLElement>("#cabecalho .pilula-bot:not(.bnc-pb)") : document.getElementById("composer-texto");
    alvo?.focus({ preventScroll: true });
  },
});
let telaDaBusca: string | null = null;
// Editar › Buscar no menu do Mac: o clique chega aqui; fora da conversa, não faz nada (como o ⌘F).
const passaDoEco = criarFiltroDeEco();
/** ⌘F/⌘G pela tecla ou pelo menu. O eco da outra via (a mesma tecla, no Mac) não anda de novo. */
function acaoDaBusca(acao: "abrir" | "proxima" | "anterior", via: ViaDaBusca["via"]): void {
  if (!passaDoEco({ acao, via, em: performance.now() })) return;
  if (acao !== "abrir" && buscaNaConversa.aberta()) buscaNaConversa.navegar(acao === "proxima" ? 1 : -1);
  else abrirBuscaNaConversa();
}
window.nodDesktop?.aoBuscar?.((acao) => {
  if (podeBuscarNaConversa()) acaoDaBusca(acao, "menu");
});

function chaveDaTelaDeBusca(): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala") return `${t.tipo}:${t.conversaId}`;
  if (t.tipo === "trabalho") return `trabalho:${t.id}`;
  return null;
}

function desdeDaBusca(): Date | null {
  const c = conversaDaTela(estado);
  if (!c || c.mensagens.length === 0) return null;
  let menor = Infinity;
  for (const m of c.mensagens) if (m.criadoEm < menor) menor = m.criadoEm;
  return Number.isFinite(menor) ? new Date(menor) : null;
}

/** ⌘F abre? Só com a conversa, a sala ou a task na frente: sem diálogo, sem Seu espaço e sem a ligação em tela cheia. */
function podeBuscarNaConversa(): boolean {
  return chaveDaTelaDeBusca() !== null && !camadaSobreABusca();
}

/** Seu espaço, ligação em tela cheia, onboarding ou um diálogo cobrem a conversa (o `.app` fica inerte). */
function camadaSobreABusca(): boolean {
  // A busca geral do celular (NOD-380) e a inicial dos bots (NOD-379) também cobrem a conversa.
  return !!estado.espaco || telaLigacao.cheia() || telaOnboarding.cobre() || !!document.querySelector("dialog:modal")
    || !!document.querySelector(".busca-celular:not(.saindo)") || celular.botsAbertos();
}

function abrirBuscaNaConversa(): void {
  telaDaBusca = chaveDaTelaDeBusca();
  // NOD-429: a busca é na conversa; aberta no modo Quadro, a conversa volta à vista antes.
  quadroNaTela.trocar("conversa");
  document.getElementById("cabecalho")?.classList.remove("bnc-dica"); // a dica "⌘F busca" não fica dentro da busca aberta
  buscaNaConversa.abrir(document.getElementById("cabecalho"));
}

// ---- NOD-42: a descoberta (uma vez) e o gesto da pílula no celular ----------------------------------------------------
const marcasDaBusca: Marcas = { ler: (k) => localStorage.getItem(k), gravar: (k, v) => localStorage.setItem(k, v) };
let dicaVista = lerMarca(marcasDaBusca, MARCA_DICA);
let cutucaoVisto = lerMarca(marcasDaBusca, MARCA_CUTUCAO);
const NO_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const ATALHO_DA_BUSCA = NO_MAC ? "⌘F" : "Ctrl+F";

/** "⌘F busca" na pílula por 3 s, na primeira conversa longa (computador). A classe fica no #cabecalho: sobrevive ao render. */
function talvezMostrarDicaDaBusca(): void {
  if (dicaVista || celular.ativo() || estado.tela.tipo !== "conversa" || buscaNaConversa.aberta()) return;
  const area = document.getElementById("timeline");
  const cab = document.getElementById("cabecalho");
  if (!area || !cab) return;
  if (!deveMostrarDica({ jaMostrou: dicaVista, celular: celular.ativo(), conteudo: area.scrollHeight, area: area.clientHeight })) return;
  dicaVista = true;
  gravarMarca(marcasDaBusca, MARCA_DICA);
  cab.style.setProperty("--bnc-dica", JSON.stringify(`${ATALHO_DA_BUSCA} busca`));
  cab.classList.add("bnc-dica");
  window.setTimeout(() => cab.classList.remove("bnc-dica"), DICA_MS);
}

/** Celular: a pílula desce 6 px uma vez, na primeira rolagem longa para trás (nunca com movimento reduzido). */
document.getElementById("timeline")?.addEventListener("scroll", (ev) => {
  if (cutucaoVisto || estado.tela.tipo !== "conversa" || buscaNaConversa.aberta()) return;
  const area = ev.currentTarget as HTMLElement;
  const distanciaDoFim = area.scrollHeight - area.scrollTop - area.clientHeight;
  if (!deveCutucar({ jaCutucou: cutucaoVisto, celular: celular.ativo(), reduzido: movimentoReduzido(), distanciaDoFim, area: area.clientHeight })) return;
  const botao = document.querySelector<HTMLElement>("#cabecalho .pilula-bot:not(.bnc-pb)");
  // Com o quadro, a pílula é a cápsula inteira (o bot e o segmento): ela desce junto.
  const pilula = botao?.closest<HTMLElement>(".qd-pil") ?? botao;
  if (!pilula) return;
  cutucaoVisto = true;
  gravarMarca(marcasDaBusca, MARCA_CUTUCAO);
  pilula.classList.add("bnc-cutuca");
  pilula.addEventListener("animationend", () => pilula.classList.remove("bnc-cutuca"), { once: true });
}, { passive: true });

/**
 * ADA-8: o menu do segurar na pílula (o reconhecedor é web/lib/gesto-da-pilula-na-tela.ts): "Buscar na conversa" e,
 * com mais de uma página, cada página na ordem da pílula, com a atual marcada. Escolher uma página vai a ela.
 */
function abrirMenuDaPilula(ancora: HTMLElement, itens: readonly ItemDoMenuDaPilula[], irPara: (posicao: number) => void): void {
  const lupa = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  const botoes = itens.map((it) => it.tipo === "buscar"
    ? `<button type="button" role="menuitem" data-pilula="buscar">${lupa}Buscar na conversa</button>`
    : `<button type="button" role="menuitemradio" data-pilula="pagina" data-pos="${it.pos}" aria-checked="${it.atual}">${esc(it.nome)}</button>`).join("");
  const d = dialogo(`<div role="menu" aria-label="Conversa">${botoes}</div>`, true);
  d.classList.add("menu-pilula");
  const r = ancora.getBoundingClientRect();
  d.style.left = `${Math.max(12, Math.min(r.left + r.width / 2 - d.offsetWidth / 2, window.innerWidth - d.offsetWidth - 12))}px`;
  d.style.top = `${Math.min(r.bottom + 8, window.innerHeight - d.offsetHeight - 12)}px`;
  d.querySelector<HTMLButtonElement>("[data-pilula]")?.focus();
  // Revisão 2 do #651: com as páginas o menu cresceu; as setas, Home e End andam nele como nos outros menus.
  d.addEventListener("keydown", (e) => {
    const bs = [...d.querySelectorAll<HTMLButtonElement>("[data-pilula]")];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    const k = e.key === "ArrowDown" ? (i + 1) % bs.length : e.key === "ArrowUp" ? (i - 1 + bs.length) % bs.length : e.key === "Home" ? 0 : e.key === "End" ? bs.length - 1 : -1;
    if (k < 0 || !bs.length) return;
    e.preventDefault();
    bs[k]?.focus();
  });
  d.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pilula]");
    if (!b) return;
    d.close();
    if (b.dataset.pilula === "buscar") abrirBuscaNaConversa();
    else irPara(Number(b.dataset.pos));
  });
}

function renderPrincipal(): void {
  const t = estado.tela;
  // NOD-174: a pessoa lê a frase do servidor; o código fechado fica só no <details>, para quem depura.
  const erro = estado.erro ? htmlDoErro(estado.erro) : "";
  let cabecalho = "";
  let corpo = "";
  let partes: PartesDaTimeline | null = null;
  let composer: { chave: string; html: string } | null = null;
  switch (t.tipo) {
    case "novo-bot":
      corpo = renderNovoBot(estado);
      break;
    case "nova-rotina":
      corpo = renderNovaRotina(estado, t.agenteId);
      break;
    case "inicio":
      break;
    case "sua-vez":
      corpo = renderSuaVez(estado);
      break;
    case "nao-lidos":
      corpo = renderNaoLidos(estado);
      break;
    case "quadro-compartilhado":
      // NOD-455: o casco; o controlador desenha dentro dele (e não é regravado enquanto a tela é a mesma).
      corpo = '<div id="qcp" class="qcp-casco"></div>';
      break;
    case "rotinas":
      corpo = renderRotinas(estado);
      break;
    case "conectores":
      corpo = renderConectores(estado);
      break;
    case "nova-sala":
      corpo = renderNovaSala(estado);
      break;
    // ADR-083 (#195/#196): "Todos os trabalhos", a tela da task e a tela provisória de uma linha do chat.
    case "trabalhos":
      // ADR-099 (parte 5): com o dono de cada bot no servidor, uma linha por bot; sem ele (servidor anterior), por task.
      corpo = temDonos(estado) ? renderTrabalhosPorBot(estado) : renderTodosOsTrabalhos(estado, t.filtro);
      break;
    case "trabalho":
      cabecalho = renderTopoTrabalho(estado, t.id);
      // Por blocos como a conversa (definido em 2026-10-08, revisão W1, ADR-061): o texto ao vivo só mexe na parte ao vivo.
      partes = partesDaTask(t.id);
      anunciarSubagentes(t.id);
      corpo = CASCA_TIMELINE_TASK;
      composer = { chave: `trabalho:${t.id}`, html: htmlComposer("Escreva para esta task…") + htmlAcoesDaTask(t.id) };
      break;
    case "linha":
      corpo = `<div class="timeline tk-timeline">${renderTelaLinha(estado, t)}</div>`;
      break;
    case "conversa":
      if (comQuadro(t.agenteId)) lerPaginas(t.agenteId);
      {
        const ps = paginasDaPilula(t.agenteId);
        const dto = paginasDtoDe(t.agenteId);
        cabecalho = renderCabecalhoConversa(estado, t.agenteId, { comQuadro: comQuadro(t.agenteId), paginas: ps, ordem: ordemDoAgente(t.agenteId, ps), pedirApp: dto ? { cabeMais: dto.cabeMais, limite: dto.limite } : undefined });
      }
      partes = partesDaTimeline();
      corpo = partes ? CASCA_TIMELINE : renderTimeline(null, estado);
      composer = { chave: `conversa:${t.conversaId}`, html: htmlComposer(placeholderPadrao(), (estado.frota?.agentes ?? []).filter((a) => a.id !== t.agenteId && a.ownerId === estado.sessao?.pessoaId && a.confirmado).map((a) => a.nome), { anexos: aceitaDo(botGerido(t.agenteId)?.harness), comandos: true, aprovacao: true, bot: botGerido(t.agenteId)?.nome }) };
      break;
    case "sala":
      cabecalho = renderCabecalhoSala(estado, t.salaId);
      partes = partesDaTimeline();
      corpo = partes ? CASCA_TIMELINE : renderTimeline(null, estado);
      composer = { chave: `sala:${t.salaId}`, html: htmlComposer(PLACEHOLDER_SALA, nomesDosMembros(estado, t.salaId)) };
      break;
  }
  atualizarGaveta(estado, gavetaSuja);
  document.querySelector(".app")?.classList.toggle("com-detalhes", t.tipo === "conversa");
  document.querySelector(".app")?.classList.toggle("detalhes-ocultos", painelOculto());
  const donoDaTela = t.tipo === "conversa" && botGerido(t.agenteId)?.ownerId === estado.sessao?.pessoaId;
  definirTelaDoBot(donoDaTela ? api : null, donoDaTela && t.tipo === "conversa" ? t.agenteId : null);
  // ADR-094: um cabeçalho só. No celular o ☰ da gaveta de bots entra no próprio cabeçalho da tela; tela sem cabeçalho
  // ganha uma faixa só com ele (`so-menu`, que no computador não aparece).
  // NOD-42: a busca é da tela em que abriu (fecha ANTES do render: o "buscando" sai do cabeçalho junto). Aberta, o
  // cabeçalho é regravado em volta do miolo, que nunca sai do DOM (texto, foco, acento e cursor ficam).
  if (buscaNaConversa.aberta() && chaveDaTelaDeBusca() !== telaDaBusca) buscaNaConversa.fechar(false);
  regiaoEmVoltaDe("cabecalho", botaoAbrirBots(t.tipo === "conversa") + cabecalho + botaoBuscarCelular(), buscaNaConversa.no());
  buscaNaConversa.encaixar(document.getElementById("cabecalho"));
  document.getElementById("cabecalho")?.classList.toggle("so-menu", cabecalho === "");
  document.getElementById("cabecalho")?.classList.toggle("cabecalho-task", t.tipo === "trabalho");
  // Plano "tela limpa" (2026-10-16, T1): na conversa própria o cabeçalho é a pílula flutuante sobre o chat.
  document.getElementById("cabecalho")?.classList.toggle("cabecalho-pilula", t.tipo === "conversa");
  marcarPainelNaPilula();
  topoEncolhe.reavaliar();
  quadroNaTela.sincronizar(t.tipo === "conversa" && comQuadro(t.agenteId)
    ? { chave: t.conversaId, nome: botGerido(t.agenteId)?.nome ?? "agente", agenteId: t.agenteId, paginas: paginasDaPilula(t.agenteId) }
    : { chave: null, nome: "", agenteId: t.tipo === "conversa" ? t.agenteId : null });
  trilhaDaConversa.observar();
  regiao("erro", erro);
  const cascaMuda = regiaoMudaria("timeline", corpo);
  const historicoMuda = cascaMuda || (partes !== null && blocosMudariam("timeline-historico", partes.historico));
  const aoVivoMuda = cascaMuda || (partes !== null && blocosMudariam("timeline-ao-vivo", partes.aoVivo));
  if (historicoMuda || aoVivoMuda) regravarTimeline(corpo, partes, { cascaMuda, historicoMuda, aoVivoMuda });
  // Chat limpo (PR 7; QA do PR 398): o progresso das frentes muda só o bloco dele, dentro da fala, sem regravá-la. O bloco
  // trocado é medido de novo antes da pílula (PR 8): ela some com o bloco à vista, e a frente nova do lote muda o bloco.
  if (progressoNaTela.desenhar(conversaDaTela(estado), estado, memoriaNaFala()) > 0) rolagem.progressoTrocado();
  // NOD-455: o quadro compartilhado vive fora do reducer, como o da dona; a URL /quadros/:qid é só desta tela.
  if (t.tipo === "quadro-compartilhado") {
    if (quadroCompartilhado.atual() !== t.quadroId) quadroCompartilhado.abrir(t.quadroId);
    quadroCompartilhado.montar();
    const caminho = caminhoDoQuadro(t.quadroId);
    if (window.location.pathname !== caminho) window.history.replaceState(window.history.state, "", caminho + window.location.search + window.location.hash);
  } else if (quadroCompartilhado.atual() !== null) {
    quadroCompartilhado.fechar();
    if (quadroDaUrl(window.location.pathname)) window.history.replaceState(window.history.state, "", "/" + window.location.search + window.location.hash);
  }
  // NOD-348: o tempo da fala viva é escrito logo depois do render (a parte trocada nasce vazia) e o anunciador vê o estado novo.
  relogioDaFala.tocar();
  anunciadorDoTurno.observar(falasNaTela());
  // ADR-083 (#195): a faixa de Trabalhos fica colada em cima do campo, só na conversa e só com trabalho aberto do bot.
  // ADR-099 (parte 5): virou a linha do dono; chat limpo (PR 8): virou a pílula que se alarga, que some com a fala à vista.
  // Depois da timeline (revisão do PR 400): a medida do progresso na fala é a da timeline que acabou de ser desenhada
  // (`rolagem.depoisDeDesenhar`). Antes dela, a conversa recém-aberta com a fala à vista usava a medida da tela anterior:
  // a pílula nascia à vista, contava "mostrada" e escorregava para fora no mesmo quadro. O espaço que ela abre embaixo da
  // timeline muda o tamanho da caixa, e o ResizeObserver da rolagem mantém no fim quem estava no fim.
  desenharPilula();
  // O composer só é regravado quando a conversa muda: o textarea preserva texto, foco e cursor.
  if (composer?.chave !== composerDe) {
    // ADR-095: a gravação é do campo que sai; o texto dela nunca cai no campo de outra conversa.
    ditado.descartar();
    // Revisão do PR 1 (2026-10-16): o menu do seletor de IA é do bot do campo que sai; um clique nele nunca grava noutro.
    fecharMenuIa();
    fecharFolhaMais();
    const saindo = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (composerDe && saindo) rascunhos.guardar(composerDe, saindo.value);
    composerDe = composer?.chave ?? null;
    esquecerRegiao("composer");
    esquecerRegiao("composer-pergunta");
    regiao("composer", composer?.html ?? "");
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    const rascunho = composerDe ? rascunhos.ler(composerDe) : "";
    if (ta && rascunho) {
      ta.value = rascunho;
      ajustarAltura(ta);
      ta.setSelectionRange(rascunho.length, rascunho.length);
    }
    // No celular o foco abriria o teclado a cada conversa aberta: o campo espera o toque.
    if (!celular.ativo()) ta?.focus();
    redesenharAnexos();
  }
  atualizarComposer();
  ditado.atualizar();
  // O Parar da task some quando ela termina; o campo continua (escrever retoma a task do mesmo ponto).
  if (t.tipo === "trabalho") {
    const tr = trabalhoPorId(estado, t.id);
    document.querySelector<HTMLElement>('#composer [data-act="parar-trabalho"]')?.toggleAttribute("hidden", !tr || !aberto(tr));
  }
  document.body.classList.toggle("ocupado", estado.ocupado);
  // QA do PR #389 (2026-10-18): depois de responder em "Sua vez", o foco vai ao próximo item quando a fila relida chega.
  if (focoDaFila && aplicarFocoDaFila(document, focoDaFila, Date.now()) === "feito") focoDaFila = null;
  talvezMostrarDicaDaBusca();
}

function pedirFocoDaFila(respondida: string): void {
  if (estado.tela.tipo !== "sua-vez") return;
  const ids = (estado.suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido").map((i) => i.decisao.id);
  focoDaFila = { respondida, proximo: proximoDaFila(ids, respondida), ate: Date.now() + VALIDADE_DO_FOCO_MS };
}

type PartesDaTimeline = { historico: BlocoDaTimeline[]; aoVivo: BlocoDaTimeline[] };

/** O progresso das frentes nas falas (chat limpo, PR 7): os lugares são achados quando o histórico é regravado. */
const progressoNaTela = criarProgressoNaTela();

/** PR 8: o ponto da memória do Mac vai no bloco que ainda anda (com a pílula escondida, é ele que avisa). */
function memoriaNaFala(): ReturnType<typeof memoriaNaPilula> {
  const c = conversaDaTela(estado);
  return c?.conversa.agenteId ? memoriaNaPilula(estado, c.conversa.agenteId, c.conversa.id) : null;
}

/**
 * A timeline de uma conversa em duas partes (definido em 2026-09-30, web/telas/conversa.ts): a casca fica e
 * cada parte é uma região por blocos. O histórico vem da lembrança (web/lib/lembrar.ts) e só é refeito quando
 * algo que ele lê muda; a parte ao vivo é refeita a cada quadro, e só o bloco do turno que escreveu é regravado.
 */
const CASCA_TIMELINE = '<div class="timeline"><div id="timeline-historico" class="timeline-parte"></div><div id="timeline-ao-vivo" class="timeline-parte"></div></div>';

/** A casca da tela da task: as mesmas duas partes da conversa, com o desenho da task (`tk-timeline`). */
const CASCA_TIMELINE_TASK = '<div class="timeline tk-timeline"><div id="timeline-historico" class="timeline-parte"></div><div id="timeline-ao-vivo" class="timeline-parte"></div></div>';

/**
 * NOD-350: a região viva própria dos subagentes (#anuncio-subagentes, separada da de "Ouvir") diz a linha deles quando
 * ela MUDA nesta task — a contagem, cada fim; nunca as chamadas nem o último passo. Abrir a task só registra a linha.
 */
const anunciosDeSubagentes = new Map<string, string | null>();
function anunciarSubagentes(id: string): void {
  const texto = anuncioDosSubagentes(estado, id);
  const conhecida = anunciosDeSubagentes.has(id);
  const antes = anunciosDeSubagentes.get(id) ?? null;
  anunciosDeSubagentes.set(id, texto);
  if (anunciosDeSubagentes.size > 50) anunciosDeSubagentes.delete(anunciosDeSubagentes.keys().next().value!);
  if (!conhecida || texto === antes || !texto) return;
  const anuncio = document.getElementById("anuncio-subagentes");
  if (anuncio) anuncio.textContent = texto;
}

/** A tela da task em duas partes: o histórico lembrado (só muda com mensagem nova) e o ao vivo do turno do trabalho. */
function partesDaTask(id: string): PartesDaTimeline {
  return { historico: lembrar("task-historico", estado, [id, versaoDasFases(), versaoDasDecisoesDaBarra(), barraNaConversa, ehCelular()], (e) => blocosDoHistoricoDaTask(e, id)), aoVivo: blocosAoVivoDaTask(estado, id) };
}

function partesDaTimeline(): PartesDaTimeline | null {
  const c = conversaDaTela(estado);
  if (!c) return null;
  // O chip de link do Slack diz "mensagem das HH:MM" no mesmo dia e "de DD/MM" depois: o dia é um extra.
  // Chat limpo (PR 7): o progresso das frentes na fala lê o ao vivo e o relógio, então não entra aqui — a fala leva só o
  // lugar dele, que `progressoNaTela` enche depois (web/telas/progresso-na-fala.ts); a fala não é regravada quando uma frente anda.
  const historico = lembrar("timeline-historico", estado, [new Date().toDateString(), versaoDasFases(), versaoDasDecisoesDaBarra(), barraNaConversa, ehCelular()], (e) => {
    const conversa = conversaDaTela(e);
    return conversa ? blocosDoHistorico(conversa, e) : [];
  });
  // ADR-077: os cards da configuração guiada entram como um bloco ao vivo na conversa da guia.
  const guia = telaOnboarding.blocoNaConversa(c.conversa.id);
  // NOD-345: os cartões da conta e a fala única do lembrete, também ao vivo (nunca viram mensagem do transcript).
  const conta = telaConta.blocoNaConversa(c.conversa.id);
  const lembrete = blocoDoLembrete(c.conversa.id);
  return {
    historico,
    aoVivo: [
      ...blocosAoVivo(c, estado),
      ...(guia ? [{ chave: "onboarding", html: guia }] : []),
      ...(lembrete ? [{ chave: "conta-lembrete", html: lembrete }] : []),
      ...(conta ? [{ chave: "conta", html: conta }] : []),
    ],
  };
}

/**
 * Regrava os blocos que mudaram guardando o que a pessoa tem aberto ou digitado neles, e mantém no fim quem estava no
 * fim. Com o histórico parado, só a parte ao vivo é mexida, e só nela se procura o que guardar: procurar no documento
 * inteiro (dezenas de milhares de nós numa conversa longa) a cada quadro de streaming custava mais que o próprio desenho.
 */
function regravarTimeline(corpo: string, partes: PartesDaTimeline | null, muda: { cascaMuda: boolean; historicoMuda: boolean; aoVivoMuda: boolean }): void {
  const t = estado.tela;
  const timeline = document.getElementById("timeline");
  const escopo: ParentNode = muda.historicoMuda ? document : document.getElementById("timeline-ao-vivo") ?? document;
  const abertos = [...escopo.querySelectorAll<HTMLDetailsElement>("details[data-disclosure][open]")].map((el) => el.dataset.disclosure);
  const buscas = muda.cascaMuda ? ["busca-destinatario", "busca-marketplace"].map((id) => ({ id, valor: (document.getElementById(id) as HTMLInputElement | null)?.value ?? "" })) : [];
  // A pasta marcada no card de pasta sobrevive a um frame que re-renderiza a conversa no meio da escolha.
  const pastasMarcadas = [...escopo.querySelectorAll<HTMLInputElement>("input[data-pasta-de]:checked")].map((el) => ({ de: el.dataset.pastaDe ?? "", valor: el.value, foco: document.activeElement === el }));
  // ADR-082: a ação do lote do Nod que a pessoa desmarcou continua desmarcada depois de um frame que redesenha o card.
  const loteDesmarcado = [...escopo.querySelectorAll<HTMLInputElement>("[data-proposta] input[data-lote-i]")].filter((el) => !el.checked).map((el) => ({ proposta: el.closest<HTMLElement>("[data-proposta]")?.dataset.proposta ?? "", i: el.dataset.loteI ?? "" }));
  const respostas = [...escopo.querySelectorAll<HTMLInputElement>("[data-decisao] input")].map((el) => ({
    decisao: el.closest<HTMLElement>("[data-decisao]")?.dataset.decisao ?? "",
    atributo: el.hasAttribute("data-resposta") ? "data-resposta" : el.hasAttribute("data-item-texto") ? "data-item-texto" : "data-item",
    chave: el.dataset.resposta ?? el.dataset.itemTexto ?? el.dataset.item ?? "",
    campo: guardarCampo(el),
    foco: document.activeElement === el, inicio: el.selectionStart, fim: el.selectionEnd,
  }));
  // QA do PR #389 (2026-10-18): o botão em foco (a opção do cartão, o ×) volta com o foco depois de regravar.
  const focoNoBotao = timeline?.contains(document.activeElement) ? botaoEmFoco(document.activeElement as HTMLElement) : null;
  // ADR-051: o iframe do artefato sai antes de a timeline ser regravada e volta sem recarregar (moveBefore),
  // no hidratar() logo abaixo — depois de os <details> reabrirem; sem moveBefore, ele é recriado do cache.
  if (muda.historicoMuda) artefatos.estacionar();
  regiao("timeline", corpo);
  if (muda.cascaMuda) {
    esquecerRegiao("timeline-historico");
    esquecerRegiao("timeline-ao-vivo");
  }
  if (partes) {
    if (muda.historicoMuda) regiaoPorBlocos("timeline-historico", partes.historico);
    if (muda.aoVivoMuda) regiaoPorBlocos("timeline-ao-vivo", partes.aoVivo);
  }
  // O progresso das frentes entra nos lugares da fala antes de reabrir os <details> e de contar as linhas mostradas.
  if (muda.historicoMuda) {
    progressoNaTela.achar(partes ? document.getElementById("timeline-historico") : null);
    progressoNaTela.desenhar(conversaDaTela(estado), estado, memoriaNaFala());
  }
  for (const resposta of respostas) {
    const el = document.querySelector<HTMLInputElement>(`[data-decisao="${CSS.escape(resposta.decisao)}"] input[${resposta.atributo}="${CSS.escape(resposta.chave)}"]`);
    if (!el || !restaurarCampo(el, resposta.campo)) continue;
    if (resposta.foco) {
      el.focus({ preventScroll: true });
      if (resposta.inicio !== null && resposta.fim !== null) el.setSelectionRange(resposta.inicio, resposta.fim);
    }
    const raiz = el.closest<HTMLElement>("[data-decisao]");
    const contador = raiz?.querySelector("[data-contador]");
    if (contador) contador.textContent = String(raiz?.querySelectorAll("input[data-item]:checked").length ?? 0);
  }
  if (focoNoBotao && (!document.activeElement || document.activeElement === document.body)) {
    acharBotao(document.querySelectorAll<HTMLButtonElement>("#timeline button[data-act]"), focoNoBotao)?.focus({ preventScroll: true });
  }
  // Chat limpo (PR 4): o cartão encolhido do pedido decidido nesta conversa recebe o foco e o anúncio no primeiro desenho.
  if (muda.historicoMuda && encolhidosPendentes.length > 0) encolhidosPendentes = aplicarEncolhidos(document, encolhidosPendentes, Date.now(), anunciar);
  for (const busca of buscas) {
    const campo = document.getElementById(busca.id) as HTMLInputElement | null;
    if (campo) campo.value = busca.valor;
  }
  for (const d of loteDesmarcado) {
    const el = document.querySelector<HTMLInputElement>(`[data-proposta="${CSS.escape(d.proposta)}"] input[data-lote-i="${CSS.escape(d.i)}"]`);
    if (el) el.checked = false;
  }
  for (const marcada of pastasMarcadas) {
    const el = [...document.querySelectorAll<HTMLInputElement>(`input[data-pasta-de="${CSS.escape(marcada.de)}"]`)].find((x) => x.value === marcada.valor);
    if (!el) continue;
    el.checked = true;
    if (marcada.foco) el.focus({ preventScroll: true });
  }
  // A busca do seletor de contatos e a do marketplace só existem nas telas que não são conversa (casca inteira).
  if (muda.cascaMuda) {
    filtrarBots((document.getElementById("busca-destinatario") as HTMLInputElement | null)?.value ?? "", ".contact-picker");
    filtrarApps((document.getElementById("busca-marketplace") as HTMLInputElement | null)?.value ?? "");
  }
  for (const el of escopo.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]")) if (abertos.includes(el.dataset.disclosure)) el.open = true;
  if (muda.historicoMuda) artefatos.hidratar(timeline ?? document);
  if (muda.historicoMuda) diagramas.hidratar(timeline ?? document);
  if ((muda.historicoMuda || muda.cascaMuda) && t.tipo === "conversa") contarLinhasMostradas();
  rolagem.depoisDeDesenhar(t.tipo === "conversa" || t.tipo === "sala" ? t.conversaId : t.tipo === "trabalho" ? `trabalho:${t.id}` : null, muda.historicoMuda || muda.cascaMuda);
}

const PLACEHOLDER_SALA = "Mensagem para a sala — @Nome dirige a pergunta";

function placeholderPadrao(): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return PLACEHOLDER_SALA;
  const nome = botGerido(t.agenteId)?.nome ?? "o bot";
  // Jornada C: com a fala guardada e nenhuma IA pronta, a dica diz quando o bot responde (o envio continua liberado).
  const c = estado.conversas[t.conversaId];
  if (c && conversaAguardandoIa({ [t.conversaId]: { mensagens: c.mensagens } }, iasNoCard(estado), turnosVivosDe(estado))) return `${dicaDoComposerSemIa(nome)}…`;
  return `Escreva uma mensagem para ${nome}…`;
}

/**
 * O campo reflete o modo sem ser regravado (web/lib/regioes.ts): a faixa, os modos e a citação entram
 * na região `composer-pergunta`; placeholder, dica, borda e clipe mudam no próprio nó. definido em
 * 2026-09-17: hidratação do nome atualiza só o placeholder; nunca recria o textarea nem perde rascunho.
 * definido em 2026-09-24 (emenda da ADR-045): com pergunta aberta, a próxima mensagem responde.
 */
function atualizarComposer(): void {
  const alvo = conversaAtual();
  const caixa = document.querySelector<HTMLElement>("#composer .composer");
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!alvo || !caixa || !ta) return;
  const nota = document.getElementById("composer-nota");
  const a = aparenciaDoComposer(modoDoComposer(estado, alvo.conversaId), estado, { placeholder: placeholderPadrao(), nota: nota?.dataset.padrao ?? "" }, alvo.conversaId);
  regiao("composer-pergunta", a.topo);
  // ADR-094: no celular o texto de ajuda inteiro quebrava em duas linhas dentro do campo; lá fica o curto, e o leitor de
  // tela continua ouvindo o completo.
  const placeholder = celular.ativo() ? "Mensagem" : a.placeholder;
  if (ta.placeholder !== placeholder) ta.placeholder = placeholder;
  if (ta.getAttribute("aria-label") !== a.placeholder) ta.setAttribute("aria-label", a.placeholder);
  // Plano "tela limpa" (2026-10-16, T5): a dica "Enter envia…" saiu. Plano "pergunta com botões" (2026-10-18): a nota do
  // modo resposta e o clipe desligado também — com pergunta aberta o campo não muda.
  if (nota && nota.textContent !== a.nota) nota.textContent = a.nota;
  atualizarModoNoComposer();
  atualizarSeletorIa();
  atualizarMais();
  atualizarParar();
}

/**
 * O Parar do campo (plano "tela limpa", 2026-10-16, decisão E11; revisão do PR 1): enquanto há turno vivo do chat na
 * conversa da tela (NOD-311: task não conta; NOD-354: `pararNoCampoDaTela`), o Parar fica à vista como botão secundário ao lado do Enviar — mesmo com rascunho, anexo ou o ditado gravando,
 * quando o Enviar também aparece. Com o campo vazio, só o Parar. Quem decide é `botoesDoCampo` (web/telas/conversa.ts).
 */
function atualizarParar(): void {
  // ADA-5: o Enviar ⇄ Parar da pílula segue o mesmo turno vivo (e volta ao rótulo certo depois do ditado).
  quadroNaTela.atualizarPilula();
  const t = estado.tela;
  const parar = document.querySelector<HTMLButtonElement>('#composer .parar-envio[data-act="parar-conversa"]');
  const enviar = document.querySelector<HTMLButtonElement>('#composer .send[data-act="enviar"]');
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!parar || !enviar || !ta) return;
  const alvo = conversaAtual();
  const anexos = alvo && !alvo.salaId ? (anexosPendentes.get(alvo.conversaId) ?? []).length : 0;
  const b = botoesDoCampo({ trabalhando: pararNoCampoDaTela(estado), temConteudo: ta.value.trim() !== "" || anexos > 0, ditando: ditado.ativo() });
  if (parar.hidden !== !b.parar) parar.hidden = !b.parar;
  if (enviar.hidden !== !b.enviar) enviar.hidden = !b.enviar;
  if (b.parar && t.tipo === "conversa") {
    const titulo = tituloDoParar(estado, t.agenteId);
    const rotulo = rotuloDoParar(botGerido(t.agenteId)?.nome);
    if (parar.title !== titulo) parar.title = titulo;
    if (parar.getAttribute("aria-label") !== rotulo) parar.setAttribute("aria-label", rotulo);
  }
}

/**
 * Escreve no campo por código (ditado, sugestão, limpar depois de enviar) e reavalia o Enviar/Parar: o evento "input" só
 * dispara quando a pessoa digita, e sem isto o botão ficava o de antes (revisão do PR 1, 2026-10-16).
 */
function escreverNoCampo(ta: HTMLTextAreaElement, valor: string): void {
  // NOD-444: texto trocado por código (ditado, sugestão de prompt) deixa de ser o rascunho da pílula.
  mostrarSugestaoRotina(false);
  ta.value = valor;
  atualizarParar();
}

/**
 * O seletor de IA do campo (plano "tela limpa", 2026-10-16, T6): o miolo segue o bot e o uso da janela sem regravar o
 * campo (ADR-020) — como o chip de aprovações, só troca o que mudou.
 */
function atualizarSeletorIa(): void {
  const bt = document.getElementById("composer-ia") as HTMLButtonElement | null;
  if (!bt) return;
  const t = estado.tela;
  const d = t.tipo === "conversa" ? dadosDoSeletor(estado, t.agenteId) : null;
  if (!d) { bt.hidden = true; return; }
  bt.hidden = false;
  const m = mioloDoSeletor(d, bt.getAttribute("aria-expanded") === "true");
  if (bt.dataset.miolo !== m.html) { bt.innerHTML = m.html; bt.dataset.miolo = m.html; }
  if (bt.title !== m.titulo) { bt.title = m.titulo; bt.setAttribute("aria-label", m.titulo); }
  bt.setAttribute("aria-disabled", String(!d.dona));
}

/** O menu do seletor de IA aberto (um por vez) e se um clique dele ainda está gravando. */
let menuIa: HTMLDialogElement | null = null;
let gravandoIa = false;

function fecharMenuIa(): void {
  if (menuIa?.open) menuIa.close();
  menuIa = null;
}

/**
 * Revisão do PR 1 (2026-10-16): o clique grava só o que muda (`pedidoDoSeletor`), um por vez (o próximo clique espera o
 * PUT voltar), e o agente devolvido entra na frota e na gestão na hora (`agente-gravado`), antes do refetch. O clique que
 * chega depois de a conversa trocar (o menu é fechado por `fecharMenuIa`, mas o PUT pode estar no ar) não grava.
 */
function abrirSeletorIa(el: HTMLElement): void {
  const t = estado.tela;
  const a = t.tipo === "conversa" ? estado.frota?.agentes.find((b) => b.id === t.agenteId) : undefined;
  const d = t.tipo === "conversa" ? dadosDoSeletor(estado, t.agenteId) : null;
  if (!a || !d || !d.dona || gravandoIa || estado.ocupado) return;
  const chave = composerDe;
  menuIa = abrirMenuIa(el, renderMenuIa(d), (escolha) => {
    menuIa = null;
    if (escolha.tipo === "provedores") { abrirEspaco("conexao"); return; }
    if (composerDe !== chave || gravandoIa) return;
    const atual = estado.frota?.agentes.find((b) => b.id === a.id) ?? a;
    const pedido = pedidoDoSeletor(atual, escolha, contextoInteligencia(estado));
    if (!pedido) return;
    gravandoIa = true;
    void agir(async () => {
      try {
        const { agente } = await api!.gravarInteligencia(a.id, pedido);
        dispatch({ tipo: "agente-gravado", agente });
        dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
      } finally {
        gravandoIa = false;
      }
    });
  }, atualizarSeletorIa);
}

/**
 * ADR-059: o botão do modo de aprovação segue o bot da conversa. O composer não se regrava (ADR-020), então o miolo do
 * botão é trocado no próprio nó, só quando muda — o texto digitado fica onde está. revisto em 2026-10-18 (Fase 4, PR 2):
 * só o ícone, com o nome no `aria-label` e na dica; a faixa acima do campo saiu.
 */
function atualizarModoNoComposer(): void {
  const chip = document.getElementById("composer-modo") as HTMLButtonElement | null;
  const t = estado.tela;
  const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
  if (!chip) return;
  if (!bot) { chip.hidden = true; return; }
  const modo = bot.modoAprovacao ?? "manual";
  const dona = bot.ownerId === estado.sessao?.pessoaId;
  const r = renderChipModo(modo, dona);
  chip.hidden = false;
  if (chip.dataset.modo !== modo || chip.dataset.dona !== String(dona)) {
    chip.innerHTML = r.html;
    chip.dataset.modo = modo;
    chip.dataset.dona = String(dona);
    chip.setAttribute("aria-label", r.titulo);
    chip.setAttribute("aria-disabled", String(!dona));
  }
}

/** A folha do + aberta (NOD-381): uma por vez, do campo da conversa da tela. */
let folhaMais: HTMLDialogElement | null = null;

function fecharFolhaMais(): void {
  if (folhaMais?.open) folhaMais.close();
  folhaMais = null;
}

/** O que a folha do + mostra para o bot da tela (`linhasDoBot`). */
function linhasDaFolhaMais(): LinhasDaFolhaMais {
  const t = estado.tela;
  const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
  const d = t.tipo === "conversa" ? dadosDoSeletor(estado, t.agenteId) : null;
  return linhasDoBot({
    temArquivo: document.getElementById("composer-arquivos") !== null,
    dona: !!bot && bot.ownerId === estado.sessao?.pessoaId,
    modo: bot?.modoAprovacao,
    ia: d?.dona ? rotuloDoSeletor(d) : null,
  });
}

/** O menu que a folha acabou de abrir (o último <dialog> aberto) engole o 2º toque de um toque duplo. */
function travarToqueDuplo(): void {
  const abertos = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const d = abertos[abertos.length - 1];
  if (d) travarToqueDuploEm(d);
}

/** O + só aparece quando a folha teria o que mostrar (bot de outra pessoa sem anexo, frota ainda chegando: escondido). */
function atualizarMais(): void {
  const mais = document.querySelector<HTMLButtonElement>("#composer .mais-campo");
  if (!mais) return;
  const l = linhasDaFolhaMais();
  const vazio = linhasVisiveis(l).length === 0;
  if (mais.hidden !== vazio) mais.hidden = vazio;
  // Revisão 2: o aviso do modo total continua no campo (ADR-059) e o rótulo diz o que a folha tem. Revisão 5: o aviso
  // vale para quem conversa com o bot, dona ou colega (o colega é quem manda o texto que o faz agir sozinho).
  const t = estado.tela;
  const atencao = t.tipo === "conversa" && botGerido(t.agenteId)?.modoAprovacao === "total";
  if (mais.hasAttribute("data-atencao") !== atencao) mais.toggleAttribute("data-atencao", atencao);
  const rotulo = rotuloDoMais(l, atencao);
  if (mais.getAttribute("aria-label") !== rotulo) mais.setAttribute("aria-label", rotulo);
}

/**
 * NOD-381: o + do campo no celular abre a folha de baixo com Anexar, Modo de aprovação e IA. Cada linha fecha a folha e
 * faz o que o botão antigo fazia, com o + como âncora (o menu de modo e o de IA abrem acima do campo, como antes).
 * O diálogo de `dialogo` para o clique (stopPropagation), então as linhas têm o próprio ouvinte.
 */
function abrirFolhaMais(el: HTMLElement): void {
  const l = linhasDaFolhaMais();
  if (linhasVisiveis(l).length === 0) return;
  fecharMenuIa();
  const chave = composerDe;
  const d = dialogo(renderFolhaMais(l), true);
  d.classList.add("folha-mais");
  folhaMais = d;
  const controle = controleDaFolha(el, {
    valido: () => composerDe === chave && el.isConnected,
    anexar: () => document.getElementById("composer-arquivos")?.click(),
    modo: () => { abrirModoAprovacao(el); travarToqueDuplo(); },
    ia: () => { abrirSeletorIa(el); travarToqueDuplo(); },
  });
  d.addEventListener("close", () => { if (folhaMais === d) folhaMais = null; controle.fechou(); });
  d.addEventListener("click", (e) => {
    const linha = (e.target as HTMLElement).closest<HTMLElement>("[data-mais]");
    if (!linha) return;
    // Revisão 2: Anexar fecha antes de agir — com o modal aberto o input de arquivo fica inerte. Modo e IA marcam o
    // pendente antes do close (revisão 4: vale também num motor que dispare o `close` na hora), e ele roda no `close`.
    const escolha = linha.dataset.mais as EscolhaDaFolhaMais;
    if (escolha === "anexar") { d.close(); controle.escolher(escolha); } else { controle.escolher(escolha); d.close(); }
  });
  d.querySelector<HTMLElement>("[data-mais]")?.focus();
}

function abrirModoAprovacao(el: HTMLElement): void {
  const t = estado.tela;
  const bot = t.tipo === "conversa" ? botGerido(t.agenteId) : undefined;
  if (!bot || bot.ownerId !== estado.sessao?.pessoaId) return;
  // O total só chega aqui com `confirmado` (o segundo clique do menu); a linha de sistema na conversa confirma a troca.
  abrirMenuModo(el, bot.nome, bot.modoAprovacao ?? "manual", (modo, confirmado) => {
    void agir(async () => { await mudarGestao(() => api!.mudarModoAprovacao(bot.id, modo, confirmado)); });
  }, estado.frota?.revisor === true);
}

/**
 * Entrada (ADR-030). A recusa do Google é UMA mensagem para todos os motivos — o servidor não diz se
 * foi domínio, cadastro ou verificação, e a tela também não, para não contar a quem está de fora quem tem acesso.
 */
/** ADR-069: o pedido do app do Mac sobrevive à ida ao Google na sessionStorage desta aba. */
function pedidoPendente(): PedidoPareamento | null {
  try { return lerGuardado(window.sessionStorage.getItem(CHAVE_GUARDADA)); } catch { return null; }
}
/**
 * ADA-229 (5/11, primeiro teste no Windows): o link `?parear-maquina=CÓDIGO` que o app do Windows (e o `nod-motor parear`)
 * abre no navegador chegava numa aba sem sessão, e a tela abria um espaço provisório, que começa pelo onboarding ("olá",
 * "A IA dos seus bots", que supõe o app do Mac). O código ficava guardado e nunca era usado; o app esperava até vencer e
 * voltava ao Conectar, e a pessoa via o código piscar. Um código de máquina pendente é um pareamento como o do Mac: a
 * máquina se liga à conta de quem entra, nunca a um provisório.
 */
function codigoDeMaquinaPendente(): boolean {
  try { return window.sessionStorage.getItem(CHAVE_CODIGO_MAQUINA) !== null; } catch { return false; }
}
function esquecerPedido(): void {
  try { window.sessionStorage.removeItem(CHAVE_GUARDADA); } catch { /* sem storage, nada guardado */ }
}

/** NOD-345: a tela sem sessão com contas — entrar com e-mail, pedir o link e a página do link (senha nova duas vezes). */
function htmlEntradaConta(): string {
  const r = entrada.redefinir;
  const senha = (nome: string, rotulo: string, nova: boolean) => `<label class="cc-campo">${rotulo}<span class="cc-senha"><input name="${nome}" type="password" autocomplete="${nova ? "new-password" : "current-password"}" required${nova ? ' minlength="12"' : ""} maxlength="128"><button type="button" class="cc-mostrar" data-act="conta-mostrar" aria-pressed="false">Mostrar</button></span></label>`;
  const enviar = (rotulo: string, ocupado: boolean) => `<button type="submit" class="bt pri"${ocupado ? ' disabled aria-busy="true"' : ""}>${esc(ocupado ? "Conferindo…" : rotulo)}</button>`;
  const erro = (t: string | null) => (t ? `<p class="cc-erro" role="alert">${esc(t)}</p>` : "");
  if (r) {
    if (r.vencido) return `<div class="cc-cartao"><h3 class="cc-titulo">Esse link não vale mais</h3><p class="cc-texto">Ele vale por 30 minutos e uma vez só.</p><div class="cc-acoes">${botao("entrada-ir", "Pedir outro link", { classe: "pri", dados: { etapa: "recuperar" } })}</div></div>`;
    return `<form class="cc-cartao cc-form" data-form="entrada-redefinir"><h3 class="cc-titulo">Crie uma senha nova</h3>${senha("nova", "Senha nova", true)}${senha("nova2", "Repita a senha nova", true)}<p class="cc-dica">Pelo menos 12 caracteres. As outras sessões saem.</p>${erro(r.erro)}<div class="cc-acoes">${enviar("Salvar senha", r.ocupado)}</div></form>`;
  }
  const c = entrada.conta ?? { etapa: "entrar" as const, erro: null, enviadoPara: null, ocupado: false };
  const email = (rotulo = "E-mail") => `<label class="cc-campo">${rotulo}<input name="email" type="email" autocomplete="email" required maxlength="254" spellcheck="false" autocapitalize="off"></label>`;
  if (c.etapa === "recuperar") {
    return c.enviadoPara
      ? `<div class="cc-cartao"><p class="cc-texto" role="status">Se existir uma conta com <b>${esc(c.enviadoPara)}</b>, mandamos um link para criar uma senha nova. Ele vale por 30 minutos e uma vez só.</p><div class="cc-acoes">${botao("entrada-ir", "Voltar", { classe: "cc-link", dados: { etapa: "entrar" } })}</div></div>`
      : `<form class="cc-cartao cc-form" data-form="entrada-recuperar"><h3 class="cc-titulo">Recuperar a senha</h3>${email("E-mail da conta")}${erro(c.erro)}<div class="cc-acoes">${botao("entrada-ir", "Voltar", { classe: "cc-link", dados: { etapa: "entrar" } })}${enviar("Mandar link", c.ocupado)}</div></form>`;
  }
  return `<form class="cc-cartao cc-form" data-form="entrada-conta"><h3 class="cc-titulo">Entrar com e-mail</h3>${email()}${senha("senha", "Senha", false)}${erro(c.erro)}<div class="cc-acoes">${botao("entrada-ir", "Esqueci a senha", { classe: "cc-link", dados: { etapa: "recuperar" } })}${enviar("Entrar", c.ocupado)}</div></form>`;
}

async function trabalharNaEntrada(fn: () => Promise<void>): Promise<void> {
  const ocupado = entrada.redefinir ?? entrada.conta;
  if (ocupado?.ocupado) return;
  const marcar = (v: boolean) => {
    if (entrada.redefinir) entrada = { ...entrada, redefinir: { ...entrada.redefinir, ocupado: v } };
    else entrada = { ...entrada, conta: { ...(entrada.conta ?? { etapa: "entrar", erro: null, enviadoPara: null }), ocupado: v } };
    render();
  };
  marcar(true);
  try { await fn(); } finally { marcar(false); }
}
const contaDaEntrada = (m: Partial<NonNullable<typeof entrada.conta>>) => { entrada = { ...entrada, conta: { ...(entrada.conta ?? { etapa: "entrar", erro: null, enviadoPara: null, ocupado: false }), ...m } }; render(); };

function entrarPelaTela(form: HTMLFormElement): Promise<void> {
  const d = new FormData(form);
  return trabalharNaEntrada(async () => {
    try {
      const r = await contaApi.entrar(String(d.get("email") ?? "").trim(), String(d.get("senha") ?? ""));
      if (r.resultado === "recusado") return contaDaEntrada({ erro: ERRO_ENTRAR });
      if (r.resultado === "entrou" && r.trocaApp && window.nodDesktop?.trocarConta) {
        if (await window.nodDesktop.trocarConta(r.trocaApp).catch(() => false)) return;
        return contaDaEntrada({ erro: FALHA_TROCA_APP });
      }
      window.location.reload();
    } catch (e) {
      contaDaEntrada({ erro: fraseDoErroDeConta(e) });
    }
  });
}
function recuperarPelaTela(form: HTMLFormElement): Promise<void> {
  const email = String(new FormData(form).get("email") ?? "").trim();
  return trabalharNaEntrada(async () => {
    try { await contaApi.recuperar(email); contaDaEntrada({ etapa: "recuperar", enviadoPara: email, erro: null }); } catch (e) { contaDaEntrada({ erro: fraseDoErroDeConta(e) }); }
  });
}
function redefinirPelaTela(form: HTMLFormElement): Promise<void> {
  const d = new FormData(form);
  const r = entrada.redefinir;
  if (!r) return Promise.resolve();
  const nova = String(d.get("nova") ?? "");
  if (nova !== String(d.get("nova2") ?? "")) { entrada = { ...entrada, redefinir: { ...r, erro: "As duas senhas não são iguais." } }; render(); return Promise.resolve(); }
  return trabalharNaEntrada(async () => {
    try {
      const x = await contaApi.redefinir(r.token, nova);
      if (x.resultado === "invalido") { entrada = { ...entrada, redefinir: { ...r, vencido: true } }; return; }
      // Vinha de um espaço provisório: a senha já mudou, e a escolha (levar o trabalho ou não) abre ao recarregar.
      if (x.resultado === "escolher") { window.location.replace("/"); return; }
      if (x.trocaApp && window.nodDesktop?.trocarConta) {
        if (await window.nodDesktop.trocarConta(x.trocaApp).catch(() => false)) return;
        entrada = { ...entrada, redefinir: { ...r, erro: FALHA_TROCA_APP } };
        return;
      }
      window.location.replace("/");
    } catch (e) {
      entrada = { ...entrada, redefinir: { ...r, erro: fraseDoErroDeConta(e) } };
    }
  });
}

/** NOD-345: o que o menu da conta pede — "Sair" sai desta sessão; o resto abre o cartão na conversa do Nod. */
async function abrirDoMenuConta(qual: string): Promise<void> {
  // NOD-406: "Sou da equipe" vai ao Google da equipe (o mesmo link do cartão de entrar); no app, à tela de conexão.
  if (qual === "equipe") {
    if (equipeDoApp()) {
      // A confirmação é um diálogo do app; cancelar ou ocupado devolvem false e a pessoa segue no espaço.
      await window.nodDesktop?.souDaEquipe?.().catch(() => false);
      return;
    }
    const url = linkEquipe(); if (url) window.location.assign(url); return;
  }
  if (qual !== "sair") return telaConta.abrir(qual, true);
  await contaApi.sair().catch(() => undefined);
  // Quem sai cai na tela de entrada, não num espaço provisório novo; e este navegador esquece o verificador.
  try { window.localStorage.removeItem(CHAVE_VERIFICADOR); } catch { /* sem storage */ }
  // NOD-380: o que se buscou neste navegador não fica para quem entrar depois.
  try { apagarTodosOsRecentes(window.localStorage); } catch { /* sem storage */ }
  window.location.replace("/?saiu=1");
}

function renderEntrada(): string {
  const m = entrada.modo;
  // NOD-345: a página do link de recuperação vale com ou sem modo lido.
  if (entrada.redefinir) return `<section class="tela entrar"><h1>nod</h1>${htmlEntradaConta()}</section>`;
  const pedido = pedidoPendente();
  const doMac = pedido ? `<p class="mudo">Depois de entrar, você confirma a conexão do Mac <b>${esc(pedido.nome)}</b>.</p>` : "";
  const recusa = entrada.recusado
    ? `<p class="erro" role="alert">Não foi possível entrar com essa conta. Se ela ainda não tem acesso ao nod, peça para ser cadastrada.</p>`
    : "";
  if (!m) return `<section class="tela entrar"><h1>nod</h1><p class="mudo">carregando…</p></section>`;
  if (m.modo === "google") {
    // NOD-345: com contas, quem não é da equipe entra com o e-mail (o Google da equipe continua aqui).
    return `<section class="tela entrar"><h1>nod</h1><p>Entre com a sua conta Google.</p>${doMac}${recusa}<a class="bt pri" href="${esc(sessaoApi.urlGoogle)}">Entrar com Google</a>${m.contas ? htmlEntradaConta() : ""}</section>`;
  }
  const pessoas = m.pessoas.length
    ? m.pessoas.map((p, i) => botao("entrar", `Entrar como ${esc(p.nome)}`, { classe: i === 0 ? "pri" : undefined, dados: { pessoa: p.id } })).join(" ")
    : '<p class="mudo">Nenhuma pessoa no cadastro. Rode <code>npm run db:seed</code>.</p>';
  return `<section class="tela entrar"><h1>nod</h1><p>Login de desenvolvimento (só nesta máquina): entre como uma pessoa do cadastro.</p>${pessoas}${m.contas ? htmlEntradaConta() : ""}</section>`;
}

/**
 * NOD-216 (revisão): o pedido que entrou na fila "pensa" por JANELA_PENSANDO_MS e depois fica parado. O relógio do estado
 * só anda no tick de 15 s, então um timer único (sempre o próximo vencimento; o anterior é cancelado) redesenha na hora.
 */
let viradaDoMascote: { em: number; timer: number } | null = null;
function agendarViradaDoMascote(): void {
  const em = proximaViradaDoMascote(estado, Date.now());
  if (viradaDoMascote?.em === em) return;
  if (viradaDoMascote) window.clearTimeout(viradaDoMascote.timer);
  viradaDoMascote = em === null ? null : { em, timer: window.setTimeout(() => { viradaDoMascote = null; dispatch({ tipo: "tick", agora: Date.now() }); }, Math.max(0, em - Date.now()) + 50) };
}

function render(): void {
  // Um redesenho síncrono já cobre o que o quadro pendente ia mostrar.
  if (quadroPendente) {
    window.cancelAnimationFrame(quadroPendente);
    quadroPendente = 0;
  }
  agendarViradaDoMascote();
  // NOD-379: sem sessão a inicial não existe e a entrada (no palco) não pode ficar inerte.
  celular.definirSessao(!!estado.sessao);
  if (!estado.sessao) {
    document.querySelector(".app")?.classList.add("sem-sessao");
    definirTelaDoBot(null, null);
    regiao("detalhes", "");
    regiao("sidebar", "");
    buscaNaConversa.fechar(false); // sem sessão, a busca não fica aberta vigiando a tela de entrada (2ª revisão do PR 560)
    regiao("cabecalho", "");
    // Revisão do PR 1 (2026-10-16): sem sessão não há pílula — a classe deixava o cabeçalho vazio flutuando sobre a entrada.
    document.getElementById("cabecalho")?.classList.remove("cabecalho-pilula");
    regiao("timeline", renderEntrada());
    regiao("composer", "");
    rolagem.depoisDeDesenhar(null, true);
    prenderFocoNaGaveta(null);
    return;
  }
  document.querySelector(".app")?.classList.remove("sem-sessao");
  // ADR-114: a conversa própria à vista conta uma abertura (só quando muda de conversa) para o gatilho da Atividade.
  const naTela = estado.tela;
  const doBot = naTela.tipo === "conversa" ? estado.frota?.agentes.find((a) => a.id === naTela.agenteId && a.ownerId === estado.sessao?.pessoaId) : undefined;
  vigiaAtividade.naTela(doBot && naTela.tipo === "conversa" ? { agenteId: doBot.id, conversaId: naTela.conversaId } : null);
  // NOD-122: quem tem o foco quando a gaveta do app abre é para onde ele volta quando ela fecha.
  const gavetaDoApp = gavetaPrendeFoco(estado.tela);
  if (gavetaDoApp && !gavetaMontada) origemDaGaveta = origemDoFoco();
  if (!arrastandoBot) redesenharSidebar();
  if (celular.botsAbertos()) mostrarDicaToqueLongo();
  else esconderDicaToqueLongo(false);
  const codigo = codigoComFoco();
  // Seu espaço é uma camada por cima: a tela de baixo continua montada e fica inerte (nem foco, nem clique) enquanto ela está aberta.
  regiaoReabrindo("espaco", estado.espaco ? renderEspaco(estado, canalAvisos.estado(), celular.botsAbertos() ? { rotulo: "Início", icone: "" } : voltaDaTela(estado, estado.tela), {
    conta: dadosConta(),
    contaPagina: contas?.minhaConta && estado.configUi.abertos.includes("conta-pagina") ? telaMinhaConta.render() : null,
    tema: lerTema(),
    densidade: barraAtual.densidade,
    conexao: resumoConexao(),
  }) : "", { seletor: ".espaco-conteudo", chave: secaoAberta(estado) === "agentes" || secaoAberta(estado) === "rotinas" ? secaoAberta(estado) : null });
  rolarAgenda();
  devolverSegredosSsh();
  document.getElementById("espaco")?.toggleAttribute("hidden", !estado.espaco);
  // A ligação em tela cheia também deixa a .app (e Seu espaço) inerte; a pílula não: a pessoa usa o nod com a ligação aberta.
  // O onboarding por cima (olá, IA do Mac, "está te ligando") também deixa a .app inerte (ADR-077).
  // ADA-242 (aceite 6): quem já concluiu, numa máquina que não viu "Este computador", vê só essa tela (uma vez por sessão).
  void telaOnboarding.verificarMaquina();
  const camadaOnboarding = telaOnboarding.camada();
  const devolverFoco = regiaoMudaria("onboarding", camadaOnboarding) ? guardarFocoDaCamada(document.getElementById("onboarding")) : null;
  regiao("onboarding", camadaOnboarding);
  devolverFoco?.();
  document.getElementById("onboarding")?.toggleAttribute("hidden", camadaOnboarding === "");
  // A busca do celular em tela cheia também (NOD-380): sem isto, o próximo render devolvia a .app ao Tab com o diálogo aberto.
  pintarInerciaDoApp();
  document.getElementById("espaco")?.toggleAttribute("inert", telaLigacao.cheia());
  telaLigacao.render();
  const retomar = ligacaoParaRetomar;
  if (retomar && botGerido(retomar.agenteId)) {
    ligacaoParaRetomar = null;
    queueMicrotask(() => telaLigacao.retomar(retomar));
  }
  renderPrincipal();
  garantirAcessosDoApp();
  // NOD-379: com a inicial do celular à vista (o voltar do navegador por cima do Marketplace), a gaveta de app não prende
  // o foco: ela deixaria a inicial inerte.
  prenderFocoNaGaveta(celular.botsAbertos() ? null : gavetaDoApp);
  codigo?.();
  focoPendente.aplicar();
}

/**
 * O campo do código do Claude (cartão de IA) com o foco: o cartão é regravado quando o app do Mac manda um estado novo
 * ou a cada tecla (o valor mora no estado), e o foco voltaria ao corpo. Devolve o foco e o cursor ao campo novo.
 */
function codigoComFoco(): (() => void) | null {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLInputElement) || !ativo.dataset.iaCodigo) return null;
  const { iaCodigo } = ativo.dataset;
  const [inicio, fim] = [ativo.selectionStart, ativo.selectionEnd];
  return () => {
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.dataset.iaCodigo === iaCodigo) return;
    const novo = document.querySelector<HTMLInputElement>(`input[data-ia-codigo="${iaCodigo}"]`);
    novo?.focus();
    if (novo && inicio !== null && fim !== null) novo.setSelectionRange(inicio, fim);
  };
}

/**
 * NOD-122 (web/lib/foco-gaveta.ts): com a gaveta do app aberta, o resto da `.app` fica inerte e o Tab circula só nela.
 * A `.app` em si não fica inerte, porque a gaveta mora dentro dela. Ao abrir, o foco vai ao × da gaveta; ao fechar
 * (×, "Pronto", fundo ou Esc), volta a quem a abriu. Refeito a cada render, porque a grade é regravada.
 */
let gavetaMontada: string | null = null;
let origemDaGaveta: { act?: string; id?: string } | null = null;
let inertesDaGaveta: Element[] = [];
/** O que o Tab alcança dentro da gaveta (o ciclo de `voltaDoTab`). */
const FOCAVEIS_DA_GAVETA = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function origemDoFoco(): { act?: string; id?: string } | null {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLElement) || !ativo.closest(".mkt")) return null;
  return { act: ativo.dataset.act, id: ativo.dataset.id };
}

function prenderFocoNaGaveta(slug: string | null): void {
  for (const el of inertesDaGaveta) el.removeAttribute("inert");
  inertesDaGaveta = [];
  const app = document.querySelector(".app");
  const gaveta = slug ? document.querySelector<HTMLElement>(".tela-conectores .gaveta") : null;
  if (app && gaveta) {
    inertesDaGaveta = irmaosAteARaiz<Element>(gaveta, app, (no) => no.classList.contains("gaveta-fundo"));
    for (const el of inertesDaGaveta) el.setAttribute("inert", "");
  }
  const antes = gavetaMontada;
  gavetaMontada = gaveta ? slug : null;
  if (gavetaMontada && gavetaMontada !== antes) gaveta?.querySelector<HTMLElement>(".gaveta-fechar")?.focus();
  if (antes && !gavetaMontada) {
    const volta = seletoresDaOrigem(origemDaGaveta, antes, CSS.escape).map((s) => document.querySelector<HTMLElement>(s)).find((el) => el);
    volta?.focus();
    origemDaGaveta = null;
  }
}

/**
 * A barra lateral só é refeita quando algo que ela lê muda (definido em 2026-09-30): durante o streaming nada
 * nela muda, e o texto da busca e o filtro das linhas só precisam ser reaplicados quando as linhas são novas
 * (digitar na busca filtra direto, no ouvinte de input).
 */
function redesenharSidebar(): void {
  const html = lembrar("sidebar", estado, [ambienteBanco, buscaAberta, termoBusca() !== "", naFrente(), deixarNaoLida, secoesRecolhidas, edicaoTime?.alvo ?? "", [...selecaoBots].join(","), celular.ativo(), celular.botsAbertos(), frotaFalhou, favoritosTodos, celular.ativo() ? new Date().toDateString() : "", serializar(barraAtual), JSON.stringify(compartilhados), abaDoInicio, suaVezFalhou, quadrosDaAba.tipo === "pronto" ? quadrosDaAba.em : quadrosDaAba.tipo], renderSidebar);
  // NOD-119: no celular a barra é a gaveta de sempre; o <html> só leva a densidade no computador (virar o aparelho muda).
  pintarBarra(barraAtual, document.documentElement, celular.ativo(), buscaAberta || termoBusca() !== "");
  if (!regiaoMudaria("sidebar", html)) return;
  const busca = document.getElementById("busca-bots") as HTMLInputElement | null;
  const valorBusca = busca?.value ?? "";
  const focoBusca = document.activeElement === busca;
  // NOD-379: no celular o campo mora na barra flutuante; regravá-la com ele focado fecha o teclado do iOS e perde o acento
  // em composição. O filtro segue ao vivo; a lista se atualiza logo depois que a busca perde o foco.
  if (focoBusca && celular.ativo()) { sidebarAdiada = true; return; }
  const rolagem = document.querySelector<HTMLElement>("#sidebar .list")?.scrollTop ?? 0;
  const focoNoTime = focoDoTime();
  const focoNaTabBar = alvoDoFocoNaTabBar(document.activeElement);
  regiao("sidebar", html);
  devolverFocoDoTime(focoNoTime);
  if (focoNaTabBar) document.querySelector<HTMLElement>(`#sidebar ${focoNaTabBar}`)?.focus({ preventScroll: true });
  const novaBusca = document.getElementById("busca-bots") as HTMLInputElement | null;
  if (novaBusca) { novaBusca.value = valorBusca; if (focoBusca) novaBusca.focus({ preventScroll: true }); }
  filtrarBots(valorBusca);
  manterRolagemDaBarra(rolagem);
  religarTopoDoInicio();
}

/** A conversa cuja linha já foi trazida à vista: a barra só rola sozinha quando a conversa aberta muda. */
let conversaNaVistaDaBarra: string | null = null;

/**
 * definido em 2026-10-06 (web/lib/rolagem-barra.ts): a lista refeita volta à rolagem de antes; com conversa nova aberta,
 * a linha dela entra na vista com o mínimo de movimento. Mede depois do filtro da busca, que esconde linhas.
 */
function manterRolagemDaBarra(anterior: number): void {
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  if (!lista) return;
  const t = estado.tela;
  const conversa = t.tipo === "conversa" || t.tipo === "sala" ? t.conversaId : null;
  const el = conversa && conversa !== conversaNaVistaDaBarra ? lista.querySelector<HTMLElement>('[aria-current="true"]') : null;
  let linha: Faixa | null = null;
  if (el && el.offsetParent !== null) {
    const r = el.getBoundingClientRect();
    const caixa = lista.getBoundingClientRect();
    // Coordenadas do conteúdo da lista, já com a rolagem de antes.
    linha = { topo: r.top - caixa.top + anterior, base: r.bottom - caixa.top + anterior };
    conversaNaVistaDaBarra = conversa;
  }
  lista.scrollTop = rolagemDaBarra({ anterior, altura: lista.clientHeight, linha });
}

// ---------------------------------------------------------------------------------------------
// Sessão, SSE e relógio.

async function iniciarSessao(escopo: Escopo): Promise<void> {
  conexoes.cancelarTodas();
  // NOD-106: outra pessoa ou outro tenant, a leitura da sessão velha para (o reducer zera o estado, o som ia seguir).
  if (escopo.tenantId !== estado.sessao?.tenantId || escopo.pessoaId !== estado.sessao?.pessoaId) tocador.parar("saiu");
  // NOD-407: o retry do Acordar é da sessão que clicou; nunca acorda o computador de outra pessoa.
  cancelarRetryDoComputador();
  // Os rascunhos são da pessoa: outra sessão, outros rascunhos.
  rascunhos.usar(`${escopo.tenantId}.${escopo.pessoaId}`);
  api = criarApi(escopo);
  // NOD-324: a disponibilidade do ditado (e o aceite do aviso) é da sessão; a da anterior não decide o 🎤 desta.
  ditado.reiniciar();
  // NOD-455: os compartilhados e o quadro aberto são da pessoa: outra sessão não herda a lista da anterior.
  compartilhados = [];
  lendoCompartilhados++;
  quadroCompartilhado.fechar();
  // Outra sessão, outra fila: a primeira leitura volta a ser só a linha de base.
  avisador.reiniciar();
  canalAvisos.contador(0);
  deepLink.novaSessao();
  ambienteBanco = await api.ambiente();
  dispatch({ tipo: "sessao", escopo });
  void api.preferencias().then((p) => {
    if (p.usoDoMac) dispatch({ tipo: "uso-do-mac", uso: p.usoDoMac });
    atualizarModoNoComposer();
    dispatch({ tipo: "modo-dev", ligado: p.modoDev });
    if (p.experimentos) dispatch({ tipo: "experimentos", experimentos: p.experimentos, quadroLiberado: p.quadroLiberado ?? false });
    aplicarModoDevNoComputador(p.modoDev);
    const c = conversaDaTela(estado);
    if (p.modoDev && c) void carregarRaioX(c.conversa.id);
  }, () => undefined);
  // Outra sessão: a ligação da anterior sai da tela (o servidor a encerra se ninguém voltar em 10 s).
  telaLigacao.descartar();
  telaOnboarding.descartar();
  telaConta.descartar();
  contaAtual = null;
  ligacaoParaRetomar = null;
  void api.ligacaoViva().then(({ ligacao }) => {
    if (ligacao && (ligacao.estado === "chamando" || ligacao.estado === "em_curso")) { ligacaoParaRetomar = ligacao; render(); }
  }, () => undefined);
  live?.disconnect();
  live = criarLiveEvents(api.urlEventos, {
    aoReidratar: () => {
      dispatch({ tipo: "invalidar", quais: invalidacoesAoRetomar(estado) });
      quadroNaTela.reler(); // NOD-442/455: fora do reducer
      quadroCompartilhado.reler();
      relerCompartilhados();
      // NOD-324: o aviso de voz, sem descartar a fala.
      void ditado.reler();
    },
  });
  live.subscribe((ev) => {
    if (ev.tipo === "frame") receberFrame(ev.frame);
    else if (ev.tipo === "conexao") {
      // NOD-216: o stream que volta depois de cair relê os turnos vivos (a conversa aberta e os donos da barra), mesmo
      // com o replay: um turno.encerrado de antes do buffer deixaria o mascote animado para sempre.
      for (const acao of acoesAoMudarConexao(estado, ev)) dispatch(acao);
      if (ev.estado === "reconectando" && ev.proximaEmMs !== null) conferirSessaoAoCair();
    }
  });
  live.connect();
  dispatch({ tipo: "invalidar", quais: ["frota", "sua-vez", "nao-lidos", "salas", "executor", "rotinas"] });
  void lerComputadorAgora();
  // #195: a task que estava aberta antes de recarregar volta aberta.
  const task = taskLembrada();
  if (task) navegar(task);
}

/**
 * NOD-345 (revisão do PR 504): o canal ao vivo caiu. Se foi porque a sessão foi encerrada (sair das outras, senha nova
 * em outro aparelho), a página volta à tela de entrar em vez de ficar reconectando para sempre. Rede fora não conta.
 */
let conferindoSessao = false;
function conferirSessaoAoCair(): void {
  if (conferindoSessao) return;
  conferindoSessao = true;
  sessaoApi.atual().then(
    (escopo) => {
      conferindoSessao = false;
      // O cookie mudou de conta (outra aba entrou, importou ou trocou): esta aba recomeça na conta nova.
      if (estado.sessao && (escopo.tenantId !== estado.sessao.tenantId || escopo.pessoaId !== estado.sessao.pessoaId)) window.location.reload();
    },
    (e: unknown) => {
      conferindoSessao = false;
      if (e instanceof ErroApi && e.status === 401) window.location.reload();
    },
  );
}

/** NOD-370: a seção de cada região rolável na última pintura (a rolagem só volta na mesma seção). */
const chaveDaRolagem = new Map<string, string | null>();

/**
 * Revisão do #228 (2026-10-09): regrava a região e reabre os `<details data-disclosure>` que estavam abertos, devolvendo
 * o foco ao que o tinha. Este Mac é relida a cada 30 s (ADR-091), e o "porquê" aberto pela pessoa fechava sozinho.
 */
// NOD-85: com a agenda carregada, abre no agora (ou vai até o dia pedido pela régua, mini mês ou link) e avisa o estado
// para não rolar de novo no próximo quadro. O movimento suave sai com prefers-reduced-motion.
function rolarAgenda(): void {
  const ui = estado.agenda.ui;
  if (!estado.espaco || secaoAberta(estado) !== "rotinas" || !estado.agenda.dto || (ui.alvo === null && !ui.rolarAgora)) return;
  const alvo = ui.alvo ? document.getElementById(`ag-dia-${ui.alvo}`) : document.querySelector<HTMLElement>("#espaco .ag-agora");
  const suave = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  alvo?.scrollIntoView({ block: ui.alvo ? "start" : "center", behavior: suave ? "smooth" : "auto" });
  queueMicrotask(() => dispatch({ tipo: "agenda-rolou" }));
}
function regiaoReabrindo(id: string, html: string, rolagem?: { seletor: string; chave: string | null }): void {
  const raiz = document.getElementById(id);
  const chaveAntes = chaveDaRolagem.get(id) ?? null;
  if (rolagem) chaveDaRolagem.set(id, rolagem.chave);
  if (!raiz || !regiaoMudaria(id, html)) return regiao(id, html);
  // NOD-370: a lista redesenhada (Agentes depois de excluir ou ocultar) fica na rolagem em que estava e o botão focado
  // (o ⋯ da linha) volta com o foco quando o elemento foi trocado.
  const posicao = guardarPosicao(raiz as unknown as RaizDaLista, document.activeElement instanceof HTMLButtonElement ? document.activeElement : null, rolagem ? { seletor: rolagem.seletor, chaveAntes } : null);
  // ADR-102: o campo marcado (o código do login, o apelido) volta com o foco e o cursor depois de redesenhar.
  // NOD-346: o "Sobre mim" é textarea e também volta com o foco.
  const ativoCampo = document.activeElement;
  const campo = (ativoCampo instanceof HTMLInputElement || ativoCampo instanceof HTMLTextAreaElement) && raiz.contains(ativoCampo) ? ativoCampo : null;
  const manter = campo?.dataset.manterFoco ? { chave: campo.dataset.manterFoco, valor: campo.value, ini: campo.selectionStart, fim: campo.selectionEnd } : null;
  const abertos = new Set([...raiz.querySelectorAll<HTMLDetailsElement>("details[data-disclosure][open]")].map((el) => el.dataset.disclosure));
  const ativo = document.activeElement instanceof HTMLElement && raiz.contains(document.activeElement) ? document.activeElement.closest<HTMLDetailsElement>("details[data-disclosure]")?.dataset.disclosure ?? null : null;
  // NOD-367 (revisão 2): o botão, switch ou seletor focado volta ao mesmo controle no HTML novo (chave estável, não posição).
  const focado = !manter && document.activeElement instanceof HTMLElement && raiz.contains(document.activeElement) ? document.activeElement : null;
  const seletorFoco = focado ? seletorDoFocoNaRegiao(focado) : null;
  regiao(id, html);
  if (focado && !focado.isConnected && seletorFoco) {
    try { raiz.querySelector<HTMLElement>(seletorFoco)?.focus({ preventScroll: true }); } catch { /* um data-* que não vira seletor: o foco não volta, o render segue */ }
  }
  for (const el of raiz.querySelectorAll<HTMLDetailsElement>("details[data-disclosure]")) {
    if (abertos.has(el.dataset.disclosure)) el.open = true;
    if (ativo !== null && el.dataset.disclosure === ativo) el.querySelector("summary")?.focus();
  }
  const volta = manter ? raiz.querySelector<HTMLInputElement | HTMLTextAreaElement>(`input[data-manter-foco="${CSS.escape(manter.chave)}"], textarea[data-manter-foco="${CSS.escape(manter.chave)}"]`) : null;
  if (volta && manter) {
    volta.value = manter.valor;
    volta.focus();
    volta.setSelectionRange(manter.ini, manter.fim);
  }
  reporPosicao(raiz as unknown as RaizDaLista, posicao, rolagem ?? null);
}

/** ADR-090: o código de pareamento da máquina que veio na URL, guardado até a sessão existir. */
const CHAVE_CODIGO_MAQUINA = "nod-parear-maquina";
/** NOD-416 (ADR-144): o link da tarefa (`?tarefa=ZE-12`), guardado até a sessão existir. */
const CHAVE_TAREFA_LINK = "nod-tarefa-link";
const CHAVE_QUADRO_LINK = "nod-quadro-link";
const CHAVE_VOLTA_NUVEM = "nod-volta-nuvem";
async function boot(): Promise<void> {
  dispatch({ tipo: "tick", agora: Date.now() });
  let ticks = 0;
  window.setInterval(() => {
    ticks += 1;
    // definido em 2026-09-24 ("aviso no Mac"): a decisora designada que não é dona não recebe frame
    // decisao.* (o outbox manda à dona); sem isto o pedido dela só aparecia — e só avisava — quando
    // outra coisa relesse "Sua vez".
    if (ticks % TICKS_POR_RELEITURA === 0 && estado.sessao) estado = reduzir(estado, { tipo: "invalidar", quais: ["sua-vez"] });
    // ADR-091 (definido em 2026-10-09): o uso da CPU muda a cada leitura sem mudar de nível (e só a mudança de nível vira
    // frame) — com Este Mac aberta, os números são relidos a cada 30 s, a batida do amostrador.
    // Revisto em 2026-10-09: também com Máquinas aberta, que mostra a leitura de cada máquina.
    // Revisto em 2026-10-11: com Máquinas aberta, a lista também. Máquina que cai ou volta não vira `inventario.mudou` (só a
    // mudança das IAs da pessoa vira), e o cartão ficava em "sem contato" com a VM já de volta e os bots trabalhando nela.
    // Desde a NOD-300 (2026-10-20) ela vira (motivo "presenca", no varrer da ponte); esta releitura fica como rede.
    if (ticks % 2 === 0 && estado.sessao && secaoAberta(estado) === "maquinas") estado = reduzir(estado, { tipo: "invalidar", quais: ["trabalhos", "maquinas"] });
    // ADR-121 (NOD-92): de volta do Google, o preparo da conta roda no servidor; a conta é relida até ele terminar.
    const conta = estado.nuvem.conta;
    if (estado.sessao && estado.nuvem.aviso === "preparando" && conta !== "desligada" && (conta === null || conta.preparando)) estado = reduzir(estado, { tipo: "invalidar", quais: ["nuvem", "maquinas"] });
    // PR 2: enquanto o nod cria uma VM, a conta (a lista do que está sendo criado) e as máquinas são relidas: o motor pareia sozinho.
    // Revisão NOD-92 (item 17): a primeira leitura que falhou (rede, 5xx) deixa a conta em null; o tique tenta de novo.
    else if (estado.sessao && secaoAberta(estado) === "maquinas" && (conta === null || relerEnquantoCria(estado.nuvem))) estado = reduzir(estado, { tipo: "invalidar", quais: ["nuvem", "maquinas"] });
    dispatch({ tipo: "tick", agora: Date.now() });
  }, 15_000);
  const url = new URL(window.location.href);
  const pedidoNaUrl = lerPedido(url.searchParams);
  if (url.searchParams.has(PARAMETROS_DO_PEDIDO[0])) {
    if (pedidoNaUrl) { try { window.sessionStorage.setItem(CHAVE_GUARDADA, JSON.stringify(pedidoNaUrl)); } catch { /* sem storage: o diálogo não abre e o app espera até o prazo */ } }
    for (const k of PARAMETROS_DO_PEDIDO) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // ADR-090: o link que o motor mostra no terminal (`?parear-maquina=K7QM-4F2X`) abre Máquinas › Conectar com o código,
  // depois do login se preciso (fica na sessionStorage da aba até a sessão existir).
  const codigoMaquina = url.searchParams.get("parear-maquina");
  if (codigoMaquina !== null) {
    try { window.sessionStorage.setItem(CHAVE_CODIGO_MAQUINA, codigoMaquina.slice(0, 16)); } catch { /* sem storage: a pessoa digita o código */ }
    url.searchParams.delete("parear-maquina");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // NOD-455: o link direto /quadros/:qid (no recarregar e no celular) abre o quadro compartilhado depois da sessão.
  const quadroNaUrl = quadroDaUrl(url.pathname);
  if (quadroNaUrl) { try { window.sessionStorage.setItem(CHAVE_QUADRO_LINK, quadroNaUrl); } catch { /* sem storage: o link não abre */ } }
  // NOD-416: o link da tarefa abre a conversa do bot dela, no Quadro, com a tarefa em tela cheia (depois do login se preciso).
  const tarefaNaUrl = url.searchParams.get(PARAMETRO_TAREFA);
  if (tarefaNaUrl !== null) {
    try { window.sessionStorage.setItem(CHAVE_TAREFA_LINK, tarefaNaUrl.slice(0, 40)); } catch { /* sem storage: o link não abre */ }
    url.searchParams.delete(PARAMETRO_TAREFA);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // ADR-121 (NOD-92): a volta do Google (`/maquinas?nuvem=preparando|recusado`) abre Máquinas com o aviso, depois do login.
  const voltaDaNuvem = url.searchParams.get("nuvem");
  if (voltaDaNuvem !== null) {
    if (voltaDaNuvem === "preparando" || voltaDaNuvem === "recusado") { try { window.sessionStorage.setItem(CHAVE_VOLTA_NUVEM, voltaDaNuvem); } catch { /* sem storage: sem o aviso */ } }
    url.searchParams.delete("nuvem");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  if (url.searchParams.get("entrar") === "recusado") {
    entrada = { ...entrada, recusado: true };
    marcarEquipe(false);
    url.searchParams.delete("entrar");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // NOD-345: a volta do Google para conta (`/?conta=convertida|escolher|recusado|entrou`) e o link de recuperação
  // (`/#redefinir=<token>`). Os dois saem da URL na hora; o token não fica no histórico.
  const voltaDaConta = url.searchParams.get("conta");
  const saiu = url.searchParams.get("saiu") === "1";
  if (voltaDaConta !== null || saiu) {
    url.searchParams.delete("conta");
    url.searchParams.delete("saiu");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  // NOD-346: o link do e-mail novo (`/#confirmar-email=<token>`) confirma a troca e abre Minha conta com o resultado.
  const linkConfirmar = window.location.hash.startsWith("#confirmar-email=");
  const tokenConfirmar = /^#confirmar-email=([A-Za-z0-9_-]{20,100})$/.exec(window.location.hash)?.[1] ?? null;
  if (linkConfirmar) window.history.replaceState(null, "", url.pathname + url.search);
  const confirmando = linkConfirmar ? telaMinhaConta.confirmarEmail(tokenConfirmar) : null;
  const tokenRedefinir = /^#redefinir=([A-Za-z0-9_-]{20,100})$/.exec(window.location.hash)?.[1] ?? null;
  if (window.location.hash.startsWith("#redefinir=")) window.history.replaceState(null, "", url.pathname + url.search);
  if (tokenRedefinir || window.location.hash.startsWith("#redefinir=")) {
    entrada = { ...entrada, redefinir: tokenRedefinir ? { token: tokenRedefinir, erro: null, vencido: false, ocupado: false } : { token: "", erro: null, vencido: true, ocupado: false } };
    render();
    entrada = { ...entrada, modo: await sessaoApi.modo().catch(() => null) };
    return render();
  }
  try {
    await iniciarSessao(await sessaoApi.atual());
    abrirCodigoDeMaquinaGuardado();
    abrirVoltaDaNuvemGuardada();
    void abrirTarefaGuardada(); abrirQuadroGuardado();
    await lerContas(voltaDaConta);
    if (confirmando) { await confirmando; if (contas?.minhaConta) abrirEspaco("conta"); }
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) {
      render();
      try {
        const modo = await sessaoApi.modo();
        entrada = { ...entrada, modo };
        // NOD-345: com o espaço provisório ligado, a primeira visita chega à conversa sem cadastro: o verificador desta
        // instalação (localStorage) pede o espaço e volta ao mesmo espaço depois. Fora isso, a tela de entrada de antes.
        // No app, o espaço provisório vem pelo processo principal (com a chave de máquina); aqui seria um espaço só da
        // tela, sem executor. Sessão do app que caiu volta à tela de entrar.
        // NOD-406: a volta recusada do Google da equipe fica na tela de entrada, com o motivo, sem abrir um provisório.
        // A marca da equipe: quem já entrou pelo Google da equipe neste navegador volta à tela de entrar.
        if (abreProvisorio({ saiu, recusado: entrada.recusado, bootstrap: modo.contas?.bootstrap ?? false, noApp: window.nodDesktop !== undefined, equipe: daEquipe(), pareando: pedidoPendente() !== null || codigoDeMaquinaPendente() }) && (await provisorioDaWeb())) {
          await iniciarSessao(await sessaoApi.atual());
          // O link da tarefa também vale na primeira visita, no espaço provisório (revisão do PR #623).
          void abrirTarefaGuardada(); abrirQuadroGuardado();
          await lerContas(voltaDaConta);
          return;
        }
        render();
      } catch (e2) {
        mostrarErroDoBoot(e2);
      }
    } else mostrarErroDoBoot(e);
  }
}

/** NOD-345: o verificador desta instalação na web (aleatório, guardado; perder = um espaço novo, o antigo fica). */
const CHAVE_VERIFICADOR = "nod-instalacao";
async function provisorioDaWeb(): Promise<boolean> {
  let v: string | null = null;
  try { v = window.localStorage.getItem(CHAVE_VERIFICADOR); } catch { /* sem storage: um verificador por visita */ }
  if (!v || !/^[A-Za-z0-9_-]{32,128}$/.test(v)) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    v = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { window.localStorage.setItem(CHAVE_VERIFICADOR, v); } catch { /* idem */ }
  }
  try {
    await contaApi.provisorioWeb(v);
    return true;
  } catch (e) {
    if (e instanceof ErroApi && e.desafio && e.bits) {
      const resposta = await resolverProvaNoNavegador(e.desafio, e.bits);
      if (resposta !== null) {
        try { await contaApi.provisorioWeb(v, { desafio: e.desafio, resposta }); return true; } catch { /* mostra o limite abaixo */ }
      }
    }
    // Muitos espaços novos da mesma rede (NAT de escritório, CGNAT): a tela de entrada diz por quê, em vez de só aparecer.
    if (e instanceof ErroApi && e.status === 429) entrada = { ...entrada, conta: { etapa: "entrar", enviadoPara: null, ocupado: false, ...entrada.conta, erro: LIMITE_PROVISORIO } };
    return false;
  }
}

/** NOD-346: o servidor não diz se a conta existiu (sem enumeração); a dica cobre quem excluiu e voltou depois do prazo. */
const ERRO_ENTRAR = "E-mail ou senha não conferem. Se você excluiu a conta há mais de 30 dias, ela e os dados foram apagados.";
const LIMITE_PROVISORIO = "Muitos espaços novos foram abertos desta rede agora. Entre com uma conta ou tente de novo em alguns minutos.";

/** NOD-345: com sessão, o que as contas dizem (o menu, o lembrete, o cartão que ficou aberto, a volta do Google). */
async function lerContas(volta: string | null): Promise<void> {
  const modo = entrada.modo ?? (await sessaoApi.modo().catch(() => null));
  // ADA-245: o texto do onboarding (Computadores, remover deste computador); sem a flag, as telas de antes.
  dispatch({ tipo: "onboarding-texto", ligado: modo?.onboardingTexto === true });
  contas = modo?.contas ?? null;
  loginGoogle = modo?.modo === "google";
  // NOD-406 (revisões r5/r6): o pedido "Conectar este Mac?" espera saber quem é a sessão. Sem contas ligadas, abre como
  // antes; sem conseguir ler o modo, fica guardado.
  if (!contas) { seguirPareamento(decidirPareamento({ modoLido: modo !== null, contas: false, estado: null })); return; }
  if (volta) {
    await telaConta.aoVoltarDoGoogle(volta);
    seguirPareamento(decidirPareamento({ modoLido: true, contas: true, estado: contaAtual, volta }));
    return;
  }
  const e = await telaConta.retomar();
  // NOD-406: a sessão da equipe (pessoa de antes das contas) marca o navegador; a recusa do Google tira a marca (no boot).
  if (e?.legado) marcarEquipe(true);
  // NOD-406: o Google da equipe recusou e o cookie do provisório seguiu valendo: o motivo aparece no cartão de entrar,
  // em vez de a pessoa voltar ao espaço sem saber por quê.
  if (entrada.recusado && e && !e.conta && !e.legado) {
    entrada = { ...entrada, recusado: false };
    await telaConta.abrir("entrar", true, RECUSA_EQUIPE);
    return;
  }
  seguirPareamento(decidirPareamento({ modoLido: true, contas: true, estado: e }));
}
function daEquipe(): boolean {
  try { return window.localStorage.getItem(CHAVE_EQUIPE) === "1"; } catch { return false; }
}
function marcarEquipe(sim: boolean): void {
  try { if (sim) window.localStorage.setItem(CHAVE_EQUIPE, "1"); else window.localStorage.removeItem(CHAVE_EQUIPE); } catch { /* sem storage: sem a marca */ }
}
const RECUSA_EQUIPE = "Não foi possível entrar com essa conta Google. Se ela ainda não tem acesso ao nod, peça para ser cadastrada.";
/** NOD-406: o link da equipe no cartão de entrar e no menu do espaço provisório. */
const equipeDoApp = () => equipeNoApp({ loginGoogle, contaGoogle: contas?.google ?? false, noApp: window.nodDesktop !== undefined, ponte: typeof window.nodDesktop?.souDaEquipe === "function" });
const linkEquipe = () => linkDaEquipe({ loginGoogle, contaGoogle: contas?.google ?? false, noApp: window.nodDesktop !== undefined, url: sessaoApi.urlGoogle });

/** NOD-406 (revisão r5): com contas ligadas, o espaço provisório entra numa conta antes de conectar o Mac. */
const PAREAR_PROVISORIO = "Para conectar o app do Mac, entre primeiro na sua conta. O pedido do app continua esperando.";
/** "abrir" = "Conectar este Mac?"; "entrar" = o cartão de entrar, com o pedido guardado; "esperar" = nada. */
function seguirPareamento(passo: PassoPareamento): void {
  const pedido = pedidoPendente();
  if (!pedido || !api || passo === "esperar" || document.getElementById("parear-titulo")) return;
  if (passo === "abrir") abrirPareamento(api, pedido, esquecerPedido);
  else void telaConta.abrir("entrar", true, PAREAR_PROVISORIO);
}

/** Revisão NOD-215: sem sessão, a falha de rede do boot fica no "Reconectando…" e a página recarrega quando o nod voltar. */
function mostrarErroDoBoot(e: unknown): void {
  const erro = erroDe(e);
  if (erro === null) return;
  if (ehErroDeRede(erro)) {
    bootCaiuPorRede = true;
    redeCaiu(erro);
  } else dispatch({ tipo: "erro", erro });
}

// ---------------------------------------------------------------------------------------------
// Conexão de apps (definido em 2026-09-25, jornadas de conexão): uma espera por app, e o que fazer quando
// o login termina. Sem um `depois` da própria tentativa, o padrão: no marketplace a gaveta abre em
// "Quem pode usar"; no chat, o card já virou o de permitir no servidor e a conversa só relê.

const conexoes = criarConexoes({
  conectar: (slug) => api!.conectarApp(slug),
  verificar: (slug) => api!.verificarApp(slug),
  mudou: (slug, valor) => dispatch({ tipo: "conexao-app", slug, valor }),
  conectado: (slug) => {
    const conversa = conversaAtual();
    dispatch({ tipo: "invalidar", quais: ["conectores", "sua-vez", "frota", ...(conversa ? [`conversa:${conversa.conversaId}` as Invalidacao] : [])] });
    const t = estado.tela;
    if (t.tipo === "conectores" && !t.avancado) navegar({ ...t, gaveta: { slug, passo: "quem-usa" } });
  },
  abrirJanela: (nome) => {
    try {
      const janela = window.open("", nome, "popup,width=560,height=720");
      // Ainda about:blank, da nossa origem: cortar o opener impede a página do provedor de navegar o Nod.
      if (janela) janela.opener = null;
      return janela;
    } catch { return null; }
  },
  ...(window.nodDesktop !== undefined ? { abrirNoNavegador: (url: string) => {
    // definido em 2026-10-12 (GFK-2019): o handler do Electron pede abertura fora e retorna deny/null, sem confirmação.
    window.open(url, "_blank", "noopener,noreferrer");
  } } : {}),
  esperar: (ms) => new Promise((r) => window.setTimeout(r, ms)),
  agora: () => Date.now(),
});

/** Chamado DENTRO do clique (a janela de login só abre sem bloqueio no gesto da pessoa). `depois` morre com a tentativa. */
function iniciarConexao(slug: string, depois: (() => Promise<void>) | null = null): void {
  if (!slug) return;
  // O GitHub não depende do Composio (ADR-048): o servidor tenta o gh desta máquina e o token antes.
  if (!estado.composioConfigurado && slug !== "github") {
    abrirMarketplace(true);
    dispatch({ tipo: "aviso-conexao", texto: "Para conectar apps, adicione a chave do Composio do time abaixo." });
    return;
  }
  dispatch({ tipo: "erro", erro: null });
  void conexoes.iniciar(slug, depois).catch((e: unknown) => mostrarErro(e));
}

function propostaDoEstado(id: string): Proposta | null {
  for (const c of Object.values(estado.conversas)) {
    const p = c.propostas.find((x) => x.id === id);
    if (p) return p;
  }
  return estado.suaVez?.itens.find((i) => i.proposta?.id === id)?.proposta ?? null;
}

// ---------------------------------------------------------------------------------------------
// Ações (delegação por data-act e data-form). A web só pede; o servidor decide.

/**
 * NOD-85: Rotinas é uma seção das Configurações (por cima da tela). Vindo do formulário de nova rotina (criar ou
 * cancelar), sai dele antes: fechar as Configurações não pode voltar ao formulário já enviado (Codex no PR 595).
 */
function abrirRotinas(): void {
  if (estado.tela.tipo === "nova-rotina") navegar({ tipo: "inicio" });
  abrirEspaco("rotinas");
}

/** NOD-422 (PR 2): a trilha do quadro, só com o quadro ligado nos experimentos (o servidor confere de novo). */
function trilharQuadro(e: EventoTrilhaQuadro): void {
  if (!api || estado.experimentos.quadro !== true) return;
  try {
    void api.trilhaQuadro([e]).catch(() => undefined);
  } catch {
    // Sem rede ou sem sessão: a trilha some, a tela segue.
  }
}

function navegar(tela: Tela, o: { filaDeSuaVez?: boolean } = {}): void {
  // NOD-85: a tela antiga de Rotinas virou a agenda das Configurações; todo caminho que levava a ela abre a seção.
  if (tela.tipo === "rotinas") { abrirRotinas(); return; }
  const antes = estado.tela;
  // NOD-422: vindo da inicial do celular, é uma visita nova (pode contar outra vez). Antes do entrarNaConversa, que já
  // redesenha e observa (revisão 4 do PR #630: depois dele, a mesma visita agendava duas contas).
  if (celular.botsAbertos()) trilhaDaConversa.nova();
  // NOD-379: no celular o "início" é a tela inicial (fechar um Trabalho, voltar da conexão), não a conversa que o reducer
  // escolhe para ele; saindo dela, empilha uma entrada no histórico (o voltar do navegador volta a ela).
  // ADA-19: no celular, Sua vez é aba da inicial, não tela (emenda da ADR-148): o sino, o aviso e o link levam à aba.
  // A exceção é o pedido na conversa de outra pessoa (filaDeSuaVez): ela decide na fila, como no computador.
  if (celular.ativo() && abaDoDestino(tela) === "sua-vez" && !o.filaDeSuaVez) { trocarAbaDoInicio("sua-vez"); celular.voltarAoInicio(); return; }
  const paraInicial = celular.ativo() && tela.tipo === "inicio";
  if (!paraInicial) celular.entrarNaConversa();
  aoTrocarDeTela(antes, tela);
  dispatch({ tipo: "navegar", tela });
  conversaEscolhida = tela.tipo === "conversa" ? tela.conversaId : null;
  // NOD-422 (PR 2): a conversa de um bot aberta (a trilha do quadro; "sem mensagem em 60 s" sai na consulta). Só a
  // Conversa à vista conta, não o Quadro do bot (revisão do PR #630): web/lib/trilha-conversa.ts.
  trilhaDaConversa.observar();
  // Antes de ler a conversa: a que o reducer põe por baixo da inicial não conta como lida.
  if (paraInicial) celular.voltarAoInicio();
  lembrarTaskAberta(tela);
  lerConversaDaTela();
  if (rolaAoTopoAoNavegar(tela.tipo)) document.getElementById("timeline")?.scrollTo({ top: 0 });
}

/** A tela de onde a pessoa sai: no celular, com a inicial à vista, é a inicial (não a conversa escondida por baixo). */
function telaDeOrigem(): Tela {
  return celular.botsAbertos() ? { tipo: "inicio" } : estado.tela;
}

/** O que muda fora do reducer quando a tela troca: por `navegar` ou, na NOD-370, quando o bot da conversa saiu da frota. */
function aoTrocarDeTela(antes: Tela, tela: Tela): void {
  // NOD-380: a janela que cresce até a fala achada vale enquanto a pessoa está naquela conversa.
  if (alvoDaBusca && ((tela.tipo !== "conversa" && tela.tipo !== "sala") || tela.conversaId !== alvoDaBusca.conversaId)) alvoDaBusca = null;
  // A gaveta aberta só para um nível (ou a sobreposta, na janela estreita) fecha quando a conversa muda.
  if (tela.tipo !== "conversa" || antes.tipo !== "conversa" || antes.conversaId !== tela.conversaId) {
    painelAbertoNaHora = false;
    document.querySelector(".app")?.classList.remove("detalhes-abertos");
  }
  linhaEm = tela.tipo === "conversa" || tela.tipo === "sala" ? tela.conversaId : null;
  deixarNaoLida = null;
  // A linha "Novas" some ao navegar (reducer); a conta das levas vai junto.
  levaContada.clear();
  // NOD-106: sair da conversa para a leitura (a resposta some da tela).
  if (tocador.atual() && (tela.tipo !== "conversa" || antes.tipo !== "conversa" || antes.conversaId !== tela.conversaId)) tocador.parar("saiu");
}

/**
 * definido em 2026-10-04: o Marketplace lembra de onde a pessoa veio para o "‹ <de onde veio>" do topo, como Seu espaço.
 * Andar dentro dele (Avançado, voltar ao Marketplace, clicar no botão de novo) não esquece a origem.
 */
function abrirMarketplace(avancado = false): void {
  esquecerErroDoCanvas();
  const t = telaDeOrigem();
  const voltar = t.tipo === "conectores" ? t.voltar : t.tipo === "inicio" ? undefined : t;
  navegar({ tipo: "conectores", ...(avancado ? { avancado: true as const } : {}), ...(voltar ? { voltar } : {}) });
}

/** Abre a tela da task; de dentro de outra task (ou de uma linha), o Fechar continua voltando para a tela de fora. */
function abrirTrabalho(id: string): void {
  if (id) navegar(telaDaTask(telaDeOrigem(), id));
}

function fecharTask(): void {
  const voltar = telaAoFechar(estado.tela);
  if (voltar) navegar(voltar);
}

async function mudarGestao(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao", "rotinas", "salas", "sua-vez"] });
  } catch (e) { mostrarErro(e); throw e; }
}

/** NOD-370: depois de excluir ou ocultar, o anúncio e o foco na lista em que a pessoa estava (web/lib/posicao-da-lista.ts). */
function depoisDeTirarDaLista(a: BotGerido, grupo: "Excluídos" | "Ocultos"): (dialogoAindaAberto: boolean) => void {
  return planejarSaidaDaLista({ doc: document as unknown as RaizDaLista, ativo: () => document.activeElement, agentesAberto: secaoAberta(estado) === "agentes", id: a.id, nome: a.nome, grupo, anunciar: anunciarGestao, lembrarFoco: (seletor) => focoPendente.lembrar(seletor) });
}

/** NOD-370: a região viva fica fora da `.app`, que está inerte (fora da árvore de acessibilidade) com Seu espaço aberto. */
function anunciarGestao(texto: string): void {
  anunciarEm(document.getElementById("anuncio-gestao"), texto, (fn) => window.setTimeout(fn, 50));
}

function acaoDoBot(a: BotGerido, acao: AcaoGestao): void {
  const executar = (fn: () => Promise<unknown>) => void agir(async () => { await mudarGestao(fn); });
  if (acao === "perfil") { abrirNivel(a.id, { tipo: "perfil" }); return; }
  // NOD-382: no celular o menu tem "Ver perfil"; da lista, o ‹ do perfil volta para a lista.
  if (acao === "ver-perfil") { abrirPerfil(a.id, celular.botsAbertos() ? "lista" : "chat"); return; }
  if (ehCelular() && acao === "excluir") { excluirNoCelular(a); return; }
  // ADR-125 (NOD-349): Renomear abre a gaveta com o nome em edição (saiu o diálogo); Enter ou blur salva, Esc desfaz.
  if (acao === "renomear") { renomearNaGaveta(a); return; }
  // NOD-437: "Time · Produto" abre a escolha do time (no celular, a folha que sobe).
  if (acao === "mover") { abrirEscolhaDeTime([a.id], document.querySelector<HTMLElement>(`#sidebar [data-bot-contexto="${CSS.escape(a.id)}"]`), a.nome); return; }
  if (acao === "duplicar") {
    const texto = textoDuplicar(a.ownerId === estado.sessao?.pessoaId);
    pedirGestao(`Duplicar ${a.nome}?`, texto, "Duplicar", async () => {
      const r = await api!.duplicar(a.id);
      await mudarGestao(async () => r);
      navegar({ tipo: "conversa", agenteId: r.agente.id, conversaId: r.conversa.id });
    }); return;
  }
  if (acao === "excluir") {
    pedirGestao(`Excluir ${a.nome}?`, "<p>O bot vai para Excluídos. Novos trabalhos serão bloqueados, rotinas pausadas e acessos revogados. Trabalhos em andamento receberão um pedido de interrupção; ações externas já realizadas não podem ser desfeitas.</p><p>Você pode recuperar o perfil e o histórico em Configurações › Agentes.</p>", "Excluir agente", async () => {
      // NOD-370: a pessoa fica onde estava (Seu espaço só continua aberto se ela já estava nele).
      await mudarGestao(() => api!.excluirAgente(a.id));
    }, true, depoisDeTirarDaLista(a, "Excluídos")); return;
  }
  if (acao === "copiar") {
    void navigator.clipboard.writeText(a.conversaId).then(() => pedirGestao("ID copiado", `<p>ID da conversa copiado para a área de transferência.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})).catch(() => pedirGestao("ID da conversa", `<p>Selecione e copie o ID abaixo.</p><input aria-label="ID da conversa" readonly value="${esc(a.conversaId)}" />`, "Concluir", async () => {})); return;
  }
  if (acao === "ocultar" && !a.oculto) {
    pedirGestao("Ocultar da barra lateral?", "<p>O bot e suas rotinas continuam funcionando. Para trazê-lo de volta, abra Configurações › Agentes › Ocultos.</p>", "Ocultar", async () => {
      await mudarGestao(() => api!.ocultar(a.id, true));
    }, false, depoisDeTirarDaLista(a, "Ocultos")); return;
  }
  if (acao === "nao-lido") {
    // definido em 2026-09-29 (0039): o menu vale pelo "lido até". Marcar a conversa aberta como não lida não pode ser
    // desfeito pela leitura automática: ela fica não lida até a pessoa sair dela.
    const nova = a.naoLido === true;
    if (!nova) deixarNaoLida = a.conversaId;
    // NOD-449: todo "marcar como lido" tem Desfazer no aviso (revisão do PR #616).
    if (nova) { void marcarComDesfazer(a.conversaId, a.nome); return; }
    void agir(async () => { await api!.marcarNaoLida(a.conversaId); dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota"] }); });
    return;
  }
  executar(() => acao === "fixar" ? api!.fixar(a.id, !a.fixado) : acao === "restaurar" ? api!.restaurarAgente(a.id) : api!.ocultar(a.id, false));
}

/**
 * Clique no aviso: abre a task de onde veio (NOD-114, ADR-083), ou a conversa do bot (ou a sala); a conversa de outra
 * pessoa (a decisora designada não a lê) abre "Sua vez".
 */
function abrirAlvoDoAviso(alvo: AlvoAviso): void {
  if (!estado.sessao) return;
  // NOD-93: o primeiro download da VM local abre o painel do computador com a janela de primeiro uso (a cena do
  // mascote, a barra com os MB e o "Continuar em segundo plano").
  const destino = destinoDoAlvo(alvo, { pessoaId: estado.sessao.pessoaId, agentes: estado.frota?.agentes ?? [], salas: estado.salas });
  if (destino.tipo === "computador-do-bot") {
    abrirEspaco("computador-do-bot");
    if (destino.primeiroUso) dispatch({ tipo: "computador-ui", ui: { preparoAberto: true } });
    return;
  }
  if (alvo.tipo === "trabalho") {
    abrirTrabalho(alvo.trabalhoId);
    return;
  }
  navegar(destino);
}

function botGerido(id: string | undefined): BotGerido | undefined {
  const a = [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((a) => a.id === id && !a.excluidoEm);
  // "Marcar como lido / não lido" no menu segue os não lidos, que chegam a cada mensagem (a frota não).
  return a && estado.naoLidos ? { ...a, naoLido: temNovas(a.conversaId) } : a;
}

function menuDoBot(el: HTMLElement): void {
  const a = botGerido(el.dataset.id);
  // ADR-125: o ⋯ saiu do topo da gaveta; o menu mora na linha da lista (clique direito, Shift+F10, toque longo e o ⋯ no toque).
  if (a) abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, el, (acao) => acaoDoBot(a, acao));
}

function conversaAtual(): { conversaId: string; salaId: string | null } | null {
  const t = estado.tela;
  if (t.tipo === "conversa") return { conversaId: t.conversaId, salaId: null };
  if (t.tipo === "sala") return { conversaId: t.conversaId, salaId: t.salaId };
  return null;
}

/**
 * A caixa "Respondendo" está à vista (duas ou mais perguntas abertas, plano "pergunta com botões", Parte 3a)? É só com ela
 * que o Esc manda a próxima mensagem como assunto novo, como o × dela: sem a caixa, o Esc mudaria algo que não se vê.
 */
function comCaixaRespondendo(conversaId: string): boolean {
  const modo = modoDoComposer(estado, conversaId);
  return modo.tipo === "resposta" && modo.perguntas.length > 1;
}

/**
 * Depois de responder ou dispensar uma pergunta (plano "pergunta com botões", acessibilidade): o foco volta ao campo da
 * conversa e a região viva diz o que aconteceu ("Resposta enviada: …").
 */
function anunciarPergunta(texto: string): void {
  const anuncio = document.getElementById("anuncio-pergunta");
  if (anuncio) {
    anuncio.textContent = "";
    window.setTimeout(() => { anuncio.textContent = texto; }, 50);
  }
  if (estado.tela.tipo === "conversa" || estado.tela.tipo === "sala") document.getElementById("composer-texto")?.focus();
}

// ---- o "/" do campo (definido em 2026-09-28; canvas "Comandos /") --------------------------------------------------
// O catálogo vem do servidor (o que o Mac mandou no último turno) e é relido quando a lista abre, no máximo por minuto.
let comandosDto: ComandosDto | null = null;
let comandosLidosEm = 0;

async function carregarComandos(): Promise<void> {
  if (!api || Date.now() - comandosLidosEm < 60_000) return;
  comandosLidosEm = Date.now();
  try {
    comandosDto = await api.comandos();
  } catch {
    // Sem a lista, o campo continua mandando texto: "/nome" ainda roda a skill no Mac.
  }
}

function nomeDoBotDaTela(): string {
  const t = estado.tela;
  return t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "o bot" : "o bot";
}

/** O contexto da lista "/" do chat: o catálogo, as recentes da conversa e de quem é o bot (ADA-5: a pílula usa o mesmo). */
function contextoDaBarra(): ContextoDaBarra {
  const bot = estado.tela.tipo === "conversa" ? botGerido(estado.tela.agenteId) : undefined;
  return {
    dto: comandosDto,
    recentes: recentesDaConversa(conversaDaTela(estado)?.mensagens ?? []),
    atalhos: estado.tela.tipo === "conversa",
    botProprio: Boolean(bot && bot.ownerId === estado.sessao?.pessoaId && bot.confirmado && bot.papel !== "nod"),
    bot: nomeDoBotDaTela(),
  };
}
const recarregarComandos = (): Promise<void> | null => (Date.now() - comandosLidosEm >= 60_000 ? carregarComandos() : null);
// ADA-5: a lista "/" do chat é a do composer (web/lib/composer.ts); os ids do #composer seguem os mesmos.
const barraDoChat = criarBarra({ lista: () => document.getElementById("barra-lista"), dica: () => document.getElementById("barra-dica"), contexto: contextoDaBarra, recarregar: recarregarComandos });
const atualizarBarra = (ta: HTMLTextAreaElement): void => barraDoChat.atualizar(ta);
const teclaNaBarra = (ev: KeyboardEvent, ta: HTMLTextAreaElement): boolean => barraDoChat.tecla(ev, ta);

/**
 * Os comandos que o nod resolve sem turno: /nova-sessao zera a sessão do bot (o /clear do CLI não esquece — medido)
 * e /modelo abre a escolha de modelo e esforço. Os outros seguem como mensagem: o servidor põe o nome do CLI.
 */
async function comandoDoNod(texto: string, alvo: { conversaId: string; salaId?: string | null }): Promise<boolean> {
  const c = comandoNoTexto(comandosDto, texto);
  if (!c || !("conversa" in c) || alvo.salaId || !api) return false;
  const t = estado.tela;
  if (c.conversa.acao === "nod") {
    const a = api;
    await agir(async () => {
      await a.novaSessao(alvo.conversaId);
      dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    });
    return true;
  }
  if (c.conversa.acao === "tela" && t.tipo === "conversa") {
    abrirInteligencia(t.agenteId);
    return true;
  }
  return false;
}

/**
 * Depois de enviar, o campo e o rascunho só se esvaziam se ainda têm o texto enviado: o que a pessoa digitou enquanto
 * a mensagem ia ao servidor, ou numa conversa para onde ela foi no meio, fica onde está.
 */
function limparDepoisDeEnviar(ta: HTMLTextAreaElement, chave: string | null, texto: string): void {
  // NOD-444: a pílula some quando o envio é aceito (não no upload em andamento nem com a caixa vazia).
  mostrarSugestaoRotina(false);
  const naTela = ta.isConnected && composerDe === chave;
  if (naTela && ta.value.trim() === texto) {
    escreverNoCampo(ta, "");
    ta.style.height = "auto";
    atualizarBarra(ta);
  }
  if (!chave) return;
  if (naTela) rascunhos.guardar(chave, ta.value);
  else if (rascunhos.ler(chave).trim() === texto) rascunhos.guardar(chave, "");
}

/** O campo da tela da task (#195): o texto vai para a task (`POST trabalhos/:id/mensagens`), nunca para a conversa. */
async function enviarParaTrabalho(id: string): Promise<void> {
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const chave = composerDe;
  const texto = ta?.value.trim() ?? "";
  if (!ta || !api || !texto) return;
  const a = api;
  rolagem.colar();
  // Revisão W3 (2026-10-08): Enter + botão não mandam o mesmo recado duas vezes (a rota da task não leva `idEnvio`).
  await enviarUmaVez(envios, `trabalho:${id}`, texto, () => agir(async () => {
    try {
      await a.escreverNoTrabalho(id, texto);
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === "cota_provisorio") {
        await telaConta.abrir("cota", false);
        return;
      }
      throw e;
    }
    limparDepoisDeEnviar(ta, chave, texto);
    dispatch({ tipo: "invalidar", quais: [`trabalho:${id}`, "trabalhos"] });
  }));
}

async function enviarComposer(): Promise<void> {
  // ADR-095: com o ditado gravando, o ↑ (e o Enter) param a gravação e enviam o texto direto, sem prévia.
  if (ditado.ativo()) return ditado.concluir("enviar");
  const tela = estado.tela;
  if (tela.tipo === "trabalho") return enviarParaTrabalho(tela.id);
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  const chave = composerDe;
  const alvo = conversaAtual();
  if (!ta || !alvo || !api) return;
  const texto = ta.value.trim();
  const fila = alvo.salaId ? [] : anexosPendentes.get(alvo.conversaId) ?? [];
  // Não sai com arquivo pela metade: o clique espera o upload terminar (o chip mostra a barra).
  if (fila.some((i) => i.estado === "enviando")) return;
  const ids = fila.flatMap((i) => (i.estado === "pronto" && i.meta ? [i.meta.id] : []));
  if (!texto && ids.length === 0) return;
  // Quem manda mensagem quer ver a própria mensagem e a resposta: a conversa volta a acompanhar o fim.
  rolagem.colar();
  // definido em 2026-09-24 (emenda da ADR-045): com pergunta aberta, a mensagem RESPONDE por
  // POST decisoes/:id/responder (a retomada nasce lá), salvo "Outro assunto".
  if (ids.length === 0 && (await comandoDoNod(texto, alvo))) {
    limparDepoisDeEnviar(ta, chave, texto);
    return;
  }
  // Anexo com pergunta aberta vai como mensagem comum, e a pergunta segue aberta (decisão 9 do plano "pergunta com botões").
  const modo = modoDoComposer(estado, alvo.conversaId);
  // ADR-113 (Parte 3b): a fala citada pelo "Responder" vai junto, como mensagem comum (só na conversa própria).
  const citacao = alvo.salaId ? null : estado.citacoes[alvo.conversaId] ?? null;
  const destino = destinoDoEnvio(modo, ids.length > 0, citacao);
  // Letra sozinha ("A", "b.", "c)") vira o texto da opção da pergunta respondida; a resposta continua texto (EMENDA 16).
  const enviado = destino.tipo === "resposta" && modo.tipo === "resposta" ? textoDaLetra(texto, opcoesDaPergunta(estado, modo.alvo)) : texto;
  const a = api;
  // Só a mensagem comum leva chave; com um envio dela em voo nesta conversa, o segundo (Enter + botão) é ignorado.
  const comum = destino.tipo === "mensagem" && !alvo.salaId;
  const idEnvio = comum ? envios.iniciar(alvo.conversaId, texto, ids, destino.tipo === "mensagem" ? destino.respondeA : undefined) : undefined;
  if (idEnvio === null) return;
  // Plano "o pensamento no chat", Parte 1 (2026-10-26): a mensagem comum entra na tela no clique (fala pendente) e o campo
  // e os anexos limpam já; o POST confirma com `ids.mensagem` e a releitura só reconcilia. Falhou: a fala fica, com
  // "Tentar de novo" (mesma chave) — sem faixa de erro no topo, salvo a sessão perdida (401), que é de toda a tela.
  const pendente: FalaPendente | null = comum && idEnvio ? { idEnvio, texto: enviado, anexos: metasDosAnexos(fila), ...(destino.tipo === "mensagem" && destino.respondeA ? { respondeA: destino.respondeA } : {}), em: Date.now(), estado: "enviando", mensagemId: null, turnoId: null } : null;
  if (pendente) {
    dispatch({ tipo: "fala-pendente", conversaId: alvo.conversaId, pendente });
    limparDepoisDeEnviar(ta, chave, texto);
    limparAnexos(alvo.conversaId);
    rolagem.colar();
  }
  await agir(async () => {
    let enviou = false;
    let r: Awaited<ReturnType<typeof enviarPeloComposer>>;
    try {
      r = await enviarPeloComposer(a, alvo, destino, enviado, ids, idEnvio);
      enviou = true;
      // NOD-380: depois de falar, a conversa volta à janela comum; o alvo da busca não segura mais o `?ate=`.
      alvoDaBusca = alvoDepoisDeFalar(alvoDaBusca, alvo.conversaId);
    } catch (e) {
      if (!pendente || (e instanceof ErroApi && e.status === 401)) throw e;
      if (e instanceof ErroApi && e.codigo === "cota_provisorio") {
        const naTela = ta.isConnected && composerDe === chave;
        const atual = naTela ? ta.value : chave ? rascunhos.ler(chave) : "";
        await reagirACota({
          enviado,
          atual,
          retirarFala: () => dispatch({ tipo: "fala-pendente-sai", conversaId: alvo.conversaId, idEnvio: pendente.idEnvio }),
          repor: (reposto) => { if (naTela) { escreverNoCampo(ta, reposto); ajustarAltura(ta); atualizarBarra(ta); } if (chave) rascunhos.guardar(chave, reposto); },
          abrirConta: () => telaConta.abrir("cota", false),
        });
        return;
      }
      // Revisão de engenharia (27/10): o porquê (limite do plano, conversa encerrada, sem internet…) vai na própria fala,
      // com a frase que a faixa de antes mostrava — sem ele, "Não foi enviada" não dizia o que fazer.
      dispatch({ tipo: "fala-pendente-falhou", conversaId: alvo.conversaId, idEnvio: pendente.idEnvio, motivo: motivoDaFalha(e) });
      return;
    } finally {
      if (idEnvio) envios.concluir(alvo.conversaId, enviou);
    }
    if (pendente) dispatch({ tipo: "fala-pendente-confirmada", conversaId: alvo.conversaId, idEnvio: pendente.idEnvio, mensagemId: r.ids?.mensagem ?? null, turnoId: r.ids?.turno ?? null });
    else limparDepoisDeEnviar(ta, chave, texto);
    if (r.enviado === "resposta") anunciarPergunta(`Resposta enviada: ${enviado}`);
    if (r.enviado === "mensagem" && !pendente) limparAnexos(alvo.conversaId);
    // A escolha do campo vale até este envio: a próxima mensagem volta ao padrão.
    dispatch({ tipo: "composer", conversaId: alvo.conversaId, escolha: null });
    // Só a citação que foi junto: um "Responder" noutra fala durante o envio fica no campo para a próxima mensagem.
    if (citacao && estado.citacoes[alvo.conversaId]?.mensagemId === citacao.mensagemId) dispatch({ tipo: "citar", conversaId: alvo.conversaId, citacao: null });
    dispatch({ tipo: "invalidar", quais: r.enviado === "resposta" ? [`conversa:${alvo.conversaId}`, "sua-vez", "frota"] : [`conversa:${alvo.conversaId}`] });
  });
}

/** Os metadados dos anexos prontos, para a fala pendente desenhar os chips como a gravada vai desenhar. */
function metasDosAnexos(fila: readonly ItemAnexo[]): AnexoDaConversa[] {
  return fila.flatMap((i) => (i.estado === "pronto" && i.meta ? [{ ...i.meta }] : []));
}

/** A frase do erro que derrubou o envio da fala pendente (a mesma da faixa, `erroDaAcao`); AbortError não tem frase. */
function motivoDaFalha(e: unknown): string | undefined {
  const erro = erroDe(e);
  return erro ? erroDaAcao(erro).mensagem : undefined;
}

/**
 * "Tentar de novo" da fala pendente que falhou (Parte 1): a mesma fala, pela mesma chave de idempotência (`envios` guarda
 * a chave pendente enquanto a assinatura é igual), sem passar pelo campo. Com outro envio em voo na conversa, espera.
 */
async function reenviarPendente(conversaId: string, idEnvio: string): Promise<void> {
  const p = estado.conversas[conversaId]?.pendentes?.find((x) => x.idEnvio === idEnvio);
  if (!p || !api) return;
  const ids = p.anexos.map((x) => x.id);
  // Revisão do PR (27/10): a chave é a da própria pendente (`envios` só trava o voo); e o motivo da falha anterior sai.
  const chave = envios.iniciar(conversaId, p.texto, ids, p.respondeA, p.idEnvio);
  if (chave === null) return;
  const { motivo: _motivo, ...semMotivo } = p;
  dispatch({ tipo: "fala-pendente", conversaId, pendente: { ...semMotivo, idEnvio: chave, estado: "enviando" } });
  if (chave !== idEnvio) dispatch({ tipo: "fala-pendente-sai", conversaId, idEnvio });
  const a = api;
  let enviou = false;
  try {
    const r = await (p.respondeA ? a.enviar(conversaId, p.texto, ids, chave, p.respondeA) : a.enviar(conversaId, p.texto, ids, chave));
    enviou = true;
    // NOD-380: quem fala na conversa voltou para o fim; a janela deixa de crescer até a fala achada na busca.
    alvoDaBusca = alvoDepoisDeFalar(alvoDaBusca, conversaId);
    // `idsDaResposta` (revisão de engenharia, 27/10): a resposta sem `ids` (servidor de antes, no deploy) não pode virar
    // "falhou" depois de enviada — a pendente sai e a releitura traz a gravada, como no envio pelo campo.
    const gravados = idsDaResposta(r);
    dispatch({ tipo: "fala-pendente-confirmada", conversaId, idEnvio: chave, mensagemId: gravados?.mensagem ?? null, turnoId: gravados?.turno ?? null });
    dispatch({ tipo: "invalidar", quais: [`conversa:${conversaId}`] });
  } catch (e) {
    dispatch({ tipo: "fala-pendente-falhou", conversaId, idEnvio: chave, motivo: motivoDaFalha(e) });
    if (e instanceof ErroApi && e.status === 401) mostrarErro(e);
  } finally {
    envios.concluir(conversaId, enviou);
  }
}

// ---- anexos (ADR-046) ----------------------------------------------------------------------------
// A fila vive fora do reducer: são File e objectURL do navegador, não estado da API. Por conversa,
// para o rascunho de anexos sobreviver a ir e voltar entre conversas como o texto sobrevive.
const anexosPendentes = new Map<string, ItemAnexo[]>();

/** NOD-207: o que o composer oferece vem das capacidades do catálogo (web/lib/capacidades.ts), nunca do id do harness. */
function aceitaDo(harness: string | undefined): Aceita | undefined {
  return aceitaDoBot(estado.executor?.harnesses, harness);
}

function redesenharAnexos(): void {
  const alvo = conversaAtual();
  if (!alvo || alvo.salaId) return;
  const itens = anexosPendentes.get(alvo.conversaId) ?? [];
  // ADA-5: a fila é uma só (a da conversa); aparece no campo do chat e na pílula do Quadro.
  const pilula = document.querySelector<HTMLElement>('#quadro [data-composer="fila"]');
  if (pilula) { pilula.innerHTML = renderItensAnexo(itens); pilula.hidden = itens.length === 0; }
  quadroNaTela.atualizarPilula();
  const fila = document.getElementById("composer-anexos");
  if (!fila) return;
  fila.innerHTML = renderItensAnexo(itens);
  fila.hidden = itens.length === 0;
  const r = document.getElementById("composer-resumo");
  if (r) r.textContent = resumoAnexos(itens);
  atualizarParar();
}

function limparAnexos(conversaId: string): void {
  for (const i of anexosPendentes.get(conversaId) ?? []) if (i.previa) URL.revokeObjectURL(i.previa);
  anexosPendentes.delete(conversaId);
  redesenharAnexos();
}

function adicionarArquivos(arquivos: readonly File[], doQuadro?: Aceita): void {
  const alvo = conversaAtual();
  const input = document.getElementById("composer-arquivos") as HTMLInputElement | null;
  if (!alvo || alvo.salaId || !api || (!input && !doQuadro) || arquivos.length === 0) return;
  const aceita = doQuadro ?? (input?.dataset.aceita as Aceita | undefined) ?? "tudo";
  const conversaId = alvo.conversaId;
  const fila = anexosPendentes.get(conversaId) ?? [];
  anexosPendentes.set(conversaId, fila);
  const a = api;
  for (const arquivo of arquivos) {
    const validos = fila.filter((i) => i.estado !== "erro").length;
    const mime = mimeDe(arquivo);
    const recusa = validos >= POR_MENSAGEM ? `Até ${POR_MENSAGEM} arquivos por mensagem.` : motivoRecusa(arquivo, aceita);
    const item: ItemAnexo = { chave: crypto.randomUUID(), nome: arquivo.name, mime, tamanho: arquivo.size, estado: recusa ? "erro" : "enviando", progresso: 0,
      ...(recusa ? { erro: recusa } : {}), ...(!recusa && mime.startsWith("image/") ? { previa: URL.createObjectURL(arquivo) } : {}) };
    fila.push(item);
    if (recusa) continue;
    void a.subirAnexo(conversaId, arquivo, mime, (f) => { item.progresso = f; redesenharAnexos(); })
      .then((meta) => { item.estado = "pronto"; item.meta = meta; })
      .catch(() => { item.estado = "erro"; item.erro = "Não foi possível enviar. Tente de novo."; })
      .finally(redesenharAnexos);
  }
  redesenharAnexos();
}

function removerAnexo(chave: string): void {
  const alvo = conversaAtual();
  if (!alvo) return;
  const fila = anexosPendentes.get(alvo.conversaId) ?? [];
  const item = fila.find((i) => i.chave === chave);
  if (item?.previa) URL.revokeObjectURL(item.previa);
  anexosPendentes.set(alvo.conversaId, fila.filter((i) => i.chave !== chave));
  redesenharAnexos();
}

/**
 * Põe o foco no elemento quando a releitura o desenhar (até 3 s), se a pessoa não tiver levado o foco para outro lugar
 * nesse meio-tempo (definido em 2026-10-26, QA do PR 4: o "Devia ter perguntado" vira a marca "Você marcou…").
 */
function focarQuandoAparecer(seletor: string, origem: Element, ate = Date.now() + 3000): void {
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && ativo !== origem && document.contains(ativo)) return;
  const el = document.querySelector<HTMLElement>(seletor);
  if (el) { el.focus(); return; }
  if (Date.now() < ate) window.setTimeout(() => focarQuandoAparecer(seletor, origem, ate), 100);
}

/** NOD-70: a próxima página das Decisões (o cursor é a última linha); falhou, a linha "Carregar mais" mostra o erro. */
async function maisDecisoes(): Promise<void> {
  const v = estado.atividadeVista;
  const cliente = api;
  if (!v || !cliente) return;
  const chave = chaveDasDecisoes(v.agenteId, v.dia, v.desfecho);
  const atual = estado.decisoesDoBot[chave];
  if (!atual || atual === "erro" || !atual.proximo || atual.carregandoMais) return;
  const cursor = atual.proximo;
  dispatch({ tipo: "mais-decisoes", chave, cursor, resultado: "carregando" });
  try {
    const r = await cliente.decisoes(v.agenteId, { de: v.dia, fuso: fusoLocal(), desfecho: v.desfecho, cursor });
    if (api !== cliente) return;
    dispatch({ tipo: "mais-decisoes", chave, cursor, resultado: r });
    anunciar(`Mais ${r.linhas.length} ${r.linhas.length === 1 ? "decisão" : "decisões"}.`);
    if (r.linhas[0]) focarQuandoAparecer(`#detalhes [data-act="decisoes-abrir"][data-id="${CSS.escape(r.linhas[0].id)}"]`, document.activeElement ?? document.body);
  } catch {
    dispatch({ tipo: "mais-decisoes", chave, cursor, resultado: "erro" });
  }
}

/** NOD-70: escolhe o período do CSV e lê quantas decisões ele tem (o "N decisões" antes de baixar). */
function escolherPeriodoDoCsv(dias: ExportarCsv["periodo"]): void {
  const v = estado.atividadeVista;
  const cliente = api;
  if (!v || !cliente) return;
  dispatch({ tipo: "atividade-vista", mudanca: { exportar: { periodo: dias, fase: "opcoes", previa: null, linhas: null } } });
  const { de, ate } = periodoDoCsv(v.dia, dias);
  const mesmo = () => estado.atividadeVista?.agenteId === v.agenteId && estado.atividadeVista.dia === v.dia && estado.atividadeVista.desfecho === v.desfecho && estado.atividadeVista.exportar?.periodo === dias && estado.atividadeVista.exportar.fase === "opcoes";
  void cliente.decisoes(v.agenteId, { de, ate, fuso: fusoLocal(), desfecho: v.desfecho, limite: 1 }).then(
    (r) => {
      const ex = estado.atividadeVista?.exportar;
      if (api === cliente && mesmo() && ex) dispatch({ tipo: "atividade-vista", mudanca: { exportar: { ...ex, previa: totalDoFiltro(r.contagem, v.desfecho) } } });
    },
    () => undefined,
  );
}

/**
 * NOD-70: baixa o CSV do período com o filtro da lista. No celular, com compartilhamento de arquivo, abre a folha do
 * sistema (salvar em Arquivos, mandar por e-mail); senão, o download normal pelo link.
 */
async function baixarCsv(): Promise<void> {
  const v = estado.atividadeVista;
  const cliente = api;
  const ex = v?.exportar;
  if (!v || !cliente || !ex || ex.fase === "gerando") return;
  const fase = (f: ExportarCsv["fase"], linhas: number | null = null, cortado = false) => {
    const atual = estado.atividadeVista?.exportar;
    if (atual) dispatch({ tipo: "atividade-vista", mudanca: { exportar: { ...atual, fase: f, linhas, cortado } } });
  };
  fase("gerando");
  anunciar("Gerando o arquivo…");
  try {
    const { de, ate } = periodoDoCsv(v.dia, ex.periodo);
    const r = await cliente.decisoesCsv(v.agenteId, { de, ate, fuso: fusoLocal(), desfecho: v.desfecho });
    if (api !== cliente) return;
    const arquivo = new File([r.blob], r.nome, { type: "text/csv" });
    if (ehCelular() && typeof navigator.canShare === "function" && navigator.canShare({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: r.nome }).catch((e: unknown) => { if (!(e instanceof DOMException && e.name === "AbortError")) throw e; });
    } else {
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.nome;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    fase("baixado", r.linhas, r.cortado);
    anunciar(`Arquivo baixado: ${r.linhas} ${r.linhas === 1 ? "decisão" : "decisões"}${r.cortado ? ", o limite do arquivo" : ""}.`);
  } catch {
    fase("erro");
    anunciar("O arquivo não saiu.");
  }
}

/** NOD-70: no celular, deslizar a lista das Decisões troca o dia (para a esquerda, o anterior; para a direita, o seguinte). */
let deslizeDasDecisoes: { x: number; y: number } | null = null;
document.addEventListener("touchstart", (ev) => {
  const t = ev.touches[0];
  deslizeDasDecisoes = t && ev.touches.length === 1 && (ev.target as Element | null)?.closest?.("#detalhes [data-deslize-dia]") ? { x: t.clientX, y: t.clientY } : null;
}, { passive: true });
document.addEventListener("touchend", (ev) => {
  const ini = deslizeDasDecisoes;
  deslizeDasDecisoes = null;
  const t = ev.changedTouches[0];
  if (!ini || !t) return;
  const passo = diaDoDeslize(t.clientX - ini.x, t.clientY - ini.y);
  if (passo === 0) return;
  document.querySelector<HTMLElement>(`#detalhes [data-act="decisoes-dia"][data-direcao="${passo < 0 ? "anterior" : "seguinte"}"]`)?.click();
}, { passive: true });

/** Fala oculta para quem lê a tela: a região viva da pergunta também serve às ações na fala (ADR-113), sem mexer no foco. */
const FALHA_AO_COPIAR = "Não deu para copiar: libere a área de transferência no navegador e tente de novo";
/** NOD-84: copia o que `valor` busca (o endereço ou o segredo) e marca o botão: `.wh-ok` por 2 s, ou "Não copiou". */
async function copiarDoWebhook(el: HTMLElement, valor: (id: string) => Promise<string>, anuncio: string): Promise<void> {
  const id = el.dataset.id ?? "";
  let ok = false;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
      const blob = valor(id).then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
    } else {
      await navigator.clipboard.writeText(await valor(id));
    }
    ok = true;
  } catch {
    // Plano B (QA da NOD-84): a tela só mostra o mascarado, então "selecione o texto" não tinha saída.
    ok = await valor(id).then((t) => copiarPorSelecao(document as unknown as DocParaCopiar, t)).catch(() => false);
  }
  const vivo = el.querySelector(".wh-vivo");
  if (vivo) vivo.textContent = ok ? "Copiado" : FALHA_AO_COPIAR;
  if (el.classList.contains("wh-copiar")) {
    el.classList.toggle("wh-ok", ok);
    el.classList.toggle("wh-falhou", !ok);
  } else {
    mostrarCopia(el, ok, relogioDoCopiar);
  }
  if (!ok && !vivo) anunciar(FALHA_AO_COPIAR);
  else if (!vivo) anunciar(anuncio);
  clearTimeout(timersCopiarCodigo.get(el));
  timersCopiarCodigo.set(el, window.setTimeout(() => { el.classList.remove("wh-ok", "wh-falhou"); if (vivo) vivo.textContent = ""; }, COPIADO_MS));
}

/** "Gerar novo endereço" confirma no lugar (sem modal): abre a caixa, foca o botão de confirmar; Cancelar volta. */
function alternarConfirmaWebhook(el: HTMLElement, abrir: boolean): void {
  const id = el.dataset.id ?? "";
  const caixa = document.getElementById(`wh-confirma-${id}`);
  const gatilho = document.querySelector<HTMLElement>(`[data-act="webhook-gerar"][data-id="${CSS.escape(id)}"]`);
  if (!caixa) return;
  caixa.hidden = !abrir;
  gatilho?.setAttribute("aria-expanded", String(abrir));
  if (abrir) caixa.querySelector<HTMLElement>('[data-act="webhook-gerar-confirmar"]')?.focus();
  else gatilho?.focus();
}

function anunciar(texto: string): void {
  const anuncio = document.getElementById("anuncio-pergunta");
  if (!anuncio) return;
  anuncio.textContent = "";
  window.setTimeout(() => { anuncio.textContent = texto; }, 50);
}

/** A fala de id dado entre as conversas e as tasks carregadas (a barra de ações só leva o id no `data-id`). */
function falaPorId(id: string): Mensagem | undefined {
  for (const c of [...Object.values(estado.conversas), ...Object.values(estado.trabalhoDetalhe)]) {
    const m = c?.mensagens.find((x) => x.id === id);
    if (m) return m;
  }
  return undefined;
}

/**
 * "Responder" na fala (ADR-113, Parte 3b). A fala que é uma pergunta ainda aberta aponta o campo para ELA (a mensagem
 * responde à pergunta, como o "Trocar" da Parte 3a); qualquer outra fala vira citação: a caixa "Respondendo · trecho · ×"
 * e a mensagem comum com `respondeA`.
 */
function responderAFala(fala: Mensagem): void {
  const alvo = conversaAtual();
  if (!alvo || alvo.salaId || alvo.conversaId !== fala.conversaId) return;
  const pergunta = fala.payload?.kind === "pedido_a_pessoa" ? fala.payload.decisaoId : null;
  const modo = modoDoComposer(estado, alvo.conversaId);
  if (pergunta && modo.tipo !== "normal" && modo.perguntas.some((p) => p.decisao.id === pergunta)) {
    dispatch({ tipo: "citar", conversaId: alvo.conversaId, citacao: null });
    escolherNoComposer(false, pergunta);
    return;
  }
  dispatch({ tipo: "citar", conversaId: alvo.conversaId, citacao: citacaoDaFala(fala) });
  document.getElementById("composer-texto")?.focus();
}

/** Põe ou tira a reação da pessoa (o chip ou o emoji do menu). A conversa relê pelo frame `reacao.mudou` e aqui também. */
async function alternarReacao(fala: Mensagem, emoji: string): Promise<void> {
  if (!api) return;
  const a = api;
  const minha = reacoesDaFala(estado, fala).some((r) => r.emoji === emoji && r.minha);
  await agir(async () => {
    await a.reagir(fala.id, emoji, !minha);
    dispatch({ tipo: "invalidar", quais: [`conversa:${fala.conversaId}`] });
    anunciar(minha ? `Reação ${emoji} tirada` : `Você reagiu com ${emoji}`);
  });
}

/**
 * O seletor da carinha e o menu ⋯ (tela "Responder, reagir e mais ações"): o mesmo menu flutuante dos bots
 * (`dialogo(…, true)`), aberto ao lado do botão, com setas, Home e End entre os itens e Esc para fechar (o foco volta ao
 * botão). O "+" troca a linha das quatro rápidas pela lista inteira, sem fechar.
 */
function abrirMenuDaFala(ancora: HTMLElement, tipo: "reagir" | "mais"): void {
  const fala = falaPorId(ancora.dataset.id ?? "");
  if (!fala) return;
  const bot = botDaFala(fala, estado);
  const d = dialogo(tipo === "reagir" ? htmlSeletorDeReacao(fala, estado) : htmlMenuDaFala(fala, estado, !!bot && comQuadro(bot)), true);
  d.classList.add("menu-fala");
  d.setAttribute("aria-label", tipo === "reagir" ? "Reagir a esta mensagem" : "Mais ações da mensagem");
  ancora.setAttribute("aria-expanded", "true");
  d.addEventListener("close", () => ancora.setAttribute("aria-expanded", "false"));
  const posicionar = (): void => {
    const r = ancora.getBoundingClientRect();
    d.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - d.offsetWidth - 12))}px`;
    d.style.top = `${Math.max(12, Math.min(r.bottom + 6, window.innerHeight - d.offsetHeight - 12))}px`;
  };
  posicionar();
  d.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo.closest("[data-reacao-mais]")) {
      const linha = d.querySelector(".linha-emojis");
      if (linha) linha.outerHTML = linhaDeEmojis(fala, estado, true);
      d.querySelector<HTMLButtonElement>(".linha-emojis button")?.focus();
      posicionar();
      return;
    }
    const emoji = alvo.closest<HTMLElement>("[data-reacao]")?.dataset.reacao;
    if (emoji) { d.close(); void alternarReacao(fala, emoji); return; }
    const item = alvo.closest<HTMLElement>("[data-fala]");
    if (item?.getAttribute("aria-disabled") === "true") return;
    const acao = item?.dataset.fala;
    if (acao) { d.close(); acaoDoMenuDaFala(fala, acao, ancora); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const passo = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + passo + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
}

/** Os itens do ⋯: copiar, abrir task (pelo bot, citando a fala), lembrar e Raio-X. */
function acaoDoMenuDaFala(fala: Mensagem, acao: string, ancora: HTMLElement): void {
  const bot = botDaFala(fala, estado);
  if (acao === "copiar") {
    void copiarTexto(fala.texto).then((ok) => (ok ? anunciar("Texto copiado") : mostrarAvisoDesfazer({ texto: "Não deu para copiar" })));
    return;
  }
  // ADA-2 F5 (ADR-156 §2): os itens que no computador são botões da barra, no menu do toque longo.
  if (acao === "responder") { responderAFala(fala); return; }
  if (acao === "relatar") {
    if (api) abrirReportarBug(api, fala.id, __NOD_VERSAO__, null, () => dispatch({ tipo: "invalidar", quais: ["relatos"] }));
    return;
  }
  if (acao.startsWith("proxy:")) {
    const act = acao.slice("proxy:".length);
    document.querySelector<HTMLElement>(`[data-mensagem="${CSS.escape(fala.id)}"] .msg-actions [data-act="${CSS.escape(act)}"]`)?.click();
    return;
  }
  if (acao === "criar-tarefa") { if (bot) void criarTarefaDaFala(fala, bot); return; }
  if (acao === "baixar-tudo" && api) {
    // NOD-323 (J2): um download por vez, com folga (o navegador barra vários de uma vez).
    const urls = baixaveis(fala.anexos ?? []).map((x) => ({ url: `${api!.urlAnexo(fala.conversaId, x.id)}?baixar=1`, nome: x.nome }));
    urls.forEach((u, k) => window.setTimeout(() => {
      const a = document.createElement("a");
      a.href = u.url;
      a.download = u.nome;
      document.body.append(a);
      a.click();
      a.remove();
    }, k * 400));
    anunciar(`Baixando ${urls.length} arquivos`);
    return;
  }
  if (acao === "raio-x" && api && fala.turnoId) {
    const t = estado.tela;
    void abrirRaioX(api, fala.turnoId, t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "agente" : "sala", ancora, ondeDoTurno(fala, estado.conversas[fala.conversaId]?.mensagens ?? []));
    return;
  }
  if (acao === "desfazer") {
    if (podeAbrirCartao(fala, estado)) abrirCartaoDesfazer(fala);
    return;
  }
  if (!api || !bot) return;
  const a = api;
  // Decisão 3 do plano (Marlon, 18/10): "Abrir task com isto" passa pelo bot — a mensagem comum cita a fala e o bot usa
  // abrir_task. Com pergunta aberta, ela NÃO responde à pergunta (destinoDoEnvio com citação).
  if (acao === "abrir-task") void agir(async () => {
    rolagem.colar();
    await a.enviar(fala.conversaId, textoAbrirTask(fala), [], crypto.randomUUID(), fala.id);
    dispatch({ tipo: "invalidar", quais: [`conversa:${fala.conversaId}`] });
    anunciar("Pedido enviado: abrir uma task com esta mensagem");
  });
  if (acao === "lembrar") void agir(async () => {
    await a.criarMemoria(bot, "fato", textoParaLembrar(fala), fala.conversaId);
    dispatch({ tipo: "invalidar", quais: [`conversa:${fala.conversaId}`, `memoria:${bot}`] });
    anunciar(`Anotado na memória de ${botGerido(bot)?.nome ?? "o bot"}`);
  });
}

/** Copiar com a área de transferência; sem ela (http, permissão), a textarea oculta com `execCommand`. */
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.setAttribute("readonly", "");
    Object.assign(ta.style, { position: "fixed", opacity: "0", left: "-9999px" });
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/**
 * ADA-2 F5 (ADR-156 §3): "Criar tarefa disto" — a rota de sempre (`quadro.criar_tarefa`), sem agente nem status (Backlog,
 * ninguém começa). O aviso traz Abrir (a tarefa no Quadro) e Desfazer (`quadro.desfazer` com o lote da criação). Dois
 * toques seguidos não criam duas: a segunda chamada espera a primeira acabar e não sai.
 */
let criandoTarefaDaFala = false;
async function criarTarefaDaFala(fala: Mensagem, botId: string): Promise<void> {
  if (!api || criandoTarefaDaFala) return;
  const a = api;
  // A origem é a conversa com o bot, também quando a fala é da pessoa (QA ADA-20: "Da conversa com você" não diz de onde veio).
  const autor = botGerido(botId)?.nome ?? "o bot";
  const campos = tarefaDaFala(fala.texto, autor, dataHora(fala.criadoEm));
  criandoTarefaDaFala = true;
  try {
    await agir(async () => {
      const r = await a.criarTarefa(botId, campos);
      const tarefaId = r.lote?.tarefaIds[0] ?? null;
      const loteId = r.lote?.id ?? null;
      const aviso = mostrarAvisoDesfazer({
        texto: "Tarefa criada",
        ...(tarefaId ? { abrir: { rotulo: "Abrir", aoAbrir: () => quadroNaTela.abrirTarefa(botId, tarefaId) } } : {}),
        ...(loteId ? { aoDesfazer: () => agir(async () => { await a.desfazerLoteQuadro(botId, loteId); anunciar("Tarefa desfeita"); }) } : {}),
      });
      aviso.dataset.tarefa = tarefaId ?? "";
      anunciar("Tarefa criada no quadro");
    });
  } finally {
    criandoTarefaDaFala = false;
  }
}

/**
 * ADA-2 F5 (ADR-156 §2): no celular, segurar a mensagem 450 ms levanta a fala, desfoca o resto e abre o menu com tudo o
 * que a fala tem (htmlMenuSegurado). Os itens usam o mesmo clique do ⋯ (`acaoDoMenuDaFala`).
 */
function abrirMenuSeguradoDaFala(segurada: HTMLElement): boolean {
  const id = segurada.dataset.mensagem ?? "";
  const el = segurada.isConnected ? segurada : document.querySelector<HTMLElement>(`[data-mensagem="${CSS.escape(id)}"]`);
  const fala = falaPorId(id);
  if (!el || !fala || fala.parcial) return false;
  const bot = botDaFala(fala, estado);
  const extras: ExtraDaBarra[] = [...el.querySelectorAll<HTMLElement>(".msg-actions [data-act]")]
    .filter((b) => !(ACTS_COBERTOS as readonly string[]).includes(b.dataset.act ?? "") && b.getAttribute("aria-disabled") !== "true")
    .map((b) => ({ act: b.dataset.act ?? "", rotulo: b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "" }));
  navigator.vibrate?.(10);
  const d = dialogo(htmlMenuSegurado(fala, estado, !!bot && comQuadro(bot), extras), true);
  d.classList.add("menu-fala", "menu-fala-seg", "menu-segurado");
  d.setAttribute("aria-label", "Ações da mensagem");
  el.classList.add("fala-segurada");
  d.addEventListener("close", () => el.classList.remove("fala-segurada"));
  // A fala do bot sai em um balão por parágrafo (NOD-358): o menu se mede pelo conjunto dos balões, não só pelo primeiro.
  const baloes = [...el.querySelectorAll<HTMLElement>(".bubble")];
  const origens = baloes.length ? baloes : [el];
  const caixas = origens.map((o) => o.getBoundingClientRect());
  const fora = baloes.length ? null : (el.querySelector<HTMLElement>(".bubble-wrap") ?? el).getBoundingClientRect();
  const r = fora ?? { top: Math.min(...caixas.map((c) => c.top)), bottom: Math.max(...caixas.map((c) => c.bottom)), left: Math.min(...caixas.map((c) => c.left)) };
  const lista = d.querySelector<HTMLElement>('[role="menu"]');
  const lugar = lugarDoMenuSegurado({ topo: r.top, base: r.bottom }, d.offsetHeight, window.innerHeight);
  d.style.top = `${lugar.topo}px`;
  d.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - d.offsetWidth - 12))}px`;
  if (lista && lugar.alturaMaxima !== null) Object.assign(lista.style, { maxHeight: `${Math.max(0, lugar.alturaMaxima - (d.offsetHeight - lista.offsetHeight))}px`, overflowY: "auto" });
  // A fala segurada sobe por cima do fundo desfocado: uma cópia sem foco de cada balão, no mesmo lugar (o padrão do
  // NOD-379). Todos os balões ficam escondidos (.fala-segurada), então todos ganham cópia.
  d.prepend(...origens.map((origem, i) => {
    const ro = caixas[i]!;
    const copia = origem.cloneNode(true) as HTMLElement;
    copia.classList.add("fala-copia");
    copia.inert = true;
    copia.setAttribute("aria-hidden", "true");
    for (const x of copia.querySelectorAll("[id]")) x.removeAttribute("id");
    Object.assign(copia.style, { left: `${ro.left}px`, top: `${ro.top}px`, width: `${ro.width}px`, maxHeight: `${Math.max(48, ro.height)}px` });
    return copia;
  }));
  d.addEventListener("click", (e) => {
    const alvo = e.target as HTMLElement;
    if (alvo === d) { d.close(); return; }
    if (alvo.closest("[data-reacao-mais]")) {
      const linha = d.querySelector(".linha-emojis");
      if (linha) linha.outerHTML = linhaDeEmojis(fala, estado, true);
      d.querySelector<HTMLButtonElement>(".linha-emojis button")?.focus();
      return;
    }
    const emoji = alvo.closest<HTMLElement>("[data-reacao]")?.dataset.reacao;
    if (emoji) { d.close(); void alternarReacao(fala, emoji); return; }
    const item = alvo.closest<HTMLElement>("[data-fala]");
    if (item?.getAttribute("aria-disabled") === "true") return;
    const acao = item?.dataset.fala;
    if (acao) { d.close(); acaoDoMenuDaFala(fala, acao, el); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    // Só os botões do menu: a cópia da fala (inert) pode ter botões (o Copiar do bloco de código, a barra da linha de
    // sistema) que não recebem foco e travariam as setas e o Home.
    const itens = [...d.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  requestAnimationFrame(() => d.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  return true;
}
const toqueNaFala = criarToqueLongo<HTMLElement>({ agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), agora: () => performance.now() }, abrirMenuSeguradoDaFala);
document.addEventListener("pointerdown", (ev) => {
  const alvo = ev.target as HTMLElement;
  const fala = celular.ativo() && ev.pointerType !== "mouse" && ev.isPrimary && !alvo.closest(SELETOR_INTERATIVO)
    ? alvo.closest<HTMLElement>("#timeline .message[data-mensagem], #timeline .msg-linha[data-mensagem]")
    : null;
  if (fala) { toqueNaFala.comecar(fala, ev.clientX, ev.clientY); fala.classList.add("fala-segurando"); }
  else toqueNaFala.esquecer();
}, true);
const soltarFala = (): void => {
  toqueNaFala.soltar();
  for (const x of document.querySelectorAll(".fala-segurando")) x.classList.remove("fala-segurando");
};
document.addEventListener("pointermove", (ev) => toqueNaFala.mover(ev.clientX, ev.clientY));
document.addEventListener("pointerup", soltarFala);
document.addEventListener("pointercancel", soltarFala);
document.addEventListener("click", (ev) => {
  if (toqueNaFala.engolirClique()) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
// O Android dispara contextmenu no toque longo da fala: o menu nosso já abriu (ou vai abrir), o do sistema não.
document.addEventListener("contextmenu", (ev) => {
  if (celular.ativo() && (ev.target as HTMLElement).closest?.("#timeline .message[data-mensagem], #timeline .msg-linha[data-mensagem]") && !(ev.target as HTMLElement).closest("a, img, video")) ev.preventDefault();
});

/**
 * NOD-54 (ADR-134): o cartão "Desfazer o que o bot mudou?" abre embaixo da fala e o foco vai ao título (não é modal: a
 * conversa segue). Esc ou Cancelar fecham e o foco volta ao ⋯ da fala.
 */
function abrirCartaoDesfazer(fala: Mensagem): void {
  dispatch({ tipo: "desfazer-cartao", mensagemId: fala.id });
  const titulo = document.querySelector<HTMLElement>(`[data-desfazer-cartao="${CSS.escape(fala.id)}"] h3`);
  titulo?.focus();
  titulo?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function fecharCartaoDesfazer(focarMenu: boolean): void {
  const id = estado.desfazerAberto;
  if (!id) return;
  dispatch({ tipo: "desfazer-cartao", mensagemId: null });
  if (focarMenu) document.querySelector<HTMLElement>(`[data-mensagem="${CSS.escape(id)}"] [data-act="mais-da-fala"]`)?.focus();
}

/** Pede o desfazer (ou o "Voltar mesmo assim"): a máquina do turno puxa e a linha da fala mostra o progresso. */
function pedirDesfazer(fala: Mensagem, forcar: boolean): void {
  if (!api || !fala.turnoId) return;
  const a = api;
  const turnoId = fala.turnoId;
  if (estado.desfazerAberto === fala.id) dispatch({ tipo: "desfazer-cartao", mensagemId: null });
  void agir(async () => {
    const r = await a.desfazerTurno(fala.conversaId, turnoId, forcar);
    dispatch({ tipo: "invalidar", quais: [`conversa:${fala.conversaId}`] });
    anunciar(r.ok ? (forcar ? "Voltando os arquivos em conflito" : "Desfazendo os arquivos deste turno") : TEXTO_DA_RECUSA[r.recusa]);
  });
}

document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || !estado.desfazerAberto) return;
  if (!(ev.target as HTMLElement).closest?.("[data-desfazer-cartao]")) return;
  ev.preventDefault();
  fecharCartaoDesfazer(true);
});

/** "Trocar" e o × da caixa "Respondendo" (Parte 3a): muda o que a próxima mensagem faz e volta ao campo. */
function escolherNoComposer(outroAssunto: boolean, alvoId?: string): void {
  const alvo = conversaAtual();
  if (!alvo) return;
  dispatch({ tipo: "composer", conversaId: alvo.conversaId, escolha: { outroAssunto, alvoId: alvoId ?? estado.composer[alvo.conversaId]?.alvoId ?? null } });
  document.getElementById("composer-texto")?.focus();
}

/** "Ver pergunta": leva ao balão e o realça um instante (sem animação para quem pediu menos movimento). */
function verPergunta(decisaoId: string): void {
  const balao = document.querySelector<HTMLElement>(`[data-pergunta="${CSS.escape(decisaoId)}"]`);
  if (!balao) return;
  levarAo(balao);
}

/** Rola até o balão/card, põe o foco nele e (se `realcar`) realça (web/lib/levar-ao-alvo.ts) — a lista redesenhada não o perde. */
function levarAo(alvo: AlvoDoAtalho, realcar = true): void {
  rolagem.soltar();
  levarAoAlvo(alvo, { reduzido: movimentoReduzido(), agendar: (fn, ms) => window.setTimeout(fn, ms), realcar });
}

/**
 * definido em 2026-10-15 (NOD-270): abre a conversa da rotina e leva ao balão da pergunta (ou ao card, se for aprovação)
 * quando a timeline o desenhar — espera até ~3 s. Fora da janela carregada (re-revisão de design do #342, ajuste C), abre
 * a faixa de trabalhos com o que espera a pessoa — nunca só a conversa aberta, em silêncio, nem um card sem relação.
 */
function verPerguntaNaConversa(conversaId: string, agenteId: string, decisaoId: string): void {
  if (!conversaId || !decisaoId) return;
  navegar({ tipo: "conversa", conversaId, agenteId });
  const id = CSS.escape(decisaoId);
  const ate = Date.now() + 3000;
  const tentar = (): void => {
    // A pessoa saiu da conversa nesses 3 s: o atalho não a puxa de volta.
    if (estado.tela.tipo !== "conversa" || estado.tela.conversaId !== conversaId) return;
    const alvo = document.querySelector<HTMLElement>(`[data-pergunta="${id}"], [data-decisao="${id}"], [data-proposta="${id}"]`);
    const passo = passoDoAtalho(alvo !== null, Date.now(), ate);
    if (passo === "tentar") window.setTimeout(tentar, 100);
    else if (passo === "faixa") dispatch({ tipo: "faixa-trabalhos", agenteId });
    else if (alvo) levarAo(alvo);
  };
  window.setTimeout(tentar, 0);
}

/**
 * O que deixa a .app inerte fora a busca do celular: Seu espaço, a ligação em tela cheia, o onboarding por cima e a
 * folha de recentes (ADA-19: modal presa no <body>; sem isso o leitor de tela e o Tab do navegador saíam dela).
 */
function appInerteSemBusca(): boolean {
  return !!estado.espaco || telaLigacao.cheia() || telaOnboarding.cobre() || folhaRecentes !== null;
}
/** A .app fica inerte quando há outra camada por cima; o render() e a folha de recentes (que vive fora dele) repintam. */
function pintarInerciaDoApp(): void {
  document.querySelector(".app")?.toggleAttribute("inert", appInerte({ outraCamada: appInerteSemBusca(), buscaAberta: !!document.querySelector(".busca-celular:not(.saindo)") }));
}

/**
 * NOD-380: a fala achada na busca do celular. Enquanto a pessoa lê a conversa dela, cada leitura da conversa pede `?ate=`
 * (a janela cresce até a fala, mesmo fora das 200 recentes, e não encolhe debaixo de quem está lendo quando chega fala
 * nova) e, quando a timeline a desenha, leva até ela com o destaque de 2 s. Sair da conversa ou mandar uma fala nela (a
 * pessoa voltou para o fim) esquece o alvo, e a janela volta à normal.
 */
let alvoDaBusca: AlvoDaFala | null = null;
const ateDaBusca = (conversaId: string): string | undefined => (alvoDaBusca?.conversaId === conversaId ? alvoDaBusca.mensagemId : undefined);
/** A resposta diz se a fala veio na janela (e não o relógio): rede lenta não vira o aviso de "antiga demais". */
function notarAlvoDaBusca<C extends { mensagens: readonly { id: string }[] }>(conversaId: string, ate: string | undefined, conversa: C): C {
  notarVeio(alvoDaBusca, conversaId, ate, conversa.mensagens.map((x) => x.id), Date.now());
  return conversa;
}
const DESTAQUE_BUSCA_MS = 2000;

function abrirMensagemAchada(m: MensagemAchada): void {
  if (!(m.conversaTipo === "sala" && m.salaId) && !m.agenteId) return;
  // O alvo antes de navegar: a 1ª leitura da conversa, disparada pela navegação, já sai com o `?ate=`.
  alvoDaBusca = { conversaId: m.conversaId, mensagemId: m.id };
  if (m.conversaTipo === "sala" && m.salaId) navegar({ tipo: "sala", salaId: m.salaId, conversaId: m.conversaId });
  else if (m.agenteId) navegar({ tipo: "conversa", conversaId: m.conversaId, agenteId: m.agenteId });
  levarAFalaComAte(mundoDaFala, m.conversaId, m.id, {
    aoChegar: (alvo) => {
      abrirDetalhesAcima(alvo);
      rolagem.soltar();
      levarAoAlvo(alvo, { reduzido: movimentoReduzido(), agendar: (fn, ms) => window.setTimeout(fn, ms), realcar: false });
      alvo.classList.add("achada-na-busca");
      window.setTimeout(() => alvo.classList.remove("achada-na-busca"), DESTAQUE_BUSCA_MS);
    },
    aoFalhar: (antiga) => {
      // Revisão 2 (achado 6): a fala que não veio não deixa a janela crescida até um alvo que nunca se desenha.
      soltarAlvoNaoDesenhado(mundoDaFala, m.conversaId, m.id);
      dispatch({ tipo: "erro", erro: { codigo: "busca_alvo_fora", mensagem: antiga ? "Essa mensagem é antiga demais para abrir aqui. A conversa abriu nas mais recentes." : "Não deu para levar até essa mensagem. A conversa abriu nas mais recentes." } });
    },
  });
}

/** NOD-363: o mundo de levarAFalaComAte (web/lib/ir-para-a-fala.ts) — a tela, o alvo da janela, a timeline e o relógio. */
const mundoDaFala = criarMundoDaFala<HTMLElement>({
  tela: () => estado.tela,
  alvo: { ler: () => alvoDaBusca, gravar: (a) => { alvoDaBusca = a; } },
  mensagens: (id) => estado.conversas[id]?.mensagens,
  noTimeline: (sel) => document.querySelector<HTMLElement>(sel),
  escapar: (x) => CSS.escape(x),
  invalidar: (q) => dispatch({ tipo: "invalidar", quais: [q as Invalidacao] }),
  agendar: (fn, ms) => window.setTimeout(fn, ms),
  agora: () => Date.now(),
});

document.getElementById("timeline")?.addEventListener(
  "scroll",
  (ev) => {
    const c = ev.currentTarget as HTMLElement;
    if (alvoDaBusca) alvoDaBusca = alvoNoFimDaConversa(alvoDaBusca, { topo: c.scrollTop, altura: c.scrollHeight, janela: c.clientHeight });
  },
  { passive: true },
);

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const FORMATO_DIA_MES = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

limparEntradaDaBusca();
const buscaCelular = criarBuscaCelular({
  appInerte: appInerteSemBusca,
  bots: () =>
    [...(estado.frota?.agentes ?? [])]
      .filter((a) => !a.excluidoEm)
      .sort((a, b) => (b.ultimaMensagem?.em ?? 0) - (a.ultimaMensagem?.em ?? 0))
      .map((a) => ({ agenteId: a.id, conversaId: a.conversaId, nome: a.nome, titulo: a.titulo, sub: a.ultimaMensagem?.previa ?? a.titulo, mascote: (tamanho) => iconeAgente(a, tamanho) })),
  salas: () =>
    estado.salas.map(({ sala, membros }) => {
      const nomes = membros.filter((x) => !x.removidoEm).map((x) => estado.frota?.agentes.find((a) => a.id === x.agenteId)?.nome).filter((n): n is string => Boolean(n));
      return { salaId: sala.id, conversaId: sala.conversaId, nome: sala.nome, sub: nomes.join(", "), membros: `${membros.filter((x) => !x.removidoEm).length} bots` };
    }),
  rosto: (m) => {
    const agentes = estado.frota?.agentes ?? [];
    const sala = m.salaId ? estado.salas.find((s) => s.sala.id === m.salaId)?.sala : undefined;
    const doBot = m.agenteId ? agentes.find((a) => a.id === m.agenteId) : undefined;
    const sufixo = sala ? `em ${sala.nome}` : "";
    if (m.autor.tipo === "agente") {
      const bot = agentes.find((a) => a.id === m.autor.id);
      return { titulo: bot?.nome ?? "Bot", sufixo, avatar: bot ? iconeAgente(bot, "md") : avatar({ tipo: "agente", nome: "Bot" }) };
    }
    const eu = m.autor.id === estado.sessao?.pessoaId;
    const nome = eu ? "Você" : "Pessoa";
    return { titulo: nome, sufixo: sufixo || (doBot ? `com ${doBot.nome}` : ""), avatar: avatar({ tipo: "pessoa", nome }) };
  },
  data: (iso) => dataCurta(iso, Date.now(), { hora: (t) => FORMATO_HORA.format(t), diaMes: (t) => FORMATO_DIA_MES.format(t), completa: (t) => FORMATO_DATA.format(t) }),
  buscar: (termo, cursor, signal) => {
    const a = api;
    if (!a) return Promise.reject(new Error("sem sessão"));
    return buscarSemOcupado((s) => a.buscarMensagens(termo, cursor, s), signal, (ms) => new Promise((ok) => window.setTimeout(ok, ms)));
  },
  abrirBot: (agenteId, conversaId) => {
    // A busca aberta a partir da inicial: a conversa escolhida nela conta de novo, como na lista (NOD-422).
    if (buscaDaInicial) trilhaDaConversa.nova();
    buscaDaInicial = false;
    navegar({ tipo: "conversa", conversaId, agenteId });
  },
  abrirSala: (salaId, conversaId) => navegar({ tipo: "sala", salaId, conversaId }),
  abrirMensagem: abrirMensagemAchada,
  reduzido: () => movimentoReduzido(),
  chaveRecentes: () => (estado.sessao ? chaveDosRecentes(estado.sessao.tenantId, estado.sessao.pessoaId) : null),
});

/**
 * "Esperando você" na linha do dono (definido em 2026-10-12, ADR-099, parte 5): leva à mensagem do bot com a pergunta — a
 * da decisão, quando a linha a conhece; senão a última pergunta ou o último cartão da conversa. Sem nenhum na janela
 * carregada, abre o detalhe da linha (ele lista o que espera a pessoa). No celular a folha fecha antes de rolar.
 */
function irAoQueEsperaVoce(decisaoId: string | null): void {
  const timeline = document.getElementById("timeline") ?? document;
  const id = decisaoId ? CSS.escape(decisaoId) : null;
  // Re-revisão de design do #342 (ajuste C): só o card da própria decisão ganha realce; o último qualquer só rola e foca.
  const escolha = alvoDoQueEspera(
    id ? timeline.querySelector<HTMLElement>(`[data-pergunta="${id}"], [data-decisao="${id}"], [data-proposta="${id}"]`) : null,
    [...timeline.querySelectorAll<HTMLElement>("[data-pergunta], [data-decisao], [data-proposta]")].at(-1) ?? null,
  );
  const t = estado.tela;
  if (!escolha) {
    if (t.tipo === "conversa") dispatch({ tipo: "faixa-trabalhos", agenteId: t.agenteId });
    return;
  }
  if (estado.faixaTrabalhosAberta) dispatch({ tipo: "faixa-trabalhos", agenteId: null });
  levarAo(escolha.alvo, escolha.realcar);
}

/**
 * A pílula do bot (chat limpo, PR 8; web/telas/pilula-do-bot.ts). Desenhada a cada render e quando o progresso na fala entra
 * ou sai da vista (a rolagem avisa só quando muda). Aberta e com a fala entrando na vista, ela fecha sozinha; se o foco
 * estava dentro, vai para o "ver as N" do bloco na fala (revisão de engenharia, item 17). A região viva diz quando uma
 * frente do bot termina.
 */
function desenharPilula(): void {
  const t = estado.tela;
  if (t.tipo !== "conversa" || !estado.sessao) {
    pilula.desenhar(null);
    pilulaAtual = null;
    frentesVistas = null;
    return;
  }
  anunciarFrentesTerminadas(t.conversaId, t.agenteId);
  const p = pilulaNaConversa(estado, t.agenteId, progressoDaFala);
  if (p.tipo !== "pilula") {
    if (p.tipo === "nada") {
      const ao = aoSumir({ aberta: estado.faixaTrabalhosAberta === t.agenteId, focoDentro: pilula.focoDentro() });
      if (ao.foco === "campo") document.getElementById("composer-texto")?.focus({ preventScroll: true });
      if (ao.fechar) window.setTimeout(() => { if (estado.faixaTrabalhosAberta === t.agenteId && pilulaAtual === null) dispatch({ tipo: "faixa-trabalhos", agenteId: null }); }, 0);
    }
    pilula.desenhar(p.tipo === "legado" ? p : null);
    pilulaAtual = null;
    return;
  }
  let aberta = estado.faixaTrabalhosAberta === t.agenteId;
  const ao = p.escondida ? aoEsconder({ aberta, focoDentro: pilula.focoDentro() }) : { fechar: false, foco: null };
  if (ao.foco === "fala") focarProgressoNaFala(p.pilula);
  if (ao.fechar) {
    aberta = false;
    // Fora do render: o estado guarda "fechada" para a próxima vez que a fala sair da vista.
    window.setTimeout(() => { if (estado.faixaTrabalhosAberta === t.agenteId) dispatch({ tipo: "faixa-trabalhos", agenteId: null }); }, 0);
  }
  pilula.desenhar({ tipo: "pilula", partes: p.partes, aberta, escondida: p.escondida });
  pilulaAtual = { pilula: p.pilula, telemetria: p.partes.telemetria };
  // ADR-099 (gatilho de 30%): a pílula que fala de frentes conta como "mostrada" quando aparece, no tipo `frentes`.
  if (!p.escondida && p.partes.telemetria) telemetria.mostrada({ tipo: "frentes", agenteId: t.agenteId, chaveLinha: p.partes.telemetria });
}

/** "Hero w3 pronta": só quando uma frente do bot da conversa à vista termina, nunca a cada passo (web/lib/pilula.ts). */
function anunciarFrentesTerminadas(conversaId: string, agenteId: string): void {
  const frentes = trabalhosConhecidos(estado, conversaId).filter((x) => x.agenteId === agenteId);
  const { anuncios, estados } = anunciosDeFim(frentesVistas?.conversaId === conversaId ? frentesVistas.estados : null, frentes);
  frentesVistas = { conversaId, estados };
  if (anuncios.length) anunciar(anuncios.join(". "));
}

/** O bloco de progresso na fala de um dos grupos da pílula (o primeiro que a timeline tem), procurado só quando se pede. */
function progressoDaPilula(p: Pilula, soAVista = false): HTMLElement | null {
  const timeline = document.getElementById("timeline");
  for (const g of p.grupos) {
    for (const id of g.ids) {
      if (soAVista && !progressoDaFala.aVista.has(id)) continue;
      const el = timeline?.querySelector<HTMLElement>(`.progresso[data-frentes~="${CSS.escape(id)}"]`);
      if (el) return el;
    }
  }
  return null;
}

/** A pílula fechou sozinha com o foco dentro: o foco vai ao "ver as N" do bloco que entrou na vista (ou ao título da frente). */
function focarProgressoNaFala(p: Pilula): void {
  const bloco = progressoDaPilula(p, true);
  bloco?.querySelector<HTMLElement>(".progresso-resumo, .progresso-titulo")?.focus({ preventScroll: true });
}

/** "Ver na conversa ↑": fecha a pílula, rola até a fala com o progresso e a realça (como o protótipo D4BE2). */
function verPilulaNaConversa(): void {
  const p = pilulaAtual?.pilula;
  const bloco = p ? progressoDaPilula(p) : null;
  if (!bloco) return;
  if (estado.faixaTrabalhosAberta) dispatch({ tipo: "faixa-trabalhos", agenteId: null });
  levarAo(bloco.closest<HTMLElement>(".bubble") ?? bloco);
}

/** "Parar" da pílula: pergunta com a lista das frentes abertas que a pílula mostra (o Parar do campo não para frentes, NOD-311). */
function pararPelaPilula(): void {
  const p = pilulaAtual?.pilula;
  if (!p || p.abertas.length === 0) return;
  const frentes = p.abertas;
  const parar = (): Promise<void> => agir(async () => {
    await Promise.allSettled(frentes.map((x) => api!.pararTrabalho(x.id)));
    dispatch({ tipo: "invalidar", quais: ["trabalhos", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  });
  pedirGestao(textoPararTasks(frentes, p.nome), `${listaPararTasks(frentes)}<p>O que já foi feito fica.</p>`, frentes.length === 1 ? "Parar a task" : "Parar tudo", parar, true);
}

/** "Ver aprovação" (definido em 2026-10-03): da lista "N coisas esperam você" ao card do pedido na timeline. */
function verDecisao(decisaoId: string): void {
  const id = CSS.escape(decisaoId);
  const card = document.querySelector<HTMLElement>(`[data-decisao="${id}"], [data-proposta="${id}"]`);
  if (!card) return;
  levarAo(card);
}

function marcacoesDe(decisaoId: string): { id: string; selecionado: boolean; textoFinal?: string }[] {
  const raiz = document.querySelector(`[data-decisao="${CSS.escape(decisaoId)}"]`);
  if (!raiz) return [];
  return [...raiz.querySelectorAll<HTMLInputElement>("input[data-item]")].map((cb) => {
    const id = cb.getAttribute("data-item") ?? "";
    const texto = raiz.querySelector<HTMLInputElement>(`input[data-item-texto="${CSS.escape(id)}"]`)?.value;
    return { id, selecionado: cb.checked, ...(texto !== undefined ? { textoFinal: texto } : {}) };
  });
}

/** O que está marcado no cartão de liberar apps (card-liberar.ts): cada app marcado com o nível do seletor dele. */
function escolhasDoCardLiberar(card: HTMLElement | null): (EscolhaLiberar & { conectorId: string })[] {
  if (!card) return [];
  return [...card.querySelectorAll<HTMLInputElement>("input[data-liberar-app]:checked")].map((cb) => {
    const conectorId = cb.dataset.liberarApp ?? "";
    const nivel = card.querySelector<HTMLSelectElement>(`select[data-liberar-nivel="${CSS.escape(conectorId)}"]`)?.value;
    return { conectorId, slug: cb.dataset.slug ?? "", nivel: nivel === "escrita" ? "escrita" : "leitura" };
  });
}

/**
 * O botão e a lista pode/não pode do cartão seguem o que a pessoa marca, no lugar: o cartão não é redesenhado (o foco
 * fica no controle que ela acabou de mexer) e o HTML do bloco continua o mesmo para o render por blocos.
 */
function atualizarCardLiberar(card: HTMLElement): void {
  const escolhas = escolhasDoCardLiberar(card);
  const permitir = card.querySelector<HTMLElement>('[data-act="liberar-apps"]');
  if (permitir) permitir.textContent = rotuloPermitir(escolhas);
  const lista = card.querySelector(".pode-nao");
  if (lista) lista.outerHTML = listaDoQuePodem(estado, escolhas);
}

function filtrarApps(texto: string): void {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-app-busca]")];
  for (const el of cards) el.hidden = !el.dataset.appBusca?.includes(texto.trim().toLowerCase());
  // ADR-057: a seção "Mais apps" some inteira quando a busca não deixa nenhum cartão dela.
  for (const secao of document.querySelectorAll<HTMLElement>("[data-secao-apps]")) secao.hidden = !secao.querySelector("[data-app-busca]:not([hidden])");
  const vazio = document.getElementById("marketplace-vazio");
  if (vazio) vazio.hidden = cards.some((el) => !el.hidden);
}

/**
 * A Inteligência de um bot da pessoa (o menu da gestão, o /modelo do campo, "Trocar a IA" nos avisos). revisto em
 * 2026-10-10 (plano das IAs): abre sempre no nível da gaveta (2B), indo à conversa do bot se for outra; o diálogo com o
 * select de antes saiu.
 */
function abrirInteligencia(agenteId: string | undefined): void {
  const a = botGerido(agenteId);
  if (!a || a.ownerId !== estado.sessao?.pessoaId) return;
  abrirNivel(a.id, { tipo: "inteligencia" });
}

// ---- as IAs do Mac nos cartões (Provedores de IA, onboarding, chat) — plano das IAs, 2026-10-10 ---------------------------
const iasDoMac = criarIasDoMac({
  mac: () => window.nodDesktop,
  ui: () => estado.iasMac,
  mudar: (mudanca: Partial<UiIas>) => dispatch({ tipo: "ias-mac", mudanca }),
  // O onboarding testa a IA pelo teste dele (onboarding-teste.ts); fora dele, o fim do fluxo testa aqui.
  testeAqui: () => !telaOnboarding.cobre(),
  aoMudarNoMac: () => { if (estado.sessao) dispatch({ tipo: "invalidar", quais: ["ias", "inventario", "executor"] }); },
  verificarNoServidor: async () => {
    dispatch({ tipo: "hidratar-inventario", inventario: await api!.inventario(true) });
    dispatch({ tipo: "invalidar", quais: ["ias", "executor"] });
  },
  copiar: (texto) => navigator.clipboard.writeText(texto),
  agendar: (fn, ms) => { window.setTimeout(fn, ms); },
  // NOD-209: no onboarding, trocar de conta tira o veredito da conta antiga; a nova é testada antes do Continuar.
  aoComecarTroca: (ia) => { if (telaOnboarding.cobre()) telaOnboarding.comecarTroca(ia); },
  aoFimDaTroca: (ia, trocou) => { if (telaOnboarding.cobre()) telaOnboarding.fimDaTroca(ia, trocou); },
});
void iasDoMac.iniciar();
// ADR-101 (NOD-211): as várias contas de cada IA, só no app do Mac (web/lib/contas-do-mac.ts).
const contasDoMac = criarContasDoMac({
  mac: () => window.nodDesktop,
  ui: () => estado.iasMac,
  mudar: (mudanca: Partial<UiIas>) => dispatch({ tipo: "ias-mac", mudanca }),
  confirmar: (texto) => window.confirm(texto),
  avisarTermos: abrirAvisoDosTermos,
});
void contasDoMac.iniciar();
// ADR-102 (2026-10-13): a lista única de contas de IA, em todas as máquinas (web/lib/contas-da-pessoa.ts).
const contasDaPessoa = criarContasDaPessoa({
  api: () => api,
  ui: () => estado.contasUi,
  mudar: (mudanca) => dispatch({ tipo: "contas-ui", mudanca }),
  contas: () => estado.contasIa,
  trocarContas: (contas) => dispatch({ tipo: "trocar-contas", contas }),
  // NOD-94: a só-computador não tem conta de IA (nenhum bot trabalha nela).
  maquinas: () => maquinasDeTrabalho(estado.maquinas?.maquinas ?? []),
  detalhes: () => estado.detalhesContas,
  invalidar: () => dispatch({ tipo: "invalidar", quais: ["contas", "maquinas"] }),
  // No Mac, o login é o do app: a conta de sempre, se ainda sem login; senão uma pasta nova (ADR-101).
  // NOD-8 (definido em 2026-10-22): a instalação (o passo 1) que falhou para aqui e devolve o erro, sem abrir o login.
  entrarNoMac: async (ia, apelido) => {
    const e = estado.iasMac.estados[ia];
    if (!e?.conta) {
      const r = await (pedeInstalar(inventarioDaIa(estado, ia)) ? iasDoMac.instalar(ia) : iasDoMac.entrar(ia));
      return r.ok ? true : { erro: r.erro };
    }
    const ponte = window.nodDesktop?.contas;
    return ponte ? ponte.adicionar(ia, apelido ?? "").catch(() => false) : false;
  },
  avisarTermos: abrirAvisoDosTermos,
  cifrar: (chave, codigo) => cifrarCodigo(chave, codigo),
  agendar: (fn, ms) => { window.setTimeout(fn, ms); },
  agora: Date.now,
});
/**
 * NOD-94: "Usar uma máquina só para o computador" (instalação por SSH). Os segredos ficam na memória do controlador;
 * o estado só tem o que a tela mostra.
 */
const instalarSsh = criarInstalarSsh({
  api: { instaladorasSsh: () => api!.instaladorasSsh(), pedirInstalacaoSsh: (p) => api!.pedirInstalacaoSsh(p), verInstalacaoSsh: (id) => api!.verInstalacaoSsh(id),
    credencialSsh: (id, c) => api!.credencialSsh(id, c), confiarNaNovaSsh: (id) => api!.confiarNaNovaSsh(id), cancelarInstalacaoSsh: (id) => api!.cancelarInstalacaoSsh(id),
    criarConvite: (c) => api!.criarConvite(c) },
  cifrar: (chave, texto) => cifrarCodigo(chave, texto),
  ler: () => estado.instalarSsh,
  gravar: (i) => dispatch({ tipo: "instalar-ssh", instalar: i }),
  agendar: (fn, ms) => { const t = window.setTimeout(fn, ms); return { cancelar: () => window.clearTimeout(t) }; },
  origem: location.origin,
  computadorAtual: () => estado.maquinas?.maquinas.find(soComputador)?.nome ?? null,
  aoFicarPronta: () => dispatch({ tipo: "invalidar", quais: ["maquinas"] }),
});
/**
 * Os campos de frase, senha e sudo saem do HTML sem valor: depois de redesenhar, o valor volta da memória do controlador
 * (o campo com foco já mantém o dele). Sem instalação aberta, os segredos que sobraram (troca de pessoa) somem.
 */
function devolverSegredosSsh(): void {
  if (!estado.instalarSsh) { if (instalarSshPronto) instalarSsh.descartar(); return; }
  for (const el of document.querySelectorAll<HTMLInputElement>("#espaco [data-ssh-segredo]")) {
    if (el !== document.activeElement) el.value = instalarSsh.valorDoSegredo(el.dataset.sshSegredo as CampoSegredo);
  }
}
instalarSshPronto = true;
// NOD-323: a mídia do bot na conversa (carga, GIF, áudio) e, no app do Mac, o Mostrar no Finder.
const midiaDom: OpcoesMidiaDom = {
  ...(window.nodDesktop?.midia ? { ponte: window.nodDesktop.midia } : {}),
  local: async (url) => (api ? (await api.localDaMidia(url)).caminhoRelativo : null),
  redesenhar: () => render(),
};
instalarMidiaDom(midiaDom);
const opcoesDaLuz = midiaDom.ponte ? { finder: (it: { url: string }) => { void mostrarNoFinder(it.url, midiaDom).then((ok) => { if (!ok) anunciar("O arquivo não está mais na pasta do bot"); }); } } : {};
/** Abre a mídia na tela cheia; pelo link `nod-anexo:` do texto, acha a mídia da mesma fala (ou o cartão do arquivo). */
function abrirMidia(el: HTMLElement): void {
  // A mídia que não carregou: o próprio botão é o "Tentar de novo" (clique, Enter ou espaço).
  if (el.closest(".msg-midias")) { if (el.closest(".falhou")) tentarDeNovo(el); else abrirLuz(el, opcoesDaLuz); return; }
  const id = el.dataset.anexoId ?? "";
  const grupo = el.closest("[data-mensagem]")?.querySelector<HTMLElement>(".msg-midias");
  const alvo = grupo?.querySelector<HTMLElement>(`[data-anexo-id="${CSS.escape(id)}"]`);
  if (alvo && acaoDoAlvo(alvo.dataset.act, false, false) === "luz") { abrirLuz(alvo, opcoesDaLuz); return; }
  // Na tela cheia, mas sem botão à vista (atrás do "+N"): abre nela a partir da primeira mídia da fala.
  const k = indiceNaLuz(grupo?.dataset.luz, id);
  const primeira = grupo?.querySelector<HTMLElement>('[data-act="midia-abrir"]');
  if (k >= 0 && primeira) { abrirLuz(primeira, { ...opcoesDaLuz, indice: k }); return; }
  if (!alvo) return anunciar("Esse arquivo não está nesta mensagem");
  const previa = alvo.querySelector<HTMLElement>('[data-act="previa-arquivo"]');
  const link = alvo.querySelector<HTMLAnchorElement>("a[href]");
  const acao = acaoDoAlvo(alvo.dataset.act, previa !== null, link !== null);
  if (acao === "tocar") {
    // Revisão 4 do #507: o link abre (toca); se o memo já está tocando, não pausa.
    alvo.scrollIntoView({ block: "nearest" });
    alvo.focus();
    if (alvo.closest(".msg-memo")?.querySelector("audio")?.paused !== false) alvo.click();
  }
  else if (acao === "previa") previa?.click();
  else if (acao === "link") link?.click();
  else { alvo.scrollIntoView({ block: "nearest" }); (alvo.matches("button") ? alvo : alvo.querySelector<HTMLElement>("button"))?.focus(); }
}
// O app do Mac anterior a 2026-10-13 (sem a ponte `contas.detalhes`) mostra a tela de antes, com a faixa (suposição 8).
if (window.nodDesktop?.contas && !window.nodDesktop.contas.detalhes) dispatch({ tipo: "contas-ui", mudanca: { appAntigo: true } });
/** O "Criar de novo" (id da VM) que abriu o painel Criar; null = o botão do topo. */
let criarAbertoPor: string | null = null;
/** O ⋯ que abriu o diálogo aberto agora (o foco volta para ele ao fechar; revisão do PR #306). */
function gatilhoDoDialogo(): string | null {
  const u = estado.contasUi;
  // ADA-245: o "Remover o nod deste computador?" abre do "…" da linha; o foco volta para ele.
  const rm = estado.removerUi.dialogo;
  if (rm) return `[data-act="maq-menu"][data-maquina="${CSS.escape(rm.previa.id)}"]`;
  if (u.confirmar) return `[data-act="cl-menu"][data-id="${CSS.escape(u.confirmar.contaId)}"]`;
  if (u.desconectar) return `[data-act="maq-menu"][data-maquina="${CSS.escape(u.desconectar.maquinaId)}"]`;
  // Revisão NOD-92 (item 16): o excluir abre do ⋯ da máquina ou do "Excluir" da VM que falhou ao ser criada.
  const x = estado.nuvem.excluir;
  if (x) return `[data-act="maq-menu"][data-maquina="${CSS.escape(x.id)}"], [data-act="nuvem-excluir"][data-id="${CSS.escape(x.id)}"]`;
  // Revisão NOD-92 (rodada 2): o foco volta ao "Criar" que abriu o painel — o do topo ou o "Criar de novo" daquela VM.
  if (estado.nuvem.criar) return criarAbertoPor ? `[data-act="nuvem-criar-abrir"][data-id="${CSS.escape(criarAbertoPor)}"]` : `[data-act="nuvem-criar-abrir"]:not([data-id])`;
  // NOD-367 (revisão 3): o Esc no "…" aberto devolve o foco ao "…" que o abriu (da máquina ou da conta).
  if (u.maquinaMenu) return `[data-act="maq-menu"][data-maquina="${CSS.escape(u.maquinaMenu)}"]`;
  if (u.menu) return `[data-act="cl-menu"][data-id="${CSS.escape(u.menu)}"]`;
  return null;
}
function focarGatilho(seletor: string | null): void {
  if (seletor) document.querySelector<HTMLElement>(`#espaco ${seletor}`)?.focus();
}
/** O campo marcado com `data-cl-autofoco` recebe o foco logo depois do redesenho (o renomear, o diálogo). */
function focarNovo(): void {
  document.querySelector<HTMLElement>("#espaco [data-cl-autofoco]")?.focus();
}

/**
 * O clique de IA que veio de fora de um cartão (um aviso no chat, o menu da conta) abre Provedores de IA, onde o cartão
 * mostra o andamento: o código do login, o campo de colar, o erro. A linha do chat que acompanha o login ela mesma
 * (`data-fica`) não sai do lugar.
 */
function verCartaoDaIa(el: HTMLElement): void {
  if (el.closest("#espaco, #onboarding, [data-fica]")) return;
  abrirEspaco("conexao");
}

/** Muda o rascunho da Inteligência (2B) e marca a gaveta como "com mudança não salva". */
function mudarInteligencia(agenteId: string | undefined, m: (r: RascunhoInteligencia) => MudancaRascunho | null): void {
  const a = estado.frota?.agentes.find((b) => b.id === (agenteId ?? estado.gaveta?.agenteId));
  if (!a) return;
  const r = estado.rascunhoIa?.agenteId === a.id ? estado.rascunhoIa : rascunhoDe(a);
  const mudanca = m(r);
  if (!mudanca) return;
  dispatch({ tipo: "rascunho-ia", rascunho: mudarRascunho(r, mudanca, contextoInteligencia(estado)) });
  if (mudanca.tipo !== "pilula") gavetaSuja = chaveDaGaveta();
}
const iaDaTela = (id: string | undefined) => iasDaTela(estado).find((i) => i.id === id);

/** A ordem arrastada: a da pessoa (Provedores de IA) grava na hora; a do bot (2B) vai para o rascunho. */
function aoSoltarOrdem(lista: string, ordem: string[]): void {
  if (lista === "contas") { void contasDaPessoa.reordenar(ordem); return; }
  const ids = ordem.filter(ehIaMac);
  if (lista === "pessoa") {
    const completa = [...ids, ...(estado.ias?.ordem ?? []).filter((id) => !ids.includes(id as never))];
    dispatch({ tipo: "ordem-ias", ordem: completa });
    void agir(async () => {
      await api!.gravarOrdemIas(completa);
      dispatch({ tipo: "invalidar", quais: ["ias"] });
    });
    return;
  }
  if (lista === "bot") mudarInteligencia(undefined, (r) => {
    const atual = r.ordem ?? ordemDaPessoa(estado.ias?.ias, estado.ias?.ordem);
    return { tipo: "ordem", ordem: [...ids, ...atual.filter((id) => !ids.includes(id as never))] };
  });
}
instalarOrdemArrastavel(document, aoSoltarOrdem);

function filtrarBots(texto: string, raiz = "#sidebar"): void {
  const termo = texto.trim().toLowerCase();
  for (const el of document.querySelectorAll<HTMLElement>(`${raiz} [data-busca]`)) el.hidden = !el.dataset.busca?.includes(termo);
  // Buscando, as seções recolhidas mostram o que casa (navegacao.css) — por atributo, sem redesenhar a barra no meio da
  // digitação: refazer o campo cortava o acento de tecla morta ("´é") e o focusout fechava a busca (definido em 2026-10-04).
  if (raiz !== "#sidebar") return;
  document.getElementById("sidebar")?.toggleAttribute("data-buscando", termo !== "");
  // NOD-379 (critério 6): buscando, a seção ou a grade sem nenhum resultado some inteira, com o título.
  const grupos = [...document.querySelectorAll<HTMLElement>("#sidebar .section, #sidebar .fixados, #sidebar .inicio-favoritos")];
  const itens = grupos.map((g) => [...g.querySelectorAll<HTMLElement>(".bot-row, .fixado")].map((el) => !el.hidden));
  const some = gruposSemResultado(termo !== "", itens);
  grupos.forEach((g, i) => g.toggleAttribute("data-sem-resultado", some[i]));
  // Nada em lugar nenhum: uma frase no lugar da lista vazia.
  const nada = termo !== "" && grupos.length > 0 && some.every(Boolean);
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  let aviso = lista?.querySelector<HTMLElement>(".busca-nada") ?? null;
  if (nada && lista && !aviso) {
    aviso = document.createElement("p");
    aviso.className = "busca-nada mudo";
    aviso.setAttribute("role", "status");
    lista.append(aviso);
  }
  if (aviso) {
    aviso.hidden = !nada;
    aviso.textContent = nada ? `Nenhum bot com “${texto.trim()}”` : "";
  }
}

/** NOD-45: o timer que devolve o Copiar do card do bloco de código ao repouso, por botão. */
const timersCopiarCodigo = new WeakMap<HTMLElement, number>();
/** NOD-8: o relógio do "✓ Copiado" dos outros botões de copiar (web/lib/copiar.ts). */
const relogioDoCopiar: RelogioDoCopiar = { agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), timers: new WeakMap() };

/** NOD-58: muda o nível da Memória aberto (aba, editor, menu, realce) sem sair dele. */
function mudarNivelMemoria(agenteId: string, mudanca: Partial<Extract<NivelGaveta, { tipo: "memoria" }>>): void {
  const atual = estado.gaveta?.agenteId === agenteId && estado.gaveta.nivel.tipo === "memoria" ? estado.gaveta.nivel : { tipo: "memoria" as const };
  const nivel: NivelGaveta = { ...atual, ...mudanca, tipo: "memoria" };
  for (const k of Object.keys(nivel) as (keyof typeof nivel)[]) if (nivel[k] === undefined) delete nivel[k];
  dispatch({ tipo: "gaveta", agenteId, nivel });
}

/**
 * NOD-58: o retorno das ações da Memória vai para a região viva fixa (fora do `#detalhes`, que é redesenhado e nasceria
 * já com o texto, sem ser lido), com o limpa-e-escreve do `anunciarEm`.
 */
function avisarMemoria(texto: string): void {
  dispatch({ tipo: "status-memoria", texto });
  anunciarGestao(texto);
}

/** NOD-58 (QA): digitar e apagar tudo não é rascunho; compara cada campo com o valor desenhado. */
function memoriaComRascunho(): boolean {
  const campos = [...document.querySelectorAll<HTMLTextAreaElement | HTMLSelectElement>("#detalhes form.mem-editor textarea, #detalhes form.mem-editor select")];
  return rascunhoMudou(campos.map((c) => (c instanceof HTMLSelectElement ? { value: c.value, defaultValue: [...c.options].find((o) => o.defaultSelected)?.value ?? c.value } : c)));
}

/** NOD-58: com texto não salvo no editor ou no Anotar, trocar de memória, de aba ou abrir o "…" pergunta antes. */
function semPerderRascunho(fazer: () => void): void {
  if (gavetaSuja && gavetaSuja === chaveDaGaveta() && !memoriaComRascunho()) gavetaSuja = null;
  if (gavetaSuja && gavetaSuja === chaveDaGaveta()) {
    // `fazer` roda pelo `depois`, já com o diálogo fechado: com o modal aberto a página é inerte e o foco não pegaria.
    pedirGestao("Descartar as mudanças?", "<p>O que você mudou aqui ainda não foi salvo.</p>", "Descartar", async () => { gavetaSuja = null; }, true, () => { if (gavetaSuja === null) fazer(); });
    return;
  }
  fazer();
}

/** NOD-58: memórias com um Desfazer da linha "Apagada" a caminho (inclui a leitura do diário antes do desfazer). */
const trazendo = new Set<string>();

/** NOD-58: memórias com um Apagar a caminho; o segundo clique não sai e não vira um 404 falso. */
const apagando = new Set<string>();

/** NOD-58: entradas com um desfazer a caminho; o segundo clique (duplo clique) não sai e não vira um falso conflito. */
const desfazendo = new Set<string>();

/** NOD-58: desfaz uma entrada do diário. 409 = a memória mudou depois (aviso com "Ver a mais nova"); rede = "Tentar de novo". */
async function desfazerNoDiario(agenteId: string, entradaId: string, memoriaId: string): Promise<boolean> {
  if (desfazendo.has(entradaId)) return false;
  desfazendo.add(entradaId);
  avisador.acaoPropria();
  dispatch({ tipo: "erro", erro: null });
  dispatch({ tipo: "ocupado", valor: true });
  try {
    const r = await api!.desfazerEntrada(agenteId, entradaId);
    dispatch({ tipo: "aviso-diario", aviso: null });
    // A original fica desfeita já na tela, mesmo se veio pelo "Mostrar mais" (a releitura só traz a 1ª página).
    dispatch({ tipo: "diario-desfeita", agenteId, entradaId, em: r.entrada.criadoEm });
    if (r.entrada.acao === "criada") dispatch({ tipo: "memoria-apagada-sai", agenteId, memoriaId });
    avisarMemoria("Mudança desfeita.");
    dispatch({ tipo: "invalidar", quais: [`memoria:${agenteId}`, `diario:${agenteId}`] });
    return true;
  } catch (e) {
    if (e instanceof ErroApi && e.status === 409) {
      dispatch({ tipo: "aviso-diario", aviso: { entradaId, tipo: "conflito" } });
      avisarMemoria("Esta memória mudou depois. Desfaça a mudança mais nova primeiro.");
      dispatch({ tipo: "invalidar", quais: [`diario:${agenteId}`] });
    } else if (ehErroDeRede(erroDe(e))) {
      dispatch({ tipo: "aviso-diario", aviso: { entradaId, tipo: "rede" } });
      avisarMemoria("Não deu para desfazer agora.");
    } else mostrarErro(e);
    return false;
  } finally {
    desfazendo.delete(entradaId);
    dispatch({ tipo: "ocupado", valor: false });
  }
}

/** NOD-58: a linha "Apagada" da aba Memórias: o desfazer é o da entrada mais nova dessa memória (a remoção). */
async function desfazerApagada(el: HTMLElement): Promise<void> {
  const agenteId = el.dataset.agente ?? "";
  const memoriaId = el.dataset.id ?? "";
  let entrada = estado.diarios[agenteId]?.entradas.find((e) => e.memoriaId === memoriaId);
  if (entrada?.acao !== "apagada" || entrada.desfeitaEm !== null) {
    const pagina = await api!.diarioMemoria(agenteId).catch((e: unknown) => (mostrarErro(e), null));
    if (!pagina) return;
    dispatch({ tipo: "hidratar-diario", agenteId, pagina });
    entrada = pagina.entradas.find((e) => e.memoriaId === memoriaId);
  }
  if (entrada?.acao !== "apagada" || entrada.desfeitaEm !== null) {
    dispatch({ tipo: "memoria-apagada-sai", agenteId, memoriaId });
    avisarMemoria("Esta memória mudou depois. Veja no Histórico.");
    return;
  }
  if (await desfazerNoDiario(agenteId, entrada.id, memoriaId)) avisarMemoria("Memória de volta.");
}

/** NOD-58: as ações da Memória (abas Memórias | Histórico). Nada de Desfazer no chat, nem Refazer (decisão de produto). */
const acoesDaMemoria: Record<string, (el: HTMLElement) => Promise<void> | void> = {
  "memoria-aba": (el) => semPerderRascunho(() => {
    const agenteId = el.dataset.agente ?? "";
    const aba = el.dataset.aba === "historico" ? "historico" : "memorias";
    gavetaSuja = null;
    dispatch({ tipo: "aviso-diario", aviso: null });
    mudarNivelMemoria(agenteId, { aba, editando: undefined, menu: undefined, realce: undefined });
    // O histórico guardado aparece na hora; a leitura nova chega por cima.
    if (aba === "historico") dispatch({ tipo: "invalidar", quais: [`diario:${agenteId}`] });
    document.querySelector<HTMLElement>(`#detalhes .mem-aba[data-aba="${aba}"]`)?.focus();
  }),
  "editar-memoria": (el) => semPerderRascunho(() => {
    gavetaSuja = null;
    mudarNivelMemoria(el.dataset.agente ?? "", { editando: el.dataset.id, menu: undefined });
    const campo = document.querySelector<HTMLTextAreaElement>("#detalhes .mem-editando .mem-editor-texto");
    if (campo) { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); }
  }),
  "cancelar-edicao": (el) => {
    gavetaSuja = null;
    mudarNivelMemoria(el.dataset.agente ?? "", { editando: undefined });
    document.querySelector<HTMLElement>(`#detalhes [data-mem-corpo="${CSS.escape(el.dataset.id ?? "")}"]`)?.focus();
  },
  "memoria-mais": (el) => semPerderRascunho(() => {
    const agenteId = el.dataset.agente ?? "";
    const aberto = estado.gaveta?.nivel.tipo === "memoria" && estado.gaveta.nivel.menu === el.dataset.id;
    mudarNivelMemoria(agenteId, { menu: aberto ? undefined : el.dataset.id });
    if (!aberto) document.querySelector<HTMLElement>("#detalhes .mem-menu [role=menuitem]")?.focus();
  }),
  "apagar-memoria": (el) => {
    const memoriaId = el.dataset.id ?? "";
    if (apagando.has(memoriaId)) return;
    apagando.add(memoriaId);
    return agir(async () => {
      const agenteId = el.dataset.agente ?? "";
      const m = estado.memorias[agenteId]?.find((x) => x.id === memoriaId);
      await api!.apagarMemoria(agenteId, memoriaId);
      gavetaSuja = null;
      if (m) dispatch({ tipo: "memoria-apagada", agenteId, apagada: { memoriaId: m.id, tipo: m.tipo, texto: m.texto, criadoEm: m.criadoEm } });
      mudarNivelMemoria(agenteId, { menu: undefined, editando: undefined });
      const dona = estado.frota?.agentes.some((b) => b.id === agenteId && b.ownerId === estado.sessao?.pessoaId) ?? false;
      avisarMemoria(dona ? "Memória apagada. Dá para desfazer." : "Memória apagada.");
      dispatch({ tipo: "invalidar", quais: [`memoria:${agenteId}`, `diario:${agenteId}`] });
      document.querySelector<HTMLElement>(`#detalhes [data-act="desfazer-apagada"][data-id="${CSS.escape(memoriaId)}"]`)?.focus();
    }).finally(() => apagando.delete(memoriaId));
  },
  // Com rascunho não salvo a gaveta não se redesenha (a linha "Apagada" ficaria e o 2º clique viraria conflito falso).
  "desfazer-apagada": (el) => semPerderRascunho(() => {
    const memoriaId = el.dataset.id ?? "";
    if (trazendo.has(memoriaId)) return;
    trazendo.add(memoriaId);
    void desfazerApagada(el).finally(() => trazendo.delete(memoriaId));
  }),
  "ver-no-historico": (el) => semPerderRascunho(() => {
    const agenteId = el.dataset.agente ?? "";
    gavetaSuja = null;
    mudarNivelMemoria(agenteId, { aba: "historico", menu: undefined, editando: undefined, realce: el.dataset.id });
    dispatch({ tipo: "invalidar", quais: [`diario:${agenteId}`] });
  }),
  "desfazer-entrada": (el) => void desfazerNoDiario(el.dataset.agente ?? "", el.dataset.id ?? "", el.dataset.memoria ?? ""),
  "ver-mais-nova": (el) => {
    dispatch({ tipo: "aviso-diario", aviso: null });
    mudarNivelMemoria(el.dataset.agente ?? "", { realce: el.dataset.memoria });
    document.querySelector<HTMLElement>("#detalhes .mem-realce")?.scrollIntoView({ block: "nearest" });
  },
  "revisar-entrada": (el) =>
    agir(async () => {
      const agenteId = el.dataset.agente ?? "";
      const r = await api!.revisarDiario(agenteId, el.dataset.id ?? "");
      dispatch({ tipo: "diario-revisado", agenteId, entradaId: el.dataset.id ?? "", aRevisar: r.aRevisar });
      avisarMemoria("Marcada como revisada.");
    }),
  "revisar-tudo": (el) =>
    agir(async () => {
      const agenteId = el.dataset.agente ?? "";
      const r = await api!.revisarDiario(agenteId);
      dispatch({ tipo: "diario-revisado", agenteId, entradaId: null, aRevisar: r.aRevisar });
      avisarMemoria("Tudo revisado.");
    }),
  "diario-mais": (el) =>
    agir(async () => {
      const agenteId = el.dataset.agente ?? "";
      const ultima = estado.diarios[agenteId]?.entradas.at(-1);
      if (!ultima) return;
      dispatch({ tipo: "hidratar-diario", agenteId, pagina: await api!.diarioMemoria(agenteId, ultima.id), anexar: true });
    }),
};

/** Cria um bot em branco e abre a conversa dele. */
function criarBotAgora(): Promise<void> {
  return agir(async () => {
    const r = await api!.criarAgente(undefined, { interativo: true });
    dispatch({ tipo: "invalidar", quais: ["frota"] });
    navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
  });
}

function pedidoDoCard(el: HTMLElement): PedidoBarra | null {
  const p = el.dataset.pedido;
  return p === "compacta" || p === "so_avatares" || p === "normal" ? p : null;
}

const ACOES: Record<string, (el: HTMLElement) => Promise<void> | void> = {
  // NOD-119: Configurações › Aparência › Barra lateral; recolhida continua recolhida.
  "escolher-densidade": (el) => {
    const d = el.dataset.valor === "compacta" ? "compacta" : "confortavel";
    mudarBarra(escolherDensidade(barraAtual, d), true);
    document.querySelector<HTMLElement>(`.segmentado [data-act="escolher-densidade"][data-valor="${d}"]`)?.focus();
  },
  // NOD-119 (C1): o card do chat. Só o clique da pessoa muda a barra; a decisão fica neste computador.
  "aplicar-barra": (el) => {
    const pedido = pedidoDoCard(el);
    const id = el.dataset.mensagem;
    if (!pedido || !id || celular.ativo()) return;
    gravarDecisao(id, "aplicada");
    void window.nodDesktop?.definirDecisaoBarra?.(id, "aplicada").catch(() => undefined);
    mudarBarra(pedidoDoChat(barraAtual, pedido), true);
  },
  "recusar-barra": (el) => {
    const id = el.dataset.mensagem;
    if (!id) return;
    gravarDecisao(id, "recusada");
    void window.nodDesktop?.definirDecisaoBarra?.(id, "recusada").catch(() => undefined);
    render();
  },
  ...telaOnboarding.acoes,
  // NOD-323: a mídia do bot.
  "midia-abrir": abrirMidia,
  "midia-gif": alternarGif,
  "midia-audio": alternarAudio,
  "midia-audio-vel": velocidadeDoAudio,
  "midia-tentar": tentarDeNovo,
  "midia-finder": (el) => {
    const url = el.closest<HTMLElement>("[data-midia-url]")?.dataset.midiaUrl;
    if (url) void mostrarNoFinder(url, midiaDom).then((ok) => { if (!ok) anunciar("O arquivo não está mais na pasta do bot"); });
  },
  ...telaConta.acoes,
  // NOD-377: Cobrar e Desistir da espera de colega vencida (pílula e Trabalhos).
  ...criarAcoesDaEspera({
    cobrar: (agenteId, tarefaId) => api!.cobrarEspera(agenteId, tarefaId),
    desistir: (agenteId, tarefaId) => api!.desistirDaEspera(agenteId, tarefaId),
    invalidar: () => dispatch({ tipo: "invalidar", quais: ["trabalhos"] }),
    render: () => render(),
    anunciar: (texto) => anunciar(texto),
    // Revisão do PR #544: o foco vai ao campo só na conversa (em Trabalhos, fica onde estava).
    focarCampo: () => { if (estado.tela.tipo === "conversa") document.getElementById("composer-texto")?.focus(); },
  }),
  ...(telaMinhaConta.acoes as Record<string, (el: HTMLElement) => Promise<void> | void>),
  "conta-abrir": (el) => { try { marcarFalou(window.localStorage); } catch { /* sem storage */ } return telaConta.acoes["conta-abrir"]?.(el); },
  "entrada-ir": (el) => { entrada = { ...entrada, conta: { etapa: el.dataset.etapa === "recuperar" ? "recuperar" : "entrar", erro: null, enviadoPara: null, ocupado: false }, redefinir: null }; render(); },
  // NOD-345: "Mostrar" a senha troca o tipo do campo ali mesmo (o valor nunca sai do DOM).
  "conta-mostrar": (el) => {
    const input = el.parentElement?.querySelector<HTMLInputElement>("input");
    if (!input) return;
    const mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    el.textContent = mostrar ? "Esconder" : "Mostrar";
    el.setAttribute("aria-pressed", String(mostrar));
  },
  "conta-lembrete-ok": () => { try { marcarFalou(window.localStorage); } catch { /* sem storage */ } render(); },
  "abrir-raio-x": (el) => {
    const t = estado.tela;
    const nome = t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "agente" : "sala";
    if (api && el.dataset.id) void abrirRaioX(api, el.dataset.id, nome, el, el.dataset.onde ?? "");
  },
  "alternar-modo-dev": () => agir(alternarModoDev),
  // Modo ligação (definido em 2026-10-04, ADR-071).
  "iniciar-ligacao": () => { const t = estado.tela; if (t.tipo === "conversa") void telaLigacao.ligar(t.agenteId); },
  "ligacao-encolher": () => telaLigacao.encolher(),
  "ligacao-expandir": () => telaLigacao.expandir(),
  "ligacao-mudo": () => telaLigacao.alternarMudo(),
  "ligacao-teclado": () => telaLigacao.alternarTeclado(),
  "ligacao-ajustes": (el) => telaLigacao.abrirAjustes(el),
  "ligacao-desligar": () => telaLigacao.desligar(),
  "ligacao-aprovar": (el) => agir(() => telaLigacao.decidir(el.dataset.id ?? "", true)),
  "ligacao-recusar": (el) => agir(() => telaLigacao.decidir(el.dataset.id ?? "", false)),
  "ligacao-retomar-audio": () => telaLigacao.retomarAudio(),
  "ligacao-sugestao": (el) => { telaLigacao.enviarTexto(el.dataset.texto ?? ""); },
  // Rede de segurança (2026-10-05): a IA do Mac caiu no meio da ligação.
  "ligacao-continuar-ia": (el) => telaLigacao.continuarCom(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli"),
  "ligacao-ia-entrar": (el) => telaLigacao.iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "entrar"),
  "ligacao-ia-instalar": (el) => telaLigacao.iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "instalar"),
  "ligacao-sem-voz": () => telaLigacao.semVoz(),
  "ligacao-avaliar": (el) => telaLigacao.avaliar(el.dataset.nota === "ruim" ? "ruim" : "boa"),
  "ligacao-motivo": (el) => telaLigacao.motivo((el.dataset.motivo ?? "outro") as MotivoAvaliacaoLigacao),
  "ligacao-fechar-avaliacao": () => telaLigacao.fecharAvaliacao(),
  "ligacao-fechar-recusa": () => telaLigacao.fecharRecusa(),
  "ver-transcricao": (el) => {
    const t = estado.tela;
    void telaLigacao.verTranscricao(el.dataset.id ?? "", t.tipo === "conversa" ? botGerido(t.agenteId)?.nome ?? "Bot" : "Bot");
  },
  "apagar-transcricao": (el) => {
    const id = el.dataset.id ?? "";
    const alvo = conversaAtual();
    pedirGestao("Apagar a transcrição?", "<p>O resumo continua na conversa.</p>", "Apagar transcrição", async () => {
      await telaLigacao.apagarTranscricao(id);
      if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    }, true);
  },

  // ADR-113 (plano "pergunta com botões", Parte 5): as ações na fala — web/telas/acoes-da-fala.ts desenha, aqui se age.
  // NOD-54: o cartão e as linhas do desfazer (web/telas/desfazer.ts).
  "desfazer-cancelar": () => fecharCartaoDesfazer(true),
  "desfazer-confirmar": (el) => {
    const fala = falaPorId(el.dataset.id ?? "");
    if (fala) pedirDesfazer(fala, false);
  },
  "desfazer-tentar": (el) => {
    const fala = falaPorId(el.dataset.id ?? "");
    if (fala) pedirDesfazer(fala, false);
  },
  "desfazer-forcar": (el) => {
    const fala = falaPorId(el.dataset.id ?? "");
    if (fala) pedirDesfazer(fala, true);
  },
  "reagir-fala": (el) => abrirMenuDaFala(el, "reagir"),
  "mais-da-fala": (el) => abrirMenuDaFala(el, "mais"),
  "reagir-chip": (el) => {
    const fala = falaPorId(el.dataset.id ?? "");
    if (fala && el.dataset.emoji) void alternarReacao(fala, el.dataset.emoji);
  },
  "responder-fala": (el) => {
    const fala = falaPorId(el.dataset.id ?? "");
    if (fala) responderAFala(fala);
  },
  "citacao-cancelar": () => {
    const alvo = conversaAtual();
    if (alvo) dispatch({ tipo: "citar", conversaId: alvo.conversaId, citacao: null });
    document.getElementById("composer-texto")?.focus();
  },
  "ver-fala-citada": (el) => {
    const balao = document.querySelector<HTMLElement>(`[data-mensagem="${CSS.escape(el.dataset.id ?? "")}"]`);
    if (balao) levarAo(balao);
    else anunciar("Essa mensagem saiu da janela carregada da conversa.");
  },
  // NOD-106: com a ligação viva o botão só explica (aria-disabled); na resposta que já lê, para; senão, lê esta.
  "ouvir-mensagem": (el) => {
    const id = el.dataset.id;
    if (!id || el.getAttribute("aria-disabled") === "true" || estado.ligacaoViva) return;
    if (tocador.atual()?.mensagemId === id) return tocador.parar("parou");
    tocador.destravar();
    limparFalhaLeitura();
    void ouvirMensagem(id);
  },
  "relatar-mensagem": (el) => {
    const id = el.dataset.id;
    // definido em 2026-09-21: o correlation_id NÃO vai junto. `estado.erro` é o slot do último erro
    // do app inteiro — pode ser de outra chamada, de vinte minutos atrás, e some quando qualquer
    // agir() dá certo. Carimbar isso no relato mandaria quem investiga para a linha de log errada;
    // o turno e a mensagem já ligam o relato ao que aconteceu.
    if (id && api) abrirReportarBug(api, id, __NOD_VERSAO__, null, () => dispatch({ tipo: "invalidar", quais: ["relatos"] }));
  },
  // ADR-051: o artefato numa janela grande (o mesmo documento, o mesmo estado) e o .html para guardar.
  "artefato-tela-cheia": (el) => agir(() => artefatos.telaCheia(el.dataset.mensagem ?? "")),
  "artefato-baixar": (el) => agir(() => artefatos.baixar(el.dataset.mensagem ?? "")),
  "artefato-nova-aba": (el) => agir(() => artefatos.novaAba(el.dataset.mensagem ?? "")),
  // ADR-053: a tabela do bot vai para a área de transferência com as colunas separadas, pronta para a planilha.
  // definido em 2026-10-03: o rodapé da tabela copia como Planilha, CSV ou JSON (web/lib/texto-formatado.ts rodapeDaTabela).
  "copiar-tabela": async (el) => {
    const antes = el.textContent ?? "";
    const formato = el.dataset.formato === "csv" || el.dataset.formato === "json" ? el.dataset.formato : "tsv";
    try {
      const celulas: unknown = JSON.parse(el.dataset.tabela ?? "[]");
      const linhas = Array.isArray(celulas) ? celulas.map((l) => (Array.isArray(l) ? l.map(String) : [])) : [];
      await navigator.clipboard.writeText(tabelaComo(formato, linhas));
      el.textContent = "Copiada";
    } catch {
      el.textContent = "Não copiou";
    }
    setTimeout(() => { el.textContent = antes; }, 1500);
  },
  entrar: (el) => agir(async () => { await iniciarSessao(await sessaoApi.entrar(el.dataset.pessoa ?? "")); void abrirTarefaGuardada(); abrirQuadroGuardado(); await lerContas(null); }),
  navegar: (el) => {
    const tela = el.dataset.tela;
    if (tela === "conectores") abrirMarketplace();
    else if (tela === "rotinas") abrirRotinas();
    else if (tela === "sua-vez" || tela === "nao-lidos" || tela === "nova-sala" || tela === "novo-bot" || tela === "nova-rotina" || tela === "trabalhos") navegar({ tipo: tela });
    // As antigas telas da conta são seções de Seu espaço desde 2026-09-30.
    else if (tela === "chaves") abrirEspaco("computadores");
    else if (tela === "relatos") abrirEspaco("relatos");
    else if (tela === "gestao") abrirEspaco("agentes");
    else if (tela === "espaco") abrirEspaco("conexao");
  },
  // NOD-383: no celular, "Configurações" (a Geral do menu) abre a lista das seções; os outros itens abrem a seção direto.
  "menu-conta": (el) => abrirMenuConta(el, dadosMenuConta(), { secao: (s) => abrirEspaco(s, s === "geral" && celular.ativo()), conta: (qual) => void abrirDoMenuConta(qual) }, celular.ativo()),
  "secao-espaco": (el) => abrirEspaco((el.dataset.secao as SecaoEspaco | undefined) ?? "conexao"),
  // NOD-85: a agenda das rotinas (Configurações › Rotinas).
  "agenda-ir": (el) => { if (el.dataset.dia) dispatch({ tipo: "agenda-ir", dia: el.dataset.dia }); },
  "agenda-mes": (el) => {
    const ui = estado.agenda.ui;
    const mes = el.dataset.mes ?? (ui.mes === null ? (ui.foco ?? diaDe(estado.agora)).slice(0, 7) : null);
    dispatch({ tipo: "agenda-ui", mudanca: { mes, aberto: null, menu: null } });
    if (mes !== null && !el.dataset.mes) requestAnimationFrame(() => diaParaFocarNoMes((sel) => document.querySelector<HTMLElement>(sel))?.focus());
  },
  "agenda-bot": (el) => { if (el.dataset.id) dispatch({ tipo: "agenda-bot", id: el.dataset.id }); },
  "agenda-linha": (el) => {
    const chave = el.dataset.chave ?? null;
    const ui = estado.agenda.ui;
    dispatch({ tipo: "agenda-ui", mudanca: { aberto: ui.aberto === chave ? null : chave, menu: null, mes: null } });
    // QA do PR #595 (B5): no celular a linha abre numa folha por cima; o foco vai para ela (o Esc o devolve à linha).
    if (celular.ativo() && ui.aberto !== chave) requestAnimationFrame(() => document.querySelector<HTMLElement>("#espaco .ag-folha")?.focus());
  },
  "agenda-bloco": (el) => {
    const chave = el.dataset.chave ?? null;
    dispatch({ tipo: "agenda-ui", mudanca: { bloco: estado.agenda.ui.bloco === chave ? null : chave, aberto: null } });
  },
  "agenda-tentar": () => dispatch({ tipo: "agenda-tentar" }),
  "agenda-so-problema": () => dispatch({ tipo: "agenda-ui", mudanca: { soProblema: false } }),
  "agenda-todos": () => dispatch({ tipo: "agenda-ui", mudanca: { bots: [], soProblema: false, busca: null } }),
  "agenda-busca-abrir": () => {
    dispatch({ tipo: "agenda-ui", mudanca: { busca: "" } });
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-agenda-busca]")?.focus());
  },
  "agenda-busca-fechar": () => {
    dispatch({ tipo: "agenda-ui", mudanca: { busca: null } });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-act="agenda-busca-abrir"]')?.focus());
  },
  "agenda-pausadas": () => dispatch({ tipo: "agenda-ui", mudanca: { pausadasAbertas: !estado.agenda.ui.pausadasAbertas } }),
  "agenda-fechar": () => dispatch({ tipo: "agenda-ui", mudanca: { aberto: null, menu: null, mes: null } }),
  // O link "Abrir na agenda" que o bot escreve (ver_agenda): abre Rotinas no dia, com o filtro de problema.
  "abrir-agenda": (el) => {
    const dia = el.dataset.dia;
    abrirEspaco("rotinas");
    dispatch({ tipo: "agenda-abrir", hoje: diaDe(estado.agora), ...(dia ? { dia } : {}), soProblema: el.dataset.problema === "1" });
  },
  // NOD-312: a carona "relê o necessário" e a marca "recomeçou" abrem e fecham a explicação logo abaixo (no DOM, sem
  // re-render: o foco fica no botão); o estado sobrevive ao próximo render da timeline (web/lib/recomeco.ts).
  "recomeco-explicar": (el) => {
    alternarExplicacaoNoDom(el);
  },
  // NOD-367: as ações das Configurações (a linha recolhida, a conta, os experimentos e o onboarding).
  "config-recolhe": (el) => { if (el.dataset.recolhe) dispatch({ tipo: "config-recolhe", id: el.dataset.recolhe }); },
  // NOD-368: a seleção e a troca em lote de Agentes.
  "lote-marcar": (el) => { if (el.dataset.id) { gravarLote(marcarLote(estado.configUi.lote, el.dataset.id)); anunciarSelecaoDoLote(); } },
  "lote-todos": () => { gravarLote(marcarTodosLote(estado.configUi.lote, visiveisDoLote())); anunciarSelecaoDoLote(); },
  "lote-selecionar": () => {
    gravarLote({ ...estado.configUi.lote, selecionando: true });
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#espaco .cfg-agentes .lote-todos")?.focus());
  },
  "lote-cancelar": () => { gravarLote(cancelarLote(estado.configUi.lote)); focarDepoisDoLote(); },
  "lote-abrir": (el) => abrirSeletorDoLote(el),
  "lote-fechar": () => fecharSeletorDoLote(),
  "lote-escolher": (el) => {
    if (el.getAttribute("aria-disabled") === "true") return;
    gravarLote({ ...estado.configUi.lote, escolha: el.dataset.valor ?? "" });
    // Revisão 3: a prévia é dita pelo nó fixo (um role=status recriado a cada desenho não é lido com confiança).
    depsDoLote.anunciar(document.querySelector("#espaco .lote-previa")?.textContent ?? "");
  },
  "lote-confirmar": () => confirmarLote(),
  "lote-tentar": (el) => (el.dataset.id ? tentarDeNovoNoLote(el.dataset.id) : undefined),
  "alternar-experimento": (el) => {
    const chave = el.dataset.experimento;
    if (ehChaveDeExperimento(chave)) return agir(() => alternarExperimento(chave));
  },
  "ver-onboarding": () => { fecharEspaco(); void telaOnboarding.deNovo(); },
  "cfg-conta": (el) => {
    const qual = el.dataset.conta ?? "inicio";
    // Sair fica aqui; o resto abre o cartão da conta na conversa do Nod (as rotas de antes): as Configurações fecham.
    if (qual !== "sair") fecharEspaco();
    void abrirDoMenuConta(qual);
  },
  "cfg-conta-pagina": (el) => {
    dispatch({ tipo: "config-ui", mudanca: { abertos: [...estado.configUi.abertos.filter((x) => x !== "conta-pagina"), "conta-pagina"] } });
    if (el.dataset.aba) void telaMinhaConta.acoes["mc-aba"]?.(el);
    if (el.dataset.passo) void telaMinhaConta.acoes["mc-passo"]?.(el);
    document.querySelector<HTMLElement>("#espaco .cfg-voltar")?.focus();
  },
  "cfg-conta-voltar": () => {
    dispatch({ tipo: "config-ui", mudanca: { abertos: estado.configUi.abertos.filter((x) => x !== "conta-pagina") } });
    document.querySelector<HTMLElement>("#espaco .cfg-perfil")?.focus();
  },
  // definido em 2026-10-05 (ia-fora.ts): os botões do aviso "a conta da IA não serve". Só existem dentro do app do Mac;
  // o login abre no navegador e o app percebe sozinho quando termina (testa a conta nova e reanuncia).
  // revisto em 2026-10-10 (plano das IAs, teste do Breno: "clicava em Codex e nada acontecia"): todo clique termina no
  // estado do cartão ou numa nota escrita (web/lib/ias-do-mac.ts); fora de Provedores de IA, abre a seção para a pessoa
  // ver o cartão andar (o código do login, o campo de colar, o erro).
  "ia-entrar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) { verCartaoDaIa(el); void iasDoMac.entrar(ia); } },
  // NOD-209: "Trocar conta" na IA logada — o mesmo login dentro do cartão; cancelar mantém a conta atual.
  "ia-trocar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) { verCartaoDaIa(el); void iasDoMac.trocar(ia); } },
  "ia-conectar": (el) => {
    const ia = el.dataset.ia;
    if (!ehIa(ia)) return;
    verCartaoDaIa(el);
    void (pedeInstalar(inventarioDaIa(estado, ia)) ? iasDoMac.instalar(ia) : iasDoMac.entrar(ia));
  },
  "ia-instalar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) { verCartaoDaIa(el); void iasDoMac.instalar(ia); } },
  "ia-cancelar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void iasDoMac.cancelar(ia); },
  // ADR-101 (NOD-211): as contas da IA (Provedores de IA) e o "Seguir com a conta N" do limite na conversa.
  "conta-usar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDoMac.usar(ia, Number(el.dataset.posicao)); },
  "conta-mover": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDoMac.mover(ia, Number(el.dataset.posicao), Number(el.dataset.para)); },
  "conta-remover": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDoMac.remover(ia, Number(el.dataset.posicao)); },
  "conta-form-abrir": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) contasDoMac.abrirForm(ia); },
  "conta-form-fechar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) contasDoMac.fecharForm(ia); },
  // QA do NOD-211: o erro da adição — de novo com o mesmo apelido, ou fecha.
  "conta-tentar-de-novo": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDoMac.adicionar(ia, el.dataset.apelido ?? ""); },
  "conta-falha-fechar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDoMac.fecharFalha(ia); },
  "ia-verificar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void iasDoMac.verificar(ia); },
  // No onboarding, o teste é o dele (onboarding-teste.ts): é o veredito dele que libera o Continuar.
  "ia-testar": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void (el.closest("#onboarding") ? telaOnboarding.acoes["onboarding-ia-testar"]?.(el) : iasDoMac.testar(ia)); },
  "ia-abrir-link": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void iasDoMac.abrirLink(ia); },
  "ia-copiar-codigo": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void iasDoMac.copiarCodigo(ia, el.dataset.texto ?? "").then((ok) => { if (ok) anunciar("Código copiado"); }); },
  "ia-ajuda": (el) => iasDoMac.alternarAjuda(`${el.dataset.ia ?? ""}:${el.dataset.passo ?? ""}`),
  "ia-detalhe": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) iasDoMac.alternarDetalhe(ia); },
  // 2A: o menu de Inteligência dentro do cartão da gaveta; um clique grava (Automático, ou Uma IA só naquele modelo).
  "menu-inteligencia": (el) => dispatch({ tipo: "menu-ia", agenteId: estado.menuIa === el.dataset.id ? null : el.dataset.id ?? null }),
  "inteligencia-escolher": (el) => {
    const a = estado.frota?.agentes.find((b) => b.id === el.dataset.id);
    const ia = el.dataset.ia;
    // NOD-9: o modelo que pede um CLI mais novo fica no menu (aria-disabled, "Precisa do Claude Code Y") e não grava.
    if (!a || el.getAttribute("aria-disabled") === "true") return;
    const pedido = el.dataset.modo === "auto" ? pedidoDoMenu(a, { modo: "auto" }) : ehIaMac(ia) && el.dataset.modelo ? pedidoDoMenu(a, { ia, modelo: el.dataset.modelo }) : null;
    if (!pedido) return;
    dispatch({ tipo: "menu-ia", agenteId: null });
    void gravarInteligenciaComPrevia(a, pedido);
  },
  // 2B: o rascunho muda a cada clique; Salvar é o submit do formulário da gaveta.
  "int-modo": (el) => mudarInteligencia(undefined, () => ({ tipo: "modo", modo: el.dataset.modo === "fixa" ? "fixa" : "auto" })),
  "int-fixa": (el) => mudarInteligencia(undefined, () => (ehIaMac(el.dataset.ia) ? { tipo: "fixa", ia: el.dataset.ia } : null)),
  "int-pilula": (el) => mudarInteligencia(undefined, () => (ehIaMac(el.dataset.ia) ? { tipo: "pilula", ia: el.dataset.ia } : null)),
  "int-modelo": (el) => mudarInteligencia(undefined, () => { const ia = iaDaTela(el.dataset.ia); return ia && el.dataset.modelo && el.getAttribute("aria-disabled") !== "true" ? { tipo: "modelo", ia, modelo: el.dataset.modelo } : null; }),
  "int-raciocinio": (el) => mudarInteligencia(undefined, () => { const ia = iaDaTela(el.dataset.ia); const r = el.dataset.raciocinio; return ia && (r === "low" || r === "medium" || r === "high" || r === "xhigh" || r === "max") ? { tipo: "raciocinio", ia, raciocinio: r } : null; }),
  "int-ordem-pessoa": () => mudarInteligencia(undefined, () => ({ tipo: "ordem-da-pessoa" })),
  // NOD-171: "Atualizar" do CLI abaixo do piso. No app do Mac abre a página oficial (o mesmo `iaInstalar`; quem atualiza é a
  // pessoa, no Terminal); fora dele, a seção Conexão, que mostra o comando.
  // NOD-9: no app com a ponte nova, o "Atualizar" roda o atualizador do CLI no Mac (data-agora="1" = sem esperar os bots
  // terminarem); app antigo: a página oficial, como antes (NOD-171).
  "ia-atualizar": (el) => {
    const ia = el.dataset.ia;
    const mac = window.nodDesktop;
    if (ehIa(ia) && mac?.ias?.atualizar) { verCartaoDaIa(el); void iasDoMac.atualizar(ia, { agora: el.dataset.agora === "1" }); }
    else if (ehIa(ia) && mac?.iaInstalar) void mac.iaInstalar(ia).catch(() => undefined);
    else abrirEspaco("conexao");
  },
  // NOD-8: "✓ Copiado" por 2 s (web/lib/copiar.ts).
  "copiar-texto": async (el) => {
    const ok = await navigator.clipboard.writeText(el.dataset.texto ?? "").then(() => true, () => false);
    mostrarCopia(el, ok, relogioDoCopiar);
  },
  // NOD-45: o Copiar do card do bloco de código (texto-formatado.ts cardDoCodigo). Lê o textContent do <code> do mesmo
  // card, e não um data-*: sai o código que a pessoa vê, sem crases, sem a linha da linguagem e sem a última quebra.
  // Só troca o texto do rótulo (o ícone fica) e o aria-label, para o leitor de tela ouvir o resultado.
  // O repouso é fixo (não lido do botão) e o timer anterior é cancelado: dois cliques seguidos não prendem o
  // "Código copiado" no aria-label nem voltam ao "Copiar" no meio do segundo aviso.
  "copiar-codigo": async (el) => {
    const estadoEl = el.querySelector(".md-codigo-estado");
    const mostrar = (texto: string, aria: string): void => {
      if (estadoEl) estadoEl.textContent = texto;
      el.setAttribute("aria-label", aria);
    };
    try {
      await navigator.clipboard.writeText(el.closest(".md-codigo")?.querySelector("code")?.textContent ?? "");
      mostrar(ROTULO_COPIADO, "Código copiado");
    } catch {
      mostrar("Não copiou", "Não copiou o código");
    }
    clearTimeout(timersCopiarCodigo.get(el));
    timersCopiarCodigo.set(el, window.setTimeout(() => mostrar("Copiar", "Copiar código"), COPIADO_MS));
  },
  "fechar-espaco": () => fecharEspaco(),
  // NOD-383: o ‹ de uma seção no celular volta para a lista das Configurações (o foco vai para a seção de onde saiu).
  "cfg-lista": () => {
    const volta = voltarParaLista(estado, !!contas?.minhaConta);
    if (!volta) return;
    if (volta.fecharMinhaConta) telaMinhaConta.fechar();
    dispatch({ tipo: "espaco", secao: volta.secao, lista: true });
    document.querySelector<HTMLElement>(volta.foco)?.focus();
  },
  // definido em 2026-09-25 (jornadas de conexão): "Conectar" abre o login NA HORA — no card do chat, no
  // cartão do marketplace, na gaveta, no painel do bot e no card da rotina — e a web espera sozinha
  // (web/lib/conexao.ts). Sem "Verificar conexão" e sem ir ao marketplace no meio de uma conversa.
  "conectar-app": (el) => iniciarConexao(el.dataset.id ?? ""),
  "abrir-conexao": (el) => iniciarConexao(el.dataset.id ?? ""),
  "cancelar-conexao": (el) => conexoes.cancelar(el.dataset.id ?? ""),
  "abrir-app": (el) => {
    const t = estado.tela;
    if (t.tipo === "conectores") navegar({ ...t, gaveta: { slug: el.dataset.id ?? "", passo: "detalhes" } });
  },
  "fechar-gaveta": () => {
    const t = estado.tela;
    if (t.tipo === "conectores") { const { gaveta: _g, ...resto } = t; navegar(resto); }
  },
  "filtro-marketplace": (el) => {
    const t = estado.tela;
    const f = el.dataset.id;
    if (t.tipo === "conectores" && (f === "todos" || f === "conectados" || f === "atencao")) navegar({ ...t, filtro: f });
  },
  "recolher-secao": (el) => {
    // Buscando, o título é só texto (navegacao.css): a escolha gravada não muda às cegas.
    if (document.getElementById("sidebar")?.hasAttribute("data-buscando")) return;
    const chave = el.dataset.chave ?? "";
    const comFoco = document.activeElement === el;
    secoesRecolhidas = definirSecaoRecolhida(secoesRecolhidas, chave, !secoesRecolhidas.has(chave));
    render();
    // A barra é refeita: quem recolheu pelo teclado continua no mesmo título.
    if (comFoco) document.querySelector<HTMLElement>(`#sidebar .secao-cab[data-chave="${CSS.escape(chave)}"]`)?.focus({ preventScroll: true });
  },
  "recolher-time": (el) => {
    if (document.getElementById("sidebar")?.hasAttribute("data-buscando")) return;
    const id = el.dataset.time;
    if (!id) return;
    const agora = performance.now();
    const duplo = ehCliqueDuplo(ultimoCliqueNoTime, id, agora);
    ultimoCliqueNoTime = duplo ? null : { id, em: agora };
    // O segundo clique desfaz o recolher do primeiro (o PATCH nem sai: espera o estado final) e abre o nome.
    recolherTime(id);
    if (duplo) acaoDoTime(id, "renomear");
  },
  "menu-time": (el) => { if (el.dataset.time) abrirMenuDoTime(el.dataset.time, el); },
  "novo-time": () => comecarEdicaoDoTime("novo", ""),
  "mudar-time-selecao": (el) => abrirEscolhaDeTime([...selecaoBots], el),
  "limpar-selecao": () => limparSelecao(true),
  "abrir-avancado": () => abrirMarketplace(true),
  "navegar-marketplace": () => abrirMarketplace(),
  // ADA-13 (ADR-150): o app Canvas (instalar, desinstalar e o nível por bot; só pela tela).
  "instalar-canvas": () => agir(async () => { guardarAppCanvas(await api!.instalarCanvas()); }),
  "desinstalar-canvas": () => agir(async () => {
    if (!window.confirm("Desinstalar o Canvas? Os bots perdem o acesso e a página some da pílula. Os canvas e os comentários ficam guardados.")) return;
    guardarAppCanvas(await api!.desinstalarCanvas());
  }),
  "nivel-canvas": (el) => agir(async () => {
    const n = el.dataset.nivel;
    if (n !== "nenhum" && n !== "ver_comentar" && n !== "criar_publicar") return;
    guardarAppCanvas(await api!.acessoCanvas(el.dataset.id ?? "", n === "nenhum" ? null : n));
  }),
  // ADA-241 (ADR-158): o nível aparece na hora (camada otimista, web/lib/acessos-otimistas.ts) e não trava a tela com
  // "ocupado": o clique seguinte (o mesmo bot ou outro) já sai. Erro: o par volta ao que o servidor diz, com aviso.
  "nivel-bot": (el) => {
    const agenteId = el.dataset.id ?? "";
    const conectorId = el.dataset.conector ?? "";
    const nivel = el.dataset.nivel;
    if (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita") return;
    void mudarNivelOtimista([{ agenteId, conectorId }], nivel, () => api!.definirNivel(agenteId, conectorId, nivel));
  },
  "selecionar-acesso": (el) => { gavetaDeAcessos.alternar(el.dataset.conector ?? "", el.dataset.id ?? ""); render(); },
  "selecionar-todos-acessos": (el) => { gavetaDeAcessos.alternarTodos(el.dataset.conector ?? "", meusBots(estado).map((a) => a.id)); render(); },
  "lote-acesso": (el) => {
    const conectorId = el.dataset.conector ?? "";
    const nivel = el.dataset.nivel;
    if (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita") return;
    const sel = [...gavetaDeAcessos.selecao(conectorId)].filter((id) => meusBots(estado).some((a) => a.id === id));
    const bots: "todos" | string[] = sel.length ? sel : "todos";
    if (loteDeEscritaPedeConfirmacao(nivel, bots, meusBots(estado).length)) { gavetaDeAcessos.pedirConfirmacao({ conectorId, alvo: "lote", bots }); render(); focarConfirmacao(); return; }
    void aplicarLoteDeAcessos(conectorId, nivel, bots, nivel === "escrita");
  },
  "padrao-app": (el) => {
    const conectorId = el.dataset.conector ?? "";
    const nivel = el.dataset.nivel;
    if (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita") return;
    if (nivel === "escrita") { gavetaDeAcessos.pedirConfirmacao({ conectorId, alvo: "padrao", bots: "todos" }); render(); focarConfirmacao(); return; }
    void definirPadraoDoApp(conectorId, nivel, false);
  },
  "confirmar-escrita": (el) => {
    const c = gavetaDeAcessos.confirmacao();
    gavetaDeAcessos.pedirConfirmacao(null);
    if (!c || c.conectorId !== (el.dataset.conector ?? "")) { render(); return; }
    if (c.alvo === "padrao") void definirPadraoDoApp(c.conectorId, "escrita", true);
    else void aplicarLoteDeAcessos(c.conectorId, "escrita", c.bots, true);
  },
  "cancelar-escrita": () => { gavetaDeAcessos.pedirConfirmacao(null); render(); },
  "desconectar-app": (el) => agir(async () => {
    await api!.habilitarConector(el.dataset.id ?? "", false);
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  // definido em 2026-09-25: Permitir leva só os grupos marcados no card (card-acesso.ts); sem grupos, tudo o que foi pedido.
  "permitir-acesso": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    const card = el.closest<HTMLElement>("[data-decisao]");
    const grupos = [...(card?.querySelectorAll<HTMLInputElement>("input[data-caps]") ?? [])];
    const capacidades = grupos.filter((g) => g.checked).flatMap((g) => (g.dataset.caps ?? "").split(",").filter(Boolean));
    if (grupos.length > 0 && capacidades.length === 0) { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Marque pelo menos um grupo para permitir." } }); return; }
    // Chat limpo (PR 4): o consentimento leva o id desta decisão; o cartão "Acesso permitido" recebe o foco e o anúncio.
    marcarDecidida(el, id);
    await api!.decidir(id, grupos.length > 0 ? { capacidades } : {});
    dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", "conectores", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "dar-acesso": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "dar-acesso" }),
  // definido em 2026-10-05: o cartão que oferece liberar apps recém-conectados (card-liberar.ts). Permitir leva os apps
  // marcados com o nível do seletor de cada um; o servidor concede pela rota de pessoa e chama o bot de volta.
  "liberar-apps": (el) => agir(async () => {
    const agenteId = el.dataset.id ?? "";
    const escolhas = escolhasDoCardLiberar(el.closest<HTMLElement>("[data-liberar]"));
    if (escolhas.length === 0) { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Marque pelo menos um app para permitir." } }); return; }
    await api!.liberarApps(agenteId, escolhas.map((e) => ({ conectorId: e.conectorId, nivel: e.nivel })));
    dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`, "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  // "Agora não": a dispensa fica no servidor (0054) e sobrevive a recarregar; o cartão sai quando as concessões voltam.
  "dispensar-liberar": (el) => agir(async () => {
    const agenteId = el.dataset.id ?? "";
    await api!.dispensarLiberacao(agenteId, (el.dataset.conectores ?? "").split(",").filter(Boolean));
    dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`] });
  }),
  // definido em 2026-09-25: a rotina que lê um app ainda desconectado — um botão conecta e, quando o login
  // termina, cria a rotina (o confirmar concede o que ela declarou, conceder-acessos-da-rotina.ts).
  "conectar-e-confirmar": (el) => {
    const slug = el.dataset.id ?? "";
    const propostaId = el.dataset.proposta ?? "";
    const ato = el.dataset.ato;
    marcarDecidida(el, propostaId);
    iniciarConexao(slug, async () => {
      const r = await api!.conectores();
      dispatch({ tipo: "hidratar-conectores", conectores: r.conectores, marketplace: r.marketplace, composioConfigurado: r.composioConfigurado });
      // A proposta ainda tem de estar à vista e pendente: sumiu (decidida, recusada, de outra sessão), nada é confirmado.
      const proposta = propostaDoEstado(propostaId);
      if (!proposta || proposta.estado !== "pendente" || appsQueFaltam(proposta, estado).length > 0) return;
      await agir(async () => {
        if (ato === "decidir-proposta") await api!.decidir(propostaId, {});
        else await api!.confirmarProposta(propostaId);
        dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
      });
    });
  },
  "voltar-conexao": () => {
    const t = estado.tela;
    if (t.tipo === "conectores" && t.voltar) navegar(t.voltar);
    else navegar({ tipo: "inicio" });
  },
  // NOD-383: no celular, segurar o + pergunta antes ("Criar um bot agora?"); só Criar chama o criarAgente.
  // O toque explícito em "Criar novo bot" (Nova conversa) cria direto.
  "criar-rapido": () => criarBotAgora(),
  // NOD-383: segurar o + do topo. No celular o toque longo sai sem querer: pergunta antes; no desktop cria direto.
  "segurar-mais": () => void criarRapido(celular.ativo(), () => confirmarCriarBot(LOGO_NOD), criarBotAgora),
  "escolher-missao": (el) => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { escreverNoCampo(ta, el.dataset.texto ?? ""); return enviarComposer(); }
  },
  // NOD-56: a captura da tela do bot ao fim do turno, ampliada sobre a conversa.
  "ampliar-captura": (el) => { abrirCapturaAmpliada(el); },
  // NOD-327: o card de CSV/PDF abre a prévia num modal claro sobre a conversa.
  "previa-arquivo": (el) => { abrirPreviaArquivo(el); },
  // NOD-96 (v2): Abrir leva à tela cheia em Assistindo (no pedido de ajuda, já no controle). Sem v2, o diálogo de antes.
  // ADA-13: o card do canvas no chat abre a página Canvas do bot, já nesse canvas.
  "abrir-canvas": (el) => {
    if (!el.dataset.id) return;
    canvasNaTela.querAbrir(el.dataset.id);
    quadroNaTela.abrirPagina("canvas");
  },
  "abrir-computador": (el) => {
    const a = botGerido(el.dataset.id);
    if (!a || !api || a.ownerId !== estado.sessao?.pessoaId) return;
    const sessao = api;
    if (!estado.computadorPessoa) return abrirComputador(sessao, a, { assumir: el.dataset.assumir === "1", dev: () => estado.modoDev.ligado, aoFechar: render });
    abrirTelaCheia(sessao, a, { assumir: el.dataset.assumir === "1", pedido: el.dataset.pedido ?? null, aoMudar: () => void lerComputadorAgora(), antigo: estado.modoDev.ligado ? () => abrirComputador(sessao, a, { assumir: false, dev: () => estado.modoDev.ligado }) : null });
  },
  // NOD-96 (v2): as operações do computador da pessoa. Redefinir, Sair de todos e Esquecer senhas pedem confirmação; o resto vai direto.
  "operar-computador": (el) => {
    const op = el.dataset.op as OperacaoPessoa | undefined;
    if (!op || !OPERACOES_PESSOA.includes(op)) return;
    if (op === "redefinir" || op === "sair_de_todos" || op === "esquecer_senhas") { dispatch({ tipo: "computador-ui", ui: { confirmar: op } }); focarNovo(); return; }
    return operarComputador(op);
  },
  "pc-confirmar": (el) => {
    const op = el.dataset.op;
    if (op !== "redefinir" && op !== "sair_de_todos" && op !== "esquecer_senhas") return;
    return operarComputador(op);
  },
  "pc-cancelar": () => {
    const op = estado.computadorUi.confirmar;
    const lugar = estado.computadorUi.trocarPara;
    dispatch({ tipo: "computador-ui", ui: { confirmar: null, trocarPara: null } });
    if (op) document.querySelector<HTMLElement>(`#espaco [data-pc-acao="${op}"] button`)?.focus();
    else if (lugar) document.querySelector<HTMLElement>(`#espaco [data-pc-lugar="${CSS.escape(lugar)}"] button`)?.focus();
  },
  // NOD-365: onde o computador mora. Mudar pede confirmação; a origem sem contato recusa e oferece "Trocar sem os logins".
  "pc-trocar": (el) => { dispatch({ tipo: "computador-ui", ui: { trocarPara: el.dataset.maquina ?? null, recusaDaTroca: null } }); focarNovo(); },
  "pc-trocar-confirmar": (el) => trocarLugarDoComputador(el.dataset.maquina ?? "", false),
  "pc-trocar-sem-logins": (el) => trocarLugarDoComputador(el.dataset.maquina ?? "", true),
  "ver-lugar-do-computador": () => {
    abrirEspaco("computador-do-bot");
    document.querySelector<HTMLElement>("#espaco #pc-lugar-tit")?.scrollIntoView({ block: "start" });
  },
  "pc-segundo-plano": () => dispatch({ tipo: "computador-ui", ui: { etapasAbertas: false, preparoAberto: false } }),
  // NOD-93 (ADR-127): o download pausado da VM local retoma já (o app decide; sem a VM ou app antigo, não faz nada).
  "vm-tentar-agora": () => { void window.nodDesktop?.vmTentarAgora?.().catch(() => undefined); },
  // O link do erro (e o "ver telas" da espera) abre o painel; do erro, com a ação sugerida marcada e com o foco nela.
  "ver-computador-do-bot": (el) => {
    const realce = (el.dataset.realce as OperacaoPessoa | undefined) ?? null;
    dispatch({ tipo: "computador-ui", ui: { realce } });
    abrirEspaco("computador-do-bot");
    if (realce) document.querySelector<HTMLElement>(`#espaco [data-pc-acao="${realce}"] button`)?.focus();
  },
  "entendi-computador": () => {
    try { localStorage.setItem(CHAVE_AVISO_RECRIADO, "1"); } catch { /* sem storage: a faixa volta na próxima visita */ }
    render();
  },
  // NOD-97: "Terminei" no cartão do pedido de tela (a pessoa fechou a tela com a ajuda aberta) devolve ao bot, como o Parar.
  "terminei-computador": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    await api!.configurarComputador(id, "devolver");
    marcarTelaFechadaNaAjuda(id, null);
    render();
  }),
  // definido em 2026-09-24 (emenda da ADR-037): "Tentar de novo" é o mesmo ligar do computador; falhou, a
  // frota relê e o cartão continua dizendo o motivo.
  "religar-computador": (el) => ligarComputador(el.dataset.id ?? "", "religar"),
  // ADR-125: Acordar, na aba Computador, é o mesmo ligar; o pulso seguinte lê o estado novo.
  "computador-acordar": (el) => ligarComputador(el.dataset.id ?? "", "acordar"),
  // ADR-125 (NOD-349): o topo da gaveta, as abas e o popover do avatar.
  "gaveta-compartilhar": (el) => { const a = botGerido(el.dataset.id); if (a) abrirMenuCompartilhar(a, el, (acao) => acaoDoBot(a, acao)); },
  "gaveta-aba": (el) => escolherAba(el.dataset.id ?? "", el.dataset.aba ?? ""),
  // NOD-326: a aba Biblioteca.
  "biblioteca-mais": (el) => void mostrarMaisNaBiblioteca(el.dataset.id ?? "", el.dataset.grupo ?? ""),
  "biblioteca-tentar": (el) => dispatch({ tipo: "biblioteca-tentar", conversaId: el.dataset.id ?? "" }),
  "biblioteca-menu": (el) => abrirMenuDaBiblioteca(el),
  "gaveta-avatar": (el) => {
    const a = estado.frota?.agentes.find((b) => b.id === el.dataset.id);
    if (!a) return;
    if (estado.avatarAberto?.agenteId === a.id) { fecharPopoverAvatar(); return; }
    dispatch({ tipo: "avatar-popover", aberto: { agenteId: a.id, forma: a.forma, cor: a.cor } });
    document.querySelector<HTMLElement>('#detalhes .gvn-formas [aria-checked="true"]')?.focus();
  },
  "gaveta-forma": (el) => mudarAvatar(el.dataset.id ?? "", { forma: el.dataset.valor as FormaAgente }, el),
  "gaveta-cor": (el) => mudarAvatar(el.dataset.id ?? "", { cor: el.dataset.valor as CorAgente }, el),
  "gaveta-redefinir": (el) => {
    const ab = estado.avatarAberto;
    if (ab && ab.agenteId === el.dataset.id) mudarAvatar(ab.agenteId, { forma: ab.forma, cor: ab.cor }, el);
  },
  "abrir-workspace": (el) => { const a = botGerido(el.dataset.id); const c = conversaAtual(); if (a && api && a.ownerId === estado.sessao?.pessoaId && c && !c.salaId) abrirWorkspace(api, c.conversaId); },
  // Um clique: autoriza a pasta proposta e a tarefa retoma sozinha, sem a pessoa remandar a mensagem.
  // definido em 2026-09-25 (card de pasta simplificado): com a lista aberta, a pasta é a opção marcada. O
  // segundo clique enquanto o primeiro corre é ignorado: com a lista, ele podia conceder OUTRA pasta.
  "permitir-pasta": (el) => estado.ocupado ? undefined : agir(async () => {
    const alvo = conversaAtual();
    const pasta = el.dataset.pasta ?? el.closest("[data-proposta]")?.querySelector<HTMLInputElement>("input[data-pasta-de]:checked")?.value;
    if (!alvo || alvo.salaId || !pasta) return;
    marcarDecidida(el, el.dataset.id);
    await api!.permitirPasta(el.dataset.id ?? "", pasta);
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
  }),
  // A re-renderização troca o botão clicado: o foco vai para a opção marcada (ao abrir a lista) ou para a
  // primeira que "Mostrar mais" revelou, para o teclado e o leitor de tela não caírem no começo da página.
  "lista-de-pasta": (el) => {
    const id = el.dataset.id;
    if (!id) return;
    const todas = el.dataset.lista === "todas";
    dispatch({ tipo: "lista-de-pasta", propostaId: id, lista: todas ? "todas" : "curta" });
    const card = document.querySelector(`[data-proposta="${CSS.escape(id)}"]`);
    const alvo = todas ? card?.querySelectorAll<HTMLElement>("input[data-pasta-de]")[CURTA] : card?.querySelector<HTMLElement>("input[data-pasta-de]:checked");
    alvo?.focus({ preventScroll: true });
  },
  // ADA-5 (revisão 2): o clipe da pílula do Quadro é a mesma ação; abre o seletor da pílula.
  anexar: (el) => {
    document.querySelector<HTMLInputElement>(seletorDoClipe(el))?.click();
  },
  ditar: () => ditado.comecar(),
  "ditado-parar": () => ditado.concluir("campo"),
  "remover-anexo": (el) => removerAnexo(el.dataset.id ?? ""),
  "abrir-busca": () => abrirBusca(),
  "abrir-bots": () => celular.voltarAoInicio(),
  "abrir-recentes": () => abrirRecentes(document.querySelector<HTMLElement>("#cabecalho .voltar-bots")),
  "fechar-recentes": () => sairDasRecentes(),
  "abrir-recente": (el) => {
    const conversaId = el.dataset.conversa ?? "", agenteId = el.dataset.agente ?? "";
    const fica = ficaAoEscolherRecente(conversaId, estado.tela.tipo === "conversa" ? estado.tela.conversaId : null);
    if (fica) { sairDasRecentes(true); return; }
    sairDasRecentes(false, () => navegar({ tipo: "conversa", conversaId, agenteId }));
  },
  // ADA-19: as abas da inicial do celular (tocar na ativa rola ao topo), os Tentar de novo delas e as linhas.
  "aba-do-inicio": (el) => { if (ehAba(el.dataset.aba)) trocarAbaDoInicio(el.dataset.aba); },
  "tentar-sua-vez": () => { suaVezFalhou = false; render(); dispatch({ tipo: "invalidar", quais: ["sua-vez"] }); },
  "tentar-quadros": () => { quadrosDaAba = { tipo: "carregando" }; render(); void lerQuadrosDaAba(true); },
  // Tocar num pedido abre a conversa já no pedido (o mesmo atalho do aviso: web/main.ts verPerguntaNaConversa).
  // ADA-19: pedido na conversa de outra pessoa (a decisora não a lê): abre a fila de Sua vez, onde ela decide.
  "abrir-pedido-na-fila": () => navegar({ tipo: "sua-vez" }, { filaDeSuaVez: true }),
  // O id vai em data-decisao-id, não data-decisao: o atalho procura [data-decisao] no documento todo e a barra (com a
  // linha da aba, escondida atrás da conversa) vem antes da timeline — ele rolaria até a linha, não até o pedido.
  "abrir-pedido": (el) => verPerguntaNaConversa(el.dataset.conversa ?? "", el.dataset.agente ?? "", el.dataset.decisaoId ?? ""),
  // Tocar num quadro abre a conversa do bot na página do quadro (ADA-8/ADR-146: o quadro em si é o de hoje).
  "abrir-quadro-do-bot": (el) => {
    const bot = botGerido(el.dataset.agente ?? "");
    if (!bot) { dispatch({ tipo: "erro", erro: { codigo: "quadro_sem_bot", mensagem: "Esse bot não está mais na sua frota." } }); return; }
    navegar({ tipo: "conversa", conversaId: bot.conversaId, agenteId: bot.id });
    // As páginas da pílula podem não ter chegado: o pedido espera por elas (o trocar seria desfeito quando chegassem).
    quadroNaTela.abrirPagina("tarefas");
  },
  // NOD-379: a inicial do celular — reler a frota que falhou e abrir os favoritos além dos 8.
  "tentar-frota": () => {
    void tentarFrotaAgora<Acao>({
      buscar: buscarFrota,
      aplicar: (a) => dispatch(a),
      tirarDaFila: () => pendentesDeRede.delete("frota"),
      voltarParaFila: () => { pendentesDeRede.add("frota"); sonda.lembrar(); },
      ehRede: (e) => { const erro = erroDe(e); return !!erro && ehErroDeRede(erro); },
      redesenhar: render,
    });
  },
  "ver-favoritos": () => { favoritosTodos = !favoritosTodos; render(); },
  // O botão some ao ser usado: o foco vai para o campo, e não para o <body>.
  "rolar-para-novas": () => {
    rolagem.irParaNovas();
    document.getElementById("composer-texto")?.focus({ preventScroll: true });
  },
  "alternar-detalhes": () => {
    const app = document.querySelector(".app");
    if (!app) return;
    // Estreita, o painel é sobreposto e abre/fecha a cada vez; larga, esconder é preferência que fica.
    // ADR-114: o painel que aparece pede o "N hoje" da Atividade (relevante só com ele à vista).
    // NOD-382: no celular a pílula abre o perfil do bot (e o ‹ dele volta ao chat).
    if (ehCelular()) {
      const t = estado.tela;
      if (app.classList.contains("detalhes-abertos")) fecharPerfil();
      else if (t.tipo === "conversa") abrirPerfil(t.agenteId, "chat");
      return;
    }
    if (window.matchMedia("(max-width: 1099px)").matches) { app.classList.toggle("detalhes-abertos"); marcarPainelNaPilula(); void reidratar(); return; }
    const oculto = !app.classList.contains("detalhes-ocultos");
    app.classList.toggle("detalhes-ocultos", oculto);
    painelAberto = !oculto;
    painelAbertoNaHora = false;
    marcarPainelNaPilula();
    void reidratar();
    try { localStorage.setItem(CHAVE_PAINEL_ABERTO, oculto ? "0" : "1"); } catch { /* sem storage, vale só nesta aba */ }
  },
  // NOD-444: o "+ Nova" das Rotinas leva à conversa do bot com a frase começada; nada é enviado, rascunho nunca se perde.
  "rotina-no-chat": (el) => rotinaNoChat(el.dataset.agente ?? ""),
  "usar-sugestao-rotina": () => {
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    mostrarSugestaoRotina(false);
    frasePedeAssuntoNovo();
    if (ta) escreverNaCaixa(ta, juntarSugestao(ta.value));
  },
  "preencher-prompt": (el) => {
    // NOD-382: no celular o perfil cobre o chat; "Ajustar" fecha o perfil para o campo aparecer.
    if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);
    const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
    if (ta) { escreverNoCampo(ta, el.dataset.texto ?? ""); ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; if (composerDe) rascunhos.guardar(composerDe, ta.value); }
  },
  // definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): o que é do bot abre DENTRO da gaveta, com ‹ para voltar.
  gaveta: (el) => {
    const nivel = nivelDaGaveta(el.dataset.nivel, el.dataset.id ?? "");
    if (nivel) abrirNivel(el.dataset.agente ?? "", nivel);
  },
  "gaveta-voltar": () => voltarNivel(),
  // NOD-20: o histórico de versões do perfil (web/telas/historico-perfil.ts).
  "historico-recarregar": (el) => carregarHistorico(el.dataset.agente ?? ""),
  "historico-mais": (el) => carregarHistorico(el.dataset.agente ?? "", true),
  "versao-recarregar": (el) => carregarVersao(el.dataset.agente ?? "", Number(el.dataset.versao)),
  "restaurar-versao-pedir": (el) => {
    mudarHistorico(el.dataset.agente ?? "", { confirmando: Number(el.dataset.versao), erroRestaurar: false });
    document.querySelector<HTMLElement>('#detalhes [data-act="restaurar-versao-cancelar"]')?.focus();
  },
  "restaurar-versao-cancelar": (el) => {
    mudarHistorico(el.dataset.agente ?? "", { confirmando: null, erroRestaurar: false });
    document.querySelector<HTMLElement>('#detalhes [data-act="restaurar-versao-pedir"]')?.focus();
  },
  "restaurar-versao": (el) => restaurarVersao(el.dataset.agente ?? "", Number(el.dataset.versao), null),
  "desfazer-versao": (el) => {
    const agenteId = el.dataset.agente ?? "";
    const d = historicoDe(agenteId).desfazer;
    if (!d || d.versao !== Number(el.dataset.versao) || !api) return;
    // O servidor confere que o perfil ainda está na versão que o salvar criou (`esperada`); se mudou depois (uma proposta
    // confirmada, a voz numa ligação, o Nod pelo chat), voltar desfaria isso também: responde perfil_mudou.
    return agir(() => restaurarVersao(agenteId, d.versao, d));
  },
  // NOD-382: o perfil do bot no celular (web/telas/perfil-celular.ts).
  "perfil-voltar": () => fecharPerfil(),
  "perfil-mensagem": () => fecharPerfil("chat"),
  "perfil-compartilhar": (el) => { const a = botGerido(el.dataset.id); if (a) abrirFolhaCompartilhar(a, (acao) => acaoDoBot(a, acao)); },
  "perfil-excluir": (el) => { const a = botGerido(el.dataset.id); if (a) excluirNoCelular(a); },
  "perfil-ocultar": (el) => {
    // O bot oculto sai da frota (GET /frota não o traz): ocultar fecha o perfil e volta à lista, com o aviso e o foco do
    // desktop (depoisDeTirarDaLista). Trazer de volta é por Configurações › Agentes › Ocultos, como no desktop.
    const a = botGerido(el.dataset.id);
    if (!a || a.oculto || a.papel === "nod" || a.ownerId !== estado.sessao?.pessoaId) return;
    el.setAttribute("aria-checked", "true");
    el.setAttribute("disabled", "");
    const perfil = estado.perfilCelular?.agenteId === a.id ? estado.perfilCelular : null;
    const marca = marcaDoPerfil.marca();
    void agir(async () => {
      try { await mudarGestao(() => api!.ocultar(a.id, true)); } catch (erro) { el.setAttribute("aria-checked", "false"); el.removeAttribute("disabled"); throw erro; }
      sairDoPerfilDoBotQueSaiu(a, perfil, marca);
      depoisDeTirarDaLista(a, "Ocultos")(false);
    });
  },
  "perfil-copiar-pasta": (el) => {
    const caminho = el.dataset.caminho ?? "";
    if (!caminho) return;
    const copiado = (): void => {
      const v = el.querySelector(".pfc-valor");
      const antes = v?.textContent ?? "";
      if (v) { v.textContent = "Copiado"; window.setTimeout(() => { if (v.isConnected && v.textContent === "Copiado") v.textContent = antes; }, 1500); }
      anunciar("Caminho copiado");
    };
    const manual = (): void => pedirGestao("Caminho da pasta", `<p>Selecione e copie o caminho abaixo.</p><input aria-label="Caminho da pasta" readonly value="${esc(caminho)}" />`, "Concluir", async () => {});
    if (!navigator.clipboard) { manual(); return; }
    void navigator.clipboard.writeText(caminho).then(copiado, manual);
  },
  // Sem rotinas carregadas, o dispatch já relê (invalidacoesDaTela): basta voltar ao carregando.
  "perfil-tentar-rotinas": () => { dispatch({ tipo: "rotinas-tentando" }); dispatch({ tipo: "invalidar", quais: ["rotinas"] }); },
  "perfil-editar": (el) => {
    const campo = document.querySelector<HTMLInputElement>(`#detalhes input[data-campo="${CSS.escape(el.dataset.campo ?? "")}"][data-id="${CSS.escape(el.dataset.id ?? "")}"]`);
    campo?.focus();
    campo?.select();
  },
  // ADR-114 (chat limpo, PR 2): os filtros, a troca de dia e a mensagem aberta (texto inteiro + Relatar) da Atividade.
  "atividade-filtro": (el) => {
    const filtro = el.dataset.filtro;
    if (ehFiltroAtividade(filtro)) dispatch({ tipo: "atividade-vista", mudanca: { filtro } });
    document.querySelector<HTMLElement>(`#detalhes [data-act="atividade-filtro"][data-filtro="${CSS.escape(filtro ?? "")}"]`)?.focus({ preventScroll: true });
  },
  "atividade-dia": (el) => {
    const dia = el.dataset.dia ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return;
    dispatch({ tipo: "atividade-vista", mudanca: { dia, aberta: null } });
    document.querySelector<HTMLElement>("#detalhes .atv-dia-titulo")?.focus({ preventScroll: false });
  },
  "atividade-abrir": (el) => {
    const id = el.dataset.id ?? "";
    dispatch({ tipo: "atividade-vista", mudanca: { aberta: estado.atividadeVista?.aberta === id ? null : id } });
    document.querySelector<HTMLElement>(`#detalhes [data-act="atividade-abrir"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  },
  // NOD-70: a aba Decisões (filtros, decisão aberta, Carregar mais, dia, Ver tudo) e o Exportar CSV.
  "atividade-aba": (el) => {
    const aba = el.dataset.aba === "decisoes" ? "decisoes" : "atividade";
    dispatch({ tipo: "atividade-vista", mudanca: { aba, decisao: null, exportar: null } });
    document.querySelector<HTMLElement>(`#detalhes [data-act="atividade-aba"][data-aba="${aba}"]`)?.focus({ preventScroll: true });
  },
  "decisoes-filtro": (el) => {
    const desfecho = el.dataset.filtro;
    const v = estado.atividadeVista;
    if (!v || !ehFiltroDecisoes(desfecho)) return;
    dispatch({ tipo: "atividade-vista", mudanca: { desfecho, decisao: null, exportar: null } });
    document.querySelector<HTMLElement>(`#detalhes [data-act="decisoes-filtro"][data-filtro="${CSS.escape(desfecho)}"]`)?.focus({ preventScroll: true });
    // A contagem é do dia, igual em todos os filtros: qualquer página já lida do dia serve para anunciar.
    const lida = Object.entries(estado.decisoesDoBot).find(([k, p]) => k.startsWith(`${v.agenteId}:${v.dia}:`) && p && p !== "erro")?.[1];
    if (lida && lida !== "erro") anunciar(anuncioDoFiltro(desfecho, lida.contagem, rotuloDoDia(v.dia, diaLocal(Date.now()))));
  },
  "decisoes-ver-tudo": () => {
    dispatch({ tipo: "atividade-vista", mudanca: { desfecho: "tudo", decisao: null } });
    document.querySelector<HTMLElement>('#detalhes [data-act="decisoes-filtro"][data-filtro="tudo"]')?.focus({ preventScroll: true });
  },
  "decisoes-abrir": (el) => {
    const id = el.dataset.id ?? "";
    dispatch({ tipo: "atividade-vista", mudanca: { decisao: estado.atividadeVista?.decisao === id ? null : id } });
    document.querySelector<HTMLElement>(`#detalhes [data-act="decisoes-abrir"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  },
  "decisoes-dia": (el) => {
    const dia = el.dataset.dia ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > diaLocal(Date.now())) return;
    dispatch({ tipo: "atividade-vista", mudanca: { dia, decisao: null, exportar: null } });
    document.querySelector<HTMLElement>("#detalhes .atv-dia-titulo")?.focus({ preventScroll: false });
  },
  "decisoes-tentar": () => {
    const v = estado.atividadeVista;
    if (v) dispatch({ tipo: "esquecer-decisoes", chave: chaveDasDecisoes(v.agenteId, v.dia, v.desfecho) });
  },
  "decisoes-mais": () => void maisDecisoes(),
  // Da linha de negação na Atividade e do "N negadas" de Ajustes: as Decisões do dia, no filtro Negadas.
  "decisoes-negadas": (el) => {
    const agenteId = el.dataset.agente ?? estado.atividadeVista?.agenteId ?? "";
    const dia = el.dataset.dia ?? "";
    if (estado.gaveta?.nivel.tipo !== "atividade" || estado.atividadeVista?.agenteId !== agenteId) abrirNivel(agenteId, { tipo: "atividade" });
    if (estado.atividadeVista) dispatch({ tipo: "atividade-vista", mudanca: { aba: "decisoes", desfecho: "negada", decisao: null, exportar: null, ...(/^\d{4}-\d{2}-\d{2}$/.test(dia) ? { dia } : {}) } });
    focarQuandoAparecer('#detalhes [data-act="atividade-aba"][data-aba="decisoes"]', el);
  },
  "exportar-csv": () => {
    const v = estado.atividadeVista;
    if (!v) return;
    if (v.exportar && v.exportar.fase !== "baixado") {
      dispatch({ tipo: "atividade-vista", mudanca: { exportar: null } });
      document.querySelector<HTMLElement>('#detalhes [data-act="exportar-csv"]')?.focus({ preventScroll: true });
      return;
    }
    escolherPeriodoDoCsv(1);
  },
  "exportar-periodo": (el) => {
    const dias = Number(el.dataset.dias);
    if (ehPeriodoDoCsv(dias)) escolherPeriodoDoCsv(dias);
  },
  "baixar-csv": () => void baixarCsv(),
  // PR 6 dos modos de aprovação (tela Y3): "ver na Atividade" da linha embaixo da fala abre a Atividade do bot no dia da
  // ação, no filtro "Sem aprovação".
  // PR 4 dos modos de aprovação: "Devia ter perguntado" grava a contestação (não desfaz nada) e relê a página do dia.
  // QA do PR 4 (2026-10-26): o botão some na releitura e o foco caía no body sem nada dito; agora a região viva anuncia e o
  // foco vai para a marca "Você marcou…" quando ela aparece.
  "contestar-revisor": (el) => agir(async () => {
    const acaoId = el.dataset.id ?? "";
    await api!.contestarRevisor(acaoId);
    anunciar("Marcado: devia ter perguntado. Nada foi desfeito.");
    const vista = estado.atividadeVista;
    if (vista) dispatch({ tipo: "invalidar", quais: [`atividade:${chaveDaAtividade(vista.agenteId, vista.dia)}`] });
    focarQuandoAparecer(`.atv-contestada[data-acao="${CSS.escape(acaoId)}"]`, el);
  }),
  "ver-sem-aprovacao": (el) => {
    // PR 4: o "ver" da linha do revisor conta como aberta (TipoLinha "revisor"); o "ver na Atividade" do total não leva tipo.
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.aberta({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
    const dia = el.dataset.dia ?? "";
    abrirNivel(el.dataset.agente ?? "", { tipo: "atividade" });
    if (estado.atividadeVista) dispatch({ tipo: "atividade-vista", mudanca: { filtro: "sem_aprovacao", ...(/^\d{4}-\d{2}-\d{2}$/.test(dia) ? { dia } : {}) } });
  },
  // definido em 2026-09-24 (emenda da ADR-044): parada pelo pré-voo (`ids.bloqueada`), o teste não roda —
  // a conversa abre com o card de acesso "rotina parada" e o botão que a destrava; "Sua vez" relê.
  "executar-rotina": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    // NOD-272: com execução já aberta, pergunta antes no diálogo próprio (A1 do Gil no #335); cancelar não roda nada.
    const r = await executarRotinaComConfirmacao((o) => api!.executarRotina(id, o), (p) => abrirRodarMaisUma(p, el));
    if (!r) return;
    dispatch({ tipo: "invalidar", quais: ["rotinas", `execucoes:${el.dataset.id ?? ""}`, ...(r.ids.bloqueada ? (["sua-vez", `conversa:${r.ids.conversaId ?? ""}`] as const) : [])] });
    navegar({ tipo: "conversa", conversaId: r.ids.conversaId ?? "", agenteId: el.dataset.agente ?? "" });
  }),
  // NOD-84: o Copiar do endereço busca o inteiro na hora (só a dona; nunca fica no estado). ClipboardItem com a promessa
  // para o Safari não perder o gesto; sem ele, writeText. O ícone vira ✓ por 2 s e a região viva diz "Copiado".
  "webhook-copiar": (el) => copiarDoWebhook(el, async (id) => `${location.origin}${(await api!.enderecoWebhook(id)).caminho}`, "Endereço copiado"),
  "webhook-copiar-segredo": (el) => copiarDoWebhook(el, async (id) => (await api!.enderecoWebhook(id)).segredo, "Segredo copiado"),
  "webhook-gerar": (el) => alternarConfirmaWebhook(el, true),
  "webhook-gerar-cancelar": (el) => alternarConfirmaWebhook(el, false),
  "webhook-gerar-confirmar": (el) => agir(async () => {
    await api!.gerarEnderecoWebhook(el.dataset.id ?? "");
    anunciar("Endereço novo gerado. O antigo parou de valer; cole o novo no provedor.");
    dispatch({ tipo: "invalidar", quais: ["rotinas"] });
  }),
  // "Enviar teste": um turno de verdade com um payload de exemplo; abre a conversa para ver a resposta com a etiqueta teste.
  "webhook-testar": (el) => agir(async () => {
    const r = await api!.testarWebhook(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["rotinas", ...(r.ids.bloqueada ? (["sua-vez", `conversa:${r.ids.conversaId ?? ""}`] as const) : [])] });
    navegar({ tipo: "conversa", conversaId: r.ids.conversaId ?? "", agenteId: el.dataset.agente ?? "" });
  }),
  // NOD-430: o código da tarefa na resposta de um bot abre a conversa do dono do quadro, já na tarefa.
  "abrir-tarefa-quadro": (el) => {
    const agenteId = el.dataset.agente ?? "";
    const tarefaId = el.dataset.tarefa ?? "";
    const dono = botGerido(agenteId);
    if (!dono || !tarefaId) { dispatch({ tipo: "erro", erro: { codigo: "tarefa_sem_quadro", mensagem: "Esse bot não está mais na sua frota." } }); return; }
    quadroNaTela.abrirTarefaDe(agenteId, tarefaId);
    navegar({ tipo: "conversa", conversaId: dono.conversaId, agenteId });
  },
  // ADA-15: o "ver mensagem" da resposta que veio pelo chat abre a conversa com o bot e leva à fala da pessoa.
  "ver-fala-da-resposta": (el) => {
    const { agente = "", conversa = "", mensagem = "" } = el.dataset;
    if (!agente || !conversa || !mensagem) return;
    abrirMensagemAchada({ id: mensagem, conversaId: conversa, conversaTipo: "propria", agenteId: agente, salaId: null, autor: { tipo: "pessoa", id: "" }, em: "", trecho: "" });
  },
  // NOD-455: a linha de "Compartilhados com você" e o "Abrir no quadro" do aviso.
  "abrir-quadro-compartilhado": (el) => {
    const qid = el.dataset.quadro ?? "";
    if (!qid) return;
    if (document.documentElement.dataset.sobreposta && el.closest("#sidebar")) fecharBusca();
    if (estado.tela.tipo === "quadro-compartilhado" && estado.tela.quadroId === qid) { quadroCompartilhado.abrir(qid); return; }
    navegar({ tipo: "quadro-compartilhado", quadroId: qid });
  },
  // Jornada C: o aviso da barra leva ao card "Conectar uma IA neste computador" da conversa e põe o foco nele.
  "ir-card-sem-ia": (el) => {
    const conversaId = el.dataset.conversa ?? "";
    navegar({ tipo: "conversa", conversaId, agenteId: el.dataset.agente ?? "" });
    let tentativas = 0;
    const focar = (): void => {
      const card = document.getElementById(idDoCardSemIa(conversaId));
      if (card) { card.scrollIntoView({ block: "center" }); card.focus({ preventScroll: true }); return; }
      if (++tentativas < 20) window.setTimeout(focar, 50);
    };
    window.setTimeout(focar, 0);
  },
  "abrir-conversa": (el) => {
    // NOD-119: escolher um bot na barra aberta por cima (recolhida + busca) fecha a busca, para a barra voltar a recolher.
    if (document.documentElement.dataset.sobreposta && el.closest("#sidebar")) fecharBusca();
    navegar({ tipo: "conversa", conversaId: el.dataset.conversa ?? "", agenteId: el.dataset.agente ?? "" });
  },
  "marcar-lida": (el) => marcarComDesfazer(el.dataset.conversa ?? "", el.dataset.nome ?? ""),
  "marcar-tudo-lido": () => marcarTudoComDesfazer(),
  // NOD-449: o ✓ de uma linha já lida no card do chat devolve a conversa para Não lidos.
  "marcar-nao-lida-card": (el) => agir(async () => { await api!.marcarNaoLida(el.dataset.conversa ?? ""); dispatch({ tipo: "invalidar", quais: ["nao-lidos", "frota"] }); }),
  "desfazer-recibo-leitura": (el) => agir(async () => { await api!.desfazerRecibo(el.dataset.id ?? ""); invalidarLeitura(); }),
  "abrir-sala": (el) => navegar({ tipo: "sala", salaId: el.dataset.sala ?? "", conversaId: el.dataset.conversa ?? "" }),
  "menu-agente": (el) => menuDoBot(el),
  "inteligencia": (el) => abrirInteligencia(el.dataset.id),
  // ADR-059: o botão do campo (e a linha Aprovações do painel) abre os três modos.
  "modo-aprovacao": (el) => abrirModoAprovacao(el),
  // Plano "tela limpa" (2026-10-16, T6): o seletor de IA do campo.
  "seletor-ia": (el) => abrirSeletorIa(el),
  "abrir-mais": (el) => abrirFolhaMais(el),
  // Prévia da voz do bot (Editar perfil): toca a amostra do provedor das ligações.
  "ouvir-voz": (el) => {
    const tenant = estado.sessao?.tenantId;
    const voz = el.dataset.voz;
    if (!tenant || !voz) return;
    const vel = el.closest("form")?.querySelector<HTMLInputElement>('input[name="vozVelocidade"]:checked')?.value ?? "1";
    void new Audio(`/api/t/${encodeURIComponent(tenant)}/voz/amostra?voz=${encodeURIComponent(voz)}&velocidade=${encodeURIComponent(vel)}`).play().catch(() => undefined);
  },
  "restaurar-agente": (el) => agir(async () => { await mudarGestao(() => api!.restaurarAgente(el.dataset.id ?? "")); }),
  "ir-perfil": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "perfil" }),
  "ir-memoria": (el) => abrirNivel(el.dataset.id ?? "", { tipo: "memoria", ...(el.dataset.aba === "historico" ? { aba: "historico" as const } : {}) }),
  ...acoesDaMemoria,
  "fechar-erro": () => dispatch({ tipo: "erro", erro: null }),
  // Sem agir(): no navegador, o pedido de permissão precisa sair direto do clique.
  "alternar-avisos": () => canalAvisos.alternar(),
  // NOD-115: o redesenho vem do aoMudar do canal, quando a ponte devolve as preferências. A seção é refeita: quem
  // alternou pelo teclado continua no interruptor.
  "alternar-som": async (el) => {
    const comFoco = document.activeElement === el;
    await canalAvisos.alternarSom?.();
    if (comFoco) document.querySelector<HTMLElement>('[data-act="alternar-som"]')?.focus({ preventScroll: true });
  },
  "fechar-faixa": () => dispatch({ tipo: "faixa", faixa: null }),
  enviar: () => enviarComposer(),
  "sondar-inventario": () => agir(async () => dispatch({ tipo: "hidratar-inventario", inventario: await api!.inventario(true) })),
  "trocar-executor": (el) =>
    agir(async () => {
      const estadoNovo = await api!.trocarExecutor(el.dataset.id === "codex-cli" ? "codex-cli" : el.dataset.id === "claude-cli" ? "claude-cli" : "catcher");
      dispatch({ tipo: "hidratar-executor", executor: estadoNovo });
      dispatch({ tipo: "invalidar", quais: ["inventario", "frota"] });
    }),
  // revisto em 2026-10-22 (NOD-311, emenda da ADR-083): o Parar do chat para só o turno do chat; as frentes seguem (cada
  // uma tem o Parar dela, na pílula e na tela da task). Sem lista nem confirmação.
  "parar-conversa": () => agir(async () => {
    const alvo = conversaAtual();
    if (!alvo) return;
    dispatch({ tipo: "faixa", faixa: await api!.pararConversa(alvo.conversaId) });
    dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`, "frota", "trabalhos"] });
  }),
  // A tela da task (#195): Parar task para só ela; Fechar (ou Esc) volta para onde a pessoa estava.
  "abrir-trabalho": (el) => abrirTrabalho(el.dataset.id ?? ""),
  // Chat limpo (PR 7): "ver as 5" do progresso na fala abre no lugar, como a troca; a abertura conta para o gatilho da
  // ADR-099 ("detalhe das frentes aberto em mais de 30%"), no tipo `frentes`.
  "abrir-progresso": (el) => {
    if (el.closest("details")?.open) return;
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.aberta({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
  },
  // Chat limpo (PR 3): a troca abre no lugar (o <details> cuida disso); só a abertura conta na telemetria da ADR-083.
  "abrir-troca": (el) => {
    if (el.closest("details")?.open) return;
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.aberta({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
  },
  "abrir-linha": (el) => {
    const tipo = tipoLinha(el.dataset.linhaTipo);
    if (tipo) telemetria.aberta({ tipo, agenteId: el.dataset.agente ?? "", chaveLinha: el.dataset.linhaChave ?? "" });
    const trabalho = el.dataset.trabalho;
    if (trabalho) { abrirTrabalho(trabalho); return; }
    const t = telaDeOrigem();
    navegar({ tipo: "linha", conversaId: el.dataset.conversa ?? "", mensagens: (el.dataset.mensagens ?? "").split(",").filter(Boolean), titulo: el.dataset.titulo ?? "", voltar: t.tipo === "trabalho" || t.tipo === "linha" ? t.voltar : t, ...(tipo === "rotina" ? { rotina: true } : {}) });
  },
  "fechar-trabalho": () => fecharTask(),
  "parar-trabalho": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    await api!.pararTrabalho(id);
    dispatch({ tipo: "invalidar", quais: [`trabalho:${id}`, "trabalhos"] });
  }),
  "trabalho-depois": (el) => estado.ocupado ? undefined : agir(async () => {
    await api!.trabalhoDepois(el.dataset.id ?? "", el.dataset.depois ?? "");
    dispatch({ tipo: "invalidar", quais: ["trabalhos", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "trabalho-fazer-aqui": (el) => estado.ocupado ? undefined : agir(async () => {
    await api!.trabalhoFazerAqui(el.dataset.id ?? "");
    dispatch({ tipo: "invalidar", quais: ["trabalhos", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  // ADR-085: Seu espaço › Este Mac. Otimista: a tela muda já; se o servidor recusar, volta ao que estava.
  "uso-do-mac": (el) => {
    const uso = USOS.find((u) => u.id === el.dataset.uso)?.id;
    if (!uso || !api) return;
    const antes = estado.usoDoMac;
    const comFoco = document.activeElement === el;
    // A seção é refeita: quem escolheu pelo teclado continua na escolha (a de antes, se a gravação falhar).
    const focar = (u: string) => { if (comFoco) document.querySelector<HTMLElement>(`[data-act="uso-do-mac"][data-uso="${CSS.escape(u)}"]`)?.focus({ preventScroll: true }); };
    dispatch({ tipo: "uso-do-mac", uso });
    focar(uso);
    void api.gravarPreferencias({ usoDoMac: uso }).then(() => dispatch({ tipo: "invalidar", quais: ["trabalhos"] }), () => { dispatch({ tipo: "uso-do-mac", uso: antes }); focar(antes); });
  },
  // O status do topo da task abre e fecha o cartão do tempo (protótipo "Nod — tempo da task").
  "tempo-task": (el) => {
    const id = el.dataset.id ?? null;
    dispatch({ tipo: "tempo-task", id: id && estado.tempoTaskAberto !== id ? id : null });
  },
  // A pílula abre a faixa e a faixa recolhe na pílula. revisto em 2026-10-09: a escolha vale só enquanto a pessoa está na
  // conversa (o padrão ao entrar é a pílula; reducer.ts, `faixaAbertaAoNavegar`) — não vai mais para as preferências.
  "faixa-trabalhos": (el) => {
    const t = estado.tela;
    dispatch({ tipo: "faixa-trabalhos", agenteId: el.dataset.recolher === "1" || t.tipo !== "conversa" ? null : t.agenteId });
  },
  // Chat limpo (PR 8): a pílula do bot alarga e fecha no lugar; alargar conta para o gatilho da ADR-099 (tipo `frentes`).
  pilula: (el) => {
    const t = estado.tela;
    if (t.tipo !== "conversa") return;
    const abrir = el.dataset.recolher !== "1" && estado.faixaTrabalhosAberta !== t.agenteId;
    const chave = pilulaAtual?.telemetria;
    if (abrir && chave) telemetria.aberta({ tipo: "frentes", agenteId: t.agenteId, chaveLinha: chave });
    dispatch({ tipo: "faixa-trabalhos", agenteId: abrir ? t.agenteId : null });
  },
  "pilula-ver-na-conversa": () => verPilulaNaConversa(),
  "pilula-parar": () => pararPelaPilula(),
  "bot-trabalhos": (el) => {
    const id = el.dataset.agente ?? null;
    dispatch({ tipo: "bot-trabalhos", agenteId: id && estado.botAbertoEmTrabalhos !== id ? id : null });
  },
  // "Esperando você" leva à mensagem do bot com a pergunta (a decisão fica na conversa, nunca acima do campo).
  "ir-a-pergunta": (el) => irAoQueEsperaVoce(el.dataset.id ?? null),
  "filtro-trabalhos": (el) => {
    const f = el.dataset.id;
    if (f === "todos" || f === "voce" || f === "rotinas" || f === "bots") navegar({ tipo: "trabalhos", filtro: f });
  },
  "parar-sala": (el) =>
    agir(async () => {
      dispatch({ tipo: "faixa", faixa: await api!.pararSala(el.dataset.id ?? "") });
      const alvo = conversaAtual();
      if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
    }),
  "confirmar-proposta": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.confirmarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota", "rotinas", "sua-vez", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // definido em 2026-09-25: como em "permitir-pasta", o clique que chega com outro pedido correndo é ignorado.
  "recusar-proposta": (el) => estado.ocupado ? undefined : agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.recusarProposta(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  fixar: (el) => agir(async () => void (await api!.fixar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["frota"] }))),
  ocultar: (el) => { const a = botGerido(el.dataset.id); if (a) acaoDoBot(a, "ocultar"); },
  duplicar: (el) => { const a = botGerido(el.dataset.id); if (a) acaoDoBot(a, "duplicar"); },
  revogar: (el) => agir(async () => void (await api!.revogar(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: [`concessoes:${el.dataset.agente ?? ""}`, "frota"] }))),
  // definido em 2026-09-24 (ADR-045): "Entendi" no aviso de queda do Mac.
  // definido em 2026-09-24: Cancelar de UMA mensagem da fila. Fica 5 s em "Cancelando… Desfazer" só na
  // web; depois disso vai ao servidor. Desfazer antes do prazo não toca o servidor (nada a reenfileirar).
  "cancelar-turno": (el) => {
    const turnoId = el.dataset.id ?? "";
    if (!turnoId) return;
    dispatch({ tipo: "cancelando-turno", turnoId, agora: Date.now() });
    window.setTimeout(() => {
      if (!(turnoId in estado.cancelando)) return;
      void agir(async () => {
        try {
          await api!.cancelarTurno(turnoId);
        } finally {
          dispatch({ tipo: "desfazer-cancelamento", turnoId });
          const alvo = conversaAtual();
          if (alvo) dispatch({ tipo: "invalidar", quais: [`conversa:${alvo.conversaId}`] });
        }
      });
    }, CANCELAR_DESFAZER_MS);
  },
  "desfazer-cancelamento": (el) => dispatch({ tipo: "desfazer-cancelamento", turnoId: el.dataset.id ?? "" }),
  // Parte 1 do plano "o pensamento no chat": a fala pendente que falhou.
  "reenviar-pendente": (el) => reenviarPendente(el.dataset.conversa ?? "", el.dataset.id ?? ""),
  "descartar-pendente": (el) => dispatch({ tipo: "fala-pendente-sai", conversaId: el.dataset.conversa ?? "", idEnvio: el.dataset.id ?? "" }),
  "dispensar-incidente": (el) => agir(async () => void (await api!.dispensarIncidente(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // definido em 2026-09-24 (ADR-044): o grupo (app · nível) do painel sai inteiro, com um registro só.
  "revogar-acessos": (el) => agir(async () => void (await api!.revogarAcessos(el.dataset.agente ?? "", (el.dataset.ids ?? "").split(",").filter(Boolean)), dispatch({ tipo: "invalidar", quais: [`concessoes:${el.dataset.agente ?? ""}`, "frota"] }))),
  "pausar-rotina": (el) => agir(async () => void (await api!.pausarRotina(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["rotinas"] }))),
  "ativar-rotina": (el) => agir(async () => void (await api!.ativarRotina(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["rotinas"] }))),
  "ver-execucoes": (el) => {
    const id = el.dataset.id ?? "";
    const abrindo = !estado.historicoAberto[id];
    dispatch({ tipo: "alternar-historico", rotinaId: id });
    if (abrindo) dispatch({ tipo: "invalidar", quais: [`execucoes:${id}`] });
  },
  "sondar-conector": (el) => agir(async () => void (await api!.sondarConector(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["conectores", "frota"] }))),
  "habilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", true), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "desabilitar-conector": (el) => agir(async () => void (await api!.habilitarConector(el.dataset.id ?? "", false), dispatch({ tipo: "invalidar", quais: ["conectores"] }))),
  "decidir-aprovacao": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? "") }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  // ADR-042: aprova AGORA e grava a regra para as próximas vezes, no mesmo clique.
  // definido em 2026-09-28 (emenda da ADR-037): aprova este passo e libera o computador até o fim da tarefa.
  "decidir-aprovacao-resto": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? ""), restoDaTarefa: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  "decidir-aprovacao-sempre": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.decidir(el.dataset.id ?? "", { itens: marcacoesDe(el.dataset.id ?? ""), sempre: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] }))),
  // QA do PR 4 (2026-10-18): o cartão de um item não tem caixa de marcar e mandava `itens: []`, que aprova (web/lib/recusa-da-aprovacao.ts).
  "decidir-aprovacao-nenhum": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    const itens = itensDaRecusa(marcacoesDe(id), estado.suaVez?.itens.find((i) => i.decisao.id === id)?.itensAprovacao ?? []);
    if (!itens) {
      dispatch({ tipo: "erro", erro: { codigo: "estado_invalido", mensagem: "Não deu para recusar agora. Recarregue a página e tente de novo." } });
      return;
    }
    marcarDecidida(el, id);
    await api!.decidir(id, { itens });
    dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  }),
  // NOD-367: o filtro de Feedback mora em configUi (os envios abertos ficam em configUi.abertos e sobrevivem ao redesenho).
  "filtrar-relatos": (el) => {
    dispatch({ tipo: "config-ui", mudanca: { filtro: el.dataset.filtroTipo ?? "todos" } });
    document.querySelector<HTMLElement>(`#espaco [data-act="filtrar-relatos"][data-filtro-tipo="${CSS.escape(el.dataset.filtroTipo ?? "todos")}"]`)?.focus();
  },
  "recarregar-relatos": () => dispatch({ tipo: "hidratar-relatos", relatos: null, erro: false }),
  // NOD-367 (emenda da ADR-041): "Enviar feedback" não anexa conversa nenhuma; leva à conversa com o Nod, onde se conta
  // um bug, uma ideia ou uma dúvida sem mensagem de referência (0062).
  "enviar-feedback": () => {
    const nod = destinoDoFeedback(estado);
    if (!nod) return;
    fecharEspaco();
    navegar({ tipo: "conversa", conversaId: nod.conversaId, agenteId: nod.agenteId });
  },
  // ADR-082: o card do lote do Nod — manda os índices das ações que ficaram marcadas.
  "decidir-lote": (el) => agir(async () => {
    const card = el.closest<HTMLElement>("[data-proposta]");
    const selecionados = [...(card?.querySelectorAll<HTMLInputElement>("input[data-lote-i]") ?? [])].filter((c) => c.checked).map((c) => Number(c.dataset.loteI));
    marcarDecidida(el, el.dataset.id);
    await api!.decidir(el.dataset.id ?? "", { selecionados });
    dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", "gestao", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  // Revisão 6 do #626: o card do app que não vale mais volta 409 com o `motivo`; a frase dele sai no aviso neutro (o card
  // fechou como recusado e o recibo foi gravado, então a conversa relê do mesmo jeito). Outros cards não mandam motivo.
  "decidir-proposta": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await tentarNoApp(() => api!.decidir(el.dataset.id ?? "", {}).then(() => undefined), (texto) => void mostrarAvisoDesfazer({ texto }), "card"), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", "frota", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // NOD-50: o cartão de credencial. Mostrar troca o tipo do campo sem redesenhar (o valor fica onde está); a fase guarda
  // só o "mostrando", para o próximo frame não esconder o que a pessoa pediu para ver.
  "mostrar-credencial": (el) => {
    const id = el.dataset.id ?? "";
    const input = el.parentElement?.querySelector<HTMLInputElement>("input");
    if (!input) return;
    const mostrar = input.type === "password";
    input.type = mostrar ? "text" : "password";
    el.textContent = mostrar ? "Ocultar" : "Mostrar";
    el.setAttribute("aria-pressed", String(mostrar));
    marcarFase(id, { ...faseDoCartao(id), mostrando: mostrar });
  },
  "recusar-credencial": (el) => agir(async () => {
    const id = el.dataset.id ?? "";
    for (const campo of document.querySelectorAll<HTMLInputElement>(`[data-form="guardar-credencial"][data-id="${CSS.escape(id)}"] input[name="valor"]`)) campo.value = "";
    marcarFase(id, null);
    await api!.decidir(id, { recusar: true });
    dispatch({ tipo: "invalidar", quais: ["sua-vez", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
  }),
  "recusar-decisao": (el) => agir(async () => void (marcarDecidida(el, el.dataset.id), await api!.decidir(el.dataset.id ?? "", { recusar: true }), dispatch({ tipo: "invalidar", quais: ["sua-vez", "rotinas", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] }))),
  // definido em 2026-09-24 (emenda da ADR-045): a pergunta se responde pelo campo da conversa. Revisto em 2026-10-18
  // (plano "pergunta com botões"): estes são os gestos em volta do cartão e da caixa "Respondendo".
  "composer-outro": () => escolherNoComposer(true),
  // Plano "pergunta com botões" (Parte 3a, 2026-10-18): a caixa "Respondendo" passa à próxima pergunta aberta.
  "composer-trocar": () => {
    const alvo = conversaAtual();
    const proxima = alvo ? proximaDoComposer(modoDoComposer(estado, alvo.conversaId)) : null;
    if (proxima) escolherNoComposer(false, proxima);
  },
  "ver-pergunta": (el) => verPergunta(el.dataset.id ?? ""),
  // definido em 2026-10-15 (NOD-270): da lista de rotinas ao balão da pergunta que segura a rotina, na conversa dela.
  "ver-pergunta-da-rotina": (el) => verPerguntaNaConversa(el.dataset.conversa ?? "", el.dataset.agente ?? "", el.dataset.id ?? ""),
  "ver-decisao": (el) => verDecisao(el.dataset.id ?? ""),
  // A resposta pronta é TEXTO da pessoa (EMENDA 16): o toque manda as palavras da opção por `responder`.
  // Desligada enquanto `ocupado` (o cartão desenha as opções com disabled): o clique duplo não manda duas respostas.
  "responder-opcao": (el) =>
    estado.ocupado ? undefined : agir(async () => {
      const alvo = conversaAtual();
      const texto = el.dataset.texto ?? "";
      await api!.responder(el.dataset.id ?? "", texto);
      pedirFocoDaFila(el.dataset.id ?? "");
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota", ...(alvo ? [`conversa:${alvo.conversaId}` as Invalidacao] : [])] });
      anunciarPergunta(`Resposta enviada: ${texto}`);
    }),
  // A decisora designada que não é dona da conversa responde em "Sua vez" (não lê a conversa de outra pessoa).
  // Plano "pergunta com botões" (Parte 4, 2026-10-18): o campo do cartão de "Sua vez" vale para toda pergunta sem opções,
  // e a letra sozinha vira o texto da opção (textoDaLetra), como no campo da conversa.
  responder: (el) =>
    agir(async () => {
      const id = el.dataset.id ?? "";
      const digitado = document.querySelector<HTMLInputElement>(`input[data-resposta="${CSS.escape(id)}"]`)?.value.trim() ?? "";
      const item = estado.suaVez?.itens.find((i) => i.decisao.id === id);
      const texto = item ? textoDaLetra(digitado, opcoesDaPergunta(estado, item)) : digitado;
      await api!.responder(id, texto);
      pedirFocoDaFila(id);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] });
      anunciarPergunta(`Resposta enviada: ${texto}`);
    }),
  // "Abrir conversa" do cartão de "Sua vez": abre a conversa com o campo já respondendo a ESTA pergunta.
  "responder-na-conversa": (el) => {
    dispatch({ tipo: "composer", conversaId: el.dataset.conversa ?? "", escolha: { outroAssunto: false, alvoId: el.dataset.id ?? null } });
    return ACOES["abrir-conversa"]?.(el);
  },
  retomar: (el) =>
    agir(async () => {
      const texto = document.querySelector<HTMLInputElement>(`input[data-resposta="${CSS.escape(el.dataset.id ?? "")}"]`)?.value.trim();
      await api!.retomar(el.dataset.id ?? "", texto || undefined);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "frota"] });
    }),
  "revogar-chave": (el) => {
    if (!window.confirm(`Cancelar a chave "${el.dataset.nome ?? ""}"? O computador dela para de conseguir entrar na hora.`)) return;
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    // QA NOD-367: o item some com o menu; o foco volta ao "…" da máquina, não cai no body.
    const gatilho = el.dataset.maquina ? `[data-act="maq-menu"][data-maquina="${CSS.escape(el.dataset.maquina)}"]` : null;
    focarGatilho(gatilho);
    return agir(async () => void (await api!.revogarChave(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["chaves", "maquinas", "frota"] }), focarGatilho(gatilho)));
  },
  "fechar-chave-emitida": () => dispatch({ tipo: "chave-emitida", emitida: null }),
  // ADR-102: a lista única de contas (Provedores de IA) e as ações da máquina (Máquinas).
  "cl-menu": (el) => {
    const id = el.dataset.id ?? "";
    contasDaPessoa.menu(id);
    // Revisão NOD-373: aberto, o foco vai ao primeiro item (o "…" de cada IA na ordem, como o da máquina).
    if (estado.contasUi.menu === id) document.querySelector<HTMLElement>(`#espaco [data-act="cl-menu"][data-id="${CSS.escape(id)}"]`)?.closest(".cl-mais")?.querySelector<HTMLElement>('.cl-menu [role^="menuitem"]')?.focus();
  },
  // Revisão NOD-373 (WCAG 2.5.7): "Subir/Descer na ordem" no "…" da IA, a mesma gravação do arrasto e das setas.
  "ia-ordem-passo": (el) => {
    const ia = el.dataset.ia ?? "";
    const ids = [...document.querySelectorAll<HTMLElement>('#espaco [data-ordem-lista="pessoa"] [data-ordem-item]')].map((x) => x.dataset.ordemItem ?? "");
    contasDaPessoa.fecharMenu();
    const nova = ordemDoPasso(ids, ia, el.dataset.passo);
    if (nova) aoSoltarOrdem("pessoa", nova);
    focarGatilho(`[data-act="cl-menu"][data-id="${CSS.escape(chaveDoMenuDaIa(ia))}"]`);
  },
  "cl-renomear": (el) => { contasDaPessoa.renomear(el.dataset.id ?? null); focarNovo(); },
  "cl-renomear-fechar": () => contasDaPessoa.renomear(null),
  "cl-detalhe": (el) => contasDaPessoa.detalhe(el.dataset.id ?? ""),
  // Revisor do PR #429: o diálogo abre na hora (a busca das frentes leva até 5 s); o foco vai ao "Cancelar" já ao abrir e
  // de novo quando a lista chega e o diálogo é redesenhado.
  "cl-sair": (el) => { const p = contasDaPessoa.pedirSaida(el.dataset.id ?? "", el.dataset.maquina ?? ""); focarNovo(); void p.then(focarNovo); },
  "cl-remover": (el) => { const p = contasDaPessoa.pedirRemocao(el.dataset.id ?? ""); focarNovo(); void p.then(focarNovo); },
  "cl-confirmar": async () => { const volta = gatilhoDoDialogo(); await contasDaPessoa.confirmar(); focarGatilho(volta); },
  "cl-confirmar-fechar": () => { const volta = gatilhoDoDialogo(); contasDaPessoa.fecharConfirmacao(); focarGatilho(volta); },
  "cl-entrar": (el) => contasDaPessoa.entrar(el.dataset.id ?? "", el.dataset.maquina ?? ""),
  "cl-nova": () => { contasDaPessoa.abrirNova(); document.querySelector<HTMLElement>("#espaco [data-cl-nova-apelido], #espaco [data-act='cl-conectar-vm']")?.focus(); },
  // Sem máquina para o login: fecha a conta nova e abre o Conectar em Máquinas, já no comando com o convite.
  "cl-conectar-vm": (el) => { contasDaPessoa.fecharNova(); abrirEspaco("maquinas"); return ACOES["conectar-maquina"]!(el); },
  // NOD-89 (corte 1): o atalho "Conectar uma máquina sempre ligada" da linha "Roda em" e da execução que não rodou abre
  // Máquinas › Conectar, no padrão do `cl-conectar-vm`. O fluxo da nuvem (NOD-92) entra no PR B.
  "conectar-sempre-ligada": (el) => { abrirEspaco("maquinas"); return ACOES["conectar-maquina"]!(el); },
  "cl-nova-fechar": () => contasDaPessoa.fecharNova(),
  "cl-nova-na-maquina": (el) => { const ia = el.dataset.ia; if (ehIa(ia)) void contasDaPessoa.novaNaMaquina(ia, el.dataset.maquina ?? ""); },
  // ADR-108 (R8): o liga/desliga "na fila" de cada conta (a 2ª da mesma IA e a corporativa pedem os termos antes).
  "cl-fila": (el) => { void contasDaPessoa.naFila(el.dataset.id ?? "", el.getAttribute("aria-checked") !== "true"); },
  "cl-filtro": (el) => contasDaPessoa.filtro(el.dataset.maquina || null),
  "cl-gerenciar": (el) => { dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } }); abrirEspaco("conexao"); contasDaPessoa.filtro(el.dataset.maquina || null); },
  "cl-login-cancelar": (el) => contasDaPessoa.cancelarLogin(el.dataset.login ?? ""),
  "cl-login-fechar": (el) => contasDaPessoa.fecharLogin(el.dataset.login ?? ""),
  "cl-login-de-novo": (el) => contasDaPessoa.deNovo(el.dataset.login ?? ""),
  "cl-terminal": (el) => contasDaPessoa.terminal(el.dataset.login ?? ""),
  "cl-atualizar-ia": (el) => void contasDaPessoa.atualizarIa(el.dataset.login ?? ""),
  "cl-atualizar-maquina": (el) => { const ia = el.dataset.ia; if (ia === "claude-cli" || ia === "codex-cli") void contasDaPessoa.atualizarNaMaquina(el.dataset.maquina ?? "", ia); },
  // ADR-102: os passos da linha "conta no limite" do chat (o login abre em Provedores de IA, onde a linha mostra os passos).
  // ADR-108 (R4/R6): a escolha no aviso de troca de IA do bot. A linha relê pela conversa (o servidor grava o desfecho nela).
  "troca-esperar": (el) => decidirTroca(el, "esperar"),
  "troca-levar": (el) => decidirTroca(el, "levar"),
  "troca-outra-ia": (el) => decidirTroca(el, "outra_ia"),
  // NOD-313: as pílulas e o "desfazer" do card de ritmo da rotina. A linha relê pela conversa (o servidor a reescreve).
  "ritmo-rotina": (el) => decidirRitmo(el),
  // NOD-284: o passo leva o turno da nota; quando o servidor não refaz, a tela diz por quê (nunca "seguindo" sem seguir).
  "cl-seguir": (el) => agir(async () => {
    const conversaId = el.dataset.conversa ?? "";
    const r = await api!.seguirComConta(el.dataset.id ?? "", conversaId, el.dataset.turno || undefined);
    avisarMotivoDaNota(r?.motivo);
    // definido em 2026-10-15 (NOD-277): o "Seguir com" da task parada pela cota (data-trabalho) relê também a task e a lista.
    const trabalhoId = el.dataset.trabalho;
    const conversa = `conversa:${conversaId}` as Invalidacao;
    dispatch({ tipo: "invalidar", quais: trabalhoId ? [conversa, "contas", "trabalhos", `trabalho:${trabalhoId}` as Invalidacao] : [conversa, "contas"] });
  }),
  // NOD-280: a conta pode ter voltado antes do prazo — limpa o limite dela e refaz a fala da nota.
  "cl-tentar-de-novo": (el) => agir(async () => {
    const conversaId = el.dataset.conversa || undefined;
    const turnoId = el.dataset.turno || undefined;
    const r = await api!.tentarDeNovoConta(el.dataset.id ?? "", turnoId && conversaId ? { conversaId, turnoId } : {});
    avisarMotivoDaNota(r?.motivo);
    dispatch({ tipo: "invalidar", quais: [...(conversaId ? [`conversa:${conversaId}` as Invalidacao] : []), "contas"] });
  }),
  "cl-entrar-chat": (el) => {
    const ia = el.dataset.ia;
    abrirEspaco("conexao");
    if (ia === "claude-cli" || ia === "codex-cli") void contasDaPessoa.entrar(el.dataset.id ?? "", el.dataset.maquina ?? "", { ia, apelido: el.dataset.apelido ?? "" });
  },
  "maq-menu": (el) => {
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: estado.contasUi.maquinaMenu === el.dataset.maquina ? null : el.dataset.maquina ?? null } });
    // NOD-367 (a11y do "…"): aberto, o foco vai ao primeiro item.
    if (estado.contasUi.maquinaMenu) document.querySelector<HTMLElement>(`#espaco [data-maquina-linha="${CSS.escape(estado.contasUi.maquinaMenu)}"] .cl-menu [role^="menuitem"]`)?.focus();
  },
  "maq-renomear": (el) => { dispatch({ tipo: "contas-ui", mudanca: { maquinaRenomear: el.dataset.maquina ?? null, maquinaMenu: null } }); focarNovo(); },
  // NOD-367: onde cada bot trabalha se escolhe na ficha dele; "Bots desta máquina" leva aos Agentes.
  "maq-bots": () => {
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    abrirEspaco("agentes");
  },
  // NOD-367: o que abre embaixo da linha da máquina (os detalhes da chave, o que roda no Mac); o menu fecha e o foco vai lá.
  "maq-abrir": (el) => {
    const id = el.dataset.recolhe ?? "";
    const linha = el.closest<HTMLElement>("[data-maquina-linha]")?.dataset.maquinaLinha ?? "";
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    if (!id) return;
    dispatch({ tipo: "config-recolhe", id });
    const alvo = document.querySelector<HTMLElement>(`#espaco [data-maquina-linha="${CSS.escape(linha)}"] [role="region"]`);
    if (alvo) { alvo.tabIndex = -1; alvo.focus(); } else document.querySelector<HTMLElement>(`#espaco [data-act="maq-menu"][data-maquina="${CSS.escape(linha)}"]`)?.focus();
  },
  "maq-renomear-fechar": () => dispatch({ tipo: "contas-ui", mudanca: { maquinaRenomear: null } }),
  // ADA-245 (prancha D1): "Tornar padrão" no "…", o mesmo PUT do seletor "Computador padrão".
  "maq-tornar-padrao": (el) => agir(async () => {
    const id = el.dataset.maquina ?? "";
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    focarGatilho(`[data-act="maq-menu"][data-maquina="${CSS.escape(id)}"]`);
    await api!.maquinaPadrao(id || null);
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  }),
  // ADA-245 (jornada D): o diálogo (D2) abre com a prévia do servidor; "aqui" = o computador em que o app roda.
  "rm-abrir": (el) => agir(async () => {
    const id = el.dataset.maquina ?? "";
    const menu = `[data-act="maq-menu"][data-maquina="${CSS.escape(id)}"]`;
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    focarGatilho(menu);
    // A ponte da ADA-243 (estaMaquina) devolve a máquina conferida; aqui só importa o id. Relida na hora, não do estado.
    const daqui = window.nodDesktop?.estaMaquina ? window.nodDesktop.estaMaquina().then((v) => lerEstaMaquina(v)?.id ?? null, () => null) : Promise.resolve(null);
    const [previa, esta] = await Promise.all([api!.previaRemover(id), daqui]);
    dispatch({ tipo: "remover-ui", mudanca: { dialogo: { previa, aqui: esta === id, manterIas: false, manterConexao: false, enviando: false, erro: null }, fim: null } });
    focarNovo();
  }),
  "rm-fechar": () => {
    if (estado.removerUi.dialogo?.enviando) return;
    const volta = gatilhoDoDialogo();
    dispatch({ tipo: "remover-ui", mudanca: { dialogo: null } });
    focarGatilho(volta);
  },
  // O POST no servidor e, neste computador, a limpeza pela ponte do app; a tela de Fim (D3) mostra o que aconteceu.
  "rm-confirmar": async () => {
    const d = estado.removerUi.dialogo;
    if (!d || d.enviando || !api) return;
    const opcoes = { manterIas: d.manterIas, manterConexao: d.manterConexao };
    dispatch({ tipo: "remover-ui", mudanca: { dialogo: { ...d, enviando: true, erro: null } } });
    // Neste computador a limpeza vem ANTES (ADA-245): o motor ainda roda e sabe se apagar; depois o servidor revoga na
    // hora (`daqui`). Se a limpeza falhar, o servidor segue sem `daqui` e a puxada tenta de novo.
    const ponte = window.nodDesktop;
    let daPonte: ItemDoFim[] | null = null;
    let ponteFalhou = false;
    if (d.aqui && ponte?.removerDaqui) {
      try {
        daPonte = itensDaPonte((await ponte.removerDaqui(opcoes)).itens);
      } catch {
        ponteFalhou = true;
      }
    }
    let r;
    try {
      r = await api.removerComputador(d.previa.id, opcoes, daPonte !== null);
    } catch {
      dispatch({ tipo: "remover-ui", mudanca: { dialogo: { ...d, enviando: false, erro: "Não deu para remover agora. Confira a internet e tente de novo." } } });
      focarNovo();
      return;
    }
    const itens: ItemDoFim[] = daPonte ?? (ponteFalhou ? [...itensDoServidor(r, { online: d.previa.online, opcoes }).slice(1), ITEM_PONTE_FALHOU] : itensDoServidor(r, { online: d.previa.online, opcoes }));
    dispatch({ tipo: "remover-ui", mudanca: { dialogo: null, fim: { maquinaId: d.previa.id, nome: r.nome, aqui: d.aqui, itens } } });
    dispatch({ tipo: "invalidar", quais: ["maquinas", "frota", "chaves"] });
    focarNovo();
  },
  // D3: "Fechar" encerra o app no Windows (só quando o removido é este computador); senão volta a Computadores.
  "rm-fim-fechar": () => agir(async () => {
    const f = estado.removerUi.fim;
    if (await appEncerraNoFim(f?.aqui === true, window.nodDesktop)) return;
    dispatch({ tipo: "remover-ui", mudanca: { fim: null } });
    document.querySelector<HTMLElement>('#espaco [data-act="secao-espaco"][data-secao="maquinas"]')?.focus();
  }),
  "maq-desconectar": (el) => {
    const id = el.dataset.maquina ?? "";
    const temContas = (estado.contasIa?.contas ?? []).some((c) => c.maquinas.some((v) => v.maquinaId === id && v.estado === "pronta"));
    dispatch({ tipo: "contas-ui", mudanca: { desconectar: { maquinaId: id, sair: temContas }, maquinaMenu: null } });
    focarNovo();
  },
  "maq-desconectar-fechar": () => { const volta = gatilhoDoDialogo(); dispatch({ tipo: "contas-ui", mudanca: { desconectar: null } }); focarGatilho(volta); },
  "maq-desconectar-confirmar": () => agir(async () => {
    const q = estado.contasUi.desconectar;
    if (!q) return;
    dispatch({ tipo: "contas-ui", mudanca: { desconectar: null } });
    await api!.desconectarMaquina(q.maquinaId, q.sair);
    dispatch({ tipo: "invalidar", quais: ["maquinas", "frota", "contas"] });
  }),
  // ADR-121 (NOD-92): a máquina na nuvem — dormir, acordar, o sono e o "Dormir e acordar pelo Google".
  "nuvem-dormir": (el) => agir(async () => {
    const id = el.dataset.maquina ?? "";
    dispatch({ tipo: "nuvem-ui", mudanca: { recusa: null } });
    try {
      await api!.dormirAgora(id);
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status !== 409) throw e;
      const nome = estado.maquinas?.maquinas.find((m) => m.id === id)?.nome ?? "máquina";
      dispatch({ tipo: "nuvem-ui", mudanca: { recusa: { maquinaId: id, texto: recusaDoDormir(nome) } } });
    }
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  }),
  "nuvem-acordar": (el) => agir(async () => {
    const id = el.dataset.maquina ?? "";
    dispatch({ tipo: "nuvem-ui", mudanca: { recusa: null } });
    try {
      await api!.acordarAgora(id);
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status !== 409) throw e;
      const nome = estado.maquinas?.maquinas.find((m) => m.id === id)?.nome ?? "máquina";
      dispatch({ tipo: "nuvem-ui", mudanca: { recusa: { maquinaId: id, texto: `A ${nome} não pode acordar agora. Atualize a página e tente de novo.` } } });
    }
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  }),
  "nuvem-sono-menu": (el) => dispatch({ tipo: "nuvem-ui", mudanca: { sonoMenu: estado.nuvem.sonoMenu === el.dataset.maquina ? null : el.dataset.maquina ?? null } }),
  "nuvem-dormir-apos": (el) => agir(async () => {
    const minutos = el.dataset.minutos ? (Number(el.dataset.minutos) as DormirAposMin) : null;
    dispatch({ tipo: "nuvem-ui", mudanca: { sonoMenu: null } });
    await api!.dormirApos(el.dataset.maquina ?? "", minutos);
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  }),
  "nuvem-reconectar": () => agir(() => irParaOGoogle({ para: "preparar" })),
  "nuvem-aviso-fechar": () => dispatch({ tipo: "nuvem-ui", mudanca: { aviso: null } }),
  "nuvem-conectar-abrir": (el) => {
    const m = estado.maquinas?.maquinas.find((x) => x.id === el.dataset.maquina);
    if (!m) return;
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    dispatch({ tipo: "nuvem-ui", mudanca: { conectar: { maquinaId: m.id, projeto: "", zona: ZONA_PADRAO, nome: nomeDeInstanciaSugerido(m), erro: null } } });
    focarNovo();
  },
  "nuvem-conectar-fechar": () => dispatch({ tipo: "nuvem-ui", mudanca: { conectar: null } }),
  // PR 2 (NOD-92): criar a VM pelo nod e excluir a que ele criou.
  "nuvem-criar-abrir": (el) => {
    criarAbertoPor = el.dataset.id ?? null;
    dispatch({ tipo: "nuvem-ui", mudanca: { criar: { regiao: REGIAO_PADRAO, tamanho: "padrao", erro: null, enviando: false } } });
    focarNovo();
  },
  "nuvem-criar-fechar": () => { const volta = gatilhoDoDialogo(); dispatch({ tipo: "nuvem-ui", mudanca: { criar: null } }); focarGatilho(volta); },
  "nuvem-excluir": (el) => {
    dispatch({ tipo: "contas-ui", mudanca: { maquinaMenu: null } });
    dispatch({ tipo: "nuvem-ui", mudanca: { excluir: { id: el.dataset.id ?? "", nome: el.dataset.nome ?? "máquina", erro: null } } });
    focarNovo();
  },
  "nuvem-excluir-fechar": () => { const volta = gatilhoDoDialogo(); dispatch({ tipo: "nuvem-ui", mudanca: { excluir: null } }); focarGatilho(volta); },
  "nuvem-excluir-confirmar": () => agir(async () => {
    const q = estado.nuvem.excluir;
    if (!q) return;
    try {
      await api!.excluirMaquinaNuvem(q.id);
      dispatch({ tipo: "nuvem-ui", mudanca: { excluir: null } });
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status === 0 || e.status >= 500) throw e;
      dispatch({ tipo: "nuvem-ui", mudanca: { excluir: { ...q, erro: erroDoExcluir(e.status) } } });
    }
    dispatch({ tipo: "invalidar", quais: ["nuvem", "maquinas", "frota"] });
  }),
  // ADR-090: Seu espaço › Máquinas.
  // As chaves que JÁ existem precisam estar carregadas: a máquina nova é a que não estava nelas (revisão do PR: sem isso,
  // com a seção ainda carregando, a "nova" seria o Mac e todos os bots iriam para ele).
  "conectar-maquina": () => agir(async () => {
    const chavesAntes = await chavesAtuais();
    // ADR-102 (CMJ): no modo compartilhado, o comando leva um convite e a tela vê a máquina chegar (sem digitar código).
    const criado = estado.maquinas?.servidorNoMac ? null : await api!.criarConvite().catch(() => null);
    dispatch({ tipo: "conectar-maquina", conectar: { passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes, marcados: [], convite: criado?.convite ?? null, conviteAte: criado?.expiraEm ?? null } });
    if (criado) void esperarConvite(criado.convite, criado.expiraEm);
  }),
  "fechar-conectar-maquina": () => dispatch({ tipo: "conectar-maquina", conectar: null }),
  // NOD-94: "Usar uma máquina só para o computador".
  "ssh-abrir": () => agir(async () => { await instalarSsh.abrir(); focarNovo(); }),
  "ssh-metodo": (el) => { instalarSsh.metodo(el.dataset.metodo as "chave" | "senha" | "apelido"); },
  "ssh-trocar-chave": () => { instalarSsh.trocarChave(); document.querySelector<HTMLElement>("#espaco [data-ssh-chave]")?.focus(); },
  "ssh-tem-frase": () => { instalarSsh.temFrase(true); document.querySelector<HTMLElement>('#espaco [data-ssh-segredo="frase"]')?.focus(); },
  "ssh-trocar-origem": () => instalarSsh.trocarOrigem(true),
  "ssh-origem": (el) => instalarSsh.escolherOrigem(el.dataset.id ?? ""),
  "ssh-substituir-sim": () => agir(async () => { await instalarSsh.confirmarSubstituir(); focarNovo(); }),
  "ssh-substituir-nao": () => instalarSsh.desistirDeSubstituir(),
  "ssh-tentar": (el) => agir(async () => { await instalarSsh.tentarDeNovo(el.dataset.origem); focarNovo(); }),
  "ssh-conferir": () => { instalarSsh.voltarAoFormulario(); focarNovo(); },
  "ssh-confiar": () => agir(() => instalarSsh.confiarNaNova()),
  "ssh-manual": () => agir(() => instalarSsh.abrirManual()),
  "ssh-sudo-mostrar": () => { instalarSsh.mostrarSudo(!estado.instalarSsh?.mostrarSudo); document.querySelector<HTMLElement>('#espaco [data-ssh-segredo="sudo"]')?.focus(); },
  "ssh-segundo-plano": () => { instalarSsh.segundoPlano(); document.querySelector<HTMLElement>('#espaco [data-act="ssh-reabrir"]')?.focus(); },
  "ssh-reabrir": () => { instalarSsh.reabrir(); focarNovo(); },
  "ssh-esc": () => instalarSsh.fechar(),
  "ssh-fechar": () => { instalarSsh.fechar(); document.querySelector<HTMLElement>('#espaco [data-act="ssh-abrir"]')?.focus(); },
  "ssh-cancelar": () => agir(() => instalarSsh.cancelar()),
  "passo-conectar-maquina": (el) => {
    const passo = el.dataset.passo as NonNullable<typeof estado.conectarMaquina>["passo"];
    // Na escolha dos bots, todos começam marcados: quem conecta uma VM quer tirar o trabalho do Mac.
    const marcados = passo === "bots" && estado.conectarMaquina?.marcados.length === 0 ? botsDaPessoa(estado).map((a) => a.id) : undefined;
    atualizarConectar({ passo, erro: null, ...(marcados ? { marcados } : {}) });
  },
  "ver-codigo-maquina": () => agir(async () => {
    const codigo = document.querySelector<HTMLInputElement>("#codigo-maquina")?.value.trim() ?? "";
    if (!codigo) { atualizarConectar({ erro: "Digite o código que apareceu na máquina." }); return; }
    const pedido = await api!.verDispositivo(codigo).catch(() => null);
    atualizarConectar(pedido ? { passo: "confirmar", codigo, pedido, erro: null } : { codigo, erro: "Esse código não existe ou venceu. Confira na máquina ou rode a instalação de novo." });
  }),
  "aprovar-maquina": () => agir(async () => {
    const c = estado.conectarMaquina;
    if (!c) return;
    const ok = await api!.aprovarDispositivo(c.codigo).then(() => true, () => false);
    if (!ok) { atualizarConectar({ passo: "codigo", erro: "O código venceu. Rode a instalação de novo para pegar outro." }); return; }
    atualizarConectar({ passo: "ias", erro: null });
    void esperarMaquinaNova();
  }),
  "marcar-bot-maquina": (el) => {
    const c = estado.conectarMaquina;
    const id = el.dataset.id ?? "";
    if (c) atualizarConectar({ marcados: c.marcados.includes(id) ? c.marcados.filter((x) => x !== id) : [...c.marcados, id] });
  },
  "marcar-bots-maquina": (el) => atualizarConectar({ marcados: el.dataset.todos === "1" ? botsDaPessoa(estado).map((a) => a.id) : [] }),
  "mover-bots-maquina": () => agir(async () => {
    const c = estado.conectarMaquina;
    const nova = c ? maquinaNova(estado, c) : null;
    if (!c || !nova) return;
    if (c.marcados.length > 0) {
      await api!.moverBots(nova.id, c.marcados);
      // ADR-092: com o servidor no Mac, bot novo continua no Mac — a VM só leva os escolhidos.
      if (!estado.maquinas?.servidorNoMac) await api!.maquinaPadrao(nova.id);
    }
    dispatch({ tipo: "conectar-maquina", conectar: null });
    dispatch({ tipo: "invalidar", quais: ["frota", "maquinas"] });
  }),
  "rodar-desta-vez": (el) => agir(async () => {
    const conversaId = el.dataset.conversa ?? "";
    const turnoId = el.dataset.turno || undefined;
    const r = await api!.rodarDestaVez(conversaId, el.dataset.maquina ?? "", turnoId, el.dataset.conta || undefined);
    // QA do NOD-314: "já refeito" diz que o 1º clique já fez, e o atalho daquele turno some na hora (não só na releitura).
    if (r?.motivo === "ja_refeito" && turnoId) dispatch({ tipo: "turno-refeito", turnoId });
    avisarMotivoDaNota(r?.motivo);
    dispatch({ tipo: "invalidar", quais: [`conversa:${conversaId}` as Invalidacao] });
  }),
  // NOD-314: a task na fila de uma máquina sem contato roda em outra, desta vez; relê a task e a lista.
  "rodar-trabalho-desta-vez": (el) => agir(async () => {
    const trabalhoId = el.dataset.id ?? "";
    const r = await api!.rodarTrabalhoDestaVez(trabalhoId, el.dataset.maquina ?? "");
    // QA do NOD-314: o 2º clique (os pendentes já iam para ela) diz que já foi, em vez de nada.
    avisarMotivoDaTask(r?.motivo);
    dispatch({ tipo: "invalidar", quais: ["trabalhos", `trabalho:${trabalhoId}` as Invalidacao] });
  }),
  reabrir: (el) => agir(async () => void (await api!.reabrir(el.dataset.id ?? ""), dispatch({ tipo: "invalidar", quais: ["sua-vez"] }))),
  // revisto em 2026-10-18 (plano "pergunta com botões"): o × do cartão relê também a conversa (o fio diz "Deixada pra lá").
  dispensar: (el) => agir(async () => {
    await api!.dispensar(el.dataset.id ?? "");
    const conversaId = estado.suaVez?.itens.find((i) => i.decisao.id === el.dataset.id)?.decisao.conversaId ?? conversaAtual()?.conversaId;
    dispatch({ tipo: "invalidar", quais: ["sua-vez", ...(conversaId ? [`conversa:${conversaId}` as Invalidacao] : [])] });
    if (el.closest(".cartao-pergunta")) anunciarPergunta("Pergunta deixada pra lá");
  }),
  // Em série: são poucas, e uma recusa no meio não deixa metade gravada sem a tela saber.
  "limpar-vencidos": (el) => agir(async () => {
    for (const id of (el.dataset.ids ?? "").split(",").filter(Boolean)) await api!.dispensar(id);
    dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  }),
};

const FORMS: Record<string, (form: HTMLFormElement) => Promise<void>> = {
  // NOD-94: o formulário do SSH e a senha do sudo (os valores já estão no controlador, pelo `input`).
  "instalar-ssh": () => agir(async () => { await instalarSsh.enviar(); focarNovo(); }),
  "ssh-sudo": () => agir(async () => { await instalarSsh.enviarSudo(); focarNovo(); }),
  // ADR-102: a lista única de contas e o nome da máquina.
  "cl-nova": async (form) => {
    const ia = form.querySelector<HTMLInputElement>('input[name="ia"]:checked')?.value;
    const apelido = form.querySelector<HTMLInputElement>('input[name="apelido"]')?.value ?? "";
    const maquinas = [...form.querySelectorAll<HTMLInputElement>("input[data-cl-nova-maq]:checked")].map((x) => x.value);
    if (ia !== "claude-cli" && ia !== "codex-cli") return;
    contasDaPessoa.mudarNova({ ia, apelido, maquinas });
    await contasDaPessoa.enviarNova();
  },
  "cl-renomear": async (form) => contasDaPessoa.salvarApelido(form.dataset.id ?? "", form.querySelector<HTMLInputElement>('input[name="apelido"]')?.value ?? ""),
  "cl-codigo": async (form) => contasDaPessoa.enviarCodigo(form.dataset.login ?? "", form.querySelector<HTMLInputElement>('input[name="codigo"]')?.value ?? ""),
  "maq-renomear": (form) => agir(async () => {
    const nome = form.querySelector<HTMLInputElement>('input[name="nome"]')?.value.trim() ?? "";
    if (!nome) return;
    await api!.renomearMaquina(form.dataset.maquina ?? "", nome);
    dispatch({ tipo: "contas-ui", mudanca: { maquinaRenomear: null } });
    dispatch({ tipo: "invalidar", quais: ["maquinas", "contas"] });
  }),
  // ADR-121 (NOD-92): "Dormir e acordar pelo Google" leva ao Google com a máquina, o projeto, a zona e o nome da instância.
  "nuvem-conectar": (form) => agir(async () => {
    const valor = (nome: string) => form.querySelector<HTMLInputElement>(`input[name="${nome}"]`)?.value.trim() ?? "";
    const c = { maquinaId: form.dataset.maquina ?? "", projeto: valor("projeto"), zona: valor("zona"), nome: valor("nome") };
    dispatch({ tipo: "nuvem-ui", mudanca: { conectar: { ...c, erro: null } } });
    try {
      await irParaOGoogle({ para: "conectar", ...c });
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status === 0 || e.status >= 500) throw e;
      dispatch({ tipo: "nuvem-ui", mudanca: { conectar: { ...c, erro: erroDoConectar(e.status, e.codigo) } } });
    }
  }),
  // PR 2 (NOD-92): "Criar minha máquina na nuvem". Conta conectada: grava a intenção; senão, o Google pede a permissão antes.
  "nuvem-criar": (form) => agir(async () => {
    const marcado = (nome: string) => form.querySelector<HTMLInputElement>(`input[name="${nome}"]:checked`)?.value ?? "";
    const c = estado.nuvem.criar;
    const pedido = { regiao: marcado("regiao") || REGIAO_PADRAO, tamanho: (marcado("tamanho") || "padrao") as TamanhoMaquinaNuvem };
    const conta = estado.nuvem.conta;
    dispatch({ tipo: "nuvem-ui", mudanca: { criar: { ...pedido, erro: null, enviando: true } } });
    try {
      if (conta && conta !== "desligada" && conta.conectada) {
        await api!.criarMaquinaNuvem(pedido);
        dispatch({ tipo: "nuvem-ui", mudanca: { criar: null } });
        dispatch({ tipo: "invalidar", quais: ["nuvem", "maquinas"] });
      } else {
        await irParaOGoogle({ para: "criar", ...pedido });
      }
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status === 0 || e.status >= 500) { dispatch({ tipo: "nuvem-ui", mudanca: { criar: c ? { ...c, ...pedido, enviando: false } : null } }); throw e; }
      dispatch({ tipo: "nuvem-ui", mudanca: { criar: { ...pedido, erro: erroDoCriar(e.status), enviando: false } } });
    }
  }),
  "conta-nova": async (form) => {
    const ia = form.dataset.ia;
    if (ehIa(ia)) await contasDoMac.adicionar(ia, String(new FormData(form).get("apelido") ?? ""));
  },
  // Todos os forms do onboarding (o card do bot e, com NOD_ONBOARDING_TEXTO, o nome, o objetivo escrito e o código do login).
  ...Object.fromEntries(Object.entries(telaOnboarding.forms).map(([k, f]) => [k, async (form: HTMLFormElement) => { await f(form); }])),
  ...telaConta.forms,
  ...(telaMinhaConta.forms as Record<string, (form: HTMLFormElement) => Promise<void>>),
  "entrada-conta": (form) => entrarPelaTela(form),
  "entrada-recuperar": (form) => recuperarPelaTela(form),
  "entrada-redefinir": (form) => redefinirPelaTela(form),
  // O teclado da ligação: o texto entra como uma vez da pessoa, sem passar pelo STT.
  "ligacao-texto": async (form) => {
    const campo = form.elements.namedItem("texto") as HTMLInputElement | null;
    if (campo && telaLigacao.enviarTexto(campo.value)) campo.value = "";
    campo?.focus();
  },
  "emitir-chave": (form) =>
    agir(async () => {
      const nome = (form.elements.namedItem("nome") as HTMLInputElement | null)?.value.trim() ?? "";
      const emitida = await api!.emitirChave(nome);
      form.reset();
      dispatch({ tipo: "chave-emitida", emitida });
    }),
  "criar-agente": (form) =>
    agir(async () => {
      const nome = (form.elements.namedItem("nome") as HTMLInputElement | null)?.value.trim() || undefined;
      const d = new FormData(form);
      const r = await api!.criarAgente(nome, { titulo: String(d.get("titulo") ?? ""), descricao: String(d.get("descricao") ?? "") });
      form.reset();
      dispatch({ tipo: "invalidar", quais: ["frota"] });
      navegar({ tipo: "conversa", conversaId: r.conversa.id, agenteId: r.agente.id });
    }),
  "criar-rotina": (form) => { const d = new FormData(form); const naGaveta = !!form.closest("#detalhes"); return agir(async () => {
    const [hora, minuto] = String(d.get("horario")).split(":").map(Number);
    await api!.criarRotina({ agenteId: String(d.get("agenteId")), cron: String(d.get("frequencia")).startsWith("intervalo:") ? `*/${String(d.get("frequencia")).split(":")[1]} * * * *` : d.get("frequencia") === "hora" ? "0 * * * *" : `${minuto} ${hora} * * ${d.get("frequencia")}`, fusoIana: String(d.get("fusoIana")), instrucao: String(d.get("instrucao")), fonte: String(d.get("fonte")), entregavel: String(d.get("entregavel")), limitesAprovacao: String(d.get("limitesAprovacao")), politicaSemDado: String(d.get("politicaSemDado")) });
    dispatch({ tipo: "invalidar", quais: ["rotinas"] });
    // Da gaveta, a rotina criada aparece na visão geral do bot; da tela cheia, na lista de rotinas.
    if (naGaveta) fecharNivel();
    else abrirRotinas();
  }); },
  // definido em 2026-09-30: o perfil enxuto da gaveta não traz a escolha de modelo — sem o campo, ela não muda (antes,
  // o formulário sem "inteligencia" voltaria o bot para Automático).
  "editar-perfil": (form) => {
    const d = new FormData(form);
    return agir(async () => {
      // ADR-125: Missão e voz só manda a missão e a voz; nome, subtítulo, forma e cor se editam no topo da gaveta.
      // NOD-20: missão e voz num PATCH só, para virar UMA versão do perfil (antes a voz ia pela rota própria, ADR-071).
      const agenteId = form.dataset.id ?? "";
      const voz = VOZES.find((v) => v.id === d.get("voz"))?.id;
      const vozVelocidade = VELOCIDADES.find((v) => String(v) === d.get("vozVelocidade"));
      const r = await api!.editarPerfil(agenteId, { descricao: String(d.get("descricao") ?? ""), ...(voz ? { voz } : {}), ...(vozVelocidade ? { vozVelocidade } : {}) });
      dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
      fecharNivel();
      depoisDeSalvarPerfil(agenteId, r.versao ?? null);
    });
  },
  inteligencia: (form) => {
    const a = estado.frota?.agentes.find((b) => b.id === form.dataset.id);
    if (!a) return Promise.resolve();
    const r = estado.rascunhoIa?.agenteId === a.id ? estado.rascunhoIa : rascunhoDe(a);
    return gravarInteligenciaComPrevia(a, pedidoDoRascunho(r), fecharNivel);
  },
  // Tela 1/5: o código que a página da Anthropic mostrou vai ao login do Claude Code aberto no app (só a forma de um código).
  "ia-colar-codigo": (form) => {
    const ia = form.dataset.ia;
    const codigo = String(new FormData(form).get("codigo") ?? "");
    return ehIa(ia) && codigo.trim() ? iasDoMac.colarCodigo(ia, codigo) : Promise.resolve();
  },
  "criar-memoria": (form) =>
    agir(async () => {
      const d = new FormData(form);
      await api!.criarMemoria(form.dataset.id ?? "", String(d.get("tipo") ?? "fato") as "preferencia" | "fato" | "resumo", String(d.get("texto") ?? ""));
      form.reset();
      gavetaSuja = null;
      dispatch({ tipo: "invalidar", quais: [`memoria:${form.dataset.id ?? ""}`, `diario:${form.dataset.id ?? ""}`] });
    }),
  // NOD-58: o editor no lugar (opção A). Salvar fecha o editor; o texto e o tipo vão juntos.
  "salvar-memoria": (form) =>
    agir(async () => {
      const agenteId = form.dataset.agente ?? "";
      const d = new FormData(form);
      await api!.editarMemoria(agenteId, form.dataset.id ?? "", { texto: String(d.get("texto") ?? ""), tipo: String(d.get("tipo") ?? "fato") as TipoMemoria });
      gavetaSuja = null;
      mudarNivelMemoria(agenteId, { editando: undefined });
      dispatch({ tipo: "invalidar", quais: [`memoria:${agenteId}`, `diario:${agenteId}`] });
      document.querySelector<HTMLElement>(`#detalhes [data-mem-corpo="${CSS.escape(form.dataset.id ?? "")}"]`)?.focus();
    }),
  "criar-sala": (form) =>
    agir(async () => {
      const d = new FormData(form);
      const agenteIds = d.getAll("agenteIds").map(String);
      const r = await api!.criarSala(String(d.get("nome") ?? "sala"), agenteIds);
      dispatch({ tipo: "invalidar", quais: ["salas"] });
      navegar({ tipo: "sala", salaId: r.ids.salaId ?? "", conversaId: r.ids.conversaId ?? "" });
    }),
  "configurar-composio": (form) => agir(async () => {
    const d = new FormData(form);
    await api!.configurarComposio(String(d.get("chave") ?? ""));
    form.reset();
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "app-github": (form) => agir(async () => {
    const d = new FormData(form);
    await api!.appGithub({ appId: String(d.get("appId") ?? ""), instalacaoId: String(d.get("instalacaoId") ?? ""), chavePrivada: String(d.get("chavePrivada") ?? "") });
    form.reset();
    dispatch({ tipo: "aviso-conexao", texto: "GitHub App da organização guardado. As rotinas de quem não conectou o próprio GitHub passam a usá-lo." });
  }),
  // NOD-50: o valor sai do campo direto para POST propostas/:id/credencial e não passa por estado, storage nem conversa.
  // Recusada ou mal formatada: o campo volta vazio e recebe o foco. Rede: o valor fica no campo e o botão vira "Tentar de novo".
  "guardar-credencial": async (form) => {
    const id = form.dataset.id ?? "";
    const atual = faseDoCartao(id);
    if (atual.ocupado || !api) return;
    const input = form.querySelector<HTMLInputElement>('input[name="valor"]');
    const valor = input?.value.trim() ?? "";
    const focarCampo = () => document.querySelector<HTMLInputElement>(`[data-form="guardar-credencial"][data-id="${CSS.escape(id)}"] input[name="valor"]`)?.focus();
    if (!valor) { marcarFase(id, { ...atual, ocupado: false, erro: "vazio" }); render(); focarCampo(); return; }
    marcarFase(id, { ...atual, ocupado: true, erro: null });
    render();
    try {
      await api.guardarCredencial(id, valor);
      for (const campo of document.querySelectorAll<HTMLInputElement>(`[data-form="guardar-credencial"][data-id="${CSS.escape(id)}"] input[name="valor"]`)) campo.value = "";
      marcarFase(id, null);
      dispatch({ tipo: "invalidar", quais: ["sua-vez", "conectores", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
    } catch (e) {
      const erro = e instanceof ErroApi ? erroDoCartao(e.status === 0 ? null : e.status, e.codigo) : "rede";
      if (erro === "recusada" || erro === "formato") for (const campo of document.querySelectorAll<HTMLInputElement>(`[data-form="guardar-credencial"][data-id="${CSS.escape(id)}"] input[name="valor"]`)) campo.value = "";
      marcarFase(id, { ...faseDoCartao(id), ocupado: false, erro });
      if (erro === "resolvido") dispatch({ tipo: "invalidar", quais: ["sua-vez", ...(conversaAtual() ? [`conversa:${conversaAtual()?.conversaId}` as Invalidacao] : [])] });
      render();
      focarCampo();
    }
  },
  "token-github": (form) => agir(async () => {
    const d = new FormData(form);
    const r = await api!.tokenGithub(String(d.get("token") ?? ""));
    form.reset();
    dispatch({ tipo: "aviso-conexao", texto: r.conectado ? "Token guardado. O GitHub usa o gh desta máquina quando ele está logado, e o token nos outros casos." : "Token guardado, mas o GitHub não respondeu. Tente Conectar de novo em instantes." });
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "credenciais-conector": (form) => agir(async () => {
    const d = new FormData(form);
    let env: Record<string, string>;
    try { env = JSON.parse(String(d.get("env") ?? "{}")) as Record<string, string>; }
    catch { dispatch({ tipo: "erro", erro: { codigo: "entrada_invalida", mensagem: "Informe as credenciais como um objeto JSON válido." } }); return; }
    await api!.atualizarCredenciais(form.dataset.id ?? "", env);
    form.reset();
    dispatch({ tipo: "invalidar", quais: ["conectores"] });
  }),
  "registrar-conector": (form) =>
    agir(async () => {
      const d = new FormData(form);
      const args = String(d.get("args") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
      let env: Record<string, string> = {};
      const envTexto = String(d.get("env") ?? "").trim();
      if (envTexto) env = JSON.parse(envTexto) as Record<string, string>;
      await api!.registrarConector({ nome: d.get("nome"), slug: d.get("slug"), transporte: d.get("transporte"), comando: String(d.get("comando") ?? "") || null, args, url: String(d.get("url") ?? "") || null, env, declaracao: d.get("declaracao") });
      form.reset();
      dispatch({ tipo: "invalidar", quais: ["conectores"] });
    }),
  conceder: (form) =>
    agir(async () => {
      const d = new FormData(form);
      const agenteId = String(d.get("agenteId") ?? "");
      await api!.conceder(agenteId, form.dataset.id ?? "", String(d.get("capacidade") ?? ""));
      dispatch({ tipo: "invalidar", quais: [`concessoes:${agenteId}`, "frota"] });
    }),
};

instalarDicaDeLink(document);

// NOD-119: o seletor segmentado das Configurações (radiogroup): setas, Home e End escolhem a opção ao lado e levam o foco.
document.addEventListener("keydown", (ev) => {
  const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.segmentado [role="radio"]');
  if (!el) return;
  const opcoes = [...(el.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
  const prox = proximoDoSegmentado(opcoes.indexOf(el), opcoes.length, ev.key);
  if (prox === null) return;
  ev.preventDefault();
  const alvo = opcoes[prox];
  if (!alvo || alvo === el) return;
  const acao = ACOES[alvo.dataset.act ?? ""];
  if (acao) void acao(alvo);
  else alvo.focus();
});

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || el.tagName === "BUTTON" && (el as HTMLButtonElement).type === "submit" && el.closest("form[data-form]")) return;
  const acao = ACOES[el.dataset.act ?? ""];
  // NOD-85: a ação escolhida na folha ou no menu da agenda (celular) fecha a folha antes de agir.
  if (acao && el.closest(".ag-folha") && !el.dataset.act?.startsWith("agenda-")) dispatch({ tipo: "agenda-ui", mudanca: { aberto: null, menu: null, mes: null } });
  if (acao) void acao(el);
});

// NOD-449: o teclado da tela Não lidos (↑ ↓, J K, Enter, E) e o deslize para a direita no celular.
document.addEventListener("keydown", (ev) => {
  if (estado.tela.tipo !== "nao-lidos" || ev.defaultPrevented) return;
  const alvo = ev.target as HTMLElement;
  if (alvo.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='menu']")) return;
  const linhas = [...document.querySelectorAll<HTMLElement>(".tela-nao-lidos .nl-item:not(.nl-sai)")];
  const atual = linhas.findIndex((l) => l.contains(alvo));
  const r = teclaNaoLidos(ev.key, atual, linhas.length, { ctrl: ev.ctrlKey, meta: ev.metaKey, alt: ev.altKey });
  if (!r) return;
  ev.preventDefault();
  if (r.tipo === "mover") linhas[r.indice]?.querySelector<HTMLElement>(".nl-abrir")?.focus();
  else {
    const l = linhas[atual]!;
    // O foco segue para a próxima linha (ou a anterior, se era a última): dá para marcar várias seguidas com E.
    const prox = linhas[atual + 1] ?? linhas[atual - 1];
    void marcarComDesfazer(l.dataset.conversa ?? "", l.dataset.nome ?? "").then(() => {
      const c = prox?.dataset.conversa;
      if (c) document.querySelector<HTMLElement>(`.nl-item[data-conversa="${CSS.escape(c)}"] .nl-abrir`)?.focus();
    });
  }
});
instalarDeslizeLida(document, (item) => void marcarComDesfazer(item.dataset.conversa ?? "", item.dataset.nome ?? ""));

// NOD-444: Esc no campo tira a sugestão da nova rotina (o resto do Esc do campo segue igual).
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const alvo = ev.target as HTMLElement;
  const pilula = document.getElementById("composer-sugestao");
  if (!pilula || pilula.hidden || !(alvo.id === "composer-texto" || alvo.closest("#composer-sugestao"))) return;
  // A lista do "/" e o ditado têm o Esc antes: fecham primeiro, a pílula fica para o próximo Esc.
  if (document.getElementById("barra-lista")?.hidden === false || ditado.ativo()) return;
  // Um Esc faz uma coisa só: com a pílula à vista, tira a pílula e para (a citação e a caixa "Respondendo" ficam).
  ev.preventDefault();
  ev.stopImmediatePropagation();
  mostrarSugestaoRotina(false);
  document.getElementById("composer-texto")?.focus();
});

// NOD-312: Esc dentro da explicação do recomeço (ou no botão que a abriu) fecha e devolve o foco ao botão.
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const alvo = ev.target as HTMLElement;
  const regiao = alvo.closest?.<HTMLElement>(".p312-explica");
  const botao = alvo.closest?.<HTMLElement>('[data-act="recomeco-explicar"][aria-expanded="true"]')
    ?? (regiao ? document.querySelector<HTMLElement>(`[data-act="recomeco-explicar"][aria-controls="${CSS.escape(regiao.id)}"]`) : null);
  if (!botao || botao.getAttribute("aria-expanded") !== "true") {
    // QA: a linha da troca de IA com a carona (details) também fecha no Esc e devolve o foco ao summary.
    const det = detailsParaFecharComEsc<HTMLDetailsElement>(alvo);
    if (!det) return;
    ev.preventDefault();
    ev.stopPropagation();
    det.open = false;
    det.querySelector<HTMLElement>("summary")?.focus();
    return;
  }
  ev.preventDefault();
  ev.stopPropagation();
  alternarExplicacaoNoDom(botao, false);
  botao.focus();
}, true);

function alternarExplicacaoNoDom(botao: HTMLElement, aberta?: boolean): void {
  const id = botao.dataset.id;
  if (!id) return;
  const vai = alternarExplicacao(id, aberta);
  botao.setAttribute("aria-expanded", String(vai));
  const regiao = document.getElementById(botao.getAttribute("aria-controls") ?? "");
  if (regiao) regiao.hidden = !vai;
}

// ADR-102: o ⋯ da conta e o da máquina fecham num clique fora deles; Esc fecha o diálogo, o menu e o formulário abertos.
document.addEventListener("click", (ev) => {
  const u = estado.contasUi;
  if ((u.menu || u.maquinaMenu) && !(ev.target as HTMLElement).closest(".cl-mais")) dispatch({ tipo: "contas-ui", mudanca: { menu: null, maquinaMenu: null } });
  if (estado.nuvem.sonoMenu && !(ev.target as HTMLElement).closest(".nv-ajuste-wrap")) dispatch({ tipo: "nuvem-ui", mudanca: { sonoMenu: null } });
  // NOD-58: o "…" da memória aberto é como um modal leve: o clique fora só fecha (no celular, o fundo escurecido da folha
  // não deixa o toque acertar a memória de baixo).
  const g = estado.gaveta;
  if (g?.nivel.tipo === "memoria" && g.nivel.menu && document.querySelector("#detalhes .mem-menu") && !(ev.target as HTMLElement).closest(`.mem-menu, dialog, .mem-mem-mais[data-id="${CSS.escape(g.nivel.menu)}"]`)) {
    ev.preventDefault();
    ev.stopPropagation();
    mudarNivelMemoria(g.agenteId, { menu: undefined });
  }
}, true);
// NOD-58: no editor da memória, Esc cancela e ⌘↵ (Ctrl+↵) salva; no "…" aberto, Esc fecha e devolve o foco.
document.addEventListener("keydown", (ev) => {
  const alvo = ev.target as HTMLElement;
  const editor = alvo.closest?.<HTMLFormElement>('#detalhes form[data-form="salvar-memoria"]');
  if (editor && ev.key === "Escape") {
    ev.preventDefault();
    editor.querySelector<HTMLElement>('[data-act="cancelar-edicao"]')?.click();
  } else if (alvo.closest?.("#detalhes form.mem-editor") && ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) {
    ev.preventDefault();
    alvo.closest<HTMLFormElement>("form")?.requestSubmit();
  } else if (ev.key === "Escape" && alvo.closest?.("#detalhes .mem-menu")) {
    ev.preventDefault();
    const id = alvo.closest<HTMLElement>("[data-memoria]")?.dataset.memoria ?? "";
    const seletor = `#detalhes [data-act="memoria-mais"][data-id="${CSS.escape(id)}"]`;
    document.querySelector<HTMLElement>(seletor)?.click();
    // Depois do redesenho: o botão antigo já saiu do DOM.
    document.querySelector<HTMLElement>(seletor)?.focus();
  }
});
// NOD-367: setas, Home e End no "…" das Configurações (o `.cl-menu` aberto), como no menu do avatar.
document.addEventListener("keydown", (ev) => {
  const menu = (ev.target as HTMLElement).closest?.<HTMLElement>("#espaco .cl-menu");
  if (!menu) return;
  const itens = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const proximo = proximoItemDoMenu(itens.length, itens.indexOf(document.activeElement as HTMLElement), ev.key);
  if (proximo === null) return;
  ev.preventDefault();
  itens[proximo]?.focus();
});
document.addEventListener("keydown", (ev) => {
  // O Tab fica dentro do diálogo aberto (Sair, Remover, Desconectar), como na gaveta de conectores.
  // NOD-346: a janela "Confirme que é você" de Minha conta também prende o Tab.
  const dialogo = ev.key === "Tab" ? document.querySelector<HTMLElement>("#espaco .cl-dialogo, #espaco .conta-modal") : null;
  if (dialogo) {
    const focaveis = [...dialogo.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]):not([hidden]), textarea:not([disabled]), summary")];
    const primeiro = focaveis[0];
    const ultimo = focaveis.at(-1);
    const dentro = dialogo.contains(document.activeElement);
    if (primeiro && ultimo && (!dentro || (ev.shiftKey && document.activeElement === primeiro) || (!ev.shiftKey && document.activeElement === ultimo))) {
      ev.preventDefault();
      (ev.shiftKey ? ultimo : primeiro).focus();
    }
    return;
  }
  if (ev.key !== "Escape" || !estado.espaco) return;
  // NOD-346: o Esc com a janela "Confirme que é você" aberta fecha só ela, não Seu espaço inteiro.
  if (contas?.minhaConta && telaMinhaConta.janelaAberta()) {
    ev.stopPropagation();
    ev.preventDefault();
    telaMinhaConta.fecharJanela();
    return;
  }
  // NOD-96: a confirmação do painel do computador fecha no Esc; as etapas vão para segundo plano.
  if (estado.computadorUi.confirmar || estado.computadorUi.etapasAbertas || estado.computadorUi.preparoAberto) {
    ev.stopPropagation();
    const op = estado.computadorUi.confirmar;
    dispatch({ tipo: "computador-ui", ui: { confirmar: null, etapasAbertas: false, preparoAberto: false } });
    if (op) document.querySelector<HTMLElement>(`#espaco [data-pc-acao="${op}"] button`)?.focus();
    return;
  }
  // NOD-94: no progresso, o Esc é o "Continuar em segundo plano"; no formulário, fecha (e os segredos somem).
  if (estado.instalarSsh && !estado.instalarSsh.segundoPlano) {
    ev.stopPropagation();
    instalarSsh.fechar();
    (document.querySelector<HTMLElement>('#espaco [data-act="ssh-reabrir"]') ?? document.querySelector<HTMLElement>('#espaco [data-act="ssh-abrir"]'))?.focus();
    return;
  }
  if (estado.nuvem.sonoMenu || estado.nuvem.conectar || estado.nuvem.excluir || estado.nuvem.criar) {
    ev.stopPropagation();
    const volta = estado.nuvem.sonoMenu || estado.nuvem.conectar ? null : gatilhoDoDialogo();
    dispatch({ tipo: "nuvem-ui", mudanca: estado.nuvem.sonoMenu ? { sonoMenu: null } : estado.nuvem.excluir ? { excluir: null } : estado.nuvem.conectar ? { conectar: null } : { criar: null } });
    focarGatilho(volta);
    return;
  }
  // ADA-245: o Esc fecha o diálogo de remover (fora do envio) e devolve o foco ao "…"; a tela de Fim só sai pelo "Fechar".
  if (estado.removerUi.dialogo) {
    ev.stopPropagation();
    void ACOES["rm-fechar"]?.(document.body);
    return;
  }
  if (estado.removerUi.fim && estado.onboardingTexto && estado.espaco.secao === "maquinas") {
    ev.stopPropagation();
    return;
  }
  const u = estado.contasUi;
  const mudanca = u.confirmar ? { confirmar: null } : u.desconectar ? { desconectar: null } : u.menu || u.maquinaMenu ? { menu: null, maquinaMenu: null } : u.renomear ? { renomear: null } : u.maquinaRenomear ? { maquinaRenomear: null } : null;
  if (!mudanca) return;
  ev.stopPropagation();
  const volta = gatilhoDoDialogo();
  dispatch({ tipo: "contas-ui", mudanca });
  focarGatilho(volta);
}, true);

document.addEventListener("submit", (ev) => {
  const form = (ev.target as HTMLElement).closest<HTMLFormElement>("form[data-form]");
  if (!form) return;
  ev.preventDefault();
  const tratar = FORMS[form.dataset.form ?? ""];
  if (tratar) void tratar(form);
});

// Contador ao vivo da aprovação em lista e autocomplete de @menção.
document.addEventListener("change", (ev) => {
  const cb = ev.target as HTMLInputElement;
  // NOD-346: a foto escolhida na Minha conta.
  if (cb.dataset.actChange === "mc-foto-escolhida") { void telaMinhaConta.acoes["mc-foto-escolhida"]?.(cb); return; }
  // NOD-367: o seletor das Configurações (`select.lc-seletor`) troca pela ação de `data-act-change`, com o valor escolhido.
  if (cb instanceof HTMLSelectElement && cb.dataset.actChange) { void ACOES_CHANGE[cb.dataset.actChange]?.(cb.value, cb); return; }
  if (cb.id === "composer-arquivos") {
    adicionarArquivos([...(cb.files ?? [])]);
    cb.value = "";
    return;
  }
  // PR 2: a região e o tamanho escolhidos no "Criar" atravessam os redesenhos do tick (sem redesenhar agora).
  const campoCriar = cb.dataset.nuvemCriar;
  if ((campoCriar === "regiao" || campoCriar === "tamanho") && estado.nuvem.criar) {
    estado.nuvem.criar = { ...estado.nuvem.criar, [campoCriar]: cb.value };
    return;
  }
  if (cb.matches('select[name="frequencia"]')) {
    const horario = cb.closest("form")?.querySelector<HTMLInputElement>('input[name="horario"]');
    const intervalo = cb.value.startsWith("intervalo:") || cb.value === "hora";
    if (horario) { horario.disabled = intervalo; horario.required = !intervalo; horario.closest("label")!.hidden = intervalo; }
    return;
  }
  // ADR-102: o formulário "Adicionar conta" e o "sair das contas" do desconectar.
  if (cb.matches("[data-cl-nova-ia]")) {
    if (cb.value === "claude-cli" || cb.value === "codex-cli") contasDaPessoa.mudarNova({ ia: cb.value });
    return;
  }
  if (cb.matches("[data-cl-nova-maq]")) {
    const n = estado.contasUi.nova;
    if (n) contasDaPessoa.mudarNova({ maquinas: cb.checked ? [...new Set([...n.maquinas, cb.value])] : n.maquinas.filter((x) => x !== cb.value) });
    return;
  }
  if (cb.matches("[data-cl-nova-apelido]")) { contasDaPessoa.mudarNova({ apelido: cb.value }); return; }
  // NOD-94: "Escolher arquivo…" da chave SSH: lida aqui, vira a linha resumida (o texto não fica no input).
  if (cb.matches("[data-ssh-arquivo]")) {
    const arquivo = cb.files?.[0];
    cb.value = "";
    if (arquivo) void instalarSsh.chaveDoArquivo(arquivo);
    return;
  }
  // ADA-245: as duas caixas do "Remover o nod deste computador?" atravessam os redesenhos sem redesenhar agora.
  if (cb.matches("[data-rm-caixa]")) {
    const d = estado.removerUi.dialogo;
    if (d) estado.removerUi = { ...estado.removerUi, dialogo: cb.dataset.rmCaixa === "ias" ? { ...d, manterIas: !cb.checked } : { ...d, manterConexao: cb.checked } };
    // O parágrafo de um computador desligado muda com "Continuar ligado": só ele, sem redesenhar (o foco fica na caixa).
    const nd = estado.removerUi.dialogo;
    const p = document.getElementById("rm-texto");
    if (nd && p) p.textContent = textoDeRemover(nd.previa, { aqui: nd.aqui, manterConexao: nd.manterConexao }).texto;
    return;
  }
  if (cb.matches("[data-maq-sair-contas]")) {
    const q = estado.contasUi.desconectar;
    if (q) dispatch({ tipo: "contas-ui", mudanca: { desconectar: { ...q, sair: cb.checked } } });
    return;
  }
  // ADR-101 (NOD-211; NOD-308): o modo no limite e o apelido da conta nova. O opt-in corporativo saiu da tela.
  if (cb.matches("[data-conta-modo]")) {
    const ia = cb.dataset.contaModo;
    if (ehIa(ia) && (cb.value === "perguntar" || cb.value === "automatico")) void contasDoMac.definirModo(ia, cb.value);
    return;
  }
  if (cb.matches("[data-conta-apelido]")) {
    const ia = cb.dataset.contaApelido;
    if (ehIa(ia)) contasDoMac.digitarApelido(ia, cb.value);
    return;
  }
  if (cb.matches("[data-liberar-app], [data-liberar-nivel]")) {
    const card = cb.closest<HTMLElement>("[data-liberar]");
    if (card) atualizarCardLiberar(card);
    return;
  }
  if (!cb.matches("input[data-item]")) return;
  const raiz = cb.closest("[data-decisao]");
  const contador = raiz?.querySelector("[data-contador]");
  if (contador && raiz) contador.textContent = String(raiz.querySelectorAll("input[data-item]:checked").length);
});

// Colar um print no campo (⌘V) anexa; texto colado segue normal.
document.addEventListener("paste", (ev) => {
  if ((ev.target as HTMLElement).id !== "composer-texto" || !document.getElementById("composer-arquivos")) return;
  const arquivos = arquivosDaColagem(ev.clipboardData);
  if (arquivos.length === 0) return;
  ev.preventDefault();
  adicionarArquivos(arquivos);
});

// Arrastar sobre a conversa mostra onde soltar; só quando o composer aceita anexo.
let arrastando = 0;
const temArquivos = (ev: DragEvent) => [...(ev.dataTransfer?.types ?? [])].includes("Files");
function areaSoltar(visivel: boolean): void {
  const timeline = document.getElementById("timeline");
  let area = document.getElementById("anexo-soltar");
  if (!visivel) { area?.remove(); return; }
  if (area || !timeline) return;
  const nome = botGerido(estado.tela.tipo === "conversa" ? estado.tela.agenteId : undefined)?.nome ?? "o bot";
  area = document.createElement("div");
  area.id = "anexo-soltar";
  area.className = "anexo-soltar";
  // revisto em 2026-10-18 (plano "pergunta com botões"): com pergunta aberta o arquivo também entra — vai como mensagem comum.
  area.innerHTML = `<div><b>Solte para mandar para ${esc(nome)}</b><span>Imagens, PDF e arquivos de texto · até 10 MB cada</span></div>`;
  timeline.parentElement?.appendChild(area);
}
document.addEventListener("dragenter", (ev) => {
  // Revisão 4 do ADA-5: a pílula do Quadro trata o próprio soltar (composer-ligado.ts) e marca defaultPrevented.
  if (!soltarEhDoChat(ev, !!document.getElementById("composer-arquivos"))) return;
  arrastando += 1;
  areaSoltar(true);
});
document.addEventListener("dragover", (ev) => { if (soltarEhDoChat(ev, !!document.getElementById("composer-arquivos"))) ev.preventDefault(); });
document.addEventListener("dragleave", (ev) => {
  if (!temArquivos(ev)) return;
  arrastando = Math.max(0, arrastando - 1);
  if (arrastando === 0) areaSoltar(false);
});
document.addEventListener("drop", (ev) => {
  // ADA-5 (revisto em 2026-11-04, era a NOD-429 voltar à Conversa): no Quadro, a pílula anexa o que soltou e marca
  // defaultPrevented (composer-ligado.ts); aqui fica só o soltar do chat.
  if (!soltarEhDoChat(ev, !!document.getElementById("composer-arquivos"))) return;
  ev.preventDefault();
  arrastando = 0;
  areaSoltar(false);
  adicionarArquivos([...(ev.dataTransfer?.files ?? [])]);
});

// Busca vazia que perde o foco some sem re-render: trocar o DOM entre o mousedown e o click engoliria o
// clique na linha que a pessoa foi abrir.
document.addEventListener("focusout", (ev) => {
  const campo = ev.target as HTMLInputElement;
  if (campo.id !== "busca-bots") return;
  // NOD-379: no celular o campo é a própria barra flutuante da inicial; esconder a label sumiria com a barra. A lista
  // adiada enquanto ele tinha o foco se refaz, com ou sem texto.
  if (campo.closest(".inicio-busca")) { redesenharAdiada(); return; }
  if (campo.value.trim()) return;
  buscaAberta = false;
  campo.closest("label")?.setAttribute("hidden", "");
  // NOD-119: a barra aberta por cima da conversa (recolhida + busca) volta a recolher. Se o foco foi para dentro da barra
  // (o clique numa linha), quem recolhe é o abrir-conversa: encolher agora tiraria a linha de baixo do clique.
  const para = ev.relatedTarget;
  if (!(para instanceof Node && document.getElementById("sidebar")?.contains(para))) redesenharSidebar();
});

// NOD-368 (celular = CONSULTA_CELULAR, revisão 3): o toque longo numa linha de Agentes marca o bot e liga a seleção; no modo seleção, tocar na
// linha marca e desmarca. Os botões da linha (a caixa, o "…", o Tentar de novo) seguem com a ação deles.

let toqueLongoLote: { timer: number; x: number; y: number; id: string } | null = null;
let engolirCliqueLote = false;
document.addEventListener("pointerdown", (ev) => {
  // Revisão 1 (#8): um toque novo zera o "engolir o próximo clique" que um toque longo sem clique deixou ligado.
  engolirCliqueLote = false;
  const linha = (ev.target as HTMLElement).closest?.<HTMLElement>("#espaco .cfg-agentes .lote-linha");
  if (!linha || (ev.target as HTMLElement).closest("button") || !ehCelular()) return;
  const id = linha.dataset.loteId;
  if (!id || estado.configUi.lote.selecionados.includes(id)) return;
  const timer = window.setTimeout(() => {
    toqueLongoLote = null;
    engolirCliqueLote = true;
    gravarLote({ ...marcarLote(estado.configUi.lote, id), selecionando: true });
    anunciarSelecaoDoLote();
    navigator.vibrate?.(10);
  }, 500);
  toqueLongoLote = { timer, x: ev.clientX, y: ev.clientY, id };
});
const soltarToqueLongo = (): void => { if (toqueLongoLote) { window.clearTimeout(toqueLongoLote.timer); toqueLongoLote = null; } };
document.addEventListener("pointerup", soltarToqueLongo);
document.addEventListener("pointercancel", soltarToqueLongo);
document.addEventListener("pointermove", (ev) => { if (toqueLongoLote && Math.hypot(ev.clientX - toqueLongoLote.x, ev.clientY - toqueLongoLote.y) > 10) soltarToqueLongo(); });
document.addEventListener("contextmenu", (ev) => { if (engolirCliqueLote && (ev.target as HTMLElement).closest?.(".lote-linha")) ev.preventDefault(); });
document.addEventListener("click", (ev) => {
  const linha = (ev.target as HTMLElement).closest?.<HTMLElement>("#espaco .cfg-agentes .lote-linha");
  if (engolirCliqueLote) { engolirCliqueLote = false; if (linha) { ev.preventDefault(); ev.stopPropagation(); return; } }
  if (!linha || (ev.target as HTMLElement).closest("button") || !ehCelular()) return;
  if (!(linha.closest(".lote-ligado")) || !linha.dataset.loteId) return;
  gravarLote(marcarLote(estado.configUi.lote, linha.dataset.loteId));
  anunciarSelecaoDoLote();
}, true);

document.addEventListener("keydown", (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); abrirBusca(); return; }
  // NOD-42: ⌘F/Ctrl+F abre a busca na pílula; ⌘G/⇧⌘G andam (e abrem, se fechada). Fora da conversa, segue o padrão.
  // No Mac só o ⌘ (Ctrl+F é "avançar um caractere" no campo de texto do macOS).
  if ((NO_MAC ? ev.metaKey : ev.ctrlKey) && !ev.altKey && (ev.key.toLowerCase() === "f" || ev.key.toLowerCase() === "g") && podeBuscarNaConversa()) {
    ev.preventDefault();
    const g = ev.key.toLowerCase() === "g";
    acaoDaBusca(g ? (ev.shiftKey ? "anterior" : "proxima") : "abrir", "tecla");
    return;
  }
  // NOD-42: Esc com a busca aberta (foco fora dela, ex. no body ou na timeline) fecha a busca antes de fechar a task/tela.
  // Num campo (o composer, o ⌘K), no ditado e na gaveta, o Esc de lá vem antes (revisões do PR 560); o do composer fecha
  // a busca no fim da própria fila (lista da barra, citação, "Respondendo").
  if (ev.key === "Escape" && escFechaABusca({ aberta: buscaNaConversa.aberta(), camadaPorCima: camadaSobreABusca(), ditado: ditado.ativo(), emCampo: !!(ev.target as HTMLElement).closest?.("dialog, #detalhes, #faixa-trabalhos, input, textarea, select") })) { ev.preventDefault(); buscaNaConversa.fechar(true); return; }
  if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && ev.key.toLowerCase() === "d" && estado.sessao) { ev.preventDefault(); void agir(alternarModoDev); return; }
  // NOD-117: Novo bot, ir ao bot 1–9, anterior/próximo e a folha. Depois de ⌘K e ⌘⇧D, que seguem iguais.
  // Primeiro sem olhar o DOM (cada letra digitada passa aqui); só a tecla que pode ser atalho lê o contexto.
  // A repetição (tecla segurada) não age, mas também não vaza: Alt+2 segurado no Chrome do Linux trocaria de aba.
  const teclaSemRepetir = { code: ev.code, key: ev.key, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, isComposing: ev.isComposing, keyCode: ev.keyCode };
  if (estado.sessao && atalhoDoTeclado(teclaSemRepetir, { lugar: LUGAR_TECLADO, emCampo: false, dialogo: false, celular: false, paginas: quadroNaTela.totalDePaginas() })) {
    const alvo = ev.target as HTMLElement;
    const atalho = atalhoDoTeclado(teclaSemRepetir, {
      lugar: LUGAR_TECLADO,
      emCampo: !!alvo.closest?.(SELETOR_CAMPO),
      dialogo: !!document.querySelector(SELETOR_MODAL) || !!alvo.closest?.(SELETOR_MODAL) || telaLigacao.cheia() || telaOnboarding.cobre(),
      celular: ehCelular(),
      espaco: !!estado.espaco,
      ditando: ditado.ativo(),
      // Campo da gaveta (memória, missão e voz…): navegar a zeraria com o texto pela metade.
      editando: !!alvo.closest?.("#detalhes") && !!alvo.closest?.(SELETOR_CAMPO),
      // NOD-445: ⌘[ só é nosso com a pílula de mais de uma página; senão é o voltar do app/navegador.
      paginas: quadroNaTela.totalDePaginas(),
      // NOD-461: ⌥← → num campo com texto anda por palavra; no cabeçalho de coluna move a coluna (quem já usou ganha).
      ...contextoDaPilula(document, alvo, ev),
    });
    // Atalho reconhecido sempre para aqui: ⌘5 com 3 bots não faz nada (critério 2), em vez de cair no navegador.
    if (atalho) { ev.preventDefault(); if (!ev.repeat) void executarAtalho(atalho); return; }
  }
  if (ev.key === "Escape" && (ev.target as HTMLElement).id === "busca-bots") { fecharBusca(); return; }
  // ADR-095: Esc com o ditado aberto joga a gravação fora (no campo fica o que já estava escrito).
  if (ev.key === "Escape" && ditado.ativo() && !(ev.target as HTMLElement).closest?.("dialog")) { ev.preventDefault(); ditado.descartar(); return; }
  // Esc na ligação em tela cheia encolhe para a pílula; nunca desliga (definido em 2026-10-04).
  if (ev.key === "Escape" && telaLigacao.cheia() && !(ev.target as HTMLElement).closest?.("dialog")) { ev.preventDefault(); telaLigacao.encolher(); return; }
  // Chat limpo (PR 8): Esc dentro da pílula alargada fecha e devolve o foco a ela (web/lib/pilula-na-tela.ts).
  if (teclaNaPilula(ev.key, estado.faixaTrabalhosAberta !== null) === "fechar" && (ev.target as HTMLElement).closest?.("#faixa-trabalhos")) { ev.preventDefault(); dispatch({ tipo: "faixa-trabalhos", agenteId: null }); return; }
  // NOD-368: Esc fecha o seletor do lote (o foco volta ao botão que o abriu) antes de fechar Seu espaço.
  if (ev.key === "Escape" && estado.configUi.lote.aberto && document.querySelector(".lote-pop")) { ev.preventDefault(); fecharSeletorDoLote(); return; }
  // NOD-368: setas para cima e para baixo andam entre as opções do seletor (radiogroup), pulando as indisponíveis.
  if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && (ev.target as HTMLElement).closest?.(".lote-ops")) {
    const ops = [...document.querySelectorAll<HTMLElement>('.lote-ops [role="radio"]:not([aria-disabled="true"])')];
    const i = ops.indexOf(ev.target as HTMLElement);
    const prox = i < 0 ? (ev.key === "ArrowDown" ? ops[0] : ops.at(-1)) : ops[(i + (ev.key === "ArrowDown" ? 1 : ops.length - 1)) % ops.length];
    if (prox) { ev.preventDefault(); prox.focus(); }
    return;
  }
  // QA da NOD-370: com o confirmar aberto e o pedido andando, os botões dele ficam desativados e o foco cai no <body>; o Esc
  // não fecha Seu espaço por trás do diálogo.
  if (ev.key === "Escape" && estado.espaco && !(ev.target as HTMLElement).closest?.("dialog") && !document.querySelector("dialog[open]")) {
    ev.preventDefault();
    // NOD-85: na agenda, o Esc fecha antes o que está aberto (o mês, a busca, a folha ou a linha), um por vez.
    const ag = secaoAberta(estado) === "rotinas" ? escNaAgenda(estado.agenda.ui) : null;
    if (ag) {
      dispatch({ tipo: "agenda-ui", mudanca: ag.mudanca });
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`#espaco ${ag.foco}`)?.focus());
      return;
    }
    // NOD-383: no celular, Esc numa seção volta para a lista, como o ‹.
    if (escNoEspaco(celular.ativo(), estado) === "lista") void ACOES["cfg-lista"]?.(document.body);
    else fecharEspaco();
    return;
  }
  // definido em 2026-09-25 (revisão do PR #68): Esc fecha a gaveta do app e o "+ Dar acesso" do painel.
  if (ev.key === "Escape" && gavetaDeAcessos.confirmacao()) { ev.preventDefault(); gavetaDeAcessos.pedirConfirmacao(null); render(); document.querySelector<HTMLElement>(".acessos-lote [data-act=\"lote-acesso\"], .acessos-padrao [data-act=\"padrao-app\"]")?.focus(); return; }
  if (ev.key === "Escape" && estado.tela.tipo === "conectores" && estado.tela.gaveta && !celular.botsAbertos()) { ev.preventDefault(); void ACOES["fechar-gaveta"]?.(document.body); return; }
  // NOD-122: com a gaveta aberta o Tab dá a volta nela, em vez de sair para a barra do navegador.
  if (ev.key === "Tab" && gavetaMontada && !ev.altKey && !ev.metaKey && !ev.ctrlKey) {
    const gaveta = document.querySelector<HTMLElement>(".tela-conectores .gaveta");
    const focaveis = gaveta ? [...gaveta.querySelectorAll<HTMLElement>(FOCAVEIS_DA_GAVETA)].filter((el) => el.getClientRects().length > 0) : [];
    const alvo = voltaDoTab(focaveis.length, focaveis.indexOf(document.activeElement as HTMLElement), ev.shiftKey);
    if (alvo !== null) { ev.preventDefault(); focaveis[alvo]?.focus(); return; }
  }
  // Sem gaveta, Esc no Marketplace volta para onde a pessoa estava (definido em 2026-10-04) — menos digitando num campo.
  if (ev.key === "Escape" && estado.tela.tipo === "conectores" && estado.tela.voltar && !celular.botsAbertos() && !(ev.target as HTMLElement).closest?.("dialog, input, textarea, select")) { ev.preventDefault(); void ACOES["voltar-conexao"]?.(document.body); return; }
  // A tela da task (e a provisória de uma linha) fecha no Esc — menos com algo digitado no campo dela.
  // NOD-379: com a inicial do celular à vista, o Esc não age na tela escondida por baixo (Marketplace, Trabalho, linha).
  if (ev.key === "Escape" && (estado.tela.tipo === "trabalho" || estado.tela.tipo === "linha") && !celular.botsAbertos() && !buscaNaConversa.aberta() && !(ev.target as HTMLElement).closest?.("dialog, input, select, #detalhes") && !((ev.target as HTMLTextAreaElement).id === "composer-texto" && (ev.target as HTMLTextAreaElement).value.trim())) { ev.preventDefault(); fecharTask(); return; }
  // NOD-382: Esc na visão geral do perfil do celular volta à origem, como o ‹ (no campo do nome, o Esc só desfaz).
  if (ev.key === "Escape" && ehCelular() && estado.perfilCelular && !estado.gaveta && !estado.avatarAberto && (ev.target as HTMLElement).closest?.("#detalhes") && !(ev.target as HTMLElement).closest?.("input, textarea, dialog")) { ev.preventDefault(); fecharPerfil(); return; }
  // Esc dentro da gaveta, num nível interno, volta um nível (o mesmo ‹ do topo).
  if (ev.key === "Escape" && estado.gaveta && (ev.target as HTMLElement).closest?.("#detalhes")) { ev.preventDefault(); voltarNivel(); return; }
  const ta = ev.target as HTMLTextAreaElement;
  // O campo do cartão de "Sua vez" (plano "pergunta com botões", Parte 4): Enter envia, como o botão ao lado.
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && (ta as HTMLElement).closest?.(".pq-campo")) {
    ev.preventDefault();
    (ta as HTMLElement).closest(".pq-campo")?.querySelector<HTMLButtonElement>('[data-act="responder"]')?.click();
    return;
  }
  if (ta.id !== "composer-texto") return;
  if (teclaNaBarra(ev, ta)) { ev.preventDefault(); return; }
  // Esc com a caixa "Respondendo" à vista: a próxima mensagem vira mensagem comum (o mesmo × da caixa).
  if (ev.key === "Escape") {
    const alvo = conversaAtual();
    // ADR-113: com uma fala citada, o Esc tira a citação (o × da caixa) antes de qualquer outra coisa.
    if (alvo && estado.citacoes[alvo.conversaId]) {
      ev.preventDefault();
      dispatch({ tipo: "citar", conversaId: alvo.conversaId, citacao: null });
      return;
    }
    if (alvo && comCaixaRespondendo(alvo.conversaId)) {
      ev.preventDefault();
      escolherNoComposer(true);
      return;
    }
    if (escFechaABusca({ aberta: buscaNaConversa.aberta(), camadaPorCima: camadaSobreABusca(), ditado: ditado.ativo(), emCampo: false })) { ev.preventDefault(); buscaNaConversa.fechar(true); }
    return;
  }
  // ADA-5: a mesma decisão do Enter da pílula (teclaDoCampo, web/lib/composer.ts); o Esc do chat tem os ramos dele acima.
  if (teclaDoCampo(ev, { celular: celular.ativo(), valor: ta.value }) === "enviar") {
    ev.preventDefault();
    void enviarComposer();
  }
});

/**
 * NOD-367 (revisão 3): a busca de Agentes redesenha a lista e diz o resultado num nó vivo FIXO do index.html — o
 * role=status recriado pelo innerHTML a cada tecla não era anunciado com confiança.
 */
let anuncioDaBusca = 0;
function buscarAgentes(valor: string): void {
  dispatch({ tipo: "config-ui", mudanca: { busca: valor } });
  const texto = document.querySelector("#espaco .cfg-agentes [data-contagem-busca]")?.textContent ?? "";
  const vivo = document.getElementById("anuncio-config");
  if (!vivo) return;
  window.clearTimeout(anuncioDaBusca);
  anuncioDaBusca = window.setTimeout(() => { vivo.textContent = texto; }, 400);
}
document.addEventListener("compositionend", (ev) => {
  const el = ev.target;
  if (el instanceof HTMLInputElement && el.matches("[data-config-busca]")) buscarAgentes(el.value);
});
document.addEventListener("input", (ev) => {
  const ta = ev.target as HTMLTextAreaElement;
  // NOD-444: digitar no campo tira a sugestão da nova rotina.
  if ((ta as HTMLElement).id === "composer-texto") mostrarSugestaoRotina(false);
  if ((ta as HTMLElement).dataset?.actInput === "midia-audio-ir") { irNoAudio(ta as unknown as HTMLInputElement); return; }
  if ((ta as HTMLElement).matches?.("[data-agenda-busca]")) { dispatch({ tipo: "agenda-ui", mudanca: { busca: ta.value } }); return; }
  // O código do Claude atravessa o redesenho do cartão (o foco volta pelo `manterFocoDoCodigo`).
  const iaDoCodigo = (ta as HTMLElement).dataset?.iaCodigo;
  if (ehIa(iaDoCodigo)) { dispatch({ tipo: "ias-mac", mudanca: { codigo: { ...estado.iasMac.codigo, [iaDoCodigo]: ta.value } } }); return; }
  // ADR-102: o código do login na VM e o apelido da conta nova ficam guardados sem redesenhar a cada tecla.
  // NOD-346: o rascunho do perfil atravessa os redesenhos (a releitura da exportação, o tick).
  const rascunho = (ta as HTMLElement).dataset?.mcRascunho;
  if (rascunho) { telaMinhaConta.digitou(rascunho, ta.value); return; }
  const loginDoCodigo = (ta as HTMLElement).dataset?.clCodigo;
  if (loginDoCodigo) { contasDaPessoa.digitarCodigo(loginDoCodigo, ta.value); return; }
  if ((ta as HTMLElement).matches?.("[data-cl-nova-apelido]") && estado.contasUi.nova) { estado.contasUi.nova.apelido = ta.value; return; }
  // NOD-94: o endereço e o usuário vão para o estado sem redesenhar; frase, senha e sudo só para a memória do controlador.
  const sshCampo = (ta as HTMLElement).dataset?.sshCampo;
  if (sshCampo === "endereco" || sshCampo === "usuario") { instalarSsh.campo(sshCampo, ta.value); return; }
  const sshSegredo = (ta as HTMLElement).dataset?.sshSegredo;
  if (sshSegredo === "frase" || sshSegredo === "senha" || sshSegredo === "sudo") { instalarSsh.segredo(sshSegredo, ta.value); return; }
  // A chave colada: quando o bloco fecha (ou é uma .pub), vira a linha com o tipo e a impressão.
  if ((ta as HTMLElement).matches?.("[data-ssh-chave]")) {
    if (/-----END [A-Z ]*PRIVATE KEY-----/.test(ta.value) || /^(ssh-|ecdsa-|sk-)\S+ [A-Za-z0-9+/=]{20,}/.test(ta.value.trim())) { const texto = ta.value; ta.value = ""; void instalarSsh.colarChave(texto); }
    return;
  }
  // ADR-121 (NOD-92): os campos do "Dormir e acordar pelo Google" atravessam a releitura de Máquinas (a cada 30 s).
  const campoNuvem = (ta as HTMLElement).dataset?.nuvemCampo;
  if ((campoNuvem === "projeto" || campoNuvem === "zona" || campoNuvem === "nome") && estado.nuvem.conectar) { estado.nuvem.conectar[campoNuvem] = ta.value; return; }
  // NOD-367: a busca de Agentes redesenha a lista a cada tecla (o foco volta pelo data-manter-foco).
  // Revisão 2: no meio de uma composição (acento, IME) o redesenho perderia o texto montado; a busca anda no compositionend.
  if ((ta as HTMLElement).matches?.("[data-config-busca]")) { if (!(ev as InputEvent).isComposing) buscarAgentes(ta.value); return; }
  // Revisão 4: o seletor que salva sozinho (data-act-change, a máquina do bot) não deixa a gaveta "suja" — salvou ou repôs.
  if (ta.closest?.("#detalhes") && estado.gaveta && mudancaSujaAGaveta(ta)) gavetaSuja = chaveDaGaveta();
  if (ta.id === "busca-marketplace") {
    filtrarApps(ta.value);
    return;
  }
  if (ta.id === "busca-bots" || ta.id === "busca-destinatario") { filtrarBots(ta.value, ta.id === "busca-bots" ? "#sidebar" : ".contact-picker"); return; }
  if (ta.id !== "composer-texto") return;
  ajustarAltura(ta);
  atualizarParar();
  if (composerDe) rascunhos.guardar(composerDe, ta.value);
  atualizarBarra(ta);
  const caixa = document.getElementById("autocomplete");
  if (!caixa) return;
  const lista = sugestoesDaMencao(ta.value, ta.selectionStart, JSON.parse(ta.dataset.sugestoes ?? "[]") as string[]);
  caixa.hidden = lista.length === 0;
  caixa.innerHTML = htmlSugestoes(lista);
});

document.addEventListener("mousedown", (ev) => {
  const item = (ev.target as HTMLElement).closest<HTMLElement>(".barra-item");
  const campo = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  // ADA-5: a lista do composer da pílula (.qc-pil) é dela; aqui só a do #composer.
  if (item && campo && item.closest("#composer")) {
    ev.preventDefault();
    barraDoChat.escolherIndice(campo, Number(item.dataset.indice));
    return;
  }
  const sug = (ev.target as HTMLElement).closest<HTMLElement>(".sug");
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!sug || !ta || !sug.closest("#composer")) return;
  ev.preventDefault();
  escolherMencao(ta, sug.dataset.nome ?? "");
  const caixa = document.getElementById("autocomplete");
  if (caixa) caixa.hidden = true;
});

// definido em 2026-09-24 ("aviso no Mac"): a leitura feita com a janela atrás não carimbou vista_em
// (?ver=0); quando a pessoa volta, "Sua vez" é relida já contando como vista. O menu do app também pode
// ter mudado a preferência dos avisos.
function aoVoltarParaFrente(): void {
  if (!naFrente()) return;
  void canalAvisos.reler();
  if (suaVezSemVer && estado.sessao) dispatch({ tipo: "invalidar", quais: ["sua-vez"] });
  // O que chegou com a janela atrás fica com a linha "Novas" quando a pessoa volta (definido em 2026-09-29).
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala") linhaEm = t.conversaId;
  lerConversaDaTela();
}
window.addEventListener("focus", aoVoltarParaFrente);
document.addEventListener("visibilitychange", aoVoltarParaFrente);
// NOD-96: de volta à aba, o computador do bot relê na hora (escondida, a leitura para).
document.addEventListener("visibilitychange", () => { if (!document.hidden && estado.computadorPessoa) void lerComputadorAgora(); });
// ADR-094: voltar ao app (celular desbloqueado, aba à frente, janela em foco, rede de volta) só reabre o stream se ele
// caiu de fato ou ficou mudo além do prazo (NOD-254); o que se perdeu chega pelo replay do `since` ou, sem replay
// possível, pela releitura do aoReidratar. NOD-216/NOD-450: além disso, o stream que volta relê a barra, os turnos e os
// não lidos mesmo com o replay (acoesAoMudarConexao), como rede de segurança barata. `focus` porque no Mac a janela coberta pode voltar sem `visibilitychange`.
function retomarStream(): void {
  if (document.visibilityState === "visible" && navigator.onLine) live?.retomar();
}
document.addEventListener("visibilitychange", retomarStream);
// ADR-095: tela bloqueada ou app no fundo: o iPhone corta o microfone; a gravação é descartada e a pessoa sabe por quê.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !ditado.ativo()) return;
  ditado.descartar();
  avisarDitado("tela-bloqueou");
});
window.addEventListener("online", retomarStream);
window.addEventListener("pageshow", retomarStream);
window.addEventListener("focus", retomarStream);
// Outra aba recolheu ou abriu uma seção: esta acompanha (definido em 2026-10-04).
window.addEventListener("storage", (ev) => {
  if (ev.key !== CHAVE_SECOES_RECOLHIDAS) return;
  secoesRecolhidas = lerSecoesRecolhidas();
  render();
});

void boot();

// Exposto para inspeção manual no console (nunca como API): o estado atual e o agente da tela.
declare global {
  interface Window {
    nod?: { estado(): Estado; agente(): string | null };
  }
}
window.nod = { estado: () => estado, agente: () => agenteDaTela(estado) };

// Segurar um gatilho por MS_SEGURAR dispara a ação de data-segurar; o clique curto
// segue para o data-act normal. Mesma ideia do contextmenu abaixo: um gesto alternativo
// sobre um botão que já tem um clique primário.
// Fonte única do tempo do hold: o CSS lê --ms-segurar para a animação do anel,
// senão os dois relógios andam separados e o anel fecha fora de hora.
const MS_SEGURAR = 500;
document.documentElement.style.setProperty("--ms-segurar", `${MS_SEGURAR}ms`);
let segurando: { el: HTMLElement; timer: number; disparou: boolean } | null = null;

function encerrarSegurar(): boolean | undefined {
  if (!segurando) return;
  clearTimeout(segurando.timer);
  segurando.el.classList.remove("segurando");
  const disparou = segurando.disparou;
  segurando = null;
  return disparou;
}

document.addEventListener("pointerdown", (ev) => {
  if ((ev as PointerEvent).button !== 0) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (!el) return;
  encerrarSegurar();
  ultimoHoldDisparou = false;
  const acao = el.dataset.segurar ?? "";
  const alvo = { el, disparou: false } as { el: HTMLElement; timer: number; disparou: boolean };
  alvo.timer = window.setTimeout(() => {
    alvo.disparou = true;
    // O sidebar é regravado por innerHTML a cada frame do SSE: o botão de agora pode não
    // ser mais o nó em que o gesto começou. Tira a classe de quem estiver no DOM.
    for (const n of document.querySelectorAll<HTMLElement>(".segurando")) n.classList.remove("segurando");
    const fn = ACOES[acao];
    if (fn) void fn(alvo.el);
  }, MS_SEGURAR);
  segurando = alvo;
  el.classList.add("segurando");
});

// O click só deve navegar se o hold não completou. pointerup vem antes do click,
// então guardamos o resultado para o listener de click consultar. O pointerdown
// acima zera a marca: se o click não vier (o ponteiro saiu do botão antes de soltar),
// ela não pode sobrar e engolir o clique seguinte.
let ultimoHoldDisparou = false;
for (const evento of ["pointerup", "pointercancel"]) {
  document.addEventListener(evento, () => { ultimoHoldDisparou = encerrarSegurar() ?? ultimoHoldDisparou; });
}

// Arrastar para fora aborta o gesto. pointerleave não borbulha e o botão ganha pointer
// capture implícito no pointerdown, então ouvir no document não resolve: o jeito é medir
// a posição contra o retângulo do próprio botão.
document.addEventListener("pointermove", (ev) => {
  if (!segurando) return;
  const r = segurando.el.getBoundingClientRect();
  const dentro = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
  if (!dentro) encerrarSegurar();
});

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (el && ultimoHoldDisparou) { ev.preventDefault(); ev.stopPropagation(); }
  // Zera em qualquer clique, não só no do gatilho: se o próximo clique cair noutro
  // lugar, a marca não pode ficar pendurada esperando o clique seguinte no "+".
  ultimoHoldDisparou = false;
}, true);

// Equivalente de teclado do segurar: quem navega por teclado não consegue fazer o hold.
document.addEventListener("keydown", (ev) => {
  // ev.repeat: segurar a tecla repete o keydown, e sem essa guarda um toque
  // um pouco mais longo criaria vários agentes de uma vez.
  if (ev.repeat || !ev.shiftKey || (ev.key !== "Enter" && ev.key !== " ")) return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-segurar]");
  if (!el) return;
  ev.preventDefault();
  const acao = ACOES[el.dataset.segurar ?? ""];
  if (acao) void acao(el);
});

// O menu do bot na barra lateral: abre onde o cursor está; pelo teclado (Shift+F10, tecla de menu) o evento vem sem
// posição e o menu abre ao lado do bot.
document.addEventListener("contextmenu", (ev) => {
  // NOD-437: o clique direito no cabeçalho do time abre o mesmo menu do ⋯.
  const cab = (ev.target as HTMLElement).closest<HTMLElement>("#sidebar .time-cab");
  const idTime = cab?.querySelector<HTMLElement>("[data-time]")?.dataset.time;
  if (cab && idTime) {
    ev.preventDefault();
    abrirMenuDoTime(idTime, cab, ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : undefined);
    return;
  }
  const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-bot-contexto]");
  if (!row) return;
  ev.preventDefault();
  const a = botGerido(row.dataset.botContexto);
  const ponto = ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : undefined;
  // NOD-379: o Android dispara contextmenu no toque longo; o gesto nosso já abriu o menu. Se o do sistema vier antes
  // (espera menor que 450 ms), ele abre o menu do bot segurado direto, sem piscar o menu comum.
  if (Date.now() - ultimoToqueLongo < MS_CONTEXTMENU_DO_GESTO) return;
  if (celular.ativo() && row.closest("#sidebar")) { toqueLongo.esquecer(); abrirMenuSegurado(row); return; }
  if (a) abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, row, (acao) => acaoDoBot(a, acao), ponto);
});

// NOD-379 (protótipo nod-379 v3): no celular o ⋯ sai e o menu do bot abre no toque longo. O bot segurado sobe por cima do
// fundo desfocado (um clone sem foco, no mesmo lugar) e o menu nasce logo abaixo dele.
function abrirMenuSegurado(segurada: HTMLElement): boolean {
  const a = botGerido(segurada.dataset.botContexto);
  // A barra pode ter sido redesenhada durante a espera (frota, não lidos, mensagem nova): a linha segurada saiu do DOM e
  // a de agora é outra, com o mesmo bot no mesmo lugar (favorito ou lista).
  const row = segurada.isConnected ? segurada : linhaRedesenhada(segurada);
  if (!a || !row) return false;
  ultimoToqueLongo = Date.now();
  esconderDicaToqueLongo(true);
  navigator.vibrate?.(10);
  const r = row.getBoundingClientRect();
  row.classList.add("segurado");
  abrirMenu(a, a.ownerId === estado.sessao?.pessoaId, row, (acao) => acaoDoBot(a, acao), { x: r.left + 12, y: r.bottom + 8 });
  const d = document.getElementById("gestao-dialogo");
  if (!d) { row.classList.remove("segurado"); return false; }
  d.classList.add("menu-segurado");
  // Posicionado de novo já com os itens de 48 px: abaixo do bot se couber, senão acima; sem caber, rola por dentro. A
  // altura natural é a da lista mais a moldura do diálogo (preenchimento e borda), medida pelo estilo: o .bot-menu tem
  // max-height e o offsetHeight dele pode já vir cortado.
  const lista = d.querySelector<HTMLElement>('[role="menu"]');
  const cs = getComputedStyle(d);
  const moldura = ["paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"].reduce((soma, k) => soma + (parseFloat(cs[k as "paddingTop"]) || 0), 0);
  const lugar = lugarDoMenuSegurado({ topo: r.top, base: r.bottom }, lista ? lista.scrollHeight + moldura : d.offsetHeight, window.innerHeight);
  d.style.top = `${lugar.topo}px`;
  if (lista && lugar.alturaMaxima !== null) Object.assign(lista.style, { maxHeight: `${alturaDaLista(lugar.alturaMaxima, moldura, 0)}px`, overflowY: "auto" });
  const copia = row.cloneNode(true) as HTMLElement;
  copia.removeAttribute("data-bot-contexto");
  copia.classList.add("segurado-copia");
  for (const mais of copia.querySelectorAll(".bot-mais")) mais.remove();
  copia.inert = true;
  copia.setAttribute("aria-hidden", "true");
  Object.assign(copia.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  d.prepend(copia);
  d.addEventListener("close", () => row.classList.remove("segurado"));
  return true;
}
function linhaRedesenhada(segurada: HTMLElement): HTMLElement | null {
  const id = segurada.dataset.botContexto;
  if (!id) return null;
  const candidatas = [...document.querySelectorAll<HTMLElement>(`#sidebar [data-bot-contexto="${CSS.escape(id)}"]`)];
  return candidatas[escolherRedesenhada(segurada.className, candidatas.map((c) => c.className))] ?? null;
}
const toqueLongo = criarToqueLongo<HTMLElement>({ agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), agora: () => performance.now() }, abrirMenuSegurado);
document.addEventListener("pointerdown", (ev) => {
  const row = celular.ativo() && ev.pointerType !== "mouse" && ev.isPrimary ? (ev.target as HTMLElement).closest<HTMLElement>("#sidebar [data-bot-contexto]") : null;
  if (row) toqueLongo.comecar(row, ev.clientX, ev.clientY);
  else toqueLongo.esquecer();
}, true);
// NOD-85: no celular, segurar uma linha da agenda abre o menu dela (Ver na conversa, Testar, Pausar).
// ADA-19 (protótipo ada-2 v2, passo 2.6): segurar o ‹ da conversa abre a folha de recentes; o clique que vem depois do
// toque longo é engolido (não volta para Conversas). Shift+Enter e o menu de contexto abrem a mesma folha.
const toqueNoVoltar = criarToqueLongo<HTMLElement>({ agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), agora: () => performance.now() }, (bt) => {
  if (!bt.isConnected || !celular.ativo()) return false;
  navigator.vibrate?.(10);
  abrirRecentes(bt);
  return true;
});
document.addEventListener("pointerdown", (ev) => {
  const bt = (ev.target as HTMLElement).closest?.<HTMLElement>("#cabecalho .abrir-bots.voltar-bots");
  if (bt && celular.ativo()) toqueNoVoltar.comecar(bt, ev.clientX, ev.clientY);
  else toqueNoVoltar.esquecer();
}, true);
document.addEventListener("pointermove", (ev) => toqueNoVoltar.mover(ev.clientX, ev.clientY));
document.addEventListener("pointerup", () => toqueNoVoltar.soltar());
document.addEventListener("pointercancel", () => toqueNoVoltar.soltar());
document.addEventListener("click", (ev) => {
  if (toqueNoVoltar.engolirClique()) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
document.addEventListener("contextmenu", (ev) => {
  const bt = (ev.target as HTMLElement).closest?.<HTMLElement>("#cabecalho .abrir-bots.voltar-bots");
  if (!bt || !celular.ativo()) return;
  ev.preventDefault();
  abrirRecentes(bt);
});
document.addEventListener("keydown", (ev) => {
  const bt = (ev.target as HTMLElement).closest?.<HTMLElement>("#cabecalho .abrir-bots.voltar-bots");
  if (bt && ev.key === "Enter" && ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); abrirRecentes(bt); }
}, true);

const toqueNaAgenda = criarToqueLongo<HTMLElement>({ agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), agora: () => performance.now() }, (linha) => {
  const chave = linha.dataset.chave;
  if (!chave || !linha.isConnected) return false;
  navigator.vibrate?.(10);
  dispatch({ tipo: "agenda-ui", mudanca: { menu: chave, aberto: null } });
  // QA do PR #595 (B5): o menu do toque longo recebe o foco no primeiro item.
  requestAnimationFrame(() => document.querySelector<HTMLElement>('#espaco .ag-menu [role="menuitem"]')?.focus());
  return true;
});
document.addEventListener("pointerdown", (ev) => {
  const linha = celular.ativo() && ev.pointerType !== "mouse" && ev.isPrimary ? (ev.target as HTMLElement).closest<HTMLElement>('#espaco .ag-cel [data-act="agenda-linha"]') : null;
  if (linha) toqueNaAgenda.comecar(linha, ev.clientX, ev.clientY);
  else toqueNaAgenda.esquecer();
}, true);
document.addEventListener("pointermove", (ev) => toqueNaAgenda.mover(ev.clientX, ev.clientY));
document.addEventListener("pointerup", () => toqueNaAgenda.soltar());
document.addEventListener("pointercancel", () => toqueNaAgenda.soltar());
document.addEventListener("click", (ev) => {
  if (toqueNaAgenda.engolirClique()) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
// QA do PR #632 (bug 2): no celular, segurar o cabeçalho do time abre o menu dele (o iOS não dispara contextmenu), e
// soltar o dedo depois não recolhe o time.
const toqueNoTime = criarToqueLongo<HTMLElement>({ agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (id) => clearTimeout(id), agora: () => performance.now() }, (cab) => {
  const idTime = cab.querySelector<HTMLElement>("[data-time]")?.dataset.time;
  const atual = idTime ? document.querySelector<HTMLElement>(`#sidebar .secao-cab[data-time="${CSS.escape(idTime)}"]`)?.closest<HTMLElement>(".time-cab") : null;
  if (!idTime || !atual) return false;
  navigator.vibrate?.(10);
  abrirMenuDoTime(idTime, atual);
  return true;
});
document.addEventListener("pointerdown", (ev) => {
  const cab = celular.ativo() && ev.pointerType !== "mouse" && ev.isPrimary ? (ev.target as HTMLElement).closest<HTMLElement>("#sidebar .time-cab") : null;
  if (cab?.querySelector("[data-time]")) toqueNoTime.comecar(cab, ev.clientX, ev.clientY);
  else toqueNoTime.esquecer();
}, true);
document.addEventListener("pointermove", (ev) => toqueNoTime.mover(ev.clientX, ev.clientY));
document.addEventListener("pointerup", () => toqueNoTime.soltar());
document.addEventListener("pointercancel", () => toqueNoTime.soltar());
document.addEventListener("click", (ev) => {
  if (toqueNoTime.engolirClique()) { ev.preventDefault(); ev.stopPropagation(); }
}, true);
document.addEventListener("pointermove", (ev) => toqueLongo.mover(ev.clientX, ev.clientY));
document.addEventListener("pointerup", () => toqueLongo.soltar());
document.addEventListener("pointercancel", () => toqueLongo.soltar());
// O clique que vem depois do gesto não abre a conversa por baixo do menu.
document.addEventListener("click", (ev) => {
  if (toqueLongo.engolirClique()) { ev.preventDefault(); ev.stopPropagation(); }
}, true);

// A dica "Segure um bot para ver as ações" aparece uma vez só, na inicial: some no ✕, em 6 s ou no primeiro toque longo.
function armazenamento(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}
function esconderDicaToqueLongo(marcar: boolean): void {
  clearTimeout(timerDica);
  document.querySelector(".dica-toque-longo")?.remove();
  if (marcar) marcarDicaVista(armazenamento());
}
function mostrarDicaToqueLongo(): void {
  if (!celular.botsAbertos() || document.querySelector(".dica-toque-longo") || dicaJaVista(armazenamento())) return;
  if (!document.querySelector("#sidebar .inicio-linha, #sidebar .fixado")) return;
  // ADA-19: com a tab bar na inicial não há dica de gesto (plano e protótipo ada-2: "sem dica para ensinar gesto").
  if (document.querySelector("#sidebar .tab-bar-celular")) return;
  const dica = document.createElement("div");
  dica.className = "dica-toque-longo";
  dica.setAttribute("role", "status");
  dica.innerHTML = `<span>Segure um bot para ver as ações</span><button type="button" aria-label="Fechar a dica">✕</button>`;
  dica.querySelector("button")!.addEventListener("click", () => esconderDicaToqueLongo(true));
  document.body.append(dica);
  // Vista ao aparecer: entrar numa conversa antes dos 6 s não a traz de volta.
  marcarDicaVista(armazenamento());
  timerDica = window.setTimeout(() => esconderDicaToqueLongo(false), MS_DICA);
}

// ---- times de bots na barra (NOD-437, protótipo aprovado) ---------------------------------------------------------------
// Criar, renomear, excluir (com Desfazer), reordenar (⌥↑/⌥↓, menu ou arrastando o cabeçalho), recolher (gravado na
// conta) e mover vários bots de uma vez. A regra pura mora em web/lib/times-da-barra.ts; aqui só o DOM e o servidor.
type BotDaFrota = NonNullable<typeof estado.frota>["agentes"][number];

/** Os times como a barra os desenha agora (a mesma conta do renderSidebar). */
function timesNaBarra(): TimeDaBarra<BotDaFrota>[] {
  const { comuns } = gruposDaBarra(estado.frota?.agentes ?? [], estado.sessao?.pessoaId ?? "", celular.ativo());
  return timesComBots(comuns.filter((a) => !a.fixado), estado.frota?.times);
}

/** O bot com outro time (null = Sem time: sem `secao`). */
function comSecao(a: BotDaFrota, secao: string | null): BotDaFrota {
  const { secao: _antes, ...resto } = a;
  return secao ? { ...resto, secao } : resto;
}

const chaveDeTela = (t: { nome: string; semTime: boolean }): string => `time:${t.semTime ? "" : chaveDoTime(t.nome)}`;

/** Muda os times da frota na hora: a barra se redesenha sem esperar o servidor (a frota relida confirma). */
function trocarFrota(fn: (f: NonNullable<typeof estado.frota>) => Partial<NonNullable<typeof estado.frota>>): void {
  const f = estado.frota;
  if (f) dispatch({ tipo: "hidratar-frota", frota: { ...f, ...fn(f) } });
}

/** Grava no servidor; com erro, mostra e relê a frota (a barra volta ao que está gravado). */
async function gravarTime(fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); } catch (e) { mostrarErro(e); }
  dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
}

/** O foco no cabeçalho, no ⋯ ou no campo do nome sobrevive à barra redesenhada (a frota relida, o recolher). */
type FocoDoTime = { tipo: "cab" | "mais"; chave: string } | { tipo: "campo"; alvo: string; ini: number | null; fim: number | null } | null;
function focoDoTime(): FocoDoTime {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !a.closest("#sidebar")) return null;
  if (a instanceof HTMLInputElement && a.dataset.timeCampo) return { tipo: "campo", alvo: a.dataset.timeCampo, ini: a.selectionStart, fim: a.selectionEnd };
  const chave = a.closest(".time-cab")?.querySelector<HTMLElement>(".secao-cab")?.dataset.chave;
  if (!chave || !(a.classList.contains("secao-cab") || a.classList.contains("time-mais"))) return null;
  return { tipo: a.classList.contains("time-mais") ? "mais" : "cab", chave };
}
function devolverFocoDoTime(f: FocoDoTime): void {
  if (!f) return;
  if (f.tipo !== "campo") { focarTime(f.chave, f.tipo === "mais"); return; }
  const c = document.querySelector<HTMLInputElement>(`#sidebar [data-time-campo="${CSS.escape(f.alvo)}"]`);
  if (c && document.activeElement !== c) { c.focus({ preventScroll: true }); c.setSelectionRange(f.ini, f.fim); }
}
function focarTime(chave: string, mais = false): boolean {
  const cab = document.querySelector<HTMLElement>(`#sidebar .secao-cab[data-chave="${CSS.escape(chave)}"]`);
  const alvo = mais ? cab?.parentElement?.querySelector<HTMLElement>(".time-mais") : cab;
  if (alvo && document.activeElement !== alvo) alvo.focus({ preventScroll: true });
  return !!alvo;
}

function recolherTime(id: string, recolhido?: boolean): void {
  const t = estado.frota?.times?.find((x) => x.id === id);
  if (!t || !api) return;
  const novo = recolhido ?? !t.recolhido;
  if (novo === t.recolhido) return;
  trocarFrota((f) => ({ times: f.times?.map((x) => (x.id === id ? { ...x, recolhido: novo } : x)) }));
  // Revisão 2 do PR #632 (M): os dois cliques do duplo clique (que renomeia) não viram dois PATCHes em corrida. O PATCH
  // espera um instante, sai só com o estado final e só se ele mudou; a fila por time garante a ordem (web/lib/recolher-adiado).
  recolherAdiado.pedir(id, t.recolhido, novo);
}
const recolherAdiado = criarRecolherAdiado(
  (id, recolhido) => gravarTime(() => api!.recolherTime(id, recolhido)),
  { agendar: (fn, ms) => window.setTimeout(fn, ms), cancelar: (t) => window.clearTimeout(t) },
);
// Revisão 4 do PR #632: quem recolhe e recarrega logo em seguida não perde o recolher.
window.addEventListener("pagehide", () => recolherAdiado.enviarJa());

function comecarEdicaoDoTime(alvo: string, valor: string): void {
  limparSelecao(false);
  edicaoTime = { alvo, valor };
  render();
  const c = document.querySelector<HTMLInputElement>(`#sidebar [data-time-campo="${CSS.escape(alvo)}"]`);
  if (!c) return;
  c.focus();
  c.select();
  c.scrollIntoView({ block: "nearest" });
}

function cancelarEdicaoDoTime(): void {
  const e = edicaoTime;
  if (!e) return;
  edicaoTime = null;
  render();
  const t = timesNaBarra().find((x) => x.id === e.alvo);
  if (!t || !focarTime(chaveDeTela(t))) document.querySelector<HTMLElement>("#sidebar .novo-time")?.focus();
}

let confirmandoTime = false;
async function confirmarEdicaoDoTime(): Promise<void> {
  const e = edicaoTime;
  if (!e || !api || confirmandoTime) return;
  const nome = nomeLimpo(e.valor);
  const times = timesNaBarra();
  const proprio = e.alvo === "novo" ? undefined : e.alvo;
  const atual = times.find((t) => t.id === proprio);
  if (!nome || (atual && nome === atual.nome)) { cancelarEdicaoDoTime(); return; }
  const aviso = avisoDoNome(nome, times, proprio);
  if (aviso?.existente) {
    // Nome repetido: o Enter leva até o time que já existe (aberto), em vez de criar outro.
    const ex = times.find((t) => t.id === aviso.existente?.id);
    edicaoTime = null;
    if (ex?.id && ex.recolhido) recolherTime(ex.id, false);
    render();
    if (ex) focarTime(chaveDeTela(ex));
    anunciarGestao(`O time ${aviso.existente.nome} já existe.`);
    return;
  }
  if (aviso) { anunciarGestao(aviso.texto); return; }
  confirmandoTime = true;
  try {
    if (!atual) {
      const r = await api.criarTime({ nome });
      edicaoTime = null;
      trocarFrota((f) => ({ times: [...(f.times ?? []).filter((t) => t.id !== r.time.id), { ...r.time, semTime: false }] }));
      focarTime(`time:${chaveDoTime(r.time.nome)}`);
      anunciarGestao(`Time ${r.time.nome} criado.`);
    } else {
      const r = await api.renomearTime(atual.id ?? "", nome);
      edicaoTime = null;
      const membros = new Set(atual.bots.map((b) => b.id));
      trocarFrota((f) => ({ times: f.times?.map((t) => (t.id === atual.id ? { ...t, nome: r.time.nome } : t)), agentes: f.agentes.map((a) => (membros.has(a.id) ? { ...a, secao: r.time.nome } : a)) }));
      focarTime(`time:${chaveDoTime(r.time.nome)}`);
      anunciarGestao(`Time renomeado para ${r.time.nome}.`);
    }
  } catch (err) {
    mostrarErro(err);
  } finally {
    confirmandoTime = false;
  }
  dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
}

function acaoDoTime(id: string, acao: AcaoDoTime): void {
  const times = timesNaBarra();
  const i = times.findIndex((t) => t.id === id);
  const t = times[i];
  if (!t || !api) return;
  if ((acao === "renomear" || acao === "excluir") && t.semTime) { anunciarGestao(NOTA_SEM_TIME); return; }
  if (acao === "renomear") { comecarEdicaoDoTime(id, t.nome); return; }
  if (acao === "excluir") { void excluirTimeDaBarra(t); return; }
  const destino = destinoAoMover(i, times.length, acao);
  if (destino === null) { anunciarGestao(`${nomeDoTime(t)} já é o ${acao === "subir" ? "primeiro" : "último"} time.`); return; }
  moverTime(id, destino);
}

function moverTime(id: string, destino: number): void {
  const ids = (estado.frota?.times ?? []).map((x) => x.id);
  if (!ids.includes(id) || ids.indexOf(id) === destino || !api) return;
  const ordem = ids.filter((x) => x !== id);
  ordem.splice(destino, 0, id);
  trocarFrota((f) => ({ times: ordem.map((x, posicao) => ({ ...(f.times ?? []).find((y) => y.id === x)!, posicao })) }));
  const t = estado.frota?.times?.find((x) => x.id === id);
  if (t) { focarTime(chaveDeTela(t)); anunciarGestao(fraseDoMovido(nomeDoTime(t), destino, ordem.length)); }
  void gravarTime(() => api!.ordenarTime(id, destino));
}

/** Excluir não pergunta (decisão da Ada): os bots vão para o Sem time, na mesma ordem, e o aviso traz Desfazer. */
async function excluirTimeDaBarra(t: TimeDaBarra<BotDaFrota>): Promise<void> {
  const id = t.id;
  if (!id || !api) return;
  const gravado = estado.frota?.times?.find((x) => x.id === id);
  const times = timesNaBarra();
  const i = times.findIndex((x) => x.id === id);
  const vizinho = times[i + 1] ?? times[i - 1];
  try {
    const r = await api.excluirTime(id);
    const membros = new Set(r.bots.map((b) => b.id));
    trocarFrota((f) => ({ times: f.times?.filter((x) => x.id !== id), agentes: f.agentes.map((a) => (membros.has(a.id) ? comSecao(a, null) : a)) }));
    if (!vizinho || !focarTime(chaveDeTela(vizinho))) document.querySelector<HTMLElement>("#sidebar .novo-time")?.focus();
    const texto = fraseDoExcluido(t.nome, r.bots.map((b) => b.nome));
    anunciarGestao(texto);
    mostrarAvisoDesfazer({
      texto,
      aoDesfazer: () => gravarTime(() => api!.criarTime({ nome: t.nome, posicao: gravado?.posicao, recolhido: gravado?.recolhido ?? false, bots: r.bots.map((b) => b.id) })),
    });
  } catch (e) {
    mostrarErro(e);
  }
  dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
}

/** O menu de um item: as setas andam pelos botões habilitados; abre no cursor (clique direito) ou ao lado da âncora. */
function abrirMenuDaBarra(html: string, ancora: HTMLElement | null, ponto: { x: number; y: number } | undefined, aoEscolher: (b: HTMLButtonElement) => void, folha = false): HTMLDialogElement {
  const d = dialogo(html, true);
  if (folha) d.classList.add("pfc-folha");
  else {
    const r = ancora?.getBoundingClientRect();
    const x = ponto ? ponto.x + 4 : (r?.right ?? 12);
    const y = ponto ? ponto.y + 4 : (r?.top ?? 12);
    d.style.left = `${Math.max(12, Math.min(x, window.innerWidth - d.offsetWidth - 12))}px`;
    d.style.top = `${Math.max(12, Math.min(y, window.innerHeight - d.offsetHeight - 12))}px`;
  }
  d.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button:not([disabled])");
    if (b) { d.close(); aoEscolher(b); }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const itens = [...d.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
    const atual = itens.indexOf(document.activeElement as HTMLButtonElement);
    const proximo = e.key === "Home" ? 0 : e.key === "End" ? itens.length - 1 : (atual + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
    itens[proximo]?.focus();
  });
  d.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  return d;
}

/** O ⋯ do time (e o clique direito no cabeçalho): Renomear, Mover para cima/baixo, Excluir time. O Sem time só se move. */
function abrirMenuDoTime(id: string, ancora: HTMLElement, ponto?: { x: number; y: number }): void {
  const times = timesNaBarra();
  const i = times.findIndex((t) => t.id === id);
  const t = times[i];
  if (!t) return;
  const nome = nomeDoTime(t);
  const itens = itensDoMenuDoTime(t, i, times.length).map((it) => `${it.perigo ? "<hr>" : ""}<button type="button" role="menuitem" data-acao-time="${it.acao}"${it.perigo ? ' class="danger"' : ""}${it.desabilitado ? " disabled" : ""}>${esc(it.texto)}</button>`).join("");
  const nota = t.semTime ? `<hr><p class="menu-nota">${esc(NOTA_SEM_TIME)}</p>` : "";
  abrirMenuDaBarra(`<div role="menu" aria-label="Ações do time ${esc(nome)}"><p class="menu-nome">${esc(nome)}</p>${itens}${nota}</div>`, ancora, ponto, (b) => acaoDoTime(id, b.dataset.acaoTime as AcaoDoTime));
}

/** "Para qual time?": os times, com o de agora marcado, e "+ Novo time" (no celular, a folha que sobe). */
function abrirEscolhaDeTime(ids: string[], ancora: HTMLElement | null, nomeDoBot?: string): void {
  if (!ids.length || !api) return;
  const times = timesNaBarra();
  const agentes = estado.frota?.agentes ?? [];
  const chaves = new Set(ids.map((x) => chaveDoTime(agentes.find((a) => a.id === x)?.secao ?? "")));
  const atual = chaves.size === 1 ? [...chaves][0] : null;
  const titulo = ids.length === 1 && nomeDoBot ? `Time · ${nomeDoBot}` : "Para qual time?";
  const opcoes = times.map((t) => {
    const marcado = (t.semTime ? "" : chaveDoTime(t.nome)) === atual;
    return `<button type="button" role="menuitemradio" aria-checked="${marcado}" data-time-destino="${esc(t.semTime ? "" : t.nome)}">${esc(nomeDoTime(t))}${marcado ? ' <span aria-hidden="true">✓</span>' : ""}</button>`;
  }).join("");
  abrirMenuDaBarra(`<div role="menu" aria-label="${esc(titulo)}"><p class="menu-nome">${esc(titulo)}</p>${opcoes}<hr><button type="button" role="menuitem" data-time-novo>+ Novo time</button></div>`, ancora, undefined, (b) => {
    if (b.hasAttribute("data-time-novo")) { pedirNovoTimeCom(ids); return; }
    const destino = b.dataset.timeDestino ?? "";
    if (chaveDoTime(destino) !== atual) moverBots(ids, destino);
  }, celular.ativo());
}

function moverBots(ids: string[], time: string): void {
  if (!api) return;
  const nomes = ids.map((x) => estado.frota?.agentes.find((a) => a.id === x)?.nome ?? "").filter(Boolean);
  const alvo = timesNaBarra().find((t) => !t.semTime && chaveDoTime(t.nome) === chaveDoTime(time));
  const secao = time === "" ? null : (alvo?.nome ?? nomeLimpo(time));
  const movidos = new Set(ids);
  trocarFrota((f) => ({ agentes: f.agentes.map((a) => (movidos.has(a.id) ? { ...comSecao(a, secao), fixado: false } : a)) }));
  if (alvo?.id && alvo.recolhido) recolherTime(alvo.id, false);
  limparSelecao(false);
  void agir(async () => {
    await mudarGestao(() => api!.moverBotsParaTime(ids, time));
    anunciarGestao(`${juntarNomes(nomes)} ${nomes.length === 1 ? "foi" : "foram"} para ${secao ?? "Sem time"}.`);
  });
}

/** O time novo já com bots (arrastar até "+ Novo time" ou "Novo time" na escolha). Nome repetido move para o que existe. */
function pedirNovoTimeCom(ids: string[]): void {
  const nomes = ids.map((x) => botGerido(x)?.nome ?? "").filter(Boolean);
  const quem = nomes.length > 3 ? `${nomes.length} bots` : juntarNomes(nomes) || "O bot";
  pedirGestao("Novo time", `<p>${esc(quem)} ${nomes.length > 1 ? "vão" : "vai"} para o time novo.</p><label>Nome do time<input name="time" required maxlength="60" placeholder="Produto" autocomplete="off" /></label>`, "Criar time", async (d) => {
    const nome = nomeLimpo(String(d.get("time") ?? ""));
    if (!nome) return;
    const aviso = avisoDoNome(nome, timesNaBarra());
    if (aviso?.existente) { moverBots(ids, aviso.existente.nome); return; }
    if (aviso) throw new Error(aviso.texto);
    limparSelecao(false);
    await mudarGestao(() => api!.criarTime({ nome, bots: ids }));
  });
}

function limparSelecao(anunciar: boolean): void {
  if (!selecaoBots.size) return;
  selecaoBots = new Set();
  ancoraSelecao = null;
  render();
  if (anunciar) anunciarGestao("Seleção limpa.");
}

function alternarSelecao(id: string, o: { alternar: boolean; intervalo: boolean }): void {
  const ordem = [...document.querySelectorAll<HTMLElement>("#sidebar .time .bot-row:not(.escondida)")].map((n) => n.dataset.botContexto ?? "");
  const r = selecionar({ atual: selecaoBots, ancora: ancoraSelecao, ordem, id, ...o });
  selecaoBots = r.selecao;
  ancoraSelecao = r.ancora;
  render();
  document.querySelector<HTMLElement>(`#sidebar [data-bot-contexto="${CSS.escape(id)}"] .row`)?.focus({ preventScroll: true });
  anunciarGestao(selecaoBots.size ? textoDaSelecao(selecaoBots.size) : "Seleção limpa.");
}

/** Os bots que mudaram de time entre duas leituras da frota: na barra, eles piscam de leve (o outro aparelho vê a mudança). */
function destacarMovidos(antes: readonly BotDaFrota[] | undefined, depois: readonly BotDaFrota[]): void {
  if (!antes) return;
  const era = new Map(antes.map((a) => [a.id, chaveDoTime(a.secao ?? "")]));
  const ids = depois.filter((a) => era.has(a.id) && era.get(a.id) !== chaveDoTime(a.secao ?? "")).map((a) => a.id);
  if (!ids.length) return;
  window.setTimeout(() => {
    for (const id of ids) {
      const el = document.querySelector<HTMLElement>(`#sidebar [data-bot-contexto="${CSS.escape(id)}"]`);
      if (!el) continue;
      el.classList.add("recem-movido");
      window.setTimeout(() => el.classList.remove("recem-movido"), 1600);
    }
  }, 30);
}

/**
 * Os recolhidos de antes (deste navegador) vão para a conta e saem do localStorage. A chave cuja seção ainda não virou
 * time espera a próxima frota (depois do sincronizar), para não perder o recolhido (revisão 2 do PR #632, A).
 */
const recolhidosEmVoo = new Set<string>();
function migrarRecolhidos(frota: NonNullable<Estado["frota"]>): TimeNaLista[] {
  const times = frota.times ?? [];
  const pessoaId = estado.sessao?.pessoaId;
  if (migrouRecolhidos || !pessoaId || !api) return [...times];
  const antigas = new Set([...secoesRecolhidas].filter((k) => !recolhidosEmVoo.has(k)));
  const m = recolhidosParaMigrar(antigas, pessoaId, times, { descartarOrfas: !temTimeProvisorio(frota) });
  if (m.restam === 0) migrouRecolhidos = true;
  if (!m.chaves.length) return [...times];
  for (const k of m.chaves) recolhidosEmVoo.add(k);
  const cliente = api;
  // A chave antiga só sai depois de a conta gravar (revisão do PR #632, L2): falhou, a próxima sessão tenta de novo.
  void Promise.all(m.ids.map((id) => cliente.recolherTime(id, true))).then(() => {
    for (const k of m.chaves) secoesRecolhidas = definirSecaoRecolhida(secoesRecolhidas, k, false);
  }).catch(() => {}).finally(() => { for (const k of m.chaves) recolhidosEmVoo.delete(k); });
  return times.map((t) => (m.ids.includes(t.id) ? { ...t, recolhido: true } : t));
}

function temTimeProvisorio(frota: NonNullable<Estado["frota"]>): boolean {
  return provisoriosDaBarra(frota).length > 0;
}

/** As chaves dos times que a barra desenha sem id (a seção que ainda não virou time); o Sem time sozinho não conta. */
function provisoriosDaBarra(frota: NonNullable<Estado["frota"]>): string[] {
  const { comuns } = gruposDaBarra(frota.agentes, estado.sessao?.pessoaId ?? "", celular.ativo());
  const times = timesComBots(comuns.filter((a) => !a.fixado), frota.times);
  if (times.length <= 1) return [];
  return times.filter((t) => t.id === null).map((t) => (t.semTime ? "" : chaveDoTime(t.nome)));
}

/**
 * A frota só lê os times (revisão do PR #632, A1): a seção que ainda não virou time (o servidor de antes, a conta que
 * nunca mudou um time) a barra desenha como provisória, sem ⋯ — e pede uma vez por sessão que o servidor a materialize.
 */
// Revisão 3: cada chave provisória pede uma vez (o time que o Nod cria depois da primeira leitura também materializa).
const timesSincronizados = new Set<string>();
function sincronizarTimesSePreciso(frota: NonNullable<Estado["frota"]>): void {
  if (!api || !frota.times) return;
  const novas = provisoriosDaBarra(frota).filter((c) => !timesSincronizados.has(c));
  if (!novas.length) return;
  for (const c of novas) timesSincronizados.add(c);
  void api.sincronizarTimes().then(() => dispatch({ tipo: "invalidar", quais: ["frota"] })).catch(() => {
    // Revisão 4: a falha (rede, 5xx) não marca a chave como resolvida; a próxima frota tenta de novo.
    for (const c of novas) timesSincronizados.delete(c);
  });
}

document.addEventListener("input", (ev) => {
  const c = ev.target;
  if (!(c instanceof HTMLInputElement) || !c.dataset.timeCampo || !edicaoTime) return;
  edicaoTime = { ...edicaoTime, valor: c.value };
  const aviso = document.getElementById("time-nome-aviso");
  if (aviso) aviso.textContent = avisoDoNome(c.value, timesNaBarra(), edicaoTime.alvo === "novo" ? undefined : edicaoTime.alvo)?.texto ?? "";
});
// Sair do campo confirma (como o nome na gaveta); vazio ou igual, cancela. A barra redesenhada devolve o foco ao campo novo.
document.addEventListener("focusout", (ev) => {
  const c = ev.target;
  if (!(c instanceof HTMLInputElement) || !c.dataset.timeCampo) return;
  window.setTimeout(() => {
    const agora = document.activeElement;
    if (!edicaoTime || confirmandoTime || (agora instanceof HTMLInputElement && agora.dataset.timeCampo)) return;
    void confirmarEdicaoDoTime();
  }, 0);
});
document.addEventListener("keydown", (ev) => {
  const alvo = ev.target as HTMLElement;
  if (alvo instanceof HTMLInputElement && alvo.dataset.timeCampo) {
    if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); void confirmarEdicaoDoTime(); }
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancelarEdicaoDoTime(); }
    return;
  }
  const cab = alvo.closest?.<HTMLElement>("#sidebar .secao-cab[data-time]");
  if (cab?.dataset.time) {
    const acao = atalhoDoCabecalho(ev);
    if (acao) { ev.preventDefault(); ev.stopPropagation(); acaoDoTime(cab.dataset.time, acao); }
    return;
  }
  // ⌘/Ctrl+Espaço no bot alterna a seleção (o clique com ⌘/Ctrl pelo teclado); Esc na barra limpa.
  const row = alvo.closest?.<HTMLElement>("#sidebar .time .bot-row");
  if (row && ev.key === " " && (ev.metaKey || ev.ctrlKey) && !celular.ativo()) { ev.preventDefault(); alternarSelecao(row.dataset.botContexto ?? "", { alternar: true, intervalo: false }); return; }
  if (ev.key === "Escape" && selecaoBots.size && alvo.closest?.("#sidebar")) { ev.preventDefault(); ev.stopPropagation(); limparSelecao(true); }
}, true);
// ⌘/Ctrl+clique alterna um bot; Shift+clique pega o intervalo. O clique simples abre a conversa e desfaz a seleção.
document.addEventListener("click", (ev) => {
  if (celular.ativo()) return;
  const alvo = ev.target as HTMLElement;
  const row = alvo.closest?.<HTMLElement>("#sidebar .time .bot-row");
  if (!row || alvo.closest(".bot-mais")) return;
  const alternar = ev.metaKey || ev.ctrlKey;
  if (!alternar && !ev.shiftKey) { if (selecaoBots.size) limparSelecao(false); return; }
  ev.preventDefault();
  ev.stopPropagation();
  alternarSelecao(row.dataset.botContexto ?? "", { alternar, intervalo: ev.shiftKey && !alternar });
}, true);
// O duplo clique no nome do time renomeia: quem detecta é o "recolher-time" (ehCliqueDuplo), porque o primeiro clique
// redesenha a barra e o navegador não dispara dblclick (QA do PR #632, bug 1).
let ultimoCliqueNoTime: { id: string; em: number } | null = null;

// Arrastar o cabeçalho reordena os times (no computador); a linha mostra onde ele cai.
let arrastandoTime: string | null = null;
let antesDoTime = -1;
function encerrarArrastoDeTime(): void {
  arrastandoTime = null;
  antesDoTime = -1;
  for (const n of document.querySelectorAll("#sidebar .linha-insercao")) n.remove();
  for (const n of document.querySelectorAll("#sidebar .time.origem-arrasto")) n.classList.remove("origem-arrasto");
}
document.addEventListener("dragstart", (ev) => {
  const cab = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar [data-time-arrastavel]");
  if (!cab || !ev.dataTransfer) return;
  arrastandoTime = cab.dataset.timeArrastavel ?? null;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("application/x-nod-time", arrastandoTime ?? "");
  window.requestAnimationFrame(() => cab.closest(".time")?.classList.add("origem-arrasto"));
});
document.addEventListener("dragover", (ev) => {
  if (!arrastandoTime) return;
  const sec = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar .time[data-time-id]");
  if (!sec) return;
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  const secs = [...document.querySelectorAll<HTMLElement>("#sidebar .time[data-time-id]")];
  const r = sec.getBoundingClientRect();
  const antes = secs.indexOf(sec) + (ev.clientY > r.top + r.height / 2 ? 1 : 0);
  if (antes === antesDoTime) return;
  antesDoTime = antes;
  for (const n of document.querySelectorAll("#sidebar .linha-insercao")) n.remove();
  const marca = document.createElement("div");
  marca.className = "linha-insercao linha-time";
  marca.setAttribute("aria-hidden", "true");
  const ref = secs[antes];
  if (ref) ref.before(marca);
  else secs[secs.length - 1]?.after(marca);
});
document.addEventListener("drop", (ev) => {
  if (!arrastandoTime) return;
  ev.preventDefault();
  const id = arrastandoTime;
  const ids = [...document.querySelectorAll<HTMLElement>("#sidebar .time[data-time-id]")].map((n) => n.dataset.timeId ?? "");
  const antes = antesDoTime;
  encerrarArrastoDeTime();
  if (antes < 0) return;
  moverTime(id, ordemAoSoltarTime(ids, id, antes).destino);
});
document.addEventListener("dragend", () => { if (arrastandoTime) encerrarArrastoDeTime(); });

// ---- arrastar na barra lateral (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") ---------------------------------
// Soltar na grade fixa, numa seção move, em "+ Nova seção" pede o nome. A barra se reorganiza na hora (frotaAoSoltar) e o
// servidor recebe a ordem inteira do grupo de destino (0041). Esc ou soltar fora devolve o bot: o navegador cancela o arrasto.
let arrastandoBot: string | null = null;
let alvoArrasto: { destino: Destino | "nova"; indice: number; el: HTMLElement } | null = null;

function limparIndicadores(): void {
  for (const n of document.querySelectorAll("#sidebar .vaga-fixar, #sidebar .linha-insercao")) n.remove();
  for (const n of document.querySelectorAll("#sidebar .alvo-soltar")) n.classList.remove("alvo-soltar");
}

function encerrarArrasto(): void {
  if (!arrastandoBot) return;
  limparIndicadores();
  document.getElementById("sidebar")?.classList.remove("arrastando-bot");
  for (const n of document.querySelectorAll("#sidebar .origem-arrasto")) n.classList.remove("origem-arrasto");
  // A seção aberta só pelo arrasto volta a recolher: o render abaixo não a refaz quando o HTML não mudou. Se o bot foi
  // solto nela, o drop já a abriu de vez e o render desenha a seção aberta.
  for (const s of document.querySelectorAll("#sidebar [data-aberta-no-arrasto]")) {
    s.removeAttribute("data-aberta-no-arrasto");
    s.setAttribute("data-recolhida", "");
    for (const n of s.querySelectorAll(":scope > [data-escondida-no-arrasto]")) { n.removeAttribute("data-escondida-no-arrasto"); n.classList.add("escondida"); }
  }
  arrastandoBot = null;
  alvoArrasto = null;
  if (quadroDaRolagem) cancelAnimationFrame(quadroDaRolagem);
  quadroDaRolagem = 0;
  render();
}

/**
 * Rolagem automática enquanto se arrasta (definido em 2026-10-06, web/lib/arrastar.ts): com o cursor perto da borda da
 * lista, ou em cima do rodapé ou da busca, a lista rola um passo por quadro. O dragover chega a cada ~50 ms mesmo com o
 * cursor parado e só guarda a posição; o laço anda e se reagenda enquanto a lista ainda tem para onde rolar.
 * NOD-122: não para com "Reduzir movimento": não é enfeite, é a pessoa levando o bot até uma linha fora da vista, e a
 * rolagem só anda enquanto o cursor fica na borda (como a rolagem do próprio navegador ao arrastar).
 */
let cursorDoArrasto = { x: 0, y: 0 };
let quadroDaRolagem = 0;

function rolarNoArrasto(x: number, y: number): void {
  cursorDoArrasto = { x, y };
  if (!quadroDaRolagem) quadroDaRolagem = requestAnimationFrame(passoDaRolagem);
}

function passoDaRolagem(): void {
  quadroDaRolagem = 0;
  const lista = document.querySelector<HTMLElement>("#sidebar .list");
  const barra = document.getElementById("sidebar")?.getBoundingClientRect();
  if (!arrastandoBot || !lista || !barra) return;
  const { x, y } = cursorDoArrasto;
  if (x < barra.left || x > barra.right) return;
  const caixa = lista.getBoundingClientRect();
  const passo = velocidadeAutoRolagem(y, caixa.top, caixa.bottom);
  if (passo === 0) return;
  const antes = lista.scrollTop;
  lista.scrollTop = antes + passo;
  if (lista.scrollTop !== antes) quadroDaRolagem = requestAnimationFrame(passoDaRolagem);
}

/** O índice é contado entre os OUTROS bots do grupo; a vaga e a linha não entram na conta, então não oscilam. */
function marcarAlvo(grupo: HTMLElement, x: number, y: number): void {
  if (grupo.dataset.grupo === "nova-secao") {
    if (alvoArrasto?.el === grupo) return;
    limparIndicadores();
    grupo.classList.add("alvo-soltar");
    alvoArrasto = { destino: "nova", indice: 0, el: grupo };
    return;
  }
  const fixados = grupo.dataset.grupo === "fixados";
  const itens = [...grupo.querySelectorAll<HTMLElement>(fixados ? ":scope > .fixado" : ":scope > .bot-row")].filter((n) => n.dataset.arrastavel !== arrastandoBot);
  let indice = itens.length;
  for (const [i, n] of itens.entries()) {
    const r = n.getBoundingClientRect();
    if (fixados ? y < r.top || (y <= r.bottom && x < r.left + r.width / 2) : y < r.top + r.height / 2) { indice = i; break; }
  }
  if (alvoArrasto?.el === grupo && alvoArrasto.indice === indice) return;
  limparIndicadores();
  alvoArrasto = { destino: fixados ? { grupo: "fixados" } : { grupo: "secao", secao: grupo.dataset.secao ?? "" }, indice, el: grupo };
  const antesDe = itens[indice] ?? (fixados ? grupo.querySelector(".fixados-vazio") : null);
  const marca = document.createElement("div");
  marca.setAttribute("aria-hidden", "true");
  if (fixados) { marca.className = "vaga-fixar"; marca.textContent = "Fixar"; } else { marca.className = "linha-insercao"; grupo.classList.add("alvo-soltar"); }
  grupo.insertBefore(marca, antesDe);
}

function soltarBot(id: string, destino: Destino, indice: number): void {
  const frota = estado.frota;
  const pessoaId = estado.sessao?.pessoaId;
  if (!frota || !pessoaId || !api) return;
  const ordem = ordemAoSoltar(frota.agentes, pessoaId, id, destino, indice);
  dispatch({ tipo: "hidratar-frota", frota: { ...frota, agentes: frotaAoSoltar(frota.agentes, id, destino, ordem) } });
  void agir(async () => {
    await mudarGestao(() => api!.organizarAgente(id, destino.grupo === "fixados" ? { fixado: true, ordem } : { fixado: false, secao: destino.secao, ordem }));
  });
}

function pedirNovaSecao(id: string): void {
  pedirNovoTimeCom([id]);
}

document.addEventListener("dragstart", (ev) => {
  const el = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar [data-arrastavel]");
  if (!el || !ev.dataTransfer) return;
  arrastandoBot = el.dataset.arrastavel ?? null;
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData("application/x-nod-bot", arrastandoBot ?? "");
  // O fantasma é uma cópia do bot com sombra, fora da tela: o navegador fotografa e ela sai no mesmo quadro.
  const r = el.getBoundingClientRect();
  const fantasma = el.cloneNode(true) as HTMLElement;
  fantasma.classList.add("fantasma-arrasto");
  fantasma.style.width = `${r.width}px`;
  document.body.append(fantasma);
  ev.dataTransfer.setDragImage(fantasma, ev.clientX - r.left, ev.clientY - r.top);
  window.setTimeout(() => fantasma.remove(), 0);
  // A origem esmaece e os alvos aparecem só depois da foto do fantasma.
  window.requestAnimationFrame(() => {
    if (arrastandoBot !== el.dataset.arrastavel) return;
    el.classList.add("origem-arrasto");
    document.getElementById("sidebar")?.classList.add("arrastando-bot");
  });
});
document.addEventListener("dragover", (ev) => {
  if (!arrastandoBot) return;
  rolarNoArrasto(ev.clientX, ev.clientY);
  const grupo = (ev.target as HTMLElement).closest?.<HTMLElement>("#sidebar [data-grupo]");
  if (!grupo) {
    if (alvoArrasto) { limparIndicadores(); alvoArrasto = null; }
    return;
  }
  ev.preventDefault();
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
  // Seção recolhida abre ao passar com o bot (definido em 2026-10-04): as linhas aparecem e a posição de soltar é medida
  // nelas — escondidas, todas mediam zero e o bot ia sempre para o fim. Ao fim do arrasto, encerrarArrasto desfaz.
  if (grupo.hasAttribute("data-recolhida")) {
    grupo.removeAttribute("data-recolhida");
    grupo.setAttribute("data-aberta-no-arrasto", "");
    for (const n of grupo.querySelectorAll(":scope > .bot-row.escondida")) { n.classList.remove("escondida"); n.setAttribute("data-escondida-no-arrasto", ""); }
  }
  marcarAlvo(grupo, ev.clientX, ev.clientY);
});
document.addEventListener("drop", (ev) => {
  if (!arrastandoBot) return;
  ev.preventDefault();
  const id = arrastandoBot;
  const alvo = alvoArrasto;
  // Soltou numa seção recolhida: ela fica aberta, para o bot não sumir da vista.
  const idTime = alvo && alvo.destino !== "nova" && alvo.destino.grupo === "secao" ? alvo.el.dataset.timeId : undefined;
  if (idTime && estado.frota?.times?.find((t) => t.id === idTime)?.recolhido) recolherTime(idTime, false);
  encerrarArrasto();
  if (!alvo) return;
  if (alvo.destino === "nova") pedirNovaSecao(id);
  else soltarBot(id, alvo.destino, alvo.indice);
});
document.addEventListener("dragend", () => encerrarArrasto());

// ---- Máquinas (ADR-090): conectar uma VM por código e escolher onde cada bot trabalha --------------------------------------
function abrirCodigoDeMaquinaGuardado(): void {
  let codigo: string | null = null;
  try { codigo = window.sessionStorage.getItem(CHAVE_CODIGO_MAQUINA); window.sessionStorage.removeItem(CHAVE_CODIGO_MAQUINA); } catch { /* sem storage */ }
  if (!codigo || !estado.sessao) return;
  abrirEspaco("maquinas");
  const guardado = codigo;
  void chavesAtuais().then((chavesAntes) => dispatch({ tipo: "conectar-maquina", conectar: { passo: "codigo", codigo: guardado, pedido: null, erro: null, chavesAntes, marcados: [] } }));
}
/** NOD-455: o link /quadros/:qid guardado no boot abre a tela (que mostra "sem acesso" a quem não participa). */
function abrirQuadroGuardado(): void {
  let qid: string | null = null;
  try { qid = window.sessionStorage.getItem(CHAVE_QUADRO_LINK); window.sessionStorage.removeItem(CHAVE_QUADRO_LINK); } catch { /* sem storage */ }
  void lerCompartilhados();
  if (qid && estado.sessao && api) navegar({ tipo: "quadro-compartilhado", quadroId: qid });
}

/** O diálogo de escolha do link que acha duas tarefas; fechar sem tocar responde null. */
function escolherTarefa(codigo: string, opcoes: OpcaoDeTarefaDto[]): Promise<OpcaoDeTarefaDto | null> {
  return new Promise((responder) => {
    let escolhida: OpcaoDeTarefaDto | null = null;
    const d = dialogo(htmlEscolherTarefa(codigo, opcoes));
    d.addEventListener("click", (e) => {
      const i = (e.target as HTMLElement).closest<HTMLElement>("[data-escolher-tarefa]")?.dataset.escolherTarefa;
      if (i === undefined) return;
      escolhida = opcoes[Number(i)] ?? null;
      d.close();
    });
    d.addEventListener("close", () => responder(escolhida));
  });
}
/**
 * NOD-416 (ADR-144): o link da tarefa guardado no boot. O código (o atual ou o de antes de mudar de quadro) diz o bot; a
 * frota chega depois da sessão, então espera por ele um pouco. A tarefa abre em tela cheia no Quadro.
 */
async function abrirTarefaGuardada(): Promise<void> {
  let codigo: string | null = null;
  try { codigo = window.sessionStorage.getItem(CHAVE_TAREFA_LINK); window.sessionStorage.removeItem(CHAVE_TAREFA_LINK); } catch { /* sem storage */ }
  if (!codigo || !estado.sessao || !api) return;
  try {
    const achado = await api.tarefaPorCodigo(codigo);
    // Revisão do PR #630: o código de uma tarefa do quadro que também é o id do Linear de outra: a pessoa escolhe.
    const r = "ambigua" in achado ? await escolherTarefa(codigo, achado.ambigua) : achado;
    if (!r) return;
    // Revisão 2 do PR #623: espera a lista de bots chegar (não o teto inteiro) e, sem o bot nela, diz em vez de calar.
    const bot = await botDoLink(() => botGerido(r.agenteId), () => !!estado.frota, (ms) => new Promise((ok) => window.setTimeout(ok, ms)));
    if (!bot) {
      dispatch({ tipo: "erro", erro: { codigo: "nao_encontrado", mensagem: `A tarefa ${codigo} é de um bot que não está na sua lista (excluído, oculto ou de outra pessoa).`, status: 404 } });
      return;
    }
    navegar({ tipo: "conversa", conversaId: bot.conversaId, agenteId: bot.id });
    quadroNaTela.abrirTarefa(bot.id, r.tarefaId, r.quadroId);
  } catch (e) {
    // Código que não existe (ou de outra pessoa: a RLS dá 404): diz qual; o resto (rede) segue o erro de sempre.
    if (e instanceof ErroApi && e.status === 404) dispatch({ tipo: "erro", erro: { codigo: e.codigo, mensagem: `Tarefa ${codigo} não encontrada.`, status: 404 } });
    else mostrarErro(e);
  }
}
/** ADR-121 (NOD-92): a volta do Google guardada no boot abre Máquinas com o aviso (a conta é relida até o preparo acabar). */
function abrirVoltaDaNuvemGuardada(): void {
  let volta: string | null = null;
  try { volta = window.sessionStorage.getItem(CHAVE_VOLTA_NUVEM); window.sessionStorage.removeItem(CHAVE_VOLTA_NUVEM); } catch { /* sem storage */ }
  if ((volta !== "preparando" && volta !== "recusado") || !estado.sessao) return;
  abrirEspaco("maquinas");
  dispatch({ tipo: "nuvem-ui", mudanca: { aviso: volta, conta: null } });
}
/** ADR-121 (NOD-92): o OAuth do Google começa por POST e a página vai para a `url` que volta (desvio 1). */
async function irParaOGoogle(pedido: Parameters<NonNullable<typeof api>["entrarNoGoogle"]>[0]): Promise<void> {
  const { url } = await api!.entrarNoGoogle(pedido);
  window.location.assign(url);
}
/** As chaves de máquina da pessoa agora (relê do servidor e hidrata a seção). */
async function chavesAtuais(): Promise<string[]> {
  const dados = await api!.maquinas().catch(() => estado.maquinas ?? { maquinas: [], padraoId: null });
  dispatch({ tipo: "hidratar-maquinas", maquinas: dados });
  return dados.maquinas.map((m) => m.id);
}
/** Depois do "Conectar", a chave nova aparece quando o motor troca o código (a cada 5 s): relê até ela aparecer, por 2 min. */
async function esperarMaquinaNova(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const c = estado.conectarMaquina;
    if (!c || !api) return;
    const dados = await api.maquinas().catch(() => null);
    if (dados) dispatch({ tipo: "hidratar-maquinas", maquinas: dados });
    const nova = estado.conectarMaquina ? maquinaNova(estado, estado.conectarMaquina) : null;
    // Na tela das IAs, continua relendo até o Claude Code ficar pronto (a pessoa está logando no terminal).
    if (nova && (estado.conectarMaquina?.passo !== "ias" || estado.conectarMaquina.convite || nova.ias["claude-cli"] === "pronto")) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}
/** ADR-102 (CMJ): com o convite no comando, a tela confere a cada 2 s se a máquina já pediu para entrar. */
const INTERVALO_CONVITE_MS = 2_000;
async function esperarConvite(convite: string, ate: number): Promise<void> {
  while (Date.now() < ate) {
    await new Promise((r) => setTimeout(r, INTERVALO_CONVITE_MS));
    const c = estado.conectarMaquina;
    if (!c || c.convite !== convite || !api) return;
    if (c.passo !== "comando") continue;
    const r = await api.verConvite(convite).catch((e: unknown) => (e instanceof ErroApi && e.status === 404 ? "vencido" as const : e instanceof ErroApi && e.status === 409 ? "conflito" as const : null));
    if (r === "vencido") { atualizarConectar({ erro: "O convite venceu. Feche e abra o Conectar de novo para gerar outro." }); return; }
    if (r === "conflito") { atualizarConectar({ erro: "Duas máquinas usaram este convite, então ele foi cancelado por segurança. Feche e abra o Conectar de novo para gerar outro." }); return; }
    if (r?.estado === "chegou") { atualizarConectar({ passo: "confirmar", codigo: r.codigo, pedido: r.pedido, erro: null }); return; }
  }
}
function atualizarConectar(p: Partial<NonNullable<typeof estado.conectarMaquina>>): void {
  const c = estado.conectarMaquina;
  if (c) dispatch({ tipo: "conectar-maquina", conectar: { ...c, ...p } });
}

// ---- NOD-96: o computador do bot v2 (um computador por pessoa) ----------------------------------------------------------
/**
 * A web lê GET /computador sozinha: 5 s normalmente, 1 s com operação ou ligando, 60 s quando a rota não existe
 * (NOD_COMPUTADORES desligado: tudo fica como antes). Com a aba escondida, não lê. Sem frame próprio no SSE (o PR 5
 * pode trazer um; aí basta invalidar daqui).
 */
let computadorTimer = 0;
let computadorGeracao = 0;
/** NOD-407: a repetição do Acordar depois de um 409 transitório (web/lib/retry-computador.ts). */
const retryDoAcordar = new RetryDoAcordar({ setTimeout: (f, ms) => window.setTimeout(f, ms), clearTimeout: (id) => window.clearTimeout(id) });
function cancelarRetryDoComputador(): void {
  retryDoAcordar.cancelar();
}
function lerComputadorAgora(): Promise<void> {
  window.clearTimeout(computadorTimer);
  const minha = ++computadorGeracao;
  return pulsoDoComputador(minha).catch(() => undefined);
}
async function pulsoDoComputador(minha: number): Promise<void> {
  if (minha !== computadorGeracao || !api) return;
  if (!document.hidden) {
    const lido = await api.computadorDaPessoa();
    if (minha !== computadorGeracao) return;
    // NOD-407: com o retry em curso, o "dormindo" do servidor é a ação anterior terminando; a aba segue em Acordando….
    const dto = mascararDormindo(lido, retryDoAcordar.emCurso);
    dispatch({ tipo: "hidratar-computador-pessoa", dto, agora: Date.now() });
  }
  const c = estado.computadorPessoa;
  const ms = !c ? 60_000 : c.operacao || c.estado === "ligando" ? 1_000 : 5_000;
  computadorTimer = window.setTimeout(() => void pulsoDoComputador(minha), ms);
}
/** NOD-365: muda o computador de máquina. A troca segue em segundo plano; o progresso vem pela leitura do computador. */
function trocarLugarDoComputador(maquinaId: string, semLogins: boolean): Promise<void> {
  if (!maquinaId) return Promise.resolve();
  // NOD-407: a troca mata a repetição pendente do Acordar (ela religaria a máquina de antes no meio da troca).
  cancelarRetryDoComputador();
  dispatch({ tipo: "computador-ui", ui: { trocarPara: null, recusaDaTroca: null, etapasAbertas: secaoAberta(estado) === "maquinas" } });
  window.clearTimeout(computadorTimer);
  ++computadorGeracao;
  return agir(async () => {
    try {
      await api!.trocarLugarDoComputador(maquinaId, semLogins);
    } catch (e) {
      // A origem sem contato não é erro de tela: a recusa fica na linha da máquina, com o link "Trocar sem os logins".
      if (e instanceof ErroApi && e.codigo === "origem_sem_contato") {
        // A frase do servidor é fixa; o nome da máquina de agora vem da própria seção (o servidor não põe dado na frase).
        const atual = estado.computadorPessoa?.lugares?.find((l) => l.atual)?.nome;
        dispatch({ tipo: "computador-ui", ui: { recusaDaTroca: { maquinaId, texto: atual ? `${atual} está sem contato. Ligue-a para levar os logins.` : e.message } } });
        return;
      }
      throw e;
    } finally {
      await lerComputadorAgora();
      focarNovo();
    }
  });
}

const passosDoRetry: PassosDoRetry = {
  tentar: () => (api ? api.operarComputador("tentar_de_novo") : Promise.reject(new Error("sem sessão"))),
  ler: () => lerComputadorAgora(),
  recusar: (recusa) => dispatch({ tipo: "computador-ui", ui: { recusa } }),
};

function operarComputador(op: OperacaoPessoa): Promise<void> {
  // Um clique da pessoa começa outra cadeia: a repetição pendente da anterior morre.
  const minhaCadeia = retryDoAcordar.cancelar();
  const longa = op === "atualizar" || op === "redefinir" || op === "sair_de_todos" || op === "esquecer_senhas";
  dispatch({ tipo: "computador-ui", ui: { confirmar: null, realce: null, recusa: null, etapasAbertas: longa && secaoAberta(estado) === "maquinas" } });
  // Uma leitura que saiu antes do POST chegaria sem a operação e apagaria o diálogo de etapas: a geração nova a descarta.
  window.clearTimeout(computadorTimer);
  ++computadorGeracao;
  // Acordar reage na hora (29/10): a gaveta mostra "Acordando…" antes de o servidor confirmar; a leitura seguinte corrige.
  if ((op === "acordar" || op === "tentar_de_novo") && estado.computadorPessoa) dispatch({ tipo: "hidratar-computador-pessoa", dto: { ...estado.computadorPessoa, estado: "ligando", falha: null }, agora: Date.now() });
  return agir(async () => {
    let repetir: number | null = null;
    try {
      await api!.operarComputador(op);
    } catch (e) {
      // NOD-407: o 409 do computador traz a causa real; ela fica na aba Computador, não no banner vermelho do chat.
      if ((op === "acordar" || op === "tentar_de_novo") && e instanceof ErroApi && e.status === 409) {
        // Transitório: repete com espera crescente (2, 4, 8, 16 s); passados ~30 s, o Tentar de novo volta à pessoa.
        if (!retryDoAcordar.viva(minhaCadeia)) return;
        repetir = retryDoAcordar.esperaPara(e, 0);
        if (repetir === null) dispatch({ tipo: "computador-ui", ui: { recusa: e.message } });
        return;
      }
      throw e;
    } finally {
      if (retryDoAcordar.viva(minhaCadeia)) retryDoAcordar.emCurso = repetir !== null;
      // O diálogo de etapas só existe quando a leitura traz a operação: o foco vai para ele depois dela.
      await lerComputadorAgora();
      if (repetir !== null && retryDoAcordar.viva(minhaCadeia)) {
        // A leitura pode ainda dizer dormindo enquanto a ação anterior termina; para a pessoa, segue como uma espera.
        const mascarado = mascararDormindo(estado.computadorPessoa, true);
        if (mascarado && mascarado !== estado.computadorPessoa) dispatch({ tipo: "hidratar-computador-pessoa", dto: mascarado, agora: Date.now() });
        retryDoAcordar.agendar(minhaCadeia, 1, repetir, passosDoRetry);
      }
      if (longa) focarNovo();
    }
  });
}

/** O tema escolhido no seletor de Configurações › Geral. */
function escolherTema(valor: string | undefined): EscolhaTema {
  const escolha: EscolhaTema = valor === "claro" || valor === "escuro" ? valor : "sistema";
  aplicarTema(escolha, document.documentElement);
  // No app do Mac o localStorage some a cada conexão: o tema também vai para o processo principal (nativeTheme).
  void window.nodDesktop?.definirTema?.(escolha).catch(() => undefined);
  return escolha;
}

/** NOD-367: as trocas dos seletores das Configurações (`data-act-change`), com o valor escolhido. */
const ACOES_CHANGE: Record<string, (valor: string, el: HTMLSelectElement) => Promise<void> | void> = {
  "escolher-tema": (valor) => { escolherTema(valor); },
  // NOD-367: a máquina padrão (Máquinas) e a do bot (ficha dele), no mesmo seletor; "" = qualquer uma.
  "maquina-padrao": (valor, el) => agir(salvarOuRepor(() => reporSeletor(el), async () => {
    await api!.maquinaPadrao(valor || null);
    dispatch({ tipo: "invalidar", quais: ["maquinas"] });
  })),
  "maquina-do-bot": (valor, el) => agir(salvarOuRepor(() => reporSeletor(el), async () => {
    await api!.maquinaDoBot(el.dataset.id ?? "", valor || null);
    dispatch({ tipo: "invalidar", quais: ["frota", "maquinas"] });
  })),
};


// ---- Seu espaço e o menu da conta (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") -----------------------------
/** NOD-117: os botões dos bots que contam na barra, na ordem dela (fixados, Meus agentes, seções, equipe). */
function botaoDoBotNoAtalho(a: { tipo: "ir-ao-bot"; n: number } | { tipo: "vizinho"; passo: 1 | -1 }): HTMLElement | null {
  const buscando = document.getElementById("sidebar")?.hasAttribute("data-buscando") ?? false;
  // O Nod discreto do topo (.nod-topo) não entra: a issue conta fixados, Meus agentes, seções e equipe. Com a conversa
  // dele aberta, nenhum bot é o atual e ⌘⇧] vai ao 1º (⌘⇧[ ao último).
  const linhas = [...document.querySelectorAll<HTMLElement>("#sidebar .list .fixado, #sidebar .list .bot-row")].flatMap((el) => {
    const botao = el.querySelector<HTMLElement>(':scope > [data-act="abrir-conversa"]');
    return botao ? [{ botao, escondida: el.classList.contains("escondida"), oculta: el.hidden, atual: botao.getAttribute("aria-current") === "true" }] : [];
  });
  const i = alvoDoAtalho(linhas, a, buscando);
  return i === null ? null : (linhas[i]?.botao ?? null);
}

/** Faz o atalho; false quando não há alvo (aí não faz nada). */
function executarAtalho(a: AcaoAtalho): boolean {
  if (a.tipo === "folha") { abrirEspaco("ajuda"); return true; }
  // Com Seu espaço aberto só a folha chega aqui (atalhoDoTeclado, `espaco`).
  if (a.tipo === "novo-bot") {
    navegar({ tipo: "novo-bot" });
    requestAnimationFrame(() => document.getElementById("busca-destinatario")?.focus());
    return true;
  }
  // NOD-445: ⌘[ ⌘] andam pelas páginas da pílula; só chegam aqui com mais de uma página (atalhoDoTeclado, `paginas`).
  // NOD-461: ⌥← → (a mesma ação) e ⌥⇧← → valem de qualquer lugar; no ícone da doca o foco vai junto, longe dela a doca
  // abre por um instante. ⌘[ ⌘] não espiam (como antes). Mesmo sem andar (na ponta) a tecla para aqui: não vira o voltar.
  if (a.tipo === "pagina" || a.tipo === "mover-pagina" || a.tipo === "engolir") return executarNaPilula(document, a, quadroNaTela) ?? false;
  const bot = botaoDoBotNoAtalho(a);
  if (!bot) return false;
  const nome = bot.querySelector("b")?.textContent ?? "";
  void ACOES["abrir-conversa"]?.(bot);
  // Pelo teclado não há clique para o leitor de tela seguir: anuncia e põe o foco no campo da conversa.
  if (nome) anunciar(`Conversa com ${nome}`);
  requestAnimationFrame(() => document.getElementById("composer-texto")?.focus());
  return true;
}

function abrirEspaco(pedido: PedidoSecao, lista = false): void {
  // NOD-379: o espaço cobre a inicial (fora do .app, por cima); escondê-la deixaria a conversa de baixo ao fechar.
  // NOD-367: os pedidos de antes (avisos, este Mac, relatos…) caem na seção que os absorveu.
  const secao = secaoDoPedido(pedido);
  // O menu "Avisos no Mac" muda a preferência sem passar por aqui: Geral relê ao abrir.
  if (secao === "geral") void canalAvisos.reler();
  const jaAberto = !!estado.espaco;
  if (secao === "conta" && contas?.minhaConta) telaMinhaConta.abrir();
  else if (estado.espaco?.secao === "conta" && contas?.minhaConta) telaMinhaConta.fechar();
  dispatch({ tipo: "espaco", secao, ...(lista ? { lista } : {}) });
  const foco = focoAoAbrirEspaco({ pedido, secao, celular: celular.ativo(), lista, jaAberto });
  const alvo = document.querySelector<HTMLElement>(foco);
  alvo?.focus();
  if (pedido === "ajuda") alvo?.scrollIntoView({ block: "start" });
}

/** Volta exatamente para onde estava: a tela de baixo nunca saiu do lugar. O que chegou enquanto isso ganha a linha "Novas". */
function fecharEspaco(): void {
  if (!estado.espaco) return;
  if (estado.espaco.secao === "conta" && contas?.minhaConta) telaMinhaConta.fechar();
  dispatch({ tipo: "espaco", secao: null });
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala") linhaEm = t.conversaId;
  lerConversaDaTela();
  const foco = celular.botsAbertos() ? "#sidebar .me-topo" : celular.ativo() ? '.stage [data-act="abrir-bots"]' : "#sidebar .rodape .me";
  document.querySelector<HTMLElement>(foco)?.focus();
}

/** NOD-12: o uso do plano que segura as rotinas (faixa do menu e ponto no avatar). Na simulação (catcher), nada. */
function avisoDoUso(): AvisoDoUso | null {
  if (estado.executor?.atual === "catcher" || !estado.contasIa?.disponivel) return null;
  return faixaDoUso(estado.contasIa.contas, estado.agora);
}

/** O estado de Provedores de IA em uma palavra (o menu da conta e a lista das Configurações no celular). */
function resumoConexao(): string {
  const inv = inventarioEmUso(estado);
  return !estado.executor ? "Verificando" : inv && inv.estado !== "pronto" ? "Desconectada" : estado.executor.atual === "catcher" ? "Simulação" : "Conectada";
}

function dadosMenuConta(): DadosMenuConta {
  const inv = inventarioEmUso(estado);
  const falha = !!inv && inv.estado !== "pronto";
  const fora = [...new Set((estado.frota?.negacoes ?? []).filter((n) => n.classe === "conector_indisponivel").map((n) => estado.conectores.find((c) => c.slug === n.nome || c.nome === n.nome)?.nome ?? n.nome))];
  const faixa = falha
    ? { texto: situacaoMotorFora(inv, estado.executor?.atual), botao: motorDesatualizado(estado) ? "Atualizar" : "Conectar" }
    : fora.length ? { texto: faixaDeConectores(fora), botao: "Ver" }
    : ((u) => (u ? { texto: u.texto, botao: "Ver contas" } : null))(avisoDoUso());
  return {
    faixa,
    conexao: resumoConexao(),
    maquina: avisoDasMaquinas(),
    quem: quemEsta(),
    // NOD-345: com contas no servidor, Sair por último (ou o convite, no espaço provisório).
    ...(contas && contaAtual ? { conta: { email: contaAtual.conta?.email ?? contaAtual.legado?.email ?? null, senha: contaAtual.conta?.senha ?? false, legado: !contaAtual.conta && !!contaAtual.legado } } : {}),
    equipe: contas ? (linkEquipe() ?? (equipeDoApp() ? "app" : null)) : null,
  };
}

/** NOD-367: o que o menu dizia do Este Mac (#219) e do computador do bot (NOD-96), agora numa linha que abre Máquinas. */
function avisoDasMaquinas(): DadosMenuConta["maquina"] {
  const mac = leituraDoMac(estado.trabalhos).motivoEspera;
  if (mac) return { texto: mac === "disco" ? `${rotuloDoMac()} com o disco quase cheio` : `${rotuloDoMac()} ocupado: trabalho novo espera`, tom: "atencao" };
  return estado.computadorPessoa ? avisoDoComputador(estado.computadorPessoa, estado.computadorMemoria.okMenuAte > estado.agora) : null;
}

/** NOD-367: quem está logado (o topo do menu e a seção Conta). O nome vem de Minha conta, quando já lido. */
function quemEsta(): { nome: string | null; email: string | null } | null {
  const nome = contas?.minhaConta ? telaMinhaConta.vista().dados?.perfil.nome ?? null : null;
  const email = contaAtual?.conta?.email ?? contaAtual?.legado?.email ?? null;
  return nome || email ? { nome, email } : null;
}

function dadosConta(): DadosConta {
  const q = quemEsta();
  return {
    contas: !!contas && !!contaAtual,
    minhaConta: !!contas?.minhaConta,
    nome: q?.nome ?? null,
    email: contaAtual ? contaAtual.conta?.email ?? contaAtual.legado?.email ?? null : q?.email ?? null,
    senha: contaAtual?.conta?.senha ?? false,
    legado: !contaAtual?.conta && !!contaAtual?.legado,
  };
}

// ---- a gaveta do bot por níveis (definido em 2026-09-30, canvas "Menu, sidebar e gaveta") -------------------------------
/** O nível da gaveta com algo digitado e ainda não salvo (a chave de chaveDaGaveta); null = nada pendente. */
let gavetaSuja: string | null = null;

function chaveDaGaveta(): string {
  return JSON.stringify(estado.gaveta);
}

/**
 * NOD-444: o "+ Nova" das Rotinas. No celular o perfil fecha e a conversa abre com o teclado; na janela estreita (gaveta
 * por cima da caixa, ≤1099px) a gaveta fecha; no computador ela fica aberta. Se a conversa na tela é de outro bot, vai
 * para a do bot. A caixa recebe a frase (vazia) ou fica com o rascunho e mostra a frase como pílula (web/lib/rotina-no-chat.ts).
 */
function rotinaNoChat(agenteId: string): void {
  const a = botGerido(agenteId);
  if (!a) return;
  if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);
  else if (window.matchMedia("(max-width: 1099px)").matches) { document.querySelector(".app")?.classList.remove("detalhes-abertos"); marcarPainelNaPilula(); }
  const t = telaDeOrigem();
  if (t.tipo !== "conversa" || t.agenteId !== a.id) navegar({ tipo: "conversa", conversaId: a.conversaId, agenteId: a.id });
  const ta = document.getElementById("composer-texto") as HTMLTextAreaElement | null;
  if (!ta) return;
  const plano = planoNovaRotina(ta.value);
  mostrarSugestaoRotina(plano.sugestao);
  if (!plano.sugestao) frasePedeAssuntoNovo();
  escreverNaCaixa(ta, plano.valor);
}

/**
 * A frase entrou na caixa (vazia, ou pelo toque na pílula): com a caixa "Respondendo" à vista (duas ou mais perguntas), o
 * pedido de rotina vai como assunto novo, como o × dela, e a caixa mostra isso. Só a pílula à vista não muda o destino do
 * rascunho. Com uma pergunta só, a mensagem digitada responde (decisão 1 do plano "pergunta com botões", emenda da
 * ADR-045): sem caixa à vista, mudar o destino seria invisível (revisão do PR #389).
 */
function frasePedeAssuntoNovo(): void {
  const alvo = conversaAtual();
  if (alvo && comCaixaRespondendo(alvo.conversaId)) dispatch({ tipo: "composer", conversaId: alvo.conversaId, escolha: { outroAssunto: true, alvoId: estado.composer[alvo.conversaId]?.alvoId ?? null } });
}

/** Escreve na caixa (se mudou), foca com o cursor no fim e guarda o rascunho da conversa. */
function escreverNaCaixa(ta: HTMLTextAreaElement, valor: string): void {
  if (ta.value !== valor) { ta.value = valor; atualizarParar(); ajustarAltura(ta); }
  ta.focus();
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  if (composerDe) rascunhos.guardar(composerDe, ta.value);
}

/** A pílula da frase acima da caixa (nasce escondida em cada composer; some ao digitar, com Esc ou ao enviar). */
function mostrarSugestaoRotina(mostrar: boolean): void {
  const el = document.getElementById("composer-sugestao");
  if (!el || el.hidden === !mostrar) return;
  el.hidden = !mostrar;
  // Leitor de tela: o foco fica na caixa; a caixa passa a descrever a sugestão enquanto ela está à vista.
  const ta = document.getElementById("composer-texto");
  if (mostrar) ta?.setAttribute("aria-describedby", "composer-sugestao");
  else if (ta?.getAttribute("aria-describedby") === "composer-sugestao") ta.removeAttribute("aria-describedby");
}

/** Abre o nível na gaveta do bot; se a conversa na tela é de outro bot, vai para a dele antes. Escondida, a gaveta aparece. */
function abrirNivel(agenteId: string, nivel: NivelGaveta): void {
  const a = botGerido(agenteId);
  if (!a) return;
  // NOD-379: da inicial do celular (o toque longo), entra na conversa — mesmo que seja a que está por baixo.
  const t = telaDeOrigem();
  if (t.tipo !== "conversa" || t.agenteId !== a.id) navegar({ tipo: "conversa", conversaId: a.conversaId, agenteId: a.id });
  gavetaSuja = null;
  // NOD-382: no celular a gaveta é o perfil; um atalho do chat (Ver na memória, Trocar a IA…) abre o perfil do bot com
  // origem no chat, para a Biblioteca carregar e o ‹ e o Esc fecharem como de costume.
  const perfil = perfilAoAbrirNivel(estado.perfilCelular, a.id, ehCelular());
  if (perfil !== estado.perfilCelular) dispatch({ tipo: "perfil-celular", perfil });
  const app = document.querySelector(".app");
  if (window.matchMedia("(max-width: 1099px)").matches) app?.classList.add("detalhes-abertos");
  else if (painelOculto()) painelAbertoNaHora = true;
  dispatch({ tipo: "gaveta", agenteId: a.id, nivel });
  if (nivel.tipo === "atividade") vigiaAtividade.atividadeAberta(a.id);
  carregarAoAbrirNivel(a.id, nivel);
  document.querySelector<HTMLElement>("#detalhes .gv-voltar")?.focus();
}

/**
 * NOD-382: abre o perfil do bot no celular, entrando pela direita. `origem` diz para onde o ‹ volta: o chat ou a lista de
 * bots (com a tela de antes, se abrir o perfil trocou de conversa).
 */
function abrirPerfil(agenteId: string, origem: "lista" | "chat"): void {
  const a = botGerido(agenteId);
  if (!a) return;
  const antes = estado.tela;
  // De Configurações › Agentes, o ‹ volta a Seu espaço; o espaço fecha antes, para o perfil não abrir debaixo dele.
  const perfil = perfilAoAbrir({ agenteId: a.id, tela: antes, lista: origem === "lista", espaco: estado.espaco?.secao ?? null });
  if (estado.espaco) fecharEspaco();
  if (antes.tipo !== "conversa" || antes.agenteId !== a.id) navegar({ tipo: "conversa", conversaId: a.conversaId, agenteId: a.id });
  else celular.entrarNaConversa();
  gavetaSuja = null;
  marcaDoPerfil.mexeu();
  // A classe antes do desenho: a tela do bot (o valor do Computador) já vê o painel aberto.
  document.querySelector(".app")?.classList.add("detalhes-abertos");
  dispatch({ tipo: "perfil-celular", perfil });
  dispatch({ tipo: "gaveta", agenteId: a.id, nivel: null });
  marcarPainelNaPilula();
  void reidratar();
  document.querySelector<HTMLElement>("#detalhes .pfc-voltar")?.focus({ preventScroll: true });
}

/**
 * NOD-382: fecha o perfil. "origem" é o ‹ e o Esc (volta ao chat ou, se veio da lista, à tela de antes com a lista
 * aberta); "chat" é o Mensagem (fica no chat do bot). O destino vem de saidaDoPerfil (testado em perfil-celular.test.ts).
 */
function fecharPerfil(para: "origem" | "chat" = "origem", focar = true): void {
  const perfil = estado.perfilCelular;
  marcaDoPerfil.mexeu();
  const saida = saidaDoPerfil(perfil, para);
  document.querySelector(".app")?.classList.remove("detalhes-abertos");
  dispatch({ tipo: "perfil-celular", perfil: null });
  dispatch({ tipo: "gaveta", agenteId: estado.gaveta?.agenteId ?? "", nivel: null });
  marcarPainelNaPilula();
  if (saida.navegar) navegar(saida.navegar);
  if (saida.abrirLista) celular.voltarAoInicio();
  // Seu espaço foca o próprio ‹ ao abrir.
  if (saida.abrirEspaco) { abrirEspaco(saida.abrirEspaco); return; }
  if (!focar) return;
  const alvo = saida.foco === "composer" ? document.getElementById("composer-texto")
    : saida.foco === "linha-do-bot" && perfil ? document.querySelector<HTMLElement>(`[data-bot-contexto="${CSS.escape(perfil.agenteId)}"] [data-act="abrir-conversa"], button[data-bot-contexto="${CSS.escape(perfil.agenteId)}"]`)
    : document.querySelector<HTMLElement>("#cabecalho .pilula-bot");
  alvo?.focus({ preventScroll: true });
}

/**
 * NOD-382: o bot saiu da frota (excluído ou oculto) com o perfil dele aberto. O perfil fecha e a pessoa vai para a lista
 * de bots, venha da lista ou do chat (a conversa do bot não existe mais na lista; a NOD-370 leva a tela de baixo ao
 * Início). Se a frota ainda não chegou, o perfil fecha pelo caminho de sempre.
 */
function sairDoPerfilDoBotQueSaiu(a: BotGerido, perfil: PerfilCelular | null, marca: number): void {
  // A pessoa fechou o perfil (ou abriu o de outro bot) enquanto o pedido corria: fica onde está. A frota que chegou antes
  // da resposta e zerou o perfil (NOD-370) não conta: a pessoa ainda vai para a lista ou para Seu espaço.
  // A decisão mora em web/lib/lista-apos-saida.ts (planoDaSaida), testada nas três ordens de SSE e REST.
  const plano = planoDaSaida(a.id, perfil, marcaDoPerfil.intacto(marca), estado.perfilCelular?.agenteId ?? null, !!estado.espaco);
  if (!plano) return;
  if (plano.fecharPerfil) fecharPerfil("origem", false);
  if (plano.limparPainel) { document.querySelector(".app")?.classList.remove("detalhes-abertos"); marcarPainelNaPilula(); }
  if (plano.abrirEspaco) abrirEspaco(plano.abrirEspaco);
  if (!plano.abrirLista) return;
  // A releitura ainda não chegou: a inicial abre agora e fica (reduzirVendoSaida não a fecha, NOD-379); pelo histórico.
  celular.voltarAoInicio();
}

/** NOD-382: Excluir no celular confirma numa folha; excluído, o perfil fecha e a pessoa volta à lista. */
function excluirNoCelular(a: BotGerido): void {
  if (a.papel === "nod" || a.ownerId !== estado.sessao?.pessoaId) return;
  confirmarExclusaoNaFolha(a, async () => {
    const perfil = estado.perfilCelular?.agenteId === a.id ? estado.perfilCelular : null;
    const marca = marcaDoPerfil.marca();
    // Sem passar pelo mostrarErro: o erro já aparece na própria folha ("Não deu para excluir"), não duas vezes.
    await api!.excluirAgente(a.id);
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao", "rotinas", "salas", "sua-vez"] });
    sairDoPerfilDoBotQueSaiu(a, perfil, marca);
  // O aviso e o foco são calculados depois de fechar o perfil (a lista ou Seu espaço já abertos), como no Ocultar.
  }, (aberto) => depoisDeTirarDaLista(a, "Excluídos")(aberto));
}

/**
 * Volta um nível (ADR-125): o que abriu de Ajustes volta para Ajustes; a rotina e o próprio Ajustes, à visão geral. O
 * foco vai para a linha de onde a pessoa veio (ou para o ‹ do nível pai).
 */
function fecharNivel(): void {
  gavetaSuja = null;
  const g = estado.gaveta;
  if (!g) { document.querySelector<HTMLElement>("#detalhes .gv-painel")?.focus(); return; }
  const pai = paiDoNivel(g.nivel, ehCelular());
  dispatch({ tipo: "gaveta", agenteId: g.agenteId, nivel: pai });
  if (pai) carregarAoAbrirNivel(g.agenteId, pai);
  const id = "id" in g.nivel ? g.nivel.id : "";
  const origem = document.querySelector<HTMLElement>(`#detalhes [data-act="gaveta"][data-nivel="${g.nivel.tipo}"]${id ? `[data-id="${CSS.escape(id)}"]` : ""}`);
  (origem ?? document.querySelector<HTMLElement>(pai ? "#detalhes .gv-voltar" : "#detalhes .gv-painel"))?.focus();
}

// ---- NOD-20: histórico de versões do perfil ----------------------------------------------------------------------------

const mudarHistorico = (agenteId: string, mudanca: Partial<HistoricoDoBot>): void => {
  dispatch({ tipo: "historico-perfil", agenteId, mudanca });
  // Revisão 3 M3: o anúncio vai ao nó fixo #anuncio-config (fora da gaveta, que o render troca inteira): numa região
  // recriada já com o texto, o leitor de tela não lê nada.
  if (mudanca.anuncio) anunciarEm(document.getElementById("anuncio-config"), mudanca.anuncio, (fn) => window.setTimeout(fn, 50));
};
const historicoDe = (agenteId: string): HistoricoDoBot => estado.historicoPerfil[agenteId] ?? HISTORICO_INICIAL;
/** A última carga pedida por bot: a resposta de uma carga mais velha não sobrescreve a nova. */
const cargaDoHistorico = new Map<string, number>();
const cargaDaVersao = new Map<string, number>();
/** O "Mostrar versões anteriores" tem a sua vez (revisão 2 M5): dividir a do refresh deixava o `carregando` preso. */
const cargaDoMais = new Map<string, number>();
const proximaCarga = (m: Map<string, number>, id: string): number => { const n = (m.get(id) ?? 0) + 1; m.set(id, n); return n; };

/** A primeira página do histórico (substitui a lista); `mais` pede a página antes da última versão mostrada. */
async function carregarHistorico(agenteId: string, mais = false): Promise<void> {
  if (!api) return;
  if (mais) {
    const h = historicoDe(agenteId);
    const ultima = h.lista?.versoes[h.lista.versoes.length - 1];
    if (!ultima || h.carregandoMais) return;
    const n = proximaCarga(cargaDoMais, agenteId);
    const lista = cargaDoHistorico.get(agenteId);
    // Vale só se nenhum refresh começou no meio (ele troca a lista e zera o carregandoMais) nem outro "mais".
    const vale = () => cargaDoMais.get(agenteId) === n && cargaDoHistorico.get(agenteId) === lista;
    mudarHistorico(agenteId, { carregandoMais: true });
    try {
      const r = await api.versoesPerfil(agenteId, ultima.versao);
      if (!vale()) return;
      const atual = historicoDe(agenteId).lista;
      mudarHistorico(agenteId, { lista: atual ? { ...r, versoes: [...atual.versoes, ...r.versoes.filter((v) => !atual.versoes.some((x) => x.versao === v.versao))] } : r, carregandoMais: false });
    } catch (e) {
      if (vale()) mudarHistorico(agenteId, { carregandoMais: false });
      mostrarErro(e);
    }
    return;
  }
  const n = proximaCarga(cargaDoHistorico, agenteId);
  proximaCarga(cargaDoMais, agenteId);
  mudarHistorico(agenteId, { carregando: true, erro: false, carregandoMais: false });
  try {
    const lista = await api.versoesPerfil(agenteId);
    if (cargaDoHistorico.get(agenteId) === n) mudarHistorico(agenteId, { lista, carregando: false, erro: false });
  } catch {
    if (cargaDoHistorico.get(agenteId) === n) mudarHistorico(agenteId, { carregando: false, erro: true, anuncio: "Não deu para carregar o histórico." });
  }
}

async function carregarVersao(agenteId: string, numero: number): Promise<void> {
  if (!api) return;
  const n = proximaCarga(cargaDaVersao, agenteId);
  const h = historicoDe(agenteId);
  mudarHistorico(agenteId, { erroDetalhe: false, ...(h.detalhe?.versao.versao === numero ? {} : { detalhe: null }) });
  try {
    const detalhe = await api.versaoPerfil(agenteId, numero);
    if (cargaDaVersao.get(agenteId) !== n) return;
    // Revisão 4 M1: o perfil mudou por fora com a confirmação aberta: ela caduca (a guarda e o aviso eram do perfil de antes).
    const caducou = confirmacaoCaducou(historicoDe(agenteId), numero, detalhe);
    mudarHistorico(agenteId, { detalhe, erroDetalhe: false, ...(caducou ? { confirmando: null, erroRestaurar: false, anuncio: "O perfil mudou enquanto você conferia. Confira de novo antes de restaurar." } : {}) });
  } catch {
    if (cargaDaVersao.get(agenteId) === n) mudarHistorico(agenteId, { erroDetalhe: true, anuncio: "Não deu para abrir esta versão." });
  }
}

/** O que cada nível pede ao abrir (só no bot da pessoa: o servidor recusa o histórico de outra). */
function carregarAoAbrirNivel(agenteId: string, nivel: NivelGaveta): void {
  const a = botGerido(agenteId);
  if (!a || a.ownerId !== estado.sessao?.pessoaId) return;
  if (nivel.tipo === "ajustes" || nivel.tipo === "historico") void carregarHistorico(a.id);
  if (nivel.tipo === "versao") void carregarVersao(a.id, Number(nivel.id));
}

/** Salvou Missão e voz e virou a versão `versao`: o Desfazer embaixo do cartão Perfil restaura a de antes. */
function depoisDeSalvarPerfil(agenteId: string, versao: number | null): void {
  if (versao === null || versao < 2) { mudarHistorico(agenteId, { anuncio: "Missão salva." }); return; }
  mudarHistorico(agenteId, {
    anuncio: "Missão salva.",
    desfazer: { versao: versao - 1, criada: versao, rotulo: "Desfazer", aria: "Desfazer a mudança na missão e na voz", onde: "ajustes", desfeito: "Desfeito: a missão voltou a como estava." },
  });
  void carregarHistorico(agenteId);
}

/**
 * Restaura a versão `numero`. Pela confirmação (desfazer = null): volta ao Histórico com o Desfazer no topo, que restaura a
 * que era a atual. Pelo Desfazer: anuncia e tira o link. Falhou: nada mudou; a confirmação mostra o erro.
 */
async function restaurarVersao(agenteId: string, numero: number, desfazer: HistoricoDoBot["desfazer"]): Promise<void> {
  const h = historicoDe(agenteId);
  if (!api || h.restaurando) return;
  const anterior = h.detalhe?.numeroAtual ?? h.lista?.atual ?? null;
  // A guarda: a versão em que a pessoa estava olhando (o Desfazer, a que o salvar criou). Sem ela não há o que comparar.
  const esperada = desfazer ? desfazer.criada : anterior;
  if (esperada === null) return;
  // A confirmação avisou que um segredo some (perdeSegredo, do servidor); confirmar é a pessoa aceitando. O Desfazer não
  // avisa: se o servidor recusar com versao_redigida, a confirmação abre (abaixo).
  const aceitarRedacao = !desfazer && h.confirmando === numero && h.detalhe?.versao.versao === numero && h.detalhe.perdeSegredo === true;
  mudarHistorico(agenteId, { restaurando: true, erroRestaurar: false });
  try {
    const r = await api.restaurarVersao(agenteId, numero, { esperada, aceitarRedacao });
    dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
    if (desfazer) {
      mudarHistorico(agenteId, { restaurando: false, desfazer: null, anuncio: desfazer.desfeito });
    } else {
      mudarHistorico(agenteId, {
        restaurando: false,
        confirmando: null,
        anuncio: `Perfil restaurado para a versão ${numero}.`,
        desfazer: anterior ? { versao: anterior, criada: r.versao.versao, rotulo: "Desfazer", aria: `Desfazer: voltar à versão ${anterior}`, onde: "historico", desfeito: `Desfeito: o perfil voltou à versão ${anterior}.` } : null,
      });
      if (estado.gaveta?.agenteId === agenteId && estado.gaveta.nivel.tipo === "versao") {
        gavetaSuja = null;
        dispatch({ tipo: "gaveta", agenteId, nivel: { tipo: "historico" } });
        // O reducer limpa a confirmação ao trocar de nível; o Desfazer e o anúncio ficam (a gaveta não fechou).
      }
    }
    await carregarHistorico(agenteId);
    const nova = document.querySelector<HTMLElement>(`#detalhes [data-nivel="versao"][data-id="${r.versao.versao}"]`);
    (nova ?? document.querySelector<HTMLElement>("#detalhes .gv-voltar"))?.focus();
  } catch (e) {
    if (e instanceof ErroApi && e.motivo === "perfil_mudou") {
      // Outra mudança chegou antes: o Desfazer some e a lista relê, para a pessoa ver o que mudou e escolher de novo.
      const msg = "O perfil mudou depois disso. Use o Histórico para voltar.";
      mudarHistorico(agenteId, { restaurando: false, confirmando: null, desfazer: null, anuncio: msg });
      dispatch({ tipo: "erro", erro: { codigo: "perfil_mudou", mensagem: msg } });
      await carregarHistorico(agenteId).catch(() => undefined);
    } else if (desfazer && e instanceof ErroApi && e.motivo === "versao_redigida") {
      // Revisão 2 (A2): voltar apagaria um segredo. O Desfazer some e abre a versão com a confirmação e o aviso: a pessoa
      // decide lá (sem isto, cada clique dava o mesmo 409).
      mudarHistorico(agenteId, { restaurando: false, desfazer: null, anuncio: "Voltar apaga um segredo do perfil. Confira antes de restaurar." });
      abrirNivel(agenteId, { tipo: "versao", id: String(numero) });
      mudarHistorico(agenteId, { confirmando: numero, erroRestaurar: false });
    } else if (desfazer) {
      mudarHistorico(agenteId, { restaurando: false });
      mostrarErro(e);
    } else {
      // Revisão 4 M2: o erro vai pelo nó fixo de anúncio (o da gaveta nasce já com o texto e não é lido) e o foco volta ao botão.
      mudarHistorico(agenteId, { restaurando: false, erroRestaurar: true, anuncio: "Não deu para restaurar. Nada mudou no perfil." });
      document.querySelector<HTMLElement>('#detalhes [data-act="restaurar-versao"]')?.focus();
    }
  }
}

/** ADR-125: Acordar e Tentar de novo ligam o computador; o botão diz "Acordando…" até a resposta, e a frota relê. */
function ligarComputador(agenteId: string, tipo: "acordar" | "religar"): Promise<void> {
  dispatch({ tipo: "computador-acao", acao: { agenteId, tipo } });
  return agir(async () => {
    try {
      await api!.configurarComputador(agenteId, "iniciar");
      // Revisão da NOD-349: acordou — a aba não volta a dizer "dormindo" até o próximo pulso.
      dispatch({ tipo: "computador-visto", agenteId, estado: "ligado" });
    } finally {
      dispatch({ tipo: "computador-acao", acao: null });
      dispatch({ tipo: "invalidar", quais: ["frota"] });
    }
  });
}

/** ADR-125: a última aba por bot, lembrada neste navegador (`nod.gaveta.aba`; sem storage, só nesta aba). */
const CHAVE_ABA_GAVETA = "nod.gaveta.aba";
/**
 * NOD-326: "Mostrar mais" num grupo da Biblioteca — mais 5 do que já foi lido ou, no último grupo, a próxima página. O
 * foco vai para o primeiro item novo (o botão clicado some ou é redesenhado).
 */
async function mostrarMaisNaBiblioteca(conversaId: string, grupo: string): Promise<void> {
  if (grupo !== "hoje" && grupo !== "semana" && grupo !== "antigos") return;
  const antes = document.querySelectorAll(`#detalhes #gvb-${grupo} ~ .gvb-itens > li.gvb-item`).length;
  const antesDoClique = estado.bibliotecaDoBot[conversaId];
  dispatch({ tipo: "biblioteca-mais", conversaId, grupo });
  const b = estado.bibliotecaDoBot[conversaId];
  // Revisão 3: só busca quem ligou o "carregando" neste clique (o outro grupo, com a página a caminho, não repete o GET).
  const pediu = !antesDoClique?.carregandoMais && b?.carregandoMais === true;
  if (pediu && !api) dispatch({ tipo: "hidratar-biblioteca", conversaId, pagina: null, seguinte: true });
  if (pediu && b && api) {
    const sessao = estado.sessao;
    const cliente = api;
    const r = await lerSeAindaVale(() => cliente.biblioteca(conversaId, b.proximo ?? undefined), () => estado.sessao === sessao && api === cliente);
    // Revisão 1: trocou a sessão no caminho — a página é da de antes e não entra; o botão (se a lista ficou) volta.
    if (!r.vale) { dispatch({ tipo: "hidratar-biblioteca", conversaId, pagina: null, seguinte: true }); return; }
    if (!r.valor) anunciar("Não deu para carregar mais arquivos. Tente de novo.");
    dispatch({ tipo: "hidratar-biblioteca", conversaId, pagina: r.valor, seguinte: true });
  }
  // Revisão 2: o foco só anda se a pessoa ainda está no botão (ou ele sumiu); se ela foi para outro lugar, fica lá.
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && !ativo.matches(".gvb-mostrar")) return;
  // O primeiro item novo do grupo; se a página trouxe só itens de outro grupo, o primeiro do grupo seguinte; senão o botão.
  const doGrupo = document.querySelectorAll<HTMLElement>(`#detalhes #gvb-${grupo} ~ .gvb-itens > li.gvb-item`)[antes];
  const alvo = doGrupo ?? document.querySelector<HTMLElement>(`#detalhes .gvb-grupo:has(#gvb-${grupo}) ~ .gvb-grupo li.gvb-item`) ?? document.querySelector<HTMLElement>(`#detalhes #gvb-${grupo} ~ .gvb-itens .gvb-mostrar`);
  (alvo?.matches(".gvb-mostrar") ? alvo : alvo?.querySelector<HTMLElement>(".gvb-abrir, .gvb-menu"))?.focus();
}

/**
 * NOD-326: o "…" de um item da Biblioteca — Baixar (só com os bytes no nod) e Ir para a mensagem. NOD-363: o Ir está em
 * todo item (irParaFalaDaBiblioteca): com a fala desenhada leva na hora, sem rede; fora da janela o item diz
 * "Carregando…" (anunciado), a conversa relê com `?ate=` e, quando a fala chega, o menu fecha, a gaveta sobreposta do
 * celular fecha e só então rola. Sem a fala, a nota diz isso no menu. Fechar o menu ou trocar de tela cancela a espera.
 */
function abrirMenuDaBiblioteca(ancora: HTMLElement): void {
  const { url, nome = "arquivo", mensagemDe = "", conversa = "", id = "" } = ancora.dataset;
  // Revisão 2 (achado 2): a Biblioteca redesenha durante a espera (SSE, a releitura com `ate`) e troca o botão "…";
  // posição, aria-expanded e o foco de volta seguem o botão que está na tela.
  const ancoraViva = (): HTMLElement => (ancora.isConnected ? ancora : document.querySelector<HTMLElement>(`#detalhes [data-act="biblioteca-menu"][data-id="${CSS.escape(id)}"]`)) ?? ancora;
  const d = dialogo(htmlDoMenuDaBiblioteca({ nome, baixar: Boolean(url) }), true);
  d.setAttribute("aria-label", `Ações de ${nome}`);
  d.classList.add("menu-compartilhar");
  ancora.setAttribute("aria-expanded", "true");
  let aberto = true;
  let espera: { soltar(): void } | null = null;
  d.addEventListener("close", () => {
    aberto = false;
    const viva = ancoraViva();
    viva.setAttribute("aria-expanded", "false");
    espera?.soltar();
    if (!ancora.isConnected && viva.isConnected && (document.activeElement === document.body || document.activeElement === null)) viva.focus();
  });
  const posicionar = (): void => {
    const r = ancoraViva().getBoundingClientRect();
    d.style.left = `${Math.max(12, Math.min(r.right - d.offsetWidth, window.innerWidth - d.offsetWidth - 12))}px`;
    d.style.top = `${Math.max(12, Math.min(r.bottom + 6, window.innerHeight - d.offsetHeight - 12))}px`;
  };
  posicionar();
  const ui = criarMenuDoIr<HTMLElement>({
    item: d.querySelector<HTMLButtonElement>('[data-gestao="ir"]'),
    status: d.querySelector<HTMLElement>(".menu-status"),
    // `dialogo()` de outro menu remove este sem disparar close: o desconectado também não vale mais.
    // Revisão 4: o `close` chega numa tarefa depois do close(); `d.open` já fica falso na hora.
    aberto: () => aberto && d.open && d.isConnected,
    marcar: marcarIrCarregando,
    desmarcar: desmarcarIrCarregando,
    textoCarregando: TEXTO_IR_CARREGANDO,
    nota: (antiga) => htmlDaNotaDoMenu(antiga ? NOTA_FALA_FORA : NOTA_FALA_DEMOROU),
    trocarNota: (html) => {
      d.querySelector(".menu-nota")?.remove();
      if (html) d.insertAdjacentHTML("beforeend", html);
    },
    posicionar,
    focarNota: () => d.querySelector<HTMLElement>(".menu-nota")?.focus(),
    fechar: () => { if (d.open) d.close(); },
    irAte: (fala, vizinha) => {
      if (d.open) d.close();
      abrirDetalhesAcima(fala);
      // NOD-382: no celular, ir para a mensagem fecha o perfil de verdade (o estado junto), e a pessoa fica no chat.
      if (ehCelular() && estado.perfilCelular) fecharPerfil("chat", false);
      else if (window.matchMedia("(max-width: 1099px)").matches) {
        document.querySelector(".app")?.classList.remove("detalhes-abertos");
        marcarPainelNaPilula();
      }
      // Revisão 3 (B5): a vizinha não leva o realce de "é esta" (como o alvoDoQueEspera de levar-ao-alvo.ts).
      levarAo(fala, !vizinha);
    },
  });
  d.addEventListener("click", (e) => {
    const bt = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-gestao]");
    const acao = bt?.dataset.gestao;
    if (!acao || !bt || bt.getAttribute("aria-disabled") === "true") return;
    if (acao === "baixar" && url) {
      d.close();
      const a = document.createElement("a");
      a.href = baixarUrl(url);
      a.download = nome;
      a.click();
    } else if (acao === "ir" && mensagemDe) {
      espera = irParaFalaDaBiblioteca(mundoDaFala, ui, conversa, mensagemDe);
    }
  });
  d.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const bts = [...d.querySelectorAll<HTMLButtonElement>("button")];
    // Revisão 2 (achado 8): com o foco na nota (fora dos itens), ↑ vai ao último item (NOD-367).
    const i = proximoItemDoMenu(bts.length, bts.indexOf(document.activeElement as HTMLButtonElement), e.key);
    if (i !== null) bts[i]?.focus();
  });
  (d.querySelector<HTMLElement>('[role="menuitem"]') ?? d.querySelector<HTMLElement>(".menu-nota"))?.focus();
}

function escolherAba(agenteId: string, aba: string): void {
  // NOD-58: as setas nas abas Memórias | Histórico do nível Memória trocam a aba como o clique.
  if (aba === "memorias" || aba === "historico") {
    const tab = document.querySelector<HTMLElement>(`#detalhes .mem-aba[data-aba="${aba}"]`);
    if (tab) ACOES["memoria-aba"]?.(tab);
    return;
  }
  if (aba !== "detalhes" && aba !== "biblioteca" && aba !== "computador") return;
  dispatch({ tipo: "aba-gaveta", agenteId, aba });
  try { localStorage.setItem(CHAVE_ABA_GAVETA, JSON.stringify(estado.abaGaveta)); } catch { /* modo privado */ }
  document.querySelector<HTMLElement>(`#detalhes [role="tab"][data-aba="${aba}"]`)?.focus();
}
try {
  const lidas = JSON.parse(localStorage.getItem(CHAVE_ABA_GAVETA) ?? "{}") as unknown;
  if (lidas && typeof lidas === "object") {
    const abas = Object.fromEntries(Object.entries(lidas).filter((par): par is [string, "detalhes" | "biblioteca" | "computador"] => par[1] === "detalhes" || par[1] === "biblioteca" || par[1] === "computador"));
    dispatch({ tipo: "abas-lidas", abas });
  }
} catch { /* sem storage ou JSON velho: começa em Detalhes */ }

/** ADR-125: forma e cor mudam na hora (otimista); o PATCH sai 300 ms depois do último toque, e o erro desfaz. */
// Revisão da NOD-349: nome, subtítulo, forma e cor saem pela mesma fila por bot (um PATCH de cada vez, o último vence),
// e a frota só se relê quando a fila do bot esvazia (reler no meio desfaria na tela a escolha que ainda vai sair).
type MudancaDePerfil = { nome?: string; titulo?: string; forma?: FormaAgente; cor?: CorAgente };
const filaDePerfil = criarFilaDePerfil<MudancaDePerfil>(async (agenteId, mudanca) => {
  try {
    const r = await api!.editarPerfil(agenteId, mudanca);
    // NOD-20 (protótipo v2): o nome salvo ganha o Desfazer embaixo dele; o subtítulo, a forma e a cor não (ficam no Histórico).
    const soNome = Object.keys(mudanca).length === 1 && mudanca.nome !== undefined;
    if (soNome && typeof r.versao === "number" && r.versao >= 2) {
      mudarHistorico(agenteId, { anuncio: "Nome salvo.", desfazer: { versao: r.versao - 1, criada: r.versao, rotulo: "Desfazer", aria: "Desfazer a mudança no nome", onde: "identidade", desfeito: "Desfeito: o nome voltou a como estava." } });
    } else if (typeof r.versao === "number" && historicoDe(agenteId).desfazer) {
      // Outra mudança gravou versão depois: o Desfazer de antes desfaria ela também.
      mudarHistorico(agenteId, { desfazer: null });
    }
  } finally {
    // A fila esvaziou e nada espera no debounce: a frota relida já é a verdade (com o erro, desfaz o otimista).
    if (filaDePerfil.semEspera(agenteId) && !salvarAvatar.pendente(agenteId)) {
      const { [agenteId]: _, ...resto } = perfilPendente;
      perfilPendente = resto;
      dispatch({ tipo: "invalidar", quais: ["frota", "gestao"] });
    }
  }
});
function marcarPendente(agenteId: string, mudanca: MudancaDePerfil): void {
  perfilPendente = { ...perfilPendente, [agenteId]: { ...perfilPendente[agenteId], ...mudanca } };
}
const salvarAvatar = criarSalvarAvatar<MudancaDePerfil>((agenteId, mudanca) => filaDePerfil.enviar(agenteId, mudanca).catch(() => avisarNaIdentidade(ERRO_AO_SALVAR)));
function mudarAvatar(agenteId: string, mudanca: { forma?: FormaAgente; cor?: CorAgente }, el: HTMLElement): void {
  marcarPendente(agenteId, mudanca);
  dispatch({ tipo: "agente-local", agenteId, mudanca });
  salvarAvatar.pedir(agenteId, mudanca);
  const valor = el.dataset.valor;
  const alvo = valor ? `#detalhes button[data-act="${el.dataset.act ?? ""}"][data-valor="${CSS.escape(valor)}"]` : "#detalhes .gvn-redefinir";
  document.querySelector<HTMLElement>(alvo)?.focus();
}
function fecharPopoverAvatar(focarAvatar = true): void {
  const ab = estado.avatarAberto;
  if (!ab) return;
  salvarAvatar.agora(ab.agenteId);
  dispatch({ tipo: "avatar-popover", aberto: null });
  if (focarAvatar) document.querySelector<HTMLElement>("#detalhes .gvn-avatar")?.focus();
}

/** ADR-125: Renomear bot (menu da lista) abre a visão geral da gaveta com o nome selecionado no campo. */
function renomearNaGaveta(a: BotGerido): void {
  const t = telaDeOrigem();
  if (t.tipo !== "conversa" || t.agenteId !== a.id) navegar({ tipo: "conversa", conversaId: a.conversaId, agenteId: a.id });
  const app = document.querySelector(".app");
  if (window.matchMedia("(max-width: 1099px)").matches) app?.classList.add("detalhes-abertos");
  else if (painelOculto()) { painelAbertoNaHora = true; render(); }
  if (estado.gaveta) dispatch({ tipo: "gaveta", agenteId: a.id, nivel: null });
  const focar = () => {
    const campo = document.querySelector<HTMLInputElement>("#detalhes #gvn-nome");
    campo?.focus();
    campo?.select();
  };
  focar();
  // O menu ⋯ acabou de fechar e o close dele devolve o foco à linha: o campo é focado de novo depois (revisão da NOD-349).
  setTimeout(focar, 0);
}

aoVerComputador((agenteId, visto) => dispatch({ tipo: "computador-visto", agenteId, estado: visto }));

instalarIdentidade({
  salvarCampo: (agenteId, campo, valor) => {
    marcarPendente(agenteId, { [campo]: valor });
    dispatch({ tipo: "agente-local", agenteId, mudanca: { [campo]: valor } });
    return filaDePerfil.enviar(agenteId, { [campo]: valor });
  },
  fecharPopover: fecharPopoverAvatar,
  escolherAba,
  escolherRadio: (b) => { if (b.dataset.act === "gaveta-forma" || b.dataset.act === "gaveta-cor") void ACOES[b.dataset.act]?.(b); },
});

/** ‹ (ou Esc): com mudança não salva, pergunta antes; o que está salvo não pergunta nada. */
function voltarNivel(): void {
  if (gavetaSuja && gavetaSuja === chaveDaGaveta()) {
    pedirGestao("Descartar as mudanças?", "<p>O que você mudou aqui ainda não foi salvo.</p>", "Descartar", async () => fecharNivel(), true);
    return;
  }
  fecharNivel();
}
