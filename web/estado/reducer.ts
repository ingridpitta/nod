import type { Agente, CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import type { MotivoRecomeco } from "../../src/contracts/turno.ts";
import { ehMotivoRecomeco } from "../lib/recomeco.ts";
import type { AnexoDaConversa } from "../../src/contracts/anexo.ts";
import type { AtividadeDto } from "../../src/contracts/atividade.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { InstalacaoSshDto, MetodoSsh } from "../../src/contracts/instalacoes-ssh.ts";
import type { ResumoDaChave } from "../lib/chave-ssh.ts";
import { HISTORICO_INICIAL, type HistoricoDoBot } from "../lib/historico-perfil.ts";
import type { ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { DetalhesDasContas } from "../../src/contracts/desktop.ts";
import type { EstaMaquina } from "../../src/contracts/desktop-esta-maquina.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { IasDaPessoa } from "../../src/contracts/inteligencia.ts";
import type { UsoDoPlanoDto } from "../../src/contracts/uso-do-plano.ts";
import type { DisponibilidadeLigacao } from "../../src/contracts/ligacao.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { EntradaDiario, Memoria, PaginaDiario, TipoMemoria } from "../../src/contracts/memoria.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import type { CausaNativa, Negacao } from "../../src/contracts/negacao.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { Experimentos, RaioXConversa, UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { EstadoDaTarefa, EstadoDoSubagente, FaixaParada, SubagenteVivo, TarefaDoBot } from "../../src/contracts/turno.ts";
import type { DonoDto, EstadoDoDono } from "../../src/contracts/dono.ts";
import type { NivelPressao, TaxaDeAbertura, TrabalhoDetalheDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { Escopo } from "../../src/shared/types.ts";
import type { LeituraAtual } from "../lib/ouvir.ts";
import { FALA_SAINDO_MS } from "../lib/fala-viva.ts";
import { acoesFechadas, acoesSemNota, ATIVIDADE_VAZIA, linhasDoResumo, comFerramenta, comFimDaAcao, comSubagentes, comTarefas, comTexto, comVigia, SEM_NOME_DA_FERRAMENTA, semFerramentaAberta, soSubagentes, subagentesParados, textoDaFala, type AtividadeTurno, type FerramentaEmUso, type SubagentesDoTurno, type VigiaDaAtividade, comCabecalho, comFrentesEm } from "../lib/atividade.ts";
import { chaveDaAtividade, diaLocal, vistaInicial, type VistaDaAtividade } from "../lib/atividade-do-bot.ts";
import { chaveDasDecisoes, type PaginaDasDecisoes } from "../lib/decisoes-do-bot.ts";
import type { DecisoesDto } from "../../src/contracts/decisoes-do-bot.ts";
import { AGENDA_INICIAL, agendaPorLer, ehAcaoDaAgenda, reduzirAgenda, type AcaoAgenda, type EstadoAgenda } from "./agenda.ts";
import { diaDe } from "../lib/agenda.ts";
import type { PaginaDaBiblioteca } from "../../src/contracts/biblioteca.ts";
import { gruposVisiveis, juntarPagina, POR_VEZ, type BibliotecaDaConversa, type GrupoBiblioteca } from "../lib/biblioteca.ts";
import type { EstadoConexao } from "../lib/live-events.ts";
import { ehErroDeRede, type ErroNaTela } from "../lib/erro-da-tela.ts";
import { lembrarComputador, MEMORIA_INICIAL, UI_INICIAL as UI_COMPUTADOR_INICIAL, type ComputadorPessoaDto, type ComputadorUi, type MemoriaDoComputador } from "../lib/computador-pessoa.ts";
import { conversasComPergunta } from "../lib/perguntas.ts";
import { UI_IAS_INICIAL, type UiIas } from "../telas/cartao-ia.ts";
import { UI_CONTAS_INICIAL, type UiContas } from "../telas/contas-lista.ts";
import { UI_REMOVER_INICIAL, type UiRemover } from "../telas/remover-computador.ts";
import { UI_NUVEM_INICIAL, type UiNuvem } from "../lib/maquina-nuvem.ts";
import type { RascunhoInteligencia } from "../telas/inteligencia.ts";
import { LOTE_INICIAL, soOsQueExistem, type LoteAgentes } from "../lib/lote-agentes.ts";

/**
 * Estado da web (ADR-020: a web decide, nunca executa; ADR-029: todo fail-closed vira estado
 * escrito). O servidor é a fonte da verdade: um frame SSE (ADR-016) NÃO carrega o conteúdo — ele
 * diz o que mudou (kind, conversaId, turnoId) e o reducer marca o que precisa ser REIDRATADO por
 * REST (`invalidacoes`); só os deltas de turno (efêmeros) entram direto no estado. Nada aqui lê
 * Date.now(): `agora` chega pela ação `tick`.
 */
export type Tela =
  /** Ainda sem conversa escolhida: assim que a frota chega, `resolverInicio` troca pela conversa certa. */
  | { tipo: "inicio" }
  | { tipo: "conversa"; conversaId: string; agenteId: string }
  | { tipo: "sala"; salaId: string; conversaId: string }
  | { tipo: "rotinas" }
  | { tipo: "nova-rotina"; agenteId?: string }
  | { tipo: "novo-bot" }
  /**
   * definido em 2026-09-25 (jornada do marketplace): `gaveta` é a gaveta do app aberta por cima da grade —
   * "detalhes" (o que o app libera; gerenciar, se já conectado) ou "quem-usa" (abre sozinha quando o login
   * termina). `avancado` mostra a tela técnica: chave do Composio, MCP próprio, catálogos e concessão por ação.
   * `voltar` (definido em 2026-10-04) é a tela de onde a pessoa veio, para o "‹ <de onde veio>" do topo.
   */
  | { tipo: "conectores"; app?: string; gaveta?: { slug: string; passo: "detalhes" | "quem-usa" }; avancado?: true; filtro?: "todos" | "conectados" | "atencao"; voltar?: Exclude<Tela, { tipo: "conectores" }> }
  | { tipo: "sua-vez" }
  /** Não lidos (definido em 2026-09-29, 0039): tudo o que chegou, a conversa mais recente em cima. */
  | { tipo: "nao-lidos" }
  /** NOD-455 (ADR-143): o quadro de outra pessoa em que quem lê participa (/quadros/:qid). */
  | { tipo: "quadro-compartilhado"; quadroId: string }
  | { tipo: "nova-sala" }
  /** ADR-083 (#196): "Todos os trabalhos" — os de todos os bots da pessoa, com os filtros De você / Rotinas / Entre bots. */
  | { tipo: "trabalhos"; filtro?: FiltroTrabalhos }
  /**
   * ADR-083 (#195): a tela da task. `voltar` é a tela de onde a pessoa veio (o Fechar e o Esc voltam para ela); abrir
   * outra task de dentro de uma task mantém o `voltar` de fora.
   */
  | { tipo: "trabalho"; id: string; voltar: Tela }
  /**
   * definido em 2026-10-07 (#191): a tela provisória de uma linha do chat sem trabalho por trás (execuções antigas de
   * rotina, pedido a colega de antes do ADR-083): as mensagens que a linha recolheu, na ordem, com Fechar.
   */
  /** `rotina` (definido em 2026-10-08, QA do épico, R2): a tela separa as execuções da rotina, uma a uma. */
  | { tipo: "linha"; conversaId: string; mensagens: string[]; titulo: string; voltar: Tela; rotina?: boolean };

/** Os filtros de "Todos os trabalhos": De você (pessoa e rede), Rotinas e Entre bots (colega). */
export type FiltroTrabalhos = "todos" | "voce" | "rotinas" | "bots";

/**
 * "Seu espaço" (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o que é da CONTA abre pelo menu do avatar numa
 * camada de tela cheia POR CIMA da tela atual, que continua montada embaixo — sair devolve a conversa exata (rolagem,
 * rascunho, gaveta). Gerenciar agentes, Relatos e Computadores deixaram de ser telas e viraram seções daqui.
 */
/**
 * ADR-090: o "Conectar uma máquina" (protótipo "Nod — Motor na VM", prancha 2): o comando, o código, a confirmação
 * ("Conectar vm-sp?"), o login das IAs e a escolha dos bots. `chavesAntes`: as chaves que já existiam, para achar a nova.
 */
/** NOD-94: uma máquina da pessoa que pode instalar por SSH agora (o Mac ou um motor que puxou há pouco). */
export type InstaladoraSsh = { id: string; nome: string; plataforma: string };

/**
 * NOD-94: o "Usar uma máquina só para o computador" (instalação por SSH, emenda 11 da ADR-090). A chave, a frase, a
 * senha e a do sudo NUNCA ficam aqui: moram só na memória do controlador (web/lib/instalar-ssh.ts) enquanto o diálogo
 * está aberto, e só saem cifradas para a instaladora. Aqui fica o que a tela mostra.
 */
export type InstalarSsh = {
  fase: "form" | "progresso";
  /** O que a pessoa digitou no Endereço: `host`, `host:porta` ou, no Mac, o apelido do ~/.ssh/config. */
  endereco: string;
  usuario: string;
  metodo: MetodoSsh;
  /** A chave colada, resumida (tipo e impressão); null = ainda não colou. */
  chave: ResumoDaChave | null;
  temFrase: boolean;
  /** null = carregando. */
  instaladoras: InstaladoraSsh[] | null;
  origemId: string | null;
  trocarOrigem: boolean;
  /** 409 `ja_tem_computador`: a tela pergunta "Substituir?"; `confirmado` = a pessoa disse sim. */
  substituir: { nome: string; confirmado: boolean } | null;
  pedido: InstalacaoSshDto | null;
  /** O erro que mora num campo (aria-invalid + aria-describedby). */
  campoErro: { campo: "endereco" | "usuario" | "acesso" | "sudo"; texto: string } | null;
  /** O erro geral, em âmbar (sem instaladora, falha de rede). */
  erro: string | null;
  /** `sem_sudo` com chave: a etapa Conferindo para e pede a senha do sudo no diálogo. */
  pedeSudo: boolean;
  mostrarSudo: boolean;
  /** "Prefere fazer você mesmo?": o comando com o convite (criado ao abrir). null = fechado. */
  manual: string | null;
  segundoPlano: boolean;
  enviando: boolean;
  /** As origens que já tentaram e não acharam rota (o "Tentar a partir de" oferece as outras). */
  tentadas: string[];
};

export type ConectarMaquina = {
  passo: "comando" | "codigo" | "confirmar" | "ias" | "bots";
  codigo: string;
  pedido: { nome: string; plataforma: string; pedidoHaS: number } | null;
  erro: string | null;
  chavesAntes: string[];
  marcados: string[];
  /** ADR-102: o convite do comando de instalação (modo compartilhado); a tela vê a máquina chegar sem código. */
  convite?: string | null;
  /** Até quando o convite vale (o servidor diz); a tela para de esperar e mostra a hora. */
  conviteAte?: number | null;
};

/** NOD-367 (protótipo v2): as seções das Configurações, nesta ordem na lateral. NOD-85: Rotinas entre Agentes e Feedback. */
export type SecaoEspaco = "conta" | "geral" | "conexao" | "maquinas" | "agentes" | "rotinas" | "feedback";
/**
 * O que um ponto de entrada pode pedir: as 6 seções, as de antes da NOD-367 (avisos, preferências, este Mac,
 * computadores, computador do bot, relatos), que caem na seção que as absorveu, e "ajuda" (Geral, no bloco Ajuda).
 */
export type PedidoSecao = SecaoEspaco | "avisos" | "preferencias" | "este-mac" | "computador-do-bot" | "computadores" | "relatos" | "ajuda";

/** NOD-383: a seção que está aberta de fato. Na lista das Configurações do celular, nenhuma (o tique, as releituras e o Esc
 * não agem sobre a seção de onde a pessoa saiu). */
export function secaoAberta(e: Pick<Estado, "espaco">): SecaoEspaco | null {
  return e.espaco && !e.espaco.lista ? e.espaco.secao : null;
}

export function secaoDoPedido(p: PedidoSecao): SecaoEspaco {
  switch (p) {
    case "avisos": case "preferencias": case "ajuda": return "geral";
    case "este-mac": case "computador-do-bot": case "computadores": return "maquinas";
    case "relatos": return "feedback";
    default: return p;
  }
}

/**
 * NOD-367: o estado de tela das Configurações — as linhas recolhidas abertas (Avançado, Chaves revogadas, Ocultos, o
 * detalhe de uma chave ou de um envio), o "…" aberto e a busca de Agentes. Fechar as Configurações zera.
 */
/** `filtro`: o tipo escolhido em Feedback ("todos", "bug", "melhoria" ou "duvida"). */
/** NOD-368: `lote` = a seleção e a troca em lote de Agentes; zera ao trocar de seção, como o resto daqui. */
export type ConfigUi = { abertos: string[]; busca: string; filtro: string; lote: LoteAgentes };
export const CONFIG_UI_INICIAL: ConfigUi = { abertos: [], busca: "", filtro: "todos", lote: LOTE_INICIAL };
/**
 * NOD-368 (revisão 1): sair de Agentes no meio de uma troca em lote não zera o `mudando` nem as mensagens: os PUTs em voo
 * ainda escrevem nelas, e voltar a Agentes antes do fim não pode abrir uma segunda troca por cima da primeira.
 */
export const loteAoSair = (l: LoteAgentes): LoteAgentes => (l.mudando ? { ...LOTE_INICIAL, mudando: true, resultados: l.resultados } : LOTE_INICIAL);

/**
 * A gaveta do bot por níveis (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o que é do bot abre DENTRO dela,
 * com ‹ para voltar à visão geral — a conversa continua ao lado. Editar perfil e Memória deixaram de ser telas.
 * `acesso.id` é o app (slug; o id do conector quando não há slug).
 */
export type NivelGaveta =
  | { tipo: "rotina"; id: string }
  | { tipo: "acesso"; id: string }
  | { tipo: "dar-acesso" }
  | { tipo: "perfil" }
  /**
   * NOD-58: a Memória tem duas abas (Memórias | Histórico). `editando` é a memória aberta no editor (opção A, no lugar);
   * `menu`, a do "…" aberto; `realce`, a entrada do Histórico que "Ver no Histórico"/"Ver a mais nova" apontou.
   */
  | { tipo: "memoria"; aba?: "memorias" | "historico"; editando?: string; menu?: string; realce?: string }
  | { tipo: "inteligencia" }
  | { tipo: "nova-rotina" }
  /** ADR-083 (#196): os trabalhos do bot por grupo (Precisa de você, Trabalhando, Na fila, Terminados hoje). */
  | { tipo: "trabalhos" }
  /** ADR-114 (chat limpo, PR 2): o que saiu do chat do bot, um dia por vez (web/telas/atividade.ts). */
  | { tipo: "atividade" }
  /** ADR-125 (NOD-349): Atalhos, Perfil (Missão e voz), Acessos, Ambiente e o Modo dev, fora da visão geral. */
  | { tipo: "ajustes" }
  /** NOD-20: o histórico de versões do perfil (Ajustes › Perfil › Histórico) e uma versão aberta (`id` = o número). */
  | { tipo: "historico" }
  | { tipo: "versao"; id: string }
  /** NOD-382: as telas das linhas do perfil do celular (web/telas/perfil-celular.ts); o desktop não as abre. */
  | { tipo: "codigo" }
  | { tipo: "rotinas" }
  | { tipo: "biblioteca" }
  | { tipo: "computador" };

/**
 * NOD-382: o perfil do bot no celular está aberto, e de onde a pessoa veio (o ‹ volta para lá): da lista de bots (com a
 * tela que estava atrás dela em `voltar`) ou do chat do próprio bot.
 */
export type PerfilCelular = { agenteId: string; origem: "lista" | "chat" | "espaco"; voltar?: Tela; espaco?: SecaoEspaco };

/** NOD-58: a memória apagada nesta sessão, que fica no lugar como uma linha com Desfazer. */
export type MemoriaApagadaNaTela = { memoriaId: string; tipo: TipoMemoria; texto: string; criadoEm: number };

/** ADR-125: as abas da visão geral da gaveta (a Biblioteca chegou com a NOD-326). */
export type AbaGaveta = "detalhes" | "biblioteca" | "computador";

/** ADR-125: o que a aba Computador mostra, lido de `GET agentes/:id/computador` (web/lib/computador.ts). */
export type EstadoComputadorBot = "ligado" | "ocupado" | "dormindo" | "sem" | "fora" | "indisponivel" | "erro";

/**
 * `semJanela` (revisão do PR #264, NOD-208): a janela de login não abriu (bloqueador de pop-up, app desktop ou
 * a re-sonda do "Tentar de novo", que a abre fora do clique). O bloco de espera mostra "Abrir o login" como link.
 */
export type ConexaoApp = { url: string | null; falhou: string | null; semJanela?: boolean };

/**
 * A ligação viva da pessoa (definido em 2026-10-04, ADR-071): `local` = aberta NESTA página (a tela da ligação);
 * senão veio de `GET ligacoes/viva` (outra janela). A barra lateral marca o bot "Em ligação" nos dois casos.
 */
export type LigacaoVivaNaTela = { ligacaoId: string; agenteId: string; conversaId: string; local: boolean };

/**
 * `trabalhoId` (ADR-083): o turno é de um trabalho — o ao vivo dele aparece na tela da task, nunca no chat.
 * `vistoEm` (NOD-216): o relógio da web quando o servidor confirmou o turno pela última vez (frame ou leitura). A leitura
 * que não o traz só o tira se ela saiu DEPOIS disso — um frame mais novo que o GET não some com a resposta velha.
 * `chegouEm` (NOD-216, revisão): o relógio DA WEB quando ela viu o turno pela primeira vez — a janela de "pensando" conta
 * daqui, e não do `desde` do banco, que vem no relógio do servidor (um relógio adiantado ou atrasado decidiria a animação).
 * `origem` (NOD-216, revisão): de onde o turno veio (`turno_criado.origem`, `TurnoEmCursoDto.origem`); só as origens da
 * fila do dono (`ORIGENS_DA_FILA_DO_DONO`) podem ser desmentidas por ela.
 */
/** `agenteId` (NOD-348): o bot do turno, do `agente_id` do frame — na sala, cada fala viva tem o mascote de quem fala. */
/** O turno que acabou com texto, guardado com a atividade até a releitura da conversa (`em`: a hora do fim). */
export type FalaSaindo = { turno: TurnoVivo; atividade: AtividadeTurno; em: number };
export type TurnoVivo = { turnoId: string; conversaId: string; estado: "na_fila" | "rodando"; executor: string | null; machineId: string | null; desde: number; trabalhoId?: string | null; vistoEm?: number; chegouEm?: number; origem?: string | null; agenteId?: string | null; /** NOD-312: o turno recomeçou sem a sessão (turno_despachado.dados.motivo_recomeco). */ motivoRecomeco?: MotivoRecomeco | null; /** NOD-402 (ADR-130): turno dos bastidores (rotina, colega, sob procuração) — conta na presença, nunca no chat. */ bastidores?: boolean; /** NOD-402: a hora do despacho no relógio do SERVIDOR (turno_despachado, GET), comparável ao `criadoEm` das mensagens. */ despachadoEm?: number; /** NOD-402: a hora em que o turno nasceu no SERVIDOR (turno_criado, turno_despachado, GET); a ordem do chat trava daqui. */ criadoEm?: number };

/**
 * Plano "o pensamento no chat", Parte 1 (2026-10-26): a fala da pessoa entre o clique e a confirmação do servidor. Nasce
 * no clique (`fala-pendente`), ganha o id gravado quando o POST volta (`fala-pendente-confirmada`, `ids.mensagem`) e sai
 * quando a releitura traz a mensagem com esse id. Falhou: fica na tela, tracejada, com "Tentar de novo" (a mesma chave
 * de idempotência, web/lib/envio-idempotente.ts). Só a mensagem comum da conversa própria: resposta à pergunta e sala
 * têm rotas próprias, sem chave.
 */
export type FalaPendente = {
  idEnvio: string;
  texto: string;
  anexos: readonly AnexoDaConversa[];
  respondeA?: string;
  em: number;
  estado: "enviando" | "falhou";
  mensagemId: string | null;
  turnoId: string | null;
  /** Revisão de engenharia (27/10): a frase do erro que derrubou o envio (a da tabela da web), ao lado de "Não foi enviada". */
  motivo?: string;
};

export type ConversaEstado = ConversaDto & {
  carregadaEm: number;
  /** As falas da pessoa ainda não confirmadas pela releitura (Parte 1). */
  pendentes?: readonly FalaPendente[];
  /** mensagemId → idEnvio das falas confirmadas: a gravada fica com a chave do bloco da pendente (o nó não troca). */
  enviadas?: Readonly<Record<string, string>>;
};

export type NegacaoVista = Negacao & { conversaId: string | null; vistaEm: number };

/**
 * definido em 2026-09-24 (emenda da ADR-045): o que a PRÓXIMA mensagem do campo faz enquanto há
 * pergunta aberta na conversa. Sem entrada, responde à mais antiga (web/lib/perguntas.ts);
 * `outroAssunto` manda mensagem comum e deixa a pergunta aberta; `alvoId` escolhe qual pergunta
 * responder quando são várias. Vale até o próximo envio, e some quando a conversa fica sem pergunta.
 */
export type EscolhaComposer = { outroAssunto: boolean; alvoId: string | null };

/**
 * definido em 2026-10-18 (ADR-113, plano "pergunta com botões", Parte 3b): a fala a que a PRÓXIMA mensagem do campo
 * responde, escolhida pelo "Responder" da barra de ações. Fica fora de `composer` de propósito: `hidratar-sua-vez` apaga
 * a escolha do campo nas conversas sem pergunta aberta, e a citação não pode sumir por ali (revisão de engenharia do
 * plano). O `trecho` é só para a caixa "Respondendo": o servidor recalcula o dele a partir de `mensagemId`. Vale até o
 * envio ou o × da caixa.
 */
export type CitacaoNoCampo = { mensagemId: string; trecho: string };

export type Invalidacao = "onboarding" | "ligacao" | "trabalhos" | `trabalho:${string}` | `disponibilidade:${string}` | "gestao" | "frota" | "sua-vez" | "nao-lidos" | "rotinas" | "conectores" | "inventario" | "executor" | "ias" | "uso-plano" | "salas" | "chaves" | "maquinas" | "nuvem" | "contas" | "relatos" | "agenda" | `conversa:${string}` | `vivos:${string}` | `memoria:${string}` | `diario:${string}` | `concessoes:${string}` | `execucoes:${string}` | `atividade:${string}` | `atividade-hoje:${string}` | `decisoes:${string}` | `biblioteca:${string}`;

export type Estado = {
  sessao: Escopo | null;
  tela: Tela;
  /** Seu espaço aberto por cima da tela, na seção escolhida; null = fechado. */
  /** NOD-383: `lista` = no celular, a lista das seções (estilo Ajustes); a seção abre por cima dela. O desktop ignora. */
  espaco: { secao: SecaoEspaco; lista?: boolean } | null;
  configUi: ConfigUi;
  frota: FrotaDto | null;
  gestao?: FrotaDto | null;
  inventario: Inventario | null;
  /** Interruptor de executor da máquina (catcher ⇄ claude-cli): estado escrito de cada opção e a última recusa. */
  executor: EstadoExecutor | null;
  /**
   * As IAs da pessoa (`GET /ias`, definido em 2026-10-10, plano das IAs): a ordem do Automático, o estado de cada uma com
   * o limite e os modelos. undefined = ainda não lido; null = o servidor não tem a rota (versão anterior).
   */
  ias?: IasDaPessoa | null;
  /**
   * O uso da janela de cada IA (`GET /uso-do-plano`, NOD-179), para o anel do seletor de IA do campo (definido em
   * 2026-10-16, plano "tela limpa", decisão E6). undefined = ainda não lido; null = o servidor não tem a rota.
   */
  usoDoPlano?: UsoDoPlanoDto | null;
  /** As IAs do app do Mac (`nodDesktop.ias`) e o que é só da tela nos cartões (web/telas/cartao-ia.ts). */
  iasMac: UiIas;
  /** O rascunho do nível Inteligência da gaveta (2B) até Salvar; null = nenhum. */
  rascunhoIa: RascunhoInteligencia | null;
  /** O bot cujo menu de Inteligência (2A) está aberto na gaveta; null = fechado. */
  menuIa: string | null;
  conversas: Record<string, ConversaEstado>;
  /**
   * O turno vivo de cada conversa carregada (turno.delta, turno.atividade, turno.tarefas), por conversaId e
   * turnoId, descartado ao encerrar. definido em 2026-09-30: mora fora de `conversas` porque muda a cada
   * pedaço de texto de cada bot; dentro da conversa, cada pedaço trocava a referência dela e forçava a
   * timeline inteira a ser refeita (web/lib/lembrar.ts).
   */
  atividades: Record<string, Record<string, AtividadeTurno>>;
  turnosVivos: Record<string, TurnoVivo>;
  /**
   * NOD-348 (QA do #508): a fala viva que virou mensagem (o turno acabou, ou `turno.fala` no meio dele), por conversa e
   * por turno, até a releitura que saiu depois dela trazer a fala gravada — sem ela, a timeline ficava um quadro sem fala
   * nenhuma e a conversa pulava ~95 px no fim de todo turno. Some sozinha em `FALA_SAINDO_MS` (o tick limpa).
   */
  falasSaindo?: Record<string, Record<string, FalaSaindo>>;
  /**
   * Os últimos turnos que a web viu encerrar ou ser interrompidos (definido em 2026-10-08, revisão W6): o `GET
   * trabalhos/:id` que saiu antes do `turno.encerrado` e chega depois dele traz o turno ainda vivo, e sem esta lista o
   * bot ficava "Trabalhando" para sempre. Só os mais recentes (`ENCERRADOS_GUARDADOS`).
   */
  turnosEncerrados: readonly string[];
  /**
   * NOD-350: os subagentes do turno que acabou (turnoId → lista final), para a task terminada ainda dizer quem concluiu,
   * falhou ou parou (critérios 4 e 5). Só na memória da tela, os mais recentes; recarregar perde (sem migração).
   */
  subagentesDoFim: Readonly<Record<string, SubagentesDoTurno>>;
  /**
   * NOD-216 (revisão): os turnos que uma leitura tirou (turnoId → quando a leitura saiu). A resposta MAIS VELHA que chega
   * depois não os traz de volta — sem isto, o GET conversa que saiu antes do GET trabalhos devolvia o fantasma.
   */
  turnosDesmentidos: Readonly<Record<string, number>>;
  /** Cancelar da fila tem 5 s de Desfazer antes de ir ao servidor (turnoId → instante do clique). */
  cancelando: Record<string, number>;
  salas: { sala: Sala; membros: MembroSala[] }[];
  suaVez: SuaVezDto | null;
  /** Não lidos (0039): o que chegou depois do "lido até" de cada conversa; null = ainda não carregou. */
  naoLidos: NaoLidosDto | null;
  /**
   * Onde a linha "Novas" entra em cada conversa: a primeira não lida quando a pessoa abriu a conversa (ou voltou
   * para a janela com ela aberta). Fica até ela sair da conversa; o servidor já conta tudo como lido. `total` =
   * quantas estavam não lidas quando a linha entrou (a pílula da base diz "3 novas", 2026-10-05).
   */
  novasDesde: Record<string, { mensagemId: string; em: number; total: number }>;
  rotinas: RotinaDto[];
  /**
   * O que já chegou do servidor ao menos uma vez (definido em 2026-09-30): lista vazia é resposta, não falta.
   * Antes `rotinas.length === 0` contava como "não carregou" e quem não tinha rotina relia /rotinas (e
   * redesenhava a tela) a cada ação e a cada frame; o mesmo valia para salas e para o marketplace.
   */
  carregado: { rotinas: boolean; salas: boolean; conectores: boolean };
  execucoes: Record<string, ExecucaoRotina[]>;
  /** Rotinas com o histórico aberto no painel. Separado de `execucoes`: um evento recarrega a lista, mas não a reabre. */
  historicoAberto: Record<string, boolean>;
  /**
   * Card de pasta com a lista aberta ("Não é essa"), por proposta: `curta` mostra as primeiras, `todas`
   * mostra tudo; ausente = só a sugerida. definido em 2026-09-25: estado de tela, não vai ao servidor.
   */
  listaDePasta: Record<string, "curta" | "todas">;
  conectores: Conector[];
  marketplace: AppComLogo[];
  composioConfigurado: boolean;
  /**
   * definido em 2026-09-25: os apps com login em andamento (a janela do provedor aberta e a web
   * perguntando ao servidor, sozinha, se terminou). `falhou` = a frase do que deu errado; o card oferece
   * tentar de novo. Some quando conecta ou quando a pessoa cancela.
   */
  conectando: Record<string, ConexaoApp>;
  /** O nível aberto na gaveta de um bot; outro bot na tela = visão geral. */
  gaveta: { agenteId: string; nivel: NivelGaveta } | null;
  /** NOD-382: o perfil do celular aberto (null = fechado ou desktop). */
  perfilCelular: PerfilCelular | null;
  /** NOD-382: a leitura de /rotinas falhou antes de dar certo uma vez (o perfil do celular mostra "—" e Tentar de novo). */
  rotinasFalharam: boolean;
  /** ADR-125: a última aba da gaveta por bot (o main lê e grava em `localStorage` `nod.gaveta.aba`). */
  abaGaveta: Record<string, AbaGaveta>;
  /** ADR-125: o popover do avatar aberto, com a forma e a cor de quando abriu (Redefinir volta a elas). */
  avatarAberto: { agenteId: string; forma: FormaAgente; cor: CorAgente } | null;
  /** ADR-125: o estado do computador de cada bot, do último pulso da aba Computador; ausente = carregando. */
  computadorVisto: Record<string, EstadoComputadorBot>;
  /** ADR-125: Acordar ou Tentar de novo em andamento (o botão desabilita e diz "Acordando…"). */
  computadorAcao: { agenteId: string; tipo: "acordar" | "religar" } | null;
  /**
   * A Atividade do bot (ADR-114, chat limpo, PR 2): as páginas lidas, por `agenteId:dia` (null = a rota disse 404: servidor
   * de antes, ou o bot não é da pessoa); o "N hoje" da linha da gaveta por bot (`total` null = indisponível, a linha fica
   * sem número); e o que a gaveta mostra (dia, filtro e a mensagem aberta).
   */
  atividadeDoBot: Record<string, AtividadeDto | null>;
  /** NOD-70: `negadas` é o "· N negadas" da linha Atividade em Ajustes (undefined/null: ainda não leu, ou falhou). */
  atividadeHoje: Record<string, { dia: string; total: number | null; negadas?: number | null }>;
  atividadeVista: VistaDaAtividade | null;
  /** NOD-20: o histórico de versões do perfil por bot (web/telas/historico-perfil.ts). */
  historicoPerfil: Record<string, HistoricoDoBot>;
  /**
   * NOD-70: a aba Decisões, por `bot:dia:filtro` (chaveDasDecisoes). null = indisponível (servidor de antes ou bot de outra
   * pessoa, 404); "erro" = a leitura falhou (a aba mostra o erro com Tentar de novo).
   */
  decisoesDoBot: Record<string, PaginaDasDecisoes | null | "erro">;
  /**
   * NOD-326: a Biblioteca da gaveta, por `conversaId` — as páginas lidas, o cursor, o erro e quantos itens cada grupo
   * mostra. Ausente = ainda não lida (a falta `biblioteca:<id>` só existe com a aba aberta na visão geral).
   */
  bibliotecaDoBot: Record<string, BibliotecaDaConversa>;
  avisoConexao: string | null;
  concessoes: Record<string, Concessao[]>;
  /**
   * O "Agora não" do cartão de liberar apps (definido em 2026-10-05, 0054): por bot, o instante em que a pessoa
   * dispensou cada app (conectorId → ms). Chega junto com as concessões; ausente = ainda não carregou, e o cartão
   * não aparece (web/telas/card-liberar.ts).
   */
  liberacoesDispensadas: Record<string, Record<string, number>>;
  memorias: Record<string, Memoria[]>;
  /** NOD-58: quantas mudanças do bot (só dele) faltam revisar, por bot; vem com a lista e com o histórico. */
  memoriasARevisar: Record<string, number>;
  /** NOD-58: o histórico da memória do bot, mais novas primeiro (páginas de 50 anexadas pelo "Mostrar mais"). */
  diarios: Record<string, { entradas: EntradaDiario[]; mais: boolean }>;
  /** NOD-58: as memórias que a pessoa apagou nesta sessão, no lugar onde estavam, com Desfazer (por bot). */
  memoriasApagadas: Record<string, MemoriaApagadaNaTela[]>;
  /** NOD-58: o aviso sob uma entrada do Histórico: o desfazer recusou (`conflito`, 409) ou não chegou (`rede`). */
  avisoDiario: { entradaId: string; tipo: "conflito" | "rede" } | null;
  /** NOD-58: a frase do aria-live da Memória ("Memória apagada. Dá para desfazer."). */
  statusMemoria: string;
  /** Minhas chaves de máquina (ADR-031); null = ainda não carregou. */
  chaves: ChaveMaquinaDto[] | null;
  /** ADR-090: as máquinas da pessoa (chaves vivas + o que as conectadas anunciaram) e o padrão de onde os bots trabalham. */
  maquinas: MaquinasDto | null;
  /**
   * ADA-243 (definido em 2026-11-07): a máquina desta instalação do app (a ponte `estaMaquina`). null = web pura, app
   * antigo ou ainda sem chave: a web não chuta qual é "este computador".
   */
  estaMaquina: EstaMaquina | null;
  /**
   * NOD-96 (computador do bot v2): o computador da pessoa. null = a rota não existe (NOD_COMPUTADORES desligado) ou
   * ainda não leu — a web fica no modelo de antes. `computadorMemoria` é o que a web lembra entre leituras (esperas,
   * ✓, telas fechadas por uma operação); `computadorUi`, o realce e o diálogo do painel.
   */
  computadorPessoa: ComputadorPessoaDto | null;
  computadorMemoria: MemoriaDoComputador;
  computadorUi: ComputadorUi;
  /** ADR-090: o "Conectar uma máquina" aberto em Seu espaço › Máquinas (passo, código digitado, o pedido visto). */
  conectarMaquina: ConectarMaquina | null;
  /** NOD-94: a instalação por SSH aberta (o diálogo ou a linha em segundo plano); null = nenhuma. */
  instalarSsh: InstalarSsh | null;
  /** ADR-102: as contas de IA da pessoa em todas as máquinas; null = ainda não carregou. */
  contasIa: ContasIaDto | null;
  /** ADR-102: e-mail e organização das contas que este Mac conhece (só no app do Mac); null = fora do app ou app antigo. */
  detalhesContas: DetalhesDasContas | null;
  /** O que é só da tela na lista de contas e em Máquinas (menu aberto, logins na tela, confirmações). */
  contasUi: UiContas;
  /** ADR-121 (NOD-92): a conta da nuvem e o que é só da tela nela (aviso da volta do Google, formulário, menu do sono). */
  nuvem: UiNuvem;
  /** ADA-245 (jornada D): o diálogo "Remover o nod deste computador?" e a tela de Fim. */
  removerUi: UiRemover;
  /** ADA-245: `ModoSessaoDto.onboardingTexto` (GET /api/sessao/modo); false = as telas de antes, sem renomear nada. */
  onboardingTexto: boolean;
  /** Relatos de comportamento indesejado (ADR-041); null = ainda não carregou. */
  relatos: Relato[] | null;
  /** NOD-367: a lista de Feedback não carregou (a seção mostra "Tentar de novo" em vez de pedir de novo sozinha). */
  relatosErro?: boolean;
  /** NOD-85: a agenda das rotinas (Configurações › Rotinas). */
  agenda: EstadoAgenda;
  /**
   * Modo dev (definido em 2026-09-28, 0036): a preferência vem do servidor (o app desktop limpa o localStorage)
   * e, ligada, cada conversa aberta traz o resumo do Raio-X de cada turno e o total do dia.
   */
  modoDev: { ligado: boolean; raioX: Record<string, RaioXConversa>; taxasLinhas?: TaxaDeAbertura[] };
  /**
   * A chave crua recém-emitida: mostrada UMA vez e descartada ao sair da tela. Fica só na memória da
   * aba — nunca em storage — e o servidor não tem como mostrá-la de novo.
   */
  chaveEmitida: ChaveEmitidaDto | null;
  negacoes: NegacaoVista[];
  faixaParada: FaixaParada | null;
  /** Escolha do campo por conversa (EscolhaComposer); ausente = o padrão. */
  composer: Record<string, EscolhaComposer>;
  /** A citação do campo por conversa (CitacaoNoCampo); ausente = a mensagem não responde a nenhuma fala. */
  citacoes: Record<string, CitacaoNoCampo>;
  conexao: { estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };
  /** O que a próxima volta do main precisa buscar por REST (conjunto, sem duplicata). */
  invalidacoes: Invalidacao[];
  agora: number;
  erro: ErroNaTela | null;
  ocupado: boolean;
  ligacaoViva: LigacaoVivaNaTela | null;
  /** A disponibilidade de ligar para cada bot (só decide se o botão "Ligar" aparece); null = a leitura falhou. */
  disponibilidadeLigacao: Record<string, DisponibilidadeLigacao | null>;
  /**
   * Ouvir uma resposta (NOD-106): a leitura em curso (o tocador de web/lib/ouvir.ts despacha `leitura-mudou`) e a
   * falha antes do primeiro som, que desenha "Não deu para ouvir agora." embaixo do balão por 6 s. Fica aqui porque o
   * render da conversa é puro e lê `Estado`.
   */
  leitura: LeituraAtual | null;
  falhaLeitura: { mensagemId: string } | null;
  /** NOD-54 (ADR-134): a fala com o cartão "Desfazer o que o bot mudou?" aberto embaixo dela (uma por vez). */
  desfazerAberto: string | null;
  /**
   * Onboarding por ligação (definido em 2026-10-04, ADR-077): o que `GET onboarding` disse. undefined = ainda não leu;
   * null = a leitura falhou ou a rota não existe (falha fechada: o app abre normal). `onboardingAberto` = a camada do
   * onboarding está na frente (resolverInicio abre quando `mostrar`; "Ver o onboarding de novo" reabre).
   */
  onboarding?: EstadoOnboarding | null;
  onboardingAberto: boolean;
  /** A primeira leitura já decidiu se o onboarding abre (só uma vez por sessão; depois só pelo menu da conta). */
  onboardingResolvido?: boolean;
  /**
   * ADR-083 (#195/#196): os trabalhos da pessoa (abertos e terminados hoje, de todos os bots) como `GET trabalhos` os
   * devolveu; null = ainda não leu. A faixa, o chip da barra, o ícone do topo, a gaveta e "Todos os trabalhos" leem daqui.
   */
  trabalhos: TrabalhosDto | null;
  /** A tela da task de cada trabalho já aberto (`GET trabalhos/:id`), com as mensagens dele. */
  trabalhoDetalhe: Record<string, TrabalhoDetalheDto>;
  /** QA do NOD-314: turnos que o servidor disse já refeitos ("ja_refeito") nesta sessão — o atalho do turno preso some. */
  turnosRefeitos: string[];
  /** Pressão de memória do Mac (#194): do `GET trabalhos` e do frame `memoria.mudou`; null = nenhum Mac falou. */
  pressao: NivelPressao | null;
  /**
   * O bot cuja faixa de Trabalhos a pessoa abriu nesta visita à conversa; null = pílula. revisto em 2026-10-09 (pedido
   * do Marlon: "o default na UI deve ser a pílula, ela é sempre muito mais sutil"): a faixa nasce recolhida sempre, abre
   * só no clique e fica aberta enquanto a pessoa está na conversa (ida e volta pela tela da task inclusive) — antes era
   * uma preferência guardada em `PUT preferencias`, e o padrão era aberta. Ver `faixaAbertaAoNavegar`. Chat limpo (PR 8,
   * 2026-10-18): é o estado da pílula do bot alargada (web/telas/pilula-do-bot.ts), que sobrevive ao re-render da região.
   */
  faixaTrabalhosAberta: string | null;
  /** definido em 2026-10-12 (ADR-099, parte 5): o bot aberto na tela Trabalhos (as frentes dele embaixo da linha). */
  botAbertoEmTrabalhos: string | null;
  /** ADR-085: quanto do Mac os bots podem usar (Seu espaço › Este Mac; `PUT preferencias`). */
  usoDoMac: UsoDoMac;
  /** ADR-111: as chaves de experimento do menu da conta (Calibração, Memória longa, ADR-112 Modo WhatsApp e, NOD-429, Quadro), lidas de `GET preferencias`. */
  experimentos: Experimentos;
  /** NOD-415 (ADR-141): a flag NOD_QUADROS libera os quadros para esta pessoa (ausente = não liberado). */
  quadroLiberado?: boolean;
  /** O cartão do tempo aberto no topo da task (protótipo "Nod — tempo da task"): o id da task, ou null. */
  tempoTaskAberto: string | null;
};

export type Acao =
  | AcaoAgenda
  | { tipo: "conexao-app"; slug: string; valor: ConexaoApp | null }
  | { tipo: "gaveta"; agenteId: string; nivel: NivelGaveta | null }
  | { tipo: "historico-perfil"; agenteId: string; mudanca: Partial<HistoricoDoBot> }
  | { tipo: "perfil-celular"; perfil: PerfilCelular | null }
  | { tipo: "rotinas-falharam" }
  | { tipo: "rotinas-tentando" }
  | { tipo: "aba-gaveta"; agenteId: string; aba: AbaGaveta }
  | { tipo: "abas-lidas"; abas: Record<string, AbaGaveta> }
  | { tipo: "avatar-popover"; aberto: { agenteId: string; forma: FormaAgente; cor: CorAgente } | null }
  | { tipo: "computador-visto"; agenteId: string; estado: EstadoComputadorBot }
  | { tipo: "computador-acao"; acao: { agenteId: string; tipo: "acordar" | "religar" } | null }
  | { tipo: "agente-local"; agenteId: string; mudanca: { nome?: string; titulo?: string; forma?: FormaAgente; cor?: CorAgente } }
  | { tipo: "hidratar-atividade"; agenteId: string; dia: string; atividade: AtividadeDto | null }
  | { tipo: "hidratar-atividade-hoje"; agenteId: string; dia: string; total: number | null; negadas?: number | null }
  | { tipo: "hidratar-decisoes"; chave: string; pagina: DecisoesDto | null | "erro" }
  | { tipo: "mais-decisoes"; chave: string; cursor: string; resultado: "carregando" | "erro" | DecisoesDto }
  | { tipo: "esquecer-decisoes"; chave: string }
  | { tipo: "hidratar-biblioteca"; conversaId: string; pagina: PaginaDaBiblioteca | null; seguinte: boolean }
  | { tipo: "biblioteca-mais"; conversaId: string; grupo: GrupoBiblioteca }
  | { tipo: "biblioteca-tentar"; conversaId: string }
  | { tipo: "atividade-vista"; mudanca: Partial<Omit<VistaDaAtividade, "agenteId">> }
  | { tipo: "aviso-conexao"; texto: string | null }
  | { tipo: "sessao"; escopo: Escopo | null }
  | { tipo: "navegar"; tela: Tela }
  | { tipo: "espaco"; secao: SecaoEspaco | null; lista?: boolean }
  | { tipo: "config-ui"; mudanca: Partial<ConfigUi> }
  /** Abre ou fecha uma linha recolhida das Configurações. */
  | { tipo: "config-recolhe"; id: string }
  | { tipo: "tick"; agora: number }
  | { tipo: "cancelando-turno"; turnoId: string; agora: number }
  | { tipo: "desfazer-cancelamento"; turnoId: string }
  | { tipo: "conexao"; estado: EstadoConexao; tentativa: number; proximaEmMs: number | null }
  | { tipo: "frame"; frame: FrameSse; agora: number }
  | { tipo: "hidratar-gestao"; gestao: FrotaDto }
  | { tipo: "hidratar-frota"; frota: FrotaDto }
  | { tipo: "hidratar-inventario"; inventario: Inventario }
  | { tipo: "hidratar-executor"; executor: EstadoExecutor }
  | { tipo: "hidratar-ias"; ias: IasDaPessoa | null }
  | { tipo: "hidratar-uso-plano"; usoDoPlano: UsoDoPlanoDto | null }
  /** O agente que o servidor devolveu ao gravar (`PUT agentes/:id/inteligencia`), já na frota e na gestão antes de reler. */
  | { tipo: "agente-gravado"; agente: Agente }
  /** Mudou algo das IAs do Mac ou da tela dos cartões (só os campos que vieram). */
  | { tipo: "ias-mac"; mudanca: Partial<UiIas> }
  /** A ordem arrastada em Provedores de IA, já na tela antes do servidor responder. */
  | { tipo: "ordem-ias"; ordem: IasDaPessoa["ordem"] }
  | { tipo: "rascunho-ia"; rascunho: RascunhoInteligencia | null }
  | { tipo: "menu-ia"; agenteId: string | null }
  | { tipo: "hidratar-conversa"; conversa: ConversaDto; agora: number }
  | { tipo: "hidratar-sua-vez"; suaVez: SuaVezDto }
  | { tipo: "hidratar-nao-lidos"; naoLidos: NaoLidosDto }
  | { tipo: "novas-desde"; conversaId: string; mensagemId: string; em: number; total: number }
  | { tipo: "hidratar-rotinas"; rotinas: RotinaDto[] }
  | { tipo: "hidratar-execucoes"; rotinaId: string; execucoes: ExecucaoRotina[] }
  | { tipo: "alternar-historico"; rotinaId: string }
  | { tipo: "lista-de-pasta"; propostaId: string; lista: "curta" | "todas" }
  | { tipo: "hidratar-conectores"; conectores: Conector[]; marketplace?: AppComLogo[]; composioConfigurado?: boolean }
  | { tipo: "hidratar-concessoes"; agenteId: string; concessoes: Concessao[]; liberacoesDispensadas?: Record<string, number> }
  | { tipo: "hidratar-memorias"; agenteId: string; memorias: Memoria[]; aRevisar?: number }
  | { tipo: "hidratar-diario"; agenteId: string; pagina: PaginaDiario; anexar?: boolean }
  | { tipo: "diario-revisado"; agenteId: string; entradaId: string | null; aRevisar: number }
  | { tipo: "diario-desfeita"; agenteId: string; entradaId: string; em: number }
  | { tipo: "memoria-apagada"; agenteId: string; apagada: MemoriaApagadaNaTela }
  | { tipo: "memoria-apagada-sai"; agenteId: string; memoriaId: string }
  | { tipo: "aviso-diario"; aviso: { entradaId: string; tipo: "conflito" | "rede" } | null }
  | { tipo: "status-memoria"; texto: string }
  | { tipo: "hidratar-salas"; salas: { sala: Sala; membros: MembroSala[] }[] }
  | { tipo: "hidratar-chaves"; chaves: ChaveMaquinaDto[] }
  | { tipo: "hidratar-maquinas"; maquinas: MaquinasDto }
  | { tipo: "esta-maquina"; maquina: EstaMaquina | null }
  | { tipo: "hidratar-computador-pessoa"; dto: ComputadorPessoaDto | null; agora: number }
  | { tipo: "computador-ui"; ui: Partial<ComputadorUi> }
  | { tipo: "conectar-maquina"; conectar: ConectarMaquina | null }
  | { tipo: "instalar-ssh"; instalar: InstalarSsh | null }
  | { tipo: "hidratar-contas"; contas: ContasIaDto; detalhes: DetalhesDasContas | null }
  | { tipo: "trocar-contas"; contas: ContasIaDto }
  | { tipo: "contas-ui"; mudanca: Partial<UiContas> }
  | { tipo: "nuvem-ui"; mudanca: Partial<UiNuvem> }
  | { tipo: "remover-ui"; mudanca: Partial<UiRemover> }
  | { tipo: "onboarding-texto"; ligado: boolean }
  | { tipo: "hidratar-relatos"; relatos: Relato[] | null; erro?: boolean }
  | { tipo: "modo-dev"; ligado: boolean }
  | { tipo: "hidratar-raio-x"; conversaId: string; raioX: RaioXConversa }
  | { tipo: "chave-emitida"; emitida: ChaveEmitidaDto | null }
  | { tipo: "faixa"; faixa: FaixaParada | null }
  | { tipo: "composer"; conversaId: string; escolha: EscolhaComposer | null }
  | { tipo: "citar"; conversaId: string; citacao: CitacaoNoCampo | null }
  | { tipo: "fala-pendente"; conversaId: string; pendente: FalaPendente }
  | { tipo: "fala-pendente-confirmada"; conversaId: string; idEnvio: string; mensagemId: string | null; turnoId: string | null }
  | { tipo: "fala-pendente-falhou"; conversaId: string; idEnvio: string; motivo?: string }
  | { tipo: "fala-pendente-sai"; conversaId: string; idEnvio: string }
  | { tipo: "invalidar"; quais: Invalidacao[] }
  | { tipo: "invalidacoes-tratadas"; quais: Invalidacao[] }
  | { tipo: "erro"; erro: ErroNaTela | null }
  /** QA do NOD-314: o "Rodar em <outra> desta vez" respondeu `ja_refeito`: o atalho daquele turno some. */
  | { tipo: "turno-refeito"; turnoId: string }
  /** NOD-215: uma chamada caiu por rede (ainda tentando de novo ou já desistiu): vira "Reconectando…", nunca por cima de outro erro. */
  | { tipo: "rede-caiu"; erro: ErroNaTela }
  /** NOD-215: o nod respondeu de novo: o "Reconectando…" some sozinho. */
  | { tipo: "rede-voltou" }
  | { tipo: "ocupado"; valor: boolean }
  | { tipo: "ligacao-viva"; viva: LigacaoVivaNaTela | null }
  | { tipo: "hidratar-disponibilidade-ligacao"; agenteId: string; disponibilidade: DisponibilidadeLigacao | null }
  /** NOD-106: o tocador mudou de fase (null = ocioso); `falha` grava (ou, com null, tira) o aviso de falha. */
  | { tipo: "leitura-mudou"; leitura: LeituraAtual | null; falha?: { mensagemId: string } | null }
  /** NOD-54: abre (o id da fala) ou fecha (null) o cartão do desfazer. */
  | { tipo: "desfazer-cartao"; mensagemId: string | null }
  | { tipo: "esquecer-disponibilidade-ligacao"; agenteId: string }
  | { tipo: "hidratar-onboarding"; onboarding: EstadoOnboarding | null }
  | { tipo: "onboarding-aberto"; aberto: boolean }
  /** `agora` (NOD-216): quando a leitura saiu; com ele, os donos reconciliam os turnos vivos das conversas dos bots. */
  | { tipo: "hidratar-trabalhos"; trabalhos: TrabalhosDto; agora?: number }
  | { tipo: "hidratar-trabalho"; detalhe: TrabalhoDetalheDto; agora: number }
  /** O `GET trabalhos/:id` voltou 404: a task não existe (ou não é desta pessoa). */
  | { tipo: "trabalho-sumiu"; id: string }
  /** Abre (o id do bot) ou recolhe (null) a faixa de Trabalhos da conversa. */
  | { tipo: "faixa-trabalhos"; agenteId: string | null }
  /** ADR-099 (parte 5): abre (o id do bot) ou fecha (null) as frentes de um bot na tela Trabalhos. */
  | { tipo: "bot-trabalhos"; agenteId: string | null }
  | { tipo: "uso-do-mac"; uso: UsoDoMac }
  | { tipo: "experimentos"; experimentos: Experimentos; quadroLiberado?: boolean }
  | { tipo: "tempo-task"; id: string | null }
  | { tipo: "hidratar-taxas-linhas"; taxas: TaxaDeAbertura[] };

export const estadoInicial: Estado = {
  sessao: null,
  tela: { tipo: "inicio" },
  espaco: null,
  configUi: CONFIG_UI_INICIAL,
  frota: null,
  inventario: null,
  executor: null,
  iasMac: UI_IAS_INICIAL,
  rascunhoIa: null,
  menuIa: null,
  conversas: {},
  atividades: {},
  turnosVivos: {},
  turnosEncerrados: [],
  subagentesDoFim: {},
  turnosDesmentidos: {},
  cancelando: {},
  salas: [],
  suaVez: null,
  naoLidos: null,
  novasDesde: {},
  rotinas: [],
  carregado: { rotinas: false, salas: false, conectores: false },
  execucoes: {},
  historicoAberto: {},
  listaDePasta: {},
  conectores: [],
  marketplace: [],
  composioConfigurado: false,
  conectando: {},
  gaveta: null,
  perfilCelular: null,
  rotinasFalharam: false,
  abaGaveta: {},
  avatarAberto: null,
  computadorVisto: {},
  computadorAcao: null,
  atividadeDoBot: {},
  bibliotecaDoBot: {},
  atividadeHoje: {},
  atividadeVista: null,
  historicoPerfil: {},
  decisoesDoBot: {},
  avisoConexao: null,
  concessoes: {},
  liberacoesDispensadas: {},
  memorias: {},
  memoriasARevisar: {},
  diarios: {},
  memoriasApagadas: {},
  avisoDiario: null,
  statusMemoria: "",
  chaves: null,
  maquinas: null,
  estaMaquina: null,
  computadorPessoa: null,
  computadorMemoria: MEMORIA_INICIAL,
  computadorUi: UI_COMPUTADOR_INICIAL,
  conectarMaquina: null,
  instalarSsh: null,
  contasIa: null,
  detalhesContas: null,
  contasUi: UI_CONTAS_INICIAL,
  nuvem: UI_NUVEM_INICIAL,
  removerUi: UI_REMOVER_INICIAL,
  onboardingTexto: false,
  relatos: null,
  agenda: AGENDA_INICIAL,
  modoDev: { ligado: false, raioX: {} },
  chaveEmitida: null,
  negacoes: [],
  faixaParada: null,
  composer: {},
  citacoes: {},
  conexao: { estado: "parado", tentativa: 0, proximaEmMs: null },
  invalidacoes: [],
  agora: 0,
  erro: null,
  ocupado: false,
  ligacaoViva: null,
  disponibilidadeLigacao: {},
  leitura: null,
  falhaLeitura: null,
  desfazerAberto: null,
  onboardingAberto: false,
  trabalhos: null,
  trabalhoDetalhe: {},
  turnosRefeitos: [],
  pressao: null,
  faixaTrabalhosAberta: null,
  botAbertoEmTrabalhos: null,
  usoDoMac: "equilibrado",
  experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false, quadro: false },
  tempoTaskAberto: null,
};

/** A posição de uma IA na ordem nova (as que não estão nela vão para o fim, na ordem de antes). */
const posicao = (ordem: readonly string[], id: string): number => (ordem.includes(id) ? ordem.indexOf(id) : ordem.length);

/** A lista de tarefas de um frame: item fora do formato fica de fora (a web nunca confia no formato do frame). */
const ESTADOS_TAREFA: Record<EstadoDaTarefa, true> = { pendente: true, andamento: true, feita: true };
function tarefasDoFrame(v: unknown): TarefaDoBot[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((t): TarefaDoBot[] => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.titulo === "string" && typeof o.estado === "string" && o.estado in ESTADOS_TAREFA
      ? [{ id: o.id, titulo: o.titulo, estado: o.estado as EstadoDaTarefa }]
      : [];
  }).slice(0, 50);
}

const ESTADOS_SUBAGENTE: Record<EstadoDoSubagente, true> = { trabalhando: true, concluido: true, falhou: true, parado: true };

/** NOD-350: o servidor já validou (ponte-validacao.ts); aqui só não deixa um frame torto quebrar a tela. */
function subagentesDoFrame(v: unknown): SubagenteVivo[] {
  if (!Array.isArray(v)) return [];
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return v.flatMap((t): SubagenteVivo[] => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.estado !== "string" || !(o.estado in ESTADOS_SUBAGENTE)) return [];
    if (o.natureza !== "agente" && o.natureza !== "comando") return [];
    return [{ id: o.id, natureza: o.natureza, descricao: typeof o.descricao === "string" ? o.descricao.slice(0, 80) : "", estado: o.estado as EstadoDoSubagente, passo: typeof o.passo === "string" && o.passo !== "" ? o.passo.slice(0, 60) : null, chamadas: num(o.chamadas), duracaoMs: num(o.duracaoMs) }];
  }).slice(0, 20);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function invalidar(estado: Estado, ...pedidas: (Invalidacao | null)[]): Estado {
  // NOD-85: o que muda uma rotina (pausar, ativar, rodar, criar, excluir o bot) muda a agenda também.
  const quais = pedidas.includes("rotinas") && !pedidas.includes("agenda") ? [...pedidas, "agenda" as const] : pedidas;
  const novas = quais.filter((q): q is Invalidacao => q !== null && !estado.invalidacoes.includes(q));
  return novas.length === 0 ? estado : { ...estado, invalidacoes: [...estado.invalidacoes, ...novas] };
}

