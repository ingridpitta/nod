-- definido em 2026-09-21: ADR-041 reverte o §Integrações da ADR-033 em duas frases —
-- a chave do projeto Composio passa a ser do TENANT; sessões e contas continuam da pessoa.

-- 'equipe' faz a policy nod_pessoa_select da 0004 liberar a leitura para todo o tenant.
ALTER TABLE composio_configuracoes DROP CONSTRAINT composio_configuracoes_visibility_check;
ALTER TABLE composio_configuracoes DROP CONSTRAINT composio_configuracoes_tenant_id_owner_id_key;
ALTER TABLE composio_configuracoes ADD CONSTRAINT composio_configuracoes_tenant_id_key UNIQUE (tenant_id);
-- UPDATE antes do CHECK: com linhas 'privado' já gravadas, o CHECK primeiro falha (23514) no banco diário.
-- NO FORCE só em volta do UPDATE (regra da 0005): como nod_dono, FORCE faz o UPDATE afetar 0 linhas
-- em silêncio, e o CHECK — que não passa por RLS — acha as linhas 'privado' mesmo assim.
ALTER TABLE composio_configuracoes NO FORCE ROW LEVEL SECURITY;
UPDATE composio_configuracoes SET visibility = 'equipe';
ALTER TABLE composio_configuracoes FORCE ROW LEVEL SECURITY;
ALTER TABLE composio_configuracoes ADD CONSTRAINT composio_configuracoes_visibility_check CHECK (visibility = 'equipe');

-- A 0004 dá UPDATE só para a dona ('equipe' abre LEITURA). Sem esta policy, quem cadastrou a chave
-- é a única que a troca — e se ela sair do nod a troca passaria a exigir nod_dono (ADR-041 §2).
-- Mesma forma da nod_decisora (0003): PERMISSIVE, só FOR UPDATE, USING e WITH CHECK pela MESMA
-- perna (o tenant da sessão), com a RESTRICTIVE nod_tenant continuando conjuntiva. INSERT segue da
-- dona — o UNIQUE (tenant_id) já garante uma linha por tenant — e DELETE também, para que apagar a
-- chave do time não vire efeito colateral de quem só ia trocá-la. O gate aceita esta policy por
-- NOME (POLICIES_EXTRAS em tests/conformidade/gate-rls.ts).
CREATE POLICY nod_equipe_update ON composio_configuracoes AS PERMISSIVE FOR UPDATE TO nod_app
  USING (tenant_id = current_setting('nod.tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid);

-- A policy FOR UPDATE concede UPDATE de QUALQUER coluna (medido em 2026-09-16 na 0003: com o
-- trigger desligado, a decisora reescreveu frase/prazo e pôs visibility='equipe' na linha da dona).
-- Aqui a lista FECHADA é chave_cifrada: trocar a chave é o ato que a policy abre. Lista de colunas,
-- não de valores — coluna nova na tabela nasce TRAVADA para quem não é a dona até ser nomeada aqui.
-- Sem pessoa na sessão (nod_dono sem SET LOCAL) a trava não se aplica: o dono não tem policy e não
-- chega aqui pelo caminho da aplicação. Mesmo padrão de nod_decisao_pernas_imutaveis: BEFORE UPDATE, P0001.
CREATE FUNCTION nod_composio_pernas_imutaveis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  pessoa uuid := nullif(current_setting('nod.pessoa_id', true), '')::uuid;
  livres text[] := ARRAY['chave_cifrada'];
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'owner_id e tenant_id da configuração Composio são imutáveis (ADR-041)' USING ERRCODE = 'P0001';
  END IF;
  IF pessoa IS NOT NULL AND pessoa <> OLD.owner_id THEN
    IF (to_jsonb(OLD) - livres) <> (to_jsonb(NEW) - livres) THEN
      RAISE EXCEPTION 'quem não cadastrou a chave Composio só altera chave_cifrada (ADR-041)' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nod_composio_pernas_imutaveis
  BEFORE UPDATE ON composio_configuracoes
  FOR EACH ROW EXECUTE FUNCTION nod_composio_pernas_imutaveis();

-- ROLLBACK:
-- DROP TRIGGER nod_composio_pernas_imutaveis ON composio_configuracoes;
-- DROP FUNCTION nod_composio_pernas_imutaveis();
-- DROP POLICY nod_equipe_update ON composio_configuracoes;
-- ALTER TABLE composio_configuracoes DROP CONSTRAINT composio_configuracoes_visibility_check;
-- ALTER TABLE composio_configuracoes DROP CONSTRAINT composio_configuracoes_tenant_id_key;
-- UPDATE composio_configuracoes SET visibility = 'privado';
-- ALTER TABLE composio_configuracoes ADD CONSTRAINT composio_configuracoes_tenant_id_owner_id_key UNIQUE (tenant_id, owner_id);
-- ALTER TABLE composio_configuracoes ADD CONSTRAINT composio_configuracoes_visibility_check CHECK (visibility = 'privado');
