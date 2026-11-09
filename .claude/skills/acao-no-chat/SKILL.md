---
name: acao-no-chat
description: >-
  Regra de paridade tela × chat do nod (NOD-391, ADR-135) aplicada antes do CI: todo botão novo tem ação no registro
  e caminho no chat. Um bloco por momento: spec (seção "No chat"), protótipo (o caminho pela conversa) e plano/QA
  (seção "Ações"). Use ao detalhar, prototipar, planejar ou testar uma feature com botão, rota ou ação nova.
  Gatilhos: "ação no chat", "paridade", "No chat", "seção Ações", "botão novo", "rota nova", "registro de ações".
---

# Ação no chat

A catraca `tests/conformidade/paridade.test.ts` derruba no CI a rota nova sem id (A), a ação sem rota (B), as vivas
abaixo do piso (C) e o `docs/paridade.md` velho (D). Ela **não** exige o caminho no chat: aceita `falta` e `nunca`
declarados. Quem garante o caminho é o fluxo, e esta skill o traz para o começo, para a feature nascer com os dois.

## 1. A regra

**Todo botão novo tem ação no registro e caminho no chat.** "Botão" é o que a pessoa faz na tela e muda algo: toda rota
de pessoa que não é GET (sem `interno`, `maquina` ou `publica`, ADR-135 §5), e a ação da conta, que mora em
`/api/conta` e declara `semRotaDePessoa`.

- **Registro:** `REGISTRO_DE_ACOES` em `src/domain/acoes/index.ts`, um arquivo por domínio (`src/domain/acoes/bots.ts`,
  `src/domain/acoes/rotinas.ts`, `src/domain/acoes/acessos.ts`…; `memoria.*` mora em `bots.ts`); domínio novo entra no spread do registro. Cada ação é
  uma `DefinicaoAcao` (`src/contracts/acoes.ts`) com id `dominio.verbo` (ex.: `bots.criar`, `rotinas.pausar`),
  `titulo`, `risco`, `cartaoNoChat` e `chat`. O `validarRegistro` confere o conteúdo.
- **A rota declara o id** em `Rota.acao` (tipo `IdAcao`; id fora do registro não compila).
- **Risco** (`RiscoAcao`, ADR-135 §3): `leitura` nunca vira cartão · `muda` segue o modo do bot · `arriscada` vira
  cartão no manual e no automático · `pessoa_confirma` é sempre da pessoa, também em "Ignorar todas as aprovações".
- **O cartão só sai do risco sozinho no lote do `gerir_bots`** (`riscoDaAcao` em `src/domain/lote-bots.ts`; o modo,
  o de quem recebe o pedido, lá o do Nod, entra em `decidirLote`; hoje, lá, `leitura` segue o modo como `muda`).
  Fora do lote, a ferramenta aplica o mapa ela mesma: `leitura` não consulta o modo; `pessoa_confirma` vira cartão
  antes do modo (`decidirPeloModo` em `src/domain/modo-aprovacao.ts` aprova tudo em "Ignorar todas as aprovações");
  `arriscada` vai direto em `semRevisor(decidirPeloModo(modo, { arriscada: true, credencial: false }))` (modo atual
  do bot; sem plano, manual), nunca por `confirmacaoPeloModo` (`src/use-cases/confirmar-pelo-modo.ts`), que alivia
  o arriscado na conversa com a pessoa (`conversaComAPessoa`); `muda` vai por `confirmacaoPeloModo` com
  `arriscada: false`. A cerca 3 fora do lote só vale com o revisor ligado (`gravaInstrucao`); se o spec a pede sempre,
  a ação é `arriscada`. Divergência de risco não vira `parcial`: se a ferramenta que já existe diverge do mapa, a Ada
  decide no spec (corrigir a ferramenta ou o risco no registro), no mesmo PR.
- **Estado no chat** (`EstadoNoChat`): `vivo` (mesmo executor da tela, com teste de contrato) · `parcial` (o chat faz,
  mas diverge; diz o quê) · `falta` (a onda dona, uma de `ONDAS`, vai ligar) · `nunca` (exceção com motivo escrito).
