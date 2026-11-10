# AGENTS.md — como trabalhar neste repositório

Curto no dia 1; cresce quando um agente errar de verdade. As decisões moram em [docs/adr/](docs/adr/); as
práticas herdadas, com evidência, em [docs/praticas-herdadas.md](docs/praticas-herdadas.md).

Para iniciar, atualizar ou separar o Nod diário de bancos descartáveis de feature, siga
[docs/ambiente-local-persistente.md](docs/ambiente-local-persistente.md). O banco diário usa a porta
5434 e o volume `nod_nod_pgdata`; agentes nunca devem executar `docker:reset`, `docker compose down -v`
ou remover esse volume sem um pedido explícito de perda total dos dados.

## Comandos

```bash
npm ci                      # Node 24.19.0 (pinado em .mise.toml)
npm run dev:setup           # sobe o Postgres (127.0.0.1:5434, container nod-postgres), migra nod + nod_test (0001–0010) e roda o seed em nod
npm run dev                 # api 8888 + web 5274 (5173 e 5432 são de OUTROS projetos: nunca use); executor catcher por default
npm run check               # lint → typecheck → fence:domain → fence:migrations → unit → integration → conformidade → concurrency → db:test:limpar
npm run diario:prod         # Nod diário sem modo dev (#218): build da web + só a API, que serve a página em 127.0.0.1:8888 (docs/ambiente-local-persistente.md)
npm run e2e:fumaca          # doze jornadas sobre o servidor completo com catcher (tests/concurrency/e2e-catcher.test.ts), custo zero
npm run e2e:aceite          # scripts/e2e-aceite.sh com o CLI real (sonnet, ou NOD_MODELO); imprime o custo somado — rode UMA vez, custa assinatura
node scripts/carga-tela/rodar.ts medir <rotulo>   # carga da TELA num Chrome headless (vários bots escrevendo, turno pesado) sobre um banco efêmero; uso no cabeçalho do script (ADR-061)
node scripts/alvos-44px/rodar.ts [claro|escuro]   # auditoria de toque do CELULAR (390×844, toque): alvo <44×44 por elementFromPoint a 22 px, atalho de teclado, macOS/"este computador", banco, título em 2 linhas; falha listando seletor e tamanho. Rode ao mexer na interface do celular (ADR-094); uso no cabeçalho do script
npm run sonda               # ADR-019: {estado, versao} sem email; custa um turno de MODELO_SONDA_PADRAO (Sonnet 4.6). sonda:mcp-timeout mede o teto do tools/call
npm run test:integration    # só com DATABASE_URL_TEST (copie .env.example para .env); sem ele pula fora do CI e FALHA sob CI
npm run prompt:referencia   # NOD-163: regrava tests/unit/domain/__prompts__/ (o prompt de sistema inteiro por cenário, estável × volátil, e tamanhos.json) — só quando a mudança no prompt é de propósito
gitleaks dir . --config scripts/ci/gitleaks.toml --redact   # NOD-485 (ADR-161): o repo é público; rode antes de cada push (a CI roda o mesmo no job gitleaks)
npm run paridade            # NOD-391 (ADR-135): regrava docs/paridade.md a partir do registro de ações; sob CI ou com --conferir só confere
npm run db:test:limpar      # apaga os bancos nod_test_<hash> de worktrees que não existem mais (nunca nod nem nod_test); roda no fim do check
npm run db:migrate          # como nod_dono; a aplicação (nod_app, NOBYPASSRLS) nunca migra
npm run db:seed             # identidade (tenants/pessoas) como nod_dono + Vera/Tuca/sala geral como nod_app; idempotente por id determinístico (a 2ª passagem registra seed_sem_mudancas); o CI nunca chama
npm start                   # node src/adapters/http/server.ts → boot.ts (partições, compor, listen, registry, laços); é o mesmo CMD do Dockerfile
```

Prompts de referência (NOD-163): `tests/unit/domain/prompt-referencia.test.ts` (projeto unit, roda no `check`) compara o
prompt de sistema de cada cenário fixo com `__prompts__/<cenario>.txt` e falha com o diff em qualquer mudança de
`src/domain/prompt-sistema.ts`; também falha se a parte estável de um cenário crescer mais de 10% sobre
`__prompts__/tamanhos.json`. Mudou o prompt de propósito: rode `npm run prompt:referencia` e commite o diff de
`__prompts__/` junto. **Regra:** o diff de `__prompts__/` é revisado no PR como código — o revisor lê as linhas que
entraram, saíram ou mudaram de parte (estável × volátil) e o tamanho novo; atualizar a referência sem olhar é o que este
teste existe para impedir.

O pre-commit roda só `lint-staged` (eslint --fix nos .ts). O gate pesado é `npm run check`, antes do push.
O hook é instalado pelo `prepare` do `npm ci`/`npm install`; confira com `ls .git/hooks/pre-commit`
(observado em 2026-09-16: o primeiro commit da fundação saiu SEM o hook porque ninguém tinha rodado
`npm run prepare` — um `git commit` que não imprime a linha do lint-staged é sinal de hook ausente).

**Onde abrir PR** (NOD-485, ADR-161, desde 2026-11-10): o desenvolvimento acontece AQUI, no repo público
`marlonwlv/nod`, que também faz o deploy de produção (`deploy.yml`, depois do `ci` verde num push à `main`). Branch a
partir da `main` deste repo, PR para a `main` dele, merge squash com a CI verde (a branch protection exige os checks).
O `gamefik/nod` está congelado: não abra PR lá. Regras de repo público: nenhum segredo, IP, id de tenant, e-mail ou nome
de pessoa/cliente/bot interno em código, comentário, teste, commit ou PR; a config real de produção mora no secret
`NOD_CONFIG_PRIVADA` do environment `producao` (o `infra/gcp/config.env` daqui traz só flags e identificadores de
exemplo); commits com `-s` (DCO, CONTRIBUTING.md). Uma varredura agendada fora deste repo confere a `main` e os PRs
abertos contra a lista de nomes internos e avisa o Marlon.

**PR rascunho não roda CI** (2026-10-28; a fila do runner próprio tinha 63% de runs cancelados por push novo nas
frentes). Enquanto o PR é rascunho, confira local com `npm run check` (ou os testes do que mudou) e faça quantos
pushes quiser. Quando quiser a CI, uma vez, com o trabalho pronto: `gh pr ready <n>` e espere com
`gh pr checks <n> --watch`. Num rascunho esse comando volta na hora sem checks: não é falha nem CI verde. Falhou e
precisa mexer de novo: `gh pr ready <n> --undo`, corrija e repita. PR só de documentação também roda a CI (NOD-485: a `main` exige os checks).


**Teste instável na CI** (2026-11-04; a CI foi para máquinas rápidas e quatro testes de tempo caíram no mesmo dia). Na
CI cada teste que falha roda uma segunda vez antes de reprovar o job (`retry` do vitest, só com `CI=1`); o resumo do
vitest marca o que passou na segunda. Isso evita o rerun manual e a main vermelha, não dispensa a correção: um teste
que precisou do retry duas vezes na mesma semana vira issue e é corrigido ou tirado do bloqueio até lá. Localmente o
retry é 0: quem está mexendo no teste vê a instabilidade de perto. Um teste não pode depender de dois eventos caírem
em milissegundos ou segundos diferentes (mtime, `criado_em` em ms, `Date.now()` entre duas gravações).

## Aviso: nvm/asdf ganham do mise

