# ADR-081 — O Nod: o bot fixo da pessoa

Status: aceito · Data: 2026-10-07 · Pedido do Marlon (/spec, canvas "Nod — bot fixo: jornadas") · Revisa a guia da
[ADR-077](adr-077-onboarding-por-ligacao.md) · Mãos sobre os bots na [ADR-082](adr-082-as-maos-do-nod.md)

## Contexto

O Marlon quis um bot fixo para toda pessoa: o que faz o onboarding, tira dúvidas sobre o produto, mexe nos outros bots
a pedido dela (criar, duplicar, editar, excluir, inclusive vários de uma vez) e recebe bugs, ideias de melhoria e
dúvidas — hoje ele descobre a maioria dos bugs só conversando com as pessoas.

O mais perto disso era a guia "Nina" da ADR-077. Verificado na main em 2026-10-07 (853b205):

- Ela era uma linha comum em `agentes`; só `preferencias.onboarding_guia_id` dizia quem era a guia. Excluir, ocultar e
  renomear funcionavam como em qualquer bot (o PR #114 só evitou que a tela do onboarding prendesse a pessoa).
- A descrição dela prometia "ajuda a criar e ajustar os outros bots", mas no chat ela não tinha ferramenta nenhuma para
  isso — `propor_bot` e `para_bot` só existiam na ligação de onboarding.
- Quem entrou antes da ADR-077 não tinha guia.
- Um relato precisava de uma mensagem de bot apontada (`relatos.mensagem_id NOT NULL`, ADR-041): um bug contado em
  conversa não tinha onde cair.

## Decisão

1. **A guia vira o Nod, e o Nod fica.** `agentes.papel = 'nod'` (0061), um por pessoa (índice único parcial). A
   migração promove a guia viva: nome "Nod", título "Ajudante", descrição do Nod, mascote preto (`c-black`), fixado, voz
   `bento` quando ela estava na voz padrão da guia ('clara'). Um bot da pessoa que já se chamava "Nod" vira "Nod (seu)".
2. **Toda pessoa tem o seu.** `garantirNod` roda em todo `GET /onboarding` (a web chama ao entrar) e no `chamando`. Com
   a trava da pessoa (`pg_advisory_xact_lock`, `agentes.travarNod`), duas abas abrindo juntas criam um Nod só. Uma guia
   viva ainda sem papel (criada pelo código antigo durante a drenagem do deploy) vira o Nod ali.
3. **O Nod não some.** Os casos de uso recusam com `nod_protegido` (403): excluir, ocultar, renomear, mover para uma
   seção e duplicar. O gatilho `nod_agente_nod_protegido` recusa o mesmo no banco (nome, `oculto`, `excluido_em`,
   `papel`), para qualquer caminho futuro. Modelo, voz, esforço, descrição, modo de aprovação e fixar seguem livres.
   O nome "Nod" é reservado: nenhum outro bot nasce nem é renomeado assim.
4. **Só a pessoa fala com o Nod.** Ele não é colega de ninguém (`ehColega`, o diretório do prompt) e `pedir_a_bot` não
   chega nele (`resolverAlvo` → `nao_permitido`). É a base da cerca 2 da ADR-082.
5. **Discreto, não escondido.** Fixado, o Nod é o primeiro da grade; desafixado, ele vira o logo (fundo da ação, olhos)
   e "Nod" na barra de cima da lateral, à esquerda da lupa — a "Alt E" escolhida pelo Marlon (o rodapé foi rejeitado
   por ser feio). O menu dele troca Fixar/Desafixar por "Voltar ao topo"/"Deixar discreto" e não oferece mover,
   renomear, duplicar, ocultar nem excluir; ele não se arrasta.
6. **O que ele sabe do produto.** `MANUAL_DO_NOD` (`src/domain/manual-do-nod.ts`, teto de 24 mil caracteres) entra na
   parte estável do prompt, logo depois do "que faz", só no turno do Nod. Os outros bots não ganham uma linha (os
   cenários de `__prompts__/` ficam byte a byte; o cenário `nod` é novo). No "auto" ele roda no modelo mais potente,
   como a guia.
7. **A caixa do Nod.** `registrar_relato` grava um relato com `origem = 'nod'`, `tipo` bug/melhoria/dúvida e
   `mensagem_id` nulo (0062). Título e texto vão para `relato_prosa`, privada e apagável (ADR-004); a lista mostra o
   título e o começo do texto só dos relatos que a própria pessoa contou ao Nod (o do botão segue sem prosa na lista). O trecho são as 10 últimas mensagens da conversa do Nod,
   redigidas (NOD-158). Teto de 20 por pessoa em 24 h. A tela Relatos ganha o filtro por tipo.

## Alternativas descartadas

- **Um bot novo, ao lado da Nina.** Dois bots de ajuda, e a pessoa teria de entender a diferença.
- **Proteger só na web (esconder os botões).** A rota e as ferramentas continuariam excluindo; o gatilho fecha o
  banco para qualquer caminho.
- **Gatilho também no DELETE.** A aplicação nunca apaga bot de verdade (excluir é soft, ADR-034) e a limpeza dos testes
  de concorrência apaga bots por dona (`tests/concurrency/limpeza-e2e.ts`) — revisão de engenharia de 2026-10-07.
- **Ícone no rodapé, linha no fim da lista, menu da conta ou busca** para o Nod discreto: desenhados no canvas; o
  Marlon escolheu a barra de cima.
- **Tabela nova para bugs e melhorias.** `relatos` já tinha a prosa privada, a tela e a consulta que o Marlon usa;
  estender custou três colunas.

## Consequências

- `GET /onboarding` passa a escrever uma vez por pessoa (cria o Nod) e a travar a pessoa por um instante a cada leitura.
- Quem já tinha a Nina a vê virar "Nod" (nome não volta sozinho: o anterior não é guardado).
- Contas criadas nos testes e2e ganham um Nod (a limpeza apaga por dona, sem gatilho de DELETE).

## Gatilho de reversão

Reabrir se o Nod virar ruído (as pessoas o deixam discreto e nunca o abrem por um mês) ou se a reserva do nome "Nod"
atrapalhar alguém de verdade. Para soltar a proteção sem reverter o código: uma migração que derruba o gatilho
`nod_agente_nod_protegido`.
