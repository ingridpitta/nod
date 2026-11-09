-- definido em 2026-09-24 (ADR-045): a queda do Mac vira UM aviso, não um card por turno.
--
-- Medido no banco diário em 24/09: 43 decisões retomar_turno em 7 dias, 100% de turnos de rotina
-- interrompidos por maquina_sem_contato, quase todas de madrugada — o Mac acorda por instantes, o
-- agendador (mesmo processo) dispara, o Mac dorme no meio do turno e o varredor de lease criava um
-- card "Retomar" E uma mensagem por turno; 24 h depois o varredor de expiração escrevia outra. Para
-- rotina, retomar não faz sentido: a próxima janela já roda sozinha.
--
-- desfecho_rotina += 'interrompida': a máquina parou no meio. Não é falhou (erro técnico da rotina)
-- nem passou_em_branco (ninguém respondeu o gate). ADD VALUE no fim, porque o gate
-- tests/conformidade/motivos-enum.test.ts compara a ORDEM com src/contracts/motivos.ts; e o valor NÃO
-- é usado nesta migração (enum novo não vale na mesma transação).
ALTER TYPE desfecho_rotina ADD VALUE IF NOT EXISTS 'interrompida';

CREATE TYPE tipo_incidente AS ENUM ('mac_sem_contato');

-- Um incidente por queda, com começo e fim. Quedas a menos de 3 h uma da outra se MESCLAM no mesmo
-- incidente (src/domain/incidente.ts); a regra mora no caso de uso interromper-por-maquina.ts.
CREATE TABLE incidentes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tipo tipo_incidente NOT NULL,
  -- A máquina que parou de responder (a primeira vista no incidente). Sem FK: machine_id é o id do
  -- computador que o próprio app anuncia, como em turnos.machine_id e rotina_janelas.machine_id.
  machine_id uuid,
  -- Último contato: a última renovação do lease do turno perdido (lease_ate − LEASE_MS).
  comecou_em timestamptz NOT NULL,
  -- Quando a máquina voltou. NULL = EM CURSO: no modo compartilhado o servidor nota a queda com o Mac
  -- ainda fora, e o varredor fecha quando ele volta a puxar. No modo local o varredor roda no próprio
  -- Mac, então notar já é ter voltado.
  voltou_em timestamptz,
  rotinas int NOT NULL DEFAULT 0 CHECK (rotinas >= 0),
  conversas int NOT NULL DEFAULT 0 CHECK (conversas >= 0),
  agentes uuid[] NOT NULL DEFAULT '{}',
  -- "Entendi": sai da tela. Fechado E dispensado não recebe queda nova (abre outro aviso).
  dispensado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT incidente_intervalo CHECK (voltou_em IS NULL OR comecou_em <= voltou_em)
);
SELECT nod_escopar_tabela('incidentes');
ALTER TABLE incidentes ADD PRIMARY KEY (tenant_id, id);
-- Um em curso por pessoa e tipo: duas quedas notadas ao mesmo tempo (varredor × entrega tardia)
-- mesclam no MESMO incidente. O caso de uso serializa por advisory lock; o índice é a trava do banco.
CREATE UNIQUE INDEX incidente_em_curso ON incidentes (tenant_id, owner_id, tipo) WHERE voltou_em IS NULL;
CREATE INDEX incidentes_visiveis ON incidentes (tenant_id, owner_id, voltou_em) WHERE dispensado_em IS NULL;

-- Limpeza: as retomar_turno ABERTAS de turnos de rotina (o próprio turno ou uma retomada dele, até
-- 5 saltos, como rotinaDoTurno) fecham por regra, com o desfecho de ADR-042 — nunca apagadas. É
-- dado de tabela escopada, então NO FORCE só em volta do comando, religado no MESMO bloco (regra da
-- 0005): sem isso o UPDATE rodado como nod_dono afeta 0 linhas em silêncio. Nas DUAS tabelas: o
-- UPDATE em decisoes lê turnos. Conferido em 2026-09-24: o trigger nod_decisao_pernas_imutaveis (0003)
-- só barra quem não é a dona quando nod.pessoa_id está definido — na migração ele é nulo, e
-- owner_id/decisor_id não mudam.
ALTER TABLE decisoes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE turnos NO FORCE ROW LEVEL SECURITY;
WITH RECURSIVE subida AS (
  SELECT d.tenant_id, d.id AS decisao_id, t.origem, t.retoma_turno_id, 0 AS saltos
  FROM decisoes d JOIN turnos t ON t.tenant_id = d.tenant_id AND t.id = d.turno_id
  WHERE d.tipo = 'retomar_turno' AND d.estado IN ('pendente', 'reaberta')
  UNION ALL
  SELECT s.tenant_id, s.decisao_id, p.origem, p.retoma_turno_id, s.saltos + 1
  FROM subida s JOIN turnos p ON p.tenant_id = s.tenant_id AND p.id = s.retoma_turno_id
  WHERE s.origem = 'retomada' AND s.saltos < 5
)
UPDATE decisoes d
SET estado = 'decidida',
    desfecho = jsonb_build_object(
      'tipo', 'decidida_por_regra',
      'regra', 'regra:rotina_nao_retoma',
      'regraVersao', 1,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    decidida_em = now()
WHERE (d.tenant_id, d.id) IN (SELECT tenant_id, decisao_id FROM subida WHERE origem = 'rotina');
ALTER TABLE turnos FORCE ROW LEVEL SECURITY;
ALTER TABLE decisoes FORCE ROW LEVEL SECURITY;

-- ROLLBACK:
-- DROP TABLE incidentes;
-- DROP TYPE tipo_incidente;
-- As retomar_turno fechadas por 'regra:rotina_nao_retoma' continuam fechadas (o turno de rotina não
-- se retoma; reabrir à mão seria inventar decisão). Não há DROP VALUE em enum: para tirar
-- 'interrompida', reclassifique as execuções (UPDATE rotina_execucoes SET desfecho = 'falhou',
-- motivo = 'maquina_sem_contato' WHERE desfecho = 'interrompida', entre NO FORCE/FORCE) e recrie o tipo.
