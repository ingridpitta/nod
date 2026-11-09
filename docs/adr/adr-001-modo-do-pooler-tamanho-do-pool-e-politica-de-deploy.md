# ADR-001 — Modo do pooler, tamanho do pool e política de deploy

**Status** mantido

## Decisão

Pooler em modo transação, pool pequeno, deploy por recreate (nunca rolling). Decidido antes da fase 0. Acréscimo de uma linha: o endpoint de long-poll da ponte NÃO segura conexão do banco enquanto espera — consulta, solta, dorme no processo.

## O que mudou

Só a nota sobre o long-poll. Nenhuma decisão mudou.

## Por quê

Cinco decisões de quatro frentes dependem deste ADR e nada nele dependia do número de clientes. A nota sobre o long-poll existe porque a ponte nova introduz ~38 conexões HTTP paradas, e se cada uma segurasse conexão de banco o pool esgotaria — que é o incidente de sexta 19h que o ADR-001 já nomeava como o mais provável do sistema.


## Emenda de 2026-10-15 — Pool direto no Cloud SQL, prazo de aquisição e timeouts por tx (NOD-266)

Contexto: produção conecta direto ao Cloud SQL (db-custom-1-3840, max_connections 100), sem pooler; a premissa "pooler em modo transação, pool pequeno" não vale hoje. Em 15/10 08:07–10:12 o pool de 5 se esgotou com conexões presas por chamada de conector e o servidor ficou ~2 h esperando uma conexão livre, sem erro nem log.

Decisão:
- Tamanho do pool da app vem de NOD_DB_POOL_MAX (padrão 15; não inteiro, menor que 1 ou maior que 50 derruba o boot). Pool do dono segue max 1; migrações fora.
- Toda tx escopada (abrirTxEscopada) tem prazo de 10 s para pegar conexão. Estourou: 503 codigo "banco_ocupado" com a mensagem genérica e correlation_id; a função não roda se a conexão chegar depois. Os laços de fundo (paraCadaPessoa) param a volta no primeiro banco_ocupado, e a listagem das pessoas tem o mesmo prazo.
- vincularEscopo aplica via SET LOCAL statement_timeout 60s, lock_timeout 10s e idle_in_transaction_session_timeout 660s (acima dos 600 s da chamada de conector com arquivo, que rodava dentro da tx; baixou para 60s na emenda da NOD-263, abaixo). Só na tx escopada da app.
- A trx entregue à função é guardada: depois que a transação assenta (fim da função, commit, rollback ou a sessão encerrada pelo idle), qualquer consulta por ela lança tx_encerrada. Spike de 2026-10-15 (postgres.js 3.4.9): sem a guarda, a consulta seguinte de uma trx cuja sessão o Postgres encerrou rodou na conexão reaberta do pool, fora de transação e sem escopo. Ligar o kill por idle depende dessa guarda e de mais duas emendas: quando a função termina depois da queda, o callback do begin não assenta (senão o begin mandaria COMMIT/ROLLBACK pelo handler cru, no objeto Connection que o pool pode ter reaberto para outra requisição), e o remendo `nod:remendo-vaga-do-pool` faz o `execute` sem socket devolver `true`, para a conexão fechada não sair da fila de fechadas (com pool `max 1`, o servidor inteiro travava).
- Quem pode estar dentro da tx escopada da mesma pessoa (o carregador de conectores da composição) reusa a trx do contexto em vez de abrir uma segunda tx: duas tx da mesma requisição com o pool cheio são deadlock de pool.
- Tx > 5 s gera log tx_longa (aviso).
- Revisão do PR #321: a guarda vale também no ENVIO da consulta (o postgres.js é preguiçoso; uma consulta montada com a tx viva e aguardada depois do kill rodaria fora da tx). O reuso da trx do contexto roda num SAVEPOINT, para o erro de quem reusa não abortar a tx do caso de uso. Timeout da tx (57014, 55P03 — inclusive esperando pg_advisory_xact_lock — e o 25P02 que vem depois) responde 503 banco_ocupado e não marca falha no conector. A volta do laço de fundo começa num ponto sorteado, para a parada no banco_ocupado não deixar sempre as mesmas pessoas de fora. O remendo do postgres.js decide "troca já aplicada" por uma marca própria de cada troca (a segunda passagem do postinstall reinseria a checagem sem a correção da vaga).
- Limitação conhecida: o postgres.js não tira da fila do pool o begin de quem desistiu; quando a conexão chega, ele faz BEGIN → ROLLBACK sem rodar nada. Custa uma ida ao banco por desistência; só some com um prazo de aquisição no próprio driver.

Consequência: idle_timeout continua protegendo contra conexões ociosas; o prazo de aquisição protege contra esgotamento. Se um pooler voltar, rever o tamanho (pool pequeno) — os timeouts por SET LOCAL continuam válidos em modo transação. Réplicas × NOD_DB_POOL_MAX + dono + migrações precisa caber no max_connections.


## Emenda de 2026-10-16 — Nenhuma chamada externa com tx escopada aberta (NOD-263)

