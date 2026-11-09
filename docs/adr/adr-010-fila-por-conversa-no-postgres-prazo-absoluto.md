# ADR-010 — Fila por conversa no Postgres, prazo absoluto

**Status** revisado

## Decisão

Mantidos os três estados e o prazo absoluto, e acrescentado um QUARTO estado: 'interrompido', com motivo tipado. Duas colunas novas na linha de turno: machine_id (qual máquina reivindicou) e lease_ate (instante absoluto, renovado). O prazo passa a ter dois níveis: o lease curto (90s, renovado de 30 em 30 pela máquina) e o prazo de produto que já existia. A reivindicação é o UPDATE condicional com FOR UPDATE SKIP LOCKED — não precisa de tabela nova. Lease vencido converte a linha em parada VISÍVEL com motivo escrito, nunca em reenvio.

## O que mudou

Quarto estado 'interrompido'. Duas colunas (machine_id, lease_ate). O lease como segundo nível de prazo.

## Por quê

Este é o ADR que MAIS ganha com a mudança de premissa, e quem o lesse procurando o que simplificar tiraria a coisa errada. O argumento original era 'o container do PaaS reinicia — é premissa, não acidente'. Agora o executor é o seu laptop, e laptop fecha várias vezes por dia: a interrupção sobe uma ordem de grandeza e o estado 'despachando' com prazo absoluto deixa de ser rede contra restart e vira o mecanismo central do modelo de execução. O openmausbot já tem 'interrupted' no enum (server/message-db.ts:55-64) — o nod estava com três estados onde o repo de referência tem quatro, e a sua decisão 4 mostra por quê.


## Refinamentos (2026-09-16)

- Outbox transacional (`events_outbox`) gravado na MESMA transação do evento (`eventsRepo.gravarComOutbox`): rollback derruba os dois; índice parcial nos pendentes.
- Abandono exige DUAS condições simultâneas: `tentativas >= OUTBOX_TETO_TENTATIVAS` E `criado_em < agora - OUTBOX_IDADE_MIN_MS` (ambas em `src/shared/constantes.ts`, com o critério datado). Só o teto esvaziaria a fila numa queda curta do consumidor; só a idade nunca abandonaria a linha envenenada. Abandonado é CONTADO (métrica `outbox_abandonados`, ADR-017), nunca apagado. Prova: `tests/integration/outbox-abandono.test.ts`.
- Trava de reivindicação só se prova no terceiro modo de teste (duas conexões, `tests/concurrency`), nunca dentro do withRollback (ver ADR-011).

## Refinamento (2026-09-16, L9 — assentar lê com trava)

`assentarTurno` lê o turno com `FOR UPDATE` (`turnosRepo.buscarTravado`). Medido no e2e: Parar (que marca `parar_solicitado_em`) e a entrega do laço correm em transações paralelas; a leitura sem trava via `NULL`, esperava o commit de Parar só no UPDATE seguinte e assentava `sem_progresso` em vez de `parado_pela_pessoa`. Com a trava, a leitura espera o commit e o motivo sai certo — ADR-009: quem decide o motivo é o servidor, e ele precisa ler o estado commitado.

## Refinamento (2026-09-24, fila honesta e frota em paralelo)

Três mudanças vieram de um caso real: a Nina ficou 30 min numa triagem de e-mails, a tela mostrava só "na fila", o Marlon mandou "fazer novamente" mais duas vezes (duas triagens a mais enfileiradas) e a Taga esperou o tempo todo.

- **A conversa devolve os turnos abertos** (`turnosEmCurso`). A web recria o turno vivo depois de recarregar a página; antes ela só o conhecia pelo frame `turno.iniciado`, que não se repete.
- **Cada mensagem na fila se cancela sozinha, e as que ficam são lidas juntas.**
  - `turnos.mensagem_origem_id` (0024) liga o turno à fala que o disparou. Não é `mensagens.turno_id`, que continua sendo a fala que o turno produziu.
  - O Cancelar (`POST /turnos/:id/cancelar`) só pega turno `pendente`.
  - Ao reivindicar um turno disparado por fala da pessoa, os outros pendentes da mesma conversa e agente saem `interrompido`/`absorvido` com `absorvido_por`, e a entrada do vencedor vira a lista das falas.
  - Isso nunca é requeue: nenhum turno volta a `pendente`.
- **Pool elástico de laços por pessoa, sem teto** (decisão do Marlon). Sempre um laço ocioso puxando e mais um por turno rodando.
  - A serialização que importa já estava aqui: mesma conversa e mesmo agente. O laço único serializava também agentes diferentes, sem motivo.
  - O paralelismo máximo é o número de agentes com trabalho.
  - Custo aceito: rotinas simultâneas de vários agentes abrem várias CLIs e gastam o limite da assinatura mais rápido.
  - A rota da ponte desktop guarda um plano por turno, e o app tem um buffer de trechos por turno.

Gatilho de reversão do pool: se o limite da assinatura estourar por paralelismo (rate_limit `rejected` no stream-json) mais de uma vez por semana, pôr teto configurável por pessoa.

## Gatilho de reversão

Reabrir (trocar por fila externa) se, medido em produção: latência de reivindicação p95 > 500 ms com o pool do ADR-001, ou `outbox_abandonados` > 0 por dia durante duas semanas seguidas sem causa no consumidor, ou a fila precisar de fan-out entre serviços que não compartilham o Postgres.
