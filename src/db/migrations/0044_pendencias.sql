-- definido em 2026-09-30 (ADR-064): pendências do bot — o que ele deixou para depois não morre com o turno.
--
-- Medido no mesmo dia no banco diário: às 14:46 o Chico escreveu "passo o repo ao Dev 1 assim que o canal
-- voltar" e isso só aconteceu às 15:06, porque o Marlon perguntou; às 15:48 prometeu repassar a task ao Dev 2
-- "quando voltar" e a rotina das 15:50, com a ferramenta na mão, respondeu "não repeti nada". Só a espera pela
-- pessoa (acesso, aprovação, pergunta) sobrevivia ao fim do turno; o resto virava texto.
--
-- A pendência é do bot e mora na conversa própria dele. Sem alarme: `a_partir_de` só decide quando ela passa a
-- aparecer para o bot, no próximo turno que a pessoa ou uma rotina abrir. `cuidado` marca a que foi anotada num
-- turno que leu conteúdo de fora ou teve entrada não confiável: o bot confere na fonte antes de agir por ela.
CREATE TABLE pendencias (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  turno_id uuid,
  texto text NOT NULL,
  a_partir_de timestamptz,
  cuidado boolean NOT NULL DEFAULT false,
  profundidade smallint NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'aberta',
  resolvida_em timestamptz,
  resolvida_por text,
  resolvida_no_turno_id uuid,
  motivo text,
  pedida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT pendencia_texto CHECK (char_length(texto) BETWEEN 1 AND 500),
  CONSTRAINT pendencia_motivo CHECK (motivo IS NULL OR char_length(motivo) <= 500),
  CONSTRAINT pendencia_estado CHECK (estado IN ('aberta', 'feita', 'descartada')),
  CONSTRAINT pendencia_resolvida_por CHECK (resolvida_por IS NULL OR resolvida_por IN ('bot', 'pessoa')),
  CONSTRAINT pendencia_resolvida CHECK ((estado = 'aberta') = (resolvida_em IS NULL) AND (estado = 'aberta') = (resolvida_por IS NULL)),
  CONSTRAINT pendencia_profundidade CHECK (profundidade BETWEEN 0 AND 3)
);
SELECT nod_escopar_tabela('pendencias');
ALTER TABLE pendencias ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
-- O turno é o registro de quem anotou e de quem resolveu, não dono da pendência: apagar o turno não a apaga.
ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (turno_id);
ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, resolvida_no_turno_id) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (resolvida_no_turno_id);
CREATE INDEX pendencias_abertas_por_agente ON pendencias (tenant_id, agente_id, criado_em) WHERE estado = 'aberta';
CREATE INDEX pendencias_por_turno_que_resolveu ON pendencias (tenant_id, resolvida_no_turno_id) WHERE resolvida_no_turno_id IS NOT NULL;

-- ROLLBACK:
-- DROP TABLE pendencias;
