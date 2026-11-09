# ADR-143 — Quadro com várias pessoas: a porta é a dona

Status: proposta (2026-11-02, NOD-443) · Estende [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (as ações
`quadro.*`) e a [ADR-144](adr-144-codigo-da-tarefa-e-mover-entre-quadros.md) (histórico da tarefa).

## Contexto

O quadro da NOD-442 é de uma pessoa só. A NOD-443 pede gente do time no mesmo quadro, com três modos de conversa que a
dona escolhe (só ela; cada um na sua conversa, com mural; uma conversa do grupo), pendência só para quem decide, "Fulano,
pelo bot X" em toda mudança e o mesmo funcionamento a partir de qualquer bot. As decisões de produto D1–D9 estão no
comentário 🧭 da issue (protótipo v1 aprovado).

Hoje o quadro, as tarefas, os lotes e o histórico têm RLS de dona (`nod_escopar_tabela`, sem perna): ninguém mais lê nem
escreve. Abrir leitura e escrita para quem participa no próprio Postgres seria uma policy de SELECT por tabela (quatro) e
policies de UPDATE/INSERT com triggers que fecham colunas (AGENTS.md), mais a leitura dos bots da dona (os nomes dos
responsáveis), que também são dela.

## Decisão

1. **A porta é a dona.** As tabelas do quadro ficam como estão. Entra `quadro_membros` (0146), da dona, com a perna
   `pessoa_id = eu` na leitura: quem participa lê só a própria participação, e só ela. Para ler ou mexer, a porta
   (`Deps.quadroDaDona`, `src/db/porta-da-dona.ts`) lê a participação no escopo da pessoa, **troca o escopo da MESMA
   transação** para o da dona (`vincularEscopo`, como a importação de espaço) e **confere a participação de novo lá
   dentro**; o lote trava o quadro e confere uma terceira vez, então quem saiu antes do lock não passa. No fim o escopo
   volta ao da pessoa, com erro ou sem. Lá dentro roda o MESMO `aplicarLoteQuadro` da tela e do `gerir_quadro`, com
   `pedidoPor` = a pessoa. Quem não participa recebe `nao_encontrado` (não vaza que o quadro existe). A volta,
   `Deps.avisoComVoce`, faz o caminho contrário só para avisar e só grava esse aviso: a dona entra no escopo de quem
   participa de um quadro dela (conferido no escopo da dona), confere que o bot é dessa pessoa e grava o aviso de "Com
   você" na conversa dela, com autoria de regra (`regra:quadro_com_voce`), sem entregar o escopo a mais ninguém. As duas portas
   são montadas juntas por `comPortas` (`compor.ts`, `executar-caso.ts` e o helper de teste).
2. **Quem pediu fica no lote e na tarefa** (`quadro_lotes.pedido_por`, `quadro_tarefas.pedido_por`). O bot que fez é o
   `autor_agente_id` de sempre. Assinatura no padrão da NOD-430: "Ana, pela Ada"; para quem lê, "Você, pela Ada".
   O turno que o próprio quadro começou (a delegação de uma tarefa) não tem quem pediu e não entra no mural (D8).
3. **Modo por quadro** (`quadros.modo_conversa`, padrão `individual`, D3). Só a dona troca, por `mudar_modo` (tela ou
   qualquer bot dela), e a troca é um lote com Desfazer. No `so_dono`, o pedido de quem participa vira comentário na
   tarefa, para a dona (`quadro_tarefa_comentarios`, D7), e a resposta volta no canal de quem pediu: nunca erro mudo.
   A conversa de cada pessoa mora no escopo dela e nunca vira pública (D4).
4. **Quem decide** (D5): quem pediu a tarefa, se ainda participa (ou é a dona); senão o responsável humano (a tarefa
   ainda não tem); senão a dona. Calculado na leitura: quem sai devolve a pendência à dona sem migrar nada. Só quem
   decide responde; o resto vê "Esperando Fulano".
5. **Desfazer** (D9): quem pediu o lote e a dona.
   **O que quem participa faz na tarefa dos outros** (revisão 1 do PR #628, achado 6): na tarefa que ela pediu, tudo;
   na de outra pessoa (`pedido_por ≠ eu`), muda o status e comenta, mas não exclui nem reescreve o título, a descrição ou
   o responsável (`nao_permitido`, com o caminho na recusa). Responder e tirar de Com você continua só de quem decide.
   A dona mexe em qualquer tarefa.
6. **Ao vivo**: depois do commit, `quadro.mudou` vai para a dona e para cada pessoa do quadro.

## Consequências

- Nenhuma transação a mais: o pedido de quem participa é uma transação só, com duas trocas de escopo (a dela → a da
  dona → a dela). O que o lote grava confirma ou desfaz junto com o resto do pedido.
- O escopo da dona só é aberto pela porta, depois da participação conferida: a superfície são `portaDaDona` e
  `avisoComVoce` (`src/db/porta-da-dona.ts`), cobertas pelos testes de escopo
  (`tests/integration/quadro-pessoas.test.ts`) e pela corrida de quem sai (`tests/concurrency/quadro-pessoas-corrida.test.ts`).
- A conversa única do grupo (modo 3) não entra nesta etapa: o modo persiste e as regras valem (todos pedem, só quem
  pediu desfaz); a sala compartilhada fica para a próxima.

## Suposições da revisão 1 (PR #628), para a Ada confirmar

Escolhas de produto feitas na correção, sem decisão registrada antes. Cada uma está num teste de
`tests/integration/quadro-pessoas*.test.ts`; mudar uma é mudar o teste.

- **Achado 1.** O turno que o pedido de quem participa começa no bot da dona nasce não confiável e contaminado, sob a
  procuração de quem pediu (não da dona), com a autoria dela. Exceção no `gerir_quadro`: nesse turno, o bot da dona
  continua mexendo no card da tarefa (a corrente de um salto aceita quando o quadro do turno é da dona e quem pediu
  participa). `editar_quadro` (a meta entra em todo turno de tarefa) passa a ser só da dona.
- **Achado 2.** Só quem decide responde ou tira a tarefa de Com você. O turno que o próprio quadro abriu (sem quem
  pediu, `quemPediu` null) continua podendo retirar a própria pergunta.
- **Achado 3.** Os deps que a porta entrega são os da dona inteiros; restringir ao que o caso de uso usa fica pendente
  (`aplicarLoteQuadro` recebe `Deps`).
- **Achado 5.** O aviso de "Com você" para quem participa vai só pelo bot pelo qual ela pediu (o último lote dela com
  autor bot, de preferência o que tocou a tarefa), como mensagem não confiável, só com o código e o nome da dona, sem
  a pergunta. Quem pediu pela tela (sem bot) vê só o card e o `quadro.mudou`.
- **Achado 6.** Na tarefa de outra pessoa, quem participa muda o status e comenta, mas não exclui nem reescreve
  título, descrição ou responsável (item 5 da Decisão).
- **Achado 7.** O "executor da dona" é o do último turno dela (não sob procuração de outra pessoa) na conversa do bot;
  sem turno dela ali, o do pedido.
- **Achado 9.** O comentário de quem participa ou de um turno não confiável é `de_fora`; o teto é de 50 comentários por
  pessoa em cada tarefa (e no quadro), e a recusa pede para juntar num só. O comentário sai com a tarefa.
- **Achado 11.** A primeira pessoa e o modo escolhido na tela vão no mesmo lote (`adicionar_pessoa {pessoa, modo?}`).

## Suposições da revisão 2 (PR #628), para a Ada confirmar

- **Achado 1.** Só a dona troca quem pediu uma tarefa que já existe (pôr para andar, responder). Quem participa muda o
  status da tarefa da dona sem virar quem pediu.
- **Achado 2.** No turno que o pedido de quem participa abriu, o bot da dona age sob a procuração dela (as regras são as
  de quem pediu) e só na tarefa do turno: não cria, não exclui nem muda outra tarefa, não comenta em outra, não mexe na
  meta, no prazo ou nas colunas e não desfaz. O lote não entra no mural (não é um pedido dela, D8).
- **Achado 3.** O turno limpo que lê o quadro de outra pessoa, ou um quadro com tarefa pedida por outra pessoa ou
  comentário de fora, fica contaminado (ADR-047).
- **Achado 5.** ~~Quem participa ainda não tem a tela do quadro~~: a NOD-455 a entregou (ver "A tela de quem participa"
  abaixo); o aviso de "Com você" ganha o link "Abrir no quadro".
- **Achado 6.** O turno que o próprio quadro abriu (sem quem pediu) só tira de Com você a tarefa dele; sem turno, nenhuma.
- **Achado 7.** O modo `grupo` sai das escolhas (ferramenta e servidor) até a conversa do grupo existir.

## Suposições da revisão 3 (PR #628), para a Ada confirmar

- **Achado 1 (o bot da dona a pedido de outra pessoa).** O turno que o pedido de quem participa abre no bot da dona
  (`sobProcuracaoDe` ≠ dona) roda em modo manual, seja qual for o modo do bot (automático ou total): toda ação com
  efeito fora pede aprovação, e a aprovação é da dona. Esse turno não tem terminal, computador, pasta de trabalho
  (`workspace`) nem as ferramentas nativas de arquivo, e não chama `pedir_a_bot`, `encaminhar` nem `pedir_credencial`:
  o que a dona deu ao bot dela não vira de quem participa do quadro. Regra em `modoNoTurno` e `aPedidoDeOutraPessoa`
  (`src/domain/modo-aprovacao.ts`), aplicada no plano do turno e em todo leitor do modo em runtime.
- **Achado 2.** `pedir_a_bot` recusa (`nao_permitido`) o turno a pedido de outra pessoa, mesmo chamado por fora do plano.
- **Achado 4.** O aviso de "Com você" é do bot de quem participa, com `decidido_por` de regra; o evento do quadro grava
  como conta de execução quem pediu (a pessoa que participa), ou a dona quando o bot dela age sob procuração.
- **Achado 5.** O comentário aponta tarefa do MESMO quadro (chave composta `(tenant_id, quadro_id, tarefa_id)`) e vai
  junto quando a tarefa muda de quadro.
- **Achado 6.** `pedido_por` fica sem chave estrangeira para `pessoas` (justificativa na 0146): nulo é a dona, o
  `owner_id` das tabelas escopadas também não tem essa chave, e quem sai do quadro devolve a pendência à dona pelo caso
  de uso, não pelo banco.

## Suposições da revisão 3 pós-merge (PR #628), para a Ada confirmar

Pendências de produto do merge com a NOD-417, mais as escolhas desta correção. Cada uma está num teste de
`tests/integration/quadro-pessoas.test.ts` ("revisão 3 pós-merge") ou de `tests/unit/domain/`.

- **`turnoConfiavel` (merge 417 × 443).** O `planejarLote` separa duas confianças: `origemConfiavel` (o conteúdo é de
  fora: marca `deFora` e barra meta e colunas) e `turnoConfiavel` (o turno do bot autor está limpo: valem ou não as
  travas da 417 de se tomar a tarefa, passagem segurada e `terminei` alheio). O pedido de quem participa é de fora, mas
  num turno limpo dela o bot que ela nomeia começa; num turno sujo, a tarefa fica com o bot sem acionar (`comecaram: []`,
  pelo `gerir_quadro` e pela porta). Pendente: a Ada confirmar que quem participa, de um turno limpo, aciona os bots da dona.
- **Comentário (417) × recado (443).** Há dois caminhos com o mesmo nome de op (`comentar`). No próprio quadro, com
  tarefa, é o comentário da NOD-417 (`quadro_comentarios`, `comentarTarefa`): aciona o responsável e os @mencionados.
  De quem participa (pela porta) e no quadro sem tarefa, é o recado da NOD-443 (`quadro_tarefa_comentarios`, D7): fica
  para a dona, de fora, e não aciona bot. Pendente: a Ada decidir se os dois viram um só (e se o recado de quem participa
  deve acionar alguém).
- **Achado 1.** O pedido de quem participa nunca se junta a um turno da fila do bot da dona: abre o turno dela (não
  confiável, sob a procuração dela, contaminado, manual). O turno da fila da própria tarefa sai (a tarefa tem um turno só).
- **Achado 2.** Na tarefa de outra pessoa, quem participa também não escreve a pergunta nem o PR. O bot da dona sob a
  procuração dela escreve os dois na tarefa do turno dele (é o trabalho dele), e o PR escrito de fora marca a tarefa de fora.
- **Achado 4.** O recado do bot da dona sob a procuração de quem participa não é de ninguém: sai sem `pedido_por`,
  assinado só pelo bot ("Ada"), e conta no teto do bot, não no de quem pediu.

## Revisão 5 (PR #628): o que a dona deu ao bot não vai a quem participa, para a Ada confirmar

- **Achado 1 (decisão).** O turno a pedido de outra pessoa (`aPedidoDeOutraPessoa`: `sobProcuracaoDe` ≠ dona) não leva
  nada do que é da dona no bot dela: nenhuma ferramenta de conector (nem a leitura, que a regra da consulta sem decisão
  aprovaria sozinha e devolveria os dados dela a quem pediu), nem as memórias do bot, nem o histórico da conversa da dona
  com ele (nem os anexos de antes, nem o "desde a sua última vez"). O pedido de quem participa chega pela entrada do turno;
  o bot trabalha com o quadro e o que ela escreveu. Corte no `montarPlano` (`src/domain/plano-turno.ts`) e no
  `emitirPlanoTurno`; defesa em profundidade no `chamarFerramenta`, que nega (`fora_do_catalogo`, terminal) toda ferramenta
  de conector num plano com essa autoria. A procuração da própria dona (pedido de um bot dela) não muda.
  Alternativa descartada: deixar as leituras e só travar as escritas no manual — a leitura já é o vazamento.
- **Achado 3.** O `gerir_bots` lê o modo por `modoNoTurno`, como todo leitor do modo em runtime.
- **Achado 4.** O aviso do GitHub no topo do quadro (`avisoGithub`) fala da conexão e dos repos da dona: só ela o vê;
  para quem participa (e o bot dela), `null`.
- **Achado 5.** Quem participa não grava PR (`pr_url`) em tarefa nenhuma, nem na que ela pediu (`nao_permitido`): o PR vai
  ao turno do bot da dona como coisa dela. Quem grava é o bot da dona, no turno dele, e o laço do servidor (NOD-421).

## Revisão 6 (PR #628): o resto do que é da dona, para a Ada confirmar

- **Achado 1.** O "Sobre mim" da dona não entra no prompt do turno a pedido de outra pessoa (`emitirPlanoTurno` nem o lê;
  `montarPlano` o omite).
- **Achados 2 e 4.** `ver_colegas` (os bots da dona com rotinas e apps), `listar_rotinas` (as rotinas do bot) e
  `ler_artefato` (os artefatos da conversa dela) entram em `FORA_DO_PEDIDO_DE_OUTRA_PESSOA`. O prompt desse turno vai sem
  o diretório de colegas e sem o inventário de rotinas (`colegas` e `rotinas` vazios; `emitirPlanoTurno` nem lê as rotinas).
  `listar_rotinas` não estava no achado; entrou pela mesma regra do inventário.
- **Achado 5 (defesa em profundidade).** `chamarFerramenta` nega (`fora_do_catalogo`, terminal, sem migração) toda
  ferramenta fora da lista do pedido (`permitidaAPedidoDeOutraPessoa`: só ferramenta do nod, fora de
  `FORA_DO_PEDIDO_DE_OUTRA_PESSOA` e do histórico) num plano com essa autoria. Não só as de conector: computador, pasta e
  as do nod que leem ou gravam o que é da dona também. O catálogo que `montarPlano` monta cabe inteiro nessa lista.
- **Achado 6 (decisão).** Quem participa vê os PRs (`prs`) e as linhas de sistema (`linhas`) das tarefas do quadro, também
  as que o bot da dona abriu: são o estado da tarefa no mural compartilhado (número, estado, CI, conflito, a URL do PR já
  é o `pr_url` da tarefa), não credencial nem configuração. O que fica só com a dona é o `avisoGithub`, que fala da conexão
  e dos repos dela (revisão 5, achado 4). Alternativa descartada: filtrar os PRs de quem participa — o quadro deixaria de
  mostrar por que uma tarefa foi para Feito.

## Revisão 7 (PR #628): o turno a pedido de quem participa só vê o quadro dele, para a Ada confirmar

- **Achado 1.** As frentes e tasks abertas da dona (`trabalhosAbertos`, "Trabalhos em andamento") não entram no turno a
  pedido de outra pessoa: `emitirPlanoTurno` nem as lê e `promptEmPartes` as omite. Com as revisões 5 e 6, o prompt desse
  turno vai sem nada da dona: sem frentes/tasks, "Sobre mim", diretório de colegas e inventário de rotinas (teste de
  integração pelo `abrirTurno`, origem `delegacao`, `sobProcuracaoDe` = quem participa).
- **Achado 2.** No lote do turno sob procuração (`porProcuracao`), `acharQuadro` só acha o quadro do próprio turno
  (`repo.doTurno`), ignorando `quadro` por id ou nome; sem quadro no turno, a falha é genérica (`nao_encontrado`, "quadro
  não encontrado"). A lista "Os quadros da pessoa" (os quadros e os bots da dona) não sai para esse turno.
- **Achado 3.** O quadro que volta ao bot nesse turno é montado com quem pediu como leitor (`leitorDoLote`: `pedidoPor`
  quando `porProcuracao`), então quem participa não recebe o `avisoGithub` da dona (revisão 5, achado 4) nem pela
  resposta da ferramenta.
- **Achado 4 (exceção registrada).** `pedir_aprovacao` continua disponível no turno a pedido de outra pessoa e pode propor
  uma ferramenta de conector da dona (o app dela, que o turno não chama — revisão 5). É a única saída de efeito externo
  desse turno, e de propósito: o pedido vira cartão em "Sua vez" da dona, que decide; nada roda sem o ok dela. Para ela
  decidir sabendo que o pedido não foi dela, o cartão diz "a pedido de <quem participa>" (`aPedidoDe` no `SuaVezDto`,
  preenchido por `listarSuaVez` quando `aPedidoDeOutraPessoa`). Alternativa descartada: tirar `pedir_aprovacao` desse
  turno — o bot da dona não conseguiria mais pedir a ela o que só ela pode autorizar, e a tarefa de quem participa
  pararia sem caminho.

## Revisão 8 (PR #628)

- **O `quadro_mudou` de todo caminho chega a quem participa.** O comentário (`comentarTarefa`: pela tela, pelo bot e pelo
  `pedir_a_bot` com tarefa) e a volta dos PRs do GitHub (`sincronizarPrsDoQuadro`, aviso do topo e linhas) passam pelo
  `comMembros`, como o lote: `dados.membros` vai preenchido e o despacho entrega a cada membro.
- **O modo "grupo" é recusado no servidor.** Saiu do tipo (`MODOS_CONVERSA = so_dono | individual`) e do CHECK da
  migração 0146; `erroDoModo` (domínio) dá o motivo ("a conversa do grupo ainda não existe…") ao `lerOp` e ao
  `aplicarPessoas`, que confere de novo (o lote que chega sem passar pelo `lerOp`). Volta quando a conversa do grupo existir.
- **Executor da dona (corrige o achado 7 da revisão 1).** Sem turno dela na conversa do bot, o turno do pedido de quem
  participa nasce no padrão dela — o palpite `catcher` de quem enfileira (NOD-206), que o plano corrige pela máquina dela
  —, nunca no executor do turno de quem pediu.
- **Quem saiu do quadro não pede pela dona.** `pedir_aprovacao` num turno sob a procuração de outra pessoa, de tarefa de
  quadro, confere que ela ainda participa; se a dona a tirou, volta `recusada` ("quem pediu esta tarefa não participa
  mais do quadro") e nenhum cartão nasce.
- **"A pedido de" também no cartão do revisor** que aparece na conversa, e `listarSuaVez` lê cada turno uma vez e cada
  nome uma vez por chamada.

## A tela de quem participa (NOD-455)

- **Só as rotas do quadro.** A tela (`web/lib/quadro-compartilhado*.ts`, `web/telas/quadro-compartilhado.ts`) lê e muda
  só por `/quadros/:qid…` e `GET /quadros/compartilhados`, nunca pelas `/agentes/:id/…` da dona. O gate da tela é espelho
  do servidor (`regraDoModo`, `pendenciaAlheia`, `tarefaDeOutraPessoa`, `podeDesfazer`); a ação proibida não aparece
  (ausente, não desligada). Quem não participa recebe 404 e vê "Você não participa deste quadro." sem nome nenhum.
- **Vale o experimento da dona.** A porta (`src/db/porta-da-dona.ts`) confere que a pessoa é membro e que o experimento
  `quadro` da DONA está ligado. O de quem participa não decide: com o dela desligado, ela continua vendo (e mexendo, pelo
  gate) nos quadros de outras donas em que participa; com o da dona desligado, o quadro some para todo mundo.
  **Quem decide é o quadro** (decisões 1 e 2 da Ada, revisão 6 do PR #634): a flag do servidor `NOD_QUADROS` (ADR-141
  §6) que vale é a da DONA. O repo de preferências, lido no escopo dela dentro da porta, já junta a liberação dela à
  chave; fora da flag a chave dela lê desligada e o quadro some para quem participa como um que não existe (tela, lista,
  mural, lote e bot). Quem participa não precisa estar na flag nem ter a chave ligada. Isso não abre a flag para ela: o
  quadro próprio, a chave em Experimentos, a pílula e o `criar_quadro` continuam presos à liberação e à chave dela.
- **O bot de quem participa segue a dona.** O `gerir_quadro` entra no plano do bot dela quando ela participa de algum
  quadro que a porta abre (`participaDeQuadroAberto`), mesmo com a chave dela desligada ou fora da flag. A consulta
  (`acoes: []`) lê o quadro da dona pela porta, sem os trabalhos (as execuções são da dona), e contamina o turno; a
  escrita é o mesmo lote de quem participa (o que a API permite). Com a chave dela desligada, os quadros próprios dela
  não entram na escolha do quadro do pedido; repetir, cancelar e recado no quadro de outra pessoa voltam `nao_permitido`.
- **Quem sai recebe o último frame.** O lote que tira alguém marca `dados.sairam` (`comSairam`); o `comMembros` junta essa
  pessoa aos destinatários desse frame (e tira a marca), para a tela dela reler, receber o 404 e virar "sem acesso", e a
  linha sair de "Compartilhados com você". Os frames seguintes já não chegam a ela.
- **Ao vivo, agrupado.** O `quadro.mudou` deste quadro relê em 250 ms (uma rajada vira uma leitura); o frame que chega
  com uma ação em voo relê quando ela acaba; o SSE que reconecta relê a tela e a lista. A releitura não apaga o que a
  pessoa digita (o campo que ela mudou fica com o valor dela).

## Gatilho de reversão

Se uma segunda feature precisar de leitura compartilhada das mesmas tabelas (ex.: busca entre quadros de outras pessoas),
trocar a porta por policies de leitura por participação no Postgres e manter o caso de uso só para a escrita.
