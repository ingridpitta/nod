-- definido em 2026-10-20 (NOD-308; decisão do Marlon na NOD-221 item 3, 19/10): a conta corporativa (Team, Enterprise,
-- Business, Edu) segue a mesma regra da pessoal. A 1ª conta ativa de cada IA nasce na fila; a 2ª em diante nasce fora
-- (ADR-108 §2, termos de uso); a pessoa liga ou desliga qualquer uma. `corporativa` fica só como selo na tela.
--
-- Backfill: liga a corporativa que estaria na fila se fosse pessoal (o critério da 0080): no "Perguntar antes", nenhuma
-- outra conta ativa da mesma IA já está na fila; no "Trocar sozinho" (`contas_modo = 'automatico'`), a pessoa já
-- consentiu todas. Assim uma corporativa de posição menor não cria uma segunda conta na fila quando outra posição já
-- está ligada. Não há trilha de
-- quem tirou a conta da fila à mão (a coluna é só um boolean): quem desligou à mão uma corporativa que cai no critério
-- volta a vê-la ligada (risco 1 do plano, aceito). Removida, pessoal e corporativa já na fila não mudam.
-- Só dado (expand-only, sem DDL) e idempotente: o código anterior lê a flag como "na fila" em toda conta (ADR-108).
SET LOCAL lock_timeout = '5s';

-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta do comando, religado no MESMO bloco (regra da
-- 0005/0026/0039/0049/0061/0068/0072/0080) — o gate rls.test.ts (relforcerowsecurity) acusa se sobrar.
ALTER TABLE contas_ia NO FORCE ROW LEVEL SECURITY;
ALTER TABLE preferencias NO FORCE ROW LEVEL SECURITY;
UPDATE contas_ia c SET entra_na_troca_automatica = true
  WHERE c.removida_em IS NULL AND c.corporativa AND NOT c.entra_na_troca_automatica
    AND (EXISTS (SELECT 1 FROM preferencias p WHERE p.tenant_id = c.tenant_id AND p.owner_id = c.owner_id AND p.contas_modo = 'automatico')
      OR (NOT EXISTS (SELECT 1 FROM contas_ia x WHERE x.tenant_id = c.tenant_id AND x.owner_id = c.owner_id AND x.ia = c.ia
                        AND x.removida_em IS NULL AND x.entra_na_troca_automatica)
        AND c.id = (SELECT x.id FROM contas_ia x
                      WHERE x.tenant_id = c.tenant_id AND x.owner_id = c.owner_id AND x.ia = c.ia
                        AND x.removida_em IS NULL AND x.corporativa AND NOT x.entra_na_troca_automatica
                      ORDER BY x.posicao, x.id LIMIT 1)));
ALTER TABLE preferencias FORCE ROW LEVEL SECURITY;
ALTER TABLE contas_ia FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- -- Só dado e sem marca de quais linhas o backfill ligou: ele fica, como o da 0080. Desligar pelo predicado atingiria
-- -- também a corporativa que já estava na fila antes da migração ou foi ligada depois pela pessoa.
-- SELECT 1;
