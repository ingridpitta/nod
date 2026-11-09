# ADR-065 — O bot sabe o que tem neste turno, e cada task na sua pasta

> Emendada pela [ADR-147](adr-147-motor-no-windows-nativo.md): a cerca do git no Windows.

Status: aceito, revista pela [ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) no mesmo dia (o terminal
vale em todo modo, então a linha "Terminal:" só aparece no peer legado; os itens 5 e 7 abaixo foram feitos lá);
emendada pela [ADR-088](adr-088-limpeza-das-pastas-de-task.md) em 2026-10-09 (o `worktree add` também é cercado: a
worktree nasce na pasta do turno, a da task quando há task, e sai quando a task acaba) ·
Data: 2026-10-01 · Emenda a [ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) (o git que mexe
na pasta de trabalho só roda dentro de `~/nod/<bot>`) e a [ADR-052](adr-052-o-kit-do-terminal-com-o-nod-decidindo.md)
(o prompt diz por que o terminal falta). Itens 8 e 6 da investigação "os Devs não executam tasks", aprovados pelo
Marlon em 2026-10-01.

## Contexto

O Marlon montou o Chico (Tech Lead) e quatro Devs para trabalharem sozinhos: o Chico indica a task, o Dev implementa.
Medido no banco diário entre 28 e 30/09:

- **O terminal só existe em conversa.** `nativasDoTurno` só liga o kit em conversa ou criação confiável. Dos 71
  turnos de rotina e de pedido de colega dos Devs, nenhum tinha Bash; dos 54 de conversa, todos tinham. Os 6 pedidos
  de implementar do Chico em 29 e 30/09 voltaram com "neste turno não tenho terminal".
- **O bot não sabe por quê, e a crença errada se espalha.**
  - O Dev 4 escreveu que "o catálogo muda de turno para turno".
  - O Marlon perguntou cinco vezes, a cinco bots, "como eu faço para te desbloquear"; nenhum soube responder.
  - Às 22:50 a Clarice gravou na memória "Dev 3/Dev 4 não têm terminal nem permissão de push no GitHub".
  - Às 23:27 o Chico disse ao Dev 4 que o bloqueio continuava porque o Dev 4 "estaria sem terminal". A frase vinha de
    um comentário de horas antes, e naquele momento o Dev 4 já tinha o terminal na conversa com o Marlon.
  - Uma varredura no banco desde 21/09 achou cerca de 10 turnos (Chico, Clarice, Milton, Dev 1, Dev 3) que tratam um
    corte por desenho como "a ferramenta caiu".
- **Os clones da pessoa são um só por repositório.** Com o terminal na conversa, o Dev 4 ia implementar em
  `~/code/acme/main-repos/acme`, o mesmo clone em que o Marlon e os outros Devs trabalham. O terminal do bot é o do
  Mac da pessoa (ADR-055). O primeiro `git switch` de um Dev trocaria a branch do outro no meio do trabalho.

## Decisão

**1. O turno sem terminal diz por quê.** `motivoSemTerminal` (nativas.ts) sai da mesma regra de `nativasDoTurno`:
- devolve null quando o turno tem o terminal ou quando o harness nunca o teria (Codex, máquina sem o hook);
- devolve `conteudo_de_fora` quando o mesmo modo, com entrada confiável, teria o terminal;
- nos outros casos, devolve o modo: pedido de colega, rotina, sala ou resposta a colega.

Com o motivo, o prompt ganha a linha "Terminal:", classificada pelo Raio-X em `ferramentas`. Ela diz:
- o motivo, e que no nod o terminal vem nos turnos que a pessoa abre na conversa;
- que não é falha e não volta no meio do turno;
- para fazer o que der, anotar com `anotar_pendencia` a parte que precisa de terminal e dizê-la a quem pediu;
- para não guardar "sem terminal" como fato.

Se a regra das nativas mudar, o motivo acompanha sem tocar no prompt.

**2. O que um colega diz que não tem vale para o turno dele.** A linha de colaboração ganha essa frase, para todo bot
que tem `pedir_a_bot` ou `ver_colegas`.

**3. Capacidade do turno não vira memória.** O `lembrar` do bot recusa a frase que nega terminal, arquivos, pastas,
skills, computador ou pedir a colega, ou que fala do turno ou do catálogo (`falaDeCapacidadeDoTurno`). Volta
`{ ok: false, recusado }` com o motivo, no mesmo padrão do argumento recusado do `pedir_aprovacao` (ADR-062).
- Acesso a app não entra: concessão é do bot, não do turno.
- A pessoa grava pela tela o que quiser.

**4. Git que mexe na pasta de trabalho só dentro de `~/nod/<bot>`.** O hook do nod nega o comando antes do servidor e
em qualquer modo de aprovação, como faz com credencial (`gitForaDaPastaDoBot`). Vale para:
- `git checkout`, `switch`, `commit`, `merge`, `rebase`, `reset`, `pull`, `stash`, `cherry-pick`, `revert`, `am`,
  `apply`, `restore`, `clean`, `add`, `rm` e `mv`;
- `gh pr checkout`.

A pasta vem do `cwd` do evento do Claude Code, do `cd`/`pushd` anteriores na mesma linha e do `-C`/`--work-tree`. A
mensagem ensina o caminho: `git -C <clone> worktree add "~/nod/<bot>/<repo>-<task>" -b <branch> origin/main`.
Continuam livres no clone da pessoa o que só lê, o `fetch`, o `push` e o `worktree add`, porque é por eles que a
worktree nasce. O driver grava `pastaDoBot` e `home` na configuração 0600 do hook. Config de driver antigo, sem os
dois campos, não liga a cerca.

