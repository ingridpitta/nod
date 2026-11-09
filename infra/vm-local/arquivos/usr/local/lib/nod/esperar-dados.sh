#!/bin/sh
# NOD-93 (ADR-127 §6): espera o Lima montar o disco de dados e liga /var/lib/nod-computador nele (perfis, cookies e
# chaves do supervisor). Sai com 1 depois do prazo: o computador não sobe no disco base, que troca a cada versão do app.
set -eu
MONTAGEM="${NOD_DADOS_MONTAGEM:-/mnt/lima-nod-dados}"
PRAZO_S="${NOD_DADOS_PRAZO_S:-120}"
ALVO="${NOD_DADOS_ALVO:-/var/lib/nod-computador}"
i=0
while ! mountpoint -q "$MONTAGEM"; do
  i=$((i + 1))
  if [ "$i" -gt "$PRAZO_S" ]; then echo "nod: $MONTAGEM não montou em ${PRAZO_S}s" >&2; exit 1; fi
  sleep 1
done
mkdir -p "$MONTAGEM/computador" "$ALVO"
mountpoint -q "$ALVO" || mount --bind "$MONTAGEM/computador" "$ALVO"
