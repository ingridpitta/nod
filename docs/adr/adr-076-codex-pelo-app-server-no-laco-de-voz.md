# ADR-076 — Codex pelo app-server no laço de voz

Status: aceito, não homologado com o Codex real · Data: 2026-10-04 · Estende a ADR-072 (o turno-cérebro da ligação)
ao Codex. Fecha, só para a ligação, o "Não implementado" da
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) ("Codex continua um prompt por turno"). Fase 4 do
[plano do modo ligação](../plano-modo-ligacao.md).

## Contexto

A ligação precisa de um cérebro que responda em pedaços enquanto a pessoa ainda escuta, aceite fala nova no meio e
possa ser interrompido sem morrer. O `codex exec --json`, usado no turno de chat desde 2026-09-18, não serve: não tem
deltas de texto e é um processo por prompt. Até aqui, um bot de Codex era recusado na ligação (`codex_em_breve`).

A pesquisa de 2026-10-04 (Codex CLI rust-v0.160.0, de 01/10/2026; protocolo v2 em
`codex-rs/app-server-protocol`, main de 03/10/2026) achou o `codex app-server`: JSON-RPC 2.0, uma mensagem por linha
no stdio, com `item/agentMessage/delta`, `turn/steer` e `turn/interrupt`. **A OpenAI o marca como experimental**: o
help diz "[experimental] Run the app server or related tooling" e a doc diz que o app-server "is experimental and
isn't supported for production workloads". `turn/steer`, `turn/interrupt` e `item/agentMessage/delta` não têm o
atributo `#[experimental]` no código; `dynamicTools` tem, e por isso não é usado.

**O Codex não estava instalado na máquina onde isto foi escrito.** Nada aqui foi visto contra o binário real.

## Decisão

**O turno-cérebro de uma ligação com bot de Codex sobe um `codex app-server` aberto a ligação inteira**
(`src/adapters/executor/drivers/codex-ligacao.ts`, chamado por `codex-cli.ts` quando `modoTurno === "ligacao"`). O
protocolo fica num parser puro (`src/domain/codex-app-server.ts`).

- **Subir:** `codex -c mcp_servers=<proxy nod> -c approval_policy="never" -c sandbox_mode="read-only" -c <isolamento>
  app-server`. As chaves `-c` de isolamento são as mesmas do `codex exec` (`OVERRIDES_ISOLAMENTO_CODEX`), agora num
  módulo comum (`codex-comum.ts`) com o filtro de ambiente (sem `OPENAI_*`, `CODEX_API_KEY`, `DATABASE_*`) e o
  launcher 0600 do proxy, que leva o token fora do argv e é apagado ao encerrar. As flags `--ignore-user-config`,
  `--ignore-rules` e `--strict-config` só entram se `codex app-server --help` as listar. O piso de versão é esse help
  responder; sem ele, `executor_indisponivel`.
- **Handshake:** `initialize` → `initialized` → `thread/start` com `ephemeral:true`, `approvalPolicy:"never"`,
  `sandbox:"read-only"`, o modelo de voz (`plano.ligacaoVoz.modelo`, resolvido no servidor por `NOD_MODELO_LIGACAO_CODEX`, ADR-072 emenda de 2026-10-05) e as
  instruções de voz em `developerInstructions` (o mesmo canal do `codex exec`). Prazo de 30 s só para subir; depois,
  nenhum relógio de trabalho (ADR-067).
- **Ida e volta:** cada `vez` vira `turn/start` com esforço `low`; com turno em curso, vira `turn/steer` com
  `expectedTurnId`, e a resposta passa a sair com o número da vez nova. Steer recusado entra na fila e abre o próximo
  turno. `item/agentMessage/delta` vira `fala`, `turn/completed` vira `fala-fim`, item `mcpToolCall` vira `atividade`
  (`mcp__nod__<ferramenta>`, como no Claude). A vez 0 (aquecimento) não é falada.