## Alternativas descartadas

- **Decidir a pasta no servidor (`autorizarComando`).** No modo compartilhado o servidor não conhece os caminhos do Mac.
  O hook é local e já decide credencial.
- **Pedir aprovação em vez de negar.** No modo total, que é o do Chico e dos Devs, o card sairia aprovado sozinho. O
  certo não é perguntar à pessoa, é usar uma worktree.
- **Cercar também Write e Edit em clone alheio.** Saber se um caminho está num repositório exige o disco, e a ADR-055
  deu ao bot arquivos no Mac inteiro por escolha do Marlon. Fica para a decisão do terminal fora da conversa.

## Custo aceito

- A linha "Terminal:" custa cerca de 600 caracteres nos turnos de rotina, delegação e sala do harness Claude Code.
- Um git que a pessoa pedir na conversa para rodar no clone dela também é negado. O bot faz numa worktree e abre o PR.
- O reconhecimento de frase é por padrão. Uma memória legítima que negue terminal em outro sentido não grava.

## Validação

- `tests/unit/domain/sem-terminal.test.ts`: motivo por modo; linha na delegação, com remetente e pendência; na rotina,
  sem `anotar_pendencia`; frase de colaboração; frases reais de 30/09 recusadas e memórias de processo aceitas.
- `tests/unit/domain/git-na-pasta-do-bot.test.ts`: `cd`, `-C`, `cwd` e o commit com heredoc do Claude Code; worktree com
  espaço no nome; o que passa no clone; pasta que depende do shell; o hook negando antes do servidor e o config antigo.
- `tests/integration/memoria.test.ts`: o `lembrar` recusa a frase da Clarice sem gravar nem emitir evento; a pessoa grava.

## Gatilho de reversão

- **A cerca nega trabalho legítimo.** Três negações num dia para comando dentro de `~/nod/<bot>`, vistas na trilha do
  turno: revisar `gitForaDaPastaDoBot` antes de mais cercas.
- **A linha não muda a fala.** Uma semana depois do deploy, ainda aparece "a ferramenta caiu" ou "sem terminal" como
  fato em mais de 5 turnos: a linha não basta, e o caminho é dar o terminal (decisão em aberto, abaixo).

## Revisão de 2026-10-11: o gatilho disparou

O primeiro gatilho de reversão disparou sem ser visto. A pílula da conversa diz "alcance insuficiente — peça
aprovação" para toda nativa negada, e o motivo de verdade só chega ao modelo.

O Marlon perguntou por que o Ze 1 teve "Bash negada". Para responder, as sessões dos bots foram varridas: o
`tool_result` de cada `PreToolUse:Bash hook error: nod: …` foi casado com o comando que o gerou. O resultado:

- 482 negações: 161 na VM, de 09/10 a 11/10, e 321 no Mac, de 28/09 a 09/10.
- 177 eram "numa pasta que não deu para conferir". Em 167 delas, o comando dava valor à variável e a usava em
  seguida, como em `T=~/nod/"Ze 1"/<task>; git worktree add "$T/pr757"`. O `resolver` desistia de todo `$`.
- O Ze 1 tropeçou 82 vezes só na VM.

**Mudança:** `gitForaDaPastaDoBot` passa a ler as variáveis que o próprio comando definiu:

- **Formas aceitas:** `NOME=valor` depois de `;`, de `&&` ou no começo; `export`, `local` e `readonly`; `$PWD`, que é a
  pasta naquele ponto; e `$HOME`.
- **Formas que continuam sem valor:** variável de laço; atribuição depois de `||` ou num pipe; o prefixo
  `W=x git -C "$W"`, que o shell expande antes de atribuir; e a variável entre aspas simples.

Com as negações reais reaplicadas, 144 das 177 passam. Nenhuma das 53 que eram "fora da sua pasta" passou.

**Buraco fechado no mesmo PR:** o git depois de `do`, `then` e `else` (`for …; do git checkout …; done`) não era
conferido, porque a cerca via `do` como o programa.

**Próximo passo, fora deste PR:** a fronteira de escrita aplicada pelo sistema operacional (o sandbox do Claude Code,
que já trata a worktree, e o `workspace-write` do Codex). Ela tira do nod a leitura de shell como texto, que nunca
fecha. O assunto fica para uma ADR própria, porque a ADR-055 recusou o sandbox por causa da rede.

## Não implementado

- **Terminal, pastas, computador e artefato fora da conversa** (item 5). A investigação de 01/10 mapeou 16 capacidades
  e 13 regras que mudam com a origem do turno. A decisão é do Marlon.
- **Rotina que só acorda com pendência** (item 7). Depende do item 5: retomar o que ficou pela metade só serve se a
  rotina tiver como fazer.
- **Conta de GitHub dos bots**, sem admin e com a main protegida. Precisa do Marlon para criar a conta; hoje o push sai
  pelo `gh` dele.

> **Revisto em 2026-10-22 ([ADR-119](adr-119-clone-da-maquina-por-repositorio.md), NOD-315):** na máquina Linux, a frente com repo faz a worktree a partir do clone da máquina (`~/nod/.clones/<dono>/<nome>.git`, bare), não de um clone na própria pasta. A worktree segue dentro da pasta da task; o clone é do nod e não sai com a limpeza.
