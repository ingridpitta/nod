#!/usr/bin/env bash
# NOD-205: ensaio de restauração do banco de produção. Clona o nod-pg por PITR numa cópia nod-pg-ensaio-*,
# compara produção e cópia na nod-vm (o Cloud SQL só tem IP privado; a VM é alcançada pelo túnel IAP) e
# apaga a cópia. Não escreve na produção: só lê dela (e roda `analyze`, que atualiza estatísticas).
# Roda no workflow .github/workflows/ensaio-restauracao.yml (conta nod-ensaio) ou do Mac, com o gcloud
# logado. Runbook: docs/runbook-producao.md.
#
# Uso:
#   ensaiar-restauracao.sh [--simular] [tudo]     [--copia NOME] [--instante ISO]   clona, compara e SEMPRE apaga
#   ensaiar-restauracao.sh [--simular] ensaiar    --copia NOME   [--instante ISO]   clona e compara (o workflow apaga noutro passo)
#   ensaiar-restauracao.sh [--simular] apagar     --copia NOME                      apaga a cópia e confere que não sobrou nenhuma
# --instante: ISO 8601 em UTC (2026-10-09T12:00:00Z); vazio = estado mais recente.
# --simular: imprime os comandos do gcloud em vez de executá-los.
set -euo pipefail
DIR_ENSAIO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=config.env
source "$DIR_ENSAIO/config.env"

# Única família de nomes que o ensaio cria e a única que ele aceita apagar. O IAM repete a regra: o papel
# nodEnsaioApagar (provisionar.sh) só vale para instâncias com este prefixo.
PREFIXO=nod-pg-ensaio-
SIMULAR="${SIMULAR:-0}"
G="${GCLOUD:-gcloud}"
# Na simulação os comandos saem pelo fd 3 (a saída original), para aparecerem mesmo quando o gcloud é
# chamado dentro de $(...) ou com a saída descartada.
exec 3>&1

gc() {
  if [ "$SIMULAR" = 1 ]; then
    echo "[simular] gcloud --project=$PROJETO --quiet $*" >&3
    return 0
  fi
  "$G" --project="$PROJETO" --quiet "$@"
}
passo() { printf '\n== %s\n' "$*"; }

