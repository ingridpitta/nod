#!/usr/bin/env bash
# Deploy na VM (chamado pelo workflow, por túnel IAP, como root): monta o env a partir do Secret
# Manager, baixa a imagem, migra como nod_dono e sobe a versão nova SEM QUEDA (azul/verde).
# revisto em 2026-10-22 (NOD-218, emendas das ADR-001 e ADR-017): duas cores do nod (nod-azul e nod-verde) e o Caddy
# fixo na frente. Quem decide qual cor atende é o marcador estado/cor-ativa, escrito SÓ aqui (tmp + mv); a ordem de
# subida nunca decide.
#   reconcilia → env e imagem da cor parada → pull → migra (compatível com N-1) → up --no-deps da cor parada
#   → espera healthy ≤90 s ──falhou──→ logs + stop da nova, marcador intocado, exit 1
#   → grava cor-ativa=nova → promove o Caddyfile.novo (NOD-331) → confirma pelo Caddy (/api/saude/lb devolve a cor
#     nova 3× seguidas em ≤15 s)
#        └─ não confirmou → cor-ativa volta à velha, Caddyfile anterior de volta, stop da nova, exit 1 (a velha não
#           drenou: segue atendendo)
#   → docker stop -t 660 na velha (ela drena até 10 min) → fecha as ligações órfãs dela → prune
# NOD-331: o workflow instala o Caddyfile em estágio (/opt/nod/Caddyfile.novo); ele só vira o Caddyfile na troca. Até
# lá, um restart do Caddy ou um reboot da VM relê o Caddyfile em uso. Na transição, o legado sai em
# NOD_TRANSICAO_STOP_S (30 s): depois do recreate do Caddy ninguém o alcança.
# Rollback: `sudo /opt/nod/deploy.sh <tag-anterior>` (a tag anterior está em imagens.env, na cor parada); a imagem
# antiga sobe na cor parada pelo mesmo fluxo (docs/deploy-gcp.md). Tag de antes da NOD-218 é recusada antes de migrar.
# Uso: deploy.sh <tag-da-imagem>
set -euo pipefail
TAG="${1:?uso: deploy.sh <tag>}"
cd /opt/nod
# NOD-485 (ADR-161): um deploy por vez NA VM. O concurrency do workflow só vale dentro de um repo; na transição o
# gamefik/nod e o marlonwlv/nod podem disparar juntos. O segundo espera o primeiro (até NOD_DEPLOY_LOCK_S, 30 min) e,
# se não conseguir, sai sem mexer em nada. O deploy.yml pega a trava ANTES de instalar config.env, compose.yml e
# Caddyfile.novo (`flock … /opt/nod/deploy.lock sh -c 'install …; exec deploy.sh'`), senão o outro repo trocaria esses
# arquivos no meio deste deploy: aqui o descritor herdado é reaproveitado (a mesma trava passa na hora). Rodado à mão,
# abre o seu.
if command -v flock >/dev/null; then
  TRAVA_FD=""
  for f in /proc/$$/fd/*; do
    if [ "$(readlink "$f" 2>/dev/null)" = "$(pwd -P)/deploy.lock" ]; then TRAVA_FD="${f##*/}"; break; fi
  done
  if [ -z "$TRAVA_FD" ]; then
    exec 9>>./deploy.lock
    TRAVA_FD=9
  fi
  flock -w "${NOD_DEPLOY_LOCK_S:-1800}" "$TRAVA_FD" || { echo "outro deploy segura /opt/nod/deploy.lock há ${NOD_DEPLOY_LOCK_S:-1800} s; nada foi mexido" >&2; exit 1; }
else
  echo "aviso: sem flock na VM; o deploy segue sem a trava entre repos" >&2
fi
# Sem aspas, `NOD_MODELO_LIGACAO_CLAUDE=modelo esforco=low` são duas atribuições no `source`: as opções cairiam em silêncio.
if grep -Eq "^NOD_MODELO_LIGACAO_[A-Z]+=[^\"' #]+[[:blank:]]+[^[:blank:]#]" config.env; then
  echo "NOD_MODELO_LIGACAO_* com opções precisa estar entre aspas no config.env (ex.: \"claude-sonnet-5-5 esforco=low\")" >&2
  exit 1
fi
source ./config.env
: "${SQL_IP:?SQL_IP vazio no config.env}"

