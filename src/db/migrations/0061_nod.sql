-- definido em 2026-10-07 (ADR-081, pedido do Marlon): o Nod é o bot fixo de cada pessoa — ajuda, onboarding e as mãos
-- dela sobre os outros bots. A guia do onboarding (a Nina, ADR-077) vira o Nod. Uma marca em agentes, um por pessoa, e o
-- banco recusa excluir, ocultar, renomear ou desmarcar o Nod (o caso de uso recusa antes, com 'nod_protegido'; o
-- gatilho é a rede para qualquer caminho futuro).
--
-- Sem gatilho de DELETE: a aplicação nunca apaga bot de verdade (excluir é excluido_em, ADR-034), e a limpeza dos
-- testes de concorrência apaga bots por dona (tests/concurrency/limpeza-e2e.ts) — revisão de engenharia de 2026-10-07.
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS papel text;
ALTER TABLE agentes ADD CONSTRAINT agentes_papel CHECK (papel IS NULL OR (papel = 'nod' AND dono = 'pessoa'));
CREATE UNIQUE INDEX IF NOT EXISTS agentes_um_nod_por_pessoa ON agentes (tenant_id, owner_id) WHERE papel = 'nod';

-- Dado de tabela escopada lido e escrito como nod_dono: NO FORCE só em volta dos comandos, religado no MESMO bloco
-- (regra da 0005/0026/0039/0049) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;

-- Um bot da pessoa que já se chama "Nod" (e não é a guia) vira "Nod (seu)": o nome fica com o bot fixo. Excluídos também
-- (restaurar um "Nod" depois deixaria dois). Bot da empresa fica: o nome reservado é entre os bots da pessoa.
UPDATE agentes a SET nome = 'Nod (seu)'
WHERE lower(trim(a.nome)) = 'nod' AND a.papel IS NULL AND a.dono = 'pessoa'
  AND NOT EXISTS (SELECT 1 FROM preferencias p WHERE p.tenant_id = a.tenant_id AND p.onboarding_guia_id = a.id);

-- A guia viva vira o Nod: mesma conversa, memória e acessos; nome, título, descrição e mascote do Nod, no topo.
-- A voz padrão da guia ('clara', feminina) vira a do Nod ('bento', masculina): ele se apresenta como "o Nod". Voz
-- escolhida pela pessoa fica.
UPDATE agentes a SET papel = 'nod', nome = 'Nod', titulo = 'Ajudante', cor = 'c-black', fixado = true, oculto = false, secao = '',
  voz = CASE WHEN a.voz IS NULL OR a.voz = 'clara' THEN 'bento' ELSE a.voz END,
  descricao = 'Seu bot fixo no Nod. Tira dúvidas sobre o produto, cria e ajusta seus bots e anota bugs e ideias para o time do Nod.'
FROM preferencias p
WHERE p.tenant_id = a.tenant_id AND p.owner_id = a.owner_id AND p.onboarding_guia_id = a.id
  AND a.excluido_em IS NULL AND a.dono = 'pessoa';

ALTER TABLE preferencias FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes FORCE ROW LEVEL SECURITY;

-- O Nod não some, não muda de nome e não deixa de ser o Nod. Restaurar (excluido_em de volta a null), fixar, modelo, voz,
-- esforço e modo continuam livres.
CREATE OR REPLACE FUNCTION nod_agente_nod_protegido() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.papel = 'nod' AND (
       NEW.papel IS DISTINCT FROM OLD.papel
    OR NEW.nome IS DISTINCT FROM OLD.nome
    OR (NEW.excluido_em IS NOT NULL AND OLD.excluido_em IS NULL)
    OR (NEW.oculto AND NOT OLD.oculto)) THEN
    RAISE EXCEPTION 'nod_protegido' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS nod_agente_nod_protegido ON agentes;
CREATE TRIGGER nod_agente_nod_protegido BEFORE UPDATE ON agentes FOR EACH ROW EXECUTE FUNCTION nod_agente_nod_protegido();

-- ROLLBACK:
-- DROP TRIGGER IF EXISTS nod_agente_nod_protegido ON agentes;
-- DROP FUNCTION IF EXISTS nod_agente_nod_protegido();
-- DROP INDEX IF EXISTS agentes_um_nod_por_pessoa;
-- ALTER TABLE agentes DROP CONSTRAINT IF EXISTS agentes_papel;
-- ALTER TABLE agentes DROP COLUMN IF EXISTS papel;
-- -- (o nome "Nod" dos bots promovidos e o "Nod (seu)" ficam: o nome anterior não é guardado)
