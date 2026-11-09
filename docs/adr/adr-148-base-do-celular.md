# ADR-148 — A base do celular: a forma muda, as ações não

Status: aceita (2026-11-03, ADA-2 F1) · Emenda a [ADR-094](adr-094-celular-e-a-mesma-web-instalavel.md) (item 3, "no
celular o layout só reorganiza o que existe"), só no celular.

## Contexto

A auditoria a 390 px (ADA-2) achou o quadro com 755 px de largura (a meta em `nowrap` de `paginas.css`), alvos de 28 a
32 px, campos de 13–14 px (o iOS dá zoom ao focar), a tarefa aberta numa caixa dentro da tela e o topo em degradê por
cima do conteúdo. O protótipo v2 do Gil (ADA-2) pede mais do que reorganizar: tamanhos, pesos e superfícies próprios do
celular. O item 3 da ADR-094 não deixava isso explícito.

## Decisão

1. **No celular a forma pode mudar; as ações não.** Tamanho, peso, superfície, quebra de linha e posição podem ser
   próprios do celular; nenhuma ação nova nem tirada, sem API nem migração por causa da forma. Mudança de fluxo (tab
   bar, abas, toque longo) segue em PR de fase próprio, citando esta ADR.
2. **Uma folha só para a base**, `web/celular-base.css`, carregada depois de `mobile.css`, inteira dentro da consulta
   canônica (`CONSULTA_CELULAR`, `web/lib/celular.ts`). `tests/unit/web/celular.test.ts` recusa regra fora dela: a
   janela estreita no computador não muda (critério 13 da ADA-2).
3. **Tokens de forma** em `tokens.css`: `--cel-alvo` (44), `--cel-campo` (16, campo sem zoom no iOS) e `--cel-corpo`
   (16). São medidas, não cor: iguais nos dois temas.
4. **Topo de vidro só quando rolado** (`web/lib/topo-encolhe.ts`): parado no topo a faixa não tem fundo; rolado,
   `topo-encolhido` liga `backdrop-filter`. Blur só na faixa e nas pílulas, nunca em lista. A escuta é de rolagem
   passiva com um quadro de animação, só lê `scrollTop` (a rolagem guardada é da ADA-12) e reavalia na troca do
   `hidden` do quadro. Sem sentinela com IntersectionObserver: o `#timeline` e a `.qd-conteudo` são regravados a cada
   render.
5. **Nada passa da largura**: a 390 px `scrollWidth` = 390 em conversa, barra, quadro e tarefa.

## Emenda F2 (2026-11-08, ADA-17: a tarefa aberta)

6. **Render por formato, não por CSS.** A tarefa aberta no celular tem render próprio (`web/telas/tarefa-celular.ts`),
   escolhido por `ehCelular()` em `web/lib/quadro-na-tela.ts`; o do computador (`tarefaAberta`) não muda. A troca da
   consulta redesenha. Esconder pedaços do computador por CSS deixaria dois DOMs para o leitor de tela e o teste.
7. **Propriedades numa folha**, sem `<select>` nativo: cada chip da bandeja abre uma folha (`web/lib/folha.ts`) com o
   valor atual marcado. Os toques caem no mesmo caminho do select (`quadro.mudar_tarefa`); nada de ação nova. A folha
   fica acima do teclado por `--teclado` (`web/lib/teclado-visivel.ts`, `visualViewport`), nunca por `vh`.
8. **Toque longo é atalho, nunca o único caminho.** No comentário, o toque longo abre Responder/Copiar; o Responder
   também fica visível no cartão. A citação da resposta vai no texto do comentário (sem esquema novo).

## Gatilho de reversão

Se uma fase do celular precisar de uma ação que o computador não tem, ela volta a esta ADR e decide aqui antes.

## Adendo (ADA-18, celular F3: o quadro)

Aplicação do item 1 ao quadro, sem ação nova de domínio nem migração:

- **Visão no título** (Lista, Colunas, Minhas tarefas) guardada em `exibir_quadro.visao` (o jsonb que já guardava
  recolhidas e compacto). No chat, a mesma troca é a op `exibir` do `gerir_quadro` (registro em `src/domain/acoes`,
  paridade). Minhas tarefas = o filtro Comigo.
- **Colunas de 280 px com snap**: a rolagem lateral fica só no carrossel (`.qd-cel-cols`); pontos até 7 colunas,
  contador `n/N` acima disso.
- **Toque longo de 500 ms na linha** (o gesto do NOD-379, `web/lib/toque-longo.ts`) abre Mover para… (folha de 56 px,
  o mesmo lote com Desfazer do computador), Atribuir e Copiar link (`?tarefa=`). Shift+F10/ContextMenu é o equivalente
  de teclado. O clique de soltar é engolido em qualquer alvo (cai no fundo da folha recém-aberta).
- **Prazo da tarefa** não existe no modelo: fica atrás de `PRAZO_DA_TAREFA = false` até uma fase decidir o campo aqui.
- **O ⋯ do topo** reúne meta, prazo do quadro (folha, sem `select`), Pessoas, Atividade, Ordem das colunas, Trazer do
  Linear e Remover quadro: as mesmas ações do topo do computador.
- O CSS fica todo em `web/quadro-celular.css`, dentro da consulta canônica; o computador não muda (critério 13).

## Emenda F4 (2026-11-08, ADA-19)

6. **No celular, Sua vez é aba da inicial, não tela.** A inicial ganha a tab bar em pílula de vidro (Conversas,
   Quadros, Sua vez) com o botão redondo de busca; ir para `sua-vez` no celular troca de aba em vez de empilhar uma
   tela. O computador mantém a tela de Sua vez. A aba mostra só "Precisa de você" (pedidos abertos não vencidos, um por
   fio, a mesma conta do sino e do Dock), sem incidentes nem avisos. Nenhuma ação nova: as linhas usam
   `verPerguntaNaConversa`, os quadros usam `quadroNaTela` e `abrir-quadro-compartilhado`, e segurar o ‹ abre as recentes
   (até 8, pela última mensagem). A folha fica em `web/tab-bar-celular.css`, carregada depois de `celular-base.css`,
   na mesma consulta canônica.