Se o seu shell carrega nvm ou asdf, eles GANHAM do mise e você roda a suíte no Node errado, e o erro
MENTE sobre onde está o bug. A origem deste aviso é uma medição do projeto de referência, não nossa: no monorepo dele,
19 falhas com o Node 18 do nvm contra 892 verdes com `mise exec` — e as 19 apontavam arquivos de
feature que estavam corretos (docs/praticas-herdadas.md §8). Se algo falhar sem sentido, confira
`node --version` = 24.19.0 ou envelope com `mise exec -- npm run check`.

## Regras que o código trava (não são sugestão)

- **Toda transação tem tenant E pessoa.** `abrirTxEscopada(db, {tenantId, pessoaId})` em produção;
  `withRollback(escopo, fn)` + `vincularEscopo` nos testes. Vazio lança `escopo_vazio`. Ler sem escopo
  falha fechado no Postgres ("unrecognized configuration parameter"), nunca devolve zero linhas.
  `abrirTxEscopada` só aceita o POOL: passar uma transação aberta não compila e lança
  `estado_invalido` (o SET LOCAL num SAVEPOINT sobrevive ao RELEASE — medido em 2026-09-16).
- **Chave de máquina carrega o próprio escopo** (ADR-031): validar busca o hash DENTRO da tx escopada
  pelo escopo alegado (`autorizarChaveMaquina`). Busca pelo hash sem escopo nunca acha a linha (falha
  como nod_app; volta vazia em silêncio como nod_dono). A chave crua não vai para banco, log nem listagem.
- **`tenants`/`pessoas` são só leitura para nod_app.** Quem escreve identidade é o seed (nod_dono) e, na primeira
  entrada de uma conta de domínio admitido, a função do dono `nod_admitir_pessoa` (0052, `NOD_ADMISSAO_DOMINIOS`).
  Não dê `GRANT INSERT` em `pessoas` nem privilégio em `dominios_admitidos` a nod_app: `tests/conformidade/admissao-por-dominio.test.ts` acusa.
  Teste que precisa de pessoas usa `withRollbackDono` de `tests/helpers/db-dono.ts` — e esse helper
  nunca lê tabela escopada.
- **Toda tabela nova passa por `nod_escopar_tabela(tbl, perna_extra)`** na migração, senão
  `tests/conformidade/rls.test.ts` acusa (lê pg_catalog; exceções têm motivo escrito em `gate-rls.ts`).
  Desde a 0004 a função cria QUATRO policies PERMISSIVE por comando — `nod_pessoa_select` (dono OU
  'equipe' OU perna extra), `nod_pessoa_insert`/`update`/`delete` (só a dona) — e o gate confere nome E
  comando (`polcmd`). A perna extra e 'equipe' só ABREM LEITURA: UPDATE/DELETE por quem não é a dona
  afetam ZERO linhas (medido em 2026-09-16: com a policy FOR ALL da 0001 a decisora apagava a decisão
  da dona). Quem precisa que a perna também ESCREVA cria uma policy PERMISSIVE a mais, só para o comando
  necessário, e a registra por nome em `POLICIES_EXTRAS` do gate — como `nod_decisora` (0003, FOR UPDATE
  em decisoes/itens_aprovacao).
  Uma policy FOR UPDATE concede UPDATE de QUALQUER coluna (medido em 2026-09-16 com os triggers da 0003
  desligados: a decisora reescreveu frase/prazo e pôs `visibility = 'equipe'` na decisão da dona); por isso a policy vem
  SEMPRE com um trigger BEFORE UPDATE que fecha a lista de colunas que quem não é a dona pode mudar
  (`colunasLivresDaDecisora` em `src/db/schema/decisoes.ts`), e o motivo em `POLICIES_EXTRAS` nomeia o trigger.
- **Toda rota de pessoa que muda algo declara `Rota.acao`** (NOD-391, ADR-135). O id sai do registro em
  `src/domain/acoes/` (o tipo `IdAcao` não aceita id fora dele). A catraca `tests/conformidade/paridade.test.ts` barra
  rota sem id (A), ação sem rota (B), vivas abaixo de `docs/paridade.piso.json` (C) e `docs/paridade.md` velho (D):
  rota nova → registre a ação e rode `npm run paridade`; ligou uma ação no chat → suba o piso no mesmo PR.
- **Migração nova só adiciona** (NOD-186). `npm run fence:migrations` (`scripts/migracao-aditiva.ts`, no `check`
  e no CI) lê o trecho antes de `-- ROLLBACK:`, sem comentários nem literais (`'…'`, `E'…'`, `"…"`; o corpo
  de `$$…$$` é verificado como código), e barra `DROP TABLE`,
  `DROP [COLUMN]`, `RENAME` (tabela, coluna, valor de enum…), `ALTER [COLUMN] … TYPE`, `SET NOT NULL` e
  (NOD-191) `DROP [MATERIALIZED] VIEW`, `DROP TYPE`, `DROP DOMAIN`, `DROP FUNCTION/PROCEDURE/ROUTINE`,
  `TRUNCATE` e, em `ALTER TYPE`, `ALTER ATTRIBUTE … [SET DATA] TYPE` e `DROP ATTRIBUTE`, com `arquivo:linha`.
  Passam: `ALTER TYPE … ADD VALUE/ADD ATTRIBUTE`, `CREATE OR REPLACE VIEW/FUNCTION`, `DROP INDEX/TRIGGER/POLICY`,
  `DROP CONSTRAINT/DEFAULT/NOT NULL` e `TRUNCATE` como privilégio (`GRANT/REVOKE`) ou evento de trigger.
  Motivo: o rollback de código (NOD-173) volta a imagem e deixa o banco novo; o código
  antigo quebra se a coluna, a view, a função ou o tipo sumiu ou mudou, e `TRUNCATE` apaga dado que o
  rollback não devolve. Vale só para prefixo > `BASE_ADITIVA` (0058); as antigas não
  são reescritas. Exceção caso a caso: `-- destrutiva-ok: <motivo>` na linha anterior ao comando (ou à
  cláusula dele); a marca vale do código logo abaixo até o `;` seguinte, nunca para a instrução
  seguinte nem para o resto do arquivo; motivo vazio falha. Exemplo legítimo: `DROP FUNCTION f(int)`
  antes de recriar `f(bigint)` com outra assinatura leva a marca com o motivo (o gate não analisa se o
  código antigo usa o objeto; barra sempre e a exceção decide caso a caso).
  **E traz um rollback que desfaz de verdade** (NOD-195). O mesmo gate exige, nas > 0058, o marcador
  `-- ROLLBACK:` sozinho no início da linha (texto depois dele na mesma linha é comentário) e pelo menos um
  comando no bloco abaixo; sem marcador ou com bloco vazio sai com 1 e `arquivo:linha`. Formato do bloco:
  cada linha de SQL comentada com `-- ` (o runner não aplica nada depois do marcador) e `-- -- texto` para
  comentário de verdade, que não vira SQL (`trechoDeRollback` em `src/db/migrar.ts`). O rollback é
  executado: `tests/conformidade/rollback-ida-e-volta.test.ts` cria um banco descartável como `nod_dono`,
  aplica até a 0058 e, para cada nova, tira uma foto do schema pelo `pg_catalog` (relações com RLS,
  persistência e opções, colunas, constraints, índices, tipos/enums, funções, views, triggers, policies,
  regras, grants; ACL nula conta como a padrão do dono, que é o que o `REVOKE` deixa), aplica a
  migração, aplica o rollback, exige a mesma foto e reaplica. Rollback que esquece algo falha dizendo o
  objeto que sobrou ou faltou. `ALTER TYPE … ADD VALUE` não tem volta direta: o rollback renomeia o tipo,
  recria com os valores de antes (mesmo nome e ordem), converte as colunas com `USING col::text::tipo` e
  apaga o renomeado; índice parcial ou default que cita o tipo sai antes e volta igual (modelo na 0060).
  Linha que ainda usa o valor novo faz o cast falhar e a transação voltar inteira — por isso o bloco roda
  numa transação só (`psql -1 -v ON_ERROR_STOP=1`); colado solto, cada instrução se confirma e o erro deixa
  o schema pela metade. O teste de ida e volta prova com uma linha `lote_bots` que o rollback da 0060 falha
  sem apagar nada.
