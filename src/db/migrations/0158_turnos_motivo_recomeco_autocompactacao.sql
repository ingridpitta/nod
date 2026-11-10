-- definido em 2026-11-09 (NOD-480, emenda da ADR-040): o turno que parou com "o histórico enche de novo logo depois de
-- resumido" (`autocompact_thrashing` do Claude Code) se repete UMA vez numa sessão nova, sem --resume, e nasce com o
-- motivo de recomeço 'autocompactacao' (a web marca "↺ recomeçou"; a emissão leva o aviso e o resumo do trabalho, ou a
-- passagem de bastão na frente). A segunda falha com o mesmo motivo mostra o aviso.
--
-- Só troca o CHECK da 0119 por um com o valor novo. Entra NOT VALID, como o de antes: validar varreria `turnos` inteira
-- sob a trava do ALTER TABLE; as linhas antigas já passaram pelo CHECK de antes, que é um subconjunto deste. lock_timeout
-- de 5 s: sem a trava, a migração falha e o deploy para limpo.
SET LOCAL lock_timeout = '5s';

ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
ALTER TABLE turnos
  ADD CONSTRAINT turnos_motivo_recomeco_valido
    CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada', 'autocompactacao')) NOT VALID;

-- ROLLBACK:
-- SET LOCAL lock_timeout = '5s';
-- -- A linha que já usa o valor novo faria o CHECK de antes falhar no próximo UPDATE dela: volta ao nulo (é só a marca).
-- UPDATE turnos SET motivo_recomeco = NULL WHERE motivo_recomeco = 'autocompactacao';
-- ALTER TABLE turnos DROP CONSTRAINT IF EXISTS turnos_motivo_recomeco_valido;
-- ALTER TABLE turnos
--   ADD CONSTRAINT turnos_motivo_recomeco_valido
--     CHECK (motivo_recomeco IS NULL OR motivo_recomeco IN ('troca_de_conta', 'troca_de_ia', 'troca_de_maquina', 'sessao_recusada')) NOT VALID;
