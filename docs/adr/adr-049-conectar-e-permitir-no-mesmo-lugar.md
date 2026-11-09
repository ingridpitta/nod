# ADR-049 — Conectar e permitir no mesmo lugar

Status: aceito · Data: 2026-09-25 · Emenda ADR-013, ADR-033 (§Integrações), ADR-041 e ADR-044.

## Contexto

Conectar um app e dar acesso a um bot custava, no caminho mais comum (o bot pede leitura de um app ainda
desconectado), **8 cliques em 3 telas e 2 turnos**. No de escrita eram 3 turnos, e a web ainda postava
"Conectei clickup. Continue…" **em nome da pessoa**. O mapa dos caminhos e o canvas das jornadas ideais
(página "Conectores" do canvas "Nod — tela do agente") foram revistos com o Marlon em 2026-09-25.

Na tela real do marketplace, conferida no mesmo dia:
- ✓ e "Não foi possível acessar as ferramentas" apareciam no mesmo cartão (Slack, Gmail);
- "Reconectar", "Refazer conexão" e "Verificar conexão" apareciam juntos, sem dizer o estado;
- "Conectar" só mostrava outro botão ("Entrar no X ↗"), e depois do login a pessoa ainda precisava clicar
  em "Verificar conexão";
- o aviso de sucesso aparecia no fim da grade;
- a página tinha ~16 mil px, com o catálogo cru de cada MCP;
- dar acesso a um bot era um formulário técnico, uma ação por envio.

## Decisão

1. **"Conectar" abre o login na hora, onde a pessoa está.** Isso vale para o card do chat, o cartão e a
   gaveta do marketplace, o "+ Dar acesso" do painel do bot e o card da rotina. A janela nasce vazia dentro
   do clique e recebe a URL do provedor. A web pergunta `POST marketplace/:slug/verificar` a cada 2,5 s,
   por até 10 min (`web/lib/conexao.ts`). O "Verificar conexão" manual saiu.
2. **O login terminou e o servidor troca os cards.** O `verificar` que dá certo chama `aoConectarApp`, que
   troca cada card "Conecte o X" desta pessoa, em qualquer conversa, pelo card de permitir do nível pedido
   (`conexaoViraPedido`). Isso vale também para escrita. Nada é concedido nessa troca: conceder continua
   sendo o clique em Permitir (ADR-044).
3. **O nível decide o que se pede.** `pedir_acesso` com `[]` e o app conectado vale também na conversa:
   - leitura = as ações de leitura;
   - escrita = ler, criar, editar e comentar.

   Apagar nunca entra por nível. O grupo de cada ação sai de `src/domain/grupos-de-acesso.ts`:
   - ler = o `readOnlyHint` da sonda, nunca o nome;
   - a escrita se separa pelo verbo do nome, e apagar ganha de tudo.

   O pedido ganha `para`, uma linha que o card mostra.
4. **Permitir por grupo.** No card de escrita, a pessoa desmarca grupos. `decisoes/:id/decidir` aceita
   `capacidades`, que só pode estreitar o pedido: algo fora dele ou uma lista vazia dá `entrada_invalida`.
5. **O marketplace termina em "quem pode usar".** Cada app tem UM estado e UMA ação. A falha só vale se é
   mais nova que a última sonda boa. O login termina e a gaveta abre em "Quem pode usar o {App}?", com
   Nenhum / Ler / Ler e alterar por bot. `POST agentes/:id/acessos {conectorId, nivel}` deixa o conjunto
   concedido IGUAL ao do nível:
   - o que falta é concedido em lote, com um consentimento;
   - o que sobra é revogado, com um registro.

   A rota mora em `rotas/concessoes.ts`, que já era a rota de pessoa autorizada a conceder
   (`conceder-so-pela-pessoa`).
6. **O técnico foi para "Configurações avançadas"**: a chave do Composio, o GitHub por token ou App, o MCP
   próprio, os catálogos e a concessão por ação.