segredo() { gcloud secrets versions access latest --secret="$1" --project="$PROJETO"; }
limpo() { printf '%s' "$1" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

# ADR-124 §6 (NOD-406): login por e-mail. O servidor compara as flags por `=== "1"` e, com NOD_CONTAS=1 e NOD_LOGIN=google,
# recusa subir sem a chave do Resend e o remetente: a cor nova nunca ficaria saudável. Aqui o deploy para antes de mexer
# em qualquer cor, com o motivo. O Google para conta e Minha conta ainda não têm caminho neste deploy: ligados, recusa
# em vez de sumir em silêncio.
NOD_CONTAS="$(limpo "${NOD_CONTAS:-}")"
NOD_BOOTSTRAP="$(limpo "${NOD_BOOTSTRAP:-}")"
NOD_PROVISORIO_COTA_TURNOS="$(limpo "${NOD_PROVISORIO_COTA_TURNOS:-}")"
NOD_ANTIABUSO="$(limpo "${NOD_ANTIABUSO:-}")"
NOD_EMAIL_REMETENTE="$(limpo "${NOD_EMAIL_REMETENTE:-}")"
NOD_ONBOARDING_TEXTO="$(limpo "${NOD_ONBOARDING_TEXTO:-}")"
for v in NOD_CONTAS_GOOGLE NOD_MINHA_CONTA NOD_PURGA_CONTA; do
  [ -z "$(limpo "${!v:-}")" ] || { echo "$v ainda não é levado pelo deploy (NOD-406): tire a linha do config.env" >&2; exit 1; }
done
for v in NOD_CONTAS NOD_BOOTSTRAP NOD_ONBOARDING_TEXTO; do
  case "${!v}" in ""|1) ;; *) echo "$v só aceita 1 ou vazio no config.env (o servidor compara por === \"1\")" >&2; exit 1 ;; esac
done
case "$NOD_ANTIABUSO" in ""|1) ;; *) echo "NOD_ANTIABUSO só aceita 1 ou vazio" >&2; exit 1 ;; esac
[[ -z "$NOD_PROVISORIO_COTA_TURNOS" || ( "$NOD_PROVISORIO_COTA_TURNOS" =~ ^[1-9][0-9]{0,5}$ && "$NOD_PROVISORIO_COTA_TURNOS" -le 100000 ) ]] || { echo "NOD_PROVISORIO_COTA_TURNOS deve ser inteiro de 1 a 100000 ou vazio" >&2; exit 1; }
if { [ -n "$NOD_ANTIABUSO" ] || [ -n "$NOD_PROVISORIO_COTA_TURNOS" ]; } && [ "$NOD_BOOTSTRAP" != 1 ]; then
  echo "salvaguardas do provisório exigem NOD_BOOTSTRAP=1" >&2; exit 1
fi
# O nome só com letras, dígitos, espaço, ponto, _ e -: no env_file do compose, `#`, `$` e aspas mudariam o valor.
REMETENTE_OK='^([A-Za-z0-9 ._-]+ <[A-Za-z0-9._%+-]+@nodbot\.ai>|[A-Za-z0-9._%+-]+@nodbot\.ai)$'
# A chave do Resend (só de envio) mora no Secret Manager e só é lida com as contas ligadas, aqui, antes da reconciliação
# das cores. Só o formato `re_…` passa: um CR ou uma quebra de linha colados com ela injetariam linhas no env.
RESEND_CHAVE=""
if [ "$NOD_CONTAS" = 1 ]; then
  [[ "$NOD_EMAIL_REMETENTE" =~ $REMETENTE_OK ]] || { echo "NOD_CONTAS=1 exige NOD_EMAIL_REMETENTE do domínio nodbot.ai no config.env (ex.: \"nod <conta@nodbot.ai>\")" >&2; exit 1; }
  RESEND_CHAVE="$(segredo nod-resend-api-key 2>/dev/null)" || { echo "NOD_CONTAS=1: não consegui ler o segredo nod-resend-api-key (existe? a SA da VM tem secretAccessor? docs/deploy-gcp.md, Login por e-mail)" >&2; exit 1; }
  [[ "$RESEND_CHAVE" =~ ^re_[A-Za-z0-9_]+$ ]] || { echo "NOD_CONTAS=1 exige o segredo nod-resend-api-key com uma chave do Resend (re_…; docs/deploy-gcp.md, Login por e-mail)" >&2; exit 1; }
elif [ "$NOD_BOOTSTRAP" = 1 ]; then
  echo "NOD_BOOTSTRAP=1 exige NOD_CONTAS=1 no config.env" >&2
  exit 1
fi

ip_publico() { curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip; }
# Sem domínio, o provisório é o endereço. Com domínio, o Caddy serve os dois (NOD-173): Macs antigos têm o provisório.
# Aí ele é opcional: sem metadata (fora da VM), o deploy segue só com o domínio.
NOD_ENDERECO_PROVISORIO=""
if [ -z "${NOD_DOMINIO:-}" ]; then
  IP_PUBLICO="$(ip_publico)"
  NOD_DOMINIO="${IP_PUBLICO//./-}.sslip.io"
elif IP_PUBLICO="$(ip_publico 2>/dev/null)" && [ -n "$IP_PUBLICO" ]; then
  NOD_ENDERECO_PROVISORIO="${IP_PUBLICO//./-}.sslip.io"
fi
export NOD_DOMINIO NOD_ENDERECO_PROVISORIO
IMAGEM="$REGISTRO/nod:$TAG"

