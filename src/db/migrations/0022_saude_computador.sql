-- definido em 2026-09-24 (emenda da ADR-037): o computador do bot com erro REAL e aviso único.
--
-- Medido em 24/09: o computador da Nina estava "Up" mas quebrado desde 22/09 18:01 — o volume -home
-- guardou o SingletonLock do Chromium de um container antigo, o navegador não abria e o container
-- reiniciava em loop. Três camadas escondiam o erro (runtime, adaptador Docker e ferramenta) e toda
-- execução devolvia "indisponível ou tela alterada". Agora a falha tem código fechado, a saúde fica
-- no próprio computador e três falhas seguidas da máquina tiram o computador das próximas execuções.

-- Código FECHADO (src/contracts/motivos.ts, MOTIVOS_FALHA_COMPUTADOR; o gate motivos-enum compara a
-- ordem). Nenhum valor é usado nesta migração.
CREATE TYPE motivo_falha_computador AS ENUM (
  'docker_indisponivel',
  'imagem_ausente',
  'nao_iniciou',
  'cofre_invalido',
  'navegador_nao_abriu',
  'sem_resposta',
  'acao_falhou',
  'tela_alterada',
  'ocupado'
);

-- A ação que falhou diz por quê (a atividade mostra "Observar a tela · falhou ×7 · o navegador não
-- abriu"). Só em ação que falhou.
ALTER TABLE computador_acoes ADD COLUMN motivo motivo_falha_computador;
ALTER TABLE computador_acoes ADD CONSTRAINT computador_acao_motivo_so_na_falha CHECK (motivo IS NULL OR estado = 'falhou');

-- Saúde da máquina: falhas SEGUIDAS (só as que contam, src/domain/computador.ts), o motivo da última
-- e quando ela saiu do ar. Não reaproveita `ajuda` — aquela é o pedido de login do bot. Colunas
-- novas com default: nenhuma linha existente muda, então não há NO FORCE aqui.
ALTER TABLE computadores
  ADD COLUMN falhas_seguidas int NOT NULL DEFAULT 0,
  ADD COLUMN falha_motivo motivo_falha_computador,
  ADD COLUMN indisponivel_desde timestamptz;
ALTER TABLE computadores ADD CONSTRAINT computador_saude CHECK (
  falhas_seguidas >= 0
  AND (falhas_seguidas = 0) = (falha_motivo IS NULL)
  AND (indisponivel_desde IS NULL OR falhas_seguidas > 0)
);

-- ROLLBACK:
-- ALTER TABLE computadores DROP CONSTRAINT computador_saude;
-- ALTER TABLE computadores DROP COLUMN indisponivel_desde, DROP COLUMN falha_motivo, DROP COLUMN falhas_seguidas;
-- ALTER TABLE computador_acoes DROP CONSTRAINT computador_acao_motivo_so_na_falha;
-- ALTER TABLE computador_acoes DROP COLUMN motivo;
-- DROP TYPE motivo_falha_computador;