- **Domínio é puro** (`src/domain/**`): sem `node:*`, sem banco, `agora: number` por parâmetro.
  O compilador guarda a pureza (`tsconfig.domain.json`); o eslint guarda a direção entre camadas.
- **`src/services` é SEM BANCO.** Laço de fundo que abre transação mora em `src/adapters/fundo/` e
  passa por `paraCadaPessoa`.
- **Sem `console.*`** fora de `src/obs/log.ts`. Sem `DELETE FROM`/`TRUNCATE` em teste fora de
  `tests/concurrency/`. Sem `as unknown as`.
- **Erro nunca vaza `message`.** `ErroDeDominio(codigo)`; a mensagem sai de uma tabela fixa em
  `src/adapters/http/erros.ts`; o resto vira 500 + `correlation_id`.
- **Comentário registra medição e data**, não intenção: `definido em AAAA-MM-DD: <critério>` para
  escolhas, `medido em AAAA-MM-DD: <número> (<como>)` SÓ para o que foi cronometrado/observado.
- **Id de fora nunca chega cru ao Postgres**: grupo `id`/`mid` de path fora de uuid → 404 no roteador;
  22P02 (id malformado no corpo) → 400 `entrada_invalida` em `erros.ts`. Nunca 500.
- **Quem assenta um turno lê a linha com trava** (`turnosRepo.buscarTravado`, FOR UPDATE): Parar e a
  entrega correm em transações paralelas e a leitura sem trava assentava 'sem_progresso' no lugar de
  'parado_pela_pessoa' (medido em 2026-09-16 no e2e).
- **A web só faz `import type` de `src/`** (eslint) e nunca executa nada: pede por REST, recebe frames
  SSE que dizem O QUE mudou (kind, conversaId, turnoId) e reidrata por REST (`web/estado/reducer.ts`).
  O composer nunca é regravado dentro da mesma conversa (`web/lib/regioes.ts`).
- **Todo botão novo tem ação no registro e caminho no chat** (NOD-392): o registro a catraca acima trava; o caminho no
  chat (que ela aceita como `falta`/`nunca`) o fluxo garante: o spec traz a seção "No chat", o protótipo mostra o
  caminho pela conversa e o plano traz a seção "Ações"; o modelo de cada uma está em
  [`.claude/skills/acao-no-chat/SKILL.md`](.claude/skills/acao-no-chat/SKILL.md) (`/acao-no-chat`).

## Quatro modos de teste

`tests/unit` (sem banco) · `tests/integration` (withRollback, paralelo) · `tests/conformidade`
(lê o catálogo do Postgres; o primeiro teste do gate é NEGATIVO) · `tests/concurrency` (duas
conexões de verdade, serial, limpeza própria por id). Testes nunca dependem do seed: criam as próprias
linhas com `randomUUID` dentro do envelope; só `tests/helpers/ids.ts` (identidade) é fixo.

**Fuzz das ações e bot de QA** (NOD-398, ADR-135). `tests/concurrency/fuzz-acoes.test.ts` chama toda ação do registro
contra o servidor de verdade: `FUZZ_N` entradas por ação (20 no PR, 200 no `fuzz-noturno.yml`) e `FUZZ_SEMENTE` para
reproduzir (no PR ela sai do `GITHUB_SHA`; a falha imprime a linha de comando). `tests/concurrency/qa-pelas-acoes.test.ts`
e `tela-capturar.test.ts` precisam da web montada (`npx vite build`) e de um Chromium (`NOD_CHROME`); sem eles pulam,
menos com `NOD_QA_EXIGE_CHROME=1` (só o job navegador da CI). A ação `tela.capturar` fica atrás de `NOD_CAPTURA_TELA=1`,
desligada em produção (503 `indisponivel`).

**Teste sob carga** (NOD-194, 2026-10-07). O Mac roda a suíte de vários bots ao mesmo tempo (load 600–950),
e o relógio de parede mede a fila, não o código. Guarda de desempenho (regex O(n²), backtracking) não usa
`performance.now() < N`: usa `razaoDeCrescimento` de `tests/helpers/crescimento.ts` (tempo de CPU, entrada 4x
maior, razão < 8, cada medida repetida até ≥ 5 ms de CPU para o caso rápido não cair no ruído) e prova no PR que ela falha com o teto revertido. O `it` da guarda leva o `PRAZO_GUARDA` (30 s) do mesmo helper, cobrado por
`tests/unit/helpers/crescimento-prazo.test.ts`. Espera de rede afirma contra o próprio
prazo (`< LONGPOLL_MS / 2`, `< 2 * PRAZO_...`), nunca contra um número mágico. Teste do `unit` que sobe processo
de verdade, faz `import()` ou é CPU pesada leva prazo explícito por teste ou por arquivo (`vi.setConfig`), com o
`medido em …` ao lado; o padrão de 5 s do projeto `unit` não muda. Quando há `spawnSync` com `timeout`, o
prazo do teste cobre a soma deles, senão o vitest corta antes do processo. Prazo INTERNO do código (sonda de
1 s do whisper, 12 s da capacidade do gh, 5 s do `gh auth status`) também estoura com carga: o teste que não mede
esse prazo injeta o que o código já aceita (`fetchImpl`, `criarBackendGh({prazoMs})`); se o prazo é fixo no código,
um `vi.mock` do arquivo de teste troca SÓ o prazo (`executarPorRest` em `github-gh`, `execFile` em `github-nativo`) e
mantém o teste que mede o prazo com o valor explícito; ou deixa o falso mais barato. O código não muda.

**Teste sob carga: fakes e workers** (NOD-198, 2026-10-08). O Mac roda a suíte de vários bots ao mesmo tempo
(load 200–970) e o relógio de parede mede a fila, não o código. **Fake termina por evento, não por relógio**: a
ferramenta "em curso" de um CLI falso (`tests/fixtures/*-falso.mjs`) termina com a próxima mensagem do stdin
(olhando a fila ANTES de esperar), com o corte ou com o fim do stdin; quando a ordem depende do teste, o fake espera
um portão que o teste abre (`TESTE_NOD_PORTAO` no `codex-falso`) depois de provar que o driver já tratou o que foi
mandado (ping/pong no mesmo WebSocket), nunca `setTimeout(r, 50)` contra 300 ms do fake. Sem relógio de reserva: se
ninguém manda o evento, o fake espera e o prazo do teste acusa. Todo `dormir`/`setTimeout` que sobra numa fixture
tem comentário dizendo o que imita e por que não decide ordem (o revisor confere com `rg "dormir|setTimeout"
tests/fixtures/*-falso.mjs`). Os testes `tests/integration/executor/*-falso` que sobem o CLI falso de verdade usam
`PRAZO_TESTE_FALSO_MS` e `prazoSondaDoTeste()` de `tests/helpers/prazo-falso.ts` (medida lá), não um número local;
o `testTimeout` dos projetos não muda. O `vitest.config.ts` limita `maxWorkers` a **8**, sem passar do padrão
núcleos − 1 (medido em 2026-10-08, nota no arquivo; +18% sem carga; um 8 fixo subia o paralelismo no CI de poucos
núcleos): no vitest 3.2.7 o limite só existe na raiz, então vale para os quatro projetos; com núcleos − 1 workers o
processo principal do `test:unit` sob carga não respondia ao RPC a tempo e a suíte saía com exit 1 por
`Timeout calling "onTaskUpdate"`, sem teste falho.

