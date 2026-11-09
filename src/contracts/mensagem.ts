import type { ContasNoLimite, IaComConta } from "./contas-ia.ts";
import type { AnexoDaConversa, RecusasMidia, TipoAnexo } from "./anexo.ts";
import type { PayloadLinhaLigacao } from "./ligacao.ts";
import type { Autoria } from "./evento.ts";
import type { IdHarness } from "./harness.ts";
import type { CAUSA_LIMITE, CausaSemIa } from "./inventario.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { CausaNativa } from "./negacao.ts";
import type { EstadoTrabalho, OrigemTrabalho } from "./trabalho.ts";
import type { ContaNoLimite, MotivoRecomeco, OrigemTurno } from "./turno.ts";
import type { PayloadTrocaDeIa } from "./troca-de-ia.ts";
import type { PayloadRotinaEvento, PayloadRotinaRitmo } from "./rotina.ts";
import type { Destino } from "./destino-no-chat.ts";
import type { PayloadPedidoRespondido, PayloadPeerPedido } from "./troca-entre-bots.ts";
import type { AncoraDoConsentimento, PayloadPropostaDecidida, PayloadRegraPermanente } from "./cartao-encolhido.ts";
import type { DesfechoItem, DesfechoRotina, MotivoFalhaComputador, MotivoNegacao, MotivoPasse } from "./motivos.ts";

/** Marca de confiança é propriedade do CONTEÚDO, nunca do nome da ferramenta (ADR-026). */
/**
 * definido em 2026-10-15 (NOD-257, H5): o pedido a colega parado na fila e o porquê. Não é gravado: `lerConversa` o põe
 * no payload do handoff na leitura (use-cases/fila-do-pedido.ts). `motivo` nulo = só na vez dele.
 */
export type FilaDoPedido = {
  desde: number;
  motivo: "depois_de" | "faixa_ocupada" | "condicao_da_maquina" | "agente_excluido" | "geracao_antiga" | "maquina_alvo_sem_contato" | null;
};

export type Confianca = "confiavel" | "nao_confiavel";

export type KindMensagem =
  | "texto"
  | "sistema"
  | "handoff"
  | "passe"
  | "consentimento"
  | "rotina_execucao"
  | "resultado_aprovacao"
  | "negacao"
  | "parada"
  | "peer_ask"
  /** definido em 2026-09-28 (ADR-051, 0031): o card do artefato; o HTML vem por GET artefatos/:id. */
  | "artefato";