/**
 * O uso do plano relido por um frame (revisão do PR 1, 2026-10-16): `usoDoPlano === null` é o servidor sem a rota, ou a
 * leitura que falhou fechada (main.ts) — nenhum frame pede de novo; quem tenta outra vez é a volta da janela ou da rede
 * (`invalidacoesAoRetomar`).
 */
const usoPlano = (e: Estado): Invalidacao | null => (e.usoDoPlano === null ? null : "uso-plano");
/**
 * NOD-12 (2026-10-22): a leitura do uso agora é por conta e vem com a lista de contas (as barras de Provedores de IA, a
 * faixa do menu e o anel do seletor). O turno que acaba traz leitura nova: relê as contas, se a tela já as tem; quem
 * nunca as pediu (ex.: sem abrir a conversa) continua sem pedir.
 */
const contasDoTurno = (e: Estado): Invalidacao | null => (e.contasIa === null ? null : "contas");

/** NOD-348: guarda a fala viva do turno que vira mensagem com texto, na conversa aberta (não o da task, sem fala viva). */
function comFalaSaindo(estado: Estado, turnoId: string | null, agora: number, fim = false): Estado {
  const turno = turnoId ? estado.turnosVivos[turnoId] : undefined;
  // NOD-402: o turno dos bastidores nunca teve fala viva no chat — sem retrato (o `sem_novidade` não grava nada e o
  // retrato que esperava a gravada sumia aos 15 s: a mensagem que pisca e some).
  if (!turno || turno.estado !== "rodando" || turno.trabalhoId || turno.bastidores || !estado.conversas[turno.conversaId]) return estado;
  const atividade = estado.atividades[turno.conversaId]?.[turno.turnoId];
  if (!atividade) return estado;
  if (!textoDaFala(atividade)) {
    if (!fim) return estado;
    // QA do #534 (27/10): sem texto, o pensamento ("Pensou por N s · N ações") também fica como retrato até a releitura
    // trazer a gravada — senão a fala viva some num quadro e a gravada entra no seguinte (medido em 27/10: 145 ms no Mac,
    // um RTT em produção), o pulo que o retrato existe para evitar. Com um retrato ou uma fala gravada do turno, o resumo
    // vai para eles, como antes; sem ação nenhuma não há o que mostrar (a gravada sem resumo também não tem pensamento).
    if (temRetratoDoTurno(estado, turno.conversaId, turno.turnoId) || gravadaDoTurno(estado, turno.conversaId, turno.turnoId)) return comAcoesNaUltimaSaindo(estado, turno.conversaId, turno.turnoId, atividade.acoes, Math.max(0, agora - turno.desde));
    if (atividade.acoes.length === 0) return estado;
  }
  // Uma por fala (revisão 4 do #508): dois `turno.fala` antes da releitura não apagam o primeiro.
  const atuais = estado.falasSaindo?.[turno.conversaId] ?? {};
  let n = Object.keys(atuais).length;
  while (atuais[`${turno.turnoId}:${agora}:${n}`]) n++;
  const daConversa = { ...atuais, [`${turno.turnoId}:${agora}:${n}`]: { turno, atividade, em: agora } };
  return { ...estado, falasSaindo: { ...estado.falasSaindo, [turno.conversaId]: daConversa } };
}

