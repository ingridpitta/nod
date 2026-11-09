
# ADR-122 (NOD-96): o computador da pessoa nesta máquina (NOD_COMPUTADORES=motor no servidor). Idempotente: perfis,
# logins e workspace em /var/lib/nod-computador ficam.
$SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq xvfb openbox xdotool xclip scrot x11vnc dbus-x11 gnome-keyring libsecret-tools pulseaudio ffmpeg fonts-liberation fonts-noto-color-emoji bubblewrap tint2 pcmanfm xfce4-terminal adwaita-icon-theme x11-xserver-utils >/dev/null
passo "pacotes do computador (tela, keyring e isolamento)"
# DNS da tela e do terminal pelo stub do systemd-resolved (o IP do resolvedor da nuvem é bloqueado com a metadata).
# Sem o stub, instala o resolved mantendo os servidores de hoje como upstream.
if [ ! -f /run/systemd/resolve/stub-resolv.conf ]; then
  NOD_DNS=$(awk '$1 == "nameserver" { print $2 }' /etc/resolv.conf 2>/dev/null | grep -v '^127\.' | sort -u | tr '\n' ' ')
  if [ -n "$NOD_DNS" ]; then
    $SUDO mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\nDNS=%s\n' "$NOD_DNS" | $SUDO tee /etc/systemd/resolved.conf.d/nod-computador.conf >/dev/null
  fi
  $SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq systemd-resolved >/dev/null
  $SUDO systemctl enable --now systemd-resolved >/dev/null 2>&1 || true
fi
[ -f /run/systemd/resolve/stub-resolv.conf ] && passo "DNS do computador (systemd-resolved)"
getent group nod-pc-arquivos >/dev/null 2>&1 || $SUDO groupadd --system nod-pc-arquivos
getent group nod-pc-ctl >/dev/null 2>&1 || $SUDO groupadd --system nod-pc-ctl
id nod-pc >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --home-dir /var/lib/nod-computador --shell /usr/sbin/nologin --gid nod-pc-arquivos nod-pc
id nod-pc-term >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --home-dir /var/lib/nod-computador --shell /usr/sbin/nologin --gid nod-pc-arquivos nod-pc-term
$SUDO usermod -aG nod-pc-ctl nod-pc
$SUDO install -d -o nod-pc -g nod-pc-arquivos -m 2750 /var/lib/nod-computador
$SUDO mkdir -p "$PASTA/computador"
BAIXADOS=$(mktemp -d)
for ARQUIVO in computador-supervisor.mjs computador-tela.mjs computador-terminal.mjs; do
  curl -fsSL "$NOD_SERVIDOR/api/motor/arquivos/$ARQUIVO" -o "$BAIXADOS/$ARQUIVO"
done
$SUDO install -o root -g root -m 644 "$BAIXADOS/computador-supervisor.mjs" "$PASTA/computador/supervisor.mjs"
$SUDO install -o root -g root -m 644 "$BAIXADOS/computador-tela.mjs" "$PASTA/computador/tela.mjs"
$SUDO install -o root -g root -m 644 "$BAIXADOS/computador-terminal.mjs" "$PASTA/computador/terminal.mjs"
rm -rf "$BAIXADOS"
if [ ! -f "$PASTA/computador/node_modules/playwright-core/package.json" ] || ! grep -q '"version": "1.63.0"' "$PASTA/computador/node_modules/playwright-core/package.json"; then
  echo '{"name":"nod-computador","private":true,"type":"module"}' | $SUDO tee "$PASTA/computador/package.json" >/dev/null
  $SUDO env PATH="$PASTA/node/bin:$PATH" "$PASTA/node/bin/npm" install --prefix "$PASTA/computador" --no-fund --no-audit --ignore-scripts --loglevel=error playwright-core@1.63.0 >/dev/null
