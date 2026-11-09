# Práticas herdadas de um projeto de referência

Investigação do monorepo de um projeto de referência (daqui em diante, "a referência") para trazer práticas ao nod. Cada afirmação foi verificada abrindo os arquivos — onde há número, ele foi contado.

---

## Tese

O nod não herda a ARQUITETURA da referência — herda os MECANISMOS dela, e a distinção é o achado central desta investigação. O que o Marlon admira no monorepo (clean arch de verdade, teste de integração barato contra banco real, excelente DX local) existe lá, é excelente, e verifiquei que nenhuma dessas três coisas é entregue pelos pnpm workspaces. As quatro camadas da referência (domain/repositories/services/use-cases) convivem DENTRO de packages/core, que é um pacote só, e as fronteiras entre elas são 16 blocos `files:` no eslint.config.mjs que são todos globs de DIRETÓRIO — nenhum depende de resolução de pacote. O withRollback, que é a peça mais valiosa do repositório inteiro, tem 15 linhas efetivas e nenhuma dependência de workspace. O split de testes é script de npm. Ou seja: o nod herda a disciplina, não a topografia.

O que o nod herda, concretamente, são cinco famílias: (1) a injeção de transação como FÁBRICA — o tipo `Transaction = <T>(fn: (trx) => Promise<T>) => Promise<T>` — que é a única razão pela qual teste unitário e de integração custam o mesmo esforço, e que no nod já é o helper db/tx.ts que o ADR-003 decidiu; (2) o withRollback, que é a única forma honesta de provar RLS (ADR-003) e trilha por trigger (ADR-004), porque nenhum dos dois existe em banco mockado; (3) o gate de cobertura por registry comparado contra a REALIDADE (o catálogo do Postgres, não strings), que é o mecanismo de maior retorno por linha do repositório e ataca a falha que ninguém vê — tabela nova nascendo desguardada; (4) o outbox transacional, que é a referência pagando Inngest e ainda assim pondo a durabilidade no Postgres, confirmando o ADR-010 com evidência de quem tinha o fornecedor contratado; (5) o hábito de comentar a falha MEDIDA e DATADA ao lado da decisão que ela motivou, que custa zero manutenção e é o que impede alguém de reintroduzir o bug em seis meses. O que o nod explicitamente NÃO herda é o isolamento multi-tenant: a referência não tem RLS, resolve tudo em camada de aplicação, e isso já vazou em produção com número medido. O ADR-003 é estruturalmente superior ao que a referência tem hoje, e a investigação confirma isso em vez de contradizê-lo.

---

## Pacote único ou workspaces

PACOTE ÚNICO. O ADR-018 fica de pé inteiro, e o monorepo da referência é evidência A FAVOR dele, não contra. Verifiquei pessoalmente, não por relato.

A evidência positiva: os 16 blocos `files:` do eslint.config.mjs são todos globs de caminho de diretório (`packages/core/src/domain/**/*.ts`, `packages/core/src/repositories/**/*.ts`, `packages/core/src/use-cases/**/*.ts`, e assim por diante). Nenhuma das 15 regras de fronteira depende de workspace protocol, de package.json separado ou de resolução pnpm. Uma proibição de `**/repositories/**` funciona idêntica se o diretório for `packages/core/src/repositories` ou `src/repositories`. A clean arch que o Marlon quer é entregue por glob + tsconfig, não por workspace.

A evidência negativa, que é mais forte: a única coisa que SÓ os workspaces poderiam dar — a fronteira externa por resolução de módulo — não segurou. Contei 99 imports por caminho profundo (`@acme/db/src/schema/index.js`) dentro de packages/core/src, furando o barril público. O workspace não impediu ninguém. Em troca cobra: 12 package.json, 13 tsconfig, typescript declarado em 9 arquivos com drift JÁ presente (^5.7.0 em dois pacotes contra ^5.7.2 nos outros sete), vitest em 7 package.json, `pnpm -r --if-present` em todo script da raiz e `--passWithNoTests` para não quebrar. O `tooling/*` está declarado no pnpm-workspace.yaml e contém exatamente dois arquivos (docker-compose.yml e AGENTS.md), nenhum package.json — é uma pasta elevada a cidadão de workspace por convenção, não por necessidade.

O custo mais eloquente é de segunda ordem: na referência, o reporter de falha ao Sentry teve que morar em apps/web e não em apps/inngest, porque apps/inngest não pode importar @sentry/nextjs sem arriscar o pnpm resolver uma SEGUNDA instância do SDK, nunca inicializada, com captureException virando no-op silencioso. A fronteira de workspace empurrou a observabilidade para longe do que ela observa. Com um container (ADR-017) e um pacote (ADR-018), esse custo não existe.

E as duas razões REAIS que justificam workspaces na referência não existem no nod: separar bundle de cliente do de servidor (ela paga isso com transpilePackages + serverExternalPackages + aliases webpack no next.config.mjs, porque o barril do core impuro arrasta postgres, argon2 e nodemailer para o browser), e publicar packages/shared para outro repositório (é o único com publishConfig, e paga um build dual ESM+CJS com um `node -e` escrevendo package.json na mão).

Uma ressalva de honestidade: não medi TEMPO. Não sei quanto os workspaces custam em segundos de install ou typecheck, e um argumento de latência poderia existir nos dois sentidos. O que medi foi custo de manutenção e atrito de comando, que é o eixo que importa para 2-3 engenheiros. E o gatilho de reversão fica escrito: se surgir um segundo deployable com bundle de cliente, ou se um terceiro repositório precisar consumir parte do nod como dependência publicada, reabra.

---

## O que adotar

