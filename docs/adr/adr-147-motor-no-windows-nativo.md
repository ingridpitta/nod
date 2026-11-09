# ADR-147 — O motor roda no Windows nativo

Status: aceita (2026-11-03, ADA-11, Fase 1) · Emenda a [ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) ("uma
máquina Linux" vira "uma máquina Linux ou Windows") e a [ADR-089](adr-089-ciclo-de-vida-dos-processos.md) (o grupo de
processo vira "árvore"). Plano em [docs/planos/plano-windows-fase1.md](../planos/plano-windows-fase1.md).

## Contexto

O motor (`motor/main.ts`) e o executor dependem de POSIX em quase toda camada: `kill(-pgid)`, `bash`/`sh` fixos,
`~/.config`, `ps`/`/proc`, a cerca do git comparando com `/`. O contrato e o banco só aceitam `darwin` e `linux`
(0067). Quem só tem um PC com Windows não consegue pôr os bots para trabalhar nele.

## Decisão

1. **Windows 10 22H2/11 x64, nativo, com o Claude Code e o Codex nativos.** Não WSL: o WSL2 pede admin, virtualização na
   BIOS e reinício, e os arquivos ficariam fora do disco do Windows. O WSL2 com systemd continua servindo como "uma
   máquina Linux" (ADR-090) pelo instalador Linux, sem código novo e sem teste na CI.
2. **Git for Windows é obrigatório.** O `git` já é preciso para clone e worktree, e traz o `bash.exe` que roda o hook
   das nativas e as esperas. O motor recusa `rodar` sem ele (código de saída 3, texto com `winget install Git.Git`).
3. **Um lugar só sabe "como é aqui"**: `src/adapters/executor/plataforma.ts` (pastas, resolver binário pelo PATH ×
   PATHEXT, shell do nod, matar a árvore, listar processos). `.cmd` do npm vira `node <script>` lido do shim; nunca
   `cmd.exe /c` (expande `%VAR%`, CVE-2024-27980). Programas do sistema por caminho absoluto
   (`%SystemRoot%\System32\taskkill.exe`), nunca pelo nome solto com a cwd na pasta do bot.
4. **Matar a árvore**: POSIX segue com `kill(-pgid)`. No Windows uma vigia (uma só, a cada 3 s) fotografa os
   descendentes de cada CLI vivo (pid + horário de criação). O Parar manda `taskkill /T /F` na raiz enquanto ela ainda é
   nossa (antes do exit) e, depois, `taskkill /F` sem `/T` em cada visto cujo horário ainda bate; o boot mata só a lista
   anotada, sem `/T`. Pid com horário diferente não é mais nosso e não morre; o líder que já saiu nunca leva taskkill.