## Composição (L9)

`src/adapters/http/compor.ts` é o único lugar que liga as lanes: `comporApp({db, env})` monta o
`Services` concreto, `UseCasesNod`, a ponte in-process, a fábrica `dentro` (abre `abrirTxEscopada` e
monta `Deps`) e as rotas de todas as lanes; `boot.ts` sobe partições → listen → registry (claude-cli
só quando `NOD_EXECUTOR=claude-cli`; a sonda custa um turno) → inventário por pessoa → orquestrador →
scheduler 30 s → varredor de lease 15 s → varredor de expiração 30 s → despachante do outbox.
O executor da máquina é VIVO: `NOD_EXECUTOR` só dá o valor inicial e o interruptor (`GET`/`POST executor`,
botão na Frota) troca catcher ⇄ claude-cli em tempo de execução — a troca liga o driver em sombra na hora
(`registrarDriver`, sonda paga só quando a pessoa pede) e só acontece se a sonda disser 'pronto'. Quem
precisa do executor lê `app.executor`/getters, nunca copia o valor (a cópia congela a troca). A escolha
não sobrevive ao reinício (NOD_HOME guarda só `machine-id`, EMENDA 11).
`tests/helpers/servidor-completo.ts` sobe o mesmo app em porta 0 sobre `nod_test` (commita: por isso o
e2e mora em `tests/concurrency` e limpa por id). Serviço chamado fora de uma tx escopada lança
`escopo_vazio` — o escopo dos `Services` vem do `AsyncLocalStorage` que `abrirTxEscopada` preenche.

**Banco de teste por worktree** (2026-10-05). Fora do CI, o `vitest.config.ts` troca o banco de
`DATABASE_URL_TEST` por `nod_test_<hash do caminho da worktree>`, e o globalSetup dos projetos com banco
o cria e migra sob demanda como `nod_dono` (que precisa de `CREATEDB`; num Postgres criado antes desta
data, rode uma vez `docker exec nod-postgres psql -U postgres -c 'ALTER ROLE nod_dono CREATEDB'`). Assim
vários bots rodam `npm run check` ao mesmo tempo sem um contaminar o tenant padrão do outro. O CI fica no
`nod_test` do próprio job; `NOD_BANCO_TESTE_COMPARTILHADO=1` volta ao banco da URL. Onde este arquivo diz
`nod_test` sobre a suíte local, leia o banco da worktree.

## Desvios registrados

- **O e2e commita** (laços reais, sessão, SSE) e mora em `tests/concurrency/e2e-catcher.test.ts`, não em
  `tests/integration` como o plano nomeava; a `trilha` é imutável e as linhas do e2e (de uma pessoa
  aleatória por execução) ficam em `nod_test`.
- **`/metrics`** responde na raiz (server) e em `/api/metrics` (rota da L8) — EMENDA-L9 §3.
- **Cron com intervalos** (ADR-033): minuto/hora aceitam fixos, listas, `*` e passos como `*/5`.
  UTC também é persistível (0010); a janela continua canônica e deduplicada.

- **Docker compose com um serviço só** (desvio do §5 das práticas herdadas, EMENDA 25): o catcher do nod não é um
  serviço como o Mailpit — é um driver in-process do executor (`NOD_EXECUTOR=catcher`), porque o que se
  captura é o que o proxy decidiu e o que o CLI teria chamado, e isso mora no processo do servidor.
- **`src/contracts/` existe além de `src/shared/types.ts`** (EMENDA 26): contém SÓ tipos e `as const`,
  sem lógica; a web importa dali só com `import type`. Gatilho de revisão: um arquivo passando de
  200 linhas.
- **Login por `NOD_LOGIN`, obrigatório** (ADR-030; o épico E1 dizia "o stub some" — revisto em
  2026-09-16). `google` = OAuth Google para e-mails do cadastro (o seed lê `NOD_SEED_EMAIL`; `NOD_GOOGLE_DOMINIO`
  restringe a um domínio Workspace — emenda 2026-10-02) e para contas Workspace dos domínios em
  `NOD_ADMISSAO_DOMINIOS`, que viram pessoa na primeira entrada (emenda 2026-10-05); pode escutar fora de 127.0.0.1 e
  RECUSA segredo de sessão curto ou o de exemplo; `stub` = login de desenvolvimento que lista as pessoas
  do cadastro, só em 127.0.0.1. Sem `NOD_LOGIN` o servidor não sobe. Os testes nunca usam nenhum dos
  dois: cunham o cookie com `cunharCookie` (`servidorDeTeste.entrar`, `servidorCompleto.sessaoDe`).
- **Minha conta atrás de flag** (ADR-126, NOD-346): `NOD_MINHA_CONTA=1` (exige `NOD_CONTAS`) liga `/api/conta/eu/*`, o
  laço da exportação e a seção em Seu espaço (o modo da sessão diz `contas.minhaConta`); `NOD_PURGA_CONTA=1` (exige a
  anterior) liga a purga 30 dias depois da exclusão. Em produção a purga fica desligada até a revisão LGPD: a exclusão
  fica programada e a tela diz isso.
- **Onboarding por texto atrás de flag** (ADR-157, ADA-242): `NOD_ONBOARDING_TEXTO=1` (exige `NOD_CONTAS`) liga
  `POST /api/conta/codigo` (conta sem senha, identidade `email`), o Google no app (`/api/conta/google {app,porta,estado}`
  → loopback → `POST /api/conta/google/trocar` com a prova) e a conversa por texto no lugar da ligação. O modo da sessão
  diz `contas.onboardingTexto`. Desligada, a rota de código responde 404 e tudo segue como antes.
- **PRs do GitHub no quadro atrás de env** (NOD-421): `NOD_QUADRO_GITHUB_REPOS="dono/repo,…"` (até 5) liga o laço
  `src/adapters/fundo/prs-do-quadro.ts`. A cada 30 s ele lê os PRs de cada repo, com `NOD_QUADRO_GITHUB_TOKEN` por uma
  chamada GraphQL (produção: a imagem não tem `gh`; o token vem do segredo `nod-github-quadro-token`; a base é
  `NOD_QUADRO_GITHUB_API`, padrão `https://api.github.com`, só https, nunca a `NOD_GITHUB_API` do conector) ou, sem ele, pelo
  `gh pr list` logado na máquina (desenvolvimento; no modo compartilhado sem token o `gh` nunca roda e o quadro mostra
  "não conectado"). **Trava entre tenants (ADR-145):** só os tenants de
  `NOD_QUADRO_GITHUB_TENANTS` sincronizam, em qualquer jeito (token, `gh` com `GH_TOKEN`, `gh` local) e modo; vazia =
  nenhum, o laço nem sobe e o boot loga `prs_do_quadro_sem_tenants`. A ADR-145 é proposta: em produção a lista fica vazia e,
  sem o segredo, o `deploy.sh` a esvazia; ligar exige secret + tenant na lista + 🧭. No dev, ponha o `TENANT_PADRAO` do seed (`.env.example`).
  PR de fork (`isCrossRepository`) não casa. Sem acesso, o quadro ganha uma linha no topo
  ("GitHub não conectado no servidor: os PRs não sincronizam" / "GitHub · sem acesso a dono/repo"), gravada só quando
  muda, e o código vai para o log uma vez por mudança. Liga
  cada PR à tarefa cujo item do Linear aparece no branch, ou cujo `pr_url` é o do PR. CI, conflito e merge viram linhas de
  sistema (`quadro_tarefa_linhas`, 0142); o merge do último PR leva a tarefa para Feito por um lote comum, se a coluna anda.
  Sem a env, nada sobe. **Para integrar com a NOD-416:** o casamento passa a aceitar também o id da tarefa
  (`casaComTarefa`, campo `ids`), e o histórico da tarefa passa a ler `quadro_tarefa_linhas` (ou copia dela, com autor
  GitHub). Os textos já saem prontos (`textoDaLinha`).

