#!/usr/bin/env bash
# `xcrun stapler <staple|validate> <alvo>` com retry quando o CloudKit da Apple não responde.
#
# Medido em 5/11/2026 (release v1.0.0-rc.5, run 42035097482): o job mac x64 (macos-15-intel) caiu 4 vezes seguidas com
# `Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."` em https://api.apple-cloudkit.com e
# "The staple and validate action failed! Error 68", cada vez num passo diferente (o staple do electron-builder, o do
# DMG, o validate do ZIP, o validate do verificador). O arm64 passou todas. O stapler busca o bilhete no CloudKit a
# cada chamada; a queda é transitória, então repetir resolve. Só a saída 68 (CloudKit) repete; outra falha sai na hora.
set -uo pipefail
acao="${1:?staple|validate}"
alvo="${2:?alvo}"
tentativas="${STAPLER_TENTATIVAS:-6}"
espera="${STAPLER_ESPERA_S:-20}"
for i in $(seq 1 "$tentativas"); do
  xcrun stapler "$acao" "$alvo"
  codigo=$?
  if [ "$codigo" -eq 0 ]; then exit 0; fi
  if [ "$codigo" -ne 68 ] || [ "$i" -eq "$tentativas" ]; then
    echo "::error::stapler $acao ($alvo) saiu com $codigo na tentativa $i de $tentativas" >&2
    exit "$codigo"
  fi
  echo "::warning::stapler $acao ($alvo): CloudKit da Apple não respondeu (saída 68), tentativa $i de $tentativas; espera ${espera}s" >&2
  sleep "$espera"
done