/** Há um retrato (fala parada) deste turno na conversa? */
function temRetratoDoTurno(estado: Estado, conversaId: string, turnoId: string): boolean {
  return Object.values(estado.falasSaindo?.[conversaId] ?? {}).some((s) => s.turno.turnoId === turnoId);
}

/** A conversa carregada já tem uma fala de texto do bot deste turno? */
function gravadaDoTurno(estado: Estado, conversaId: string, turnoId: string): boolean {
  return (estado.conversas[conversaId]?.mensagens ?? []).some((m) => m.turnoId === turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente");
}

/**
 * QA do #534 (27/10): a releitura que já traz a fala gravada do retrato o tira mesmo tendo começado antes do fim do turno.
 * O `mensagem.nova` da fala final chega antes do `turno.encerrado` e dispara um GET que volta COM a gravada; esperar o GET
 * seguinte (a regra `em > agora` da releitura) deixava retrato e gravada à vista ao mesmo tempo por um RTT (medido em
 * 2026-10-27: 200 ms no Mac, Chrome headless via CDP com o catcher). A gravada do retrato é a fala de texto do bot do mesmo turno com o mesmo texto; o retrato sem
 * texto (só o pensamento) sai quando a fala do turno que leva o resumo (`acoes_do_turno`) chegou.
 */
function gravadaDoRetrato(conversa: ConversaDto, s: FalaSaindo): boolean {
  const texto = textoDaFala(s.atividade).trim();
  return conversa.mensagens.some((m) => m.turnoId === s.turno.turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente" && (texto ? m.texto.trim() === texto : m.payload?.kind === "acoes_do_turno"));
}

/**
 * NOD-353 (revisão do #523): o turno acabou sem fala final depois de um `turno.fala` — a última fala parada dele é a que
 * guarda o resumo (o servidor grava nela, `acoesNaUltimaFalaDoTurno`), então o retrato dela passa a ter as ações do fim.
 */
function comAcoesNaUltimaSaindo(estado: Estado, conversaId: string, turnoId: string, acoes: AtividadeTurno["acoes"], duracaoMs: number): Estado {
  const atuais = estado.falasSaindo?.[conversaId];
  const chave = atuais ? Object.keys(atuais).filter((k) => atuais[k]?.turno.turnoId === turnoId).sort((a, b) => (atuais[a]?.em ?? 0) - (atuais[b]?.em ?? 0)).at(-1) : undefined;
  const s = chave ? atuais?.[chave] : undefined;
  if (!atuais || !chave || !s) return comAcoesNaUltimaGravada(estado, conversaId, turnoId, acoes, duracaoMs);
  if (s.atividade.acoes === acoes) return estado;
  return { ...estado, falasSaindo: { ...estado.falasSaindo, [conversaId]: { ...atuais, [chave]: { ...s, atividade: { ...s.atividade, acoes } } } } };
}

/**
 * NOD-353 (revisão 2 do #523): a releitura do `turno.fala` já trouxe a fala do meio gravada (e tirou o retrato) antes do
 * encerrado — o resumo entra nela na hora, igual ao que o servidor grava (`acoesNaUltimaFalaDoTurno`), sem esperar a
 * próxima releitura (o resumo sumia por um momento).
 */
function comAcoesNaUltimaGravada(estado: Estado, conversaId: string, turnoId: string, acoes: AtividadeTurno["acoes"], duracaoMs: number): Estado {
  const c = estado.conversas[conversaId];
  if (!c || acoes.length === 0) return estado;
  let i = -1;
  for (let k = c.mensagens.length - 1; k >= 0; k--) {
    const m = c.mensagens[k];
    if (m?.turnoId === turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente") { i = k; break; }
  }
  const m = c.mensagens[i];
  if (!m || m.payload) return estado;
  // `duracaoMs` (revisão do PR, 27/10): o tempo do relógio da web, como a parada mostra — sem ele a gravada dizia só
  // "2 ações" até a releitura trazer o do servidor, e o cabeçalho "pronto" mudava de texto.
  const payload = { kind: "acoes_do_turno" as const, acoes: linhasDoResumo(acoes, true).map((l) => ({ rotulo: l.rotulo, ...(l.estado === "falhou" ? { falhou: true as const } : {}), ...(l.vezes ? { vezes: l.vezes } : {}) })), duracaoMs };
  const mensagens = [...c.mensagens];
  mensagens[i] = { ...m, payload };
  return { ...estado, conversas: { ...estado.conversas, [conversaId]: { ...c, mensagens } } };
}

/**
 * Tira as falas que saíam e já não precisam ficar: `fica` decide por fala. A releitura só tira as falas de antes dela
 * (`em <= saiuEm`): uma resposta que saiu antes do fim do turno ainda não traz a fala gravada (revisão 3 do #508).
 */
function semFalasSaindo(estado: Estado, fica: (s: FalaSaindo, conversaId: string) => boolean): Estado {
  if (!estado.falasSaindo) return estado;
  let mudou = false;
  const falasSaindo: NonNullable<Estado["falasSaindo"]> = {};
  for (const [conversaId, daConversa] of Object.entries(estado.falasSaindo)) {
    const restantes: Record<string, FalaSaindo> = {};
    for (const [turnoId, s] of Object.entries(daConversa)) {
      if (fica(s, conversaId)) restantes[turnoId] = s;
      else mudou = true;
    }
    if (Object.keys(restantes).length > 0) falasSaindo[conversaId] = restantes;
  }
  return mudou ? { ...estado, falasSaindo } : estado;
}

function semTurnoVivo(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || !estado.turnosVivos[turnoId]) return estado;
  const turnosVivos = { ...estado.turnosVivos };
  delete turnosVivos[turnoId];
  return { ...estado, turnosVivos };
}

/** Parte 1: quantas falas confirmadas a conversa lembra o idEnvio (a chave do bloco); as mais velhas saem. */
export const ENVIADAS_GUARDADAS = 50;

/** As pendentes da conversa (só se ela está carregada: é dela que a pessoa envia); `enviadas` entra junto, quando há. */
function comPendentes(estado: Estado, conversaId: string, f: (ps: readonly FalaPendente[]) => readonly FalaPendente[], enviadas?: Record<string, string>): Estado {
  const c = estado.conversas[conversaId];
  if (!c) return estado;
  const pendentes = f(c.pendentes ?? []);
  const juntas = enviadas ? Object.fromEntries(Object.entries({ ...c.enviadas, ...enviadas }).slice(-ENVIADAS_GUARDADAS)) : c.enviadas;
  const { pendentes: _antes, enviadas: _enviadas, ...resto } = c;
  return { ...estado, conversas: { ...estado.conversas, [conversaId]: { ...resto, ...(pendentes.length ? { pendentes } : {}), ...(juntas && Object.keys(juntas).length ? { enviadas: juntas } : {}) } } };
}

/** Parte 4: a mensagem que veio no frame, se tem a forma de uma fala de pergunta e a conversa está carregada sem ela. */
function comMensagemDoFrame(estado: Estado, f: FrameSse): Estado {
  const m = mensagemDoFrame(f.dados.mensagem_json);
  const c = m ? estado.conversas[m.conversaId] : undefined;
  if (!m || !c || c.mensagens.some((x) => x.id === m.id)) return estado;
  return { ...estado, conversas: { ...estado.conversas, [m.conversaId]: { ...c, mensagens: [...c.mensagens, m] } } };
}

export function mensagemDoFrame(json: unknown): Mensagem | null {
  if (typeof json !== "string" || json.length > 64_000) return null;
  let m: unknown;
  try { m = JSON.parse(json); } catch { return null; }
  if (!m || typeof m !== "object") return null;
  const x = m as Record<string, unknown>;
  const payload = x.payload as Record<string, unknown> | null | undefined;
  // Revisão de engenharia (27/10): `renderMensagem` lê `autoria.autor_tipo` sem guarda; sem a autoria, a tela quebraria.
  const autoria = x.autoria as Record<string, unknown> | null | undefined;
  // `opcoes` (revisão do PR, 27/10): o cartão faz `.map` nelas; fora de lista, o render da conversa inteira quebraria.
  const ok = typeof x.id === "string" && typeof x.conversaId === "string" && x.kind === "texto" && typeof x.texto === "string" && typeof x.criadoEm === "number" && typeof autoria?.autor_tipo === "string" && payload?.kind === "pedido_a_pessoa" && typeof payload.decisaoId === "string" && (payload.opcoes === undefined || Array.isArray(payload.opcoes));
  return ok ? (m as Mensagem) : null;
}

/** definido em 2026-10-08 (W6): quantos turnos encerrados a web lembra — bem mais que os GETs que podem estar em voo. */
export const ENCERRADOS_GUARDADOS = 200;

/** NOD-216: o turno vivo foi confirmado pelo servidor antes de uma leitura que saiu em `leituraEm`? */
const confirmadoAntes = (v: TurnoVivo, leituraEm: number): boolean => (v.vistoEm ?? v.desde) < leituraEm;

/**
 * NOD-216 (revisão): as origens que `dono.fila` lista (src/repositories/donos.repo.ts). Um pendente de outra origem
 * (`retomada`, por exemplo) não aparece nela e nem por isso é fantasma; origem desconhecida também não se desmente.
 */
export const ORIGENS_DA_FILA_DO_DONO: ReadonlySet<string> = new Set(["conversa", "delegacao", "peer", "rotina"]);

/** Tira os turnos desmentidos por uma leitura que saiu em `leituraEm`, e lembra disso (`turnosDesmentidos`). */
function semDesmentidos(estado: Estado, ids: readonly string[], leituraEm: number): Estado {
  if (ids.length === 0) return estado;
  // QA do #534 (27/10): a leitura que desmente um turno rodando chega antes do `turno.encerrado`/`interrompido` (a de
  // trabalhos, ou a que o próprio Parar dispara; medido em 2026-10-27: 86 ms e 50 ms sem fala nenhuma, no Mac). A fala viva dele fica como
  // retrato, igual ao fim pelo frame: a releitura que traz a gravada o tira (`gravadaDoRetrato`) e `FALA_SAINDO_MS` dá o teto.
  let comRetratos = estado;
  for (const id of ids) comRetratos = comFalaSaindo(comRetratos, id, leituraEm, true);
  const turnosVivos = { ...comRetratos.turnosVivos };
  const lembrados = Object.entries({ ...estado.turnosDesmentidos, ...Object.fromEntries(ids.map((id) => [id, leituraEm])) });
  for (const id of ids) delete turnosVivos[id];
  return { ...comRetratos, turnosVivos, turnosDesmentidos: Object.fromEntries(lembrados.slice(-ENCERRADOS_GUARDADOS)) };
}

/** A leitura que saiu em `leituraEm` é mais velha que a que desmentiu o turno: ela não o traz de volta. */
const desmentidoDepois = (estado: Estado, turnoId: string, leituraEm: number): boolean => (estado.turnosDesmentidos[turnoId] ?? -Infinity) > leituraEm;

/**
 * NOD-219 (definido em 2026-10-13): a conversa PRÓPRIA do bot trabalha? A barra e a conversa reconciliadas aqui são a
 * própria; `conversaTrabalhando` conta também o turno do bot numa sala, que segurava o vivo de uma conversa própria
 * parada. O servidor de antes não manda o campo novo: aí vale o de sempre. NOD-260 (definido em 2026-10-15): o servidor
 * novo manda sempre o campo, e o turno de sala nunca entra nele.
 */
const propriaTrabalhando = (e: EstadoDoDono): boolean => e.conversaPropriaTrabalhando ?? e.conversaTrabalhando;

/**
 * NOD-216: os mascotes da barra são dos bots cuja conversa NÃO está aberta — essa conversa não é relida, e um turno vivo
 * que perdeu o `turno.encerrado` ficava animando o bot para sempre. `GET trabalhos` traz o dono de cada bot, lido no
 * servidor agora: sem `conversaPropriaTrabalhando` (NOD-219), nenhum turno da conversa roda; fora de `fila`, nenhum espera a vez. O vivo
 * da conversa do bot que o dono desmente sai (só o confirmado antes da leitura; o de task é da tela da task).
 */
function reconciliarPelosDonos(estado: Estado, trabalhos: TrabalhosDto, leituraEm: number | undefined): Estado {
  const donos = trabalhos.donos;
  if (leituraEm === undefined || !Array.isArray(donos) || donos.length === 0) return estado;
  const conversaDe = new Map((estado.frota?.agentes ?? []).map((a) => [a.id, a.conversaId]));
  const desmentidos: string[] = [];
  for (const dono of donos) {
    const conversaId = conversaDe.get(dono.estado.agenteId);
    if (!conversaId) continue;
    const naFila = new Set(dono.fila.map((p) => p.turnoId));
    const trabalhando = propriaTrabalhando(dono.estado);
    for (const v of Object.values(estado.turnosVivos)) {
      if (v.conversaId !== conversaId || v.trabalhoId || !confirmadoAntes(v, leituraEm)) continue;
      // Revisão: o "na fila" fora da fila com o bot trabalhando pode ser o mesmo turno, já despachado (o frame
      // turno_despachado perdido ou ainda a caminho) — fica; e só a origem que a fila lista pode ser desmentida por ela.
      const desmentido = v.estado === "rodando"
        ? !trabalhando
        : !naFila.has(v.turnoId) && !trabalhando && ORIGENS_DA_FILA_DO_DONO.has(v.origem ?? "");
      if (desmentido) desmentidos.push(v.turnoId);
    }
  }
  return semDesmentidos(estado, desmentidos, leituraEm);
}

/**
 * NOD-300 (definido em 2026-10-20): o dono lido em `GET trabalhos` vale também para a conversa do bot — a linha acima do
 * campo e a barra leem o da conversa (web/lib/dono.ts) e, sem isto, a releitura de Trabalhos (a máquina que perdeu o
 * contato) não mudava a barra. A regra do `comEstadoDoDono`: só as conversas daquele bot ganham objeto novo, e só quando
 * o dono mudou de fato.
 */
export function comDonosNasConversas(e: Estado, donos: readonly DonoDto[] | undefined): Estado {
  if (!Array.isArray(donos) || donos.length === 0) return e;
  const porBot = new Map(donos.map((d) => [d.estado.agenteId, d]));
  const trocadas = Object.entries(e.conversas).flatMap(([id, c]) => {
    const novo = c.dono ? porBot.get(c.dono.estado.agenteId) : undefined;
    return novo && JSON.stringify(novo) !== JSON.stringify(c.dono) ? [[id, { ...c, dono: novo }] as const] : [];
  });
  return trocadas.length === 0 ? e : { ...e, conversas: { ...e.conversas, ...Object.fromEntries(trocadas) } };
}

/**
 * QA do PR #302 (NOD-216): o bot que o dono diz trabalhando (ou com fila) e cuja conversa a web ainda não leu tem a
 * conversa pedida (`vivos:`, buscada mesmo fora da tela). Sem isto, depois de um reload a barra mostrava "disponível" o
 * bot que rodava, até a conversa dele abrir: os turnos vivos só vinham da conversa carregada, e `GET trabalhos` só
 * desmente. A leitura da conversa traz os turnos dela (a sala e a task continuam fora); lida uma vez, não se pede de novo.
 */
function comConversasDosDonos(estado: Estado): Estado {
  const donos = estado.trabalhos?.donos;
  if (!Array.isArray(donos) || donos.length === 0 || !estado.frota) return estado;
  const conversaDe = new Map(estado.frota.agentes.map((a) => [a.id, a.conversaId]));
  const pedir: Invalidacao[] = [];
  for (const dono of donos) {
    const conversaId = conversaDe.get(dono.estado.agenteId);
    if (conversaId && !estado.conversas[conversaId] && (propriaTrabalhando(dono.estado) || dono.fila.length > 0)) pedir.push(`vivos:${conversaId}`);
  }
  return invalidar(estado, ...pedir);
}

function encerrado(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || estado.turnosEncerrados.includes(turnoId)) return estado;
  return { ...estado, turnosEncerrados: [turnoId, ...estado.turnosEncerrados].slice(0, ENCERRADOS_GUARDADOS) };
}

/** `turno.fala`: zera só o texto em streaming do turno (o resto da atividade segue com o turno vivo). */
function semTexto(estado: Estado, conversaId: string | null, turnoId: string | null): Estado {
  const a = conversaId && turnoId ? estado.atividades[conversaId]?.[turnoId] : undefined;
  if (!a || !conversaId || !turnoId) return estado;
  // NOD-350: com subagentes, o cartão recomeça só com eles (e a última ferramenta como ✓); eles seguem depois da fala.
  // NOD-353: as ações seguem (o resumo é do turno inteiro); a volta acabou, então nenhuma roda mais.
  // Revisão do PR (27/10): `antes` zera, então o `nota` das ações de antes sai junto (`acoesSemNota`).
  const proxima = soSubagentes(a) ?? { ...a, atual: "", antes: [], curtasDescartadas: undefined, acoes: acoesSemNota(acoesFechadas(a.acoes)), cabecalho: undefined };
  return { ...estado, atividades: { ...estado.atividades, [conversaId]: { ...estado.atividades[conversaId], [turnoId]: proxima } } };
}

export const SUBAGENTES_DO_FIM_GUARDADOS = 50;

/**
 * NOD-350: o turno acabou (ou foi parado). Quem ainda trabalhava vira parado (critério 5) e a lista final fica guardada
 * por turnoId para a task terminada; o cartão ao vivo some em seguida (o delete abaixo).
 */
function fimDosSubagentes(estado: Estado, conversaId: string | null, turnoId: string | null, agora: number): Estado {
  if (!conversaId || !turnoId) return estado;
  const daConversa = estado.atividades[conversaId];
  const final = subagentesParados(daConversa?.[turnoId]?.subagentes ?? null, agora);
  if (!daConversa || !(turnoId in daConversa)) return estado;
  const restantes = { ...daConversa };
  delete restantes[turnoId];
  const atividades = { ...estado.atividades, [conversaId]: restantes };
  if (!final) return { ...estado, atividades };
  const guardados = Object.entries({ ...estado.subagentesDoFim, [turnoId]: final }).slice(-SUBAGENTES_DO_FIM_GUARDADOS);
  return { ...estado, atividades, subagentesDoFim: Object.fromEntries(guardados) };
}

function semConversa(atividades: Estado["atividades"], conversaId: string): Estado["atividades"] {
  const restantes = { ...atividades };
  delete restantes[conversaId];
  return restantes;
}

/**
 * A faixa de Trabalhos aberta depois de navegar (revisto em 2026-10-09: o padrão ao entrar na conversa é a pílula). Fica
 * aberta enquanto a pessoa continua na conversa do bot: na mesma conversa, na tela de uma task (ou de uma linha) e ao
 * voltar dela. Entrar na conversa vindo de outro lugar (outro bot, "Todos os trabalhos", Seu espaço) recolhe.
 */
export function faixaAbertaAoNavegar(aberta: string | null, de: Tela, para: Tela): string | null {
  if (!aberta) return null;
  if (para.tipo === "trabalho" || para.tipo === "linha") return aberta;
  if (para.tipo !== "conversa" || para.agenteId !== aberta) return null;
  const continua = de.tipo === "trabalho" || de.tipo === "linha" || (de.tipo === "conversa" && de.agenteId === aberta);
  return continua ? aberta : null;
}

/**
 * NOD-280 (critério 9): a conversa aberta tem nota de limite com `contas` (ADR-102). A lista de contas vale para ela: a
 * conta que entrou na máquina depois da nota vira "Seguir com", e `contas.mudou` relê a lista com a conversa aberta.
 */
export function conversaAbertaTemNotaDeContas(estado: Pick<Estado, "tela" | "conversas">): boolean {
  const t = estado.tela;
  if (t.tipo !== "conversa" && t.tipo !== "sala" && t.tipo !== "linha") return false;
  return estado.conversas[t.conversaId]?.mensagens.some((m) => m.payload?.kind === "limite_do_plano" && !!m.payload.contas) ?? false;
}

/**
 * A conversa que a tela mostra (conversa ou sala), já carregada ou ainda chegando. ADR-083: a tela da task mostra o ao
 * vivo do turno do trabalho, que chega pelos frames da conversa do bot dele — mesmo de outro bot, nunca aberta.
 */
export function conversaIdNaTela(estado: Estado): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha") return t.conversaId;
  if (t.tipo === "trabalho") return estado.trabalhoDetalhe[t.id]?.trabalho.conversaId ?? estado.trabalhos?.trabalhos.find((x) => x.id === t.id)?.conversaId ?? null;
  return null;
}

