import type { Agente } from "./agente.ts";
import type { Conversa, Proposta } from "./conversa.ts";
import type { Decisao, ItemFila } from "./decisao.ts";
import type { EpochMs, IsoUtc } from "./ids.ts";
import type { IncidenteDto } from "./incidente.ts";
import type { ReacaoNaFala } from "./reacao.ts";
import type { Inventario } from "./inventario.ts";
import type { ItemAprovacao } from "./item-aprovacao.ts";
import type { Mensagem } from "./mensagem.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";
import type { Negacao } from "./negacao.ts";
import type { FioDaPergunta, FioDoItem, PedidoDoItem } from "./pedido.ts";
import type { BloqueioRotina, ChamadaWebhook, EsperaRotinaDto, JanelasPuladasDaRotina, OndeRodaDto, ParadaDaRotina, PerguntaPendenteDaRotina, Rotina } from "./rotina.ts";
import type { DonoNaConversa, TrabalhoDto } from "./trabalho.ts";
import type { TrocasNaConversa } from "./troca-entre-bots.ts";
import type { AcoesDoModoNaConversa } from "./acoes-do-modo.ts";

/** Mutação devolve ids; o estado chega por SSE (ADR-016). */
export type RespostaMutacao = { ok: true; ids: Record<string, string> };

/** Tela de entrada (ADR-030): `google` mostra "Entrar com Google"; `stub` (dev) lista as pessoas. `contas` (NOD-345) só com NOD_CONTAS. */
export type ModoSessaoDto = ({ modo: "google" } | { modo: "stub"; pessoas: { id: string; nome: string }[] }) & { contas?: { google: boolean; bootstrap: boolean; minhaConta?: boolean; onboardingTexto?: boolean }; onboardingTexto?: true };

export type AmbienteBancoDto = { regime: "persistente" | "efemero" | "desconhecido"; porta: number | null };
/** Chave de máquina como a dona a vê na lista (ADR-031): NUNCA traz a chave nem o hash. `papel` (NOD-94): PapelMaquina; ausente = motor. */
export type ChaveMaquinaDto = { id: string; nome: string; prefixo: string; criadaEm: EpochMs; ultimoUsoEm: EpochMs | null; revogadaEm: EpochMs | null; papel?: "motor" | "computador" };

/** Resposta da emissão: a chave crua aparece AQUI e em mais lugar nenhum. */
export type ChaveEmitidaDto = { chave: string; dados: ChaveMaquinaDto };
export type ErroDto = { codigo: string; mensagem: string; correlation_id?: string | null };

export type FrotaDto = {
  /**
   * `computadorForaDoAr` (definido em 2026-09-24, emenda da ADR-037): o computador do bot deixou de responder — a barra
   * lateral, o cabeçalho e o painel dizem isso sem abrir o computador. `ultimaMensagem` (mesma data, sidebar no estilo
   * do Grok): a prévia de uma linha da última mensagem da conversa própria; null sem conversa ou sem texto.
   */
  agentes: (Agente & { conversaId: string; descricaoEstado: string; computadorForaDoAr: { desde: EpochMs; motivo: MotivoFalhaComputador } | null; ultimaMensagem: { previa: string; em: EpochMs } | null })[];
  inventario: Inventario; /** NOD-437: os times da pessoa, na ordem da barra (Sem time incluso); quem está em cada um é o `secao` do bot. */ times?: import("./time.ts").TimeNaLista[];
  /** `revisor` (ADR-115, modos PR 4): o revisor do Automático ligado (`NOD_REVISOR`); o menu diz o Automático com ele. */ negacoes: Negacao[]; revisor?: true;
};

/**
 * EMENDA 13: turno pendente por agente ocupado é renderizável ("na fila — Vera está respondendo em #revisão").
 * `conversaId` é ONDE o bloqueio está (turnosRepo.pendentesRenderizaveis): igual à conversa lida =
 * serialização desta própria conversa ("na fila"); diferente = o agente está ocupado noutra
 * ("Vera está respondendo em #revisão"). A web distingue pela igualdade — definido em 2026-09-16.
 */
export type TurnoPendenteDto = { id: string; motivo: "agente_ocupado_em"; conversaId: string };

/**
 * Turno aberto da conversa (definido em 2026-09-24): a web recria o "trabalhando" ao recarregar a página no meio de um
 * turno. Sem isto ela só conhecia o turno pelo frame turno.iniciado, que não se repete, e o cartão sumia até o fim.
 */
