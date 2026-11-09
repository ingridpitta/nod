# Fixtures reais do `claude -p --output-format stream-json` (sonda de 2026-09-16, CLI 2.1.272, haiku)

Origem: scratchpad/sondas da sessão de 2026-09-16 (mapa-cli.json descreve cada uma).

- `s3-mcp-ok.jsonl` — cópia literal do stdout de s3: MCP stdio conectado, `mcp__nod__somar` chamada e
  respondida, `result` success com `total_cost_usd` 0.0207631 e `permission_denials: []`.
- `s4b-negado.jsonl` — cópia literal do stdout de s4b: mesmo comando SEM `--allowedTools`; o CLI nega a
  ferramenta, `result` continua `success`/`is_error:false` e só `permission_denials` denuncia.
- `s2c-session-in-use.jsonl` — VAZIO de propósito: o stdout real de s2c foi vazio (exit 1, stderr
  "Error: Session ID … is already in use."). O teste passa o stderr real por parâmetro.
- `s6-sigterm.jsonl` — RECONSTRUÍDO: a sonda s6 não gravou o stdout inteiro, só `s6.log` com a contagem
  por tipo de evento e a última linha. Este arquivo usa linhas REAIS do s3 na ordem e contagem do s6.log
  (init, status, rate_limit, message_start, 2 content_block_start, 2 thinking_tokens, 31 deltas,
  1 assistant, 1 content_block_stop), com o `session_id` do s6, e termina na última linha real do s6
  — sem `result`, como o SIGTERM deixou.
- `s7-sessao-viva.jsonl` — REAL, FILTRADO (2026-10-01, CLI 2.1.286, haiku, ADR-067): `--input-format stream-json`
  com o stdin ABERTO. O modelo pôs um Bash de 40 s em segundo plano (`system/task_started`, `is_backgrounded`), a
  pessoa escreveu "quanto é 2+2?" no meio e ele respondeu às duas no mesmo `result` ("Disparado\n\n4"); quando o
  comando terminou (`task_updated` completed + `task_notification`), o CLI abriu outro `system/init` e chamou o
  modelo de novo sozinho (`result` "bg-pronto"). Ficaram só init, assistant, user, result e system/task_*; os
  caminhos locais viraram `/tmp/nod-turno` e a lista de ferramentas do init foi reduzida ao kit do nod.
- `relatorio-lembrar.jsonl` — SINTÉTICO (2026-09-28), no formato das linhas reais do s3 (uma linha
  `assistant` por bloco, deltas antes do bloco completo): o modelo escreve um relatório de mais de 280
  caracteres, chama `mcp__nod__lembrar`, recebe o tool_result e fecha com "Anotado.". O `result` traz só
  "Anotado." — é o caso em que a fala perdia o relatório (comporFala em src/domain/stream-json.ts).
- `mensagem-no-meio.jsonl` — SINTÉTICO (2026-10-07, ADR-083 §6, #189), no formato das linhas reais: o modelo narra
  ("Vou revisar as três tasks.") e chama `consultar`; depois do resultado, a pessoa escreveu no meio (o CLI lê a
  mensagem no limite da ferramenta; a linha dela não aparece porque o stdout não a ecoa sem `--replay-user-messages`) e
  o modelo responde numa frase curta ("O prazo é sexta-feira, dia 9.") antes de chamar `lembrar` e fechar. Sem a regra
  da mensagem do meio, essa resposta (< 280 caracteres antes de uma ferramenta) era narração e sumia.
- `s8-subagentes.jsonl` — REAL, FILTRADO e EDITADO (2026-10-23, CLI 2.1.296, haiku, NOD-350): stdin aberto, o modelo
  chamou dois `Agent` com `run_in_background` ("Contar linhas do um.txt" e "Falhar de propósito"). As linhas
  `assistant`/`user` DOS SUBAGENTES chegam no stream principal com `parent_tool_use_id` = o id do `Agent`; o progresso
  vem em `system/task_progress` (`usage.tool_uses`, `last_tool_name`). Três voltas: "lancei", a volta quando o 1º
  terminou e a final. Ficaram só init, assistant, user, result e system/task_*; o init foi reduzido; caminhos viraram
  `/tmp/nod-turno`. EDITADO: o 2º agente voltou `completed` na captura (o modelo não falha de propósito) e foi trocado
  para `failed` no `task_updated` e no `task_notification`, para cobrir a falha.
