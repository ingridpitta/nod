#!/usr/bin/env bash
# NOD-96 PR 7 (definido em 2026-10-22, ADR-122): roda DENTRO da VM limpa, como root, a partir da cópia do repo que o
# scripts/e2e-computador-vm.sh enviou. Instala o computador da pessoa exatamente como o script do motor (o mesmo
# blocoDoComputador(), com os arquivos de dist/motor servidos por um http local no lugar do servidor), confere as
# units do systemd e roda o na-vm.mjs como o usuário `nod`.
#
#   sudo bash scripts/e2e-computador-vm/preparar.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$(pwd)
PASTA=/opt/nod-motor
NODE_VERSAO=$(node -p 'require("./package.json").engines.node' 2>/dev/null || echo 24.19.0)
falhas=0
ok() { echo "ok      $*"; }
falhou() { echo "FALHOU  $*"; falhas=$((falhas + 1)); }

. /etc/os-release
echo "== $PRETTY_NAME ($(uname -r)), $(nproc) vCPU, $(free -m | awk '/Mem:/{print $2}') MB"

# 1. O que a VM limpa não tem e o script do motor pressupõe (o node do motor e o usuário nod).
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates xz-utils python3 >/dev/null
if [ ! -x "$PASTA/node/bin/node" ]; then
  mkdir -p "$PASTA/node"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSAO}/node-v${NODE_VERSAO}-linux-x64.tar.xz" | tar -xJ -C "$PASTA/node" --strip-components=1
fi
export PATH="$PASTA/node/bin:$PATH"
id nod >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash nod

# 2. Os arquivos do computador (dist/motor) servidos como /api/motor/arquivos/<nome>, como o servidor faria.
if [ ! -f dist/motor/computador-supervisor.mjs ]; then
  npm ci --no-fund --no-audit --loglevel=error
  node scripts/motor/build.mjs
fi
SERVE=$(mktemp -d)
mkdir -p "$SERVE/api/motor/arquivos"
cp dist/motor/computador-*.mjs "$SERVE/api/motor/arquivos/"
python3 -m http.server 8099 --bind 127.0.0.1 --directory "$SERVE" >/dev/null 2>&1 &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null || true' EXIT
sleep 1

# 3. O mesmo trecho que o script do motor roda (src/adapters/http/computador-instalacao.ts), duas vezes: a segunda
#    prova que é idempotente.
node --input-type=module -e "import { blocoDoComputador } from '$REPO/src/adapters/http/computador-instalacao.ts'; process.stdout.write(blocoDoComputador());" > /tmp/bloco-computador.sh
for vez in 1 2; do
  if SUDO="" APT=apt-get PASTA="$PASTA" NOD_SERVIDOR=http://127.0.0.1:8099 bash -euo pipefail -c 'passo() { echo "  ✓ $1"; }; . /tmp/bloco-computador.sh'; then
    ok "instalação do computador (vez $vez)"
  else
    falhou "instalação do computador (vez $vez)"
  fi
done

# 4. As units numa máquina limpa: sockets de pé, serviço ativado pelo socket, endurecimento aplicado.
for u in nod-computador.socket nod-computador-terminal.socket; do
  systemctl is-active --quiet "$u" && ok "$u ativo" || falhou "$u inativo: $(systemctl status "$u" --no-pager 2>&1 | tail -5)"
done
[ "$(stat -c '%U:%G %a' /run/nod-computador/ctl.sock)" = "nod-pc:nod 660" ] && ok "ctl.sock nod-pc:nod 0660" || falhou "ctl.sock $(stat -c '%U:%G %a' /run/nod-computador/ctl.sock)"
# O grupo do term.sock vem da mesma constante que gera a unit (GRUPO_DO_TERMINAL): só o supervisor fala com o terminal.
GRUPO_TERM=$(node --input-type=module -e "import { GRUPO_DO_TERMINAL } from '$REPO/src/adapters/http/computador-instalacao.ts'; process.stdout.write(GRUPO_DO_TERMINAL);")
[ "$(stat -c '%U:%G %a' /run/nod-computador/term.sock)" = "nod-pc-term:$GRUPO_TERM 660" ] && ok "term.sock nod-pc-term:$GRUPO_TERM 0660" || falhou "term.sock $(stat -c '%U:%G %a' /run/nod-computador/term.sock) (esperado nod-pc-term:$GRUPO_TERM 660)"
for u in nod-computador.service nod-computador-terminal.service; do
  deny=$(systemctl show "$u" -p IPAddressDeny --value)
  case "$deny" in *169.254.0.0/16*) ok "$u: IPAddressDeny com metadata" ;; *) falhou "$u: IPAddressDeny='$deny'" ;; esac
  echo "  segurança de $u: $(systemd-analyze security "$u" --no-pager 2>/dev/null | tail -1)"
done
PW="$PASTA/computador/node_modules/playwright-core/package.json"
[ -f "$PW" ] && ok "playwright-core $(node -p "require('$PW').version")" || falhou "playwright-core ausente"
ls -d "$PASTA"/chromium/chromium* >/dev/null 2>&1 && ok "Chromium do Playwright em $PASTA/chromium" || falhou "Chromium ausente em $PASTA/chromium"
if sudo -u nod ls /var/lib/nod-computador >/dev/null 2>&1; then falhou "nod lê /var/lib/nod-computador"; else ok "nod não lê /var/lib/nod-computador (perfis, logins, keyring)"; fi

# 5. O smoke de verdade (Xvfb, Chromium, bwrap, egress, Atualizar/Redefinir), como o motor: usuário nod.
chmod -R a+rX "$REPO"
if sudo -u nod env PATH="$PATH" node "$REPO/scripts/e2e-computador-vm/na-vm.mjs" --telas "${NOD_SMOKE_TELAS:-6}"; then ok "smoke do supervisor"; else falhou "smoke do supervisor"; fi
systemctl is-active --quiet nod-computador.service && ok "nod-computador.service de pé depois do Atualizar (Restart=always)" || falhou "nod-computador.service caiu"
echo "== log do supervisor (últimas 40 linhas)"
journalctl -u nod-computador.service --no-pager -n 40 || true

# 6. Reinício da VM: os sockets voltam sozinhos (WantedBy=sockets.target).
systemctl is-enabled --quiet nod-computador.socket && systemctl is-enabled --quiet nod-computador-terminal.socket && ok "sockets habilitados no boot" || falhou "sockets não habilitados no boot"

echo
[ "$falhas" -eq 0 ] && echo "SMOKE OK ($PRETTY_NAME)" || echo "SMOKE FALHOU: $falhas checagem(ns) ($PRETTY_NAME)"
exit "$falhas"
