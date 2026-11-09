-- definido em 2026-10-12 (ADR-099, parte 2): `esperar_comando`. Em 11/10, 11 tasks do Ze 1 esperavam a mesma CI do GitHub
-- acordando por horário (`me_chame_as`), checando e dormindo de novo: 67 voltas e cerca de US$ 114, nenhuma com novidade.
-- Aqui o bot pede ao Nod para rodar um comando que só termina quando a espera acaba (`gh pr checks 845 --watch`); o
-- motor da máquina do turno o roda FORA do CLI, em grupo próprio (ADR-089), e o fim enfileira a retomada do turno de
-- origem pelo caminho da volta marcada (ADR-086), com o código de saída e as últimas linhas.
--
-- Uma linha por pedido, um pedido por turno (`esperas_por_turno`). `maquina_id` é a do turno de origem (a chave da
-- máquina, ADR-031) e, como em 0066, sem FK: a chave pode ser revogada. `pasta` é relativa a `~/nod` (a `pastaDoBot` do
-- plano). `visto_em` é o último `puxar` das esperas pela máquina: sem notícia por muito tempo, o varredor a dá por caída.
-- `quedas` conta as vezes que o motor teve de relançar o comando (a máquina reiniciou no meio). `acordou_em` marca que
-- a retomada já nasceu (o fim antes de o turno de origem terminar espera o assentamento dele).
-- Só adição (expand-only): tabela nova, que o código anterior não lê.
SET LOCAL lock_timeout = '5s';
CREATE TABLE esperas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  trabalho_id uuid,
  turno_id uuid NOT NULL,
  maquina_id uuid NOT NULL,
  pasta text,
  comando text NOT NULL,
  motivo text NOT NULL,
  estado text NOT NULL DEFAULT 'rodando',
  codigo_saida integer,
  saida text,
  motivo_fim text,
  quedas integer NOT NULL DEFAULT 0,
  iniciada_em timestamptz,
  visto_em timestamptz,
  acordou_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  terminado_em timestamptz,
  CONSTRAINT espera_estado CHECK (estado IN ('rodando', 'terminou', 'caiu', 'cancelada')),
  CONSTRAINT espera_comando CHECK (char_length(comando) BETWEEN 1 AND 4000),
  CONSTRAINT espera_motivo CHECK (char_length(motivo) BETWEEN 1 AND 300),
  CONSTRAINT espera_pasta CHECK (pasta IS NULL OR char_length(pasta) <= 300),
  -- definido em 2026-10-12: as últimas linhas da saída, até 4 KB — o bastante para dizer o que falhou numa CI.
  CONSTRAINT espera_saida CHECK (saida IS NULL OR char_length(saida) <= 4096),
  CONSTRAINT espera_motivo_fim CHECK (motivo_fim IS NULL OR char_length(motivo_fim) <= 300),
  CONSTRAINT espera_quedas CHECK (quedas >= 0),
  CONSTRAINT espera_terminada CHECK ((estado <> 'rodando') = (terminado_em IS NOT NULL))
);
SELECT nod_escopar_tabela('esperas');
ALTER TABLE esperas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE esperas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE esperas ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE esperas ADD FOREIGN KEY (tenant_id, trabalho_id) REFERENCES trabalhos (tenant_id, id);
ALTER TABLE esperas ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
-- Um pedido por turno: a segunda chamada no mesmo turno é recusada com instrução.
CREATE UNIQUE INDEX esperas_por_turno ON esperas (tenant_id, turno_id);
-- O que cada máquina deve estar rodando (o puxar das esperas, a cada 5 s) e o varredor das sem notícia.
CREATE INDEX esperas_rodando_por_maquina ON esperas (tenant_id, maquina_id) WHERE estado = 'rodando';
-- O estado do trabalho (`fatos`) e o Parar da task e da conversa leem as que rodam por trabalho e por conversa.
CREATE INDEX esperas_rodando_por_trabalho ON esperas (tenant_id, trabalho_id) WHERE estado = 'rodando' AND trabalho_id IS NOT NULL;
CREATE INDEX esperas_rodando_por_conversa ON esperas (tenant_id, conversa_id) WHERE estado = 'rodando';

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. As esperas que estavam rodando ficam sem dono (o motor
-- -- antigo não as puxa) e somem com o DROP; os bots que esperavam não acordam e a pessoa os chama de novo.
-- DROP INDEX esperas_rodando_por_conversa;
-- DROP INDEX esperas_rodando_por_trabalho;
-- DROP INDEX esperas_rodando_por_maquina;
-- DROP INDEX esperas_por_turno;
-- DROP TABLE esperas;