/** Payload tipado por kind: estado de controle nunca se lê do texto (Regra 9, GRUPO.passe-tipado). */
export type PayloadMensagem =
  | { kind: "boas_vindas" } | { kind: "acoes_do_turno"; acoes: { rotulo: string; falhou?: true; vezes?: number }[]; duracaoMs?: number } // NOD-353: resumo das ações; duracaoMs (26/10, "Pensou por 9 s" na gravada)
  /** `trabalhoId` (2026-10-07, ADR-083): o trabalho de quem RECEBEU o pedido. `nomePara` (2026-10-18, chat limpo PR 3): o nome dele no momento. */
  | { kind: "handoff"; de: string; para: string; motivo: string; tarefaId?: string; trabalhoId?: string; fila?: FilaDoPedido; nomePara?: string }
  /** ADR-047/058 e chat limpo (PR 3, `nome`): troca-entre-bots.ts. */
  | PayloadPeerPedido
  | { kind: "passe"; motivo: MotivoPasse }
  /** definido em 2026-09-24 (ADR-044): um consentimento por LOTE de capacidades do mesmo app. A âncora: cartao-encolhido.ts. */
  | ({ kind: "consentimento"; conectorId: string; slug: string; capacidades: string[]; naoInclui: string[] } & AncoraDoConsentimento)
  /** Forma das mensagens gravadas antes de 2026-09-24: uma capacidade por consentimento. */
  | { kind: "consentimento"; conectorId: string; slug: string; capacidade: string; naoInclui: string[] }
  | { kind: "rotina_execucao"; rotinaId: string; instanteAgendado: EpochMs; desfecho: DesfechoRotina }
  | PayloadRotinaEvento
  /**
   * definido em 2026-10-03: `frase` (o pedido) e `texto` por item entram para a web desenhar o recibo compacto da
   * decisão sem reler o texto redigido; as mensagens gravadas antes não os têm. `revisor` (modos, PR 4): o cartão era do revisor ("Negado por você").
   */
  | { kind: "resultado_aprovacao"; decisaoId: string; frase?: string; itens: { idx: number; desfecho: DesfechoItem; texto?: string }[]; revisor?: true }
  /**
   * `causa` (definido em 2026-10-05): a IA estava logada e a conta não serviu (src/contracts/inventario.ts).
   * `modelo` (NOD-171): o harness está pronto, mas o modelo escolhido no agente não é aceito por ele; a tela pede outro
   * modelo em vez de dizer que a IA "já voltou".
   * `causaNativa` e `vezes` (definido em 2026-10-11): por que o hook do nod barrou a nativa e quantas vezes no turno.
   * `ia` (NOD-220): o harness do turno que a IA recusou (plano_ausente). Só existe quando a recusa foi de uma IA; a do
   * executor (motor ausente, `nome` = motorDe: "claude-cli" no local, "catcher") não o grava. `nome` mistura os dois;
   * `ia` não. A web decide "já voltou" e nomeia a IA por `ia`; valor fora do catálogo da web não vale (nada se infere).
   * As negações gravadas antes não o têm: a web nunca conclui "já voltou" por inferência de outra IA.
   */
  | { kind: "negacao"; classe: "ferramenta_negada" | "conector_indisponivel" | "plano_ausente"; nome: string; motivo: MotivoNegacao; terminal: boolean; causa?: CausaSemIa; modelo?: string; causaNativa?: CausaNativa; vezes?: number; ia?: IdHarness; anexo?: TipoAnexo; /** jornada C: fala fixa sem IA, turno guardado (src/domain/sem-ia.ts) */ aguardaIa?: true }
  /**
   * definido em 2026-10-05: o bot em "automático" passou a responder por outra IA porque a conta da primeira não
   * serviu. Linha de sistema, dita uma vez por troca; o turno que falhou foi repetido na outra IA.
   * revisto em 2026-10-10 (emenda da ADR-036): `causa: "limite"` = a primeira chegou ao limite da assinatura; `renovaEm`
   * diz quando ela volta a valer na ordem (a tela mostra a linha discreta "O Claude chegou ao limite · respondendo pelo
   * ChatGPT"). Nas outras causas, `renovaEm` não vem.
   */
  | { kind: "ia_trocada"; de: IdHarness; para: IdHarness; causa: CausaSemIa | typeof CAUSA_LIMITE; renovaEm?: EpochMs }
  /**
   * NOD-171: o turno parou porque o plano da IA atingiu o limite de uso (motivo `limite_do_plano` do protocolo do Claude
   * Code, ou a classe `limite_de_uso` do texto do Codex). Vai no aviso "Turno interrompido" para a tela desenhar o card
   * com a hora LOCAL de `voltaEm` (o texto gravado traz a de São Paulo). `voltaEm` null: o fornecedor não disse quando.
   */
  | { kind: "limite_do_plano"; harness: IdHarness | null; voltaEm: EpochMs | null; conta?: ContaNoLimite; contas?: ContasNoLimite }
  /**
   * definido em 2026-10-13 (ADR-102): a conta da lista bateu no limite e o turno seguiu noutra (a mesma IA, com "Trocar
   * sozinho", ou outra IA). A conta pelo apelido (o servidor guarda a lista).
   */
  | { kind: "conta_seguiu"; de: { id: string; apelido: string; ia: IaComConta }; para: { id: string; apelido: string; ia: IaComConta }; voltaEm: EpochMs | null }
  /**
   * definido em 2026-10-16 (ADR-108 R4/R6): a IA das tasks do bot chegou ao limite e elas esperam — o aviso com a
   * recomendação ("esperar" ou "levar") e, no bot fixo, os dois caminhos. Um por bot; aberto, é atualizado.
   */
  | PayloadTrocaDeIa | PayloadRotinaRitmo // RotinaRitmo: NOD-313 (2026-10-23), o card que sugere espaçar ou pausar a rotina.
  /** ADR-102: a pessoa escolheu "Seguir com <conta>" e o turno foi refeito nela. */
  | { kind: "conta_escolhida"; contaId: string; apelido: string; ia: IaComConta }
  /**
   * NOD-302 (continuação da NOD-253): na conversa de onde saiu um pedido a colega, a linha de que ele espera na fila pela
   * cota da IA do colega, com a hora em que ela renova. Uma por turno do pedido (`turnoId`, o do colega).
   */
  | { kind: "pedido_na_fila_da_cota"; turnoId: string; agenteId: string; ia: IdHarness; voltaEm: EpochMs | null }
  /**
   * definido em 2026-10-12 (ADR-101 item 6): a conta em uso bateu no limite, "Trocar sozinho" estava ligado e o turno foi
   * refeito na conta `para`. Só posições; `foraDaTroca` são as contas livres que a troca pulou (NOD-308: sempre vazia; fica por compat).
   */
  | { kind: "conta_trocada"; harness: IdHarness; de: number; para: number; voltaEm: EpochMs | null; foraDaTroca: number[] }
  | { kind: "parada"; interrompidas: number; nadaRodando: boolean }
  /**
   * `delegada` (ADR-047): resultado de tarefa delegada, não resposta a pergunta; o conteúdo segue não
   * confiável. `falhou`: aviso de que a tarefa não vai terminar. `paradoPelaPessoa` (NOD-311): quem pediu estava parado.
   */
  | { kind: "peer_ask"; agenteId: string; nome: string; naoSupervisionado: true; tarefaId: string; turnoOrigemId?: string; delegada?: true; falhou?: true; trabalhoId?: string; paradoPelaPessoa?: true }
  /** definido em 2026-09-24 (emenda da ADR-037): o aviso ÚNICO de que o computador saiu do ar. NOD-96 PR 5: `acao` = a ação do painel que resolve; `computador_em_operacao` = a pessoa pediu Atualizar/Redefinir/Sair de todos e a tela fechou. NOD-97: a linha cinza de que a pessoa fechou a tela no controle e o computador voltou ao bot. */
  | { kind: "computador_fora_do_ar"; agenteId: string; desde: EpochMs; motivo: MotivoFalhaComputador; acao?: { op: "atualizar" | "tentar_de_novo"; rotulo: string } } | { kind: "computador_em_operacao"; agenteId: string; operacao: "atualizar" | "redefinir" | "sair_de_todos" | "esquecer_senhas" | "trocar" } | { kind: "computador_tela_fechada"; agenteId: string } | { kind: "computador_senha_preenchida"; agenteId: string; origem: string }
  /**
   * definido em 2026-09-24 (emenda da ADR-045): a fala do agente que É a pergunta de pedir_a_pessoa; `opcoes` são as
   * respostas prontas (pedido.ts), e o toque manda o texto da opção como a resposta. revisto em 2026-10-18 (plano "pergunta
   * com botões"): a web desenha um cartão com as opções A a D; `recomendada` é o índice da que o bot recomenda (0: a
   * normalização a põe em primeiro; payload antigo não tem); `ajudaDoComputador`: o pedido de ajuda do computador do bot,
   * que se responde com "Assumir controle", nunca com a mensagem digitada.
   */
  | { kind: "pedido_a_pessoa"; decisaoId: string; opcoes?: string[]; recomendada?: number; ajudaDoComputador?: true }
  /**
   * A resposta da pessoa, ligada à pergunta (responder-decisao.ts): `perguntaEm` rotula "respondendo à pergunta das HH:MM"
   * e `retomada` diz se um turno de retomada nasceu junto; `turnoRetomadaId` (2026-09-24, fio da pergunta) diz QUAL. `via`
   * (2026-10-18): "opcao" quando o texto É uma das opções (espaços e caixa não contam), com o índice em `opcao`; senão
   * "texto". Calculado no servidor, nunca vindo do corpo; sem balão da pergunta (sala esfriada) ou antes de 18/10, sem `via`.
   */
  | { kind: "resposta_a_pedido"; decisaoId: string; agenteId: string; perguntaEm: EpochMs; retomada: boolean; turnoRetomadaId?: string; via?: "opcao" | "texto"; opcao?: number }
  /**
   * definido em 2026-10-18 (ADR-113, Parte 3b): a fala da pessoa que responde a outra (o "Responder" da barra). O servidor
   * recalcula o `trecho` da fala citada (mesma conversa); a entrada e o histórico levam "(respondendo a: «trecho»)".
   */
  | { kind: "resposta_a_fala"; respondeA: { mensagemId: string; trecho: string } }
  /**
   * definido em 2026-09-25 (card de pasta simplificado): o registro de que a pessoa abriu uma pasta
   * para o agente. O card da proposta some ao permitir; esta linha fica na conversa ("acme aberta
   * para o Dev 1 · Trocar"). `onde` é a pasta-mãe relativa à pasta pessoal, quando a busca a deu. `turnoId` (2026-10-18,
   * chat limpo PR 4): o turno que pediu, a âncora do cartão encolhido; as gravadas antes não o têm.
   */
  | { kind: "pasta_aberta"; propostaId: string; agenteId: string; pasta: string; nome: string; onde?: string; turnoId?: string | null }
  /** 2026-09-28 (ADR-051): só ids, o HTML não viaja com a conversa; o canvas (ADA-13, ADR-150) também: ids e contagens. */
  | { kind: "artefato"; artefatoId: string; versao: number; titulo: string } | { kind: "canvas"; canvasId: string; agenteId: string; versao: number; titulo: string; jornadas: number; telas: number; importado: boolean; confiavel?: boolean }
  /** definido em 2026-10-04 (ADR-075): a linha "Chat de voz · mm:ss"; a transcrição vem por GET ligacoes/:id/falas. */
  | PayloadLinhaLigacao
  /**
   * definido em 2026-10-07 (ADR-083): a linha centralizada "Abriu a task <titulo>" na conversa do bot. Mensagem
   * `sistema`; a web abre a tela do trabalho ao clicar.
   */
  | { kind: "trabalho_aberto"; trabalhoId: string; titulo: string; origem: OrigemTrabalho }
  /** definido em 2026-10-12 (ADR-099, I2): a linha única "Começou N frentes: …" do lote que o dono abriu (abrir_frentes). `tituloDoLote` (chat limpo, PR 5, 2026-10-18): resolvido na abertura; ausente nas linhas de antes. */
  | { kind: "frentes_abertas"; loteId: string; origem: OrigemTrabalho; frentes: { trabalhoId: string; titulo: string }[]; tituloDoLote?: string }
  /** definido em 2026-10-12 (ADR-099, I2): a cópia, na conversa do dono, do recado que ele repassou a uma frente. */
  | { kind: "recado_a_frente"; trabalhoId: string; titulo: string }
  /** definido em 2026-10-12 (ADR-099, I3): a linha "3 frentes terminaram" (ou "A frente X terminou", com `avisar_a_cada_uma`) na conversa do dono. */
  | { kind: "frentes_terminadas"; loteId: string; frentes: { trabalhoId: string; titulo: string; estado: EstadoTrabalho }[] }
  /** ADR-099 (I3) e chat limpo (PR 3: `resposta`, `turnoRaizId`): troca-entre-bots.ts. */
  | PayloadPedidoRespondido
  /** Chat limpo, PR 4 (o cartão encolhido): cartao-encolhido.ts. */
  | PayloadRegraPermanente | import("./ferramentas-barra.ts").PayloadAjusteBarra | import("./ferramentas-nao-lidos.ts").PayloadNaoLidosLista | import("./ferramentas-nao-lidos.ts").PayloadReciboLeitura // NOD-119: o card do ajustar_barra_lateral; NOD-449: o card e o recibo do nao_lidos.
  | PayloadPropostaDecidida | { kind: "aviso_pessoa" } | import("./destino-no-chat.ts").PayloadTarefaLinha // NOD-114: a fala `texto` com que o bot avisou a pessoa por conta própria (avisar_pessoa); ADA-28: a linha que aponta para a tarefa.
  | { kind: "turno_preso"; maquinaId: string; /** QA do NOD-314: a IA em que o turno está fixado (harnessFixado); null/ausente = Automático. */ ia?: string | null }; // NOD-314: pendente preso 24 h a uma máquina sem contato saiu da fila.

