---
name: quebrar-jornada
description: >-
  Cria ou quebra uma jornada do roadmap do nod na cadeia office-hours (enquadramento de produto) →
  épicos → issues do tamanho de um agente. Use quando for planejar uma jornada nova, quebrar os
  épicos de uma jornada existente em issues, ou preparar tasks para a esteira Linear→código.
  Gatilhos: "quebrar a jornada NN", "transformar épico em issues", "criar doc de jornada",
  "issues para a esteira".
---

# Quebrar jornada em issues

Codifica o método usado em `docs/roadmap/` para ir de uma intenção de produto até issues que um
agente executa ponta-a-ponta. Não escreve código de produto — o output são **documentos**
(`office-hours.md`, `epicos.md`, `issues.md`).

## O pipeline: três altitudes, três skills

| Altitude | Pergunta | Artefato | Quem | Frequência |
|---|---|---|---|---|
| Produto | Vale construir? qual a cunha? | `office-hours.md` | humano (`/office-hours`) | 1× por jornada |
| Plano | Como construir? escopo, arquitetura | `epicos.md` | esta skill | 1× por jornada |
| Execução | Transformar intenção em código | `issues.md` → task Linear → `/spec` | esta skill + esteira | 1× por issue |

**Regra de altitude (não misture):** `/office-hours` é portão humano por jornada, a montante — nunca
por issue (trava pedindo confirmação e, por design, não gera código). A perna automatizada
(Cloud Agent) começa em `/spec` por issue, consumindo o `office-hours.md` como contexto de produto.

## Passo 0 — Ancorar antes de cortar (obrigatório)

Issues genéricas nascem de quebra sem leitura. Antes de escrever qualquer issue:

1. Leia o `office-hours.md` da jornada e o `epicos.md`.
2. Leia os **ADRs** que cada épico nomeia (estende/reverte) em `docs/adr/` — cada um traz o gatilho.
3. Leia `AGENTS.md` (as regras que o código trava) — elas definem o que "testável" significa aqui.
4. **Abra o código nas costuras que a issue vai tocar** (Grep/Read): nomeie arquivos e funções reais
   (`src/domain/…`, `compor.ts`, `sessao.ts`, `token-turno.ts`, `gate-rls.ts`). A issue cita o
   arquivo para o agente não caçar.

## Passo 1 — Doc de office-hours (jornada)

Se a jornada ainda não existe, rode `/office-hours` (humano) e destile o design doc para
`docs/roadmap/jornada-<NN>/office-hours.md`. Seções fixas (convenção de `docs/roadmap/README.md`):

- **Norte / valor** — o de→para para o usuário.
- **Persona & pré-condições.**
- **A jornada passo a passo** (perspectiva do usuário).
- **Capacidades introduzidas** (de → para, mapeadas à referência: OMB etc.).
- **Fora de escopo** (explícito — a linha vermelha).
- **Impacto arquitetural & ADRs afetados** — cada ADR revertido/estendido **com seu gatilho**.
- **Critérios de aceite.**
- **Perguntas em aberto** — viram spikes no Passo 3, não stories.

## Passo 2 — Épicos

Cada épico é uma **fatia de capacidade entregável e testável**. Em `epicos.md`:

- **Mapa de dependências** em `mermaid flowchart` (ordem de dependência, não de prioridade).
- Marque o **marco de meio de caminho** (o subconjunto de maior valor e menor risco).
- Por épico: **Objetivo · Escopo · ADRs** (estende/reverte + por quê, sem reverter gatilho à toa) **·
  Depende de · Pronto quando** (critério observável).
- Um épico grande demais para 2-3 issues vira mais issues; não esprema.

## Passo 3 — Issues

### Princípio de corte: fatia vertical + esqueleto ambulante

Não corte por camada técnica ("uma issue pro domínio, outra pro banco"). Corte em **fatias
verticais**: cada issue atravessa as camadas que precisar (`domain → services → adapters → web`) e
termina num comportamento observável e testável. Para épicos que são fundação técnica, a primeira
issue é um **esqueleto ambulante**: o caminho mais fino ponta-a-ponta que já liga o gate/trilha.

### Régua de tamanho (o "ideal para um agente")

Uma issue tem o tamanho certo quando cabe em **uma execução de agente com um único `npm run check`
verde**:

- **1 PR** mergeável, revisável de uma sentada.
- Fecha em **1 critério de aceite = 1 teste**, nomeando o modo: `tests/unit` (sem banco) ·
  `tests/integration` (`withRollback`) · `tests/conformidade` (lê o catálogo do Postgres) ·
  `tests/concurrency` (duas conexões reais). Ver `AGENTS.md` §"Quatro modos de teste".
