# site/ — site de marketing do nod (nodbot.ai)

A versão **w4 · Wordmark gigante**, aprovada pelo Mateus e pelo Orquestrador de Sites (NOD-321). É uma pasta
estática servida **como está** pelo Worker `nodbot-site` da Cloudflare (static assets). Não tem build, framework
nem dependência: o `index.html` traz CSS e JS inline e não faz nenhuma requisição externa. Decisão em
[ADR-118](../docs/adr/adr-118-site-marketing-cloudflare-workers.md).

| Arquivo | O que é |
|---|---|
| `index.html` | A w4. Só o `<head>` difere do arquivo aprovado (canonical, ícones, OG, Twitter; sem meta robots). |
| `404.html` | Resposta de qualquer caminho que não existe, com status 404 (`not_found_handling: "404-page"`). |
| `_headers` | Segurança, cache e o interruptor do noindex (abaixo). |
| `_redirects` | `/download/mac` e `/download/mac-intel` → .dmg e `/download/windows` → .exe (ADA-226) no bucket `nodbot-downloads` (302). |
| `robots.txt`, `sitemap.xml` | Tudo liberado; sitemap só com a home. |
| `og.png` | Prévia de link 1200×630 (hero da w4). Para trocar, use um **nome novo**: fica 1 dia em cache, e Slack/WhatsApp guardam a prévia. |
| `favicon.svg`, `icon-192.png`, `apple-touch-icon.png` | Copiados de `web/public`. |
| `wrangler.jsonc`, `.assetsignore` | Config do Worker. O `.assetsignore` impede que `wrangler.jsonc`, este README e o `.wrangler/` do `wrangler dev` subam. |

O teste `tests/unit/site/site-estatico.test.ts` (roda no `npm run test:unit`) guarda esse contrato.

## Ver local

```sh
npx wrangler dev -c site/wrangler.jsonc
```

Abre em http://localhost:8787 e aplica `_headers`, `_redirects` e o 404 como em produção, sem conta Cloudflare.
Confira com `curl -I http://localhost:8787/` e o console do Chrome (nenhuma violação de CSP).

## Deploy

Da raiz do repo, com o wrangler logado na conta do Worker (account `896acdae7be7fd3878d47d927a1b9471`):

```sh
npx wrangler deploy -c site/wrangler.jsonc
```

Publica a pasta `site/` em https://nodbot-site.nodbot.workers.dev (e em nodbot.ai, depois que o domínio for ligado).
Não há deploy automático nem preview por PR: para testar antes do merge, use o `wrangler dev` local ou
`npx wrangler versions upload -c site/wrangler.jsonc`, que devolve uma URL de versão sem mexer na produção.
O `deploy.yml` do app não toca nesta pasta (ela está no `.dockerignore`).

## Interruptor do noindex

O noindex mora num ponto só: a linha `X-Robots-Tag: noindex` em `site/_headers`. O HTML **não** tem
`<meta name="robots">`. Para liberar a indexação (quando a NOD-322 fechar: links reais, vídeo e sem `data-pend`),
apague essa linha e o comentário acima dela num PR pequeno. O teste 1 falha se a página ainda tiver `href="#"` ou
`data-pend` sem o noindex.

## Checklist B — quem tem a conta Cloudflare

Depois do merge do PR A, e o domínio só depois da NOD-322.

0. Anotar a saída de `curl -sI http://app.nodbot.ai` e `curl -sI https://app.nodbot.ai` (baseline). **Não editar o registro `app`.**
1. Confirmar que a zona nodbot.ai está ativa na mesma conta do Worker `nodbot-site`.
2. ~~App do Pages no GitHub~~ — não se aplica (deploy por `wrangler deploy`).
3. ~~Projeto Pages~~ — não se aplica: o Worker `nodbot-site` já existe.
4. Rodar `npx wrangler deploy -c site/wrangler.jsonc` e conferir `https://nodbot-site.nodbot.workers.dev/`: 200, a w4 e os cabeçalhos no `curl -I`.
5. Em Workers & Pages → `nodbot-site` → Settings → Domains & Routes, adicionar o Custom Domain `nodbot.ai`. Esperar o certificado ativo.
6. No DNS, criar `A www 192.0.2.1` com proxy ligado. Em Rules → Bulk Redirects, lista com origem `www.nodbot.ai`, destino `https://nodbot.ai`, 301, com Preserve query string, Subpath matching e Preserve path suffix ligados; criar e **ativar** a regra.
7. Não ligar HSTS na zona e não mexer no modo SSL nem no proxy do `app`.
8. Verificar:
   - `curl -sI https://nodbot.ai/` → 200 com os cabeçalhos; `http://nodbot.ai/` → https.
   - `https://www.nodbot.ai/a?x=1` e `http://www.nodbot.ai/a?x=1` → 301 para `https://nodbot.ai/a?x=1`.
   - `/robots.txt`, `/sitemap.xml` e `/og.png` → 200; `/nao-existe` → 404; `/download/mac` → 302.
   - md5 da home igual ao de `site/index.html`.
   - app.nodbot.ai responde igual ao passo 0.
9. Só com o OG final, colar nodbot.ai no Slack, no WhatsApp e num validador OG (ex.: opengraph.xyz).