/**
 * O texto ao vivo de uma conversa é guardado quando ela está carregada OU é a que a tela está abrindo.
 * definido em 2026-10-01: abrir um bot no meio da resposta põe o GET da conversa para correr junto com os
 * deltas, e o que chegava antes dele era descartado, então a fala aparecia começando no meio (achado da
 * revisão do PR #99). Conversa fora da tela e nunca aberta continua sem guardar (ADR-061, mudouNaTela).
 */
function guardaAoVivo(estado: Estado, conversaId: string): boolean {
  return Boolean(estado.conversas[conversaId]) || conversaIdNaTela(estado) === conversaId;
}

/** O turno vivo `turnoId` da conversa, trocado por `mudar` (o resto de `atividades` fica com a mesma referência). */
function comAtividade(estado: Estado, conversaId: string, turnoId: string, mudar: (a: AtividadeTurno | undefined) => AtividadeTurno, agora?: number): Estado["atividades"] {
  const daConversa = estado.atividades[conversaId] ?? {};
  // Parte 2 do plano "o pensamento no chat": o cabeçalho do pensamento (com a permanência) acompanha cada mudança.
  const antiga = daConversa[turnoId];
  const nova = mudar(antiga);
  return { ...estado.atividades, [conversaId]: { ...daConversa, [turnoId]: agora === undefined ? nova : comCabecalho(comFrentesEm(antiga, nova, agora), agora) } };
}

/**
 * NOD-402 (ADR-130): as origens que nascem nos bastidores — a mesma lista de `ORIGENS_DOS_BASTIDORES` (src/domain/triagem.ts),
 * repetida aqui porque a web não importa o domínio. O servidor manda `bastidores: true` nos frames e no DTO (inclusive na
 * retomada, que herda a faixa com outra origem); a origem só cobre o GET de um servidor antigo (o DTO traz o `trabalhoId`).
 */
const ORIGENS_DOS_BASTIDORES: ReadonlySet<string> = new Set(["rotina", "delegacao", "peer"]);
// definido em 2026-10-28: a marca do frame é a do servidor (que já deixa de fora a frente de rotina ou colega, com `trabalhoId`).
// A origem não basta: o `turno_criado` da repetição de uma frente (contas-ia) leva `origem: "rotina"` sem o `trabalhoId`.
const bastidoresDoFrame = (dados: Record<string, unknown>): boolean => !dados.trabalhoId && !dados.trabalho_id && dados.bastidores === true;

/**
 * NOD-402: o frame ao vivo (texto, ferramenta, etapas, subagentes, vigia) é de um turno dos bastidores? Esses não guardam
 * atividade: nada deles vai ao chat. O frame direto do plano chega antes do `turno.iniciado` (outbox), então vale a marca
 * do próprio frame além da do turno vivo.
 */
function deBastidores(e: Estado, dados: Record<string, unknown>, turnoId: string): boolean {
  const vivo = e.turnosVivos[turnoId];
  if (dados.trabalhoId || dados.trabalho_id || vivo?.trabalhoId) return false;
  return dados.bastidores === true || vivo?.bastidores === true;
}

/** O frame é do turno do cérebro de uma ligação (ADR-071)? `modo` é o que o servidor manda; `origem` também vale. */
function turnoDeLigacao(dados: Record<string, unknown>): boolean {
  return dados.modo === "ligacao" || dados.origem === "ligacao";
}

/**
 * O aviso do vigia do turno (NOD-73) como a tela o guarda. `mudoMs` vira o instante em que o silêncio começou, para a
 * contagem de minutos andar sem frame novo. Fora do formato, null (o frame é ignorado).
 */
function vigiaDoFrame(d: Record<string, unknown>, agora: number): VigiaDaAtividade | null {
  const mudoMs = d.mudoMs;
  const emFundo = d.emFundo;
  if (typeof mudoMs !== "number" || !Number.isFinite(mudoMs) || mudoMs < 0 || typeof emFundo !== "number" || !Number.isFinite(emFundo) || emFundo < 0) return null;
  const r = d.repeticao && typeof d.repeticao === "object" ? (d.repeticao as Record<string, unknown>) : null;
  const rotulo = r ? texto(r.rotulo) : null;
  const repeticao = r && rotulo && typeof r.vezes === "number" && r.vezes > 0 ? { rotulo, vezes: r.vezes } : null;
  return { mudoDesde: mudoMs > 0 ? agora - mudoMs : null, aberta: texto(d.aberta), emFundo: Math.floor(emFundo), repeticao };
}

/** Um handler por TipoFrame — a tabela é TOTAL: um tipo novo no contrato não compila sem entrar aqui. */
type Handler = (estado: Estado, frame: FrameSse, agora: number) => Estado;

/**
 * O estado do dono que chega no frame `trabalho.mudou` (definido em 2026-10-12, ADR-099, parte 5): troca o `estado` do
 * dono daquele bot na lista de `GET trabalhos` e na conversa dele, sem mexer nas esperas e na fila (o REST traz). Fora do
 * formato (ou ausente: a leitura falhou no servidor), nada muda.
 */
export function comEstadoDoDono(e: Estado, cru: unknown): Estado {
  if (!cru || typeof cru !== "object") return e;
  const novo = cru as EstadoDoDono;
  if (typeof novo.agenteId !== "string" || typeof novo.principal !== "string" || typeof novo.frentes !== "number") return e;
  const trocar = (d: DonoDto): DonoDto => (d.estado.agenteId === novo.agenteId ? { ...d, estado: novo } : d);
  const donos = e.trabalhos?.donos;
  const trabalhos = e.trabalhos && donos?.some((d) => d.estado.agenteId === novo.agenteId) ? { ...e.trabalhos, donos: donos.map(trocar) } : e.trabalhos;
  // Só as conversas daquele bot ganham objeto novo (a tela lembra o que desenha pela referência, web/lib/lembrar.ts).
  const doBot = Object.entries(e.conversas).filter(([, c]) => c.dono?.estado.agenteId === novo.agenteId);
  const conversas = doBot.length === 0 ? e.conversas : { ...e.conversas, ...Object.fromEntries(doBot.map(([id, c]) => [id, { ...c, dono: c.dono ? trocar(c.dono) : c.dono }])) };
  return trabalhos === e.trabalhos && conversas === e.conversas ? e : { ...e, trabalhos, conversas };
}

const conv = (f: FrameSse): Invalidacao | null => {
  const id = texto(f.dados.conversaId);
  return id ? `conversa:${id}` : null;
};

/**
 * ADR-114 (chat limpo, PR 2): a mensagem nova, a negação (a de conector chega só por esse frame) e o trabalho que mudou na
 * conversa de um bot releem o "N hoje" dele — só se a linha já foi lida — e a página da Atividade aberta dele. O frame não
 * diz o assunto: relê a contagem, que é barata (`contagem=1`). O main junta as releituras numa por segundo.
 */