- Toca um **conjunto limitado de costuras**: se precisa mexer em >2 ADRs ou >2 fronteiras de camada
  ao mesmo tempo, está grande demais → parta em duas.
- **Nunca deixa `main` quebrado nem afrouxa o fail-closed**: mesmo parcial, o proxy continua negando
  o que não tem plano válido. Coexistência atrás de flag até a issue de limpeza remover o antigo.

Passe cada issue candidata por **INVEST** (Independente, Negociável, Valiosa, Estimável, Small,
Testável). Falhou em "Testável" ou "Small" → corte de novo.

### User Story por padrão; enabler → Issue "normal"

- **US** quando há persona com valor direto: `Como <persona>, quero <objetivo>, para <benefício>.`
- **Issue** quando é enabler técnico, decisão ou limpeza que não vira User Story honesta (ex.: "adicionar
  coluna", "liberar flag de host", "remover stub"). Não force US onde não há persona.

### Anatomia de cada issue (o "contexto próprio")

É um **briefing autocontido** — a entrada do `/spec`. Seções fixas:

- **Título** + rótulo `[US]`/`[Issue]` + épico pai.
- **Contexto/porquê** — 2-3 linhas + os ADRs que estende/reverte.
- **Costuras** — arquivos/módulos concretos a tocar.
- **Escopo / Fora de escopo** — a linha vermelha explícita.
- **Aceite = o teste** — qual dos quatro modos e o que prova.
- **No chat** — os ids das ações novas, 2-3 falas de como a pessoa pede, o cartão e o risco, mais o critério fixo
  "dá para fazer pelo chat com qualquer bot"; sem ação nova, "No chat: nenhuma ação nova". Modelo em
  [`/acao-no-chat`](../acao-no-chat/SKILL.md).
- **Depende de** — issues anteriores.

### Incógnitas viram spikes, não stories

Cada "pergunta em aberto" que bloqueia uma decisão vira uma **issue-spike com timebox** cujo
entregável é um **ADR** (ou pré-ADR em `docs/roadmap/`), separada das stories de implementação. Um
agente de implementação nunca recebe issue com decisão de arquitetura pendente embutida.

### Ordem

Respeite o grafo de dependência do `epicos.md`. Numere `E<N>.<k>` (E1.0, E1.1…). E1.0 costuma ser a
spike de decisão.

## Passo 4 — Publicar no Linear

Com o `issues.md` pronto, cada issue vira uma task na esteira Linear → Cursor → gstack. Siga
[docs/roadmap/criar-issue-no-linear.md](../../../docs/roadmap/criar-issue-no-linear.md): time de chave LEA /
projeto Nod / status Todo, título `<ID> — <título>`, labels `jornada-NN` + `trilha`, `blocked by` por
"Depende de", e anote o `Linear: LEA-…` de volta no `issues.md`. Só publique jornadas cuja pasta tenha
`office-hours.md`.

## Estrutura de arquivos

```
docs/roadmap/
  README.md                     # índice das jornadas + convenção
  jornada-<NN>/
    office-hours.md             # enquadramento de produto (Passo 1)
    epicos.md                   # épicos (Passo 2)
    issues.md                   # quebra em issues (Passo 3)
  pre-adr-0NN-*.md              # pré-esboços de ADR (viram ADR quando construídos)
```

Ao criar a pasta de uma jornada nova ou migrar uma antiga (arquivos soltos → pasta), **ajuste os
links relativos**: os que apontam para fora da pasta (ex.: um pré-ADR em `docs/roadmap/`) viram
`../…`; atualize também `docs/roadmap/README.md`. Verifique com um grep pelos nomes antigos antes de
fechar.

## Checklist antes de fechar

- [ ] `office-hours.md`, `epicos.md`, `issues.md` na pasta `jornada-<NN>/`.
- [ ] Cada issue: 1 PR, 1 teste de aceite nomeado, ≤2 ADRs, fora-de-escopo explícito, depende-de.
- [ ] Cada issue com botão novo tem a seção "No chat" (`/acao-no-chat`); sem ação nova, diz "nenhuma ação nova".
- [ ] User Story onde há persona; Issue onde é enabler/decisão/limpeza.
- [ ] Perguntas em aberto viraram spikes com entregável = ADR.
- [ ] Costuras citam arquivos/funções reais (leu o código no Passo 0).
- [ ] Nenhum link quebrado (grep pelos nomes de arquivo antigos = 0).
- [ ] `office-hours` NÃO aparece na perna por issue (é humano, por jornada).
