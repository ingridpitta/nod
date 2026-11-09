-- definido em 2026-09-24: a fila da conversa fica visível e a pessoa cancela UMA mensagem por vez.
-- `mensagem_origem_id` diz qual fala da pessoa disparou o turno. Não é `mensagens.turno_id`: aquele
-- é a fala que o turno PRODUZIU (assentamento, parcial, varredor contam com isso), e misturar os dois
-- sentidos fazia a mensagem da pessoa virar "fala do turno".
ALTER TABLE turnos ADD COLUMN mensagem_origem_id uuid;
-- A prosa é apagável (nod_poda, limpeza): apagar a fala só esquece o vínculo, nunca o turno. SET NULL só
-- na coluna do vínculo — a forma composta sem lista anularia também o tenant_id.
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, mensagem_origem_id) REFERENCES mensagens (tenant_id, id) ON DELETE SET NULL (mensagem_origem_id);

-- Mensagens que chegam enquanto o agente trabalha são lidas JUNTAS no próximo turno: ao reivindicar o
-- pendente mais antigo, os outros pendentes da mesma conversa saem como interrompido/'absorvido',
-- apontando para o turno que respondeu por eles. Na tela cada mensagem continua separada.
ALTER TABLE turnos ADD COLUMN absorvido_por uuid;
ALTER TABLE turnos ADD FOREIGN KEY (tenant_id, absorvido_por) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (absorvido_por);
ALTER TYPE motivo_interrupcao ADD VALUE IF NOT EXISTS 'absorvido';

-- ROLLBACK:
-- ALTER TABLE turnos DROP COLUMN absorvido_por;
-- ALTER TABLE turnos DROP COLUMN mensagem_origem_id;
-- (o valor 'absorvido' do enum fica: Postgres não remove valor de enum; antes, UPDATE turnos SET motivo_interrupcao = 'parado_pela_pessoa' WHERE motivo_interrupcao = 'absorvido')
