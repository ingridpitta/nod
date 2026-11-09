# ADR-142 — Passagem por coluna: a coluna tem responsável, e entrar nela aciona

Status: aceita (2026-11-02, NOD-417; a PM aceitou na revisão do PR #622) · Revisa a [ADR-140](adr-140-colunas-do-quadro-por-grupo.md) (decisão 2: quem é acionado).

## Contexto

Na ADR-140 a coluna só dizia o comportamento pelo grupo; quem trabalhava era sempre o responsável da tarefa. Para um
fluxo em etapas (fazer → revisar → testar), a pessoa precisava mudar o responsável à mão a cada passo. O pedido é a
passagem no estilo Multica: cada coluna pode ter um agente e uma instrução, e a tarefa que entra nela vai para ele.

## Decisão

1. **A coluna ganha `responsavel` (id de agente ou null) e `instrucoes` (até 500).** Ficam no mesmo jsonb
   `quadros.colunas`, sem migração; coluna sem os dois campos é igual a antes, e as padrão continuam "padrão" só sem
   eles. Só aceitam passagem as colunas de não iniciado e de andamento (Backlog, A fazer, Fazendo, Revisão e as da
   pessoa nesses grupos); Bloqueado, Precisa de você, Cancelado, Feito e Fechado nunca têm (`aceitaPassagem`).
2. **Entrar numa coluna com responsável passa a tarefa a ele; ele é acionado só onde a coluna aciona**
   (`acionaNaColuna`, emendado na revisão 3 do PR #622): A fazer e as colunas de andamento, inclusive Revisão. Em Não
   iniciado só A fazer aciona: no Backlog e nas colunas da pessoa desse grupo a tarefa passa ao responsável sem
   acioná-lo, e entrar nelas para o turno vivo da tarefa. A tarefa fica na coluna (Revisão não vira Fazendo); A fazer
   segue levando ao andamento, como na ADR-140 ("entrar em A fazer aciona" fica). O passo que nomeia um agente explicitamente vence a passagem. As tarefas que já estavam na
   coluna quando a passagem foi definida não mudam de mão. O bot que move a própria tarefa para a coluna que já é dele
   não se reaciona (só pelo `terminei`).
3. **`terminei`** fecha a etapa: a tarefa vai para a próxima coluna da ordem (pulando Precisa de você, Bloqueado e
   Cancelado) e, se ela tiver responsável, ele começa. Sem tarefa explícita, vale a do turno de quem chama. Sem próxima
   coluna (já no fim do andamento), é erro com a frase de por quê. Na próxima sem passagem, o responsável continua e não
   é reacionado.
4. **O mesmo caminho de mudança de status.** A passagem por entrada, o `terminei` e o "Não iniciar ainda" da tela são
   o `mudar_tarefa` de sempre dentro do `planejarLote` (lote travado, tudo ou nada, Desfazer), para as travas e o
   histórico de movimentos verem toda mudança. `sem_iniciar` move e passa ao responsável sem acionar (`semAcionar`).
5. **`definir_passagem`** é um passo de coluna: só a pedido da pessoa (na tela ou num turno de conversa limpo), como
   criar ou renomear coluna. A instrução da etapa é da pessoa e vai ao responsável fora da cerca `<tarefa>`.
6. **Tela**: o cabeçalho mostra o nome do responsável (cinza) ou o "Passar para…" só no hover; o popover tem "Sem
   passagem — o responsável continua" / "Passar para um agente — começa na hora" (onde a coluna aciona; nas outras,
   "passa para ele, sem acionar"), o agente e "O que essa etapa faz"; a descrição do `definir_passagem` diz o mesmo.
   Soltar o card numa coluna com responsável pede "Confirmar · Não iniciar ainda" (Confirmar é o padrão) num card
   discreto no lugar do card, dentro da lista da coluna de destino: sem modal, sem popover e sem botão cheio
   (`role="group"`, dois links, foco no Confirmar, Esc cancela). O "Mover para…" do card (teclado e toque) leva à
   mesma confirmação.

## Emenda (2026-11-02, revisão do PR #622): o pedir_a_bot com a tarefa

O `pedir_a_bot` com `tarefa` grava o pedido como comentário do remetente na tarefa e aciona o colega por ele, sem
trocar o responsável. Fora isso é o mesmo pedido do caminho sem tarefa: o `handoff` fica na conversa de quem pede e o
`peer_pedido` no turno de quem recebe, então a espera circular, o `ja_pedido`, o painel e o varredor de esperas o veem; a
mensagem da pessoa vai na entrada do colega; e o resultado volta a quem pediu pela entrega de sempre (`peer_ask` e
retomada do turno que pediu) quando o turno do colega acaba. O comentário do colega na tarefa não aciona o remetente
de novo, para não haver dois trabalhos pela mesma resposta. O turno do colega na fila só recebe o pedido se não atende
o pedido de outro bot. `tarefa_id` é sempre o turno do colega. Erros distintos, sem gravar nada: `experimento_desligado`,
`sem_quadro`, `tarefa_invalida`, `colega_fora_do_quadro` (colega de outro dono, que não está no quadro da pessoa).
`colega_nao_acionado` (o colega não ganhou turno) também é tipado; nesse caso o comentário fica na tarefa, mas nenhum
pedido aberto é registrado. A cota da IA do colega é conferida como no pedido sem tarefa: na reserva ou no limite, a
instrução diz a quem pediu que ele ainda não começa e até quando. O mesmo critério de juntar vale no lote: o início da
tarefa não se junta a um turno que atende o pedido de outro bot, e o turno juntado fica com a maior profundidade.

A trava do `terminei` vale também para o `mudar_tarefa` com status: o bot que não é o responsável, num turno com
conteúdo de fora, muda a tarefa de coluna (a passagem troca o responsável), mas não aciona ninguém por isso.

Revisão 3 do PR #622: a trava compara com o responsável do INÍCIO do lote, e num turno com conteúdo de fora o bot não
se toma uma tarefa (de outro bot ou sem responsável) nem cria uma para si, em lote nenhum: sem isso, se atribuir e depois
mandar `terminei` ou o status, no mesmo lote ou na chamada seguinte, contornava a trava. O comentário do colega que
atende um pedido do responsável nessa tarefa (o `peer_pedido` do turno dele) não aciona o responsável: a resposta volta
pelo peer.

Revisão 4 do PR #622:
- Num turno com conteúdo de fora, entrar na coluna cujo responsável é o próprio autor, com uma tarefa que não era dele
  (ou criando uma ali), é recusado como "se tomar a tarefa": senão a passagem o fazia responsável e o `terminei`
  seguinte acionava a próxima etapa. Vale para `criar_tarefa`, `mudar_tarefa` e `importar_linear`.
- No mesmo turno, a troca explícita de responsável (`agente` no passo) numa tarefa que não era do autor muda a tarefa,
  mas não aciona ninguém, como a passagem. No turno confiável e para a dona da tarefa, a troca de mão aciona (NOD-418).
- `acionaNaColuna` exclui Precisa de você e Bloqueado, como o `andando`: lá ninguém começa.
- O pedido do responsável ao colega que comenta é achado pela tarefa e pelo par responsável → colega, enquanto está
  aberto (`pedidoAbertoSql`), não pelo turno de quem comenta: a retomada do turno do colega também não reaciona o
  responsável. Respondido o pedido, o comentário do colega volta a acioná-lo.
- No `pedir_a_bot` com a tarefa, a @menção no texto do pedido não aciona nenhum bot além do alvo: o pedido é a ele.
- **Decisão (suposição para a Ada confirmar):** o comentário só aciona o responsável quando a tarefa está numa coluna
  em andamento (grupo iniciado, fora Precisa de você e Bloqueado). Em Não iniciado (Backlog, A fazer) e Encerrado
  (Feito, Cancelado) o comentário fica na tarefa sem acionar o responsável, e o resultado diz isso (a tarefa, a coluna
  e quem não foi acionado). A @menção segue acionando o mencionado em qualquer coluna.

## Emenda NOD-419 (2026-11-02): travas, recusa, freios e histórico

Ponto único: `src/domain/freios-quadro.ts`, chamado pelo `planejarLote` no fim de cada lote (o antes contra o depois de
cada tarefa tocada), venha a mudança da pessoa, do agente, do `terminei`, da passagem ou do Linear.

- **Travas** (opcionais, no mesmo jsonb da coluna): `saiPara` (vale para a pessoa e o agente) e `soPessoa` (só o
  agente é recusado). Precisa de você e Bloqueado são saída sempre; o que o sistema move fica isento. A recusa é a
  frase de por quê: o bot lê, e a tela a mostra no próprio card com "Mandar para…".
- **`nao_e_comigo`** (o agente, com motivo): sugere só o responsável da coluna; sem responsável, a tarefa vai para
  Precisa de você ("Quem pega?"); no 4º passe, para o dono em Bloqueado (revisão 8). O motivo fica em comentário.
- **Freios**: o 7º movimento de AGENTE entre as mesmas duas colunas (laço) ou o 13º acionamento na hora (freio) leva a
  Bloqueado sem acionar, e a pessoa recebe uma linha. Bloquear exige a pergunta no próprio passo; o agente que cancela,
  o motivo (que fica no histórico do movimento, marcado de fora, não em `pergunta`). Os acionamentos contam pelo relógio
  do banco (o mesmo que grava `criado_em`), e contam também os do comentário e do `pedir_a_bot` com a tarefa (que passa
  pelo comentário): cada bot acionado grava um movimento `acionou`. Passado o freio, o comentário de bot fica gravado
  sem acionar ninguém e sem mover a tarefa (um movimento `freio` na mesma coluna); o da pessoa sempre aciona. Revisão
  do PR #629.
- **Histórico** (`quadro_movimentos`, migração 0140): um movimento por mudança de coluna ou de mão, com autor e o que
  acionou. Sem chave estrangeira para a tarefa (como 0138): excluir e desfazer não apagam o histórico.
  `desfazer_movimento` desfaz só o movimento mais recente que ainda vale (sem id, esse), num turno limpo; o bot lê os
  ids em `movimentos` de cada tarefa no resumo. O Desfazer do lote marca os movimentos dele e devolve ao jogo o que um
  `desfazer_movimento` do lote tinha marcado. O desfazer não conta como ida e volta no laço. A trava "só sai para" vale
  a partir da coluna de onde a tarefa saiu para esperar (Fazendo → Bloqueado → Feito não a contorna); "só a pessoa" aceita
  o agente que repassa o pedido dela na conversa, num turno limpo. Revisão do PR #629.
- **Tela**: o agente move e passa direto, com "Ada terminou · Desfazer" na linha 1 do card; a pessoa que solta numa
  coluna com responsável segue no card discreto da decisão 6. A tarefa aberta tem o histórico recolhido.

Revisão 2 do PR #629:

- **Duas tabelas, dois papéis** (decisão tomada): `quadro_movimentos` (0140) é o registro dos freios e da passagem; dele
  saem a conta de passes, o laço, o freio e o desfazer. O histórico da NOD-416 (`quadro_tarefa_historico`, 0137) é a
  auditoria de status, responsável e quadro. As duas ficam.
- **Agente da etapa excluído**: a tarefa que entra numa coluna cujo responsável não existe mais vai para Precisa de
  você ("<coluna>: o agente desta etapa não existe mais"), em vez de ficar na coluna sem ninguém.
- **Desfazer sem janela**: o histórico que o lote lê é o das últimas 24 h; o lote com `desfazer_movimento` lê também o
  último desfazível de cada tarefa, de qualquer idade, porque a tela oferece o Desfazer nele. O laço não muda.
- **Freio do comentário sob a trava do quadro**: o comentário e o `pedir_a_bot` com a tarefa contam e gravam os
  acionamentos depois do `buscarTravado` (FOR UPDATE, a mesma ordem do lote).
- **A fazer não leva trava**: dela a tarefa sai quando o responsável começa (o `comecam` a leva ao andamento), então a
  trava ali seria contornada sem ninguém mover. O `travar_coluna` recusa ligar a trava em A fazer (tirar continua
  permitido) e o menu da coluna não a oferece.

Revisão 3 do PR #629:

- **A pessoa não é isenta do freio no lote, e é no comentário** (decisão registrada, sem mudar o comportamento): o
  `frearDepois` conta os acionamentos de qualquer autor, então a pessoa que move passado o 13º acionamento da hora
  também leva a tarefa a Bloqueado; a resposta não freia (ela abre o turno fora dos começos que o freio confere); o
  comentário da pessoa sempre aciona (o `comentar-tarefa` só freia o de bot). Motivo: no lote o freio segura a esteira
  (passagem, `terminei`, o mover) e a pessoa vê a tarefa em Bloqueado com o motivo e responde; o comentário é a pessoa
  falando direto com o responsável, e frear isso a deixaria sem como seguir. Revisão 4: a conta do freio zera no último
  freio que levou a Bloqueado (como o laço), para "responda para seguir" valer também no passo seguinte da mesma hora.
- **Laço e freio só a pessoa desfaz**: o `desfazer_movimento` do agente recusa o movimento `laco` ou `freio` (fora o
  agente que repassa o pedido da pessoa na conversa limpa); o resumo do bot marca esses com `so_a_pessoa_desfaz`.
- O histórico da tarefa aberta leva até 10 movimentos e, à parte, até 10 `acionou`: os comentários que acionam não
  empurram o último movimento (e o Desfazer) para fora. O `acionou` do comentário guarda o bot acionado e a tela diz
  "acionou X pelo comentário".
- Bloqueado com pergunta (o motivo do agente, do laço ou do freio) mostra o Responder na tarefa aberta, como Precisa de
  você: o servidor já aceitava o `responder` ali.
- A ação `quadro.desfazer_movimento` aceita a tarefa sem o movimento (o último desfazível), como o gerir_quadro.

Revisão 4 do PR #629: o `nao_e_comigo` que manda a tarefa para Precisa de você (sem responsável) avisa a pessoa pela
conversa do agente que recusou, com as mesmas regras do aviso (turno não confiável ou pergunta de fora: só o card). O
histórico da tarefa aberta separa os dois tetos pelo "mudou a tarefa" (o `freio` do comentário fica com os `acionou`).

Revisão 5 do PR #629:
- A isenção das travas e do laço (a resposta, o `nao_e_comigo`, o `desfazer_movimento`, a coluna que saiu) só vale se o
  sistema foi o último a mexer na tarefa no lote. Um passo seguinte que muda coluna ou mão faz o lote valer como um
  movimento só, do antes ao depois: as travas e o laço conferem, o histórico grava `mover`, e o desfazer coberto não fica
  marcado (senão "desfazer e refazer" abatia a conta do laço sem gravar nada).
- O Desfazer do lote pelo agente (fora da conversa com a pessoa) recusa o lote com `laco` ou `freio` valendo, como o
  `desfazer_movimento`.
- O aviso do laço e do freio da tarefa sem responsável sai pela conversa do agente que fez o lote; de turno não
  confiável ou tarefa de fora, só o card.
- O comentário de bot aciona no máximo o que falta até o limite da hora; os alvos além dele ficam sem acionar, com o
  `freio` registrado.

Revisão 6 do PR #629:
- **O passo do sistema não fecha um lote que já mexeu na tarefa** (decisão tomada: recusa explícita, mais simples que
  reconferir a trava no meio do lote). A resposta, o `nao_e_comigo` e o `desfazer_movimento` são recusados quando um passo
  anterior do mesmo lote já mudou a tarefa de coluna ou de mão ("ela já mudou de coluna ou de mão neste lote"); senão a
  isenção do sistema cobria o movimento de antes e contornava "só a pessoa", "só sai para" e o laço. A coluna que sai
  (`remover_coluna`, `substituir_colunas`) também não leva a tarefa que outro passo do lote já mudou: o lote é recusado.
  Na ordem inversa (o sistema primeiro, depois o passo) vale a revisão 5: o lote é julgado como um movimento só. Editar
  só o título ou a descrição não conta como mexer.
- **O laço e o freio desfeitos continuam sendo o corte** da conta (no domínio e no `acionamentosNaHora` do banco): desfazer
  não devolve à conta as passagens nem os acionamentos de antes deles, e o movimento seguinte não laça nem freia de novo.
- **Excluir e recriar** (decisão tomada: recusar, mais simples e seguro que herdar a contagem): o agente fora da conversa
  com a pessoa não exclui uma tarefa e cria outra com o mesmo título (sem caixa nem espaços nas pontas) ou o mesmo item do
  Linear no mesmo lote, em qualquer ordem; a pessoa (e o agente que repassa o pedido dela na conversa limpa) pode. Lacuna
  conhecida: em duas chamadas separadas a tarefa nova ainda nasce sem o histórico da excluída.
- O `nao_e_comigo` que o mesmo lote cobriu (a tarefa mudou de mão ou de coluna depois) não deixa comentário nem aviso de
  recusa.

Revisão 7 do PR #629:
- **Só a pessoa tira a tarefa da espera em que o laço ou o freio a pôs.** Se o último movimento válido que levou a tarefa
  para Bloqueado ou Precisa de você foi `laco` ou `freio`, o agente fora da conversa com a pessoa (ou de turno não
  confiável) não a tira de lá: nem `mudar_tarefa`, nem `mudar`, nem removendo a coluna. Podem a pessoa, a `responder` e o
  agente que repassa o pedido dela na conversa num turno limpo. Passar de uma espera para a outra (Bloqueado → Precisa de
  você) continua livre. O histórico do lote inclui o último movimento desfazível da tarefa em espera, então um laço de
  mais de 24 h ainda vale.
- **Bloqueado e Precisa de você não escondem a ida e volta**: o laço e o freio contam o par pela coluna de origem
  (`origemDaTrava`), tanto no histórico (Fazendo → Bloqueado → Revisão conta como Fazendo → Revisão, em lotes separados)
  quanto no `frearDepois`.
- **O aviso do laço e do freio sai sempre.** É texto do sistema; de turno não confiável ou de tarefa de fora, sai sem o
  título ("Uma tarefa do quadro foi para Bloqueado: …"). O freio do comentário também avisa na conversa do responsável
  (uma vez por tarefa e por hora).
- **"Só sai para" confere os destinos com as colunas do início do lote**: um destino removido no mesmo lote recusa o
  lote, com a dica de mover a tarefa e mexer nas colunas em chamadas separadas.
- **A pergunta do laço/freio sai do card** quando a tarefa deixa a espera por outro caminho que não a `responder`.
- **Excluir e recriar zera o histórico** (lacuna aceita): em chamadas separadas, a tarefa recriada nasce sem os
  movimentos da excluída, e a conta do laço e do freio recomeça (excluir a tarefa parada pelo laço ou pelo freio passou a
  ser recusado na revisão 8). Sugestão de issue de acompanhamento: herdar a contagem pelo título ou pelo item do Linear por 24 h.
- **As travas não valem para os movimentos do sistema** (a `responder`, o `nao_e_comigo`, o `desfazer_movimento`, a coluna
  que sai): eles seguem a própria regra e não passam por "só a pessoa" nem "só sai para". A revisão 6 impede que um
  deles cubra um passo do agente no mesmo lote, e a coluna que sai continua sujeita à regra da espera acima.

Revisão 8 do PR #629:
- **A espera do laço/freio não se perde com outro movimento dentro dela.** Bloqueado → Precisa de você, a troca de
  responsável em Bloqueado e o `nao_e_comigo` escondiam o laço de mais de 24 h (o lote só lia o último desfazível). Para as
  tarefas em espera, o lote lê também o último movimento válido que as levou para a espera vindo de fora dela, de
  qualquer idade (`entradasNaEspera`, o espelho de `paradaDaEspera`).
- **Excluir não contorna a espera.** O agente fora da conversa com a pessoa (ou de turno não confiável) não exclui a tarefa
  que o laço ou o freio parou numa espera: a mesma regra de sair dela (`conferirExclusao`). A pessoa e o agente que repassa
  o pedido dela na conversa limpa excluem.
- **O aviso de turno não confiável não cita colunas.** O motivo do laço no aviso vira "entre duas colunas"; o card guarda o
  motivo completo.
- **O 4º passe vai para o dono em Bloqueado** (decisão da Ada na issue, 02/11 03:33: "no 4º passe, a tarefa vai para o
  dono em Bloqueado"), sem responsável, com a pergunta "Quem pega?" e o aviso à pessoa. Sem a coluna Bloqueado no quadro,
  Precisa de você. Antes do limite, sem candidato, continua Precisa de você. Substitui a suposição da revisão 2.

Revisão 9 do PR #629:
- **Bloquear e cancelar pelo agente, em todo caminho.** A pergunta (bloquear) e o motivo (cancelar) valem para o
  `mudar_tarefa`, o `terminei`, o `criar_tarefa` e o `importar_linear` com autor agente (`exigenciaDoAgente`). Criar e trazer
  do Linear não têm esses campos: o agente cria (ou traz) e muda o status com `mudar_tarefa` no mesmo lote.
- **Por que o laço e o freio contam o agente da conversa limpa como agente, e a trava o trata como a pessoa** (decisão
  registrada, sem mudar o comportamento). A trava pergunta "quem pode tirar daqui": na conversa limpa o agente repassa o
  pedido da pessoa, e recusá-lo deixaria a pessoa sem como mover pela conversa. O laço e o freio contam o que de fato
  aconteceu, pelo autor gravado no movimento (o agente que executou), e servem de rede de segurança: tratar como pessoa
  exigiria gravar o movimento com outro autor (o histórico mentiria sobre quem moveu) ou um campo novo. O custo é pequeno:
  a pessoa que pede sete idas e voltas na conversa vê a tarefa em Bloqueado, responde ou desfaz (o agente da conversa limpa
  também desfaz o laço e o freio, revisão 3) e segue.
- O histórico do lote lê os movimentos antigos (o último desfazível, a entrada na espera) só das tarefas que esperam ou
  que o lote desfaz; antes lia os de todas, e o passe velho de outra tarefa entrava na conta do laço.
- A recusa da tarefa excluída no mesmo lote não deixa comentário; a recusa da tarefa criada no mesmo lote o grava no id
  real (antes, 500).
- O resumo do bot traz a `pergunta` também em Bloqueado (o motivo do agente, do laço ou do freio), não só em Precisa de você.

Revisão 10 do PR #629:
- **O `mudar_tarefa` com motivo não apaga a recusa.** O motivo (e o movimento `mover`) só vale quando o próprio passo muda
  o status ou o responsável. Antes, `[nao_e_comigo, mudar_tarefa {motivo}]` gravava o movimento como `mover` (o passe não
  contava e o limite de 3 furava, com o comentário e o aviso de recusa saindo assim mesmo), e o `mudar_tarefa {motivo}`
  sozinho gravava um `mover` sem mudança. O `mover` que no fim do lote não mudou nada também não é gravado.
- **Só a pessoa tira a tarefa do Bloqueado do 4º passe**, como do laço e do freio (`paradaDaPessoa`, reconhecida por
  `paradaDaEspera` na entrada da espera): o agente fora da conversa com a pessoa (ou de turno não confiável) não a muda
  de lá, não a exclui, não desfaz o movimento nem o lote dele, e o resumo do bot o marca `so_a_pessoa_desfaz`. O 4º passe
  que vai de Precisa de você a Bloqueado também conta como entrada (no domínio e no `entradasNaEspera`). Antes do limite o
  `nao_e_comigo` nunca entra em Bloqueado, então a recusa comum (Precisa de você) continua livre. Lacuna aceita: sem a
  coluna Bloqueado no quadro, o 4º passe vai a Precisa de você e não se distingue de uma recusa comum.

### Suposições para a Ada

- **Bloquear sem motivo, só para a pessoa**: o motivo (a `pergunta` no próprio passo) é exigido só do agente. Exigir da
  pessoa pediria um campo novo no soltar, no "Mover para…" e na tarefa aberta, e as mudanças que chegam do Linear não
  trazem motivo; ficou grande para esta revisão. A pessoa que arrasta para Bloqueado sabe por quê; o card mostra
  "bloqueada" até alguém escrever a pergunta.

### Pendências

- Ao mesclar a NOD-416 (antes na fila), unificar a lista da tarefa aberta numa só e tratar a tarefa que muda de quadro
  (os movimentos acompanham ou a contagem zera). Fica para o merge.

## Gatilho de reversão

Se a passagem acionar agentes que a pessoa não esperava (Desfazer logo depois de mover para uma coluna com
responsável em mais de 1 a cada 5 casos, ou queixa do mesmo tipo), volta a regra da ADR-140 (coluna não muda o
responsável) e a passagem passa a ser só uma sugestão no card.
