# ADR-070 — Design system: base grafite, azul só para o que é novo, cor do agente só na identidade

**Status** novo · decidido em 2026-10-04

## Decisão

A cor da web passa a sair de um arquivo só, `web/tokens.css`, com os tokens do design system "Nod"
(direção D, "grafite + cor do agente"). Os três CSS da interface usam só `var(--…)`.

- **Superfícies:** `surface` (área principal), `surface-side` (barra lateral, gaveta, quadro),
  `surface-raised` (balões, tags, hover), `surface-selected` (item atual). Separa-se por `line`;
  sombra (`shadow-pop`) só no que flutua.
- **Ação:** `action` (grafite no claro, quase branco no escuro) é a única cor de botão primário e
  do enviar. Exceção do próprio design system: dentro de um aviso de estado, o botão que resolve usa
  a cor do estado (vermelho em "Conectar IA").
- **Sinal:** `signal` (azul) só para o que é novo: divisor "Novas", ponto e contador de não lidas,
  ponto do mascote de pergunta e de não lido, "esperando sua resposta". Link, seleção, foco, modo
  automático, pergunta e aviso informativo ficam neutros.
- **Estados:** `danger` (o trabalho não começa ou parou), `warning` (a pessoa resolve depois),
  `success`; informação é neutra. O componente é o aviso de estado (`web/lib/aviso-estado.ts`),
  sempre com ícone, texto e, quando houver, o botão que resolve. O "executor indisponível" virou
  erro com **Conectar IA** (antes era âmbar e sem ação).
- **Cor do agente:** as 12 skins viram `--agent-*`; a classe `c-*` do perfil define
  `--mascote-cor` uma vez e o mascote, o avatar vazado e a amostra do editor leem dali.
- **Tipografia:** Geist e Geist Mono, servidas pelo próprio Nod (`web/public/fontes/`, OFL), sem
  Google Fonts: o app do Mac precisa funcionar sem depender de terceiros.
- **Tema:** claro e escuro. "Sistema" segue o macOS; "Claro" e "Escuro" (Preferências) gravam
  `data-theme` no `<html>` e ficam neste computador (`localStorage`, aplicado antes do primeiro
  quadro pelo `index.html`). No app do Mac o `localStorage` é apagado a cada conexão, então a escolha
  também vai para `userData/preferencias.json` (`nodDesktop.definirTema`) e o processo principal a
  aplica em `nativeTheme.themeSource`: o `prefers-color-scheme` da página já nasce certo e a janela
  abre com o fundo do tema, sem piscar branco. O app instalado antes desta versão não tem a função;
  nele o tema volta a "Sistema" ao reabrir.
- **Logo:** os olhos do mascote ("Olhos") no favicon, no ícone do app e na tela de conexão do Mac.

`tests/unit/web/cores-por-token.test.ts` recusa cor literal nos CSS da interface; a exceção é uma
linha marcada com `cor-fixa: <motivo>` (hoje: a tela do computador do bot, escura nos dois temas, e
a máscara do anel de "segurar para criar").

## Por quê

Os CSS tinham ~700 cores literais: uns 30 cinzas quase iguais, três azuis sem papel definido (link,
seleção e "novas" com o mesmo azul) e nenhum modo escuro possível. E os bots já trazem 12 cores
saturadas: uma cor de marca na interface competia com elas, e o vermelho de uma skin se confundia
com erro.

## Alternativas rejeitadas

- **Azul como cor de marca e de ação (direção B).** Menor migração, mas o azul fazendo tudo deixa
  de sinalizar o que é novo e briga com bots azuis e violeta.
- **A interface vestindo a cor do agente em foco (direção C).** Mais identidade, mas âmbar, verde e
  creme não têm contraste com texto branco (precisaria de regra por skin) e um bot vermelho deixa o
  enviar com cara de erro.
- **Fontes do Google Fonts.** O app do Mac carrega a página do servidor; depender de outro domínio
  para a fonte é um ponto de falha e de rastreio a mais.

## Limites

- Os avatares continuam os do `bloub`. O design system também desenha um avatar novo (quadrado com
  os olhos do logo), mas o mascote está em exploração (onça/capivara) e trocar agora seria refazer
  duas vezes.
- A skin `encre` quase some sobre o fundo escuro; o `bloub` não tem contorno para ela ainda.
- O texto gravado da negação (`redacao.ts`) não mudou: mensagens antigas e a prévia da barra lateral
  ainda mostram a frase técnica; a conversa mostra o aviso novo e deixa a frase em "Detalhes
  técnicos".

## Gatilho de reversão

Reabrir se uma tela nova precisar de uma cor que nenhum token cobre mais de duas vezes (vira token
novo no design system antes do CSS), ou se o modo escuro gerar mais de um relato de contraste por
mês.

## Emenda (2026-10-26): a cor do agente no brilho do pensamento

