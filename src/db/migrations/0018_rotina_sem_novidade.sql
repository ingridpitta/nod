-- definido em 2026-09-21: rotina que roda e não encontra novidade fica em SILÊNCIO — nenhuma
-- mensagem na conversa, nem a fala do agente nem o marcador 'Rotina executou em ...'. A pessoa
-- confere no histórico da rotina que ela rodou. Antes disso a única alavanca era
-- rotinas.politica_sem_dado (prosa livre no prompt), e o agente "obedecia" escrevendo um texto
-- educado dizendo que não havia nada: exatamente o flood que esta migração existe para acabar.
--
-- Dois enums:
--   desfecho_rotina += 'sem_novidade'  — consultou a fonte e nada mudou. Não é passou_em_branco
--     (ninguém respondeu o gate) nem falhou (erro técnico): a execução foi completa e correta.
--   motivo_sem_novidade                — por que não rendeu notícia, TIPADO (Regra 9: o sinal vem
--     da ferramenta `sem_novidade`, nunca de regex sobre o texto do modelo).
--
-- BEFORE 'falhou' não é estética: tests/conformidade/motivos-enum.test.ts compara pg_enum com
-- src/contracts/motivos.ts na ORDEM declarada (enumsortorder), e lá sem_novidade vem antes de falhou.
ALTER TYPE desfecho_rotina ADD VALUE IF NOT EXISTS 'sem_novidade' BEFORE 'falhou';

CREATE TYPE motivo_sem_novidade AS ENUM ('nada_mudou', 'fonte_vazia', 'ja_relatado');

-- rotina_execucoes.motivo é text com CHECK '^[a-z_]+$' (0002) e serve os enums de motivo de
-- rotina; os valores novos já passam no CHECK — a coluna não muda.

-- A marca fica no TURNO, como motivo_interrupcao/motivo_falha: a ferramenta `sem_novidade` roda no
-- meio do turno e o assentamento (assentar-turno.ts) precisa ler a decisão depois, na MESMA tx.
-- NULL = o agente não pediu silêncio; qualquer valor = não escreva a fala dele na conversa.
ALTER TABLE turnos ADD COLUMN sem_novidade_motivo motivo_sem_novidade;

-- ROLLBACK: não há DROP VALUE em enum do Postgres. Para reverter:
--   ALTER TABLE turnos DROP COLUMN sem_novidade_motivo;
--   UPDATE rotina_execucoes SET desfecho = 'executou' WHERE desfecho = 'sem_novidade';
--   DROP TYPE IF EXISTS motivo_sem_novidade;
-- e então recrie desfecho_rotina sem o valor e reaplique a coluna. Seguro só enquanto nenhuma
-- execução carregar 'sem_novidade'.
