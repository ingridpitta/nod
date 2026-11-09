# ADR-159: A tarefa é a casa do trabalho

Status: proposta (2026-11-08, ADA-28). Emenda a ADR-114 (destino do que nasce no chat), a ADR-099 (frente) e a
ADR-142 (passagem e fechamento). Plano: [docs/planos/ADA-28-chat-quadro.md](../planos/ADA-28-chat-quadro.md).

## Contexto

Com o quadro, o mesmo trabalho aparecia em dois lugares. A pergunta do bot virava um cartão na Sua vez e, ao mesmo
tempo, um card em "Precisa de você", e responder num não resolvia o outro. A frente aberta numa tarefa vivia solta no
chat. O comentário de bot parecia aprovação. Não havia jeito de dizer "quem dá o Done sou eu".

## Decisão

1. **Tudo o que nasce num turno de tarefa leva o `tarefa_id`** (migração 0157): a decisão (`decisoes.tarefa_id`) e a
   frente (`trabalhos.tarefa_id`). O chat só aponta, numa linha discreta (`tarefa_linha`).
2. **A espera da pessoa é sempre uma decisão.** O "Precisa de você" do card é a mesma decisão da Sua vez: responder
   num lugar resolve os dois, e o bot acorda uma vez só (a retomada da decisão, sem o turno da resposta).
3. **O comentário diz, antes de enviar, se aciona alguém.** A prévia da tela espelha a regra do servidor (`andando`,
   `mencionados`, `quemAcionar`) e um teste confere o espelho. Comentário de bot nunca vale como aprovação nem tira a
   tarefa de "Precisa de você".
4. **`quem_fecha` bot|pessoa no quadro** (ausente = bot, o comportamento de antes). Com pessoa, o bot não move a tarefa
   para um status do grupo feito. O `terminei` da última etapa e o merge do PR abrem a decisão "CÓDIGO está pronta para
   o Done" (`tarefa_pede_done`), com as opções "Dar Done" e "Voltar para <etapa anterior>". Só a dona muda isso.
5. **Atrás da flag `NOD_TAREFA_CASA` (desligada)** ficam os itens 1 e 2, que dependem de decisão de produto (ADA-23,
   ADA-24 e ADA-25 com protótipo em aprovação). Os itens 3 e 4 não mudam nada no padrão e não passam pela flag.

## Consequências

- A web não importa o domínio (ADR-018). Por isso a regra da prévia tem duas cópias, provadas iguais por teste
  (tests/unit/web/previa-comentario.test.ts).
- `quadro.editar` (a rota PATCH e o `gerir_quadro`) aceita `quem_fecha`. O Desfazer do lote restaura o valor anterior.

## Gatilho de reversão

Se, em 2 semanas com a flag ligada, a pessoa perder perguntas ou aprovações porque elas foram só para a tarefa (taxa de
decisões vencidas com `tarefa_id` acima da taxa sem), o item 2 volta a criar o aviso no chat.
