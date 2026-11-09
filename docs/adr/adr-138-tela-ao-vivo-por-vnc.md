# ADR-138 — A tela do computador do bot é ao vivo (VNC) quando a pessoa está no controle

Status: aceita (2026-10-29, NOD-95) · Emenda a [ADR-037](adr-037-computadores-por-bot.md) ("screenshots periódicos, não
streaming" sai), [ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md) (a tela ganha o x11vnc; a mensagem `vivo`
no socket de controle) e [ADR-021](adr-021-ponte-maquina-local.md) (um canal contínuo motor → servidor, ainda sem o
servidor discar).

## Contexto

Com a pessoa no controle, a tela cheia mostrava uma captura (scrot → PNG → base64) a cada 2 s, e cada clique, tecla ou
rolagem virava uma ação: transação com trava, registro, reserva, fila da máquina (long-poll de 250 ms), socket, IPC,
xdotool e uma captura de volta — seis saltos por quadro. A ADR-037 exclui streaming de propósito. No primeiro ensaio
real no Mac (29/10/2026) o Marlon tentou rolar uma página e desistiu: "impossível usar". A referência de produto (Grok
Bot) mostra o desktop inteiro ao vivo, com "Take control", e a pessoa usa como um computador remoto.

## Decisão

1. **No controle, a tela é ao vivo; assistindo, continua nas capturas.** A tela cheia (web/telas/tela-cheia.ts) pede o
   ao vivo quando a pessoa assume e o desliga quando devolve, fecha ou perde o controle por fora. Teclado, mouse e
   rolagem vão pelo VNC, sem passar pelas ações; as ações de antes seguem valendo e são o caminho de volta quando o ao
   vivo não liga ou cai. Assistindo ao vivo, áudio e compartilhar com outra pessoa ficam fora.
2. **O protocolo é o VNC (RFB) do próprio Xvfb da tela**, servido pelo `x11vnc` que a tela sobe no primeiro pedido, só
   num socket unix (`-unixsock /tmp/nod-vnc-<display>.sock`, `-rfbport 0 -rfbportv6 0`, no `/tmp` privado da unit do
   supervisor, fora do bwrap das telas): sem porta TCP, porque outra tela, que vê a rede, enxergaria esta. O cliente é o noVNC (MPL-2.0, THIRD_PARTY_NOTICES.md), carregado só ao assumir. Transmitir só a
   janela do Chrome pelo CDP (como o OpenMausBot) foi descartado: não mostra o desktop com dock, que é o alvo (NOD-96,
   NOD-410).
3. **O canal é um WebSocket de saída do motor.** O servidor não disca (ADR-021): a web abre
   `wss://…/api/t/:t/agentes/:id/computador/vivo` (cookie, tenant do caminho, `Origin` do mesmo host, como a mídia da
   voz); o servidor cria a sessão (id + token de uso único), manda o comando assinado `vivo` à máquina pela fila de
   sempre, e o motor abre `wss://…/api/maquina/computador/vivo/:sessao?t=token` de volta. O servidor pareia os dois e
   só repassa bytes; não interpreta nem guarda quadro nenhum (a regra da ADR-037 sobre não gravar a tela da pessoa
   continua). O token, não a chave da máquina, autentica o motor: o WebSocket global do Node e do Electron não leva
   header próprio, e o token nasce no comando assinado que só a máquina certa recebe.
4. **No socket de controle, `vivo` muda o que a conexão é.** O motor abre uma conexão só para isso e manda
   `{tipo:"vivo", comando}`; aceita, essa conexão vira o fluxo cru do VNC (os estados param de chegar nela); recusada,
   fecha. O supervisor só serve a tela já aberta ou abrindo (5ª revisão: a web a abre pela captura antes; um `vivo` atrasado
   que chega depois do `fechar_tela` do Parar é recusado com `tela_alterada` em vez de reabrir a tela) e, enquanto o fluxo
   corre, toca a tela a cada 30 s: para a régua e para o varredor de ociosidade do servidor, a pessoa ao vivo é ação.
   No Mac (ADR-127) nada muda: é o mesmo `ctl.sock` encaminhado pelo Lima, sem porta nem mount novo.
