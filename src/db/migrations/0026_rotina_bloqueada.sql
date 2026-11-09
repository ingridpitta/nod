-- definido em 2026-09-24 (emenda da ADR-044, "rotina se trava sozinha"): a rotina que precisa de um app
-- a que o agente não tem acesso para ANTES de gastar um turno. Medido no banco diário em 24/09: a rotina
-- de Gmail da Nina rodou 3x/dia sem a concessão; cada execução gastou um turno de modelo (~US$ 0,09),
-- falhou e abriu um card. O servidor sabe antes de gastar — pela fonte da rotina e pelas concessões.
--
-- desfecho_rotina += 'bloqueada': a janela foi reivindicada (ADR-011 inalterado) e NÃO virou turno —
-- falta conexão, falta acesso ou a pergunta da execução anterior segue sem resposta. Não é falhou (não
-- houve erro), nem passou_em_branco (nada rodou para esperar um gate). ADD VALUE no fim, porque o gate
-- tests/conformidade/motivos-enum.test.ts compara a ORDEM com src/contracts/motivos.ts; e o valor NÃO é
-- usado nesta migração (enum novo não vale na mesma transação).
ALTER TYPE desfecho_rotina ADD VALUE IF NOT EXISTS 'bloqueada';

-- Os motivos do bloqueio (sem_conexao, sem_acesso, aguardando_resposta) vão em rotina_execucoes.motivo,
-- que é text com CHECK '^[a-z_]+$' (0002) e já serve os motivos de rotina: a coluna não muda. A lista
-- fechada mora em MOTIVOS_BLOQUEIO_ROTINA (src/contracts/motivos.ts). rotina_execucoes.turno_id já é
-- nulo por desenho (0002): a execução bloqueada não tem turno.

-- UM pedido de acesso aberto por (agente, app) vindo de rotina, qualquer que seja a rotina: o pré-voo
-- de duas rotinas do mesmo agente no mesmo tick, e pedir_acesso chamado por um turno de rotina, caem no
-- mesmo card (propostasRepo.criarAcessoDeRotina faz INSERT ... ON CONFLICT DO NOTHING sobre este índice).
--
-- Limpeza ANTES do índice, porque podem existir duplicatas no banco diário: a chave de dedupe da ADR-044
-- era (agente, conector, ROTINA) — duas rotinas da Nina que leem o Gmail abriam dois cards — e um pedido
-- cuja decisão venceu ficava 'pendente' enquanto o disparo seguinte abria outro. Nada é apagado: as
-- propostas saem de 'pendente' e as decisões abertas das sobras fecham por regra (ADR-042). É dado de
-- tabela escopada, então NO FORCE só em volta dos comandos, religado no MESMO bloco (regra da 0005):
-- sem isso o UPDATE rodado como nod_dono afeta 0 linhas em silêncio. Conferido em 2026-09-24: o trigger
-- nod_decisao_pernas_imutaveis (0003) só barra quem não é a dona quando nod.pessoa_id está definido — na
-- migração ele é nulo — e owner_id/decisor_id não mudam; propostas não têm trigger.
ALTER TABLE propostas NO FORCE ROW LEVEL SECURITY;
ALTER TABLE decisoes NO FORCE ROW LEVEL SECURITY;

-- (1) Pedido de rotina 'pendente' cuja decisão de mesmo id já fechou (vencida, decidida): era o card que
-- saía da tela e continuava contando como aberto. Vira 'recusada' — o mesmo destino que o varredor dá,
-- desde esta emenda, ao pedido de rotina que vence (varredor-expiracao.ts).
UPDATE propostas p
SET estado = 'recusada'
WHERE p.kind = 'acesso' AND p.estado = 'pendente' AND p.payload ? 'rotinaId'
  AND EXISTS (
    SELECT 1 FROM decisoes d
    WHERE d.tenant_id = p.tenant_id AND d.id = p.id AND d.estado NOT IN ('pendente', 'reaberta'));

-- (2) Sobras: por (dona, agente, app) fica o pedido MAIS ANTIGO (o primeiro que a pessoa viu, como o
-- "×N" da fila honesta); os outros viram 'recusada' e a decisão aberta de cada um fecha pela regra
-- 'regra:pedido_de_acesso_unico' (rótulo em web/telas/sua-vez.ts, REGRA_HUMANA).
CREATE TEMP TABLE sobras_acesso_de_rotina ON COMMIT DROP AS
SELECT tenant_id, id FROM (
  SELECT tenant_id, id, row_number() OVER (
    PARTITION BY tenant_id, owner_id, agente_id, payload->>'conector' ORDER BY criado_em, id) AS n
  FROM propostas
  WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId') ranque
WHERE n > 1;

UPDATE decisoes d
SET estado = 'decidida',
    desfecho = jsonb_build_object(
      'tipo', 'decidida_por_regra',
      'regra', 'regra:pedido_de_acesso_unico',
      'regraVersao', 1,
      'em', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    decidida_em = now()
WHERE (d.tenant_id, d.id) IN (SELECT tenant_id, id FROM sobras_acesso_de_rotina)
  AND d.estado IN ('pendente', 'reaberta');

UPDATE propostas p
SET estado = 'recusada'
WHERE (p.tenant_id, p.id) IN (SELECT tenant_id, id FROM sobras_acesso_de_rotina);

ALTER TABLE decisoes FORCE ROW LEVEL SECURITY;
ALTER TABLE propostas FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX propostas_acesso_de_rotina_aberta
  ON propostas (tenant_id, owner_id, agente_id, (payload->>'conector'))
  WHERE kind = 'acesso' AND estado = 'pendente' AND payload ? 'rotinaId';

-- ROLLBACK:
-- DROP INDEX propostas_acesso_de_rotina_aberta;
-- As propostas e decisões fechadas pela limpeza continuam fechadas (reabrir à mão seria inventar
-- pedido; o pré-voo abre um card novo na próxima janela). Não há DROP VALUE em enum: para tirar
-- 'bloqueada', apague as execuções bloqueadas (DELETE FROM rotina_execucoes WHERE desfecho = 'bloqueada',
-- entre NO FORCE/FORCE — elas não têm turno nem efeito) e recrie o tipo.
