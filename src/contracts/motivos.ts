// Enum único de motivos (ADR-004): cada união vira `CREATE TYPE ... AS ENUM` na 0002 e tests/conformidade/motivos-enum.test.ts
// (L3) compara pg_enum com estas listas `as const`. Nenhum campo `motivo text` livre existe em trilha/turno/sala.

export const MOTIVOS_PASSE = ["passei_sem_nada_a_dizer", "negado_fail_closed", "ausente_offline", "cota_esgotada"] as const;
export type MotivoPasse = (typeof MOTIVOS_PASSE)[number];

export const MOTIVOS_NEGACAO = [
  "capacidade_desligada",
  "teto_canal",
  "alcance_insuficiente",
  "fora_do_catalogo",
  "plano_ausente",
  "plano_expirado",
  "catalogo_vazio",
  "conector_indisponivel",
  "parada_ativa",
  "args_invalidos",
  "falha_tecnica",
  "timeout_transporte",
] as const;
export type MotivoNegacao = (typeof MOTIVOS_NEGACAO)[number];

export const MOTIVOS_INTERRUPCAO = [
  "parado_pela_pessoa",
  "maquina_sem_contato",
  "reinicio_servidor",
  "sem_progresso",
  "lancamento_falhou",
  "sessao_rejeitada",
  "executor_indisponivel",
  /** 2026-09-18: ficou mudo sem ferramenta pendente e o watchdog encerrou. Ninguém o grava desde 2026-10-01 (ADR-067). */
  "turno_travado",
  /** definido em 2026-09-18: produziu trabalho e não concluiu — não confundir com sem_progresso. */
  "trabalho_incompleto",
  /** definido em 2026-09-24: mensagem da fila lida junto com outra no mesmo turno (`absorvido_por`); nada se perdeu. */
  "absorvido",
  /** 2026-10-15 (NOD-243): turno de rotina pendente, nunca começado, além de max(período, 30 min); a janela seguinte o encerra. */
  "vencido",
  "maquina_removida", // 2026-10-20 (NOD-293 A7, 0099): a pessoa revogou a chave da máquina com o turno rodando; sem "sem contato".
  "reinicio_do_motor", // 2026-10-27 (ADR-131, 0122): o motor parou no meio do turno (atualização, restart, app fechado); é queda.
] as const;
export type MotivoInterrupcao = (typeof MOTIVOS_INTERRUPCAO)[number];

export const MOTIVOS_FALHA = [
  "erro_max_turns",
  "erro_execucao",
  "motor_ausente",
  "nao_autenticado",
  /**
   * definido em 2026-10-06 (NOD-171, 0058): o plano do Claude Code atingiu o limite de uso. Só pelo protocolo:
   * `rate_limit` `rejected` na rodada e `result` com erro. O Codex não informa isso em campo: fica `erro_execucao`, e
   * só a frase muda (src/domain/erro-fornecedor.ts).
   */
  "limite_do_plano",
  /** definido em 2026-10-15 (NOD-269, 0087): no despacho, nenhuma conta da IA livre na máquina; o fundo espera. */
  "sem_conta",
] as const;
export type MotivoFalha = (typeof MOTIVOS_FALHA)[number];

/** Localidade honesta: nesta rodada existe um executor só, na máquina da pessoa (ADR-022, ADR-028). */
export const MOTIVOS_LOCALIDADE = ["tudo_local_nesta_rodada", "motor_ausente"] as const;
export type MotivoLocalidade = (typeof MOTIVOS_LOCALIDADE)[number];

export const DESFECHOS_ITEM = ["executado", "retirado_pela_pessoa", "sensivel_nao_aprovado", "falhou_na_execucao", "ja_executado"] as const;
export type DesfechoItem = (typeof DESFECHOS_ITEM)[number];

/**
 * Por que um item continuou PENDENTE em vez de ser resolvido por regra (ADR-042). NÃO é
 * MotivoNegacao: o item não foi negado, e classificar terminal/transitória (parada-alcada.ts) não
 * faz sentido para ele. ADR-029: regra suspensa em silêncio é negação seca — a pessoa lê o motivo.
 */
