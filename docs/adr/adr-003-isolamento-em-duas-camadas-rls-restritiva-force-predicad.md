# ADR-003 — Isolamento em duas camadas: RLS restritiva FORCE + predicado explícito, SET LOCAL por transação

**Status** revisado

## Decisão

O MECANISMO nasce ligado na migração 0001 (ENABLE + FORCE, policy RESTRICTIVE, role de aplicação NOBYPASSRLS não-dono, SET LOCAL em helper único, teste de conformidade contra o catálogo), e passa a apontar para a PESSOA. A policy do dia 1 é conjuntiva: tenant_id = current_setting('nod.tenant_id') AND (owner_id = current_setting('nod.pessoa_id') OR visibility = 'equipe' OR existe delegação). Três colunas na 0001: tenant_id (DEFAULT da constante TENANT_PADRAO, dentro de toda UNIQUE e FK — A-RLS-5 preservada), owner_id, e visibility como enum fechado com DEFAULT 'privado'. O helper db/tx.ts faz DOIS SET LOCAL, ambos obrigatórios, e LANÇA ERRO se algum vier vazio em vez de deixar o Postgres devolver zero linhas. A-RLS-4 mantido.

## O que mudou

O eixo da policy muda de tenant para pessoa. Duas colunas novas (owner_id, visibility). O helper ganha um segundo parâmetro obrigatório. A perna de tenant fica escrita na mesma policy desde já, como cláusula conjuntiva, para que o dia do SaaS custe dias.

## Por quê

O isolamento não sumiu, mudou de eixo — e o novo eixo é MAIS difícil, não menos. Entre 70 clientes nenhuma linha legitimamente se encontrava. Entre as pessoas do time a fila é mista de propósito: você quer que a colega veja seu trabalho, e ao mesmo tempo seu agente privado não é dela. Isolamento com exceções legítimas é exatamente onde filtro de aplicação falha, e o projeto de referência já tem a cicatriz (CHANGELOG 0.19.0.0, 71 registros fantasmas de outras contas; o TODO(rbac-follow-up) admitindo 'fail-closed por disciplina, não por construção'). DUAS FRENTES DISCORDARAM AQUI e a discordância chegou até você sem ninguém sinalizar: a frente da ponte escreveu que 'pessoa é filtro de trabalho, não fronteira de segurança'. Ela está errada, e o critério de aceite de E3.1 a desmente por escrito: 'Dado que existe uma decisão dirigida a outra pessoa numa organização onde sou membro, quando a fila renderiza, então essa decisão NÃO APARECE PARA MIM EM NENHUMA CIRCUNSTÂNCIA.' Isso é P0 desde sempre e é isolamento por pessoa DENTRO da mesma organização.


## Refinamentos (2026-09-16, fundação)

- O helper único virou DUAS funções em `src/db/tx.ts`: `abrirTxEscopada(db, escopo)` abre o BEGIN e emite os dois `set_config(..., true)` (SET LOCAL) como primeira instrução; `vincularEscopo(trx, escopo)` só emite os dois SET LOCAL num trx que já existe. Produção usa a primeira; `tests/helpers/with-rollback.ts` usa a segunda. Motivo: withRollback e a fábrica de transação brigam pela propriedade do BEGIN (docs/praticas-herdadas.md §1).
- O segundo SET LOCAL é `nod.pessoa_id`. Os dois são obrigatórios, sem default: `''`/`undefined` lança `ErroDeDominio('escopo_vazio')` antes de tocar o banco.
- PERMISSIVE + RESTRICTIVE, verificado em 2026-09-16 no spike (`tests/integration/spike-rls-rollback.test.ts`): o Postgres exige uma policy PERMISSIVE para conceder; a RESTRICTIVE só aperta. Com só a RESTRICTIVE, até o INSERT do próprio escopo cai em 42501 e o SELECT devolve zero. Por isso `nod_escopar_tabela` cria `nod_pessoa` (PERMISSIVE, dono OU 'equipe' OU perna extra; WITH CHECK só dono) e `nod_tenant` (RESTRICTIVE, perna conjuntiva do tenant).
- O role da suíte é `nod_app` (NOBYPASSRLS, não-dono); o gate `tests/conformidade/rls.test.ts` assere `rolbypassrls = false` e lê pg_class/pg_policies por NOME de policy. O primeiro teste do gate é negativo (`rls-negativo.test.ts`).
- Partições de `events`: a policy do pai cobre toda consulta pelo pai; nod_app não recebe GRANT nas partições, e o gate prova as duas metades — por execução: `rls.test.ts` cria uma partição nova com `sqlParticao` como nod_dono sob rollback, ela passa no gate, e um `GRANT` direto nela é acusado.
- **`abrirTxEscopada` só aceita o pool (`Db`), nunca uma transação aberta.** Medido em 2026-09-16 no psql: um `set_config(..., true)` feito dentro de um SAVEPOINT persiste depois do `RELEASE` — abrir a "tx da pessoa B" como savepoint dentro da transação de A deixaria A rodando como B (escalada silenciosa). O tipo recusa (`TransactionSql` não tem `begin`; `tests/unit/db/tx.test.ts` prova com `@ts-expect-error`) e uma guarda em runtime lança `estado_invalido`. Escopo aninhado não existe: quem já tem um trx usa `vincularEscopo`. `paraCadaPessoa(db: Db, …)` abre um BEGIN real por pessoa; a fonte de pessoas é injetável (`listarPessoas`) só para o teste enumerar linhas criadas sob rollback.
- **Identidade é só leitura para a aplicação:** `tenants`/`pessoas` têm `GRANT SELECT` a nod_app (o contrato fixado); quem escreve é o seed, como nod_dono. Testes que precisam de pessoas as criam com `tests/helpers/db-dono.ts` (`withRollbackDono`), que NUNCA lê tabela escopada — sob FORCE o dono sem policy não vê nada, e é assim que deve ficar.
- **Escopo é da conexão, provado com duas conexões simultâneas** (`tests/concurrency/escopo-por-conexao.test.ts`): cada transação lê a sua pessoa; fora delas o parâmetro não existe ou está vazio (`''::uuid` não converte — fechado nos dois casos).

