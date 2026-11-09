-- definido em 2026-09-30 (ADR-063): pedido entre bots até três passes seguidos (era um, ADR-058). Medido no mesmo dia no
-- banco diário: 36 dos 64 turnos do Chico nasceram em profundidade 1, sem pedir_a_bot, e cinco relatos da pessoa
-- vieram disso. O código anterior só escreve 0 e 1, então esta migração pode entrar antes do código novo.
ALTER TABLE turnos DROP CONSTRAINT turnos_profundidade;
ALTER TABLE turnos ADD CONSTRAINT turnos_profundidade CHECK (profundidade BETWEEN 0 AND 3);

-- ROLLBACK (o UPDATE roda como postgres: com FORCE ROW LEVEL SECURITY o nod_dono não enxerga as linhas, e o código
-- anterior leria 2 e 3 como 0, liberando o salto):
-- UPDATE turnos SET profundidade = 1 WHERE profundidade > 1;
-- ALTER TABLE turnos DROP CONSTRAINT turnos_profundidade;
-- ALTER TABLE turnos ADD CONSTRAINT turnos_profundidade CHECK (profundidade IN (0, 1));