nome_de_ensaio() { [[ "${1:-}" =~ ^nod-pg-ensaio-[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; }
instante_valido() { [[ "${1:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$ ]]; }
ip_valido() { [[ "${1:-}" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; }

# Espera as operações em andamento de uma instância (filtro extra opcional, ex.: só os clones).
esperar_operacoes() { # instância [filtro]
  local filtro="status!=DONE" ops op
  [ -n "${2:-}" ] && filtro="$filtro AND $2"
  ops="$(gc sql operations list --instance="$1" --filter="$filtro" --format='value(name)')" || return 1
  for op in $ops; do
    echo "esperando a operação $op ($1)"
    gc sql operations wait "$op" --timeout=unlimited || return 1
  done
}

INSTANTE_RESTAURADO=""
DURACAO_CLONE=""

clonar() { # cópia [instante]
  local copia="$1" instante="${2:-}" args=() op inicio
  nome_de_ensaio "$copia" || { echo "nome de cópia inválido: '$copia' (precisa começar com $PREFIXO)" >&2; return 2; }
  if [ -n "$instante" ]; then
    instante_valido "$instante" || { echo "instante inválido: '$instante' (use ISO 8601 em UTC, ex.: 2026-10-09T12:00:00Z)" >&2; return 2; }
    args+=(--point-in-time="$instante")
    INSTANTE_RESTAURADO="$instante"
  else
    INSTANTE_RESTAURADO="$(date -u +%Y-%m-%dT%H:%M:%SZ) (estado mais recente)"
  fi
  passo "Clonando $SQL_INSTANCIA em $copia (instante: $INSTANTE_RESTAURADO)"
  inicio="$(date +%s)"
  # O clone herda tier, rede (IP privado na nod-vpc), usuários e senhas da origem, e também a proteção
  # contra exclusão: o apagar_copia desliga a proteção antes do delete.
  op="$(gc sql instances clone "$SQL_INSTANCIA" "$copia" ${args[@]+"${args[@]}"} --async --format='value(name)')"
  passo "Esperando o clone terminar"
  gc sql operations wait "${op:-<operacao-do-clone>}" --timeout=unlimited
  DURACAO_CLONE="$(($(date +%s) - inicio))"
  echo "clone pronto em ${DURACAO_CLONE}s"
}

# Roda na nod-vm, como root, por `bash -s`: argumentos projeto, IP da produção e IP da cópia. A senha do
# nod_dono vem do Secret Manager na própria VM e entra no container por `-e PGPASSWORD` (variável
# exportada, nunca na linha de comando nem no log). A cópia herda a senha da origem.
# Saída: uma linha "<lado> <chave> <valor>" por medida.
script_comparacao() {
  cat <<'REMOTO'
set -euo pipefail
projeto="$1"; ip_producao="$2"; ip_copia="$3"
PGPASSWORD="$(gcloud secrets versions access latest --secret=nod-pg-senha-dono --project="$projeto")"
export PGPASSWORD
consulta="
select 'migracoes_n', count(*)::text from schema_migrations
union all select 'migracoes_md5', coalesce(md5(string_agg(nome, ',' order by nome)), '-') from schema_migrations
union all select 'migracoes_ultima', coalesce(max(nome), '-') from schema_migrations
union all select 'pessoas_count', count(*)::text from pessoas
union all select 'pessoas_live', coalesce((select n_live_tup from pg_stat_user_tables where schemaname = 'public' and relname = 'pessoas'), 0)::text
union all select 'tabelas', count(*)::text from pg_tables where schemaname = 'public'
union all select 'linhas', coalesce(sum(n_live_tup), 0)::text from pg_stat_user_tables"
medir() { # lado ip
  docker run --rm -e PGPASSWORD -e PGSSLMODE=require -e PGHOST="$2" -e PGUSER=nod_dono -e PGDATABASE=nod postgres:16 \
    psql -X -q -A -t -F ' ' -v ON_ERROR_STOP=1 -c 'analyze' -c "$consulta" | sed "s/^/$1 /"
}
medir producao "$ip_producao"
medir copia "$ip_copia"
REMOTO
}

comparar() { # cópia arquivo-de-medidas
  local copia="$1" saida="$2" ip_producao ip_copia
  passo "Comparando $SQL_INSTANCIA e $copia na $VM_NOME (túnel IAP)"
  # Chamada em contexto `||` (ensaiar), onde o set -e não vale: cada erro é tratado aqui.
  ip_producao="$(gc sql instances describe "$SQL_INSTANCIA" --format='value(ipAddresses[0].ipAddress)')" || return 1
  ip_copia="$(gc sql instances describe "$copia" --format='value(ipAddresses[0].ipAddress)')" || return 1
  if [ "$SIMULAR" = 1 ]; then
    ip_producao="${ip_producao:-10.0.0.1}"
    ip_copia="${ip_copia:-10.0.0.2}"
  fi
  # Os IPs entram na linha de comando remota: só passam se forem IPv4.
  ip_valido "$ip_producao" || { echo "IP da produção inválido: '$ip_producao'" >&2; return 1; }
  ip_valido "$ip_copia" || { echo "IP da cópia inválido: '$ip_copia'" >&2; return 1; }
  # O script vai pela entrada padrão (here-string, não pipe: com pipefail, o SIGPIPE do lado que escreve
  # viraria falha se o ssh não lesse tudo).
  gc compute ssh "$VM_NOME" --zone="$ZONA" --tunnel-through-iap \
    --command="sudo bash -s -- '$PROJETO' '$ip_producao' '$ip_copia'" <<<"$(script_comparacao)" >"$saida" || return 1
  cat "$saida"
}

valor() { awk -v l="$2" -v k="$3" '$1 == l && $2 == k { print $3; exit }' "$1"; }

# Lê as medidas e decide. Obrigatórios: lista de migrações (quantidade e md5 da lista ordenada), pessoas e
# número de tabelas em public, medidos do mesmo jeito nos dois lados. Produção com 0 em qualquer um deles
# falha: comparação vazia não prova nada. O total de linhas é só informativo (a produção segue escrevendo).
avaliar() { # arquivo-de-medidas
  local f="$1" falhas=0 chave_pessoas metodo item rotulo p c ok resumo
  if [ "$(valor "$f" producao pessoas_count)" != 0 ] && [ -n "$(valor "$f" producao pessoas_count)" ]; then
    chave_pessoas=pessoas_count
    metodo='count(*) como nod_dono'
  else
    # A RLS é forçada: o nod_dono pode ver 0 linhas em pessoas. Aí vale a estatística depois do analyze.
    chave_pessoas=pessoas_live
    metodo='n_live_tup de pg_stat_user_tables depois de analyze (a RLS forçada esconde as linhas de pessoas do nod_dono)'
  fi
  resumo="$(mktemp)"
  {
    echo "## Ensaio de restauração"
    echo
    echo "- Instante restaurado: ${INSTANTE_RESTAURADO:-?}"
    echo "- Duração do clone: ${DURACAO_CLONE:-?} s"
    echo "- Contagem de pessoas por: $metodo"
    echo "- Última migração: produção $(valor "$f" producao migracoes_ultima), cópia $(valor "$f" copia migracoes_ultima)"
    echo
    echo "| Item | Produção | Cópia | Bateu |"
    echo "|---|---|---|---|"
    for item in migracoes_n migracoes_md5 "$chave_pessoas" tabelas; do
      case "$item" in
        migracoes_n) rotulo="Migrações (quantidade)" ;;
        migracoes_md5) rotulo="Migrações (md5 da lista)" ;;
        tabelas) rotulo="Tabelas em public" ;;
        *) rotulo="Pessoas" ;;
      esac
      p="$(valor "$f" producao "$item")"
      c="$(valor "$f" copia "$item")"
      if [ -z "$p" ] || [ -z "$c" ]; then
        ok="não (medida ausente)"
      elif [ "$item" != migracoes_md5 ] && [ "$p" = 0 ]; then
        ok="não (produção com 0: comparação vazia não conta)"
      elif [ "$item" = migracoes_md5 ] && [ "$p" = - ]; then
        ok="não (produção sem migrações)"
      elif [ "$p" = "$c" ]; then
        ok="sim"
      else
        ok="não"
      fi
      [ "$ok" = sim ] || falhas=$((falhas + 1))
      echo "| $rotulo | ${p:--} | ${c:--} | $ok |"
    done
    echo "| Linhas (pg_stat_user_tables, informativo) | $(valor "$f" producao linhas) | $(valor "$f" copia linhas) | — |"
    echo
    if [ "$falhas" = 0 ]; then echo "**Resultado: bateu.**"; else echo "**Resultado: NÃO bateu ($falhas item(ns)).**"; fi
  } >"$resumo"
  cat "$resumo"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then cat "$resumo" >>"$GITHUB_STEP_SUMMARY"; fi
  rm -f "$resumo"
  [ "$falhas" = 0 ]
}

# Apaga uma cópia de ensaio. Recusa, antes de qualquer chamada ao gcloud, nome fora do prefixo. Os erros
# são tratados um a um (esta função também roda em contexto `||`, onde o set -e não vale).
apagar_copia() { # cópia
  local copia="${1:-}" existe restantes
  if ! nome_de_ensaio "$copia"; then
    echo "recusado: '$copia' não é uma cópia de ensaio (prefixo $PREFIXO); nada foi apagado" >&2
    return 2
  fi
  passo "Apagando a cópia $copia"
  # Um cancelamento no meio do clone deixa a operação correndo na origem: espera ela acabar primeiro.
  esperar_operacoes "$SQL_INSTANCIA" "operationType=CLONE" || return 1
  existe="$(gc sql instances list --filter="name=$copia" --format='value(name)')" || return 1
  [ "$SIMULAR" = 1 ] && existe="$copia"
  if [ -z "$existe" ]; then
    echo "a instância $copia não existe (o ensaio parou antes do clone): nada a apagar"
  else
    esperar_operacoes "$copia" || return 1
    # A cópia herda o --deletion-protection do nod-pg.
    gc sql instances patch "$copia" --no-deletion-protection || return 1
    gc sql instances delete "$copia" || return 1
  fi
  restantes="$(gc sql instances list --filter="name:${PREFIXO}*" --format='value(name)')" || return 1
  if [ -n "$restantes" ]; then
    echo "sobraram cópias de ensaio: $restantes" >&2
    return 1
  fi
  echo "nenhuma cópia ${PREFIXO}* sobrando"
}

ensaiar() { # cópia instante
  local medidas rc=0
  clonar "$1" "$2"
  medidas="$(mktemp)"
  comparar "$1" "$medidas" || rc=$?
  if [ "$rc" = 0 ]; then
    if [ "$SIMULAR" = 1 ]; then
      echo "(simulação: a comparação não é avaliada)"
    else
      avaliar "$medidas" || rc=$?
    fi
  fi
  rm -f "$medidas"
  return "$rc"
}

uso() { sed -n '8,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

main() {
  local cmd=tudo copia="" instante=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --simular) SIMULAR=1 ;;
      --copia) copia="${2:-}"; shift ;;
      --copia=*) copia="${1#*=}" ;;
      --instante) instante="${2:-}"; shift ;;
      --instante=*) instante="${1#*=}" ;;
      tudo | ensaiar | apagar) cmd="$1" ;;
      -h | --help) uso; return 0 ;;
      *) echo "argumento desconhecido: $1" >&2; uso >&2; return 2 ;;
    esac
    shift
  done
  case "$cmd" in
    apagar)
      [ -n "$copia" ] || { echo "apagar precisa de --copia" >&2; return 2; }
      apagar_copia "$copia"
      ;;
    ensaiar)
      [ -n "$copia" ] || { echo "ensaiar precisa de --copia" >&2; return 2; }
      ensaiar "$copia" "$instante"
      ;;
    tudo)
      COPIA_TUDO="${copia:-${PREFIXO}local-$(date -u +%Y%m%d%H%M%S)}"
      nome_de_ensaio "$COPIA_TUDO" || { echo "nome de cópia inválido: '$COPIA_TUDO'" >&2; return 2; }
      trap 'exit 130' INT TERM
      trap finalizar_tudo EXIT
      ensaiar "$COPIA_TUDO" "$instante"
      ;;
  esac
}

# No modo `tudo`, apaga a cópia na saída, com sucesso ou falha, e falha se o apagamento falhar.
finalizar_tudo() {
  local rc=$?
  trap - EXIT
  apagar_copia "$COPIA_TUDO" || { [ "$rc" != 0 ] || rc=1; }
  exit "$rc"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