Plano "o pensamento no chat" (ADR-129, Parte 3; opção C aprovada pelo Marlon). A regra "a cor do agente aparece só no
avatar, no ponto de trabalhando e no marcador da menção" ganha uma quarta exceção declarada: **o brilho que corre no
cabeçalho do pensamento da fala viva** (`.fala-viva-estado`, web/interface.css) é da cor do bot (`--mascote-cor`, da
classe `c-*` posta na raiz da fala). O gradiente passa pelo tom do bot e por um ponto mais escuro (`color-mix` com
`--ink`) no meio, para as skins claras (creme, âmbar) não sumirem no tema claro. Sem a cor (bot sem perfil, sala de
antes), o cinza de sempre. Continua fora: link, seleção, botão, foco, aviso e qualquer texto parado.

Gatilho: uma skin sem contraste legível nos dois temas que o `color-mix` não resolva reverte esta emenda para o cinza.

## Emenda (2026-10-28): o realce da busca na conversa

NOD-42 (⌘F). O realce das ocorrências usa tokens próprios (`--realce-busca`, `--realce-busca-atual` e
`--realce-busca-tinta` e `--realce-busca-texto`, web/tokens.css, com valor por tema; o texto de todas as
ocorrências também troca de cor, porque a bolha da própria pessoa tem texto branco), e não `--agent-ambre`: a cor do agente segue só na
identidade, e o realce não se confunde com o bot âmbar. No modo de alto contraste do sistema, `Mark` e `Highlight`.

Gatilho: o texto de um tema perder o contraste de 4,5:1 sobre o realce reverte para um novo par de valores.

## Emenda (2026-10-30): o balão da pessoa na cor do bot

NOD-431 (pedido do Marlon). O balão da fala da pessoa ganha a cor do bot dono da conversa como fundo sólido; o balão do
bot não muda. Para o texto nunca perder legibilidade, a cor não entra crua: `src/domain/contraste-do-balao.ts` calcula,
por skin e por tema, o fundo, a tinta e o fundo do chip de comando, e os literais moram em
web/tokens.css (`--balao-<skin>`, `-tinta`, `-codigo`). Correção de 30/10 (Marlon, comparando com o Grok): a tinta é
sempre branca. O fundo é a cor do bot quando o branco passa de 4,5:1 nela (e no chip); senão, a cor mais próxima no
mesmo tom (só a luminosidade anda, em passos de 1%) em que passa, quase sempre um pouco mais escura. O balão também
precisa se separar da página e do balão do bot por 1,2:1 (por isso o preto clareia no escuro). Exceção: sem bot dono
(sala) o balão fica no grafite `--action`, que no tema escuro é claro com texto escuro; não é cor de bot e fica como
estava. Os `--balao-<skin>-tinta` ficam (todos brancos) para a reversão ser só de valores. Gatilho da correção: se o
teste de uso mostrar que as skins quentes (âmbar, laranja, marrom, creme) ficaram indistinguíveis no balão, o creme e o
âmbar ganham um ajuste próprio de tom. Nada de opacidade no balão: "enviando" ganha contorno tracejado na tinta pura (≥ 3:1, WCAG 1.4.11), e
"falhou" fica claro com tracejado. As classes `balao-c-*` (web/estilos.css) mapeiam a cor do bot nesses tokens; sem bot dono (sala) o balão fica
no grafite de antes (`--action`). Vale também no celular, desfazendo o balão cinza da NOD-380. Dentro do balão, o link e a
seleção herdam a tinta; fora dele, botão, foco, aviso e a interface em volta seguem grafite. Isso abre duas exceções a
regras de cima: a emenda de 26/10 tirava a seleção da cor do agente, e no balão da pessoa a seleção inverte tinta e fundo
(o texto selecionado aparece na cor do bot); e a alternativa C rejeitou a interface na cor do agente porque "um bot
vermelho deixa o enviar com cara de erro". Aqui o vermelho fica só no balão de uma fala já enviada, nunca no botão nem no
estado: o erro de envio continua marcado pelo balão claro com tracejado e pelo aviso (vermelho no computador, cinza no celular), então as duas leituras
não se misturam. Se o teste de uso mostrar que um balão vermelho lê como erro, o gatilho abaixo vale. O realce da busca
(emenda de 28/10) escolheu um âmbar próprio para não se confundir com o bot âmbar; no balão da pessoa a cor sozinha não
marca a ocorrência (o fundo varia com o bot), então ali as ocorrências ganham sublinhado pontilhado e a
atual inverte tinta e fundo do balão (o mesmo par da seleção, ≥ 4,5:1), com sublinhado cheio. Nos estados claros
(falhou, fila) o balão redefine os tokens para surface/ink, e a seleção e o realce seguem o balão claro. O teste tests/unit/domain/contraste-do-balao.test.ts
percorre as 12 skins nos dois temas e falha se o tokens.css divergir do cálculo.

Gatilho: o Marlon ou o teste de uso dizer que as duas vozes voltaram a se confundir, ou que a conversa ficou colorida
demais, reverte para o grafite único; uma skin nova entra só com os tokens que o cálculo der.