export type TurnoEmCursoDto = { id: string; estado: "pendente" | "despachando"; desde: number; mensagemId: string | null; trabalhoId?: string | null; /** NOD-216: só a origem da fila do dono é desmentida por ela. */ origem?: string; /** NOD-276 (J3): quando a máquina o pegou; "Trabalhando · há N" conta daqui. */ despachadoEm?: number | null; /** QA do NOD-314: a máquina escolhida "desta vez" (sobrepõe a do bot no chip da fila). */ maquinaDestaVez?: string | null; /** NOD-348: o bot do turno (o mascote da fala viva na sala e na recarga). */ agenteId?: string; /** NOD-402 (ADR-130): turno dos bastidores (rotina, colega) — a web o conta na presença e o deixa fora do chat. */ bastidores?: boolean };

export type ConversaDto = DonoNaConversa & TrocasNaConversa & AcoesDoModoNaConversa & {
  conversa: Conversa;
  mensagens: Mensagem[];
  turnosPendentes: TurnoPendenteDto[];
  turnosEmCurso: TurnoEmCursoDto[];
  /** Turnos que a pessoa cancelou antes de rodar: a mensagem que os disparou mostra "Cancelada · não rodou". */
  turnosCancelados: { id: string; mensagemId: string }[];
  /** Propostas PENDENTES da conversa (E1.1): o cartão da web nasce daqui, nunca de um kind de Mensagem (definido em 2026-09-16, L9). */
  propostas: Proposta[];
  /** definido em 2026-09-24 (fio da pergunta): os fios com mensagem na janela carregada, com o estado derivado. */
  fios: FioDaPergunta[];
  trabalhos?: TrabalhoDto[]; // ADR-083: trabalhos abertos do bot desta conversa (faixa); ausente = servidor antigo
  reacoes?: ReacaoNaFala[]; // ADR-113: as reações das falas da janela, agrupadas por emoji; ausente = servidor antigo
};

export type SuaVezDto = {
  /**
   * `proposta`: a de MESMO id da decisão (acesso, perfil, rotina…), para a web tirar dela os rótulos; null nos outros tipos.
   * `fio` (definido em 2026-09-24): o fio e a rodada dos três tipos de pedir_a_pessoa; null nos outros.
   * `rotinaParada` (mesma data, emenda da ADR-044): o pedido de acesso aberto que veio de uma rotina — desde quando e o que não rodou.
   * `nuncaPermanente` (ADR-047): sem "Sempre permitir". `pedido` (2026-10-18): PedidoDoItem. `trabalhoId` (NOD-114): a task do turno (null = conversa).
   */
  itens: (ItemFila & { itensAprovacao: ItemAprovacao[]; proposta: Proposta | null; fio: FioDoItem | null; rotinaParada: ParadaDaRotina | null; nuncaPermanente?: string[]; pedido?: PedidoDoItem | null; trabalhoId?: string | null; /** NOD-402: o turno do pedido é dos bastidores. */ bastidores?: boolean; /** NOD-443 (revisão 7 do PR #628, achado 4): o nome de quem participa do quadro e pediu o turno que abriu o cartão (o bot da dona sob a procuração dela). */ aPedidoDe?: string })[];
  /** Avisos de infraestrutura (ADR-045): um por queda do Mac, nunca um card por turno. Não são decisões. */
  incidentes: IncidenteDto[];
  foraDoAr: { nome: string; desde: EpochMs }[];
  vazio: boolean;
  ultimaDecisaoEm: IsoUtc | null;
};

export type DecisaoDto = { decisao: Decisao; itens: ItemAprovacao[] };
/** `bloqueio` (definido em 2026-09-24, emenda da ADR-044): parada por falta de conexão ou acesso, com o card aberto; null = roda. */
/** `resumo` (definido em 2026-09-30): o cron em palavras, com o fuso — "dias úteis às 08:00 (America/Sao_Paulo)"; a gaveta do bot mostra. `ondeRoda` (NOD-89): ausente no modo local e nas rotinas de outra pessoa. */
export type RotinaDto = { rotina: Rotina; proximaExecucao: EpochMs; bloqueio: BloqueioRotina | null; resumo: string; espera: EsperaRotinaDto | null; /** NOD-412: a pausada com data — quando volta e o texto ("seg 09:00"). */ retomada?: { em: EpochMs; texto: string }; perguntaPendente?: PerguntaPendenteDaRotina; esperaDaCota?: { ia: string; voltaEm: EpochMs }; ondeRoda?: OndeRodaDto; webhook?: WebhookDaRotinaDto } & JanelasPuladasDaRotina;
/** NOD-84: o card e a gaveta da rotina webhook (só a dona); o endereço inteiro só sai por GET rotinas/:id/endereco. */ export type WebhookDaRotinaDto = { prefixo: string | null; provedor: string | null; eventos: string[]; chamadasHoje: number; recusadasHoje: number; recusaPendente: boolean; ultimas: ChamadaWebhook[] };

