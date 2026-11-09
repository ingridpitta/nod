# ADR-077 — Onboarding por ligação

Status: aceito, não homologado com voz e IA reais · Data: 2026-10-04 · Fase 5 do
[plano do modo ligação](../plano-modo-ligacao.md) (protótipo "Proposta 2", aprovado em 2026-10-03). Usa a ligação da
ADR-072, a aprovação por voz da ADR-074 e o consentimento da ADR-075.

## Contexto

A pessoa nova abria o nod numa tela vazia ("Novo bot") e tinha de descobrir sozinha bot, app e rotina. O protótipo
aprovado troca isso por uma ligação: "olá", a IA do Mac (só se nenhuma estiver logada), a primeira bot liga, uma
entrevista curta em tela cheia e, com a ligação encolhida na pílula, a bot guia monta o primeiro bot, o app dele e uma
rotina dele.

## Decisão

- **Estado em `preferencias` (0049, só adição).** `onboarding_etapa` (`ola`, `executor`, `chamando`, `entrevista`,
  `configurando`, `concluido`), a guia (`onboarding_guia_id`), o bot novo (`onboarding_bot_id`), a conclusão e o que a
  pessoa contou (`apelido` ≤60, `como_conheceu` ≤200, `objetivo` ≤500, `tamanho_time` em 4 faixas). Backfill entre
  NO FORCE/FORCE (regra da 0005): quem já tem bot confirmado ou chave de máquina é marcado concluído. O passo da
  configuração (bot → app → rotina → fim) é calculado do banco a cada `GET onboarding`, nunca guardado. Mostrar o
  onboarding = não concluiu e (está no meio ou não tem bot confirmado): quem chegou com bots depois da migração (seed)
  não o vê sem pedir.
- **Rotas** `GET /onboarding`, `POST /onboarding/etapa`, `POST /onboarding/concluir`, mais os atalhos do caminho sem
  voz `POST /onboarding/bot` e `POST /onboarding/rotina`. Entrar em `chamando` garante a guia (a salva, senão uma nova
  pelo `criar-agente`, com nome livre: "Nina", "Nina 2"…; voz feminina, mascote azul) e cria a ligação com
  `iniciadaPor:"produto"`, tocando. **O "Atender" é o consentimento**: a ligação do produto nasce sem ele, o
  orquestrador recusa a mídia (4403) até `liberar`, e `etapa:"entrevista"` só passa com o consentimento gravado. Sem o
  Atender em 2 min, a ligação vira não atendida. "Configurar sem voz" encerra a ligação como recusada.
- **Ferramentas do laço de voz só no onboarding** (`anotar_entrevista`, `concluir_entrevista`, `propor_bot`): entram no
  catálogo `ligacao` só quando a ligação é do produto, da guia, com o onboarding numa etapa da ligação
  (`montarPlano({onboarding})`), e cada caso de uso confere o mesmo contexto. O apelido vira o `pessoaNome` de todos os
  prompts; o objetivo vira memória da guia; origem e tamanho viram log sem texto.
- **O orquestrador conduz; o modelo extrai.** A primeira fala é roteiro (sem esperar o cérebro). O prompt de voz da
  primeira ligação lista as quatro perguntas, o resumo "Certo?" e os três passos, depois do marcador dinâmico (muda a
  cada campo). Quando uma ferramenta do onboarding termina no cérebro, o orquestrador relê o estado e manda à mídia
  `{t:"onboarding", etapa, campos}` (o painel "O que você contou"; `configurando` encolhe para a pílula) e
  `{t:"sugestoes", itens}` (os chips "Diga algo como", textos fixos do protótipo, por etapa e passo).
- **O primeiro bot é uma proposta** (`kind_proposta`/`tipo_decisao` `bot`, 0050 só de enum): o card "Novo bot ·
  preenchido com o que você contou" se confirma por clique (com nome e descrição editados) ou por voz ("pode criar",
  perfil `proposta`). Confirmado, ele vira o `onboarding_bot_id`.
