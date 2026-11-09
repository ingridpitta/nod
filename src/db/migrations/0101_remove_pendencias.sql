-- definido em 2026-10-22 (NOD-317, PR 2): o "A fazer" (ADR-064) e o "só com pendência" (item 7 da ADR-066) saem do banco.
--
-- Decisão do Marlon em 19/10, na NOD-232. O PR 1 (#417, lançado no merge 9c6bc94c) tirou a feature do código: nenhuma
-- imagem no ar lê nem escreve `pendencias` ou `rotinas.so_com_pendencia`, então o rollback de imagem (NOD-173) volta
-- para um código que não precisa delas. SÓ MERGEAR DEPOIS DO DEPLOY DO PR 1.
--
-- Ordem (o runner já roda o arquivo numa transação só):
-- 1. Aviso, uma linha de sistema na conversa da rotina, para cada rotina com a opção cujo agente e a própria rotina não
--    foram excluídos. Autoria igual à de autoriaPessoa(owner, "regra:nod-317-a-fazer-removido") (use-cases/apoio-l7.ts):
--    o servidor escrevendo em nome da pessoa dona da rotina. Assunto sistema.generico: vai para a Atividade.
-- 2. Garantia de pausa: a forense N15 diz que as 4 de produção já estão pausadas; isto só impede que alguma acorde em
--    toda janela sem a pessoa pedir.
-- 3. As mensagens antigas com assunto 'pendencia' passam a sistema.generico: o destino já era o mesmo (atividade).
-- 4 e 5. Apaga a tabela e a coluna. As 271 linhas de produção ficam no export anexado à NOD-317 (fora do repo: tem conteúdo de conversas).
--
-- Dado de tabela escopada escrito como nod_dono: NO FORCE só em volta dos comandos, religado no MESMO bloco (regra da
-- 0005/0026/0096) — sem isso o INSERT não enxerga as rotinas e os UPDATEs mudam 0 linhas em silêncio. O trigger
-- nod_rotina_agente_ativo (0011) só dispara quando a rotina vira 'ativa'; aqui ela só vira 'pausada'.
ALTER TABLE rotinas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE mensagens NO FORCE ROW LEVEL SECURITY;

INSERT INTO mensagens (tenant_id, owner_id, conversa_id, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao,
  executor, locality, locality_reason, machine_id, decidido_por, regra_versao, kind, texto, confianca, assunto)
SELECT r.tenant_id, r.owner_id, r.conversa_id, 'pessoa', r.owner_id, NULL, r.owner_id,
  'catcher', 'local', 'tudo_local_nesta_rodada', NULL, 'regra:nod-317-a-fazer-removido', 1, 'sistema',
  'A opção "só com pendência" saiu do nod; esta rotina segue pausada e só volta se você reativar.', 'confiavel', 'sistema.generico'
FROM rotinas r
JOIN agentes a ON a.tenant_id = r.tenant_id AND a.id = r.agente_id
WHERE r.so_com_pendencia AND r.excluido_em IS NULL AND a.excluido_em IS NULL;

UPDATE rotinas SET estado = 'pausada' WHERE so_com_pendencia AND estado = 'ativa';

UPDATE mensagens SET assunto = 'sistema.generico' WHERE assunto = 'pendencia';

ALTER TABLE mensagens FORCE ROW LEVEL SECURITY;
ALTER TABLE agentes FORCE ROW LEVEL SECURITY;
ALTER TABLE rotinas FORCE ROW LEVEL SECURITY;

-- destrutiva-ok: NOD-317, feature removida no PR 1 já lançado (#417, 9c6bc94c); export anexado à NOD-317 (fora do repo)
DROP TABLE pendencias;

-- destrutiva-ok: NOD-317, "só com pendência" removido no PR 1 já lançado (#417, 9c6bc94c); nenhum código no ar lê a coluna
ALTER TABLE rotinas DROP COLUMN so_com_pendencia;

-- ROLLBACK:
-- -- As LINHAS não voltam por aqui: a tabela e a coluna voltam vazias (a coluna, toda false). Os dados de produção
-- -- voltam pelo export anexado à NOD-317; as rotinas que tinham a opção estão listadas na issue
-- -- NOD-317. Os avisos, a pausa e a troca de assunto ficam (são dado, não schema).
-- CREATE TABLE pendencias (
--   id uuid NOT NULL DEFAULT gen_random_uuid(),
--   agente_id uuid NOT NULL,
--   conversa_id uuid NOT NULL,
--   turno_id uuid,
--   texto text NOT NULL,
--   a_partir_de timestamptz,
--   cuidado boolean NOT NULL DEFAULT false,
--   profundidade smallint NOT NULL DEFAULT 0,
--   estado text NOT NULL DEFAULT 'aberta',
--   resolvida_em timestamptz,
--   resolvida_por text,
--   resolvida_no_turno_id uuid,
--   motivo text,
--   pedida_em timestamptz,
--   criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
--   CONSTRAINT pendencia_texto CHECK (char_length(texto) BETWEEN 1 AND 500),
--   CONSTRAINT pendencia_motivo CHECK (motivo IS NULL OR char_length(motivo) <= 500),
--   CONSTRAINT pendencia_estado CHECK (estado IN ('aberta', 'feita', 'descartada')),
--   CONSTRAINT pendencia_resolvida_por CHECK (resolvida_por IS NULL OR resolvida_por IN ('bot', 'pessoa')),
--   CONSTRAINT pendencia_resolvida CHECK ((estado = 'aberta') = (resolvida_em IS NULL) AND (estado = 'aberta') = (resolvida_por IS NULL)),
--   CONSTRAINT pendencia_profundidade CHECK (profundidade BETWEEN 0 AND 3)
-- );
-- SELECT nod_escopar_tabela('pendencias');
-- ALTER TABLE pendencias ADD PRIMARY KEY (tenant_id, id);
-- ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, agente_id) REFERENCES agentes (tenant_id, id);
-- ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, conversa_id) REFERENCES conversas (tenant_id, id);
-- ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, turno_id) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (turno_id);
-- ALTER TABLE pendencias ADD FOREIGN KEY (tenant_id, resolvida_no_turno_id) REFERENCES turnos (tenant_id, id) ON DELETE SET NULL (resolvida_no_turno_id);
-- CREATE INDEX pendencias_abertas_por_agente ON pendencias (tenant_id, agente_id, criado_em) WHERE estado = 'aberta';
-- CREATE INDEX pendencias_por_turno_que_resolveu ON pendencias (tenant_id, resolvida_no_turno_id) WHERE resolvida_no_turno_id IS NOT NULL;
-- ALTER TABLE rotinas ADD COLUMN so_com_pendencia boolean NOT NULL DEFAULT false;
