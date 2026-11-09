#!/usr/bin/env bash
# Roteiro MANUAL de aceite com o CLI REAL — `npm run e2e:aceite` (EMENDA 30: o e2e automatizado
# sem custo é tests/concurrency/e2e-catcher.test.ts; este script percorre o fluxo_e2e_de_aceite do
# plano com curl+jq contra um servidor NOD_EXECUTOR=claude-cli e IMPRIME o custo somado).
#
# CUSTO — medido em 2026-09-16 (rodada única, Haiku 4.5, macOS, CLI 2.1.272; NOD-164: o padrão agora é o alias
# `sonnet` dos agentes, a medir na próxima rodada):
#   ver o bloco "CUSTO MEDIDO" no fim deste cabeçalho (preenchido pela rodada real).
#
# Sobe o compose, migra, roda o seed, sobe o servidor em 8888 com env LIMPO (denylist
# ^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$ — o driver também limpa), e
# percorre: sonda → sessão → SSE → criar bot → perfil proposto → confirmar → memória → 2º turno
# (--resume) → rotina por texto → conector + concessão → aprovação em lista → parar → pergunta ≠
# permissão → sua vez/expiração → /metrics. Os passos DETERMINÍSTICOS (formas, códigos, RLS) falham o
# script; os que dependem do MODELO chamar a ferramenta certa são reportados como "modelo não chamou"
# e não derrubam a rodada (o e2e com catcher é quem prova a mecânica; aqui prova-se o contrato com o
# CLI real). Zero `claude -p` fora do que o servidor dispara.
#
# CUSTO MEDIDO (2026-09-16): US$ 0,1131 — 1 sonda (US$ 0,012949) + 8 turnos Haiku 4.5 (US$ 0,100106):
#   turno 1 (criar bot, atualizar_perfil + lembrar, com MCP) US$ 0,0230; os demais entre US$ 0,003 (resume)
#   e ~US$ 0,02 (com chamada de ferramenta). Meta < US$ 0,50. Rodada única: exit 0, todos os passos
#   determinísticos verdes; o modelo chamou atualizar_perfil, lembrar, criar_rotina, listar_contatos +
#   pedir_aprovacao (2 de 3 e-mails enviados) e pedir_a_pessoa por conta própria. Custo por turno lido
#   de GET turnos/:id (gastos, ADR-015); somado com jq no fim do script.
set -euo pipefail

cd "$(dirname "$0")/.."
export NOD_EXECUTOR=claude-cli
export NOD_LOGIN="${NOD_LOGIN:-stub}"
export NOD_MODELO="${NOD_MODELO:-sonnet}"
export NOD_API_PORT="${NOD_API_PORT:-8888}"
export NOD_LONGPOLL_MS="${NOD_LONGPOLL_MS:-8000}"
API="http://127.0.0.1:${NOD_API_PORT}"
JAR="$(mktemp -t nod-jar)"
LOG="$(mktemp -t nod-servidor).log"
EMAILS="$(mktemp -t nod-emails).jsonl"
INICIO_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SERVIDOR_PID=""
OBS=()

for v in $(env | cut -d= -f1 | grep -E '^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$' || true); do unset "$v"; done
command -v jq >/dev/null || { echo "jq é obrigatório"; exit 1; }
command -v psql >/dev/null || { echo "psql é obrigatório"; exit 1; }
[ -f .env ] || { echo "copie .env.example para .env"; exit 1; }
set -a; . ./.env; set +a
export NOD_EXECUTOR=claude-cli
# Revisto em 2026-10-18 (QA do PR #393): a porta do .env vale para o servidor E para o curl; antes o API saía do
# ambiente de antes do .env e, com NOD_API_PORT só no .env, o script falava com a 8888 enquanto o servidor ouvia outra.
API="http://127.0.0.1:${NOD_API_PORT}"

