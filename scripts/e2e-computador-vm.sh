#!/usr/bin/env bash
# NOD-96 PR 7 (definido em 2026-10-22, ADR-122): smoke do computador da pessoa numa VM GCP LIMPA. Cria a VM (Debian 12;
# com --trixie, Debian 13), envia o repo (git archive do HEAD + dist/motor), roda scripts/e2e-computador-vm/preparar.sh
# lá dentro como root (instala como o script do motor, confere as units do systemd e roda o smoke real com Xvfb e
# Chromium) e APAGA a VM no fim, passe ou falhe. Nada é instalado na máquina de onde roda.
#
#   gcloud auth login                                               # se o login venceu
#   NOD_GCP_PROJETO=<projeto-de-teste> scripts/e2e-computador-vm.sh            # Debian 12 (o alvo)
#   NOD_GCP_PROJETO=<projeto-de-teste> scripts/e2e-computador-vm.sh --trixie   # Debian 13 (secundário)
#   NOD_GCP_PROJETO=<projeto-de-teste> scripts/e2e-computador-vm.sh --manter   # não apaga a VM (para depurar)
#
# Variáveis: NOD_GCP_PROJETO (OBRIGATÓRIA, sem padrão: o smoke nunca cai no projeto de produção de config.env, e o
# projeto de produção é recusado), NOD_GCP_ZONA (padrão: a de infra/gcp/config.env), NOD_SMOKE_REDE (padrão nod-smoke:
# uma rede de teste só do smoke, criada se faltar, com SSH liberado; a rede de produção é recusada), NOD_SMOKE_MAQUINA
# (e2-standard-4: 16 GB, para 6 telas com memória sobrando). A VM nasce sem conta de serviço e sem escopos: o metadata
# não entrega token nenhum, mesmo se o egress falhar. Custo: uma e2-standard-4 por ~10 min.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGEM=debian-12; FAMILIA=debian-12; MANTER=0
for a in "$@"; do
  case "$a" in
    --trixie) IMAGEM=debian-13; FAMILIA=debian-13 ;;
    --manter) MANTER=1 ;;
    *) echo "opção desconhecida: $a"; exit 2 ;;
  esac
done
# shellcheck disable=SC1091
. infra/gcp/config.env
PROJETO_PRODUCAO="$PROJETO"; REDE_PRODUCAO="$REDE"
PROJETO="${NOD_GCP_PROJETO:-}"
[ -n "$PROJETO" ] || { echo "defina NOD_GCP_PROJETO com um projeto de TESTE (sem padrão, para não cair em $PROJETO_PRODUCAO)"; exit 2; }
[ "$PROJETO" != "$PROJETO_PRODUCAO" ] || { echo "NOD_GCP_PROJETO=$PROJETO é o projeto de produção: use um projeto de teste"; exit 2; }
ZONA="${NOD_GCP_ZONA:-$ZONA}"
REDE_TESTE="${NOD_SMOKE_REDE:-nod-smoke}"
[ "$REDE_TESTE" != "$REDE_PRODUCAO" ] || { echo "NOD_SMOKE_REDE=$REDE_TESTE é a rede de produção: use uma rede de teste"; exit 2; }
MAQUINA="${NOD_SMOKE_MAQUINA:-e2-standard-4}"
VM="nod-smoke-pc-${IMAGEM}-$(date -u +%m%d%H%M)"

command -v gcloud >/dev/null || { echo "gcloud não está no PATH"; exit 1; }
gcloud auth print-access-token >/dev/null 2>&1 || { echo "gcloud sem login válido: rode 'gcloud auth login' e tente de novo"; exit 1; }

# O pacote: o HEAD (sem o que não está commitado) + os arquivos do computador já construídos.
TMP=$(mktemp -d)
CRIOU=0
apagar() {
  rm -rf "$TMP"
  [ "$CRIOU" = 1 ] || return 0
  if [ "$MANTER" = 0 ]; then
    gcloud compute instances delete "$VM" --project "$PROJETO" --zone "$ZONA" --quiet >/dev/null 2>&1 ||
      echo "ATENÇÃO: não consegui apagar a VM (ela continua cobrando). Apague à mão: gcloud compute instances delete $VM --project $PROJETO --zone $ZONA --quiet" >&2
  else echo "VM mantida: gcloud compute instances delete $VM --project $PROJETO --zone $ZONA --quiet"; fi
}
trap apagar EXIT
node scripts/motor/build.mjs >/dev/null
git archive --format=tar --prefix=nod/ HEAD > "$TMP/nod.tar"
tar -rf "$TMP/nod.tar" --transform 's,^,nod/,' dist/motor/computador-supervisor.mjs dist/motor/computador-tela.mjs dist/motor/computador-terminal.mjs
gzip "$TMP/nod.tar"

# A rede de teste: criada uma vez (modo auto) e reaproveitada; só SSH entra.
if ! gcloud compute networks describe "$REDE_TESTE" --project "$PROJETO" >/dev/null 2>&1; then
  echo "== criando a rede de teste $REDE_TESTE em $PROJETO"
  gcloud compute networks create "$REDE_TESTE" --project "$PROJETO" --subnet-mode auto --quiet >/dev/null
fi
if ! gcloud compute firewall-rules describe "$REDE_TESTE-ssh" --project "$PROJETO" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$REDE_TESTE-ssh" --project "$PROJETO" --network "$REDE_TESTE" \
    --allow tcp:22 --direction INGRESS --target-tags nod-smoke --quiet >/dev/null
fi

echo "== criando $VM ($FAMILIA, $MAQUINA) em $PROJETO/$ZONA, rede $REDE_TESTE, sem conta de serviço"
CRIOU=1
gcloud compute instances create "$VM" --project "$PROJETO" --zone "$ZONA" --machine-type "$MAQUINA" \
  --image-family "$FAMILIA" --image-project debian-cloud --boot-disk-size 30GB \
  --network "$REDE_TESTE" --tags nod-smoke --no-service-account --no-scopes \
  --labels nod-smoke=computador --metadata enable-oslogin=TRUE --quiet >/dev/null
for _ in $(seq 1 30); do gcloud compute ssh "$VM" --project "$PROJETO" --zone "$ZONA" --command true --quiet >/dev/null 2>&1 && break; sleep 5; done

gcloud compute scp "$TMP/nod.tar.gz" "$VM:/tmp/nod.tar.gz" --project "$PROJETO" --zone "$ZONA" --quiet
set +e
gcloud compute ssh "$VM" --project "$PROJETO" --zone "$ZONA" --quiet --command \
  'set -e; sudo rm -rf /srv/nod; sudo mkdir -p /srv; sudo tar -xzf /tmp/nod.tar.gz -C /srv; sudo bash /srv/nod/scripts/e2e-computador-vm/preparar.sh' \
  2>&1 | tee "$TMP/../nod-smoke-${IMAGEM}.log"
rc=${PIPESTATUS[0]}
set -e
echo "log: $TMP/../nod-smoke-${IMAGEM}.log"
exit "$rc"