function atividadeDoFrame(e: Estado, f: FrameSse): Invalidacao[] {
  const conversaId = texto(f.dados.conversaId);
  const bot = conversaId ? e.frota?.agentes.find((a) => a.conversaId === conversaId) : undefined;
  if (!bot) return [];
  const quais: Invalidacao[] = [];
  if (e.atividadeHoje[bot.id]) quais.push(`atividade-hoje:${bot.id}`);
  if (e.atividadeVista?.agenteId === bot.id) quais.push(`atividade:${chaveDaAtividade(bot.id, e.atividadeVista.dia)}`);
  // NOD-70: a aba Decisões aberta relê a página (a decisão nova entra no topo; "Carregar mais" recomeça da 1ª página).
  const v = e.atividadeVista;
  if (v?.agenteId === bot.id && v.aba === "decisoes") quais.push(`decisoes:${chaveDasDecisoes(bot.id, v.dia, v.desfecho)}`);
  return quais;
}

/**
 * NOD-326: a fala nova e o fim do turno (a mídia do bot se prende à fala final) releem a 1ª página da Biblioteca da
 * conversa — só se ela já foi lida; a releitura junta o novo ao que a pessoa já carregou (web/lib/biblioteca.ts).
 */
function bibliotecaDoFrame(e: Estado, f: FrameSse): Invalidacao[] {
  const conversaId = texto(f.dados.conversaId);
  return conversaId && e.bibliotecaDoBot[conversaId] ? [`biblioteca:${conversaId}`] : [];
}

/** O turno da ligação não é trabalho do bot (ADR-072): não relê Trabalhos. */
const trabalhosDoTurno = (f: FrameSse): Invalidacao[] => (turnoDeLigacao(f.dados) || f.dados.modo === "ligacao" || f.dados.origem === "ligacao" ? [] : ["trabalhos"]);

/** NOD-353: o id da chamada no frame (o mesmo formato que a ponte aceita); fora dele, a ação fica sem id. */
const idDaAcao = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null);

/** NOD-348: o `emUso` do frame, conferido; o servidor antigo não o manda e a fala diz "Usando uma ferramenta". */
function emUsoDoFrame(v: unknown): FerramentaEmUso {
  if (!v || typeof v !== "object") return SEM_NOME_DA_FERRAMENTA;
  const { texto: t, frentes } = v as Record<string, unknown>;
  return typeof t === "string" && t.trim() ? { texto: t.trim().slice(0, 80), frentes: frentes === true } : SEM_NOME_DA_FERRAMENTA;
}

/** NOD-312: o motivo do recomeço do frame, conferido contra a lista do contrato (valor desconhecido = nenhum). */
function motivoDoFrame(v: unknown): MotivoRecomeco | null {
  return ehMotivoRecomeco(v) ? v : null;
}

const POR_FRAME: Record<TipoFrame, Handler> = {
  // definido em 2026-09-29 (0039): a mensagem nova também relê os não lidos (o ponto da barra e o ícone do topo).
  "mensagem.nova": (e, f) => (conv(f) ? invalidar(e, conv(f), "nao-lidos", ...atividadeDoFrame(e, f), ...bibliotecaDoFrame(e, f)) : e),
  "turno.iniciado": (e, f, agora) => {
    // definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação não é trabalho do bot — nada de "trabalhando", fila ou Parar.
    if (f.dados.modo === "ligacao" || f.dados.origem === "ligacao") return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId) return invalidar(e, conv(f));
    // Modo ligação (definido em 2026-10-04, ADR-071): o turno do cérebro da ligação não é "trabalhando", nem fila, nem
    // Parar — a tela da ligação mostra o que ele faz. O servidor marca o frame com `modo: "ligacao"` (e `origem`).
    if (turnoDeLigacao(f.dados)) return invalidar(e, conv(f));
    // dados.kind distingue "na fila" (turno_criado) de "rodando" (turno_despachado) — pendência L8 §5.
    const estado = f.dados.kind === "turno_despachado" ? "rodando" : "na_fila";
    const anterior = e.turnosVivos[turnoId];
    const trabalhoId = texto(f.dados.trabalhoId) ?? texto(f.dados.trabalho_id) ?? anterior?.trabalhoId ?? null;
    const vivo: TurnoVivo = { turnoId, conversaId, estado, executor: texto(f.dados.executor) ?? anterior?.executor ?? null, machineId: texto(f.dados.machine_id) ?? anterior?.machineId ?? null, desde: estado === "rodando" && anterior?.estado !== "rodando" ? agora : (anterior?.desde ?? agora), trabalhoId, vistoEm: agora, chegouEm: anterior?.chegouEm ?? agora, origem: texto(f.dados.origem) ?? anterior?.origem ?? null, agenteId: texto(f.dados.agente_id) ?? texto(f.dados.agenteId) ?? anterior?.agenteId ?? null, motivoRecomeco: motivoDoFrame(f.dados.motivo_recomeco) ?? anterior?.motivoRecomeco ?? null, ...(!trabalhoId && (bastidoresDoFrame(f.dados) || anterior?.bastidores) ? { bastidores: true } : {}), ...(typeof f.dados.despachadoEm === "number" ? { despachadoEm: f.dados.despachadoEm } : anterior?.despachadoEm !== undefined ? { despachadoEm: anterior.despachadoEm } : {}), ...(typeof f.dados.criadoEm === "number" ? { criadoEm: f.dados.criadoEm } : anterior?.criadoEm !== undefined ? { criadoEm: anterior.criadoEm } : {}) };
    return invalidar({ ...e, turnosVivos: { ...e.turnosVivos, [turnoId]: vivo } }, conv(f), "trabalhos");
  },
  "turno.delta": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    const trecho = typeof f.dados.texto === "string" ? f.dados.texto : "";
    if (!turnoId || !conversaId) return e;
    const vivo = e.turnosVivos[turnoId];
    const turnosVivos = vivo && vivo.estado !== "rodando" ? { ...e.turnosVivos, [turnoId]: { ...vivo, estado: "rodando" as const, desde: agora } } : e.turnosVivos;
    if (!guardaAoVivo(e, conversaId) || deBastidores(e, f.dados, turnoId)) return turnosVivos === e.turnosVivos ? e : { ...e, turnosVivos };
    return { ...e, turnosVivos, atividades: comAtividade(e, conversaId, turnoId, (a) => comTexto(a, trecho), agora) };
  },
  "turno.atividade": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    const rotulo = texto(f.dados.rotulo) ?? "Usou uma ferramenta";
    const vivo = e.turnosVivos[turnoId];
    const turnosVivos = vivo && vivo.estado !== "rodando" ? { ...e.turnosVivos, [turnoId]: { ...vivo, estado: "rodando" as const, desde: agora } } : e.turnosVivos;
    if (deBastidores(e, f.dados, turnoId)) return turnosVivos === e.turnosVivos ? e : { ...e, turnosVivos };
    return { ...e, turnosVivos, atividades: comAtividade(e, conversaId, turnoId, (a) => comFerramenta(a, rotulo, emUsoDoFrame(f.dados.emUso), idDaAcao(f.dados.id)), agora) };
  },
  // NOD-353: a chamada terminou (feita ou Falhou, de tool_result.isError); fim de turno ou id desconhecido não muda nada.
  "turno.acao_fim": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    const id = idDaAcao(f.dados.id);
    if (!turnoId || !conversaId || !id || !guardaAoVivo(e, conversaId) || deBastidores(e, f.dados, turnoId)) return e;
    const a = e.atividades[conversaId]?.[turnoId];
    const nova = comFimDaAcao(a, id, f.dados.falhou === true);
    return !nova || nova === a ? e : { ...e, atividades: { ...e.atividades, [conversaId]: { ...e.atividades[conversaId], [turnoId]: comCabecalho(nova, agora) } } };
  },
  "turno.tarefas": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId) || deBastidores(e, f.dados, turnoId)) return e;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => comTarefas(a, tarefasDoFrame(f.dados.tarefas)), agora) };
  },
  // NOD-350: a lista inteira dos subagentes do turno (o servidor manda no máximo ~1 por segundo) e a linha pronta.
  "turno.subagentes": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId) || deBastidores(e, f.dados, turnoId)) return e;
    // A descarga do último frame pode chegar depois do fim: não ressuscita o cartão, só acerta a lista final.
    if (e.turnosEncerrados.includes(turnoId)) {
      const fim = e.subagentesDoFim[turnoId];
      if (!fim) return e;
      // A base é a lista final guardada: quem já tinha terminado mantém a hora em que a tela viu o fim.
      const lista = subagentesParados(comSubagentes({ ...ATIVIDADE_VAZIA, subagentes: fim }, subagentesDoFrame(f.dados.subagentes), texto(f.dados.resumo), agora).subagentes, agora);
      return lista ? { ...e, subagentesDoFim: { ...e.subagentesDoFim, [turnoId]: lista } } : e;
    }
    // `principalOcioso`: a volta do bot acabou, com ou sem fala (sala, ou só disparou os subagentes) — a última
    // ferramenta dele vira ✓ e deixa de pulsar no "agora" (critério 2).
    const ocioso = f.dados.principalOcioso === true;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => {
      const nova = comSubagentes(a, subagentesDoFrame(f.dados.subagentes), texto(f.dados.resumo), agora);
      return ocioso ? semFerramentaAberta(nova) : nova;
    }, agora) };
  },
  // NOD-73: o vigia só avisa. Guarda o aviso no turno vivo; a ligação não mostra nada disso (ADR-071).
  "turno.vigia": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId) || deBastidores(e, f.dados, turnoId)) return e;
    const vigia = vigiaDoFrame(f.dados, agora);
    if (!vigia) return e;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => comVigia(a, vigia)) };
  },
  // ADR-067: a volta do modelo virou mensagem e o turno segue rodando — a conversa relê, e o cartão ao vivo recomeça
  // vazio para a próxima volta (senão o mesmo texto apareceria duas vezes). NOD-348 (revisão 3 do #508): o texto que
  // virou mensagem fica como fala parada até a releitura, e o turno segue com as etapas, o vigia e a ferramenta em uso.
  "turno.fala": (e, f, agora) => invalidar(semTexto(comFalaSaindo(e, texto(f.dados.turnoId), agora), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f)),
  // NOD-260 (definido em 2026-10-15, J1): o turno que começa, acaba ou é interrompido muda Trabalhos (a linha do dono, o
  // "Trabalhando · há N"); antes só `trabalho.mudou` relia, e o turno da conversa ficava "trabalhando" lá. Os frames são
  // da pessoa (o barramento publica por pessoa); main.ts junta a releitura numa por segundo (web/lib/releitura-adiada.ts).
  // definido em 2026-10-16 (plano "tela limpa", T6): o CLI informa o uso do plano a cada turno, então o anel do seletor relê
  // quando um turno termina (uma leitura por turno, sem relógio novo); fora da conversa a falta espera a tela pedir. O turno
  // interrompido também gastou a janela (e é o que acaba quando a conta bate no limite): relê igual (revisão do PR 1).
  // NOD-12: e a lista de contas, que carrega a leitura por conta.
  // NOD-114 (revisão): e os não lidos — a fala do meio que virou o fim do turno só vira o aviso "terminou" numa releitura.
  "turno.encerrado": (e, f, agora) => invalidar(fimDosSubagentes(encerrado(semTurnoVivo(comFalaSaindo(e, texto(f.dados.turnoId), agora, true), texto(f.dados.turnoId)), texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId), agora), conv(f), "frota", "nao-lidos", usoPlano(e), contasDoTurno(e), ...trabalhosDoTurno(f), ...bibliotecaDoFrame(e, f)),
  // QA do #534 (27/10): o Parar deixa o retrato como o fim normal — a fala viva não some antes de a gravada (parcial) chegar.
  "turno.interrompido": (e, f, agora) => invalidar(fimDosSubagentes(encerrado(semTurnoVivo(comFalaSaindo(e, texto(f.dados.turnoId), agora, true), texto(f.dados.turnoId)), texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId), agora), conv(f), "frota", "sua-vez", usoPlano(e), contasDoTurno(e), ...trabalhosDoTurno(f), ...bibliotecaDoFrame(e, f)),
  // Parte 4 do plano "o pensamento no chat": a fala da pergunta vem no frame (`mensagem_json`) e entra na conversa já
  // carregada, provisória, até a releitura (que a traz igual, pelo mesmo id). Sem o campo (servidor de antes), só relê.
  "decisao.nova": (e, f) => invalidar(comMensagemDoFrame(e, f), "sua-vez", conv(f)),
  "decisao.decidida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "decisao.vencida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "proposta.nova": (e, f) => invalidar(e, conv(f)),
  "rotina.criada": (e, f) => invalidar(e, "rotinas", conv(f)),
  "rotina.executou": (e, f) => {
    const rotinaId = texto(f.dados.rotinaId) ?? texto(f.dados.rotina_id);
    return invalidar(e, "rotinas", conv(f), rotinaId ? `execucoes:${rotinaId}` : null);
  },
  "sala.handoff": (e, f) => invalidar(e, conv(f)),
  negacao: (e, f, agora) => {
    const classe = f.dados.classe;
    const motivo = f.dados.motivo;
    const nome = texto(f.dados.nome) ?? texto(f.dados.ferramenta) ?? "(sem nome)";
    const valida = (classe === "ferramenta_negada" || classe === "conector_indisponivel" || classe === "plano_ausente") && typeof motivo === "string";
    if (!valida) return invalidar(e, conv(f));
    // definido em 2026-10-11: a causa que o hook do nod deu e quantas vezes no turno (causa desconhecida: a tela cai no motivo).
    const causaNativa = typeof f.dados.causa_nativa === "string" ? (f.dados.causa_nativa as CausaNativa) : null;
    const vezes = typeof f.dados.vezes === "number" && f.dados.vezes > 1 ? f.dados.vezes : null;
    const vista: NegacaoVista = { classe, nome, motivo: motivo as Negacao["motivo"], desde: typeof f.dados.desde === "number" ? f.dados.desde : agora, terminal: f.dados.terminal === true, conversaId: texto(f.dados.conversaId), vistaEm: agora, ...(causaNativa ? { causa: causaNativa } : {}), ...(vezes ? { vezes } : {}) };
    // definido em 2026-09-16: as 20 mais recentes bastam na tela; o registro completo está na trilha.
    return invalidar({ ...e, negacoes: [vista, ...e.negacoes].slice(0, 20) }, conv(f), ...atividadeDoFrame(e, f));
  },
  // definido em 2026-09-24 (emenda da ADR-037): só a SAÚDE (entrou ou saiu do ar) muda a frota — a
  // lateral, o cabeçalho e o painel; as ações comuns do computador não relêem nada.
  "computador.mudou": (e, f) => (f.dados.saude === true ? invalidar(e, "frota") : e),
  // definido em 2026-10-16 (decisão E6): o uso da janela é relido junto com as IAs.
  // NOD-300: e os trabalhos — a máquina que perdeu ou recuperou o contato (motivo "presenca") muda a linha do dono.
  "inventario.mudou": (e) => invalidar(e, "inventario", "frota", "executor", "ias", usoPlano(e), "maquinas", "trabalhos"),
  // ADR-102: a lista de contas (ou um login numa máquina) mudou. definido em 2026-10-16 (revisão do PR 1): a conta em uso
  // pode ter trocado (limite, login, outra conta na frente), e com ela o uso da janela do anel.
  // NOD-374: o app entrou ou saiu de Fora do ar (sonda, laço ou chamada que limpou): a lateral e a tela de apps se atualizam.
  "conector.mudou": (e) => invalidar(e, "frota", "conectores"),
  "contas.mudou": (e) => invalidar(e, "contas", "maquinas", usoPlano(e)),
  "agente.mudou": (e, f) => {
    const agenteId = texto(f.dados.agente_id) ?? texto(f.dados.agenteId);
    // NOD-58: qualquer mudança na memória (o bot anotou, a pessoa editou, apagou ou desfez) relê a lista e o histórico.
    const daMemoria = String(f.dados.acao ?? "").startsWith("memoria_") && agenteId;
    const memoria: Invalidacao | null = daMemoria ? `memoria:${agenteId}` : null;
    const diario: Invalidacao | null = daMemoria ? `diario:${agenteId}` : null;
    const concessoes: Invalidacao | null = f.dados.kind === "concessao_criada" && agenteId ? `concessoes:${agenteId}` : null;
    return invalidar(e, "frota", "gestao", "nao-lidos", ...(["excluir", "restaurar", "duplicado"].includes(String(f.dados.acao)) ? ["rotinas", "salas", "sua-vez"] as const : []), conv(f), memoria, diario, concessoes);
  },
  "parada.faixa": (e, f) => {
    const faixa: FaixaParada = {
      interrompidas: typeof f.dados.interrompidas === "number" ? f.dados.interrompidas : 0,
      naoInterrompidas: [],
      jaEntregues: [],
      nadaRodando: f.dados.nada_rodando === true,
    };
    return invalidar({ ...e, faixaParada: faixa }, conv(f));
  },
  // O relato é registro, não estado vivo da conversa: nada na timeline muda, então nada se invalida.
  // A seção Feedback relê ao entrar (definido em 2026-09-21; NOD-367 zera a lista no "espaco").
  "relato.criado": (e) => e,
  // A linha "Chat de voz" da conversa e a ligação viva (a barra lateral marca o bot "Em ligação").
  "ligacao.mudou": (e, f) => invalidar(e, conv(f), "ligacao"),
  // ADR-113: as reações de uma fala mudaram (noutra aba ou pelo próprio clique) — relê a conversa, que traz o chip.
  "reacao.mudou": (e, f) => invalidar(e, conv(f)),
  "checkpoint.mudou": (e, f) => invalidar(e, conv(f)),
  // NOD-351: o cartão de conta é do controlador de conta-no-chat (main.ts), fora do estado: o reducer não muda nada.
  "conta.abrir": (e) => e,
  // NOD-442: o quadro mora fora do estado do chat (web/lib/quadro-na-tela.ts relê por REST ao ver o frame).
  "quadro.mudou": (e) => e,
  // NOD-445: as páginas do bot moram fora do estado (web/lib/paginas-na-tela.ts relê por REST ao ver o frame).
  "paginas.mudaram": (e) => e,
  "canvas.mudou": (e) => e,
  // ADR-083: um trabalho nasceu ou mudou — relê a lista (faixa, barra, gaveta), a conversa do bot (a linha "Abriu a
  // task", a pergunta e o resultado) e a tela da task, se ela já foi aberta.
  "trabalho.mudou": (e, f) => {
    const id = texto(f.dados.trabalhoId) ?? texto(f.dados.trabalho_id);
    const aberta = id && (e.trabalhoDetalhe[id] || (e.tela.tipo === "trabalho" && e.tela.id === id)) ? (`trabalho:${id}` as Invalidacao) : null;
    // ADR-099 (parte 5): o estado do dono que o frame traz vale na hora (a linha acima do campo, o chip e Trabalhos), antes
    // de a lista e a conversa voltarem do REST.
    return invalidar(comEstadoDoDono(e, f.dados.estadoDono), "trabalhos", conv(f), aberta, ...atividadeDoFrame(e, f));
  },
  // #194: o nível vale na hora (a pílula aparece sem esperar o REST); a lista relê para o total de memória.
  "memoria.mudou": (e, f) => {
    const nivel = f.dados.nivel;
    if (nivel !== "verde" && nivel !== "amarela" && nivel !== "vermelha") return e;
    return invalidar(e.pressao === nivel ? e : { ...e, pressao: nivel }, "trabalhos");
  },
  resumed: (e, f) => (f.dados.resumed === true ? e : invalidar(e, "frota", "sua-vez", "nao-lidos", "rotinas", "conectores", "inventario", "executor", "ias", usoPlano(e), "salas", ...Object.keys(e.conversas).map((id): Invalidacao => `conversa:${id}`))),
};

/** Frames que trazem fala nova (ou o fim de um turno) para a conversa do bot: a tela da task aberta relê as mensagens dela. */
const RELEEM_A_TASK: ReadonlySet<TipoFrame> = new Set<TipoFrame>(["mensagem.nova", "turno.iniciado", "turno.fala", "turno.encerrado", "turno.interrompido", "decisao.nova", "decisao.decidida"]);

export function aplicarFrame(estado: Estado, frame: FrameSse, agora: number): Estado {
  const handler = POR_FRAME[frame.tipo];
  const depois = handler ? handler(estado, frame, agora) : estado;
  // ADR-083 (#195): a tela da task mostra as mensagens do trabalho, que chegam pelos frames da conversa do bot dele.
  const t = depois.tela;
  if (t.tipo !== "trabalho" || !RELEEM_A_TASK.has(frame.tipo) || texto(frame.dados.conversaId) !== conversaIdNaTela(depois)) return depois;
  return invalidar(depois, `trabalho:${t.id}`);
}

