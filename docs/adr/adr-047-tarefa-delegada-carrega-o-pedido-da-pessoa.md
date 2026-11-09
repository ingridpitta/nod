# ADR-047 — Tarefa delegada carrega o pedido da pessoa

Status: aceito · Data: 2026-09-24 · Emenda ADR-025 e ADR-026. ADR-042 ganha uma lista de ações que
nunca são permanentes.

> **Substituída em parte pela [ADR-058](adr-058-um-pedido-entre-bots-com-os-acessos-de-quem-recebe.md)
> (2026-09-29).** `perguntar_a_bot` e `delegar_tarefa` viraram uma ferramenta só, `pedir_a_bot`. Quem recebe
> usa os acessos dele venha o pedido de conversa, sala ou rotina. Saem a exigência da mensagem da pessoa e a
> checagem de conteúdo de fora; a trava da rotina de quem pediu é herdada. Continuam valendo daqui: um salto,
> `NUNCA_PERMANENTE`, entrega única por raiz, avisos de falha e a neutralização dos blocos da entrada.

## Contexto

Marlon pediu ao Taga: "pede ao Dev 1 para me ajudar a revisar o PR #466". O Dev 1 recusou, e a recusa
era o comportamento projetado:

- O Taga só tinha `perguntar_a_bot` (`src/use-cases/perguntar-a-bot.ts`). O turno do Dev 1 nascia com
  origem `peer`, profundidade 1 e entrada `nao_confiavel`, com o texto "outro bot do nod, não
  supervisionado por pessoa".
- `sob_procuracao_de` ficava `null`, e a mensagem de Marlon não chegava ao Dev 1. Quem pediu o
  trabalho sumia no caminho.
- O modo peer tem só `lembrar` (`FERRAMENTAS_NOD_POR_MODO.peer`). O Dev 1 não podia nem pedir acesso
  ao GitHub.

A ADR-026 está certa: o que um bot diz a outro é conteúdo não confiável. Mas o pedido de Marlon não é
conteúdo de bot. É a mesma mensagem que, mandada direto ao Dev 1, abriria um turno confiável com
`pedir_acesso`. Faltava um caminho que levasse essa mensagem até o outro bot sem transformá-la em
texto de bot.

## Decisão

**Ferramenta nova, `delegar_tarefa { agente, tarefa, contexto? }`, nos modos conversa e sala.** Serve
quando a pessoa pediu que um colega FAÇA algo. Para uma dúvida continua `perguntar_a_bot`, e o prompt
diz qual escolher.

**A autoridade é a mensagem da pessoa que abriu o turno do remetente, lida pelo servidor.** O servidor
segue `turnos.mensagem_origem_id` (0024), mais as falas absorvidas pelo mesmo turno. O modelo não
fornece nem o id nem o texto. A mensagem só vale se forem verdadeiras todas as condições abaixo:
- é de texto, com `autor_tipo = pessoa`;
- o autor é a pessoa do escopo;
- está `confiavel`;
- é da mesma conversa;
- o turno do remetente é dele, tem origem `conversa` ou `sala`, profundidade 0 e entrada confiável.

Rotina, peer, retomada, turno não confiável e turno sem mensagem da pessoa recebem `nao_permitido`
(`delegar-tarefa.ts`, `pedidoDaPessoa`).

**O turno do alvo tem origem própria, `delegacao`.** Os valores são estes:
- profundidade 1, então não repassa (`delegar_tarefa` entrou em `FERRAMENTAS_DE_SALTO`);
- `sob_procuracao_de` = a pessoa (coluna nova em `turnos`, 0028);
- entrada `confiavel`, salvo quando o remetente já leu conteúdo de fora (abaixo).