passo() { printf '\n== %s\n' "$*"; }
ok() { printf '   ok: %s\n' "$*"; }
obs() { OBS+=("$*"); printf '   obs: %s\n' "$*"; }
falha() { printf '   FALHA: %s\n' "$*"; exit 1; }
api() { # api METODO caminho [json]
  local m="$1" c="$2" corpo="${3:-}"
  if [ -n "$corpo" ]; then curl -sS -b "$JAR" -X "$m" "$API/api/t/$T/$c" -H 'content-type: application/json' -d "$corpo"; else curl -sS -b "$JAR" -X "$m" "$API/api/t/$T/$c"; fi
}
status() { # status METODO caminho [json] → só o código HTTP (mesmo if/else de api(): ${corpo:+-d "$corpo"} sem aspas quebrava em cron com '*')
  local m="$1" c="$2" corpo="${3:-}"
  if [ -n "$corpo" ]; then curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X "$m" "$API/api/t/$T/$c" -H 'content-type: application/json' -d "$corpo"; else curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X "$m" "$API/api/t/$T/$c"; fi
}
ms() { perl -MTime::HiRes=time -e 'printf "%d\n", time()*1000'; } # `date +%s%3N` não existe no macOS (imprime "3N" literal); perl arranca em ~10 ms, python3 em ~200
esperar_turno() { # esperar_turno ID [timeout_s]
  local id="$1" limite="${2:-180}" t0 estado
  t0=$(date +%s)
  while :; do
    estado=$(api GET "turnos/$id" | jq -r .turno.estado)
    case "$estado" in concluido|interrompido) echo "$estado"; return 0;; esac
    [ $(( $(date +%s) - t0 )) -gt "$limite" ] && { echo "timeout"; return 1; }
    sleep 2
  done
}
esperar() { # esperar "descrição" segundos comando-que-imprime-algo-não-vazio
  local desc="$1" limite="$2" t0; shift 2; t0=$(date +%s)
  while :; do
    local r; r=$("$@" 2>/dev/null || true)
    [ -n "$r" ] && [ "$r" != "null" ] && { echo "$r"; return 0; }
    [ $(( $(date +%s) - t0 )) -gt "$limite" ] && { echo ""; return 1; }
    sleep 2
  done
}
encerrar() {
  if [ -n "$SERVIDOR_PID" ]; then kill "$SERVIDOR_PID" 2>/dev/null || true; wait "$SERVIDOR_PID" 2>/dev/null || true; fi
}
trap encerrar EXIT

passo "PREPARO: compose, migrações, seed"
# Revisto em 2026-10-18 (QA do PR #393): com o banco efêmero (docs/ambiente-local-persistente.md) o compose principal
# não sobe — numa worktree ele tentava criar outro `nod-postgres` e parava a rodada; quem migra e semeia é o efêmero.
if [ "${NOD_BANCO_AMBIENTE:-}" != "efemero" ]; then npm run -s docker:up >/dev/null; fi
npm run -s db:migrate >/dev/null
npm run -s db:migrate:test >/dev/null
npm run -s db:seed >/dev/null
ok "postgres 5434 no ar, migrações aplicadas, seed idempotente"

passo "SUBIR: servidor 8888 com NOD_EXECUTOR=claude-cli (a sonda custa um turno)"
node src/adapters/http/server.ts > "$LOG" 2>&1 &
SERVIDOR_PID=$!
# `nod_no_ar` sai DEPOIS da sonda do boot (o listen vem antes; /api/saude já responde enquanto o CLI é sondado).
for i in $(seq 1 150); do grep -q '"evento":"nod_no_ar"' "$LOG" 2>/dev/null && break; sleep 1; done
grep -q '"evento":"nod_no_ar"' "$LOG" || { cat "$LOG"; falha "servidor não subiu"; }
curl -sf "$API/api/saude" | jq -e '.ok == true' >/dev/null || falha "/api/saude"
# Login de desenvolvimento (NOD_LOGIN=stub, ADR-030): a pessoa vem do cadastro semeado, entra por id.
PESSOA_MARLON=$(curl -sS "$API/api/sessao/modo" | jq -r '.pessoas[] | select(.nome == "Marlon") | .id')
[ -n "$PESSOA_MARLON" ] || falha "Marlon não está no cadastro (rode npm run db:seed)"
curl -sS -c "$JAR" -X POST "$API/api/sessao/entrar" -H 'content-type: application/json' -d "{\"pessoaId\":\"$PESSOA_MARLON\"}" >/dev/null
T=$(curl -sS -b "$JAR" "$API/api/sessao" | jq -r .tenantId)
P=$(curl -sS -b "$JAR" "$API/api/sessao" | jq -r .pessoaId)
INV=$(api GET inventario)
echo "   inventário: $INV"
[ "$(echo "$INV" | jq -r .estado)" = "pronto" ] || falha "inventário não está pronto — confira \`npm run sonda\` (ausente/nao_autenticado é fail-closed por desenho)"
echo "$INV" | jq -e 'has("email") | not' >/dev/null && ok "inventário pronto, sem email (ADR-019)"
# Revisto em 2026-10-18 (QA do PR #389): desde a ADR-093 o boot sonda o login sem inferência e não loga
# `sonda_claude_cli`; sem a linha, o grep saía com 1 e o `pipefail` matava a rodada logo depois do inventário.
CUSTO_SONDA=$(grep '"evento":"sonda_claude_cli"' "$LOG" | tail -1 | jq -r '.custo_usd // 0' || true)
CUSTO_SONDA=${CUSTO_SONDA:-0}
ok "sonda custou US\$ $CUSTO_SONDA"