export function reduzir(estado: Estado, acao: Acao): Estado {
  if (ehAcaoDaAgenda(acao)) return { ...estado, agenda: reduzirAgenda(estado.agenda, acao) };
  switch (acao.tipo) {
    case "sessao":
      // Trocou a pessoa: chaves E relatos somem. Relato carrega correlationId, machineId e o erro
      // cru do fornecedor — não pode ficar na tela da próxima sessão (ADR-002).
      return { ...estado, sessao: acao.escopo, chaves: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.chaves : null, maquinas: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.maquinas : null, computadorPessoa: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.computadorPessoa : null, instalarSsh: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.instalarSsh : null, contasIa: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.contasIa : null, detalhesContas: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.detalhesContas : null, relatos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.relatos : null, chaveEmitida: null,
        modoDev: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.modoDev : { ligado: false, raioX: {} },
        naoLidos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.naoLidos : null, novasDesde: {},
        citacoes: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.citacoes : {},
        carregado: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.carregado : estadoInicial.carregado,
        ligacaoViva: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.ligacaoViva : null,
        disponibilidadeLigacao: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.disponibilidadeLigacao : {},
        leitura: acao.escopo?.pessoaId === estado.sessao?.pessoaId && acao.escopo?.tenantId === estado.sessao?.tenantId ? estado.leitura : null,
        falhaLeitura: acao.escopo?.pessoaId === estado.sessao?.pessoaId && acao.escopo?.tenantId === estado.sessao?.tenantId ? estado.falhaLeitura : null,
        // NOD-326 (revisão 3): a Biblioteca também some na troca de tenant (não fica dado de um tenant no outro).
        ...(acao.escopo?.tenantId === estado.sessao?.tenantId ? {} : { bibliotecaDoBot: {} }),
        ...(acao.escopo?.pessoaId === estado.sessao?.pessoaId ? {} : { onboarding: undefined, onboardingAberto: false, onboardingResolvido: false, agenda: AGENDA_INICIAL, trabalhos: null, trabalhoDetalhe: {}, pressao: null, atividadeDoBot: {}, atividadeHoje: {}, atividadeVista: null, historicoPerfil: {}, decisoesDoBot: {}, bibliotecaDoBot: {} }) };
    case "navegar": {
      // definido em 2026-10-08 (revisão W5): reabrir uma task já vista relê as mensagens dela (o detalhe guardado é de
      // quando ela foi aberta da última vez); W11: sair da tela da task de um bot cuja conversa não está carregada apaga o
      // ao vivo dela — os frames dessa conversa param de ser guardados, e voltar juntaria o texto com um buraco no meio.
      const navegado = resolverInicio({
        ...estado,
        ...aoTrocarDeTela(estado, acao.tela),
        // Ir a outro lugar (o clique num aviso, por exemplo) fecha Seu espaço: a pessoa foi para onde pediu.
        espaco: null,
        configUi: { ...CONFIG_UI_INICIAL, lote: loteAoSair(estado.configUi.lote) },
        erro: null,
        // Saiu de Computadores: a chave crua some da memória (ela aparece uma vez só).
        chaveEmitida: null,
      });
      if (acao.tela.tipo === "trabalho") return invalidar(navegado, `trabalho:${acao.tela.id}`);
      // NOD-260 (definido em 2026-10-15): abrir Trabalhos (vindo de outra tela) sempre relê — a lista guardada é de
      // quando ela foi lida, e só o frame de um trabalho a relia.
      return acao.tela.tipo === "trabalhos" && estado.tela.tipo !== "trabalhos" ? invalidar(navegado, "trabalhos") : navegado;
    }
    case "espaco":
      // A chave crua só vive enquanto a pessoa está em Máquinas; trocar de seção ou fechar a descarta. NOD-367: trocar de
      // seção fecha o "…" e as linhas abertas; fechar as Configurações zera também a busca.
      return {
        // NOD-383: a lista do celular não é seção nenhuma (guarda só de onde a pessoa saiu, para o foco): voltar para ela
        // descarta a chave e as linhas abertas como trocar de seção.
        ...estado, espaco: acao.secao ? { secao: acao.secao, ...(acao.lista ? { lista: true } : {}) } : null, chaveEmitida: acao.secao === "maquinas" && !acao.lista ? estado.chaveEmitida : null, erro: null,
        configUi: !acao.secao ? { ...CONFIG_UI_INICIAL, lote: loteAoSair(estado.configUi.lote) } : acao.secao === estado.espaco?.secao && !acao.lista && !estado.espaco.lista ? estado.configUi : { ...CONFIG_UI_INICIAL, busca: estado.configUi.busca, lote: loteAoSair(estado.configUi.lote) },
        // NOD-367 (revisão 2): o relato.criado não invalida nada (ADR-041), então entrar em Feedback relê "Seus envios" e
        // esquece o erro de antes; o envio feito na conversa com o Nod aparece ao voltar.
        ...(acao.secao === "feedback" && !acao.lista && secaoAberta(estado) !== "feedback" ? { relatos: null, relatosErro: false } : {}),
        // NOD-85: entrar em Rotinas abre a agenda em hoje, no agora (o link do chat abre num dia com `agenda-abrir` depois).
        ...(acao.secao === "rotinas" && !acao.lista && secaoAberta(estado) !== "rotinas" ? { agenda: reduzirAgenda(estado.agenda, { tipo: "agenda-abrir", hoje: diaDe(estado.agora) }) } : {}),
      };
    case "config-ui":
      return { ...estado, configUi: { ...estado.configUi, ...acao.mudanca } };
    case "config-recolhe": {
      const abertos = estado.configUi.abertos.includes(acao.id) ? estado.configUi.abertos.filter((x) => x !== acao.id) : [...estado.configUi.abertos, acao.id];
      return { ...estado, configUi: { ...estado.configUi, abertos } };
    }
    case "fala-pendente":
      return comPendentes(estado, acao.conversaId, (ps) => [...ps.filter((p) => p.idEnvio !== acao.pendente.idEnvio), acao.pendente]);
    case "fala-pendente-confirmada": {
      // Sem o id (servidor de antes), a pendente sai e a releitura traz a gravada: um quadro sem a fala, como era.
      if (!acao.mensagemId) return comPendentes(estado, acao.conversaId, (ps) => ps.filter((p) => p.idEnvio !== acao.idEnvio));
      const id = acao.mensagemId;
      // Revisão de engenharia (27/10): a releitura (do `turno.iniciado` por SSE) pode chegar ANTES da resposta do POST e já
      // trazer a gravada; aí a pendente só sai, e a gravada fica com a chave dela (o bloco da pendente nunca virou o dela).
      if (estado.conversas[acao.conversaId]?.mensagens.some((m) => m.id === id)) return comPendentes(estado, acao.conversaId, (ps) => ps.filter((p) => p.idEnvio !== acao.idEnvio));
      return comPendentes(estado, acao.conversaId, (ps) => ps.map((p) => (p.idEnvio === acao.idEnvio ? { ...p, estado: "enviando", mensagemId: id, turnoId: acao.turnoId } : p)), { [id]: acao.idEnvio });
    }
    case "fala-pendente-falhou":
      // Revisão do PR (27/10): o motivo é o desta falha — a de antes (do "Tentar de novo" que falhou de novo) sai.
      return comPendentes(estado, acao.conversaId, (ps) => ps.map((p) => {
        if (p.idEnvio !== acao.idEnvio) return p;
        const { motivo: _antes, ...resto } = p;
        return { ...resto, estado: "falhou", ...(acao.motivo ? { motivo: acao.motivo } : {}) };
      }));
    case "fala-pendente-sai":
      return comPendentes(estado, acao.conversaId, (ps) => ps.filter((p) => p.idEnvio !== acao.idEnvio));
    case "cancelando-turno":
      return { ...estado, cancelando: { ...estado.cancelando, [acao.turnoId]: acao.agora } };
    case "desfazer-cancelamento": {
      if (!(acao.turnoId in estado.cancelando)) return estado;
      const cancelando = { ...estado.cancelando };
      delete cancelando[acao.turnoId];
      return { ...estado, cancelando };
    }
    case "tick": {
      // definido em 2026-09-24 (ADR-045): nenhum evento diz que o Mac voltou (o fechamento do aviso é do
      // varredor, no modo compartilhado). Enquanto houver aviso EM CURSO, cada tick relê "Sua vez".
      const comAgora = semFalasSaindo({ ...estado, agora: acao.agora }, (s) => acao.agora - s.em < FALA_SAINDO_MS);
      return estado.suaVez?.incidentes.some((i) => i.voltouEm === null) ? invalidar(comAgora, "sua-vez") : comAgora;
    }
    case "conexao": {
      // NOD-215: o SSE de volta a `aberto` prova que o servidor voltou; só o erro DE REDE some (outro erro fica).
      const erro = acao.estado === "aberto" && ehErroDeRede(estado.erro) ? null : estado.erro;
      return { ...estado, conexao: { estado: acao.estado, tentativa: acao.tentativa, proximaEmMs: acao.proximaEmMs }, erro };
    }
    case "frame":
      return aplicarFrame(estado, acao.frame, acao.agora);
    case "hidratar-gestao": {
      // NOD-370: a gestão traz os excluídos; a conversa de baixo do bot excluído vai para Início (Seu espaço fica).
      const excluidos = new Set(acao.gestao.agentes.filter((a) => a.excluidoEm).map((a) => a.id));
      // NOD-368 (revisão 2): o bot excluído, ocultado ou de outra pessoa sai da seleção do lote quando a gestão é relida.
      const ativos = acao.gestao.agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId && !a.excluidoEm && !a.oculto).map((a) => a.id);
      const lote = soOsQueExistem(estado.configUi.lote, ativos);
      const comLote = lote === estado.configUi.lote ? estado : { ...estado, configUi: { ...estado.configUi, lote } };
      return semBotsQueSairam(comLote, excluidos, { gestao: acao.gestao }) ?? { ...comLote, gestao: acao.gestao };
    }
    case "hidratar-frota": {
      // Revisão da NOD-349: o computador que a frota diz que voltou deixa de valer como "fora" lido num pulso antigo.
      const voltaram = acao.frota.agentes.filter((a) => !a.computadorForaDoAr && estado.computadorVisto[a.id] === "fora").map((a) => a.id);
      const computadorVisto = voltaram.length ? Object.fromEntries(Object.entries(estado.computadorVisto).filter(([id]) => !voltaram.includes(id))) : estado.computadorVisto;
      const proximo = { ...estado, frota: acao.frota, inventario: acao.frota.inventario, computadorVisto };
      return comConversasDosDonos(resolverInicio(semBotsQueSairam(proximo, botsQueSairam(estado, acao.frota), {}) ?? proximo));
    }
    case "hidratar-inventario":
      return { ...estado, inventario: acao.inventario };
    case "hidratar-executor":
      return { ...estado, executor: acao.executor };
    case "hidratar-ias":
      return { ...estado, ias: acao.ias };
    case "hidratar-uso-plano":
      return { ...estado, usoDoPlano: acao.usoDoPlano };
    case "agente-gravado": {
      // Revisão do PR 1 (2026-10-16): o seletor de IA mostra a escolha na hora; o refetch de frota/gestão confirma depois.
      // Só os campos do perfil que o PUT devolve entram — o que é da frota (conversaId, estado, prévia) fica.
      const junto = <T extends { agentes: Agente[] }>(dto: T): T => ({ ...dto, agentes: dto.agentes.map((x) => (x.id === acao.agente.id ? { ...x, ...acao.agente } : x)) });
      return { ...estado, frota: estado.frota ? junto(estado.frota) : estado.frota, gestao: estado.gestao ? junto(estado.gestao) : estado.gestao };
    }
    case "ias-mac":
      return { ...estado, iasMac: { ...estado.iasMac, ...acao.mudanca } };
    case "ordem-ias": {
      if (!estado.ias) return estado;
      const ias = [...estado.ias.ias].sort((a, b) => posicao(acao.ordem, a.id) - posicao(acao.ordem, b.id));
      return { ...estado, ias: { ...estado.ias, ordem: acao.ordem, ordemPadrao: false, ias } };
    }
    case "rascunho-ia":
      return { ...estado, rascunhoIa: acao.rascunho };
    case "menu-ia":
      return { ...estado, menuIa: acao.agenteId };
    case "hidratar-conversa": {
      const conversaId = acao.conversa.conversa.id;
      // Turno aberto que a web não viu nascer (página recarregada no meio dele): o REST o devolve e ele
      // volta a ser vivo, com o `desde` do banco. O frame turno.iniciado não se repete para quem chegou depois.
      // TODO(servidor, modo ligação): `TurnoEmCursoDto` (src/contracts/api.ts) não traz `origem`; o plano diz que
      // `lerConversa` já exclui o turno `ligacao`. Se ele vier, a web o ignora aqui pelo campo `origem` (ou `modo`).
      // NOD-216: o que a web já viu encerrar nunca volta (o GET que saiu antes do `turno.encerrado`), como em hidratar-trabalho.
      // Revisão: e o que uma leitura mais nova já desmentiu também não (a resposta velha que chega por último).
      const leuTurnos = Array.isArray(acao.conversa.turnosEmCurso);
      const emCurso = acao.conversa.turnosEmCurso ?? [];
      const novos = emCurso.filter((t) => !estado.turnosVivos[t.id] && !estado.turnosEncerrados.includes(t.id) && !desmentidoDepois(estado, t.id, acao.agora) && !("origem" in t && t.origem === "ligacao") && !("modo" in t && t.modo === "ligacao"));
      // NOD-216: e o turno da conversa que o servidor não devolve mais sai — o `turno.encerrado` perdido (SSE caído, aba
      // dormindo) deixava "na fila · há 6h" e o mascote animado para sempre. Só os confirmados ANTES desta leitura sair; o
      // de task (`trabalhoId`) é da tela da task (hidratar-trabalho).
      // Revisão: a resposta sem `turnosEmCurso` (servidor antigo, resposta parcial) não diz que nada roda — não tira nada.
      const naLeitura = new Set(emCurso.map((t) => t.id));
      const sumiram = leuTurnos ? Object.values(estado.turnosVivos).filter((v) => v.conversaId === conversaId && !v.trabalhoId && !naLeitura.has(v.turnoId) && confirmadoAntes(v, acao.agora)).map((v) => v.turnoId) : [];
      const semSumidos = semDesmentidos(estado, sumiram, acao.agora);
      const turnosVivos = novos.length === 0 ? semSumidos.turnosVivos : { ...semSumidos.turnosVivos };
      // `chegouEm`: o relógio da web, nunca adiante do `desde` do banco (o relógio da web atrasado faria a fila "pensar").
      // NOD-276 (J3): o que já roda conta "Trabalhando · há N" do despacho; "Na fila há N" segue com a criação.
      const desdeDe = (t: (typeof novos)[number]): number => (t.estado === "despachando" ? (t.despachadoEm ?? t.desde) : t.desde);
      const deBastidoresNoDto = (t: (typeof emCurso)[number]): boolean => !t.trabalhoId && (t.bastidores === true || (typeof t.origem === "string" && ORIGENS_DOS_BASTIDORES.has(t.origem)));
      for (const t of novos) turnosVivos[t.id] = { turnoId: t.id, conversaId, estado: t.estado === "despachando" ? "rodando" : "na_fila", executor: null, machineId: null, desde: desdeDe(t), trabalhoId: t.trabalhoId ?? null, vistoEm: acao.agora, chegouEm: Math.min(desdeDe(t), acao.agora), origem: t.origem ?? null, agenteId: t.agenteId ?? null, ...(deBastidoresNoDto(t) ? { bastidores: true } : {}), ...(t.estado === "despachando" && t.despachadoEm != null ? { despachadoEm: t.despachadoEm } : {}), criadoEm: t.desde };
      // definido em 2026-10-28: o turno que a web já via (o `turno_criado` saiu sem a marca) passa aos bastidores pela leitura.
      let promovidos = turnosVivos;
      for (const t of emCurso) {
        const ja = promovidos[t.id];
        const marca = ja && !ja.bastidores && !ja.trabalhoId && deBastidoresNoDto(t);
        // Definido em 2026-10-28: e ganha a hora do despacho do servidor (o `turno_despachado` perdido não a deixa faltar até o fim).
        const hora = ja && ja.despachadoEm === undefined && t.estado === "despachando" && t.despachadoEm != null;
        const nasceu = ja && ja.criadoEm === undefined;
        if (marca || hora || nasceu) { if (promovidos === semSumidos.turnosVivos) promovidos = { ...promovidos }; promovidos[t.id] = { ...ja, ...(marca ? { bastidores: true } : {}), ...(hora ? { despachadoEm: t.despachadoEm as number } : {}), ...(nasceu ? { criadoEm: t.desde } : {}) }; }
      }
      // O texto em streaming de um turno que já acabou sai; o dos que continuam vivos fica.
      // NOD-402: o turno dos bastidores não guarda atividade (o promovido aqui perde a que tinha).
      const vivosDaConversa = new Set(Object.values(promovidos).filter((t) => t.conversaId === conversaId && !t.bastidores).map((t) => t.turnoId));
      const anteriores = estado.atividades[conversaId] ?? {};
      const mortos = Object.keys(anteriores).filter((turnoId) => !vivosDaConversa.has(turnoId));
      let atividades = estado.atividades;
      if (mortos.length > 0) {
        const restantes = { ...anteriores };
        for (const turnoId of mortos) delete restantes[turnoId];
        atividades = { ...estado.atividades, [conversaId]: restantes };
      }
      // Parte 1: a pendente cuja gravada chegou sai; as outras seguem (a releitura que saiu antes do POST não a traz).
      const antes = estado.conversas[conversaId];
      const gravadas = new Set(acao.conversa.mensagens.map((m) => m.id));
      const pendentes = (antes?.pendentes ?? []).filter((p) => !(p.mensagemId && gravadas.has(p.mensagemId)));
      const extras = { ...(pendentes.length ? { pendentes } : {}), ...(antes?.enviadas ? { enviadas: antes.enviadas } : {}) };
      // O retrato de antes da releitura sai (revisão 3 do #508); o desta releitura (`semDesmentidos`, `em` = agora) ou de depois
      // dela fica — salvo se a gravada já veio nela (QA do #534).
      return { ...semFalasSaindo(semSumidos, (s, c) => c !== conversaId || (s.em >= acao.agora && !gravadaDoRetrato(acao.conversa, s))), turnosVivos: promovidos, atividades, conversas: { ...estado.conversas, [conversaId]: { ...acao.conversa, carregadaEm: acao.agora, ...extras } } };
    }
    case "hidratar-sua-vez": {
      // A escolha do campo só vale enquanto a conversa tem pergunta aberta: respondida ou deixada pra lá
      // (aqui ou noutra aba), um "Outro assunto" antigo não pode decidir pela pergunta seguinte.
      const comPergunta = conversasComPergunta(acao.suaVez);
      const composer = Object.fromEntries(Object.entries(estado.composer).filter(([conversaId]) => comPergunta.has(conversaId)));
      return { ...estado, suaVez: acao.suaVez, composer };
    }
    case "rotinas-tentando":
      // "Tentar de novo": volta ao carregando até a resposta (ou a nova falha).
      return estado.rotinasFalharam ? { ...estado, rotinasFalharam: false } : estado;
    case "rotinas-falharam":
      // Só a primeira carga que falha vira erro: com a lista já carregada, uma falha passageira não a troca pelo aviso.
      return estado.rotinasFalharam || estado.carregado.rotinas ? estado : { ...estado, rotinasFalharam: true };
    case "perfil-celular":
      return { ...estado, perfilCelular: acao.perfil };
    case "hidratar-rotinas":
      return { ...estado, rotinasFalharam: false, rotinas: acao.rotinas, carregado: estado.carregado.rotinas ? estado.carregado : { ...estado.carregado, rotinas: true } };
    case "hidratar-execucoes":
      return { ...estado, execucoes: { ...estado.execucoes, [acao.rotinaId]: acao.execucoes } };
    case "alternar-historico":
      return { ...estado, historicoAberto: { ...estado.historicoAberto, [acao.rotinaId]: !estado.historicoAberto[acao.rotinaId] } };
    case "conexao-app": {
      const conectando = { ...estado.conectando };
      if (acao.valor) conectando[acao.slug] = acao.valor;
      else delete conectando[acao.slug];
      return { ...estado, conectando, avisoConexao: acao.valor ? null : estado.avisoConexao };
    }
    case "gaveta": {
      // O rascunho da Inteligência (2B) e o menu rápido (2A) não sobrevivem à troca de nível.
      // ADR-114: a Atividade abre sempre no dia de hoje, em "Tudo"; sair dela esquece o dia, o filtro e o item aberto.
      const atividadeVista: VistaDaAtividade | null = acao.nivel?.tipo === "atividade" ? vistaInicial(acao.agenteId, diaLocal(estado.agora > 0 ? estado.agora : Date.now())) : null;
      const depois = { ...estado, avatarAberto: null, gaveta: acao.nivel ? { agenteId: acao.agenteId, nivel: acao.nivel } : null, rascunhoIa: acao.nivel?.tipo === "inteligencia" && estado.rascunhoIa?.agenteId === acao.agenteId ? estado.rascunhoIa : null, menuIa: null, atividadeVista, historicoPerfil: historicoAoTrocarNivel(estado.historicoPerfil, acao.agenteId, acao.nivel) };
      // Reabrir a Atividade relê o dia (a página guardada aparece enquanto a nova não chega): fechada, nenhum frame a relia.
      return atividadeVista && chaveDaAtividade(atividadeVista.agenteId, atividadeVista.dia) in estado.atividadeDoBot ? invalidar(depois, `atividade:${chaveDaAtividade(atividadeVista.agenteId, atividadeVista.dia)}`) : depois;
    }
    case "aba-gaveta":
      if (estado.abaGaveta[acao.agenteId] === acao.aba) return estado;
      return { ...estado, abaGaveta: { ...estado.abaGaveta, [acao.agenteId]: acao.aba }, avatarAberto: null };
    case "abas-lidas":
      return { ...estado, abaGaveta: { ...acao.abas, ...estado.abaGaveta } };
    case "avatar-popover":
      return { ...estado, avatarAberto: acao.aberto };
    case "computador-visto":
      if (estado.computadorVisto[acao.agenteId] === acao.estado) return estado;
      return { ...estado, computadorVisto: { ...estado.computadorVisto, [acao.agenteId]: acao.estado } };
    case "computador-acao":
      return { ...estado, computadorAcao: acao.acao };
    case "agente-local": {
      // ADR-125: o nome, o subtítulo, a forma e a cor mudam na hora na frota (otimista); o PATCH confirma ou desfaz.
      if (!estado.frota) return estado;
      const agentes = estado.frota.agentes.map((a) => (a.id === acao.agenteId ? { ...a, ...acao.mudanca } : a));
      return { ...estado, frota: { ...estado.frota, agentes } };
    }
    case "hidratar-atividade": {
      // A página do dia de hoje também é o "N hoje" da linha (o mesmo total, nas mesmas três fontes).
      const hoje = estado.atividadeHoje[acao.agenteId];
      const atividadeHoje = acao.atividade && hoje?.dia === acao.dia ? { ...estado.atividadeHoje, [acao.agenteId]: { ...hoje, dia: acao.dia, total: acao.atividade.total } } : estado.atividadeHoje;
      return { ...estado, atividadeDoBot: { ...estado.atividadeDoBot, [chaveDaAtividade(acao.agenteId, acao.dia)]: acao.atividade }, atividadeHoje };
    }
    case "historico-perfil": {
      const atual = estado.historicoPerfil[acao.agenteId] ?? HISTORICO_INICIAL;
      return { ...estado, historicoPerfil: { ...estado.historicoPerfil, [acao.agenteId]: { ...atual, ...acao.mudanca } } };
    }
    case "hidratar-atividade-hoje":
      return { ...estado, atividadeHoje: { ...estado.atividadeHoje, [acao.agenteId]: { dia: acao.dia, total: acao.total, ...(acao.negadas === undefined ? {} : { negadas: acao.negadas }) } } };
    case "hidratar-decisoes": {
      const p = acao.pagina;
      const atual = estado.decisoesDoBot[acao.chave];
      let pagina: PaginaDasDecisoes | null | "erro" = p === null || p === "erro" ? p : { linhas: p.linhas, contagem: p.contagem, proximo: p.proximo, haAntes: p.haAntes, carregandoMais: false, erroMais: false };
      // Revisão A3 (NOD-70): a releitura (SSE) traz só a 1ª página. Se a pessoa já tinha carregado mais e a 1ª página nova
      // ainda encosta na lista (a última linha dela está lá), as novas entram em cima e o resto carregado fica, com o
      // cursor e o "carregando" de antes; senão (muita coisa nova, outro recorte), a lista recomeça.
      if (pagina && pagina !== "erro" && p && p !== "erro" && atual && atual !== "erro" && p.proximo !== null && atual.linhas.length > p.linhas.length) {
        const ultima = p.linhas.at(-1)?.id;
        const i = ultima === undefined ? -1 : atual.linhas.findIndex((l) => l.id === ultima);
        if (i >= 0) {
          const novas = new Set(p.linhas.map((l) => l.id));
          const resto = atual.linhas.slice(i + 1).filter((l) => !novas.has(l.id));
          pagina = { ...pagina, linhas: [...p.linhas, ...resto], proximo: atual.proximo, carregandoMais: atual.carregandoMais, erroMais: atual.erroMais };
        }
      }
      return { ...estado, decisoesDoBot: { ...estado.decisoesDoBot, [acao.chave]: pagina } };
    }
    case "mais-decisoes": {
      const atual = estado.decisoesDoBot[acao.chave];
      if (!atual || atual === "erro") return estado;
      const r = acao.resultado;
      // A página que chega só entra se ainda continua a lista que a pediu: se a lista foi relida no meio (SSE, filtro,
      // Tentar de novo), o cursor dela mudou e a página velha pularia o pedaço do meio (revisão do /codex, NOD-70).
      if (atual.proximo !== acao.cursor || (r !== "carregando" && !atual.carregandoMais)) return estado;
      const pagina: PaginaDasDecisoes =
        r === "carregando" ? { ...atual, carregandoMais: true, erroMais: false }
        : r === "erro" ? { ...atual, carregandoMais: false, erroMais: true }
        // As linhas novas vão no fim; uma que já está (a página releu no meio) não se repete.
        : { ...atual, linhas: [...atual.linhas, ...r.linhas.filter((l) => !atual.linhas.some((x) => x.id === l.id))], contagem: r.contagem, proximo: r.proximo, carregandoMais: false, erroMais: false };
      return { ...estado, decisoesDoBot: { ...estado.decisoesDoBot, [acao.chave]: pagina } };
    }
    case "esquecer-decisoes": {
      const { [acao.chave]: _fora, ...resto } = estado.decisoesDoBot;
      return { ...estado, decisoesDoBot: resto };
    }
    case "hidratar-biblioteca": {
      const antes = estado.bibliotecaDoBot[acao.conversaId];
      // Revisão 1 da NOD-326: a página seguinte só entra se ainda é esperada (a lista não foi trocada por erro nem por
      // "Tentar de novo" enquanto ela vinha); a releitura que falha mantém a lista que estava boa.
      if (acao.seguinte && (!antes || antes.erro || !antes.carregandoMais)) return estado;
      let nova: BibliotecaDaConversa;
      if (acao.pagina) nova = juntarPagina(antes?.erro ? undefined : antes, acao.pagina, acao.seguinte);
      else if (acao.seguinte && antes) nova = { ...antes, carregandoMais: false, falhouMais: true };
      else if (antes && !antes.erro) return estado;
      else nova = { itens: [], proximo: null, erro: true, carregandoMais: false, mostrando: antes?.mostrando ?? {} };
      return { ...estado, bibliotecaDoBot: { ...estado.bibliotecaDoBot, [acao.conversaId]: nova } };
    }
    case "biblioteca-mais": {
      const b = estado.bibliotecaDoBot[acao.conversaId];
      if (!b) return estado;
      const g = gruposVisiveis(b, estado.agora > 0 ? estado.agora : Date.now()).find((v) => v.grupo === acao.grupo);
      if (!g || (!g.maisLocal && !g.maisNoServidor)) return estado;
      // Revisão 3: com uma página a caminho, só o "mais" do que já foi lido anda (outro grupo); o do servidor espera.
      if (b.carregandoMais && !g.maisLocal) return estado;
      const mostrando = { ...b.mostrando, [acao.grupo]: g.itens.length + POR_VEZ };
      return { ...estado, bibliotecaDoBot: { ...estado.bibliotecaDoBot, [acao.conversaId]: { ...b, mostrando, carregandoMais: b.carregandoMais || g.maisNoServidor, falhouMais: false } } };
    }
    case "biblioteca-tentar": {
      const { [acao.conversaId]: _fora, ...resto } = estado.bibliotecaDoBot;
      return { ...estado, bibliotecaDoBot: resto };
    }
    case "atividade-vista": {
      if (!estado.atividadeVista) return estado;
      const vista = { ...estado.atividadeVista, ...acao.mudanca };
      const depois = { ...estado, atividadeVista: vista };
      // NOD-70: voltar à aba Decisões (ou trocar o dia ou o filtro para uma página já lida) relê, mostrando a guardada.
      const chave = chaveDasDecisoes(vista.agenteId, vista.dia, vista.desfecho);
      const releu = vista.aba === "decisoes" && (acao.mudanca.aba === "decisoes" || acao.mudanca.dia !== undefined || acao.mudanca.desfecho !== undefined) && chave in estado.decisoesDoBot;
      return releu ? invalidar(depois, `decisoes:${chave}`) : depois;
    }
    case "lista-de-pasta":
      return { ...estado, listaDePasta: { ...estado.listaDePasta, [acao.propostaId]: acao.lista } };
    case "aviso-conexao":
      return { ...estado, avisoConexao: acao.texto };
    case "hidratar-conectores":
      return { ...estado, conectores: acao.conectores, marketplace: acao.marketplace ?? estado.marketplace, composioConfigurado: acao.composioConfigurado ?? estado.composioConfigurado, carregado: estado.carregado.conectores ? estado.carregado : { ...estado.carregado, conectores: true } };
    case "hidratar-concessoes":
      // Sem as dispensas na resposta, o que havia fica: sem saber o que a pessoa dispensou, o cartão de liberar não aparece.
      return { ...estado, concessoes: { ...estado.concessoes, [acao.agenteId]: acao.concessoes }, liberacoesDispensadas: acao.liberacoesDispensadas ? { ...estado.liberacoesDispensadas, [acao.agenteId]: acao.liberacoesDispensadas } : estado.liberacoesDispensadas };
    case "hidratar-memorias": {
      // NOD-58: a memória que voltou (desfazer, outro aparelho) deixa de aparecer como apagada.
      const apagadas = (estado.memoriasApagadas[acao.agenteId] ?? []).filter((a) => !acao.memorias.some((m) => m.id === a.memoriaId));
      return {
        ...estado,
        memorias: { ...estado.memorias, [acao.agenteId]: acao.memorias },
        memoriasApagadas: { ...estado.memoriasApagadas, [acao.agenteId]: apagadas },
        ...(acao.aRevisar === undefined ? {} : { memoriasARevisar: { ...estado.memoriasARevisar, [acao.agenteId]: acao.aRevisar } }),
      };
    }
    case "hidratar-diario": {
      const velho = estado.diarios[acao.agenteId];
      let entradas: EntradaDiario[];
      let mais = acao.pagina.mais;
      if (acao.anexar) {
        const antes = velho?.entradas ?? [];
        const vistas = new Set(antes.map((e) => e.id));
        entradas = [...antes, ...acao.pagina.entradas.filter((e) => !vistas.has(e.id))];
      } else {
        // Releitura (frame, desfazer): a 1ª página nova por cima, e o que já veio pelo "Mostrar mais" continua
        // abaixo dela, desde que encoste na página nova (sem buraco entre as duas).
        entradas = acao.pagina.entradas;
        const ultima = entradas.at(-1);
        const primeiraVelha = velho?.entradas[0];
        if (acao.pagina.mais && ultima && primeiraVelha && !maisNova(ultima, primeiraVelha)) {
          const resto = (velho?.entradas ?? []).filter((e) => maisNova(ultima, e));
          if (resto.length > 0) {
            entradas = [...entradas, ...resto];
            mais = velho?.mais ?? mais;
          }
        }
      }
      return {
        ...estado,
        diarios: { ...estado.diarios, [acao.agenteId]: { entradas, mais } },
        memoriasARevisar: { ...estado.memoriasARevisar, [acao.agenteId]: acao.pagina.aRevisar },
      };
    }
    case "diario-desfeita": {
      const d = estado.diarios[acao.agenteId];
      if (!d) return estado;
      const entradas = d.entradas.map((e) => (e.id === acao.entradaId && e.desfeitaEm === null ? { ...e, desfeitaEm: acao.em, revisadaEm: e.revisadaEm ?? acao.em } : e));
      return { ...estado, diarios: { ...estado.diarios, [acao.agenteId]: { ...d, entradas } } };
    }
    case "diario-revisado": {
      const d = estado.diarios[acao.agenteId];
      const agora = estado.agora > 0 ? estado.agora : Date.now();
      const entradas = d?.entradas.map((e) => (e.autor === "agente" && e.revisadaEm === null && (acao.entradaId === null || e.id === acao.entradaId) ? { ...e, revisadaEm: agora } : e));
      return {
        ...estado,
        ...(d && entradas ? { diarios: { ...estado.diarios, [acao.agenteId]: { ...d, entradas } } } : {}),
        memoriasARevisar: { ...estado.memoriasARevisar, [acao.agenteId]: acao.aRevisar },
      };
    }
    case "memoria-apagada": {
      const outras = (estado.memoriasApagadas[acao.agenteId] ?? []).filter((a) => a.memoriaId !== acao.apagada.memoriaId);
      return { ...estado, memoriasApagadas: { ...estado.memoriasApagadas, [acao.agenteId]: [...outras, acao.apagada] } };
    }
    case "memoria-apagada-sai":
      return { ...estado, memoriasApagadas: { ...estado.memoriasApagadas, [acao.agenteId]: (estado.memoriasApagadas[acao.agenteId] ?? []).filter((a) => a.memoriaId !== acao.memoriaId) } };
    case "aviso-diario":
      return { ...estado, avisoDiario: acao.aviso };
    case "status-memoria":
      return { ...estado, statusMemoria: acao.texto };
    case "hidratar-salas":
      return { ...estado, salas: acao.salas, carregado: estado.carregado.salas ? estado.carregado : { ...estado.carregado, salas: true } };
    case "hidratar-nao-lidos":
      return { ...estado, naoLidos: acao.naoLidos };
    case "novas-desde":
      return { ...estado, novasDesde: { ...estado.novasDesde, [acao.conversaId]: { mensagemId: acao.mensagemId, em: acao.em, total: acao.total } } };
    case "hidratar-chaves":
      return { ...estado, chaves: acao.chaves };
    case "hidratar-maquinas":
      return { ...estado, maquinas: acao.maquinas };
    case "esta-maquina":
      return { ...estado, estaMaquina: acao.maquina };
    case "hidratar-computador-pessoa": {
      if (!acao.dto) return estado.computadorPessoa ? { ...estado, computadorPessoa: null, computadorMemoria: MEMORIA_INICIAL, computadorUi: UI_COMPUTADOR_INICIAL } : estado;
      const computadorMemoria = lembrarComputador(estado.computadorPessoa, acao.dto, estado.computadorMemoria, acao.agora);
      // A operação acabou: as etapas fecham sozinhas. NOD-93: o preparo acabou (pronto, falhou): a janela de primeiro uso também.
      const fimDaOperacao = !acao.dto.operacao && estado.computadorUi.etapasAbertas;
      const fimDoPreparo = estado.computadorUi.preparoAberto && !acao.dto.preparo?.estado.match(/^(baixando|pausado_sem_internet|preparando|ligando|esperando_memoria)$/);
      const computadorUi = fimDaOperacao || fimDoPreparo ? { ...estado.computadorUi, ...(fimDaOperacao ? { etapasAbertas: false } : {}), ...(fimDoPreparo ? { preparoAberto: false } : {}) } : estado.computadorUi;
      // NOD-407: ligou (ou está ligando): a recusa do Acordar anterior não vale mais.
      const semRecusa = computadorUi.recusa && (acao.dto.estado === "pronto" || acao.dto.estado === "ligando") ? { ...computadorUi, recusa: null } : computadorUi;
      return { ...estado, computadorPessoa: acao.dto, computadorMemoria, computadorUi: semRecusa };
    }
    case "computador-ui":
      return { ...estado, computadorUi: { ...estado.computadorUi, ...acao.ui } };
    case "conectar-maquina":
      return { ...estado, conectarMaquina: acao.conectar };
    case "instalar-ssh":
      return { ...estado, instalarSsh: acao.instalar };
    case "hidratar-contas":
      return { ...estado, contasIa: acao.contas, detalhesContas: acao.detalhes };
    case "trocar-contas":
      return { ...estado, contasIa: acao.contas };
    case "contas-ui":
      return { ...estado, contasUi: { ...estado.contasUi, ...acao.mudanca } };
    case "nuvem-ui":
      return { ...estado, nuvem: { ...estado.nuvem, ...acao.mudanca } };
    case "remover-ui":
      return { ...estado, removerUi: { ...estado.removerUi, ...acao.mudanca } };
    case "onboarding-texto":
      return estado.onboardingTexto === acao.ligado ? estado : { ...estado, onboardingTexto: acao.ligado };
    case "hidratar-relatos":
      return { ...estado, relatos: acao.relatos, relatosErro: acao.erro === true };
    // Desligado, os resumos saem da memória: religar busca de novo, com o que mudou nesse meio-tempo.
    case "modo-dev":
      return { ...estado, modoDev: { ligado: acao.ligado, raioX: acao.ligado ? estado.modoDev.raioX : {} } };
    case "hidratar-raio-x":
      return estado.modoDev.ligado ? { ...estado, modoDev: { ...estado.modoDev, raioX: { ...estado.modoDev.raioX, [acao.conversaId]: acao.raioX } } } : estado;
    case "chave-emitida":
      return acao.emitida ? invalidar({ ...estado, chaveEmitida: acao.emitida }, "chaves") : { ...estado, chaveEmitida: null };
    case "faixa":
      return { ...estado, faixaParada: acao.faixa };
    case "composer": {
      const composer = { ...estado.composer };
      if (acao.escolha) composer[acao.conversaId] = acao.escolha;
      else delete composer[acao.conversaId];
      return { ...estado, composer };
    }
    case "citar": {
      const citacoes = { ...estado.citacoes };
      if (acao.citacao) citacoes[acao.conversaId] = acao.citacao;
      else delete citacoes[acao.conversaId];
      return { ...estado, citacoes };
    }
    case "invalidar":
      return invalidar(estado, ...acao.quais);
    case "invalidacoes-tratadas":
      return { ...estado, invalidacoes: estado.invalidacoes.filter((q) => !acao.quais.includes(q)) };
    case "erro":
      return { ...estado, erro: acao.erro, ocupado: false };
    case "turno-refeito":
      return estado.turnosRefeitos.includes(acao.turnoId) ? estado : { ...estado, turnosRefeitos: [...estado.turnosRefeitos, acao.turnoId] };
    case "rede-caiu":
      // Um erro de outra natureza na tela não é trocado pelo aviso de rede; o "ocupado" fica: a ação segue tentando.
      if (estado.erro !== null && !ehErroDeRede(estado.erro)) return estado;
      return { ...estado, erro: acao.erro };
    case "rede-voltou":
      return ehErroDeRede(estado.erro) ? { ...estado, erro: null } : estado;
    case "ocupado":
      return { ...estado, ocupado: acao.valor };
    case "ligacao-viva": {
      const a = estado.ligacaoViva;
      const b = acao.viva;
      const igual = a === b || (a !== null && b !== null && a.ligacaoId === b.ligacaoId && a.local === b.local && a.agenteId === b.agenteId);
      return igual ? estado : { ...estado, ligacaoViva: b };
    }
    case "desfazer-cartao":
      return estado.desfazerAberto === acao.mensagemId ? estado : { ...estado, desfazerAberto: acao.mensagemId };
    case "leitura-mudou": {
      const a = estado.leitura;
      const b = acao.leitura;
      const mesma = a === b || (a !== null && b !== null && a.mensagemId === b.mensagemId && a.fase === b.fase);
      const falhaLeitura = acao.falha === undefined ? estado.falhaLeitura : acao.falha;
      return mesma && falhaLeitura === estado.falhaLeitura ? estado : { ...estado, leitura: b, falhaLeitura };
    }
    case "hidratar-disponibilidade-ligacao":
      return { ...estado, disponibilidadeLigacao: { ...estado.disponibilidadeLigacao, [acao.agenteId]: acao.disponibilidade } };
    case "hidratar-onboarding":
      return resolverInicio({ ...estado, onboarding: acao.onboarding });
    case "onboarding-aberto":
      return estado.onboardingAberto === acao.aberto ? estado : { ...estado, onboardingAberto: acao.aberto };
    case "hidratar-trabalhos":
      // O servidor manda o nível que vale agora: null (nenhum Mac falou) também limpa o amarelo antigo (revisão W4).
      return comConversasDosDonos(comDonosNasConversas(reconciliarPelosDonos({ ...estado, trabalhos: acao.trabalhos, pressao: acao.trabalhos.pressao }, acao.trabalhos, acao.agora), acao.trabalhos.donos));
    case "hidratar-trabalho": {
      // Página aberta no meio do trabalho: o turno que roda volta a ser vivo, para o ao vivo dele ser guardado e desenhado.
      // definido em 2026-10-08 (revisão W6): o turno do trabalho que não é mais o vivo dele sai, e o que a web já viu
      // encerrar nunca volta — o GET que saiu antes do `turno.encerrado` não recria um "Trabalhando" fantasma.
      const t = acao.detalhe.trabalho;
      const velhos = Object.values(estado.turnosVivos).filter((v) => v.trabalhoId === t.id && v.turnoId !== t.turnoVivoId);
      const volta = t.turnoVivoId && !estado.turnosVivos[t.turnoVivoId] && !estado.turnosEncerrados.includes(t.turnoVivoId) ? t.turnoVivoId : null;
      let turnosVivos = estado.turnosVivos;
      if (velhos.length > 0 || volta) {
        turnosVivos = { ...estado.turnosVivos };
        for (const v of velhos) delete turnosVivos[v.turnoId];
        if (volta) turnosVivos[volta] = { turnoId: volta, conversaId: t.conversaId, estado: "rodando", executor: null, machineId: null, desde: t.iniciadoEm ?? acao.agora, trabalhoId: t.id };
      }
      return { ...estado, turnosVivos, trabalhoDetalhe: { ...estado.trabalhoDetalhe, [t.id]: acao.detalhe } };
    }
    case "trabalho-sumiu": {
      // definido em 2026-10-08 (revisão W2): a task que some (404) não fica em "carregando a task…" pedindo o GET de novo
      // a cada frame — a tela volta para onde a pessoa estava (main.ts esquece a task lembrada na aba).
      const t = estado.tela;
      if (t.tipo !== "trabalho" || t.id !== acao.id) return estado;
      return resolverInicio({ ...estado, tela: t.voltar, invalidacoes: estado.invalidacoes.filter((q) => q !== `trabalho:${acao.id}`) });
    }
    case "faixa-trabalhos":
      return estado.faixaTrabalhosAberta === acao.agenteId ? estado : { ...estado, faixaTrabalhosAberta: acao.agenteId };
    case "bot-trabalhos":
      return estado.botAbertoEmTrabalhos === acao.agenteId ? estado : { ...estado, botAbertoEmTrabalhos: acao.agenteId };
    case "uso-do-mac":
      return estado.usoDoMac === acao.uso ? estado : { ...estado, usoDoMac: acao.uso };
    case "experimentos":
      return { ...estado, experimentos: acao.experimentos, ...(acao.quadroLiberado !== undefined ? { quadroLiberado: acao.quadroLiberado } : {}) };
    case "tempo-task":
      return estado.tempoTaskAberto === acao.id ? estado : { ...estado, tempoTaskAberto: acao.id };
    case "hidratar-taxas-linhas":
      return estado.modoDev.ligado ? { ...estado, modoDev: { ...estado.modoDev, taxasLinhas: acao.taxas } } : estado;
    case "esquecer-disponibilidade-ligacao": {
      if (!(acao.agenteId in estado.disponibilidadeLigacao)) return estado;
      const disponibilidadeLigacao = { ...estado.disponibilidadeLigacao };
      delete disponibilidadeLigacao[acao.agenteId];
      return { ...estado, disponibilidadeLigacao };
    }
  }
}

