# ADR-118 — Site de marketing em Cloudflare Workers static assets

Status: aceita · Data: 2026-10-22 · NOD-321 · Substitui o site Vite de `site/` (28/09).

## Contexto

O Mateus escolheu a w4 (Orquestrador de Sites) como site de nodbot.ai, sem repositório novo. A w4 é um HTML único
com CSS e JS inline, sem requisição externa. O `site/` tinha um site Vite antigo com lista de interesse que nunca foi
ligada (`VITE_NOD_WAITLIST_URL`). O app roda na GCP (`app.nodbot.ai`, Caddy, DNS only) e não pode ser afetado. O
domínio está na Cloudflare, onde o Worker `nodbot-site` já foi criado com a w4 (noindex).

## Decisão

1. `site/` passa a ser a pasta publicada, **sem build**: a w4 em `index.html` (só o head muda), `404.html`,
   `_headers`, `_redirects`, `robots.txt`, `sitemap.xml`, ícones e `og.png`. Saem o site Vite, os scripts `site:*` e
   o `site:build` da CI; `site` entra no `.dockerignore`.
2. O site fica **fora da GCP**, no Worker `nodbot-site` com static assets (`site/wrangler.jsonc`,
   `assets.directory: "."`, `not_found_handling: "404-page"`), publicado por `npx wrangler deploy -c site/wrangler.jsonc`.
   Não usa a integração Git do Pages: sem token no repo e sem build remoto do monorepo.
3. O noindex mora num ponto só, `X-Robots-Tag: noindex` em `site/_headers`, até a NOD-322 trazer os links finais.
4. CSP `default-src 'none'` com `'unsafe-inline'` só para script e style (a w4 é toda inline): a página não pode
   carregar nada de fora. HSTS sem `includeSubDomains`, para não amarrar o `app`.
5. O contrato é guardado por `tests/unit/site/site-estatico.test.ts` no job unit.

Alternativas: Pages com integração Git (descartada no adendo de 21/10: o Pages virou parte do Workers e o Worker já
existia); servir pelo Caddy do app (acopla o site ao deploy do app e à VM).

## Consequências

- Deploy é manual (quem tem o wrangler logado), sem preview automático por PR: QA no `wrangler dev` ou num
  `wrangler versions upload`.
- Push na main que só muda `site/` ainda dispara o `deploy.yml` do app (já acontecia; fora do escopo).
- Imagens sem hash no nome ficam 1 dia em cache: trocar `og.png` exige nome novo.

## Gatilho de reversão

Rever se o site passar a precisar de build ou de backend (formulário, lista, analytics), se o deploy manual
atrasar publicações (aí entra um job no GitHub Actions com token só de Workers, rodando quando `site/**` mudar), ou
se a Cloudflare deixar de servir o domínio.
