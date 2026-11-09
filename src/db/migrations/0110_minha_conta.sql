-- definido em 2026-10-23 (NOD-346, ADR-126): Minha conta — perfil e "Sobre mim", reautenticação recente, troca de
-- e-mail, desligar uma forma de entrada, exportação dos dados e exclusão com 30 dias para desfazer, depois a purga.
--
-- Só adição: o código anterior não lê nada daqui. Tudo atrás de NOD_MINHA_CONTA (e a purga de NOD_PURGA_CONTA),
-- desligadas por padrão. A única mudança de comportamento no banco é estreita e testada: a trilha passa a aceitar
-- DELETE só dentro da purga (nod_dono + GUC nod.purga_tenant do próprio tenant), emenda da ADR-004.
SET LOCAL lock_timeout = '5s';

-- Perfil: o "Sobre mim" vai na parte estável do prompt dos bots próprios (2000 caracteres). A foto chega reduzida pelo
-- navegador (256 px); o teto de 256 KB segura um cliente que não reduza.
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS sobre_mim text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_sobre_mim CHECK (sobre_mim IS NULL OR char_length(sobre_mim) BETWEEN 1 AND 2000);
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS foto bytea;
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS foto_tipo text;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_foto CHECK (
  (foto IS NULL AND foto_tipo IS NULL)
  OR (foto IS NOT NULL AND octet_length(foto) BETWEEN 1 AND 262144 AND foto_tipo IN ('image/png', 'image/jpeg'))
);

-- Reautenticação recente (ADR-126 §1): ações de risco exigem senha ou Google há menos de 10 minutos nesta sessão.
ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS reautenticada_em timestamptz;
-- (o nod_app já tem UPDATE em sessoes desde a 0109)

-- Troca de e-mail: link de uso único enviado ao endereço NOVO (chave = conta; dados = o e-mail novo).
ALTER TABLE codigos_conta DROP CONSTRAINT codigos_conta_finalidade;
ALTER TABLE codigos_conta ADD CONSTRAINT codigos_conta_finalidade
  CHECK (finalidade IN ('verificacao', 'recuperacao', 'troca_app', 'troca_email', 'reautenticacao'));
GRANT UPDATE (email) ON contas TO nod_app;

-- Desligar uma forma de entrada. O domínio recusa a última; o trigger recusa de novo (corrida entre duas remoções, ou
-- um bug): a conta nunca fica sem forma de entrar. A trava FOR UPDATE da conta serializa as duas remoções.
GRANT DELETE ON identidades_conta TO nod_app;
CREATE FUNCTION nod_identidade_nunca_a_ultima()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Só a purga (o dono, com o GUC da PRÓPRIA conta desta identidade) apaga a última.
  IF current_user = 'nod_dono' AND OLD.conta_id::text = current_setting('nod.purga_conta', true) THEN
    RETURN OLD;
  END IF;
  PERFORM 1 FROM public.contas WHERE id = OLD.conta_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.identidades_conta WHERE conta_id = OLD.conta_id AND id <> OLD.id) THEN
    RAISE EXCEPTION 'a última forma de entrada não sai (ADR-126)' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER identidades_conta_nunca_vazia
  BEFORE DELETE ON identidades_conta
  FOR EACH ROW EXECUTE FUNCTION nod_identidade_nunca_a_ultima();

-- Exportação assíncrona (ADR-126 §4): o laço de fundo monta o zip e guarda aqui; vale 7 dias e some na poda.
CREATE TABLE exportacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  estado text NOT NULL DEFAULT 'pedida',
  motivo text,
  arquivo bytea,
  tamanho integer,
  pedida_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  pronta_em timestamptz,
  expira_em timestamptz,
  CONSTRAINT exportacoes_estado CHECK (estado IN ('pedida', 'pronta', 'falhou')),
  CONSTRAINT exportacoes_motivo CHECK (motivo IS NULL OR motivo ~ '^[a-z_]{1,40}$'),
  CONSTRAINT exportacoes_pronta CHECK (
    (estado = 'pronta' AND arquivo IS NOT NULL AND tamanho = octet_length(arquivo) AND pronta_em IS NOT NULL AND expira_em IS NOT NULL)
    OR (estado <> 'pronta' AND arquivo IS NULL)
  ),
  CONSTRAINT exportacoes_teto CHECK (arquivo IS NULL OR octet_length(arquivo) <= 52428800)
);
SELECT nod_escopar_tabela('exportacoes');
ALTER TABLE exportacoes ADD PRIMARY KEY (tenant_id, id);
-- Uma pedida por pessoa: pedir de novo enquanto prepara devolve a mesma.
CREATE UNIQUE INDEX exportacoes_uma_pedida ON exportacoes (tenant_id, owner_id) WHERE estado = 'pedida';

