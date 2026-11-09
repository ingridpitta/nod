# ADR-011 — Travas de execução: janela de rotina única, expiração idempotente

**Status** revisado

## Decisão

Mantidas as duas UNIQUE — reivindicação de janela por (tenant_id, rotina_id, instante_agendado) derivado do cron mais fuso IANA, e idempotência do varredor por (decisao_id, tipo_de_evento). Mantida a recusa de offset numérico na persistência de rotina. Acréscimo: a tabela de reivindicação registra QUAL executor ganhou. MAS A JUSTIFICATIVA MUDA: a trava protege o varredor idempotente sobre a trilha imutável e o scheduler do servidor — NÃO protege contra 'N laptops disputando a janela das 8h', porque quem avalia cron é o servidor, não o laptop.

## O que mudou

Nada de mecanismo. A justificativa é reescrita, porque o cenário de frota que uma frente usou para defendê-la não existe na arquitetura de pull.

## Por quê

Aqui uma frente manteve a coisa certa pelo motivo errado, e motivo errado sustenta a próxima coisa cara. O cenário 'dois laptops que abrem às 8h01 avaliam a mesma janela das 8h' é impossível: na ponte de pull o laptop não avalia cron nenhum, ele puxa trabalho que o servidor já enfileirou. O argumento verdadeiro é o original e continua bom: numa trilha imutável por trigger a linha duplicada não sai, e sob LGPD dado inexato retido é infração distinta. Duas UNIQUE numa migração. Para o turno local, SKIP LOCKED já resolve e é grátis.


## Como se prova: três modos de teste, não dois (2026-09-16)

A estratégia de testes tem TRÊS modos além do unitário: integração-sob-rollback (`tests/integration`, a esmagadora maioria), conformidade lendo o catálogo (`tests/conformidade`) e concorrência-com-duas-conexões (`tests/concurrency`, poucos arquivos, serial, limpeza própria por id, `SET LOCAL lock_timeout = '250ms'`). As duas UNIQUE deste ADR e a reivindicação do ADR-010 só se provam com duas transações de verdade disputando a mesma linha — o withRollback tem um envelope só, e tentar espremer o teste nele conclui erradamente que a trava funciona. Nunca apertar o `max` do pool (`tests/helpers/db.ts`): transações enfileiradas deixam esses testes verdes provando nada. Os dois primeiros arquivos do modo nasceram na fundação: `tests/concurrency/escopo-por-conexao.test.ts` (duas transações simultâneas com pessoas diferentes) e `migrar-trava.test.ts` (dois runners disputam a `pg_advisory_lock(7211)`; a mutação sem a trava cai em chave duplicada — observado em 2026-09-16). `test:concurrency` roda SEM `--passWithNoTests`: zero arquivos é vermelho.

## Gatilho de reversão

Reabrir se um teste de concorrência com dois processos mostrar janela duplicada apesar da UNIQUE (impossível por construção; indicaria instante canônico não determinístico entre processos — corrigir `proximaJanela`, não a trava), ou se o scheduler precisar rodar fora do servidor (ADR-022 mudaria antes).
