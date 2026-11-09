/**
 * O assunto de cada item da conversa e para onde ele vai (definido em 2026-10-18, plano do chat limpo, PR 1; ADR-114).
 *
 * `mensagens.assunto` (0091) guarda o que a mensagem é. A tabela `DESTINO` (src/domain/destino-no-chat.ts, só no
 * servidor) diz para onde cada assunto vai; a web recebe o destino pronto no DTO (`Mensagem.destino`) e nunca importa a
 * tabela (ADR-018). Mudar uma regra é mudar a tabela, sem regravar o banco. `null` em `assunto` é fala ou linha antiga
 * sem backfill: fica no chat.
 *
 * Os grupos abaixo são só leitura: o destino de cada um está na tabela, não no nome.
 */
export const ASSUNTOS = [
  // Falas entre bots e o que a pessoa entregou ou decidiu (chat).
  "colega.handoff",
  "colega.pedido",
  "colega.resposta",
  "acesso.concedido",
  "acesso.revogado",
  "acesso.pasta",
  "aprovacao.recibo",
  "aprovacao.automatica_falhou",
  // O aviso do deploy do PR 6 dos modos de aprovação: o "Ignorar todas" passou a usar as credenciais (uma vez por bot).
  "aprovacao.total_credenciais",
  "proposta.obsoleta",
  "proposta.resultado",
  "artefato",
  "ligacao",
  "sessao.nova",
  "sala.evento",
  // Rotinas: criar, mudar, pausar, apagar e a falha (chat); a execução sem nada para a pessoa (Atividade).
  "rotina.evento",
  "rotina.falhou",
  "rotina.adiada",
  "rotina.execucao",
  // O bot e o turno.
  "agente.criado",
  "bot.criado",
  "turno.orfao",
  "turno.falhou",
  "turno.interrompido",
  "turno.queda_da_maquina",
  "turno.retomado",
  "lote.retorno_caiu",
  "passe",
  "parada",
  // Negações.
  "negacao.ferramenta",
  "negacao.conector",
  "negacao.terminal",
  "negacao.plano_ausente",
  // IA, contas e cota.
  "ia.trocada",
  "ia.troca",
  "ia.limite_do_plano",
  "ia.fala_espera",
  "conta.trocada",
  "conta.seguiu",
  "conta.escolhida",
  "conta.nota",
  "conta.recusada",
  "cota.pedido_na_fila",
  "cota.espera",
  // NOD-309: o fundo que espera por outra queda (erro do provedor, máquina, reinício) e volta sozinho.
  "fundo.espera",
  "computador.fora_do_ar",
  "computador.em_operacao",
  // NOD-97: a pessoa fechou a tela no controle e o bot voltou a usar o computador.
  "computador.tela_fechada",
  // NOD-97 PR 5: o Chrome preencheu uma senha salva; o bot não vê o que está escrito.
  "computador.senha_preenchida",
  // Frentes e tasks: a web precisa delas na janela para desenhar outra coisa (anexo).
  "trabalho.aberto",
  "frentes.abertas",
  "frentes.terminadas",
  "frentes.recado",
  "pedido.respondido",
  // NOD-114: o bot avisou a pessoa por conta própria (avisar_pessoa); o desktop e o navegador mostram o aviso.
  "aviso.pessoa",
  // NOD-119: o card que pergunta se muda a barra lateral (ajustar_barra_lateral); a pessoa confirma nele.
  "barra.ajuste",
  "canvas",
  // NOD-449: o card com a lista de não lidos e o recibo de "marcadas como lidas" (nao_lidos); a pessoa age neles.
  "leitura.lista",
  "leitura.recibo",
  // NOD-437: o recibo do gerir_times (o que mudou nos times e quem pediu por qual bot).
  "times.organizados",
  // ADA-28 (ADR-159): a linha do chat que aponta para a tarefa ("ADA-28 precisa de você · abrir", "Faustino terminou ADA-28").
  "tarefa.precisa",
  "tarefa.resultado",
  // ADA-28 (ADR-159): a variante de bastidor (turno de tarefa, rotina, colega ou procuração) do que fica no chat quando o
  // turno é da conversa. A troca acontece na gravação (`seBastidor`), então linha antiga não muda de lugar (S6).
  "bastidor.turno_falhou",
  "bastidor.turno_orfao",
  "bastidor.lote_retorno_caiu",
  "bastidor.negacao_terminal",
  "bastidor.aprovacao_recibo",
  // ADA-241: o recibo do gerir_acessos (quem ficou com qual nível no app e quem pediu por qual bot).
  "acessos.mudados",
  // O resto do que o sistema escreve (Atividade).
  "memoria.anotada",
  "memoria.task_fechada",
  "compactacao",
  // NOD-54 (ADR-134): a linha que o bot lê no próximo turno ("Desfeito: N arquivos voltaram"); a pessoa vê o resultado na própria fala.
  "arquivos.desfeitos",
  "proposta.decidida",
  "inteligencia",
  "aprovacao.modo",
  "aprovacao.automatica",
  "acesso.automatico",
  "decisao.vencida",
  "sistema.generico",
] as const;

