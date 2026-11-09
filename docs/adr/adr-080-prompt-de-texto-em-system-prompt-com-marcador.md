# ADR-080 — Prompt de texto em `--system-prompt` com o marcador de cache

Status: aceito, medido no CLI 2.1.290 · Data: 2026-10-06 · NOD-183 · Estende a NOD-155 (o prompt em parte estável e
volátil, #163) e reaproveita o marcador do prompt de voz ([ADR-072](adr-072-o-laco-de-voz.md)).

## Contexto

A NOD-155 separou o prompt de sistema do turno de texto em duas partes: a estável (agente, modo, catálogo, colegas,
rotinas) e a volátil, no fim (quem pediu, profundidade, computador, terminal, memória, pendências, contexto). Mas o
driver do claude-cli continuou passando o prompt por `--append-system-prompt`, que o CLI acrescenta ao prompt padrão do
Claude Code. Medido abaixo: no 2º turno com outro remetente, só cerca de 1,4 mil tokens vinham do cache, ou seja, o
prefixo cacheável acabava antes da parte estável do nod.

A sonda `scripts/sonda-system-prompt-texto.ts` monta o prompt real de delegação (`partesDoPromptSistema`, 7 colegas, um
conector com 20 ferramentas, memória e contexto), troca só a forma de entregar o prompt e mede, em sessões novas, o
2º turno com a parte volátil diferente (Cecília → Chico). Rodada em 2026-10-06, CLI 2.1.290, modelo sonnet:

| Forma | Prompt padrão | cachePct 2º turno | Lido / escrito | Custo 2º turno |
|---|---|---|---|---|
| `--append-system-prompt` sem marcador (até aqui) | mantido | 16% | 1384 / 7532 | US$ 0,0305 |
| `--append-system-prompt` com marcador | mantido | 15% | 1384 / 7568 | US$ 0,0306 |
| append + `--exclude-dynamic-system-prompt-sections` (com ou sem marcador) | mantido | 16% | 1384 / ~7350 | US$ 0,0297 |
| `--system-prompt` (estável) + `--append-system-prompt` (volátil) | substituído | 13% | 883 / 5894 | US$ 0,0238 |
| **`--system-prompt` com estável, marcador e volátil** | substituído | **75%** | **5070 / 1692** | **US$ 0,0078** |

O append ignora o marcador `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`; só o `--system-prompt` o respeita, e só substituindo
o prompt padrão (cerca de 2,1 mil tokens). Nenhuma forma mantém o prompt padrão e cacheia.

Por isso a sonda mediu também o comportamento sem o prompt padrão, em quatro turnos, duas rodadas em cada forma:
ToolSearch achando e chamando uma ferramenta MCP, Read → Edit num arquivo de uma pasta de projeto autorizada, Bash
sob o hook do nod (o hook viu a chamada e o arquivo saiu certo) e resposta só em texto. As quatro passaram 2/2 nas
duas formas. Na revisão (Eng 2, 2026-10-06, mesmo CLI e modelo) a fase de comportamento foi repetida: as quatro de
novo OK nas duas formas; o turno só de texto leu 15% do cache no append (US$ 0,0311) e 80% no `--system-prompt`
(US$ 0,0071).

## Decisão

- **Contrato aditivo.** `PlanoTurno` ganha `promptSistemaPartes?: { estavel: string; volatil: string }`. O
  `promptSistema` continua igual: as duas partes juntadas com `"\n"`, sem marcador. Quem não conhece o campo (Codex,
  Raio-X, app antigo) segue lendo só o `promptSistema`. O plano da ligação não leva as partes (o prompt de voz tem o
  próprio marcador).
- **Driver do claude-cli.** Com as partes e a flag liberada, manda
  `--system-prompt "<estável>\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n<volátil>"` e não manda `--append-system-prompt`.
  Sem a flag, sem as partes ou com o marcador dentro de alguma parte (um texto colado numa memória partiria o prompt
  no lugar errado), volta ao `--append-system-prompt` de antes.
  Desde a NOD-188 (emenda abaixo), a volátil sai do `--system-prompt` e vai na mensagem do turno.
- **Gate da flag.** `--system-prompt` entra em `FLAG_FLOORS` com piso 2.1.290 (a versão sondada) e fica fora de
  `FLAGS_DO_TURNO`, como `--effort` e `--autocompact`. O driver só a usa quando o `--help` lido no turno a traz **e** a
  versão é ≥ 2.1.290. Hoje o `PISO_CLI` do Claude também é 2.1.290 (NOD-171), então na prática o gate é o help.
- **Aviso sem terminal.** Quando o plano pede o terminal e a máquina não tem o hook, o `AVISO_SEM_TERMINAL` vai no fim
  do `promptSistema` (como antes) e no fim da parte volátil, depois do marcador, para não quebrar o prefixo. Desde a NOD-188,
  vai com a volátil na mensagem do turno.
- O marcador saiu de `prompt-ligacao.ts` para `src/domain/marcador-prompt.ts`, que os dois prompts usam.

## Alternativas descartadas

- **Manter o append e só pôr o marcador.** Medido: 15%, o marcador é ignorado.
- **`--exclude-dynamic-system-prompt-sections`.** Só vale com o prompt padrão; medido: 16%.
- **`--system-prompt` com a estável e append com a volátil.** Medido: 13%; o texto do append não fica depois de um
  prefixo estável.
- **Copiar o prompt padrão do Claude Code para dentro do nosso.** Ele muda a cada versão do CLI e é dele; os quatro
  comportamentos que importam ao nod passaram sem ele.

## Consequências

- Turno de texto no claude-cli ≥ 2.1.290: o 2º turno com outro remetente lê ~75% do contexto do cache em vez de ~16%
  e custa cerca de 1/4 na medição. A medição é de sessões novas. No `--resume`, desde a NOD-185 (emenda abaixo), o
  snapshot desligado faz o 2º e o 3º turno lerem 71–72% do cache com a parte volátil nova; antes, liam 76–78%, mas do
  prompt gravado no 1º turno.
- O bot deixa de receber o prompt padrão do Claude Code (orientações gerais de uso de ferramentas, de segurança no git
  como não forçar push nem commitar sem pedido, de estilo). O cwd e a data continuam chegando: o CLI 2.1.290 os manda
  como contexto do usuário, fora do prompt de sistema (conferido na revisão com `claude -p --system-prompt` numa pasta
  vazia: o modelo disse a pasta e a data certas). O nod já informa a pasta do bot e as ferramentas; os quatro
  comportamentos da sonda ficaram iguais. As regras de git do prompt padrão não foram medidas: ficam para o QA.
- O Codex não muda: segue lendo o `promptSistema` inteiro.
- Registrado na NOD-183 e resolvido na NOD-185 (emenda abaixo): o `--system-prompt-snapshot`, ligado por padrão,
  reenvia no `--resume` o prompt gravado no 1º turno, e a parte volátil dos turnos seguintes da mesma sessão não
  chegava ao modelo. Já acontecia com o append.

## Emenda — NOD-185: `--system-prompt-snapshot off` (2026-10-06)

No CLI 2.1.290 o snapshot vem ligado: o 1º request da conversa grava o prompt de sistema e todo `--resume` seguinte o
reenvia como está, mesmo que o launch passe outro texto. A sonda (fases `snapshot`, `snapshotVolatil` e
`snapshotHistorico` de `scripts/sonda-system-prompt-texto.ts`, sonnet) repetiu a sessão "laranja → azul → verde" com o
mesmo bot, mudando só a parte volátil:

| 1º turno → seguintes | 2º turno | cachePct 2º | 3º turno | cachePct 3º |
|---|---|---|---|---|
| on → on (até aqui) | "laranja" | 78% | "laranja" | 76% |
| **off → off** | **"azul"** | **72%** | **"verde"** | **71%** |
| on → off (sessão gravada antes do app novo) | "azul" | 72% | "verde" | 71% |

Em sessões novas, o 2º turno com outro remetente cacheia igual com e sem a flag (75% e 75%). Com um 1º turno de ~15 mil
tokens, o histórico não cacheava no `--resume` nem com `on` (16% contra 15%, US$ 0,2506 contra 0,2522 no 2º turno):
desligar o snapshot não encarece a conversa longa.

Decisão: `--system-prompt-snapshot off` em todo turno do claude-cli (no 1º também, para não gravar), com piso 2.1.290
em `FLAG_FLOORS` e fora de `FLAGS_DO_TURNO`. O gate é o mesmo do `--system-prompt`: a flag no `--help` lido no turno e
a versão ≥ piso; sem isso, os args saem como antes. Independe da forma do prompt (vale também no append). A ligação não
muda: é sessão efêmera, sem `--resume`.

Gatilho de revisão: o cache do 2º turno cair abaixo de ~70% com `off` numa versão nova do CLI, ou o histórico passar a
cachear no `--resume` com `on` (aí o `off` passaria a custar a reescrita do histórico a cada turno).

## Emenda — NOD-188: volátil na mensagem do turno e cwd estável por bot (2026-10-06)

Com um histórico de ~15 mil tokens, o 2º turno no `--resume` lia só 15–16% do cache (US$ 0,25 por turno), com e sem
snapshot. A fase `snapshotHistorico` da sonda (sonnet, CLI 2.1.292, 11 variantes, 3 turnos "laranja → azul → verde"
com o mesmo bot; brutos da NOD-188) separou três causas:

| Variante | 2º turno | 3º turno | Respostas |
|---|---|---|---|
| controle on (volátil no sistema) | 16% | 16% | "laranja" (prompt velho) |
| controle off | 15% | 15% | azul / verde |
| volátil fixa, off | 99% ¹ | 99% | — |
| volátil na mensagem, off | 15% | 15% | azul / verde |
| estável + marcador no sistema, volátil na mensagem, off | 15% | 14% | azul / verde |
| controle off, cwd fixo | 15% | 15% | azul / verde |
| **estável + marcador, volátil na mensagem, off, cwd fixo** | **14%** | **99%** | **azul / verde** |

¹ Nessa variante o 1º turno chamou ferramentas (3 requests); ver a causa 3.

1. **A volátil no prompt de sistema.** Ela muda a cada turno (remetente, memória) e fica antes do histórico: tudo
   depois dela deixa de casar com o cache. Mudou para a mensagem do turno.
2. **O cwd por turno.** O CLI grava em cada turno do transcrito um anexo `environment` com o cwd, que é reenviado no
   `--resume`. Com um `mkdtemp` por turno (EMENDA 11 da ADR-014), cada turno reescreve o histórico. Só com 1 e 2
   resolvidos o 3º turno vai a 99%.
3. **Peculiaridade do CLI, sem conserto do nosso lado.** O 1º request de uma sessão nova renderiza a 1ª mensagem de um
   jeito diferente do replay no `--resume`. Por isso o 2º turno erra o cache uma vez (~15%) quando o 1º turno foi uma
   resposta só. Quando o 1º turno teve mais de um request (ferramentas), o replay já casa e o 2º turno cacheia. Do 3º
   turno em diante, 99–100%.

Decisão:

- **Driver do claude-cli.** Com as partes e a flag liberada, o `--system-prompt` leva só
  `"<estável>\n__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__\n"`, idêntico entre turnos e remetentes. A volátil vai no início da
  mensagem do turno (stdin), entre `[Contexto deste turno]` e `[Fim do contexto deste turno]`, seguida do texto da
  pessoa (`volatilNaMensagem`). A volátil vazia fica de fora. Na mensagem que começa com "/" (comando da barra como
  `/cost`, skill como `/review 420`, ou um caminho), que o CLI só reconhece no início, a volátil volta ao
  `--system-prompt` desse turno, depois do marcador, como na NOD-183: o turno perde o cache do histórico uma vez, mas
  o modelo não fica sem remetente, memória e regras do modo. Um delimitador do bloco que venha dentro da volátil
  (conversa recente, memória) chega ao modelo com parênteses no lugar dos colchetes, para não fechar o bloco antes da
  hora e fazer o resto parecer fala da pessoa (revisão do Eng 1). No append (gate fechado, sem partes ou marcador dentro de uma parte) nada muda: a volátil segue no
  prompt inteiro. O `AVISO_SEM_TERMINAL` continua no fim da volátil, agora na mensagem.
- **cwd estável por bot (exceção à EMENDA 11 da ADR-014).** Sem pasta do bot nem projeto, o cwd do turno de texto é
  `<cwdBase>/texto-<agenteId>`, como a ligação já faz (`ligacao-<agenteId>`, ADR-071/072). O `mkdtemp` por turno
  continua guardando o `mcp.json` 0600 e a config do hook, e é apagado no `finally`. Com pasta do bot ou projeto, o cwd
  já era estável.
- `--system-prompt-snapshot off` (NOD-185) fica: o sistema não muda mais, mas o `off` evita que uma sessão gravada
  antes desta versão reenvie a volátil velha.
- Ligação e Codex não mudam.

Sem regressão nas fases `cache` e `comportamento` (sonnet, CLI 2.1.292), forma nova contra a de antes:

| | `--system-prompt` com a volátil (antes) | volátil na mensagem + `off` (agora) |
|---|---|---|
| 2º turno de sessão nova, outro remetente | 75% | 75% |
| ToolSearch → ferramenta MCP | OK | OK |
| Read → Edit no projeto | OK | OK |
| Bash sob o hook, na pasta do bot | OK | OK |
| Só texto, frase curta | OK | OK |

Consequências: a conversa longa sai de ~15% para 99% do 3º turno em diante (US$ 0,27 contra 0,37 no 3º turno da
medição). O critério de ≥ 60% no 2º turno só é atingido quando o 1º turno teve mais de um request; com um 1º turno de
resposta única, o 2º turno segue em ~15% pela causa 3. O que a volátil diz continua chegando ao modelo (azul e verde
nas respostas), agora como contexto do usuário.

Relato para o Claude Code (causa 3): "With `claude -p --resume <id>`, the first resumed request misses the prompt
cache for the first user turn: the first request of a new session serializes that turn differently from how
`--resume` replays it from the transcript. Repro: turn 1 `claude -p --session-id X --system-prompt S` (single
response, ~15k tokens of context), turn 2 and 3 `claude -p --resume X --system-prompt S` with the same cwd. Turn 2
reads ~15% from cache, turn 3 reads ~99%. If turn 1 makes tool calls, turn 2 already hits the cache. CLI 2.1.292,
sonnet."

Gatilho de revisão: o 3º turno cair abaixo de ~90% no `--resume` numa versão nova do CLI; o CLI passar a cachear o
2º turno (a causa 3 resolvida upstream: refazer a medição e fechar o critério); o modelo tratar o bloco
`[Contexto deste turno]` como fala da pessoa num turno real (QA).

## Gatilho de revisão

- Um comportamento que dependia do prompt padrão quebrar num turno real (ferramenta nativa mal usada, Bash fora do
  hook, ToolSearch não usada, git destrutivo sem pedido): rodar a sonda de novo e, se confirmar, voltar ao append só para o caso afetado.
- Uma versão do CLI passar a respeitar o marcador no `--append-system-prompt`: voltar ao append com marcador e
  recuperar o prompt padrão.
- Mudança no formato do marcador ou na flag em versão nova do CLI: a sonda e o piso precisam ser refeitos.
