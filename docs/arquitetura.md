# Arquitetura do nod

Um servidor Node (Postgres com RLS em duas camadas) emite
**planos de turno**; o app local **puxa** o trabalho e roda o CLI do fornecedor atrás de um
**proxy MCP**, que é o ponto de decisão do produto. Fonte: `AGENTS.md`, `docs/adr/`,
`src/adapters/http/compor.ts` e `boot.ts`.

## 1. Camadas e fronteiras travadas pelo código

```mermaid
flowchart TB
    subgraph cliente["Cliente"]
        web["web/ — SPA<br/>só import type de src/<br/>REST para ler, SSE para saber o que mudou"]
    end

    subgraph servidor["Servidor Node (um container) — src/"]
        direction TB

        subgraph adapters["adapters/ — laça o mundo ao núcleo"]
            direction LR
            http["http/<br/>server · roteador · rotas/*<br/>sessao · sse · erros<br/>compor.ts · boot.ts"]
            fundo["fundo/ — laços por pessoa<br/>orquestrador · scheduler<br/>varredor-lease · varredor-expiracao<br/>despachar-outbox · ponte-interna · particoes"]
            executor["executor/<br/>registry · laco · sonda · spi<br/>drivers: catcher | claude-cli"]
            proxy["mcp-proxy/<br/>proxy · catalogo · negacao<br/>corte · moldura · probe"]
        end

        usecases["use-cases/ — regra de produto<br/>enviar-mensagem · decidir · emitir-plano-turno<br/>assentar-turno · conceder · pedir-aprovacao · ..."]
        services["services/ — SEM BANCO<br/>barramento · interruptor · inventario<br/>conectores-vivos · token-turno"]
        repos["repositories/ — única porta ao banco<br/>events · turnos · decisoes · salas · ..."]
        domain["domain/ — PURO<br/>sem node:*, sem banco, agora:number por parâmetro<br/>guardado por tsconfig.domain.json"]
    end

    subgraph pg["Postgres 127.0.0.1:5434"]
        direction TB
        rls["RLS restritiva FORCE + predicado explícito<br/>SET LOCAL por transação (tenant + pessoa)<br/>nod_app é NOBYPASSRLS"]
        events["events particionada por tempo<br/>+ outbox"]
        estado["tabelas de domínio (estado com regra)<br/>trilha imutável por trigger"]
    end

    web -->|"REST (POST/GET)"| http
    http -.->|"SSE: frames numerados, replay por pessoa"| web

    http --> usecases
    fundo --> usecases
    usecases --> services
    usecases --> repos
    usecases --> domain
    services --> domain
    repos -->|"abrirTxEscopada → SET LOCAL"| rls
    rls --- events
    rls --- estado

    classDef puro fill:#e8f5e9,stroke:#2e7d32;
    classDef semdb fill:#fff3e0,stroke:#ef6c00;
    class domain puro;
    class services semdb;
```

**Direção de import (eslint) e pureza (compilador) são travas, não convenção:** `domain` não
conhece ninguém; `services` não toca no banco; `repositories` é a única porta ao Postgres; toda
transação carrega tenant **e** pessoa (`abrirTxEscopada`), e ler sem escopo falha fechado no
Postgres.

## 2. Fluxo de um turno — a ponte puxa, o proxy decide

Há **dois canais internos** distintos (verificado no código):
- **Ponte interna** (`src/adapters/fundo/ponte-interna.ts`): os cinco verbos do ADR-021
  (`conectar/desconectar/puxar/renovar/entregar`) hoje são **chamadas de função in-process**, não
  HTTP. O orquestrador é quem os dirige.
- **Rotas internas HTTP** (`/api/interno/*`, `src/adapters/http/rotas/interno.ts`): autenticadas
  pelo **token de turno**, com `Origin → 403` antes do token. É por aqui que o **proxy MCP** volta
  ao servidor: `GET /plano`, `POST /ferramentas/:nome`, `GET /decisoes/:id/aguardar`, `POST /negacoes`.

```mermaid
sequenceDiagram
    autonumber
    participant P as Pessoa (navegador)
    participant W as web (SPA)
    participant S as Servidor (rotas + use-cases)
    participant DB as Postgres (RLS)
    participant O as orquestrador (fundo)
    participant Bp as Ponte interna<br/>(5 verbos, in-process)
    participant X as Executor + driver<br/>(catcher | claude-cli)
    participant M as Proxy MCP<br/>(ponto de decisão, loopback)

    P->>W: escreve / decide
    W->>S: POST REST
    S->>DB: use-case grava events + outbox (tx escopada)
    Note over S,DB: turno nasce "pendente" na fila por conversa

    O->>Bp: puxar(pessoaId)
    Bp->>DB: despacharTurno em tx escopada
    Bp-->>O: PLANO DE TURNO<br/>(catálogo resolvido, autoria, token, expiração)
    O->>X: laço spawna o driver com o plano
    X->>M: tools/list · tools/call
    M->>M: monta ferramentas · classifica negação<br/>corta orçamento · monta aprovação
    M->>S: GET /api/interno/plano · POST /ferramentas/:nome<br/>(loopback, token de turno)
    S->>DB: chamarFerramenta (tx escopada)
    X->>Bp: renovar (30s: 4 sinais + lote de eventos)
    X->>Bp: entregar (resultado, uma vez)
    Bp->>DB: assentarTurno → events → outbox (tx escopada)
    S-->>W: SSE "turno.delta / mudou" (via despachante do outbox)
    W->>S: reidrata por REST
```