| Quando | Prática | Esforço | ADR |
|---|---|---|---|
| `dia-1` | Injeção de transação como FÁBRICA — o tipo Transaction, que é o db/tx.ts do ADR-003 | baixo | ADR-003 |
| `dia-1` | withRollback — teste de integração contra Postgres real com rollback por Symbol | baixo | ADR-003 e ADR-004 |
| `dia-1` | Fronteiras de camada por no-restricted-imports sobre globs de DIRETÓRIO | baixo | ADR-018 |
| `dia-1` | Gate de conformidade lendo o CATÁLOGO do Postgres, não arquivos de migração | baixo | ADR-003 e ADR-004 |
| `dia-1` | Dois roles no docker-compose desde o primeiro commit, e healthcheck obrigatório | baixo | ADR-003 e ADR-017 |
| `dia-1` | CI que NÃO roda seed, com skip de integração virando ERRO sob CI | baixo | ADR-003 e ADR-004 |
| `fase-1` | Outbox transacional no Postgres, com abandono exigindo DUAS condições | medio | ADR-010 |
| `dia-1` | Runtime pinado por mise, com o aviso MEDIDO ao lado | baixo | ADR-014 (versão exata pinada) aplicado a quem desenvolve, e ADR-018 (o pino do runtime é parte do esqueleto). |
| `dia-1` | Pre-commit mínimo, gate pesado no check e CI em três jobs paralelos | baixo | ADR-018 |
| `dia-1` | Log estruturado com wrapper único e no-console LIGADO no primeiro commit | baixo | ADR-017 (sete métricas) e ADR-018 (o core não observa, a borda observa) |
| `dia-1` | Catcher local como DEFAULT de dev para todo efeito externo caro | medio | ADR-013 e ADR-014 |
| `fase-1` | Seed idempotente por UUID determinístico, na versão pequena | baixo | ADR-003 (dois tenants fixos para exercitar o isolamento) e ADR-005 (tabelas de domínio para estado). |
| `dia-1` | Comentário que registra a MEDIÇÃO e a DATA, não a intenção | baixo | Transversal |
| `dia-1` | Gatilho de reversão em todo ADR decidido contra uma alternativa razoável | baixo | Todos os 18 |

### 1. Injeção de transação como FÁBRICA — o tipo Transaction, que é o db/tx.ts do ADR-003

Todo caso de uso recebe `(repos, services, tx, input)` e `tx` é uma fábrica `<T>(fn: (trx) => Promise<T>) => Promise<T>`, nunca um handle. Em produção ela abre envelope real; no teste, `(fn) => fn(trx)` devolve o envelope condenado do rollback; em teste unitário, `(fn) => fn({} as never)` porque os repos são falsos. É a indireção de uma linha que faz três modos de execução usarem o mesmo código de produção.

**No nod.** É o `src/db/tx.ts` que o ADR-003 já decidiu, com uma decisão nova e obrigatória: fatiar em DUAS funções, porque withRollback e db/tx.ts brigam pela propriedade do BEGIN. `openTenantTx(db, tenantId)` abre a transação E emite o SET LOCAL como primeira instrução; `bindTenant(trx, tenantId)` só emite o SET LOCAL num trx que já existe. Produção chama a primeira, teste chama withRollback e depois a segunda. Sem esse fatiamento, ou o teste duplica a lógica de tenant (o que o ADR-003 existe para impedir), ou o rollback não cobre os writes.

**Modelo.** `packages/core/src/transaction.ts (3 linhas efetivas) e packages/core/src/use-cases/types.ts`

**Relação com os ADRs.** ADR-003 — refina: o helper único vira duas funções, e o tenant é parâmetro OBRIGATÓRIO, sem default. A referência declara `createEmpresasRepo(db, scope = {kind:'global'})`, que é fail-OPEN no ponto de entrada dentro de um sistema que se descreve como fail-closed.

*dia-1 · esforço baixo*

---

### 2. withRollback — teste de integração contra Postgres real com rollback por Symbol

Abre `db.transaction()`, roda o corpo do teste e lança um `Symbol('rollback')` de módulo para forçar o ROLLBACK; o catch externo engole só esse símbolo e repropaga qualquer erro real. O resultado escapa pela closure porque o await nunca retorna com sucesso. Usar Symbol privado em vez de Error é o detalhe que importa: impede confundir rollback intencional com falha real.

**No nod.** `tests/helpers/with-rollback.ts`, copiável quase sem mudança, mais um segundo helper que a referência não tem e o nod precisa: `expectRejected(trx, fn)` que abre SAVEPOINT, executa, captura a exceção do trigger ou do CHECK, faz ROLLBACK TO SAVEPOINT e devolve a transação utilizável. Verifiquei o padrão da referência em cep.repo.test.ts: o `rejects.toThrow()` é sempre o ÚLTIMO ato do envelope, nada é verificado depois. Eles contornaram o problema em vez de resolvê-lo, e o nod não pode contornar porque o ADR-004 vai querer provar 'o trigger recusou E a linha original continua lá'.

**Modelo.** `packages/core/tests/helpers/with-rollback.ts; o contorno visível em packages/core/tests/integration/repositories/cep.repo.test.ts:85-105`

**Relação com os ADRs.** ADR-003 e ADR-004 — é a única forma honesta de provar ambos, porque RLS com FORCE e trigger não existem em banco mockado. Refina o ADR-004: todo teste de imutabilidade abre SAVEPOINT.

*dia-1 · esforço baixo*

---

### 3. Fronteiras de camada por no-restricted-imports sobre globs de DIRETÓRIO

Um bloco por camada no eslint, cada um proibindo o que a camada não pode ver, com mensagem de erro que ENSINA o caminho certo ('fale com o banco pelos repos, pegue env pelos services, transação pelo parâmetro tx injetado'). Usa a variante @typescript-eslint da regra para poder liberar `allowTypeImports: true` onde o import de tipo some na compilação e não fere pureza.

**No nod.** `eslint.config.mjs` na raiz com blocos para `src/domain/**`, `src/repositories/**`, `src/use-cases/**`, `src/adapters/**`. O ADR-018 já delega essa fronteira ao lint e está certo: nenhum tsconfig consegue dizer 'use-cases não importa repositories'. O que o tsconfig guarda é a outra metade — a ausência de Node e DOM.

**Modelo.** `eslint.config.mjs (586 linhas, 16 blocos `files:`, todos globs de diretório)`

**Relação com os ADRs.** ADR-018 — refina o MECANISMO: a guarda é composta. O tsconfig guarda a pureza (Node/DOM ausentes), o lint guarda a DIREÇÃO entre camadas. O texto atual pode ser lido como se o compilador cobrisse tudo.

*dia-1 · esforço baixo*

---

### 4. Gate de conformidade lendo o CATÁLOGO do Postgres, não arquivos de migração

Um teste unitário sem banco (ou com uma conexão só de leitura) que compara o estado real contra uma lista declarada: toda tabela ou cumpre a regra, ou está numa lista de exceções com motivo ESCRITO. Falha o CI quando uma tabela nova nasce sem decisão registrada.

**No nod.** Dois gates de ~40 linhas cada. (1) Toda tabela com coluna tenant_id ou tem policy restritiva com FORCE — lido de `pg_class.relrowsecurity`, `relforcerowsecurity` e `pg_policies` — ou está na lista de exceções com razão. (2) Toda tabela de trilha tem trigger e CHECK, mesma forma. Comparar contra o catálogo é comparar com a REALIDADE: não pode ter entrada morta.

