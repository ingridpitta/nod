#!/usr/bin/env bash
# Do Mac que tem o banco do dia a dia: leva esse banco para o Cloud SQL. Roda UMA vez, antes do
# primeiro deploy, com o banco de produção vazio (vm/restaurar.sh recusa outro caso). O dump fica só
# no tempo da cópia: é apagado aqui e na VM ao final.
# NOD_PG_CONTAINER escolhe o container do Postgres local (padrão nod-postgres, o do docker-compose.yml).
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
G="${GCLOUD:-gcloud}"
gc() { "$G" --project="$PROJETO" --quiet "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CONTAINER="${NOD_PG_CONTAINER:-nod-postgres}"
echo "origem: container $CONTAINER, banco nod ($(docker exec "$CONTAINER" psql -U postgres -d nod -Atc "select count(*) from schema_migrations") migrações aplicadas)"
read -r -p "Este é o banco certo para levar à produção? [s/N] " ok
[ "$ok" = s ] || { echo "nada foi enviado"; exit 1; }
docker exec "$CONTAINER" pg_dump -U postgres -d nod -Fc --no-owner >"$TMP/nod.dump"
echo "dump local: $(du -h "$TMP/nod.dump" | cut -f1)"

gc compute ssh "$VM_NOME" --zone="$ZONA" --tunnel-through-iap --command="mkdir -p ~/nod-tmp && chmod 700 ~/nod-tmp"
gc compute scp config.env vm/restaurar.sh "$TMP/nod.dump" "$VM_NOME":nod-tmp/ --zone="$ZONA" --tunnel-through-iap
gc compute ssh "$VM_NOME" --zone="$ZONA" --tunnel-through-iap --command="sudo bash ~/nod-tmp/restaurar.sh ~/nod-tmp/nod.dump; s=\$?; rm -rf ~/nod-tmp; exit \$s"
