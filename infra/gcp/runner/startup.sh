#!/usr/bin/env bash
# Startup da VM do runner (provisionar-runner.sh). Roda como root a cada boot; só instala e registra uma vez.
# Os runners da VM vêm da metadata "runners" (nome:label separados por espaço). Sem ela, os três da 1ª VM:
#   nod-ci-1 e nod-ci-2 (label nod-ci): lint, unit e deploy;
#   nod-ci-integracao (label nod-integracao): até 2026-11-04 era o único que subia o Postgres (porta fixa 5434);
#   desde então o Postgres de cada job sobe em porta sorteada e qualquer runner serve os jobs com banco.
set -euo pipefail
MARCA=/var/lib/nod-runner-pronto
[ -f "$MARCA" ] && exit 0

meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
REPO=$(meta github-repo)
TOKEN=$(meta runner-token)
RUNNERS=$(meta runners 2>/dev/null || echo "nod-ci-1:nod-ci nod-ci-2:nod-ci nod-ci-integracao:nod-integracao")
VERSAO=2.338.0

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# O que o ci usa do ubuntu-latest: git, psql (init dos roles), build-essential (deps nativas do npm), jq, docker.
apt-get install -yq ca-certificates curl git jq unzip zip build-essential python3 postgresql-client docker.io
# NOD-398: as libs do sistema que o Chromium headless do bot de QA e da tela.capturar pede (o Chromium em si vem de
# `npx playwright install chromium`, no cache do runner). Com elas aqui, o job não precisa de apt a cada run.
# A imagem é ubuntu-2404 (provisionar-runner.sh): nela várias libs mudaram para o nome *t64 (a transição do time_t de 64
# bits) e o nome antigo é só virtual, então o apt-get falha. Os nomes abaixo são os da 24.04 e são os MESMOS de
# libs-chromium.txt (o ci.yml usa aquela lista no runner já provisionado; tests/unit/infra confere que batem).
apt-get install -yq libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libxkbcommon0 libxcomposite1 \
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libatspi2.0-0t64 libdbus-1-3 \
  libglib2.0-0t64 fonts-liberation
systemctl enable --now docker

id runner >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker runner
echo 'runner ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/runner

curl -fsSL -o /tmp/runner.tgz \
  "https://github.com/actions/runner/releases/download/v${VERSAO}/actions-runner-linux-x64-${VERSAO}.tar.gz"

registrar() { # nome label
  local dir="/home/runner/$1"
  mkdir -p "$dir" && tar -xzf /tmp/runner.tgz -C "$dir" && chown -R runner:runner "$dir"
  if [ ! -f "$dir/.runner" ]; then
    sudo -u runner "$dir/config.sh" --unattended --replace --url "https://github.com/$REPO" --token "$TOKEN" \
      --name "$1" --labels "$2" --work _work
  fi
  (cd "$dir" && ./svc.sh install runner && ./svc.sh start)
}
for r in $RUNNERS; do registrar "${r%%:*}" "${r#*:}"; done

# Limpeza semanal de imagens e volumes que os jobs deixam para trás.
echo '0 4 * * 0 root docker system prune -af --volumes >/dev/null 2>&1' >/etc/cron.d/nod-docker-prune
touch "$MARCA"
