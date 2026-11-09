# ADR-057 — Marketplace com o catálogo público do Composio

Status: aceito · Data: 2026-09-29 · Revê o item 3 do [ADR-041](adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md)
(catálogo vindo do provedor). Os itens 1, 2, 4, 5 e 6 continuam valendo.

## Contexto

Em 2026-09-29, o Marlon pediu: "o composio tem centenas de apps mas o meu marketplace mostra apenas
alguns. Quero mostrar todos". A grade tinha 12 apps: os 11 auth configs do painel e o GitHub nativo. O
motivo é o item 3 do ADR-041: a grade é o `GET /auth_configs`, ou seja, o que alguém configurou no painel.

Esse item partiu de uma premissa: "Notion, Linear e Google Sheets estão no array e não têm auth config no
Composio. Apareciam como 'Conectar' e nunca conectariam". A documentação do Composio, lida em 2026-09-29,
diz outra coisa (páginas "Managed Auth" e "Authentication" das sessions):

- **123 toolkits têm login gerenciado pelo Composio.** O Composio mantém o app OAuth, e a sessão conecta
  sem auth config nenhum no painel. O campo que diz isso é `composio_managed_auth_schemes`, no
  `GET /toolkits`.
- **189 toolkits exigem OAuth próprio.** Sem auth config no painel, a sessão devolve erro pedindo um.
- **O total é 312.**

A premissa valia para os 189, não para os 123. Os números acima são da documentação. O que a grade mostra
com a chave do tenant está em "Medido".

## Decisão

1. **A grade mostra o painel mais o catálogo público com login gerenciado.** O `catalogo()` continua lendo
   `/auth_configs`. Um `gerenciados()` novo lê `GET /toolkits?limit=1000` (segue o `next_cursor` até 5
   páginas) e fica só com o toolkit que tem `composio_managed_auth_schemes` não vazio. Saem também o
   `no_auth` (não há login a fazer, e conectar aqui termina numa conta conectada), o `is_local_toolkit` e
   o `type: "custom"` (o customizado, com auth config, já vem do painel).
2. **Os 189 sem login gerenciado ficam fora.** Um botão "Conectar" que dá erro é o problema que o ADR-041
   veio corrigir. Quem quiser um deles cria o auth config no painel, e ele aparece em até um minuto, pelo
   caminho de sempre.
3. **Toolkit com `_` no slug fica fora.** O slug vira o slug do conector, e `registrarConector` só aceita
   `[a-z0-9-]` (`src/use-cases/registrar-conector.ts`), assim como as rotas `/marketplace/:slug/conectar`
   e `/verificar`. Sem esse filtro, o cartão apareceria e o clique daria 404.
