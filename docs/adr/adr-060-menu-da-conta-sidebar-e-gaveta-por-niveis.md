# ADR-060 — Menu da conta, sidebar arrastável e a gaveta do bot por níveis

Status: aceito · Data: 2026-09-30 · Emendada pela ADR-125 (itens 3 e 5, 2026-10-23), pela NOD-370 (2026-10-26, a conversa do bot que saiu), pela NOD-119 (2026-10-29, densidade e largura da barra) e pela NOD-444 (2026-10-31, nova rotina começa no chat) · Emenda ADR-032 (painel do bot) e a regra de 2026-09-18 de "Seu espaço". Canvas "Nod —
tela do agente", página "Menu, sidebar e gaveta".

## Contexto

O Marlon comparou o nod com o Grok bot e pediu quatro mudanças. Conferido na tela real em 2026-09-30, numa janela de
1440 × 900:
- **Seu espaço** ocupava o lugar da conversa com uma página longa de seis blocos. Para sair, só clicando num bot.
- **Sidebar de 292 px:** o fixado tinha mascote de 49 px, o título cortava sem reticências e os ••• ficavam em cima do
  mascote. Não havia como arrastar um bot para fixar ou trocar de seção.
- **Gaveta de 300 px:** Editar perfil, Memória e Nova rotina saíam dela e ocupavam o lugar da conversa.
- **Editar perfil** juntava nome, título, missão, mascote, o catálogo com 15 estados do mascote, seis botões e a lista
  técnica de acessos.

## Decisão

1. **Menu da conta no avatar.** O avatar abre um menu: Conexão, Avisos, Modo dev (liga ali mesmo, ⌘⇧D continua),
   Computadores, Gerenciar agentes e Relatos. No rodapé do menu fica o banco da instância.
   - A faixa do topo só aparece quando algo precisa da pessoa: a IA desconectada (com Conectar) ou um conector fora do ar
     ("Gmail e ClickUp fora do ar", com Ver).
   - O selo "Persistente" saiu da barra. O efêmero e o não identificado continuam nela, porque pedem atenção.
2. **Seu espaço é uma camada, não uma tela.** Ele abre em tela cheia por cima da tela atual, já na seção escolhida, com
   as seções na coluna da esquerda.
   - A tela de baixo continua montada e inerte. Sair devolve a conversa exata: rolagem, rascunho do campo e nível da
     gaveta. O que chegou enquanto isso ganha a linha "Novas".
   - Um botão só para sair: "‹ <de onde veio>", com o mascote do bot, mais o Esc. Sem ×: os dois fariam o mesmo, e o
     nome diz para onde a pessoa volta. Trocar de seção não empilha.
   - As telas `gestao`, `relatos` e `chaves` viraram seções. A chave crua recém-emitida vive enquanto a seção
     Computadores está aberta.
3. **Sidebar de 340 px e gaveta de 380 px.** Na janela de 1440, a conversa fica com 720. Abaixo de 1100 px, a gaveta
   abre por cima da conversa.
   - Os fixados têm mascote de 56 px. Nome e título cortam com reticências, e o `title` mostra o nome inteiro.
   - Sem ••• nos bots: o menu abre no clique direito, na posição do cursor, ou com Shift+F10. No bot aberto, também
     pelo ⋯ do topo da gaveta.
4. **Arrastar na barra (0041).** Um bot da pessoa arrastado para a grade é fixado na posição em que cai. Arrastado
   para uma seção, sai da grade e entra na seção. Arrastado para "+ Nova seção", pede o nome.
   - O servidor recebe um pedido só: `PATCH agentes/:id/organizacao` com `fixado`, `secao` e `ordem`. A `ordem` traz os
     ids do grupo de destino, e cada um grava o próprio índice em `agentes.posicao`.
   - A frota ordena por `fixado desc, posicao nulls last, criado_em`. A barra se reorganiza na hora, sem esperar a
     frota voltar.
   - Bot de outra pessoa não arrasta. Fixar e "Mover para…" continuam no menu para quem não usa mouse.
