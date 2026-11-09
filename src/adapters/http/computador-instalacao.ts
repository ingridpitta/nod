/**
 * definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §4): o que o script do motor (ADR-090) instala a mais quando o servidor
 * roda com NOD_COMPUTADORES=motor — o computador por pessoa. Idempotente: rodar de novo atualiza os arquivos e mantém
 * perfis, logins e workspace. Com a flag desligada nada disto entra no script.
 *
 *   apt (Xvfb, openbox, keyring, bwrap…) ── Chromium do Playwright em /opt/nod-motor/chromium (+ install-deps)
 *   usuários nod-pc (supervisor e telas) e nod-pc-term (terminal), grupo nod-pc-arquivos (o workspace dos dois)
 *   e grupo nod-pc-ctl (só o nod-pc: quem fala com o terminal)
 *   systemd-resolved, se faltar o stub (o DNS da tela e do terminal; ver RESOLV_DO_STUB)
 *   /opt/nod-motor/computador (supervisor.mjs, tela.mjs, terminal.mjs + playwright-core) ── /var/lib/nod-computador
 *   nod-computador.socket/.service e nod-computador-terminal.socket/.service (ativados por socket)
 *
 * O socket de controle é 0660 do grupo `nod`: só o motor fala com o supervisor. O do terminal é 0660 do grupo
 * nod-pc-ctl, que só tem o nod-pc: só o supervisor fala com o terminal, mesmo que o `nod` entre no grupo do workspace
 * (nod-pc-arquivos) para trocar arquivos com os bots.
 */

/** Os arquivos do computador em dist/motor (servidos em /api/motor/arquivos/<nome> só com a flag). */
export const ARQUIVOS_DO_COMPUTADOR = ["computador-supervisor.mjs", "computador-tela.mjs", "computador-terminal.mjs"] as const;
export type ArquivoDoComputador = (typeof ARQUIVOS_DO_COMPUTADOR)[number];

/** A versão do playwright-core do supervisor (a mesma de infra/computador/package.json; um teste confere). */
export const PLAYWRIGHT_DO_COMPUTADOR = "1.63.0";

/**
 * Pacotes do apt. scrot: a tela captura com ele, como o runtime (desvio registrado na ADR-122). x11vnc: a tela ao vivo
 * (NOD-95, ADR-138). tint2, pcmanfm, xfce4-terminal, adwaita-icon-theme e x11-xserver-utils: o dock do desktop (NOD-410,
 * 30/10): o painel com Chrome, Arquivos e Terminal, os ícones e o fundo da tela.
 */
export const PACOTES_DO_COMPUTADOR = [
  "xvfb", "openbox", "xdotool", "xclip", "scrot", "x11vnc", "dbus-x11", "gnome-keyring", "libsecret-tools", "pulseaudio", "ffmpeg",
  "fonts-liberation", "fonts-noto-color-emoji", "bubblewrap",
  "tint2", "pcmanfm", "xfce4-terminal", "adwaita-icon-theme", "x11-xserver-utils",
] as const;

/**
 * Redes que a tela e o terminal não alcançam (metadados da nuvem, a rede da casa, o próprio host). 127.0.0.53 fica
 * liberado: é o stub do systemd-resolved, que roda fora do cgroup e alcança o upstream. O IP do resolvedor da nuvem
 * NÃO é liberado: no GCE ele é 169.254.169.254, o mesmo da metadata, e o IPAddressAllow não filtra porta.
 */
export const REDES_NEGADAS = ["127.0.0.0/8", "::1/128", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "fc00::/7", "fe80::/10"] as const;
export const REDES_LIBERADAS = ["127.0.0.53/32"] as const;

/**
 * O resolv.conf que aponta para o stub (127.0.0.53). As units o montam em /etc/resolv.conf: na VM-alvo o
 * /etc/resolv.conf aponta direto para 169.254.169.254, que o IPAddressDeny corta. Sem o arquivo, o instalador põe o
 * systemd-resolved e o motor anuncia `faltam_pacotes` com "systemd-resolved". O mesmo caminho está em isolamento.mjs.
 */
export const RESOLV_DO_STUB = "/run/systemd/resolve/stub-resolv.conf";

/** O grupo do socket do terminal: só o nod-pc (o supervisor). Separado do grupo do workspace (nod-pc-arquivos). */
export const GRUPO_DO_TERMINAL = "nod-pc-ctl";

