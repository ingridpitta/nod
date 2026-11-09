# ADR-061 — A tela aguenta vários bots escrevendo

Status: aceito · Data: 2026-09-30 · Emenda ADR-016 (SSE) e ADR-020 (render por regiões).

## Contexto

O Marlon relatou que, com vários bots executando ao mesmo tempo ou num turno mais pesado, a tela ficava sem resposta, e
o navegador chegava a pedir para aguardar. A investigação reproduziu o problema sem gastar assinatura, com
`scripts/carga-tela` (Chrome headless, build de produção, banco efêmero, catcher emitindo um pedaço de texto a cada
25 ms, como o stream do Claude). O cenário: 12 bots, uma conversa aberta com 200 mensagens em markdown (tabelas,
código, links), e 8 bots escrevendo fora da tela ou um turno de 600 pedaços na conversa aberta.

Com o código da main (63c9c07), medido em 2026-09-30 (i7-9750H, Chrome for Testing 148 headless, máquina quieta):
- **8 bots escrevendo fora da tela:** os turnos acabaram em 6 s e a aba ficou presa numa tarefa só por 118 s. Uma
  tecla no campo levou 118 s para ser tratada.
- **Turno pesado na conversa aberta:** o turno acabou em 16 s e a aba continuava congelada aos 318 s, quando a
  medição desistiu. Com a máquina carregada, numa rodada anterior, não voltou em 40 minutos.

As causas, na ordem do perfil de CPU:
1. **Cada frame SSE redesenhava a tela inteira, na hora.** O claude-cli manda um evento por pedaço de texto (8
   caracteres em média, num frame de 458 B), e cada um era um `render()` síncrono: a barra, o painel e a timeline
   inteira, com o markdown das 200 mensagens refeito. Um bot fora da tela custava o mesmo que o da tela.
2. **`hora()` criava um `Intl.DateTimeFormat` a cada chamada:** 42 s dos 118 s de CPU do perfil. Markdown, links e
   o TSV das tabelas, refeitos a cada frame, somavam mais 49 s.
3. **Regravar a timeline recriava todos os mascotes.** Cada `<nod-mascote>` pintava quatro vezes ao ser criado, com
   `getComputedStyle` em cada uma: 1,1 s para 200. Os animados tinham cada um o próprio `requestAnimationFrame`, com
   `getComputedStyle` e `innerHTML` a cada quadro.
4. **A reidratação redesenhava sem ter buscado nada.** Uma conversa de outro bot fica invalidada até ser aberta, e
   cada frame passava pelo `render()` do fim do `reidratar`. Quem não tinha rotina relia `/rotinas` a cada frame:
   lista vazia contava como "não carregou".
5. **No servidor, o JIT do Postgres compilava consultas curtas.** `pendentesRenderizaveis`, lida em todo GET da
   conversa, estimava custo 504 mil numa conversa com 1.020 turnos e levava 1,36 s; sem JIT, 48 ms. O GET da frota
   fazia 133 consultas com 32 bots, trazendo até 1.000 turnos inteiros por bot só para contar os concluídos.

A investigação teve três frentes em paralelo (render do cliente, mascotes e servidor), cada uma com bancada própria.
Os números acima e abaixo são do `scripts/carga-tela`, salvo quando dito.

## Decisão

1. **O frame muda o estado na hora e a tela no máximo uma vez por quadro** (`receberFrame` e `renderNoQuadro` em
   `web/main.ts`). Só redesenha se o frame mudou algo que a tela mostra (`mudouNaTela` em `web/estado/reducer.ts`):
   o texto de um bot fora da tela não redesenha nada. As ações da pessoa continuam redesenhando na hora, porque quem
   clica espera o DOM novo na linha seguinte.
2. **O texto ao vivo mora em `estado.atividades`, fora de `conversas`.** Cada pedaço de texto trocava a referência da
   conversa e forçava o histórico a ser refeito.
3. **A timeline tem duas regiões por blocos com chave**: o histórico e o que está ao vivo (`regiaoPorBlocos` em
   `web/lib/regioes.ts`). Cada mensagem, fio, grupo de avisos, proposta e o bloco de decisões tem chave estável. A
   mensagem nova entra sem regravar as outras: os mascotes, os `<details>` abertos e os campos com texto das que
   ficam não são tocados. No ao vivo, só o bloco do turno que escreveu é regravado. (Emendado pela ADR-114, Emenda da
   NOD-348: a fala viva do turno não é regravada inteira — só as partes que mudaram, com o mascote no lugar.)
4. **Histórico, barra lateral e painel de detalhes são lembrados** (`lembrar` em `web/lib/lembrar.ts`). O desenho
   recebe o estado por um Proxy que anota as chaves do primeiro nível que leu, e a string só é refeita quando uma delas
   ganha referência nova. Ler a mais custa um redesenho a mais; nunca deixa a tela velha.
5. **O que é puro fica em cache:** os formatadores de data (`formatoData`), o HTML do markdown por mensagem
   (`textoFormatado` com `chave`) e o resumo da etapa do cartão, que só lê o começo do texto.
6. **A reidratação só redesenha quando buscou algo.** O frame só reidrata se mudou as invalidações, e
   `estado.carregado` separa "lista vazia" de "ainda não carregou" para rotinas, salas e conectores.
7. **O mascote pinta uma vez ao conectar e anima num relógio só** (`web/lib/mascote-elemento.ts` e
   `mascote-svg.ts`; `web/vendor/bloub` intocado). A cor vem do CSS (`var(--mascote-cor)`), o quadro parado sai de um
   cache e os animados remendam atributos do SVG em vez de regravá-lo, a no máximo 60 quadros por segundo.