GOOGLE_ID="$(segredo nod-google-client-id 2>/dev/null || true)"
GOOGLE_SEGREDO="$(segredo nod-google-client-secret 2>/dev/null || true)"
if [ -z "$GOOGLE_ID" ] || [ -z "$GOOGLE_SEGREDO" ]; then
  echo "faltam os segredos nod-google-client-id/secret (docs/deploy-gcp.md, passo do OAuth)" >&2
  exit 1
fi

umask 077
mkdir -p estado
chmod 0755 estado

# Todo `docker compose` lê as duas imagens de imagens.env (o compose exige as duas definidas) e nomeia a cor.
dc() { docker compose --env-file imagens.env "$@"; }
outra() { if [ "$1" = azul ]; then echo verde; else echo azul; fi; }
id_cor() { dc ps -q "nod-$1" 2>/dev/null || true; }
roda() { [ -n "$(id_cor "$1")" ]; }
# NOD-485 (ADR-161): o log do Actions é público. Os logs do servidor (ids de tenant e pessoa, e-mails, IPs de quem
# acessou) ficam num arquivo só do root na VM (umask 077) e no Cloud Logging; o log do deploy diz só onde ler.
logs_da_nova() {
  dc logs --tail=80 "nod-$NOVA" >"estado/falha-nod-$NOVA.log" 2>&1 || true
  echo "os últimos logs da nod-$NOVA estão na VM em /opt/nod/estado/falha-nod-$NOVA.log (e no Cloud Logging)" >&2
}
# O `nod` de antes do azul/verde (a transição): mesmo projeto do compose, serviço `nod`.
legado() { docker ps -q --filter label=com.docker.compose.project=nod --filter label=com.docker.compose.service=nod; }
marcar() { printf '%s\n' "$1" > estado/cor-ativa.novo && chmod 0644 estado/cor-ativa.novo && mv estado/cor-ativa.novo estado/cor-ativa; }
imagem_de() { sed -n "s/^NOD_IMAGEM_$(echo "$1" | tr a-z A-Z)=//p" imagens.env 2>/dev/null || true; }
# O domínio vai junto: o compose exige NOD_DOMINIO em qualquer comando, e o runbook (docs/deploy-gcp.md) roda
# `docker compose --env-file imagens.env …` fora deste script.
gravar_imagens() {
  printf 'NOD_IMAGEM_AZUL=%s\nNOD_IMAGEM_VERDE=%s\nNOD_DOMINIO=%s\nNOD_ENDERECO_PROVISORIO=%s\n' "$1" "$2" "$NOD_DOMINIO" "$NOD_ENDERECO_PROVISORIO" \
    > imagens.env.novo && mv imagens.env.novo imagens.env
}
# As ligações vivas da cor que saiu: o orquestrador delas morreu com ela (a outra cor não as conhece).
# NOD-331: 3 tentativas (5 s entre elas). Falhou as 3: a pendência fica em estado/orfas-pendentes (uma linha
# "<cor> [--transicao]", sem duplicar) e o próximo deploy a retoma (retomar_orfas). Deu certo: a linha sai.
PENDENTES=estado/orfas-pendentes
pendencia_tirar() {
  [ -f "$PENDENTES" ] || return 0
  grep -vxF -- "$1" "$PENDENTES" > "$PENDENTES.novo" || true
  if [ -s "$PENDENTES.novo" ]; then chmod 0644 "$PENDENTES.novo" && mv "$PENDENTES.novo" "$PENDENTES"; else rm -f "$PENDENTES" "$PENDENTES.novo"; fi
}
pendencia_por() {
  grep -qxF -- "$1" "$PENDENTES" 2>/dev/null && return 0
  mkdir -p estado
  { cat "$PENDENTES" 2>/dev/null || true; printf '%s\n' "$1"; } > "$PENDENTES.novo"
  chmod 0644 "$PENDENTES.novo" && mv "$PENDENTES.novo" "$PENDENTES"
}
orfas() {
  local linha="$2${3:+ $3}" t
  for t in 1 2 3; do
    # shellcheck disable=SC2086 # ${3:-} vazio não vira argumento
    if dc run --rm --no-deps -T "nod-$1" node scripts/ligacoes-orfas.ts --instancia "$2" ${3:-} </dev/null; then
      pendencia_tirar "$linha"
      return 0
    fi
    if [ "$t" -lt 3 ]; then sleep 5; fi
  done
  echo "aviso: não fechou as ligações órfãs da cor $2 em 3 tentativas; pendência em $PENDENTES, o próximo deploy retoma" >&2
  pendencia_por "$linha"
}
# NOD-331: antes de subir a cor nova, retoma as órfãs que um deploy anterior não fechou, com a imagem da ativa. A
# pendência da PRÓPRIA ativa é descartada: o boot dela já fechou as dela, e as vivas agora são legítimas. Sem ativa, fica.
retomar_orfas() {
  [ -s "$PENDENTES" ] || return 0
  if [ -z "$ATIVA" ]; then
    echo "aviso: há ligações órfãs pendentes ($PENDENTES), mas nenhuma cor ativa para fechá-las; ficam para o próximo deploy" >&2
    return 0
  fi
  local pendentes cor flag
  pendentes="$(cat "$PENDENTES")"
  while read -r cor flag <&3; do
    [ -n "$cor" ] || continue
    if [ "$cor" = "$ATIVA" ]; then
      echo "órfãs pendentes da $cor descartadas: é a cor ativa (o boot dela já fechou as dela)"
      pendencia_tirar "$cor${flag:+ $flag}"
      continue
    fi
    echo "retomando as ligações órfãs pendentes da cor $cor"
    orfas "$ATIVA" "$cor" "$flag"
  done 3<<< "$pendentes"
}

