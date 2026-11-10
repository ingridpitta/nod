-- definido em 2026-11-10 (pedido do Marlon via Ada, sem issue): a triagem diária dos relatos (ADR-041, ADR-081) roda pelo
-- psql na nod-vm. Quem tria precisa LER os relatos e a prosa de TODOS os tenants e marcar cada um (novo, no_backlog,
-- feito, descartado) com a tarefa que ele virou — e mais nada.
--
-- O caminho é o mesmo da poda de versões (0132): policies TO nod_dono que só abrem com o GUC `nod.triagem`, e esse GUC
-- só é ligado dentro das três funções abaixo (set_config local na entrada, desligado antes de sair; em erro
-- a transação ou o savepoint desfaz o GUC junto). A cláusula SET da função não serve: GUC customizado ali exige
-- superusuário. Sem papel nem senha novos: a nod-vm já tem DATABASE_URL_DONO.
-- As funções são SECURITY INVOKER (revisão do PR #726): quem chama é a própria dona, então DEFINER não acrescenta nada e
-- só alarga o estrago de um GRANT EXECUTE por engano (o nod_app passaria a ler como nod_dono, de todos os tenants).
-- Como INVOKER, quem não é nod_dono roda sob as próprias policies, e as nod_triagem_* não valem para ele.
--   - 'ler' abre só SELECT em relatos e relato_prosa (nod_triagem_leitura);
--   - 'marcar' abre SELECT e UPDATE em relatos (nod_triagem_marcar), e o trigger nod_triagem_so_rastreio barra mudança
--     em qualquer coluna fora de estado, tarefa_ref e triado_em. Não há policy de INSERT nem de DELETE: a triagem não
--     cria nem apaga relato.
-- A policy nod_purga continua como estava, e o nod_app não ganha nada (nem EXECUTE: REVOKE ALL FROM PUBLIC).
-- nod_dono é a dona das tabelas e já pode tudo nelas por DDL; o que isto fecha é o uso do dia a dia: quem roda a rotina
-- só lê e só marca, e o acesso cross-tenant passa por um nome que aparece no catálogo e no gate de RLS.
--
-- Só adição: o código anterior não lê as colunas novas, e o INSERT dele cai no default 'novo'.
SET LOCAL lock_timeout = '5s';

ALTER TABLE relatos
  ADD COLUMN estado text NOT NULL DEFAULT 'novo',
  ADD COLUMN tarefa_ref text,
  ADD COLUMN triado_em timestamptz;
ALTER TABLE relatos ADD CONSTRAINT relatos_estado CHECK (estado IN ('novo', 'no_backlog', 'feito', 'descartado')) NOT VALID;
-- Identificador de issue do Linear (ADA-123, NOD-45): prefixo em maiúsculas e número. Nada de URL nem texto livre.
ALTER TABLE relatos ADD CONSTRAINT relatos_tarefa_ref CHECK (tarefa_ref IS NULL OR tarefa_ref ~ '^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]{0,6}$') NOT VALID;
ALTER TABLE relatos VALIDATE CONSTRAINT relatos_estado;
ALTER TABLE relatos VALIDATE CONSTRAINT relatos_tarefa_ref;
-- A fila da triagem: os novos, do mais antigo ao mais recente, de todos os tenants.
CREATE INDEX relatos_triagem ON relatos (estado, criado_em);

CREATE POLICY nod_triagem_leitura ON relatos AS PERMISSIVE FOR SELECT TO nod_dono
  USING (current_setting('nod.triagem', true) IN ('ler', 'marcar'));
CREATE POLICY nod_triagem_leitura ON relato_prosa AS PERMISSIVE FOR SELECT TO nod_dono
  USING (current_setting('nod.triagem', true) = 'ler');
CREATE POLICY nod_triagem_marcar ON relatos AS PERMISSIVE FOR UPDATE TO nod_dono
  USING (current_setting('nod.triagem', true) = 'marcar')
  WITH CHECK (current_setting('nod.triagem', true) = 'marcar');

-- A policy de UPDATE concede qualquer coluna; o trigger fecha a lista nas três do rastreio (molde de
-- nod_decisao_pernas_imutaveis). E o contrário para o resto: fora do modo 'marcar', ninguém grava as três.
CREATE FUNCTION nod_triagem_so_rastreio()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_marcar boolean := coalesce(current_setting('nod.triagem', true), '') = 'marcar';
BEGIN
  -- Fora do modo 'marcar' (o nod_app sempre): o rastreio é da triagem. O relato nasce 'novo', sem tarefa nem data, e o
  -- UPDATE do código não mexe nessas três colunas — senão um relato sairia da fila sem ninguém ter triado (Codex).
  IF NOT v_marcar THEN
    IF TG_OP = 'INSERT' AND (NEW.estado <> 'novo' OR NEW.tarefa_ref IS NOT NULL OR NEW.triado_em IS NOT NULL) THEN
      RAISE EXCEPTION 'relato nasce novo; o rastreio é da triagem' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND (NEW.estado, NEW.tarefa_ref, NEW.triado_em) IS DISTINCT FROM (OLD.estado, OLD.tarefa_ref, OLD.triado_em) THEN
      RAISE EXCEPTION 'só a triagem altera estado, tarefa_ref e triado_em' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE'
     AND to_jsonb(NEW) - ARRAY['estado', 'tarefa_ref', 'triado_em'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['estado', 'tarefa_ref', 'triado_em'] THEN
    RAISE EXCEPTION 'a triagem só altera estado, tarefa_ref e triado_em' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER nod_triagem_so_rastreio BEFORE INSERT OR UPDATE ON relatos
  FOR EACH ROW EXECUTE FUNCTION nod_triagem_so_rastreio();

-- Liga o modo da triagem para a função que chama. Chegar com o GUC já ligado é alguém tentando abrir a policy por fora (ou
-- uma função da triagem chamando outra): recusa, como a poda da 0132. Sem EXECUTE para ninguém além da dona.
CREATE FUNCTION nod_triagem_ligar(p_modo text)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF coalesce(current_setting('nod.triagem', true), '') <> '' THEN
    RAISE EXCEPTION 'triagem com GUC já ligado' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('nod.triagem', p_modo, true);
END;
$$;

-- A fila: relatos de todos os tenants, sem o trecho da conversa (que pode ser grande; está em triagem_relato).
-- p_estado NULL lista todos os estados.
CREATE FUNCTION triagem_relatos(p_estado text DEFAULT 'novo', p_limite integer DEFAULT 200)
RETURNS TABLE (
  id uuid, tenant_id uuid, autor_id uuid, criado_em timestamptz, tipo text, origem text, categoria categoria_relato,
  estado text, tarefa_ref text, triado_em timestamptz, titulo text, texto_pessoa text, versao_app text, modelo text,
  motivo_falha motivo_falha, conversa_id uuid, mensagem_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM nod_triagem_ligar('ler');
  RETURN QUERY
    SELECT r.id, r.tenant_id, r.owner_id, r.criado_em, r.tipo, r.origem, r.categoria, r.estado, r.tarefa_ref, r.triado_em,
           p.titulo, p.texto_pessoa, r.versao_app, r.modelo, r.motivo_falha, r.conversa_id, r.mensagem_id
      FROM relatos r
      LEFT JOIN LATERAL (SELECT rp.titulo, rp.texto_pessoa FROM relato_prosa rp
                          WHERE rp.tenant_id = r.tenant_id AND rp.relato_id = r.id ORDER BY rp.id LIMIT 1) p ON true
     WHERE p_estado IS NULL OR r.estado = p_estado
     ORDER BY r.criado_em, r.id
     LIMIT least(greatest(coalesce(p_limite, 200), 1), 1000);
  PERFORM set_config('nod.triagem', '', true);
END;
$$;

-- Um relato inteiro, com o trecho da conversa e os metadados de diagnóstico.
CREATE FUNCTION triagem_relato(p_id uuid)
RETURNS TABLE (
  id uuid, tenant_id uuid, autor_id uuid, criado_em timestamptz, tipo text, origem text, categoria categoria_relato,
  alcance alcance_relato, estado text, tarefa_ref text, triado_em timestamptz, titulo text, texto_pessoa text, trecho jsonb,
  estado_turno estado_turno, motivo_falha motivo_falha, motivo_interrupcao motivo_interrupcao, sinais jsonb, modelo text,
  harness text, executor text, versao_app text, conversa_id uuid, mensagem_id uuid, turno_id uuid, correlation_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM nod_triagem_ligar('ler');
  RETURN QUERY
    SELECT r.id, r.tenant_id, r.owner_id, r.criado_em, r.tipo, r.origem, r.categoria, r.alcance, r.estado, r.tarefa_ref,
           r.triado_em, p.titulo, p.texto_pessoa, p.trecho, r.estado_turno, r.motivo_falha, r.motivo_interrupcao, r.sinais,
           r.modelo, r.harness, r.executor, r.versao_app, r.conversa_id, r.mensagem_id, r.turno_id, r.correlation_id
      FROM relatos r
      LEFT JOIN LATERAL (SELECT rp.titulo, rp.texto_pessoa, rp.trecho FROM relato_prosa rp
                          WHERE rp.tenant_id = r.tenant_id AND rp.relato_id = r.id ORDER BY rp.id LIMIT 1) p ON true
     WHERE r.id = p_id;
  PERFORM set_config('nod.triagem', '', true);
END;
$$;

-- Marca um relato: estado, a tarefa que ele virou (opcional) e triado_em = now(). Só essas três colunas (o trigger acima
-- garante). Id que não existe é erro, não silêncio. p_tarefa_ref NULL mantém a referência que já estava (no_backlog →
-- feito não perde a tarefa); '' limpa.
CREATE FUNCTION triagem_marcar(p_id uuid, p_estado text, p_tarefa_ref text DEFAULT NULL)
RETURNS TABLE (id uuid, tenant_id uuid, estado text, tarefa_ref text, triado_em timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_id IS NULL OR p_estado IS NULL THEN
    RAISE EXCEPTION 'triagem_marcar exige id e estado' USING ERRCODE = '22004';
  END IF;
  PERFORM nod_triagem_ligar('marcar');
  RETURN QUERY
    UPDATE relatos r
       SET estado = p_estado,
           tarefa_ref = CASE WHEN p_tarefa_ref IS NULL THEN r.tarefa_ref ELSE nullif(btrim(p_tarefa_ref), '') END,
           triado_em = now()
     WHERE r.id = p_id
    RETURNING r.id, r.tenant_id, r.estado, r.tarefa_ref, r.triado_em;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'relato % não encontrado', p_id USING ERRCODE = 'P0002';
  ELSIF v_n > 1 THEN
    RAISE EXCEPTION 'id % repetido entre tenants; nada foi marcado', p_id USING ERRCODE = '21000';
  END IF;
  PERFORM set_config('nod.triagem', '', true);
END;
$$;

REVOKE ALL ON FUNCTION triagem_relatos(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION triagem_relato(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION triagem_marcar(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nod_triagem_so_rastreio() FROM PUBLIC;
REVOKE ALL ON FUNCTION nod_triagem_ligar(text) FROM PUBLIC;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- DROP FUNCTION IF EXISTS triagem_marcar(uuid, text, text);
-- DROP FUNCTION IF EXISTS triagem_relato(uuid);
-- DROP FUNCTION IF EXISTS triagem_relatos(text, integer);
-- DROP FUNCTION IF EXISTS nod_triagem_ligar(text);
-- DROP TRIGGER IF EXISTS nod_triagem_so_rastreio ON relatos;
-- DROP FUNCTION IF EXISTS nod_triagem_so_rastreio();
-- DROP POLICY IF EXISTS nod_triagem_marcar ON relatos;
-- DROP POLICY IF EXISTS nod_triagem_leitura ON relato_prosa;
-- DROP POLICY IF EXISTS nod_triagem_leitura ON relatos;
-- DROP INDEX IF EXISTS relatos_triagem;
-- ALTER TABLE relatos DROP CONSTRAINT IF EXISTS relatos_tarefa_ref;
-- ALTER TABLE relatos DROP CONSTRAINT IF EXISTS relatos_estado;
-- ALTER TABLE relatos DROP COLUMN IF EXISTS triado_em;
-- ALTER TABLE relatos DROP COLUMN IF EXISTS tarefa_ref;
-- ALTER TABLE relatos DROP COLUMN IF EXISTS estado;
