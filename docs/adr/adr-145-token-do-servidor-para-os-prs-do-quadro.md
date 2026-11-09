# ADR-145 — Um token do servidor só de leitura para os PRs do quadro, escopado por uma lista de tenants

Status: Proposta: aguarda 🧭 da Ada/Marlon antes de ligar em produção (2026-11-02, NOD-421, 3ª revisão do PR #621) · Emenda [ADR-048](adr-048-github-um-conector-varios-jeitos-de-conectar.md)
(o servidor passa a ter uma credencial GitHub própria, fora do conector, só para este laço).

## Contexto

A NOD-421 liga os PRs do GitHub às tarefas do quadro: um laço de fundo lê os PRs dos repos de
`NOD_QUADRO_GITHUB_REPOS` a cada 30 s e os casa com as tarefas pelo id no branch ou pelo `pr_url`. A ADR-048 diz que o
GitHub é um conector por pessoa e que o servidor não roda o jeito `gh`. Esse conector ainda não serve a um laço de fundo:
nenhum jeito dele (gh do Mac, token pessoal, Composio, App da organização) existe por tenant num formato que o laço possa
ler sem turno. A imagem de produção não tem o `gh`.

A saída provisória é um token global do servidor (`NOD_QUADRO_GITHUB_TOKEN`, segredo `nod-github-quadro-token`). Ele lê
o repo privado `gamefik/nod`. Sem trava, qualquer tenant com o quadro ligado e um `NOD-…` no branch veria repo, número,
CI e estado desses PRs. A 1ª revisão pôs a lista de tenants só no jeito token. A 2ª mostrou que o `gh` de um servidor
compartilhado, ou um `GH_TOKEN` no ambiente, é a mesma credencial do servidor com outro nome.

## Decisão

1. **Token global do servidor, só de leitura.** Fine-grained com Pull requests, Commit statuses, Checks e Metadata em
   leitura, restrito aos repos da lista (ou o token de instalação de um GitHub App). Só o laço o usa: nunca vai a turno,
   ferramenta, URL ou log (`fonteApi` o põe só no cabeçalho, recusa redirect e devolve só o código do erro).
2. **Escopo pela allowlist de tenants.** Só os tenants de `NOD_QUADRO_GITHUB_TENANTS` (uuids) recebem a leitura. Vale
   em **qualquer** jeito: token da API, `gh` com `GH_TOKEN` (tratado como token do servidor) e `gh` logado na máquina.
3. **Lista vazia = nenhum tenant.** O laço nem sobe (`planoPrsDoQuadro` devolve null e loga
   `prs_do_quadro_sem_tenants`), em qualquer modo, inclusive o pessoal. A revisão aceitava abrir tudo no `gh` local do
   modo pessoal; preferimos fechar sempre: o custo no desenvolvimento é uma linha a mais no `.env` (o `TENANT_PADRAO`
   do seed, no `.env.example`), e o mesmo código não depende de saber se a máquina é "pessoal".
4. **Dentro do tenant, o RLS de sempre.** O caso de uso roda escopado por pessoa (`paraCadaPessoa`); só casa com as
   tarefas da pessoa, e a gravação é `insert … select` da tarefa da dona (a FK não passa pelo RLS). PR de fork
   (`isCrossRepository`) nunca casa: qualquer um abre um fork com `nod-421` no branch.

## Consequências

- Todas as pessoas de um tenant da lista veem os PRs dos repos configurados que casarem com tarefas delas. A lista é
  decisão de quem opera o servidor, em `infra/gcp/config.env`. Hoje ela está **vazia** (a decisão é proposta): nenhum
  tenant sincroniza em produção, e o `deploy.sh` ainda a esvazia sem o segredo `nod-github-quadro-token`. O candidato é
  o tenant "Nod" (`172e1fdf-…`), que entra junto com o 🧭.
- Dev local precisa de `NOD_QUADRO_GITHUB_TENANTS` além de `NOD_QUADRO_GITHUB_REPOS`; sem ela o boot diz por que não subiu.
- A base da API do token é própria (`NOD_QUADRO_GITHUB_API`, padrão `https://api.github.com`, só https; 4ª revisão do
  PR #621): mexer na `NOD_GITHUB_API` do conector não leva o token do servidor para outro host.
- O laço não sabe quem é a pessoa no GitHub: alguém do tenant pode ver um PR que, no GitHub, não poderia. Aceito
  enquanto o tenant listado é o dono do repo.

## Gatilho de reversão

- **O conector GitHub por tenant existir** (app > token > composio, legível por um laço de fundo): o laço passa a usar
  a credencial de cada tenant, o token global e `NOD_QUADRO_GITHUB_TENANTS` saem.
- Antes disso, revisar se: entrar na lista um tenant que não é dono de todos os repos de `NOD_QUADRO_GITHUB_REPOS`, ou
  o token ganhar qualquer permissão de escrita.

## Pendências (3ª revisão do PR #621)

- **Ligar exige: secret + tenant na lista + 🧭.** Enquanto a decisão é proposta, o laço fica desligado em produção:
  `infra/gcp/config.env` traz `NOD_QUADRO_GITHUB_TENANTS=` vazio, e o `deploy.sh` esvazia a lista quando o segredo
  `nod-github-quadro-token` não existe (REPOS ligada sem token e sem tenants = o laço não sobe;
  `tests/integration/deploy-config.regression-1.test.ts`).
- **Alternativa levantada: ler pelo conector da pessoa.** Em vez do token global, o laço leria com a credencial GitHub de
  cada pessoa (`configGithubNativo`/`criarCofreDeTokensDoApp`), com uma `FontePrs` por escopo: cada pessoa só vê o que a
  conta dela no GitHub vê, e a lista de tenants sai. Custo: N leituras por volta (uma por pessoa conectada, não uma por
  repo) e o caso "pessoa sem conector" vira aviso por pessoa. `FontePrs` já é injetável, então a troca não mexe no caso
  de uso. A decisão entre as duas é do 🧭.
- **Risco: membros do tenant podem não ser colaboradores do repo.** O token é do servidor; quem está num tenant da lista
  vê repo, número, estado, CI e conflito dos PRs que casarem com as tarefas dele, mesmo sem acesso ao repo no GitHub. Só a
  alternativa acima fecha isso; com o token global, o mitigador é listar apenas tenants em que todos são colaboradores.
