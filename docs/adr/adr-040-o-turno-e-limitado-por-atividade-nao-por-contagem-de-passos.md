# ADR-040 — O turno é limitado por atividade, não por contagem de passos

> Revista pela [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) em 2026-10-01: o vigia de atividade
> saiu. O turno segue até o bot terminar, até o Parar ou até o lease vencer, sem relógio de trabalho.

Definido em 2026-09-18, a partir de um teste real. Pedindo para seguir uma implementação, o agente
leu o servidor, entendeu como a pasta da conversa funciona, ia examinar um helper — e o turno morreu:

> Turno interrompido: erro_max_turns. O que já saiu fica marcado como parcial; nada foi reenviado.

`MAX_TURNOS_CLI = 12` nasceu em 2026-09-16 (commit `633485e`), com o comentário *"cabe lembrar →
pedir_aprovacao → resposta, com folga"* — quando o Nod só tinha as nove ferramentas de conversa,
antes de computadores, pastas e programação. Uma tarefa de código gasta isso só para entender o
repositório: Glob, quatro Reads, Edit, Read de conferência. **A premissa mudou; a constante não.**

## Decisão

1. **Sem teto de passos.** `--max-turns` sai do turno. Não condicionar a haver projeto autorizado:
   conversa também chama conectores e `computador_*`, e o teto condicional seria a mesma armadilha
   com outro número, dependendo de um estado que a pessoa não vê.
2. **O que limita é atividade.** O watchdog em `laco.ts` observa os eventos do agente — o mesmo
   ponto nos dois drivers — e encerra o turno que fica 5 minutos mudo, pelo caminho que
   `{ativo:false}` já usava (`adapterAtual.interromper()`).
3. **Ferramenta em andamento é silêncio legítimo.** `tool_use` sem `tool_result` isenta o turno:
   `computador_*` leva até 240s e o proxy serializa as chamadas. A isenção tem teto
   (`ISENCAO_FERRAMENTA_MS`, 480s) para um `tool_result` perdido não isentar para sempre.
4. **`--autocompact auto`** para a tarefa longa compactar o contexto em vez de estourá-lo (era `200000` até 2026-11-09; ver emenda).
5. **Dois motivos novos**, porque `sem_progresso` mentia: `turno_travado` (ficou mudo) e
   `trabalho_incompleto` (produziu e não concluiu — o caso do incidente).

## As duas referências, lidas nos clones em 2026-09-18

**OpenMausBot** (`~/code/OpenMausBot`) — **nunca passa `--max-turns`**; verificado por grep no repo
inteiro, zero ocorrências. O comentário de `server/turn-watchdog.ts:8-11` é a declaração de
princípio que esta ADR adota:

> *"This watchdog watches ACTIVITY, not duration: a turn may legitimately run for an hour while
> events keep flowing, but a turn whose thread has emitted nothing at all for `stallMs` is wedged."*

Mais `--autocompact 200000` (`server/drivers/claude.ts:295`), sessão CLI viva por thread retomável
por `--resume`, deadline absoluto só em sala, e o Stop humano como controle primário.

**OpenBot** (`~/code/OpenBot`) — tem `TOOL_STEPS = 8` (`server/src/copilot.ts:379`) com justificativa
quase idêntica à nossa, e **não trata o estouro**: a constante aparece duas vezes no repositório
inteiro, sem erro, sem retomada, sem teste. O run termina com `RUN_FINISHED` normal e a pessoa vê
uma resposta incompleta que parece deliberada. **Não é modelo a copiar** — o nosso `erro_max_turns`
pelo menos falhava alto.

## Por que o lease não servia como watchdog

O lease de 90s é renovado por **timer fixo** (`laco.ts`, `setInterval`). Ele prova que o **processo**
vive, não que o **agente** progride: um CLI travado renovaria para sempre. São dois relógios com
sentidos diferentes, e foram mantidos separados de propósito.

Alternativa rejeitada: parar de renovar o lease quando não há atividade, deixando o varredor matar o
turno. O motivo sairia como `maquina_sem_contato`, que é mentira — a máquina está viva.

## Por que a isenção aqui é mais simples que no openmausbot

Lá o `setWaitingOnHuman` existe porque o turno **fica parado** no card de permissão. No Nod, não: o
long-poll dura uma fatia de 20s (`LONGPOLL_APROVACAO_MS`) e responde ao modelo *"encerre o turno; a
decisão retoma depois"* (`proxy.ts`). O turno acaba e a retomada é um turno novo. A janela de
silêncio a proteger é outra — a chamada de ferramenta — e ela é observável sem inventar estado.

## Fail-closed

`--autocompact` é flag **condicional**: fica fora de `FLAGS_DO_TURNO` (exigi-la ali derrubaria todo
turno num CLI mais antigo, inclusive quem não precisa dela) e o gate é o `--help` lido no turno.
Sem a flag, o turno roda sem ela. `--max-turns` continua em `FLAG_FLOORS` porque `sonda.ts` ainda a
usa com valor 1, onde o teto é exatamente o desejado.

