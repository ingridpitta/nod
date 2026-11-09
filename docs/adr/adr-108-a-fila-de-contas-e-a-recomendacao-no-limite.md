# ADR-108 — A lista de contas é a fila; no limite, a task espera e o Nod recomenda

Status: aceito (decisões do Marlon de 15 e 16/10/2026, aprovadas em 16/10 por volta das 02:20; implementação autônoma
do PR 2 do plano, sob a autorização dele) · Data: 2026-10-16 · Emenda a
[ADR-036](adr-036-harnesses-e-modelos.md) (o Automático troca de IA), aos itens 4 e 6 da
[ADR-101](adr-101-varias-contas-por-ia-um-diretorio-por-conta.md) (termos de uso; "Perguntar antes / Trocar sozinho"),
à [ADR-102](adr-102-contas-da-pessoa-em-todas-as-maquinas.md) (a regra da conta em uso) e às decisões NOD-221, NOD-223 e
NOD-224 · Plano: [docs/plano-limite-e-troca.md](../plano-limite-e-troca.md) (PR 2, R1–R8, E1–E4, E7–E9)

## Contexto

Em 15/10 às 20:39 o Eng 1 tinha 19 frentes abertas no Claude quando a conta marlonwlv (20x) acabou. Três problemas
apareceram juntos:

- **Duas regras para a mesma lista.** A lista de Provedores tinha uma ordem e, por cima, o seletor "Perguntar antes /
  Trocar sozinho" (ADR-101 §6). O "Perguntar antes" (o padrão) parava tudo para perguntar mesmo quando a próxima conta
  da mesma IA estava livre. O opt-in "pode entrar na troca" só valia para a conta corporativa.
- **A task trocava de IA sem ninguém decidir.** No assentamento a task esperava a conta voltar, mas no despacho o plano
  punha a IA sem conta em `noLimite` e entregava a task pendente do bot no Automático ao ChatGPT
  (`emitir-plano-turno.ts`, E1). A frente recomeçava do resumo, sem a sessão do Claude, e ninguém tinha escolhido isso.
- **O bot fixo ficava preso sem saída.** Um bot "só Opus" sem outra conta do Claude na fila só mostrava a nota de
  limite; os caminhos possíveis (uma conta fora da fila, ou outra IA até a volta) não apareciam.

## Decisão

1. **A lista é a fila (R1, E2, E4).** `contas_ia.entra_na_troca_automatica` passa a significar "na fila" para toda
   conta, pessoal ou corporativa. Quando a conta em uso bate no limite, o Nod passa sozinho, sem perguntar, para a
   próxima conta **da mesma IA** que está na fila, em ordem de posição. Some o "Perguntar antes / Trocar sozinho":
   `preferencias.contas_modo` fica no banco e no `GET /contas-ia` (o app antigo lê) e o `PUT /contas-ia/modo` continua
   respondendo, mas nenhuma decisão o lê.
   - A escolha automática só considera contas na fila. Conta fora da fila só entra por escolha explícita da pessoa
     (`contas_escolhidas`, "Seguir com" / "Continuar na conta").
   - Sem nenhuma conta da IA na fila **nesta máquina**, vale a escolhida e, sem escolhida, a primeira da IA na
     máquina — a pessoa nunca fica sem IA no primeiro uso (é o que a máquina fazia antes da fila).
2. **Termos de uso: a fila é o consentimento (ADR-101 §4, mantido).** A 1ª conta pessoal de cada IA nasce na fila; a
   2ª em diante e a corporativa nascem fora. Ligar uma delas na tela mostra o aviso dos termos que já existia ao ligar
   "Trocar sozinho" (o mesmo texto, `TERMOS_DA_TROCA`); a pessoa consente uma vez por conta. Desligar nunca pergunta. A
   migração **0080** liga, por pessoa e IA, a conta pessoal não removida de menor posição; quem já usava "Trocar
   sozinho" já tinha consentido, então todas as pessoais dele entram. A corporativa só continua na fila para quem estava
   no "Trocar sozinho" e a tinha marcado (revisão do PR 2, C4).
   **Emenda NOD-308 (2026-10-20; decisão do Marlon na NOD-221 item 3, 19/10): conta corporativa segue a mesma regra da pessoal; não há mais exceção por plano.** A 1ª conta de cada IA nasce na fila, seja pessoal ou
   corporativa; a 2ª em diante nasce fora. A conta que vira corporativa não sai da fila. A migração **0095** liga a
   corporativa que estaria na fila se fosse pessoal (1ª ativa da IA, ou quem estava no "Trocar sozinho").
   **A leitura jurídica dos termos (Anthropic: "ordinary, individual usage"; OpenAI: "circumvent rate limits") não foi
   validada: fica sinalizada para o Marlon/jurídico antes de a fila virar padrão para clientes.**
