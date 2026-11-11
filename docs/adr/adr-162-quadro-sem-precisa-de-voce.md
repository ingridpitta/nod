# ADR-162: Quadro sem "Precisa de você" (fluxo Multica)

Status: aceita (2026-11-10, pedido do Marlon: o fluxo do quadro igual ao dos workflows de projeto do Multica). Revê a
coluna fixa "Precisa de você" da NOD-448 (ADR-140) e o texto das 4 saídas da ADR-155.

## Contexto

O quadro tinha uma coluna fixa, "Precisa de você" (status `voce`), sempre a última do andamento. Perguntar à pessoa
tirava a tarefa da coluna onde ela andava, e responder a trazia de volta. No Multica não há essa coluna: a pergunta do
agente é um comentário na tarefa mencionando a pessoa, o card fica onde está, e a resposta dela (outro comentário)
aciona o agente de novo. Pergunta e comentário nunca mudam o status; mover de coluna é o handoff.

## Decisão

1. **"Precisa de você" deixa de ser coluna.** Sai das colunas padrão (7 agora), das fixas (só Cancelado) e da tela
   (computador, celular, quadro compartilhado, folhas, sugestões). `validarColunas` não exige mais e recusa o id `voce`;
   a coluna gravada num quadro de antes sai na leitura (`colunasDe`).
2. **O status `voce` vira a marca "esperando a pessoa".** Não é coluna: a tarefa aparece na coluna de onde veio
   (`voltarPara`, `colunaNaTela`; sem ela, a de andamento) e o DTO entrega `status` = essa coluna e `esperaPessoa: true`.
   Com a marca, o quadro não chama o bot de novo (`andando` é falso), não conta turno sem saída e avisa a pessoa
   (`esperaPessoa` dos avisos, como Bloqueado e a trava "só a pessoa"). Os freios, o laço e o histórico, que já tratavam
   `voce` como espera, seguem iguais. O responsável continua o mesmo (sem o "Você" no lugar do bot).
3. **Perguntar = comentário.** A saída "Precisa de você" vira "perguntar": `mudar_tarefa` com `pergunta` e sem status
   (o status `voce` antigo segue aceito no parse e faz o mesmo). O caso de uso grava a pergunta como comentário do bot com
   a @menção de quem decide (`comentarPergunta`). O comentário da pessoa numa tarefa que espera por ela é a resposta: a
   marca sai e o responsável volta a andar (o `responder` de sempre, chamado por `comentarTarefa`).
4. **Os fallbacks deixam o card na coluna**, com a marca e um comentário do **sistema** (autor novo `sistema` em
   `quadro_comentarios`, migração 0159, que não aciona ninguém): a 2ª parada sem saída, o freio do reacionamento, o
   reacionamento sem onde retomar, o agente da etapa que sumiu, o "não é comigo" sem candidato (esse já deixa o
   comentário da recusa) e o freio num quadro sem Bloqueado. O travamento de fato continua em **Bloqueado com o motivo**
   (sem onde rodar, a falha que não se repete, o 4º passe, o laço). A decisão ligada à tarefa (ADR-159) e a etiqueta
   precisa-humano do Linear também usam a marca, na coluna da tarefa.
5. **Dados de antes, sem migração que mova linhas.** A tarefa gravada com `voce` já é lida na coluna de `voltarPara`
   com a marca; o parse segue aceitando `voce`.
6. **A única concessão além do Multica**: o card mostra o **chip 🔔** de "esperando você" (decisão posterior do Marlon,
   2026-11-10, no lugar do "te perguntou" pequeno e cinza da primeira versão), com prioridade sobre os outros estados da
   linha do card (`web/telas/quadro.ts`). O Responder no card fica só em Bloqueado; a pergunta do bot se responde na
   tarefa (comentário ou o campo da pergunta).
7. **A resposta deixa o card onde está (emenda de 2026-11-10, P2 da comparação Multica).** A tarefa respondida volta à
   coluna de onde a pergunta saiu (`voltaDaResposta`), também em Não iniciado: em **A fazer** o bot é chamado (a coluna
   aciona), no **Backlog** a resposta fica guardada no card e ninguém roda. Antes a pergunta feita no Backlog ou em A
   fazer levava a tarefa a Fazendo e acionava o bot.

## Consequências

- O filtro "Comigo" passa a contar a marca, Bloqueado e a coluna "só a pessoa" (`ehComigo(t, colunas)`).
- O status `voce` no banco não é mais o id de uma coluna: quem lê `quadro_tarefas.status` direto precisa de
  `colunaNaTela`. O histórico chama o movimento para `voce` de "Esperando você".
- Arrastar o card que espera a pessoa para outra coluna tira a marca (é a pessoa decidindo); a pergunta fica no
  comentário.

## Alternativas

- **Coluna de verdade + uma coluna booleana nova** (`espera_pessoa`): o modelo mais limpo, mas reescreveria os freios,
  o laço, as consultas de espera (`entradasNaEspera`, `perguntaEm`) e o varredor, todos escritos sobre `voce`.
- **Manter a coluna e só esconder na tela**: o bot seguiria movendo a tarefa, e a regra do Multica (pergunta não muda o
  status) não valeria para ele.

## Gatilho de reversão

Migrar a marca para uma coluna própria (`quadro_tarefas.espera_pessoa`) e o status para a coluna de verdade quando
qualquer um acontecer: (a) um bug em produção causado por ler `quadro_tarefas.status = 'voce'` como coluna; (b) uma
segunda espera da pessoa que não caiba em `voce` (ex.: perguntar numa tarefa Bloqueada sem tirar de Bloqueado); (c) o
Marlon pedir que a tarefa possa mudar de coluna sem perder a pergunta pendente.
