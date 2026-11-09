-- definido em 2026-10-23 (NOD-313): a sugestão de espaçar ou pausar a rotina que roda muitas vezes sem novidade.
--
-- `rotina_ritmo`: uma linha por rotina, criada na primeira execução sem novidade. `sem_novidade_seguidas` soma a cada
-- execução sem novidade e zera quando a rotina executa ou falha (domain/ritmo-rotina.ts, efeitoNaContagem); com 20
-- seguidas o nod escreve UM card na conversa da rotina. `sugerida_em`: desde quando o card está aberto (nulo = nenhum
-- aberto) — só um por rotina, reivindicado sob a trava da linha. `sugestao_mensagem_id`: a mensagem do último card (o
-- clique e o "desfazer" só valem para ela). `silenciada_ate`: o "Deixar como está" cala a sugestão por 30 dias.
-- `desfazer`: o que o "desfazer" do card restaura (o cron e o estado de antes do clique).
--
-- REGRA: a rotina nunca muda sozinha. Esta tabela só guarda a contagem e o card; a mudança é o clique da pessoa.
-- Só adição: o código anterior não lê esta tabela. Sem FK para mensagens (a linha da mensagem nasce depois, na mesma
-- transação, no padrão de `trocas_de_ia`).
SET LOCAL lock_timeout = '5s';

CREATE TABLE rotina_ritmo (
  rotina_id uuid NOT NULL,
  sem_novidade_seguidas integer NOT NULL DEFAULT 0,
  sugestao_mensagem_id uuid,
  sugerida_em timestamptz,
  silenciada_ate timestamptz,
  desfazer jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rotina_ritmo_seguidas CHECK (sem_novidade_seguidas >= 0),
  CONSTRAINT rotina_ritmo_desfazer CHECK (desfazer IS NULL OR (jsonb_typeof(desfazer) = 'object' AND octet_length(desfazer::text) <= 2000))
);
SELECT nod_escopar_tabela('rotina_ritmo');
ALTER TABLE rotina_ritmo ADD PRIMARY KEY (tenant_id, rotina_id);
-- ON DELETE CASCADE: a linha é só contagem e card de uma rotina; apagar a rotina de vez (limpeza, e2e) leva a linha junto.
ALTER TABLE rotina_ritmo ADD FOREIGN KEY (tenant_id, rotina_id) REFERENCES rotinas (tenant_id, id) ON DELETE CASCADE;

-- ROLLBACK:
-- -- O código anterior não lê a tabela: voltar a imagem basta. Os cards já escritos ficam no chat como linhas de
-- -- sistema; o código anterior não conhece o payload `rotina_ritmo` e os desenha como uma linha comum.
-- DROP TABLE rotina_ritmo;