- **Ação nova nasce `vivo`.** `falta` é exceção que a Ada decide no spec, com o porquê; a onda sai de `ONDAS` e, se
  nenhuma serve, a issue dona entra em `ONDAS` e `NOME_DA_ONDA` no mesmo PR. `nunca` só nas exceções da ADR-135 §2:
  senha, sessão, pareamento, credencial, o próprio chat, o cartão que é a resposta da pessoa, estado de tela, onboarding.
- **Placar:** `docs/paridade.md` (gerado por `npm run paridade`, nunca à mão) e o piso `docs/paridade.piso.json`, que
  só sobe.

Feature **sem ação nova** (nenhuma rota de pessoa nova que não seja GET: só tela, só visual, ou rota nova para um id já
`vivo`; um POST que só lê é ação `leitura` e entra no registro) escreve **"No chat: nenhuma ação nova"** e não leva o
critério fixo. Reusar um id existente cita o id. Id que já existe e muda de estado (`falta`/`parcial` → `vivo`, as
ondas) conta como ação nova: leva a seção "No chat" e o critério.

## 2. Spec (Ada, no detalhamento)

O spec da issue ganha a seção abaixo, preenchida. É a entrada do protótipo e do plano.

```markdown
## No chat

| Ação (id) | O que faz | Risco | cartaoNoChat | Estado | Em que bot |
| --- | --- | --- | --- | --- | --- |
| `dominio.verbo` | frase curta | muda | não | vivo | todos / só o Nod, em conversa e criação |

**Como a pessoa pede** (2–3 falas reais, de jeitos diferentes):
- "…"
- "…"

**O cartão:** `cartaoNoChat` é declarativo (nada o lê em runtime; ex.: `bots.excluir` tem `sim` e, no lote em
"Ignorar todas as aprovações", roda sem cartão); o cartão que aparece sai do risco × modo (`muda` segue o modo do bot; `arriscada` vira cartão no manual e no automático; `pessoa_confirma` é
sempre da pessoa, também em "Ignorar todas as aprovações").
**Risco:** por que esse risco, e o que muda depois de conteúdo de fora (cerca 3 da ADR-082), se mudar.
```

E o critério de aceite fixo, copiado igual:

> - [ ] Dá para fazer pelo chat com qualquer bot: a mesma ação pela tela e pelo chat chega ao mesmo estado, com o
>   cartão que o risco e o modo pedem.

**"Qualquer bot"** = todo bot cujo plano de turno (`montarPlano` em `src/domain/plano-turno.ts`) recebe a ferramenta
da ação, nos modos de turno em que ela entra. Entre as ferramentas de ação, hoje há duas exceções: as
`FERRAMENTAS_DO_NOD` (ex.: `gerir_bots`) só entram no turno do Nod, e só em conversa e criação
(`MODOS_DAS_MAOS_DO_NOD`); `criar_bots` só entra nos outros bots, também só em conversa e criação.
O critério fica igual: é a coluna "Em que bot" que diz o bot e o modo, e o QA testa por ela.

**Quando não usar o critério fixo:** sem ação nova, a seção vira a linha "No chat: nenhuma ação nova" e o critério
não entra. A ação em `falta` ou `nunca` diz a onda ou o motivo na tabela e fica fora do critério. A ação em `parcial`
fica fora também ("mesmo estado" é falso por definição) e escreve a divergência na tabela.

## 3. Protótipo (Gil)

A jornada do protótipo mostra **os dois caminhos** para cada ação da seção "No chat":

1. **Pela tela:** o clique, como sempre.
2. **Pela conversa:** a fala da pessoa (uma das falas do spec), a resposta do bot, o **cartão** (quando o risco e o
   modo pedem) e o **resultado** (o mesmo estado final da tela, visto na tela).

O Gil trabalha no `nod-prototipos` e lê esta skill da main do nod (o `fetch` antes, para não ler um `origin/HEAD` velho):
`git -C ~/nod/.clones/gamefik/nod.git fetch -q origin && git -C ~/nod/.clones/gamefik/nod.git show origin/HEAD:.claude/skills/acao-no-chat/SKILL.md`.
Sem ação nova, o protótipo não precisa do caminho pela conversa.

## 4. Plano e QA (Faustino)

O plano de engenharia ganha a seção **"Ações"**, uma linha por id da seção "No chat":

