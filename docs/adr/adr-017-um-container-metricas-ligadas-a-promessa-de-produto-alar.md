# ADR-017 — Um container, métricas ligadas a promessa de produto, alarme externo

**Status** revisado

## Decisão

O container único sobrevive, com menos gente dentro: web, fila, trilha e o executor de SERVIDOR. O endpoint de long-poll mora NELE. As sete métricas caem para QUATRO: (1) idade da pendência mais velha não decidida; (2) taxa de expiração por falta de decisão, COM OS DOIS RÓTULOS (expirou_sem_ninguém_ver / expirou_com_alguém_ciente); (4) turnos retomados versus perdidos após restart, agora com rótulo separando restart do servidor de máquina sumida; (5) custo do executor de servidor no mês. Entra uma quinta: quantas máquinas estão com poll aberto agora, por pessoa. Saem: duração de checkout do pool, distância até a partição futura, taxa de resumed:false. O alarme externo PERMANECE. Rótulo como union fechado em TypeScript permanece, com o campo de tenant JÁ DECLARADO no tipo.

## O que mudou

De sete para cinco métricas. A (2) é DEVOLVIDA com os dois rótulos depois de uma frente a ter cortado.

## Por quê

Uma frente cortou a métrica (2) dizendo que ela foi justificada por cardinalidade segura com 70 clientes. Fui ao texto do ADR-017 e não foi: a justificativa é 'uma pendência que expira porque ninguém olhou não move CPU — o container fica saudável enquanto o produto falha em silêncio'. Os dois rótulos separam problemas OPOSTOS: ninguém viu (falha de notificação) versus viram e não decidiram (falha de carga). E a substituição proposta — 'entre colegas que se veem todo dia alguém pergunta' — é exatamente a disciplina humana que o ADR-003 rejeitou como mecanismo. Custo de manter: dois valores num union fechado. Histórico não se inventa depois.


## Refinamento (2026-09-16)

Entra a sexta métrica, `outbox_abandonados` (por tenant), do ADR-010 refinado: item do outbox abandonado pelas DUAS condições é contado, não apagado — no projeto de referência isso era um `console.error` que ninguém lia. O rótulo continua union fechado em `src/obs/metricas.ts` (L8), sem id/email de titular.

## Refinamento (2026-10-13, NOD-219)

Entra a sétima métrica, `turno_velho_na_fila` (contador, por tenant e pessoa, rótulo `bloqueio`: `depois_de` | `faixa_ocupada` | `condicao_da_maquina`). A promessa é a mesma da (1): o pedido que a pessoa fez não pode ficar "na fila" em silêncio. Ela conta a partir do prazo da fila do turno (`prazo_em`, em geral 24 h depois do pedido), não antes: o "na fila · há 6h" do diagnóstico continua sem alarme, e se as primeiras semanas mostrarem que 24 h é tarde demais, o limiar próprio é decisão a tomar com o dado dela. O varredor de turnos órfãos encerra só o pendente impossível de rodar (agente excluído, geração antiga); o pendente que passou do prazo da fila mas pode sair a qualquer momento (preso por outro trabalho, pela faixa ou pela condição da máquina — cota, Mac fora, memória, disco) não é encerrado, é contado, no máximo uma vez por hora por turno. É a medida que falta para decidir se esse caso merece regra própria; sem ela, a decisão seria no escuro, como foi o diagnóstico da NOD-219. Union continua fechado, sem id de turno no rótulo (o id vai só no log `turno_velho_na_fila`). O gatilho abaixo vale para ela: dois meses sem decisão operacional, sai.

## Refinamento (2026-10-15, NOD-267): saúde que enxerga o processo travado, e quem reinicia

Em 15/10 o pool de conexões esgotou: o processo seguia vivo, o `/api/saude` ora dava 200, os laços de fundo ficaram
presos num tick pendurado (a trava `rodando` faz os seguintes serem pulados em silêncio) e nada reiniciou — o Docker
com `unless-stopped` só reinicia processo MORTO, não container `unhealthy`. A promessa do alarme externo não muda; muda
o que a saúde enxerga e quem age:

