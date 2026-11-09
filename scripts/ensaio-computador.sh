#!/usr/bin/env bash
# Ensaio do computador com os harnesses REAIS (NOD-169) — `npm run ensaio:computador -- [opções]`.
#
# Sobe um banco efêmero (scripts/db-efemero.sh, derrubado no fim), migra, roda o seed e sobe o servidor em 8889 com NOD_EXECUTOR=auto, NOD_COMPUTADORES=docker e
# env LIMPO (mesma denylist do e2e-aceite). O laço por execução fica em scripts/ensaio-computador/rodar.ts; o relatório
# em scripts/ensaio-computador/relatorio.ts. Saída em /tmp/nod-ensaio-<data>/ (execucoes.jsonl, relatorio.md, servidor.log).
#
# Opções (repassadas ao rodar.ts):
#   --harness claude,codex   --tarefas 1 | 1,3-5 | todas   --repeticoes N   --com-audio   --confirmo-orcamento   --teto-s 360
#   --so-portao              modo seco: só confere ambiente, opções e portão de custo e sai, sem banco, servidor nem modelo
#
# PORTÃO DE CUSTO: sem --confirmo-orcamento, só 1 tarefa × 1 repetição por harness. A rodada completa (10 tarefas × 3
# repetições × 2 harnesses = 60 execuções) só depois do ok do Marlon no orçamento medido pela rodada do portão.
# Codex: o CLI precisa estar no PATH ou em NOD_CODEX_BIN. Não rode junto com suítes pesadas (liga Docker).
set -euo pipefail

cd "$(dirname "$0")/.."
export NOD_EXECUTOR=auto
export NOD_COMPUTADORES=docker
export NOD_LOGIN="${NOD_LOGIN:-stub}"
export NOD_API_PORT="${NOD_ENSAIO_PORTA:-8889}"
API="http://127.0.0.1:${NOD_API_PORT}"
SAIDA="/tmp/nod-ensaio-$(date -u +%Y-%m-%d)"
mkdir -p "$SAIDA"
LOG="$SAIDA/servidor.log"
SERVIDOR_PID=""

# Portão antes de qualquer custo (banco, servidor e a sonda paga do Claude no boot): a mesma regra e as mesmas opções do
# rodar.ts, sem subir nada. Com --so-portao, o roteiro para aqui: é o modo seco.
case " $* " in
  *" --so-portao "*) node scripts/ensaio-computador/rodar.ts --api "$API" --saida "$SAIDA" "$@" || exit $?
    echo "portão ok: nada foi subido (modo seco)"; exit 0 ;;
  *) node scripts/ensaio-computador/rodar.ts --so-portao --api "$API" --saida "$SAIDA" "$@" || exit $? ;;
esac

for v in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$' || true); do unset "$v"; done
command -v psql >/dev/null || { echo "psql é obrigatório"; exit 1; }
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "Docker precisa estar no ar"; exit 1; }
docker image inspect nod-computador:1 >/dev/null 2>&1 || { echo "imagem nod-computador:1 ausente (veja docs/computadores.md)"; exit 1; }
[ -f .env ] || { echo "copie .env.example para .env (com a NOD_CREDENTIAL_KEY do seu cofre)"; exit 1; }
set -a; . ./.env; set +a
# O .env traz NOD_API_PORT=8888 (o dev): reafirma a porta do ensaio para não colidir com o servidor que já está no ar.
export NOD_EXECUTOR=auto NOD_COMPUTADORES=docker NOD_API_PORT="${NOD_ENSAIO_PORTA:-8889}"
# A chave do cofre vem do .env; o ensaio nunca gera outra (quebraria as credenciais já cifradas).
[ -n "${NOD_CREDENTIAL_KEY:-}" ] || { echo "NOD_CREDENTIAL_KEY ausente no .env"; exit 1; }

ATIVOS=$(docker ps --format '{{.Names}}' | grep -c '^nod-computador-' || true)
[ "$ATIVOS" -lt 3 ] || { echo "já há $ATIVOS computadores rodando (teto 3): desligue algum antes do ensaio"; exit 1; }

BANCO=0
encerrar() {
  if [ -n "$SERVIDOR_PID" ]; then kill "$SERVIDOR_PID" 2>/dev/null || true; wait "$SERVIDOR_PID" 2>/dev/null || true; fi
  if [ "$BANCO" = 1 ]; then bash scripts/db-efemero.sh down ensaio "$PG_PORTA" >/dev/null 2>&1 || true; fi
}
trap encerrar EXIT

# Banco efêmero próprio, nunca o banco diário: a fila de turnos é compartilhada por quem usa o mesmo banco, e um
# servidor de dev no ar (sem o Codex, por exemplo) reivindicaria o turno do ensaio e o recusaria com motor_ausente.
PG_PORTA="${NOD_ENSAIO_PG_PORTA:-5436}"
echo "== PREPARO: banco efêmero 'ensaio' em $PG_PORTA (migrações e seed)"
BANCO=1
bash scripts/db-efemero.sh up ensaio "$PG_PORTA" >/dev/null
export NOD_BANCO_AMBIENTE=efemero
export DATABASE_URL="postgres://nod_app:nod@127.0.0.1:${PG_PORTA}/nod"
export DATABASE_URL_DONO="postgres://nod_dono:nod@127.0.0.1:${PG_PORTA}/nod"

echo "== SUBIR: servidor $NOD_API_PORT (NOD_EXECUTOR=auto, computadores em Docker)"
node src/adapters/http/server.ts > "$LOG" 2>&1 &
SERVIDOR_PID=$!
for _ in $(seq 1 180); do grep -q '"evento":"nod_no_ar"' "$LOG" 2>/dev/null && break; sleep 1; done
grep -q '"evento":"nod_no_ar"' "$LOG" || { tail -40 "$LOG"; echo "servidor não subiu"; exit 1; }
CUSTO_SONDA=$(grep '"evento":"sonda_claude_cli"' "$LOG" | tail -1 | jq -r '.custo_usd // 0' 2>/dev/null || echo 0)
echo "   no ar; sonda do Claude custou US\$ ${CUSTO_SONDA:-0}"

echo "== ENSAIO"
STATUS=0
node scripts/ensaio-computador/rodar.ts --api "$API" --saida "$SAIDA" "$@" || STATUS=$?

if [ -s "$SAIDA/execucoes.jsonl" ]; then
  node scripts/ensaio-computador/relatorio.ts "$SAIDA/execucoes.jsonl" > "$SAIDA/relatorio.md"
  echo "== RELATÓRIO: $SAIDA/relatorio.md"
  cat "$SAIDA/relatorio.md"
fi
exit "$STATUS"
