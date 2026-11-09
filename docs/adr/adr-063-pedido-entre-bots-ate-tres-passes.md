# ADR-063 — Pedido entre bots até três passes

Status: aceito, emendada pela [ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (o que atravessa a
cadeia é a marca de quem leu algo de fora, não mais a trava da rotina) · Data: 2026-09-30 · Emenda a ADR-058 (a trava 2, "um salto", vira até três passes). Convive com a
[ADR-062](adr-062-aprovacoes-que-cumprem-o-que-prometem.md), do mesmo dia (sem trava entre bots da mesma pessoa).

## Contexto

Em 2026-09-30 o Marlon registrou cinco relatos sobre bots que não conseguiam chamar colegas. Todos eram de turnos em
profundidade 1:

| Hora | Agente | Turno | Origem | O que ele escreveu |
|---|---|---|---|---|
| 14:47 | Chico | `17f14368` | retomada | a ferramenta de avisar colegas está indisponível |
| 14:50 | Chico | `5acbde6d` | delegação | o agente deveria abrir um turno novo ou ter uma lista de tarefas |
| 14:59 | Dev 1 | `6e96b0d2` | retomada | não fez o que faltava no fim do turno (avisar o Chico) |
| 15:06 | Chico | `398bf8e1` | retomada | por que não conseguiu chamar o Dev |
| 15:22 | Dev 2 | `896707f1` | retomada | de novo, não conseguiu pedir a outro bot |

Medido no banco diário no mesmo dia (consultas como nod_app, Raio-X dos turnos):

- A ADR-058 tirava `pedir_a_bot` de todo turno em profundidade 1. Nasciam assim quem cumpre um pedido, a continuação
  de quem pediu quando a resposta volta e as retomadas desses dois. O Chico coordena os Devs, então **36 dos 64
  turnos dele** no dia foram de profundidade 1. No mesmo modo conversa, o Raio-X mostrou 15 ferramentas do nod em
  profundidade 0 e 14 em profundidade 1; a que faltava era `pedir_a_bot`.
- **Cerca de 20 falas**, em cinco agentes (Chico, Devs 1 a 3 e Clarice), disseram que "a ferramenta caiu" ou "ficou
  indisponível" e prometeram repassar "quando voltar". Nada guardava a promessa: às 15:48 o Chico prometeu repassar a
  task ao Dev 2, e a rotina das 15:50, que tinha a ferramenta, respondeu "não repeti nada". Às 10:48, numa conversa
  com a ferramenta presente, ele hesitou: "fiquei em dúvida se `pedir_a_bot` está disponível".
- **A Clarice tentou quatro vezes** (14:43, 15:35, 15:44 e 15:53) fazer o Chico acionar os Devs. Clarice → Chico →
  Devs é a cadeia A → B → C que a ADR-058 proibia, então as quatro falharam. Na última, às 15:54, o Chico respondeu
  "eu não tenho `pedir_a_bot` neste turno". Quando o Marlon escreveu "acione os devs agora" na conversa do Chico
  (15:47, profundidade 0), três dos quatro Devs responderam em cerca de 1 minuto.
- **O prompt não explicava a regra, e às vezes a contradizia.** Na conversa, o parágrafo do `pedir_a_bot` sumia sem
  aviso. Na retomada de uma rotina, a linha do modo dizia "inclusive consultando colegas" sem a ferramenta no
  catálogo. O próprio prompt já tinha o princípio para o computador ("sem as ferramentas, o agente precisa saber POR
  QUE"), mas não o aplicava ao salto.
- **Custo:** os turnos de profundidade 1 foram cerca de **19% do custo do dia** (US$ 35 de US$ 184 até as 16h),
  perto do gatilho de 20% da ADR-058.

O Marlon decidiu liberar até profundidade 3 e pediu que, no limite, o prompt diga a verdade em tom humano, até com
humor.

## Decisão

**Profundidade conta passes.** `PROFUNDIDADE_MAXIMA = 3` (`src/domain/profundidade.ts`) é a constante única. Cada
passe de bot para bot soma 1, seja o pedido ou a resposta que volta. Turno de conversa ou de rotina nasce em 0, então
fala da pessoa ou rotina zera a conta. O mesmo número limita a cadeia A → B → C → D e as rodadas A → B → A → B.
`turnos.profundidade` aceita 0 a 3 (migração 0043).

- **Quem pede:** abaixo de 3, qualquer turno pede. O alvo nasce um passe mais fundo (`pedir-a-bot.ts`). A delegação
  ganha `pedir_a_bot` no kit do modo; quem corta o salto é a profundidade (`montarFerramentas`), não o modo.
- **A resposta que volta:** a continuação de quem pediu nasce na profundidade da tarefa, um passe a mais que o turno
  que pediu, e não mais 1 fixo. Se quem pediu cumpria ele mesmo um pedido de colega, a continuação mantém a
  procuração (`sob_procuracao_de`). Assim o modo, a trava e o aviso de falha seguem a cadeia.
- **Entre donos diferentes continua um salto só** (confirmado pelo Marlon em 2026-09-30), como a Jornada 02 já
  previa em 2026-09-16 (`docs/roadmap/jornada-02-bots-se-chamam.md`). A procuração (ADR-025) vale de um bot para
  outro. Além do primeiro passe, quem pede e quem recebe precisam ser bots da própria pessoa. Sem isto, o bot da Ana,
  cumprindo por procuração um pedido do Marlon, chamaria outro bot dela, que nunca deu procuração a ninguém.
- **A trava da rotina atravessa a cadeia.** `travaDoPedido` sobe: se quem pediu cumpria um pedido (delegação ou
  retomada dela), a trava dessa delegação passa adiante. A subida é limitada pela profundidade. Uma cadeia mais funda
  que isso, ou uma retomada com procuração cuja raiz não aparece, trava (fail-closed). Sem isto, uma rotina com
  aprovação que leu conteúdo de fora → Clarice → Chico → Dev escreveria sem card no Dev. A regra da ADR-062 (sem trava
  entre bots da mesma pessoa com entrada limpa) vale em cada passe: o que atravessa é só a trava que já existia.
- **A entrega espera os subpedidos.** A tarefa delegada entrega uma vez por raiz (ADR-047). Se quem cumpre o pedido
  pediu a um colega, o turno dele termina com "pedi ao Dev, aguardo". Esse texto sairia como resultado final, e a
  resposta de verdade seria descartada como `ja_entregue`. Agora a entrega e o aviso de falha esperam
  (`aguardando_colega`) enquanto a cadeia tiver um `handoff` com `tarefaId` sem a `peer_ask` correspondente na
  conversa. Quem entrega é a continuação que recebeu a última resposta.
- **A continuação diz o que falta.** Quando ainda faltam respostas, a entrada dela diz "Ainda faltam as respostas de
  Dev 2 e Dev 3; … não repita esses pedidos". Quando quem pediu cumpre um pedido e tudo voltou, diz "Todas as
  respostas que você pediu chegaram: consolide a resposta final para Clarice".

**Prompt (`src/domain/prompt-sistema.ts`):**

- **No limite (profundidade 3).** Texto escrito pelo Marlon, literal, na seção colegas. O prefixo "Limite da
  corrente:" é o que o Raio-X classifica.
  > Limite da corrente: três passes entre bots sem uma pessoa no meio, e o nod corta a ligação antes que vire
  > telefone sem fio. Neste turno você não pede nada a colegas. Faça o que der e diga, com uma pitada de humor, o que
  > falta e para quem — nunca que a ferramenta caiu. Uma pessoa ou uma rotina reabre a linha.

  Na delegação, só o trecho do meio muda: "Faça o que der e diga na sua resposta a <quem pediu>, com uma pitada de
  humor, o que falta e para quem — nunca que a ferramenta caiu."
- **No penúltimo passe (profundidade 2):** "Quem receber um pedido seu agora já estará no último passe da corrente e
  não poderá repassá-lo: peça direto a quem resolve."
- **Delegação abaixo do limite:** sai "Você não pode repassar a outro bot neste turno". Entra que ele pode pedir a um
  colega com `pedir_a_bot`, e que a resposta final volta a quem pediu depois que os pedidos dele voltarem.
- **Rotina:** "inclusive consultando colegas quando ela pedir" só aparece com `pedir_a_bot` no catálogo.

O parágrafo do `pedir_a_bot` não some mais calado: sem a ferramenta, a linha do limite explica.

## Alternativas descartadas

- **Manter um salto (ADR-058).** Travava o bot que coordena outros, e o contexto acima mostra o custo disso.
- **Continuação na profundidade de quem pediu, com orçamento por fio sem fala humana.** É o modo squad da Jornada 02
  (2026-09-16): profundidade até 2, a volta ao originador "não aprofunda a árvore", o freio é o orçamento e há uma
  guarda de anel. Resolveria as rodadas "resposta chegou, aciono o próximo". Mas pediria um contador novo por fio e
  a guarda de anel, que nunca foram implementados. A profundidade como contador de passes cobre cadeia e rodada com
  um número só, que já existe na tabela. O laço A → B → A fica limitado por ela, sem guarda própria.
- **Sem limite.** Laço A → B → A sem fim, e custo sem teto.

## Custo aceito

- **Fan-out.** Um bot que pede a quatro colegas em cada passe gera, no pior caso, 4 → 16 → 64 turnos de colega a
  partir de um turno. A profundidade limita o comprimento, não a largura. Não há gatilho próprio, por decisão do
  Marlon (2026-09-30): ele não quer regra de turnos. O gatilho de custo cobre.
- **Alcance de um texto de fora.** Um texto lido por A pode, pelo pedido de B, levar C a escrever com as concessões de
  C, onde antes a cadeia parava em B. Continuam valendo a trava 1 (rotina herdada, agora atravessando a cadeia), a
  trava 3 (merge, aprovar e revisar PR sempre por card) e o modo de aprovação de cada bot (ADR-059).
- **Resposta final mais lenta.** Quem pediu recebe o resultado só depois que todos os subpedidos voltarem.

## Validação

- `tests/unit/domain/profundidade.test.ts`: a contagem, o corte em 3 e a leitura fail-closed do banco.
- `tests/unit/domain/montagem-ferramentas.test.ts` e `plano-turno.test.ts`: o salto fica em 0, 1 e 2 e sai em 3; a
  delegação tem `pedir_a_bot`.
- `tests/unit/domain/prompt-sistema.test.ts` e `pedido-de-colega.test.ts`: a linha do limite em 3 e ausente de 0 a
  2; a frase do penúltimo passe; a rotina sem a promessa; a delegação que pede e a que, no limite, responde a quem
  pediu.
- `tests/unit/use-cases/pedir-a-bot.test.ts`:
  - o pedido em 1 e em 2, e a recusa em 3;
  - a continuação na profundidade certa;
  - a trava atravessando rotina → A → B → C, e ausente em conversa → A → B → C;
  - Clarice → Chico → Dev com entrega única e final, e o aviso de falha que espera.
- `tests/integration/pedir-a-bot.test.ts` e `bot-a-bot.test.ts`: o mesmo sobre o Postgres, com a 0043 (que recusa
  profundidade 4), e a corrente Taga → Dev 1 → Chico → Dev 2 com a trava da rotina de ponta a ponta.
- `tests/concurrency/e2e-catcher.test.ts`: na jornada bot-a-bot, o alvo e a continuação recebem `pedir_a_bot`.

## Gatilho de reversão

- **Custo (confirmado pelo Marlon em 2026-09-30).** Substitui o gatilho de 20% da ADR-058, que foi medido em 19% com
  um salto só e dispararia logo com três. Se os turnos de profundidade ≥ 1 passarem de **35% do custo diário em três
  dias úteis seguidos** (`turnos.custo_usd`), o pedido ganha teto por bot e por dia.
- **Segurança (herdado da ADR-058, agora pela cadeia).** Se aparecer um efeito externo feito por um bot a pedido de
  outro, com o pedido tendo passado por dois ou mais bots, que a pessoa desfaz em até 24 h (trilha: `tool_call` de
  conector de escrita em turno `delegacao` de profundidade ≥ 2 sem item aprovado, seguido de revogação ou relato),
  a cadeia volta a um salto quando o fio leu conteúdo de fora.

## Não implementado

- **Pendência que sobrevive ao turno** (o item 3 da conversa de 2026-09-30, relatos das 14:50 e 14:59). No limite, o
  bot só diz o que falta; nada guarda o pedido para o próximo turno de profundidade 0. Resolvido pela
  [ADR-064](adr-064-pendencias-do-bot.md): no limite, o bot anota com `anotar_pendencia`.
- **Subpedido que nunca termina.** Só turno `despachando` com lease vencido é varrido (`turnos.vencidos`). Um
  subpedido parado em `pendente` para sempre já deixava sem resposta quem o fez, e agora segura também a entrega a
  quem pediu antes dele (`aguardando_colega`). Parar e o fim do turno avisam; cancelar da fila, não
  (`cancelar-turno.ts`).
- **Terminal e pastas na delegação.** Quem cumpre um pedido de colega continua sem terminal, pastas e computador
  (`nativasDoTurno`, `workspace_*` e ADR-047 v1 só os ligam em conversa e criação). "O Chico manda um Dev implementar"
  ainda não funciona, qualquer que seja a concessão.
