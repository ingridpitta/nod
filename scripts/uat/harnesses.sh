#!/usr/bin/env bash
# UAT REAL de harnesses e modelos (NOD-171) — `bash scripts/uat/harnesses.sh`. PAGO: cada turno é um turno real
# do Claude Code ou do Codex nas contas deste Mac. O roteiro manual é docs/uat-harnesses-e-modelos.md; este
# script percorre a rodada B (HM-08 a HM-15 e HM-18) e o piso de versão por API, sem UI, e grava uma linha
# JSON por caso em $SAIDA/resultados.jsonl.
#
# Fases (banco efêmero próprio, nunca o diário: um servidor de dev no ar reivindicaria os turnos):
#   1. local: servidor com NOD_EXECUTOR=auto e o Codex atual (NOD_UAT_CODEX_NOVO); um turno por modelo do
#      seletor, automático e fixado. "independentes": dois bots ao mesmo tempo, volta ao automático e duplicação.
#   2. desatualizado: o mesmo servidor reiniciado com um Codex abaixo do piso (NOD_UAT_CODEX_VELHO): o bot
#      fixado no Codex termina com a negação "desatualizado" (sem cair no Claude) e o automático roda no Claude.
#   3. compartilhado: NOD_MODO=compartilhado e o Mac simulado (scripts/uat/mac-simulado.ts) anunciando o Codex
#      velho, depois o novo: o turno fixado no Codex não fica pendente (UX-01 no app do Mac).
# O limite do plano não entra aqui: não se leva conta ao limite (fixtures e CLI falso nos testes de integração).
#
# Env: NOD_UAT_CODEX_NOVO e NOD_UAT_CODEX_VELHO (binários do Codex), NOD_UAT_PORTA (8890), NOD_UAT_PG_PORTA (5437),
# NOD_UAT_FASES ("local independentes desatualizado compartilhado"). Precisa do .env do clone (NOD_CREDENTIAL_KEY): rode a partir
# do clone ou aponte NOD_UAT_ENV para ele.
set -euo pipefail

cd "$(dirname "$0")/../.."
for v in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$' || true); do unset "$v"; done
command -v jq >/dev/null || { echo "jq é obrigatório"; exit 1; }
ARQ_ENV="${NOD_UAT_ENV:-.env}"
[ -f "$ARQ_ENV" ] || { echo "sem $ARQ_ENV (a NOD_CREDENTIAL_KEY vem dele)"; exit 1; }
set -a; . "$ARQ_ENV"; set +a
CODEX_NOVO="${NOD_UAT_CODEX_NOVO:?aponte NOD_UAT_CODEX_NOVO para o Codex atual}"
CODEX_VELHO="${NOD_UAT_CODEX_VELHO:?aponte NOD_UAT_CODEX_VELHO para um Codex abaixo do piso}"
FASES="${NOD_UAT_FASES:-local independentes desatualizado compartilhado}"
PORTA="${NOD_UAT_PORTA:-8890}"
PG_PORTA="${NOD_UAT_PG_PORTA:-5437}"
API="http://127.0.0.1:${PORTA}"
SAIDA="/tmp/nod-uat-harnesses-$(date -u +%Y-%m-%dT%H%M)"
mkdir -p "$SAIDA"
RES="$SAIDA/resultados.jsonl"
JAR="$SAIDA/cookies"
SERVIDOR_PID=""; MAC_PID=""; BANCO=0; FALHAS=0; N_LOG=0

export NOD_LOGIN=stub NOD_API_PORT="$PORTA" NOD_BANCO_AMBIENTE=efemero NOD_EXECUTOR=auto NOD_MODELO=auto
# O NOD_HOME do .env é o ~/.nod do dev (workspaces, machine-id, turnos/): o UAT usa um só dele, dentro da saída.
export NOD_HOME="$SAIDA/home"
export DATABASE_URL="postgres://nod_app:nod@127.0.0.1:${PG_PORTA}/nod"
export DATABASE_URL_DONO="postgres://nod_dono:nod@127.0.0.1:${PG_PORTA}/nod"
unset NOD_MODO

