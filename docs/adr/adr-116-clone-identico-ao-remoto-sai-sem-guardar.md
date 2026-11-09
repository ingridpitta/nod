# ADR-116 — O clone idêntico ao remoto sai sem guardar (NOD-295 A+B)

Status: aceita · Data: 2026-10-19 · Revê a ADR-096 §4 e a ADR-099 (I5) só para o clone (`.git` PASTA) na pasta da task.

## Contexto

Em 19/10 a VM dos bots tinha 87 GB em `~/nod/.guardado`, crescendo ~20 GB/dia: a limpeza tratava qualquer clone como
dúvida (`if (achados.clones > 0) return { duvida: "clone" }`, em `provarSemTrabalho`) e, na task encerrada, guardava a
pasta inteira, `.git/objects` e node_modules à parte. Quase tudo eram clones limpos do gamefik (~1,8 GB cada) de frentes
que não mudaram nada. Critério do Marlon: seguro para qualquer codebase; só apaga o que é idêntico ao remoto; na
dúvida, guarda.

## Decisão

1. **A. O clone refazível sai sem guardar** (`cloneParaFicar`, em `src/adapters/executor/limpeza-das-tasks.ts`), só na
   task `encerrada` ou `sem_trabalho`, quando TUDO isto vale: `.git` de verdade e raiz do próprio clone; sem LFS; sem
   `*.pid` vivo; as conferências da worktree (montagem, aninhado, alteração, arquivo novo, ignorado que não se refaz,
   HEAD solto); nenhuma worktree dele que fique; ao menos um remoto, e o local existindo fora da pasta; sem stash;
   `rev-list --all --reflog --not --remotes` vazio; nenhum `assume-unchanged`/`skip-worktree`; nenhum outro clone da
   pasta dependendo dele (remoto ou `alternates`). Sai com `rm -rf` conferido; o relato conta `clonesApagados`, e
   `puladas.clone` passa a contar só os que ficaram (log `limpeza_clone_fica` com o motivo).
2. **B. A frente sem trabalho com clone provado sai no fim**, sem campo novo em `abrir_frentes`: a prova vem do conteúdo.
3. **O clone sujo continua guardado, sem o que se refaz**: `node_modules`, caches, `.local-output/disposable-pg-*`, os
   ignorados regeneráveis (`classificarIgnorado`) e, quando o remoto refaz o clone (sem `shallow`, sem `alternates`,
   índice vazio, nada só no reflog), `.git/objects` — os commits fora do remoto vão num `git bundle` conferido dentro do
   `.git`, com um LEIA de como refazer.

"Idêntico ao remoto" é contra os `refs/remotes` locais (a última busca), sem rede: a mesma prova da worktree sem
trabalho (ADR-099 I5). Uma branch apagada no servidor depois da busca ainda conta como enviada.

## Fora

C (recolher contêiner/volume por rótulo) e D (Postgres compartilhado) da NOD-295. O `pgdata` genérico não sai do
guardado (só o `disposable-pg-*`, que o nome diz descartável). Hooks e config locais do `.git` do clone apagado não se
refazem com o clone.

## Gatilho de reversão

Um trabalho perdido por um clone apagado: volta a guardar todo clone (`cloneParaFicar` devolvendo sempre um motivo).
