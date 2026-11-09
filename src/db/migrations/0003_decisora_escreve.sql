-- 0003 decisora escreve + events.locality_reason tipado. Fecha duas pendências de contrato da L3
-- (PENDENCIAS-A): (1) a perna extra de decisoes/itens_aprovacao só ABRIA LEITURA (o WITH CHECK da
-- nod_escopar_tabela exige owner_id = pessoa da sessão), então a decisora designada não conseguia
-- decidir; (2) events.locality_reason nasceu `text` na 0001 enquanto mensagens/turnos usam o enum
-- motivo_localidade da 0002. Convenção `-- ROLLBACK:` no fim.

-- ---------------------------------------------------------------------------------------------
-- (1) Policy PERMISSIVE ADICIONAL, só FOR UPDATE, para a decisora designada (EMENDA 1, ADR-007).
-- Postgres OR-a as policies PERMISSIVE do mesmo comando: para UPDATE, a linha precisa passar no
-- USING de alguma (nod_pessoa já enxerga pela perna extra) e a linha NOVA no WITH CHECK de alguma
-- — é este WITH CHECK que faltava. USING e WITH CHECK pela MESMA perna (decisor_id = pessoa da
-- sessão), e a RESTRICTIVE nod_tenant continua conjuntiva. INSERT e DELETE não ganham nada: a
-- policy é FOR UPDATE, então criar uma decisão em nome de outra pessoa continua 42501. Mas uma
-- policy FOR UPDATE não distingue COLUNA: quem passa por ela pode reescrever a linha inteira —
-- as colunas que a decisora pode tocar são fechadas pelos triggers logo abaixo, não pela policy.
-- Provado em tests/integration/repos/decisora-escreve.test.ts (ana decide a de marlon dirigida a
-- ela; não vê nem decide a outra). O gate de RLS aceita esta policy por NOME (POLICIES_EXTRAS em
-- tests/conformidade/gate-rls.ts) — qualquer outra policy fora da lista é acusada.
CREATE POLICY nod_decisora ON decisoes AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid
         AND decisor_id = current_setting('nod.pessoa_id')::uuid)
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
              AND decisor_id = current_setting('nod.pessoa_id')::uuid);

CREATE POLICY nod_decisora ON itens_aprovacao AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid
         AND EXISTS (SELECT 1 FROM decisoes d
                     WHERE d.tenant_id = itens_aprovacao.tenant_id AND d.id = itens_aprovacao.decisao_id
                       AND d.decisor_id = current_setting('nod.pessoa_id')::uuid))
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
              AND EXISTS (SELECT 1 FROM decisoes d
                          WHERE d.tenant_id = itens_aprovacao.tenant_id AND d.id = itens_aprovacao.decisao_id
                            AND d.decisor_id = current_setting('nod.pessoa_id')::uuid));

