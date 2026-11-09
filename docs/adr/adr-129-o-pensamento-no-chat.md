# ADR-129 — O pensamento no chat

Status: proposta no PR #534 (plano em [docs/plano-chat-pensamento.md](../plano-chat-pensamento.md)) · Data: 2026-10-26 ·
Emenda da ADR-114 (chat limpo, emenda da NOD-348: a fala viva) e da ADR-070 (design system; ver "Emenda da ADR-070").

## Contexto

Quatro relatos de quem usa o chat, trazidos pelo Marlon em 26/10: a fala da pessoa demora a aparecer e o bot aparece
"pensando" antes dela; o bot escreve no balão e depois apaga; o indicador de pensamento é pequeno demais; as animações
não estão redondas. Lido na main de 26/10:

- A fala da pessoa não era otimista: POST, depois a releitura da conversa inteira, e só então a fala. O `turno.iniciado`
  chega por SSE junto com o POST e a fala viva nascia antes.
- O balão que se apaga era desenho: a narração curta (≤ 280 caracteres) antes de uma ferramenta é descartada quando chega
  texto depois dela (`falaComposta`, espelho do `comporFala` do servidor). O texto já estava no balão quando sumia.
- O indicador era uma linha de 12 px ao lado do nome, sem balão até chegar texto.
- A troca de estado animava a cada ferramenta, sem permanência; o bloco era recriado quando o morph não dava; a fala viva
  virava a gravada por troca de nó, com um rodapé de margem negativa para esconder o pulo.

Protótipo com quatro painéis (Hoje, A, B, C) e dez cenários, aprovado pelo Marlon na opção C:
https://claude.ai/artifact/6CevDm4XZuTfeP95qX7cjJ (privado).

## Decisão

1. **Enviar é instantâneo.** A mensagem comum da conversa própria nasce na tela no clique (`fala-pendente`), com a chave
   de idempotência que já existia; o campo e os anexos limpam na hora. O POST confirma com `ids.mensagem` e `ids.turno`;
   a releitura que traz a gravada tira a pendente, e a gravada herda a chave do bloco. Falhou: a fala fica, tracejada,
   com "Tentar de novo" (mesma chave) e Descartar; sem faixa de erro no topo, salvo 401. Resposta à pergunta e sala
   seguem como eram (rotas próprias, sem chave).
2. **O pensamento é o indicador principal.** No lugar da linha viva, um `<details class="pensar">` abaixo do nome,
   fechado por padrão, sem fundo: o cabeçalho diz o que o bot faz agora em 14 px com o brilho, e à direita a faixa
   `tempo · N ações · N falharam`. Aberto, um trilho com as notas (a narração curta que uma ferramenta fechou) e os
   grupos de ações (a mesma ferramenta seguida vira ×N, com as falhas contadas), na ordem em que aconteceram; as tarefas
   do bot ficam dentro. Só os últimos `GRUPOS_A_VISTA` (8) grupos à vista; os anteriores atrás de "N anteriores".
3. **Com o detalhe fechado, o cabeçalho mostra o pensamento atual.** A narração curta corre no cabeçalho (a primeira
   linha, sem marcação, cortada com reticências); a ferramenta em uso e "Pensando" trocam com permanência mínima de
   `PERMANENCIA_MS` (600 ms): a troca que chega antes fica pendente no estado (`comCabecalho`, no reducer, por frame) e o
   relógio da tela a escreve quando dá o tempo (`escreverEstados`), sem esperar o próximo frame. Esperando aprovação ou
   resposta da pessoa, ou no silêncio do vigia, o cabeçalho diz isso e o brilho para.
4. **Balão só com texto definitivo, numa direção só.** `falaNoBalao`: os relatórios longos de antes da última ferramenta
   sempre (a gravada os guarda) e o texto corrente só quando passou de `PROMOCAO_CHARS` (= `NARRACAO_MAX_CHARS_WEB`, 280,
   a mesma fronteira do servidor) ou quando o turno acabou (`turno.fala`, `turno.encerrado`, quando a regra do servidor
   o grava). Antes disso, o texto corrente é pensamento. O balão nunca mostra um texto que a mensagem gravada vai deixar
   de fora, e nunca perde conteúdo. O servidor (`comporFala`) não muda.
5. **Nada some.** No fim, o cabeçalho vira "Pensou por N s · N ações · N falharam" e o `<details>` continua abrindo; a
   fala gravada desenha o mesmo bloco a partir do payload `acoes_do_turno`, que ganha `duracaoMs` (opcional; servidor de
   antes = linha sem o tempo). Sem ação nem nota, o pensamento não fica (a gravada sem resumo também não o tem).
6. **Um nó por fala.** O pensamento é a parte `data-no-lugar` do morph (`regiaoPorBlocos`): muda por dentro, e o `open`
   do `<details>` é da pessoa — `trocarConteudo` nunca o tira nem o põe; a regravação da região o reabre pelo
   `data-disclosure` (`pensar-<turnoId>`, o mesmo na viva, na parada e na gravada).
7. **O leitor de tela não ouve a narração inteira.** O anunciador lê um `.sr-only.fala-viva-anuncio` ("Pensando",
   "Escrevendo", "Usando Linear"), não o texto visível do cabeçalho.

## Decisões fechadas com o Marlon em 26/10

- Limiar da promoção: 280, numa constante só. A resposta curta entra inteira no fim do turno.
- A fala gravada mostra o tempo: `duracaoMs` no payload, do despacho (ou da criação, no turno de antes da 0083) até o fim.
- Fala no meio do turno: o banco segue gravando uma mensagem por `turno.fala`; a tela agrupa pelo turno (Parte 5).
- Mascote no silêncio: `alert` × repouso + sonolenta, decidido nas capturas da Parte 3.

## Fora

A narração curta como fala gravada (como ChatGPT e Claude): mexeria no servidor e vai contra o Modo WhatsApp (ADR-112).
O cartão de pergunta e de aprovação nascendo do frame, as animações e a cor do bot no brilho são as Partes 4, 5 e 3 do
mesmo PR e têm as emendas delas.

## Riscos aceitos

- A resposta curta sem streaming no balão: aparece inteira no fim do turno. O limiar é uma constante; medir com o uso.
- O pensamento fechado esconde a falha de uma ferramenta: por isso ela conta na faixa do cabeçalho ("1 falhou") e na
  linha "Pensou por".
- O `nota` de cada ação aproxima o índice das narrações descartadas pelo teto (`curtasDescartadas` conta só as curtas):
  num turno com mais de 200 narrações a ordem nota/ação pode desviar; os grupos e a contagem não.

## Gatilho de reversão

Se em 30 dias os relatos de "balão que some" continuarem (a promoção não os resolveu) E a taxa de abertura do pensamento
ficar perto de zero, volta-se a discutir a narração como fala gravada. Se a permanência de 600 ms deixar a tela "atrás"
do que o bot faz nos turnos de ferramentas muito curtas (rajadas abaixo de 100 ms), baixar `PERMANENCIA_MS` antes de
tirar a regra.