# O compose carrega os dois env_file e as duas imagens em qualquer comando: o que ainda não existe nasce aqui. A cor
# que nunca subiu fica com um env vazio, reescrito antes de ela subir.
for c in azul verde; do [ -f "nod-$c.env" ] || : > "nod-$c.env"; done
IMG_AZUL="$(imagem_de azul)"; IMG_VERDE="$(imagem_de verde)"
gravar_imagens "${IMG_AZUL:-$IMAGEM}" "${IMG_VERDE:-$IMAGEM}"

# Reconciliação: o marcador é a fonte da verdade; um job morto no meio deixa o estado que ele encontrar.
ATIVA="$(cat estado/cor-ativa 2>/dev/null || true)"
case "$ATIVA" in azul | verde) ;; *) ATIVA="" ;; esac
LEGADO="$(legado)"
if [ -n "$ATIVA" ]; then
  if ! roda "$ATIVA" && roda "$(outra "$ATIVA")"; then
    echo "reconciliação: o marcador dizia $ATIVA, mas só $(outra "$ATIVA") roda; o marcador passa a $(outra "$ATIVA")"
    ATIVA="$(outra "$ATIVA")"
    marcar "$ATIVA"
  fi
elif [ -z "$LEGADO" ]; then
  if roda azul; then ATIVA=azul; elif roda verde; then ATIVA=verde; fi
  if [ -n "$ATIVA" ]; then
    echo "reconciliação: sem marcador e só $ATIVA de pé; o marcador passa a $ATIVA"
    marcar "$ATIVA"
  fi
fi
if [ -n "$ATIVA" ] && roda "$(outra "$ATIVA")"; then
  echo "reconciliação: $(outra "$ATIVA") ainda de pé (deploy anterior interrompido); drenando antes de seguir"
  dc stop -t 660 "nod-$(outra "$ATIVA")"
  orfas "$ATIVA" "$(outra "$ATIVA")"
fi
retomar_orfas

if [ -n "$ATIVA" ]; then
  NOVA="$(outra "$ATIVA")"
  VELHA="$ATIVA"
else
  # Transição (o `nod` legado de pé, sem marcador) ou instalação nova: começa pela azul.
  NOVA=azul
  VELHA=""
fi
[ -n "$LEGADO" ] && echo "transição: o nod legado sai depois que a azul confirmar no Caddy"
echo "deploy de $TAG na cor $NOVA${VELHA:+ (a $VELHA segue atendendo até a troca)}"

