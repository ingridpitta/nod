-- definido em 2026-10-18 (plano dos modos de aprovação, PR 3a; ADR-115 proposta): o revisor do Automático novo.
-- estado_decisao += 'em_revisao': a ação arriscada do Automático vira uma decisão que espera o VEREDITO do revisor (na IA
--   da pessoa, rodado pelo laço do turno) em vez da pessoa. Nenhuma lista da tela, nenhuma fila de "Sua vez" e nenhum
--   vencimento olha esse estado (todas filtram 'pendente'/'reaberta'); o hook espera a revisão como espera a pessoa.
-- motivo_aprovacao_manual += 'revisor_pediu', 'revisor_falhou': o cartão que sobra da revisão diz por quê.
-- acoes_pelo_modo: o registro do que o modo decidiu sem a pessoa (a revisão, o veredito, o tempo, as fichas). Texto
--   livre (o resumo da ação e o motivo do revisor) mora aqui, nunca na trilha (CHECK trilha_sem_texto_livre, 0001);
--   apagável por nod_poda, e a dona poda o que passou de 90 dias (varredor de expiração).
-- Os valores novos dos enums só são usados pelo código, nunca nesta transação (como na 0060 e na 0088): nada de índice
--   parcial com 'em_revisao'.
SET LOCAL lock_timeout = '5s';

ALTER TYPE estado_decisao ADD VALUE IF NOT EXISTS 'em_revisao';
ALTER TYPE motivo_aprovacao_manual ADD VALUE IF NOT EXISTS 'revisor_pediu';
ALTER TYPE motivo_aprovacao_manual ADD VALUE IF NOT EXISTS 'revisor_falhou';