parar_mac() { if [ -n "$MAC_PID" ]; then kill "$MAC_PID" 2>/dev/null || true; wait "$MAC_PID" 2>/dev/null || true; MAC_PID=""; fi; }
parar_servidor() { if [ -n "$SERVIDOR_PID" ]; then kill "$SERVIDOR_PID" 2>/dev/null || true; wait "$SERVIDOR_PID" 2>/dev/null || true; SERVIDOR_PID=""; fi; }
encerrar() {
  parar_mac; parar_servidor
  if [ "$BANCO" = 1 ]; then bash scripts/db-efemero.sh down uat171 "$PG_PORTA" >/dev/null 2>&1 || true; fi
}
trap encerrar EXIT

api() { # api METODO caminho [json]
  local m="$1" c="$2" corpo="${3:-}"
  if [ -n "$corpo" ]; then curl -sS -b "$JAR" -X "$m" "$API/api/t/$T/$c" -H 'content-type: application/json' -d "$corpo"; else curl -sS -b "$JAR" -X "$m" "$API/api/t/$T/$c"; fi
}

subir() { # subir RÓTULO CODEX_BIN [compartilhado]
  parar_mac; parar_servidor
  N_LOG=$((N_LOG + 1)); LOG="$SAIDA/servidor-$N_LOG-$1.log"
  if [ "${3:-}" = compartilhado ]; then export NOD_MODO=compartilhado; else unset NOD_MODO; fi
  NOD_CODEX_BIN="$2" node src/adapters/http/server.ts > "$LOG" 2>&1 &
  SERVIDOR_PID=$!
  for _ in $(seq 1 240); do grep -q '"evento":"nod_no_ar"' "$LOG" 2>/dev/null && break; sleep 1; done
  grep -q '"evento":"nod_no_ar"' "$LOG" || { tail -40 "$LOG"; echo "servidor não subiu"; exit 1; }
  local pessoa; pessoa=$(curl -sS "$API/api/sessao/modo" | jq -r '.pessoas[] | select(.nome == "Marlon") | .id')
  curl -sS -c "$JAR" -X POST "$API/api/sessao/entrar" -H 'content-type: application/json' -d "{\"pessoaId\":\"$pessoa\"}" >/dev/null
  T=$(curl -sS -b "$JAR" "$API/api/sessao" | jq -r .tenantId)
  api POST preferencias '{"modoDev":true}' >/dev/null # o Raio-X diz qual harness e qual versão do CLI rodaram
  echo "   servidor no ar ($1, Codex $("$2" --version 2>/dev/null | awk '{print $NF}'))"
}

bot() { # bot HARNESS MODELO → "agenteId conversaId"
  local r a c; r=$(api POST agentes '{"dono":"pessoa"}'); a=$(echo "$r" | jq -r .agente.id); c=$(echo "$r" | jq -r .conversa.id)
  api PATCH "agentes/$a" "{\"harness\":\"$1\",\"modelo\":\"$2\"}" | jq -e 'has("codigo") | not' >/dev/null || { echo "PATCH $1/$2 recusado" >&2; exit 1; }
  echo "$a $c"
}

