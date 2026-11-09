#!/usr/bin/env bash
# NOD-93 (ADR-127): o disco base da VM local do Mac, um por arquitetura: Debian 12 genericcloud + chrony + o computador
# da pessoa da ADR-122 (pacotes, usuários, units, o node do motor e o Chromium do Playwright), pelo MESMO
# blocoDoComputador do instalador, com os arquivos locais e sem ligar a unit. Sem dockerd e sem imagem. Sai
#   <saida>/nod-vm-<versao>-<arch>.img.zst  (raw comprimido)  e  <saida>/nod-vm-<versao>-<arch>.img.zst.sha256
# O app baixa esse arquivo (Range + sha256, desktop/vm-local/download.ts) e o Lima (vmType vz) liga a VM com ele.
# Perfis, cookies e chaves do supervisor (/var/lib/nod-computador) moram no disco de dados `nod-dados`
# (nod-dados.service), não neste: trocar o disco base a cada versão do app não apaga nada da pessoa.
#
# Roda no workflow desktop-release (job vm-local) num runner Linux da MESMA arquitetura do disco: o virt-customize
# executa o apt do convidado, e convidado de outra arquitetura exigiria emulação. Precisa de root (libguestfs),
# libguestfs-tools, qemu-utils, zstd, curl e sha512sum/sha256sum.
#
# Uso:
#   construir-disco.sh [--simular] <arm64|amd64> <versao> <origem> <saida>
# <origem> é a pasta de `node scripts/vm-local/origem-do-disco.ts` (computador-*.mjs, computador.sh, node.versao).
# --simular: imprime os comandos externos em vez de executá-los (sem download, sem root).
set -euo pipefail
DIR_VM="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source-path=SCRIPTDIR source=base.env
source "$DIR_VM/base.env"

SIMULAR="${SIMULAR:-0}"
exec 3>&1

ext() { # comando externo; na simulação só imprime (no fd 3, para aparecer mesmo dentro de $(...))
  if [ "$SIMULAR" = 1 ]; then echo "[simular] $*" >&3; return 0; fi
  "$@"
}
passo() { printf '\n== %s\n' "$*"; }

arch_valida() { [ "${1:-}" = arm64 ] || [ "${1:-}" = amd64 ]; }
# A versão vira nome de arquivo e rótulo: só o que um semver/tag usa.
versao_valida() { [[ "${1:-}" =~ ^[0-9A-Za-z][0-9A-Za-z.+-]*$ ]]; }

sha512_da_base() { # arch
  case "$1" in
    arm64) echo "$DEBIAN_SHA512_ARM64" ;;
    amd64) echo "$DEBIAN_SHA512_AMD64" ;;
  esac
}
nome_da_base() { echo "debian-12-genericcloud-$1-$DEBIAN_DATA.qcow2"; }
nome_do_disco() { echo "nod-vm-$2-$1.img.zst"; } # arch versao
arq_do_node() { [ "$1" = arm64 ] && echo arm64 || echo x64; }

baixar_node() { # arch versao destino: o node do motor, conferido pelo SHASUMS256.txt do próprio release do Node
  local nome="node-v$2-linux-$(arq_do_node "$1").tar.xz" destino="$3" url="https://nodejs.org/dist/v$2"
  ext curl -fsSL --retry 3 -o "$destino/$nome" "$url/$nome"
  ext curl -fsSL --retry 3 -o "$destino/SHASUMS256.txt" "$url/SHASUMS256.txt"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] conferir sha256 $nome" >&3; else
    (cd "$destino" && grep " $nome\$" SHASUMS256.txt | sha256sum -c --status) || { echo "sha256 do node não confere ($nome)" >&2; return 1; }
  fi
  mv "$destino/$nome" "$destino/node.tar.xz" 2>/dev/null || true
}

baixar_base() { # arch destino
  local arch="$1" destino="$2" esperado
  esperado="$(sha512_da_base "$arch")"
  ext curl -fsSL --retry 3 -o "$destino" "$DEBIAN_URL_BASE/$(nome_da_base "$arch")"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] conferir sha512 $esperado" >&3; return 0; fi
  echo "$esperado  $destino" | sha512sum -c --status || { echo "sha512 da base Debian não confere ($destino)" >&2; return 1; }
}

# Rede do appliance do libguestfs para o apt e o computador.sh do convidado. Sem cliente DHCP no appliance (Ubuntu 24.04)
# a eth0 sobe sem endereço: aqui ela recebe o endereço fixo da rede SLIRP do libguestfs (169.254.0.0/16, gateway .2,
# DNS .3). O daemon do libguestfs troca o /etc/resolv.conf do convidado a cada comando e devolve o original depois,
# por isso o DNS vai junto de cada comando que usa a rede, e não num --run-command à parte.
REDE_DO_APPLIANCE='if ! ip -4 addr show dev eth0 2>/dev/null | grep -q inet; then ip link set eth0 up && ip addr add 169.254.2.15/16 dev eth0 && ip route add default via 169.254.2.2; fi; [ -s /etc/resolv.conf ] || { rm -f /etc/resolv.conf; echo "nameserver 169.254.2.3" > /etc/resolv.conf; }'