fi
$SUDO env PLAYWRIGHT_BROWSERS_PATH="$PASTA/chromium" "$PASTA/node/bin/node" "$PASTA/computador/node_modules/playwright-core/cli.js" install --with-deps chromium >/dev/null
$SUDO chmod -R a+rX "$PASTA/chromium" "$PASTA/computador"
passo "Chromium do computador"
$SUDO tee /etc/systemd/system/nod-computador.socket >/dev/null <<'NODUNIDADE'
[Unit]
Description=Nod: o socket do computador da pessoa (ADR-122)

[Socket]
ListenStream=/run/nod-computador/ctl.sock
SocketUser=nod-pc
SocketGroup=nod
SocketMode=0660
DirectoryMode=0755

[Install]
WantedBy=sockets.target
NODUNIDADE
$SUDO tee /etc/systemd/system/nod-computador.service >/dev/null <<'NODUNIDADE'
[Unit]
Description=Nod: o supervisor do computador da pessoa (ADR-122)
Requires=nod-computador.socket nod-computador-terminal.socket
After=network-online.target

[Service]
Type=simple
User=nod-pc
Group=nod-pc-arquivos
SupplementaryGroups=nod-pc-ctl
StateDirectory=nod-computador
StateDirectoryMode=2750
RuntimeDirectory=nod-computador-pc
RuntimeDirectoryMode=0700
WorkingDirectory=/var/lib/nod-computador
Environment=HOME=/var/lib/nod-computador
Environment=NOD_PC_RAIZ=/var/lib/nod-computador
Environment=NOD_PC_RUN=/run/nod-computador-pc
Environment=NOD_PC_TERMINAL=/run/nod-computador/term.sock
Environment=NOD_PC_TELA=/opt/nod-motor/computador/tela.mjs
Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/nod-motor/chromium
ExecStart=/opt/nod-motor/node/bin/node /opt/nod-motor/computador/supervisor.mjs
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelModules=true
ProtectControlGroups=true
OOMScoreAdjust=300
IPAddressDeny=127.0.0.0/8 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10
IPAddressAllow=127.0.0.53/32
BindReadOnlyPaths=-/run/systemd/resolve/stub-resolv.conf:/etc/resolv.conf
NODUNIDADE
$SUDO tee /etc/systemd/system/nod-computador-terminal.socket >/dev/null <<'NODUNIDADE'
[Unit]
Description=Nod: o socket do terminal do computador da pessoa (ADR-122)

[Socket]
ListenStream=/run/nod-computador/term.sock
SocketUser=nod-pc-term
SocketGroup=nod-pc-ctl
SocketMode=0660
DirectoryMode=0755

[Install]
WantedBy=sockets.target
NODUNIDADE
$SUDO tee /etc/systemd/system/nod-computador-terminal.service >/dev/null <<'NODUNIDADE'
[Unit]
Description=Nod: o terminal do computador da pessoa, sem tela (ADR-122)
Requires=nod-computador-terminal.socket

[Service]
Type=simple
User=nod-pc-term
Group=nod-pc-arquivos
UMask=0007
WorkingDirectory=/var/lib/nod-computador
Environment=HOME=/var/lib/nod-computador
Environment=NOD_PC_RAIZ=/var/lib/nod-computador
ReadWritePaths=/var/lib/nod-computador
ExecStart=/opt/nod-motor/node/bin/node /opt/nod-motor/computador/terminal.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
OOMScoreAdjust=300
IPAddressDeny=127.0.0.0/8 ::1/128 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10 fc00::/7 fe80::/10
IPAddressAllow=127.0.0.53/32
BindReadOnlyPaths=-/run/systemd/resolve/stub-resolv.conf:/etc/resolv.conf
NODUNIDADE
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now nod-computador-terminal.socket nod-computador.socket >/dev/null 2>&1
# Arquivos novos valem no próximo comando: o serviço reinicia se já estava de pé (as telas fecham; os dados ficam).
$SUDO systemctl try-restart nod-computador.service nod-computador-terminal.service >/dev/null 2>&1 || true
passo "computador da pessoa (nod-computador)"