CREATE TABLE acoes_pelo_modo (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  turno_id uuid NOT NULL,
  -- Nula no "Ignorar todas" (PR 6): o total não abre decisão.
  decisao_id uuid,
  modo text NOT NULL CONSTRAINT acoes_pelo_modo_modo CHECK (modo IN ('automatico', 'total')),
  tipo text NOT NULL CONSTRAINT acoes_pelo_modo_tipo CHECK (tipo IN ('comando', 'arquivo', 'leitura_credencial', 'app', 'mcp')),
  -- Redigido (redigirSegredos) e cortado pelo repositório; o teto aqui é a segunda camada.
  resumo text NOT NULL CONSTRAINT acoes_pelo_modo_resumo CHECK (char_length(resumo) <= 500),
  gatilho text NOT NULL CONSTRAINT acoes_pelo_modo_gatilho CHECK (gatilho IN ('arriscado', 'envio_apos_fora', 'credencial', 'fora_da_pasta', 'comum')),
  -- Frase fixa do domínio (o porquê de comandoArriscado), nunca texto de modelo.
  risco text CONSTRAINT acoes_pelo_modo_risco CHECK (char_length(risco) <= 200),
  -- Nulo enquanto a revisão está em voo e no "Ignorar todas".
  veredito text CONSTRAINT acoes_pelo_modo_veredito CHECK (veredito IN ('libera', 'pede', 'falhou', 'nao_revisado')),
  falha text CONSTRAINT acoes_pelo_modo_falha CHECK (falha ~ '^[a-z_]{1,32}$'),
  -- O motivo do revisor (texto de modelo) já cortado em 160 pelo servidor, ou a frase fixa da falha.
  motivo text CONSTRAINT acoes_pelo_modo_motivo CHECK (char_length(motivo) <= 160),
  revisor_modelo text CONSTRAINT acoes_pelo_modo_revisor_modelo CHECK (char_length(revisor_modelo) <= 80),
  revisor_harness text CONSTRAINT acoes_pelo_modo_revisor_harness CHECK (char_length(revisor_harness) <= 32),
  -- A máquina a que o pedido foi; nula quando não foi a nenhuma (cartão direto na fase 1). O teto do turno e o do dia
  -- contam as linhas com máquina.
  revisor_maquina text CONSTRAINT acoes_pelo_modo_revisor_maquina CHECK (char_length(revisor_maquina) <= 128),
  -- Quando a renovação entregou o pedido à máquina: separa o atraso da batida do tempo do CLI.
  entregue_em timestamptz,
  revisor_ms integer CONSTRAINT acoes_pelo_modo_revisor_ms CHECK (revisor_ms >= 0),
  fichas_entrada integer CONSTRAINT acoes_pelo_modo_fichas_entrada CHECK (fichas_entrada >= 0),
  fichas_saida integer CONSTRAINT acoes_pelo_modo_fichas_saida CHECK (fichas_saida >= 0),
  desfecho_pessoa text CONSTRAINT acoes_pelo_modo_desfecho_pessoa CHECK (desfecho_pessoa IN ('aprovou', 'negou', 'venceu')),
  contestada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('acoes_pelo_modo');
ALTER TABLE acoes_pelo_modo ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE acoes_pelo_modo ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
ALTER TABLE acoes_pelo_modo ADD FOREIGN KEY (tenant_id, decisao_id) REFERENCES decisoes (tenant_id, id);
-- Uma linha por decisão: a fase 3 e o desfecho da pessoa acham a linha pela decisão.
CREATE UNIQUE INDEX acoes_pelo_modo_por_decisao ON acoes_pelo_modo (tenant_id, decisao_id) WHERE decisao_id IS NOT NULL;
-- A Atividade do bot (PR 4) e as linhas do revisor na conversa (acoesDoModo por turno).
CREATE INDEX acoes_pelo_modo_atividade ON acoes_pelo_modo (tenant_id, agente_id, criado_em);
CREATE INDEX acoes_pelo_modo_por_turno ON acoes_pelo_modo (tenant_id, turno_id);
-- O teto de revisões por pessoa por dia e a poda de 90 dias, pela dona.
CREATE INDEX acoes_pelo_modo_por_dona ON acoes_pelo_modo (tenant_id, owner_id, criado_em);
GRANT SELECT, DELETE ON acoes_pelo_modo TO nod_poda;

-- ROLLBACK:
-- -- Runbook (plano, revisão de engenharia 8): desligue NOD_REVISOR e espere 3 min (o varredor vira as decisões
-- -- 'em_revisao' em cartão). Isso basta para reverter só o código: o servidor antigo lê e decide os cartões 'revisor_*'
-- -- (QA do PR 403). Para reverter o banco, os cartões que ficaram ainda usam os valores novos: antes do bloco, rode
-- -- `update itens_aprovacao set motivo_manual = 'acao_arriscada' where motivo_manual in ('revisor_pediu', 'revisor_falhou')`
-- -- (e `update decisoes set estado = 'pendente' where estado = 'em_revisao'`, se sobrou alguma) como superusuário: o
-- -- nod_dono passa pelo FORCE ROW LEVEL SECURITY sem política e o update dele muda 0 linhas. Com alguma linha usando um
-- -- valor novo, o cast falha e a transação inteira volta (nada é apagado aqui). Rode o bloco numa transação só
-- -- (`psql -1 -v ON_ERROR_STOP=1`).
-- DROP TABLE acoes_pelo_modo;
-- ALTER TABLE decisoes ALTER COLUMN estado DROP DEFAULT;
-- ALTER TYPE estado_decisao RENAME TO estado_decisao_0093;
-- CREATE TYPE estado_decisao AS ENUM ('pendente', 'decidida', 'vencida', 'reaberta');
-- ALTER TABLE decisoes ALTER COLUMN estado TYPE estado_decisao USING estado::text::estado_decisao;
-- ALTER TABLE decisoes ALTER COLUMN estado SET DEFAULT 'pendente';
-- DROP TYPE estado_decisao_0093;
-- ALTER TYPE motivo_aprovacao_manual RENAME TO motivo_aprovacao_manual_0093;
-- CREATE TYPE motivo_aprovacao_manual AS ENUM ('sem_regra_permanente', 'regra_suspensa_conteudo_nao_confiavel', 'regra_inativa',
--   'origem_sensivel', 'destino_computador', 'gate_de_rotina', 'fora_do_catalogo', 'sem_plano', 'destino_terminal',
--   'acao_arriscada', 'toca_credencial');
-- ALTER TABLE itens_aprovacao ALTER COLUMN motivo_manual TYPE motivo_aprovacao_manual USING motivo_manual::text::motivo_aprovacao_manual;
-- DROP TYPE motivo_aprovacao_manual_0093;
