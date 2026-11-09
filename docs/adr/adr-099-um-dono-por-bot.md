# ADR-099 — Um dono por bot: a conversa coordena, as frentes trabalham por baixo

Status: proposta · Data: 2026-10-11 · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) (tasks
paralelas), [ADR-084](adr-084-pedido-a-colega-parado-avisa-ou-retoma.md) (pedido a colega parado),
[ADR-086](adr-086-esperar-fora-do-mac.md) (`me_chame_as`) e [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md)
(comando em segundo plano). Conversa com a [ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md) (proposta,
PR #252: fila dos comandos pesados). Plano de entrega em [plano-um-dono-por-bot.md](../plano-um-dono-por-bot.md);
telas em [prototipos/um-dono-por-bot](../prototipos/um-dono-por-bot/README.md). Decisões do Marlon em 2026-10-11.

## Contexto

Em 11/10, às 20:33, a tela Trabalhos mostrava "Trabalhando · 13", com um trabalhando de fato. Medido na produção (banco e
GitHub Actions do gamefik):

- **Onze tasks do Ze 1 dormiam com volta marcada** (`me_chame_as`). Todas dependiam, direta ou indiretamente, da CI do
  gamefik #845, a base de 14 PRs empilhados. Foram 67 voltas no dia e cerca de US$ 114 nas tasks que seguiam abertas. Uma
  delas voltou 12 vezes seguidas, acima das 10 em que a própria ADR-086 manda rever a regra; nada avisou.
- **A CI do #845 nunca terminou.** O job `checks` falhou 4 vezes (11:38–14:12) e depois foi cancelado 9 vezes seguidas: leva
  mais de 55 min nesse PR (cerca de 28 de banco e 27 de mobile; na `main`, 2 a 15 min) e é cancelado por commit novo. Várias
  tasks do próprio Ze 1 empurravam no mesmo branch; uma anotou "ver se o head mudou com a correção da outra sessão".
- **O orquestrador empilhava.** Às 17:29 o Leonardo abriu "Destravar o que está parado há mais de 1h" (mais uma task
  olhando a mesma CI) e mandou começar o B07/B08 (US$ 38 e mais 7 PRs em cima do #845). O Ze 2, o Ze 3 e os Devs estavam
  quase ociosos.
- **De manhã**, 14 tasks do Ze 1 caíram com a máquina (`maquina_sem_contato`, VM sem memória) sem produzir nada.

Cada bot acertou olhando a sua parte. O defeito é de forma: a ADR-083 fez das tasks **pares** independentes e visíveis,
cada uma com sessão própria, sem ninguém acima delas. Ninguém via o conjunto, cada task vigiava o mundo por conta própria,
os efeitos de uma eram invisíveis para as outras, e a tela listava cada sessão como trabalho.

Uma primeira proposta (esperas como objeto compartilhado, vigias, registro de efeitos, painel do orquestrador; página
"Tasks que terminam") remendava as consequências e obrigava o Nod a construir um harness de coordenação de pares. O Marlon
pediu algo mais geral, que não poluísse a tela e servisse a qualquer trabalho longo, não só código.

**Referência: Hermes Agent** (Nous Research, código lido em 11/10, commit 835c3dd; Bot Mode oficial, embutido no Hermes
Desktop). Um bot é uma conversa permanente, um turno por vez, com fila. O paralelismo são subagentes que devolvem só o
resumo, em uma mensagem. Esperar é um processo em segundo plano cujo fim abre um turno ("o filho devolve o fato, PR e SHA,
e o pai lança o vigia"); laço com sleep é proibido. Travas por falta de progresso, não por relógio, e o fluxo de CI tenta
3 vezes e pergunta ao usuário. Na tela, "ativo" é só turno vivo; esperar aparece como processo, não como trabalho.

## Decisão

**Cada bot tem um dono: a conversa dele.** Ela coordena todo o trabalho do bot; o paralelismo fica por baixo dela, em
frentes que devolvem o resultado ao dono. A pessoa fala com o bot, não com as frentes.

1. **O dono é a fila do bot, não uma sessão única do CLI.**
   - Pedidos da pessoa, de colegas (`pedir_a_bot`) e de rotinas entram na fila do dono, em ordem. A pessoa passa na frente.
   - **Não há limite por pedido.** Todo pedido começa na hora se há recurso (item 7). Um pedido só espera na fila quando
     falta recurso ou quando o dono decide que ele depende de outro trabalho (item 1a).
   - Turno de colega vira frente na hora; o dono recebe só o resumo. Assim a marca de conteúdo de fora (ADR-047) fica na
     frente que leu, e a conversa com a pessoa não perde a escrita por causa de um pedido de colega.
   - **A rotina é um alarme que põe um pedido na fila do dono** ("rodar <rotina>"); a partir daí é igual a qualquer
     pedido: o dono abre frentes ou pede a colegas e fecha com o resumo. Na conversa continua a linha agrupada "da
     rotina", que só vira mensagem quando há algo para a pessoa. A rotina não abre frentes sozinha.
   - Sala e ligação continuam paralelas à conversa, como hoje (são conversas diferentes; ADR-072).
1a. **O dono decide na entrada.** Num turno curto, ao receber um pedido, o dono olha o que já está em andamento e escolhe:
   começar agora numa frente; juntar a uma frente que já mexe na mesma coisa; ou esperar ("depende do #845, começo quando
   ele fechar"). É julgamento, não regra: o dono consegue porque é dono de todas as frentes. O conflito entre frentes se
   resolve pela forma (item 6), não pela contagem.
2. **Frente.** Uma unidade de trabalho do bot, com sessão e pasta próprias, filha do dono e **que não aparece como task**.
   - É uma linha de `trabalhos` (reaproveita pasta da ADR-065/088, limpeza da ADR-096, custo, memória e `sessaoExecutor`).
     Não usa o subagente do harness: só o Claude tem, e o Nod não o enxerga (motivo da ADR-083).
   - Devolve ao dono um resumo curto com fatos (o que fez, PR e SHA, o que falta).
   - **Cada pedido tem o seu lote.** As frentes abertas juntas para o mesmo pedido voltam juntas: o dono é acordado uma
     vez, quando a última termina, e responde numa mensagem só. Ao abrir o lote, o dono pode pedir "avise a cada uma"
     quando as frentes são independentes e muito diferentes em duração (ex.: revisar 5 PRs).
   - **Um pedido nunca espera frentes de outro pedido.** O pedido de um colega, ou um pedido novo da pessoa, é o seu
     próprio lote: o resultado sai assim que a frente dele termina, mesmo com outras frentes do bot ainda rodando.
   - Uma frente que precisa da pessoa pergunta na hora, sem esperar as outras.
   - Se alguma frente do lote leu conteúdo de fora, o turno de retorno do dono nasce marcado (ADR-047); o próximo turno
     da pessoa nasce limpo.
   - Frente não abre frente (`podeAbrirTask`). Não há teto fixo de frentes (ADR-083/085); a máquina decide (item 7).
3. **O dono fica leve.** O turno do dono dispara frentes, responde em poucas linhas e encerra; o trabalho pesado vai para
   frente. A rede de 2 min (ADR-083) passa a promover o turno a frente, e sem `bifurcaSessao` promove com o histórico.
4. **Esperar algo de fora é um comando, e o fim dele acorda o dono.**
   - Ferramenta do Nod `esperar_comando({ comando, motivo })`, pelo proxy, em qualquer harness em que o bot tem terminal
     (sem terminal, rodar comando por essa porta seria um atalho de permissão). O pedido fica no banco
     (comando, pasta, máquina, turno de origem); o motor roda o comando **fora do CLI**, com as regras do terminal do bot
     (ADR-052, ADR-089: sem laço com sleep); o turno do dono encerra na hora.
   - Quando o comando termina, o Nod enfileira a retomada do dono com o código de saída e as últimas linhas, pelo caminho
     do `acordar_em` (ADR-086). Ex.: `gh pr checks 845 --watch` acorda o Ze 1 uma vez, quando a CI acaba.
   - Só o dono espera. A frente devolve o fato; quem lança a espera é o dono.
   - Queda da máquina: ao voltar, o motor relança o comando gravado; se não puder, acorda o dono com "a espera caiu".
   - `me_chame_as` fica só para hora marcada ("me chame amanhã às 9 h") e sai do catálogo das frentes.
   - Um Bash em segundo plano dentro do CLI não serve para isso: pela ADR-067 o turno fica aberto e a fila do bot trava
     enquanto o comando roda, e o Codex não tem terminal.
5. **Sem progresso, o bot para e pergunta.** Três retornos da mesma espera sem fato novo, ou três quedas
   (`MAX_QUEDAS_POR_PEDIDO` da ADR-084), e o dono para e pergunta à pessoa na conversa, com opções. Mede-se novidade,
   não tempo: "só o Parar freia" (ADR-067) continua valendo. Substitui o teto de 24 voltas da ADR-086.
6. **Cada frente no próprio branch; só o dono integra.** Frentes que mexem num repositório trabalham em branch e worktree
   próprios; o dono junta o resultado e é o único que empurra no branch do PR. Não há trava no hook: é a forma de trabalhar
   que o dono usa ao disparar frentes. Resolve o caso do #845 sem proibir nada.
7. **O limite é a capacidade, medida.** Enquanto houver recurso, o bot trabalha em quantas frentes precisar.
   - **Máquina:** a frente herda a origem do pedido: veio da pessoa, não é segurada; veio de colega ou rotina, pode ser
     segurada (ADR-085). Comandos pesados seguem a fila da ADR-097, se aprovada.
   - **Cota da IA:** a assinatura tem limite por janela e por semana, compartilhado por todas as frentes. Frentes novas
     param de nascer quando a cota usada chega a 99%: **1% fica reservado para a conversa com a pessoa**, que nunca para
     por falta de cota. Sinal de limite do provedor (429, "limite atingido") segura trabalho novo em vez de deixá-lo falhar.
   - **Recursos de fora** (fila da CI, limites de API do GitHub, ClickUp, Gmail) não aparecem na máquina: o Nod mede o tempo
     de fila e os erros de limite e mostra; não há trava automática por eles.
   - **Custo visível, sem teto:** quanto cada bot gastou hoje, e um aviso quando o ritmo do dia sai do normal.
     (revisto em 2026-10-26, NOD-369: sai do topo de Trabalhos; ver a emenda.)
8. **Entre bots.**
   - `pedir_a_bot` vira pedido na fila do dono do outro bot. A resposta imediata diz o que aconteceu: começou, ou espera
     por falta de recurso, ou espera porque depende de outro trabalho (e de qual); o bot pode sugerir um colega livre.
   - Espera circular (A espera B, B espera A) é detectada no `pedir_a_bot` e recusada com instrução ao bot.
   - O varredor da ADR-084 passa a ler o estado da frente que atende o pedido.
   - **Pedido de colega concluído não acorda o dono:** a resposta vai direto a quem pediu (ADR-084), e na conversa do dono
     fica só a linha "Respondi ao pedido de X" (revisto em 2026-10-18: a troca agrupada; ver a emenda do PR 3).
9. **Frente sem trabalho sai na hora.** Ao terminar, a pasta da frente com zero commits além da base e árvore limpa é
   apagada; com trabalho, segue a limpeza da ADR-096 (guardar antes de apagar). Só com prova afirmativa; na dúvida, fica.
10. **Tela** ([protótipo](../prototipos/um-dono-por-bot/README.md)):
    - **Conversa:** uma linha centralizada quando as frentes começam e outra quando terminam; o resultado chega numa
      mensagem do bot.
    - **Uma linha acima do campo**, nunca uma pilha. O texto principal é o estado de maior prioridade — Esperando você >
      Trabalhando em N frentes > Esperando X > N na fila — e os outros viram contagem ao lado. Some quando o bot está
      livre. Aberta, mostra cada frente com o último passo, a espera (comando, última linha, tentativa N de 3) e a fila.
    - **A decisão fica na conversa**, como mensagem do bot com opções; a linha só ecoa "Esperando você" e leva até ela.
    - **Trabalhos:** uma linha por bot (Precisa de você, Trabalhando, Esperando) e os livres numa linha; as frentes abrem
      com um clique.
    - **Barra lateral:** um sinal por bot — ponto vivo trabalhando, vazado esperando, azul precisa de você.
    - **Esperar não é trabalhar:** nada que só espera conta como "Trabalhando".
11. **Falar com uma frente.** A rota de mensagem para um trabalho vira recado para a frente, que aparece também na conversa
    do dono. `mandar_para_task`, "Fazer aqui" e "Fazer depois" são revistos no plano.
12. **Capacidades, nunca o nome do harness** (ADR-083 §5). Fila, frentes, espera e perguntas são ferramentas do Nod e
    valem igual para qualquer harness; dentro da frente o trabalho continua no CLI com o que ele tem de melhor.

## Emendas

- **ADR-083:** tasks deixam de ser pares visíveis. A faixa por trabalho no `reivindicar` continua, agora para frentes.
  `abrir_task` passa a abrir frente do dono.
- **ADR-084:** o pedido a colega é um item na fila do dono do outro bot; o varredor lê a frente que o atende.
- **ADR-084 (2026-10-15, NOD-241):** a frente de lote que caiu espera o sinal de volta até `RETOMAR_ATE_MS` (2 h desde o
  último sinal), e não 30 min: o "Retomar" aberto fica com a pessoa nesse tempo e o dono só acorda na desistência. O
  pedido a colega mantém os 30 min. A queda conta do último sinal do turno (emenda da ADR-084). A frente que espera sai da
  consulta por `ADIAR_PEDIDO_IGNORADO_MS` (5 min), para não ocupar o limite de 20 das que já podem voltar — nunca além
  do fim das 2 h, para a desistência sair na hora.
- **ADR-086:** `me_chame_as` só para hora marcada; a volta marcada não conta como trabalhando; o teto de 24 voltas vira o
  item 5.
- **ADR-067:** esperar algo de fora não é mais comando em segundo plano do CLI (item 4). O comando do próprio trabalho
  (testes, build) continua no terminal da frente.

## Emenda (2026-10-18, ADR-114, chat limpo, PR 3) — item 8

- **"Na conversa do dono fica só a linha 'Respondi ao pedido de X'" vira a troca agrupada.** Na conversa própria, a
  conversa com outros bots é UMA linha por troca, "Conversou com Ada e Teodora · 6 mensagens · até 19:23", que abre no
  lugar com cada mensagem ("Para Ada" / "De Teodora", a hora e o texto). Uma troca é o fio de um pedido: do lado de quem
  recebe, a raiz do pedido (o turno de `delegacao`) com o pedido, a resposta e os pedidos que o próprio bot fez no meio; do
  lado de quem pede, o turno de origem (o `handoff` e as `peer_ask`). Trocas vizinhas, sem nada à vista no meio e sem uma
  pausa de 30 min (a do divisor de data), juntam numa linha. Saem "↗ pedido a colega", "↙ Resposta de", "Enviou mensagem
  para", "N mensagens com", "Pedido do X" e "Respondi ao pedido de X"; "Contribuição de outro bot · confira as fontes" e
  "Contexto de X · não é instrução da pessoa" vão para dentro, junto da mensagem que marcam; o colega que não terminou diz
  "· 1 não terminou" na linha e o motivo dentro. A sala fica como antes (lá a conversa entre bots é o conteúdo).
- **A resposta do lote entra na troca:** `pedido_respondido` passa a levar `resposta` (o texto entregue, até 2.000
  caracteres) e `turnoRaizId` (o turno do pedido), com a confiança da fala entregue, não a de sistema. A linha gravada
  antes, sem eles, conta como mensagem da troca sem texto ("Para Ada · 15:09 · respondido").
- **O nome sempre vem:** o `peer_pedido` grava `nome` (de quem pediu) e o `handoff`, `nomePara` (de quem recebe), no
  momento; a leitura da conversa leva `pedidosDeColega` (o autor e o nome do `peer_pedido` de cada turno de delegação da
  janela, numa consulta à parte, pelo índice `mensagens_por_turno`). A web usa o nome da mensagem, o da raiz, o da frota
  e, por último, "um colega"; "outro bot" deixou de existir.
- **Gatilho:** a telemetria das linhas ganha o tipo `troca` (mostrada a cada troca desenhada, aberta quando a pessoa abre
  a troca), no mesmo gatilho de 30% da ADR-083.

## Emenda (2026-10-18, ADR-114, chat limpo, PR 8) — item 10

- **A linha centralizada de início e fim de frentes sai do chat** (PR 2: "Começou N frentes" e "N frentes terminaram"
  viraram `anexo`) e **o progresso mora na fala que abriu as frentes** (PR 7): a barra com um segmento por frente e "3 de 5
  prontas · … · ver as 5" dentro do balão.
- **A linha acima do campo vira a pílula do bot que se alarga** (`web/telas/pilula-do-bot.ts`; protótipo D4BE2, escolha
  "4B+4E"). Fechada, uma pílula centrada acima do campo: "● 5 frentes de hero  3 de 5 prontas" (o título do lote do PR 5,
  senão "N frentes"; vários lotes, "2 lotes · 4 de 7 prontas"). Sem frentes, a espera com o ponto vazado ("Esperando o
  deploy terminar · 2 min") ou a fila ("1 pedido na fila"), pela mesma prioridade de antes; com frentes, a espera e a fila
  entram em contagem ao lado. O clique a alarga no lugar: as frentes (rodando primeiro, com o último passo e o tempo;
  depois as prontas com a hora; separadas por lote quando há mais de um), "Esperando" e "Na fila" como na linha aberta, a
  frase da memória do Mac, e no pé "Ver na conversa ↑" (rola até a fala e a realça) e "Parar" (a mesma confirmação do
  Parar do campo, só com as frentes abertas da pílula).
- **Some quando a fala com o progresso está à vista** e volta quando ela sai; espera e fila não têm fala-âncora e a seguram
  à vista. Alargada, ela fecha sozinha quando a fala entra na vista, e o foco que estava nela vai para o "ver as N" do bloco.
- **"Esperando você" sai da pílula**: a pergunta tem o cartão e a pílula "Nina perguntou algo" (#389). O texto "Esperando
  você" segue na barra lateral e em Trabalhos, como antes.
- Os passos de cada frente dentro da linha aberta (o clique que abria as etapas) saem: o título da frente abre a tela dela.
- **Gatilho:** "a pessoa abrindo o detalhe das frentes em mais de 30% das vezes" passa a ser medido em "ver as N" e na
  pílula alargada (telemetria das linhas, tipo `frentes`; a pílula conta "mostrada" quando aparece com frentes e "aberta"
  quando alarga, chave `frentes:pilula:<lotes>`).

## Emenda (2026-10-20, NOD-309) — item 7

- **O retorno do lote é refeito em toda queda.** `marcarDevolvido` continua na hora de enfileirar o retorno (é a trava do
  UNIQUE contra duas frentes fechando juntas), mas o lote só conta como entregue com `lotes_de_frentes.retorno_concluido_em`
  preenchido, gravado quando o turno de retorno assenta `concluido`. Enquanto ele for nulo, `refazerRetornoDoLote` vale
  para qualquer queda (cota, reinício, máquina, transitório), não só a da cota, com a regra de espera do fundo da ADR-045
  (emenda de 2026-10-20).
- **Cota da IA no Automático:** `anteciparEsperasDaCota` passa a acordar também o fundo em `auto/auto` quando qualquer IA
  da pessoa sai do limite; o portão da cota no `reivindicar` segura de novo se a escolhida ainda estiver no limite. A nova
  tentativa por erro transitório não é acordada: fica com o próprio backoff.

## Emenda (2026-10-20, NOD-300) — item 10

- **A frente presa a máquina sem contato espera, não trabalha.** Frente `rodando` com turno vivo numa máquina sem contato
  (a regra do chip e de Trabalhos, NOD-260: não conectada há 60 s ou mais, desde o último uso da chave;
  `src/domain/presenca-da-maquina.ts`) conta como "esperando", com o motivo "<máquina> · sem contato" e o desde do último
  contato. É uma espera sintética: entra só no motivo e no desde da linha fechada, não vira item de `DonoDto.esperas`. Na
  dúvida (sem o serviço das máquinas, Mac do servidor, sem último uso), vale o de antes.
- **A presença avisa.** O varredor da ponte guarda a última presença avisada de cada máquina e publica
  `inventario.mudou` (`motivo: "presenca"`) só na transição — um aviso por pessoa por passada; o `desconectar` também
  avisa. A web relê `trabalhos` pela janela de 1 s e copia o dono lido para a conversa do bot (a linha acima do campo e a
  barra leem o dela).

## Emenda (2026-10-20, NOD-282) — a frente chega certa ao dono

- **Recusa no despacho.** A frente recusada sem login ou sem a IA na máquina (`nao_autenticado`, `motor_ausente`) volta
  ao dono na hora, só com ela e a pergunta de reconexão; a recusa de espera (`limite_do_plano`, `sem_conta`) não volta
  sozinha: espera a cota ou a conta, como o pedido a colega (NOD-274). Fecho e varredor seguem a mesma régua
  (`classificarFimDaFrente`).
- **Aprovação vencida.** A frente fecha falhou com o texto da aprovação ("o pedido de aprovação venceu sem resposta"); o
  motivo técnico continua `pergunta_vencida`.
- **Ação já executada.** Na aprovação decidida tarde, o item cuja ação igual (conector, ferramenta, argumentos) já saiu
  numa decisão posterior da mesma faixa fecha `ja_executado`, sem chamar o conector; os demais itens rodam.
- **Retorno complementar.** A frente reaberta (aprovação vencida reaberta) que volta a final depois do lote devolvido
  acorda o dono uma vez, só com ela ("que tinha ficado pendente"), sem botão nem card; no lote de colega, o complemento
  vai a quem pediu. Resumo igual ao de antes: nada. Limite: o complementar que cai não é refeito.

## Emenda (2026-10-22, NOD-325) — item 2

- **A fala da frente de lote é `anexo`.** A fala de texto do bot num turno de frente com lote (`forma = 'frente'`,
  `lote_id` não nulo) sai do chat com destino `anexo` (servidor, `destinoDaLinha`) e a web não faz balão dela; mora na
  tela da frente. O dono é a voz única: a pessoa vê só a resposta do retorno do lote, uma vez, com uma ou N frentes.
- **Fica no chat:** o `pedido_a_pessoa` da frente; a fala da pessoa; a frente sem lote (forma efetiva task) e a task.
- **Limite:** se o lote for apagado (`lote_id` vira null), a fala volta ao chat. O relato (`janelaAte`) segue a mesma regra.

## Emenda (2026-10-26, NOD-369) — item 7

- **O custo de hoje sai do topo de Trabalhos.** Decisão do Marlon (26/10): a tela fica mais limpa sem o botão
  "US$ X hoje" e o painel por bot ("acima do normal", "sem base", nota do Codex). A web não lê mais `GET custo-hoje`.
- **Fica:** o cálculo (`src/domain/custo-do-dia.ts`, `src/use-cases/custo-do-dia.ts`) e o endpoint `GET custo-hoje`;
  o custo por turno e o "Hoje com X" do modo dev (ADR-054). O endpoint fica sem consumidor na UI, mantido de propósito
  para uma volta do aviso em outro lugar.
- **Limite:** o custo segue visível por task (topo da task e a linha "terminou") e no modo dev/Raio-X; o total do dia
  por bot e o aviso de ritmo fora do normal não aparecem mais na tela. Gatilho para rever: gasto fora do ritmo que a
  pessoa só descobre na fatura.

## Emenda (2026-10-26, ADR-130) — item 1

- **A triagem da rotina e do colega roda nos bastidores da conversa do dono**, em paralelo à fala da pessoa. A conversa
  tem duas faixas (`turnos.bastidores`, 0121): a da pessoa e a dos bastidores (rotina, delegação, peer, sob procuração e
  as retomadas deles); cada uma é serial e uma não espera a outra. "A pessoa passa na frente" passa a valer também para o
  que já roda: a fala dela não espera mais uma rotina ou um pedido de colega em andamento. O turno da pessoa vê no prompt
  o que roda nos bastidores. A drenagem do motor (ADR-100) continua entregando a fala da pessoa.

## Alternativas rejeitadas

- **Manter tasks como pares e coordenar por fora** (esperas como objeto, registro de efeitos, painel do orquestrador): é
  construir um harness de coordenação de pares, com mais estado e mais tela. Remenda as consequências da forma.
- **Dono por branch ou trava de push no hook:** regra específica de código que não generaliza e cria problemas novos.
- **Sessão única do CLI como dono:** mistura modo, catálogo e procuração, e pela ADR-047 a sessão retomada carrega a marca de
  conteúdo de fora de qualquer pedido que entrou nela.
- **Subagente do harness como frente:** só o Claude tem, e o Nod não o enxerga.
- **Esperar com Bash em segundo plano do CLI:** segura o turno e a fila do bot, e o Codex não tem terminal.
- **Teto fixo de frentes** (o Hermes recusa a 11ª): o Marlon rejeitou teto (ADR-083/085); a máquina decide.
- **Um pedido de colega por vez em cada bot:** limitaria pelo número, não pela capacidade, e desperdiçaria o bot com
  pedidos independentes. O que ele tentava evitar (missões colidindo) se resolve com branch por frente e o julgamento do
  dono na entrada.
- **A rotina como coordenador próprio** (abrindo até 10 frentes sem passar pelo dono): criaria um segundo dono dentro do
  bot.
- **O Nod virar o harness** (como o Hermes): perderia os laços de agente afinados pelos fabricantes e as assinaturas das
  pessoas; o Nod fica com a coordenação e os CLIs com o trabalho.

## Limites

- **O contexto do dono cresce.** Só o Claude retoma sessão; o Codex recebe as últimas mensagens. A frente devolve resumo
  curto; a compactação continua manual (`/compactar`) ou do CLI. Medir antes de criar regra.
- **Esperas sem comando** (a resposta de uma pessoa sem conector que avise) usam `me_chame_as` com a mesma paciência do item 5.
- **O computador do bot** continua um por bot (ADR-037); frentes que precisam dele esperam a vez.
- **A pessoa pode esperar o turno do dono.** O dono é leve, mas um turno dele em andamento vai até o fim antes da próxima
  mensagem da pessoa.
- **A leitura da cota depende do provedor.** Se o CLI não expõe quanto da janela foi usado, o Nod começa pelo sinal de
  limite e estima a porcentagem pelo que já gastou; a reserva de 1% garante alguns turnos de conversa, não trabalho longo.
- **Muitas frentes enchem o contexto do dono** mesmo com resumos curtos. Medir antes de criar regra.

## Gatilho de reversão

- Mais de 10% das mensagens da pessoa esperando mais de 5 min na fila do dono em 2 semanas: reabrir uma faixa paralela para
  a pessoa.
- A pessoa abrindo o detalhe das frentes em mais de 30% das vezes em 2 semanas (medido em "ver as N" e na pílula alargada,
  tipo `frentes`, desde a emenda do PR 8): as frentes voltam a aparecer como itens próprios.
- Mais de 20% das esperas acordando o dono sem fato novo: rever o `esperar_comando` e a orientação do prompt.
- A conversa com a pessoa parada por falta de cota mesmo com a reserva, mais de uma vez por semana: rever a reserva de 1%.

> Cruzamento (2026-10-27, NOD-376): a fala da pessoa na tela de uma frente fica na frente (moldura própria) e não
> volta ao dono; ver a emenda NOD-376 da [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md).

> Emenda (2026-10-28, NOD-377): a espera "Esperando <colega>" do dono sempre tem fim e mostra "sem resposta há X" com
> Cobrar e Desistir quando vence; ver a [ADR-132](adr-132-toda-espera-de-colega-tem-fim.md).