8. **O servidor junta os pedaços de texto de um turno por 100 ms** (`JUNTAR_DELTAS_MS`, dentro do barramento).
   Qualquer outro frame da pessoa solta os guardados antes: a ordem continua a da publicação, inclusive o
   `turno.encerrado` que chega pelo outbox. `NOD_JUNTAR_DELTAS_MS=0` volta a um frame por pedaço.
9. **O JIT fica desligado por transação** (`set_config('jit', 'off', true)` em `vincularEscopo`, na mesma consulta do
   tenant e da pessoa). A frota passa a usar consultas em lote, número fixo em qualquer tamanho de frota, e a contagem
   de execuções passa a ser a real. A migração 0042 cria os índices de turnos por conversa e de mensagens por turno, e
   o stdout do executor é dividido em linhas sem reler a linha acumulada.

## Resultado

Medido em 2026-09-30 com `scripts/carga-tela`, as duas variantes em seguida, no mesmo banco restaurado e com a máquina
quieta (tecla = tempo até o Chrome confirmar que a página tratou uma tecla no campo, uma a cada 250 ms):

| Cenário | Antes (main) | Depois |
|---|---|---|
| 8 bots escrevendo fora da tela | aba presa 118 s; tecla 118 s | maior tarefa 153 ms; tecla p50/p95 7/24 ms |
| Turno pesado na conversa aberta | aba congelada aos 318 s | maior tarefa 230 ms; tecla p50/p95 9/35 ms |
| Os dois juntos | não rodou (a aba não voltou) | maior tarefa 126 ms; tecla p50/p95 8/34 ms |
| Parada, 8 s | 30 ms bloqueados | 17 ms bloqueados |

Nos três cenários de carga a tela acompanha os turnos: fica livre 1,5 s depois do fim do último, que é a pausa que a
própria medição faz. Os frames recebidos caíram de 1.320 para 385 no cenário dos 8 bots.

No servidor, medido em 2026-09-30 num banco efêmero com 30 bots, 6,8 mil turnos e 14,5 mil mensagens:
- **GET da conversa com 1.020 turnos:** 1.453 → 89 ms.
- **GET da frota:** 133 → 12 consultas; p50 914 → 109 ms num A/B na mesma rodada.
- **GET dos não lidos:** p50 427 → 125 ms.
- **Reidratação completa depois de uma reconexão** (7 GETs): 170 → 44 consultas, 1.976 → 381 ms.
- **Uma linha de 8 MB no stdout do executor** (captura de tela em base64), em pedaços de 512 B: 88,9 s → 14 ms.

## Alternativas descartadas

- **Um framework com DOM virtual** (React, Preact, lit). Seria reescrever a web, que a ADR-020 fez com strings e
  regiões. O custo estava no que era refeito a cada frame, não na técnica de desenhar.
- **Acrescentar só o pedaço novo ao balão em streaming**, em vez de regravar o bloco do turno. Medido em 2026-09-30:
  ficou pior. O Chrome refaz o layout do parágrafo inteiro de qualquer jeito, e cada layout ficou mais caro com os
  nós pequenos acrescentados (2,2 → 2,9 s de layout no turno pesado; 55 → 44 quadros por segundo).
- **Dependências escritas à mão para cada região**, em vez do Proxy. Uma dependência esquecida deixa a tela velha em
  silêncio; o Proxy anota o que o desenho leu de fato.
- **Virtualizar a timeline** (desenhar só o que está na vista). Com os blocos e o mascote barato, 200 mensagens
  deixaram de pesar, e a API já corta a conversa em 200.
- **Throttle fixo no cliente** (por exemplo, redesenhar a cada 250 ms). Atrasaria a tela até sem carga; o quadro
  com `mudouNaTela` só pula o que não aparece.
- **Desligar o JIT no parâmetro de conexão ou com ALTER DATABASE.** O pooler em modo transação do deploy (ADR-001) não
  repassa parâmetro de conexão, e o ALTER DATABASE só vale para sessão nova e depende de quem é dono do banco.

## Gatilho de reversão

- Se aparecer tela velha (algo mudou no estado e não apareceu) numa região lembrada, o desenho leu estado por fora do
  parâmetro: corrigir o desenho. Se acontecer duas vezes, trocar o `lembrar` daquela região por dependências
  explícitas com teste.
- Se o texto em streaming parecer aos saltos, baixar `JUNTAR_DELTAS_MS`. Com 50 ms, os frames dobram.
- Se o `scripts/carga-tela` mostrar tarefa acima de 250 ms no cenário de 8 bots, ou tecla acima de 200 ms no p95,
  algo voltou a redesenhar por frame. Rodar antes de mexer em `web/main.ts`, `web/lib/regioes.ts` ou no barramento.

## Não implementado

- **Backpressure no SSE.** `sse.ts` ignora o retorno de `res.write`: uma aba parada 15 s com 10 turnos acumula 1,3 MB
  no Node e recebe tudo de uma vez ao voltar. Com os pedaços juntados, a rajada é cinco vezes menor.
- **GET da conversa incremental.** Ele devolve sempre as 200 últimas mensagens (~280 KB) e é relido de 4 a 5 vezes
  por turno na conversa aberta.
- **Não lidos com o texto inteiro.** O GET tem 230 a 350 KB, 81% de texto das falas, e é relido a cada mensagem
  nova de qualquer conversa.
- **Barra lateral linha a linha.** Ela ainda é regravada inteira quando muda, e os anéis do mascote "trabalhando"
  recomeçam a cada regravação.
- **Juntar o REST do fim de turno.** Um fim de turno na conversa aberta faz 7 requisições, em série.
- **Pool de conexões.** Continua com 5; o GET da frota deixou de segurar uma conexão por 1–2 s.