4. **Duas seções na tela.** Em cima fica o dia a dia: a curadoria, o painel e o GitHub nativo. Os apps
   curados que só existem no catálogo público (Notion, Linear, Sheets) voltam para cá com o nome em
   português. Embaixo vem **"Mais apps · N"**, com o resto em ordem alfabética, marcado `doCatalogo`. Um
   app de "Mais apps" que a pessoa conecta sobe para a grade de cima. Enquanto conecta, fica onde foi
   clicado. A busca que já existia cobre as duas seções, e "Mais apps" some quando a busca não deixa
   nenhum cartão dela. Isso atende o gatilho do ADR-041 ("mais de ~40 itens: … precisa de filtro ou
   paginação") com busca e seção, sem paginação.
5. **O app sem curadoria mostra a descrição do provedor, em inglês.** Ela é cortada em 160 caracteres, na
   palavra. A categoria sai em português por uma tabela de palavras (`categoriaEmPortugues`), e o que não
   casa vira "Integrações". A descrição padrão em português repetida em ~100 cartões não diria nada. Com
   ela, a busca por "crm" não acharia o HubSpot.
6. **Os dois catálogos têm caches separados, e um não derruba o outro.** O painel continua com janela de
   60 s. O catálogo público fica com janela de 1 h, porque muda quando o Composio lança um toolkit e é a
   resposta pesada. Se o catálogo público falhar, a grade fica com o painel e o último catálogo público
   bom (log `marketplace_catalogo_publico_falhou`). Se o painel falhar, a grade continua caindo no piso
   curado, como antes. O cache saiu de `rotas/conectores.ts` para `src/adapters/integracoes/catalogo-composio.ts`,
   e a rota de conectar lê o mesmo cache. Assim, o conector de um app do catálogo nasce com o nome que a
   grade mostrou ("HubSpot"), não com o slug.
7. **O modelo continua vendo só a curadoria (item 5 do ADR-041).** `pedir_acesso` para um app que não foi
   curado nem conectado continua recusado. Depois de conectado pela tela, o app é um conector como
   qualquer outro, e o pedido de acesso vale.

## O que isso custa

- Cerca de 100 cartões a mais na página. O logo de cada um passa pelo proxy do servidor (ADR-041 §6), com
  `loading="lazy"`: só os cartões visíveis buscam.
- Uma chamada pesada ao Composio por tenant por hora, feita no primeiro GET `conectores` depois que a
  janela vence. A pessoa que abre a tela nesse momento espera por ela.
- Descrições em inglês no meio de uma tela em português, até alguém curar o app.

## Alternativas descartadas

- **Mostrar os 312** (a opção B do pedido), com "Configure no painel" no lugar de "Conectar" para os 189.
  Mostraria tudo, mas um terço da grade seria vitrine sem ação, o que o ADR-041 tirou de propósito.
- **Filtrar com `managed_by=composio` no provedor.** A documentação descreve o parâmetro como "quem gerencia
  o toolkit", sem dizer se é o login. O campo `composio_managed_auth_schemes` é o que a página "Managed
  Auth" manda conferir, então o filtro é nosso.

## Gatilho de reversão

- **Dois apps de "Mais apps" falharem ao conectar pedindo auth config** (erro em `criarSessao` ou
  `autorizar` para um slug `doCatalogo`). Isso prova que `composio_managed_auth_schemes` não basta, e a
  grade volta ao painel mais uma lista conferida.
- **O `GET /api/conectores` com o catálogo público frio passar de 2 s**, medido na tela com a chave real.
  Nesse caso, a busca vai para um laço de fundo em vez de rodar na abertura da tela.
- **Nenhum app de "Mais apps" conectado em 30 dias** (conectores cujo slug não está em `APPS_MARKETPLACE`
  nem no painel). A seção é ruído, e passa a abrir fechada.

## Medido

Medido em 2026-09-29, com o servidor desta mudança na 5274 e a chave do tenant padrão, por
`GET /api/t/<tenant>/conectores` (login stub):

- **104 apps na grade:** 12 no dia a dia e 92 em "Mais apps". O Notion, o Linear e o Google Sheets
  voltaram ao dia a dia. Os 92 já descontam os filtros dos itens 1 a 3.
- **Todos os 104 com logo, de `logos.composio.dev/api/<slug>`.** O proxy devolveu o do Airtable como
  `image/svg+xml`, 1262 B.
- **Resposta sem cache: 0,77 s. Com cache: 0,06 s.** O gatilho de 2 s está longe.
- **Categorias dos 92:** Vendas e marketing 15, Comunicação 13, Produtividade 10, Projetos 9,
  Desenvolvimento 9, Finanças 9, Conhecimento 7, Design e mídia 6, Dados 5, E-commerce 2, Pessoas 1,
  Atendimento 1. Só 5 caíram em "Integrações".

Não medido: conectar de fato um app de "Mais apps". Esse é o primeiro gatilho de reversão.

## Fora deste ADR

- O `github_mcp` do painel tem `_` no slug e continua aparecendo pela curadoria. Pela regex da rota
  `[a-z0-9-]+`, o clique em "Conectar" não casa e dá 404, como já acontecia antes. Corrigir isso é mexer
  no slug do conector, e fica para uma decisão própria.

## Logos oficiais (2026-09-29)

**Nenhum logo do provedor chegava à tela.** A web pedia `/api/marketplace/:slug/logo`, sem o tenant, e a
rota só existe escopada (`/api/t/:tenant/marketplace/:slug/logo`, ADR-005). Toda busca dava 404 e o
`onerror` tirava a imagem. Por isso a grade mostrava símbolos desenhados à mão (✣, ⌘, "31"…) e iniciais,
inclusive antes deste ADR. A correção: `logoApp` recebe o estado e monta a URL com o tenant da sessão, como
`conversa.ts` já faz nos anexos. Os símbolos saíram. Sem logo, o cartão mostra só a inicial do nome.

**Comparação dos 104.** Medido em 2026-09-29. Cada logo que o Composio serve foi posto ao lado do ícone
que a própria marca publica no próprio site (`link rel=icon`/`apple-touch-icon`). Para os produtos do
Google, a comparação foi com o CDN de marca que o `workspace.google.com` usa. Cerca de 90 bateram. Em 10, o
logo do Composio é antigo ou de outra marca, e a web usa o arquivo da própria marca, guardado em
`web/public/logos/`. Nenhum arquivo foi desenhado ou editado: o único ajuste foi trocar as variáveis CSS
dos SVGs da Atlassian pela cor padrão que o próprio SVG declara.

| App | O Composio servia | Arquivo oficial (fonte) |
|---|---|---|
| Google Sheets | versão anterior de 2026 | `gstatic.com/images/branding/productlogos/sheets_2026q3/v1/web/192px.svg` |
| Jira | o "A" da Atlassian | `@atlaskit/logo` 23.3.1, pacote oficial da Atlassian, `artifacts/logo-components/jira/icon.js` |
| Confluence | o "A" da Atlassian | idem, `confluence/icon.js` |
| Bitbucket | balde azul, anterior à marca de 2025 | idem, `bitbucket/icon.js` (o mesmo desenho do `bitbucket.org/favicon.ico`) |
| Linear | círculo lilás antigo | `linear.app/static/favicon.svg` |
| Basecamp | montanha verde antiga | `basecamp.com/assets/images/general/favicon.svg` |
| Harvest | barras laranja antigas | `getharvest.com/hubfs/Harvest_2026.svg` |
| FreshBooks | variante preta | `freshbooks.com/_next/static/media/freshbooks-icon.c24773ec.svg` |
| Dynamics 365 | o logo da Microsoft | `learn.microsoft.com/en-us/media/logos/logo_dynamics.svg` |
| Prisma | triângulo antigo | `prisma.io/icon.svg`, o mesmo símbolo do logo do cabeçalho do site (`/logo/full-color.svg`) |

Ficaram com o do Composio:

- **Zoom.** O ícone atual ("zm") só existe oficialmente em 32 px. O kit de imprensa tem só o logo por
  extenso, 1426×321, largo demais para o cartão. O do Composio é o ícone oficial da versão anterior.
- **Google Photos, Ads e BigQuery.** Não há versão 2026 no CDN do Google.
- **Excel e Outlook.** O site da Microsoft serve o favicon da empresa, e o do Composio é o do produto.

**Gatilho de revisão:** uma marca trocar o ícone e o arquivo guardado ficar para trás do que ela mesma
publica. A lista de slugs com arquivo próprio mora em `LOGOS_OFICIAIS` (`web/telas/marketplace.ts`), e
`tests/unit/web/logo-app.test.ts` confere que cada um existe em `web/public/logos/`.
