#!/usr/bin/env bash
# Do Mac: cria papéis, banco e extensões no Cloud SQL, rodando vm/banco-inicial.sh na VM pelo túnel
# IAP (o Cloud SQL só tem IP privado). Idempotente. Ver docs/deploy-gcp.md.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
G="${GCLOUD:-gcloud}"
gc() { "$G" --project="$PROJETO" --quiet "$@"; }

gc compute ssh "$VM_NOME" --zone="$ZONA" --tunnel-through-iap --command="mkdir -p ~/nod-tmp"
gc compute scp config.env vm/banco-inicial.sql vm/banco-inicial.sh "$VM_NOME":nod-tmp/ --zone="$ZONA" --tunnel-through-iap
gc compute ssh "$VM_NOME" --zone="$ZONA" --tunnel-through-iap --command="sudo bash ~/nod-tmp/banco-inicial.sh; rm -rf ~/nod-tmp"
