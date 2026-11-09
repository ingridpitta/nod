-- definido em 2026-09-28: o nível de esforço do bot, o `--effort` do Claude Code (medido no `--help` da 2.1.284: low,
-- medium, high, xhigh, max). No terminal a pessoa escolhe o esforço da sessão; no nod o bot rodava sempre no padrão
-- do modelo. NULL = o padrão do modelo (nenhuma flag). Mudar o esforço não troca a sessão, diferente do modelo.
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS esforco text;
ALTER TABLE agentes ADD CONSTRAINT agentes_esforco CHECK (esforco IS NULL OR esforco IN ('low', 'medium', 'high', 'xhigh', 'max'));

-- ROLLBACK:
-- ALTER TABLE agentes DROP CONSTRAINT agentes_esforco;
-- ALTER TABLE agentes DROP COLUMN esforco;