**Chaves do desenho (todas confirmadas no código):**
- O servidor **nunca disca** para a máquina: presença é o próprio poll (ADR-021). Hoje a ponte é
  `PonteInterna` in-process; a versão HTTP multi-máquina entra sem trocar o driver.
- O **plano de turno** (ADR-024) é o primitivo: sem plano/expirado/catálogo vazio, `tools/list`
  vazio e todo `tools/call` negado (fail-closed estrutural — `proxy.ts`, não código de política).
- O **proxy MCP** (ADR-013) é a autoridade local (loopback) — contém o **agente**, não o dono da
  máquina. Nunca consulta WAN por chamada: decide contra o plano já puxado.
- Dois executores (ADR-014): `catcher` (padrão, in-process, custo zero) e `claude-cli` (haiku real
  com `--strict-mcp-config --tools "" ` e env limpo; custa assinatura).

## 3. Laços de fundo (boot.ts, todos por pessoa)

```mermaid
flowchart LR
    boot["boot()"] --> part["garantirParticoes"]
    boot --> listen["listen (porta 8888)"]
    boot --> reg["registry (sonda o driver)"]
    boot --> inv["inventário por pessoa"]
    reg --> orq["orquestrador de turnos<br/>(injeta o laço da L4)"]
    reg --> sch["scheduler de rotina 30s"]
    reg --> vl["varredor de lease 15s"]
    reg --> ve["varredor de expiração 30s"]
    reg --> out["despachante do outbox → barramento → SSE"]
```

## 4. Conformidade código × ADR

Verificado contra o código real (não só a doc). Todos **confirmam**; a única nuance é a ponte
(contrato de 5 verbos existe, mas hoje in-process, não HTTP — a própria ADR-021 já registra isso).

| ADR | Afirmação | Estado | Evidência |
|---|---|---|---|
| 003 | `abrirTxEscopada` exige tenant+pessoa, `SET LOCAL` por tx, `escopo_vazio` se vazio | ✅ | `src/db/tx.ts:14-27,41-57` |
| 003 | Só aceita o POOL; tx já aberta → `estado_invalido` | ✅ | `src/db/tx.ts:41-45` |
| 003 | RLS `FORCE` + policies por comando (`nod_pessoa_select/insert/update/delete` + `nod_tenant` restritiva) | ✅ | `src/db/migrations/0004_policies_por_comando.sql:37-70` |
| 003 | `nod_app` é `NOBYPASSRLS`; ler sem escopo falha fechado | ✅ | `infra/postgres/init/01_roles.sql:15` · `tests/conformidade/rls.test.ts:77` |
| 004 | Trilha imutável por trigger (bloqueia UPDATE/DELETE/TRUNCATE) | ✅ | `src/db/migrations/0001_fundacao.sql:115-132` |
| 005/006 | Uma `events` particionada por tempo, sem catch-all; `garantirParticoes` | ✅ | `0001_fundacao.sql:141-163` · `src/adapters/fundo/particoes.ts:30` |
| 005 | Outbox + despachante publica no barramento | ✅ | `0001_fundacao.sql:183-201` · `src/adapters/fundo/despachar-outbox.ts:66-91` |
| 013 | Proxy: monta ferramentas · classifica negação · corta orçamento · monta aprovação | ✅ | `mcp-proxy/{catalogo,negacao,corte,moldura}.ts` |
| 013 | Proxy chama o servidor por loopback in-process, nunca WAN por chamada | ✅ | `mcp-proxy/proxy.ts:99` · `executor/cliente-nod.ts:117-128` |
| 014 | Dois drivers (`catcher` padrão, `claude-cli`); haiku + `--strict-mcp-config --tools ""` + env limpo | ✅ | `compor.ts:125` · `executor/drivers/claude-cli.ts:49-95` |
| 016 | SSE com frames numerados + replay por pessoa | ✅ | `http/sse.ts:20` · `services/barramento.ts:83-120` |
| 018 | Domínio puro (sem `node:*`/banco, `agora:number`); guardado por compilador + fence | ✅ | `tsconfig.domain.json` · `scripts/prove-domain-fence.sh` · `package.json` (`fence:domain`) |
| 021 | 5 verbos `conectar/desconectar/puxar/renovar/entregar`; servidor nunca disca | ✅ (in-process) | `src/adapters/fundo/ponte-interna.ts:66-146` |
| 021 | Rotas `/api/interno/*` com `Origin → 403` antes do token | ✅ | `http/roteador.ts` · `http/rotas/interno.ts:38-50` |
| 023 | Todo evento carrega autor + `sob_procuracao_de` | ✅ | `use-cases/autoria-evento.ts:29-91` · `0001_fundacao.sql:148-157` |
| 024 | `emitirPlanoTurno` (catálogo, autoria, token, expiração); proxy é único consumidor | ✅ | `use-cases/emitir-plano-turno.ts` · `mcp-proxy/proxy.ts:62-150` |