**Modelo.** `packages/db/tests/seedable-coverage.test.ts (o bom, detecta via `is(x, Table)` do drizzle) e packages/core/src/repositories/scopeable.registry.json (o ruim, compara strings — o campo `_naming` documenta que `janela_admissao_pedidos` em snake_case não casava com nada e a tabela ficou desguardada até 2026-09-02)`

**Relação com os ADRs.** ADR-003 e ADR-004 — é o gate de maior retorno por linha do repositório inteiro, e ataca exatamente a falha que ninguém vê.

*dia-1 · esforço baixo*

---

### 5. Dois roles no docker-compose desde o primeiro commit, e healthcheck obrigatório

O compose da referência tem 46 linhas e dois serviços (Postgres 16 com `pg_isready` a cada 2s, e um catcher local), volume nomeado, e quatro comandos de lifecycle na raiz: docker:up, docker:down, docker:reset, dev:setup.

**No nod.** Copiar a forma, mudar o conteúdo num ponto crítico. A referência sobe POSTGRES_USER: acme, que é o DONO do banco, local e no CI. Copiar isso seria fatal: FORCE ROW LEVEL SECURITY existe justamente porque o dono normalmente escapa da RLS, então toda a suíte rodaria como superuser e ficaria verde provando nada. O init do compose cria dois roles — dono para migração, aplicação NOBYPASSRLS para tudo mais — e o gate de conformidade assere que o role da suíte tem `rolbypassrls = false`. Mais dois bancos no mesmo container (nod e nod_test), que custam dois comandos e evitam o único defeito estrutural que a referência carrega aqui.

**Modelo.** `tooling/docker/docker-compose.yml (linhas 3-13 do serviço postgres) e .github/workflows/ci.yml`

**Relação com os ADRs.** ADR-003 e ADR-017 — o compose local é o espelho de dev do container único, e é parte do esqueleto que o ADR-018 manda commitar antes da lógica.

*dia-1 · esforço baixo*

---

### 6. CI que NÃO roda seed, com skip de integração virando ERRO sob CI

O CI migra o schema e para — tabelas vazias, cada teste cria as próprias linhas, com o padrão 'ensure, não find-or-throw' (procura a linha, se não achar cria com onConflictDoNothing). O comentário do workflow é explícito sobre ser deliberado.

**No nod.** Adotar direto, mais a trava que a referência não tem. Verifiquei: 168 arquivos usam `describe.skipIf(!process.env['DATABASE_URL'])` e nenhum workflow assegura que DATABASE_URL existe no CI — um pipeline mal configurado fica VERDE com zero teste de integração. No nod isso é pior que na referência porque os invariantes skipados seriam RLS e trilha LGPD: um CI verde e vazio não é ausência de prova, é prova falsa. Mantenha o auto-skip para o dev sem Docker, e faça `test:integration` FALHAR sem DATABASE_URL e o skip virar erro quando process.env.CI está setado.

**Modelo.** `.github/workflows/ci.yml e packages/core/AGENTS.md:507`

**Relação com os ADRs.** ADR-003 e ADR-004 — com seed, o teste de isolamento pode estar verde porque a linha vizinha não existe, não porque a policy barrou. Com tabelas vazias, o teste é obrigado a criar tenant A e tenant B, que é a única prova que vale.

*dia-1 · esforço baixo*

---

### 7. Outbox transacional no Postgres, com abandono exigindo DUAS condições

O item de fila é escrito na MESMA transação do estado de domínio — se a escrita der rollback, o evento não existe, sem 2-phase commit. Índice parcial nos pendentes mantém o índice pequeno. O abandono exige `tentativas >= N` E `idade > X` simultaneamente, e as linhas abandonadas não são apagadas, são CONTADAS.

**No nod.** É o ADR-010 confirmado por quem tinha o fornecedor pago: a referência TEM Inngest e ainda assim a durabilidade mora no events_outbox. O refinamento que ela oferece de graça é a política de abandono, que o ADR-010 não decide: só o teto de tentativas esvazia a fila inteira numa queda do fornecedor (o cron roda a cada minuto sem backoff), e só a idade nunca abandona a linha envenenada que falha rápido e para sempre. E 'itens abandonados' precisa ser uma das sete métricas do ADR-017 — na referência é um console.error que ninguém lê, o pior buraco operacional do repositório.

**Modelo.** `packages/db/src/schema/events-outbox.ts e apps/inngest/src/functions/dispatch-outbox-events.ts`

**Relação com os ADRs.** ADR-010 — confirmado e refinado com a política de abandono. ADR-017 — acrescenta a métrica.

*fase-1 · esforço medio*

---

### 8. Runtime pinado por mise, com o aviso MEDIDO ao lado

Um `.mise.toml` de 3 linhas, mais um bloco no AGENTS.md documentando que se o shell tem nvm ou asdf, ele GANHA do mise e você roda a suíte no Node errado. Com número: 19 falhas com Node 18 do nvm, 892 verdes com `mise exec`. O pre-commit é envelopado (`if command -v mise; then mise exec -- pnpm lint-staged; else ...`).

**No nod.** Copiar inteiro. É a classe de falha que MENTE sobre onde está o bug — as 19 falhas apontavam arquivos de feature que estavam corretos, e quem acredita na primeira leitura 'conserta' código que já funcionava. Isso importa dobrado num produto feito de agentes, porque é exatamente o erro que um agente comete com confiança.

**Modelo.** `.mise.toml e AGENTS.md § Comandos`

**Relação com os ADRs.** ADR-014 (versão exata pinada) aplicado a quem desenvolve, e ADR-018 (o pino do runtime é parte do esqueleto).

*dia-1 · esforço baixo*

---

### 9. Pre-commit mínimo, gate pesado no check e CI em três jobs paralelos

O pre-commit roda APENAS lint-staged com eslint --fix nos .ts staged — sem typecheck, sem teste. O gate real é `check` = lint + typecheck + test antes do push, e o CI em três jobs paralelos: lint+typecheck sem DB, unit sem DB, integração com sidecar Postgres.

**No nod.** Adotar sem ajuste. A distribuição de custo está certa e é o que impede o time de adquirir o hábito do `--no-verify`, que é o fracasso típico do pre-commit ambicioso. Coerente com o ADR-018: a garantia forte é o compilador, e typecheck pertence ao CI, não ao pre-commit. Com pacote único fica mais simples ainda — sem filtro de workspace, sem `-r --if-present`.

**Modelo.** `package.json (simple-git-hooks + lint-staged) e .github/workflows/ci.yml`

**Relação com os ADRs.** ADR-018 — é o esqueleto que ele manda commitar antes da lógica.

