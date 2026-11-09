#!/usr/bin/env bash
# Prepara a voz grátis do dev (definido em 2026-10-04, ADR-071, plano "Modo dev grátis"): `say` do macOS para falar,
# whisper.cpp para entender. Confere o que já existe, baixa só o modelo que faltar e diz como ligar. Idempotente.
set -euo pipefail

dir="${NOD_VOZ_LOCAL:-$HOME/.cache/nod/voz}"
# definido em 2026-10-04: o small (~190 MB) entende bem melhor a fala de verdade que o base; 0,65 s por ~7 s de fala no M1.
modelo="${NOD_VOZ_WHISPER_MODELO:-ggml-small-q5_1.bin}"
url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelo}"
falhou=0

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "a voz local é só do macOS (o 'say' não existe aqui); fora do Mac use NOD_VOZ_STT=falso NOD_VOZ_TTS=falso" >&2
  exit 1
fi

if ! command -v say >/dev/null 2>&1; then
  echo "x 'say' não encontrado (devia vir com o macOS)" >&2
  falhou=1
else
  vozes="$(say -v '?' | awk '/pt_BR/ {print $1}' | sort -u | tr '\n' ' ')"
  if [[ -z "${vozes// /}" ]]; then
    echo "x nenhuma voz pt-BR no 'say': Ajustes do Sistema > Acessibilidade > Conteúdo Falado > Voz do Sistema > Gerenciar Vozes > Português (Brasil)" >&2
    falhou=1
  else
    echo "ok say, vozes pt-BR: ${vozes}"
    for v in Luciana Flo Sandy Shelley Eddy Reed Rocko Grandpa; do
      [[ " ${vozes} " == *" ${v} "* ]] || echo "  aviso: a voz ${v} (do catálogo do nod) não está instalada; o 'say' vai falhar com ela"
    done
  fi
fi

bin="${NOD_VOZ_WHISPER_BIN:-}"
if [[ -z "$bin" ]]; then
  bin="$(command -v whisper-server || true)"
  for c in /opt/homebrew/bin/whisper-server /usr/local/bin/whisper-server; do
    [[ -n "$bin" ]] && break
    [[ -x "$c" ]] && bin="$c"
  done
fi
if [[ -z "$bin" || ! -x "$bin" ]]; then
  echo "x whisper-server não encontrado. Instale com:" >&2
  echo "    brew install whisper-cpp" >&2
  falhou=1
else
  echo "ok whisper-server: ${bin}"
fi

mkdir -p "$dir"
if [[ -s "${dir}/${modelo}" ]]; then
  echo "ok modelo: ${dir}/${modelo}"
else
  echo "baixando ${modelo} (~60 MB) para ${dir}…"
  tmp="${dir}/${modelo}.part"
  if curl -fL --retry 2 -o "$tmp" "$url"; then
    mv "$tmp" "${dir}/${modelo}"
    echo "ok modelo: ${dir}/${modelo}"
  else
    rm -f "$tmp"
    echo "x falhou o download de ${url}" >&2
    falhou=1
  fi
fi

if (( falhou )); then
  echo "algo faltou (acima); a voz local não vai funcionar até resolver." >&2
  exit 1
fi

cat <<FIM

Pronto. Fora de produção no macOS a voz local já é o padrão; para forçar:
    NOD_VOZ_STT=local NOD_VOZ_TTS=local npm run dev
O nod sobe o whisper-server em 127.0.0.1:${NOD_VOZ_WHISPER_PORTA:-8178} na primeira ligação (a primeira vez leva ~40 s
compilando o Metal). Para os testes e o CI: NOD_VOZ_STT=falso NOD_VOZ_TTS=falso.
FIM
