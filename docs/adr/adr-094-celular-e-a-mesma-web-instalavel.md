# ADR-094 — O Nod no celular é a mesma web, instalável, servida pelo mesmo servidor

**Status** aceito · decidido e implementado em 2026-10-10 (o Marlon pediu o Nod no celular apontando para a produção,
https://203-0-113-100.sslip.io; a versão do PR #99 só tinha funcionado servida pelo servidor local via ngrok)

Substitui o PR #99 (`codex/nod-mobile`, que nunca entrou na main). Mantém a ADR-018 (a web só pede, nunca executa), a
ADR-016 (SSE com `since` e reidratação por REST) e a ADR-030 (login Google com allowlist).

## Contexto

O #99 fez uma PWA para iPhone e Android, testada pelo Marlon num túnel ngrok para o servidor do Mac. Ela saiu da main de
30/09, e a main reescreveu depois quase tudo o que ela tocava (barra, gaveta do bot, Tasks, rolagem, onboarding,
ligação). A PWA nunca chegou à produção: aberto no celular, o endereço de produção mostrava a tela de computador, com a
barra de bots ocupando metade da tela. "Só conectava no local" não era host fixo no cliente, que sempre usou caminhos
relativos. Era o código mobile que só existia naquela branch.

A revisão do #99 (2026-10-01) pediu para a refação: celular decidido pelo toque e não pela largura; reconectar só quando
a conexão caiu de fato; reler não lidos e pendências na volta; `/assets/*` imutável; um cabeçalho só, sem anel de foco
no toque, sem 🐞 fixo e sem •••.

## Decisão

1. **Uma web só, sem host fixo.** O celular abre a mesma página que o computador, servida pelo mesmo servidor
   (`estatico.ts`). O manifesto (`web/public/manifest.webmanifest`) tem `id`, `start_url` e `scope` iguais a `/`. Quem
   instala de `https://<servidor>` fala com aquele servidor, e um deploy da main chega ao app instalado na próxima
   abertura. Não há app de loja, Capacitor nem push.
2. **Celular = toque E tela de telefone.** A consulta é `CONSULTA_CELULAR` (`web/lib/celular.ts`): sem hover, ponteiro
   grosso, e largura ≤ 600 px (em pé) ou altura ≤ 500 px (deitado). A mesma string está em `web/mobile.css`, e
   `tests/unit/web/celular.test.ts` confere. Janela estreita no Mac continua desktop. O iPad continua com as colunas.
3. **O layout do celular só reorganiza o que existe** (`web/mobile.css`, a última folha):
   (Emenda 2026-11-03, ADA-2, ADR-148: no celular a forma pode mudar — alvo de 44, campo de 16, topo de vidro —, as ações não; `web/celular-base.css` carrega depois de `mobile.css`.)
   - a barra de bots vira gaveta pela esquerda. Ela abre pelo ☰, que entra no próprio cabeçalho da tela (um cabeçalho
     só). Tela sem cabeçalho ganha uma faixa só com o ☰;
   - a conversa ocupa a tela, e a gaveta do bot cobre a tela inteira com o próprio topo;
   - a altura segue o `visualViewport`, então o campo fica colado no teclado do iPhone. No Android,
     `interactive-widget=resizes-content` faz o mesmo;
   - áreas seguras com `env(safe-area-inset-*)`, alvos de toque de 44 px e campos com 16 px de fonte, para o Safari não
     dar zoom sozinho;
   - Enter quebra a linha e a seta envia;
   - o 🐞 "relatar" aparece só depois de um toque na mensagem;
   - abrir uma conversa não abre o teclado;
   - nenhum foco é movido pelo código ao abrir a gaveta, e o toque não deixa anel de foco.
     (Emenda 2026-10-28, NOD-382, ADR-133 item 4: o perfil do bot foca o ‹ ao abrir, e "Mensagem" abre o teclado.)

   (Emenda 2026-10-28, NOD-383.) Exceção registrada: as **Configurações** têm render próprio no celular, decidido por
   `ehCelular()` (`renderEspacoCelular` em `web/telas/espaco.ts`): uma lista estilo Ajustes e cada seção em tela cheia
   com ‹, o detalhe de linha em 1 linha com "Saiba mais" (`comSaibaMais` em `web/lib/linha-config.ts`) e a folha
   "Criar um bot agora?" ao segurar o +. O motivo: 6 seções em abas e linhas com três frases não cabem em 390 px só com
   CSS. Os textos que falam do aparelho passam por `web/lib/aparelho.ts` ("neste aparelho", "Seu Mac"). O conteúdo de
   cada seção é o mesmo do desktop (as mesmas funções `render*`); o desktop não muda. A auditoria
   `scripts/alvos-44px/` (44 px por `elementFromPoint`, sem atalho de teclado, macOS, "este computador" nem banco) guarda
   o celular. Reverter esta exceção se o render do celular divergir do desktop em conteúdo (uma opção que só existe num
   dos dois) ou se uma seção nova não entrar na lista do celular no mesmo PR.
4. **O service worker guarda só o que é público** (`web/public/sw.js`): `/offline.html` e os ícones, num cache
   versionado (`nod-publico-v1`). Ele só atende navegação da mesma origem fora de `/api`: vai à rede e, sem rede, mostra a
   página "sem conexão". API, sessão, SSE, anexos e o HTML/JS do app nunca são copiados nem servidos do cache. Não há
   fila de envio offline. Só o build registra o worker (`web/pwa.ts`), só em contexto seguro e nunca no app do Mac.
5. **Cache HTTP** (`cacheDoArquivo` em `estatico.ts`):
   - `/assets/*` (nome com hash do Vite): `public, max-age=31536000, immutable`;
   - HTML, `sw.js` e manifesto: `no-cache`;
   - ícones e logos: um dia;
   - fontes: uma semana, como antes;
   - tudo com `nosniff`.
   Um `.js` que não existe continua 404 e nunca recebe o HTML do app.
6. **Reconexão só quando caiu ou ficou muda.** Voltar ao app (aba à frente, `focus`, `online`, `pageshow`) chama
   `live.retomar()`. Com o stream aberto e com sinal nos últimos 45 s (`PRAZO_SILENCIO_MS`, 3 pings), não faz nada.
   Aberto e mudo além do prazo, fecha e reabre na hora com o `since`. Caído e esperando o backoff, que chega a 30 s,
   reabre na hora com o `since`. (Emenda 2026-10-15, NOD-254.) Quando o servidor
   não consegue retomar (`resumed:false`), a web relê tudo o que já tinha carregado (`invalidacoesAoRetomar`): não lidos,
   Sua vez, trabalhos, todas as conversas e, com o "A fazer" ligado, as pendências.
7. **Login no celular.** Continua o OAuth Google por navegação na mesma janela (`/api/sessao/google`), sem `window.open`.
   Duas mudanças:
   - a volta bem-sucedida responde com uma página da própria origem que segue para `/` (`PAGINA_ENTROU`), no lugar do
     302. Assim o app nasce de uma navegação do próprio site, e o cookie `SameSite=Strict` vale nela também no Safari;
   - o `nod_sessao` do login Google ganha `Max-Age` de 30 dias (`PERMANENCIA_SESSAO_S`). Sem isso, o iPhone apaga o
     cookie quando o sistema fecha o app instalado em segundo plano. O cookie assinado continua sem validade no servidor,
     antes e depois desta mudança. Isso só muda quanto o aparelho guarda o cookie.

## Alternativas rejeitadas

- **Rebase/merge do #99.** Conflita em sete arquivos centrais da web, e a main mudou o que ele adaptava. As ideias foram
  portadas para o código de hoje.
- **Celular pela largura (`max-width`).** Uma janela estreita no Mac viraria celular, e um celular deitado (844 px) não.
- **Uma barra própria do celular em cima do cabeçalho da tela (#99).** Eram dois cabeçalhos empilhados.
- **Service worker com cache do app (offline completo).** Guardaria conversa e sessão no aparelho e poderia prender um
  build velho depois do deploy. O Nod sem rede não tem o que fazer além de avisar.
- **Capacitor ou app de loja.** Assinatura, revisão da loja e uma segunda base de código, sem ganho para o uso de hoje.
- **`SameSite=Lax` no cookie de sessão.** Também resolveria a volta do Google, mas mandaria o cookie em toda navegação
  vinda de outro site. A página de volta resolve sem afrouxar.

## Limites conhecidos

- Os prints de verificação são do Chromium com toque emulado (iPhone 390×844 e Android 412×915), não do WebKit. O teclado
  foi simulado encolhendo o viewport. O comportamento real do Safari (teclado, OAuth no app instalado, cookie) só se
  confirma num aparelho.
- No iPhone, o app instalado tem cookies separados do Safari: quem instala entra de novo, uma vez, dentro do app.
- Sem push: o aviso de "Sua vez" com o app fechado não existe no celular.
- Telas pouco usadas no celular (Raio-X, computador do bot, formulários longos) não ganharam desenho próprio. Elas cabem
  na largura, mas não foram revistas uma a uma.

## Gatilho de reversão

Reverter se, em 14 dias de uso no celular, acontecer um destes:

- o app instalado mostrar um build velho depois de um deploy, porque o service worker ou o cache seguraram o HTML ou o
  JS. Tirar o registro do worker (`web/pwa.ts`) e publicar um `sw.js` que se desregistra;
- o login no iPhone voltar à tela de entrada depois do Google. Voltar ao 302, testar `SameSite=Lax` e medir;
- alguém no computador cair no layout do celular. A consulta está errada: estreitar `CONSULTA_CELULAR`.

## Implementação (2026-10-10)

- `web/lib/celular.ts` (consulta, área acima do teclado, Enter) e `web/lib/gaveta-bots.ts` (gaveta de bots, fundo,
  `inert`, Esc, toque que mostra o "relatar", altura do `visualViewport`).
- `web/mobile.css`, `web/index.html` (viewport, manifesto, ícones, metas do iOS), `web/pwa.ts`.
- `web/public/manifest.webmanifest`, `web/public/sw.js`, `web/public/offline.html` e `web/public/icons/*`, gerados por
  `node scripts/mobile/icones.mjs` a partir da marca do `favicon.svg`.
- `web/main.ts`: ☰ no cabeçalho, gaveta fecha ao navegar, placeholder curto no celular, Enter, `retomar()` e
  `invalidacoesAoRetomar`. `web/lib/live-events.ts`: `retomar()`. `web/estado/reducer.ts`: `invalidacoesAoRetomar`.
- `src/adapters/http/estatico.ts`: tipos e cache. `src/adapters/http/sessao-google.ts` e `sessao-cookie.ts`: página de
  volta e `Max-Age`.
- Testes:
  - `tests/unit/web/pwa.test.ts`: o worker num contexto isolado, o manifesto, os ícones e o `index.html`;
  - `tests/unit/web/celular.test.ts`, `tests/unit/web/retomada.test.ts` e `tests/unit/web/live-events.test.ts`
    (`retomar`);
  - `tests/unit/http/estatico.test.ts`;
  - `tests/integration/sessao-google.test.ts` e `tests/concurrency/admissao-por-dominio.test.ts`.
- `scripts/alvos-44px/` (NOD-383, 2026-10-28): auditoria de toque do celular num Chrome headless em 390×844 com toque.
  Mede cada alvo visível por `elementFromPoint` a 22 px do centro nos 4 pontos cardinais (área efetiva ≥44×44) e acha
  atalho de teclado, macOS, "este computador", informação de banco e título que quebra em duas linhas; falha listando
  seletor e tamanho. A regra é pura (`regra.ts`, `tests/unit/scripts/alvos-44px.test.ts`); o executor (`rodar.ts`) roda
  contra um servidor com `NOD_LOGIN=stub`. Regressão para quem mexer na interface do celular.

## Emenda de 2026-10-27: o ‹ da conversa (NOD-381)

Na conversa o ☰ do cabeçalho vira o ‹ do protótipo nod-381, num círculo de vidro à esquerda da pílula flutuante. Até a
tela inicial do celular (NOD-379) existir, ele abre a mesma gaveta de bots (mesmo `data-act`, mesmo rótulo "Bots e
conversas"); quando ela existir, o ‹ passa a voltar para ela.

## Emenda (2026-10-28, NOD-379): a barra de bots vira a tela inicial

Protótipo nod-379 v3. No celular a barra de bots deixa de ser gaveta (item 3, primeiro ponto): o app abre nela, ocupando
a tela, no formato de mensageiro — o topo do web (avatar à esquerda, não lidos/Trabalhos/Sua vez só quando há algo, o +
à direita, alvos de 44 px), os favoritos em grade de quatro (oito à vista e "Ver todos"), as conversas em lista com hora e
prévia e uma barra flutuante só com Buscar. Tocar num bot esconde a inicial e o chat entra da direita (280 ms, nada com
movimento reduzido); o ‹ do cabeçalho e o voltar do navegador desempilham uma entrada nossa no histórico
(`{nodInicio: "conversa"}`) e mostram a inicial na mesma rolagem; sem essa entrada (link, recarregar) o ‹ só mostra a
inicial, sem `history.back()`. Sai o fundo escurecido e o Esc da gaveta. Com a inicial por cima, a conversa de baixo não
conta como lida. Exceção ao "nenhum foco é movido" do item 3: quem estava com o foco na inicial e entra numa conversa o
leva ao ‹; ao voltar, ele volta à linha de onde saiu (a parte que some fica inerte e o foco não pode ficar nela). O menu do bot abre no toque longo (450 ms, 10 px de tolerância; o ⋯ fica só para o leitor de tela) e o
menu da conta vira folha de baixo. O computador não muda. Código: `web/lib/gaveta-bots.ts`, `web/lib/inicio-celular.ts`,
`web/lib/toque-longo.ts`, `renderSidebar` em `web/main.ts` e o bloco "inicial" de `web/mobile.css`.

O ‹ da NOD-381 passa a voltar à inicial (rótulo "Voltar ao início").

Decisões e limites da emenda NOD-379:
- Recarregar com um Trabalho aberto (#195, `sessionStorage` da aba) reabre o Trabalho, não a inicial: é a mesma aba
  voltando ao que estava; o ‹ dele leva à inicial. Abrir o app (aba nova, PWA) sempre começa na inicial.
- Recarregar dentro de uma conversa deixa uma entrada a mais no histórico (a do documento anterior, sem a marca): um
  voltar a mais não muda nada na tela.
- Seu espaço aberto pela inicial mostra "‹ Início". O voltar do navegador com ele aberto não o fecha.
- A seção "Implementação (2026-10-10)" acima descreve a gaveta, o fundo e o Esc, que esta emenda substitui.
