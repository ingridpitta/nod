# ADR-134 — Checkpoints de arquivos por turno (o "Desfazer N arquivos" da fala)

Status: aceita no PR #561 (NOD-54) · Data: 2026-10-28 · Estende a ADR-021 (a máquina puxa, o servidor nunca disca) e a
ADR-096 (o guardado da pasta do bot).

## Contexto

O bot muda arquivos na máquina da pessoa e não havia como voltar um turno. A NOD-54 pede "desfazer o que o bot mudou
neste turno" pela fala, com o protótipo aprovado pelo Marlon (https://gamefik.github.io/nod-prototipos/nod-54/) e as
decisões do último comentário da issue: o item no ⋯ da fala final, um cartão de confirmação embaixo da fala (não modal),
uma linha de progresso e depois o resultado; só o que este turno mudou volta; commit e push não voltam; 20 turnos por bot
ou 7 dias.

## Decisão

1. **A foto mora na máquina, num git sombra.** Antes do turno, o motor fotografa a pasta do bot num repositório *bare*
   por bot em `~/nod/.checkpoints/<bot>.git` (`refs/nod/turnos/<turno>/antes|depois`, commits sem pai). Não usa `git add`
   nem abre o `.git` da pessoa: percorre os arquivos, grava os blobs com `hash-object -w` e monta a árvore num index
   temporário fora da pasta, com ambiente sem `GIT_*` e sem a config dela. Fica fora: `.git`, `node_modules`, pastas de
   frente, arquivos acima de 20 MiB, nomes com caractere de controle (o `Icon\r` do macOS); teto de 2 GB por sombra. Prazo de 5 s para a foto; passou, o turno segue sem
   checkpoint (nunca derruba o turno). A pasta do bot que ainda não existe (o primeiro turno) é uma foto vazia; um erro
   de leitura que não seja "sumiu" (EMFILE, EACCES) deixa o turno sem checkpoint, em vez de a subpasta virar "criada" e
   o desfazer apagá-la.
2. **O Write/Edit fora da pasta** guarda o original pelo hook das ferramentas nativas (`guardarOriginal`, 2 s) e entra no
   mesmo checkpoint. Caminho fora da casa (`~`) deixa o turno sem checkpoint.
3. **O conteúdo nunca sobe.** No fim do turno, a entrega leva só o resumo (`checkpoint`: caminhos, ação criado/mudado/
   apagado, total). O servidor grava em `checkpoints` (0120), um por turno, ligado à fala final (`mensagem_id`) no
   assentamento; a leitura da conversa junta o `checkpoint` à fala.
4. **Desfazer é um pedido que a máquina puxa.** `POST /conversas/:id/turnos/:turno/desfazer` passa o checkpoint para
   `desfazendo`; o motor puxa `/ponte/desfazeres` a cada 3 s, roda um de cada vez e relata progresso (no máximo a cada
   2 s, porque cada relato relê a conversa nas abas) e o fim. Um desfazer por bot de cada vez (índice único parcial). A recusa (vencido, outro desfazendo, já
   desfazendo, nada a forçar) volta 200 com `ok: false` e o motivo: é resposta, não erro.
5. **Por arquivo, três vias.** Se o arquivo está como o turno deixou, volta. Se mudou depois em outra parte, `git
   merge-file` volta só a parte do turno (`mesclado`). Se mudou nas mesmas linhas, fica (`conflito`) e a tela oferece
   "Voltar mesmo assim" (`forcar`), que volta por cima só os caminhos em conflito; o resultado dele entra no anterior (o
   que a pessoa mexeu depois da primeira passada fica). Refazer é seguro: um diário por turno na sombra guarda o desfecho de cada arquivo
   assim que ele é decidido, e o que já voltou ou mesclou não é tocado de novo na nova tentativa (o que a pessoa mexeu
   depois fica); a máquina que caiu no meio retoma de onde parou; o fim fica guardado até o servidor aceitar. Os criados saem primeiro: no disco do
   Mac, `Notes.md` -> `notes.md` é o mesmo arquivo.