# Os segredos vêm antes do heredoc: um `$(segredo …)` dentro dele que falhe não aborta com set -e e gravaria o env com
# a senha vazia. Na atribuição, a falha do gcloud derruba o deploy antes de qualquer cor subir.
PG_SENHA_APP="$(segredo nod-pg-senha-app)"
PG_SENHA_DONO="$(segredo nod-pg-senha-dono)"
SESSAO_SEGREDO="$(segredo nod-sessao-segredo)"
CREDENTIAL_KEY="$(segredo nod-credential-key)"
# ADR-115 (revisor no servidor, 2026-10-25): a chave da API da Anthropic da conta do Nod, só com o revisor ligado. Ligado
# e sem o segredo, o gcloud falha aqui e o deploy para antes de qualquer cor subir; desligado, nem é lido.
# O valor passa pelo mesmo critério do servidor (`lerConfigRevisor` tira os espaços das pontas): `" ligado "` ou um
# config.env salvo com CRLF (`ligado\r`) ligam aqui também, e o env da cor nova leva o valor já limpo.
NOD_REVISOR="$(printf '%s' "${NOD_REVISOR:-}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
REVISOR_CHAVE=""
if [ "$NOD_REVISOR" = ligado ]; then REVISOR_CHAVE="$(segredo nod-anthropic-revisor)"; fi
# ADR-122 (NOD-96) e ADR-121 (NOD-92): o servidor compara as flags por igualdade exata (`=== "motor"`); um config.env com
# CRLF ou espaço nas pontas desligaria em silêncio. Mesma limpeza do NOD_REVISOR (`limpo`, definida no topo).
NOD_COMPUTADORES="$(limpo "${NOD_COMPUTADORES:-}")"
NOD_COMPUTADOR_VERSAO_MINIMA="$(limpo "${NOD_COMPUTADOR_VERSAO_MINIMA:-}")"
NOD_MAQUINA_NUVEM="$(limpo "${NOD_MAQUINA_NUVEM:-}")"
NOD_NUVEM_CONTA_FATURAMENTO="$(limpo "${NOD_NUVEM_CONTA_FATURAMENTO:-}")"
# NOD-132 (ADR-149): a versão anunciada aos apps do Mac e o bucket dos ZIPs (vazio = desligada; o boot valida o formato).
NOD_APP_VERSAO_PUBLICADA="$(limpo "${NOD_APP_VERSAO_PUBLICADA:-}")"
NOD_APP_ATUALIZACAO_BUCKET="$(limpo "${NOD_APP_ATUALIZACAO_BUCKET:-}")"
NOD_APP_ATUALIZACAO_SHA256="$(limpo "${NOD_APP_ATUALIZACAO_SHA256:-}")"
# NOD-421: o laço dos PRs do quadro (até 5 dono/repo). Só estes tenants sincronizam pelo token do servidor (vazio =
# nenhum, e o laço não sobe). Ligar exige o segredo nod-github-quadro-token + o tenant na lista + o 🧭 da Ada/Marlon
# (ADR-145, proposta). 3ª revisão do PR #621: sem o segredo, a lista sai VAZIA no nod.env, então nada sobe em produção
# mesmo com REPOS e um tenant no config.env (o deploy segue e avisa no stderr).
NOD_QUADRO_GITHUB_REPOS="$(limpo "${NOD_QUADRO_GITHUB_REPOS:-}")"
NOD_QUADRO_GITHUB_TENANTS="$(limpo "${NOD_QUADRO_GITHUB_TENANTS:-}")"
QUADRO_GITHUB_TOKEN=""
if [ -n "$NOD_QUADRO_GITHUB_REPOS" ]; then QUADRO_GITHUB_TOKEN="$(limpo "$(segredo nod-github-quadro-token 2>/dev/null || true)")"; fi
if [ -n "$NOD_QUADRO_GITHUB_REPOS" ] && [ -z "$QUADRO_GITHUB_TOKEN" ]; then
  echo "aviso: NOD_QUADRO_GITHUB_REPOS ligado sem o segredo nod-github-quadro-token: os PRs do quadro não sincronizam (docs/deploy-gcp.md, Token dos PRs do quadro)" >&2
  NOD_QUADRO_GITHUB_TENANTS=""
