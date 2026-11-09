-- definido em 2026-10-23 (NOD-345, ADR-124): identidade progressiva. Usar sem conta, criar conta depois, sessões revogáveis.
--
-- Conta é identidade GLOBAL de acesso, acima dos tenants (ADR-124 §1): as tabelas de conta não têm tenant_id e são lidas
-- ANTES de existir escopo (entrar, resolver o cookie). Por isso ficam sem RLS, com exceção nomeada em
-- tests/conformidade/gate-rls.ts, e o nod_app só tem os privilégios que o código usa (nenhum DELETE nas de identidade).
-- `pessoas` e `tenants` continuam sem escrita do nod_app (ADR-003): o espaço provisório nasce pela função do dono
-- `nod_criar_espaco_provisorio`, estreita e com teste de conformidade.
--
-- Converter = ligar a conta à MESMA pessoa (conta_pessoas). Nada do espaço se move. `importacoes` (escopada) guarda a
-- idempotência de levar um espaço provisório para uma conta que já existe.
--
-- Só adição: o código anterior não lê nenhuma destas tabelas. Tudo atrás de NOD_CONTAS (desligada por padrão).
SET LOCAL lock_timeout = '5s';

-- E-mail canônico da conta: só entra aqui depois de provado (código por e-mail ou Google com email_verified).
CREATE TABLE contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT contas_email_formato CHECK (email = lower(email) AND length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
CREATE UNIQUE INDEX contas_email_unico ON contas (email);

-- Formas de entrar. Google pelo par iss+sub (nunca hd nem e-mail); senha com hash Argon2id em formato PHC (parâmetros
-- dentro do próprio texto, versionados). Uma senha por conta.
CREATE TABLE identidades_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES contas (id),
  tipo text NOT NULL,
  google_iss text,
  google_sub text,
  senha_hash text,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  atualizada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT identidades_conta_tipo CHECK (tipo IN ('google', 'senha')),
  CONSTRAINT identidades_conta_forma CHECK (
    (tipo = 'google' AND google_iss IS NOT NULL AND google_sub IS NOT NULL AND senha_hash IS NULL
       AND length(google_iss) <= 100 AND length(google_sub) <= 255)
    OR (tipo = 'senha' AND senha_hash IS NOT NULL AND google_iss IS NULL AND google_sub IS NULL AND length(senha_hash) <= 400)
  )
);
CREATE UNIQUE INDEX identidades_conta_google ON identidades_conta (google_iss, google_sub) WHERE tipo = 'google';
CREATE UNIQUE INDEX identidades_conta_uma_senha ON identidades_conta (conta_id) WHERE tipo = 'senha';

-- A conta ligada a uma pessoa de um tenant. Uma pessoa tem no máximo uma conta; uma conta, no máximo uma pessoa por tenant.
CREATE TABLE conta_pessoas (
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  conta_id uuid NOT NULL REFERENCES contas (id),
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, pessoa_id),
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id),
  CONSTRAINT conta_pessoas_uma_por_tenant UNIQUE (conta_id, tenant_id)
);

-- Sessão revogável (ADR-124 §4): o cookie leva só o id (sid), assinado. `aparelho` é o rótulo curto do User-Agent
-- (ex.: "macOS · Chrome"), nunca o cabeçalho inteiro.
CREATE TABLE sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  origem text NOT NULL,
  aparelho text NOT NULL DEFAULT '',
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  ultimo_uso_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  revogada_em timestamptz,
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id),
  CONSTRAINT sessoes_origem CHECK (origem IN ('web', 'maquina')),
  CONSTRAINT sessoes_aparelho CHECK (length(aparelho) <= 80)
);
CREATE INDEX sessoes_da_pessoa ON sessoes (tenant_id, pessoa_id) WHERE revogada_em IS NULL;

-- "Sair das outras" e senha nova também derrubam o cookie antigo, sem sid, emitido antes desta migração: a partir do
-- corte, cookie sem sid desta pessoa deixa de valer.
CREATE TABLE sessoes_corte (
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  cortado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, pessoa_id),
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id)
);

