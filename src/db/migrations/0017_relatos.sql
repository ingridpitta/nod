-- definido em 2026-09-21 (ADR-041): a pessoa aponta uma mensagem e diz que o comportamento não foi o
-- desejado. O valor está nos METADADOS, não na prosa: tudo que explica "por que aconteceu" já existe
-- tipado em turnos/mensagens e é copiado para cá no instante do envio.
--
-- A forma copia a trilha do ADR-004: metadados tipados numa tabela, prosa em tabela irmã APAGÁVEL por
-- nod_poda. O trecho de conversa pode conter dado pessoal (ADR-002) e conteúdo de conector ou de
-- outro bot (ADR-026), então precisa sair inteiro num pedido de exclusão sem tocar no registro.
CREATE TYPE categoria_relato AS ENUM (
  'resposta_errada', 'nao_fez_o_pedido', 'travou_ou_parou', 'lento', 'interface', 'outro'
);
CREATE TYPE alcance_relato AS ENUM ('mensagem', 'janela');

-- ---------------------------------------------------------------------------------------------
-- Diagnóstico da execução que não concluiu. Antes disto o erro_cru do CLI só existia como linha de
-- log em stdout (src/adapters/fundo/ponte-interna.ts), que some no Electron empacotado — e era
-- justamente o campo mais diagnóstico que havia. A ponte grava aqui quando desfecho <> 'sucesso'.
-- erro_cru é texto do fornecedor, logo é prosa: apagável por nod_poda como trilha_prosa.
CREATE TABLE turno_diagnosticos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  turno_id uuid NOT NULL,
  erro_cru text,
  ferramentas text[] NOT NULL DEFAULT '{}',
  negacoes text[] NOT NULL DEFAULT '{}',
  sessao_cli text,
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('turno_diagnosticos');
ALTER TABLE turno_diagnosticos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE turno_diagnosticos ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX turno_diagnosticos_por_turno ON turno_diagnosticos (tenant_id, turno_id, em DESC);
GRANT SELECT, DELETE ON turno_diagnosticos TO nod_poda;

-- ---------------------------------------------------------------------------------------------
-- O relato: só escalares e enums. Nenhuma coluna aqui guarda o que a pessoa escreveu.
-- sinais é jsonb porque são os QUATRO booleanos write-ahead do ADR-009 (attempted, rejected,
-- promptSubmitted, producedOutput) — estrutura fechada e conhecida, não prosa aninhada.
CREATE TABLE relatos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  mensagem_id uuid NOT NULL,
  conversa_id uuid NOT NULL,
  turno_id uuid,
  categoria categoria_relato NOT NULL,
  alcance alcance_relato NOT NULL,
  mensagens_anexadas int NOT NULL DEFAULT 0,
  estado_turno estado_turno,
  origem_turno origem_turno,
  sinais jsonb,
  motivo_falha motivo_falha,
  motivo_interrupcao motivo_interrupcao,
  modelo text,
  harness text,
  executor text,
  machine_id uuid,
  custo_usd numeric,
  reenvios int,
  confianca_mensagem confianca NOT NULL,
  mensagem_parcial boolean NOT NULL DEFAULT false,
  versao_app text,
  correlation_id uuid,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('relatos');
-- definido em 2026-09-21: relato é insumo de ROADMAP, não registro privado — quem investiga precisa
-- ver o que as outras pessoas relataram, senão a triagem lista só os próprios. Mesmo precedente de
-- catcher_registros (0002:516). A prosa continua privada: relato_prosa NÃO recebe este default.
ALTER TABLE relatos ALTER COLUMN visibility SET DEFAULT 'equipe';
ALTER TABLE relatos ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE relatos ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id);
ALTER TABLE relatos ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE relatos ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id);
CREATE INDEX relatos_recentes ON relatos (tenant_id, criado_em DESC);
CREATE INDEX relatos_por_categoria ON relatos (tenant_id, categoria, criado_em DESC);

-- ---------------------------------------------------------------------------------------------
-- A prosa, separada e apagável (ADR-004). texto_pessoa é o complemento opcional da etapa 2; trecho
-- é o recorte da conversa que a pessoa mandou anexar, gravado como snapshot porque a conversa muda
-- depois e o relato precisa dizer o que ela VIU.
CREATE TABLE relato_prosa (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  relato_id uuid NOT NULL,
  texto_pessoa text,
  trecho jsonb
);
SELECT nod_escopar_tabela('relato_prosa');
ALTER TABLE relato_prosa ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE relato_prosa ADD FOREIGN KEY (tenant_id, relato_id) REFERENCES relatos (tenant_id, id);
CREATE INDEX relato_prosa_por_relato ON relato_prosa (tenant_id, relato_id);
GRANT SELECT, DELETE ON relato_prosa TO nod_poda;

-- ROLLBACK:
-- DROP TABLE relato_prosa;
-- DROP TABLE relatos;
-- DROP TABLE turno_diagnosticos;
-- DROP TYPE alcance_relato;
-- DROP TYPE categoria_relato;