passo "SSE: canal por pessoa com id streamId:seq (terminal 2 é o arquivo)"
SSE="$(mktemp -t nod-sse)"
( curl -sN -b "$JAR" "$API/api/t/$T/eventos" > "$SSE" 2>/dev/null & echo $! > "$SSE.pid" )
sleep 1
grep -q '^event: resumed' "$SSE" && ok "frame 'resumed' na conexão" || falha "SSE sem frame resumed"

passo "CRIAR BOT: nasce 'Novo agente', sem acessos; o modelo propõe o perfil (mcp__nod__atualizar_perfil)"
R=$(api POST agentes '{"dono":"pessoa"}')
A=$(echo "$R" | jq -r .agente.id); C=$(echo "$R" | jq -r .conversa.id)
[ "$(echo "$R" | jq -r .agente.nome)" = "Novo agente" ] && ok "agente $A 'Novo agente', conversa $C"
api GET frota | jq -e --arg a "$A" '.agentes[] | select(.id==$a) | .descricaoEstado == "sem acessos · nunca executou"' >/dev/null && ok "frota: 'sem acessos · nunca executou'"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Te chamo de Vera. Você revisa PRs do time nod e responde curto. Use a ferramenta atualizar_perfil para propor nome, título e descrição, e a ferramenta lembrar para guardar a preferência: prefiro resumos em tópicos. Depois responda em uma linha."}')
T1=$(echo "$R" | jq -r .ids.turno)
E1=$(esperar_turno "$T1") ; ok "turno 1 → $E1 (custo $(api GET "turnos/$T1" | jq -r .turno.custoUsd))"
grep -q 'event: turno.delta' "$SSE" && ok "frames turno.delta chegaram (streaming)" || obs "sem turno.delta no SSE"
PROPS=$(api GET "conversas/$C/mensagens" | jq -c '[.propostas[] | .kind]')
if echo "$PROPS" | jq -e 'index("perfil") != null' >/dev/null; then
  PP=$(api GET "conversas/$C/mensagens" | jq -r '.propostas[] | select(.kind=="perfil") | .id')
  api GET frota | jq -e --arg a "$A" '.agentes[] | select(.id==$a) | .nome == "Novo agente"' >/dev/null && ok "nada aplicado antes de confirmar (E1.1)"
  api POST "propostas/$PP/confirmar" >/dev/null
  NOME=$(api GET frota | jq -r --arg a "$A" '.agentes[] | select(.id==$a) | .nome')
  ok "proposta confirmada: agente agora se chama '$NOME'"
else
  obs "o modelo não chamou atualizar_perfil neste turno (propostas: $PROPS); seguindo com PATCH do nome"
  api PATCH "agentes/$A" '{"nome":"Vera"}' >/dev/null
fi
MEM=$(api GET "agentes/$A/memoria" | jq -c '[.memorias[] | {tipo, origem}]')
if [ "$(echo "$MEM" | jq length)" -gt 0 ]; then ok "memória via lembrar: $MEM"; else obs "o modelo não chamou lembrar; anotando pela pessoa"; api POST "agentes/$A/memoria" '{"tipo":"preferencia","texto":"prefere resumos em tópicos"}' >/dev/null; fi
S1=$(api GET "conversas/$C/mensagens" | jq -r .conversa.sessaoCli)
[ "$S1" != "null" ] && ok "sessão do CLI guardada na conversa: $S1"