-- Códigos e tokens de uso único, só em hash (HMAC-SHA256 com o segredo do servidor):
--  verificacao (6 dígitos, 15 min, 5 tentativas; chave = sessão que pediu; dados = e-mail e hash da senha escolhida),
--  recuperacao (token de 32 bytes, 30 min; chave = conta), troca_app (60 s; o app do Mac troca por uma chave nova).
-- Pedir outro marca o anterior como usado (`usado_em`).
CREATE TABLE codigos_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finalidade text NOT NULL,
  chave text NOT NULL,
  hash bytea NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  CONSTRAINT codigos_conta_finalidade CHECK (finalidade IN ('verificacao', 'recuperacao', 'troca_app')),
  CONSTRAINT codigos_conta_chave CHECK (length(chave) BETWEEN 1 AND 200),
  CONSTRAINT codigos_conta_hash CHECK (octet_length(hash) = 32),
  CONSTRAINT codigos_conta_tentativas CHECK (tentativas >= 0),
  CONSTRAINT codigos_conta_dados CHECK (jsonb_typeof(dados) = 'object' AND octet_length(dados::text) <= 4000)
);
CREATE INDEX codigos_conta_abertos ON codigos_conta (finalidade, chave) WHERE usado_em IS NULL;
CREATE UNIQUE INDEX codigos_conta_hash_aberto ON codigos_conta (finalidade, hash) WHERE usado_em IS NULL;

-- A escolha pendente quando o e-mail ou o Google já tem conta (ADR-124 §3): nada troca de espaço até a pessoa decidir.
-- `destino_*` é a pessoa da conta que já existe (ou a pessoa legada com esse e-mail); `nova_identidade` é a forma de
-- entrar que ainda vai ser gravada ({"tipo":"senha","senhaHash":…} ou {"tipo":"google","iss":…,"sub":…}).
CREATE TABLE entradas_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessao_id uuid NOT NULL REFERENCES sessoes (id),
  destino_tenant_id uuid NOT NULL,
  destino_pessoa_id uuid NOT NULL,
  conta_id uuid REFERENCES contas (id),
  email text NOT NULL,
  nova_identidade jsonb NOT NULL DEFAULT '{}'::jsonb,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  resolvida_em timestamptz,
  resolucao text,
  FOREIGN KEY (destino_tenant_id, destino_pessoa_id) REFERENCES pessoas (tenant_id, id),
  CONSTRAINT entradas_conta_resolucao CHECK (resolucao IS NULL OR resolucao IN ('importada', 'entrou', 'outra', 'cancelada')),
  CONSTRAINT entradas_conta_identidade CHECK (jsonb_typeof(nova_identidade) = 'object' AND octet_length(nova_identidade::text) <= 1000)
);
CREATE INDEX entradas_conta_abertas ON entradas_conta (sessao_id) WHERE resolvida_em IS NULL;

-- Conectar outro computador (protótipo #j5): o computador logado gera o código (5 min, uso único, o novo invalida o
-- anterior); o novo o digita e vê 3 símbolos; o logado confirma vendo os mesmos símbolos. Código só em hash.
CREATE TABLE pareamentos_conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  hash bytea NOT NULL,
  estado text NOT NULL DEFAULT 'aguardando',
  pedido_sessao_id uuid REFERENCES sessoes (id),
  pedido_aparelho text,
  simbolos text,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  expira_em timestamptz NOT NULL,
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id),
  CONSTRAINT pareamentos_conta_hash CHECK (octet_length(hash) = 32),
  CONSTRAINT pareamentos_conta_estado CHECK (estado IN ('aguardando', 'pedido', 'confirmado', 'recusado', 'usado', 'trocado')),
  CONSTRAINT pareamentos_conta_aparelho CHECK (pedido_aparelho IS NULL OR length(pedido_aparelho) <= 80),
  CONSTRAINT pareamentos_conta_simbolos CHECK (simbolos IS NULL OR simbolos ~ '^[a-z]+(,[a-z]+){2}$')
);
CREATE UNIQUE INDEX pareamentos_conta_hash_vivo ON pareamentos_conta (hash) WHERE estado IN ('aguardando', 'pedido');
CREATE INDEX pareamentos_conta_da_pessoa ON pareamentos_conta (tenant_id, pessoa_id) WHERE estado IN ('aguardando', 'pedido', 'confirmado');