export const MOTIVOS_APROVACAO_MANUAL = [
  "sem_regra_permanente",
  "regra_suspensa_conteudo_nao_confiavel",
  "regra_inativa",
  "origem_sensivel",
  "destino_computador",
  "gate_de_rotina",
  "fora_do_catalogo",
  "sem_plano",
  "destino_terminal", // ADR-055 (0034): comando que altera algo no terminal do Mac da pessoa.
  // ADR-059 (0040): o modo automático aprovaria, mas a ação é arriscada (apagar, forçar, merge, publicar).
  "acao_arriscada",
  "toca_credencial", // ADR-059 (0040): o comando toca uma credencial do Mac — pede a pessoa no automático (no total, só a chave do nod; ADR-115).
  // ADR-115 (0093): o revisor do Automático pediu o ok da pessoa; ou não revisou (erro, prazo, teto, sem revisor).
  "revisor_pediu", "revisor_falhou",
] as const;
export type MotivoAprovacaoManual = (typeof MOTIVOS_APROVACAO_MANUAL)[number];

/** Por que uma permissão permanente parou de valer (ADR-042 claim 7). Inativa nunca é apagada. */
export const MOTIVOS_INATIVIDADE_PERMISSAO = ["revogada_pela_pessoa", "concessao_revogada", "conector_desabilitado", "capacidade_fora_do_catalogo", "agente_excluido"] as const;
export type MotivoInatividadePermissao = (typeof MOTIVOS_INATIVIDADE_PERMISSAO)[number];

/**
 * passou_em_branco ≠ falhou: ninguém respondeu o gate não é erro técnico (E7.3).
 * sem_novidade ≠ passou_em_branco: o agente CONSULTOU a fonte e nada mudou — a execução foi
 * completa e correta, só não rendeu notícia. É o único desfecho que não escreve no chat
 * (definido em 2026-09-21): rotina que não tem o que dizer fica em silêncio, e a pessoa confere
 * no histórico da rotina que ela rodou.
 * interrompida ≠ falhou (definido em 2026-09-24, ADR-045): a máquina parou de responder no meio
 * (motivo maquina_sem_contato) — não é erro da rotina nem do agente. Também não escreve no chat: vai
 * para o histórico da rotina e para o aviso único do incidente.
 * bloqueada ≠ falhou (definido em 2026-09-24, emenda da ADR-044): a janela foi reivindicada e NÃO virou
 * turno — o pré-voo viu que falta conexão ou acesso, ou que a pergunta anterior segue sem resposta
 * (MOTIVOS_BLOQUEIO_ROTINA). Nenhum modelo rodou; não escreve no chat: o card de acesso já está lá.
 * adiada (2026-10-15, NOD-243): a execução anterior segue aberta (MOTIVOS_ADIADA); a janela é reivindicada SEM turno
 * e fica no histórico. Não escreve no chat, salvo o aviso único depois de ADIADAS_PARA_AVISAR seguidas.
 * nao_rodou ≠ falhou (2026-10-15, NOD-274, 0087): a cota da IA só volta depois da próxima execução (cota_da_ia, com
 * volta_em); não escreve no chat. revisto em 2026-10-16 (#335): a janela pulada pela execução aberta é 'adiada'.
 */
export const DESFECHOS_ROTINA = ["executou", "passou_em_branco", "sem_novidade", "falhou", "interrompida", "bloqueada", "nao_rodou", "adiada"] as const;
export type DesfechoRotina = (typeof DESFECHOS_ROTINA)[number];

/**
 * Por que a janela ficou 'bloqueada' (definido em 2026-09-24, emenda da ADR-044). Vai em
 * rotina_execucoes.motivo, text com CHECK '^[a-z_]+$' (0002): lista TS, sem enum no banco — o gate
 * motivos-enum não se aplica. sem_conexao: o app está registrado e desligado; sem_acesso: o agente não
 * tem a concessão; aguardando_resposta: a pergunta da execução anterior ainda espera (só no agendador).
 */
export const MOTIVOS_BLOQUEIO_ROTINA = ["sem_conexao", "sem_acesso", "aguardando_resposta"] as const;
export type MotivoBloqueioRotina = (typeof MOTIVOS_BLOQUEIO_ROTINA)[number];

/** Por que a janela ficou 'adiada' (2026-10-15, NOD-243): o turno anterior (ou retomada) vivo, ou uma frente dele viva. */
export const MOTIVOS_ADIADA = ["execucao_anterior_aberta", "frente_aberta"] as const;
export type MotivoAdiada = (typeof MOTIVOS_ADIADA)[number];

/**
 * Por que a execução anterior foi encerrada como 'interrompida' pela agenda ou pela pessoa (definido em 2026-10-15,
 * pacote B2). vencida: pendente nunca começado além de max(período, 30 min) (NOD-243); frente_parada: a frente
 * dela sem turno vivo há mais de 24 h (NOD-243); rotina_pausada: a pessoa pausou com o turno na fila (NOD-272).
 */
