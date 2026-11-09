# ADR-058 — Um pedido entre bots, com os acessos de quem recebe

Status: aceito, emendada pela [ADR-063](adr-063-pedido-entre-bots-ate-tres-passes.md) e pela
[ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (a trava herdada saiu: no lugar dela, o turno de quem
recebe nasce marcado se quem pediu leu algo de fora) · Data: 2026-09-29 ·
Substitui a divisão `perguntar_a_bot` × `delegar_tarefa` da ADR-047.
Emenda a ADR-026 (a marca de não confiável deixa de reduzir o catálogo de quem recebe um pedido de colega)
e a ADR-035 (rotina também pede a colega com os acessos dele).

## Contexto

Em 2026-09-29, às 17:30, a rotina "a cada 10 min" da Clarice leu no Slack uma DM da Emanuelly sobre o
filtro de nome do Backoffice (PR #415) e pediu ao Chico, por `perguntar_a_bot`, que explicasse como a
busca funciona. O Chico respondeu com hipóteses e "isso precisa chegar como tarefa delegada pelo
Marlon". Medido no Raio-X do turno `8aa4a078`:

- o turno do Chico nasceu `peer`, profundidade 1, entrada `nao_confiavel`, sem procuração;
- o catálogo tinha 78 ferramentas (GitHub 7 e Supabase 61, todas de leitura; ClickUp 7) e ele chamou
  **zero**: o texto do modo peer (`prompt-sistema.ts`, ADR-047) mandava não ler nenhum sistema e dizer
  que o trabalho precisava vir como tarefa delegada;
- a Clarice não podia delegar: `delegar_tarefa` só aceita turno aberto por mensagem da pessoa
  (`pedidoDaPessoa`), e o turno era de rotina.

O sistema tinha dois jeitos de um bot pedir algo a outro, e o que uma rotina alcançava não fazia trabalho
nenhum. Marlon: "a grande novidade desse sistema é os bots conseguirem se comunicar e um resolver
tasks/perguntas do outro. Se um bot tem permissões de acesso às ferramentas, ele deveria poder usar
independente se a msg veio de mim, de outro bot ou da rotina de outro bot."

## Decisão

**Uma ferramenta, `pedir_a_bot { agente, pedido, contexto? }`, no lugar de `perguntar_a_bot` e
`delegar_tarefa`.** Serve para pergunta e para tarefa. Entra nos modos criação, conversa, sala e rotina.

**Quem recebe usa os acessos dele.** O turno do alvo nasce com origem `delegacao` (o nome ficou; é o modo
de quem cumpre um pedido de colega), profundidade 1, `sob_procuracao_de` = a pessoa dona dos dois bots e
entrada **confiável**: catálogo inteiro das concessões dele, mais `lembrar`, `pedir_acesso`,
`pedir_aprovacao` e `pedir_a_pessoa`. Vale venha o pedido de uma conversa, de uma sala ou de uma rotina.
Sai a checagem "o remetente viu conteúdo de fora" (`remetenteViuConteudoDeFora`) e sai a exigência de uma
mensagem da pessoa no turno do remetente.

**Três travas continuam, e nenhuma depende de quem pediu:**
1. **A trava da rotina é herdada.** Se o pedido nasceu de um turno de rotina com `exige_aprovacao` (ou de
   uma retomada ligada a ela), quem recebe também só produz efeito externo por item aprovado
   (`politicaExecucao.efeitoExternoSoPorAprovacao`). Ler e consultar ficam livres. Foi a escolha de
   Marlon: a trava é configuração dele na rotina, e passar o pedido por outro bot não pode desligá-la.
   Sem achar o pedido ou o remetente, a trava liga (fail-closed).
2. **Um salto.** Quem responde não repassa (`pedir_a_bot` e `encaminhar` saem em profundidade 1), e a
   continuação de quem pediu também roda em profundidade 1. Qualquer bot pede a qualquer colega; não há
   cadeia A → B → C nem laço A → B → A.
3. **Merge, aprovar e revisar PR** continuam sempre por card (`NUNCA_PERMANENTE`, ADR-047).

**Alcance: os bots do mesmo dono.** Todo bot pede a todo colega por padrão. Bot de outra pessoa usaria as
permissões DELA; continua exigindo procuração (ADR-025), agora de classe `pedir_a_bot`. As procurações
antigas de classe `perguntar_a_bot` ou `delegar_tarefa` continuam valendo.

**A resposta volta como continuação de quem pediu.** A entrega (`entregarRespostaPeer`) abre no remetente
uma retomada do turno que pediu (`retoma_turno_id` = esse turno), com a mesma confiança dele: a rotina
continua rotina, com a trava dela, e a conversa continua conversa, com o kit dela. Antes a continuação
nascia `peer`, só com `lembrar` e leitura, e a Clarice não conseguiria agir sobre a resposta.

**A entrada do alvo** leva o pedido do colega num bloco `<pedido_do_colega>` e, quando o turno do remetente
foi aberto por uma mensagem da pessoa, essa mensagem literal num bloco `<pedido_da_pessoa>`. Os
marcadores continuam neutralizados dentro dos textos (ADR-047).

## Alternativas descartadas

- **Liberar só a leitura no modo peer** (a primeira proposta desta investigação). Resolvia o PR #415, mas
  mantinha dois caminhos, e uma rotina continuava sem conseguir pedir trabalho de escrita a um colega nem
  mesmo por card.
- **Deixar rotina delegar com a tarefa nascendo não confiável.** Mantinha o catálogo reduzido de quem
  recebe, que é justamente o que impede o colega de usar o que a pessoa concedeu a ele.

## Custo aceito

Um texto de fora (DM no Slack, e-mail, página) lido por um bot pode, pelo pedido dele, levar outro bot a
escrever com as concessões desse outro bot sem card, quando o pedido não veio de rotina com trava. Hoje
todas as rotinas ativas têm a trava (5 de 5, consultado em 2026-09-29), e o que vem de conversa tem a
pessoa olhando a conversa do remetente.

## Validação

- `tests/integration/pedir-a-bot.test.ts`: pedido de conversa, de rotina com trava e de rotina sem trava;
  catálogo inteiro no alvo; a trava herdada; um salto; a continuação como retomada do remetente.
- Os testes de bot-a-bot e de tarefa delegada passam a exercitar `pedir_a_bot`.

## Gatilho de reversão

- Se aparecer um efeito externo feito por um bot a pedido de outro que a pessoa desfaz em até 24 h
  (consultável na trilha: `tool_call` de conector de escrita em turno `delegacao` sem item aprovado,
  seguido de revogação ou de relato), a entrada do alvo volta a ser não confiável quando o turno do
  remetente leu conteúdo de fora, mantendo o caminho único.
- Se o custo de turnos de colega passar de 20% do custo diário (Raio-X, modo dev), o pedido ganha teto
  por bot e por dia.

## Emenda de 2026-09-30: até três passes (ADR-063)

A trava 2, "um salto", virou até três passes seguidos entre bots, sem uma pessoa ou rotina no meio. Com um salto, 36
dos 64 turnos do Chico num dia não tinham `pedir_a_bot`, e a cadeia Clarice → Chico → Devs falhou quatro vezes.
Entre donos diferentes continua um salto só. As travas 1 e 3 continuam. A 1 agora atravessa a cadeia: `travaDoPedido`
sobe pelas delegações de quem pediu. O gatilho de custo de 20% acima foi medido em 19% com um salto só. A ADR-063 o
troca por 35% do custo diário em três dias úteis seguidos, valor confirmado pelo Marlon. Detalhes, textos do prompt e
gatilhos estão na [ADR-063](adr-063-pedido-entre-bots-ate-tres-passes.md).