- **Interromper:** modo duro = `turn/interrupt`; modo suave = nada morre, a vez seguinte leva "você foi interrompido".
- **Pedidos do servidor são sempre negados:** `item/commandExecution/requestApproval` e
  `item/fileChange/requestApproval` com `{decision:"decline"}`, `mcpServer/elicitation/request` com
  `{action:"decline"}`, os do protocolo v1 com `{decision:"denied"}`, e todo o resto (inclusive
  `item/permissions/requestApproval`) com erro JSON-RPC −32000. Sem resposta, o turno trava.
- **Fim:** interrompe o turno em curso, pede o mesmo resumo do Claude (`PEDIDO_DE_RESUMO`) e, quando esse turno conclui,
  fecha o stdin (SIGTERM depois de 2 s se não sair). O resumo é a fala da entrega; `sessaoCli` é null.
- **Ligar por padrão:** `compor.ts` deixa de recusar bot com Codex. `NOD_LIGACAO_CODEX=0` desliga (a recusa diz
  "está desligada neste servidor").

## Alternativas descartadas

- **`codex exec` por fala** (plano B do plano). Sem deltas: a pessoa só ouviria depois da resposta inteira, mais um
  processo novo a cada fala.
- **`dynamicTools` em vez do proxy MCP.** É `#[experimental]` e exige `capabilities.experimentalApi`; o proxy já existe
  e é o mesmo do turno de chat.
- **Voz nativa do Codex (`thread/realtime/*`).** Toda experimental, na nuvem e sem pt-BR documentado.
- **`baseInstructions` com o prompt de voz.** Trocaria o prompt inteiro do Codex por um curto, como o `--system-prompt`
  do Claude, e talvez ganhe latência. Fica para medir: o canal provado é o `developer_instructions`.

## Custo aceito

- **Depende de uma API experimental.** Uma versão nova do Codex pode mudar nomes de métodos ou campos e a ligação com
  bot de Codex parar. O parser ignora o que não conhece em vez de lançar; o sintoma seria silêncio, não erro.
- **Esforço fixo em `low`.** Se o Luna aceitar `minimal` ou `none`, há latência sobrando.
- **Sem custo em dólar** (`custoUsd: null`), como no `codex exec`.

## Validação

Só contra o app-server falso (`tests/fixtures/codex-falso.mjs`, subcomando `app-server`):

- `tests/unit/domain/codex-app-server.test.ts`: as mensagens montadas (initialize, initialized, thread/start,
  turn/start, turn/steer, turn/interrupt), a recusa por método e a leitura de resposta, erro, delta, item de ferramenta,
  mensagem completa, turno concluído/interrompido/falhou, pedido do servidor, uso de tokens e linha inválida.
- `tests/integration/executor/codex-ligacao-falso.test.ts`, com um WebSocket local no papel do canal do cérebro:
  - `vez` vira `fala` e `fala-fim`, a vez 0 não é falada, a ferramenta vira `atividade`;
  - o pedido de aprovação do app-server é negado com `decline`;
  - `fim` entrega o resumo como texto do `ResultadoTurno`;
  - thread efêmera com o modelo do env, esforço `low`, token só no launcher 0600, nada de `OPENAI_*` no ambiente;
  - fala no meio do turno vai por `turn/steer` e sai com o número da vez nova;
  - `interromper` duro e `fim` no meio de um turno mandam `turn/interrupt`;
  - Parar encerra o app-server e sai interrompido.
- `tests/integration/executor/codex-cli-falso.test.ts` continua verde: o `codex exec` não mudou.

## A confirmar com o Codex real

- **Nomes exatos dos campos**: `thread/start` (`ephemeral`, `developerInstructions`, `approvalPolicy`, `sandbox`),
  as respostas `{thread:{id}}` e `{turn:{id}}`, `turn/steer` → `{turnId}`, o `status` de `turn/completed`, o item
  `mcpToolCall` (`server`, `tool`), `thread/tokenUsage/updated` e se o servidor aceita o campo `jsonrpc` (a doc diz que
  ele é omitido nas mensagens do app-server).
- **O formato da recusa** de `item/permissions/requestApproval` (hoje erro JSON-RPC) e se o Codex pede elicitação para
  chamar ferramenta do proxy nod com `approval_policy="never"`. Se pedir, negar sempre bloqueia as ferramentas na
  ligação.