```markdown
## Ações

- `dominio.verbo` — registro: `src/domain/acoes/<dominio>.ts` (titulo, risco, cartaoNoChat, schema, casoDeUso,
    chat com via e contrato)
  · rota: `Rota.acao` em `src/adapters/http/rotas/<arquivo>.ts`
  · executor único: `src/use-cases/acoes/<dominio>.ts`, na tabela id → executor, chamado pela rota e pela ferramenta
  · ferramenta: qual, e em que bot: schema em `src/contracts/ferramentas-nod.ts` (ou no arquivo do domínio espalhado
    em `FERRAMENTAS_NOD`; as só do Nod em `src/contracts/ferramentas-do-nod.ts`), nome em `NOMES_FERRAMENTAS_NOD`,
    caso de uso em `USE_CASE_POR_FERRAMENTA` (`src/contracts/servicos.ts`), despacho em
    `src/use-cases/chamar-ferramenta.ts`, rótulo (opcional) em `src/domain/rotulo-ferramenta.ts` (e o que os testes
    das ferramentas pedirem: `ESPERADAS`, `DESPACHO`); entra no turno por `src/domain/plano-turno.ts`
    (`FERRAMENTAS_NOD_POR_MODO` = todo bot, por modo; `FERRAMENTAS_DO_NOD` = só o Nod, somado; a só do Nod entra nos dois `FERRAMENTAS_DO_NOD`, o de schemas e o do plano)
  · cartão: no lote, sai do registro; fora dele, como no item da regra, com a proposta que o mostra (um `TipoDecisao`
    de `src/contracts/decisao.ts` reusado, ou um novo com migração e cartão na web), e o teste do cartão por risco e modo
    (`pessoa_confirma` no total; `arriscada` no automático, na conversa)
  · lote (só se entra no `gerir_bots`): lote.tipo = via.tipoNoLote, `riscoDe`/`deFora` se o risco muda com o argumento
    ou depois de conteúdo de fora, o tipo em `TIPOS_ACAO_LOTE` e o `case` em `src/use-cases/gerir-bots.ts`
  · contrato: `tests/integration/paridade-<dominio>.test.ts` (tela e chat → mesmo estado no banco)
  · piso: `docs/paridade.piso.json` sobe N
```

Tudo no **mesmo PR** (registro, rota, executor, ferramenta, teste de contrato, piso e `npm run paridade`). O modelo é o
piloto `bots.*`: `src/domain/acoes/bots.ts`, `src/use-cases/acoes/bots.ts` e `tests/integration/paridade-bots.test.ts`.
A tabela id → executor do piloto é `EXECUTORES_BOTS`, e o `casoDeUso` da ação é o id; domínio novo cria a sua tabela e,
em `tests/unit/use-cases/acoes-executores.test.ts` (que compara as chaves com o `casoDeUso` das ações `vivo`), troca
`EXECUTORES_BOTS` pela união das tabelas. Hoje a união é `EXECUTORES` (`src/use-cases/acoes/index.ts`: `bots.*` e
`quadro.*`); domínio novo entra nela.
Efeito fora do banco vai em `Deps.aposCommit` (ADR-135 §4); efeito de tipo novo entra na união `EfeitoAposCommit` e
ganha o seu ramo em `rodarAposCommit` (`src/adapters/http/compor.ts`), que hoje desliga o computador, limpa o computador removido e traz a
importação do Linear em segundo plano. Tabela de
executores ou efeito novo também atualizam o "hoje" desta skill e o teste dela (`tests/unit/skills/acao-no-chat.test.ts`).
Ação que fica `falta` não sobe o piso e diz a onda. Ação `parcial` ou `nunca` leva registro e rota, e a linha diz a
divergência ou o motivo.

Antes do push: `npm run paridade` (regera o `docs/paridade.md`) e o `npm run check` (a catraca roda nele).

**QA testa os dois caminhos**, por id: o clique na tela e o pedido no chat (uma das falas do spec, com o app real, no
bot da coluna "Em que bot"), e confere que o estado final é o mesmo, que o cartão aparece só quando o risco e o modo
pedem e que o modo "Ignorar todas as aprovações" não pula o `pessoa_confirma`. Um caminho sem prova entra em "o que ficou
sem prova" no resumo.

Sem ação nova: o plano escreve "Ações: nenhuma ação nova" e o QA testa só a tela.