export type Assunto = (typeof ASSUNTOS)[number];

/**
 * `chat`: vira linha no chat. `anexo` (revisão de 18/10): não vira linha, mas a web precisa dele na janela para desenhar
 * outra coisa (o título e a origem das tasks, a âncora das frentes, a troca entre bots). `atividade`: sai do chat e
 * mora na Atividade do bot.
 */
export type Destino = "chat" | "anexo" | "atividade";

/**
 * O filtro da Atividade. Item sem categoria só aparece em "Tudo". `sem_aprovacao` (PR 6 dos modos de aprovação): o que o
 * modo rodou sem a pessoa — o terminal e os arquivos (`acoes_pelo_modo`) e os apps e acessos aprovados pelo modo.
 */
export type CategoriaDaAtividade = "sem_aprovacao" | "frentes" | "bloqueios" | "maquina_ia";

export type RegraDeDestino = {
  destino: Destino;
  categoria: CategoriaDaAtividade | null;
  /**
   * Destino que muda com o tempo (limite do plano, troca de IA, computador fora do ar, IA ausente): a tabela os marca
   * `chat`, a web os esconde quando deixam de valer, e a Atividade os lista sempre.
   */
  temporal?: true;
  /**
   * ADA-28 (ADR-159): o assunto que a linha grava quando o turno é de bastidor (`turnos.bastidores`, ADR-130) e a flag
   * `NOD_TAREFA_CASA` está ligada. A falha do turno da pessoa continua no chat; a do turno de tarefa ou rotina vai para a
   * Atividade. Decide-se na gravação, não na leitura, porque as listas por destino (ASSUNTOS_ANEXO/ATIVIDADE) são fixas.
   */
  seBastidor?: Assunto;
};

/**
 * ADA-28 (ADR-159): a linha do chat que aponta para a tarefa — `precisa` ("ADA-28 precisa de você · abrir") ou `resultado`
 * ("Faustino terminou ADA-28 · abrir"). Só ids e o código: o título e o estado vêm da tarefa ao abrir; tarefa removida
 * vira "ADA-28 (removida)" (U7).
 */
export type PayloadTarefaLinha = { kind: "tarefa_linha"; motivo: "precisa" | "resultado"; tarefaId: string; quadroId: string; codigo: string; agenteId: string };

/**
 * ADA-28 (ADR-159): a mensagem foi gravada num turno de tarefa (a cadeia chega a `quadro_execucoes`, ou a frente leva o
 * `tarefa_id`). A web a tira da timeline do chat; o que a pessoa vê é a linha `tarefa.*`. Só com NOD_TAREFA_CASA=1.
 */
export type TarefaDaMensagem = { id: string; codigo: string; quadroId: string };
