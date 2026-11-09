# ADR-041 — Chave Composio do tenant, catálogo vindo do provedor

Definido em 2026-09-21. Reverte, em duas frases, o §Integrações da
[ADR-033](adr-033-criacao-conversacional-marketplace-intervalos.md); o resto daquele parágrafo
continua valendo palavra por palavra.

Quatro apps novos (Supabase, Sentry, Google Drive e um GitHub MCP próprio) foram configurados no
painel do Composio em 2026-09-21 e **não apareceram no Marketplace**. Não havia como aparecerem: o
catálogo é o array `APPS_MARKETPLACE` em `src/contracts/marketplace.ts`, escrito à mão em
2026-09-17, e o nod nunca pergunta ao provedor o que existe. O único toque em `/toolkits`
(`composio.ts:27`) é `?limit=1`, health-check da chave.

A mesma inspeção mostrou o inverso: **Notion, Linear e Google Sheets estão no array e não têm auth
config no Composio**. Apareciam como "Conectar" e nunca conectariam. O array e o provedor
divergiram nos dois sentidos em quatro dias.

## Decisão

1. **A chave do projeto Composio é do tenant, não da pessoa.** `composio_configuracoes` passa a
   `UNIQUE (tenant_id)` e `CHECK (visibility = 'equipe')`. Uma pessoa configura; todo o tenant lê.
   Ninguém mais cola chave para ver o Marketplace.
2. **Qualquer pessoa do tenant troca a chave.** O padrão da 0004 é "'equipe' só abre LEITURA";
   uma policy PERMISSIVE a mais (`nod_equipe_update`, FOR UPDATE) abre a escrita, registrada por
   nome em `POLICIES_EXTRAS` do gate. Sem ela, quem criou a linha é a única que troca — e quando
   essa pessoa sai, a troca exige `nod_dono`.
3. **O catálogo exibido vem de `GET /auth_configs`**, não do array: o que a pessoa configurou no
   painel, não o catálogo público do provedor (centenas de toolkits). Cache em memória com TTL
   curto; a falha da chamada cai no array estático, que deixa de ser a verdade e vira o piso.
4. **Sessões e contas continuam por pessoa.** `composio_sessoes` não muda: `visibility = 'privado'`,
   `UNIQUE (tenant_id, owner_id, toolkit)`, usuário remoto `nod:<tenant>:<pessoa>`. Compartilhar o
   catálogo não é compartilhar login: cada pessoa segue autorizando o próprio Slack.
5. **O que o modelo vê continua curado.** `prompt-sistema.ts` e `pedir-acesso.ts` seguem lendo a
   lista escrita à mão. `src/domain` é puro e não faz I/O (`tsconfig.domain.json`), e um auth config
   com zero conexões não é capacidade: anunciá-lo ao modelo produz promessa que o proxy nega.
6. **Logo por proxy do servidor**, `GET /api/marketplace/:slug/logo`, com a inicial do nome como
   piso. URL de CDN direta no `<img>` faria o browser de cada pessoa contar ao provedor quais apps
   o time abre, e a linha do §Integrações — *"nunca devolvida à web ou ao modelo"* — existe porque
   aqui quem fala com o Composio é o servidor.

## O que isso custa, e por que aceitamos

A chave deixa de ser de uma pessoa e passa a abrir todas as integrações do tenant. Hoje ela viaja
cifrada para o `env` do conector MCP (`rotas/marketplace.ts:39-42`): o estrago de um vazamento sai
de uma pessoa para a organização inteira. Aceitamos porque o nod é ferramenta interna de um time pequeno
com **uma** conta Composio, e porque a alternativa — cada pessoa colando a própria chave — é
exatamente o que o pedido de 2026-09-21 recusou.

Descartada: **catálogo de equipe com chave privada** (tabela nova só de `{slug, nome, logo}`, sem
segredo). Preservava a ADR-033 inteira e dava a visibilidade pedida, mas quem não tivesse chave
veria os apps sem conseguir conectar — visibilidade sem capacidade.

## Gatilho de reversão

Qualquer um destes reabre a decisão:

- Duas contas Composio distintas passarem a conviver no mesmo tenant (ex.: um time com projeto
  próprio) — `UNIQUE (tenant_id)` passa a recusar o segundo cadastro.
- Uma rotação de chave do Composio derrubar as integrações de mais de uma pessoa ao mesmo tempo:
  é a prova de que o raio do vazamento virou concreto, e a chave volta a ser por pessoa ou sai
  para variável de ambiente.
- O `GET /auth_configs` devolver mais de ~40 itens: a grade deixa de ser navegável e o catálogo
  precisa de filtro ou paginação, não de mais cache.
- A tela ficar visivelmente mais lenta que o array estático: medir antes de resolver com cache
  mais longo, que troca lentidão por catálogo velho — o problema que este ADR veio corrigir.

## Fase de testes (2026-09-21)

Enquanto o produto roda só para uma pessoa, o formulário de chave **continua visível para todos**,
em vez de aparecer só quando o tenant não tem chave: a troca frequente durante o desenvolvimento
vale mais que a tela limpa. Quando o time entrar de verdade, esconder para quem já tem chave no
tenant é uma linha em `web/telas/marketplace.ts`.

## Revisto em 2026-09-29 ([ADR-057](adr-057-marketplace-com-o-catalogo-publico-do-composio.md))

O item 3 ficou mais largo. A grade agora é o `GET /auth_configs` **mais** o catálogo público com login
gerenciado pelo Composio (`composio_managed_auth_schemes` no `GET /toolkits`), este numa seção "Mais
apps". A premissa do contexto ("Notion, Linear e Google Sheets … nunca conectariam") vale só para os
toolkits sem login gerenciado. Segundo a documentação do provedor, esses três têm login gerenciado. O
gatilho "mais de ~40 itens" foi atendido com seção e busca, sem paginação.