construir() { # arch versao origem saida
  local arch="$1" versao="$2" origem="$3" saida="$4" trab raw disco node_versao a
  arch_valida "$arch" || { echo "arquitetura inválida: '$arch' (arm64 ou amd64)" >&2; return 2; }
  versao_valida "$versao" || { echo "versão inválida: '$versao'" >&2; return 2; }
  if [ "$SIMULAR" != 1 ]; then
    for a in computador-supervisor.mjs computador-tela.mjs computador-terminal.mjs computador.sh node.versao; do
      [ -f "$origem/$a" ] || { echo "a origem do disco não tem $a: $origem" >&2; return 2; }
    done
    [ "$(uname -m)" = "$([ "$arch" = arm64 ] && echo aarch64 || echo x86_64)" ] || { echo "o disco $arch precisa de um host $arch (este é $(uname -m))" >&2; return 2; }
  fi
  node_versao="$(cat "$origem/node.versao" 2>/dev/null || echo "${NODE_VERSAO_SIMULADA:-24.19.0}")"
  [[ "$node_versao" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "versão do node inválida: '$node_versao'" >&2; return 2; }
  trab="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$trab'" RETURN
  raw="$trab/disco.raw"
  disco="$saida/$(nome_do_disco "$arch" "$versao")"
  mkdir -p "$saida"

  passo "base Debian $DEBIAN_SERIE $DEBIAN_DATA ($arch)"
  baixar_base "$arch" "$trab/base.qcow2"
  # O qcow2 vem com a raiz de ~2 GB: o virt-resize copia para um raw de DISCO_TAMANHO e estica a raiz (sda1 no
  # genericcloud; 14 e 15 são BIOS e EFI) antes do apt e do Chromium.
  ext qemu-img create -f raw "$raw" "$DISCO_TAMANHO"
  ext virt-resize --expand /dev/sda1 "$trab/base.qcow2" "$raw"

  passo "node $node_versao do motor"
  mkdir -p "$trab/origem"
  baixar_node "$arch" "$node_versao" "$trab/origem"
  [ "$SIMULAR" = 1 ] || cp "$origem"/computador-*.mjs "$origem/computador.sh" "$trab/origem/"

  passo "chrony, o computador da pessoa (ADR-122) e os arquivos do nod no convidado"
  ext virt-customize -a "$raw" --network \
    --run-command "$REDE_DO_APPLIANCE && apt-get -q update && DEBIAN_FRONTEND=noninteractive apt-get -q -y install chrony curl ca-certificates xz-utils" \
    --mkdir /var/lib/nod \
    --copy-in "$trab/origem:/var/lib/nod" \
    --run-command 'mkdir -p /opt/nod-motor/node && tar --no-same-owner -xJf /var/lib/nod/origem/node.tar.xz -C /opt/nod-motor/node --strip-components=1 && chown -R root:root /opt/nod-motor/node' \
    --run-command "$REDE_DO_APPLIANCE && ORIGEM=/var/lib/nod/origem sh /var/lib/nod/origem/computador.sh" \
    --mkdir /etc/systemd/system/nod-computador.service.d \
    --copy-in "$DIR_VM/arquivos/etc/systemd/system/nod-computador.service.d/nod-dados.conf:/etc/systemd/system/nod-computador.service.d" \
    --mkdir /etc/systemd/system/nod-computador-terminal.service.d \
    --copy-in "$DIR_VM/arquivos/etc/systemd/system/nod-computador-terminal.service.d/nod-dados.conf:/etc/systemd/system/nod-computador-terminal.service.d" \
    --copy-in "$DIR_VM/arquivos/etc/systemd/system/nod-dados.service:/etc/systemd/system" \
    --mkdir /etc/chrony/conf.d \
    --copy-in "$DIR_VM/arquivos/etc/chrony/conf.d/nod.conf:/etc/chrony/conf.d" \
    --mkdir /usr/local/lib/nod \
    --copy-in "$DIR_VM/arquivos/usr/local/lib/nod/esperar-dados.sh:/usr/local/lib/nod" \
    --run-command 'chmod 0755 /usr/local/lib/nod/*.sh && systemctl enable nod-dados.service chrony.service' \
    --run-command 'rm -rf /var/lib/nod/origem && apt-get clean && rm -rf /var/lib/apt/lists/*' \
    --truncate /etc/machine-id

  passo "compactar e publicar"
  ext virt-sparsify --in-place "$raw"
  # medido em 2026-11-05 (release rc.3, run 41911353290): o -19 levava 14 min no amd64 e 9 min no arm64, com o disco
  # pronto. Numa amostra de 400 MB: -19 em 72 s (105 MB), -12 em 6 s (118 MB). O -12 custa ~12% de download e
  # devolve 10 a 20 min por release.
  ext zstd -q -T0 -12 --long=27 -o "$disco" "$raw"
  if [ "$SIMULAR" = 1 ]; then echo "[simular] sha256 $disco" >&3; else (cd "$saida" && sha256sum "$(basename "$disco")" > "$(basename "$disco").sha256"); fi
  echo "$disco"
}

main() {
  if [ "${1:-}" = --simular ]; then SIMULAR=1; shift; fi
  [ "$#" -eq 4 ] || { echo "uso: construir-disco.sh [--simular] <arm64|amd64> <versao> <origem> <saida>" >&2; return 2; }
  construir "$@"
}

# Carregado com `source`, só define as funções (os testes usam assim).
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
