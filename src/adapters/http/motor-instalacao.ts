/**
 * A instalação do motor numa máquina Linux da pessoa (ADR-090): `curl -fsSL https://<nod>/motor | sh`. O servidor serve
 * este script com o próprio endereço e a própria versão, e os três arquivos do motor (dist/motor). Debian e Ubuntu,
 * x64 e arm64. Roda de novo para atualizar: troca os arquivos, mantém a conexão e o login das IAs.
 *
 *   root/sudo ── apt (curl, git, gh) ── Node fixo em /opt/nod-motor/node ── usuário `nod`
 *            └─ Claude Code e Codex (sem o Codex com NOD_SEM_CODEX=1) no ~/.local do `nod` ── /opt/nod-motor/app (3 arquivos)
 *            └─ /usr/local/bin/nod-motor (roda como `nod`) ── serviço nod-motor (systemd) ── pareamento por código
 *
 * O motor roda como o usuário `nod`, nunca root. A chave fica em ~nod/.config/nod-motor (0600). O login das IAs é feito
 * pela pessoa, pela tela (ADR-102) ou no terminal (`nod-motor entrar claude`): o script não pede nem guarda credencial.
 *
 * ADR-102 (2026-10-13): o comando que a tela mostra leva um convite de uso único (`/motor?convite=…`); o pareamento
 * no fim o leva junto e a tela vê a máquina chegar sem a pessoa digitar código. O Codex vem sempre.
 *
 * NOD-94 (emenda 11 da ADR-090): `/motor?papel=computador` instala a máquina "só computador" — o mesmo motor, sem gh,
 * Claude Code nem Codex (ela nunca pega turno). Nesse modo o script também escreve, uma por linha, `NOD-ETAPA:<id>` a
 * cada passo e `NOD-ERRO:<motivo>` antes de falhar: é o que a instaladora por SSH lê para mostrar o progresso. O papel
 * de verdade é do convite (o servidor grava); o do script só escolhe o que instalar. Sem papel, o script é o de sempre,
 * byte a byte.
 */
import { CONVITE } from "../../shared/convite.ts";
import { ARQUIVOS_DO_MOTOR } from "../../domain/atualizacao-do-motor.ts";
import { blocoDoComputador } from "./computador-instalacao.ts";
import { PISO_CLI } from "../executor/flag-floors.ts";

export { ARQUIVOS_DO_MOTOR, type ArquivoDoMotor } from "../../domain/atualizacao-do-motor.ts";

/** O Node que o motor usa (o mesmo do .mise.toml e do Dockerfile). */
export const NODE_DO_MOTOR = "24.19.0";

/** Só https (ou http em loopback, dev) e um host sem nada que o shell interprete. */
export function servidorParaScript(proto: string, host: string): string | null {
  const p = proto.split(",")[0]?.trim().toLowerCase();
  const h = host.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  const loopback = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h);
  if (p === "https") return `https://${h}`;
  if (p === "http" && loopback) return `http://${h}`;
  return null;
}

/** O convite do comando (ADR-102): 32 caracteres base64url, nada que o shell interprete. */
export const CONVITE_NO_SCRIPT = CONVITE;

/** NOD-94: as etapas que o script só-computador anuncia, na ordem (`NOD-ETAPA:<id>`). */
export const ETAPAS_DO_SCRIPT = ["conferencia", "pacotes", "node", "usuario", "motor", "servico", "pareamento", "pronta"] as const;
export type EtapaDoScript = (typeof ETAPAS_DO_SCRIPT)[number];
/** NOD-94: os motivos que o script só-computador escreve antes de sair (`NOD-ERRO:<motivo>`). */
export const ERROS_DO_SCRIPT = ["so_nao_suportado", "sem_sudo", "nao_pareou", "instalacao_falhou"] as const;
export type ErroDoScript = (typeof ERROS_DO_SCRIPT)[number];

/** `papel` do endereço (`/motor?papel=…`): só "computador" muda o script; qualquer outra coisa é o de sempre. */
export function papelDoScript(v: string | null | undefined): "computador" | null {
  return v === "computador" ? "computador" : null;
}

