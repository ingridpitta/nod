#!/usr/bin/env bash
# Script de inicialização da VM (metadata startup-script): roda a cada boot e é idempotente. Instala o
# Docker com o plugin compose, liga o login no Artifact Registry e cria /opt/nod. O resto (compose,
# Caddyfile, segredos) chega a cada deploy por deploy.sh.
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg postgresql-client
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi
gcloud auth configure-docker southamerica-east1-docker.pkg.dev --quiet
install -d -m 0750 /opt/nod
