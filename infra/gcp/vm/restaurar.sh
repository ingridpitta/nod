#!/usr/bin/env bash
# Na VM, como root: restaura um pg_dump (formato custom) no banco nod do Cloud SQL, como nod_dono.
# Recusa se o banco já tiver tabelas — restaurar por cima mistura dois estados e a trilha é imutável.
# As extensões ficam fora da lista: já existem (banco-inicial.sql) e só o postgres pode comentá-las.
# medido em 2026-10-02: um dump local de 12 MB (0001–0041) volta sem nenhum erro como nod_dono num
# Postgres 16 em que nod_dono não é superusuário, e a 0042–0046 aplica por cima.
# Uso: restaurar.sh <arquivo.dump>
set -euo pipefail
DUMP="$(realpath "${1:?uso: restaurar.sh <arquivo.dump>}")"
cd "$(dirname "$0")"
source ./config.env
: "${SQL_IP:?SQL_IP vazio no config.env}"

docker run --rm -v "$DUMP:/d.dump:ro" \
  -e PGPASSWORD="$(gcloud secrets versions access latest --secret=nod-pg-senha-dono --project="$PROJETO")" \
  -e PGSSLMODE=require -e PGHOST="$SQL_IP" -e PGUSER=nod_dono -e PGDATABASE=nod \
  postgres:16 sh -c '
    set -e
    n="$(psql -Atc "select count(*) from pg_tables where schemaname = '\''public'\''")"
    if [ "$n" != 0 ]; then echo "o banco nod já tem $n tabelas: restauração recusada" >&2; exit 1; fi
    pg_restore -l /d.dump | grep -v " EXTENSION " >/tmp/lista
    pg_restore --no-owner --exit-on-error -L /tmp/lista -d nod /d.dump
    # Contagem pelas estatísticas: um count(*) como nod_dono passa pela RLS forçada e veria zero.
    psql -qAtc "analyze" -c "select (select count(*) from schema_migrations) || '\'' migrações, '\'' || (select count(*) from pessoas) || '\'' pessoas, '\'' || coalesce(sum(n_live_tup), 0) || '\'' linhas em '\'' || count(*) filter (where n_live_tup > 0) || '\'' tabelas'\'' from pg_stat_user_tables"
  '
