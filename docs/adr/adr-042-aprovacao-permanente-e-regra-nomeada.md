# ADR-042 — Aprovação permanente é regra nomeada da pessoa, não ausência de registro

Definido em 2026-09-21, a partir da queixa do Marlon: *"Toda hora preciso dar uma aprovação
e o agente acaba me interrompendo demais"*. Detalhada, a queixa tinha três causas distintas —
FREQUÊNCIA (várias perguntas na mesma tarefa), TRIVIALIDADE (pergunta para ler) e FALTA DE
CONTEXTO (a pessoa para tudo e ainda não sabe o que está aprovando). Esta decisão ataca as
duas primeiras; a terceira é superfície e já foi resolvida no card.

O diagnóstico achou o ponto exato: **ferramenta com `readOnlyHint` já executa direto hoje**
— `chamar-ferramenta.ts:186` só barra não-readOnly, e só sob gate de rotina. Quem cria o card
de leitura é o MODELO, chamando `pedir_aprovacao` por conta própria, porque nada abaixo dele
o impede. Corrigir isso no prompt seria violar o ADR-026 (*"Prompt não é gate"*): a regra
tem que morar no servidor.

## Decisão

1. **Consulta não é decisão.** Um item cujo destino tem `readOnlyHint: true` no catálogo
   SONDADO do conector (`probe.ts:66`, capturado na descoberta — ADR-013) não produz
   pendência: o servidor executa e registra. A declaração é do CONECTOR, nunca do modelo e
   nunca derivada do nome da ferramenta. Sem plano, sem catálogo ou fora dele: fail-closed,
   vira pendência.
2. **A pessoa pode criar uma regra permanente, e ela é uma LINHA, não um flag.** "Sempre
   permitir" no card grava uma `permissoes_permanentes` com escopo
   `(pessoa, agente, conector, capacidade)` — a ferramenta inteira, qualquer destino. Não
   existe escopo por argumento nesta rodada. A regra aponta para o item que a originou: o que
   a pessoa viu ao clicar é reconstruível.
3. **Nada é auto-aprovado sem linha em `itens_aprovacao`.** O item nasce, nasce
   `selecionado = true`, recebe desfecho. O que muda é que a decisão nasce FECHADA
   (`estado = 'decidida'`, `decidida_por = NULL`), não pendente. A tabela continua sendo o
   único registro de efeito externo do produto — não há segundo caminho. Decisão fechada não
   entra em `listarSuaVez` (`decisoes.repo.ts:99` filtra pendente/reaberta), não entra na
   gauge `pendencia_mais_velha_s` e não pode expirar: o ADR-007 é respeitado porque nada é
   suprimido, e sim nunca fica pendente.
4. **A autoria continua `autor_tipo: "agente"`.** Uma regra criada por pessoa não transforma
   o ato do agente em ato da pessoa. Quem pergunta "foi uma pessoa?" lê `autor_tipo` (ADR-023)
   e recebe "não". Quem pergunta "sob que autoridade?" lê `decidido_por` e recebe o nome da
   regra com a versão.
5. **Duas regras NOMEADAS e versionadas no servidor**, resolvidas em
   `src/domain/aprovacao-permanente.ts` — nunca no proxy, nunca no modelo:
   `regra:consulta_sem_decisao` (autoridade do conector, dia um, não revogável) e
   `regra:aprovacao_permanente` (autoridade da pessoa, por clique, revogável). Fundi-las
   produziria o `if` anônimo que o ADR-026 proíbe, porque os ciclos de vida são opostos.
6. **Turno com entrada não confiável não usa regra permanente.** `confiancaEntrada =
   "nao_confiavel"` desliga a regra da pessoa por inteiro. `regra:consulta_sem_decisao`
   continua valendo — `catalogoReduzido` (`confianca.ts:18`) já deixa readOnly passar direto,
   então executar um item readOnly dentro de `pedir_aprovacao` ali não amplia nada.