-- O WITH CHECK olha só a linha NOVA: sem esta trava a decisora poderia reescrever owner_id (e
-- virar "dona") ou empurrar decisor_id para outra pessoa, e o item poderia mudar de decisão.
-- E a policy FOR UPDATE concede o UPDATE de QUALQUER coluna (medido em 2026-09-16: com estes
-- triggers desligados, a decisora reescreveu frase/tipo/prazo e pôs visibility='equipe' na decisão
-- da dona — count 1 nos dois UPDATEs, abrindo-a ao tenant inteiro; com eles ligados, P0001). Por isso os triggers disparam em TODO UPDATE e têm DUAS travas:
--   (a) pernas imutáveis para todo mundo, dona inclusive (owner_id/decisor_id; owner_id/decisao_id);
--   (b) quem NÃO é a dona (OLD.owner_id <> pessoa da sessão) só altera a LISTA FECHADA de colunas
--       do ato de decidir — todo o resto da linha tem que sair igual (to_jsonb(OLD) - lista =
--       to_jsonb(NEW) - lista; lista de colunas, não de valores, por isso uma coluna nova na tabela
--       nasce TRAVADA para a decisora até alguém a nomear aqui).
-- definido em 2026-09-16: decisora altera em decisoes só estado, desfecho, decidida_em, decidida_por,
-- vista_em — e prazo_decisao_em SÓ na transição vencida → reaberta (é o botão "reabrir" de 'Sua vez',
-- ADR-007/spec 'volta ao topo com prazo novo'); em itens_aprovacao só selecionado, marcado_por,
-- marcado_em, texto_final, editado_por (desfecho é da execução, que roda pela dona). visibility,
-- tipo, frase, prazos, agente/conversa/turno, idx, texto_original, destino, origem_sensivel e
-- justificativa ficam com a dona. Sem pessoa na sessão (nod_dono sem SET LOCAL) a trava (b) não se
-- aplica: o dono não tem policy e não chega a esta linha pelo caminho da aplicação.
-- Mesmo padrão de nod_agente_dono_imutavel (0002): BEFORE UPDATE, P0001. Provado em
-- tests/integration/repos/decisora-escreve.test.ts (frase/visibility/prazo pela decisora → P0001;
-- reabrir vencida pela decisora passa; a dona continua livre).
CREATE FUNCTION nod_decisao_pernas_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pessoa uuid := nullif(current_setting('nod.pessoa_id', true), '')::uuid;
  livres text[] := ARRAY['estado', 'desfecho', 'decidida_em', 'decidida_por', 'vista_em'];
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.decisor_id IS DISTINCT FROM OLD.decisor_id THEN
    RAISE EXCEPTION 'owner_id e decisor_id da decisão são imutáveis (EMENDA 1)' USING ERRCODE = 'P0001';
  END IF;
  IF pessoa IS NOT NULL AND pessoa <> OLD.owner_id THEN
    IF OLD.estado = 'vencida' AND NEW.estado = 'reaberta' THEN
      livres := array_append(livres, 'prazo_decisao_em');
    END IF;
    IF (to_jsonb(OLD) - livres) <> (to_jsonb(NEW) - livres) THEN
      RAISE EXCEPTION 'quem não é a dona só altera % da decisão (0003); prazo_decisao_em só ao reabrir vencida',
        array_to_string(livres, ', ') USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_decisao_pernas_imutaveis
  BEFORE UPDATE ON decisoes
  FOR EACH ROW EXECUTE FUNCTION nod_decisao_pernas_imutaveis();

CREATE FUNCTION nod_item_aprovacao_pernas_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pessoa uuid := nullif(current_setting('nod.pessoa_id', true), '')::uuid;
  livres text[] := ARRAY['selecionado', 'marcado_por', 'marcado_em', 'texto_final', 'editado_por'];
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.decisao_id IS DISTINCT FROM OLD.decisao_id THEN
    RAISE EXCEPTION 'owner_id e decisao_id do item de aprovação são imutáveis (EMENDA 1)' USING ERRCODE = 'P0001';
  END IF;
  IF pessoa IS NOT NULL AND pessoa <> OLD.owner_id AND (to_jsonb(OLD) - livres) <> (to_jsonb(NEW) - livres) THEN
    RAISE EXCEPTION 'quem não é a dona só altera % do item de aprovação (0003)',
      array_to_string(livres, ', ') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_item_aprovacao_pernas_imutaveis
  BEFORE UPDATE ON itens_aprovacao
  FOR EACH ROW EXECUTE FUNCTION nod_item_aprovacao_pernas_imutaveis();

-- ---------------------------------------------------------------------------------------------
-- (2) events.locality_reason vira o enum motivo_localidade (ADR-004: um enum só). Em tabela
-- particionada o ALTER COLUMN TYPE desce a todas as partições. O USING converte o texto existente:
-- valor fora do enum falha alto na migração, nunca vira linha silenciosa (a 0001 nasceu sem
-- linhas fora de 'tudo_local_nesta_rodada'/'motor_ausente' porque só src/domain/plano-turno.ts
-- produz esse campo, a partir de MOTIVOS_LOCALIDADE). O gate tests/conformidade/motivos-enum.test.ts
-- passa a cobrir `events` além das tabelas da 0002 + trilha.
ALTER TABLE events
  ALTER COLUMN locality_reason TYPE motivo_localidade USING locality_reason::motivo_localidade;

-- ROLLBACK:
ALTER TABLE events ALTER COLUMN locality_reason TYPE text USING locality_reason::text;
DROP TRIGGER IF EXISTS nod_item_aprovacao_pernas_imutaveis ON itens_aprovacao;
DROP FUNCTION IF EXISTS nod_item_aprovacao_pernas_imutaveis();
DROP TRIGGER IF EXISTS nod_decisao_pernas_imutaveis ON decisoes;
DROP FUNCTION IF EXISTS nod_decisao_pernas_imutaveis();
DROP POLICY IF EXISTS nod_decisora ON itens_aprovacao;
DROP POLICY IF EXISTS nod_decisora ON decisoes;
