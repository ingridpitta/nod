# ADR-096 — O disco que se cuida: a máquina dos bots não enche sem ninguém olhar

Status: aceito · Data: 2026-10-11 · Emenda a [ADR-088](adr-088-limpeza-das-pastas-de-task.md) (a limpeza das tasks) e
usa os limites de disco da [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (#219).

## Contexto

Em 11/10 os bots pararam. A VM `nod-motor-teste` (disco de 49 GB) chegou a 99%, com 935 MB livres, e o portão do disco
(#219) segurou todo trabalho novo, como devia. O portão só detecta e para; ninguém liberava espaço.

Medido na VM em 11/10 (`du` e `git status` com `nice`/`ionice`, e o `journalctl -u nod-motor`):

- A limpeza das tasks (ADR-088) rodava no padrão `simular` havia dois dias. Nos logs de 3 dias, **zero** worktrees
  sairiam: 74 puladas como `aninhado`, 13 como `ignorado_valioso` e 10 como `suja`.
- O `aninhado` era falso. A busca por `.git` dentro da worktree desistia com qualquer pasta a mais de 8 níveis, e o
  gamefik tem código assim (`packages/mundo-vivo/tools/provas/vereditos/mundo/rondas/r14-mundo-vivo/palcos`). Nenhuma
  das worktrees conferidas tinha repositório dentro.
- Das 41 worktrees de task, 4 eram seguradas por cache de ferramenta dentro de um pacote (`packages/auth/.turbo/`,
  `apps/mobile/.expo/`): a regra da ADR-088 só aceitava o cache no primeiro nível do caminho.
- `~/nod` somava ~37 GB, ~31 GB deles em worktrees de task. Outros ~3 GB eram sobras da task fora de worktree:
  dados de Postgres local (`pgdata`, `pg5471`), logs, ferramentas. Caches: 1,4 GB em `~/.npm` e 4 GB no store do pnpm.
- Depois de liberar, o disco cresceu 2 GB em uma hora de bots trabalhando.

O Marlon aumentou o disco para 100 GB e ligou a limpeza à mão. Isso não serve para quem usa o nod: a pessoa comum não
sabe da variável, não tem como aumentar o disco e só descobre quando os bots param.

## Decisão

A máquina que roda os bots cuida do próprio disco: limpa por padrão, limpa mais quando aperta, guarda antes de apagar
o que não se refaz e avisa antes de chegar ao fim. Sete partes: 1, 2, 3 e 7 no PR #246; 4, 5 e 6 no PR seguinte,
empilhado nele.

**1. O `aninhado` olha o que importa.** A busca por `.git` abaixo da worktree não tem mais teto de nível, só o de 20 mil
pastas fora de `node_modules`. Ela já não seguia link (`Dirent.isDirectory()` é falso para ele), então não entra em
laço. A worktree do gamefik tem 1.193 pastas fora de `node_modules`.

O cache de **uma ferramenta conhecida**, com nome que só ela usa, vale em qualquer nível: `.turbo`, `.expo`, `.next`,
`.nuxt`, `.svelte-kit`, `.vite`, `.parcel-cache`, `.pnpm-store`, `__pycache__` e `.pytest_cache`. A pasta inteira passa
pela mesma conferência de `.env*` da ADR-088. `dist`, `coverage` e `.cache` continuam só no primeiro nível, porque são
nomes genéricos.

**2. A limpeza apaga por padrão.** `NOD_LIMPEZA_TASKS` sem valor, ou com valor desconhecido, liga. `simular` e
`desligada` só valem escritos por extenso. Isto é o gatilho da ADR-088 §7, cumprido pelo Marlon em 11/10 com os logs da
VM na mão. As proteções da ADR-088 continuam todas: `git worktree remove` sem --force, montagem, travada, aninhado,
suja, ignorado valioso, HEAD solto, turno vivo, reconfirmação com o servidor.

**3. Disco apertado, limpeza na hora.** A cada 5 min a limpeza lê o disco de `~/nod` (`statfs`, sem processo novo). No
amarelo ou no vermelho da ADR-085 (abaixo de 10 GB ou de 3 GB livres, com a mesma histerese), ela roda uma **passada
apertada**, no máximo uma a cada 30 min:

- o pedido leva `apertado: true`, e o servidor oferece também a task encerrada há mais de 2 h como `encerrada`, sem
  exigir o PR mergeado. As outras travas de `quandoLimpar` não mudam. A branch fica no clone: se o bot voltar à task,
  ele recria a worktree;
- no fim, os caches de pacote saem pelas próprias ferramentas: `npm cache clean --force` e `pnpm store prune`. O
  segundo roda depois das worktrees, porque só tira do store o que nenhum projeto usa. Programa ausente é pulado;
- o relato vai marcado (`apertada`, `caches_mb` no log `limpeza_feita`), e a máquina registra
  `limpeza_disco_apertado` com o nível e o espaço livre.

**7. O pesado cede a vez.** Os comandos pesados da limpeza rodam com prioridade baixa de CPU e de disco: o
`git status` de cada worktree, o `git worktree remove`, o `du` da simulação e a limpeza dos caches. No Linux,
`ionice -c2 -n7 nice -n10`; no macOS, `taskpolicy -c utility`; sem as ferramentas, roda direto (`prefixoDeFundo`). Em
11/10, três `du` sobre `/home` da VM, ao lado dos turnos, deixaram a máquina sem responder nem ao SSH (~170 MB/s de
leitura com 20% de CPU) até um reset.

Prioridade baixa, nunca a ociosa. A primeira versão usou `taskpolicy -b` e `ionice -c3`: com load 114 no Mac, três
testes da limpeza passaram de 60 s sem terminar. Máquina cheia é justamente quando o disco enche, e a limpeza parada
nessa hora não serve.

**4. Guardar antes de apagar** (`src/adapters/executor/guardar-antes-de-apagar.ts`). Antes, o que o
`git worktree remove` sem --force não tira segurava a pasta para sempre. Isso inclui a worktree `suja`, com
`ignorado_valioso`, com HEAD solto ou com repositório aninhado, o clone inteiro e as sobras fora de worktree (`pgdata`,
logs, patches). Na VM eram ~3 GB de sobras e 5 worktrees com alterações por commitar. Agora, na task `encerrada`
(3 dias, ou 2 h com o disco apertado), depois de as worktrees limpas saírem, o que ficou segue esta ordem:

1. **Conferir.** Montagem de container dentro da pasta, worktree travada (`git worktree lock`) ou erro numa worktree
   seguram a pasta inteira, como antes. Um `*.pid` de processo vivo também (`processo_vivo`): o Postgres de teste que o
   bot deixou rodando.
2. **Marcar os commits.** O HEAD de cada worktree da pasta, inclusive a de pasta escondida, ganha uma referência no clone
   (`refs/nod/guardado/<task>/<caminho>`). O commit que só o HEAD solto alcançava não se perde. Nada vai ao GitHub.
3. **Guardar.** A pasta inteira vira `~/nod/.guardado/<bot>/<slug>.tar.gz`, sem `node_modules` e sem os caches de
   ferramenta do item 1. Clone aninhado vai com o `.git`. O arquivo nasce `.parcial`, passa pela leitura inteira
   (`tar -tzf`) e só então ganha o nome final. Acima de 2 GB compactado a pasta fica (`grande_demais`): guardar não pode
   encher o disco que se quer liberar. Falha em qualquer etapa apaga o `.parcial` e deixa a pasta.
4. **Apagar.** As worktrees saem com `git worktree remove --force`, da mais funda para a mais rasa, e o clone as
   esquece. Depois, `rm -rf` na pasta. O --force aqui não perde nada: tudo o que ele apagaria já está no guardado
   conferido e nas referências.

Na task de menos de 3 dias (`so_com_pr_mergeado`), nada é guardado: o bot ainda pode voltar a ela.

**As órfãs da raiz do bot** (ADR-088 §5, 198 no Mac do Marlon em 09/10) saem quando estão paradas há 30 dias, ou há 7
com o disco apertado. Nunca saem com um turno daquele bot rodando, porque o turno sem task usa a raiz do bot. A órfã limpa
sai como a da task, sem --force. A que tem algo a guardar passa pelo mesmo caminho acima. Docker mudo segura todas.

**O guardado vence** em 30 dias, ou em 7 com o disco apertado. O `.parcial` de uma passada que morreu no meio sai em 1
dia. Logs: `limpeza_pasta_guardada` (com `guardado_mb` e `liberado_mb`), `limpeza_pasta_pulada`, `limpeza_orfa_removida`,
`limpeza_guardados_vencidos`; no servidor, `guardadas`, `guardado_mb`, `guardados_vencidos` e `orfas_removidas` no
`limpeza_feita`.

**5. Gastar menos: medido, nada a mudar agora.** Na VM, em 11/10, os arquivos de `node_modules/.pnpm` de uma worktree
do gamefik tinham de 24 a 70 links (`stat -c %h`): o pnpm já liga os pacotes ao store e não copia. O peso de cada
worktree do gamefik é o próprio checkout: ~750 MB de arquivos versionados (`docs` 256 MB, `apps` 241 MB, `packages`
246 MB). O que reduz o disco é tirar a worktree cedo (itens 1 a 4). Gatilho para voltar: um repositório com npm e
`node_modules` grande por worktree aparecer entre os maiores de `~/nod`.

**6. Tendência: avisar antes e limpar antes.**

- **No servidor**, cada máquina tem um histórico do espaço livre: um ponto a cada 5 min, das últimas 3 h. Ele fica fora
  da leitura viva, então a máquina que some por minutos não o perde. A reta dos mínimos quadrados (`acabaEmMs`) diz em
  quanto tempo o livre chega a 3 GB. Ela pede pelo menos 3 pontos em 30 min; disco estável ou que ganhou espaço não tem
  estimativa. A tela só recebe a estimativa abaixo de 24 h (`acabaLogo`): a web só mostra.
- **Na tela**, o cartão da máquina diz "Disco acaba em cerca de 6 h no ritmo atual" em amarelo, mesmo com o disco
  verde. Este Mac mostra "14 GB livres · acaba em cerca de 6 h" e, no detalhe, o que o Nod faz sozinho. O frame sai
  quando a máquina passa a acabar em menos de 24 h, e o log `disco_acaba_logo` vai no máximo uma vez por hora.
- **Na máquina**, a limpeza calcula a mesma tendência pelas próprias leituras de 5 min. Se o disco acaba em menos de 6
  h, a passada apertada já roda com o disco ainda verde: no ritmo de 11/10 (2 GB por hora), 10 GB de folga duram 5 h.

## Alternativas descartadas

- **Aumentar o disco.** Resolve uma vez, para quem tem acesso à nuvem. A pessoa comum não tem, e o disco enche de novo
  no mesmo ritmo.
- **Manter `simular` e avisar a pessoa para ligar.** Exige saber de uma variável de ambiente; o padrão é o que acontece
  com quem não sabe.
- **Regra percentual para o aperto.** A ADR-085 já recusou: 5% de 466 GB seguraria um disco com folga de sobra. Os
  limites absolutos valem para a VM de 50 GB e para o Mac de 466 GB.
- **Apagar caches com `rm`.** As ferramentas sabem o que é delas e o que está em uso (`pnpm store prune` só tira o que
  nenhum projeto referencia).
- **Rodar o motor inteiro com prioridade baixa (systemd `Nice=`).** Os turnos dos bots também perderiam a vez; só a
  limpeza é trabalho de fundo.
- **Commitar o que está sujo numa branch `wip/...` e mandar ao GitHub** (a primeira proposta do item 4). Publicaria
  trabalho pela metade no repositório da pessoa, dispararia CI e encheria o GitHub de branches. O guardado local e a
  referência no clone guardam o mesmo sem sair da máquina.
- **Medir a "cota" pelo tamanho de `~/nod`.** Exige `du` em milhões de arquivos, que foi o que travou a VM em 11/10. O
  espaço livre (`statfs`) e a tendência dele custam uma chamada.

## Riscos aceitos

- **A worktree de uma task encerrada há 2 h some no aperto.** Se o bot voltar, recria a worktree a partir da branch e
  reinstala as dependências. É mais lento, mas os bots não param.
- **`npm cache clean` ou `pnpm store prune` no meio da instalação de um bot.** A instalação pode falhar e o bot tenta de
  novo. Só acontece no aperto, no máximo uma vez a cada 30 min.
- **Valor desconhecido em `NOD_LIMPEZA_TASKS` liga a limpeza.** Antes ele simulava. Quem quer simular escreve `simular`.
- **O guardado leva o `.env` da worktree.** Fica na mesma máquina, em `~/nod/.guardado` (pasta 0700), e vence em 30 dias.
  Deixar o `.env` de fora perderia o que a pessoa não tem em outro lugar.
- **O `.pid` de um processo que morreu e teve o número reaproveitado** segura a pasta até a próxima passada. Recusa demais,
  nunca apaga a mais.
- **Uma órfã parada há 30 dias que alguém ainda queria.** A branch fica no clone, e o resto está no guardado por mais 30
  dias.

## Gatilho de reversão

- Relato de worktree apagada com trabalho fora de qualquer branch: `NOD_LIMPEZA_TASKS=desligada` e reabrir esta ADR e a
  ADR-088.
- `limpeza_disco_apertado` repetindo por mais de um dia na mesma máquina sem `liberado_mb` nem `caches_mb`: o que
  enche está fora da limpeza (fora de `~/nod`, ou guardados `grande_demais`), e é preciso medir de novo.
- Relato de algo que faltou num guardado: parar o item 4 (voltar a pular a pasta) até entender o que o `tar` deixou de
  fora.
