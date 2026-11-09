-- definido em 2026-10-05 (NOD-170, emenda da ADR-037): ciclo de vida do computador no host.
--
-- Na Release 1 o computador roda no Mac de quem usa o nod. Depois do primeiro uso ele ficava ligado para
-- sempre (--restart unless-stopped) reservando 2 GiB e 2 CPUs, sem teto. Agora o computador sem atividade
-- desliga sozinho (NOD_COMPUTADOR_OCIOSO_MIN) e o host tem um teto de ligados (NOD_COMPUTADORES_MAX).

-- O teto recusa com código próprio. Fica FORA de CONTA_PARA_SAUDE e não conta como sucesso: a máquina
-- não falhou nem respondeu. No fim da lista, como em MOTIVOS_FALHA_COMPUTADOR (o gate motivos-enum
-- compara a ordem). Nenhum valor novo é usado nesta migração.
ALTER TYPE motivo_falha_computador ADD VALUE IF NOT EXISTS 'limite_de_computadores';

-- A última ação do bot ou da pessoa (liberar, iniciar, assumir, devolver). As linhas antigas nascem com
-- now(): nada desliga no primeiro minuto depois do deploy.
ALTER TABLE computadores ADD COLUMN ultima_atividade_em timestamptz NOT NULL DEFAULT now();

-- ROLLBACK:
-- ALTER TABLE computadores DROP COLUMN ultima_atividade_em;
-- (o valor 'limite_de_computadores' fica: Postgres não remove valor de enum; antes, troque as linhas que o usam)
