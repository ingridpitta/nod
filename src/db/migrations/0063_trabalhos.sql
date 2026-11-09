-- definido em 2026-10-07 (ADR-083, épico #188, issue #192): trabalhos em paralelo — a conversa coordena, cada trabalho
-- longo roda à parte, com sessão do CLI e pasta próprias.
--
-- Medido no diário, 7 dias até 07/10: pedido de colega dura 73 min no p90 (até 7 h) e rotina chega a 16 h. Pela regra
-- de um turno por bot (ADR-010, emenda 13), esse trabalho segurava a conversa: 16 de 38 mensagens da pessoa esperaram
-- mais de 5 min, uma esperou 71 min. Aqui o turno ganha `trabalho_id`, e a faixa do `reivindicar` passa a ser
-- coalesce(trabalho_id, conversa_id) (turnos.repo.ts).
--
-- O nome é `trabalho`, não `tarefa`: `tarefaId` já é o id do turno delegado, `iniciar_tarefa` é da ligação e
-- `turno.tarefas` é a lista do TaskCreate. Na tela é a "task". Só adição (expand-only): o código anterior roda sobre
-- este schema (coluna nula em turnos, tabela nova que ele não lê).
CREATE TABLE trabalhos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  titulo text NOT NULL,
  origem text NOT NULL,
  pedido_por_agente_id uuid,
  rotina_id uuid,
  trabalho_mae_id uuid,
  depois_de_trabalho_id uuid,
  estado text NOT NULL DEFAULT 'na_fila',
  sessao_cli text,
  sessao_harness text,
  -- definido em 2026-10-08 (revisão do épico, S14): o executor que criou a sessão, como conversas.sessao_executor (0005):
  -- o --resume do trabalho só vale para o mesmo executor (o catcher não retoma a sessão de um CLI real, nem o contrário).
  sessao_executor text,
  pasta text,
  memoria_mb integer,
  custo_usd numeric(12, 6),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  iniciado_em timestamptz,
  terminado_em timestamptz,
  CONSTRAINT trabalho_titulo CHECK (char_length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT trabalho_origem CHECK (origem IN ('pessoa', 'rotina', 'colega', 'rede')),
  CONSTRAINT trabalho_estado CHECK (estado IN ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso', 'terminado', 'parado', 'falhou')),
  CONSTRAINT trabalho_sessao_executor CHECK (sessao_executor IS NULL OR sessao_executor IN ('local', 'catcher')),
  CONSTRAINT trabalho_pasta CHECK (pasta IS NULL OR char_length(pasta) <= 300),
  CONSTRAINT trabalho_memoria CHECK (memoria_mb IS NULL OR memoria_mb >= 0),
  -- Um trabalho não espera a si mesmo nem é mãe de si mesmo (o ciclo maior o caso de uso recusa).
  CONSTRAINT trabalho_depois_de_outro CHECK (depois_de_trabalho_id IS NULL OR depois_de_trabalho_id <> id),
  CONSTRAINT trabalho_mae_outro CHECK (trabalho_mae_id IS NULL OR trabalho_mae_id <> id),
  CONSTRAINT trabalho_terminado CHECK ((estado IN ('terminado', 'parado', 'falhou')) = (terminado_em IS NOT NULL))
);
SELECT nod_escopar_tabela('trabalhos');
ALTER TABLE trabalhos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, pedido_por_agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, trabalho_mae_id) REFERENCES trabalhos (tenant_id, id);
ALTER TABLE trabalhos ADD FOREIGN KEY (tenant_id, depois_de_trabalho_id) REFERENCES trabalhos (tenant_id, id);
-- Os abertos do bot: a faixa, o chip da barra e a seção "Trabalhos em andamento" do prompt leem por aqui.
CREATE INDEX trabalhos_abertos_por_agente ON trabalhos (tenant_id, agente_id) WHERE estado IN ('na_fila', 'rodando', 'precisa_de_voce', 'fechado_ocioso');
-- "Terminados hoje" e a rede de 2 min (o trabalho `rede` da conversa) leem pela conversa.
CREATE INDEX trabalhos_por_conversa ON trabalhos (tenant_id, conversa_id, criado_em);
-- definido em 2026-10-08 (revisão do épico, S23): GET trabalhos sem agenteId lê os abertos (o índice acima pelo prefixo
-- tenant_id) OU os terminados desde ontem — este; sem ele a perna do OR varria a tabela.
CREATE INDEX trabalhos_terminados ON trabalhos (tenant_id, terminado_em) WHERE terminado_em IS NOT NULL;
-- definido em 2026-10-08 (revisão do épico, S23): o estado do trabalho (`fatos`) junta as decisões pelos turnos dele, e
-- decisoes.doTurno já lia por turno_id sem índice nenhum (só decisor e fio tinham).
CREATE INDEX IF NOT EXISTS decisoes_por_turno ON decisoes (tenant_id, turno_id) WHERE turno_id IS NOT NULL;

-- O turno do trabalho. Nulo = turno da conversa (a faixa é a conversa, como antes).
ALTER TABLE turnos ADD COLUMN trabalho_id uuid;
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, trabalho_id) REFERENCES trabalhos (tenant_id, id);
-- O `not exists` do reivindicar por trabalho (a mesma forma do índice por conversa da 0042).
CREATE INDEX turnos_trabalho_despachando ON turnos (tenant_id, trabalho_id) WHERE estado = 'despachando';
-- As mensagens de um trabalho saem dos turnos dele (GET trabalhos/:id).
CREATE INDEX turnos_por_trabalho ON turnos (tenant_id, trabalho_id, criado_em) WHERE trabalho_id IS NOT NULL;
-- A fala da pessoa mandada a uma task é do trabalho do turno que ela abriu (a leitura da conversa marca `trabalhoId`).
CREATE INDEX turnos_por_mensagem_origem ON turnos (tenant_id, mensagem_origem_id) WHERE mensagem_origem_id IS NOT NULL;

-- A faixa de Trabalhos em cima do campo recolhida numa pílula (reversível, por pessoa; a 0036 já escopa a tabela).
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS faixa_trabalhos_recolhida boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- DROP INDEX decisoes_por_turno;
-- DROP INDEX trabalhos_terminados;
-- ALTER TABLE preferencias DROP COLUMN faixa_trabalhos_recolhida;
-- DROP INDEX turnos_por_mensagem_origem;
-- DROP INDEX turnos_por_trabalho;
-- DROP INDEX turnos_trabalho_despachando;
-- ALTER TABLE turnos DROP COLUMN trabalho_id;
-- DROP TABLE trabalhos;