passo "2º TURNO usa --resume (mesma sessão)"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Em uma linha: qual preferência minha você guardou?"}')
T2=$(echo "$R" | jq -r .ids.turno); E2=$(esperar_turno "$T2"); ok "turno 2 → $E2"
[ "$(api GET "conversas/$C/mensagens" | jq -r .conversa.sessaoCli)" = "$S1" ] && ok "sessaoCli preservada (--resume)"
api POST "agentes/$A/fixar" >/dev/null && api POST "agentes/$A/ocultar" '{"oculto":false}' >/dev/null && ok "Pin/Hide respondem"

# Definido em 2026-10-18 (QA do PR #393, plano chat limpo PR 5): o título que o modelo dá às frentes com o pedido de
# "2 a 5 palavras" e se ele manda o `titulo_do_lote`. O pedido não dita títulos; as frentes são paradas logo que abrem
# (o que importa é a abertura, e cada frente rodando custaria um turno a mais).
passo "FRENTES: abrir_frentes com título de 2 a 5 palavras e titulo_do_lote; as frentes param logo"
# A conversa tem que estar parada: com a sessão viva (ADR-067) o pedido entra no turno que ainda roda (a retomada do perfil
# confirmado) e o turno dele volta "interrompido · absorvido" — medido na 1ª rodada de 2026-10-18, o modelo nem viu o pedido.
ociosa() { api GET "conversas/$C/mensagens" | jq -r 'if ([.turnosEmCurso[] | select(.trabalhoId == null)] | length) == 0 then "sim" else empty end'; }
esperar "conversa sem turno do dono rodando" 240 ociosa >/dev/null || obs "a conversa não ficou parada em 240 s"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Os resultados estão ficando muito bons. Por hora podemos seguir com as 5 opções que você mandou, mas preciso de duas coisas longas e independentes: refazer os roteiros de animação do hero com mais calma, em 5 cenas, e escrever os textos da página de preços em português e em inglês. Use a ferramenta abrir_frentes para as duas, numa chamada só, e me diga em uma frase o que começou."}')
TF=$(echo "$R" | jq -r .ids.turno); EF=$(esperar_turno "$TF" 240); ok "turno das frentes → $EF"
LF=$(api GET "conversas/$C/mensagens" | jq -c '[.mensagens[] | select(.payload.kind=="frentes_abertas")][-1].payload // empty')
if [ -n "$LF" ]; then
  for W in $(echo "$LF" | jq -r '.frentes[].trabalhoId'); do api POST "trabalhos/$W/parar" >/dev/null || true; done
  echo "$LF" | jq -r '.frentes[] | "   título: \"\(.titulo)\" (\(.titulo | split(" ") | length) palavras, \(.titulo | length) caracteres)"'
  TL=$(echo "$LF" | jq -r '.tituloDoLote // empty')
  [ -n "$TL" ] && ok "titulo do lote: \"$TL\"" || obs "a linha frentes_abertas saiu sem tituloDoLote"
  echo "$LF" | jq -e '[.frentes[].titulo | split(" ") | length] | all(. <= 5)' >/dev/null && ok "todos os títulos com até 5 palavras" || obs "título com mais de 5 palavras: $(echo "$LF" | jq -c '[.frentes[].titulo]')"
  TCOL=$(psql "$DATABASE_URL" -qAt -c "select set_config('nod.tenant_id','$T',false); select set_config('nod.pessoa_id','$P',false); select coalesce(titulo, '(null: o modelo não mandou titulo_do_lote)') from lotes_de_frentes where id = '$(echo "$LF" | jq -r .loteId)';" | tail -1)
  echo "   lotes_de_frentes.titulo: $TCOL"
  esperar "conversa parada depois das frentes" 240 ociosa >/dev/null || obs "a conversa não ficou parada depois das frentes"
else
  obs "o modelo não chamou abrir_frentes neste turno"
fi