5. **Sem sandbox de SO no Windows**, como no Mac de hoje: o bot tem o usuário da pessoa. Ficam a cerca do git e o hook
   das nativas, que no Windows é **obrigatório**: as nativas do terminal saem de `--allowedTools` e só o allow do hook
   as libera; sem hook o turno não roda comando (falha fechada). Caminhos são comparados normalizados (`\` → `/`,
   drive em minúsculas, `..` resolvido antes) por `src/domain/caminhos.ts`; UNC fica fora da pasta do bot e o `\\?\` que
   não é drive nem `UNC\` (`GLOBALROOT`, `Volume{…}`) não é conferível (nega).
6. **O computador do bot anuncia `sem_suporte` no Windows.** A atualização automática do motor e das IAs fica
   desligada no win32 (Fase 2), assim como a trava do clone da máquina.
7. **Plataforma `win32` no contrato e no banco** (0149). O servidor recusa plataforma desconhecida em vez de tratá-la
   como Mac.

8. **O motor do Windows só conecta em servidor que conhece o `win32`** (a sessão lista as plataformas): num rollback, o
   servidor antigo o trataria como Mac.

## Desvios de outras ADRs (no win32)

- **[ADR-065](adr-065-o-bot-sabe-o-que-tem-e-cada-task-na-sua-pasta.md)** (cerca do git): a mesma regra, com os caminhos
  normalizados, o `git.exe` absoluto ou em maiúsculas, o comando de dentro de `powershell`/`pwsh`/`cmd`/`bash -c`, e
  falha fechada no `-EncodedCommand` e no git que não deu para ler.
- **[ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md)/089** (processos do trabalho): "grupo de processo" vira
  "árvore vista", como no item 4.
- **[ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md)** (fila do forno): desligada no win32. Ela mede a
  árvore pelo `ps` e o `$$` do Git Bash não é o pid do Windows; o comando pesado roda direto.
- **[ADR-103](adr-103-o-codex-com-o-terminal-pelo-hook-do-nod.md)** (Codex com o terminal pelo hook): o Codex falha aberto
  se o hook não roda, então no win32 o terminal dele só liga com `NOD_CODEX_TERMINAL_WINDOWS=1`, depois que uma sonda numa
  máquina Windows provar o PreToolUse lá. Sem a flag, o Codex roda isolado (sem terminal).

## Alternativas rejeitadas

- **WSL2 como alvo único**: pede admin e reinício (fere "instalar sem passos manuais") e tira os arquivos do disco.
- **Job Object por addon nativo** para matar a árvore: dependência nativa nova; fica como gatilho abaixo.
- **`cmd.exe /c` para os `.cmd`**: expande `%VAR%` e não carrega quebra de linha no argumento.

## O que mudou também no Linux

A cerca do git é a mesma função nas duas plataformas, e as correções das revisões do PR #642 a deixaram mais restrita
também no Linux (nunca mais frouxa): `--git-dir`/`GIT_DIR` fora da pasta do bot, o `cd` dentro de `( … )`, o comando
lido inteiro depois de `$(…)` ou crase, `xargs git <sub>` conferido na pasta atual e `-c core.worktree=`,
`-c include.path=`, o `-c alias.*=` que não expande para um git que só lê (`alias.st=status` fica livre) e `--config-env` negam; o `--git-dir`/`GIT_DIR` que não dá para resolver nega o git que
mexe; `builtin cd`, o `cd` depois de um redirecionamento, o `cd` relativo com `CDPATH`, o `popd` e o `pushd` sem pasta viram pasta desconhecida (o `cd -` do bash volta à
anterior quando a cerca a viu no mesmo comando) (no Windows também o `Pop-Location`, o `cd -`/`cd +` e o `-Path:` só com opções); `bisect`, `read-tree`, `checkout-index`, `update-index`, `symbolic-ref`, `sparse-checkout`, `submodule`,
`notes`, `tag` (só o que cria, apaga ou força; `--column` lista) e `submodule foreach` (fora o de um git que só lê) entram na lista do que mexe. A única folga é o `$(pwd)`, que vira a pasta atual, e o
`$(git rev-parse --show-toplevel)` como palavra inteira (o git ali age no mesmo repositório em que agiria na pasta atual;
fora de um repositório o `cd ""` não sai do lugar); com caminho grudado (`…)/../x`) ele é pasta desconhecida. A guarda
de credencial no Linux segue a de antes (caixa e `\` de regex, como `config\.aws`, não contam); as formas do Windows
(sem caixa, `\`, `^` do cmd, ponto no fim, ADS, cofres, nome curto 8.3) só valem quando a máquina é win32 ou o texto
tem cara forte de Windows (drive, `~\`, UNC, `%USERPROFILE%`/`%APPDATA%`…, `$env:`, `powershell`/`cmd`, um `.exe`
como programa, `AppData\` como pasta) — `%H%` do `git log`, `app.exe` de argumento e `rg "AppData"` não contam. Fora do
Windows o nome 8.3 só vale como pasta (`/GITHUB~1`), e a chave do nod com glob só quando o glob mira o nome (`n*`), não
a pasta inteira (`~/.config/*`). Exceção consciente: `git credential fill` é credencial também no Linux (o token sai
dele). No hook do win32, o que só a regra do Windows pega nega seco (o servidor não sabe a plataforma); por isso ali o
padrão de uma busca (`rg -n "cmdkey" src`), a mensagem e o `--grep` do git e o texto do `echo` (sem `$`, crase, `%`
ou parênteses) são texto, não caminho. Na cerca, o `@` do cmd sai antes da leitura, o
`if`/`for` do cmd que troca de pasta no mesmo segmento nega, e o `Set-Location` com outra opção que não `-Path`/
`-LiteralPath`/`-PassThru` vira pasta desconhecida.

## Limitações conhecidas

- O `taskkill /T` só vai à raiz quando o líder está na foto (a da vigia ou uma tirada na hora, com prazo de 2 s) e toda
  a árvore nasceu depois do seu pai; com filho mais velho, a raiz morre sem `/T` e os descendentes pelos vistos (pid +
  início, foto com prazo de 3 s). Sem foto nenhuma (o CIM falhou ou demorou) vai só a raiz, sem `/T` (não dá para provar a árvore com o pid
  reaproveitado); os descendentes saem pelos vistos da vigia. Os vistos só saem do arquivo da instância depois de uma
  foto que deu certo: sem ela, ficam para uma nova foto sem prazo, o `exit` do nod e o boot seguinte (revisão 14). O boot sem
  foto também não apaga o arquivo: os grupos anotados voltam a ele e esperam um boot com foto (revisão 14b). O `/T`
  exige o início do líder na foto dentro da janela do spawn, e o `taskkill` do Parar é assíncrono, com prazo de 1,5 s, num
  orçamento de 5 s antes de esperar o fim (revisão 16). No Linux, o boot sem `ps` também devolve os grupos ao arquivo.
- A guarda de credencial é lista negra: lê o comando como o bash o entrega (sem aspas e sem a `\` de escape, nas duas
  plataformas desde a revisão 14), mas não abre glob (`~/.a?s/…`, `n*/c*` a partir do Roaming), não junta string do
  PowerShell (`"$HOME\.a" + "ws…"`), não pega cópia em massa (`cp -r ~/AppData/Roaming`) nem `gh auth status -t`. A defesa
  firme da chave do nod é o caminho resolvido, não o texto (Fase 2).
- Neto que se desanexa (`start /b`, serviço) antes de ser visto (até 3 s) escapa do `taskkill`.
- Revisão 17 do PR #642: o Parar no Windows pode passar de 7 s quando o líder sai mas um neto segura o stdout (o
  `close` não chega e a espera do SIGKILL segue). E a cerca do git já tinha, desde antes deste PR, lacunas no Linux que
  continuam: `cd -P ../..`, `bash -c "cd ../.. && git …"` e `GIT_WORK_TREE=../..`. O `case … esac` com troca de pasta
  passou a negar nas duas plataformas.
- Revisão 19: a guarda de credencial não decodifica a aspa ANSI-C (`~/.a$'w's/…`, `$'\x2e'aws`), a mesma classe do glob
  acima. O `cd` sem `&&` agora pode falhar para a cerca (só segue se todas as pastas possíveis são do bot), e o eco por
  pipe deixou de ser texto livre no hook do win32.
- Revisão 22: por isso o monorepo com `cd packages/api && npm test; cd ../.. && git commit` nega (falso positivo
  consciente): se o primeiro `cd` falha, o `cd ../..` cai acima da pasta do bot, onde o git acharia outro repositório
  (o `~` com dotfiles). Basta `cd packages/api && npm test && cd ../.. && git commit`, ou o `git -C`. Parênteses entre
  aspas ou com `\` não abrem nem fecham o subshell da cerca.
- Revisão 23: a variável atribuída num subshell, num pipe ou no fundo não vale fora dele; o `(` no meio da palavra (o
  array `a=(1 2)`, o `@(…)`) não abre nem fecha subshell; e o comentário `#` com operador, atribuição ou troca de pasta
  nega quando há git no comando. A "falha fechada" do item 5 vale para o terminal: Read, Grep e Glob não pedem
  aprovação no modo default, então um hook que falha sem bloquear (estouro do teto, saída diferente de 2) deixa a
  leitura passar. O autoteste do boot e o `catch` que nega cobrem o caso comum; negar a leitura sem hook é Fase 2.
- Revisão 24 (lacunas que já vinham da main, fechadas nas duas plataformas): a `\` com a quebra de linha só continua
  a linha; `env`/`nohup`/`timeout`/`exec`/`command`/`sudo`/`doas` antes do git e `cd --`/`-L`/`-e` são lidos também no
  POSIX; o `-c` que roda um programa (`core.fsmonitor`, `core.hooksPath`, `core.sshCommand`, `diff.external`, pager,
  filtros…) só fica livre com o repositório na pasta do bot. Seguem abertos: as mesmas chaves por variável de ambiente
  exportada antes (`GIT_SSH_COMMAND`, `GIT_PAGER`), o `^` de continuação do cmd (sem Windows para provar) e as refs do
  clone da pessoa mexidas por `branch -f`/`update-ref` fora do clone da máquina.
- Revisão 25: o comentário `#` (no começo de uma palavra, fora de aspas) sai antes da leitura da cerca, como no bash e
  no PowerShell (no cmd é texto); a regra da revisão 23 que negava comentário com operador saiu (negava `# Commit (sem
  push)`). O `-c` que desliga o programa (`pager.diff=false`, `credential.helper=`, `core.pager=cat`) fica livre.
- Revisão 26: o `#` só comenta depois de espaço, quebra de linha ou `;&|(` (o `\r` solto do bash é parte da palavra) e
  o comentário acaba no `\r` ou no `\n`; o `<# … #>` do PowerShell some inteiro (sem `#>`, nega). O
  `protocol.*.allow` (o `ext::` roda programa) voltou a contar como `-c` que roda programa.
- Revisão 27: a `\` antes do `\r\n` não continua a linha (no bash ela escapa o `\r`; a revisão 24 escondia a linha
  seguinte da classificação, do envio e da cerca); o `#` logo depois do `)` comenta; o `\r` solto num comentário falha
  fechado; o `-p` do `time` é pulado. O `npx.cmd`/`npm.cmd` que vem com o Node (`SET "NPX_CLI_JS=%~dp0\…"`) vira node +
  script, sem cair no `.ps1` (o npm do prefixo, instalado por cima, fica de fora). Baixos aceitos, iguais aos da main no
  POSIX: o `g''it` e o `g\⏎it` (o filtro inicial lê o texto cru), o corpo do heredoc lido como comando no POSIX, o git
  que roda programa por `difftool -x`, `grep -O`, `difftool.*.cmd` e `core.gitProxy` e o `core.pager` com um shell na
  pasta do bot (o mesmo que um `bash script.sh`). Também ficam o `resolverBinario` do filho no PATH do nod (os drivers
  passam caminho absoluto) e o pid reaproveitado entre a foto do CIM e o `taskkill` sem `/T` (milissegundos).
- **Falha fechada no win32 (depois da revisão 27).** 27 rodadas acharam, cada uma, um caso de borda novo no parser (a
  mesma linha pode ser lida pelo PowerShell, pelo cmd ou pelo Git Bash). Decisão: parar de corrigir caso a caso. No
  Windows, o comando que cita git/gh (ou que monta um comando na hora: `iex`, `&`/`.` com aspas, `-enc`…) só passa se
  for o subconjunto simples (`foraDoSubconjuntoDoWindows`): programa e argumentos sem aspas no programa, separados
  por `&&` ou `;`, com aspas simples ou duplas fechadas. Nega `\r`, quebra de linha fora de aspas, `$`, `%`, `^`, crase,
  `#`, `( ) [ ] { } < > |`, `&` sozinho, `@` no começo da palavra, `\` que escapa, aspas coladas em aspas, `\` antes de
  aspas e qualquer shell ou embrulho fora de aspas (`bash`, `sh`, `cmd`, `powershell`, `pwsh`, `wsl`, `env`, `start`,
  `iex`, `xargs`…). O que passa pelo subconjunto segue pela cerca de sempre (pasta, `-C`, `--git-dir`, `-c`). O custo
  é o bot reescrever no Windows o `git log | head`, o heredoc do commit (use `-m`) e o `bash -c`; o teste com uma
  negação por classe das revisões 14 a 27 está em `caminhos.test.ts` ("falha fechada fora do subconjunto simples").
  Gatilho de reversão: se o atrito medido no Windows real (comandos negados por dia de bot) passar do que o bot
  consegue reescrever sozinho, abrir o subconjunto com um caso de cada vez, cada um com teste nas três leituras.
- **Revisão final e confirmações (depois da falha fechada).** No win32 também negam o `for %i` do cmd (mesmo sem git),
  o `Invoke*` (fora `Invoke-WebRequest`/`-RestMethod`/`-Pester`), `ScriptBlock`, o .NET que inicia processo
  (`[Diagnostics.Process]::Start`, `[type]`, reflexão, `Add-Type`), `ComObject`/WScript, WMI/CIM e `%x`. Nas duas
  plataformas, o programa com curinga ilegível (classe não trivial como `[[:alpha:]]`, `\` na classe, chaves
  `{gi,rese}t`, extglob, palavra com mais de 512 caracteres) nega, salvo nos programas que não executam argumentos
  (`ls`, `rm`, `cat`, `tr`…; `rg`, `sed`, `find`, `xargs` e `env` ficam de fora porque rodam programa). O git dentro de
  `<(…)`, `>(…)` e `$(…)` é lido como um comando à parte (`cat <(git -C outro reset --hard)` nega; o git de leitura no
  `$(…)` fica livre). O heredoc com muitos delimitadores é lido em tempo linear. QA: no win32 o git/gh só passa como
  programa do próprio segmento; como argumento de outro programa (`conhost git …`, `wt -d x git …`, `node -e "…git…"`,
  `forfiles /c "git …"`, `schtasks /tr`, `find -exec git`, `stdbuf git`) nega, mesmo entre aspas. No POSIX esses
  lançadores (`stdbuf`, `setsid`, `find -exec`, `script -qc`) seguem como na main, da classe do `bash script.sh`.
  QA 2: o git montado por variável, sem o texto git (`$'\147it'`, `$a$b`, o `$x` como programa, depois de um embrulho
  como `nohup`/`timeout` ou de `-exec`/`-c`/`-e`/`/c`), entra no subconjunto no win32 e nega pelo `$`. O `$` num
  argumento comum (`cd $HOME/x`, `ls $TMP`, `npm test -- $ARQ`) segue livre. No POSIX é a mesma lacuna da main.
- Bot cujo nome vira pasta que o NTFS não aceita (CON, NUL, `?`, `*`, ponto no fim…) roda sem o terminal no Windows: a
  limpeza do nome não mudou, para não mover a pasta dos bots que já existem no Mac e no Linux.
- O Codex fica sem terminal no Windows até a sonda (item de Desvios, ADR-103).
- O job `windows` da CI só vira obrigatório com a proteção da branch, que é configuração do repositório (de uma pessoa).
- Sem atualização automática, computador e app desktop: Fases 2–4, que dependem do Marlon. O instalador e a subida no login vieram na [ADR-151](adr-151-instalador-do-motor-no-windows.md).
- A chave fica em `%APPDATA%\nod-motor` com a ACL herdada do perfil (só o usuário, SYSTEM e Admins); `icacls` na Fase 2.

## Gatilho de reversão

Reavaliar WSL2 como alvo único se mais da metade das quebras da Fase 1 vier de shell/hook no Windows, ou se a sonda
mostrar órfão de processo frequente depois do Parar.
