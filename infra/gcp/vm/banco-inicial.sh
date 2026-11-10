#!/usr/bin/env bash
# Na VM, como root: aplica banco-inicial.sql no Cloud SQL como postgres. As senhas saem do Secret
# Manager direto para o ambiente do container, nunca para a linha de comando.
set -euo pipefail
cd "$(dirname "$0")"
source ./config.env
: "${SQL_IP:?SQL_IP vazio no config.env}"
segredo() { gcloud secrets versions access latest --secret="$1" --project="$PROJETO"; }

docker run --rm -v "$PWD/banco-inicial.sql:/b.sql:ro" \
  -e PGPASSWORD="$(segredo nod-pg-senha-postgres)" -e PGSSLMODE=require \
  -e SENHA_DONO="$(segredo nod-pg-senha-dono)" -e SENHA_APP="$(segredo nod-pg-senha-app)" \
  postgres:16 sh -c 'psql -h "$0" -U postgres -d postgres -v senha_dono="$SENHA_DONO" -v senha_app="$SENHA_APP" -f /b.sql' "$SQL_IP"
echo "papéis, banco nod e extensões prontos"