passo "ROTINA POR TEXTO: criar_rotina → proposta + decisão 'rotina' em Sua vez; decidir ativa"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Use a ferramenta criar_rotina para propor: todo dia útil às 8:00 de America/Sao_Paulo (cron 0 8 * * 1-5) poste aqui um resumo dos PRs abertos; fonte: PRs abertos do time nod; entregável: resumo em tópicos; limites de aprovação: nada sai sem aprovação; se não houver dado, diga que não houve. Depois responda em uma linha."}')
T3=$(echo "$R" | jq -r .ids.turno); E3=$(esperar_turno "$T3"); ok "turno 3 → $E3"
DR=$(api GET sua-vez | jq -r '[.itens[] | select(.decisao.tipo=="rotina")][0].decisao.id // empty')
if [ -n "$DR" ]; then
  [ "$(api GET rotinas | jq '.rotinas | length')" = "0" ] && ok "zero rotinas antes de confirmar"
  api POST "decisoes/$DR/decidir" '{}' >/dev/null
  api GET rotinas | jq -e '.rotinas[0].rotina | .estado=="ativa" and .fusoIana=="America/Sao_Paulo" and .exigeAprovacao==true' >/dev/null && ok "rotina ativa com fuso nomeado e gate ligado"
else
  obs "o modelo não chamou criar_rotina; criando pela pessoa (POST rotinas)"
  api POST rotinas "{\"agenteId\":\"$A\",\"cron\":\"0 8 * * 1-5\",\"fusoIana\":\"America/Sao_Paulo\",\"instrucao\":\"resumo dos PRs\",\"fonte\":\"PRs\",\"entregavel\":\"tópicos\",\"limitesAprovacao\":\"nada sem aprovação\",\"politicaSemDado\":\"diga que não houve\"}" >/dev/null