*dia-1 · esforço baixo*

---

### 10. Log estruturado com wrapper único e no-console LIGADO no primeiro commit

É o inverso do que a referência fez, e por isso entra aqui. Verifiquei: `no-console: "off"` no eslint.config.mjs:95, e 479 chamadas de console cruas só em packages/core/src (incluindo use-cases e services, ou seja caminho de produção). Não há pino, winston, nem correlation id de servidor em lugar nenhum.

**No nod.** Um wrapper único de log JSON, `no-console` ligado no primeiro commit, e todo log carregando tenant_id e um id de correlação — que nascem de graça no db/tx.ts do ADR-003, que já é obrigado a existir e já sabe o tenant. O wrapper fica FORA do domínio, porque o ADR-018 proíbe @types/node lá: o domínio retorna o que aconteceu, a borda loga. Custa quase nada agora; a referência hoje pagaria uma migração de ~610 chamadas ou conviveria com dois padrões.

**Modelo.** `eslint.config.mjs:95 (a decisão a inverter) e apps/inngest/src/functions/dispatch-outbox-events.ts (a consequência: evento perdido reportado por console.error)`

**Relação com os ADRs.** ADR-017 (sete métricas) e ADR-018 (o core não observa, a borda observa) — nenhum ADR diz hoje ONDE o log fica, só onde ele não fica.

*dia-1 · esforço baixo*

---

### 11. Catcher local como DEFAULT de dev para todo efeito externo caro

O segundo serviço do compose é um Mailpit, e os TRÊS canais externos da referência (email, WhatsApp, Slack) dividem o mesmo inbox — inclusive o Slack, entregando o Block Kit inteiro para revisar a copy sem canal real. Em dev não é preciso credencial de nenhum. O transport catcher é o DEFAULT, não um opt-in.

**No nod.** É mais importante no nod do que na referência, porque o ADR-013 põe o proxy MCP como ponto de decisão e o ADR-014 põe a CLI do fornecedor no container com API key por tenant — o nod inteiro é feito de efeitos externos caros e com credencial. Sem um catcher que registre o que o proxy decidiu e o que o executor teria chamado, cada ciclo de edição custa uma chamada paga e não há loop de desenvolvimento local. Combine com o ADR-016: o inbox é o lugar natural para inspecionar a sequência de frames SSE numerados.

**Modelo.** `tooling/docker/docker-compose.yml (serviço mailpit) e os três catcher-*.service.ts em packages/core/src/services/`

**Relação com os ADRs.** ADR-013 e ADR-014 — acrescenta a decisão que falta: o desenvolvimento local NÃO pode exigir a CLI do fornecedor nem API key real.

*dia-1 · esforço medio*

---

### 12. Seed idempotente por UUID determinístico, na versão pequena

`deterministicId(key)` faz sha256 de um prefixo fixo e formata o hex como UUID preservando os nibbles de versão e variante. Todo seed faz upsert contra esse id, então rodar duas vezes produz o mesmo estado.

**No nod.** Um seed que dá medo não é usado, e um seed não usado apodrece — a idempotência é o que permite chamá-lo dentro de um reset ou depois de um pull sem pensar. Para o ADR-003 tem um segundo uso decisivo: você precisa que tenant_a tenha SEMPRE o mesmo uuid para escrever o teste de isolamento. Comece com 3-5 agregados num array simples, não com o registry lazy de 33 entradas cuja ordem por FK é conhecimento tácito em comentário.

**Modelo.** `packages/db/src/seed/deterministic-id.ts (12 linhas)`

**Relação com os ADRs.** ADR-003 (dois tenants fixos para exercitar o isolamento) e ADR-005 (tabelas de domínio para estado).

*fase-1 · esforço baixo*

---

### 13. Comentário que registra a MEDIÇÃO e a DATA, não a intenção

O melhor hábito do repositório e o de menor custo. Exemplos: o aviso em caixa alta de não apertar o `max` do pool, com a medição (1083ms com max=1 contra 512ms com max=10) e os quatro testes de corrida nomeados que continuariam verdes provando nada; o teste de cobertura journal↔disco que nasceu de duas branches criando a 0099 e uma migration nunca ter rodado, com o CI falhando três dias depois a dez camadas da causa.

**No nod.** Adotar como hábito, não como artefato. É o que impede alguém de 'otimizar' no mês 3 e desligar a suíte em silêncio — e o nod vai precisar exatamente disso para o ADR-011 (reivindicação por tenant/rotina/instante) e o ADR-010, que são invariantes de corrida. Os ADRs do nod já têm Evidência e Revisitar-quando, que é o mesmo gênero; o que falta é levar isso para o comentário de código.

**Modelo.** `packages/core/tests/setup.ts (o aviso sobre o pool) e packages/db/tests/migration-journal-coverage.test.ts`

**Relação com os ADRs.** Transversal — sustenta ADR-010, ADR-011 e ADR-018.

*dia-1 · esforço baixo*

---

### 14. Gatilho de reversão em todo ADR decidido contra uma alternativa razoável

O design doc do apps/agents estrutura decisões com condições VERIFICÁVEIS que provariam o erro: a premissa P3 foi mantida contra a recomendação de dois revisores, e o custo foi registrado como 'teste de 6 meses' com três condições nomeadas.

**No nod.** Nenhum dos 18 ADRs tem isso, e os candidatos óbvios são justamente os decididos contra alternativas razoáveis: o ADR-018 (pacote único) e o ADR-010 (fila no Postgres). Sem gatilho, um ADR só pode ser reaberto por OPINIÃO — que é exatamente o que o pedido original mandou evitar. Para o ADR-018 o gatilho já está escrito no veredito acima.

**Modelo.** `docs/plans/agents/dev-agent-v1.md (premissas P0-P4, decisões D1-D11) e apps/agents/README.md`

**Relação com os ADRs.** Todos os 18 — é prática de processo, não de código.

*dia-1 · esforço baixo*

---

## ADRs que mudam

### ADR-018 — pacote único, core puro guardado pelo compilador

**Mudança.** A decisão de pacote único está CONFIRMADA e sai reforçada — não reabrir. Mudam duas coisas. Primeira, o MECANISMO: a guarda é composta, não única. O tsconfig sem @types/node e sem lib DOM prova a ausência de Node e DOM, e isso é barato e real; mas nenhum tsconfig consegue dizer 'use-cases não importa repositories'. Essa segunda fronteira precisa de no-restricted-imports por glob de qualquer jeito, e o ADR deve nomear qual metade cada mecanismo cobre. Segunda, o ESCOPO da pureza: defina-a como propriedade do DIRETÓRIO src/domain/ com tsconfig próprio, não do pacote inteiro. Verifiquei que tsconfig.base.json da referência já tem lib ES2022 sem DOM para todo o monorepo, e é packages/core/tsconfig.json que DESFAZ a pureza acrescentando "types": ["node"] — o pacote chamado core não passaria no critério do próprio ADR-018. A pureza real vive só em src/domain/.

