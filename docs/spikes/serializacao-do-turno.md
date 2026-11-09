# Spike E5.3 — serialização do turno e retomada a partir de estado persistido

**Data** 2026-09-16 · **Entregável** documento (nenhum critério é [AUTO]) · **Fonte** a sonda de
2026-09-16 contra o CLI 2.1.272 com haiku (mapa-cli.json, fixtures em `tests/fixtures/stream-json/`),
os ADRs 009/010/014/021/024 e o driver da L4 (`src/adapters/executor/drivers/claude-cli.ts`).

Toda afirmação abaixo marcada **provado** foi observada na sonda; **decidido** é escolha desta rodada;
**aberto** é o que ninguém mediu.

## 1. Como o estado do turno é serializado

O turno tem DOIS estados serializados, em lugares diferentes, e a fronteira entre eles é o desenho:

| O quê | Onde mora | Quem escreve | Sobrevive a |
|---|---|---|---|
| **Estado de protocolo** — os quatro sinais (`attempted`, `rejected`, `promptSubmitted`, `producedOutput`), `estado`, `machine_id`, `lease_ate`, `motivo_*`, `custo_usd`, `retoma_turno_id` | `turnos` (Postgres, 0002) | o servidor, via `renovar` a cada 30 s e `entregar` no fim (ADR-009/021) | reinício do servidor, máquina sumida, laptop fechado |
| **Sessão do CLI** — `session_id` do `claude -p` | `conversas.sessao_cli` (Postgres) — UM por conversa, gravado do `init.session_id`/`result.session_id` do primeiro turno | o servidor ao assentar o turno (L6) | idem |
| **Contexto da conversa** (mensagens, tool_use/tool_result, raciocínio) | transcript do CLI em `~/.claude/projects/<slug-do-cwd>/<session_id>.jsonl` na MÁQUINA DA PESSOA | o CLI, sozinho | reinício do servidor; NÃO sobrevive a troca de máquina nem a `rm -rf ~/.claude` |
| **Mensagens visíveis** (texto final, deltas assentados como uma mensagem, passe, parada, negação) | `mensagens` + `events` (Postgres) | o servidor ao assentar | tudo |
| **cwd do turno** (`mcp.json` 0600) | `NOD_HOME/turnos/turno-XXXX` (mkdtemp) | o driver | NADA — apagado no `finally` do mesmo turno (EMENDA 11) |

**Provado (s2a/s2b/s2d):** `--session-id <uuid>` no primeiro turno é honrado (`init.session_id` igual) e
`--resume <mesmo uuid>` num segundo processo devolve o contexto (respondeu `JABUTICABA-77`, a
palavra-código dita no turno anterior) com `cache_read` de 6 556 tokens e US$0,0035 — e funciona de
**qualquer cwd** (s2d rodou em `../outro-cwd`). Por isso o cwd é descartável e a sessão não é.

**Provado (s2c):** reutilizar `--session-id` dá `Error: Session ID … is already in use.`, exit 1,
stdout vazio. Logo `sessao_cli` nulo = `--session-id`; preenchido = `--resume`; nunca os dois.

**Decidido:** o nod NÃO serializa o contexto do modelo. O transcript é do CLI; o nod guarda só a
chave (`session_id`) e o que a pessoa precisa ver. Copiar o transcript para o servidor seria (a)
dado pessoal em trânsito sem classificação (ADR-002), (b) formato interno do fornecedor sem
contrato, (c) inútil na máquina de outra pessoa, porque a sessão é da conta de quem rodou.

## 2. O que é descartado entre turnos

- **O processo.** Cada turno é um `claude -p` novo. Nada fica residente entre turnos (ADR-014).
- **O cwd e o `mcp.json`.** Apagados no `finally`, inclusive em falha (teste `claude-cli-falso`:
  tmpdir inexistente após s3, s6 e s2c). O token de turno que estava no `mcp.json` é revogado pelo
  servidor ao assentar (`services.tokenTurno.revogar`).