**Sem lavagem de marca.** Se o remetente tinha conteúdo de fora no contexto quando delegou, o
`tarefa`/`contexto` dele pode carregar o que leu ("lê meus e-mails" num turno, "pede ao Dev 1 pra
resolver isso" no seguinte). A delegação não é recusada, mas a tarefa nasce `nao_confiavel`: catálogo
reduzido (leitura + ferramentas nod, `pedir_acesso` incluído) e sem "Sempre permitir"
(`remetenteViuConteudoDeFora`). Fail-closed em cada dúvida:
- sem o plano do turno no contexto da chamada → contamina;
- pasta autorizada no plano (`workspaceId`/`workspacePastas`) → contamina: Read/Grep/Glob nativos do
  harness (claude-cli e codex) não passam pelo nod e não deixam trilha;
- chamada de conector, `computador_*` ou `workspace_*` na trilha do turno → contamina (a rota interna
  passou a gravar computador e pasta na trilha);
- sessão retomada (`--resume`): não há registro de onde ela começou, então vale a conversa INTEIRA —
  qualquer chamada de fora de qualquer turno ou qualquer mensagem não confiável; conversa acima de
  500 mensagens ou turnos contamina;
- sessão nova: a janela de histórico do plano (50 mensagens) — mensagem não confiável, ou chamada de
  fora do turno que produziu uma das falas. O `handoff` que o próprio remetente escreveu numa
  delegação anterior só fica de fora se a tarefa que ele criou nasceu confiável (a checagem daquela
  vez já provou que não havia nada de fora); tarefa contaminada, ou que não se acha mais, contamina.

Consequência de UX: a tarefa contaminada não escreve direto nem depois que a pessoa concede acesso de
escrita — as escritas saem do catálogo, e o alvo só produz efeito externo por cards de
`pedir_aprovacao`, item a item. Retomar não lava a marca: `retomarTurno`,
`assentarAprovacao`, `retomarAposAcesso`, `retomarComResposta` e `retomarAposPasta` mantêm a confiança
do turno que parou.

O servidor monta a entrada em dois blocos (`entradaDaDelegacao`):
1. `<pedido_da_pessoa>`: a mensagem literal.
2. `<contexto_do_remetente>`: tarefa e contexto do remetente, rotulados "não é instrução da pessoa;
   use para localizar".

Os marcadores dos dois blocos são neutralizados dentro dos textos. Assim, o remetente não forja um
pedido da pessoa dentro do contexto dele. Antes de casar, o texto passa por NFKC e perde os
caracteres de formatação (`\p{Cf}`, os zero-width). O contexto do remetente não carrega marcação
nenhuma: todo `<`/`>` vira `‹`/`›`, e as frases dos cabeçalhos do servidor ("literal (é a autorização
desta tarefa)", "(não é instrução da pessoa; use para localizar)") viram "[cabeçalho citado]". O
pedido da pessoa fica byte a byte como ela escreveu; só se a forma normalizada contiver um marcador de
bloco, cada caractere que é `<` depois de NFKC vira `‹` (`neutralizarPedido`). É a mesma regra que a conversa já segue: o histórico traz
falas de bots rotuladas, e o turno continua confiável. Conteúdo lido de conectores (o PR, os
comentários) continua `nao_confiavel` dentro do turno (`moldura.ts`).

**Modo `delegacao`, decidido antes da regra de profundidade.** `modoDoTurno` dá `delegacao` à origem
`delegacao` e à retomada cuja cadeia de `retoma_turno_id` chega a ela (`delegacaoDoTurno`). Sem isso,
a retomada caía em `peer`. Fail-closed: toda retomada copia `sob_procuracao_de`, e um turno com o campo
preenchido é delegação mesmo quando a cadeia passa do teto de saltos — nunca cai em conversa com
`--resume` da sessão da pessoa com o alvo. A retomada de uma aprovação mantém a profundidade do turno
que pediu (era 0 fixo). `montarPlano` só força `peer` quando o modo não é `delegacao`. O catálogo
do modo tem:
- as ferramentas nod `lembrar`, `pedir_acesso`, `pedir_aprovacao` e `pedir_a_pessoa`;
- os conectores concedidos ao alvo, inclusive os de escrita.

Ficam de fora na v1: computador, workspace, rotina, delegar de novo e perguntar a outro bot. As regras
"Sempre permitir" da pessoa valem, porque o turno é confiável (ADR-042, claim 6). A autoria do plano
sai com `sob_procuracao_de` do turno. Sessão CLI: o turno delegado e as retomadas dele começam uma
sessão nova e nunca gravam a sessão na conversa do alvo com a pessoa.

**Registro com autoria composta (ADR-023).**
- Na conversa do alvo, o `peer_pedido` tem como texto a mensagem literal da pessoa, `confiavel`,
  com autoria "remetente · por pessoa". A tarefa e o contexto vão no payload, e a web os mostra fora
  do balão com o rótulo "Contexto de Taga · não é instrução da pessoa".
- Na conversa de origem fica um `handoff` com a mesma autoria. Ele é `nao_confiavel`, porque o
  texto é do remetente.

**Donos diferentes continuam exigindo procuração** (`autorizarDelegacao`). A classe nova é
`delegar_tarefa`. Uma procuração só de `perguntar_a_bot` não basta.

**`delegar_tarefa` só aparece quando o turno pode delegar**: origem conversa ou sala, profundidade 0,
confiável e com mensagem da pessoa. Numa retomada ela estaria no catálogo e sempre negaria.

**`pedir_aprovacao` exige concessão do agente.** Antes bastava a ferramenta estar no catálogo do
CONECTOR: o agente podia propor, e um clique executava uma ferramenta que a pessoa nunca deu a ele.
Agora o item sem concessão do agente é recusado (`nao_permitido`, "peça com pedir_acesso").

**Pedido de acesso.** O card aparece só na conversa do alvo, pelo fluxo atual (ADR-044), e o domínio
aceita escrita. Aprovar leva a `retomarAposAcesso`. A retomada copia `sob_procuracao_de`, e o modo
continua `delegacao` pela cadeia.

**Devolução do resultado.** `entregarRespostaPeer` também entrega o resultado de `delegacao` e o da
retomada dela, com a moldura "Resultado da tarefa que <pessoa> pediu a <alvo>". O conteúdo continua
`nao_confiavel` para o remetente, e a autoria é "alvo · por pessoa". Enquanto QUALQUER turno da cadeia
(a raiz e as retomadas dela) tiver decisão ou pedido de acesso pendente, nada é entregue
(`aguardando_pessoa`): o remetente recebe só o resultado final. O card de CONEXÃO (app ainda não
conectado) não tem decisão: segura a entrega só até o próprio prazo (criação + 24 h, o mesmo de uma
decisão), e o varredor de expiração avisa o remetente depois disso. E o resultado sai uma vez por raiz
(`ja_entregue`): a aprovação decidida durante o long-poll do proxy deixava o turno original terminar
e ainda criava uma retomada, e as duas entregavam.

**Aviso de falha.** Quando a tarefa não vai terminar, o remetente recebe um aviso curto ("Dev 1 não
concluiu: <motivo>"), uma vez por raiz, e pode contar à pessoa. Os gatilhos são três:
- turno delegado (ou retomada dele) interrompido ou concluído sem texto (`depoisDeAssentar`);
- a pessoa recusou o acesso pedido pelo alvo (`decidirAcesso`);
- venceu o card de conexão pedido pelo alvo, ou uma decisão da cadeia — acesso, aprovação, pergunta ou o "Retomar" do turno que caiu com o
  Mac (varredor de expiração). A queda em si não avisa: enquanto o "Retomar" está aberto, a tarefa
  ainda pode continuar.

O motivo é texto do servidor, nunca do modelo. Se a pessoa depois retomar e a tarefa concluir, o
resultado ainda sai.

**Ações que nunca são "Sempre permitir".** A lista curta é `NUNCA_PERMANENTE`, em
`aprovacao-permanente.ts`, e casa pelo NOME da capacidade, para valer igual no GitHub nativo e no
mapeado pelo Composio (ADR-048):
- qualquer nome com `merge`;
- qualquer nome com `approv` ou `aprovar`;
- qualquer nome com `review` ou `revisar` (`pr_revisar`, `GITHUB_CREATE_/SUBMIT_/UPDATE_/DISMISS_A_REVIEW…`).

Leitura fica livre só pela declaração do catálogo sondado (`readOnlyHint === true`):
`GITHUB_CHECK_IF_A_PULL_REQUEST_HAS_BEEN_MERGED` continua chamável porque o catálogo a declara leitura.
Sem a declaração, nome que casa é tratado como escrita (fail-closed); verbo no nome não conta (ADR-042:
`readOnlyHint` nunca se infere do nome).

Ela vale em quatro camadas:
1. `chamarFerramenta` recusa a chamada DIRETA dessas ações em qualquer modo, mesmo com concessão de
   escrita (`alcance_insuficiente`, transitória: "peça aprovação"). Elas só rodam como item aprovado
   de `pedir_aprovacao`, que executa por outro caminho (`decidir.ts`).
2. `permitirSempre` não cria a regra. O item é aprovado, a regra não nasce.
3. `montarPlano` tira o nome de `semprePermitir`, e `decidirAprovacao` pergunta mesmo com linha ativa.
4. A web recebe `nuncaPermanente` em "Sua vez" e mostra o botão desabilitado com o motivo
   (ADR-029: o botão não some).

## Risco aceito

Com "Sempre permitir" em `github__pr_comentar`, um texto injetado no PR pode induzir o Dev 1 a comentar
sem pergunta. É o mesmo risco de Marlon pedir direto ao Dev 1, e o alcance é só comentar. Aprovar e
fazer merge nunca são permanentes: sempre pedem clique.

## Alternativas rejeitadas

- **Tornar o turno peer confiável quando a pergunta vem de uma conversa com a pessoa.** Isso confia no
  texto do REMETENTE, que é saída de modelo e pode carregar conteúdo de conector (ADR-026). A autoridade
  tem que ser a mensagem da pessoa, lida pelo servidor, e não a paráfrase do bot.
- **O modelo passa o id da mensagem da pessoa.** Um modelo influenciado escolheria outra mensagem ou uma
  de outra conversa. O vínculo turno → mensagem já é do servidor (`mensagem_origem_id`).
- **Delegar a partir de rotina.** Não há pessoa pedindo naquele momento. Rotina continua com
  `perguntar_a_bot` (consulta), e execução autônoma a partir de rotina é outra decisão (UAT CO02).
- **Card de acesso na conversa do remetente.** Quem vai usar o acesso é o alvo, e a concessão é dele
  (ADR-013). Mostrar o card no Taga confundiria "Taga pediu" com "Taga recebe".

## Validação

- `tests/unit/domain/tarefa-delegada.test.ts`: modo `delegacao` não vira peer; tem `pedir_acesso` e as
  escritas concedidas; não tem salto nem rotina; `semprePermitir` é preservado, menos `pr_revisar`;
  `sob_procuracao_de` vem preenchido; linhas do prompt; `modoDoTurno`; entrada em dois blocos, sem
  forjar bloco.
- `tests/unit/domain/aprovacao-permanente.test.ts`: `nuncaPermanente` e a recusa em `decidirAprovacao`.
- `tests/unit/web/tarefa-delegada.test.ts`: assinatura composta, contexto rotulado, "Resultado de" e
  botão desabilitado.
- `tests/integration/tarefa-delegada.test.ts`, em Postgres real:
  - o turno nasce `delegacao` e a autoria composta fica gravada;
  - são recusados rotina, peer, retomada, turno não confiável, turno sem mensagem, mensagem de bot e
    turno de outro agente;
  - dono diferente sem procuração ou só com a classe `perguntar_a_bot` é recusado; com a classe
    `delegar_tarefa`, passa;
  - `pedir_acesso` (escrita) abre o card na conversa do alvo; aprovar retoma em modo `delegacao` com as
    ferramentas concedidas; o resultado só volta depois;
  - `permitirSempre` não cria regra de `pr_revisar`.
- `tests/integration/tarefa-delegada-revisao.test.ts` (revisão independente): aprovar PR e merge
  recusados por chamada direta num turno delegado confiável; remetente que leu conector ou computador
  gera tarefa `nao_confiavel`; entrega uma vez por raiz; pendência em qualquer turno da cadeia segura a
  entrega; fail-closed além do teto de saltos e retomada da aprovação com profundidade e confiança
  mantidas; aviso de falha por recusa, interrupção e vencimento, uma vez só.
- `tests/concurrency/e2e-catcher.test.ts`, jornada "tarefa delegada": Marlon → Vera → `delegar_tarefa` →
  Tuca → resultado de volta à Vera, e uma tarefa que falha no Tuca volta como aviso, sobre o servidor
  completo.

## Gatilho de reversão

- Qualquer turno `delegacao` cuja mensagem de autoridade não seja de `autor_tipo = pessoa`. É violação
  da decisão: desligar `delegar_tarefa` no mesmo dia. A consulta liga
  `turnos.sob_procuracao_de` → `turnos.mensagem_origem_id` do turno de origem, e esse turno está no
  `peer_pedido`.
- Um comentário publicado sob "Sempre permitir" que a pessoa apaga ou desautoriza depois, duas vezes
  no mesmo mês. Nesse caso, comentar também entra em `NUNCA_PERMANENTE`.
- Se mais da metade das delegações em 30 dias terminar em recusa do alvo por falta de autoridade, o
  prompt do remetente não está escolhendo a ferramenta certa. Rever a linha de colaboração antes de
  ampliar qualquer catálogo.

## Não implementado

- Turno de sala criado por `postar-na-sala` não grava `mensagem_origem_id`. Por isso `delegar_tarefa`
  ali é recusada (fail-closed). Na conversa própria e na sala via `enviarMensagem`, funciona.
- **Pré-condição antes de existir rota de procuração:** entre donos diferentes, o turno do alvo, o
  `peer_pedido` e o card de acesso são gravados no escopo da pessoa REMETENTE, dentro da conversa do
  dono do alvo (herdado de `perguntar_a_bot`; hoje inalcançável, porque procuração não tem rota nem
  UI). Resolver quem escreve no espaço do outro dono antes de abrir a procuração.
- Anexos da mensagem da pessoa não vão para a tarefa.
- O teto diário da procuração não é contado (`gastoHoje = 0`, como em `perguntar_a_bot`).
- A web assina "Taga · por você" e não "por Marlon": a sessão da web não carrega o nome da pessoa.

## Emenda de 2026-10-09 — quem pediu foi excluído

**Contexto.** Em produção, a Elis pediu ao Ze 1 a fatia 5 do PR #764 e foi excluída às 15:11, com o Ze 1 ainda
trabalhando na VM. Quando ele terminou, a entrega da resposta (`entregarRespostaPeer`) lançou 404 "bot remetente" dentro
do assentamento. A transação voltou inteira, a VM tentou entregar três vezes e desistiu, e o turno do Ze 1 caiu por
lease vencido como "seu Mac parou de responder". Isso aconteceu duas vezes, às 16:52 e às 16:53. Nos dois casos a
resposta se perdeu, embora a máquina estivesse de pé.

**Decisão.** Com quem pediu excluído, a entrega e o aviso de falha devolvem `ignorado: "remetente_excluido"`: não há a
quem continuar, e a resposta fica na conversa de quem a escreveu, porque o assentamento conclui. O varredor de pedidos
parados (`pedidosAColegaParados`) deixa de listar o pedido cujo remetente (`handoff.payload.de`) foi excluído. Antes,
ele voltaria ao pedido a cada 5 min até a janela fechar.

**Validação.** Integração `pedidos-parados`: com a Ada excluída, o turno do Dev conclui, a resposta fica na conversa
dele, entrega e aviso devolvem `remetente_excluido` e o varredor não volta ao pedido. Sem a correção, o teste falha com
o 404.

## Emenda de 2026-10-15 — o pedido fecha quando o colega o resolve na conversa (NOD-262)

**Contexto.** A Clarice pediu algo ao Milton (tarefa 20f4696b, 14/10, bugs a5d1121a e e3f3c0e3). O turno `delegacao`
ficou pendente, segurado pela cota. Nesse meio-tempo, a pessoa falou com o Milton na conversa dele e ele resolveu o
assunto ali. A resposta a quem pediu só sai pelo turno da própria delegação (`entregar`), e a fila lida junta
(`absorverPendentes`) só absorve turnos de conversa e sala. Resultado: a Clarice continuou esperando e, quando o turno do
pedido rodou, o trabalho foi refeito.

**Decisão.** Na conversa e na sala, o prompt lista os pedidos de colegas ainda na fila do bot: os 5 mais antigos, com
`tarefa_id`, quem pediu e o pedido cortado em 200 caracteres, marcado como dado. Só nesse caso o catálogo ganha
`responder_pedido(tarefa_id, texto)`. A ferramenta confere de novo se o turno é do próprio bot com a pessoa e se o
pedido é uma delegação dele ainda `pendente`. Então, num SAVEPOINT, tira a delegação da fila como
`interrompido`/`absorvido`, com `absorvido_por` = o turno que respondeu, e entrega o texto pelo caminho de sempre
(`entregarRespostaDeclarada` → `entregar`: a `peer_ask` e a continuação de quem pediu). Se a entrega não sai
(`ja_entregue`), a delegação volta à fila. Quem pediu excluído é a exceção: o pedido sai da fila mesmo assim. Se a
conversa leu conteúdo de fora (ADR-062), a delegação e a continuação herdam a marca. Recusa não grava nada. Sem a
chamada, nada muda: a delegação roda como sempre.

**Fora.** Fechamento automático sem o bot declarar, a delegação já em despacho (responde sozinha ao assentar), os modos
delegação, rotina, criação e ligação, e a interface.

**Validação.** Integração `responder-pedido`: CA1 (peer_ask, absorvido, continuação; a segunda chamada é recusada), CA2
(sem chamada, a entrega normal), CA3 (outro bot, turno alheio, delegação em despacho: recusa sem efeito), CA4 (o plano
emitido lista o pedido e traz a ferramenta; o seguinte, não), CA5 (o varredor de pedidos parados ignora), e a marca da
ADR-062. Unitário `pedidos-pendentes`: catálogo por modo, snapshot da linha, o "+N" e o corte.
