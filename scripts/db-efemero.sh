#!/usr/bin/env bash
set -euo pipefail

acao="${1:-}"
nome="${2:-}"
porta="${3:-5435}"

uso() {
  echo "uso: $0 up|down|status NOME [PORTA]" >&2
  echo "exemplo: $0 up acesso-novo 5435" >&2
  exit 2
}

[[ "$acao" =~ ^(up|down|status)$ ]] || uso
[[ "$nome" =~ ^[a-z0-9][a-z0-9-]*$ ]] || uso
[[ "$porta" =~ ^[0-9]+$ ]] || uso
(( porta >= 1024 && porta <= 65535 )) || uso
[[ "$porta" != "5434" ]] || { echo "porta 5434 pertence ao banco persistente" >&2; exit 2; }

projeto="nod-efemero-${nome}"
compose=(docker compose -p "$projeto" -f docker-compose.efemero.yml)

case "$acao" in
  up)
    NOD_PG_PORT="$porta" "${compose[@]}" up -d --wait
    DATABASE_URL="postgres://nod_app:nod@127.0.0.1:${porta}/nod" \
      DATABASE_URL_DONO="postgres://nod_dono:nod@127.0.0.1:${porta}/nod" \
      npm run db:migrate
    DATABASE_URL_TEST="postgres://nod_app:nod@127.0.0.1:${porta}/nod_test" \
      DATABASE_URL_DONO="postgres://nod_dono:nod@127.0.0.1:${porta}/nod" \
      npm run db:migrate:test
    DATABASE_URL="postgres://nod_app:nod@127.0.0.1:${porta}/nod" \
      DATABASE_URL_DONO="postgres://nod_dono:nod@127.0.0.1:${porta}/nod" \
      npm run db:seed
    echo
    echo "Banco efemero '$nome' pronto em 127.0.0.1:$porta."
    echo "Para usar neste shell:"
    echo "export NOD_BANCO_AMBIENTE=efemero"
    echo "export DATABASE_URL=postgres://nod_app:nod@127.0.0.1:${porta}/nod"
    echo "export DATABASE_URL_DONO=postgres://nod_dono:nod@127.0.0.1:${porta}/nod"
    echo "export DATABASE_URL_TEST=postgres://nod_app:nod@127.0.0.1:${porta}/nod_test"
    ;;
  down)
    NOD_PG_PORT="$porta" "${compose[@]}" down -v
    echo "Banco efemero '$nome' removido."
    ;;
  status)
    NOD_PG_PORT="$porta" "${compose[@]}" ps
    ;;
esac
