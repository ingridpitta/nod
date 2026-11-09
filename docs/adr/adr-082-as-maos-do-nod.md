# ADR-082 — As mãos do Nod: vários bots de uma vez, pelo modo de aprovação

Status: aceito · Data: 2026-10-07 · Pedido do Marlon (/spec) · Depende da [ADR-081](adr-081-o-nod-bot-fixo-da-pessoa.md) ·
Emenda a [ADR-044](adr-044-acesso-em-um-clique-tambem-na-rotina.md) (conceder) e a [ADR-059](adr-059-modos-de-aprovacao-do-bot.md)
(modo de outro bot) · Emenda de 2026-09-28 da [ADR-034](adr-034-gestao-e-exclusao-recuperavel-de-agentes.md) (duplicar)

## Contexto

"Duplique os bots A, B e C e crie mais dois bots na seção X que fazem …" — o Marlon quer o Nod como extensão da pessoa
para ações em massa. Nenhum bot conseguia criar (fora da ligação de onboarding), duplicar, editar, mover nem excluir
outro bot; dar acesso a um app era só da pessoa (trava do ESLint + `conceder-so-pela-pessoa.test.ts`). Decisões do
Marlon no /spec de 2026-10-07:

- O Nod tem o mesmo modo dos outros bots (manual, automático, sem aprovações) e o modo decide.
- Dar acesso a um app segue o modo (card no manual, roda no automático e no total), com três cercas.
- Mudar o modo de outro bot é permitido, como ação arriscada.
- No automático, num lote misto, o que pode roda na hora e só o que precisa da pessoa vira card.
- Gestão de bots fica fora da ligação nesta versão.

## Decisão

1. **Duas ferramentas, só do Nod.** `gerir_bots { resumo, acoes[] }` (até 20 ações: `criar`, `duplicar`, `editar`,
   `mover`, `excluir`, `criar_rotina`, `dar_acesso`, `mudar_modo`) e `ver_apps_conectados` (leitura). Entram no catálogo
   só quando o bot do turno é o Nod e o modo do turno é `conversa` ou `criacao` (`FERRAMENTAS_DO_NOD`). Um bot criado ou
   duplicado no mesmo lote é alvo das ações seguintes por `"@ref"`.
2. **Validar tudo antes.** O domínio (`src/domain/lote-bots.ts`) resolve os alvos — id ou nome exato entre os bots da
   pessoa, ou `"@ref"` anterior — e recusa o lote inteiro se houver qualquer problema (nome ambíguo, bot de outra pessoa
   ou da empresa, excluído, o próprio Nod, app não conectado, nível que o app não tem, nome "Nod"). Nada roda; o Nod lê
   a lista e corrige.
3. **O modo decide cada ação** (`decidirPeloModo`). Arriscadas: `excluir` e `mudar_modo` sempre; depois de conteúdo de
   fora no turno, `dar_acesso`, `duplicar` de um bot que tem acessos (a cópia os leva), `criar_rotina` e `editar` a
   descrição ou o título (instrução que o bot segue depois) — revisão de 2026-10-07. No "sem aprovações" tudo roda, como
   o Marlon decidiu (a tabela do /spec: dar acesso roda no total); é o risco aceito desse modo. O Nod **não** usa o
   alívio de `conversaComAPessoa`: pedir na conversa não tira o risco de excluir. Uma ação cujo alvo é um bot que outra
   ação (que espera) vai criar também espera.
4. **Um card só.** O que espera vira uma proposta + decisão `lote_bots` (mesmo id, 0060) na conversa do Nod, uma linha
   por ação, marcável; o que o modo fez entra como "feito". Aprovar (`POST decisoes/:id/decidir` com `selecionados`)
   executa as marcadas, na ordem, com a pessoa como autora; as desmarcadas viram "não feito". O desfecho fica no payload
   e numa linha de sistema na conversa do Nod. Em "Sua vez" o card aprova tudo de uma vez.
5. **Cada ação pelo caso de uso de sempre**, num SAVEPOINT: `criarAgente` (+ seção), `duplicarAgente`, `editarPerfil`,
   `gerirAgente` (mover, excluir), `criarRotinaPelaPessoa`, `mudarModoAprovacao`. Uma que o caso de uso recusa volta
   sozinha e as outras seguem (um erro do Postgres derruba o lote inteiro); não existe "desfazer o lote" (excluir já se
   restaura, ADR-034).
   **Emenda de 2026-10-28 ([ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md), NOD-391):** criar, duplicar, editar,
   mover, excluir e mudar o modo passam pelo executor único do registro (`src/use-cases/acoes/bots.ts`), o mesmo da tela;
   o risco de cada tipo (§3) sai do registro; e excluir pelo Nod desliga o computador do bot depois do commit, como a tela.
6. **Dar acesso pela decisão de acesso.** `abrirPedidoDeAcesso` no bot alvo e `decidirAcesso` na mesma transação, com a
   regra do modo do Nod ou a pessoa que aprovou o lote. É o caminho que a trava do ESLint já permite: o
   `conceder-so-pela-pessoa.test.ts` continua de pé sem exceção nova. **Emenda à ADR-044:** além do clique da pessoa,
   concede quem a pessoa pôs no Nod — o modo dele —, só sob as três cercas:
   - **Cerca 1:** só app que a PESSOA conectou (conector dela, habilitado). Conectar conta nova continua dela.
   - **Cerca 2:** só a pedido da pessoa, na conversa com o Nod — o catálogo e o caso de uso (`turnoDoNodComAPessoa`)
     recusam rotina, sala, ligação e delegação, e `pedir_a_bot` não chega no Nod (ADR-081).
   - **Cerca 3:** depois de conteúdo de fora no turno (`turnos.contaminado_em` ou entrada não confiável), vira card
     também no automático.
7. **Emenda à ADR-059:** o Nod muda o modo de outro bot da pessoa, como ação arriscada (card no manual e no automático;
   sozinho só no "sem aprovações"). **Emenda à de 2026-09-28 da ADR-034:** `duplicarAgente` também é chamado pelo Nod,
   sob o modo e a cerca 3.
8. **Interruptor.** `NOD_GERIR_BOTS=0` tira as ferramentas do Nod do catálogo sem reverter o código.

## Alternativas descartadas

- **Dar acesso sempre por card (a regra de antes).** O automático pararia justamente onde o Marlon quis tirar o atrito.
- **Modo puro, sem cercas.** No automático, uma página ou um e-mail com instrução escondida, ou outro bot por
  `pedir_a_bot`, conseguiria fazer o Nod dar acesso ao Gmail sem a pessoa ver.
- **O lote inteiro vira card quando qualquer ação precisa da pessoa.** Rejeitado pelo Marlon: no automático ele quer o
  que dá feito na hora.
- **Uma ferramenta por ação.** Um pedido de cinco mudanças viraria cinco cards no manual.
- **Schema por tipo de ação (oneOf).** O validador do proxy é um subconjunto de JSON Schema e o modelo erra menos com um
  objeto só; o domínio confere o que cada tipo exige.

## Gatilho de reversão

Reabrir se um lote do Nod fizer algo que a pessoa não pediu (relato ou Raio-X), se a cerca 3 deixar passar um acesso
depois de conteúdo de fora, ou se as pessoas pararem de usar o card porque "Aprovar marcadas" confunde. Desligar já:
`NOD_GERIR_BOTS=0`.