## Refinamento (2026-09-16, 0003 — a decisora escreve)

- A perna extra da policy só ABRE LEITURA: o WITH CHECK da `nod_escopar_tabela` exige `owner_id` = pessoa da sessão. Quem precisa que a perna também ESCREVA cria uma policy PERMISSIVE a mais, só para o comando necessário, e a registra por NOME em `POLICIES_EXTRAS` do gate (`tests/conformidade/gate-rls.ts`) — como `nod_decisora` (FOR UPDATE em `decisoes` e `itens_aprovacao`).
- Uma policy FOR UPDATE concede o UPDATE de QUALQUER coluna (medido em 2026-09-16 com os triggers desligados: a decisora reescreveu frase/prazo e pôs `visibility = 'equipe'` na decisão da dona). Por isso a policy extra vem SEMPRE com um trigger BEFORE UPDATE que fecha a lista de colunas que quem não é a dona pode mudar (`colunasLivresDaDecisora` em `src/db/schema/decisoes.ts`), e o motivo em `POLICIES_EXTRAS` nomeia o trigger. Provado em `tests/integration/repos/decisora-escreve.test.ts`.

## Refinamento (2026-09-16, 0004 — policies por comando)

- A `nod_pessoa` FOR ALL da 0001 tinha um furo: USING vale para SELECT, UPDATE e DELETE, e DELETE não tem WITH CHECK — quem só devia LER pela perna extra ou por `'equipe'` conseguia APAGAR a linha (medido em 2026-09-16 em `tests/integration/repos/policies-por-comando.test.ts` com a 0001–0003: `delete from decisoes` pela decisora → count 1; `delete from agentes` numa linha 'equipe' por outra pessoa → count 1).
- `nod_escopar_tabela` passa a criar QUATRO PERMISSIVE por comando — `nod_pessoa_select` (dono OU 'equipe' OU perna extra), `nod_pessoa_insert` (WITH CHECK dono), `nod_pessoa_update` (USING e WITH CHECK dono), `nod_pessoa_delete` (USING dono) — mais a RESTRICTIVE `nod_tenant`. A perna extra e 'equipe' abrem só o SELECT; UPDATE/DELETE por quem não é a dona afetam ZERO linhas (não estouram 42501: a linha não é vista), e o contrato "repositório devolve null, nunca lança" fica verdadeiro por construção. O gate confere nome E comando (`pg_policy.polcmd`).
- Consequência para o ADR-007: a decisora continua decidindo pela policy extra FOR UPDATE da 0003; deixou de poder apagar a decisão que não é dela.

## Gatilho de reversão

Reabrir se (a) o spike de regressão mostrar que SET LOCAL vaza entre transações do pool (hoje provado que não), ou (b) uma consulta legítima de produto precisar cruzar pessoas do mesmo tenant sem `visibility = 'equipe'` nem perna extra nomeada e não couber numa perna extra da policy — aí o eixo pessoa está errado, não a RLS. Reabrir o refinamento da 0004 se um fluxo de produto precisar que quem NÃO é a dona apague ou reescreva uma linha inteira pela perna extra — a resposta correta é outra policy extra nomeada com trigger, não voltar ao FOR ALL.
