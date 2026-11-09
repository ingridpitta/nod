-- definido em 2026-10-18 (ADR-113, plano "pergunta com botões", Parte 5): reações a uma fala ("👍 1" embaixo do balão).
--
-- Uma linha por pessoa, fala e emoji (`reacoes_uma_por_pessoa`): pôr de novo não duplica (ON CONFLICT DO NOTHING) e tirar
-- apaga a da própria pessoa. A dona da linha (`owner_id`, de nod_escopar_tabela) é quem reagiu.
-- RLS como em `mensagens` (0002): a dona lê as suas, e a perna extra deixa quem é da sala ler as reações das falas dela;
-- pôr e tirar só a própria (as policies por comando da 0004). `conversa_id` fica na linha para a perna e para a leitura
-- da janela não precisarem do join com `mensagens`; o caso de uso grava o da fala citada (reagir.ts).
-- O bot NÃO lê reações na v1 (decisão 2 do plano): nenhuma consulta do plano de turno toca esta tabela.
-- `emoji` é da lista fechada de src/contracts/reacao.ts (o servidor recusa o resto); o CHECK só barra texto longo.
-- ON DELETE CASCADE na fala: a limpeza por id dos testes de concorrência apaga mensagens; reação não segura uma fala.
-- Só adição: o código anterior não lê a tabela.
SET LOCAL lock_timeout = '5s';

CREATE TABLE reacoes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  mensagem_id uuid NOT NULL,
  emoji text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT reacao_emoji CHECK (char_length(emoji) BETWEEN 1 AND 16)
);
SELECT nod_escopar_tabela('reacoes', $p$EXISTS (
  SELECT 1 FROM conversas c JOIN sala_membros m ON m.tenant_id = c.tenant_id AND m.sala_id = c.sala_id
  WHERE c.tenant_id = reacoes.tenant_id AND c.id = reacoes.conversa_id
    AND m.pessoa_leitora_id = current_setting('nod.pessoa_id')::uuid AND m.removido_em IS NULL)$p$);
ALTER TABLE reacoes ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE reacoes ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
ALTER TABLE reacoes ADD FOREIGN KEY (tenant_id, mensagem_id) REFERENCES mensagens (tenant_id, id) ON DELETE CASCADE;
CREATE UNIQUE INDEX reacoes_uma_por_pessoa ON reacoes (tenant_id, mensagem_id, owner_id, emoji);

-- ROLLBACK:
-- DROP TABLE IF EXISTS reacoes;
