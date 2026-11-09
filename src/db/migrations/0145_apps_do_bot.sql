-- definido em 2026-11-02 (NOD-445, ADR-146): as páginas do bot e os apps que a pessoa cria.
-- apps_do_bot: o app (nome, ícone, fonte, forma, quem vê, a regra do "pede você") e o retrato que o bot mantém com os
-- acessos dele (dados) — o app só exibe. Remover é suave (removido_em): o Desfazer devolve, e o dado de origem nunca é
-- apagado. paginas_do_bot: a ordem das páginas por bot e pessoa (a Conversa inclusive), igual em todos os aparelhos.
-- 'app' em kind_proposta e tipo_decisao: o card Criar/Ajustar pela conversa. O valor novo não é usado nesta transação
-- (nenhum índice, default ou linha o cita aqui), então pode morar junto das tabelas.
-- Só adição: o servidor antigo no ar não lê nem escreve estas tabelas e não conhece o kind novo.
SET LOCAL lock_timeout = '5s';

ALTER TYPE kind_proposta ADD VALUE IF NOT EXISTS 'app';
ALTER TYPE tipo_decisao ADD VALUE IF NOT EXISTS 'app';

CREATE TABLE apps_do_bot (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 20),
  -- Sem acento, sem caixa e com espaços colapsados (chaveDoNome em src/domain/apps-do-bot.ts): o índice único segura o
  -- duplicado mesmo com duas abas criando ao mesmo tempo.
  nome_chave text NOT NULL CHECK (length(nome_chave) BETWEEN 1 AND 40),
  icone text NOT NULL DEFAULT 'app' CHECK (length(icone) BETWEEN 1 AND 20),
  fonte text NOT NULL CHECK (fonte IN ('tarefas', 'conector', 'arquivo', 'bot')),
  fonte_ref text CHECK (fonte_ref IS NULL OR length(fonte_ref) BETWEEN 1 AND 500),
  forma text NOT NULL CHECK (forma IN ('lista', 'quadro', 'painel', 'doc')),
  -- Só 'so_eu' no MVP; 'todos' entra com a NOD-443 (várias pessoas falando com o bot).
  quem_ve text NOT NULL DEFAULT 'so_eu' CHECK (quem_ve IN ('so_eu')),
  regra_pede text CHECK (regra_pede IS NULL OR length(regra_pede) BETWEEN 1 AND 300),
  -- A regra do "pede você" que o servidor avalia sobre os itens do retrato (revisão 7 do #626): {coluna?, dias_desde?,
  -- valor_acima?, valor_abaixo?}. Null = vale a marca `pede` que o bot grava num turno limpo.
  pede_quando jsonb CHECK (pede_quando IS NULL OR jsonb_typeof(pede_quando) = 'object'),
  dados jsonb,
  erro_fonte text CHECK (erro_fonte IS NULL OR length(erro_fonte) BETWEEN 1 AND 300),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  removido_em timestamptz
);
SELECT nod_escopar_tabela('apps_do_bot');
ALTER TABLE apps_do_bot ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE apps_do_bot ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX apps_do_bot_nome ON apps_do_bot (tenant_id, owner_id, agente_id, nome_chave) WHERE removido_em IS NULL;
CREATE INDEX apps_do_bot_do_agente ON apps_do_bot (tenant_id, owner_id, agente_id, criado_em);

CREATE TABLE paginas_do_bot (
  agente_id uuid NOT NULL,
  -- 'conversa', 'tarefas' e 'app:<uuid>' (ordemQueVale normaliza ao ler: o que sumiu sai, o que é novo entra no fim).
  ordem text[] NOT NULL CHECK (cardinality(ordem) BETWEEN 1 AND 20),
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('paginas_do_bot');
ALTER TABLE paginas_do_bot ADD PRIMARY KEY (tenant_id, owner_id, agente_id);
ALTER TABLE paginas_do_bot ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;

-- ROLLBACK:
-- -- O Postgres não remove valor de enum: o rollback recria cada tipo sem 'app', com o mesmo nome e a mesma ordem
-- -- (padrão da 0135). Antes, apague as propostas/decisões 'app' (delete from decisoes where tipo = 'app'; delete from
-- -- propostas where kind = 'app'): com alguma linha usando o valor, o cast falha e a transação inteira volta. Rode o
-- -- bloco numa transação só (`psql -1 -v ON_ERROR_STOP=1`).
-- -- Os dois CREATE TYPE abaixo levam 'quadro_exclusao' logo depois de 'colunas_quadro': é o valor da 0143 (NOD-430,
-- -- PR #627), que veio antes desta. Desfazer só a 0145 tira o 'app' e devolve os tipos exatamente como a 0143 os deixou
-- -- (mesmos valores, mesma ordem), que é o que a ida e volta confere (tests/conformidade/rollback-ida-e-volta.test.ts,
-- -- foto dos enums). O 'quadro_exclusao' só sai com o rollback da própria 0143.
-- SET LOCAL lock_timeout = '5s';
-- DROP TABLE IF EXISTS paginas_do_bot;
-- DROP TABLE IF EXISTS apps_do_bot;
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- ALTER TYPE kind_proposta RENAME TO kind_proposta_0145;
-- CREATE TYPE kind_proposta AS ENUM ('perfil', 'rotina', 'acesso', 'pasta', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao');
-- ALTER TABLE propostas ALTER COLUMN kind TYPE kind_proposta USING kind::text::kind_proposta;
-- DROP TYPE kind_proposta_0145;
-- CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
--   ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
--   WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';
-- ALTER TYPE tipo_decisao RENAME TO tipo_decisao_0145;
-- CREATE TYPE tipo_decisao AS ENUM ('aprovacao', 'acesso', 'retomar_turno', 'gate_rotina', 'perfil', 'rotina', 'pergunta',
--   'falta_de_dado', 'permissao', 'rotina_atualizacao', 'rotina_exclusao', 'bot', 'lote_bots', 'credencial', 'colunas_quadro', 'quadro_exclusao');
-- ALTER TABLE decisoes ALTER COLUMN tipo TYPE tipo_decisao USING tipo::text::tipo_decisao;
-- DROP TYPE tipo_decisao_0145;
