-- definido em 2026-10-28 (NOD-312): o turno de conversa que recomeça sem a sessão do CLI que a conversa tinha guarda o
-- porquê, para a web avisar ("↺ recomeçou", "· relê o necessário") e o Raio-X mostrar. Fonte única: a emissão do plano
-- grava 'troca_de_ia' | 'troca_de_conta' | 'troca_de_maquina' a partir das mesmas variáveis da regra de sessão (ADR-107,
-- que não muda); a repetição de uma sessão recusada nasce com 'sessao_recusada'. Nulo = turno normal (ou anterior a esta).
--
-- Só adição, sem default e sem backfill: o ADD COLUMN nulo é só catálogo. O CHECK entra NOT VALID (como a 0091): validar
-- varreria `turnos` inteira sob a trava do ALTER TABLE; a coluna nasce toda nula e as linhas novas passam pelo CHECK do
-- mesmo jeito. O ALTER TABLE segura ACCESS EXCLUSIVE em `turnos` só até o commit, sem varrer nada. lock_timeout de 5 s: se a trava não vier, a
-- migração falha e o deploy para limpo. O insert do código anterior (sem a coluna) continua passando.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos ADD COLUMN motivo_recomeco text;
ALTER TABLE turnos
  ADD CONSTRAINT turnos_motivo_recomeco_valido
    CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada')) NOT VALID;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- ALTER TABLE turnos DROP COLUMN IF EXISTS motivo_recomeco;