/**
 * NOD-96: o supervisor fica SEM ProtectKernelTunables e ProtectKernelLogs. No systemd 257 (Debian 13) elas cobrem
 * pedaços do /proc, e o kernel recusa o procfs novo do bwrap das telas ("Can't mount proc on /proc"): nenhuma tela
 * abre. O nod-pc não tem privilégio (NoNewPrivileges) e cada tela segue no bwrap; o terminal mantém as duas.
 */
const endurecimento = (doKernel: boolean) => `NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
${doKernel ? "ProtectKernelTunables=true\n" : ""}ProtectKernelModules=true
${doKernel ? "ProtectKernelLogs=true\n" : ""}ProtectControlGroups=true
OOMScoreAdjust=300
IPAddressDeny=${REDES_NEGADAS.join(" ")}
IPAddressAllow=${REDES_LIBERADAS.join(" ")}
BindReadOnlyPaths=-${RESOLV_DO_STUB}:/etc/resolv.conf`;

/** As quatro units (nome → conteúdo). */
export const UNIDADES_DO_COMPUTADOR: Record<string, string> = {
  "nod-computador.socket": `[Unit]
Description=Nod: o socket do computador da pessoa (ADR-122)

[Socket]
ListenStream=/run/nod-computador/ctl.sock
SocketUser=nod-pc
SocketGroup=nod
SocketMode=0660
DirectoryMode=0755

[Install]
WantedBy=sockets.target
`,
  "nod-computador.service": `[Unit]
Description=Nod: o supervisor do computador da pessoa (ADR-122)
Requires=nod-computador.socket nod-computador-terminal.socket
After=network-online.target

[Service]
Type=simple
User=nod-pc
Group=nod-pc-arquivos
SupplementaryGroups=${GRUPO_DO_TERMINAL}
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
${endurecimento(false)}
`,
  "nod-computador-terminal.socket": `[Unit]
Description=Nod: o socket do terminal do computador da pessoa (ADR-122)

[Socket]
ListenStream=/run/nod-computador/term.sock
SocketUser=nod-pc-term
SocketGroup=${GRUPO_DO_TERMINAL}
SocketMode=0660
DirectoryMode=0755

[Install]
WantedBy=sockets.target
`,
  "nod-computador-terminal.service": `[Unit]
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
${endurecimento(true)}
`,
};

/** O nome em /opt/nod-motor/computador de cada arquivo baixado. */
const DESTINO: Record<ArquivoDoComputador, string> = {
  "computador-supervisor.mjs": "supervisor.mjs",
  "computador-tela.mjs": "tela.mjs",
  "computador-terminal.mjs": "terminal.mjs",
};

/**
 * Como o bloco pega os arquivos e trata as units (ADR-127 §1). `servidor` (padrão) baixa de `$NOD_SERVIDOR`; `locais`
 * copia de `$ORIGEM` (o disco da VM do Mac, construído sem servidor). `ligar: false` só habilita as units, sem
 * daemon-reload, `--now` nem try-restart: funciona num chroot sem systemd de pé.
 */
export interface OpcoesDoBloco {
  arquivos?: "servidor" | "locais";
  ligar?: boolean;
}