- **`para_bot`** em `pedir_acesso` e `criar_rotina`: vale só para o `onboarding_bot_id`, no turno da ligação de
  onboarding. O card nasce na conversa do bot novo, com o agente dele e sem turno (a retomada do acesso é do turno de
  quem pediu, noutra conversa). A ligação acompanha também essas decisões (`leituraDaDecisao({soDoBotDoOnboarding})`).
- **Quatro modelos de bot no domínio** (`src/domain/roteiro-onboarding.ts`): clientes (Gmail), time (ClickUp), dia
  (Google Agenda) e código (GitHub), cada um com nome, descrição, mascote, app, o que pode e não pode e três rotinas.
  O objetivo dito escolhe o modelo por palavras-chave; nada casa = clientes, que também é o do caminho sem voz.
- **Desktop:** sem IA pronta, o app abre a janela mesmo assim (a web mostra os cards de IA) e sonda a cada 3 s até uma
  ficar pronta, então sobe o laço e reanuncia. "Entrar" roda `claude auth login`/`codex login` (o nod nunca vê token);
  "Instalar" abre a página oficial.
- `NOD_ONBOARDING_VOZ=1` abre a ligação de onboarding mesmo com `NOD_LIGACAO=admins`.

## Alternativas descartadas

- **Formulário de configuração sem ligação.** É o caminho "sem voz", não o principal: o protótipo aprovado é a ligação.
- **A web decidir a etapa.** A etapa liga a guia, a ligação e o consentimento; o cliente só pede.
- **O modelo conduzir a entrevista sozinho.** Ele esquecia perguntas e repetia; o roteiro é do servidor, o modelo só
  anota.
- **Card único com bot, app e rotina** (ADR-050). Três cards seguem o protótipo e cada um se decide por voz.

## Custo aceito

- O objetivo por palavras-chave erra frases fora do vocabulário; a pessoa corrige no card antes de criar.
- O backfill marca concluído quem tinha só uma chave de máquina (sem bot): perde o onboarding, pode pedir de novo.
- A rotina "15 min antes de cada reunião" do protótipo virou "Dias úteis, 8:00": o cron não expressa "antes do evento".

## Validação

- `tests/concurrency/onboarding-catcher.test.ts` (catcher + voz falsa): GET → chamando (ligação do produto) → mídia
  recusada sem o Atender → consentimento → entrevista → os quatro `anotar_entrevista` → `concluir_entrevista` →
  `propor_bot` aprovado por voz → bot criado → `pedir_acesso` e `criar_rotina` com `para_bot` (rotina aprovada por voz)
  → concluir.
- `tests/integration/onboarding.test.ts`: backfill da 0049, CHECKs e as rotas (sem voz, com voz, pessoa com bot).
- `tests/unit/domain/roteiro-onboarding.test.ts`, `tests/unit/voz/orquestrador-onboarding.test.ts`,
  `tests/unit/web/onboarding.test.ts`, `tests/unit/desktop/ia-mac.test.ts`.

## Gatilho de reversão

- Pessoas novas internas não terminam por voz em ≤10 min (saída da fase 5) ou abandonam na ligação: o caminho sem voz
  vira o padrão e a ligação passa a ser opção.

## Não implementado

- Modo de turno `onboarding` no texto (só a ligação tem as ferramentas).
- "Atualizar" (`claude update`) e o instalador do Codex com SHA-256 fixado nos cards de IA.
- O card ChatGPT seguir para o caminho sem voz com "voz com ChatGPT em breve" (o Codex já liga, ADR-076).

## Emenda 2026-10-04 — a guia roda no modelo mais potente