- **O plano de turno.** Emitido no `puxar`, válido por `PLANO_VALIDADE_MS` (1 h = janela do cache
  `ephemeral_1h` do CLI, mapa-cli). O próximo turno recebe um plano NOVO com o catálogo recalculado —
  é isto que responde a §4.
- **Os deltas.** Efêmeros: vão ao SSE pelo barramento, nunca ao outbox (L8). O que persiste é a
  mensagem final assentada; um turno interrompido assenta o texto parcial com `parcial = true`.
- **Os eventos não documentados** (`system/status`, `thinking_tokens`, `rate_limit_event`): o parser
  os marca `ignorado` e nada disso é gravado (medido: 31 deltas, 2 thinking_tokens, 1 status num
  turno de 4 s — s6.log).
- **O stderr.** Capturado até 64 KiB só para diagnóstico; nenhuma decisão o lê (ADR-009, E9.1).

## 3. Como a resposta humana tardia reencontra o ponto de parada

Parada = turno **encerrado** com uma `Decisao` (`tipo` pergunta | falta_de_dado | permissao |
retomar_turno) na fila de "Sua vez" da pessoa nomeada (EMENDA 16, E5.2). O ponto de parada é,
portanto, um par persistido: **(`conversas.sessao_cli`, `decisoes.id`)**.

Quando a pessoa responde — três dias depois, após reinício do servidor, de outro navegador —
`POST decisoes/:id/responder {texto}` cria um **turno NOVO** (`origem = 'retomada'`,
`retoma_turno_id` = o turno parado, ADR-010: nunca requeue) na mesma conversa. O plano desse turno
traz `entrada.sessaoCli` = a sessão guardada e `entrada.texto` = a frase da pessoa marcada como
"a informação que destravou". O driver monta `--resume <sessão>`: o CLI reabre o transcript na
máquina da pessoa e o modelo vê a própria pergunta e a resposta, sem repetição da instrução original
(E5.4 critério 1).

O que o **reinício do servidor** não afeta: sessão e decisão estão no Postgres; o transcript está na
máquina. O que a **troca de máquina** afeta: o transcript não está lá. **Provado por construção,
não medido:** `--resume` de uma sessão inexistente na máquina falha pré-init (o binário falso
reproduz com `NOD_FALSO_EXIGE_SESSAO=1`: exit 1, "No conversation found"), o classificador dá
`sessao_rejeitada` com `rejected = true`, e o servidor cria a decisão "retomar sem contexto?" — a
retomada seguinte manda `sessaoCli = null` e o agente recomeça só com a memória durável
(`memorias`) e a conversa visível no prompt. Não há caminho que finja continuidade.

**Aberto:** quanto tempo o CLI guarda o transcript. A sonda não mediu retenção; a hipótese de
trabalho é "indefinidamente até a pessoa apagar". O gatilho para medir é o primeiro `sessao_rejeitada`
numa retomada na MESMA máquina.

## 4. Resposta depois de uma mudança de permissões no intervalo

A permissão não viaja com a sessão: viaja com o **plano**. O catálogo do turno de retomada é
recalculado na hora (`montarPlano` em `src/domain/plano-turno.ts`: conector habilitado ∩ concessão
do agente ∩ profundidade ∩ redução por confiança) e vira `--allowedTools` exato + `--tools ""` +
`--strict-mcp-config` (mapa-cli: a combinação verificada de menor privilégio). Consequências:

- **Permissão retirada no intervalo:** o CLI retomado NÃO tem a ferramenta em `init.tools`. Se o
  modelo tentar, a negação é do próprio CLI — **provado (s4b):** `tool_result.is_error = true`,
  `result.subtype = 'success'`, `permission_denials = [{tool_name}]` — e o driver a devolve em
  `negacoesPermissao`; o servidor grava `negacao` (`ferramenta_negada`, `fora_do_catalogo`) e a
  renderiza (ADR-029). Nenhuma chamada chega ao conector.