3. **Outra IA só no Automático (R2).** Bot com IA fixa nunca troca de IA: `decidirLimiteDaConta({ iaFixa })` e
   `semContaParaOTurno(…, iaFixa)` só olham as contas dela (nem as oferecem como "livres").
4. **Conversa no Automático troca de IA na hora (R3).** Sem mudança.
5. **Task com sessão na IA que parou não troca de IA sozinha (R4, E1).** "Tem sessão" = `trabalhos.sessao_cli` não nulo
   e `sessao_harness` = a IA que parou. Ela espera a volta da conta (a retomada com `acordar_em` = a primeira conta da
   fila que sai do limite) e o bot ganha **um** aviso de troca (`trocas_de_ia`, um aberto por bot e IA; a task seguinte que
   para atualiza o mesmo) com a recomendação `recomendacaoDaTroca`:
   - volta em até 30 min → **esperar**; sem resposta, nada acontece;
   - mais de 30 min, ou o fornecedor não disse quando → **levar** para a outra IA; sem resposta, o varredor aplica
     sozinho 10 min depois do aviso.
   A task **sem** sessão na IA que parou segue na outra IA na hora (não há o que perder). A mesma guarda vale no
   despacho (E1): o turno de task do Automático cuja sessão é de uma IA que não serve agora volta a esperar em vez de
   sair no plano por outra IA. "Levar" reescreve os turnos pendentes das tasks do bot na IA que parou para a IA nova
   (fixa naquele turno, modelo pela escolha do bot) e acorda só as esperas da cota (prefixo `ENTRADA_DA_VOLTA_DA_COTA`),
   com uma entrada que diz que a task mudou de IA; o "me chame às" (ADR-086) mantém a hora. A decisão é
   `UPDATE … WHERE decidido_em IS NULL`: o clique e o varredor ao mesmo tempo, um vence e o outro não aplica nada.
   **Emenda (2026-10-20, NOD-310): a passagem de bastão.** Ao levar a task (clique, varredor, seletor ou R4), o
   primeiro turno sem a sessão anterior recebe uma passagem de bastão montada pelo nod com os dados do trabalho
   (pedido, progresso, decisões, erros, efeitos externos) e pelo executor com o estado do git e do PR. Teto ~3k tokens
   (9 mil caracteres do servidor + 3 mil do git), mais recentes primeiro. Não chama a IA que parou. O gatilho é
   `trabalho.sessaoCli && !entrada.sessaoCli` fora da ligação (`emitirPlanoTurno`); o plano marca
   `entrada.passagem.git` e o executor anexa o "Estado do branch" (git e `gh pr list`, 5 s por comando) antes do
   driver. O "Levar" preserva o "Pedido original da frente" da entrada ao trocar o aviso. Código:
   `src/domain/passagem-de-bastao.ts`, `src/use-cases/passagem-de-bastao.ts`, `src/adapters/executor/estado-do-git.ts`.
   **Emenda (2026-10-28, NOD-312): o mesmo mecanismo serve à conversa que recomeça.** O 1º turno de conversa do bot
   (origem conversa/retomada, sem trabalho, delegação, sala ou ligação, depois do /nova-sessao) que sai sem a sessão
   que a conversa tinha ganha um motivo (`turnos.motivo_recomeco`: troca de conta, de IA, de máquina ou sessão
   recusada), gravado uma vez. O motivo sai das mesmas variáveis da regra de retomada (ADR-107), que não muda. A
   entrada leva um aviso fixo e um resumo do trabalho (os últimos 8 turnos de conversa: ferramentas por nome e vezes,
   efeitos, erros, decisões; nunca saída de ferramenta; `redigirSegredos` em tudo; teto 3 mil caracteres), montado por
   `renderizarSecoes` de `passagem-de-bastao.ts`. A web mostra a carona "· relê o necessário" na linha da troca ou a
   marca "recomeçou" na fala. Código: `src/domain/recomeco.ts`, `src/use-cases/resumo-do-recomeco.ts`,
   `web/lib/recomeco.ts`.
