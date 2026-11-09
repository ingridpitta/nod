-- 0052 admissão por domínio (emenda de 2026-10-05 da ADR-030). Roda como nod_dono.
--
-- Até aqui só o seed criava pessoa. Agora, para os domínios que quem opera o nod listou em
-- NOD_ADMISSAO_DOMINIOS, a primeira entrada de uma conta Google desse domínio cria a pessoa.
--
-- nod_app continua SEM INSERT em pessoas. O caminho é uma função SECURITY DEFINER do dono, e quem decide
-- se o domínio entra é uma tabela que nod_app não lê nem escreve: o boot a iguala à variável, como nod_dono
-- (src/adapters/fundo/dominios-admitidos.ts). Uma conexão nod_app comprometida só consegue criar pessoa com
-- e-mail de um domínio admitido, que é o que qualquer conta desse domínio já consegue pelo login.

-- SEM RLS e sem GRANT para nod_app (exceção nomeada em tests/conformidade/gate-rls.ts): não tem dado de
-- pessoa e só a função abaixo a lê. O domínio é a chave: um domínio pertence a um tenant só.
CREATE TABLE dominios_admitidos (
  dominio text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants (id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dominios_admitidos_formato
    CHECK (dominio = lower(dominio) AND dominio ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);
REVOKE ALL ON dominios_admitidos FROM PUBLIC;

-- Devolve a pessoa do e-mail, criando-a quando o domínio é admitido. Zero linhas = recusa (e-mail ou nome
-- fora da forma, domínio não admitido). Corrida de duas primeiras entradas: o índice pessoas_email_unico
-- (0006) deixa uma só linha, e a segunda chamada devolve a mesma pessoa com criada = false.
-- search_path fixo: função SECURITY DEFINER não pode resolver nome pelo caminho de quem chama.
CREATE FUNCTION nod_admitir_pessoa(p_email text, p_nome text, p_iniciais text)
RETURNS TABLE (o_tenant_id uuid, o_pessoa_id uuid, o_criada boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome text := btrim(coalesce(p_nome, ''));
  v_iniciais text := btrim(coalesce(p_iniciais, ''));
  v_tenant uuid;
  v_id uuid;
BEGIN
  -- Um '@' só, 254 caracteres no máximo (RFC 5321). O CHECK pessoas_email_formato (0006) continua valendo.
  IF length(v_email) > 254 OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+$' THEN RETURN; END IF;
  IF length(v_nome) NOT BETWEEN 1 AND 80 OR length(v_iniciais) NOT BETWEEN 1 AND 3 THEN RETURN; END IF;

  SELECT d.tenant_id INTO v_tenant FROM public.dominios_admitidos d WHERE d.dominio = split_part(v_email, '@', 2);
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.pessoas (tenant_id, id, nome, iniciais, email)
  VALUES (v_tenant, gen_random_uuid(), v_nome, v_iniciais, v_email)
  ON CONFLICT (lower(email)) WHERE email IS NOT NULL DO NOTHING
  RETURNING pessoas.id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_tenant, v_id, true;
    RETURN;
  END IF;
  RETURN QUERY SELECT p.tenant_id, p.id, false FROM public.pessoas p WHERE lower(p.email) = v_email;
END
$$;

REVOKE ALL ON FUNCTION nod_admitir_pessoa(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_admitir_pessoa(text, text, text) TO nod_app;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS nod_admitir_pessoa(text, text, text);
-- DROP TABLE IF EXISTS dominios_admitidos;
-- (as pessoas já admitidas ficam: são linhas de pessoas como as do seed)