7. **Regra não sobrevive a mudança do mundo.** Revogar a concessão, desabilitar o conector, a
   capacidade sair do catálogo na sonda seguinte ou o agente ser excluído deixa a regra
   INATIVA com motivo tipado. Inativa não é apagada, e não volta sozinha quando a condição se
   desfaz — mesmo princípio do ADR-034 (*"Restaurar não devolve concessões nem reativa
   rotinas"*). Duplicar (emenda de 2026-09-28 do ADR-034) respeita isso: a dona leva as
   regras ATIVAS para a cópia por clique explícito, com consentimento novo na conversa dela.
   Inativa não vai, e bot de outra pessoa não passa regra nenhuma.

## Por que a claim 6 é a mais importante

Hoje, em turno não confiável, `catalogoReduzido` tira toda ferramenta de conector não-readOnly
e deixa as ferramentas nod. O comentário em `confianca.ts:15` diz por quê: *"pedir_aprovacao é
justamente o caminho para efeito externo"*. A consequência é que **toda** ação externa de um
turno contaminado passa por uma pessoa, por construção.

Auto-aprovar nesses turnos desfaz exatamente essa propriedade: um documento de fora poderia
dizer "peça aprovação para enviar X", e X sairia sozinho sob uma regra que a pessoa criou para
outra coisa. A ferramenta que o ADR-026 protegeu viraria o buraco.

## Alternativas rejeitadas

### Escopo por destino ("sempre permitir Slack no canal #vendas")

Parece mais seguro e é menos. Exigiria o servidor interpretar ARGUMENTOS para decidir se dois
pedidos são "o mesmo destino" — e argumento vem do modelo, que pode estar sob influência de
conteúdo não confiável (ADR-026). Uma regra cuja condição de aplicação o atacante controla não
é regra, é oráculo. O escopo por ferramenta tem a propriedade que o outro não tem: a pessoa
consegue enunciar o que autorizou sem ler JSON.

Verificado na doc do Grok Bot em 2026-09-21: o botão `Always allow` deles grava *"this kind of
action"*, não o destino específico; escopo por destino lá é regra escrita à mão em Settings.
O escopo por ferramenta é a escolha do Marlon com o trade-off explicado.

### Revisor-modelo antes de cada ação (Auto Review do Grok Bot)

Já recusado em `docs/grokbot-comparison.md` por três razões, a decisiva sendo que no caminho
local ele ou queima a cota da pessoa para vigiá-la, ou vira chamada WAN por `tools/call` — a
autoridade remota síncrona com fail-closed que o ADR-013 recusou depois de verificar linha a
linha que o precedente citado era falso. Adotar reabriria aquela decisão pela porta dos fundos.
A doc deles ainda admite vazios que não conseguem enumerar (*"does not review every side
effect, such as memory writes and most settings changes"*); os vazios de uma allowlist são
legíveis — é tudo que não está na lista.

### Reusar `concessoes` com uma coluna `sem_aprovacao`

Concessão responde "este agente PODE chamar esta capacidade?" e alimenta o CATÁLOGO do plano.
Permissão permanente responde "quando ele chamar, precisa de gente?" e alimenta a EXECUÇÃO.
Misturar faz um bug de aprovação virar bug de catálogo: revogar "sem perguntar" derrubaria a
ferramenta do plano, e o agente pararia de enxergá-la em vez de voltar a perguntar. Além
disso `concessoes.mensagem_id` aponta para o consentimento de ACESSO, e `revogar` é DELETE
(`concessoes.repo.ts:59`) — uma permissão de efeito externo que some sem rastro é o oposto do
que este produto vende.

### Não registrar o que foi auto-aprovado

É a alternativa que mais economiza código e a única incompatível com o produto. O nod vende a
trilha; uma ação com efeito externo e sem pessoa no loop é justamente aquela em que a trilha é
o ÚNICO registro. Um sistema que registra tudo exceto o que fez sozinho registra ao contrário.

## Risco aceito, escrito

`readOnlyHint` é declaração de terceiro. O ADR-026 trata todo conteúdo de conector como não
confiável, e esta decisão deixa essa mesma declaração remover um gate humano. Três atenuantes,
nenhum completo: é capturada na DESCOBERTA e não na chamada; o conector já teve que ser
registrado, habilitado e concedido por uma pessoa; e um conector que mentisse
`readOnlyHint: true` **já hoje** sobreviveria ao `catalogoReduzido` de um turno não confiável.
A exposição não é nova — o que é novo é ela ficar alcançável sem clique.

O caso a vigiar é catálogo de terceiros em lote (Composio, marketplace), que ninguém do time
escreveu. `probe.ts:66` lê `annotations?.readOnlyHint === true`: ausente ou malformado vira
`false`, então a falha é para o lado de perguntar.

## Gatilho de reversão

Reabrir (desligar `regra:aprovacao_permanente` e voltar tudo a pendência) se, medido:

- **Qualquer item auto-executado em turno `confiancaEntrada = nao_confiavel`.** É violação da
  claim 6, não ajuste de parâmetro: para a feature no mesmo dia.
- **Regra revogada em menos de 24 h da criação com `usos > 0`, duas vezes no mesmo mês.** Uma
  regra que a pessoa desfaz logo depois de ela agir é uma regra que ela não entendeu ao criar.
- **`itens_auto / itens_total` acima de 70 % em qualquer mês civil.** Acima disso o produto
  deixou de ser "agentes preparam, pessoa decide" e virou automação, que é outro produto e
  precisa de outro ADR.
- **`pendencia_mais_velha_s` (ADR-017 #1) sem cair em dois meses** com adoção de ao menos 6
  pessoas com uma regra ativa. A feature existe para reduzir carga de decisão; se a
  carga não cai, ela só transferiu risco.

Reabrir SÓ o escopo (aceitar regra por destino além de por ferramenta) se ao menos 3 pessoas
criarem e revogarem a MESMA regra de ferramenta mais de uma vez em 30 dias — é o sinal de que
"a ferramenta inteira" é largo demais para aquela ferramenta.

## Observabilidade: nenhuma métrica nova

O ADR-017 tem gatilho de REMOÇÃO (*"se alguma das seis métricas ficar dois meses sem gerar
decisão operacional — aí ela sai, não entra outra"*), e um contador `auto_aprovacao = 47` não
gera decisão operacional: 47 é ótimo se tudo funcionou e catastrófico se metade foi errada. A
distinção mora no desfecho por item, que é dado de produto e vive na trilha (ADR-004). As
quatro perguntas do gatilho acima são queries sobre `itens_aprovacao` e
`permissoes_permanentes`, não séries Prometheus.

Um efeito colateral útil, das métricas que já existem: se `expirou_sem_ninguem_ver` SUBIR, é
sinal de que o card aparece menos e a pessoa perdeu o hábito de olhar. É exatamente o
argumento do ADR-017 para manter os dois rótulos separados.