/**
 * O que mudou entre dois estados aparece na tela? definido em 2026-09-30: o frame de um bot que NÃO está
 * na tela (turno.delta, turno.atividade, turno.tarefas) só mexe em `atividades` da conversa dele, e só a
 * timeline da conversa aberta lê `atividades`. medido em 2026-09-30: redesenhar a tela inteira a cada um
 * desses frames travou a página por 118 s com 8 bots escrevendo e uma conversa de 200 mensagens aberta
 * (scripts/carga-tela). `invalidacoes` também não aparece: só o laço de reidratação a lê, e o que ele
 * busca redesenha ao chegar. Qualquer outra referência nova conta como mudança.
 */
export function mudouNaTela(antes: Estado, depois: Estado): boolean {
  if (antes === depois) return false;
  const naTela = conversaIdNaTela(depois);
  for (const k of Object.keys(depois) as (keyof Estado)[]) {
    if (k === "invalidacoes" || antes[k] === depois[k]) continue;
    if (k === "atividades" && (naTela === null || antes.atividades[naTela] === depois.atividades[naTela])) continue;
    return true;
  }
  return false;
}

export function agenteDaTela(estado: Estado): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa") return t.agenteId;
  return null;
}

export function conversaDaTela(estado: Estado): ConversaEstado | null {
  const t = estado.tela;
  if (t.tipo !== "conversa" && t.tipo !== "sala") return null;
  return estado.conversas[t.conversaId] ?? null;
}