turno() { # turno CASO CONVERSA ESPERADO(ok|negado) [HARNESS_ESPERADO] [MODELO_ESPERADO] [prazo_s] — registra e confere
  local caso="$1" c="$2" esperado="$3" h_esp="${4:-}" m_esp="${5:-}" limite="${6:-240}" r id t0 estado tj rx fala sistema harness versao modelo ok
  r=$(api POST "conversas/$c/mensagens" "{\"texto\":\"Responda somente com o texto UAT-${caso}-OK, sem mais nada.\"}")
  id=$(echo "$r" | jq -r .ids.turno); t0=$(date +%s)
  while :; do
    estado=$(api GET "turnos/$id" | jq -r .turno.estado)
    case "$estado" in concluido|interrompido) break;; esac
    [ $(( $(date +%s) - t0 )) -gt "$limite" ] && { estado="timeout($estado)"; break; }
    sleep 2
  done
  tj=$(api GET "turnos/$id" | jq -c .turno)
  rx=$(api GET "turnos/$id/raio-x" 2>/dev/null || echo '{}')
  fala=$(api GET "conversas/$c/mensagens" | jq -r --arg t "$id" '[.mensagens[] | select(.turnoId==$t and .kind!="sistema")] | last | .texto // ""')
  sistema=$(api GET "conversas/$c/mensagens" | jq -c --arg t "$id" '[.mensagens[] | select(.kind=="sistema")] | last | {texto: (.texto // "" | .[0:220]), payload}')
  harness=$(echo "$rx" | jq -r '.composicao.harness // empty' 2>/dev/null || true)
  versao=$(echo "$rx" | jq -r '.execucao.versaoCli // empty' 2>/dev/null || true)
  modelo=$(echo "$rx" | jq -r '.composicao.modelo // empty' 2>/dev/null || true) # o efetivo: o turno guarda "auto" quando o bot está no automático
  ok=true
  if [ "$esperado" = ok ]; then
    [ "$estado" = concluido ] && echo "$fala" | grep -q "UAT-${caso}-OK" || ok=false
    [ -z "$h_esp" ] || [ "$harness" = "$h_esp" ] || ok=false
    [ -z "$m_esp" ] || [ "$modelo" = "$m_esp" ] || ok=false
  else
    # negado: interrompe sem rodar nenhum harness (nada de cair no outro) e a fala é o aviso, não a resposta pedida
    [ "$estado" = interrompido ] && [ -z "$harness" ] && ! echo "$fala" | grep -q "UAT-${caso}-OK" || ok=false
  fi
  [ "$ok" = true ] || FALHAS=$((FALHAS + 1))
  jq -nc --arg caso "$caso" --arg esperado "$esperado" --arg estado "$estado" --arg harness "$harness" --arg versao "$versao" \
    --arg modelo "$modelo" --arg modeloCli "$(echo "$rx" | jq -r '.execucao.modelo // empty' 2>/dev/null || true)" --argjson ok "$ok" --arg fala "${fala:0:240}" --argjson tj "$tj" --argjson sistema "${sistema:-null}" --argjson seg $(( $(date +%s) - t0 )) \
    '{caso:$caso, esperado:$esperado, ok:$ok, estado:$estado, motivoFalha:$tj.motivoFalha, motivoInterrupcao:$tj.motivoInterrupcao, harnessPedido:$tj.harness, harnessRodou:$harness, versaoCli:$versao, modeloPedido:$tj.modelo, modelo:$modelo, modeloCli:$modeloCli, custoUsd:$tj.custoUsd, segundos:$seg, fala:$fala, sistema:(if $esperado=="negado" then $sistema else null end)}' | tee -a "$RES" | jq -c '{caso, ok, estado, harnessRodou, modelo, custoUsd, motivoFalha}'
}

inventario() { api GET executor | jq -c '[.harnesses.opcoes[] | select(.integrado) | {id, estado: .inventario.estado, causa: .inventario.causa, versao: .inventario.versao, minima: .inventario.minima}]' | tee /dev/stderr; }

echo "== PREPARO: banco efêmero uat171 em $PG_PORTA; saída em $SAIDA"
BANCO=1
bash scripts/db-efemero.sh up uat171 "$PG_PORTA" >/dev/null

if [[ " $FASES " == *" local "* ]]; then
  echo "== FASE 1: local, Codex atual"
  subir local "$CODEX_NOVO"
  inventario > "$SAIDA/inventario-local.json"
  read -r A CA <<<"$(bot auto auto)"; turno HM-08-auto "$CA" ok claude-cli sonnet
  for m in sonnet haiku opus; do read -r _ C <<<"$(bot claude-cli "$m")"; turno "HM-09-claude-$m" "$C" ok claude-cli "$m"; done
  for m in gpt-5.6-sol gpt-6-astra gpt-5.6-luna gpt-6.1-sol gpt-6-sol gpt-6-luna; do read -r _ C <<<"$(bot codex-cli "$m")"; turno "HM-10-codex-$m" "$C" ok codex-cli "$m"; done
  read -r _ C <<<"$(bot codex-cli auto)"; turno HM-11-codex-auto "$C" ok codex-cli gpt-5.6-sol
fi

