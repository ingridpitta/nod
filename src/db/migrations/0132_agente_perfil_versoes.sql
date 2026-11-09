-- definido em 2026-10-30 (NOD-20): o histórico de versões do perfil do bot. Cada mudança de nome, subtítulo, missão,
-- forma, cor ou voz (pela tela, pela proposta confirmada, pelo ajuste de voz ou por um restaurar) grava aqui uma cópia do
-- perfil inteiro, com os segredos já redigidos pelo código (redigirSegredos). A trilha só recebe enum, uuid e número
-- (ADR-004: sem prosa nela); o conteúdo mora aqui.
--
-- Só acrescenta: nod_app tem SELECT e INSERT (REVOKE de UPDATE e DELETE, molde de maquinas_nuvem_eventos na 0107). Quem
-- apaga: a purga da conta (policy nod_purga da nod_escopar_tabela), o CASCADE do agente apagado de verdade (roda como dona
-- da FK; o produto só marca excluido_em, então isto é a limpeza dos testes) e a poda das 50 últimas por bot, pela função
-- nod_podar_versoes_perfil abaixo, SECURITY DEFINER e presa à pessoa e ao bot do escopo vinculado.
-- Só adição: o servidor antigo no ar não a lê nem escreve.
SET LOCAL lock_timeout = '5s';

CREATE TABLE agente_perfil_versoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  versao integer NOT NULL CHECK (versao >= 1),
  -- inicial = o perfil de antes da primeira mudança registrada (sem backfill); tela = PATCH da pessoa; chat = o Nod editou
  -- pelo gerir_bots; proposta = cartão confirmado (proposta_id); voz = ajuste de voz; restauracao = restaurar a versão
  -- restaurada_de.
  origem text NOT NULL CHECK (origem IN ('inicial', 'tela', 'chat', 'proposta', 'voz', 'restauracao')),
  -- Quem fez a mudança: a pessoa (tela, ligação, cartão que ela confirmou) ou o Nod (gerir_bots no chat). A lista do
  -- Histórico mostra "quem"; sem isto uma edição do Nod apareceria como "Você mudou…".
  autor text NOT NULL DEFAULT 'pessoa' CHECK (autor IN ('pessoa', 'nod')),
  proposta_id uuid,
  restaurada_de integer,
  nome text NOT NULL,
  titulo text NOT NULL,
  descricao text NOT NULL,
  forma text NOT NULL,
  cor text NOT NULL,
  voz text,
  voz_velocidade real NOT NULL DEFAULT 1,
  -- Os campos que mudaram em relação à versão anterior (vazio na inicial).
  campos text[] NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT agente_perfil_versoes_origem CHECK (
    (origem = 'proposta') = (proposta_id IS NOT NULL)
    AND (origem = 'restauracao') = (restaurada_de IS NOT NULL)
    AND (origem <> 'chat' OR autor = 'nod')
  )
);
SELECT nod_escopar_tabela('agente_perfil_versoes');
ALTER TABLE agente_perfil_versoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE agente_perfil_versoes ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
-- Segunda cerca da numeração (a primeira é a trava da linha do agente em quem grava).
CREATE UNIQUE INDEX agente_perfil_versoes_numero ON agente_perfil_versoes (tenant_id, agente_id, versao DESC);
REVOKE UPDATE, DELETE, TRUNCATE ON agente_perfil_versoes FROM nod_app;

-- A numeração é do banco, não da confiança no código: só entra a próxima versão (max+1) e só no bot da própria pessoa
-- (a FK confere só o tenant; a policy de INSERT só a dona da LINHA). Sem isto, uma versão 999999 vinda de um bug faria a
-- poda apagar o histórico inteiro. SECURITY INVOKER: roda como nod_app, sob a RLS do escopo (a dona vê os bots dela e
-- todas as versões deles, que são dela por esta mesma regra).
CREATE FUNCTION nod_versao_perfil_coerente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_max integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agentes a WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.agente_id AND a.owner_id = NEW.owner_id) THEN
    RAISE EXCEPTION 'versão do perfil de um bot que não é da pessoa' USING ERRCODE = '42501';
  END IF;
  SELECT max(v.versao) INTO v_max FROM agente_perfil_versoes v WHERE v.tenant_id = NEW.tenant_id AND v.agente_id = NEW.agente_id;
  IF NEW.versao <> coalesce(v_max, 0) + 1 THEN
    RAISE EXCEPTION 'versão do perfil fora de ordem' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.origem = 'restauracao' AND (NEW.restaurada_de < 1 OR NEW.restaurada_de >= NEW.versao) THEN
    RAISE EXCEPTION 'restauração de versão inexistente' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nod_versao_perfil_coerente BEFORE INSERT ON agente_perfil_versoes
  FOR EACH ROW EXECUTE FUNCTION nod_versao_perfil_coerente();

-- A poda: só nod_dono, e só com os dois GUCs que nod_podar_versoes_perfil liga e desliga dentro dela. FOR ALL e não FOR
-- DELETE: o DELETE da função lê o max por subconsulta, que precisa da perna de SELECT; nod_dono é a dona da tabela (pode
-- tudo nela de qualquer jeito), e a função só apaga.
CREATE POLICY nod_poda_versoes ON agente_perfil_versoes AS PERMISSIVE FOR ALL TO nod_dono
  USING (tenant_id::text = current_setting('nod.poda_versoes_tenant', true)
         AND agente_id::text = current_setting('nod.poda_versoes_agente', true));

-- Mantém as 50 últimas versões do bot da pessoa do escopo vinculado (nod.tenant_id e nod.pessoa_id, os mesmos GUCs da
-- RLS). Quem chama só consegue podar o que é dele, e só o que passa das 50: devolve quantas apagou.
CREATE FUNCTION nod_podar_versoes_perfil(p_agente uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant uuid := nullif(current_setting('nod.tenant_id', true), '')::uuid;
  v_pessoa uuid := nullif(current_setting('nod.pessoa_id', true), '')::uuid;
  v_n integer;
BEGIN
  IF v_tenant IS NULL OR v_pessoa IS NULL OR p_agente IS NULL THEN
    RAISE EXCEPTION 'poda sem escopo' USING ERRCODE = '42501';
  END IF;
  -- Os GUCs da poda só nascem aqui dentro: chegar com eles ligados é alguém tentando abrir a policy por fora.
  IF coalesce(current_setting('nod.poda_versoes_tenant', true), '') <> '' OR coalesce(current_setting('nod.poda_versoes_agente', true), '') <> '' THEN
    RAISE EXCEPTION 'poda com GUC já ligado' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('nod.poda_versoes_tenant', v_tenant::text, true);
  PERFORM set_config('nod.poda_versoes_agente', p_agente::text, true);
  DELETE FROM agente_perfil_versoes v
   WHERE v.tenant_id = v_tenant AND v.owner_id = v_pessoa AND v.agente_id = p_agente
     AND v.versao <= (SELECT max(m.versao) FROM agente_perfil_versoes m
                       WHERE m.tenant_id = v_tenant AND m.owner_id = v_pessoa AND m.agente_id = p_agente) - 50;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('nod.poda_versoes_tenant', '', true);
  PERFORM set_config('nod.poda_versoes_agente', '', true);
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION nod_podar_versoes_perfil(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_podar_versoes_perfil(uuid) TO nod_app;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP FUNCTION IF EXISTS nod_podar_versoes_perfil(uuid);
-- DROP TABLE IF EXISTS agente_perfil_versoes;
-- DROP FUNCTION IF EXISTS nod_versao_perfil_coerente();