/** O trecho de shell do script do motor (roda dentro de principal(), depois dos arquivos do motor). */
export function blocoDoComputador(o: OpcoesDoBloco = {}): string {
  const locais = o.arquivos === "locais";
  const ligar = o.ligar !== false;
  const unidades = Object.entries(UNIDADES_DO_COMPUTADOR)
    .map(([nome, conteudo]) => `$SUDO tee /etc/systemd/system/${nome} >/dev/null <<'NODUNIDADE'\n${conteudo}NODUNIDADE`)
    .join("\n");
  return `
# ADR-122 (NOD-96): o computador da pessoa nesta máquina (NOD_COMPUTADORES=motor no servidor). Idempotente: perfis,
# logins e workspace em /var/lib/nod-computador ficam.
$SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq ${PACOTES_DO_COMPUTADOR.join(" ")} >/dev/null
passo "pacotes do computador (tela, keyring e isolamento)"
# DNS da tela e do terminal pelo stub do systemd-resolved (o IP do resolvedor da nuvem é bloqueado com a metadata).
# Sem o stub, instala o resolved mantendo os servidores de hoje como upstream.
if [ ! -f ${RESOLV_DO_STUB} ]; then
  NOD_DNS=$(awk '$1 == "nameserver" { print $2 }' /etc/resolv.conf 2>/dev/null | grep -v '^127\\.' | sort -u | tr '\\n' ' ')
  if [ -n "$NOD_DNS" ]; then
    $SUDO mkdir -p /etc/systemd/resolved.conf.d
    printf '[Resolve]\\nDNS=%s\\n' "$NOD_DNS" | $SUDO tee /etc/systemd/resolved.conf.d/nod-computador.conf >/dev/null
  fi
  $SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq systemd-resolved >/dev/null
  $SUDO systemctl enable --now systemd-resolved >/dev/null 2>&1 || true
fi
[ -f ${RESOLV_DO_STUB} ] && passo "DNS do computador (systemd-resolved)"
getent group nod-pc-arquivos >/dev/null 2>&1 || $SUDO groupadd --system nod-pc-arquivos
getent group ${GRUPO_DO_TERMINAL} >/dev/null 2>&1 || $SUDO groupadd --system ${GRUPO_DO_TERMINAL}
id nod-pc >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --home-dir /var/lib/nod-computador --shell /usr/sbin/nologin --gid nod-pc-arquivos nod-pc
id nod-pc-term >/dev/null 2>&1 || $SUDO useradd --system --no-create-home --home-dir /var/lib/nod-computador --shell /usr/sbin/nologin --gid nod-pc-arquivos nod-pc-term
$SUDO usermod -aG ${GRUPO_DO_TERMINAL} nod-pc
$SUDO install -d -o nod-pc -g nod-pc-arquivos -m 2750 /var/lib/nod-computador
$SUDO mkdir -p "$PASTA/computador"
${locais ? copiaLocal() : baixaDoServidor()}if [ ! -f "$PASTA/computador/node_modules/playwright-core/package.json" ] || ! grep -q '"version": "${PLAYWRIGHT_DO_COMPUTADOR}"' "$PASTA/computador/node_modules/playwright-core/package.json"; then
  echo '{"name":"nod-computador","private":true,"type":"module"}' | $SUDO tee "$PASTA/computador/package.json" >/dev/null
  $SUDO env PATH="$PASTA/node/bin:$PATH" "$PASTA/node/bin/npm" install --prefix "$PASTA/computador" --no-fund --no-audit --ignore-scripts --loglevel=error playwright-core@${PLAYWRIGHT_DO_COMPUTADOR} >/dev/null
fi
$SUDO env PLAYWRIGHT_BROWSERS_PATH="$PASTA/chromium" "$PASTA/node/bin/node" "$PASTA/computador/node_modules/playwright-core/cli.js" install --with-deps chromium >/dev/null
$SUDO chmod -R a+rX "$PASTA/chromium" "$PASTA/computador"
passo "Chromium do computador"
${unidades}
${ligar ? LIGAR_UNITS : HABILITAR_UNITS}
passo "computador da pessoa (nod-computador)"
`;
}

const LIGAR_UNITS = `$SUDO systemctl daemon-reload
$SUDO systemctl enable --now nod-computador-terminal.socket nod-computador.socket >/dev/null 2>&1
# Arquivos novos valem no próximo comando: o serviço reinicia se já estava de pé (as telas fecham; os dados ficam).
$SUDO systemctl try-restart nod-computador.service nod-computador-terminal.service >/dev/null 2>&1 || true`;

/** No chroot (disco da VM do Mac): só os links do enable; a unit sobe no primeiro boot da VM. */
const HABILITAR_UNITS = `$SUDO systemctl enable nod-computador-terminal.socket nod-computador.socket >/dev/null 2>&1`;

function baixaDoServidor(): string {
  return `BAIXADOS=$(mktemp -d)
for ARQUIVO in ${ARQUIVOS_DO_COMPUTADOR.join(" ")}; do
  curl -fsSL "$NOD_SERVIDOR/api/motor/arquivos/$ARQUIVO" -o "$BAIXADOS/$ARQUIVO"
done
${ARQUIVOS_DO_COMPUTADOR.map((a) => `$SUDO install -o root -g root -m 644 "$BAIXADOS/${a}" "$PASTA/computador/${DESTINO[a]}"`).join("\n")}
rm -rf "$BAIXADOS"
`;
}

/** `$ORIGEM` tem os mesmos nomes de dist/motor (computador-*.mjs). */
function copiaLocal(): string {
  return `${ARQUIVOS_DO_COMPUTADOR.map((a) => `$SUDO install -o root -g root -m 644 "$ORIGEM/${a}" "$PASTA/computador/${DESTINO[a]}"`).join("\n")}
`;
}
