#!/usr/bin/env bash
# NOD-132 (ADR-149): leva os ZIPs de uma release do app do Mac (desktop-release.yml) para o bucket privado da
# atualização automática e mostra as linhas da config da produção que ligam o anúncio. Não liga nada sozinho: o
# anúncio só sai quando NOD_APP_VERSAO_PUBLICADA (com o NOD_APP_ATUALIZACAO_SHA256 que ele imprime) entra na config da
# produção e o deploy roda.
#
#   scripts/desktop/publicar-atualizacao.sh v0.9.0
#
# ADA-229 (ADR-152): se a release tiver o instalador do app do Windows (nod-<v>-win-x64.exe), ele vai junto e a linha
# ganha `win-x64=<hash>`; sem ele, o Windows fica sem anúncio (o feed responde 204).
#
# Confere o SHA-256 de cada ZIP contra o SHA256-<arch>.txt da própria release antes de copiar. Nunca apaga nem
# sobrescreve: um objeto que já existe no bucket com outro conteúdo faz o script parar.
# Precisa de: `gh` logado com leitura no repositório e `gcloud` logado com escrita no bucket.
# NOD-485 (ADR-161): a release sai do repo público (NOD_RELEASE_REPO muda, para ler uma antiga de outro repo). O bucket
# não tem padrão aqui: é o NOD_APP_ATUALIZACAO_BUCKET da config privada da produção (secret NOD_CONFIG_PRIVADA).
#
#   NOD_APP_ATUALIZACAO_BUCKET=<bucket> scripts/desktop/publicar-atualizacao.sh v1.0.0
set -euo pipefail

REPO_GH=${NOD_RELEASE_REPO:-marlonwlv/nod}
BUCKET=${NOD_APP_ATUALIZACAO_BUCKET:-}
TAG=${1:-}

falha() { echo "ERRO: $*" >&2; exit 1; }
[ -n "$BUCKET" ] || falha "defina NOD_APP_ATUALIZACAO_BUCKET (o bucket da atualização, na config privada da produção)"
[[ "$REPO_GH" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || falha "NOD_RELEASE_REPO inválido: $REPO_GH"
[[ "$BUCKET" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]] || falha "bucket inválido: $BUCKET"
[ -n "$TAG" ] || falha "uso: $0 v<versão> (a tag da release do app)"
VERSAO=${TAG#v}
VERSAO=${VERSAO#desktop-v}
[[ "$VERSAO" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc\.(0|[1-9][0-9]*))?$ ]] || falha "versão fora de x.y.z ou x.y.z-rc.N: $VERSAO"
command -v gh >/dev/null || falha "falta o gh"
command -v gcloud >/dev/null || falha "falta o gcloud"

DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT
gh release download "$TAG" -R "$REPO_GH" -D "$DIR" -p "nod-$VERSAO-mac-*.zip" -p "nod-$VERSAO-win-x64.exe" -p "SHA256-*.txt"

if command -v sha256sum >/dev/null; then SHA=(sha256sum); else SHA=(shasum -a 256); fi
HASH_arm64=""; HASH_x64=""; HASH_win=""
EXE="nod-$VERSAO-win-x64.exe"
ALVOS="arm64 x64"
[ -f "$DIR/$EXE" ] && ALVOS="$ALVOS win-x64"
arquivo() { if [ "$1" = win-x64 ]; then echo "$EXE"; else echo "nod-$VERSAO-mac-$1.zip"; fi; }
# Primeiro confere todos; só depois sobe algum (nada de objeto órfão de uma só arquitetura no bucket).
for ARCH in $ALVOS; do
  ZIP=$(arquivo "$ARCH")
  [ -f "$DIR/$ZIP" ] || falha "a release $TAG não tem $ZIP"
  # O awk lê cada arquivo (um arquivo sem quebra de linha no fim não cola na primeira linha do próximo, como no `cat`)
  # e tira o \r do CRLF que o Set-Content do runner Windows escreve.
  ESPERADO=$(awk -v f="$ZIP" '{ sub(/\r$/, ""); n=$2; sub(/^.*\//, "", n); if (n == f) print $1 }' "$DIR"/SHA256-*.txt | head -n1)
  [ -n "$ESPERADO" ] || falha "nenhum SHA256-*.txt da release lista $ZIP"
  VEIO=$("${SHA[@]}" "$DIR/$ZIP" | awk '{print $1}')
  [ "$VEIO" = "$ESPERADO" ] || falha "SHA-256 de $ZIP não confere ($VEIO ≠ $ESPERADO)"
  case "$ARCH" in arm64) HASH_arm64=$VEIO ;; x64) HASH_x64=$VEIO ;; *) HASH_win=$VEIO ;; esac
done

# crc32c: objeto composto (upload paralelo) não tem MD5.
crc() { gcloud storage hash "$1" --hex --skip-md5 --format='value(crc32c_hash)'; }
for ARCH in $ALVOS; do
  ZIP=$(arquivo "$ARCH")
  DESTINO="gs://$BUCKET/$VERSAO/$ZIP"
  LOCAL=$(crc "$DIR/$ZIP")
  if gcloud storage objects describe "$DESTINO" >/dev/null 2>&1; then
    [ "$(crc "$DESTINO" 2>/dev/null || true)" = "$LOCAL" ] || falha "$DESTINO já existe com outro conteúdo; publique uma versão nova"
    echo "== $DESTINO já está no bucket"
  else
    gcloud storage cp --no-clobber "$DIR/$ZIP" "$DESTINO"
    # O --no-clobber pula sem erro se outro upload chegou antes; o hash só sai se o bucket tem este ZIP.
    [ "$(crc "$DESTINO" 2>/dev/null || true)" = "$LOCAL" ] || falha "$DESTINO ficou diferente no bucket; confira antes de anunciar"
  fi
done

LINHA="arm64=$HASH_arm64,x64=$HASH_x64"
if [ -n "$HASH_win" ]; then LINHA="$LINHA,win-x64=$HASH_win"; else echo "== a release não tem $EXE: o Windows fica sem anúncio"; fi

cat <<EOF

Pacotes de $VERSAO no bucket. Para anunciar a versão aos apps, ponha na config privada da produção (o secret
NOD_CONFIG_PRIVADA do environment producao, que o deploy junta ao infra/gcp/config.env):

  NOD_APP_VERSAO_PUBLICADA=$VERSAO
  NOD_APP_ATUALIZACAO_SHA256=$LINHA

e rode o deploy. Para parar o anúncio, deixe a linha vazia e rode o deploy de novo.
EOF
