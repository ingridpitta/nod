# ADR-004 — Trilha imutável por TRIGGER, sem texto livre, prosa em tabela irmã apagável

**Status** mantido · Emendada pela [ADR-126](adr-126-minha-conta-reautenticacao-exportacao-e-purga-no-beta.md) (2026-10-23): o DELETE da purga da conta é a única exceção

## Decisão

Inalterado em tudo: trigger BEFORE UPDATE OR DELETE OR TRUNCATE levantando exceção inclusive para o dono; payload só enum, uuid, timestamp e numérico garantido por CHECK na mesma migração; prosa em tabela irmã apagável referenciada por id; coluna de hash nullable e não preenchida; role de poda separado; SAVEPOINT em todo teste. A trilha ganha owner_id e é lida sob a policy do ADR-003 revisto.

## O que mudou

Só o acréscimo de owner_id, que vem do ADR-003.

## Por quê

O rigor nunca veio do número de clientes. Veio de dois fatos que não mudaram: dados pessoais sensíveis continuam em jogo, e o CHECK é o que impede que prosa entre na trilha. Se prosa entrar durante o uso interno, no dia do SaaS o passivo vai junto e não sai — numa trilha imutável 'limpar' não é DELETE. Uso interno gera MAIS texto informal e MENOS revisão, não menos. Custo de manter: uma linha.


## Refinamentos (2026-09-16)

- Exceção levantada por trigger deixa a transação ABORTADA (25P02): o teste "o trigger recusou E a linha original continua lá" só existe com SAVEPOINT. O helper `tests/helpers/expect-rejected.ts` (SAVEPOINT → tenta → ROLLBACK TO SAVEPOINT) entrou antes do primeiro trigger e é obrigatório em todo teste de imutabilidade.
- O CHECK `trilha_sem_texto_livre` e os triggers `trilha_no_update`/`trilha_no_truncate` são declarados também em `src/db/schema/trilha.ts` com nome IDÊNTICO; `tests/conformidade/trilha.test.ts` compara com pg_constraint/pg_trigger.
- Para `nod_app` a recusa vem antes, pelo REVOKE UPDATE/DELETE/TRUNCATE; o trigger é a segunda camada e vale inclusive para o dono. Só `nod_poda` apaga `trilha_prosa`.
- A mensagem de erro é canal de vazamento: `ErroDeDominio` carrega código fechado e o detalhe em `cause`; a resposta HTTP nunca ecoa `message` (ver ADR-002).

## Gatilho de reversão

Reabrir se o jurídico exigir retenção de prosa junto ao registro (aí a tabela irmã apagável não serve) ou se um pedido de exclusão LGPD precisar tocar uma coluna tipada da trilha — hoje a premissa é que enum/uuid/timestamp/numérico não identificam o titular.
