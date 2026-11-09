# ADR-132 — Toda espera de colega tem fim

Status: aceita no PR #544 (NOD-377) · Data: 2026-10-28 · Emenda da ADR-084 (pedido a colega parado avisa ou retoma) e
da ADR-099 (o painel "Esperando <bot>").

## Contexto

Em 26/10 o painel do Marlon mostrava "Esperando Leonardo · Leonardo está livre · 21 d". O painel listava todo `handoff`
sem `peer_ask`, de qualquer idade; o varredor de pedidos parados (ADR-084) só lia as últimas 24 h e só a cadeia que
acabou interrompida. Em produção, 40 pedidos ficaram abertos para sempre com o colega já terminado: concluído sem
entrega, máquina caída, executor indisponível, Parar. Ninguém fechava, e quem pediu esperava para sempre.

## Decisão

1. **Uma definição de "pedido aberto"** (`pedidoAbertoSql`): o handoff com tarefa, sem `peer_ask` da mesma tarefa na
   MESMA conversa e sem a task de colega de antes já acabada. O painel, a espera circular e o varredor usam esta. O
   painel e o varredor também filtram pela pessoa e por quem pediu ainda existir.
2. **Sem janela de idade.** O varredor de expiração, depois do bloco da ADR-084, passa por TODO pedido aberto da pessoa
   (uma vez a cada 5 min por pessoa) e aplica a regra pura `decidirEsperaDeColega` (src/domain/espera-de-colega.ts):
   - teto de 7 d desde o pedido ou a cobrança: fecha em silêncio, sem acordar quem pediu ("pedido antigo sem resposta");
     se o colega concluiu com fala e ninguém entregou, o fecho registra essa fala como resultado;
   - colega excluído ou Parar da pessoa: avisa;
   - a cadeia roda, espera uma volta marcada, tem um lote de frentes aberto ou uma decisão da pessoa em aberto: espera;
   - na fila sem ninguém pegar: espera o prazo P (24 h) e fecha com "sem resposta em 24 h";
   - nunca rodou, colega livre, passadas as 24 h da queda (que são da ADR-084): UMA reentrega automática (uma retomada
     marcada com `[nod] Cobrança do pedido <tarefa>`); na segunda, fecha com "o pedido não começou nem depois de
     reentregue";
   - concluiu: entrega a última fala (passados 5 min do fim); sem fala, avisa "terminou sem resposta";
   - caiu: passadas as 24 h da ADR-084, avisa com o motivo legível.
   Os avisos de prazo ("sem resposta", "não começou") são **finais** (`paradoPelaPessoa`): um resultado tardio só fica
   registrado, como no Desistir.
3. **A entrega de uma tarefa é serializada pela raiz** (`pg_advisory_xact_lock(tenant, 'peer_ask:'+tarefa)`): o assentar
   do turno, o varredor e o Desistir não gravam dois `peer_ask`.
4. **Cobrar e Desistir no painel.** Vencida a espera (P desde o pedido ou a cobrança), o painel mostra "sem resposta há
   X". **Cobrar** reentrega uma vez e recomeça P; é recusado (409) com a cadeia ocupada ou no prazo. **Desistir** grava o
   aviso final ("a pessoa desistiu depois de X sem resposta") e acorda quem pediu uma vez (segue com o que tem); é recusado
   no prazo sem cobrança.
5. **Detalhes das revisões 2 a 8 do PR #544.** O varredor trava a raiz e relê o pedido antes de agir (uma entrega do
   assentar que chegou entre a leitura e a ação vence). Cada pedido roda na sua transação (e a leitura da passada noutra,
   curta, sem transação aninhada): com um savepoint por pedido numa transação só, a trava do trabalho de quem pediu ficava
   presa e o assentar de outro pedido do mesmo trabalho fechava um impasse (raiz → trabalho de um lado, trabalho → raiz do
   outro; reproduzido em tests/concurrency/esperas-de-colega-corrida.test.ts). A limpeza faz o mesmo, sob a trava.
   Desistir e os avisos finais cancelam os turnos ainda pendentes da cadeia; um turno que já roda segue e o resultado só
   fica registrado. Só o Desistir fica como "parado pela pessoa"; no aviso do prazo o turno sai como `vencido`, com
   autoria de regra (`regra:esperas_de_colega`). As cobranças contam só as retomadas da cadeia que começam pela marca
   `[nod] Cobrança do pedido <tarefa>`. Se o fecho no turno do pedido não grava (turno de outra origem), o aviso vai direto na conversa do
   handoff, sem acordar ninguém. "Nunca virou turno" é nenhum turno da cadeia com `attempted` ou `despachado_em` (suposição registrada
   no PR). Os índices parciais `mensagens_handoffs_por_tempo` e `mensagens_peer_ask_por_conversa` vêm da migração
   0115 do PR #558 (NOD-362), que entrou primeiro na main; a 0117 deste PR, com os mesmos índices, saiu no merge. O
   `abertos` do #558 usa a mesma `semRespostaSql` de `pedidoAbertoSql` (CA5).
   Revisão 4: o Parar e a exclusão travam a linha do turno antes da raiz; o cancelamento do pendente sob a trava da raiz
   pula a linha travada (`SKIP LOCKED`) — quem a segura já a está interrompendo ou despachando —, sem impasse (teste de
   concorrência com os passos do parar.ts). O colega que pediu a um terceiro e espera a resposta conta como "aguardando"
   (o mesmo `aguardando_colega` da entrega): sem "sem resposta" nem Cobrar; no teto fecha pelo aviso.
   Revisão 5: as travas de um pedido seguem a ordem do assentar do colega — os trabalhos da cadeia (FOR UPDATE, por id)
   e depois a raiz — no varredor, no Cobrar, no Desistir e na limpeza; o fecho do teto também tira da fila os pendentes
   da cadeia (`vencido`, por regra).
   Revisão 6: a cadeia de retomadas é lida até 500 turnos (`PROFUNDIDADE_DA_CADEIA`, a mesma janela da entrega), não
   10 — uma cadeia longa tinha o "último" errado; a limpeza conta os 7 d do pedido (não da cobrança), como o CA7 pede.
   Revisão 8: na fila, o "sem resposta" conta também de quando o turno ficou pronto (`filaDesde`): uma retomada que
   acabou de entrar (a decisão aprovada, a volta da cota) num pedido velho espera mais P, no varredor e no painel.
6. **Limpeza única** (`npm run esperas:limpar -- --dry-run`): fecha em silêncio os pedidos com mais de 7 d, uma transação
   por pedido, idempotente.

## Alternativas

- Estender a janela da ADR-084 para 7 d: não pegava o concluído sem entrega nem o pedido que nunca virou turno.
- Coluna de estado no handoff: migração de dados e duas fontes de verdade; a leitura por `peer_ask` já existia.

## Gatilho de reversão

Se em produção o varredor fechar pedidos que ainda terminariam (relato de "resposta que chegou depois do aviso" mais de
uma vez por semana), ou a passada das esperas passar de 1 s por pessoa (o log `esperas_de_colega_lenta` do varredor, com
`duracao_ms`, aparecer mais de uma vez por dia), voltar o bloco para a
janela da ADR-084 e rever P e o teto.