- **Permissão concedida no intervalo:** a ferramenta entra no catálogo do plano novo e o proxy a
  lista em `tools/list`. O transcript antigo não sabe dela; o `--append-system-prompt` (estável por
  agente, para cachear) diz o que existe hoje.
- **Plano expirado antes de o turno rodar** (pessoa demorou > 1 h entre `puxar` e o spawn — só
  acontece com a máquina dormindo): `plano_expirado` no proxy, turno encerra sem chamada, item na fila.

Ou seja: **resposta tardia = plano reemitido**. A sessão traz o contexto; o plano traz a alçada; os
dois nunca se misturam (ADR-024).

## 5. Teto do `tools/call` (aprovação em long-poll)

A aprovação síncrona segura um `tools/call` aberto enquanto a pessoa decide. O proxy fatia a espera
em `LONGPOLL_APROVACAO_MS` (20 s, definido: abaixo do teto do pull da ponte) contra
`GET interno/decisoes/:id/aguardar`, mas o CLI tem um teto próprio para o `tools/call` inteiro.

- **Decidido:** o driver passa `MCP_TOOL_TIMEOUT = max(60 s, prazoMs do turno)` ao filho
  (`montarEnvDoFilho`), a variável documentada do Claude Code para o teto de execução de ferramenta.
- **Aberto — a medir com `scripts/sonda-mcp-timeout.ts`:** o teto REAL com e sem a variável (uma
  ferramenta que dorme N s; um turno real por ponto). Ninguém rodou nesta rodada; o número entra
  ao lado de `LONGPOLL_APROVACAO_MS` como `medido em <data>: <N> s (scripts/sonda-mcp-timeout.ts)`.
  Até lá a aprovação pendente tem o caminho de fallback já contratado: `pedir_aprovacao` devolve
  `{estado:'pendente', decisao_id, instrucao:'encerre o turno; a decisão retoma depois'}` e a
  retomada é a de §3.

## 6. As quatro capacidades que dependem deste desenho

| Capacidade | O que usa daqui | Estimativa |
|---|---|---|
| **Parar no teto** (E5.1, teto de canal / capacidade desligada): negação terminal encerra o turno sem outra chamada | plano por turno como única fonte de alçada (§4) + parada = turno encerrado com decisão (§3) | 1 semana-eng (proxy: `negacao.ts` + trilha + render) |
| **Rotina com gate** (E7.3): efeito externo só por item aprovado | `politicaExecucao.efeitoExternoSoPorAprovacao` no plano (EMENDA 15) + retomada por decisão `gate_rotina` (§3) | 1,5 semana-eng (janela única, decisão, retomada com `--resume` da sessão da rotina) |
| **Procuração** (ADR-023/025): turno rodando sob procuração de outra pessoa | `autoria.sob_procuracao_de` no plano; a sessão continua sendo da conta de quem executa (§1: transcript é da máquina) | 2 semanas-eng (fora desta rodada; a autoria composta já está no contrato) |
| **Botão de parar** (E5.4/E5.5 Parar): `renovar → {ativo:false}` → SIGTERM | sinais write-ahead a cada 30 s (§1) + ausência de `result` classificada como interrompido (**provado s6:** exit 143, signal null, 640 ms, filho MCP morto) | 0,5 semana-eng (feito no driver e no laço da L4; falta a rota `POST parar` da L6 e a faixa renderizada) |

## Evidência

`mapa-cli.json` (comando literal, eventos, armadilhas), `tests/fixtures/stream-json/{s3-mcp-ok,
s4b-negado,s6-sigterm,s2c-session-in-use}.jsonl`, `s6.log` (contagem por tipo de evento e tempo do
SIGTERM), `tests/integration/executor/claude-cli-falso.test.ts` (o driver contra o contrato),
`src/domain/stream-json.ts` (`classificarResultado`). Seis turnos reais cobrados na sonda, ~US$0,08.
