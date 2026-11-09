-- definido em 2026-10-05: "Agora não" no cartão que oferece liberar um app recém-conectado para o bot da conversa.
--
-- Medido no mesmo dia em produção: uma pessoa nova conectou o Gmail e o Slack pelo Marketplace no meio da conversa,
-- escreveu "já liberei" e o bot continuou sem acesso — conectar o app e liberá-lo para UM bot são dois passos, e só o
-- primeiro aparecia. A conversa passou a oferecer o segundo (web/telas/card-liberar.ts). O cartão não é uma decisão
-- nem uma proposta: é desenhado do que já existe (conectores, concessões). Só a dispensa precisa ser guardada.
--
-- Uma linha por pessoa, bot e app, como `leituras` (0039) guarda o "lido até" por pessoa e conversa. Mora no banco e
-- não no localStorage porque o app do Mac o apaga a cada conexão (o mesmo motivo de `preferencias`, 0036). A dispensa
-- vale para a conexão que a pessoa viu: se o app for conectado de novo depois de `dispensado_em`, a oferta volta.
--
-- O número pula a 0053: ela está reservada para um trabalho paralelo do mesmo dia.
CREATE TABLE liberacoes_dispensadas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL,
  conector_id uuid NOT NULL,
  dispensado_em timestamptz NOT NULL
);
SELECT nod_escopar_tabela('liberacoes_dispensadas');
ALTER TABLE liberacoes_dispensadas ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE liberacoes_dispensadas ADD CONSTRAINT liberacoes_dispensadas_uma_por_app UNIQUE (tenant_id, owner_id, agente_id, conector_id);
-- A dispensa é só uma preferência de tela: some junto com o bot ou com o app, sem segurar a exclusão de nenhum dos dois.
ALTER TABLE liberacoes_dispensadas ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id) ON DELETE CASCADE;
ALTER TABLE liberacoes_dispensadas ADD FOREIGN KEY (tenant_id, conector_id) REFERENCES conectores (tenant_id, id) ON DELETE CASCADE;

-- ROLLBACK:
-- DROP TABLE liberacoes_dispensadas;