7. **A rotina conecta e nasce num botão.** "Conectar {App} e criar rotina" conecta e, quando o login
   termina, confirma a rotina. O confirmar concede o que ela declarou (`conceder-acessos-da-rotina.ts`).

Duas correções vieram junto:
- o dedupe de `pedir_acesso` no mesmo turno passou a comparar o nível;
- o card aberto só é reaproveitado se cobre o pedido.

Antes, um pedido de escrita virava o card de leitura.

### Revisão do PR #68 (2026-09-25)

A revisão adversarial achou que a regra por verbo, feita como lista do que é destrutivo, deixava passar
destrutivos: nomes em camelCase (`deleteEvent`) e em português (`tarefa_excluir`), verbos como CLEAR,
MERGE e CANCEL, e o `readOnlyHint` vencendo o "apagar". Com `pedir_acesso([], escrita)`, isso virava um
card pré-marcado com esses destrutivos. Agora a regra **falha fechado**:
- só entra num grupo de escrita o que o nome diz que cria, edita ou comenta;
- o resto vai para "outras", que nenhum nível concede;
- "apagar e desfazer" ganha de tudo, também do `readOnlyHint`;
- o `destructiveHint` da sonda passou a ser capturado e leva para lá.

Os níveis também passaram a respeitar o que foi dado à parte:
- **Ler / Ler e alterar** só mexem em ler, criar, editar e comentar. O que foi dado à parte (apagar,
  "outras", escrita declarada pela rotina) fica como estava.
- **Nenhum** tira tudo.
- **Personalizado:** um conjunto que não forma um nível aparece assim, sem botão aceso.
- **Dono:** a rota de nível exige que o bot e o app sejam de quem chama.

As outras correções:
- **Rotina:** a criação da rotina depois do login vive na tentativa de login. Cancelar ou falhar a
  descarta; antes ela sobrevivia e criava a rotina, concedendo o acesso dela, na próxima conexão do app.
- **Sua vez:** também mostra os grupos para desmarcar.
- **Verificar:** diz `falhou` quando a conta entrou e o app não respondeu, e a web para de perguntar.
- **Troca de cards:** confere tudo antes de escrever e não engole erro no meio.
- **"Entrar de novo":** só aparece com o app em atenção.
- **Janela de login:** nasce sem `opener`.
- **O `para`:** perde caracteres de controle e aparece entre aspas, como fala do bot.

## Alternativas descartadas

- **O clique em Conectar já valer como permissão de leitura** (a variante de um clique do canvas).
  Economiza um clique, mas a pessoa consentiria antes de ver o que o app libera. Fica para depois de medir
  o uso.
- **Callback do Composio de volta ao nod no lugar de perguntar.** Exige uma URL pública do servidor e muda
  o auth config de cada app. Perguntar a cada 2,5 s custa uma chamada ao Composio por vez e nenhuma
  configuração.
- **A web classificar as ações.** A web só importa tipos de `src/`. O grupo sai pronto em `GET /conectores`.

## Gatilho de reversão

- Se, em 30 dias, mais de 1 em cada 5 grupos concedidos por "Ler e alterar" for revogado em até 24 h, o
  nível está largo demais. A gaveta passa a mostrar os grupos, como o card.
- Se aparecer ação destrutiva fora do grupo "apagar", a regra por verbo não basta: nomes que não casaram
  com nenhum verbo e têm efeito externo sem volta, vistos na trilha. Nesse caso, a curadoria por app vira
  obrigatória para escrita.
- Se `verificar` passar de 3 chamadas por segundo por pessoa, alargar o intervalo.

## Não implementado

- **App desktop.** A janela proíbe abrir URL de fora da origem (`proteger`, `desktop/main.ts`), então nem
  a janela de login nem o link "Abrir o login de novo" abrem ali. Isso já valia para o "Entrar no X ↗" de
  antes. Resolver pede uma ponte `window.nodDesktop.abrirLogin(url)` com allowlist de host.
- **Sugestão de nível por bot na gaveta** (como "Sugerido: ele é o PM").
- **A conta conectada** ("conectado como marlon@…"), que o Composio não devolve hoje.
