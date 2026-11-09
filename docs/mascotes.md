# Mascotes temporários

Motor Bloub original em `web/vendor/bloub`, isolado dos contratos e do backend.
Origem/licença: [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md).
O perfil persiste apenas forma e cor. Expressões e reprodução do catálogo são prévias locais.

## Mapa estado → situação

A coluna "Chat" é da fala viva (Parte 3 do plano "o pensamento no chat", ADR-129, 2026-10-26; `renderFalaViva` em
web/telas/conversa.ts): a base contínua troca com a permanência de 600 ms do cabeçalho, e o disparo único toca por cima
e volta à base quando acaba (o relógio da virada, `proximaViradaDoMascote`, redesenha na hora).

| Bloub | Situação no nod (barra, frota, cabeçalho) | Chat (fala viva) | Integração |
| --- | --- | --- | --- |
| idle | Sem turno vivo e sem decisão não vencida | Disponível, na fila; `+ attentif` escrevendo (narração ou fala em streaming) | Ativa; imóvel, olhar superior direito |
| thinking | Turno na fila recente | O turno começou e nada chegou; entre ferramentas | Ativa |
| orbit | Turno rodando | Ferramenta em uso, frentes trabalhando | Ativa |
| notify | Decisão não vencida, sem turno vivo | Esperando a aprovação ou a resposta da pessoa no turno | Ativa |
| wink | Confirmação breve de ação | Disparo único (1,7 s) quando a fala entra | Ativa no chat |
| wide | Descoberta relevante | — | Reservada |
| alert | Falha recuperável que requer atenção | Silêncio do vigia ("sem novidade há N min"); decisão pendente: `idle + somnolent` como alternativa (`MASCOTE_NO_SILENCIO`) | Ativa no chat |
| exclaim | Bloqueio crítico ou prazo próximo | — (candidato: máquina caiu, limite do plano, falha; fora do chat) | Reservada |
| sleep | Agente explicitamente suspenso | — | Reservada |
| egg | Criação/preparação inicial | — (candidato: a linha "criada por você" e o bot novo na frota) | Reservada |
| hexagon | Preparação de integração | — (candidato: o cartão de acesso ao conector) | Reservada |
| play | Início/retomada confirmada | — (candidato: depois de Aprovar ou Retomar; precisa do fato no frame) | Reservada |
| burst | Conclusão bem-sucedida | — (candidato: task entregue, uma vez por entrega) | Reservada; futuro disparo único por entrega |
| comet | Transferência entre agentes | Disparo único (2,5 s) quando as frentes saem; depois, orbit | Ativa no chat |
| swirl | Transição visual entre contextos | — | Reservada; não é estado de negócio |

Prioridade atual: execução > fila > decisão > repouso. Escopo por conversa.
Usado na barra lateral, cabeçalho da conversa e Frota. Mensagens históricas não simulam trabalho atual.
Não confundimos ausência de tarefa com suspensão, nem encerramento de turno com sucesso.
Para ativar um reservado, conectar um fato tipado do produto, definir prioridade e duração,
e testar expiração/deduplicação (principalmente celebrações e confirmações).

## Expressões

As 16 originais estão disponíveis na prévia: neutre (neutra), attentif (atenta),
surpris (surpresa), excite (empolgada), heureux (feliz), hilare (risonha),
colere (irritada), triste, effraye (assustada), mefiant (desconfiada),
confus (confusa), curieux (curiosa), fier (orgulhosa), timide (tímida),
blase (entediada), somnolent (sonolenta).

Fora da prévia, apenas a neutra é usada como expressão-base (e a atenta na fala viva enquanto o bot escreve); as outras
ficam reservadas a futuras escolhas explícitas de personalidade/interação, sem inferir emoções do texto.
Estados com rosto ou silhueta próprios preservam a animação original e podem ignorar a expressão/forma.

## Reprodução e adaptação visual

Perfil → Mascote → Catálogo Bloub: todas as 15 animações, seletor de expressão,
pausa e repetição das transições. A troca de forma/cor atualiza também o catálogo.
O motor suporta transições interrompidas, partículas, máscara dos olhos e órbitas em camadas.
O módulo original de ciclos também está preservado; seu editor de montagens não faz parte da interface nod.

Movimento reduzido mostra poses representativas. Fora da tela/aba oculta a animação é suspensa;
ao remover o componente, listeners, observer e requestAnimationFrame são liberados.
Repouso não pisca, não flutua nem acompanha o cursor.

Definido em 2026-09-18: a pose neutra em `web/lib/mascote-pose.ts` usa yaw 23°, pitch 15°,
roll −13° e separação 18° para aproximar a referência estática enviada.
A interface compensa em 1,4× a margem original de animação do SVG; na Frota a caixa é 68 px.
O catálogo mantém a margem completa para inspecionar partículas e órbitas.

## Validação

`npx vitest run --project unit tests/unit/web/mascote.test.ts tests/unit/web/mascote-bloub.test.ts`
cobre catálogo completo, formas, expressões, repouso, geometria e transições interrompidas.