## Cloud Agents e gstack

O `install` em `.cursor/environment.json` é `scripts/cloud/install.sh` (Node 24.19.0 pelo mise `v2026.10.11` em `/usr/local/bin/mise`, Docker sem systemd, `npm ci`, pull do Postgres 16) e em seguida chama `scripts/cloud/install-gstack.sh`. O `start` é `scripts/cloud/start.sh`: dockerd se faltar, `docker compose up` em 127.0.0.1:5434, copia `.env.example` para `.env` só quando o arquivo não existe, migra `nod` e `nod_test`, semeia, e abre `npm run dev` (API :8888, web :5274, `NOD_LOGIN=stub` só em loopback) mais o estático :8000. Nesta VM o `node` do PATH pode ser o 22 de `/exec-daemon`; os scripts chamam `mise exec` para o pin do `.mise.toml`. O volume do compose leva o nome do diretório do checkout (`workspace_nod_pgdata` quando a pasta é `/workspace`); a regra de não apagar o volume diário vale para ele.

O `install-gstack.sh` instala bun 1.3.10 se faltar (em `~/.bun/bin`, com symlink em `/usr/local/bin` quando o sudo sem senha existir), clona https://github.com/garrytan/gstack.git em `~/.claude/skills/gstack` no commit `GSTACK_REF` (padrão `c43c850cae779bcd134b71a28eeec00628ba0792`), roda `./setup --host claude --no-prefix --no-team --no-plan-tune-hooks --quiet`, cria symlinks em `~/.cursor/skills/` sem sobrescrever o que já existir, desliga `telemetry` / `update_check` / `auto_upgrade` / `proactive`, liga o modo spawned (marcador `~/.gstack/spawned`; o preâmbulo imprime `SPAWNED_SESSION: true`) e tenta o Chromium do Playwright sem derrubar o Build.

Neste ambiente o gstack roda spawned, não interativo: se uma skill oferecer A/B, escolha a opção marcada `(recommended)` e siga. Não use AskUserQuestion.

Para trocar a versão: `GSTACK_REF=<sha-ou-tag> bash scripts/cloud/install-gstack.sh`. O padrão vive na variável `GSTACK_REF` do próprio script.

## Executor e custo

Dev local não exige CLI nem chave: `NOD_EXECUTOR=catcher` é o padrão. Qualquer `claude -p` real
usa o modelo do agente (no Automático, o Recomendado: Opus desde 2026-10-10; `NOD_MODELO` fixa um para os bots novos), `--strict-mcp-config --tools ""` e ambiente limpo
(denylist `^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PID|CLAUDE_EFFORT|ANTHROPIC_.*)$`) — sem isso o custo
de um turno trivial sobe 8x (mapa da sonda de 2026-09-16) e pode cair na fatura errada.

Definido em 2026-09-17: as sondas usam `NOD_MODELO_SONDA` (default `MODELO_SONDA_PADRAO`, `claude-sonnet-4-6` desde a NOD-164, quando saíram do Haiku 4.5), separado do modelo dos agentes. `e2e:aceite` (antes `e2e:haiku`) usa `NOD_MODELO`, padrão `sonnet`. O modelo da ligação é do servidor: `NOD_MODELO_LIGACAO_CLAUDE`/`_CODEX` (ADR-072, emenda de 2026-10-05).

Definido em 2026-09-18 (ADR-040): o turno **não** passa `--max-turns` — o teto de 12 passos cortava
tarefa de código no meio. `--max-turns` fica em `FLAG_FLOORS` porque `sonda.ts` ainda a usa com valor 1.
`--autocompact` é condicional como `--restricted`: fora de `FLAGS_DO_TURNO`, liberada pelo `--help` da
versão instalada.

Revisto em 2026-10-01 (ADR-067, sessão viva): **nenhum relógio de trabalho**. O driver do Claude abre o CLI
com a entrada em `stream-json` e só fecha o stdin quando o modelo respondeu, nada roda em segundo plano
(`system/task_*`) e o servidor não tem mensagem nova da pessoa; cada volta intermediária vira fala na hora
(`falas` na renovação, frame `turno.fala`). Saíram o vigia de atividade, a validade de 1 h do plano e do
token de turno e o `prazoEm` nas pastas e no computador; o Bash do CLI roda sem teto (`BASH_*_TIMEOUT_MS`).
O turno acaba quando o bot termina, no Parar ou com o lease vencido (a máquina sumiu). **Um processo
preso fica "trabalhando" até alguém apertar Parar** — a lacuna está na ADR-067.

Revisto em 2026-10-05 (NOD-73, emenda à ADR-067): **vigia que avisa, não corta**. `src/domain/vigia-turno.ts`
avisa com 10 min sem novidade (sobe em 10, 20, 40… min) e com a mesma chamada 5, 10 e 20 vezes (LRU de 256
chaves); o laço o consulta a cada 60 s (`aoVigia`). Nenhum caminho do vigia chama `interromper()`. O trecho
`{ vigia }` da renovação leva só nome e números — argumento de ferramenta nunca sai do Mac — e a validação do
servidor é estrita. O servidor publica `turno.vigia` e registra `turno_sem_novidade` / `turno_repeticao`.

## Desktop e servidor compartilhado (2026-09-17)

Produção na GCP (VM + Cloud SQL, deploy pelo workflow `deploy`): [docs/deploy-gcp.md](docs/deploy-gcp.md).
`NOD_MODO=compartilhado` desliga registry e orquestrador locais; os Macs usam `/api/maquina/…`
com chave escopada. O id da chave identifica o computador; o corpo não escolhe o escopo.
`npm run desktop:build` compila Electron, preload e proxy; a cerca do bundle recusa imports de
banco/repositórios/casos de uso/HTTP/fundo. `npm run desktop:mac` exige assinatura/notarização.
`npm run release:mac` publica a pré-release local sem assinatura (`desktop-v<versão>`); o merge que sobe a versão abre
a issue "Release do app do Mac pendente" ([docs/processo-de-release.md](docs/processo-de-release.md)).
O proxy usa o runtime do app com ELECTRON_RUN_AS_NODE somente em seu mcp.json.
Não rode sondas reais para validar empacotamento: `scripts/desktop/smoke-proxy.mjs` testa JSON-RPC
sem Claude. Instruções e limites: [docs/release-desktop.md](docs/release-desktop.md).

Definido em 2026-09-24 (aviso no Mac): a janela web carrega `preload-web.cjs`, que expõe SÓ
`window.nodDesktop` (avisar, contador, preferências, tema — ADR-070; microfone e emLigacao — ADR-071); a tela de
conexão carrega `preload.cjs` (`window.nod`, com `conectar`). Nunca dê o segundo à página remota. A página
continua sem permissão nenhuma (`proteger`), com UMA exceção desde 2026-10-04 (modo ligação): `media` só de áudio,
só na origem do servidor e só no frame de topo (`desktop/permissoes-midia.ts`). O aviso sai do processo
principal, que confere remetente e argumentos (`desktop/avisos-mac.ts`). A voz do bot toca no AudioContext do
renderer (web/lib/ligacao.ts), nunca pelo processo principal: é a referência do AEC do Chromium.
`electron scripts/desktop/smoke-window.mjs` (depois de `desktop:build`) confere as duas pontes sem empacotar.