- **`-c` antes do subcomando** chega ao app-server, e quais flags de isolamento o `app-server --help` lista.
- **Esforço do Luna**: o menor que `model/list` (`supportedReasoningEfforts`) lista; trocar o `low` fixo por ele numa
  sonda (`scripts/sonda-codex-app-server.ts`, do plano) e atualizar o catálogo de `src/contracts/harness.ts`.
- **Latência**: conteúdo p50 ≤3,0 s e p95 ≤4,5 s (saída da fase 4), e se o app-server sai sozinho com o stdin fechado.
- **ToS**: os Termos da OpenAI devolveram 403 na pesquisa; o uso da assinatura por app de terceiro se apoia em
  declaração pública (Romain Huet, 30/03/2026), não nos termos.

## Gatilho de reversão

- O app-server some, muda de protocolo a cada versão ou reprova a latência medida: voltar a recusar bot de Codex na
  ligação (`NOD_LIGACAO_CODEX=0` como padrão) e levar ao Marlon o plano B (`codex exec` por fala).
- A OpenAI vetar o uso da assinatura por app de terceiro: desligar e recusar com o motivo.

## Não implementado

- `model/list` para escolher o esforço sozinho (a sonda só confere) e `account/rateLimits/*` para mostrar a cota.
- Os 10 minutos manuais da saída da fase 4 (a sonda existe desde a NOD-167; falta rodar com o Codex real).
- Codex com sessão viva no turno de chat: continua `codex exec`, um prompt por turno.

## Emenda de 2026-10-05 (NOD-167): pendente de homologação

**Status: pendente de homologação.** Nada aqui foi medido contra o Codex real, que não está instalado na máquina de
desenvolvimento. O roteiro de homologação do Marlon está em `docs/uat-modo-ligacao.md`, na seção "Homologar a ligação
com Codex".

- **Desligado em produção**: `NOD_LIGACAO_CODEX=0` no `infra/gcp/config.env`, repassado pelo `deploy.sh` com padrão `0`.
  Liga com `1` depois da homologação.
- **Recusa própria**: o Codex instalado sem o subcomando `app-server` não entra mais na ligação para falhar no meio. O
  Mac anuncia `semLacoDeVoz` (o `codex app-server --help` falhou), e o servidor recusa com o motivo
  `codex_sem_app_server` e um texto em pt-BR. O turno de ligação que chegar mesmo assim cai com a causa
  `codex_sem_app_server`.
- **Modelo da voz num lugar só**: `MODELO_LUNA_CODEX = "gpt-5.6-luna"` em `src/contracts/harness.ts`. O id é suposto
  (família do `gpt-5.6-sol`, já medido) e precisa ser confirmado pelo `model/list` da sonda.
- **Vez sem resposta**: se nada chega (nem delta, nem ferramenta) em `TEMPOS_ESPERA.vezSemRespostaMs` (20 s), o
  orquestrador fala um aviso ("A IA não me respondeu. Pode repetir, por favor?"), fecha a vez como `sem_resposta` e
  manda o interromper duro, que no laço do Codex vira `turn/interrupt`. Vale para qualquer IA. Se o `turn/start` ainda
  não respondeu, o laço guarda o interrupt e manda assim que o turno abre.
- **Sonda**: `scripts/sonda-codex-app-server.ts` mede o handshake, o `model/list`, o tempo até o 1º delta, a aprovação
  negada, a ferramenta `mcp__nod__lembrar`, o `turn/steer` e o `turn/interrupt`. O `--seco` roda contra o app-server
  falso e está no CI. As notificações que o laço não conhece passam a ser logadas pelo nome
  (`codex_ligacao_notificacao_ignorada`, uma vez cada).
- **Se a sonda reprovar**: o critério 6, opção (b), vale: "ChatGPT sem voz na Release 1", e este ADR volta ao gatilho de
  reversão.

> Nota (2026-10-06, NOD-179): a cota do Claude Code passou a ser gravada a cada turno (emenda à ADR-036, tabela
> `uso_do_plano`), só para mostrar. O `account/rateLimits/*` do app-server é o caminho para o Codex entrar na mesma
> tabela (harness `codex-cli`) quando o Codex de chat passar pelo app-server; até lá a linha do Codex não existe.