## O risco que esta decisão aceita

**Nenhuma camada pega um agente que erra em círculo emitindo eventos.** Para o watchdog, ele está
trabalhando. Restam o `prazoMs` de 24h e o Stop humano — que a pessoa pode não estar acordada para
apertar.

É uma troca deliberada: o contador cortava trabalho legítimo com muito mais frequência do que pegava
um agente perdido. O openmausbot aceita a mesma lacuna, e a resposta deles é um detector de
repetição que **só observa e conta** (`repeat-detector.ts:1-6`: *"This only OBSERVES — it counts and
says so; the human has Stop"*), deixando a interrupção para a pessoa. Se o laço produtivo vier a
incomodar na prática, é esse o caminho seguinte — não voltar o contador.

## Gatilho de reversão

Se um laço produtivo caro acontecer de fato em produção (não em hipótese), a resposta é o detector
de repetição acima, não restaurar `--max-turns`: o contador já demonstrou cortar trabalho legítimo.

## Emenda de 2026-09-28 — a aprovação continua no mesmo turno

**Contexto.** "O turno acaba e a retomada é um turno novo" valia para toda aprovação que não fosse decidida dentro de uma fatia de 20 s. Numa tarefa no computador do bot, a Ada fez 10 turnos em 3 minutos, e cada retomada reescreveu o resumo. Pior: a aprovação dada dentro da fatia continuava o turno **e** criava uma retomada, em cascata.

**Decisão.**
- **O proxy espera a decisão no próprio turno**, com a ferramenta aberta, em fatias de `LONGPOLL_APROVACAO_MS` até `ESPERA_APROVACAO_NO_TURNO_MS` (420 s). Isso fica abaixo da isenção de ferramenta aberta do vigia (480 s). Aprovada nesse tempo, o mesmo turno segue com o resultado; passado o prazo, ou com o servidor fora, volta o "pendente" e o turno encerra.
- **Uma decisão, uma continuação** (0032, `decisoes.continuada_em` e `continuada_por`):
  - quem entrega a decisão ao turno que espera a reivindica como `turno`;
  - a fase 2 só cria retomada se o turno já não está rodando, sob a trava da linha do turno;
  - o assentamento do turno cria a retomada da aprovação decidida que ele não chegou a receber.
- **Retomadas se juntam:** toda retomada nasce por `enfileirarRetomada`. Se já há uma retomada do mesmo turno na fila, a entrada nova se junta a ela. Vale para acesso, perfil, pasta, resposta a pedido e "Retomar".
- **Limitação conhecida:** a queda da máquina (`interromperPorMaquina`) não passa pela rede de segurança. Ela já abre o card "Retomar" para a pessoa.

## Emenda 2026-11-09: `--autocompact auto`

O teto fixo de 200k valia para modelos de 200k. Com o Opus de 1M (`contextWindow` 1_000_000), ele fazia o CLI compactar cedo; o system prompt e as ferramentas do nod ocupam boa parte desses 200k, o contexto voltava ao teto em até 3 turnos e o CLI parava com "Autocompact is thrashing" (relato da Helena, pico de 132k numa janela de 1 mi). `auto` usa a janela real do modelo: nos modelos de 200k o comportamento é o mesmo de antes. Gatilho de reversão: um CLI em que `auto` mude de significado ou volte a dar thrashing com a janela real.

### Adendo 2026-11-09 (tarde): por que o laço voltou depois do #712

Medido, não suposto (Raio-X de produção, o binário do Claude Code 2.1.309 e um repro local):
- **O limiar.** O CLI compacta quando o contexto passa de `min(W − 20%·W, W − 13k)`, com `W = janela − 20k`; numa janela de 200k isso dá ~144–167k, na de 1M ~967k. O disjuntor dispara na 4ª compactação seguida em que o contexto volta ao limiar em menos de 3 voltas (`rapid_refill_breaker`, `api_error: autocompact_thrashing`).
- **O piso depois do resumo.** O `post_tokens` do `compact_boundary` conta só as mensagens resumidas. O prompt e as ferramentas do nod, em cache (~76k nos turnos do Atlas), mais o resumo e o que o CLI reanexa (~46k), voltam inteiros na chamada seguinte: ~122k. O `pre_tokens` conta tudo (parte fixa, histórico e os resultados que chegaram depois da última chamada). Por isso "247k → 19k" seguido de uma chamada de 122,7k.
- **A janela da Helena seguia em 200k.** Os 17 turnos do Atlas com falha em 09/11 compactaram entre 158k e 253k, antes e depois da rc.7, e chamadas de até 253k passaram: a API servia 1M, mas o autocompact estava em 200k. No motor `309ec3dd`, com o driver novo, a compactação subiu de ~167k para 967.787 (o limiar de 1M). O repro com o 2.1.309 (`--autocompact 100000`, prompt fixo de 65k) dá as mesmas 3 compactações e o disjuntor; o mesmo turno com `auto` ou `1000000` não compacta.
- **Por que o #712 não chegou.** O driver roda dentro do app (Electron). O app procura atualização a cada 4 h e só instala quando a pessoa reinicia; o anúncio da rc.7 saiu às 16:08 UTC e o turno foi às 18:08. A rc.7 só mudou essa linha do driver, então nada nos dados distingue as versões: daqui em diante o servidor grava a versão do app no Raio-X e no log `turno_nao_concluiu`.
- **A frase.** `/nova-sessao` não tira do laço num app anterior à rc.7 (uma sessão nova também volta a ~122k depois do primeiro resumo). Nele a frase manda reiniciar o nod para atualizar (`VERSAO_APP_JANELA_REAL`, erro-fornecedor.ts). Antes da 1.0.0-rc.4 o app não se atualiza sozinho (NOD-132, ADR-149), e reiniciar não muda a versão: ali a frase manda baixar a versão nova em nodbot.ai (`VERSAO_APP_ATUALIZA_SOZINHO`). A versão só entra na frase e no Raio-X validada (`x.y.z` ou `x.y.z-rc.N`), e a do Raio-X é sempre a do anúncio da máquina: a que vier dentro da execução é descartada.
- **O que fica para a NOD-480.** Nos modelos de 200k de verdade o piso de ~122k continua perto do limiar. Só diminuir a parte fixa resolve esse caso.

## Emenda 2026-11-09 (NOD-480): o turno cabe em qualquer janela

**Contexto.** Com `auto`, o Opus de 1M parou de entrar em laço, mas "modelo simples = contexto menor" (Marlon): no Sonnet sem 1M, no Haiku ou em qualquer janela de 200k, o que volta a cada chamada depois de um resumo (~122k: prompt e ferramentas do nod, base do Claude Code, resumo e anexos; medido no #718) fica perto do limiar de compactação do 2.1.309 (`min(W − 20%·W, W − 13k)`, `W = janela − 20k`, ~144k), e uma ou duas saídas de ferramenta enchem o resto. O disjuntor para o turno com `autocompact_thrashing`.

**Decisão.** Três defesas, todas pela janela do modelo do turno (`src/domain/orcamento-contexto.ts`):
1. **Orçamento antes do turno.** A janela vem do último Raio-X do bot com o mesmo modelo (`execucao.janela`), senão da tabela por nome (`[1m]`, Opus, Fable e o `auto` do Claude = 1M; o resto = 200k). A parte fixa estimada (prompt estável, nomes das ferramentas, base do harness ~38k e resumo ~46k) acima de **metade do limiar** deixa o prompt **enxuto**: o catálogo de apps vai sem a lista `outras_do_app` (só a contagem; o bot pede por nível com `pedir_acesso` e `capacidades: []`) e o driver força a busca de ferramentas (`ENABLE_TOOL_SEARCH=true`). A decisão mede só a parte estável: o prompt não muda de turno para turno.
2. **Teto de saída proporcional:** 4% do limiar por saída — resultado das ferramentas do nod e dos apps (`politicaExecucao.orcamentoResultadoChars`, o proxy corta e oferece `ler_mais`), `bashOutputMaxChars` nos settings do kit (a saída maior vira arquivo com um trecho e o caminho) e `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` para o Read. Nunca acima dos tetos de antes.
3. **Recuperação automática.** O turno que termina em `autocompactacao` larga a sessão (conversa, task/frente ou turno da cadeia) e se repete **uma vez** sem `--resume`, com o motivo de recomeço `autocompactacao` (0158): a conversa leva o aviso e o resumo do trabalho (NOD-312), a frente o pedido e a passagem de bastão (NOD-310). As falas que já saíram ficam como parciais e vão no histórico. Só a segunda falha mostra o aviso, que não pede mais `/nova-sessao`.

Em 1M nada muda: o prompt e os tetos são os de antes. O Codex e a ligação ficam fora (sem autocompact do Claude Code). As partes 1 (busca forçada) e 2 (Bash e Read) moram no driver e chegam com a release do app; o catálogo enxuto, o teto do proxy e a recuperação chegam com o deploy do servidor.

**Limitação conhecida.** Até ~230k de janela, a base do Claude Code e o resumo que ele mesmo reanexa (~84k) já passam de metade do limiar: nesses modelos o prompt sempre vai enxuto. Abaixo de ~165k (limiar < ~115k, como o `--autocompact 100000` do repro), a parte fixa encosta no limiar e nenhum corte do nod resolve sozinho; os tetos caem ao piso, a recuperação recomeça uma vez e, se encher de novo, a pessoa lê o aviso.

**Gatilho de reversão.** Um Claude Code que mude a fórmula do limiar, a regra do disjuntor ou o padrão da busca de ferramentas (relido no binário), ou um Raio-X que mostre o prompt enxuto num modelo de 1M: refazer as constantes, não desligar as defesas.