export type MetodoHttp = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export type EntradaRota = { metodo: MetodoHttp; caminho: string; lane: "L1" | "L4" | "L5" | "L6" | "L7" | "L8" | "L9" };

/**
 * Tabela de rotas (ADR-005: prefixo /api/t/:tenantId/… salvo públicas e internas). Cada lane
 * escreve o handler fino da sua rota contra o roteador da L1; a posse é a coluna `lane`.
 */
export const ROTAS = [
  { metodo: "GET", caminho: "/api/saude", lane: "L1" }, { metodo: "GET", caminho: "/api/saude/lb", lane: "L1" }, // lb: Caddy, NOD-218
  /** Só com NOD_LOGIN=stub (desenvolvimento, loopback): entra como uma pessoa do cadastro (ADR-030). */
  { metodo: "POST", caminho: "/api/sessao/entrar", lane: "L1" },
  { metodo: "GET", caminho: "/api/sessao", lane: "L1" },
  { metodo: "GET", caminho: "/api/sessao/modo", lane: "L1" },
  /** Só com NOD_LOGIN=google (E1.2, ADR-030). */
  { metodo: "GET", caminho: "/api/sessao/google", lane: "L1" },
  { metodo: "GET", caminho: "/api/sessao/google/callback", lane: "L1" },
  { metodo: "GET", caminho: "frota", lane: "L6" },
  { metodo: "GET", caminho: "gestao-agentes", lane: "L6" },
  { metodo: "PATCH", caminho: "agentes/:id/organizacao", lane: "L6" },
  { metodo: "DELETE", caminho: "agentes/:id", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/restaurar", lane: "L6" },
  { metodo: "GET", caminho: "inventario", lane: "L9" },
  { metodo: "GET", caminho: "ambiente", lane: "L9" },
  /** Interruptor de executor (2026-09-16); o POST só no modo local (2026-10-10: o compartilhado diz `trocavel: false`). */
  { metodo: "GET", caminho: "executor", lane: "L9" },
  { metodo: "POST", caminho: "executor", lane: "L9" },
  { metodo: "GET", caminho: "ias", lane: "L9" }, // 0068: ordem, estado (com o limite) e modelos das IAs da pessoa
  { metodo: "POST", caminho: "agentes", lane: "L6" },
  { metodo: "PATCH", caminho: "agentes/:id", lane: "L6" },
  /** definido em 2026-09-29 (ADR-059): o modo de aprovação do bot, pelo chip do campo; só a dona. */
  { metodo: "POST", caminho: "agentes/:id/modo-aprovacao", lane: "L6" },
  { metodo: "GET", caminho: "agentes/:id/inteligencia", lane: "L6" },
  { metodo: "PUT", caminho: "agentes/:id/inteligencia", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/fixar", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/ocultar", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/duplicar", lane: "L6" },
  { metodo: "GET", caminho: "agentes/:id/memoria", lane: "L6" },
  { metodo: "POST", caminho: "agentes/:id/memoria", lane: "L6" },
  { metodo: "PATCH", caminho: "agentes/:id/memoria/:mid", lane: "L6" },
  { metodo: "DELETE", caminho: "agentes/:id/memoria/:mid", lane: "L6" },
  { metodo: "GET", caminho: "agentes/:id/concessoes", lane: "L5" },
  { metodo: "POST", caminho: "agentes/:id/concessoes", lane: "L5" },
  { metodo: "DELETE", caminho: "concessoes/:id", lane: "L5" },
  /** definido em 2026-09-24 (ADR-044): revoga um grupo (app · nível) com UM registro escrito. */
  { metodo: "POST", caminho: "agentes/:id/concessoes/revogar", lane: "L5" },
  { metodo: "GET", caminho: "conversas/:id/mensagens", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/mensagens", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/parar", lane: "L6" },
  { metodo: "POST", caminho: "parar", lane: "L6" },
  { metodo: "POST", caminho: "propostas/:id/confirmar", lane: "L6" },
  { metodo: "POST", caminho: "propostas/:id/recusar", lane: "L6" },
  { metodo: "GET", caminho: "rotinas", lane: "L7" },
  { metodo: "POST", caminho: "rotinas", lane: "L7" },
  { metodo: "POST", caminho: "rotinas/:id/pausar", lane: "L7" }, { metodo: "POST", caminho: "rotinas/:id/ativar", lane: "L7" }, { metodo: "POST", caminho: "rotinas/:id/ritmo", lane: "L7" }, // ritmo: NOD-313
  { metodo: "POST", caminho: "rotinas/:id/executar", lane: "L7" }, { metodo: "GET", caminho: "rotinas/:id/execucoes", lane: "L7" }, { metodo: "GET", caminho: "rotinas/:id/endereco", lane: "L7" }, { metodo: "POST", caminho: "rotinas/:id/endereco", lane: "L7" }, { metodo: "POST", caminho: "rotinas/:id/testar-webhook", lane: "L7" }, // NOD-84
  { metodo: "POST", caminho: "/api/w/:token", lane: "L7" }, { metodo: "POST", caminho: "/api/w", lane: "L7" }, { metodo: "GET", caminho: "rotinas/agenda", lane: "L7" }, // agenda: NOD-85
  { metodo: "GET", caminho: "salas", lane: "L7" },
  { metodo: "POST", caminho: "salas", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/membros", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/mensagens", lane: "L7" },
  { metodo: "POST", caminho: "salas/:id/parar", lane: "L7" },
  { metodo: "GET", caminho: "conectores", lane: "L5" },
  { metodo: "POST", caminho: "conectores", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/sondar", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/habilitar", lane: "L5" },
  { metodo: "POST", caminho: "conectores/:id/desabilitar", lane: "L5" },
  { metodo: "GET", caminho: "sua-vez", lane: "L8" },
  /** definido em 2026-09-24 (ADR-045): "Entendi" no aviso de queda do Mac. */
  { metodo: "POST", caminho: "incidentes/:id/dispensar", lane: "L8" },
  { metodo: "POST", caminho: "decisoes/:id/decidir", lane: "L9" },
  { metodo: "POST", caminho: "decisoes/:id/reabrir", lane: "L8" },
  { metodo: "POST", caminho: "decisoes/:id/retomar", lane: "L9" },
  { metodo: "POST", caminho: "decisoes/:id/responder", lane: "L9" },
  { metodo: "GET", caminho: "trilha", lane: "L5" },
  { metodo: "GET", caminho: "eventos", lane: "L8" },
  { metodo: "GET", caminho: "/metrics", lane: "L8" },
  { metodo: "GET", caminho: "dev/catcher", lane: "L8" },
  { metodo: "GET", caminho: "/api/interno/plano", lane: "L5" },
  { metodo: "POST", caminho: "/api/interno/ferramentas/:nome", lane: "L5" },
  { metodo: "GET", caminho: "/api/interno/decisoes/:id/aguardar", lane: "L5" },
  /** Negação decidida LOCALMENTE pelo proxy (ADR-013): o servidor grava a trilha e pede a interrupção (pendência L5 §3). */
  { metodo: "POST", caminho: "/api/interno/negacoes", lane: "L5" },
  /** Acréscimos da L6 (definido em 2026-09-16): estado do turno para a web/e2e e retomada direta por turno, sem decisão. */
  { metodo: "GET", caminho: "turnos/:id", lane: "L6" },
  { metodo: "POST", caminho: "turnos/:id/retomar", lane: "L6" },
  /** Modo dev (definido em 2026-09-28, 0036): a preferência da pessoa e o Raio-X dos turnos. */
  { metodo: "GET", caminho: "preferencias", lane: "L6" },
  { metodo: "PUT", caminho: "preferencias", lane: "L6" },
  { metodo: "GET", caminho: "turnos/:id/raio-x", lane: "L6" },
  { metodo: "GET", caminho: "conversas/:id/raio-x", lane: "L6" },
  /** O "/" do chat (definido em 2026-09-28, 0038): o catálogo do Mac e a nova sessão, que é do nod. */
  { metodo: "GET", caminho: "comandos", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/nova-sessao", lane: "L6" },
  /** Não lidos (definido em 2026-09-29, 0039): o que chegou depois do "lido até" de cada conversa, e marcar. */
  { metodo: "GET", caminho: "nao-lidos", lane: "L6" },
  { metodo: "POST", caminho: "nao-lidos/marcar-tudo", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/lida", lane: "L6" },
  { metodo: "POST", caminho: "conversas/:id/nao-lida", lane: "L6" },
  /** Chaves de máquina (E1.3, ADR-031): emitir (a chave crua sai uma vez), listar e revogar. */
  { metodo: "POST", caminho: "maquinas/chaves", lane: "L9" },
  { metodo: "GET", caminho: "maquinas/chaves", lane: "L9" },
  { metodo: "DELETE", caminho: "maquinas/chaves/:id", lane: "L9" },
  /** Artefato do nod (ADR-051, definido em 2026-09-28): o card busca HTML e estado; a pessoa salva o que marcou. */
  { metodo: "GET", caminho: "artefatos/:id", lane: "L6" },
  { metodo: "GET", caminho: "artefatos/:id/versoes/:versao", lane: "L6" },
  { metodo: "PUT", caminho: "artefatos/:id/estado", lane: "L6" },
] as const satisfies readonly EntradaRota[];
