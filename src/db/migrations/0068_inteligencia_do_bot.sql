-- definido em 2026-10-10 (emenda da ADR-036; plano "IAs: conexão, troca e escolha de modelo", PR 2). Teste do Breno em
-- 09/10: a ligação bateu no limite do Claude, o Codex não estava pronto, e nada trocava de IA sozinho.
--
-- Cada bot ganha o MODO da inteligência ('auto' = a primeira IA pronta da ordem que não esteja no limite; 'fixa' = uma IA
-- só, que espera se ela não estiver pronta), a ORDEM própria (nula = segue a da pessoa) e o modelo e o raciocínio
-- escolhidos para CADA IA ({"claude-cli": {"modelo": "opus", "raciocinio": "medium"}}). `harness`, `modelo` e `esforco`
-- continuam e passam a ser derivados (o repositório grava os quatro juntos): é o que os caminhos de enfileiramento copiam
-- para o turno e o que o código anterior lê.
--
-- A pessoa ganha a ordem do Automático (nula = a padrão do servidor, Claude e depois Codex) e as IAs que o servidor viu
-- chegar ao limite, com o prazo ({"claude-cli": {"renovaEm": <epoch ms>, "desde": <epoch ms>}}).
SET LOCAL lock_timeout = '5s';

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS inteligencia_modo text NOT NULL DEFAULT 'auto';
ALTER TABLE agentes ADD CONSTRAINT agentes_inteligencia_modo CHECK (inteligencia_modo IN ('auto', 'fixa'));
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS ordem_ias jsonb;
ALTER TABLE agentes ADD CONSTRAINT agentes_ordem_ias CHECK (ordem_ias IS NULL OR (jsonb_typeof(ordem_ias) = 'array' AND jsonb_array_length(ordem_ias) <= 8));
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS escolhas_ia jsonb NOT NULL DEFAULT '{}';
ALTER TABLE agentes ADD CONSTRAINT agentes_escolhas_ia CHECK (jsonb_typeof(escolhas_ia) = 'object' AND octet_length(escolhas_ia::text) <= 2000);

ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS ordem_ias jsonb;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_ordem_ias CHECK (ordem_ias IS NULL OR (jsonb_typeof(ordem_ias) = 'array' AND jsonb_array_length(ordem_ias) <= 8));
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS ias_no_limite jsonb NOT NULL DEFAULT '{}';
ALTER TABLE preferencias ADD CONSTRAINT preferencias_ias_no_limite CHECK (jsonb_typeof(ias_no_limite) = 'object' AND octet_length(ias_no_limite::text) <= 2000);

-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta dos comandos, religado no MESMO bloco (regra da
-- 0005/0026/0039/0049/0061) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY;

-- Os bots de antes (decisão do Marlon, 2026-10-10):
--  1. o modelo escolhido à mão vira a escolha daquela IA, e o esforço (só do Claude até aqui) vira o raciocínio do Claude.
--     O `sonnet` era o padrão antigo (MODELO_AGENTE_PADRAO), não uma escolha: não vira escolha.
UPDATE agentes SET escolhas_ia = jsonb_strip_nulls(jsonb_build_object(
    'claude-cli', CASE
      WHEN (harness IN ('auto', 'claude-cli') AND modelo NOT IN ('auto', 'sonnet')) OR esforco IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object(
        'modelo', CASE WHEN harness IN ('auto', 'claude-cli') AND modelo NOT IN ('auto', 'sonnet') THEN modelo END,
        'raciocinio', esforco))
    END,
    -- O esforço também ia ao Codex (o `effort` do turn/start): no bot fixo nele, vira o raciocínio do Codex.
    'codex-cli', CASE WHEN harness = 'codex-cli' AND (modelo <> 'auto' OR esforco IS NOT NULL) THEN jsonb_strip_nulls(jsonb_build_object(
        'modelo', CASE WHEN modelo <> 'auto' THEN modelo END,
        'raciocinio', esforco)) END));
--  2. fixo no Sonnet (o padrão antigo, com ou sem o Claude escolhido) passa para o Automático;
UPDATE agentes SET harness = 'auto', modelo = 'auto' WHERE modelo = 'sonnet' AND harness IN ('auto', 'claude-cli');
--  3. o "auto" de antes com um modelo do Claude escolhido já rodava fixado no Claude (harnessFixado): fica explícito;
UPDATE agentes SET harness = 'claude-cli' WHERE harness = 'auto' AND modelo <> 'auto';
--  4. quem tem uma IA escolhida (e o modelo dela, ou o recomendado) fica em "Uma IA só".
UPDATE agentes SET inteligencia_modo = 'fixa' WHERE harness <> 'auto';

ALTER TABLE agentes FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- O código anterior lê só harness/modelo/esforco, que continuam gravados: num rollback de emergência dá para deixar as
-- -- colunas. Os bots que saíram do Sonnet para o Automático não voltam (o código anterior também roda o `auto/auto`).
-- ALTER TABLE preferencias DROP CONSTRAINT IF EXISTS preferencias_ias_no_limite;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS ias_no_limite;
-- ALTER TABLE preferencias DROP CONSTRAINT IF EXISTS preferencias_ordem_ias;
-- ALTER TABLE preferencias DROP COLUMN IF EXISTS ordem_ias;
-- ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_escolhas_ia;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS escolhas_ia;
-- ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_ordem_ias;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS ordem_ias;
-- ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_inteligencia_modo;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS inteligencia_modo;
