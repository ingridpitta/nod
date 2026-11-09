-- definido em 2026-09-29: "Não lidos" (canvas "Nod — tela do agente", página "Não lidos").
--
-- Até onde cada pessoa leu cada conversa. O "não lido" era um booleano por agente (0011) que só a pessoa
-- ligava, à mão; nada marcava quando o bot respondia, a rotina entregava ou alguém escrevia numa sala. Com o
-- "lido até" por pessoa e conversa, o servidor conta o que chegou depois (a fala de quem não é a pessoa), a
-- web desenha a linha "Novas" acima da primeira e o lido vale em todos os aparelhos.
--
-- lido_ate guarda o criado_em da última mensagem vista, lido do próprio banco (subconsulta no repositório):
-- o ms() da borda trunca os microssegundos e deixaria a última mensagem contando como nova (a mesma armadilha
-- de mensagensRepo.janelaAte, medida em 2026-09-21).
CREATE TABLE leituras (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL,
  lido_ate timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
SELECT nod_escopar_tabela('leituras');
ALTER TABLE leituras ADD PRIMARY KEY (tenant_id, id);
ALTER TABLE leituras ADD CONSTRAINT leituras_uma_por_conversa UNIQUE (tenant_id, owner_id, conversa_id);
ALTER TABLE leituras ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);

-- Sem linha, tudo na conversa conta como novo. Para o banco que já existe não amanhecer com o histórico inteiro
-- não lido, cada conversa ganha a linha de quem a lê, lida até agora; o bot que a pessoa tinha marcado como não
-- lido fica com a última fala dele como nova. É dado de tabela escopada lido e escrito como nod_dono: NO FORCE só
-- em volta dos comandos, religado no MESMO bloco (regra da 0005/0026).
ALTER TABLE leituras NO FORCE ROW LEVEL SECURITY;
ALTER TABLE conversas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE mensagens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE salas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sala_membros NO FORCE ROW LEVEL SECURITY;

INSERT INTO leituras (tenant_id, owner_id, conversa_id, lido_ate)
SELECT c.tenant_id, a.owner_id, c.id,
  CASE WHEN a.nao_lido THEN COALESCE((
    SELECT max(m.criado_em) - interval '1 microsecond' FROM mensagens m
    WHERE m.tenant_id = c.tenant_id AND m.conversa_id = c.id AND m.kind IN ('texto', 'artefato')
      AND NOT (m.autor_tipo = 'pessoa' AND m.autor_id = a.owner_id)), clock_timestamp())
  ELSE clock_timestamp() END
FROM conversas c
JOIN agentes a ON a.tenant_id = c.tenant_id AND a.id = c.agente_id
WHERE c.tipo = 'propria'
ON CONFLICT DO NOTHING;

INSERT INTO leituras (tenant_id, owner_id, conversa_id, lido_ate)
SELECT DISTINCT s.tenant_id, quem.pessoa_id, s.conversa_id, clock_timestamp()
FROM salas s
CROSS JOIN LATERAL (
  SELECT s.owner_id AS pessoa_id
  UNION
  SELECT m.pessoa_leitora_id FROM sala_membros m
  WHERE m.tenant_id = s.tenant_id AND m.sala_id = s.id AND m.removido_em IS NULL) quem
ON CONFLICT DO NOTHING;

ALTER TABLE sala_membros FORCE ROW LEVEL SECURITY;
ALTER TABLE salas FORCE ROW LEVEL SECURITY;
ALTER TABLE mensagens FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes FORCE ROW LEVEL SECURITY;
ALTER TABLE conversas FORCE ROW LEVEL SECURITY;
ALTER TABLE leituras FORCE ROW LEVEL SECURITY;

-- agentes.nao_lido fica, sem uso: outras cópias do Nod no mesmo banco (worktrees na main) ainda a leem e gravam.
-- A remoção vem numa migração depois que esta estiver na main.

-- ROLLBACK:
-- DROP TABLE leituras;