Definido em 2026-10-28 (NOD-136, deep links `nod://`): o esquema é registrado só pelo Info.plist
(`electron-builder.yml`, `mac.protocols`). Navegação apenas, por isso não contraria a ADR-069 (que recusou `nod://`
para o login: qualquer app pode registrar o mesmo esquema). O link vem de fora: `desktop/deep-link.ts` o lê de forma
estrita (só conversa/<uuid>, sua-vez e computador-do-bot) e a URL nunca vai à página, a `loadURL` nem ao log (só o
motivo). Desvio da spec, que pedia push do alvo: a ponte avisa sem dado (`aoDeepLink`) e a página PUXA o alvo
(`deepLinkPendente`, remetente conferido) quando tem sessão, frota e salas, porque o processo principal não sabe
quando a página logou. Ordem de release: a web sobe antes do app que a usa (o app novo com a web antiga só foca).

Definido em 2026-10-24 (NOD-93, ADR-127): a VM local do Mac só existe com `NOD_VM_LOCAL=1` (no app e na variável de
repositório do `desktop-release`). O disco vem de `NOD_VM_DISCO_URL` (só `https:`; padrão o release do repo) e é
conferido pelo sha256 embutido no app (`<Resources>/vm-local/disco.sha256`, gravado no release por
`scripts/vm-local/digest-do-disco.ts`), nunca por um `.sha256` baixado da mesma origem.

Definido em 2026-10-09 (ADR-093): o app acha, instala e entra nas IAs sozinho. O PATH vem em camadas
(`caminho.ts`: processo, instaladores, todas as versões do nvm, `$SHELL -l` em segundo plano) e nunca leva nada do
nod nem `ELECTRON_RUN_AS_NODE`. Instalar = o npm que o app leva (`extraResources`) rodando no Electron como node, com
configuração só do nod, em `<userData>/ferramentas/<ia>/v-…` trocado atomicamente para `atual`; o binário do nod
(o nativo, no Codex) só é usado quando é igual ou mais novo que o de fora (`desktop/ferramentas.ts`).
Login = `codex login --device-auth` / `claude auth login --claudeai` por pipe (`desktop/login-ia.ts`): só links da lista
`LINKS_OFICIAIS` (host e caminho medidos), e o único texto da página que chega a um processo é o código colado, pelo
stdin. Para medir a saída de um CLI novo, rode-o com `HOME`, `CODEX_HOME`/`CLAUDE_CONFIG_DIR` temporários e um `open`
falso no PATH, só até o link aparecer — nunca complete login nem rode logout com o HOME real. As fixtures ficam em
`tests/fixtures/login-ia/` com os códigos trocados por X.

## Harnesses e inteligência por agente (ADR-036, 2026-09-18)

`harness` identifica o driver; `executor` continua indicando `local`/`catcher` nos eventos existentes.
Novos agentes usam `harness=auto, modelo=auto`; perfis anteriores preservam seus modelos. A migração
0013 adiciona a preferência a agentes e turnos. Todo novo caminho de enfileiramento deve copiar
**harness e modelo** do agente (ou do turno original em retomadas). O plano resolve a escolha uma vez;
quem executa usa `plano.harness`, nunca o padrão global copiado no boot.

Revisto em 2026-10-10 (0068, emenda da ADR-036): a inteligência do bot é `inteligencia_modo` (auto | fixa), `ordem_ias`
(nula = a da pessoa, `preferencias.ordem_ias`) e `escolhas_ia` (modelo e raciocínio por IA); `harness`/`modelo`/`esforco`
são DERIVADOS (`derivadosDa` em `src/domain/inteligencia.ts`) e o repositório grava os quatro juntos — nunca escreva
`harness` ou `modelo` de agente direto (`atualizarPerfil` só aceita `inteligencia`). O Automático usa a primeira IA pronta
da ordem fora do limite (`preferencias.ias_no_limite`, gravado pelo turno que volta no limite); o Recomendado é Opus /
GPT-5.6 Sol, raciocínio médio. Níveis de raciocínio por modelo: `HARNESSES[].modelos[].raciocinios` (o do Codex vem do
`model/list` do app-server, que não precisa de login: mede com HOME vazio e `tests/fixtures/codex-model-list-0.147.json`).

Claude Code e Codex estão integrados; Cursor e Hermes são somente entradas indisponíveis no catálogo.
`NOD_EXECUTOR=auto` descobre contas conectadas sem turno pago; produção sem variável também usa auto.
Desenvolvimento continua com catcher. Valor fora de `auto|claude-cli|codex-cli|catcher` (exato, só as
pontas aparadas; lido só por `lerNodExecutor`) falha fechado: o servidor sobe, loga `nod_executor_desconhecido`
e fica sem IA com o motivo escrito, nunca cai no catcher (NOD-160). `NOD_MODELO=auto` permite o padrão por harness; `sonnet` fixa
Claude para os agentes criados com esse override. Boot/desktop usam sondagem de login sem inferência;
`scripts/sonda.ts` e `e2e:aceite` continuam explicitamente separados e pagos.

Codex exige flags de isolamento verificadas no help, usa o proxy nod para as integrações do nod (os MCPs da pessoa só pelo hook, ADR-103), não
herda chaves OpenAI nem, fora dos modos da dona (ADR-103), plugins/apps, e não põe o token de turno no argv. Seu launcher
0600 chama `main()` do proxy e é apagado ao encerrar. `desktop/proxy.ts` deve exportar `main` além de
funcionar como executável direto. Valide ambos os caminhos sem modelos reais.

Revisto em 2026-10-05 (primeiro uso real do Codex em produção: nove turnos, zero ferramentas). Três regras em
`drivers/codex-comum.ts`, medidas com o codex-cli 0.147.0:
- **Não desligue `features.code_mode_host`.** O modelo chama as ferramentas MCP por `functions.exec`, que roda nesse
  host; com ele desligado nenhuma chamada chega ao proxy. O ambiente desse código não tem arquivo nem rede.
- **O servidor `nod` leva `default_tools_approval_mode = "approve"`.** Sob `approval_policy="never"` o Codex cancela a
  chamada MCP sozinho. Quem decide se a ferramenta roda é o proxy do nod, como sempre.
- **As chaves `-c` são negociadas na sonda** (`negociarConfigCodex`): o `codex exec` com o stdin vazio valida a config
  sem chamar modelo, e a chave que a versão não conhece cai (com `--strict-config` ela derrubava o turno inteiro). O que
  fecha o terminal e os campos obrigatórios do servidor não caem: se a versão os recusa, o Codex fica indisponível.

`node scripts/sonda-codex-ferramentas.ts` (paga, centavos da assinatura do Codex) roda o driver de verdade contra um
servidor MCP de prova e diz se o `tools/call` chegou. Rode-a quando o Codex mudar de versão. O erro que o Codex devolve
(`turn.failed`, item `error`, última linha do stderr) vai para `erroCru`, só no diagnóstico.

Revisto em 2026-10-14 ([ADR-103](docs/adr/adr-103-o-codex-com-o-terminal-pelo-hook-do-nod.md), paridade): o chat do Codex
no app-server tem o kit do terminal. O isolamento acima vale só sem o hook (máquina sem o script, hook não confiado) e no
`codex exec` de reserva. Regras medidas no 0.147.0 e no 0.162.0:
- **O hook de `-c hooks=…` só roda confiado.** A confiança é gravada pelo próprio app-server (`hooks/list` +
  `config/batchWrite`, em `codex-chat.ts`); `--dangerously-bypass-hook-trust` NÃO funciona no app-server. Não mude o
  comando nem o matcher do hook à toa: o hash muda e a confiança é gravada de novo no `config.toml` da pessoa.
