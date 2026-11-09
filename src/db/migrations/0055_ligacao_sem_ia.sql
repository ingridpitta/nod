-- definido em 2026-10-05 (rede de segurança da ligação, emenda da ADR-072): a IA do Mac pode cair com a ligação em
-- curso (medido em produção no mesmo dia: a conta do Claude Code estava logada e sem acesso, o turno-cérebro falhou em
-- segundos e a pessoa falou 4 vezes em 30 s sem resposta). Agora a ligação avisa, espera a escolha da pessoa e, sem
-- escolha em 2 min, encerra com um motivo próprio.
--
-- `ligacoes.motivo_fim` é text com CHECK (0048), não enum: o CHECK é refeito com o valor novo no fim da lista, na
-- mesma ordem de MOTIVOS_FIM_LIGACAO (src/contracts/voz.ts). Só adição: o código anterior nunca grava 'sem_ia', então
-- esta migração pode entrar antes do código novo.
ALTER TABLE ligacoes DROP CONSTRAINT ligacao_motivo_fim;
ALTER TABLE ligacoes ADD CONSTRAINT ligacao_motivo_fim CHECK (motivo_fim IS NULL OR motivo_fim IN (
  'pessoa_desligou', 'bot_desligou', 'tempo_maximo', 'limite_diario', 'cerebro_caiu', 'midia_caiu',
  'reinicio_servidor', 'drenagem', 'nao_atendida', 'recusada', 'voz_indisponivel', 'ociosidade', 'limite_da_assinatura', 'erro',
  'sem_ia'
));

-- ROLLBACK (o UPDATE roda como postgres: com FORCE ROW LEVEL SECURITY o nod_dono não enxerga as linhas):
-- UPDATE ligacoes SET motivo_fim = 'cerebro_caiu' WHERE motivo_fim = 'sem_ia';
-- ALTER TABLE ligacoes DROP CONSTRAINT ligacao_motivo_fim;
-- ALTER TABLE ligacoes ADD CONSTRAINT ligacao_motivo_fim CHECK (motivo_fim IS NULL OR motivo_fim IN (
--   'pessoa_desligou', 'bot_desligou', 'tempo_maximo', 'limite_diario', 'cerebro_caiu', 'midia_caiu',
--   'reinicio_servidor', 'drenagem', 'nao_atendida', 'recusada', 'voz_indisponivel', 'ociosidade', 'limite_da_assinatura', 'erro'
-- ));