A guia (a Nina) com o modelo no "auto" roda no modelo mais potente do harness, no chat e na ligação
(`MODELO_MAIS_POTENTE` em `src/contracts/modelos.ts`). No Claude é o alias `fable`, que acompanha o Fable mais novo
(no Claude Code 2.1.289, `claude-fable-5-1`); no Codex é `gpt-6-astra`. Na ligação, isso abre uma exceção ao modelo
rápido da ADR-072, só para a guia. Medido no mesmo dia: `--model fable` com `MAX_THINKING_TOKENS=0` respondeu em
1,8 s, como o Haiku. Um modelo escolhido no perfil da guia vale como em qualquer bot. Custo aceito: cada vez da
ligação custa no preço do Fable e pode esbarrar no limite de uso de Fable da assinatura da pessoa; nesse caso o turno
da guia falha, porque ainda não há modelo reserva (R7 do ROADMAP).

**Revisto em 2026-10-05 (NOD-164, decisão do Marlon):** na ligação a exceção acabou. A guia fala no mesmo modelo de
voz das outras ligações (`modeloDeVoz`, emenda de 2026-10-05 da ADR-072); o mais potente continua só no chat dela.

## Emenda 2026-10-04 — a guia fala antes de anotar, e fala como gente

**O que muda.** O roteiro mandava anotar a resposta e depois perguntar. Agora a guia fala primeiro (uma reação curta e
a próxima pergunta), chama `anotar_entrevista` na mesma resposta e fecha com "ok", que o servidor não fala nem grava.
Na última pergunta ela diz só uma ponte ("Deixa eu juntar tudo.") antes de anotar, e lê o resumo que a ferramenta
devolve. A frase de transição vem antes de `concluir_entrevista`. O servidor segue conduzindo: a ordem das perguntas
está no prompt, e a ferramenta devolve "se você já fez a próxima pergunta, escreva só ok; senão, pergunte: …".

**Por quê.** Medido no UAT (`scripts/uat/onboarding-voz.ts`, voz do Google, `fable`, 5 vezes cada, uma rodada): com a
ordem antiga, o primeiro texto do modelo saía 2,1–3,2 s depois da vez — são duas respostas do modelo antes do primeiro
som, porque a ferramenta em si levou 36–53 ms. Com a ordem nova, 0,7–0,8 s (1,5 s na primeira vez, a frio). O silêncio
do fim da fala até o primeiro som de conteúdo caiu de p50 5,2 s para 4,1 s. O que sobra é a síntese: 1,0–1,9 s entre o
primeiro trecho e o primeiro áudio, com a voz do Google por REST.

**Por que o "ok".** Medido no CLI 2.1.289 (`scripts/sonda-voltas-ligacao.ts`): se o modelo fala, chama a ferramenta e
não escreve mais nada, o CLI injeta "Your previous response had no visible output" e ele repete a fala e a ferramenta.
O "ok" só deixa de ser fala quando a guia já tinha falado antes de `anotar_entrevista` ou `concluir_entrevista`; um
"Ok." depois de outra ferramenta é falado. Se ela repetir depois da ferramenta uma frase que já disse antes dela, a
repetição não é falada.

**Fala oral.** O prompt de voz de todo bot passa a pedir o jeito falado: reação curta primeiro, "tá", "pra", "tô",
perguntas de até ~12 palavras com no máximo duas opções, sem dois-pontos nem parênteses. Os textos fixos do roteiro
perderam os dois-pontos ("Antes de tudo: como…" virou "Como…"; "Última: quantas…" virou "Última pergunta,
quantas…"; "Então: você é…" virou "Então, você é…").

**Saudação adiantada.** A primeira fala é sintetizada no registro da ligação (enquanto ela toca), não no atender.

**Gatilho de reversão.** Se a guia passar a repetir perguntas, pular a anotação de campos ou falar o "ok" em ligações
reais, volta a ordem antiga (anotar e depois perguntar) e o ganho fica só com a voz em streaming.

## Emenda 2026-10-23 — "atualizando" não é falta de IA (NOD-9)

Enquanto o app atualiza o CLI, o inventário sai `ausente` com a causa `atualizando`. O onboarding mostra "procurando",
e o aviso da ligação diz "Atualizando o Claude Code deste Mac. A ligação percebe quando ficar pronto." — nunca
"Instalar" nem "não está neste Mac".