-- Exclusão (ADR-126 §5): global, como as outras tabelas de conta (sem RLS; exceção em gate-rls.ts). O prazo nasce no
-- banco — o nod_app não escolhe quando a purga roda — e a única transição dele é programada → desfeita.
CREATE TABLE exclusoes_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  estado text NOT NULL DEFAULT 'programada',
  pedida_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  purgar_em timestamptz NOT NULL DEFAULT clock_timestamp() + interval '30 days',
  desfeita_em timestamptz,
  purgada_em timestamptz,
  -- 'bloqueada': a purga recusou (o espaço virou de equipe) ou falhou. Sai da fila para não travar as outras; o laço
  -- avisa (purga_bloqueada) e uma pessoa decide. O motivo é um código, nunca texto livre.
  motivo text,
  -- Revisão do PR 506: um erro passageiro (trava, tempo esgotado, serialização) deixa a exclusão programada e conta
  -- uma tentativa; só na 5ª ela vira 'bloqueada'. O laço tenta de novo na volta seguinte.
  tentativas integer NOT NULL DEFAULT 0,
  CONSTRAINT exclusoes_conta_tentativas CHECK (tentativas BETWEEN 0 AND 5),
  CONSTRAINT exclusoes_conta_estado CHECK (estado IN ('programada', 'desfeita', 'purgada', 'bloqueada')),
  CONSTRAINT exclusoes_conta_motivo CHECK (motivo IS NULL OR motivo ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT exclusoes_conta_coerente CHECK (
    (estado = 'programada' AND desfeita_em IS NULL AND purgada_em IS NULL)
    OR (estado = 'desfeita' AND desfeita_em IS NOT NULL AND purgada_em IS NULL)
    OR (estado = 'purgada' AND purgada_em IS NOT NULL)
    OR (estado = 'bloqueada' AND purgada_em IS NULL AND motivo IS NOT NULL)
  )
);
CREATE UNIQUE INDEX exclusoes_conta_uma_programada ON exclusoes_conta (conta_id) WHERE estado = 'programada';
CREATE INDEX exclusoes_conta_vencidas ON exclusoes_conta (purgar_em) WHERE estado = 'programada';
CREATE INDEX exclusoes_conta_purgadas ON exclusoes_conta (purgada_em) WHERE estado = 'purgada';
CREATE INDEX exclusoes_conta_da_pessoa ON exclusoes_conta (tenant_id, pessoa_id) WHERE estado = 'programada';

CREATE FUNCTION nod_exclusao_guarda()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- O dono (purga, e os testes que simulam um prazo vencido) escreve o que quiser.
  IF current_user = 'nod_dono' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.estado := 'programada';
    NEW.pedida_em := clock_timestamp();
    NEW.purgar_em := NEW.pedida_em + interval '30 days';
    NEW.desfeita_em := NULL;
    NEW.purgada_em := NULL;
    NEW.motivo := NULL;
    NEW.tentativas := 0;
    RETURN NEW;
  END IF;
  IF OLD.estado <> 'programada' OR NEW.estado <> 'desfeita' OR NEW.purgar_em <> OLD.purgar_em OR NEW.pedida_em <> OLD.pedida_em
     OR NEW.conta_id <> OLD.conta_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.pessoa_id <> OLD.pessoa_id THEN
    RAISE EXCEPTION 'exclusão: só programada → desfeita (ADR-126)' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER exclusoes_conta_guarda
  BEFORE INSERT OR UPDATE ON exclusoes_conta
  FOR EACH ROW EXECUTE FUNCTION nod_exclusao_guarda();

REVOKE ALL ON exclusoes_conta FROM PUBLIC;
GRANT SELECT, INSERT ON exclusoes_conta TO nod_app;
GRANT UPDATE (estado, desfeita_em) ON exclusoes_conta TO nod_app;