5. **A gaveta por níveis.** Tudo o que é do bot abre dentro dela, com ‹ (ou Esc) para voltar, e a conversa continua ao
   lado. Os níveis são rotina, acesso a um app, Dar acesso, Editar perfil, Memória, Inteligência e Nova rotina. O ícone
   do painel fecha a gaveta de qualquer nível.
   - **Rotina:** a instrução inteira, o cron em palavras (`RotinaDto.resumo`) e as últimas execuções, incluindo as
     silenciosas. O rodapé tem Pausar, Testar agora e Ajustar. Ajustar só escreve o pedido no campo, porque quem muda a
     rotina é o bot (ADR-043).
   - **Acesso:** o nível do bot, o que ele deixa em palavras, cada ação legível e Revogar.
   - **Editar perfil** ficou com mascote (forma e cor), nome, título e missão. Sair com mudança não salva pergunta se
     descarta. Salvar sem o campo de modelo não mexe na inteligência do bot.
   - Trocar de bot abre a gaveta do outro na visão geral. A rotina parada por falta de acesso continua com o botão que a
     destrava na própria linha (emenda da ADR-044).

## Alternativas descartadas

- **Seu espaço como tela, com "voltar" pelo histórico.** Trocar a conversa pela página regravava o campo e perdia o
  rascunho, a rolagem e o nível da gaveta. A camada mantém tudo sem guardar nada.
- **× e ‹ juntos em Seu espaço.** Fariam o mesmo, e a pessoa ficaria em dúvida sobre qual deles descarta algo.
- **••• visível ao passar o mouse sobre o fixado.** Continuaria em cima do mascote, que foi a reclamação.
- **Posição fracionária (a média entre os vizinhos).** Evitaria mandar o grupo inteiro, mas exige renumerar quando os
  números se aproximam. Um grupo tem dezenas de bots, então mandar a ordem inteira custa pouco.

## Gatilho de reversão

- Se a camada de Seu espaço atrapalhar um aviso que precisa de clique (o foco preso nela), ela passa a fechar sozinha
  quando chega uma decisão.
- Se um grupo da barra passar de 200 bots (o teto da `ordem`), a posição vira fracionária.

## Não implementado

- **Computador do bot e Pasta de trabalho** continuam na janela grande deles. Um desktop remoto e uma árvore de arquivos
  não cabem em 380 px.
- **Reordenar seções:** elas seguem em ordem alfabética. Só os bots se arrastam.
- **O catálogo de estados do mascote** saiu do perfil e não foi para lugar nenhum.

## Emenda de 2026-10-26 — A conversa do bot que saiu (NOD-370)

"Sair devolve a conversa exata" tem uma exceção: sempre que o bot da conversa de baixo sai da frota (excluído ou ocultado
aqui, pela barra lateral ou em outro aparelho), a tela de baixo vai para Início, que abre o primeiro bot que ficou (Novo bot
se não sobrou nenhum); um "voltar" que dava nessa conversa passa a dar em Início. Seu espaço, se estava aberto, continua na
mesma seção, e "‹ <de onde veio>" e Esc levam a essa tela. Excluir e Ocultar não abrem mais Configurações › Agentes por
conta própria. Com Agentes aberto, a lista fica na mesma rolagem e o foco vai para o ⋯ da linha seguinte do mesmo time
(a anterior se era a última; com o time vazio, a mais próxima da lista); pela barra lateral, para a linha vizinha. O
leitor de tela ouve "‹nome› foi para Excluídos/Ocultos." numa região viva fora da `.app`.

## Emenda de 2026-10-29 — Densidade e largura da barra (NOD-119)