/**
 * definido em 2026-09-24: não há página inicial — o app abre na conversa do primeiro agente da pessoa
 * (fixados primeiro, na ordem da barra lateral) e, sem nenhum, em "Novo bot". Enquanto a frota não chega
 * a tela fica "inicio" (vazia); qualquer navegação para "inicio" resolve do mesmo jeito.
 */
/** O que troca junto com a tela, por `navegar` ou quando o bot da conversa sai da frota (NOD-370). */
function aoTrocarDeTela(estado: Estado, tela: Tela): Pick<Estado, "tela" | "atividades" | "avatarAberto" | "gaveta" | "perfilCelular" | "faixaParada" | "novasDesde" | "faixaTrabalhosAberta"> {
  const saindo = conversaIdNaTela(estado);
  const atividades = saindo && !estado.conversas[saindo] && estado.atividades[saindo] && conversaIdNaTela({ ...estado, tela }) !== saindo
    ? semConversa(estado.atividades, saindo)
    : estado.atividades;
  return {
    tela,
    atividades,
    // Revisão da NOD-349: o popover do avatar não reabre sozinho ao voltar ao bot.
    avatarAberto: null,
    // A gaveta só continua num nível interno se a conversa é do mesmo bot; outro bot abre na visão geral.
    gaveta: tela.tipo === "conversa" && estado.gaveta?.agenteId === tela.agenteId ? estado.gaveta : null,
    // NOD-382: o perfil do celular é da conversa do bot; outra tela o fecha.
    perfilCelular: tela.tipo === "conversa" && estado.perfilCelular?.agenteId === tela.agenteId ? estado.perfilCelular : null,
    faixaParada: tela.tipo === estado.tela.tipo ? estado.faixaParada : null,
    // A linha "Novas" vale enquanto a pessoa está na conversa; saiu, ela some.
    novasDesde: {},
    faixaTrabalhosAberta: faixaAbertaAoNavegar(estado.faixaTrabalhosAberta, estado.tela, tela),
  };
}

/**
 * NOD-370: os bots que estavam na frota e sumiram da nova (excluídos ou ocultos). Só a saída conta: um bot recém-criado
 * que ainda não está numa frota velha não tira a pessoa da conversa dele.
 */
function botsQueSairam(estado: Estado, nova: FrotaDto): Set<string> {
  if (!estado.frota) return new Set();
  const ficam = new Set(nova.agentes.map((a) => a.id));
  return new Set(estado.frota.agentes.filter((a) => !ficam.has(a.id)).map((a) => a.id));
}

/**
 * NOD-370: a tela que depende de um bot que saiu. A conversa dele vai para Início; a tela que volta para ela (a task, o
 * Marketplace, a linha) passa a voltar para Início. null = nada na tela depende deles.
 */
function semBotsQueSairam(estado: Estado, saiu: ReadonlySet<string>, extra: Partial<Estado>): Estado | null {
  if (saiu.size === 0) return null;
  const t = estado.tela;
  if (t.tipo === "conversa") return saiu.has(t.agenteId) ? semConversaDoBot(estado, extra) : null;
  const tela = voltarSemBot(t, saiu);
  return tela === t ? null : { ...estado, ...extra, tela };
}

/** O "voltar" (de qualquer altura: Conectores › task › conversa) que dava na conversa de um bot que saiu passa a dar em Início. */
function voltarSemBot(t: Tela, saiu: ReadonlySet<string>): Tela {
  const voltar = "voltar" in t ? t.voltar : undefined;
  if (!voltar) return t;
  if (voltar.tipo === "conversa" && saiu.has(voltar.agenteId)) return { ...t, voltar: { tipo: "inicio" } } as Tela;
  const dentro = voltarSemBot(voltar as Tela, saiu);
  return dentro === voltar ? t : ({ ...t, voltar: dentro } as Tela);
}

/**
 * NOD-370: tira a conversa do bot que saiu de baixo de Seu espaço — a tela vai para Início (o primeiro bot que ficou),
 * com o que `navegar` também limpa (gaveta, avatar, "Novas", faixas); o `espaco` aberto por cima continua onde estava.
 */
function semConversaDoBot(estado: Estado, extra: Partial<Estado>): Estado {
  const t = estado.tela;
  if (t.tipo !== "conversa") return { ...estado, ...extra };
  const saiu = t.agenteId;
  // A frota ainda pode ser a de antes (a gestão chegou primeiro): o Início não escolhe o próprio bot que saiu.
  const frota = estado.frota ? { ...estado.frota, agentes: estado.frota.agentes.filter((a) => a.id !== saiu) } : estado.frota;
  const resolvido = resolverInicio({ ...estado, ...extra, ...aoTrocarDeTela(estado, { tipo: "inicio" }), frota });
  return { ...resolvido, frota: estado.frota };
}

export function resolverInicio(entrada: Estado): Estado {
  let estado = entrada;
  // definido em 2026-10-04 (ADR-077): quem não concluiu o onboarding abre nele (a camada #onboarding por cima do app). A
  // primeira leitura que diz `mostrar` abre uma vez; fechar (concluir) não reabre sozinho — só "Ver o onboarding de novo".
  if (estado.onboarding !== undefined && !estado.onboardingResolvido) {
    const o = estado.onboarding;
    if (o?.mostrar) {
      const guia = o.guia;
      // NOD-455: o link direto /quadros/:qid já abriu a tela da participante; o guia abre por cima dela, sem trocá-la.
      const fica = estado.tela.tipo === "quadro-compartilhado";
      return { ...estado, onboardingResolvido: true, onboardingAberto: true, tela: guia && !fica ? { tipo: "conversa", conversaId: guia.conversaId, agenteId: guia.id } : estado.tela };
    }
    estado = { ...estado, onboardingResolvido: true };
  }
  if (estado.tela.tipo !== "inicio" || !estado.frota) return estado;
  const meus = estado.frota.agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId && a.conversaId);
  // revisto em 2026-10-07 (ADR-081): o Nod é fixo mas de uso esporádico — o app abre no primeiro bot da pessoa e só cai
  // no Nod quando ele é o único.
  const comuns = meus.filter((a) => a.papel !== "nod");
  const primeiro = comuns.find((a) => a.fixado) ?? comuns[0] ?? meus[0];
  const tela: Tela = primeiro ? { tipo: "conversa", conversaId: primeiro.conversaId, agenteId: primeiro.id } : { tipo: "novo-bot" };
  return { ...estado, tela };
}

/** O que a tela atual precisa ter carregado (o main busca o que faltar). */
/** NOD-326: a conversa de um bot na tela, a gaveta dele na visão geral (sem nível aberto) e a aba Biblioteca escolhida. */
export function bibliotecaAberta(estado: Pick<Estado, "tela" | "gaveta" | "abaGaveta"> & Partial<Pick<Estado, "perfilCelular">>): boolean {
  const t = estado.tela;
  if (t.tipo !== "conversa") return false;
  const nivel = estado.gaveta?.agenteId === t.agenteId ? estado.gaveta.nivel : null;
  // NOD-382: no perfil do celular, a linha Biblioteca mostra "N itens" e a tela dela é a lista inteira.
  if (estado.perfilCelular?.agenteId === t.agenteId && (nivel === null || nivel.tipo === "biblioteca")) return true;
  return nivel === null && estado.abaGaveta[t.agenteId] === "biblioteca";
}

/** NOD-58: a ordem do diário (mais novas primeiro, por (criadoEm, id), como no servidor): `a` vem antes de `b`. */
function maisNova(a: EntradaDiario, b: EntradaDiario): boolean {
  return a.criadoEm > b.criadoEm || (a.criadoEm === b.criadoEm && a.id > b.id);
}

export function invalidacoesDaTela(estado: Estado): Invalidacao[] {
  const t = estado.tela;
  const faltas: Invalidacao[] = [];
  const secao = secaoAberta(estado);
  if (secao === "agentes" && !estado.gestao) faltas.push("gestao");
  if (!estado.frota) faltas.push("frota");
  // Plano das IAs (2026-10-10): Provedores de IA, a gaveta (2A/2B) e as linhas de troca de IA no chat leem `GET /ias`.
  if (estado.sessao && estado.ias === undefined && (secao === "conexao" || t.tipo === "conversa")) faltas.push("ias");
  // definido em 2026-10-16 (plano "tela limpa", T6): o anel do seletor de IA no campo da conversa lê o uso da janela.
  if (estado.sessao && estado.usoDoPlano === undefined && t.tipo === "conversa") faltas.push("uso-plano");
  // ADR-077: o onboarding é lido uma vez por sessão (a falha vira null e o app abre normal).
  if (estado.sessao && estado.onboarding === undefined) faltas.push("onboarding");
  if ((t.tipo === "conversa" || t.tipo === "sala") && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (t.tipo === "sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "nova-sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "conversa" && !estado.concessoes[t.agenteId]) faltas.push(`concessoes:${t.agenteId}`);
  // Modo ligação (2026-10-04): o botão "Ligar" do cabeçalho só aparece com a disponibilidade lida, e só para bot da pessoa.
  if (t.tipo === "conversa" && !(t.agenteId in estado.disponibilidadeLigacao) && estado.frota?.agentes.some((a) => a.id === t.agenteId && a.ownerId === estado.sessao?.pessoaId)) faltas.push(`disponibilidade:${t.agenteId}`);
  // Os níveis da gaveta que leem algo próprio: a memória do bot e o histórico da rotina aberta.
  const nivel = t.tipo === "conversa" && estado.gaveta?.agenteId === t.agenteId ? estado.gaveta.nivel : null;
  const gavetaDe = estado.gaveta?.agenteId ?? "";
  // NOD-58: Ajustes mostra "N para revisar" na linha Memória (o número vem com a lista); o Histórico lê o diário.
  if ((nivel?.tipo === "memoria" && !estado.memorias[gavetaDe]) || (nivel?.tipo === "ajustes" && !(gavetaDe in estado.memoriasARevisar))) faltas.push(`memoria:${gavetaDe}`);
  const donaDaGaveta = estado.frota?.agentes.some((a) => a.id === gavetaDe && a.ownerId === estado.sessao?.pessoaId) ?? false;
  if (nivel?.tipo === "memoria" && nivel.aba === "historico" && donaDaGaveta && !estado.diarios[gavetaDe]) faltas.push(`diario:${gavetaDe}`);
  if (nivel?.tipo === "rotina" && !estado.execucoes[nivel.id]) faltas.push(`execucoes:${nivel.id}`);
  // ADR-114: a página do dia aberto na Atividade; e o "N hoje" da linha "Atividade" do bot da pessoa (o main só busca com o
  // painel à vista). Lida num dia que já passou (a meia-noite virou com a tela aberta), relê.
  const vista = estado.atividadeVista;
  if (nivel?.tipo === "atividade" && vista && !(chaveDaAtividade(vista.agenteId, vista.dia) in estado.atividadeDoBot)) faltas.push(`atividade:${chaveDaAtividade(vista.agenteId, vista.dia)}`);
  // NOD-70: a página da aba Decisões, no dia e no filtro abertos.
  if (nivel?.tipo === "atividade" && vista?.aba === "decisoes" && !(chaveDasDecisoes(vista.agenteId, vista.dia, vista.desfecho) in estado.decisoesDoBot)) faltas.push(`decisoes:${chaveDasDecisoes(vista.agenteId, vista.dia, vista.desfecho)}`);
  if (t.tipo === "conversa" && estado.frota?.agentes.some((a) => a.id === t.agenteId && a.ownerId === estado.sessao?.pessoaId)) {
    const lida = estado.atividadeHoje[t.agenteId];
    if (!lida || (estado.agora > 0 && lida.dia < diaLocal(estado.agora))) faltas.push(`atividade-hoje:${t.agenteId}`);
  }
  // NOD-326: a Biblioteca, só com ela aberta na visão geral da gaveta deste bot (o main ainda pede o painel à vista).
  if (t.tipo === "conversa" && bibliotecaAberta(estado) && !estado.bibliotecaDoBot[t.conversaId]) faltas.push(`biblioteca:${t.conversaId}`);
  // definido em 2026-09-25: o marketplace diz quais bots usam cada app, então precisa das concessões de todos os bots da pessoa.
  if (t.tipo === "conectores") for (const a of estado.frota?.agentes ?? []) if (a.ownerId === estado.sessao?.pessoaId && !estado.concessoes[a.id]) faltas.push(`concessoes:${a.id}`);
  // definido em 2026-09-18: as rotinas do bot moram no painel Detalhes da conversa, então precisam
  // chegar junto com ela — não só na tela dedicada.
  if ((t.tipo === "rotinas" || t.tipo === "conversa") && !estado.carregado.rotinas) faltas.push("rotinas");
  // definido em 2026-09-24 ("rotina nasce com o acesso"): "Sua vez" também, porque o card da rotina proposta
  // diz se o app que ela precisa já está conectado ("Conectar {App}" ou "Criar rotina e permitir leitura").
  if ((t.tipo === "conectores" || t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "sua-vez") && !estado.carregado.conectores) faltas.push("conectores");
  // A fila alimenta o badge ⚑ da sidebar e a faixa de chamada em QUALQUER tela: sem o rail, ela é o
  // único aviso de que há decisão parada.
  if (!estado.suaVez) faltas.push("sua-vez");
  // O ícone de Não lidos e o ponto de cada linha da barra valem em qualquer tela, como a fila.
  if (!estado.naoLidos) faltas.push("nao-lidos");
  // ADR-083: o chip de cada bot na barra e o ícone "Trabalhos" do topo também (e a faixa, a gaveta, a tela da task).
  if (estado.sessao && !estado.trabalhos) faltas.push("trabalhos");
  if (t.tipo === "trabalho" && !estado.trabalhoDetalhe[t.id]) faltas.push(`trabalho:${t.id}`);
  if (t.tipo === "linha" && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (secao === "maquinas" && !estado.chaves) faltas.push("chaves");
  // ADR-090: a seção Máquinas e a conversa (a mensagem na fila diz quando a máquina do bot está fora do ar).
  // QA do NOD-314: a tela da task também lê a frota ("Rodar em <outra> desta vez" e a linha do turno preso).
  if (estado.sessao && !estado.maquinas && (secao === "maquinas" || secao === "agentes" || secao === "conexao" || t.tipo === "conversa" || t.tipo === "trabalho")) faltas.push("maquinas");
  // ADR-121 (NOD-92): a conta da nuvem em Máquinas (404 = sem a flag; a seção fica como antes).
  if (estado.sessao && estado.nuvem.conta === null && secao === "maquinas") faltas.push("nuvem");
  // ADR-102: a lista de contas em Provedores de IA e o resumo de contas de cada máquina.
  // definido em 2026-10-16 (T6): e o cabeçalho do seletor de IA no campo (a conta em uso, só o apelido).
  // NOD-280 (critério 9): e a sala/linha aberta com nota de limite de contas — a nota se recalcula com a lista.
  if (estado.sessao && !estado.contasIa && (secao === "maquinas" || secao === "conexao" || t.tipo === "conversa" || t.tipo === "trabalho" || conversaAbertaTemNotaDeContas(estado))) faltas.push("contas");
  // O frame relato.criado não invalida nada (é registro), então a seção busca quando ainda não tem.
  if (secao === "feedback" && !estado.relatos && !estado.relatosErro) faltas.push("relatos");
  // NOD-85: a agenda lê a janela dela e as rotinas (a parada por falta de acesso e o "Permitir" vêm de GET rotinas).
  if (secao === "rotinas" && agendaPorLer(estado.agenda)) faltas.push("agenda");
  if (secao === "rotinas" && !estado.carregado.rotinas) faltas.push("rotinas");
  return faltas.filter((f) => !estado.invalidacoes.includes(f));
}

/**
 * O que o stream que voltou a `aberto` relê (definido em 2026-10-13, NOD-216): os turnos vivos — `GET trabalhos` traz o
 * dono de cada bot (os mascotes da barra) e cada conversa carregada, os turnos dela. Só a aberta é buscada na hora.
 * NOD-450: e a barra, por defesa, no espírito da NOD-216. O replay (ADR-016) cobre o que este stream publicou, mas a
 * barra não pode depender de nenhum frame ter chegado: um `agente.mudou` do bot criado pelo chat (ou o `turno.encerrado`,
 * que também relê a frota) que não chegou à aba a deixava sem o bot até o F5. Relê a frota, os não lidos (a prévia e o
 * ponto do fim do turno) e, se já foi lida, a gestão (Agentes; `relevante` só busca com a seção aberta).
 * Com `resumed:false` o `aoReidratar` (invalidacoesAoRetomar) pede tudo de novo logo depois: a frota pode ser lida duas
 * vezes nessa reconexão (aceito: reconexão é rara e a NOD-370 ordena as leituras).
 */
export function invalidacoesAoReconectar(estado: Estado): Invalidacao[] {
  if (!estado.sessao) return [];
  // Revisão: a tela da task aberta também — é a leitura dela que tira o turno fantasma da task (hidratar-trabalho).
  const t = estado.tela;
  // NOD-326 (revisão 2): a Biblioteca já lida também — o stream que caiu pode ter perdido o frame do arquivo novo.
  return ["trabalhos", "frota", "nao-lidos", ...(estado.gestao ? ["gestao" as const] : []), ...Object.keys(estado.conversas).map((id): Invalidacao => `conversa:${id}`), ...Object.keys(estado.bibliotecaDoBot).map((id): Invalidacao => `biblioteca:${id}`), ...(t.tipo === "trabalho" ? [`trabalho:${t.id}` as Invalidacao] : [])];
}

/**
 * NOD-450 (revisão 1): o que a mudança de conexão relê. Só o stream que volta (`reconectando` → `aberto`) relê
 * (invalidacoesAoReconectar); a primeira conexão e as quedas não. `estado` é o de antes de aplicar a mudança.
 */
export function invalidacoesAoMudarConexao(estado: Estado, novo: EstadoConexao): Invalidacao[] {
  return novo === "aberto" && estado.conexao.estado === "reconectando" ? invalidacoesAoReconectar(estado) : [];
}

/**
 * NOD-450 (revisão 3): as faltas que o main busca já, seja qual for a tela (a barra, os turnos e os avisos estão sempre à
 * vista). As outras dependem da tela ou da seção aberta (`relevante`, no main).
 */
export function sempreRelevante(q: Invalidacao): boolean {
  return q === "frota" || q === "inventario" || q === "executor" || q === "ias" || q === "sua-vez" || q === "salas" || q === "nao-lidos" || q === "ligacao" || q === "trabalhos" || q.startsWith("vivos:");
}

/**
 * NOD-450 (revisão 2): as ações que o main despacha, em ordem, quando a conexão muda. A decisão olha o estado de ANTES
 * da mudança (depois dela o stream já está `aberto` e não haveria o que reler); o main só despacha a lista.
 */
export function acoesAoMudarConexao(estado: Estado, ev: { estado: EstadoConexao; tentativa: number; proximaEmMs: number | null }): Acao[] {
  const releituras = invalidacoesAoMudarConexao(estado, ev.estado);
  const conexao: Acao = { tipo: "conexao", estado: ev.estado, tentativa: ev.tentativa, proximaEmMs: ev.proximaEmMs };
  return releituras.length ? [conexao, { tipo: "invalidar", quais: releituras }] : [conexao];
}

/**
 * O que o stream perdido pode ter mudado (definido em 2026-10-10, ADR-094): quando o servidor não consegue retomar
 * (`resumed:false` — o celular ficou muito tempo em segundo plano e o buffer foi podado), a web relê tudo o que já tinha
 * carregado, não só a tela: os não lidos, "Sua vez", os trabalhos, e toda conversa já aberta. Só o que a
 * tela olha é buscado na hora (`relevante` no main); o resto fica marcado até a tela abrir.
 */
export function invalidacoesAoRetomar(estado: Estado): Invalidacao[] {
  if (!estado.sessao) return [];
  const t = estado.tela;
  const todas: Invalidacao[] = [
    "frota", "sua-vez", "nao-lidos", "inventario", "executor", "ias", "uso-plano", "salas", "rotinas", "ligacao", "trabalhos",
    // NOD-450: a gestão já lida (Agentes) também pode ter perdido o bot novo; só busca com a seção aberta.
    ...(estado.gestao ? ["gestao" as const] : []),
    ...Object.keys(estado.conversas).map((id): Invalidacao => `conversa:${id}`),
    ...Object.keys(estado.bibliotecaDoBot).map((id): Invalidacao => `biblioteca:${id}`),
    ...(t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha" ? [`conversa:${t.conversaId}` as Invalidacao] : []),
    ...(t.tipo === "trabalho" ? [`trabalho:${t.id}` as Invalidacao] : []),
  ];
  return [...new Set(todas)];
}

/**
 * NOD-20: trocar de nível fecha a confirmação de restaurar e o erro dela; fechar a gaveta (nível null) também tira o
 * Desfazer e o anúncio ("o link some quando a pessoa sai da gaveta", protótipo v5).
 */
export function historicoAoTrocarNivel(h: Record<string, HistoricoDoBot>, agenteId: string, nivel: NivelGaveta | null): Record<string, HistoricoDoBot> {
  const atual = h[agenteId];
  if (!atual) return h;
  const limpo: HistoricoDoBot = { ...atual, confirmando: null, erroRestaurar: false, ...(nivel ? {} : { desfazer: null, anuncio: "" }) };
  return { ...h, [agenteId]: limpo };
}
