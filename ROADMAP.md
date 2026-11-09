# ROADMAP — o que o terminal faz e o nod ainda não

> Criado em 2026-09-28. A pessoa vive descobrindo coisas que faz no Claude Code do terminal e não consegue
> fazer no nod (a última foi usar uma skill, `/review`). Esta lista reúne as lacunas que **valem a pena, mas
> precisam de desenho ou de medição antes do código**. Cada issue é um briefing autocontido para um agente:
> contexto, o que medir primeiro, costuras, escopo, aceite (o teste) e dependências, no mesmo formato de
> [docs/roadmap/jornada-01/issues.md](docs/roadmap/jornada-01/issues.md) (dá para virar task do Linear pelo
> [criar-issue-no-linear.md](docs/roadmap/criar-issue-no-linear.md)).

## Antes de pegar uma issue

**Meça antes de construir.** Tudo aqui foi visto na doc ou no `--help`, mas ninguém mediu o comportamento
em `claude -p`. Duas pesquisas nas docs oficiais erraram fatos sobre o CLI e sobre o nod. Então vale o que a
sonda mede no CLI instalado, não o que a doc promete. Dois jeitos baratos de medir:
- **Só o `init`, custo zero:** sobe o `claude -p`, lê a primeira linha `system/init` do stream-json e mata o
  processo antes da chamada ao modelo. Mostra ferramentas, skills, agentes e plugins carregados.
- **Um turno curto de haiku, centavos:** para ver o stream de uma feature de verdade. Custa centavos.
- Siga o padrão de `scripts/sonda-busca-ferramentas.ts` e `scripts/sonda-nativas.ts`: o script fica em
  `scripts/sonda-<assunto>.ts` e o resultado vai para a ADR.

**Regras que não mudam:**
- **Toda nativa passa pelo hook do nod** (ADR-052/ADR-055). Ferramenta nova entra em `NATIVAS_DO_TERMINAL`
  (`src/domain/nativas.ts`) e ganha um `case` em `decidirNativa`; o default nega (fail-closed). A rota
  `POST /api/interno/nativas` (`src/adapters/http/rotas/interno.ts`) só aceita nativa que esteja no plano do
  turno e grava a trilha (`nativa__<Ferramenta>`).
- **O Bash é sempre decidido pelo servidor**, comando a comando (`src/use-cases/autorizar-comando.ts`).
- **O stream é lido em `src/domain/stream-json.ts`:** evento desconhecido vira `ignorado`, nunca derruba o
  turno. Os argumentos do CLI saem de `montarArgs` (`src/adapters/executor/drivers/claude-cli.ts`). Flag nova
  só entra se `lerFlagsDoHelp` a achar na versão instalada (fail-closed, como `--autocompact`).
- **O cartão de atividade recebe só o nome das ferramentas, por dois caminhos:**
  - servidor: `aoEvento` em `src/adapters/http/compor.ts` publica `turno.atividade`;
  - app do Mac: `aoEvento` em `desktop/main.ts`, com os trechos vivos `TrechoVivo = {texto} | {ferramenta}`
    (`src/contracts/ponte.ts`), validados por `trechos()` em `src/adapters/http/rotas/ponte-validacao.ts`,
    que descarta formato desconhecido.
  - Mostrar mais no cartão é mexer nos dois caminhos e em `web/lib/atividade.ts` + `renderCartaoAtividade`
    (`web/telas/conversa.ts`).
