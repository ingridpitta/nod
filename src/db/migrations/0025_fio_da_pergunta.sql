-- definido em 2026-09-24 (emenda da ADR-045, fio da pergunta): a pergunta de pedir_a_pessoa é um FIO
-- que fica aberto enquanto o agente ainda precisa da pessoa. A pessoa pede explicação em vez de
-- responder, o agente explica e pergunta de novo: a pergunta nova é outra decisão (prazo e opções
-- próprios), mas do MESMO fio. `fio_id` aponta a primeira decisão do fio; NULL = a decisão começa o
-- próprio fio (toda decisão anterior a esta migração, e toda que não seja rodada seguinte). Sem backfill.
--
-- Coluna nova nasce TRAVADA para a decisora (0003: a lista de colunas livres não a nomeia) — só a dona
-- grava, e só no INSERT de pedir_a_pessoa.
ALTER TABLE decisoes ADD COLUMN fio_id uuid;

-- A conversa e "Sua vez" leem o fio inteiro pelos ids das raízes (decisoesRepo.dosFios).
CREATE INDEX decisoes_por_fio ON decisoes (tenant_id, fio_id) WHERE fio_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX decisoes_por_fio;
-- ALTER TABLE decisoes DROP COLUMN fio_id;
