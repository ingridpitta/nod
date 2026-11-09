-- definido em 2026-10-08 (ADR-085): quanto do Mac os bots podem usar antes de trabalho novo em segundo plano esperar.
--
-- Em 06/10 o diário rodou 8 bots ao mesmo tempo e o Mac chegou a carga 265 em 12 núcleos. A ADR-083 decidiu "sem
-- teto: o limite é a máquina"; aqui a pessoa escolhe o quanto a máquina aguenta: 'pouco' (segura já com o processador
-- começando a apertar), 'equilibrado' (com a memória em alerta ou o processador cheio) ou 'livre' (nunca segura, só o
-- aviso da ADR-083). Por pessoa, na linha de preferências dela (a 0036 já escopa a tabela).
ALTER TABLE preferencias ADD COLUMN IF NOT EXISTS uso_do_mac text NOT NULL DEFAULT 'equilibrado';
ALTER TABLE preferencias DROP CONSTRAINT IF EXISTS preferencias_uso_do_mac;
ALTER TABLE preferencias ADD CONSTRAINT preferencias_uso_do_mac CHECK (uso_do_mac IN ('pouco', 'equilibrado', 'livre'));

-- Revisão do #209: a pessoa está esperando este trabalho ("Executar agora" numa rotina, ou pedido a colega feito na
-- conversa com ela). O Mac apertado não o segura. Linhas antigas: false (segue a regra pela origem).
ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS pessoa_esperando boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE trabalhos DROP COLUMN IF EXISTS pessoa_esperando;
-- ALTER TABLE preferencias DROP CONSTRAINT preferencias_uso_do_mac;
-- ALTER TABLE preferencias DROP COLUMN uso_do_mac;