-- Revisão do PR 506: "espaço pessoal" é uma marca, não uma contagem. Uma empresa com uma pessoa só (e domínio admitido)
-- nunca pode ser purgada por quem exclui a própria conta. A marca nasce com o espaço provisório (NOD-345), o único
-- caminho que cria o espaço de uma pessoa; os provisórios de antes ganham a marca pelo nome que a função dava a eles,
-- se não têm domínio admitido e não são o tenant da semente.
ALTER TABLE tenants ADD COLUMN pessoal boolean NOT NULL DEFAULT false;
UPDATE tenants t SET pessoal = true
  WHERE t.nome LIKE 'Espaço de %'
    AND t.id <> '172e1fdf-428d-48cb-b052-3bd7d2573e18'
    AND NOT EXISTS (SELECT 1 FROM dominios_admitidos d WHERE d.tenant_id = t.id);
CREATE OR REPLACE FUNCTION nod_criar_espaco_provisorio(p_nome text, p_iniciais text)
RETURNS TABLE (o_tenant_id uuid, o_pessoa_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_nome text := btrim(coalesce(p_nome, ''));
  v_iniciais text := btrim(coalesce(p_iniciais, ''));
  v_tenant uuid := gen_random_uuid();
  v_pessoa uuid := gen_random_uuid();
BEGIN
  IF length(v_nome) NOT BETWEEN 1 AND 80 OR length(v_iniciais) NOT BETWEEN 1 AND 3 THEN RETURN; END IF;
  INSERT INTO public.tenants (id, nome, pessoal) VALUES (v_tenant, 'Espaço de ' || v_nome, true);
  INSERT INTO public.pessoas (tenant_id, id, nome, iniciais, email) VALUES (v_tenant, v_pessoa, v_nome, v_iniciais, NULL);
  RETURN QUERY SELECT v_tenant, v_pessoa;
END
$$;
-- O app não lê dominios_admitidos (mapa de domínio para empresa); só precisa saber, do próprio tenant, se ele é pessoal.
CREATE FUNCTION nod_tenant_pessoal(p_tenant uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce((SELECT t.pessoal FROM public.tenants t WHERE t.id = p_tenant), false)
     AND NOT EXISTS (SELECT 1 FROM public.dominios_admitidos d WHERE d.tenant_id = p_tenant);
$$;
REVOKE ALL ON FUNCTION nod_tenant_pessoal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_tenant_pessoal(uuid) TO nod_app;
-- A guarda de sessão confere o cookie antigo (sem sid) fora de qualquer tenant: depois da purga a pessoa não existe
-- mais e o cookie não pode valer. Só um booleano para o par (tenant, pessoa) que o próprio cookie assinado traz.
CREATE FUNCTION nod_pessoa_existe(p_tenant uuid, p_pessoa uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.pessoas p WHERE p.tenant_id = p_tenant AND p.id = p_pessoa);
$$;
REVOKE ALL ON FUNCTION nod_pessoa_existe(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_pessoa_existe(uuid, uuid) TO nod_app;

-- Purga (ADR-126 §6). A policy `nod_purga` deixa o DONO ver e apagar só o tenant marcado no GUC transacional; sem o
-- GUC (o caso de sempre), o dono continua vendo 0 linhas nas tabelas com FORCE RLS, como antes.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT p.polrelid::regclass AS tbl FROM pg_policy p WHERE p.polname = 'nod_tenant' LOOP
    EXECUTE format(
      $p$CREATE POLICY nod_purga ON %s AS PERMISSIVE FOR ALL TO nod_dono
         USING (tenant_id::text = current_setting('nod.purga_tenant', true))$p$,
      r.tbl);
  END LOOP;
END;
$$;

-- As tabelas escopadas futuras nascem com a policy da purga (a conformidade exige em todas).
CREATE OR REPLACE FUNCTION nod_escopar_tabela(tbl regclass, perna_extra text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  extra text := COALESCE(perna_extra, 'false');
BEGIN
  -- DEFAULT do tenant = TENANT_PADRAO (src/db/seed/index.ts).
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT %L',
                 tbl, '172e1fdf-428d-48cb-b052-3bd7d2573e18');
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS owner_id uuid NOT NULL', tbl);
  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS visibility visibilidade NOT NULL DEFAULT ''privado''', tbl);
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_select ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_insert ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_update ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_pessoa_delete ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_tenant ON %s', tbl);
  EXECUTE format('DROP POLICY IF EXISTS nod_purga ON %s', tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_select ON %s AS PERMISSIVE FOR SELECT TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND (owner_id = current_setting('nod.pessoa_id')::uuid
                   OR visibility = 'equipe'
                   OR (%s)))$p$,
    tbl, extra);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_insert ON %s AS PERMISSIVE FOR INSERT TO nod_app
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                   AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_update ON %s AS PERMISSIVE FOR UPDATE TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND owner_id = current_setting('nod.pessoa_id')::uuid)
       WITH CHECK (tenant_id = current_setting('nod.tenant_id')::uuid
                   AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_pessoa_delete ON %s AS PERMISSIVE FOR DELETE TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid
              AND owner_id = current_setting('nod.pessoa_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_tenant ON %s AS RESTRICTIVE FOR ALL TO nod_app
       USING (tenant_id = current_setting('nod.tenant_id')::uuid)$p$,
    tbl);
  EXECUTE format(
    $p$CREATE POLICY nod_purga ON %s AS PERMISSIVE FOR ALL TO nod_dono
       USING (tenant_id::text = current_setting('nod.purga_tenant', true))$p$,
    tbl);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO nod_app', tbl);
END;
$$;

-- Trilha (emenda da ADR-004): DELETE só na purga — o dono, dentro de nod_purgar_conta, com o GUC do tenant da linha.
-- UPDATE e TRUNCATE continuam recusados para todos.
CREATE OR REPLACE FUNCTION nod_trilha_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Revisão do PR 506: o GUC sozinho não basta — o tenant precisa ter uma exclusão vencida (a purga em curso) ou
  -- purgada há menos de 1 hora (a varredura). Um script do dono com o GUC marcado não apaga a trilha de mais ninguém.
  IF TG_OP = 'DELETE' AND current_user = 'nod_dono'
     AND OLD.tenant_id::text = current_setting('nod.purga_tenant', true)
     AND EXISTS (
       SELECT 1 FROM public.exclusoes_conta x
       WHERE x.tenant_id = OLD.tenant_id
         AND ((x.estado = 'programada' AND x.purgar_em <= clock_timestamp())
           OR (x.estado = 'purgada' AND x.purgada_em > clock_timestamp() - interval '1 hour'))
     ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trilha é imutável (ADR-004): % recusado', TG_OP USING ERRCODE = 'P0001';
END;
$$;

-- As passadas pelas tabelas escopadas de um tenant (a policy nod_purga deixa o dono ver só o tenant do GUC, que quem
-- chama já marcou). As FKs são NO ACTION e a ordem entre ~65 tabelas muda com o tempo: a tabela que ainda tem filho
-- espera a próxima passada (subtransação por tabela). Repete até uma passada sem erro e sem linha apagada: o que uma
-- escrita concorrente gravou depois de a tabela ser varrida sai na passada seguinte. Devolve quantas linhas apagou.
-- Sem GRANT: só roda de dentro das funções do dono abaixo.
CREATE FUNCTION nod_purga_varrer_tenant(p_tenant uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_restam boolean;
  v_apagadas bigint;
  v_total bigint := 0;
  v_n bigint;
  v_passada integer := 0;
  r record;
BEGIN
  IF current_setting('nod.purga_tenant', true) IS DISTINCT FROM p_tenant::text THEN
    RAISE EXCEPTION 'purga: GUC do tenant ausente' USING ERRCODE = 'P0001';
  END IF;
  LOOP
    v_passada := v_passada + 1;
    v_restam := false;
    v_apagadas := 0;
    FOR r IN SELECT DISTINCT p.polrelid::regclass AS tbl FROM pg_policy p WHERE p.polname = 'nod_purga' LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE tenant_id = $1', r.tbl) USING p_tenant;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_apagadas := v_apagadas + v_n;
      EXCEPTION WHEN foreign_key_violation THEN
        v_restam := true;
      END;
    END LOOP;
    v_total := v_total + v_apagadas;
    EXIT WHEN NOT v_restam AND v_apagadas = 0;
    IF v_passada >= 30 THEN RAISE EXCEPTION 'purga: dependências sem fim' USING ERRCODE = 'P0001'; END IF;
  END LOOP;
  RETURN v_total;
END
$$;
REVOKE ALL ON FUNCTION nod_purga_varrer_tenant(uuid) FROM PUBLIC;

-- Apaga tudo de um tenant pessoal cuja exclusão venceu. Devolve false sem mexer em nada se não houver exclusão
-- programada e vencida. Se o tenant deixou de ser pessoal (mais de uma pessoa ou ligação), ou se a purga falhar, a
-- exclusão vira 'bloqueada' com o motivo (sai da fila: uma recusa nunca trava as outras) e devolve false.
-- search_path fixo (SECURITY DEFINER).
CREATE FUNCTION nod_purgar_conta(p_exclusao uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ex public.exclusoes_conta%ROWTYPE;
  v_pessoas integer;
  v_contas integer;
  v_email text;
  v_sids text[];
BEGIN
  -- Codex no PR 506: o limite vale já para as primeiras travas (a exclusão e a pessoa). Travada por outra transação, a
  -- chamada falha em 3 s (55P03), nada muda (sem contar tentativa: só adia) e o laço tenta na próxima volta.
  PERFORM set_config('lock_timeout', '3s', true);
  SELECT * INTO v_ex FROM public.exclusoes_conta WHERE id = p_exclusao FOR UPDATE;
  IF NOT FOUND OR v_ex.estado <> 'programada' OR v_ex.purgar_em > clock_timestamp() THEN RETURN false; END IF;
  -- A pessoa travada: sessão nova, entrada ou pareamento para ela esperam a purga (e depois falham pela FK).
  PERFORM 1 FROM public.pessoas WHERE tenant_id = v_ex.tenant_id AND id = v_ex.pessoa_id FOR UPDATE;
  SELECT count(*) INTO v_pessoas FROM public.pessoas WHERE tenant_id = v_ex.tenant_id;
  SELECT count(*) INTO v_contas FROM public.conta_pessoas WHERE conta_id = v_ex.conta_id;
  IF v_pessoas <> 1 OR v_contas <> 1
     OR NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = v_ex.tenant_id AND pessoal)
     OR EXISTS (SELECT 1 FROM public.dominios_admitidos WHERE tenant_id = v_ex.tenant_id)
     OR NOT EXISTS (SELECT 1 FROM public.conta_pessoas WHERE conta_id = v_ex.conta_id AND tenant_id = v_ex.tenant_id AND pessoa_id = v_ex.pessoa_id) THEN
    UPDATE public.exclusoes_conta SET estado = 'bloqueada', motivo = 'espaco_de_equipe' WHERE id = p_exclusao;
    RETURN false;
  END IF;

  BEGIN
    -- O lock_timeout (3 s) do início vale aqui: uma linha travada vira erro passageiro (55P03), que conta tentativa.
    PERFORM set_config('nod.purga_tenant', v_ex.tenant_id::text, true);
    PERFORM set_config('nod.purga_conta', v_ex.conta_id::text, true);
    PERFORM public.nod_purga_varrer_tenant(v_ex.tenant_id);

    -- Conta e identidade (sem RLS): o dono é o dono das tabelas. As FKs cruzadas também saem: a entrada que uma
    -- sessão deste tenant abriu para OUTRA conta, e o pareamento pedido por uma sessão daqui.
    SELECT email INTO v_email FROM public.contas WHERE id = v_ex.conta_id;
    SELECT coalesce(array_agg(s.id::text), '{}') INTO v_sids FROM public.sessoes s WHERE s.tenant_id = v_ex.tenant_id;
    -- Códigos: os da conta, os das sessões (reautenticação, troca do app), os do cadastro (`cadastro:<sid>`, com o
    -- e-mail e o hash da senha) e qualquer outro que ainda traga o e-mail ou o tenant.
    DELETE FROM public.codigos_conta
      WHERE chave = v_ex.conta_id::text
         OR chave = ANY (v_sids)
         OR chave = ANY (SELECT 'cadastro:' || x FROM unnest(v_sids) x)
         OR (v_email IS NOT NULL AND dados->>'email' = v_email)
         OR dados->>'tenantId' = v_ex.tenant_id::text;
    DELETE FROM public.entradas_conta
      WHERE destino_tenant_id = v_ex.tenant_id OR conta_id = v_ex.conta_id OR sessao_id::text = ANY (v_sids)
         OR (v_email IS NOT NULL AND email = v_email);
    DELETE FROM public.pareamentos_conta
      WHERE tenant_id = v_ex.tenant_id OR pedido_sessao_id::text = ANY (v_sids);
    DELETE FROM public.bootstrap_instalacoes WHERE tenant_id = v_ex.tenant_id;
    DELETE FROM public.sessoes WHERE tenant_id = v_ex.tenant_id;
    DELETE FROM public.sessoes_corte WHERE tenant_id = v_ex.tenant_id;
    DELETE FROM public.conta_pessoas WHERE conta_id = v_ex.conta_id;
    DELETE FROM public.identidades_conta WHERE conta_id = v_ex.conta_id;
    DELETE FROM public.contas WHERE id = v_ex.conta_id;
    DELETE FROM public.dominios_admitidos WHERE tenant_id = v_ex.tenant_id;
    DELETE FROM public.pessoas WHERE tenant_id = v_ex.tenant_id;
    DELETE FROM public.tenants WHERE id = v_ex.tenant_id;
  EXCEPTION WHEN OTHERS THEN
    -- Tudo do bloco volta. Erro passageiro (deadlock, trava, serialização) conta uma tentativa e deixa a exclusão
    -- programada para a volta seguinte do laço; na 5ª, ou com qualquer outro erro, ela sai da fila com o código do
    -- erro (o laço avisa).
    PERFORM set_config('nod.purga_tenant', '', true);
    PERFORM set_config('nod.purga_conta', '', true);
    IF SQLSTATE IN ('40P01', '55P03', '40001') AND v_ex.tentativas < 4 THEN
      UPDATE public.exclusoes_conta SET tentativas = v_ex.tentativas + 1 WHERE id = p_exclusao;
    ELSE
      UPDATE public.exclusoes_conta SET estado = 'bloqueada', motivo = 'erro_' || lower(SQLSTATE),
        tentativas = least(v_ex.tentativas + 1, 5) WHERE id = p_exclusao;
    END IF;
    RETURN false;
  END;
  -- A linha da exclusão fica como prova da purga: só ids aleatórios, que não apontam para mais nada.
  UPDATE public.exclusoes_conta SET estado = 'purgada', purgada_em = clock_timestamp() WHERE id = p_exclusao;
  PERFORM set_config('nod.purga_tenant', '', true);
  PERFORM set_config('nod.purga_conta', '', true);
  RETURN true;
END
$$;
REVOKE ALL ON FUNCTION nod_purgar_conta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_purgar_conta(uuid) TO nod_app;

-- A varredura de depois: um turno de bot ou uma rotina que já estava em curso pode gravar no tenant depois do commit da
-- purga. Por uma hora depois de purgada, o laço passa de novo e apaga o que tiver chegado. Devolve quantas linhas.
CREATE FUNCTION nod_varrer_purgada(p_exclusao uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ex public.exclusoes_conta%ROWTYPE;
  v_n bigint;
BEGIN
  SELECT * INTO v_ex FROM public.exclusoes_conta WHERE id = p_exclusao;
  IF NOT FOUND OR v_ex.estado <> 'purgada' OR v_ex.purgada_em < clock_timestamp() - interval '1 hour' THEN RETURN 0; END IF;
  -- O tenant não pode ter voltado a existir (ids aleatórios; a guarda é barata).
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = v_ex.tenant_id) THEN RETURN 0; END IF;
  PERFORM set_config('nod.purga_tenant', v_ex.tenant_id::text, true);
  v_n := public.nod_purga_varrer_tenant(v_ex.tenant_id);
  PERFORM set_config('nod.purga_tenant', '', true);
  RETURN v_n;
END
$$;
REVOKE ALL ON FUNCTION nod_varrer_purgada(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_varrer_purgada(uuid) TO nod_app;

-- ROLLBACK:
-- -- O código anterior não lê nada daqui. As contas purgadas não voltam (é o objetivo); as exclusões programadas
-- -- deixam de valer e as exportações somem.
-- DROP FUNCTION nod_varrer_purgada(uuid);
-- DROP FUNCTION nod_purgar_conta(uuid);
-- DROP FUNCTION nod_purga_varrer_tenant(uuid);
-- CREATE OR REPLACE FUNCTION nod_trilha_imutavel()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- AS $$
-- BEGIN
--   RAISE EXCEPTION 'trilha é imutável (ADR-004): % recusado', TG_OP USING ERRCODE = 'P0001';
-- END;
-- $$;
-- DO $$
-- DECLARE
--   r record;
-- BEGIN
--   FOR r IN SELECT DISTINCT p.polrelid::regclass AS tbl FROM pg_policy p WHERE p.polname = 'nod_purga' LOOP
--     EXECUTE format('DROP POLICY nod_purga ON %s', r.tbl);
--   END LOOP;
-- END;
-- $$;
-- -- A nod_escopar_tabela volta à forma da 0004 tirando da definição atual só as duas linhas da purga (recriá-la daqui
-- -- perderia o comentário interno, que a convenção do rollback não deixa escrever).
-- DO $r$
-- DECLARE
--   d text := pg_get_functiondef('nod_escopar_tabela(regclass, text)'::regprocedure);
-- BEGIN
--   d := replace(d, E'  EXECUTE format(''DROP POLICY IF EXISTS nod_purga ON %s'', tbl);\n', '');
--   d := regexp_replace(d, E'  EXECUTE format\\(\\n    \\$p\\$CREATE POLICY nod_purga .*?tbl\\);\\n', '');
--   EXECUTE d;
-- END;
-- $r$;
-- CREATE OR REPLACE FUNCTION nod_criar_espaco_provisorio(p_nome text, p_iniciais text)
-- RETURNS TABLE (o_tenant_id uuid, o_pessoa_id uuid)
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = pg_catalog, public, pg_temp
-- AS $$
-- DECLARE
--   v_nome text := btrim(coalesce(p_nome, ''));
--   v_iniciais text := btrim(coalesce(p_iniciais, ''));
--   v_tenant uuid := gen_random_uuid();
--   v_pessoa uuid := gen_random_uuid();
-- BEGIN
--   IF length(v_nome) NOT BETWEEN 1 AND 80 OR length(v_iniciais) NOT BETWEEN 1 AND 3 THEN RETURN; END IF;
--   INSERT INTO public.tenants (id, nome) VALUES (v_tenant, 'Espaço de ' || v_nome);
--   INSERT INTO public.pessoas (tenant_id, id, nome, iniciais, email) VALUES (v_tenant, v_pessoa, v_nome, v_iniciais, NULL);
--   RETURN QUERY SELECT v_tenant, v_pessoa;
-- END
-- $$;
-- DROP FUNCTION nod_pessoa_existe(uuid, uuid);
-- DROP FUNCTION nod_tenant_pessoal(uuid);
-- ALTER TABLE tenants DROP COLUMN pessoal;
-- DROP TABLE exclusoes_conta;
-- DROP FUNCTION nod_exclusao_guarda();
-- DROP TABLE exportacoes;
-- DROP TRIGGER identidades_conta_nunca_vazia ON identidades_conta;
-- DROP FUNCTION nod_identidade_nunca_a_ultima();
-- REVOKE DELETE ON identidades_conta FROM nod_app;
-- REVOKE UPDATE (email) ON contas FROM nod_app;
-- DELETE FROM codigos_conta WHERE finalidade IN ('troca_email', 'reautenticacao');
-- ALTER TABLE codigos_conta DROP CONSTRAINT codigos_conta_finalidade;
-- ALTER TABLE codigos_conta ADD CONSTRAINT codigos_conta_finalidade CHECK (finalidade IN ('verificacao', 'recuperacao', 'troca_app'));
-- ALTER TABLE sessoes DROP COLUMN reautenticada_em;
-- ALTER TABLE preferencias DROP CONSTRAINT preferencias_foto;
-- ALTER TABLE preferencias DROP COLUMN foto_tipo;
-- ALTER TABLE preferencias DROP COLUMN foto;
-- ALTER TABLE preferencias DROP CONSTRAINT preferencias_sobre_mim;
-- ALTER TABLE preferencias DROP COLUMN sobre_mim;
