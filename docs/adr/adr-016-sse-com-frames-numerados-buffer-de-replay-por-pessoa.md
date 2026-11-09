# ADR-016 — SSE com frames numerados, buffer de replay por PESSOA

**Status** revisado

## Decisão

Mantido o SSE inteiro e exclusivamente para o canal servidor→NAVEGADOR. A ponte servidor↔máquina NÃO usa SSE. CORREÇÃO OBRIGATÓRIA: a chave do buffer de replay troca de tenant para PESSOA. Fixar no dia 1 o que é caro depois: o CONTRATO de resume (streamId, numeração, a condição replayBuffer[0].seq <= since+1, e a regra de nunca fazer replay parcial), porque ele vive nos dois lados ao mesmo tempo. Buffer e replay nascem triviais; o jitter no backoff entra desde já porque é uma linha.

## O que mudou

A chave do buffer: de tenant para pessoa. O contrato de resume é fixado; o dimensionamento do buffer espera.

## Por quê

Este é um vazamento REAL no dia 1 do uso interno, não uma questão de SaaS, e duas frentes passaram por ele — uma levantou como 'risco que não estava na pergunta', a outra revisou o ADR-016 e disse 'manter o buffer por tenant exatamente como está', ou seja, manteve o bug. Com um tenant só, buffer por tenant É buffer global, e o frame do seu turno privado entra no replay da colega. O próprio ADR-016 chama o buffer global de 'o buraco mais grave do desenho copiado' e explica: o SSE é o único lugar onde o dado atravessa para fora do servidor, a RLS já ficou para trás, e o buffer retém isso em RAM sem aparecer em nenhum inventário e sem ser apagável por pedido de exclusão.


## Refinamento (2026-09-16, L9 — o frame diz o que mudou, a web reidrata)

- O frame do outbox carrega `kind` (o KindEvento original), `eventoId`, os `dados` escalares do evento e, desde a L9, `conversaId`/`turnoId` do evento (LEFT JOIN em `events` no `outboxRepo.pendentes`). Ele NÃO carrega conteúdo: a web (`web/estado/reducer.ts`) marca o que reidratar por REST e só os `turno.delta` (publicados direto no barramento pelo laço, sem outbox) entram no estado. `resumed:false` reidrata tudo — replay parcial nunca é aplicado.
- Executor do frame de delta: `turno.delta` leva `executor` e `machineId` do plano, que a web mostra como badge ('catcher' | 'rodou em <máquina>').

## Emenda 2026-10-15 (NOD-254 — ping visível e vigia de silêncio)

O servidor manda `event: ping` / `data: {}` a cada `PING_MS` (15 s), sem `id` (não entra no buffer nem no `seq`). O cliente trata 45 s sem nenhum sinal (open, frame ou ping) como queda e reabre com `since` pelo mesmo caminho do erro (`PRAZO_SILENCIO_MS` em `web/lib/live-events.ts`). Na VM o Caddy serve só h1/h2: o SSE não anda em QUIC.

## Gatilho de reversão

Reabrir (trocar SSE por WebSocket, ou buffer em memória por buffer no Postgres) se `resumed:false` passar a ser rotina medida em uso normal (buffer de `BUFFER_SSE_FRAMES` frames insuficiente para uma reconexão típica), ou se a web precisar ENVIAR pelo mesmo canal — hoje comandos vão por REST e o canal é só servidor→navegador. Buffer por pessoa não é reversível: por tenant foi vazamento real.
