# ADR-140 — As colunas do quadro são da pessoa; o grupo dá o comportamento

Status: aceita (2026-11-01, NOD-448) · Estende a NOD-429 (tiras recolhidas) e a [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade tela × conversa).

## Contexto

O quadro tinha 8 colunas fixas e o motor decidia pelo status (Fazendo aciona o responsável, Feito conta no progresso,
Cancelado sai da conta). A NOD-448 pede que a pessoa crie, renomeie, reordene e remova colunas pela tela e pela
conversa, sem perder tarefa e sem mudar quem é acionado.

## Decisão

1. **As colunas ficam no próprio quadro** (`quadros.colunas` jsonb, lista ordenada `{id, nome, grupo}`, 0134); `null` =
   as 8 padrão, então todo quadro de antes fica igual. O status da tarefa é o id da coluna: uma das 8 chaves reservadas
   ou `c-<slug>`. O CHECK fixo vira um CHECK de forma; a coluna existir é regra do domínio, conferida com o quadro
   travado.
2. **O grupo é o comportamento**, em ordem fixa: Não iniciado → Andamento → Feito → Fechado. A coluna da pessoa faz o
   papel do grupo (`papelDe`): iniciado com responsável aciona como Fazendo; não iniciado espera como o Backlog; feito
   conta; fechado sai da conta. A regra de acionar (`deveComecar`) é uma só para Fazendo e as colunas de andamento da
   pessoa: ENTRAR vindo de fora do andamento aciona (Backlog → Fazendo, Pedido → Compras), andar dentro dele não
   (Compras → Produção), e nunca com turno vivo. Mudança consciente: Feito ou Backlog → Fazendo com o MESMO responsável
   passa a acionar (antes só a troca de responsável acionava em Fazendo); a regra é "entrar no andamento aciona". Passar
   a tarefa a outro responsável no andamento aciona o novo sempre: o lote para o turno do antigo. O Desfazer só devolve
   à espera a tarefa cujo turno o próprio lote trocou ou parou (Cancelado, Backlog, remover para o não iniciado), e num quadro sem A fazer o apelido afazer leva ao andamento e recomeça quem já está lá (a tarefa já parada no andamento que o lote só editou volta igual); a que ele só mudou de coluna volta exatamente como estava. As padrão guardam o que já faziam: A fazer aciona (NOD-417) mesmo sendo
   Não iniciado; Revisão, Bloqueado e Precisa de você não acionam. O menu da coluna diz a frase da coluna, não só a do
   grupo (`fraseDaColuna`). Progresso = Feito ÷ (total − Fechado). O grupo não muda depois de criada (mudar o grupo
   = criar outra e mover as tarefas).
3. **Invariantes** (`validarColunas`, iguais na tela e na conversa): 1 a 30 colunas, nomes de até 40 caracteres únicos
   sem acento nem caixa, ≥1 coluna em Feito, ≥1 onde o trabalho anda (Fazendo ou uma de andamento da pessoa), Precisa de você (`voce`) renomeável mas não removível e sempre a última do
   andamento, Cancelado renomeável mas não removível e a última do fechado, o grupo das padrão não muda.
4. **Tudo passa pelo lote travado das tarefas** (`aplicarLoteQuadro`, ops `criar_coluna`, `renomear_coluna`,
   `mover_coluna`, `remover_coluna`, `substituir_colunas`): a foto do Desfazer guarda as colunas, e desfazer volta as
   colunas e as tarefas juntas. Remover com tarefas exige destino; nenhuma tarefa fica numa coluna que não existe.
   **Mudar a tarefa de coluna por remover ou substituir não aciona ninguém** (decisão 4 do Gil): a tarefa entra no
   `semAcionar` do lote (`src/domain/quadro.ts`).
5. **Pela conversa**, e só num turno em que a pessoa falou com o bot (não numa tarefa, rotina ou pedido de colega),
   criar, renomear, mover e remover saem na hora com recibo e Desfazer; só substituir o conjunto
   inteiro vira card (proposta + decisão `colunas_quadro`, 0135) com antes, depois e para onde vão as tarefas.
   Confirmar confere a impressão das colunas de quando o card nasceu; se mudou, fecha como recusada e avisa (409).
6. **Na tela**, a web espelha as regras em `web/lib/colunas.ts` (ADR-018: só tipos de `src`; um teste confere os
   limites) só para não oferecer o que o servidor recusaria e dizer o porquê na hora. As tiras recolhidas de Feito e
   Fechado no fim e o "+" ficam presas à direita (NOD-429); no celular a ordem muda numa folha com alças.

## Consequências

- Os apelidos que o bot já usa ("status feito", "fazendo") continuam valendo por `porApelido`, mesmo com colunas trocadas.
- O ROLLBACK da 0134 devolve as tarefas à coluna padrão do grupo e marca como desfeitos só os lotes com foto de colunas
  da pessoa; volte o servidor antes de rodar.
- A ordem padrão muda numa coisa: Precisa de você passa para o fim do andamento (decisão 2 do Gil), em todo quadro.

## Gatilho de reversão

Se a pessoa precisar de comportamento por coluna além do grupo (ex.: acionar em uma coluna do andamento e não em
outra), o grupo deixa de bastar e a coluna ganha regras próprias.
