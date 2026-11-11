# ADR-163 — Tarefa do quadro é trabalho: cada uma roda à parte, sem teto próprio

Status: proposta · Data: 2026-11-08 (ADA-16, absorve o núcleo da ADA-10) · Emenda a
[ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) §2, §3 e §4, a
[ADR-130](adr-130-a-fala-da-pessoa-nao-espera-os-bastidores.md) (os bastidores da conversa do bot) e a
[ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (o portão do Mac).

## Contexto

O turno da tarefa do quadro ia aos bastidores da conversa do bot. Com a faixa `coalesce(trabalho_id, conversa_id)`, duas
tarefas do mesmo bot caíam na mesma faixa e uma esperava a outra acabar, mesmo sem relação entre elas. Um bot com cinco
cards em Implementando trabalhava um por vez, e o card não dizia se estava rodando, na fila ou esperando a CI.

## Decisão

1. **Origem `quadro` (emenda da ADR-083 §2).** A tarefa do quadro abre um trabalho próprio, `origem = 'quadro'`, com
   `tarefa_id` (a 0163 criou `quadro_tarefa_id`; a 0164, ADA-289, juntou-a à `tarefa_id` da 0153, que já ligava a
   frente à tarefa: trabalho da tarefa = `origem 'quadro'` + `forma 'task'`, frente = `forma 'frente'`). Há **um trabalho
   por (bot, tarefa)**, garantido pelo índice único parcial `trabalhos_da_tarefa` (só `origem 'quadro'` e `forma 'task'`); quem perde a corrida no `criar` relê o vencedor (`daTarefa`, travado) em vez de abrir outro.
2. **A faixa é o trabalho (ADR-083 §3).** Duas tarefas do mesmo bot são duas faixas e rodam juntas. Dois turnos do
   mesmo bot na mesma tarefa caem na mesma faixa e seguem em sequência.
3. **Sessão contínua (núcleo da ADA-10).** Etapas seguidas da mesma tarefa com o mesmo bot reabrem o mesmo trabalho
   (`sincronizarTrabalho` com `reabrir`) e continuam a sessão dele (`trabalho.sessaoCli`). Outro bot na mesma tarefa
   abre o trabalho dele.
   **Emenda de 2026-11-11 (ADA-10, migração 0165).** O número que a pessoa e o bot veem ("Trabalho #N") passa a ser a
   **sessão**, não o gatilho: `quadro_execucoes.sessao`, decidida no `inserir` num statement só. O mesmo bot repete a
   última sessão dele na tarefa (etapa nova, comentário, resposta, recado, nova tentativa automática); outro bot, ou o
   **Repetir**, abre a seguinte. O Repetir também larga a sessão do motor (`trabalhos.largarSessao`): o turno vai sem
   `--resume`, mantendo a pasta e a worktree do trabalho. Quem volta à tarefa depois de outro bot (A→B→A) retoma a própria
   sessão. Cada linha guarda o bot (`agente_id`) e a coluna do gatilho (a etapa, na tela: "#1 · Plano de engenharia").
   `numero` continua o gatilho, interno (ordem, varredor, `cadeiaDoQuadroEncerrada`). Linha sem sessão (backfill ou
   servidor de antes da 0165) vale pelo `numero`. Gatilho de reversão: se a pessoa pedir para ver cada etapa como trabalho
   separado, a tela volta a mostrar `numero` (o dado continua lá).
4. **Sem teto próprio (mantém a ADR-083 §4, "sem teto").** Revisto em 2026-11-10 a pedido do Marlon ("não quero
   limites"): a primeira versão do PR #698 contava os turnos `despachando` do quadro no `reivindicar` (6 por bot, 20 por
   máquina, envs `NOD_QUADRO_TETO_POR_BOT`/`_POR_MAQUINA`). Isso saiu, com as envs e o código. A tarefa do quadro não tem
   limite de quantas rodam ao mesmo tempo, nem por bot nem por máquina. **O recurso é do nod:** o único freio é o mesmo
   dos agentes e das frentes — o portão de recursos da máquina (`portaoDoMac`/`deveSegurar`, uso do Mac
   pouco/equilibrado/livre, ADR-085) e o pool elástico de laços do executor (`pool-lacos.ts`). Em série continua só a
   mesma tarefa com o mesmo bot (a mesma faixa, §2).
   **Emenda de 2026-11-10 (P5 da comparação Multica):** saiu também o teto escondido de 8 começos por lote
   (`MAX_COMECOS_POR_LOTE`, revisão rodada 4 do quadro), que deixava a 9ª tarefa em A fazer sem turno e sem dizer por
   quê. Conferido o risco que ele cobria (um bot criando 50 tarefas num lote): o bot sozinho (limite normal, NOD-430) não
   cria tarefa para outro, não atribui, só mexe nas dele e não se reinicia, então não dispara rajada; o lote da pessoa (ou
   do bot a pedido dela) é decisão dela. Restam os limites que não são teto de paralelo: no máximo 50 passos por lote
   (`LIMITES_QUADRO.ops`) e a corrente de bots, `PROFUNDIDADE_MAXIMA = 3` (ADR-063, `src/domain/profundidade.ts`): o
   turno aberto por um bot que foi aberto por um bot que foi aberto por um bot (3 saltos sem pessoa no meio) não
   começa nada sozinho — a tarefa fica em A fazer, segurada, e o resumo do `gerir_quadro` manda pedir à pessoa. Esse corte
   fica: é contra telefone sem fio entre bots, não contra paralelo.
5. **Portão do Mac (emenda da ADR-085).** A primeira etapa da tarefa (trabalho ainda não começado) entra no portão como
   a rotina e o colega quando o Mac aperta; a etapa seguinte de um trabalho já começado segue. O espaço de 30 s entre
   trabalhos novos de fundo (`ESPACO_FUNDO_MS`) não vale para o quadro: ele serializaria as tarefas paralelas. Quem
   segura a rajada delas é o próprio portão, quando a máquina aperta.
6. **Fora dos bastidores (emenda da ADR-130).** O turno da tarefa não vai mais aos bastidores da conversa do bot; os
   bastidores ficam para o pedido de colega e a triagem. O texto da triagem ("a conversa com a pessoa espera") fica,
   porque continua certo para o colega.
7. **Card.** `ExecucaoTarefa` ganha `esperando`: pendente → **na fila**, despachando → **rodando**, trabalho do
   responsável atual em `rodando` sem turno vivo → **esperando**. "Na fila há X min" (a partir de 1 min, por
   `naFilaDesde`) só aparece com motivo real, e diz qual (`motivoFila`): `mesma_tarefa` (outro turno do mesmo trabalho
   rodando: "termina a etapa anterior desta tarefa") ou o portão da máquina segurando a primeira etapa (`memoria`,
   `processador`, `disco`, pela mesma regra de `esperaDoMac` da tela de Trabalhos). Sem motivo, só "na fila".
8. **Prompt.** O turno da tarefa diz que outras tarefas do bot podem estar rodando e manda trabalhar na pasta da tarefa
   e, num repositório, numa worktree e num branch só dela. Não lista as tasks abertas da dona.
9. **Com a ADA-232/ADA-28 (merge de 2026-11-10).** O trabalho da tarefa abre frentes (`podeAbrirTask` aceita a
   origem `quadro` sem mãe), como o turno da tarefa abria antes; a frente leva o `tarefa_id`. O reacionamento sem saída
   (ADR-155) volta ao trabalho da tarefa mesmo já terminado e o reabre; o parado pela pessoa não volta.

## Alternativas rejeitadas

- **Flag para ligar o paralelo:** o padrão é paralelo; o portão de recursos segura a máquina apertada.
- **Teto por bot e por máquina (a primeira versão do #698):** um segundo limitador ao lado do portão, com número
  arbitrário (6/20) e envs sem tela. O Marlon não quer limites: o recurso da máquina é medido pelo portão, que já vale
  para agentes e frentes.
- **`quadro_execucoes.trabalho_id`:** redundante com `trabalhos.tarefa_id` + agente.
- **Teto também para rotina e colega:** fora do escopo; a ADR-085 segue cuidando da máquina para eles.

## Gatilho de reversão

Se o portão da ADR-085 segurar primeiras etapas do quadro por mais de 10 min no p90, ou a máquina travar (memória ou
disco no vermelho) por rajada de tarefas do quadro antes de o portão reagir, ou se tarefas paralelas do mesmo bot
colidirem em arquivos com frequência: reabrir a discussão de um freio próprio com o Marlon (não religar o teto sozinho)
ou voltar a faixa por bot para o quadro.
