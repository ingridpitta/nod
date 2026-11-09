# ADR-062 — Aprovações que cumprem o que prometem: conteúdo de fora por curadoria, regra que vale na hora, chamada direta no mesmo portão

Status: aceito, emendada pela [ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (saíram o gate da
rotina, a trava herdada e a confiança pela fonte da rotina) · Data: 2026-09-30 · Emenda ADR-026 (o que é conteúdo de fora), ADR-042 (a regra vale já, não "a partir
do próximo turno"), ADR-052 (a marca da web não se lava), ADR-055 ("o resto desta tarefa"), ADR-058 (a trava herdada
entre bots da mesma pessoa) e ADR-059 (a chamada direta passa pelo modo). É a Onda 1 da auditoria das aprovações; a
Onda 2 e a Onda 3 estão em "Não implementado".

## Contexto

Em 2026-09-30 o Marlon mandou o print de um card do Milton ("comentar na task do ClickUp") com três queixas: clicar em
"Sempre permitir" não parava os cards; o bot estava no modo automático e mesmo assim pedia; e aprovar uma leitura do
Slack e ver outro card de leitura do Slack irrita. Pediu uma varredura com personas (conservadora, que lê às vezes, que
quer autonomia total) e que olhasse também o Chico e a Clarice.

A perícia leu o banco do dia a dia (só leitura) e o código. O que se mediu:

- **Toda rotina nascia não confiável: 440 de 440 turnos de rotina do Marlon.** `confiancaDaFonte` marcava a rotina
  quando a fonte citava um conector com declaração `toca` ("toca dado pessoal"), e todo app do marketplace nasce
  declarado assim. Turno não confiável tem catálogo reduzido e `semprePermitir = []`: o automático e as regras nunca
  valiam numa rotina. No automático, só 3 de 25 itens de app (12%) saíram sozinhos.
- **O card do print tinha regra ativa desde 09:14:38.** Parou por `regra_suspensa_conteudo_nao_confiavel`, 34 s
  depois do clique: o plano congelava as regras no começo do turno ("a partir do próximo turno").
- **16 de 28 cliques em "Sempre permitir" não criaram regra nenhuma.** A regra já existia; o card tinha parado por
  outro motivo (37 itens pelo gate da rotina, 7 por regra suspensa, 2 por lote misto). Mesmo assim, cada clique gravava
  na conversa "permitiu para sempre".
- **Seis comentários falharam por falta do `assignee` obrigatório.** O erro ia só para o log (erro nunca vaza
  mensagem, AGENTS.md), o bot tentava de novo, e cada tentativa era um card novo.
- **As rotinas do Chico pediam ao Milton** (`pedir_a_bot`), e a trava herdada (ADR-058) virava card na conversa do
  Milton, com os dois bots do Marlon no automático.
- **A auditoria do código achou quatro furos:** a retomada de um card nascia sem a marca da web (0033), embora retome
  a mesma sessão pelo `--resume`; a continuação da resposta de um colega também; "Pode fazer e o resto desta tarefa"
  no terminal vinha antes das cercas de credencial e de arriscado; e, no manual, a chamada direta a uma escrita (até
  apagar) ia ao conector sem card, só o prompt mandava usar `pedir_aprovacao`.

Na conversa, o Marlon decidiu três pontos: (1) ClickUp e o Slack interno não são conteúdo de fora; web, Gmail e
GitHub são. Perguntou quem decide para um app novo, e a resposta foi: nunca o modelo, uma lista curada no código,
fechada para o que não está nela. (2) A rotina de um bot dele pedindo a outro bot dele não trava. (3) No manual, a
chamada direta também pede card.

## Decisão

1. **Conteúdo de fora é curadoria do servidor.** O campo `conteudoInterno` em `APPS_MARKETPLACE` marca os apps cujo
   conteúdo é escrito por gente da empresa: hoje `slack`, `notion`, `linear` e `clickup`. Todo o resto é de fora
   (`conectorTrazConteudoDeFora`, `src/domain/conteudo-de-fora.ts`), inclusive Gmail, GitHub, Jira, Confluence, os
   apps do catálogo público (ADR-057), MCP próprio e todo app novo, até alguém revisar. O modelo nunca classifica: o
   texto que ele leria é justamente o vetor de ataque. `confiancaDaFonte` passa a usar esse critério. O resto da ADR-026
   não muda: o resultado de um conector continua chegando ao modelo marcado `nao_confiavel`, e só a web das nativas
   marca o turno (0033).
2. **"Sempre permitir" vale na hora.** `pedir_aprovacao` e a chamada direta leem as regras ativas no momento da
   decisão (`semprePermitirVivo`, `src/use-cases/regras-vivas.ts`), não a lista congelada no plano. Revogar também vale
   na hora. Turno não confiável ou marcado pela web continua sem regra nenhuma (ADR-042 claim 6). O modo já era lido
   assim (ADR-059 §3).
3. **A chamada direta passa pela mesma decisão do card.** `chamar-ferramenta.ts` chama `decidirAprovacao` com o modo
   atual e as regras vivas antes de ir ao conector. O que não passaria sozinho no card recebe a negação transitória
   `alcance_insuficiente` ("peça aprovação"), e o modelo refaz por `pedir_aprovacao`, que grava o motivo no item.
4. **`pedir_aprovacao` confere os argumentos no schema do conector antes do card.** O erro volta ao bot como dado
   (`{ estado: "recusada", erros, instrucao }`, com o caminho `itens[i].destino.argumentos` e a ferramenta), sem card,
   sem decisão e sem vazar mensagem de exceção.
5. **Entre bots da mesma pessoa, a rotina de um não trava o outro.** `travaDoPedido` libera quando quem pediu é do
   mesmo dono, com entrada confiável e sem a marca da web: quem decide é o modo de quem recebe. Continua travando o
   pedido de outra pessoa, o de um turno que leu conteúdo de fora e o de uma rotina sem janela (E7.3).
6. **A marca da web não se lava.** A retomada herda `contaminado_em` do turno que ela retoma (`enfileirarRetomada`). A
   continuação da resposta de um colega herda a marca se a tarefa dele, ou qualquer retomada dela, leu a web ou nasceu
   não confiável, e também se o turno que pediu estava marcado (`entregar-resposta-peer.ts`). "O resto desta tarefa"
   no computador do bot também deixa de valer depois da web: o terminal já olhava a marca, o computador não.
7. **"Pode fazer e o resto desta tarefa" no terminal não cobre comando arriscado nem credencial.** A liberação vem
   depois das duas cercas (`autorizar-comando.ts`). Antes, um "pode fazer" num `git commit` liberava o `rm -rf` e o
   `security find-generic-password` seguintes, que nem o modo sem aprovações libera.
8. **O card só promete o que cumpre.**
   - "Sempre permitir" fica desabilitado, com a frase, quando o item parou por um motivo que regra nenhuma pula:
     `gate_de_rotina`, `regra_suspensa_conteudo_nao_confiavel`, `fora_do_catalogo` e `sem_plano` (`REGRA_NAO_PULA` em
     `web/telas/sua-vez.ts`). Continua visível (ADR-029).
   - O servidor aplica o mesmo filtro (`podeVirarRegra`). Num lote misto, a regra nasce só para o que o rótulo nomeou.
   - Regra que já vale não nasce de novo, e sem regra nova não há mensagem de consentimento.
   - Saíram "a partir do próximo turno" e "você pode revogar quando quiser": não há tela de revogar (Onda 3).
   - O porquê da pausa ganhou frases para a trava da rotina e para a ferramenta fora do alcance, e a da web diz até
     quando vale.

## Resultado

`tests/integration/personas-aprovacao.test.ts` roda três personas contra o código real, sobre Postgres: Rita (manual,
conservadora), Marlon (automático, lê às vezes) e Bruno (total). São 73 casos, e cada mudança aparece como
comentário "ADR-062". O que virou:

| Caso | Antes | Agora |
|---|---|---|
| Rotina cuja fonte cita ClickUp e Slack, com "Sempre permitir" em comentar | Marlon: card (`regra_suspensa`) | Marlon e Bruno: sai pela regra; Rita: card da rotina |
| Rotina cuja fonte cita GitHub | — | não confiável: Marlon card, Bruno segue |
| Clique em "Sempre permitir" e novo comentário no MESMO turno | Rita: card de novo | sai pela regra |
| Colega pedido por uma rotina confiável do mesmo dono | Rita e Marlon: card (`gate_de_rotina`) | Rita: card comum; Marlon: roda |
| Colega pedido por uma rotina que leu GitHub | card | card (a trava continua) |
| Escrita e apagar por chamada direta, no manual | rodava sem card | negada, "peça aprovação" |
| Apagar direto num pedido de colega, no automático | rodava sem card | negado (`acao_arriscada` no card) |
| Resposta de colega que leu a web | continuação limpa | marcada: Rita e Marlon, card |
| Retomada de um card depois da web | limpa | marcada |
| "Resto desta tarefa" e depois `rm -rf` / `cat ~/.aws/credentials` | rodavam | card |

Cinco testes antigos assumiam o comportamento de antes e foram ajustados, com a razão ao lado:
- `nativas-rota`, `pedir-a-bot` e `pedir-a-bot-revisao`: a escrita direta no manual. Agora os três ligam o
  automático para exercitar o que queriam.
- `acesso-rotina`: a rotina de teste lia o Gmail, que agora a torna não confiável.
- `github-conector`: a regra passou a vir de um clique de verdade, não da lista do plano.

## Alternativas descartadas

- **O modelo dizer se um conteúdo é de fora.** O texto a classificar é o mesmo que tentaria mandar no bot.
- **Continuar pela declaração `toca`.** Ela responde outra pergunta (dado pessoal), e o marketplace declara todo
  app assim; foi isso que zerou o automático nas rotinas.
- **Marcar o turno a cada leitura de conector.** Pararia o dia inteiro: ler ClickUp e Slack é o trabalho do Marlon.
- **Manter as regras congeladas no plano (ADR-013).** A ADR-013 pede que o servidor decida, não que ele decida com um
  valor velho. O modo já era lido na hora.
- **Liberar a trava herdada só com os dois bots no automático.** O modo de quem recebe já decide; exigir o de quem
  pediu fazia a trava de um bot manual valer sobre um bot sem aprovações da mesma pessoa.
- **Esconder "Sempre permitir" onde ele não vale.** Botão ausente é indistinguível de defeito (ADR-029): fica
  desabilitado com o porquê.

## Gatilho de reversão

- Um texto vindo de um canal do Slack Connect ou de um convidado do ClickUp fazer um bot agir: esse app sai de
  `conteudoInterno`, ou a curadoria passa a ser por conexão. É o risco aceito do item 1.
- A negação "peça aprovação" da chamada direta virar laço no manual (o modelo repetindo a chamada direta em vez de
  pedir): mais de uma negação `alcance_insuficiente` seguida da mesma ferramenta no mesmo turno, em mais de 5% dos
  turnos manuais de uma semana. Nesse caso a frase da negação muda antes da regra.
- A leitura das regras a cada escrita aparecer na latência da ferramenta: p95 de `chamar-ferramenta` acima de 50 ms a
  mais que antes. Nesse caso volta o valor do plano, com invalidação pelo clique.

## Não implementado

- **Onda 2 (agrupar):**
  - "Ler" concedido cobre as leituras do app inteiro, não ferramenta a ferramenta.
  - "Sempre permitir" por app e grupo (exige migração).
  - O `pedir_acesso` da rotina respeita o modo.
  - Um card por conversa, juntando o que chega em sequência.
- **Onda 3:**
  - Tela para ver e revogar as regras (a rota e o caso de uso existem, a tela não), com os motivos de inatividade da
    ADR-042 claim 7.
  - O card de acesso diz mais do que concede, e há um par de cards gêmeos em `decidir-acesso.ts`.
  - A rotina da Frida no Slack falha todo dia porque o canal configurado é um id de usuário ("U…").
  - `truncate` na lista de arriscados do terminal pega texto que não é SQL.
- **Curadoria além dos quatro apps.** Jira, Confluence, Google Drive e os demais seguem de fora até alguém revisar
  cada um.
