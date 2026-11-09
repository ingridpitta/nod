# ADR-119 — Clone da máquina por repositório (NOD-315)

Status: aceita · Data: 2026-10-22 · Revê a ADR-065 (cada task na sua pasta) e a ADR-088 (limpeza das pastas de task) só
na máquina Linux, para a frente com repo.

## Contexto

Cada frente clonava o repo inteiro na própria pasta (`gh repo clone dono/repo ~/nod/<bot>/<frente>/<repo>`). Em 19/10 a
VM dos bots tinha 18 clones do gamefik, ~24,6 GB só de `.git`, e cada frente gastava de 1 a 3 min clonando antes de
começar. A limpeza (ADR-116) apaga o clone limpo no fim, mas não evita o download nem o disco enquanto a frente vive.

## Decisão

1. **Um clone bare por repositório na máquina**, em `~/nod/.clones/<dono>/<nome>.git` (`caminhoDoClone`,
   `src/domain/clone-da-maquina.ts`). Só o nod o cria e atualiza; a frente só faz `worktree add` dele na própria pasta.
2. **O repo da frente fica guardado** em `trabalhos.repo` (migração 0102, CHECK `trabalho_repo` de 3 a 200 caracteres),
   vindo do campo `repo` do `abrir_frentes` normalizado por `repoDoGithub` (`dono/nome` do GitHub, minúsculo; outro
   host, `..` ou nome começando com ponto é `null` — o texto vem do modelo e vira caminho no disco).
3. **O servidor decide; o executor prepara.** `montarPlano` manda `cloneDaMaquina {repo, caminho, semClone, comClone}`
   só para a frente na máquina Linux, com terminal, repo válido e GitHub (`github`/`github_mcp`) concedido; sem GitHub,
   o log `clone_da_maquina_saida` do servidor diz `sem_credencial`. O executor (`laco.ts`), antes de criar o adapter,
   roda `prepararCloneDaMaquina` (`src/adapters/executor/clone-da-maquina.ts`) e, pronto, troca no prompt o trecho de
   hoje (`semClone`, byte a byte o de antes) pelo que cita o clone (`comClone`). App antigo ignora o campo e segue igual.
4. **Concorrência por `flock`** em `~/nod/.clones/.travas/<dono>__<nome>.lock` (fora do clone, vale antes de ele
   existir), espera de até 5 min (`clone_da_maquina_esperou_trava` quando passa de 1 s). Fetch só se o `FETCH_HEAD` tem
   mais de 2 min. Criação em `.novo-<nome>-<pid>` com rename no fim: ninguém vê clone pela metade.
5. **Qualquer saída deixa o prompt de antes** e o bot clona na pasta como sempre: `sem_credencial`, `submodulo`
   (`.gitmodules` em `origin/HEAD`), `lfs` (`filter=lfs` em algum `.gitattributes`), `clone`, `fetch`, `trava`,
   `clone_quebrado`, `prompt_sem_trecho`, `abortado`. Nunca vira erro do turno. O Parar e a renovação negada abortam o
   git e interrompem o adapter logo que nasce.
6. **Clone quebrado se conserta sozinho**: HEAD inválido com `objects/` e `refs/` vivos é reescrito no lugar
   (`reparo: "head"`); sem conserto, vai para `.quebrado-<nome>-<AAAAMMDDHHmm>`, o novo é criado, recebe os
   `refs/heads` e `refs/nod` do velho, copia `worktrees/` e roda `worktree repair` (`reparo: "recriado"`).
7. **Cerca** (`git-na-pasta-do-bot.ts`): "O clone da máquina é de todos os bots: só o nod mexe nele." Nega apagar,
   mover ou forçar branch `frente/*` que não seja o da própria frente (`branch -d/-D/-m/-M/-c/-C/-f`, `update-ref -d`),
   `worktree remove|lock|unlock|repair` fora da própria pasta, e `gc|prune|repack|reflog expire|config (escrita)|remote
   (escrita)|filter-branch|maintenance|worktree prune` com alvo em `~/nod/.clones` (pelo `-C`, cwd, `--git-dir` ou
   `GIT_DIR`). `config` e `remote` só contam como leitura com a ação na frente (`git config x y --get` grava). Como a
   cerca não pega o `remote set-url` rodado de dentro da worktree, o executor reafirma o `origin` a cada preparo e, se
   mudou, busca na hora (log `clone_da_maquina_origin_restaurado`).
8. **Limpeza**: `cloneSumiu` reconhece o gitdir da worktree do bare (`.clones/.../x.git/worktrees/n`) e procura o
   registro também nos bares de `~/nod/.clones`. O clone da máquina não é pasta de task e não é apagado pela limpeza;
   o branch da frente fica nele depois que a pasta sai.
9. **O dono integra do mesmo clone**: `DONO_INTEGRA` diz que o branch da frente fica no clone de onde a worktree nasceu
   e, se a do dono não nasceu dele, `git fetch <esse clone> <branch>` antes do merge.

## Fora

Mac (o terminal é o da pessoa, ADR-055: os clones dela continuam como estão). Task e conversa sem frente. Submódulo e
LFS. A `config` e o `gc` rodados de dentro da worktree (sem `-C` no clone) escrevem no config comum e não são pegos
pela cerca de texto — o mesmo limite de shell como texto da ADR-116.

## Gatilho de reversão

- `clone_da_maquina_saida` com `clone`, `fetch` ou `clone_quebrado` em mais de 10% dos turnos de frente por uma semana.
- Um trabalho perdido por branch ou worktree de frente apagada no clone compartilhado.
Rollback: `CLONE_DA_MAQUINA = false` em `src/domain/clone-da-maquina.ts` (o servidor deixa de mandar o campo e o prompt
é o de antes). A coluna `trabalhos.repo` fica (aditiva); os bares em `~/nod/.clones` podem ser apagados à mão.