**Motivo.** Os 16 blocos `files:` do eslint.config.mjs são todos globs de diretório; nenhum depende de resolução de pacote. E a fronteira que só workspaces dariam não segurou: 99 imports por caminho profundo dentro de packages/core/src furam o barril público do @acme/db.

### ADR-018 (segundo refinamento) — o que entra no esqueleto

**Mudança.** Nomear quatro peças que são baratas no dia zero e impraticáveis de retroagir: (1) o factory de repositórios tipado como `Db | Tx` na PRIMEIRA linha escrita; (2) `no-console` ligado no primeiro commit; (3) proibição de DELETE FROM em teste; (4) runtime pinado por mise.

**Motivo.** Cada uma tem cicatriz medida. A mais direta contra o ADR-018 é o cast: contei 352 ocorrências de `as unknown as Db` nos testes da referência, porque createSystemRepos(db: Db) não aceita o handle de transação. Um `as unknown as` é literalmente a brecha que desliga a garantia do compilador que o ADR-018 quer, e ela mora exatamente no código que deveria dar confiança. Custa cinco minutos hoje.

### ADR-004 — trilha imutável por TRIGGER

**Mudança.** Acrescentar que todo teste de imutabilidade abre SAVEPOINT antes da operação proibida, e que o helper de teste expõe isso desde o primeiro teste. No Postgres, exceção levantada por trigger deixa a transação ABORTADA: como o withRollback é UM envelope por teste, o teste 'tenta atualizar a trilha, espera erro, depois verifica que a linha original continua lá' NÃO funciona — a verificação morre com 25P02. Segundo ponto: declarar o CHECK no schema TypeScript, não só na migration, com nome IDÊNTICO nos dois lados.

**Motivo.** Verifiquei o padrão real da referência em cep.repo.test.ts:85-105: o `rejects.toThrow()` é sempre o ÚLTIMO ato do envelope, nada é verificado depois. Eles CONTORNARAM o problema em vez de resolvê-lo, e o nod não pode contornar. Os 4 CREATE TRIGGER das 124 migrations são todos de normalização (BEFORE INSERT/UPDATE que reescreve valor), nunca de imutabilidade append-only — não há precedente para copiar. O mecanismo da transação abortada, porém, está documentado com cicatriz num repositório de domínio (linha 1049), onde eles usaram transaction aninhada (que emite SAVEPOINT) para sobreviver a um 'relation does not exist'. Sobre o CHECK: db:push derrubou views em 2026-05-22 e CHECK constraints não declarados no TS em 2026-07-25.

### ADR-003 — RLS com FORCE, role NOBYPASSRLS, SET LOCAL por transação

**Mudança.** Confirmado e reforçado, com três refinamentos operacionais. (1) O helper único vira DUAS funções — openTenantTx e bindTenant — para resolver o conflito de propriedade do BEGIN entre o db/tx.ts e o withRollback. (2) O tenant é parâmetro obrigatório, sem default. (3) O compose cria dois roles desde o primeiro commit, e o gate de conformidade assere `rolbypassrls = false` no role da suíte.

**Motivo.** Duas evidências. A negativa: a referência não tem RLS para isolamento e isso já a mordeu em produção — CHANGELOG 0.19.0.0 documenta 71 registros fantasmas de outras contas numa coleta e um endpoint que inseria qualquer pessoa na audiência de qualquer coleta, disparando emails cross-conta; a resposta foi construir MAIS camada de aplicação. Há ainda um TODO(rbac-follow-up) com doze repositórios sem scope, admitindo 'fail-closed por disciplina, não por construção'. A positiva, que corrige as investigações: EXISTE precedente de SET LOCAL na referência, e é o padrão certo. packages/db/tests/cadastro-formato-canonico.test.ts trava por teste que a marca é de TRANSAÇÃO e não de sessão, com a justificativa exata que o nod precisa: 'SET sem LOCAL vazaria para a próxima consulta da mesma conexão, e a conexão é reusada pelo pooler'. Isso reduz bastante o risco do spike.

### ADR-001 — pooler, pool e deploy (status: decidir antes da fase 0)

**Mudança.** Incorporar duas consequências operacionais que a referência já pagou e que o ADR-001 não registra: com pooler em modo transação é obrigatório `prepare: false` (o pooler não suporta prepared statements), e o parâmetro que de fato importa contra esgotamento não é o tamanho do pool e sim o `idle_timeout`.

**Motivo.** packages/db/src/client.ts documenta as duas com data e sintoma. Importa ao nod porque interage com o ADR-003: toda leitura escopada abre transação explícita com SET LOCAL, e sem prepared statements o parse acontece toda vez — o custo por query sobe e ninguém mediu quanto.

### ADR-010 — fila por conversa no Postgres

**Mudança.** Confirmado com evidência de quem tinha o fornecedor contratado, mais um refinamento que falta: a política de ABANDONO exige DUAS condições simultâneas (tentativas E idade), nunca uma só. E 'itens abandonados' entra nas sete métricas do ADR-017.

**Motivo.** A referência PAGA Inngest e ainda assim a durabilidade mora no events_outbox do Postgres, escrito na mesma transação do domínio. Se a fila externa bastasse, a tabela não existiria. A regra de abandono é cicatriz: só o teto esvazia a fila inteira numa queda do fornecedor porque o cron roda a cada minuto sem backoff; só a idade nunca abandona a linha envenenada que falha rápido e para sempre.

### ADR-002 e ADR-004 — a mensagem de erro como canal de vazamento

**Mudança.** Inverter o default: a mensagem de erro só sai para o cliente se for declarada segura. Na referência a `message` do DomainError vai CRUA para o browser e o detalhe técnico depende de alguém lembrar de pôr em `options.cause`.

**Motivo.** Funciona lá porque alguém lembrou — há inclusive uma regra de herança deliberada de que SlackSendError NUNCA estende DomainError, justamente para não vazar a resposta do Slack. No nod isso colide com o ADR-002, que decidiu default fechado por ORIGEM precisamente para não depender de lembrar: uma mensagem interpolada com dado pessoal sai pela resposta HTTP sem passar por classificação nenhuma. E protege o ADR-004, cujo CHECK proíbe texto livre na trilha para poder apagar a prosa em separado — de nada adianta se a mesma prosa vaza pela resposta de erro.