6. **Trocar a IA do bot pelo seletor com tasks em andamento (R5, E8).** `PUT /agentes/:id/inteligencia` aceita
   `levarTasks?: boolean`, separado no caso de uso antes da validação estrita. A web pergunta "Só daqui em diante"
   (padrão) ou "Levar as tasks também".
   *Emenda (NOD-368, 28/10/2026):* a troca de IA **em lote** (Configurações › Agentes, vários bots de uma vez) não
   pergunta: vai sempre como "Só daqui em diante" (o PUT sem `levarTasks`), pelo mesmo `PUT /agentes/:id/inteligencia`
   da ficha, um por bot. A prévia avisa quem está no meio de uma tarefa ("a troca vale a partir do próximo pedido").
   Levar as tasks continua sendo escolha de um bot por vez, na ficha. Gatilho de reversão: pedido de "levar as tasks"
   em lote.
7. **Bot fixo sem conta da IA dele na fila (R6).** No lugar da nota, o aviso diz o estado ("O Eng 1 está parado até
   13:00"), que ele volta sozinho, e oferece os caminhos que existem: (a) "Continuar na conta <fora da fila>" — o
   "Seguir com" estendido: grava a escolhida, acorda as tasks do bot que esperavam a IA e fecha o aviso; (b) "Continuar
   no <outra IA> até HH:MM" — guarda a inteligência em `trocas_de_ia.volta_ao_fixo`, passa o bot ao Automático, leva as
   tasks e refaz a fala; o varredor devolve a inteligência fixa quando a conta volta (se a pessoa não mexeu nela
   depois). Sem nenhum caminho, fica a nota de sempre.
8. **Mesma IA, só troca de conta (R7, E3; no ChatGPT, emendado pela revisão do PR 2, I1):** linha leve, sem cartão ("marlonwlv (20x) acabou às 20:39 → seguindo no
   Claude · Marlon 20x · mesmo modelo"); as tasks seguem na hora em qualquer provedor (no Codex, pelo histórico).
9. **Provedores (R8):** um liga/desliga "na fila" por conta, na própria linha, e três linhas fixas que dizem como o Nod
   age (mesma IA, outra IA, tasks em andamento). Nada para configurar.

## Suposições registradas (decididas sem o Marlon, no autônomo)

- **E4 por máquina.** "Nenhuma conta da IA na fila" é avaliado entre as contas logadas na máquina do turno, não na lista
  inteira: senão uma VM com só a 2ª conta (fora da fila) pararia com a nota dizendo que ela está "no limite" sem estar.
- **A volta da IA** (revista no PR 2) é a primeira conta que volta a servir pela regra da conta em uso, na máquina-alvo do
  bot (a da fila, a escolhida ou, sem fila, a primeira da IA lá); sem lista de contas,
  o limite da IA em `preferencias.ias_no_limite`; sem nada, vazia (I6: a espera da task tenta de novo em 1 h).
- **Caminho sem lista de contas** (motor ou app anterior à ADR-102): a mesma regra R4 vale para a task do Automático
  quando outra IA está pronta (`aposLimiteDaIaNoFundo`).
- **O aviso mora na conversa do bot, sem turno**, quando nasce de uma task (a linha de um turno de task iria para a tela
  da task); quando nasce da fala da conversa (bot fixo), leva o turno dela, para o "Continuar na conta" refazer a fala.
- **Fechamentos novos além do pedido:** `conta` (R6 a) e `outra_ia` (R6 b) entram no CHECK de `trocas_de_ia.decisao`.
- **"Voltou"** fecha o aviso aberto e acorda as esperas da cota da IA daquele bot, também quando o limite saiu antes do
  prazo (um turno que deu certo).

## Revisão do PR 2 (16/10/2026, autônoma, sob a autorização do Marlon)

A revisão de engenharia do PR 2 achou seis falhas de regra (C1–C6) e oito pontos menores (I1–I8). Todos foram corrigidos
com teste; as decisões abaixo foram tomadas sem o Marlon e ficam para ele confirmar.

- **Máquina-alvo (C2, C5).** O aviso grava `trocas_de_ia.machine_id`: a máquina das tasks do bot (a dele, senão a
  padrão da pessoa, com a chave viva; senão a que pegou ou entregou o turno). "Parou", "voltou" e "volta em" são UMA
  regra (`estadoDaIa`): a conta em uso da IA entre as contas logadas NAQUELA máquina (`contaDoTurno`), a volta pela mesma
  regra (`voltaDaIa` com `naMaquina` e a escolhida). Uma conta livre só noutra máquina não fecha o aviso — era o laço de
  avisos a cada 30 s. A outra IA do aviso ("levar") precisa estar pronta na máquina-alvo (`prontosPorMaquina`, agora
  também no despacho e nas pontes HTTP). Sem nenhuma pronta lá, a recomendação vira "esperar", sem prazo, e o cartão diz
  "O ChatGPT não está em <máquina>, a máquina do <bot>" (`payload.foraDaMaquina`); a task sem sessão também espera.
- **A cota medida (C1).** `estadoDaIa` põe por cima a cota do uso do plano (`cotaDasIas` + `cotaSegura`): a task com
  sessão é `fundo_seguindo`, então só o limite medido (100%) a segura — ela espera a janela renovar com o aviso, em vez de
  sair no ChatGPT. Na reserva (99%), a task que já começou segue na IA da sessão: o plano não põe essa IA no "no limite"
  dela (`emitir-plano-turno.ts`).
  *Emenda de 2026-10-28 (NOD-401):* com conta da IA logada na máquina, a cota medida é **por conta**
  (`uso_do_plano_contas`, `contasComCota`, a mesma regra de `cotaDasIasComContas`). A conta que a leitura dela segura
  conta como no limite, e a próxima da fila segue sozinha. A linha por IA (`cotaDasIas`) só vale para IA sem conta na
  máquina. O plano põe na frente a IA da sessão que ainda tem conta utilizável, para que a posição das contas na lista
  não a leve para outra IA em silêncio. A outra IA oferecida e o "voltou" do varredor usam a mesma visão. O cartão diz a
  conta cuja volta ele mostra (`contaQueParou`). Isso vale também para o bot com ordem própria: a task com sessão fica na IA
  da sessão enquanto ela tiver conta livre, porque o R4 vem antes da ordem. No ChatGPT (I1), a prioridade vale só quando
  a conta da fila é a da sessão; com outra conta, decide o aviso de troca de conta. No assentamento, o fundo que segue na
  próxima conta da mesma IA ganha a linha leve "acabou → seguindo no …" e a entrada da troca, nunca "espera e volta
  sozinha", e quem pediu não recebe aviso de espera.
  A troca de conta não conta como espera (`ehTrocaDeConta`): se a conta seguinte também bate o limite, a cadeia sem task
  ganha a linha de espera e o aviso a quem pediu. A decisão do assentamento para o fundo também lê a cota por conta, então
  não diz "seguindo no …" para uma conta que a leitura dela segura. Duas suposições ficam registradas. Com várias contas
  no limite, o cartão nomeia só a que volta primeiro, porque é a volta que ele mostra. No ChatGPT, com a sessão numa conta
  livre que não é a primeira da fila na máquina, o plano ainda escolhe a da fila e o aviso de troca de conta decide. Esse
  comportamento já existia antes do NOD-401 e fica para um follow-up.
  O fundo que não segue na hora espera a primeira conta da fila da IA na máquina que volta, pela mesma visão da cota, e não
  só a conta desta rodada. A troca de conta numa cadeia que já esperou leva essa marca na entrada (`cadeiaJaEsperou`), para
  que a cadeia continue com uma só linha de espera e um só aviso a quem pediu.
- **O aviso reaberto (C2).** Reabrir o aviso do mesmo bot e da mesma IA até 30 min depois de fechar reaproveita a linha
  do anterior na conversa (`JANELA_DO_AVISO_MS`), só no aviso das tasks.
- **Herança do "esperar" (C3).** A pessoa escolheu "esperar" para (bot, IA) e a IA não voltou: a task seguinte que para
  herda a escolha — nenhum aviso, nenhum prazo novo; só a contagem da linha sobe. O aviso fechado com "esperar" ou
  "conta" espera a IA voltar (`voltou_em`); quando ela volta, o varredor acorda as esperas da cota. A espera decidida vale
  no máximo 1 dia (`ESPERA_DECIDIDA_VALE_MS`), para não ficar no varredor para sempre se a máquina saiu da conta.
- **Consentimento da corporativa (C4).** Backfill da 0080: a corporativa marcada sai da fila para quem não estava no
  "Trocar sozinho" — no "Perguntar antes" a marca não trocava nada sozinha, e agora trocaria. A conta que vira corporativa
  sai da fila; a que volta depois de removida segue a regra de nascimento (1ª pessoal da IA na fila, senão fora). Duas
  contas nascendo juntas já esperavam uma pela outra no lock da pessoa do anúncio (`pg_advisory_xact_lock`, antes da
  leitura); ficou provado por um teste de concorrência.
- **Levar ao Automático (C6).** "Levar as tasks também" com destino Automático fixa cada turno na IA que o Automático
  escolheria AGORA na máquina do bot, fora a IA que parou. Sem nenhuma, nada é levado e a conversa do bot ganha a linha
  "Nenhuma IA está pronta agora na máquina do <bot>…".
- **Codex (I1).** A sessão do Codex mora na pasta da conta: trocar de conta no ChatGPT perde a sessão. Por isso a task
  com sessão no ChatGPT cuja conta da sessão parou NÃO segue na hora noutra conta: espera e ganha o aviso, cujo "levar" é
  "seguir noutra conta do ChatGPT" (`ia_para = ia_de` com `conta_de`; o CHECK só aceita assim). O "voltou" desse aviso é
  a conta da sessão sair do limite. A guarda do despacho segura o turno do Automático pela mesma regra. No Claude, nada
  muda (a sessão é compartilhada entre as contas). Provedores: "No Claude, nada se perde. No ChatGPT, a task com sessão
  recomeçaria do resumo noutra conta: o Nod recomenda esperar ou seguir, e você decide."
- **Um aviso por bot e IA (I2).** O índice único parcial é `(tenant, agente, ia_de)`; a decisão leva `trocaId` (a web
  manda; sem ele, com dois avisos abertos, é entrada inválida).
- **Volta do bot fixo (I3).** O varredor devolve só o modo e a IA fixa, e só se a inteligência ainda for a que o
  "Continuar no <outra> até a volta" gravou; as tasks que esse caminho fixou na outra IA voltam à inteligência do bot
  (`trazerTasksDeVolta`). Limite conhecido: um turno de task fixado na outra IA por outro motivo no meio do caminho também
  volta.
- **A escolhida fora da fila (I4).** O "Seguir com"/"Continuar na conta" grava a escolhida da pessoa inteira; quando a
  fila daquela IA volta a ter conta livre na máquina do bot, o varredor a solta, se ela estiver fora da fila (a
  corporativa não vira caminho silencioso).
- **Varredor (I5).** Cada aviso roda num SAVEPOINT (o padrão dos órfãos), e contas, preferências e uso são lidos uma vez
  por pessoa no tique.
- **Sem hora do fornecedor (I6).** O aviso grava `volta_em` nulo (nada de +1 h inventada): a recomendação é "levar" e o
  texto diz que o fornecedor não disse quando volta. A espera da task continua tentando de novo em 1 h. Limite conhecido:
  a guarda do despacho lê a volta pela conta marcada no limite, e a conta sem hora fica marcada com 1 h — nesse caminho a
  volta do aviso pode virar essa hora.

## Alternativas descartadas

- **Manter "Perguntar antes" como padrão.** É o que parou o Eng 1 com conta livre na mesma IA.
- **Levar as tasks sempre para a outra IA.** As frentes perdem a sessão; com a volta em minutos, esperar é melhor.
- **Esperar sempre.** Com a volta em 16 horas, as tasks ficam paradas a noite inteira.
- **Pôr toda conta na fila no backfill.** Seria consentir pela pessoa com a troca automática entre contas da mesma IA,
  o caso das cláusulas dos termos.

## Consequências

- Quem tinha "Trocar sozinho" segue trocando entre as pessoais; quem tinha "Perguntar antes" passa a trocar sozinho só
  se ligar a 2ª conta na fila (com o aviso).
- O app do Mac no caminho da ADR-101 (`resultado.contaNoLimite`, as contas guardadas no Mac) segue igual: o seletor
  "Trocar sozinho" dele continua lá.
- A ligação de voz trocando de IA com bot fixo e o bot dizendo o que não fez ("Retomei as 19 frentes com ChatGPT") ficam
  para issues próprias.

## Gatilho de reversão

- O jurídico ou um fornecedor disser que a troca automática entre contas da mesma IA viola os termos: a fila volta a
  ser só a 1ª conta de cada IA (o liga/desliga da 2ª em diante some) e a troca entre contas volta a ser pergunta.
- O aviso de troca gerar mais ruído do que ajuda (a pessoa ignorando e as tasks paradas): a recomendação passa a ser
  aplicada sempre no prazo, inclusive "esperar".
- Medir que tasks levadas para a outra IA recomeçam mal com frequência: subir o limite de 30 min ou tirar o "levar"
  automático.