/**
 * `computador` (NOD-96 PR 2, ADR-122): o servidor roda com NOD_COMPUTADORES=motor e a máquina recebe também o
 * computador da pessoa (computador-instalacao.ts). Sem ele o script é o mesmo de antes, byte a byte.
 */
export function scriptDeInstalacao(o: { servidor: string; versao: string; convite?: string | null; papel?: "computador" | null; computador?: boolean }): string {
  if (!/^https?:\/\/[a-z0-9.:-]+$/.test(o.servidor) || !/^[0-9A-Za-z.+-]+$/.test(o.versao)) throw new Error("servidor_ou_versao_invalida");
  const convite = o.convite && CONVITE_NO_SCRIPT.test(o.convite) ? o.convite : "";
  const comp = o.papel === "computador";
  /** A linha de etapa (só no modo computador; no de sempre, nada muda). */
  const etapa = (id: EtapaDoScript) => (comp ? `etapa ${id}\n` : "");
  /** O motivo de uma falha conhecida (só no modo computador). */
  const motivo = (m: ErroDoScript) => (comp ? ` ${m}` : "");
  return `#!/bin/sh
# Nod: instala ou atualiza o motor nesta máquina (ADR-090). Servido por ${o.servidor}/motor
set -eu
# Tudo roda dentro de principal(), chamada na última linha: se o curl cortar a conexão no meio, nada pela metade executa.
# /usr/sbin e /sbin no PATH: runuser e useradd moram lá, e o root de "su" sem hífen (Debian) não os tem.
PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
cd /
NOD_SERVIDOR="${o.servidor}"
NOD_VERSAO="${o.versao}"
NOD_CONVITE="${convite}"
NODE_VERSAO="${NODE_DO_MOTOR}"
PASTA=/opt/nod-motor
USUARIO=nod
CASA=/home/nod

${comp ? `# NOD-94: a máquina só computador (nunca pega turno): sem gh, Claude Code nem Codex. As linhas NOD-ETAPA e NOD-ERRO
# são para a instaladora por SSH; quem roda à mão as vê passar e pode ignorá-las.
NOD_ERRO_DITO=""
falhar() { NOD_ERRO_DITO=1; printf 'NOD-ERRO:%s\\n' "\${2:-instalacao_falhou}"; printf '\\n\\342\\234\\227 %s\\n' "$1" >&2; exit 1; }
etapa() { printf 'NOD-ETAPA:%s\\n' "$1"; }
# Um comando que falha no meio (set -e) sai sem passar por falhar(): o EXIT diz o motivo genérico.
trap 'cod=$?; if [ "$cod" -ne 0 ] && [ -z "$NOD_ERRO_DITO" ]; then printf "NOD-ERRO:instalacao_falhou\\n"; fi' EXIT
` : `falhar() { printf '\\n\\342\\234\\227 %s\\n' "$1" >&2; exit 1; }
`}passo() { printf '\\342\\234\\223 %s\\n' "$1"; }

principal() {

${etapa("conferencia")}[ "$(uname -s)" = "Linux" ] || falhar "O motor do Nod roda em Linux (Debian ou Ubuntu)."${motivo("so_nao_suportado")}
command -v apt-get >/dev/null 2>&1 || falhar "Esta instalação usa o apt (Debian ou Ubuntu)."${motivo("so_nao_suportado")}
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  command -v sudo >/dev/null 2>&1 || falhar "Rode como root ou instale o sudo."${motivo("sem_sudo")}
  SUDO="sudo"
fi
case "$(uname -m)" in
  x86_64|amd64) ARQ=x64 ;;
  aarch64|arm64) ARQ=arm64 ;;
  *) falhar "Processador não suportado: $(uname -m)"${motivo("so_nao_suportado")} ;;
esac
como_nod() {
  if [ "$(id -u)" -eq 0 ]; then runuser -u "$USUARIO" -- env HOME="$CASA" PATH="$CASA/.local/bin:$PASTA/node/bin:/usr/local/bin:/usr/bin:/bin" "$@"
  else sudo -u "$USUARIO" -H env HOME="$CASA" PATH="$CASA/.local/bin:$PASTA/node/bin:/usr/local/bin:/usr/bin:/bin" "$@"; fi
}

printf 'Nod \\302\\267 instalando o motor %s nesta máquina${comp ? " (s\\303\\263 computador)" : ""}\\n' "$NOD_VERSAO"

# Numa VM recém-criada o cloud-init ou o unattended-upgrades seguram a trava do dpkg por alguns minutos: espera até 5 min.
APT="apt-get -o DPkg::Lock::Timeout=300"
${etapa("pacotes")}$SUDO $APT update -qq >/dev/null
$SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq curl ca-certificates git xz-utils procps >/dev/null
passo "curl e git"
${comp ? "" : `
if ! command -v gh >/dev/null 2>&1; then
  $SUDO mkdir -p -m 755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | $SUDO tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
  $SUDO chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | $SUDO tee /etc/apt/sources.list.d/github-cli.list >/dev/null
  $SUDO $APT update -qq >/dev/null
  $SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq gh >/dev/null
fi
passo "gh (GitHub)"
`}
${etapa("node")}if [ "$("$PASTA/node/bin/node" --version 2>/dev/null || true)" != "v$NODE_VERSAO" ]; then
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSAO/node-v$NODE_VERSAO-linux-$ARQ.tar.xz" -o "$TMP/node.tar.xz"
  # Extrai ao lado e só troca se deu certo (disco cheio não deixa a máquina sem Node). --no-same-owner + chown: o tarball
  # oficial traz uid 1001, que pode ser o do usuário nod — e o root executa este Node na próxima atualização.
  $SUDO rm -rf "$PASTA/node.novo"
  $SUDO mkdir -p "$PASTA/node.novo"
  $SUDO tar --no-same-owner -xJf "$TMP/node.tar.xz" -C "$PASTA/node.novo" --strip-components=1
  $SUDO chown -R root:root "$PASTA/node.novo"
  $SUDO rm -rf "$PASTA/node"
  $SUDO mv "$PASTA/node.novo" "$PASTA/node"
  rm -rf "$TMP"
fi
passo "Node $NODE_VERSAO"

${etapa("usuario")}if ! id "$USUARIO" >/dev/null 2>&1; then
  $SUDO useradd --create-home --home-dir "$CASA" --shell /bin/bash "$USUARIO"
fi
passo "usuário $USUARIO"
${comp ? "" : `
# NOD-8 (definido em 2026-10-22): os dois pacotes pedem o piso (>=PISO_CLI), como o instalador do Mac (ADR-093): a VM
# nunca recebe uma versão que o motor recusaria (cli_antigo).
como_nod npm install -g --prefix "$CASA/.local" --no-fund --no-audit --loglevel=error @anthropic-ai/claude-code@">=${PISO_CLI["claude-cli"]}" >/dev/null
passo "Claude Code"
# ADR-102: o Codex vem sempre (antes só com NOD_COM_CODEX=1); NOD_SEM_CODEX=1 desliga.
if [ "\${NOD_SEM_CODEX:-0}" != "1" ]; then
  # Revisão do PR #306: o Codex não derruba a instalação (nem a atualização de uma VM que já roda só com o Claude).
  if como_nod npm install -g --prefix "$CASA/.local" --no-fund --no-audit --loglevel=error @openai/codex@">=${PISO_CLI["codex-cli"]}" >/dev/null; then passo "Codex"
  else printf 'Aviso: o Codex não instalou agora. Rode a instalação de novo depois para tentar outra vez.\\n'; fi
fi
`}
${etapa("motor")}$SUDO mkdir -p "$PASTA/app"
BAIXADOS=$(mktemp -d)
for ARQUIVO in ${ARQUIVOS_DO_MOTOR.join(" ")}; do
  curl -fsSL "$NOD_SERVIDOR/api/motor/arquivos/$ARQUIVO" -o "$BAIXADOS/$ARQUIVO"
done
for ARQUIVO in ${ARQUIVOS_DO_MOTOR.join(" ")}; do
  $SUDO install -o root -g root -m 644 "$BAIXADOS/$ARQUIVO" "$PASTA/app/$ARQUIVO"
done
rm -rf "$BAIXADOS"
passo "motor $NOD_VERSAO"
${o.computador ? blocoDoComputador() : ""}
# ADR-097 (fase 0b): sem swap, um pico de memória trava a máquina por minutos (medido na VM dos bots em 11/10: ~20 min
# trocando páginas). Swap comprimido em memória (zram), o padrão do Fedora: metade da memória, até 8 GB. Sem o módulo
# zram no kernel, um arquivo de swap de 4 GB no disco, se sobra espaço. Só quando não há swap nenhum: quem já tem o seu
# fica com o dele. Falhar aqui não para a instalação.
ligar_swap() {
  MEM_MB=$(awk '/^MemTotal:/ { print int($2 / 1024) }' /proc/meminfo)
  ZRAM_MB=$((MEM_MB / 2))
  if [ "$ZRAM_MB" -gt 8192 ]; then ZRAM_MB=8192; fi
  if $SUDO modprobe zram 2>/dev/null; then
    $SUDO env DEBIAN_FRONTEND=noninteractive $APT install -y -qq zram-tools >/dev/null || return 1
    printf 'ALGO=zstd\\nSIZE=%s\\nPRIORITY=100\\n' "$ZRAM_MB" | $SUDO tee /etc/default/zramswap >/dev/null || return 1
    $SUDO systemctl enable zramswap >/dev/null 2>&1 || true
    $SUDO systemctl restart zramswap || return 1
    SWAP_LIGADO="memória extra comprimida (zram, $ZRAM_MB MB)"
  elif [ "$(df -Pm / | awk 'NR == 2 { print $4 }')" -gt 20480 ]; then
    $SUDO fallocate -l 4G /swapfile-nod 2>/dev/null || $SUDO dd if=/dev/zero of=/swapfile-nod bs=1M count=4096 status=none || return 1
    $SUDO chmod 600 /swapfile-nod && $SUDO mkswap /swapfile-nod >/dev/null && $SUDO swapon /swapfile-nod || return 1
    grep -q '^/swapfile-nod ' /etc/fstab || echo '/swapfile-nod none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
    SWAP_LIGADO="memória extra no disco (arquivo de swap de 4 GB)"
  else
    return 1
  fi
}
if [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
  SWAP_LIGADO=""
  ligar_swap || true
  if [ -n "$(swapon --noheadings 2>/dev/null)" ] && [ -n "$SWAP_LIGADO" ]; then passo "$SWAP_LIGADO"
  else printf 'Aviso: não deu para ligar memória extra (swap). Com a memória cheia, a máquina pode travar por alguns minutos.\\n'; fi
fi

${etapa("servico")}$SUDO tee /usr/local/bin/nod-motor >/dev/null <<'NODMOTOR'
#!/bin/sh
# Roda o motor do Nod como o usuário nod (ADR-090). Depois de parear ou entrar numa IA, o serviço recomeça.
set -eu
CASA=/home/nod
CAMINHO="$CASA/.local/bin:/opt/nod-motor/node/bin:/usr/local/bin:/usr/bin:/bin"
MOTOR="/opt/nod-motor/node/bin/node /opt/nod-motor/app/nod-motor.mjs"
if [ "$(id -un)" = nod ]; then exec env PATH="$CAMINHO" $MOTOR "$@"; fi
if [ "$(id -u)" -eq 0 ]; then
  runuser -u nod -- env HOME="$CASA" PATH="$CAMINHO" $MOTOR "$@" && ok=1 || ok=0
  SUDO=""
else
  sudo -u nod -H env PATH="$CAMINHO" $MOTOR "$@" && ok=1 || ok=0
  SUDO="sudo"
fi
# Depois de parear o serviço recomeça (a chave é nova). Depois de entrar numa IA só sobe se estava parado: reiniciar
# derrubaria os turnos rodando; a vigia das IAs percebe o login sozinha quando nenhuma IA estava pronta.
if [ "$ok" = 1 ] && [ "\${1:-}" = parear ]; then $SUDO systemctl restart nod-motor || true; fi
if [ "$ok" = 1 ] && [ "\${1:-}" = entrar ]; then
  $SUDO systemctl is-active --quiet nod-motor || $SUDO systemctl start nod-motor || true
  echo "Se o motor já estava rodando com outra IA, ela passa a valer no próximo reinício: sudo systemctl restart nod-motor (interrompe o que estiver rodando)."
fi
[ "$ok" = 1 ]
NODMOTOR
$SUDO chmod 755 /usr/local/bin/nod-motor

$SUDO tee /etc/systemd/system/nod-motor.service >/dev/null <<'NODSERVICO'
[Unit]
Description=Nod: o motor desta máquina (ADR-090)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=nod
Group=nod
WorkingDirectory=/home/nod
Environment=HOME=/home/nod
Environment=PATH=/home/nod/.local/bin:/opt/nod-motor/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/nod-motor/node/bin/node /opt/nod-motor/app/nod-motor.mjs rodar
Restart=always
RestartSec=5
# 2 = sem conexão, chave revogada ou motor desatualizado: só volta depois de parear ou atualizar.
RestartPreventExitStatus=2
KillMode=mixed
TimeoutStopSec=30
# ADR-097 (fase 0b): sem memória, o Linux mata um processo (um teste, um typecheck) e o motor segue. O padrão (stop)
# derrubava o serviço inteiro, com todos os bots e turnos da máquina (11/10, 14:35 UTC).
OOMPolicy=continue
# ADR-097 (fase 2): o motor cria um grupo de controle por turno (teto de memória e peso de processador por task).
Delegate=yes
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
NODSERVICO

# ADR-100: o motor se atualiza sozinho. Ele (usuário nod) só decide QUANDO: num momento sem turno, grava um pedido. Quem
# troca os arquivos é o root, deste servidor (gravado aqui, fora do alcance do nod) e só se o sha256 de cada arquivo bate
# com o manifesto. Os arquivos continuam do root: um bot, que roda como nod, não reescreve o hook que o vigia.
$SUDO mkdir -p /etc/nod-motor
echo "$NOD_SERVIDOR" | $SUDO tee /etc/nod-motor/servidor >/dev/null
$SUDO tee /usr/local/sbin/nod-motor-atualizar >/dev/null <<'NODATUALIZAR'
#!/bin/sh
# Nod: troca os arquivos do motor pelos do servidor desta instalação (ADR-100). Roda como root, pelo
# nod-motor-atualizar.service, quando o motor pede (~nod/.config/nod-motor/atualizar) num momento sem turno.
set -eu
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PEDIDO=/home/nod/.config/nod-motor/atualizar
APP=/opt/nod-motor/app
NODE=/opt/nod-motor/node/bin/node
TMP=$(mktemp -d)
# O pedido sai sempre, com sucesso ou não: senão o .path dispararia de novo em seguida. O motor que não reiniciou
# volta a puxar trabalho e tenta mais tarde.
trap 'rm -rf "$TMP" "$APP.novo"; rm -f "$PEDIDO"' EXIT
SERVIDOR=$(head -n 1 /etc/nod-motor/servidor)
case "$SERVIDOR" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "servidor inválido em /etc/nod-motor/servidor" >&2; exit 1 ;;
esac
curl -fsS --max-time 60 "$SERVIDOR/api/motor/manifesto" -o "$TMP/manifesto.json"
for ARQUIVO in ${ARQUIVOS_DO_MOTOR.join(" ")}; do
  curl -fsS --max-time 300 "$SERVIDOR/api/motor/arquivos/$ARQUIVO" -o "$TMP/$ARQUIVO"
done
VERSAO=$("$NODE" -e 'const fs=require("fs"),c=require("crypto");const d=process.argv[1];const m=JSON.parse(fs.readFileSync(d+"/manifesto.json","utf8"));for(const n of process.argv.slice(2)){const h=c.createHash("sha256").update(fs.readFileSync(d+"/"+n)).digest("hex");if(!m.arquivos||m.arquivos[n]!==h){console.error("o arquivo "+n+" não bate com o manifesto");process.exit(1)}}process.stdout.write(String(m.versao||"?"))' "$TMP" ${ARQUIVOS_DO_MOTOR.join(" ")})
rm -rf "$APP.novo"
mkdir -p "$APP.novo"
for ARQUIVO in ${ARQUIVOS_DO_MOTOR.join(" ")}; do
  install -o root -g root -m 644 "$TMP/$ARQUIVO" "$APP.novo/$ARQUIVO"
done
# A versão anterior fica ao lado (app.anterior) para voltar à mão, se precisar.
rm -rf "$APP.anterior"
mv "$APP" "$APP.anterior"
# Se a segunda troca falhar, a anterior volta: a máquina nunca fica sem motor.
mv "$APP.novo" "$APP" || { mv "$APP.anterior" "$APP"; exit 1; }
systemctl restart nod-motor
echo "motor atualizado: $VERSAO"
NODATUALIZAR
$SUDO chmod 755 /usr/local/sbin/nod-motor-atualizar
$SUDO tee /etc/systemd/system/nod-motor-atualizar.service >/dev/null <<'NODATUALIZARSERVICO'
[Unit]
Description=Nod: troca os arquivos do motor pelos do servidor (ADR-100)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/nod-motor-atualizar
TimeoutStartSec=15min
NODATUALIZARSERVICO
$SUDO tee /etc/systemd/system/nod-motor-atualizar.path >/dev/null <<'NODATUALIZARPATH'
[Unit]
Description=Nod: o motor pediu para se atualizar (ADR-100)

[Path]
PathExists=/home/nod/.config/nod-motor/atualizar
Unit=nod-motor-atualizar.service

[Install]
WantedBy=multi-user.target
NODATUALIZARPATH
$SUDO systemctl daemon-reload
if [ "\${NOD_ATUALIZAR_SOZINHO:-1}" = "0" ]; then
  $SUDO rm -f /etc/nod-motor/atualizar-sozinho
  $SUDO systemctl disable --now nod-motor-atualizar.path >/dev/null 2>&1 || true
  passo "atualização automática desligada (NOD_ATUALIZAR_SOZINHO=0)"
else
  $SUDO touch /etc/nod-motor/atualizar-sozinho
  $SUDO systemctl enable --now nod-motor-atualizar.path >/dev/null 2>&1
  passo "atualização automática (num momento sem turno, sem interromper nenhum)"
fi
$SUDO systemctl enable nod-motor >/dev/null 2>&1
passo "serviço nod-motor (volta sozinho se a máquina reiniciar)"

# A pasta da conexão é 0700 do nod: quem roda com sudo não a enxerga sem o $SUDO.${comp ? `
# NOD-94 (QA): com convite, a só-computador sempre pareia de novo: a chave antiga pode ter sido revogada (Desconectar) ou
# ser de um motor comum; sem parear, o pedido ficaria esperando até virar nao_pareou.` : ""}
if ${comp ? '[ -z "$NOD_CONVITE" ] && ' : ""}$SUDO test -f "$CASA/.config/nod-motor/conexao.json"; then
  $SUDO systemctl restart nod-motor
  printf '\\nMotor atualizado e no ar. Estado: nod-motor estado\\n'
${etapa("pronta")}  exit 0
fi

printf '\\n'
${etapa("pareamento")}if [ -n "$NOD_CONVITE" ]; then
  /usr/local/bin/nod-motor parear "$NOD_SERVIDOR" --convite "$NOD_CONVITE" || falhar "O pareamento não terminou. Rode de novo: nod-motor parear $NOD_SERVIDOR"${motivo("nao_pareou")}
else
  /usr/local/bin/nod-motor parear "$NOD_SERVIDOR" || falhar "O pareamento não terminou. Rode de novo: nod-motor parear $NOD_SERVIDOR"${motivo("nao_pareou")}
fi
${etapa("pronta")}printf 'Dica: deixe esta máquina só para o Nod, com atualizações de segurança automáticas e SSH só por chave.\\n'
}

principal "$@"
`;
}