fi
# Só o env da cor nova muda: a velha, que ainda drena, nunca recebe config nova.
cat >"nod-$NOVA.env.novo" <<EOF
NOD_LOGIN=google
NOD_HOST=0.0.0.0
NOD_MODO=compartilhado
NOD_STATIC_DIR=/app/dist/web
NOD_HOME=/data/nod
NOD_FUSO_PADRAO=America/Sao_Paulo
NOD_BANCO_AMBIENTE=persistente
DATABASE_URL=postgres://nod_app:$PG_SENHA_APP@$SQL_IP:5432/nod?sslmode=require
# ADR-001 (emenda de 2026-10-15): pool da app direto no Cloud SQL (max_connections 100); 15 é o padrão do código.
NOD_DB_POOL_MAX=15
# O boot cria as partições de events dos próximos 12 meses como dono (ADR-006) e fecha a conexão;
# as requisições usam só nod_app.
DATABASE_URL_DONO=postgres://nod_dono:$PG_SENHA_DONO@$SQL_IP:5432/nod?sslmode=require
NOD_SESSAO_SEGREDO=$SESSAO_SEGREDO
NOD_CREDENTIAL_KEY=$CREDENTIAL_KEY
NOD_GOOGLE_CLIENT_ID=$GOOGLE_ID
NOD_GOOGLE_CLIENT_SECRET=$GOOGLE_SEGREDO
NOD_GOOGLE_REDIRECT_URI=https://$NOD_DOMINIO/api/sessao/google/callback
# Emenda de 2026-10-05 da ADR-030: contas Workspace destes domínios viram pessoa na primeira entrada (config.env).
NOD_ADMISSAO_DOMINIOS=${NOD_ADMISSAO_DOMINIOS:-}
# Modo ligação (ADR-071): voz pelo Google pago pelos créditos do projeto; só admins na fase 1 (NOD_ADMINS no config.env).
NOD_VOZ_PROJETO=$PROJETO
NOD_LIGACAO=${NOD_LIGACAO:-admins}
NOD_ADMINS=${NOD_ADMINS:-}
# NOD-415 (ADR-141): quadros só para os admins até o Marlon liberar (desligado | admins | todos).
NOD_QUADROS=${NOD_QUADROS:-admins}
# NOD-421: os PRs do GitHub na tarefa (config.env); o token vem do Secret Manager, se existir.
NOD_QUADRO_GITHUB_REPOS=$NOD_QUADRO_GITHUB_REPOS
NOD_QUADRO_GITHUB_TOKEN=$QUADRO_GITHUB_TOKEN
NOD_QUADRO_GITHUB_TENANTS=$NOD_QUADRO_GITHUB_TENANTS
NOD_ONBOARDING_VOZ=${NOD_ONBOARDING_VOZ:-0}
NOD_MODELO_LIGACAO_CLAUDE=${NOD_MODELO_LIGACAO_CLAUDE:-}
NOD_MODELO_LIGACAO_CODEX=${NOD_MODELO_LIGACAO_CODEX:-}
NOD_REVISOR=${NOD_REVISOR:-}
NOD_REVISOR_CHAVE=$REVISOR_CHAVE
NOD_MODELO_REVISOR=${NOD_MODELO_REVISOR:-}
NOD_REVISOR_TETO_DIA=${NOD_REVISOR_TETO_DIA:-}
NOD_REVISOR_TETO_GLOBAL_USD=${NOD_REVISOR_TETO_GLOBAL_USD:-}
NOD_REVISOR_TETO_PESSOA_USD=${NOD_REVISOR_TETO_PESSOA_USD:-}
# NOD-167: sem a linha no config.env, produção fica com a ligação Codex DESLIGADA (o padrão do código é ligada).
NOD_LIGACAO_CODEX=${NOD_LIGACAO_CODEX:-0}
# Teto de pedidos de TTS por minuto deste processo, abaixo da cota de 200/min do projeto (emenda da ADR-071, NOD-166).
NOD_VOZ_TTS_TETO_MIN=${NOD_VOZ_TTS_TETO_MIN:-180}
NOD_DRENAGEM_MAX_MS=600000
# O endereço público do nod (sem barra no fim): o script do motor e da instalação por SSH apontam para ele, e a máquina
# na nuvem (ADR-121) baixa o motor dele. Sem ele, cada um usa o host do pedido (o provisório também é servido).
NOD_URL_PUBLICA=https://$NOD_DOMINIO
# ADR-122 (NOD-96): motor liga o computador da pessoa, que roda na máquina dela pelo motor. Vazio = desligado.
NOD_COMPUTADORES=$NOD_COMPUTADORES
NOD_COMPUTADOR_VERSAO_MINIMA=$NOD_COMPUTADOR_VERSAO_MINIMA
# ADR-121 (NOD-92): gcp liga a máquina na nuvem da pessoa. Só depois de cadastrar a URI abaixo no cliente OAuth.
NOD_MAQUINA_NUVEM=$NOD_MAQUINA_NUVEM
NOD_NUVEM_REDIRECT_URI=https://$NOD_DOMINIO/api/nuvem/google/callback
NOD_NUVEM_CONTA_FATURAMENTO=${NOD_NUVEM_CONTA_FATURAMENTO:-}
# NOD-132 (ADR-149): a atualização automática do app do Mac (config.env). Vazio = o feed responde 204.
NOD_APP_VERSAO_PUBLICADA=$NOD_APP_VERSAO_PUBLICADA
NOD_APP_ATUALIZACAO_BUCKET=$NOD_APP_ATUALIZACAO_BUCKET
NOD_APP_ATUALIZACAO_SHA256=$NOD_APP_ATUALIZACAO_SHA256
# ADR-124 §6 (NOD-406): contas com e-mail e senha, recuperação e o espaço provisório. Vazio = desligado. O link de
# recuperação usa o NOD_URL_PUBLICA acima.
NOD_CONTAS=$NOD_CONTAS
NOD_BOOTSTRAP=$NOD_BOOTSTRAP
NOD_PROVISORIO_COTA_TURNOS=$NOD_PROVISORIO_COTA_TURNOS
NOD_ANTIABUSO=$NOD_ANTIABUSO
NOD_EMAIL_REMETENTE=${NOD_CONTAS:+$NOD_EMAIL_REMETENTE}
NOD_RESEND_API_KEY=$RESEND_CHAVE
# ADA-242 (ADR-157): onboarding por texto, conta por código e Google no app. Vazio = desligado.
NOD_ONBOARDING_TEXTO=$NOD_ONBOARDING_TEXTO
EOF
mv "nod-$NOVA.env.novo" "nod-$NOVA.env"
if [ "$NOVA" = azul ]; then gravar_imagens "$IMAGEM" "$(imagem_de verde)"; else gravar_imagens "$(imagem_de azul)" "$IMAGEM"; fi

dc pull "nod-$NOVA"
# Imagem de antes do azul/verde (sem /api/saude/lb nem o laço por cor): o Caddy nunca a escolheria e o boot dela
# encerraria as ligações vivas da cor ativa. Voltar para antes da NOD-218 é pelo "Reverter a transição" do runbook.
if ! dc run --rm --no-deps -T "nod-$NOVA" test -f scripts/ligacoes-orfas.ts; then
  echo "a imagem $TAG é anterior ao azul/verde (NOD-218); para voltar a ela, veja docs/deploy-gcp.md (Reverter a transição)" >&2
  exit 1