6. **O bot fica sabendo.** O fim com resultado deixa uma linha de sistema na conversa (`arquivos.desfeitos`, "Desfeito:
   N arquivos voltaram…, Commit e push não voltam.") que o bot lê no próximo turno.
7. **Retenção:** 20 checkpoints por bot e 7 dias no servidor (`vencido`); o item some. A máquina guarda o dobro (40),
   porque conta também os turnos que o servidor nunca registrou; se ainda faltar a
   foto, o desfazer vira `vencido` e a fala diz por quê.
8. **Web:** o item "Desfazer N arquivos" é o último do ⋯ da fala final do bot na conversa própria (apagado com o porquê
   enquanto desfaz, depois de desfeito e enquanto outra fala do bot desfaz); o cartão abre embaixo da fala, com foco no
   título e Esc que cancela; a linha diz o progresso (`role=status`), o resultado (`details`, com a lista) ou a falha
   (`role=alert`, "Tentar de novo").

9. **Turno e desfazer não rodam juntos na mesma pasta** (revisão do PR). Os dois laços moram no mesmo processo do motor:
   o desfazer é do bot (a sombra é uma por bot). Com qualquer turno aberto na raiz do bot ou numa frente dele, devolve
   `ocupado` e roda na passada seguinte, mandando só um sinal de vida (no máximo um por minuto); o turno do bot que abre
   durante um desfazer espera até 60 s e, se ainda estiver desfazendo, segue sem checkpoint. Dois turnos sobrepostos na
   mesma pasta não ganham checkpoint (a foto de um misturaria o outro); o turno de outra pasta do bot (a frente) que
   grava pelo hook na pasta de um turno aberto tira o checkpoint dos dois (o "depois" de quem gravou já tem o trabalho do
   outro); vale também para a raiz que grava dentro de uma frente aberta (a foto da raiz pula as frentes, então o hook
   guarda esse original). O `gc` da sombra marca o começo e o fim: o turno que leu o cache no meio não o regrava. Os caminhos se comparam
   como no domínio (NFC, sem distinguir maiúsculas); o hook grava no manifesto com o home do laço, e o caminho guardado
   que não cai nesse home deixa o turno sem checkpoint. A sala entra no registro, sem foto.
   A foto é da pasta, não das ferramentas: o que a pessoa (o editor, um servidor de dev) mudou na pasta durante o turno
   entra no checkpoint e volta junto (limite aceito, revisão 12: o protótipo aprovado lista o que vai voltar antes de
   confirmar, e a pessoa vê o arquivo dela ali).
   `~/nod` pode ser um link (outro disco); um link abaixo dele é recusado (a pasta do turno que é link fica sem
   checkpoint, e a foto e o desfazer não leem por uma pasta-link acima do arquivo), e a guarda que passa por uma pasta-link acima
   do arquivo falha anotando o caminho real. A pasta do turno casa pelo caminho e pelo caminho real (o Codex manda o
   real). Risco residual: uma gravação de outro bot
   "fora" da pasta, ou do Bash fora da pasta, não é coordenada; gravar por um link fora da pasta deixa o turno sem
   checkpoint.
10. **Cada pedido tem uma `tentativa`** (incrementa no pedido; o relato a leva). Progresso e fim de uma tentativa velha
    são ignorados, e a máquina descarta o fim pendente de uma tentativa velha. O `desfazendo` sem notícia há mais de 15 min não vai mais para a máquina (a tela já o mostra como falhou) e
    (todo relato, inclusive o sinal de vida, renova `pedido_em`; a máquina sumiu) vira `falhou` no próximo pedido do bot; o checkpoint com mais de 7 dias vence no pedido mesmo sem
    turno novo, e some da fala na leitura.
11. **Credencial nunca entra na sombra** (revisão 8): a foto pula o caminho que a cerca de credencial reconhece
    (`tocaCredencial`, pelo caminho e pelo nome do arquivo, mais `*.key/pem/p12/pfx` e `id_*` em qualquer caixa e letra) e guarda só a marca do stat dela (na pasta de credencial, `.aws` ou `.ssh`, a de cada arquivo dentro); o turno em que essa marca muda, ou que grava uma credencial pelo
    hook, fica sem checkpoint. Da sombra, o bot a leria por fora da cerca. A guarda que falha (link, prazo) anota os
    caminhos tentados, para o cruzamento com outro turno aberto do bot ainda valer.
12. **Permissões:** `~/nod/.checkpoints` e as sombras em 0700, objetos 0600; a pasta da sombra que é link ou não é
    diretório é recusada (`sem_checkpoint`). A volta de um arquivo recusa link em qualquer ancestral (antes e depois de
    criar a pasta), grava por arquivo temporário 0600 exclusivo e restaura o modo (644/755). O caminho que o servidor
    recusaria vai como `~/(nome ilegível)`.

## Diferenças para o protótipo (registradas no PR)

- O conflito aparece no **resultado**, com "Voltar mesmo assim", e não no cartão antes de confirmar: o servidor não tem o
  conteúdo para saber antes. Nada é sobrescrito sem a pessoa escolher, como no protótipo.
- O resultado não diz quem mudou o arquivo depois.
- Sem a pílula do topo e sem a barra lateral; sem "o Estúdio está desligado" (o pedido fica na fila e roda quando a
  máquina volta).
- A sala, a frente (task), o artefato e o desfazer pedido pela conversa ("desfaz isso") ficam para depois. O turno de
  frente entra só no registro da máquina (sem foto, para não gastar a retenção da raiz), e o hook ainda coordena o que ele
  grava fora da pasta; o servidor não registra o checkpoint: a sessão da frente não leria a linha do desfeito.
- O relato vai cortado em 1000 caminhos (os conflitos primeiro); o servidor guarda até 200 desfechos e a contagem real.
- "Esperando o desfazer das HH:MM" só vale para as falas da janela carregada.

## Gatilho de reversão

Se a foto custar mais de 1 s no p95 dos turnos ou a sombra encher o disco das máquinas, a foto passa a ser só dos
arquivos que o turno tocou (pelo hook) em vez da pasta inteira.