if [[ " $FASES " == *" independentes "* ]]; then
  echo "== FASE 1b: local, bots independentes (HM-12, HM-13, HM-18)"
  [ -n "$SERVIDOR_PID" ] || subir local "$CODEX_NOVO"
  # HM-12: dois bots com harnesses diferentes ao mesmo tempo, cada um no seu.
  read -r BA CBA <<<"$(bot codex-cli gpt-5.6-sol)"; read -r BB CBB <<<"$(bot claude-cli sonnet)"
  # `wait` só nos dois: um `wait` sem PID esperaria também o servidor, que roda em segundo plano.
  ( turno HM-12-a-codex "$CBA" ok codex-cli gpt-5.6-sol > "$SAIDA/hm12a" ) & P12A=$!
  ( turno HM-12-b-claude "$CBB" ok claude-cli sonnet > "$SAIDA/hm12b" ) & P12B=$!
  wait "$P12A" "$P12B" || true; cat "$SAIDA/hm12a" "$SAIDA/hm12b"
  FALHAS=$(( FALHAS + $(jq -s '[.[] | select((.caso|startswith("HM-12")) and (.ok|not))] | length' "$RES") ))
  api PATCH "agentes/$BA" '{"harness":"auto","modelo":"auto"}' >/dev/null; turno HM-13-volta-auto "$CBA" ok claude-cli sonnet
  # HM-18: a duplicata preserva harness e modelo.
  api PATCH "agentes/$BB" '{"harness":"codex-cli","modelo":"gpt-6-astra"}' >/dev/null
  DUP=$(api POST "agentes/$BB/duplicar"); DA=$(echo "$DUP" | jq -r '.agente.id // .data.agente.id // empty'); DC=$(echo "$DUP" | jq -r '.conversa.id // .data.conversa.id // empty')
  api GET frota | jq -c --arg a "$DA" '.agentes[] | select(.id==$a) | {caso:"HM-18-duplicata", harness, modelo}' | tee -a "$SAIDA/duplicata.json"
  [ -n "$DC" ] && turno HM-18-duplicata "$DC" ok codex-cli gpt-6-astra
fi

if [[ " $FASES " == *" desatualizado "* ]]; then
  echo "== FASE 2: local, Codex abaixo do piso (HM-14, HM-15)"
  subir desatualizado "$CODEX_VELHO"
  inventario > "$SAIDA/inventario-desatualizado.json"
  read -r _ C <<<"$(bot codex-cli gpt-5.6-sol)"; turno HM-14-codex-fixado-velho "$C" negado "" "" 90
  read -r _ C <<<"$(bot auto auto)"; turno HM-15-auto-com-codex-velho "$C" ok claude-cli sonnet
fi

if [[ " $FASES " == *" compartilhado "* ]]; then
  echo "== FASE 3: compartilhado com o Mac simulado"
  subir compartilhado "$CODEX_NOVO" compartilhado
  CHAVE=$(api POST maquinas/chaves '{"nome":"UAT NOD-171"}' | jq -r .chave)
  mac() { # mac CODEX_BIN RÓTULO
    parar_mac
    NOD_UAT_URL="$API" NOD_UAT_CHAVE="$CHAVE" NOD_CODEX_BIN="$1" node scripts/uat/mac-simulado.ts > "$SAIDA/mac-$2.log" 2>&1 &
    MAC_PID=$!
    for _ in $(seq 1 120); do grep -q mac_simulado_no_ar "$SAIDA/mac-$2.log" 2>/dev/null && break; sleep 1; done
    grep mac_simulado_no_ar "$SAIDA/mac-$2.log" || { tail -20 "$SAIDA/mac-$2.log"; echo "Mac simulado não subiu"; exit 1; }
    sleep 3
  }
  mac "$CODEX_VELHO" velho; inventario > "$SAIDA/inventario-app-velho.json"
  read -r _ C <<<"$(bot codex-cli gpt-5.6-sol)"; turno HM-14-app-codex-fixado-velho "$C" negado "" "" 90
  read -r _ C <<<"$(bot auto auto)"; turno HM-15-app-auto-com-codex-velho "$C" ok claude-cli sonnet
  mac "$CODEX_NOVO" novo
  read -r _ C <<<"$(bot codex-cli gpt-5.6-sol)"; turno HM-10-app-codex "$C" ok codex-cli gpt-5.6-sol
  read -r _ C <<<"$(bot claude-cli haiku)"; turno HM-09-app-claude "$C" ok claude-cli haiku
fi

echo "== RESUMO ($RES)"
jq -s '{casos: length, ok: map(select(.ok)) | length, custoUsd: (map(.custoUsd // 0) | add * 10000 | round / 10000)}' "$RES"
[ "$FALHAS" = 0 ] || { echo "falhas: $FALHAS"; exit 1; }