fi
# Migração compatível com N-1 (docs/deploy-gcp.md): a velha segue no ar com o schema novo até a troca.
# NOD-485: a saída vai para um arquivo da VM: o erro do Postgres numa migração traz o `detail` com valores de linha
# (e-mails, ids de tenant) e o log do Actions é público.
if ! dc run --rm --no-deps -T "nod-$NOVA" node scripts/migrate.ts >estado/migracao.log 2>&1; then
  echo "a migração falhou (saída em /opt/nod/estado/migracao.log na VM); nenhuma cor subiu" >&2
  exit 1
fi
dc up -d --no-deps "nod-$NOVA"

saudavel=""
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$(id_cor "$NOVA")" 2>/dev/null)" = healthy ]; then
    saudavel=1
    break
  fi
  sleep 3
done
if [ -z "$saudavel" ]; then
  echo "a cor $NOVA não ficou saudável em 90 s; ${VELHA:-o nod legado} segue atendendo e o marcador não mudou" >&2
  logs_da_nova
  dc stop "nod-$NOVA"
  exit 1
fi

# Confirma pelo caminho público (o Caddy da VM, com o certificado do domínio): 3 respostas seguidas em ≤15 s. Sem
# argumento, da cor nova pelo /api/saude/lb; `confirmar legado` (NOD-331), o /api/saude 200 do nod legado.
confirmar() {
  local seguidas=0 fim=$((SECONDS + 15)) caminho=/api/saude/lb padrao="\"cor\":\"$NOVA\""
  if [ "${1:-}" = legado ]; then caminho=/api/saude; padrao=""; fi
  for _ in $(seq 1 30); do
    [ "$SECONDS" -le "$fim" ] || break
    if curl -fsS --max-time 2 --resolve "$NOD_DOMINIO:443:127.0.0.1" "https://$NOD_DOMINIO$caminho" 2>/dev/null | grep -q "$padrao"; then
      seguidas=$((seguidas + 1))
      [ "$seguidas" -ge 3 ] && return 0
    else
      seguidas=0
    fi
    sleep 1
  done
  return 1
}

# NOD-331: o Caddyfile em estágio vira o Caddyfile só na troca; o anterior fica guardado até a confirmação.
promover_caddyfile() {
  [ -f Caddyfile.novo ] || return 0
  # QA NOD-331: o estágio é do deploy que o instalou (o workflow grava a tag em Caddyfile.novo.tag). O que sobrou de um
  # deploy que falhou antes da troca não entra num rollback manual para outra tag: seria um recreate do Caddy (queda)
  # com um Caddyfile nunca confirmado. Fica em estágio até o próximo deploy do workflow.
  if [ -f Caddyfile.novo.tag ] && [ "$(cat Caddyfile.novo.tag)" != "$TAG" ]; then
    echo "aviso: o Caddyfile.novo é do deploy $(cat Caddyfile.novo.tag), não de $TAG: fica em estágio e o Caddyfile em uso segue" >&2
    return 0
  fi
  if [ -f Caddyfile ] && cmp -s Caddyfile.novo Caddyfile; then
    rm -f Caddyfile.novo Caddyfile.novo.tag
    return 0
  fi
  # Um .anterior velho (restauração que falhou num deploy passado) nunca é confundido com o desta troca. CADDY_MUDOU vem
  # antes do mv: um sinal entre os dois ainda devolve o anterior (que, até o mv, é igual ao em uso).
  rm -f Caddyfile.anterior
  if [ -f Caddyfile ]; then cp -p Caddyfile Caddyfile.anterior; fi
  CADDY_MUDOU=1
  mv Caddyfile.novo Caddyfile
  rm -f Caddyfile.novo.tag
}
# Devolve o Caddyfile anterior e recria o Caddy com ele. O sha só é regravado se o recreate deu certo (senão o próximo
# deploy recria de novo). Falha (sem anterior ou recreate com erro) → return 1.
restaurar_caddyfile() {
  [ -n "$CADDY_MUDOU" ] && [ -f Caddyfile.anterior ] || return 1
  mv Caddyfile.anterior Caddyfile
  CADDY_MUDOU=""
  if ! dc up -d --force-recreate --no-deps caddy; then
    echo "aviso: o Caddyfile anterior voltou ao disco, mas o recreate do Caddy falhou" >&2
    return 1
  fi
  sha256sum Caddyfile | cut -d' ' -f1 > .caddyfile.sha
}