5. **Só com a pessoa no controle.** O portão (`computadores.vivo`) exige `controle = pessoa`, computador no ar e sem
   operação em curso, como as ações da pessoa; devolver ou parar encerra as sessões ao vivo da tela (`fecharDaTela`).
   O bot já está parado pelo controle; o ao vivo não entra na reserva das ações. Revisão do PR #599: o
   "iniciar" também encerra (assumir não, porque a pessoa segue no controle); cada sessão pareada reconfere o controle, a tela aberta e o computador no ar a cada 10 s (cobre a corrida entre o portão e o
   pareamento); no máximo 2 sessões por pessoa e tela (a mais antiga cai); e o repasse tem contrapressão (o motor pausa
   o VNC com 4 MiB na fila do WebSocket; o servidor derruba o lado que passa de 8 MiB sem ler).
6. **A retomada pelo bot (definido em 2026-10-29 no 1º ensaio, restrito na revisão do PR #599).** Com a pessoa no
   controle, o bot só retoma quando o turno é um pedido NOVO dela: turno da pessoa (`daPessoa`, ADR-131) nascido de mensagem
   dela (origem conversa; a `retomada` automática não conta; hoje os turnos de sala e de ligação não levam a mensagem de
   origem e por isso não retomam, do lado seguro) cuja mensagem de origem foi escrita pela
   própria pessoa dona do computador depois do último "assumir" daquele computador ou tela (3ª revisão: a data é a da
   mensagem, não a do turno, porque a repetição por cota ou troca de IA reenfileira com data nova; e a fala de um bot na
   sala não conta), e sem pedido de ajuda do bot aberto. O Parar também é
   freio (4ª revisão): a mensagem de antes dele não retoma, e o ao vivo não reabre a tela parada até um assumir novo. Retomar devolve o controle ao
   bot, encerra o ao vivo dela e deixa "retomou o computador" na Atividade. Rotina, colega, frente, o turno que já
   corria quando ela assumiu e o pedido de ajuda seguem em `aguardando_pessoa` (ADR-037: o Assumir é o freio dela).

## Consequências

- Rolar, arrastar e digitar ficam como num computador remoto; a captura de 2 s segue para quem assiste e para o bot.
- Um dependência nova de runtime na web (noVNC) e um pacote novo na máquina (`x11vnc`, no `PACOTES_DO_COMPUTADOR`).
  Máquinas instaladas antes não têm o x11vnc: o `vivo` falha com `faltam_pacotes` e a tela cheia fica nas capturas,
  até o instalador rodar de novo (idempotente).
- O servidor passa a ter sessões de WebSocket pareadas em memória; um reinício as derruba e a web volta às capturas.
- O teto de 64 KiB por mensagem do WebSocket vale: o motor parte o fluxo em pedaços de 32 KiB.
- Dock (NOD-410, PR #600, 30/10): o tint2, os Arquivos e o Terminal rodam num bwrap próprio (userns sem
  capacidades, o padrão do bwrap sem setuid; no host o processo segue sendo `nod-pc`), com só o workspace gravável, uma pasta privada do dock (lançadores e config, recriada a cada subida; o HOME fica no `/tmp` do bwrap, ver abaixo) e o socket X desta tela. O resto do sistema fica visível só para leitura (`--ro-bind / /`, como o Chrome via `file://`); a raiz dos computadores, o perfil do Chrome e o run dos computadores (`/run/nod-computador*`) ficam escondidos; o resto do `/run` fica visível só para leitura (um socket ali, como o do dbus do sistema, segue conectável, como para qualquer processo `nod-pc`), e a unit mantém `ProtectHome` e `ProtectSystem=strict` (revisão 4 do PR #600).
  Ficam fora o perfil do Chrome, os logins, o tmp da tela e o bus do keyring. **Risco aceito:** o display é o mesmo do
  Chrome (é o desktop que a pessoa vê), então um processo do terminal pode mandar teclas e ler a tela do Chrome pelo X,
  como a própria pessoa no VNC. E o terminal roda como `nod-pc`, não como `nod-pc-term`: o isolamento dele é o do bwrap.
  O bot não alcança o dock: com ele de pé, a tela recusa clique e arrasto do bot na faixa do dock e, antes de clicar,
  digitar, teclar ou rolar, devolve o foco ao Chrome, e a entrada vai no mesmo processo do xdotool que reativa a janela
  dele (`windowactivate --sync` e a tecla juntos, revisão 7): o Terminal ou os Arquivos que a pessoa deixou na frente
  não recebem a entrada do bot, salvo um clique da pessoa no mesmo milissegundo. A trava vale só contra o bot (revisão
  10): a ação da pessoa no controle (o caminho de volta quando o ao vivo cai) chega à tela com `pessoa: true` no comando
  assinado e usa o dock e o Terminal como no VNC. A captura do bot (o `observar` e a tela que volta de cada ação) traz o
  Chrome para a frente antes (revisão 12): o Terminal e os Arquivos que a pessoa deixou abertos, com um token na tela,
  não vão para o modelo. O bot nunca olha com a pessoa digitando no VNC (revisão 27): o ao vivo e a entrada da pessoa
  só existem com `controle = pessoa` e sem operação em curso (`computadores.vivo`), e com esse controle a ferramenta do
  bot volta `aguardando_pessoa` antes de chegar à tela (src/adapters/fundo/computadores.ts). Nenhuma entrada nova da pessoa
  chega ao display enquanto ele age, então o foco no Chrome e a captura não correm contra um clique dela no Terminal.
  Os programas que ela deixou abertos seguem vivos (revisão 28): uma janela deles por cima do Chrome (um menu aberto,
  um terminal "sempre no topo") entra na captura, porque a máscara olha o retângulo do Chrome e não a pilha. Risco
  aceito: o tint2 não mostra dicas (`launcher_tooltip` e `task_tooltip` em 0) e o foco no Chrome fecha os menus comuns. Se um
  dia o bot puder agir com a pessoa ao vivo, a captura não pode mais ativar janela: passa a ler a pilha
  (`_NET_CLIENT_LIST_STACKING`) e devolver preto com outra janela por cima. **Risco aceito 2:** o que a pessoa roda no Terminal divide o cgroup e os limites da unit do
  supervisor (sem `TasksMax` nem memória por tela): um processo pesado dela degrada as outras telas, como faria no
  próprio computador. Gatilho: se o terminal do dock passar a rodar algo que a pessoa não digitou (automação do bot),
  ou um incidente de recurso vier dele, mover o dock para o `nod-pc-term` com display e escopo (`systemd-run --scope`,
  `TasksMax`, `MemoryMax`) próprios.
  Revisão 6 do PR #600: HOME, TMPDIR e cache do dock ficam no `/tmp` do bwrap dele, um tmpfs com teto de 64 MiB
  (`--size`), e não na pasta do dock no `/run` da máquina, que um arquivo grande no Terminal enchia para todos. Na
  revisão 10 a pasta do dock entra só leitura e o lançador do Chrome escreve num FIFO dela (não grava nada no `/run`). Os
  Arquivos (pcmanfm) sobem com `quick_exec=0`: um script ou `.desktop` que o bot gravou no workspace não executa com dois
  cliques sem o libfm perguntar. **Risco aceito 3:** se a pessoa escolher executar, ele roda como o Terminal (mesmo
  display do Chrome). Mesmo gatilho do risco 1.
- Cookies com o Chrome que fecha e relança (PR #600, revisões 4 a 12): a tela sincroniza os cookies a cada 10 s e
  ~1 s depois de cada navegação da aba (o logout costuma navegar), e as operações deles passam por uma fila, cada
  chamada ao Chrome com prazo (revisão 10: um Chrome congelado não prende a abertura, as ações nem o fechar). Os
  prazos da tela cabem nos do supervisor (revisão 12): o fechar da tela fica em 13 s dos 15 s antes do SIGKILL, o
  relançamento fecha o Chrome antigo em até 4 s e o Sair de todos espera até 45 s por tela (pode relançar o Chrome). Cookie
  removido sai pelo CDP (`Network.deleteCookies`, chave exata), não pelo `clearCookies` com filtro do Playwright, que
  apaga tudo e devolve o resto e perderia um Set-Cookie do site no meio. No relançamento valem a foto conhecida, as
  lápides (o logout que o disco não gravou não volta) e a validade maior. Se o foco precisou voltar ao Chrome, a ação
  com quadro falha com `tela_alterada` (o bot tinha visto outra janela). **Risco aceito 4:** o logout (cookie
  persistente ou de sessão) que a pessoa faz sem navegar, ou com o Chrome caindo antes do envio (até 10 s sem
  navegação, ~1 s com), fica só local; a loja segue com o cookie e o relançamento ou a próxima subida da tela o traz.
  Gatilho: um relato de login que voltou sozinho.
  **Risco aceito 5** (revisão 13): no relançamento depois de um crash, o cookie persistente que a tela conhecia e o
  perfil em disco não tem (o Chrome grava a cada ~30 s) não volta: o relançamento não distingue o login que não chegou
  ao disco do logout que a pessoa fez pelo VNC e a sincronia não pegou. Este bot fica deslogado no site até a tela
  reabrir com a loja; os outros seguem logados. Gatilho: um relato de bot deslogado depois de a pessoa fechar o Chrome
  pelo dock. O Chrome antigo que não fecha em 4 s é morto (o PID do bwrap, só se for filho da tela) e, se nem assim
  sair, o relançamento falha em vez de abrir um segundo Chrome no mesmo perfil. Cada pedido tem um prazo total dentro
  da tela (50 s na ação, 40 s no Sair de todos): passou, volta `sem_resposta` antes do SIGKILL do supervisor.
  Revisões 14 a 16: o pedido que passou do prazo ganha uma graça (~8 min, o pior caso somado de um relançamento do
  Chrome e do resto da ação), em que os pedidos novos voltam `ocupado` na hora (revisão 17: não conta para a saúde) em vez de enfileirar atrás dele
  (não rodam fora de hora depois de o bot os dar por falhos); se nem assim termina, a tela se dá por presa, fecha com 4 s de prazo e sai, e o supervisor a reabre na
  próxima ação (o VNC da pessoa cai e o que não sincronizou nesses 4 s se perde). Antes de relançar, a tela espera o
  processo do Chrome anterior sair (o `close` do dock vem da desconexão). O openbox tem teclado, mouse e menu
  explícitos (nenhum menu alcançável) e os programas do dock (Arquivos, Terminal, xdg-open) somem atrás do /dev/null
  no bwrap do Chrome e do openbox: só o dock os abre, e só com o workspace.
  Revisão 17: o clique e o arrasto do bot só valem dentro da janela do Chrome (a geometria lida pelo xdotool depois do
  foco), sem o botão do meio (cola a seleção primária, que pode vir do Terminal); a rolagem leva o ponteiro ao Chrome.
  Revisão 18: depois que a pessoa mexe (ao vivo ou ação dela), a 1ª ação do bot esvazia a área de transferência e a
  seleção primária do X: o que ela copiou no Terminal não chega ao bot por ctrl+v nem pelo menu Colar do Chrome.
  No fechar da tela, o Chrome fecha com o que sobra do orçamento de 12 s (no caso comum ~10 s), não com 2 s fixos.
  Revisão 19: o quadro que o bot observou é conferido de novo depois que a tela garante o Chrome (um relançamento
  invalida o quadro antigo).
  Revisão 20: a pasta do dock (scripts, lançadores, tint2rc, cookie X) fica ao lado do tmp da tela, nunca dentro: o tmp
  entra com escrita no bwrap do Chrome, e o bot reescreveria o script do Terminal que roda quando a pessoa clica nele.
  A captura do bot com o dock mostra só a janela do Chrome: o resto (a faixa do dock, o Terminal e os Arquivos) vai
  preto; sem a geometria da janela, a captura inteira vai preta.
  Revisão 21: a captura crua também fica ao lado do tmp (o Chrome a abriria por `file://`) e é apagada depois de lida.
  Com o dock, o Chrome nega `clipboard-read` a todas as origens (pela sessão CDP do navegador, mantida aberta: o Chrome
  desfaz a negação quando ela é solta) e as páginas ficam sem `getDisplayMedia` (init script; o Chrome não guarda
  negação de captura de tela). Risco residual: o documento inicial (about:blank) de um iframe recém-criado ou de um
  popup aberto por `window.open` pode escapar do init script; a política gerenciada `ScreenCaptureAllowed=false`
  fecharia isso, mas precisa de root no host (fica para o instalador).
  Revisão 22: a máscara corta a janela do Chrome na altura dele (o tint2 fica por cima, e um Chrome que desce até a
  faixa levaria os títulos das tarefas ao bot), e o tint2 não mostra tooltip de tarefa. Risco aceito: a página ainda
  escreve na área de transferência (`clipboard-write` é concedido sem gesto em muitas origens); o que a pessoa colar
  no Terminal passa pelo bracketed paste, que não executa a linha sozinho.
  Revisão 23: só a entrada da pessoa (clicar, arrastar, digitar, tecla, rolar) esvazia a área de transferência antes
  do bot; assistir não. Sem janela do Chrome no `observar`, a captura do bot vai preta em vez de falhar.
  Revisão 24: com o ao vivo aberto, a pessoa copia pelo VNC sem passar pela tela. Ao fim de cada ação do bot a tela anota
  a impressão (sha256) da área de transferência e da seleção primária; se mudou até a próxima ação dele, ou a leitura
  falhou, as duas são esvaziadas antes. Risco aceito: o que a pessoa copiar nos ~100 ms entre a ação do bot e a anotação
  passa como se fosse do bot.
  Revisão 25: a corrida já conhecida do reinício forçado (o `fechar` da tela antiga apaga o tmp da nova) agora leva
  também os vizinhos (`.dock` e `.tela.png`): a tela nova fica sem dock até subir de novo e a captura em curso falha;
  nada vaza, porque o que some é recriado só pela tela dona.
  Revisão 26: o mesmo risco aceito vale na outra ponta: o que a pessoa copiar entre a conferência da impressão e o
  `ctrl+v` do bot também passa. Revisão 27: a conferência é o último passo antes do xdotool (depois do foco e da
  geometria); a brecha é a da própria chamada do xdotool. Com o portão do controle acima, só a sessão ao vivo que ainda
  não caiu no instante da retomada a alcança.
  Revisão 29 (QA): gravar a seleção (esvaziar ou o `digitar`) não espera mais o filho do `xclip` que fica dono dela; pelo
  `execFile` cada gravação levava o prazo inteiro (25 s) e a guarda estourava o prazo da ação. A guarda lê só o texto:
  copiar só um arquivo (uri-list) ou uma imagem não muda a impressão (risco aceito, baixo: o bot cola por ctrl+v num
  campo de texto do Chrome). O bwrap do dock não isola a rede: o Terminal é o da pessoa, como no computador dela. A ligação dos relatos da VM ao preparo (`ligacaoDaVm`) ganhou teste próprio.

- O ensaio manual da tela ao vivo (`scripts/ensaio-computador/vivo.ts`, NOD-433) usa o login stub e só roda fora de CI e
  contra loopback, salvo `NOD_ENSAIO_REMOTO=1`. Ele não assume nem devolve a tela do bot que pediu ajuda: isso fecharia
  o pedido e retomaria o turno com um passo que ninguém fez. Ele fecha na dúvida: sem a lista de telas, ou sem a tela do
  bot depois de abri-la, não segue. Por isso recusa o computador dedicado (sem telas por bot); o ensaio é para o
  computador da pessoa.

## Gatilho de reversão

- Mais de 1 em 5 sessões ao vivo caindo em 14 dias (log `computador_vivo_*`): rever o transporte (parear por WebRTC ou
  trocar o VNC pelo screencast do Chrome).
- O x11vnc passando de 25% de uma CPU com a pessoa parada na tela: trocar por um encoder com detecção de mudança.