1. **Batimento dos laços.** O agendador e o varredor de lease gravam o batimento ao TERMINAR cada tick (sucesso ou
   erro; a espera da ADR-045 também conta). No modo compartilhado, `/api/saude` dá 503 `{ok:false}` se algum laço está
   há mais de 3 intervalos sem bater (com piso de 60 s, para um tick lento legítimo do varredor de 15 s não reiniciar o
   processo), antes de tocar no banco; depois vem o `select 1` com prazo de 2 s — um `select 1` que estourou o prazo
   não enfileira outro enquanto não volta. O boot também bate, do `listen` até os laços subirem. O motivo
   (`erro`, `prazo`, `laco_parado:<laço>`) vai só para o log `saude_falhou`. No modo local não entra (o Mac dorme).
2. **Watchdog no processo** (só no compartilhado). A cada 15 s roda a MESMA verificação da rota (com o `select 1` em voo
   compartilhado); 4 falhas seguidas → log `watchdog_reiniciando` e `process.exit(1)`, e o `unless-stopped` sobe o
   processo de novo. Liga logo depois do `listen` (um boot pendurado no banco também reinicia). Carência de `LEASE_MS`
   (90 s) desde o início do processo; para no começo da drenagem (ADR-071) e no `fechar()`. Banco fora do ar também
   conta: o reinício não conserta o banco, mas o processo novo tem pool limpo e o Docker espaça as tentativas.
   *Emenda (2026-10-28, NOD-385):* o agendador bate também dentro do tick, depois de cada rotina processada (qualquer
   desfecho) e de cada pessoa. O batimento passa a medir progresso: um tick longo que anda não vira `laco_parado` (em
   23/10 virou, tirou a única cor do Caddy e o watchdog reiniciou o processo); uma única rotina presa além de 3
   intervalos continua virando. O varredor de lease segue batendo só ao fim do tick.
3. **Tick lento** vira log `laco_tick_lento {laco, duracao_ms, intervalo_ms}`, para ver o travamento chegando antes do 503.
4. **Monitor externo** em `https://<domínio>/api/saude` a cada 1 min, alerta por e-mail depois de 2 falhas
   ([runbook-producao.md](../runbook-producao.md), seção 7). O cadastro é manual, do dono da conta, e ficou fora da NOD-267.

Gatilho de reversão desta parte: se o watchdog reiniciar o processo sem incidente real (falso positivo) mais de uma vez
num mês, sobe o limite de 4 falhas ou o de 3 intervalos — não se desliga o watchdog.

## Emenda (2026-10-22, NOD-218): dois processos vivos só durante o deploy

O "container único" vira "um processo ativo". Durante o deploy azul/verde (ADR-001, emenda de 2026-10-22) há dois containers do nod na VM, por até ~11 min: a cor nova, ativa, e a velha, drenando. Quem é ativo decide só o marcador `cor-ativa`, nunca a ordem de subida. O estado em memória continua de um processo: a cor passiva não liga laços, e a velha, ao drenar, fecha os SSE e passa a autorizar o token de turno pelo banco (revogado = o turno já não está `despachando`). A ponte das máquinas continua em memória: o Mac reconecta na nova pelo 409 de sempre. O que é por processo e mora no disco compartilhado (`/data`) leva a cor: o arquivo de grupos órfãos do executor tem `NOD_COR` no hash, e as ligações gravam `instancia` (a cor), para o boot de uma cor não encerrar o que é da outra. O alarme externo segue no `/api/saude` via Caddy, que só chega à cor ativa; o watchdog não age durante a drenagem.

## Gatilho de reversão

Reabrir (segundo container ou métricas de infraestrutura) se o executor de servidor passar a competir por CPU com o long-poll a ponto de o `puxar` estourar o teto de 20 s medido, ou se alguma das sete métricas ficar dois meses sem gerar decisão operacional — aí ela sai, não entra outra.