-- Instalação do app que criou um espaço provisório: o verificador fica só em hash e torna o bootstrap idempotente.
-- `aposentada_em`: o espaço virou conta (ou o trabalho foi levado para uma). A linha fica para a instalação NÃO ganhar
-- um espaço novo e vazio em silêncio quando a sessão da conta cair: ela volta à tela de entrar.
CREATE TABLE bootstrap_instalacoes (
  verificador_hash bytea PRIMARY KEY,
  tenant_id uuid NOT NULL,
  pessoa_id uuid NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  aposentada_em timestamptz,
  FOREIGN KEY (tenant_id, pessoa_id) REFERENCES pessoas (tenant_id, id),
  CONSTRAINT bootstrap_instalacoes_hash CHECK (octet_length(verificador_hash) = 32)
);

-- Limites contra abuso por janela fixa. A chave nunca leva IP nem e-mail em claro: é um HMAC deles.
CREATE TABLE limites_conta (
  chave text NOT NULL,
  janela timestamptz NOT NULL,
  contagem integer NOT NULL DEFAULT 0,
  PRIMARY KEY (chave, janela),
  CONSTRAINT limites_conta_chave CHECK (length(chave) BETWEEN 1 AND 120),
  CONSTRAINT limites_conta_contagem CHECK (contagem >= 0)
);

REVOKE ALL ON contas, identidades_conta, conta_pessoas, sessoes, sessoes_corte, codigos_conta, entradas_conta,
  pareamentos_conta, bootstrap_instalacoes, limites_conta FROM PUBLIC;
GRANT SELECT, INSERT ON contas, conta_pessoas TO nod_app;
-- UPDATE: ao virar conta, o verificador da instalação é aposentado (aposentada_em; não abre mais sessão no espaço).
GRANT SELECT, INSERT ON bootstrap_instalacoes TO nod_app;
GRANT UPDATE (aposentada_em) ON bootstrap_instalacoes TO nod_app;
GRANT SELECT, INSERT, UPDATE ON identidades_conta, sessoes, sessoes_corte, codigos_conta, entradas_conta, pareamentos_conta TO nod_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON limites_conta TO nod_app;

-- Importação de um espaço provisório para a conta que já existia: gravada na MESMA transação do destino, que só copia
-- (nunca sobrescreve). A chave primária torna a repetição idempotente.
CREATE TABLE importacoes (
  origem_tenant_id uuid NOT NULL,
  origem_pessoa_id uuid NOT NULL,
  contagem jsonb NOT NULL DEFAULT '{}'::jsonb,
  feita_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT importacoes_contagem CHECK (jsonb_typeof(contagem) = 'object' AND octet_length(contagem::text) <= 2000)
);
SELECT nod_escopar_tabela('importacoes');
ALTER TABLE importacoes ADD PRIMARY KEY (tenant_id, origem_tenant_id, origem_pessoa_id);

-- O espaço provisório (ADR-124 §2): um tenant pessoal e uma pessoa sem e-mail e sem conta. Só isso; o Nod fixo e a chave
-- de máquina nascem depois, pelo nod_app, já no escopo novo. search_path fixo (SECURITY DEFINER).
CREATE FUNCTION nod_criar_espaco_provisorio(p_nome text, p_iniciais text)
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
  INSERT INTO public.tenants (id, nome) VALUES (v_tenant, 'Espaço de ' || v_nome);
  INSERT INTO public.pessoas (tenant_id, id, nome, iniciais, email) VALUES (v_tenant, v_pessoa, v_nome, v_iniciais, NULL);
  RETURN QUERY SELECT v_tenant, v_pessoa;
END
$$;
REVOKE ALL ON FUNCTION nod_criar_espaco_provisorio(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nod_criar_espaco_provisorio(text, text) TO nod_app;

-- ROLLBACK:
-- -- O código anterior não lê nada daqui: voltar a imagem basta. Os espaços provisórios criados ficam como tenants e
-- -- pessoas comuns, sem conta (o login antigo não os alcança).
-- DROP FUNCTION nod_criar_espaco_provisorio(text, text);
-- DROP TABLE importacoes;
-- DROP TABLE limites_conta;
-- DROP TABLE bootstrap_instalacoes;
-- DROP TABLE pareamentos_conta;
-- DROP TABLE entradas_conta;
-- DROP TABLE codigos_conta;
-- DROP TABLE sessoes_corte;
-- DROP TABLE sessoes;
-- DROP TABLE conta_pessoas;
-- DROP TABLE identidades_conta;
-- DROP TABLE contas;