# Desfaz a troca quando o deploy não chega à confirmação: falhou o `confirmar` ou o script morreu (set -e) entre o
# `marcar` e ela (ex.: o recreate do Caddy). Roda pelo trap de EXIT: nenhum caminho de saída deixa o marcador na nova
# sem confirmação.
desfazer_troca() {
  logs_da_nova
  if [ -n "$VELHA" ] && roda "$VELHA"; then
    # A velha ainda não drenou: com o marcador de volta ela retoma o 200 do /api/saude/lb e o Caddy volta para ela.
    marcar "$VELHA"
    # O Caddyfile novo (se mudou) sai junto: a velha é atendida pelo Caddyfile de quando ela confirmou.
    if restaurar_caddyfile; then echo "o Caddyfile anterior voltou" >&2; fi
    dc stop "nod-$NOVA" || true
    echo "o marcador voltou para $VELHA" >&2
  elif [ -n "$VELHA" ]; then
    # A velha nem roda: voltar o marcador e parar a nova deixaria zero cores. A nova (saudável) fica com o marcador.
    echo "a $VELHA não está de pé: a $NOVA segue com o marcador; confira o Caddy (docs/deploy-gcp.md)" >&2
  elif [ -n "$LEGADO" ]; then
    # NOD-331: na transição, o Caddyfile do legado volta e o Caddy é recriado com ele. Só com o legado confirmado pelo
    # Caddy a azul para e o marcador sai (o próximo deploy refaz a transição). Sem confirmar, a azul (saudável) e o
    # legado ficam de pé, e a decisão é de quem opera (docs/deploy-gcp.md, "Reverter a transição").
    if restaurar_caddyfile && confirmar legado; then
      dc stop "nod-$NOVA" || true
      rm -f estado/cor-ativa
      echo "transição desfeita: o Caddy voltou ao nod legado (confirmado) e a azul parou; o próximo deploy refaz a transição" >&2
    else
      echo "transição sem confirmação: a azul e o nod legado seguem de pé; veja docs/deploy-gcp.md (Reverter a transição)" >&2
    fi
  fi
}
TROCA_PENDENTE=""
CADDY_MUDOU=""
# Não olha o $?: morto por sinal (job cancelado, túnel IAP caído → SIGTERM/SIGHUP), o bash roda o trap de EXIT com $?=0.
# TROCA_PENDENTE só fica vazio depois da confirmação, então qualquer saída com ele preenchido é uma troca não confirmada.
trap 'if [ -n "$TROCA_PENDENTE" ]; then TROCA_PENDENTE=""; desfazer_troca; fi' EXIT

# A troca: a nova passa a responder 200 em /api/saude/lb (relê o marcador a cada 500 ms) e a velha 503; o Caddy
# (health check de 1 s, lb_policy first) muda de upstream sozinho.
TROCA_PENDENTE=1
marcar "$NOVA"
promover_caddyfile
# O Caddy lê o Caddyfile num bind de arquivo único: mudou o arquivo, recria o container (fora disso, nunca — derrubaria
# os WebSockets das ligações). Na transição ele muda (os upstreams azul/verde) e há uma queda curta, uma vez.
SHA_CADDY="$(sha256sum Caddyfile | cut -d' ' -f1)"
if [ "$SHA_CADDY" != "$(cat .caddyfile.sha 2>/dev/null || true)" ]; then
  dc up -d --force-recreate --no-deps caddy
  echo "$SHA_CADDY" > .caddyfile.sha
else
  dc up -d --no-deps caddy
fi

if ! confirmar; then
  echo "o Caddy não confirmou a cor $NOVA em 15 s" >&2
  exit 1
fi
TROCA_PENDENTE=""
rm -f Caddyfile.anterior
echo "nod no ar: https://$NOD_DOMINIO ($TAG, cor $NOVA)"
# PR 6 dos modos de aprovação (2026-10-19): a linha "Ignorar todas as aprovações agora também usa as credenciais…" na
# conversa dos bots que já estavam no total. Idempotente (só escreve onde falta), com a cor nova já confirmada; falhar
# aqui não derruba o deploy. Pode sair daqui depois do primeiro deploy do PR 6.
# Com prazo de 5 min: uma trava no banco não segura o deploy (o script pode rodar de novo). `timeout` não roda a função
# `dc`, por isso o docker compose por extenso.
# NOD-485: a saída vai para um arquivo da VM (a falha de uma pessoa loga tenant_id e pessoa_id; o log do Actions é público).
timeout 300 docker compose --env-file imagens.env run --rm --no-deps -T "nod-$NOVA" node scripts/aviso-total-credenciais.ts >estado/aviso-total.log 2>&1 ||
  echo "aviso do total falhou ou passou de 5 min (saída em /opt/nod/estado/aviso-total.log na VM)" >&2

# A velha drena (até 10 min: ligações vivas e turnos do Mac que não atravessam o reinício) e sai. Síncrono: o job
# segue serializado (concurrency: deploy-producao) e o próximo deploy nunca acha duas cores de pé.
if [ -n "$VELHA" ] && roda "$VELHA"; then
  dc stop -t 660 "nod-$VELHA"
  orfas "$NOVA" "$VELHA"
fi
if [ -n "$LEGADO" ]; then
  # NOD-331: o legado não para os laços na drenagem (código de antes) e, depois do recreate do Caddy, ninguém o
  # alcança: as ligações dele caíram no recreate e Mac e navegador já falam com a azul. 660 s só o deixariam
  # despachando em dobro; 30 s cobrem o tick em curso e o fechar.
  # shellcheck disable=SC2086 # um id por linha
  docker stop -t "${NOD_TRANSICAO_STOP_S:-30}" $LEGADO
  # shellcheck disable=SC2086
  docker rm $LEGADO >/dev/null
  orfas "$NOVA" legado --transicao
fi
docker image prune -f >/dev/null