- **O hook do Codex falha aberto** (timeout estourado ou hook quebrado = o comando roda). O `hook-nativas.ts` nega sozinho
  em `PRAZO_HOOK_CODEX_MS`, abaixo do `TIMEOUT_HOOK_CODEX_S` que o Codex recebe; não inverta os dois.
- **No Codex, "permitir" é stdout vazio** (`formato: "codex"`); o JSON de allow sem `updatedInput` conta como falha.
- **O Codex usa o caminho real da pasta** (`realpath`): o `cwd` do hook é o real; o caminho dentro do patch segue o que
  o driver passou.
- `node scripts/sonda-codex-terminal.ts --codex <bin>` (paga, três turnos do Luna) homologa o hook, a recusa, o patch, a
  web, o `thread/resume` e o `thread/fork` com o Codex de verdade. Rode-a a cada versão nova do Codex; o Codex que o
  app usa fica em `~/Library/Application Support/nod/ferramentas/codex-cli/atual/bin/codex`, não no do nvm.

Conta logada que não responde (2026-10-05, emenda da ADR-019). Login conferido não prova que a conta serve: uma
organização pode ter desativado o uso por assinatura. `nao_autenticado` leva um código `causa` (`conta_sem_acesso` |
`teste_falhou`); a frase que a pessoa lê é sempre do servidor (`MOTIVO_DA_CAUSA`). Regras:
- O teste de verdade é `Instance.testar(pergunta)` nos drivers, pedido pela tela (`nodDesktop.iaTestar`). É pago: não o
  chame no boot, em sonda periódica nem em teste automatizado contra CLI real.
- O veredito mora em `desktop/vigia-ias.ts` (sem Electron, deps injetadas) e é preso à conta logada. Não guarde
  veredito no servidor: o inventário da máquina é o que o app anuncia.
- A recusa do fornecedor é reconhecida em um lugar só, `src/domain/conta-da-ia.ts`. Não espalhe regex de texto de
  fornecedor; frase nova entra lá, com teste.
- Texto do Mac não vira motivo, e o nome que entra na pergunta do teste passa por `nomeParaOTeste`.
- `erroCru` remoto atravessa a ponte com teto e vai só ao diagnóstico gravado; nunca ao log do servidor.

Reinício do servidor com Macs conectados (medido em produção em 2026-10-05, deploy no meio do uso): a ponte das
máquinas vive em memória, então o servidor novo responde 409 `estado_invalido` ao `puxar` de toda máquina que não se
reanunciou, e a fila daquela pessoa para. O app trata o 409 reanunciando (`vigia.reanunciar()`, com espera de 10 s);
não troque isso por "mostrar mensagem e esperar a pessoa reabrir". No encerramento, `servidor.close` fecha as conexões
ociosas na hora e as ativas em 5 s (`ESPERA_CONEXOES_ATIVAS_MS`); sem isso o keep-alive do Caddy segurava o processo
até o SIGKILL do compose, meio servindo por 5 min.

Deploy azul/verde (NOD-218, ADR-001 e ADR-017 emendadas): em produção há duas cores (`nod-azul`, `nod-verde`) e o
marcador `/opt/nod/estado/cor-ativa` é a única chave de quem está ativo (`src/adapters/http/cor-ativa.ts`). Não decida
"quem é ativo" por ordem de subida, lock ou variável de ambiente. Laço novo (despachante, outbox, agendador, varredor)
liga em `aoAtivar` e para em `pararLacos`, nunca no corpo do `boot`; a cor passiva só atende HTTP. Estado por processo
que mora em `/data` (compartilhado) leva a cor (`NOD_COR`), como o arquivo de grupos órfãos e `ligacoes.instancia`.
Migração tem de ser compatível com a versão anterior: a velha roda sobre o esquema novo por até 10 min. Testes:
`tests/concurrency/deploy-dois-processos.test.ts`, `tests/concurrency/drenagem-deploy.test.ts` e
`tests/integration/deploy-azul-verde.test.ts` (o `deploy.sh` com docker/curl falsos).

Anúncio remoto de harnesses é validado e vinculado ao escopo da chave; a fila só entrega a uma máquina
tarefas compatíveis. O fluxo com seleção de harness não reutiliza sessões nativas: reconstrói contexto
com histórico e memória do nod. Harness explicitamente escolhido e indisponível nunca muda para outro
fornecedor nem para catcher sem a pessoa escolher.

Piso de versão e limite do plano (NOD-171, 2026-10-06; emendas das ADR-019 e ADR-036):
- `PISO_CLI` em `flag-floors.ts` é a versão mínima testada de cada CLI. Abaixo dela o harness é `ausente` com causa
  `cli_antigo` (com `versao` e `minima`) e o turno é recusado antes do prompt. Subir o piso exige rodar de novo o UAT
  real (`scripts/uat/harnesses.sh`) e registrar em `docs/uat-harnesses-e-modelos.md`. O piso do Codex é uma linha
  isolada: trocar 0.159.0 por 0.159.2 é só ela.
- Bot fixado num harness que nenhuma máquina viva da pessoa tem pronto: o turno é reivindicado e recusado com a
  negação que nomeia o harness, nunca fica pendente. Não reintroduza "motor pronto" na negação.
- `limite_do_plano` do Claude Code vem do protocolo (`rate_limit_event` `rejected`), nunca de texto; o do Codex é a
  classe `limite_de_uso` de `erro-fornecedor.ts`. Teste com fixtures e CLI falso; não leve conta real ao limite.
- Lista editorial de modelos (`HARNESSES` em `contracts/harness.ts`) só cresce, e só com modelo que passou num turno
  real do UAT. Os padrões do automático não mudam por ela.

## Computadores dos bots (ADR-037, 2026-09-18)

`NOD_COMPUTADORES=docker` habilita o driver do servidor; `npm run computador:build` prepara a imagem.
Computador de trabalho e máquina executora do harness são recursos diferentes. O vínculo está em
`agentes.computador_id`; nunca derive o escopo do corpo da requisição. Ações passam pelo gateway
com reserva confirmada antes do efeito e nova validação depois do boot, fora da transação.
Takeover só termina por devolução explícita. Não use `--password-store=basic`: perfil usa GNOME
Keyring e checkpoint de cookies cifrado. Preserve a chave de credenciais junto da estratégia de backup.
`node scripts/smoke-computador.ts` usa dois ambientes descartáveis, sem modelos pagos. Limites e
operação: [docs/computadores.md](docs/computadores.md).

## Repositórios de referência (2026-09-18)

Procure o clone local primeiro; se não existir neste ambiente, use a URL. O clone pode faltar em
Cloud Agent ou noutra máquina, então a URL é a fonte canônica, não o caminho.

- **OpenBot (CopilotKit)** — `~/code/OpenBot`, senão https://github.com/CopilotKit/OpenBot.
  A [ADR-038](docs/adr/adr-038-padroes-e-escolhas-da-pessoa.md) fixa o commit
  `eb325300023289f17adf5a10fb38b5bb403dca82`, conferido em 2026-09-18: existe no histórico e os
  quatro arquivos citados existem nele. `server/src/host-access/tools.ts` é o paralelo direto das
  ferramentas `workspace_*`; sem pasta concedida o catálogo dele tem uma ferramenta só (linha 170),
  a mesma conclusão a que o nod chegou por conta própria. Lá a pessoa escolhe a pasta no seletor
  nativo (`requestFolderGrant` não recebe caminho): a descoberta automática é do nod.