### ADR-011 e ADR-010 — o limite do withRollback

**Mudança.** Registrar que a estratégia de testes do nod tem TRÊS modos, não dois: unitário puro, integração-sob-rollback (a esmagadora maioria) e concorrência-com-duas-conexões (poucos arquivos, com limpeza própria). Trava de reivindicação só se prova com duas transações simultâneas disputando a mesma linha, e o withRollback tem um envelope só.

**Motivo.** É limite da técnica, não defeito, e precisa ser escrito para ninguém tentar espremer o teste do ADR-011 dentro do rollback e concluir erradamente que a trava funciona. A referência tem o precedente do modo correto em update-vaga-empresa-notice.test.ts, que abre duas transações de verdade e usa `SET LOCAL lock_timeout = '250ms'` para provar o bloqueio. Junto vem o aviso medido de nunca apertar o `max` do pool, que enfileira transações concorrentes e deixa esses testes verdes provando nada.

---

## O que não trazer

- Os pnpm workspaces. Verificado: 12 package.json, 13 tsconfig, typescript com drift já presente (^5.7.0 em dois pacotes contra ^5.7.2 em sete), vitest declarado em 7 lugares, e `tooling/*` no pnpm-workspace.yaml contendo exatamente dois arquivos e nenhum package.json. Em troca, a fronteira que só eles dariam vazou 99 vezes por imports de caminho profundo. As duas razões reais que os justificam na referência (separar bundle cliente/servidor, publicar packages/shared para outro repositório) não existem no nod.
- O @acme/core como modelo de 'core puro'. Seu tsconfig tem "types": ["node"] e o pacote depende de drizzle-orm, resend, nodemailer, argon2, pdfmake e @anthropic-ai/sdk. Jamais passaria no critério do ADR-018. Copie a pureza do DIRETÓRIO src/domain/, não o pacote chamado core.
- Os 352 `as unknown as Db`. É a fronteira de tipo mais furada do repositório e mora exatamente onde deveria dar confiança. Choca frontalmente com o ADR-018: um cast desses é a brecha que desliga a garantia do compilador. Tipar o factory como `Db | Tx` na primeira linha custa cinco minutos.
- O `DELETE FROM` em teste de integração. São 3 arquivos e custaram a suíte INTEIRA: verifiquei `singleThread: true` no packages/core/vitest.config.ts, posto ali porque o paralelismo dava deadlock entre transações concorrentes travando as mesmas linhas. O próprio comentário do with-rollback.ts promete 'enables parallel test execution' — promessa que a minoria quebrou para todos.
- O skip silencioso de integração sem trava de CI. 168 arquivos usam describe.skipIf e nenhum workflow assegura DATABASE_URL no CI. No nod os invariantes skipados seriam RLS e trilha LGPD — um CI verde e vazio não é ausência de prova, é prova falsa.
- O `src/types.ts` layer-neutral do jeito que ficou (~350 linhas misturando DrizzleTx, whitelists de coluna, união de roles, blocos de Slack e prosa datada). A ideia é necessária; o arquivo é sintoma de camadas finas demais para o tamanho do time — os próprios comentários admitem caso a caso 'mora AQUI porque o repo precisa e não pode importar domain/'. Com 2-3 pessoas, mantenha estreito e revise quando passar de ~200 linhas.
- db:push, db:introspect e db:generate:safe. Os três resolvem problemas de LEGADO que o nod não tem. O db:push existe por schema parcialmente fora das migrations e adotá-lo abriria exatamente o drift que os ADRs 003 e 004 existem para fechar — trigger e CHECK não sobrevivem a push, e ele já derrubou views (CI quebrado em 2026-05-22) e CHECK constraints (2026-07-25). O db:generate:safe reescreve SQL por REGEX e falha ABERTO quando o formato do drizzle-kit mudar: diz 'nenhum índice detectado' e você comita uma migration que trava a tabela. É copiar a cicatriz antes de ter tido o corte.
- A regra ESLint custom scope-must-filter como garantia primária. É boa engenharia, mas tem falso-negativo silencioso por convenção de nome — o campo `_naming` do registry documenta que entradas em snake_case não casam com nada e `janela_admissao_pedidos` ficou desguardada até 2026-09-02 — cobre 5 tabelas de 61, e só vale dentro de um diretório. Sob RLS com FORCE e role NOBYPASSRLS o banco já recusa; para 2-3 engenheiros, manter regra de AST custom é cinto sobre suspensório. Adie até ver um invariante falhar em silêncio.
- Inngest como fila ou agendador, e PostHog como fonte de feature flag. A referência paga Inngest e ainda assim a durabilidade mora no Postgres; o plano chegou a ditar arquitetura por faixa de preço (concurrency limit 25 porque 'planos abaixo de 25 rejeitam o sync'). Flag remoto de terceiro no caminho de render adiciona latência e ponto de falha externo para resolver rollout parcial que não existe antes de haver tenants — quando precisar, uma tabela sob a RLS do ADR-003 resolve sem serviço novo e ganha isolamento por tenant de construção.
- A camada core/adapters/runner do apps/agents como estrutura. O próprio README avisa para não desenhar as interfaces até existir um segundo consumidor, e a premissa P3 foi mantida contra dois revisores com teste de 6 meses registrado. O nod tem n=1. Traga as duas funções puras (classificação de falha pelo ESTADO DE PROTOCOLO, que é o ADR-009 já escrito e testado; e o guard anti-gaming por allowlist estruturada de paths, que casa com o ADR-013) e o princípio de que quem julga nunca é quem é julgado — não o diretório de três camadas, que continua esqueleto desde 2026-07-31 com 3 de 5 arquivos só com `export {}`.
- A convenção de prefixo numérico por arquivo nos UUIDs de teste. Registro global mantido à mão em comentário, sem verificação, com colisão real já presente (62 repetido em dois arquivos). Ele existe porque o rollback não cobre 100% dos testes — se cobrir, é desnecessário. Use randomUUID.
- O modelo de estado do E2E, e o E2E inteiro na fase 0. Workers 1, fullyParallel false, specs que pegam 'a primeira linha da lista' e pulam se vazia, dependência de ordem documentada no global-setup, e nada rodando em CI. Um spec que pula parece um spec que passou. Traga só o stub de auth por env var e a regra 'um spec por jornada, a lista é o ls'; o ADR-003 já dá o isolamento certo de graça (um tenant por spec) quando chegar a hora.
- O `.gitleaks.toml` órfão — existe na raiz e nenhum workflow o invoca. Um scan de segredo que não roda dá falsa sensação de cobertura, e isso é relevante ao ADR-015. Ou wire no CI, ou não tenha o arquivo.
- O volume documental e o ecossistema de release. TODO.md com 119KB, CHANGELOG.md com 245KB, um AGENTS.md de core com 594 linhas, e quatro workflows chamando reusable workflow de outro repositório privado com orçamento em dólar. A QUALIDADE das entradas é notável e o formato vale copiar; a pilha é hábito de anos de operação. A única lição barata que vale agora: pinar action de terceiro por SHA imutável, não por tag.

