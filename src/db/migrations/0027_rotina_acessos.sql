-- definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a rotina DECLARA os apps que
-- lê ou altera, na forma já normalizada do pedido de acesso (src/contracts/acesso.ts, AcessoPedido:
-- conector, capacidades, nivel, naoPedido). A rotina de Gmail da Nina nasceu em 18/09 com fonte "Gmail do
-- Marlon" e nada pediu o acesso que ela obviamente precisava: falhou desde a primeira execução. A pessoa
-- está presente na criação — é ali que ela consente, e confirmar a rotina concede o que foi declarado.
--
-- NULL = rotina anterior a esta emenda, sem declaração: o pré-voo (0026) segue lendo a fonte. Presente,
-- mesmo vazia, a declaração ganha da fonte (necessidadesDaRotina, src/domain/rotina-acessos.ts). Sem
-- backfill: inferir da fonte o que cada rotina antiga declara seria interpretar texto.
--
-- Nenhuma policy muda: a tabela já passou por nod_escopar_tabela na 0002, e coluna nova não mexe em RLS
-- (mesma forma das 0011/0012/0020).
ALTER TABLE rotinas ADD COLUMN acessos jsonb;

ALTER TABLE rotinas ADD CONSTRAINT rotinas_acessos_lista
  CHECK (acessos IS NULL OR jsonb_typeof(acessos) = 'array');

-- ROLLBACK:
-- ALTER TABLE rotinas DROP CONSTRAINT rotinas_acessos_lista;
-- ALTER TABLE rotinas DROP COLUMN acessos;
-- As concessões feitas ao confirmar uma rotina continuam (cada uma cita o consentimento imutável da
-- pessoa, ADR-013): revogar é pela tela, por capacidade.