- **Mudança de tela começa no canvas** "Nod — tela do agente" (https://claude.ai/artifact/5G1k3LayQRehZoP4ZmuWyQ),
  numa página nova, e só depois vira código (canvas → código → PR).

**O que já foi medido (Claude Code 2.1.284, 28/09):**
- **Ferramentas embutidas em `-p`** (quando o `--tools` não restringe): Task/Agent, Bash, CronCreate,
  CronDelete, CronList, DesignSync, Edit, EnterWorktree, ExitWorktree, ListAgents, Monitor, NotebookEdit,
  PushNotification, Read, RemoteTrigger, ReportFindings, ScheduleWakeup, SendMessage, Skill, TaskCreate,
  TaskGet, TaskList, TaskStop, TaskUpdate, ToolSearch, WebFetch, WebSearch, Workflow e Write.
  - Glob e Grep existem quando pedidos pelo nome.
  - AskUserQuestion, TodoWrite e ExitPlanMode não aparecem na lista padrão de `-p`.
  - O kit do nod hoje: Read, Edit, Write, Glob, Grep, NotebookEdit, Bash, WebFetch, WebSearch, Skill, Agent e
    ToolSearch.
- **Flags que existem e o nod não usa:** `--effort`, `--fallback-model`, `--max-budget-usd`,
  `--include-hook-events`, `--forward-subagent-text`, `--prompt-suggestions`, `--fork-session`,
  `--json-schema`, `--permission-prompts`, `--agents`, `--plugin-dir`, `--name`.
- **"/" em `-p`:**
  - `/nome args` no começo do prompt roda a skill sem depender do modelo;
  - `/context` e `/cost` respondem sem chamar o modelo;
  - `/compact` e `/clear` funcionam numa sessão retomada; o `/clear` emite `conversation_reset`.
- **Skills e subagentes:** o hook do nod recebe `Skill` e `Agent` e, depois, cada ferramenta que a skill ou o
  subagente usa, com o `agent_id` do subagente (emenda da ADR-055).
- **CLAUDE.md:** o de um repositório que é só `--add-dir` não carrega. Com
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`, carrega.

**Fora deste arquivo:**
- **Já confirmado e barato, é a próxima implementação:** o "/" no chat (canvas, página "Comandos /"), o
  CLAUDE.md do projeto, a lista de tarefas do bot no cartão, o esforço (`--effort`) e o `conversation_reset`.
- **Diferenças deliberadas, que não entram sem uma ADR que as reabra:**
  - MCP do Claude Code da pessoa (`--strict-mcp-config`): o proxy do nod é o ponto de decisão, ADR-013;
  - o `settings.json` inteiro do usuário: `env`, `permissions` e `autoMode` entrariam no turno;
  - Cron e ScheduleWakeup: morrem com o processo, e o nod tem rotinas;
  - SendMessage e Workflow: a colaboração é entre bots do nod;
  - comandos só de terminal: `/doctor`, `/theme`, `/vim`.

**Ordem sugerida:** `R1 → R7 → { R2 → R3 } → R4 → R6 → R8 → R5`. R1 e R7 protegem a pessoa (processo solto e
custo sem teto); R2 e R3 dividem as mesmas costuras do cartão; R5 depende de reconciliar com os workspaces
que já existem.

---

### R1 — [Issue] Medir e decidir: processos em background no fim do turno

- **Contexto/porquê:**
  - No terminal, a pessoa pede "sobe o servidor de dev e testa" e o processo fica rodando. O Bash do Claude
    Code aceita `run_in_background`, e as ferramentas `Monitor` (acompanha a saída) e `TaskStop` (encerra)
    existem em `-p`, mas estão fora do kit do nod.
  - No nod cada turno é um processo `claude -p` que termina. A doc fala em "background tasks at exit", sem
    medição nossa.
  - Hoje o driver interrompe com `filho.kill("SIGTERM")` só no processo do CLI, sem grupo de processos
    (`src/adapters/executor/processo.ts`). Um neto pode sobreviver solto no Mac da pessoa sem ninguém saber,
    ou morrer no meio do que ela pediu. As duas coisas são ruins.
- **Medir primeiro** (haiku, centavos), com `scripts/sonda-background.ts`:
  1. Bash com `run_in_background` rodando `sleep 120`, e o turno termina. O processo continua vivo? Quem é
     o pai? E depois de um `interromper()` (SIGTERM)?
  2. `Monitor` e `TaskStop` numa sessão retomada: o próximo turno enxerga a tarefa em background do turno
     anterior?
  3. Os eventos que o stream emite para tarefas em background (ex.: `task_notification`).
- **Costuras:**
  - `src/adapters/executor/processo.ts` (grupo de processos e limpeza no fim do turno);
  - `src/domain/nativas.ts` (se `Monitor` e `TaskStop` entrarem) e `src/domain/stream-json.ts` (eventos);
  - `src/use-cases/autorizar-comando.ts`: um servidor em background é "só leitura"? Hoje não seria;
  - `docs/adr/adr-055-...` (emenda).
- **Escopo:** a sonda, a decisão escrita e a primeira implementação que ela pedir. Duas saídas plausíveis:
  1. matar o grupo inteiro no fim do turno e dizer isso no prompt;
  2. deixar o processo vivo registrado no servidor, com um jeito de a pessoa ver e parar pela conversa.
- **Fora de escopo:** gerenciar processos fora de turnos do nod.
- **Aceite:**
  - a sonda em `scripts/` com o resultado na ADR;
  - um teste de integração do driver contra o binário falso (`tests/integration/executor/claude-cli-falso.test.ts`)
    provando que nenhum processo do turno sobra sem registro depois de `interromper()` e depois do fim normal.
- **Depende de:** nada.

### R2 — [US] Ver o raciocínio do bot no cartão de atividade

- **Contexto/porquê:**
  - O terminal mostra o que o modelo está pensando (thinking). O stream do `-p` traz blocos `thinking` nas
    linhas `assistant`, deltas `thinking_delta` com `--include-partial-messages` e eventos
    `system/thinking_tokens` (ver `tests/fixtures/stream-json/LEIA-ME.md`).
  - O nod descarta tudo isso: `interpretarLinhaStreamJson` só devolve texto, tool_use e tool_result. Num
    turno longo, a pessoa vê "Trabalhando" e o nome das ferramentas, mas não o porquê.
- **Medir primeiro** (haiku ou sonnet com thinking; centavos):
  - o formato dos blocos `thinking` e dos deltas em 2.1.284;
  - se vêm redigidos (`redacted_thinking`) em algum modelo;
  - quanto texto um turno típico gera.
- **Costuras:**
  - `src/domain/stream-json.ts` (novo evento, ex.: `{ tipo: "pensamento"; texto }`);
  - `src/contracts/turno.ts` (EventoStream);
  - servidor: `src/adapters/http/compor.ts` (`aoEvento` → frame);
  - Mac: `desktop/main.ts` (`aoEvento`) e `TrechoVivo` em `src/contracts/ponte.ts`, com a validação em
    `trechos()` de `src/adapters/http/rotas/ponte-validacao.ts`;
  - web: `web/lib/atividade.ts` e `renderCartaoAtividade` em `web/telas/conversa.ts`.
- **Escopo:** canvas primeiro. Uma proposta a testar: uma linha "Pensando…" recolhida dentro do cartão de
  atividade, que abre o texto; nada entra na mensagem final.
- **Fora de escopo:** guardar o raciocínio no banco. Ele é efêmero, como os deltas.
- **Aceite:**
  - unit do parser com uma fixture real de thinking;
  - unit web do cartão com o bloco recolhido;
  - o teto de caracteres dos trechos vivos continua valendo: 16 mil hoje, e um estouro é descartado sem
    derrubar a renovação.
- **Depende de:** nada; divide as costuras com R3 (fazer junto evita mexer duas vezes no cartão).

### R3 — [US] Ver o andamento dos subagentes

- **Contexto/porquê:**
  - Desde a emenda da ADR-055 o bot lança subagentes (`Agent`). O `/review` do gstack usa vários.
  - O stream marca a chamada de subagente com `parent_tool_use_id`; o nod já lê isso no uso por chamada do
    modo dev (`subagente: true`), mas o cartão só mostra "Agent".
  - O CLI tem `--forward-subagent-text` ("Forward subagent text and thinking", só com stream-json) e
    `--include-hook-events`.
- **Medir primeiro** (haiku, centavos):
  - o que `--forward-subagent-text` acrescenta ao stream;
  - se os `tool_use` do subagente já chegam hoje com `parent_tool_use_id`;
  - o custo em linhas do stream num turno com 2 subagentes.
- **Costuras:** as mesmas de R2, mais `montarArgs` (a flag, fail-closed pelo `--help`) e o parser
  (`parent_tool_use_id` em `tool_use`).
- **Escopo:** canvas primeiro. Cada subagente como uma sub-etapa do cartão, com o tipo (general-purpose,
  Explore) e as ferramentas dele.
- **Fora de escopo:** parar um subagente sozinho. O "Parar" continua parando o turno inteiro.
- **Aceite:**
  - unit do parser com fixture real de subagente;
  - integração do driver com o binário falso emitindo uma chamada de subagente;
  - unit web do cartão.
- **Depende de:** R2 (mesmas costuras), se feitas em sequência.

### R4 — [US] Sugestões da próxima mensagem

- **Contexto/porquê:** o CLI tem `--prompt-suggestions`, que em print/SDK sugere o que a pessoa pode pedir em
  seguida. No chat, isso vira chips acima do campo ("Corrigir os 2 pontos", "Comentar no PR"), menos
  digitação no celular e no fim de um relatório.
- **Medir primeiro** (haiku, centavos):
  - onde as sugestões chegam no stream (tipo e formato);
  - se custam uma chamada a mais ao modelo, e quanto;
  - se vêm em português quando a conversa é em português.
- **Costuras:**
  - `montarArgs`;
  - `src/domain/stream-json.ts` e `ResultadoTurno` (`src/contracts/turno.ts`); a entrega passa por
    `entrega()` em `ponte-validacao.ts`, com tetos, como a execução do modo dev;
  - onde guardar: a última sugestão por conversa basta;
  - web: acima do composer, ao lado dos modos de pergunta (`composer-pergunta`, `web/main.ts`
    `atualizarComposer`).
- **Escopo:** canvas primeiro. Até 3 chips, somem quando a pessoa digita. O clique preenche o campo e não
  envia sozinho.
- **Fora de escopo:** sugestões em rotina e em sala.
- **Aceite:**
  - unit do parser;
  - integração: sugestão entregue → guardada → devolvida na leitura da conversa;
  - unit web: chips aparecem e somem;
  - o custo, se houver, aparece no Raio-X.
- **Depende de:** nada.

### R5 — [Issue] Decidir: trabalho isolado num branch (EnterWorktree) × os workspaces do nod

- **Contexto/porquê:**
  - No terminal, a pessoa pede "faz isso num worktree" e o Claude Code usa `EnterWorktree`/`ExitWorktree`.
  - O nod já tem isolamento Git próprio para as pastas autorizadas: `src/adapters/workspace/preparar.ts`
    (modos `auto`, `direto`, `worktree`) e os testes "auto isola Git e preserva arquivos alterados".
  - Com o kit do terminal, o bot trabalha no Mac inteiro, fora desse isolamento. Duas formas de isolar o
    mesmo trabalho confundem a pessoa ("onde está a minha mudança?").
- **Medir primeiro** (haiku, centavos):
  - onde `EnterWorktree` cria o worktree e com qual nome;
  - se `ExitWorktree` remove ou mantém;
  - como isso aparece no stream;
  - o que acontece na sessão retomada.
- **Costuras:** `src/adapters/workspace/preparar.ts`, `src/domain/nativas.ts`, ADR-039 (pastas), ADR-055, e a
  página "Pasta do projeto" do canvas.
- **Escopo:** a decisão numa ADR: uma forma só de isolar, e qual. Implementar só o que ela pedir.
- **Fora de escopo:** merge ou PR automático. Isso é o `/ship` e as skills.
- **Aceite:** ADR com gatilho de reversão. Se entrar no kit, unit do `decidirNativa` e um teste de
  integração do hook para `EnterWorktree`.
- **Depende de:** nada; é a última da ordem porque mexe numa área com decisão anterior.

### R6 — [US] O aviso do bot vira aviso do nod

- **Contexto/porquê:**
  - O Claude Code tem `PushNotification` (o bot avisa a pessoa quando algo precisa dela ou terminou).
  - O nod tem os próprios avisos: `web/lib/avisador.ts`, `web/lib/canal-avisos.ts` e `desktop/avisos-mac.ts`.
    Hoje eles saem de "Sua vez" e de eventos do servidor, não do bot.
  - Numa tarefa longa em background (R1) ou numa rotina, o bot não tem como chamar a pessoa sem abrir uma
    pergunta.
- **Medir primeiro:** o que `PushNotification` faz em `-p` sem app do Claude conectado (erro? no-op?), e o
  formato do input que o hook recebe.
- **Costuras:**
  - `src/domain/nativas.ts` (`case "PushNotification"`: o hook NEGA a execução nativa e o servidor cria o
    aviso) ou uma ferramenta MCP do nod (`avisar_pessoa`) no catálogo (`src/domain/plano-turno.ts`,
    `src/contracts/ferramentas-nod.ts`);
  - `src/adapters/http/rotas/interno.ts`;
  - `desktop/avisos-mac.ts`.
- **Escopo:** decidir entre interceptar a nativa ou dar uma ferramenta do nod (a do nod é mais simples de
  testar e não depende do CLI). Um aviso por turno, com o texto do bot, que abre a conversa.
- **Fora de escopo:** e-mail e celular.
- **Aceite:**
  - integração: a chamada vira aviso da dona do bot, e só dela (RLS);
  - conformidade: bot não confiável (entrada de fora) não dispara aviso.
- **Depende de:** R1 (o caso de uso mais forte é a tarefa em background).

### R7 — [US] Teto de custo por turno e modelo reserva

- **Contexto/porquê:**
  - Um turno pode gastar muito sem ninguém ver. O custo real por turno existe desde a 0035 (ADR-054), e o
    turno da Clarice que estourou a janela custou US$ 1,02.
  - O CLI tem `--max-budget-usd` (para o turno ao passar do valor) e `--fallback-model` (troca de modelo
    quando o principal está sobrecarregado).
  - Com assinatura, `total_cost_usd` é preço de lista (`costBasis: "list"` no `modelUsage`). O teto é
    "quanto isso custaria", não cobrança; a UI precisa dizer isso.
- **Medir primeiro** (haiku, centavos):
  - o `subtype` do `result` quando o teto estoura (esperado `error_max_budget_usd`);
  - se o teto conta o total da sessão retomada ou só o turno. Isso decide se o nod passa
    `teto + custo anterior` ou só o teto;
  - o que o stream diz quando o fallback troca de modelo.
- **Costuras:**
  - `montarArgs`;
  - `classificarResultado` em `src/domain/stream-json.ts` (o `subtype` novo vira motivo);
  - `MOTIVOS_FALHA` em `src/contracts/motivos.ts` (um motivo novo, ex.: `teto_de_custo`) e o texto em
    `src/domain/redacao.ts`;
  - `politicaExecucao` em `src/domain/plano-turno.ts`;
  - a configuração por bot e por rotina (perfil e rotina; canvas);
  - o Raio-X mostra o teto.
- **Escopo:** canvas primeiro. Um teto padrão por rotina (turno sem ninguém olhando) e opcional por bot.
  Estourou: a mensagem diz quanto foi e oferece continuar.
- **Fora de escopo:** orçamento mensal por pessoa.
- **Aceite:**
  - unit do classificador com fixture do `result` real;
  - integração: turno de rotina com teto → interrompido com o motivo novo e a linha na conversa;
  - conformidade: o motivo novo está no enum do banco.
- **Depende de:** nada.

### R8 — [US] Planejar antes de executar

- **Contexto/porquê:**
  - No terminal, o plan mode faz o modelo investigar sem mudar nada e apresentar um plano; a pessoa aprova, e
    só então ele executa.
  - Para tarefas grandes num bot (implementar uma feature, reorganizar uma planilha), é o que evita dez
    cards de aprovação no meio.
  - A doc indica plan mode em headless a partir da 2.1.246 e cita `--permission-prompt-tool`; não medimos.
  - `ExitPlanMode` não aparece na lista padrão de ferramentas de `-p`.
- **Medir primeiro** (haiku, centavos):
  - `--permission-mode plan` num turno `-p`: o modelo chama `ExitPlanMode`?;
  - o que chega no stream (o plano em texto? uma negação em `permission_denials`?);
  - como retomar a sessão em `default` depois de aprovado;
  - se `--permission-prompts` muda algo.
- **Costuras:**
  - `montarArgs` (`--permission-mode`);
  - `src/domain/nativas.ts` e o hook (se `ExitPlanMode` passar por ele);
  - o card de pergunta ou decisão que já existe: `pedido_a_pessoa`, `web/telas/pergunta.ts`,
    `src/use-cases/decidir.ts`;
  - a retomada: `src/use-cases/retomar-turno.ts`.
- **Escopo:** canvas primeiro. "Planejar primeiro" como opção do campo (ou `/planejar` no "/"); o plano
  chega como card com Aprovar / Ajustar; aprovar retoma o mesmo turno executando.
- **Fora de escopo:** editar o plano passo a passo no card.
- **Aceite:**
  - a sonda com o resultado na ADR;
  - integração: turno em plano → card → aprovar → retomada em `default` na mesma sessão;
  - unit web do card.
- **Depende de:** o "/" no chat (fora deste arquivo), se `/planejar` for o gatilho.