Contexto: a rota interna das ferramentas (`POST /api/interno/ferramentas/:nome`) rodava o caso de uso inteiro numa tx escopada, inclusive a chamada ao app conectado (até 30 s com as tentativas; 600 s com arquivo) e o `executarItens` do lote que o `pedir_aprovacao` aprova sozinho. Cada chamada lenta segurava uma conexão do pool e a linha do turno; foi o que esgotou o pool em 15/10.

Decisão:
- Nenhuma chamada externa (conector, gh, computador) roda com tx escopada aberta. O efeito externo é feito em três tempos, como o caminho da pessoa já fazia (`rotas/decisoes.ts`):
  1. FASE 1, numa tx curta: portões, trilha `tool_call`, `contaminar` e — no lote automático — a decisão criada e JÁ FECHADA por regra (ADR-042 §3: nunca aparece em "Sua vez" nem expira).
  2. EFEITO fora de tx, sob o contexto de log da fase 1 (mesma pessoa, mesmo `correlation_id`; sem ele o carregador não sabe de quem é o conector).
  3. FASE 2, numa tx nova: grava o desfecho de forma idempotente (`desfecho is null`; a fala "Fiz sem perguntar" e o evento só saem quando esta fase gravou algo) e nunca reenvia o efeito (ADR-009). Sucesso do app não tem fase 2: o conteúdo volta direto, não confiável (ADR-026). Banco ocupado na fase 2 repete SÓ a escrita, 3 vezes com espera curta; esgotou, loga `desfecho_nao_gravado` e responde 503.
- Guarda `conector_dentro_da_tx` (`exigirForaDaTx`, src/db/tx.ts): antes de chamar o conector vivo e no início de `executarItens`. Em produção loga aviso e segue; em teste (NODE_ENV=test) lança.
- `decidir` e `chamarFerramenta` numa tx só ficam como composição para testes.
- idle_in_transaction_session_timeout baixa de 660 s para 60 s: o que ainda conversa com o app de fora dentro da tx são as sondas de conector (orçamento de 30 s), que ficam para issue própria e aparecem no log pela guarda.

Consequência: um app lento deixa lento só o bot que o chamou. Se o servidor cair entre as fases, o item fica sem desfecho e nada é reenviado (limpeza: NOD-261). Custo: uma tx a mais por chamada que falha e por lote automático.


## Emenda de 2026-10-22 — Recreate vira azul/verde (NOD-218, aprovada pelo Marlon em 19/10)

O deploy deixa de ser recreate. A VM tem duas cores do mesmo serviço, `nod-azul` e `nod-verde`, e o Caddy na frente das duas com `lb_policy first` e health check em `/api/saude/lb`. Continua não sendo rolling: há no máximo uma cor **ativa**, e a única chave da troca é o marcador `/opt/nod/estado/cor-ativa` (um arquivo, gravado por `tmp` + `mv`, montado só leitura em `/data/estado` e relido a cada 500 ms). Quem não é a cor do marcador responde 503 `inativa` no `/api/saude/lb`, não liga os laços (despachante, outbox, agendador, varredores) e só atende HTTP. Não é advisory lock porque, com o pooler, uma trava de sessão não é confiável.

O `deploy.sh`: migra com a imagem nova, sobe a cor parada, espera o healthcheck, troca o marcador, confirma 3 vezes pelo Caddy local que a cor nova responde e só então para a velha (`stop -t 660`, a drenagem de até 10 min) e fecha as ligações órfãs dela. Se o Caddy não confirmar em 15 s, o marcador volta e a nova para. A velha, ao drenar, para os laços, fecha os SSE (o navegador reconecta na nova), autoriza o token de turno só pelo banco e despacha só ligações.

Consequências:
- Migração precisa ser compatível com a versão anterior (N-1): a velha roda sobre o esquema novo durante até 10 min. Coluna nova com default ou nula; remoção em dois deploys.
- Pool: as duas cores juntas usam ~2×15 + dono ≈ 31 das 100 conexões do Cloud SQL.
- Por até 15 s há dois despachantes; o SKIP LOCKED e as janelas UNIQUE (ADR-011) mantêm cada turno e cada rotina rodando uma vez.
- Memória: dois Node na `e2-medium`. Se o pico passar de 80% no ensaio, `NOD_DRENAGEM_MAX_MS=300000` antes de subir a VM.
- NOD-331: o Caddyfile chega em estágio (`Caddyfile.novo`) e só é promovido na troca, com a cor nova saudável; se a troca não confirma, o anterior volta (na transição, confirmado pelo Caddy antes de parar a azul). Na transição, o `nod` legado sai com `stop -t 30` (`NOD_TRANSICAO_STOP_S`), não 660: depois do recreate do Caddy ninguém mais o alcança. A drenagem para todos os laços juntos, com prazo de 15 s, e solta a cada 5 s os tokens dos turnos que a ativa já assentou. As ligações órfãs que não fecharem em 3 tentativas ficam em `estado/orfas-pendentes` para o deploy seguinte.

Gatilho de reversão: se o ensaio ou dois deploys seguidos mostrarem queda vista pela sonda do Caddy, ou se a memória não couber nem com o teto de 5 min, volta o recreate até a causa ser resolvida.
