# ADR-154 — A aprovação presa à fala da pessoa

Status: aceita (2026-11-07, ADA-15) · Emenda a [ADR-047](adr-047-tarefa-delegada-carrega-o-pedido-da-pessoa.md)
(proveniência) e a [ADR-142](adr-142-passagem-por-coluna.md) (a passagem por fala da pessoa). Mantém a
[ADR-062](adr-062-aprovacoes-que-cumprem-o-que-prometem.md) (turno contaminado) para todo o resto.

## Contexto

Marlon escreveu "ADA-2 v2 aprovado" no chat com o Gil. O Gil leu o quadro (`gerir_quadro acoes: []`) e as três escritas
seguintes foram recusadas: o `responder` exige turno limpo, e ler um quadro real (quase sempre com alguma tarefa
importada do Linear, `deFora`) contamina o turno inteiro. A fala da pessoa, que estava ali, deixava de valer.

## Decisão

1. **A autorização fica presa à mensagem, não ao turno limpo.** Os passos `responder`, `mudar_tarefa` e `terminei` do
   `gerir_quadro` aceitam `pela_fala: true` (e `mensagem_id` opcional, para desambiguar). O servidor só os trata como da
   pessoa se achar a fala e ela passar nas seis condições:
   1. linha de `mensagens` com `autor_tipo = 'pessoa'`, `autor_id` = a pessoa do escopo, `sob_procuracao_de IS NULL`,
      `confianca = 'confiavel'`, `kind = 'texto'`, na conversa do turno;
   2. é a fala que abriu o turno (`turnos.mensagem_origem_id`) ou uma que entrou nele enquanto rodava (o turno
      absorvido, `absorvido_por = turno`, ADR-067/130);
   3. o turno é dela: conversa ou ligação, profundidade 0, sem procuração (`naConversa`). Rotina, tarefa, pedido de
      colega e retomada nunca têm fala;
   4. é posterior à pergunta do card (o último movimento que pôs a tarefa em Com você/Bloqueado);
   5. cita a tarefa: o código (`ADA-2`, sem caixa, com fronteira; `ADA-21` não casa `ADA-2`) ou o item do Linear. Sem
      citação, ou com duas falas que citam a tarefa e sem `mensagem_id`, recusa: o bot pergunta;
   6. responde uma vez: a tarefa precisa estar esperando e a fala ser posterior à pergunta; sob a trava do quadro, a
      segunda resposta (outro aparelho, retry) cai em "não está esperando resposta". E a fala vale um passo por
      tarefa: a que já está no `mensagem_id` do histórico da tarefa não autoriza outro passo nela, nem no mesmo turno
      nem num turno re-enfileirado com a mesma mensagem de origem (revisão do PR #696; "responder e seguir" é o
      `avancar` no mesmo passo).
2. **O passo com fala vale só para aquela tarefa.** Ele isenta as travas do bot sozinho (limite normal, se tomar,
   passagem a outro agente, `terminei` alheio), mas só muda status/resposta: título, descrição, pergunta, PR, responsável
   e excluir continuam recusados. Os outros passos do mesmo lote seguem o turno (sujo continua sujo).
3. **A resposta gravada é a fala literal.** O texto que o bot manda é ignorado; o card guarda
   `resposta_mensagem_id`, `resposta_conversa_id` e `resposta_agente_id` e mostra "Respondido no chat com <bot> · ver
   mensagem". O histórico da tarefa leva o `mensagem_id` do passo.
4. **`avancar`**: "aprovado" é responder e seguir. Com `avancar: true` a tarefa respondida vai à coluna seguinte à de
   volta da resposta, aplicando a passagem (ADR-142) a quem a coluna nomeia, sem reabrir o turno do responsável atual.
5. **Ler o quadro ou o Linear continua marcando o turno.** O quadro e o Linear trazem texto de outros (comentários,
   descrições importadas, falas de bots); desmarcar a leitura reabriria esse vetor em todos os pontos que dependem de
   turno limpo. A fala presa à mensagem atende "ler não anula a fala" sem afrouxar o resto.
6. **Qualquer bot da mesma dona**, em qualquer quadro dela. Bot de outro dono e o quadro de outra pessoa (a porta,
   NOD-443) não aceitam `pela_fala`.

## O que não vale (e por quê)

Página, e-mail ou arquivo dizendo "Marlon aprovou" (não é linha de `mensagens` da pessoa); comentário de card
(`quadro_comentarios`); outro bot repassando (turno de colega, profundidade > 0); `mensagem_id` de outra conversa ou de
outro turno; fala anterior à pergunta; rotina reaproveitando fala velha.

## Consequências

- O bot não vê ids de mensagem: `pela_fala: true` basta e o servidor procura entre as falas do turno a que cita a tarefa.
- O servidor não interpreta "aprovado"/"não aprovo": grava o literal; o Desfazer do lote cobre a leitura errada do bot.

## Gatilho de reversão

Um caso de aprovação aplicada sem a pessoa ter falado, ou bots usando `pela_fala` fora de aprovação/resposta.
