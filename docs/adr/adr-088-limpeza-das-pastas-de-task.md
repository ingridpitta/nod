# ADR-088 — Limpeza das tasks: a worktree nasce na pasta da task e sai quando a task acaba

Status: aceito · Data: 2026-10-09 · Emenda a [ADR-065](adr-065-o-bot-sabe-o-que-tem-e-cada-task-na-sua-pasta.md) (a
worktree por task) e usa a ponte da [ADR-021](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md).
Parte do épico de performance no Mac do usuário (#221), issue #216. **Emendada pela
[ADR-096](adr-096-o-disco-que-se-cuida.md) (2026-10-11):** a limpeza apaga por padrão, o `aninhado` não tem mais teto
de nível, o cache de ferramenta vale em qualquer nível e o disco apertado dispara uma passada na hora.

## Contexto

Cada task cria uma worktree git com `node_modules` próprio, e nada no nod as removia. Medido no Mac do Marlon em 09/10:

- `~/nod` com 254 GB (era 109 GB em 06/10), num disco de 466 GB que chegou a 97% de uso.
- 261 worktrees. 198 delas ficavam na raiz da pasta do bot (`~/nod/<bot>/<repo>-<algo>`), fora de qualquer
  `trabalhos.pasta`, e só 63 dentro de pastas de task. O nod não sabia de quem eram.
- 181 do nod (~180 MB de node_modules cada), 46 do gamefik (~3,6 GB cada), 22 do lumen (~1 GB cada).
- O bot não limpa sozinho: `rm -r` vira pedido de aprovação.

O caminho já ia para a task desde a ADR-083: na task, o plano leva a pasta dela como `pastaDoBot`, o driver a usa como
diretório e a cerca do git vale para ela. Mas o `worktree add` era livre em qualquer lugar (só o git que mexe era
cercado), e os bots seguiam o hábito da memória deles: em 08/10 e 09/10 ainda nasceram worktrees na raiz
(`Teodora/qa-194`, `Eng 3/nod-200`, `Ze 2/gamefik-gfk-1793`), de tasks de QA que nunca commitam.

## Decisão

**1. A worktree nova nasce dentro da pasta do turno.** O hook (`gitForaDaPastaDoBot`) agora também confere o destino do
`git worktree add`. Na task, a pasta é `~/nod/<bot>/<slug>`, e a worktree fora dela é negada com o caminho certo
(`<pasta>/<repo>`). Sem task, vale a raiz do bot, como antes. O `worktree add` no clone da pessoa continua livre; só
muda onde ela pode nascer.

O driver grava `daTask` na configuração do hook, e o prompt da task diz que o nod apaga a worktree quando a task acaba.
A pasta da task se reconhece pela barra (`ehPastaDeTask`): a pasta do bot nunca tem barra, e a da task é `<bot>/<slug>`.

**2. Quem pode ser limpo é decisão do servidor** (`quandoLimpar`, src/domain/limpeza-das-tasks.ts). O servidor tem o
banco e decide pelas tasks da pessoa encerradas nos últimos 30 dias (`trabalhosRepo.candidatosALimpeza`):

- **nunca:**
  - task aberta;
  - task `parado`: a pessoa parou e pode continuar;
  - task com turno pendente ou rodando, inclusive a volta marcada com `acordar_em` (ADR-086);
  - task com decisão pendente (o "Retomar" é uma decisão);
  - task cuja pasta é dividida com outra task aberta;
  - pasta que não é `~/nod/<bot>/<slug>`.
- **nunca nas primeiras 2 h depois de encerrar:** é a janela da retomada automática da ADR-084 (`RETOMAR_ATE_MS`).
- **`encerrada`:** terminada ou falha há mais de 3 dias. As worktrees limpas saem.
- **`so_com_pr_mergeado`:** encerrada entre 2 h e 3 dias. Só sai a worktree cujo PR o `gh` deste Mac diz que foi
  mergeado. Qualquer dúvida conta como não mergeado: gh fora, sem login ou HEAD solto.

A task reaberta (uma mensagem nova) sai da lista. Quando volta a acabar, `terminado_em` recomeça o relógio.

**3. Quem apaga é o Mac, onde os arquivos estão** (src/adapters/executor/limpeza-das-tasks.ts). A regra é do servidor,
mas o disco é do Mac. Em produção o servidor roda na nuvem e nunca vê `~/nod`. Por isso a limpeza mora no executor,
nos dois modos:

- **modo local (o diário):** o servidor é o executor do Mac. `comporApp` sobe uma limpeza por pessoa ao lado do pool
  de laços, e ela fala com a ponte in-process.
- **modo compartilhado:** o app do Mac sobe a limpeza depois de conectar. Ela **puxa** a lista em
  `POST /api/maquina/limpeza` e relata em `limpeza/resultado`; o servidor nunca disca (ADR-021). Com servidor antigo
  (404), a lista vem vazia e nada acontece.

A primeira passada roda 10 min depois de subir e as seguintes a cada 6 h, sem paralelismo, porque apagar `node_modules`
gasta disco. É **uma passada por Mac de cada vez**: as limpezas do mesmo processo entram numa fila (no diário há uma por
pessoa), e entre processos (o diário, um servidor de teste, o app) vale a trava `~/nod/.limpeza.lock`, com pid e hora.
A trava de um pid morto, ou com mais de 24 h, é retomada. O modo vem de `NOD_LIMPEZA_TASKS` (§7). Para cada pasta
oferecida, o Mac:

1. Confere de novo o caminho: a forma `<bot>/<slug>`, que é uma pasta de verdade (não um link) e que o caminho real
   fica dentro de `~/nod`. Pasta que não existe neste Mac é pulada sem barulho: já foi limpa, ou a task rodou em
   outro Mac.
2. Acha as worktrees dentro da pasta, pelo `.git` arquivo, até 3 níveis. Não entra em `node_modules`, em pasta
   escondida, em link nem na própria worktree. Um clone inteiro (`.git` pasta) não é apagado: ele é contado como
   `clone`.
3. Pula a pasta inteira (`em_uso`) se um turno deste Mac roda nela. No diário a fonte são os planos vivos do processo;
   no app, os turnos que o laço começou e não terminou.
4. Confere cada worktree contra o que o `git worktree remove` sem --force **não** protege (§4). A primeira que falhar
   na conferência fica, com o log `limpeza_worktree_pulada` e o motivo.
5. Logo antes da primeira remoção da pasta, pergunta de novo ao servidor se ele ainda a oferece, e confere de novo se
   não há turno vivo. Se não, a pasta fica (`nao_reconfirmada`).
6. Remove com `git worktree remove` **sem --force**. Se algo mudou desde a conferência, o git ainda recusa a worktree
   suja. A branch fica no clone, então o trabalho commitado não se perde.
7. Apaga com `rmdir` as pastas que ficaram vazias, inclusive a da task (só um `.DS_Store` conta como vazio). O `rmdir`
   nunca apaga conteúdo, nunca entra numa worktree que ficou e nunca apaga uma origem de montagem.

Não há `git worktree prune`: o `remove` já apaga os metadados da worktree que tirou, e o prune varreria também
worktrees de outros donos cuja pasta sumiu (num disco desmontado, por exemplo).

**4. O que o git não protege, conferido antes de remover** (revisão independente do #225, que reproduziu perdas de dado
na primeira versão). O `git worktree remove` sem --force só olha os arquivos rastreados e os novos; ele apaga calado
o que está ignorado, inclusive repositórios e worktrees dentro de pasta ignorada. Por isso a worktree **fica** quando:

- **`montagem`:** contém a origem de um bind mount de algum container, rodando ou parado (`docker ps -aq` e
  `docker inspect`). O `nod-postgres` do diário monta `~/nod/Eng 1/nod-169/infra/postgres/init`. A comparação usa o
  caminho real (realpath) dos dois lados, em NFC e sem caixa, porque o APFS não diferencia maiúsculas e o acento pode
  vir em NFD.
- **`travada`:** o clone marca a worktree como travada (`git worktree lock`).
- **`aninhado`:** o `git worktree list --porcelain` do clone tem outra worktree dentro dela, ou há `.git` (arquivo ou
  pasta) abaixo dela fora de node_modules. O caso real é `.claude/worktrees/agent-1`, ignorada e suja. A busca vai até
  20 mil pastas; se passar disso, a worktree fica. (O teto de 8 níveis saiu na ADR-096: ele tornava `aninhado` toda
  worktree com código fundo.)
- **`suja`:** o `git status` mostra alteração em arquivo rastreado ou arquivo novo.
- **`ignorado_valioso`:** há arquivo ignorado fora do que se refaz sozinho (`.env`, `backups/*.dump`, um banco local,
  `output/relatorio.csv`). A regra é `classificarIgnorado` e vale pelo caminho que o `git status --ignored` mostra:
  - a pasta regenerável conta só pelo **primeiro** nome do caminho: `node_modules`, `dist`, `coverage`, `.vite`,
    `.next`, `.turbo`, `.cache`, `.parcel-cache`, `.pnpm-store`, `__pycache__` e `.pytest_cache`. `build`, `out` e
    `output` não entram, porque são nomes genéricos (segunda revisão do #225);
  - a pasta regenerável que o git mostra inteira (`dist/`) só sai se não houver `.env*` dentro. O Mac confere fora de
    node_modules, até 5 mil pastas; se passar disso, a worktree fica;
  - `.env*` nunca é regenerável, em nível nenhum;
  - três exceções ao "primeiro nome", todas de coisa que nunca é trabalho:
    - a pasta `node_modules` em qualquer nível, porque o monorepo pnpm do gamefik e do lumen tem uma por pacote e sem
      isso nenhuma worktree deles sairia;
    - `.DS_Store` em qualquer nível;
    - `*.tsbuildinfo` em qualquer nível;
  - `*.log` só na raiz.
- **`head_solto`:** `git rev-list -n1 HEAD --not --branches --remotes --tags` não volta vazio. Esse commit só o HEAD
  solto alcança, e se perderia com a worktree.
- **`pr_nao_mergeado`:** no nível `so_com_pr_mergeado`, nenhum PR mergeado da branch tem o `headRefOid` igual ao HEAD
  local. O nome da branch não basta: uma branch reaproveitada depois do merge tem commits novos.

**Docker instalado e mudo adia a passada inteira** (segunda revisão do #225). Se o Docker não responde (o Docker Desktop
trava quando o disco da VM enche), ou se o binário está fora do PATH mas o app `/Applications/Docker.app` ou o socket
existem, não se sabe o que está montado. Nesse caso nenhuma worktree e nenhuma pasta vazia sai, e o log é
`limpeza_adiada`. Sem Docker nenhum no Mac, não há montagens.

A regra é recusar demais em vez de apagar algo. Fora isso, a pasta do caso concreto está na raiz do bot, e a raiz do
bot nunca entra na limpeza.

**5. As worktrees órfãs da raiz do bot não são apagadas.** O nod não sabe de quem elas são. A passada só as conta
(`orfas`, e `orfasParadas` as sem mexer há 2 dias, pelo HEAD e pelo índice no clone). Mostrar o espaço liberável em
Seu espaço › Este Mac, com um botão para limpar, fica para um PR próprio (ver "Não implementado").

**6. Medir.** No Mac, os logs `limpeza_worktree_removida` (com `liberado_mb`) e `limpeza_worktree_pulada` (com o
motivo), com o id da task e só o nome da pasta do repositório. No servidor, o log `limpeza_feita` resume cada passada:
pastas, removidas, pastas apagadas, `liberado_mb`, `pulada_<motivo>`, órfãs e duração. Nenhum caminho vai ao servidor,
porque o slug vem do título da task.

Na simulação (§7), o log do servidor é `limpeza_simulada`, com `estimado_mb` (o `du -sk` das worktrees que sairiam).
No Mac, `limpeza_simulada_worktree` traz o caminho relativo a `~/nod`, porque é ele que se confere antes de ligar.

O liberado é a diferença do espaço livre do volume (`statfs`) antes e depois de cada remoção, e não o `du`. Com os
clones APFS do pnpm (gamefik, lumen), o `du` mostra mais do que apagar libera. A diferença é ruidosa quando outro
processo grava ao mesmo tempo, então soma nunca negativo.

**7. O modo, por `NOD_LIMPEZA_TASKS`** (no diário, no `.env` do servidor; no app, no ambiente do app):

Revisto pela ADR-096 (2026-10-11): o padrão passou a ser `ligada`; `simular` e `desligada` só valem escritos.

- **`simular`:** faz a passada inteira, com todas as conferências e a reconfirmação, e não apaga
  nada. Conta o que sairia: worktrees e pastas, os motivos das que ficam e o tamanho estimado. Qualquer valor que não
  seja `ligada` ou `desligada` também simulava (até a ADR-096).
- **`ligada`:** apaga.
- **`desligada`:** não roda.

O boot registra o modo efetivo (`limpeza_modo`, com `onde`: servidor local ou app do Mac).

**Gatilho para `ligada` virar o padrão:** decisão do Marlon depois de ver os `limpeza_simulada` (servidor) e os
`limpeza_simulada_worktree` (Mac) de pelo menos uma passada no diário, conferindo que nenhuma worktree listada para sair
tem trabalho a guardar. Até lá, o diário liga com `NOD_LIMPEZA_TASKS=ligada` no `.env`, se ele quiser antes. Mudar o
padrão é trocar `modoDaLimpeza` e esta seção no mesmo PR.

## Alternativas descartadas

- **Limpar pelo servidor, direto no disco.** Funcionaria no diário, onde tudo está no mesmo Mac, e quebraria em produção,
  onde o servidor está na nuvem. Também não decidir no Mac: o Mac não tem o banco para saber se a task pode voltar.
- **`git worktree remove --force`, ou `rm -rf` na pasta da task.** Apagaria trabalho não commitado. A recusa do git é a
  proteção que este desenho usa.
- **Apagar também as órfãs da raiz com a mesma regra de idade.** Sem dono, não há como saber se alguém volta a elas.
  A decisão fica com a pessoa, na tela.
- **Marcar a pasta como limpa no banco (migração 0066).** Com dois Macs, o que não tem a pasta marcaria a do outro como
  limpa. A janela de 30 dias e um `lstat` por pasta resolvem sem coluna nova.
- **Conferir PR mergeado pela ancestralidade no git.** O squash merge do GitHub quebra a ancestralidade, então o `gh` do
  Mac é a fonte.

## Riscos aceitos

- **Uma task reaberta no meio da passada.** A reconfirmação com o servidor e o turno vivo deste Mac, logo antes de cada
  pasta, deixam a janela em segundos: entre a reconfirmação e o `remove`. Se o turno começar exatamente aí, a worktree
  pode sumir debaixo do bot. A branch fica no clone e o bot recria a worktree.
- **Um processo vivo rodando de dentro de uma worktree de task encerrada** (um servidor de dev esquecido) perde a pasta.
  Para isso a task precisa estar encerrada há 3 dias, ou ter o PR mergeado.
- **O prazo de 10 min por remoção.** Se ele estourar no meio, a worktree fica pela metade, com os metadados no clone.
  O resto aparece como pasta com conteúdo, e o `git worktree prune` manual arruma os metadados.
- **A lista do que se refaz sozinho é por nome.** Uma pasta `dist/` ou `.cache/` ignorada na raiz, com algo que não se
  refaz e não é `.env*`, sai junto. O mesmo vale para o conteúdo de um `node_modules` em qualquer nível, que não é
  conferido por `.env*`.

## Não implementado (segue em PRs próprios)

- **Este Mac mostra o espaço liberável e permite limpar** (critério da #216). O Mac mede as órfãs paradas (o `du` é
  caro, então medir por amostra ou só sob pedido) e manda a medição no `puxar`, como a leitura de memória da ADR-085.
  A tela mostra "X GB em N cópias paradas há 2+ dias", com o detalhe atrás de um clique. O botão grava um pedido que o
  Mac puxa e cumpre com a mesma remoção sem --force.
- **Reaproveitar dependências entre tasks** (`npm ci --prefer-offline`, store do pnpm no mesmo volume) e a **cota por
  bot** (item 4 e item 5 da #216).

## Gatilho de reversão

- `limpeza_feita` com `pulada_suja` maior que `removidas` por uma semana: os bots deixam trabalho por commitar. Rever a
  instrução do prompt antes de pensar em forçar.
- `~/nod` crescendo mais de 20 GB por semana com a limpeza ligada: o que cresce está fora dela (as órfãs ou os clones),
  e a tela do item 5 passa a ser prioridade.
- Qualquer relato de worktree apagada com trabalho que não estava em branch nenhuma: desligar com
  `NOD_LIMPEZA_TASKS=desligada` no diário e reabrir esta ADR.

> **Revisto em 2026-10-22 ([ADR-119](adr-119-clone-da-maquina-por-repositorio.md), NOD-315):** na máquina Linux, a frente com repo faz a worktree a partir do clone da máquina (`~/nod/.clones/<dono>/<nome>.git`, bare), não de um clone na própria pasta. A worktree segue dentro da pasta da task; o clone é do nod e não sai com a limpeza.