- **OpenMausBot** — `~/code/OpenMausBot`, senão https://github.com/milind-soni/OpenMausBot.
  Referência dominante dos ADRs; a comparação viva está em
  [docs/comparacao-openmausbot.md](docs/comparacao-openmausbot.md).

`~/.openmausbot/` **não é código**: são dados de runtime do app instalado (`bots.json`,
`messages.db`). Servem como evidência de comportamento, nunca como fonte a copiar.

## Modo ligação (ADR-071 a 077, 2026-10-04)

Plano em [docs/plano-modo-ligacao.md](docs/plano-modo-ligacao.md). A voz roda no processo do nod (`src/adapters/voz/`,
sem banco: grava pelo `PersistenciaVoz` que `compor.ts` injeta); o cérebro é um turno `origem='ligacao'` que o executor
do Mac roda como laço de voz (`drivers/claude-ligacao.ts`, `codex-ligacao.ts`, `rodarLigacaoCatcher`). Provedores por
`NOD_VOZ_STT`/`NOD_VOZ_TTS`: `local` (whisper.cpp + `say`, grátis) é o padrão em dev no Mac — rode
`scripts/voz/preparar-local.sh` uma vez —, `falso` nos testes (o `servidorCompleto` já liga), `google` em produção.
`NOD_LIGACAO` = desligada | admins | todas (padrão: todas fora de produção, admins em produção).

- O e2e de custo zero é `tests/concurrency/ligacao-catcher.test.ts`; o UAT com voz e CLI de verdade é
  `node scripts/uat/ligacao-voz.ts --url http://127.0.0.1:<porta> "frase" …` contra um servidor de pé (custa assinatura
  com claude-cli).
- A decisão por voz nunca é do modelo: só a rota de decisão com `canal:"voz"` e um `comandoId` que o orquestrador emitiu
  (ADR-074). Não crie outro caminho de decisão a partir da fala.
- Nenhum áudio é gravado e o texto falado não vai para log (`log` com contagens e tempos, nunca a fala).
- Para saber onde uma ligação demorou, leia o log `ligacao_vez` (uma linha por vez: fim da voz → trecho fechado → final
  do STT → vez → primeiro texto → primeiro áudio, ferramenta antes do texto, quem fechou o trecho) e os contadores do
  VAD em `voz_ligacao_encerrada` (emenda da ADR-073). Quem mexer na decisão da vez mantém a regra: com texto pendente e
  ninguém falando, há sempre uma decisão agendada (`agendarDecisao`/`retomarDecisao` no orquestrador).
- A voz do Google sai em streaming (emenda da ADR-071), com o REST de rede de segurança; `NOD_VOZ_TTS_STREAMING=0` volta ao
  REST puro. `scripts/voz/sonda-tts-streaming.ts` compara os dois (centavos do GCP).
- Todo pedido de TTS do Google passa pelo limitador da cota (`limitador-tts.ts`, `NOD_VOZ_TTS_TETO_MIN`, padrão 180/min,
  emenda da ADR-071). Quem cria uma fala nova põe a `prioridade` no `PedidoTts` (conteúdo, leitura, espera ou prévia); sem
  ela, a fala conta como conteúdo e passa à frente das esperas.
- No laço do Claude, o texto pertence à vez da última mensagem que o CLI **leu** (o eco de `--replay-user-messages`),
  não da última escrita (emenda da ADR-072). `scripts/sonda-voltas-ligacao.ts` mede isso contra o CLI real (centavos).
- A IA do Mac pode cair no meio (emenda de 2026-10-05 da ADR-072): o turno-cérebro que termina com a ligação viva vira
  `voz.cerebroTerminou`, a ligação fala a frase fixa, manda `{t:"sem-ia"}` à mídia e espera a escolha sem ouvir
  (`aguardando_escolha`; sem escolha em 2 min, fim `sem_ia`). `POST ligacoes/:id/continuar {ia}` abre OUTRO turno-cérebro
  para a mesma ligação. Quem criar um caminho novo que encerre o turno `ligacao` mantém o evento com `origem: "ligacao"`
  e o motivo em código, senão a ligação volta a ficar muda. Log: `ligacao_cerebro_caiu` (causa e contagens, nunca fala).
- Limite da assinatura (ADR-078): só o `rate_limit_event` com `rejected` vira `{t:"limite"}` no canal do cérebro; nunca
  classifique pelo texto do erro do fornecedor. Com outra IA pronta, o limite entra no "sem IA" (causa `limite`); sem
  alternativa, encerra com `limite_da_assinatura`. Log: `ligacao_limite_da_assinatura`.
- Ouvir uma resposta fora da ligação (NOD-180, emenda de 2026-10-06 das ADR-071/075): `GET mensagens/:id/ouvir` devolve
  o áudio em streaming (`audio/L16; rate=24000`, PCM16 **big-endian**). Desligado por padrão: só `NOD_VOZ_LEITURA=1` liga,
  e a abertura segue `NOD_LIGACAO`. O texto vira trechos em `textoParaLeitura` (`ligacao-frases.ts`), o caso de uso é
  `prepararLeitura` e o áudio é do `leitura-voz.ts` (teto diário em memória `NOD_VOZ_LEITURA_CARACTERES_DIA`, padrão
  100000; janela à frente `NOD_VOZ_LEITURA_ADIANTE_MS`, padrão 15000; prioridade `previa`; uma leitura por pessoa). Log
  `voz_leitura` só com contagens e desfecho. Nos testes, a voz falsa entra pela opção `voz` do `servidorCompleto`.

## Celular (ADR-094, 2026-10-10)

O celular abre a mesma web, servida pelo mesmo servidor e instalável (PWA). Não há app de loja nem host fixo:
o manifesto usa `/`, e quem instala de `https://<servidor>` fala com aquele servidor.

- **Celular = toque E tela de telefone.** A consulta é `CONSULTA_CELULAR`, em `web/lib/celular.ts`, e é a mesma string do
  `@media` de `web/mobile.css`. O teste confere. Regra de layout de celular entra nesse bloco, nunca num `max-width` solto.
- **O service worker (`web/public/sw.js`) guarda só `/offline.html` e os ícones.** Nunca ponha API, HTML do app nem
  resposta da rede no cache dele. Mudou a lista: suba a versão de `CACHE`. `tests/unit/web/pwa.test.ts` roda o worker
  num contexto isolado.
- **`estatico.ts`:** `/assets/*` é imutável e HTML, `sw.js` e manifesto são `no-cache`. O cache do HTML é o que faz um
  deploy chegar ao app instalado.
- **Ícones:** `node scripts/mobile/icones.mjs` gera os PNGs a partir da marca do `favicon.svg` num Chrome headless.
  Passe `CHROME=<binário>` se o do cache do Playwright não existir.
- **Sem comando próprio de teste mobile.** O que roda no `check` são os unitários acima, mais `celular`, `retomada`,
  `estatico` e `live-events`. Para ver a tela, suba o servidor com `NOD_STATIC_DIR=dist/web` depois do build: o worker só
  registra no build. Fotografe com o `chrome-headless-shell` via CDP, com toque emulado
  (`Emulation.setTouchEmulationEnabled`), 390×844 e 412×915. O teclado é simulado encolhendo a altura.
  Toque de verdade (`Input.dispatchTouchEvent`), não `el.click()`: o clique sintético acende o anel de foco, e o dedo
  não acende.