fi
[ "$(status POST rotinas "{\"agenteId\":\"$A\",\"cron\":\"0 8 * * *\",\"fusoIana\":\"+03:00\"}")" = "400" ] && ok "fuso offset → 400 fuso_invalido"

passo "CONECTOR + CONCESSÃO (scripts/mcp-exemplo.mjs)"
R=$(api POST conectores "{\"nome\":\"Exemplo\",\"slug\":\"exemplo\",\"transporte\":\"stdio\",\"comando\":\"$(command -v node)\",\"args\":[\"$PWD/scripts/mcp-exemplo.mjs\"],\"env\":{\"NOD_MCP_EXEMPLO_ARQUIVO\":\"$EMAILS\"},\"declaracao\":\"nao-toca\"}")
K=$(echo "$R" | jq -r .ids.conector)
[ "$(echo "$R" | jq -r .conector.habilitado)" = "false" ] && ok "conector nasce desabilitado, env só em chaves"
api POST "conectores/$K/sondar" | jq -e '.conector.habilitado==true and ([.conector.catalogo[].nome]|sort==["enviar_email","listar_contatos"])' >/dev/null && ok "sondado: listar_contatos (readOnly) + enviar_email"
api POST "agentes/$A/concessoes" "{\"conectorId\":\"$K\",\"capacidade\":\"listar_contatos\"}" >/dev/null
api POST "agentes/$A/concessoes" "{\"conectorId\":\"$K\",\"capacidade\":\"enviar_email\"}" >/dev/null
[ "$(api GET "conversas/$C/mensagens" | jq '[.mensagens[] | select(.kind=="consentimento")] | length')" = "2" ] && ok "duas mensagens de consentimento imutáveis"
[ "$(status POST conectores '{"nome":"X","slug":"x","transporte":"stdio","comando":"node","env":{"TOKEN":true}}')" = "400" ] && ok "env placeholder em conector novo → 400"
[ "$(status POST conectores '{"nome":"Y","slug":"y","transporte":"http","url":"http://127.0.0.1:1/mcp","declaracao":"toca"}')" = "400" ] && ok "http + toca → 400"

passo "APROVAÇÃO EM LISTA: listar_contatos → pedir_aprovacao (3 itens) → decidir 2 de 3 → conector recebe 2"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Use a ferramenta exemplo__listar_contatos para pegar os contatos e depois a ferramenta pedir_aprovacao com UM item por contato (destino: conector exemplo, ferramenta enviar_email, argumentos para/assunto/texto) para enviar um e-mail curto de boas-vindas a cada um. Se a aprovação ficar pendente, encerre o turno dizendo que aguarda aprovação."}')
T4=$(echo "$R" | jq -r .ids.turno); E4=$(esperar_turno "$T4" 240); ok "turno 4 → $E4"
DA=$(api GET sua-vez | jq -r --arg t "$T4" '[.itens[] | select(.decisao.tipo=="aprovacao" and .decisao.turnoId==$t)][0].decisao.id // empty')
if [ -n "$DA" ]; then
  ITENS=$(api GET sua-vez | jq -c --arg d "$DA" '[.itens[] | select(.decisao.id==$d)][0].itensAprovacao')
  N=$(echo "$ITENS" | jq length); ok "decisão de aprovação com $N item(ns)"
  MARC=$(echo "$ITENS" | jq -c 'to_entries | map({id: .value.id, selecionado: (.key != 1)})')
  R=$(api POST "decisoes/$DA/decidir" "{\"itens\":$MARC}")
  TR=$(echo "$R" | jq -r '.ids.turnoRetomada // empty')
  ENV=$( [ -f "$EMAILS" ] && wc -l < "$EMAILS" | tr -d ' ' || echo 0 )
  ok "conector recebeu $ENV e-mail(s) (esperado: $N menos 1)"
  api GET "conversas/$C/mensagens" | jq -r '[.mensagens[] | select(.kind=="resultado_aprovacao")][0].texto' | sed 's/^/   resultado: /'
  [ -n "$TR" ] && ok "turno de retomada $TR → $(esperar_turno "$TR")"
  api GET "trilha?agente=$A&conector=$K" | jq -e '[.linhas[] | select(.kind=="tool_call")] | length > 0' >/dev/null && ok "trilha lista as chamadas ao conector"
else
  obs "o modelo não chegou a pedir_aprovacao neste turno (o e2e com catcher prova a mecânica)"
fi

passo "PARAR: turno longo interrompido em < 2 s, fala parcial; sem nada rodando → nadaRodando"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Escreva um relatório bem longo, com pelo menos 30 parágrafos, sobre revisão de código."}')
T5=$(echo "$R" | jq -r .ids.turno)
esperar "delta do turno 5" 60 sh -c "grep -c 'event: turno.delta' '$SSE' | awk '\$1 > 3'" >/dev/null || obs "poucos deltas antes do parar"
T0=$(ms)
FX=$(api POST "conversas/$C/parar"); echo "   faixa: $FX"
E5=$(esperar_turno "$T5" 30); T1MS=$(ms)
[ "$E5" = "interrompido" ] && ok "turno 5 interrompido em $(( T1MS - T0 )) ms ($(api GET "turnos/$T5" | jq -r .turno.motivoInterrupcao))"
sleep 1 # o driver dá SIGTERM e só depois SIGKILL; um segundo basta para o processo sumir
# só os `claude -p` do nod (modelo $NOD_MODELO): outras ferramentas na máquina também rodam `claude -p` (visto em 2026-09-16)
pgrep -f "claude -p.*--model ${NOD_MODELO}" >/dev/null && obs "ainda há 'claude -p' do nod vivo" || ok "nenhum 'claude -p' do nod vivo"
api POST "conversas/$C/parar" | jq -e '.nadaRodando==true' >/dev/null && ok "de novo → nadaRodando:true"

passo "PERGUNTA ≠ PERMISSÃO: pedir_a_pessoa falta_de_dado → decidir 409 → responder retoma com --resume"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Preciso do orçamento do Q4 e você não tem esse dado. Use a ferramenta pedir_a_pessoa com tipo falta_de_dado, dado: orçamento do Q4, quem_destrava: Marlon, e encerre o turno."}')
T6=$(echo "$R" | jq -r .ids.turno); E6=$(esperar_turno "$T6"); ok "turno 6 → $E6"
DF=$(api GET sua-vez | jq -r --arg t "$T6" '[.itens[] | select(.decisao.turnoId==$t)][0].decisao.id // empty')
if [ -n "$DF" ]; then
  ok "decisão tipo $(api GET sua-vez | jq -r --arg d "$DF" '[.itens[] | select(.decisao.id==$d)][0].decisao.tipo')"
  [ "$(status POST "decisoes/$DF/decidir" '{}')" = "409" ] && ok "decidir por botão → 409 (responde-se com texto)"
  R=$(api POST "decisoes/$DF/responder" '{"texto":"o orçamento do Q4 é R$ 120 mil; responda em uma linha"}')
  TR6=$(echo "$R" | jq -r .ids.turnoRetomada); ok "retomada $TR6 → $(esperar_turno "$TR6")"
else
  obs "o modelo não chamou pedir_a_pessoa neste turno"
fi

passo "SUA VEZ E EXPIRAÇÃO: prazo vencido → decisao.vencida em ≤ 30 s, varrida uma vez, reabrir"
R=$(api POST "conversas/$C/mensagens" '{"texto":"Use a ferramenta pedir_a_pessoa com tipo pergunta: posso arquivar o PR 7? Encerre o turno."}')
T7=$(echo "$R" | jq -r .ids.turno); esperar_turno "$T7" >/dev/null
DV=$(api GET sua-vez | jq -r --arg t "$T7" '[.itens[] | select(.decisao.turnoId==$t)][0].decisao.id // empty')
if [ -n "$DV" ]; then
  psql "$DATABASE_URL" -qAt -c "select set_config('nod.tenant_id','$T',false); select set_config('nod.pessoa_id','$P',false); update decisoes set prazo_decisao_em = now() - interval '1 minute' where id = '$DV';" >/dev/null
  esperar "decisao.vencida" 45 sh -c "grep -c 'event: decisao.vencida' '$SSE' | awk '\$1 > 0'" >/dev/null && ok "frame decisao.vencida chegou"
  api GET sua-vez | jq -e --arg d "$DV" '[.itens[] | select(.decisao.id==$d)][0].estadoColuna=="vencido"' >/dev/null && ok "'vencido' em cinza na fila"
  sleep 35
  [ "$(psql "$DATABASE_URL" -qAt -c "select set_config('nod.tenant_id','$T',false); select set_config('nod.pessoa_id','$P',false); select count(*) from decisao_eventos_varridos where decisao_id='$DV';" | tail -1)" = "1" ] && ok "varrida UMA vez (idempotente)"
  api POST "decisoes/$DV/reabrir" >/dev/null && api GET sua-vez | jq -e '.itens[0].estadoColuna=="reaberto"' >/dev/null && ok "reaberta no topo com prazo novo"
else
  obs "o modelo não chamou pedir_a_pessoa (pergunta)"
fi

passo "OBS: /metrics na raiz"
curl -sS "$API/metrics" | grep -q '^# TYPE nod_' && ok "/metrics em texto Prometheus"
curl -sS "$API/api/t/$T/frota" -o /dev/null -w '%{http_code}\n' | grep -q 401 && ok "sem cookie → 401"

passo "CUSTO SOMADO"
# psql -c com várias instruções devolve só o resultado da ÚLTIMA; set_config de sessão (false) basta numa conexão só.
CUSTO_TURNOS=$(psql "$DATABASE_URL" -qAt -c "select set_config('nod.tenant_id','$T',false); select set_config('nod.pessoa_id','$P',false); select coalesce(sum(custo_usd),0) from gastos where owner_id='$P' and em >= '$INICIO_ISO';" | tail -1)
N_TURNOS=$(psql "$DATABASE_URL" -qAt -c "select set_config('nod.tenant_id','$T',false); select set_config('nod.pessoa_id','$P',false); select count(*) from gastos where owner_id='$P' and em >= '$INICIO_ISO';" | tail -1)
TOTAL=$(python3 -c "print(round(float('${CUSTO_SONDA:-0}' or 0) + float('${CUSTO_TURNOS:-0}' or 0), 4))")
kill "$(cat "$SSE.pid")" 2>/dev/null || true
echo "   sonda: US\$ $CUSTO_SONDA · $N_TURNOS turno(s): US\$ $CUSTO_TURNOS · TOTAL: US\$ $TOTAL (meta < 0,50)"
if [ ${#OBS[@]} -gt 0 ]; then printf '\n== OBSERVAÇÕES (dependem do modelo; o e2e com catcher prova a mecânica):\n'; printf '   - %s\n' "${OBS[@]}"; fi
echo
echo "ACEITE COM ${NOD_MODELO}: verde (passos determinísticos) · log do servidor: $LOG"