"Sidebar de 340 px" passa a ser o padrão, não a única largura. Em Configurações › Aparência a pessoa escolhe a densidade:
Confortável (340 px, a de hoje) ou Compacta (200 px, linhas de 36 px sem a prévia). A borda direita da barra é um separador
focável que **encaixa** em larguras fixas, sem redimensionar livremente: Confortável 340 ↔ 72 ("só avatares"); Compacta
200 ↔ 56, e 340 alargada. Teclado (← → Home End Enter Espaço), dois cliques e arrasto de 40 px por passo. Vale por
computador (localStorage; no app do Mac, `preferencias.json`); no celular nada muda (a gaveta de hoje). Na barra
recolhida o `title` sai e uma etiqueta escura mostra "nome · título" no mouse e no foco, porque o `title` do sistema
demora e não aparece no teclado. Um bot também pode propor a mudança pelo chat (`ajustar_barra_lateral`): um card que
só muda a barra no clique da pessoa.

Gatilho de reversão: a preferência vive só no computador (localStorage e preferencias.json), sem métrica no servidor;
então o gatilho é observável na equipe: se em 30 dias (até 2026-11-28) ninguém do time estiver usando a Compacta ou a
recolhida (conferido na retro), ou se a borda virar pedido de largura livre, voltar à barra fixa de 340 px e tirar a
borda.

## Emenda de 2026-10-31 — Nova rotina começa no chat (NOD-444)

O "+ Nova" das Rotinas, na gaveta e no perfil do celular, não abre mais o nível "Nova rotina". Ele leva à conversa
com o bot e põe "Crie uma rotina para " na caixa, com o cursor no fim, sem enviar nada. Se já houver rascunho, ele
fica e a frase vira uma pílula de sugestão acima da caixa. A rotina nasce pelo fluxo de criar_rotina. No computador
largo (1100 px ou mais) a gaveta fica aberta. Entre 760 e 1099 px ela é sobreposta e cobriria a caixa, então fecha,
como o perfil no celular. O vazio passa a ensinar o caminho: "Peça na conversa, do seu jeito: «…»".

O nível "Nova rotina" da gaveta fica no código, sem entrada pela gaveta: o nível salvo de antes ainda o abre, e o
formulário segue vivo nas telas Rotinas e agenda, que estão fora do escopo. Sai junto com elas, quando a agenda também
começar no chat.

Com pergunta do bot em aberto: quando a frase entra na caixa (vazia, ou pelo toque na pílula) e a caixa "Respondendo"
está à vista (duas ou mais perguntas), o pedido sai como assunto novo, como o × dela, e a caixa some. Só mostrar a
pílula não muda o destino do rascunho. Com uma pergunta só, a mensagem responde a ela (decisão 1 do plano "pergunta
com botões", emenda da ADR-045). Sem caixa à vista, mudar o destino seria invisível, que é o que a revisão do PR #389
proibiu. O bot recebe o texto inteiro como resposta e cria a rotina a partir dele. Se isso confundir os bots,
mostrar a caixa "Respondendo" já com uma pergunta e deixar o × valer.

O prompt da conversa (só nela, nunca na rotina, entre bots, na sala ou na ligação) ganhou uma linha: se o pedido
de rotina não diz quando, o bot pergunta o dia e o horário com um exemplo antes de chamar criar_rotina. Isso vale
para todo pedido de rotina na conversa, não só para o "+ Nova". Quando a pessoa corrige o horário, o que o bot faz
depende de a rotina já existir:

- se existe (veio aplicada: true, ou a pessoa confirmou o card e ela está no inventário de rotinas), ele muda a rotina
  por atualizar_rotina, com o id dela (o proposta_id é o id da rotina);
- se ainda é só proposta, ele repropõe e avisa que a proposta anterior pode ser recusada.

No Manual ficam dois cards pendentes até a pessoa recusar um. Expirar a proposta anterior no servidor é follow-up.

Gatilho de reversão: se em 30 dias (até 2026-11-30) as rotinas criadas na conversa a partir do "+ Nova" exigirem mais
de duas idas e voltas para acertar o horário, na maioria dos casos (visto na retro, lendo as conversas), voltar a dar
um atalho de horário no próprio card.