export type Mensagem = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  turnoId: string | null;
  autoria: Autoria;
  kind: KindMensagem;
  texto: string;
  payload: PayloadMensagem | null;
  confianca: Confianca;
  /** Turno interrompido no meio do streaming deixa a fala parcial marcada (ADR-010). */
  parcial: boolean;
  criadoEm: EpochMs;
  anexos?: AnexoDaConversa[]; // ADR-046 (só metadados); na fala do bot, a captura (NOD-200) e a mídia dele (ADR-126)
  midiaRecusas?: RecusasMidia; // NOD-323: o que o bot não conseguiu anexar (código e contagem), na fala final
  /**
   * definido em 2026-10-07 (ADR-083, épico #188): de onde veio o turno que gravou a mensagem, para a web agrupar sem
   * adivinhar. `origemTurno`: a origem do turno (null = sem turno, como a fala da pessoa); `trabalhoId`: o trabalho do
   * turno (null = turno da conversa); `fimDoTurno`: é a última fala de um turno já encerrado — as outras falas desse
   * turno foram do meio (ADR-067). Ausentes = servidor anterior ao épico.
   */
  origemTurno?: OrigemTurno | null;
  /**
   * definido em 2026-10-12 (ADR-099, I7 revista): o turno de uma retomada leva a raiz da cadeia dele (o turno que ela continua, até 10
   * saltos). A execução de rotina e o pedido de colega não viram mais trabalho: sem a raiz, a resposta da pessoa, a volta marcada e o retorno das frentes saíam da linha agrupada "da rotina" / "Pedido do …".
   */
  raiz?: { turnoId: string; origem: OrigemTurno };
  trabalhoId?: string | null; fimDoTurno?: boolean;
  bastidores?: boolean; turnoDesde?: number; // NOD-402 (ADR-130): gravada por turno dos bastidores da conversa; `turnos.criado_em` (relógio do banco, o das mensagens). Ausentes = não, ou servidor antigo.
  motivoRecomeco?: MotivoRecomeco; // NOD-312: o turno da fala recomeçou sem a sessão. Ausente = normal ou servidor antigo.
  destino?: Destino; tarefa?: import("./destino-no-chat.ts").TarefaDaMensagem; // ADR-114: o destino da tabela DESTINO, resolvido no servidor (só na conversa própria); ADA-28: a tarefa do turno.
  checkpoint?: import("./checkpoint.ts").CheckpointDaFala; // NOD-54 (ADR-134): na fala final do turno que mudou arquivos, o "Desfazer N arquivos" do ⋯. Ausente = sem checkpoint ou vencido.
};
