-- definido em 2026-09-29 (ADR-059): o modo de aprovação de cada bot, escolhido pela dona no chip do campo (canvas
-- "Nod — tela do agente", página "Aprovações"). 'manual' é o de sempre: o que muda algo pede a pessoa. 'automatico':
-- o bot aprova as próprias ações e para no arriscado, na credencial e no que vem depois de conteúdo de fora.
-- 'total': aprova tudo; só credencial do Mac para. Coluna do agente, não da conversa: vale em conversa e em rotina.
-- O modo não concede nada: o catálogo continua sendo concessão ∩ conector (ADR-013), e o servidor decide cada
-- pedido lendo o modo ATUAL do agente, não o do plano (trocar para mais restrito vale na próxima ação).
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS modo_aprovacao text NOT NULL DEFAULT 'manual';
ALTER TABLE agentes ADD CONSTRAINT agentes_modo_aprovacao CHECK (modo_aprovacao IN ('manual', 'automatico', 'total'));

-- Por que um pedido parou mesmo com o modo automático (a pessoa lê no card; ADR-029: pausa em silêncio é negação seca).
ALTER TYPE motivo_aprovacao_manual ADD VALUE IF NOT EXISTS 'acao_arriscada';
ALTER TYPE motivo_aprovacao_manual ADD VALUE IF NOT EXISTS 'toca_credencial';

-- ROLLBACK:
-- ALTER TABLE agentes DROP CONSTRAINT agentes_modo_aprovacao;
-- ALTER TABLE agentes DROP COLUMN modo_aprovacao;
-- (valor de enum não se remove no Postgres; 'acao_arriscada' e 'toca_credencial' ficam sem uso)
