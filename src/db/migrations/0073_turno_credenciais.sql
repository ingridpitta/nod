-- definido em 2026-10-12 (NOD-214, emenda à ADR-071 e revisão da EMENDA 3 da ADR-024): o token de turno passa a ter o
-- HASH persistido. Até aqui ele vivia só na memória do servidor, e todo deploy perdia os tokens: a drenagem do SIGTERM
-- (NOD-175) esperava cada turno em curso terminar — com uma frente longa, o deploy ficava preso até o teto de 10 min e
-- a fila parava junto. Com a credencial no banco, o processo novo reconhece o turno que a máquina continuou rodando
-- (a ADOÇÃO, em rotas/ponte.ts) e o plano dele volta a ser servido ao proxy do turno.
--
-- Uma linha por turno despachado (`turno_id` é a chave). `token_hash` é o sha256 do token INTEIRO — o token em claro
-- nunca é gravado. `epoch` é o do token vivo (cunhar de novo avança). `identidade` é {tenantId, pessoaId, agenteId}.
-- `harness`, `executor`, `modo`, `despachado_em` e `bifurcou` são o que a ponte guardava só em memória e que a entrega
-- e a rede de 2 min precisam depois de um reinício. `sobrevive_reinicio` é o anúncio da máquina no despacho (só o
-- cliente que atravessa o reinício libera a drenagem). `falas_seq` é o maior `seq` de fala intermediária já gravado.
-- Nasce na tx do puxar e sai ao assentar ou ao revogar o token.
-- Só adição (expand-only): tabela nova, que o código anterior não lê.
SET LOCAL lock_timeout = '5s';
CREATE TABLE turno_credenciais (
  turno_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  epoch integer NOT NULL,
  identidade jsonb NOT NULL,
  harness text,
  executor text NOT NULL,
  modo text,
  despachado_em timestamptz NOT NULL,
  bifurcou boolean NOT NULL DEFAULT false,
  sobrevive_reinicio boolean NOT NULL DEFAULT false,
  falas_seq integer NOT NULL DEFAULT 0,
  CONSTRAINT credencial_hash CHECK (octet_length(token_hash) = 32),
  CONSTRAINT credencial_epoch CHECK (epoch >= 1),
  CONSTRAINT credencial_identidade CHECK (jsonb_typeof(identidade) = 'object' AND octet_length(identidade::text) <= 400),
  CONSTRAINT credencial_harness CHECK (harness IS NULL OR char_length(harness) <= 40),
  CONSTRAINT credencial_executor CHECK (char_length(executor) BETWEEN 1 AND 40),
  CONSTRAINT credencial_modo CHECK (modo IS NULL OR char_length(modo) <= 40),
  CONSTRAINT credencial_falas_seq CHECK (falas_seq >= 0)
);
SELECT nod_escopar_tabela('turno_credenciais');
ALTER TABLE turno_credenciais ADD PRIMARY KEY (tenant_id, turno_id);
-- O turno apagado (só a limpeza dos testes apaga turno) leva a credencial junto; o código nunca apaga turno.
ALTER TABLE turno_credenciais ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id) ON DELETE CASCADE;
-- O token apresentado é procurado pelo hash, no escopo que ele alega (como a chave de máquina, ADR-031).
CREATE UNIQUE INDEX turno_credenciais_por_hash ON turno_credenciais (tenant_id, owner_id, token_hash);

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. Os turnos em curso no momento perdem a credencial, como
-- -- em todo deploy antes da NOD-214 — caem em plano_ausente e o varredor de lease os assenta.
-- DROP INDEX turno_credenciais_por_hash;
-- DROP TABLE turno_credenciais;
