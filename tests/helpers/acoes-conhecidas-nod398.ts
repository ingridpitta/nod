/**
 * Revisão 13 do #590: as ações do registro quando a NOD-398 entrou (134, travado por teste). No PR (N=20) o teto das
 * ações só 404/403/401/429 reprova só as FORA desta lista (ações novas) que em nenhum servidor passaram da busca; as desta
 * lista oscilam com a amostra e só reprovam no noturno (N >= 100). Não acrescente ações aqui: ficar fora é o que mantém a
 * nova sob a regra do PR. Limites: a regra depende da amostra (uma ação nova que busca antes de validar pode oscilar) e
 * um 400/409 antes da busca conta como leitura.
 */
export const ACOES_CONHECIDAS_NOD398: ReadonlySet<string> = new Set([
  "acessos.conceder", "acessos.dar", "acessos.dispensar", "acessos.liberar", "acessos.revogar", "apps.conectar",
  "apps.configurar_marketplace", "apps.credenciais", "apps.criar", "apps.desabilitar", "apps.github_app",
  "apps.github_token", "apps.habilitar", "apps.sondar", "apps.verificar", "artefatos.salvar_estado",
  "bots.cobrar_colega", "bots.criar", "bots.decidir_troca_de_ia", "bots.definir_inteligencia", "bots.duplicar",
  "bots.editar", "bots.excluir", "bots.fixar", "bots.mover", "bots.mudar_modo", "bots.mudar_voz", "bots.ocultar",
  "bots.restaurar", "cartoes.confirmar_proposta", "cartoes.decidir", "cartoes.dispensar",
  "cartoes.guardar_credencial", "cartoes.permitir_pasta", "cartoes.reabrir", "cartoes.recusar_proposta",
  "cartoes.responder", "computador.operar", "computador.operar_do_bot", "computador.trocar_lugar",
  "computador.usar_tela", "conta.editar_perfil", "conta.entrar", "conta.excluir", "conta.exportar",
  "conta.parear_aparelho", "conta.remover_google", "conta.sair_das_outras", "conta.trocar_email",
  "conta.trocar_senha", "contas_ia.cancelar_login", "contas_ia.codigo_do_login", "contas_ia.editar",
  "contas_ia.entrar", "contas_ia.mudar_modo", "contas_ia.ordenar", "contas_ia.remover", "contas_ia.sair",
  "contas_ia.seguir", "contas_ia.tentar_de_novo", "contas_ia.trocar_executor", "conversas.anexar",
  "conversas.criar_pasta", "conversas.definir_pasta", "conversas.desfazer_turno", "conversas.enviar",
  "conversas.marcar_lida", "conversas.marcar_nao_lida", "conversas.marcar_tudo_lido", "conversas.nova_sessao",
  "conversas.parar", "conversas.parar_tudo", "conversas.reagir", "conversas.tirar_pasta", "incidentes.dispensar",
  "maquinas.aprovar_dispositivo", "maquinas.atualizar_ia", "maquinas.cancelar_ssh", "maquinas.confiar_ssh",
  "maquinas.convidar", "maquinas.credencial_ssh", "maquinas.criar_chave", "maquinas.definir_bots",
  "maquinas.definir_padrao", "maquinas.desconectar", "maquinas.editar", "maquinas.escolher_do_bot",
  "maquinas.instalar_ssh", "maquinas.parear", "maquinas.revogar_chave", "maquinas.rodar_desta_vez", "memoria.apagar",
  "memoria.criar", "memoria.desfazer_diario", "memoria.editar", "memoria.revisar_diario", "modo.contestar",
  "nuvem.acordar", "nuvem.conectar_google", "nuvem.criar_maquina", "nuvem.dormir", "nuvem.dormir_apos",
  "nuvem.excluir_maquina", "onboarding.bot", "onboarding.concluir", "onboarding.etapa", "onboarding.rotina",
  "preferencias.fechar_aviso", "preferencias.salvar", "relatos.registrar", "rotinas.ativar", "rotinas.criar",
  "rotinas.executar", "rotinas.mudar_ritmo", "rotinas.pausar", "salas.adicionar_membro", "salas.criar",
  "salas.enviar", "salas.parar", "tela.capturar", "telemetria.registrar", "trabalhos.depois", "trabalhos.enviar",
  "trabalhos.fazer_aqui", "trabalhos.parar", "turnos.cancelar", "turnos.retomar", "turnos.retomar_decisao",
  "voz.apagar_falas", "voz.avaliar", "voz.consentir", "voz.continuar", "voz.encerrar", "voz.ligar",
]);