---

## Esqueleto atualizado

```
nod/                                  # UM pacote. Um package.json, um node_modules.
├── package.json                      # scripts: dev, check, test:unit, test:integration,
│                                     #   docker:up/down/reset, dev:setup, db:migrate
├── pnpm-lock.yaml
├── .mise.toml                        # node + pnpm pinados (3 linhas) — ADR-014 aplicado a quem desenvolve
├── .env.example                      # ~20 linhas. Cresce só com cicatriz real, nunca antes.
├── tsconfig.json                     # base: strict, noUncheckedIndexedAccess, lib ES2022 (sem DOM)
├── tsconfig.domain.json              # ADR-018: SEM @types/node, SEM lib DOM. A pureza é do DIRETÓRIO.
├── eslint.config.mjs                 # fronteiras por glob de CAMINHO + no-console LIGADO
├── docker-compose.yml                # 2 serviços. Postgres 16 com pg_isready; catcher local.
│                                     #   init cria DOIS roles: dono (migração) e app (NOBYPASSRLS)
│                                     #   e DOIS bancos: nod e nod_test
├── CLAUDE.md                         # fino, só aponta
├── AGENTS.md                         # curto no dia 1; cresce quando um agente errar de verdade
├── docs/adr/                         # os 18 + gatilho de reversão em cada um decidido contra alternativa
│
├── src/
│   ├── domain/                       # PURO — guardado pelo COMPILADOR (tsconfig.domain.json)
│   │   ├── classificacao.ts          #   ADR-002: dado pessoal por ORIGEM, função pura, default fechado
│   │   ├── falha-de-turno.ts         #   ADR-009: estado de protocolo, 4 booleanos (modelo: failure-classification.ts)
│   │   └── decisao.ts
│   │
│   ├── db/
│   │   ├── schema/                   # TypeScript à mão, fonte única. CHECK declarado AQUI e na migration,
│   │   │                             #   com nome IDÊNTICO nos dois lados (ADR-004)
│   │   ├── migrations/               # 100% versionado. Sem push. Convenção `-- ROLLBACK:` desde a 1ª.
│   │   ├── tx.ts                     # ADR-003 — DUAS funções, e é o ponto da decisão:
│   │   │                             #   openTenantTx(db, tenantId) → abre BEGIN + SET LOCAL nod.tenant_id
│   │   │                             #   bindTenant(trx, tenantId)  → só o SET LOCAL num trx existente
│   │   │                             #   (produção usa a 1ª; withRollback + a 2ª nos testes)
│   │   │                             #   nasce aqui o correlation id que todo log carrega
│   │   └── client.ts                 # prepare:false (pooler em modo transação, ADR-001); idle_timeout
│   │
│   ├── repositories/                 # factories aceitam `Db | Tx` na PRIMEIRA linha escrita.
│   │                                 #   tenant OBRIGATÓRIO, sem default. Devolvem null, nunca lançam.
│   ├── services/                     # adaptadores de sistema externo. Sem DB.
│   ├── use-cases/                    # (repos, services, tx, input) → { data, events? }
│   │                                 #   devolve evento, não publica (ADR-005, ADR-004)
│   ├── adapters/
│   │   ├── http/                     # SSE com frames numerados (ADR-016)
│   │   ├── mcp-proxy/                # ADR-013: o ponto de decisão do produto
│   │   └── executor/                 # ADR-012 (SPI três camadas), ADR-014, ADR-015
│   ├── obs/
│   │   └── log.ts                    # wrapper ÚNICO, JSON, tenant_id + correlation id.
│   │                                 #   FORA do domínio (ADR-018: o domínio não observa)
│   └── shared/
│       └── types.ts                  # estreito. Entra só o que DUAS camadas exigem HOJE.
│                                     #   Revisar quando passar de ~200 linhas.
│
├── tests/
│   ├── helpers/
│   │   ├── db.ts                     # pool ÚNICO em cache de módulo, usado por TODOS desde o 1º teste
│   │   ├── with-rollback.ts          # 15 linhas, Symbol privado
│   │   └── expect-rejected.ts        # SAVEPOINT → tenta → ROLLBACK TO SAVEPOINT.
│   │                                 #   Sem isto, o 1º teste do ADR-004 aborta a transação (25P02)
│   ├── unit/
│   ├── integration/                  # skip vira ERRO sob process.env.CI
│   ├── concurrency/                  # 3º modo: DUAS conexões. ADR-010 e ADR-011.
│   │                                 #   NÃO usa rollback — tem limpeza própria
│   └── conformidade/
│       ├── rls.test.ts               # lê pg_class.relrowsecurity/relforcerowsecurity + pg_policies
│       │                             #   e assere rolbypassrls=false no role da suíte
│       └── trilha.test.ts            # toda tabela de trilha tem trigger e CHECK, lido do catálogo
│
└── .github/workflows/ci.yml          # 3 jobs paralelos. Migra o schema e NÃO roda seed.
```

## Primeiros commits

