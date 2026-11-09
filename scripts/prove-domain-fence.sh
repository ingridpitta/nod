#!/usr/bin/env bash
# Teste NEGATIVO da cerca do domínio (ADR-018): um arquivo que importa node:fs sob o
# tsconfig.domain.json tem que FALHAR na compilação. Se compilar, a cerca caiu.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/tsconfig.json" <<EOF
{
  "extends": "$ROOT/tsconfig.domain.json",
  "compilerOptions": { "noEmit": true },
  "include": ["illegal.ts", "$ROOT/src/contracts/**/*.ts"]
}
EOF
cat > "$TMP/illegal.ts" <<'EOF'
import { readFileSync } from "node:fs";
export const leak = readFileSync("/etc/hostname");
EOF
if npx tsc -p "$TMP/tsconfig.json" --pretty false >"$TMP/err" 2>&1; then
  echo "FALHA: o domínio compilou um import node:fs — a cerca do ADR-018 não está de pé." >&2
  exit 1
fi
if ! grep -q "node:fs" "$TMP/err"; then
  echo "FALHA: o compilador recusou por outro motivo:" >&2
  cat "$TMP/err" >&2
  exit 1
fi
echo "cerca do domínio ok: node:fs recusado"