export const MOTIVOS_INTERRUPCAO_ROTINA = ["vencida", "frente_parada", "rotina_pausada"] as const;
export type MotivoInterrupcaoRotina = (typeof MOTIVOS_INTERRUPCAO_ROTINA)[number];

/** Por que a janela ficou 'nao_rodou' (NOD-274; NOD-314: preso 24 h à máquina sem contato; NOD-309: toda queda do fundo, domain/espera-no-fundo.ts). Vai em rotina_execucoes.motivo. */
export const MOTIVOS_NAO_RODOU_ROTINA = ["cota_da_ia", "execucao_anterior_aberta", "maquina_sem_contato", "reinicio_servidor", "reinicio_do_motor", "erro_do_provedor", "servidor_nao_respondeu"] as const;
export type MotivoNaoRodouRotina = (typeof MOTIVOS_NAO_RODOU_ROTINA)[number];

/**
 * Por que a execução não rendeu notícia. Campo TIPADO vindo da ferramenta `sem_novidade` —
 * nunca inferido do texto do modelo (Regra 9, domain/rotina-texto.ts). Mesmo precedente do passe.
 */
export const MOTIVOS_SEM_NOVIDADE = ["nada_mudou", "fonte_vazia", "ja_relatado"] as const;
export type MotivoSemNovidade = (typeof MOTIVOS_SEM_NOVIDADE)[number];

/** Código FECHADO de erro de domínio: a mensagem sai de tabela fixa em src/adapters/http/erros.ts (ADR-002/004). */
export const CODIGOS_ERRO = [
  "nao_encontrado",
  "entrada_invalida",
  "escopo_vazio",
  "limite_atingido",
  "nao_permitido",
  "estado_invalido",
  "executor_indisponivel",
  "fuso_invalido",
  "cron_sem_futuro",
  "sala_tamanho",
  "http_toca_dado_pessoal",
  "env_placeholder_chave_nova",
  "dono_imutavel",
  "texto_vazio",
  "conector_indisponivel",
  "integracao_nao_configurada",
  "integracao_autenticacao",
  // ADR-081 (0060): o Nod não se exclui, não se oculta, não se renomeia, não se move nem se duplica.
  "nod_protegido", "mudou_depois", // NOD-58 (0117): desfazer recusado, a memória mudou depois (409).
  "cota_provisorio", "webhook_so_compartilhado", // NOD-408 (0126): cota de turnos do espaço sem conta (429). NOD-84 (0131): webhook no modo local (400).
] as const;
export type CodigoErro = (typeof CODIGOS_ERRO)[number];
/**
 * definido em 2026-09-24 (ADR-037, emenda "saúde do computador"): por que o computador do bot falhou,
 * em código FECHADO — antes tudo virava "computador_indisponivel_ou_tela_alterada". As seis primeiras
 * são a MÁQUINA sem responder e contam para a saúde (src/domain/computador.ts, CONTA_PARA_SAUDE); as
 * três últimas são a AÇÃO que falhou numa máquina que respondeu.
 */
export const MOTIVOS_FALHA_COMPUTADOR = [
  "docker_indisponivel",
  "imagem_ausente",
  "nao_iniciou",
  "cofre_invalido",
  "navegador_nao_abriu",
  "sem_resposta",
  "acao_falhou",
  "tela_alterada",
  "ocupado",
  // NOD-170 (0051): o host já tem o máximo de computadores ligados. Não é a máquina nem a ação: neutro para a saúde.
  "limite_de_computadores",
  // NOD-96 (0106, ADR-122): o computador da pessoa no motor. A máquina escolhida não responde à ponte; a máquina não tem
  // os pacotes do computador (`falta` no anúncio); a máquina não suporta o computador (não é Linux com systemd/bwrap);
  // o supervisor ligou mas não ficou pronto no prazo; uma operação (Atualizar, Redefinir) está em curso.
  "maquina_sem_contato",
  "faltam_pacotes",
  "sem_suporte",
  "nao_ficou_pronto",
  "atualizando",
  // NOD-407 (0129): o app conectado não entende o protocolo atual do computador. Neutro para a saúde.
  "app_desatualizado",
] as const;
export type MotivoFalhaComputador = (typeof MOTIVOS_FALHA_COMPUTADOR)[number];