1. Esqueleto e toolchain: package.json, .mise.toml, tsconfig.json + tsconfig.domain.json (sem @types/node, sem lib DOM), eslint.config.mjs com os blocos de fronteira por glob e no-console LIGADO, pre-commit com lint-staged. Nada de lógica — é o ADR-018 literal, e os quatro itens que são impraticáveis de retroagir entram aqui.
2. Ambiente local: docker-compose.yml com Postgres 16 (pg_isready) e catcher, init criando DOIS roles (dono e app NOBYPASSRLS) e DOIS bancos (nod, nod_test); scripts docker:up/down/reset e dev:setup. Este commit vem antes do schema porque o role NOBYPASSRLS precisa existir antes da primeira tabela, senão a RLS nasce não exercitada.
3. SPIKE de meia hora, antes de qualquer schema de negócio: uma tabela descartável com RLS + FORCE, e provar as três coisas que a referência não pode provar por nós — que o SET LOCAL sobrevive dentro do envelope do withRollback; que ele não vaza para a próxima transação do mesmo pool (a referência tem o precedente do padrão em cadastro-formato-canonico.test.ts, mas não sob rollback); e que uma exceção de trigger sob SAVEPOINT devolve a transação utilizável. É o único risco real do plano e custa meia hora agora contra um redesenho depois.
4. src/db/tx.ts nas duas formas (openTenantTx e bindTenant), src/db/client.ts com prepare:false, tests/helpers/db.ts com pool único, with-rollback.ts e expect-rejected.ts. A infraestrutura de teste vem ANTES do primeiro schema de negócio, porque é ela que define a assinatura que todo repositório vai ter.
5. Primeira migration: extensões, role, uma tabela de tenant, RLS restritiva com FORCE, e a convenção `-- ROLLBACK:`. Junto, os dois testes de conformidade lendo o catálogo do Postgres (rls.test.ts e trilha.test.ts) — eles nascem cobrindo uma tabela só, e é isso que garante que a décima não nasça desguardada.
6. CI em três jobs paralelos, com o skip de integração virando ERRO sob process.env.CI. A partir daqui, toda garantia dos ADRs 003 e 004 é verificada a cada PR.
7. src/obs/log.ts: wrapper único, JSON, tenant_id e correlation id nascendo do db/tx.ts. Vem cedo porque a referência prova que depois custa ~610 chamadas.
8. Domínio puro: src/domain/classificacao.ts (ADR-002) e src/domain/falha-de-turno.ts (ADR-009, com a forma do failure-classification.ts da referência — função pura, tetos separados por categoria, default de empate documentado). Testes unitários sem banco, sem mock.
9. Schema de eventos particionado (ADR-005, ADR-006: 24 meses na migração inicial, sem catch-all) e a trilha imutável por trigger com CHECK declarado nos dois lados (ADR-004). O primeiro teste que usa expect-rejected mora aqui.
10. Primeiro repositório e primeiro caso de uso de ponta a ponta, com o teste de isolamento cross-tenant que é a prova do ADR-003: abre com tenant A, tenta ler linha de B, espera vazio, rollback.
11. Fila no Postgres (ADR-010) com os três estados, prazo absoluto e a política de abandono por DUAS condições; travas de execução (ADR-011). Aqui entram os primeiros testes do terceiro modo — duas conexões de verdade, com limpeza própria.
12. Catcher local do proxy MCP (ADR-013) e o executor (ADR-012, ADR-014, ADR-015). Só depois que o loop de desenvolvimento local existe é que faz sentido escrever o que fala com fornecedor.

---

## Riscos

- O risco número um é o spike do commit 3 revelar que SET LOCAL e withRollback não convivem bem. A referência não tem RLS, então ninguém pode provar isso por nós — e é a fundação de ADR-003 e de toda a estratégia de teste. Mitigação: o spike é o terceiro commit, custa meia hora, e a referência dá metade da resposta de graça (packages/db/tests/cadastro-formato-canonico.test.ts trava por teste que a marca é de TRANSAÇÃO e não de sessão, exatamente porque a conexão é reusada pelo pooler). Se falhar, o desenho alternativo é uma conexão dedicada por teste sem pooler, mais lenta mas funcional.
- O ADR-004 vai gerar o primeiro teste incompreensível do projeto. Verifiquei que a referência CONTORNA o problema — em cep.repo.test.ts o `rejects.toThrow()` é sempre o último ato do envelope, nada é verificado depois — e o nod não pode contornar, porque vai querer provar 'o trigger recusou E a linha original continua lá'. Sem o expect-rejected com SAVEPOINT, o sintoma é 'current transaction is aborted' num ponto que não aponta para a causa. Mitigação: o helper entra no commit 4, antes do primeiro trigger.
- Ninguém mediu TEMPO em nenhuma das investigações. Não sabemos quanto custa a suíte de integração da referência nem quanto os workspaces custam em segundos. O ADR-018 conta com suíte unitária 'em segundos' e o ADR-003 obriga transação explícita até para SELECT único — o custo por teste sobe e não há número. Mitigação: medir o tempo do primeiro conjunto de testes de integração do nod e registrar como linha de base, para que a degradação seja visível.
- O gate de conformidade contra o catálogo é o mecanismo de maior retorno, mas é novo — não copiamos um arquivo, estamos adaptando o formato do seedable-coverage.test.ts para ler pg_class e pg_policies. Se ele tiver um falso-negativo, a garantia central do ADR-003 fica sem verificação e ninguém percebe. Mitigação: o primeiro teste que se escreve contra o gate é um teste NEGATIVO — criar uma tabela sem RLS de propósito e confirmar que o gate falha.
- Pacote único não é gratuito: ele deixa a fronteira entre camadas dependendo só de lint, e lint tem eslint-disable e some com --no-verify. O ADR-018 compra a pureza do domínio pelo compilador, que é forte, mas a DIREÇÃO entre camadas fica em glob de string — mover um diretório sem atualizar o eslint.config.mjs desliga a fronteira em silêncio, sem erro nenhum. Mitigação: aceitar conscientemente (é o mesmo risco que a referência corre com 200k linhas) e revisar o eslint.config.mjs sempre que um diretório mudar de lugar.
- O volume de práticas adotadas no dia 1 é grande para 2-3 engenheiros começando do zero — são doze commits antes da primeira funcionalidade de produto. O risco é o rito de esqueleto consumir o orçamento que a implementação precisava, que é exatamente o que aconteceu no apps/agents da referência: 402 linhas de design doc e, em código, duas funções puras não chamadas por ninguém desde julho. Mitigação: os commits 1 a 6 são realmente baratos (configuração e infraestrutura de teste, nenhuma abstração especulativa); se algum deles começar a virar design, é sinal de parar e escrever a primeira funcionalidade antes.
- Nenhuma investigação verificou o histórico do git da referência, então não sabemos se os workspaces foram decisão deliberada ou herança de migração. O packages/shared tem publishConfig e descrição dizendo que serve ao acme-rh, o que sugere que ao menos ESSE pacote existe por razão real. Isso não muda o veredito — as três práticas que o Marlon quer não dependem de workspaces, e isso está verificado — mas é a única hipótese que sustentaria o outro lado e ficou não testada.
- Não sabemos se o Postgres de produção da referência tem RLS habilitada por fora do repositório (o Supabase habilita por padrão em tabelas criadas pela UI dele, e várias migrations foram aplicadas por lá). A ausência no código é certa; a ausência no banco é só provável. Isso não muda a recomendação, mas enfraquece um pouco a leitura de que 'a referência escolheu não usar RLS' — a leitura mais defensável é que a decisão nunca foi tomada explicitamente para isolamento, e sim herdada do legado Directus.
