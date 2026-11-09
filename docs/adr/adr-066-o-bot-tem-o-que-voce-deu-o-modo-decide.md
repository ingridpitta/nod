# ADR-066 — O bot tem o que você deu; o modo decide

Status: aceito · Data: 2026-10-01 · Emenda as ADRs 026, 037, 039, 042, 044, 047, 051, 052, 055, 058, 059, 062, 063
e 064. Revê a [ADR-065](adr-065-o-bot-sabe-o-que-tem-e-cada-task-na-sua-pasta.md): a linha "Terminal:" passa a
aparecer só no peer legado. Decisões do Marlon em 2026-10-01 (itens 5 a 7 e A a H da investigação "os Devs não
executam tasks").

## Contexto

O Marlon montou bots para trabalhar sozinhos: o Chico (Tech Lead) delega aos Devs, e as rotinas acordam os bots. Uma
investigação com três agentes, em 01/10, mapeou no código e no banco o que muda conforme QUEM dispara o turno: a pessoa
(conversa), uma rotina ou outro bot (pedido de colega). Foram 16 capacidades e 13 regras, e cerca de 130 turnos reais
esbarraram nelas desde 21/09:

- **Terminal, arquivos, web e skills** só existiam na conversa. Nenhum dos 71 turnos de rotina e de pedido de colega dos
  Devs tinha Bash; os 6 pedidos de implementar do Chico voltaram com "não tenho terminal". Nina, Milton e Clarice
  também esbarraram (cerca de 48 casos).
- **A rotina nascia "não confiável" pelo nome de um app na fonte** (GitHub, Gmail), e o catálogo perdia a escrita sem
  aviso. Foram 1.040 de 1.130 turnos de rotina até 30/09. A Clarice não mandava Slack nem punha label no Gmail na
  rotina (0 de 269 turnos, contra 67 de 67 na conversa), e o Chico não movia task no ClickUp na rotina de 10 min.
- **O gate da rotina e a trava herdada** negavam a escrita direta e mandavam refazer pelo `pedir_aprovacao`, que no
  automático e no total aprovava sozinho. O Dev 3 tentou três vezes um comentário em 30/09.
- **O pedido de acesso da rotina ignorava o modo:** era o único lugar em que o total ainda esperava um clique, e cada
  janela seguinte saía bloqueada até ele.
- **A continuação de rotina e de pedido de colega começava do zero.** Em 30/09, às 16:33, o Milton foi retomado 13 min
  depois de uma aprovação cujo comentário falhou. Leu a task, chamou `sem_novidade` e não refez nem avisou.
- **Computador, pastas, artefato e `ver_colegas`** ficavam fora do pedido de colega ou da rotina, quase sempre por
  "escopo da primeira versão", sem argumento de risco. As pastas nem tinham motivo escrito, e a emenda da ADR-039 dizia
  o contrário.

O Marlon: "Se eu criei um bot para acessar apps e dei as devidas permissões, eu não deveria adicionar mais uma camada
do que o bot tem ou não tem naquele turno. [...] EU NÃO QUERO BLOQUEAR TOOLS DE FORMA INVISÍVEL OU COM REGRAS DIFÍCEIS
DE ENTENDER."

## Decisão

**A regra inteira em três linhas:**
1. **O bot tem sempre o que você deu a ele**, em qualquer turno: conversa, rotina, pedido de colega ou sala. Nenhuma
   ferramenta some pelo tipo de turno nem pela confiança da entrada.
2. **O modo decide quando ele para e pergunta.**
   - **Manual:** tudo que muda algo vira card.
   - **Aprovar automaticamente:** faz sozinho e só para no arriscado: comando do terminal da lista, e apagar num app
     que ninguém pediu na conversa.
   - **Ignorar todas as aprovações:** faz tudo.
   - Nos três, a credencial do Mac para.
3. **Poucas cercas fixas, iguais em todo modo e sempre explicadas:** credencial do Mac, git fora da pasta do bot
   (ADR-065) e o limite de três passes entre bots (ADR-063).

**Depois de ler algo de fora** (página da web, e-mail, PR, app sem a curadoria de "da empresa" da ADR-062): o manual
pede, e o automático e o total seguem (decisão do Marlon). A marca vem do que o bot lê, e não do nome do app na
instrução: chamar um conector "de fora" marca o turno, como a web já marcava (0033). A marca só tira, no manual, a
regra "Sempre permitir" da pessoa. Quando um bot marcado pede a um colega, o turno do colega nasce marcado, e é isso
que substitui a trava herdada.

**No código:**
- **Catálogo** (`montarPlano`, `nativasDoTurno`):
  - o kit do terminal vale em todo modo menos o peer legado, com o harness Claude Code e o hook, e com qualquer
    confiança;
  - computador e `workspace_*` valem em todo modo menos o peer;
  - `catalogoReduzido` saiu do plano;
  - rotina e delegação ganham `ver_colegas`, e a delegação ganha o artefato, porque roda na conversa própria de quem
    recebe;
  - criar e mudar rotina continuam fora da rotina e da delegação: a rotina zera a corrente, e isso lavaria o limite
    de passes.
- **Saíram** o gate da rotina (`efeitoExternoSoPorAprovacao`, EMENDA 15), a trava herdada (`travaHerdada`,
  `travaDoPedido`), a confiança pela fonte da rotina (`confiancaDaFonte`) e a negação direta por gate, web ou merge
  (`chamarFerramenta`). A chamada direta passa pela mesma decisão do card (ADR-062), com o modo.
- **Modo** (`decidirPeloModo`): credencial → total → arriscado → automático. A versão da regra do automático sobe
  para 2, porque o conjunto de ações que ele deixa passar mudou.
- **Merge** (A1): não é arriscado, nem no terminal nem no app (`acaoArriscadaNoApp` agora é só "apagar"). No manual,
  merge e aprovar PR seguem pedindo e nunca viram "Sempre permitir" (ADR-047).
- **Gravar arquivo fora de `~/nod/<bot>`** (A2): segue o modo, como o comando. O hook manda `arquivo` ao servidor, e
  `autorizarComando` decide. No manual vira o card "Gravar <arquivo>"; dentro da pasta do bot, grava livre.
- **Acesso** (G):
  - a rotina pede leitura ou escrita como qualquer turno, e o modo concede;
  - o pré-voo concede pelo modo sem parar a janela (`decidirAcesso` com `semDisparar`);
  - conectar um app (login) continua sendo da pessoa.
- **Sessão** (C): a retomada de rotina ou de pedido de colega volta na sessão do turno que continua
  (`turnos.sessaoDoTurno`), se do mesmo executor. Nunca na sessão da conversa.
- **Rotina que só acorda com pendência** (item 7, migração 0045; **`so_com_pendencia` removido, NOD-317**, ver a emenda de
  2026-10-22):
  - `rotinas.so_com_pendencia`, em `criar_rotina` e `atualizar_rotina`;
  - sem pendência visível (ADR-064), a janela passa sem turno de modelo, com custo zero, e registra
    `sem_novidade`/`sem_pendencia`;
  - "Executar agora" sempre roda.
  - É a fila puxada: quem acorda o Dev é o pedido do Chico, já com terminal, e a rotina só retoma o que ficou pela
    metade.
- **Rótulo:** a nativa do kit que o CLI negou foi o hook (comando esperando aprovação, recusado ou numa cerca), e não o
  catálogo. O motivo passa a ser `alcance_insuficiente`. 5 das 6 falas "fora do catálogo" de 29 e 30/09 eram
  comandos esperando aprovação.
- **Prompt:**
  - o automático não diz mais que para depois de conteúdo de fora;
  - a delegação perde a linha da trava;
  - a rotina pede acesso "no nível que a tarefa exige";
  - o terminal ensina a worktree e diz que gravar fora da pasta segue o modo.

**Pedido de outra pessoa:** sempre passa por você, em qualquer modo. É a cerca da sala, decidida pelo Marlon. Hoje ela
não tem o que barrar:
- só a dona da sala posta nela (`postar-na-sala.ts:65`, travado em `postar-na-sala.test.ts`, "quem não é a dona →
  nao_permitido");
- não há procuração entre pessoas (0 linhas em `procuracoes` em 01/10).

Quando houver, ela entra como cerca, com o motivo no card.

## Alternativas descartadas

- **Abrir o terminal no pedido de colega e manter o resto como estava.** Era o item 5 original. O Marlon pediu a regra
  inteira mais simples: cada exceção por tipo de turno é uma camada que ele não vê.
- **Marcar a rotina como desconfiada pela fonte, com card explicando.** Continuaria uma regra por nome de app. A marca
  pelo que o bot leu é a mesma da web e vale em toda origem.
- **Merge como cerca fixa.** O Marlon recusou (A1). O manual do time diz "merge só com OK do Marlon", e isso fica como
  orientação para o bot, não como trava.
- **Cercar Write/Edit em qualquer lugar fora da pasta, em todo modo.** O Marlon escolheu o modo (A2), e a ADR-055 deu ao
  bot o Mac inteiro. Só o manual pergunta.

## Custo aceito

- **No total, nada para além da credencial.** Um texto de fora (e-mail, PR) pode mandar no bot. É o modo que o Marlon
  escolheu para os Devs e o Chico.
- **No automático, depois de ler algo de fora**, o bot age sem card. A ADR-059 parava aqui, e o Marlon decidiu que não
  para.
- **Terminal na rotina e no pedido de colega** roda no Mac do Marlon, com as credenciais dele, sem ninguém olhando. O
  que segura: o modo, a credencial, a cerca do git e o arriscado no automático.
- **O histórico curto das rotinas com pendência:** com rotina de 20 em 20 min, as execuções `sem_pendencia` ocupam as
  20 guardadas (cerca de 6,7 h).

## Validação

- `tests/unit/domain/regra-unica.test.ts`: o mesmo agente, com as mesmas concessões, tem os mesmos apps (escrita e
  merge), computador, pastas e terminal em conversa, rotina, delegação e sala, com entrada confiável ou não. O plano
  não carrega gate nem trava.
- `tests/unit/use-cases/regra-unica.test.ts`:
  - no automático e no total, um pedido de colega lê o Gmail e envia em seguida, sem card;
  - no manual, volta para o card;
  - ClickUp não marca o turno, e Gmail marca.
- `tests/integration/gravacao-fora-da-pasta.test.ts`: no manual, card "Gravar <arquivo>"; no automático e no total,
  grava, também na delegação marcada; credencial sempre para.
- `tests/integration/sessao-da-cadeia.test.ts`: a retomada de delegação volta na sessão do turno continuado, com o
  terminal; de outro executor, sessão nova.
- `tests/integration/rotina-so-com-pendencia.test.ts`, com 6 casos.
- Os testes de modo, plano, pedido de colega, acesso na rotina e personas foram reescritos para a regra nova.

## Gatilho de reversão

- **Incidente:** um bot apaga, publica ou faz merge de algo que ninguém pediu, por conteúdo de fora lido no turno.
  Voltar o "depois de ler algo de fora" para o automático (é uma linha em `decidirPeloModo`) e reavaliar o total.
- **Custo:** o terminal fora da conversa mais que dobra o custo diário dos Devs sem dobrar as tasks em "feita". Revisar
  as rotinas e o `so_com_pendencia` antes de cortar ferramenta.
- **Cerca:** a cerca do git ou o card "Gravar" no manual negam trabalho legítimo três vezes num dia. Revisar a regra da
  pasta (ADR-065).

## Não implementado

- **Conta de GitHub dos bots**, sem admin e com a main protegida. Precisa do Marlon; hoje o push sai pelo `gh` dele.
- **Anexos e mensagem literal da pessoa no segundo passe da corrente** (achados da investigação). Seguem parando no
  primeiro passe.
- **Pendências visíveis no pedido de colega.** A delegação anota, mas só vê a lista num turno de profundidade 0. Com a
  rotina `so_com_pendencia`, o Dev revê na rotina dele.
- **A cerca "pedido de outra pessoa"**, enquanto ninguém além da dona puder acionar o bot.

## Emenda de 2026-10-19: no Automático, conteúdo de fora volta a pesar, pelo revisor, só no envio para fora (Fase 4, PR 5)

Com a chave `NOD_REVISOR` ligada ([ADR-115](adr-115-automatico-com-revisor-na-ia-da-pessoa.md), seções do PR 3a e do
PR 5), o Automático que leu conteúdo de fora (a web, um e-mail, um app de fora; o turno, a entrada ou a conversa nas
últimas 24 h) manda ao revisor a ação que **envia algo para fora**: o comando (`enviaPeloTerminal`, PR 3a), o MCP da
pessoa (PR 3a) e a escrita num app que não é ler nem apagar (PR 5). É o que fecha o "o Auto obedece um e-mail" (o A3 do
protótipo) sem voltar à parada de antes desta ADR: o revisor libera o que a pessoa pediu e só o resto vira cartão. Ler,
comentar o que a pessoa pediu num turno limpo e o resto que esta ADR soltou continuam soltos; o manual e o total não
mudam. Com a chave desligada, esta ADR vale como estava. O gatilho de reversão "Incidente" acima passa a apontar para o
revisor (o gatilho de reversão da ADR-115) antes de mexer em `decidirPeloModo`.

## Emenda de 2026-10-22: `so_com_pendencia` removido (NOD-317)

O item 7 sai junto com as pendências do bot ([ADR-064](adr-064-pendencias-do-bot.md), removida em 19/10, decisão na
NOD-232). O PR 1 (#417) tirou a opção de `criar_rotina`, `atualizar_rotina`, `listar_rotinas` e `ver_colegas`, e o
disparo agendado voltou a rodar em toda janela. A migração 0101 (PR 2) avisa na conversa das rotinas que tinham a
opção, garante que elas ficam pausadas (só voltam se a pessoa reativar) e apaga a coluna `rotinas.so_com_pendencia`.
As execuções antigas com motivo `sem_pendencia` ficam no histórico como texto livre e aparecem como "sem novidade".
A fila puxada continua: quem acorda o Dev é o pedido de colega; a retomada do que ficou pela metade passa a ser
`me_chame_as` ou `esperar_comando`.
