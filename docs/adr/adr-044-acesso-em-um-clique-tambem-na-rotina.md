# ADR-044 — Acesso em um clique, também na rotina

Status: aceito · Data: 2026-09-24 · Emenda ADR-013, ADR-035 e ADR-043. EMENDA 16 inalterada. Emendada em 2026-10-18
(chat limpo, PR 4: o registro de autorização no cartão encolhido).

## Contexto

A Nina tem uma rotina que lê o Gmail ("E-mails às 8h, 13h e 18h") e não tinha concessão. No modo
rotina `pedir_acesso` não estava no catálogo (`FERRAMENTAS_NOD_POR_MODO.rotina`) e o prompt mandava
"se faltar acesso… informe o bloqueio". Ela pedia por `pedir_a_pessoa` — um card de texto — a cada
disparo, três por dia.

Conceder era um fluxo de dois cliques em dois objetos: "Revisar acesso" (`POST propostas/:id/confirmar`)
criava a decisão 'acesso'; só "Permitir acesso" (`POST decisoes/:id/decidir`) concedia. A pessoa e o
agente entendiam que o primeiro clique já concedia: a ferramenta devolvia só `{proposta_id}` e a
mensagem de sistema dizia "Confirmado… A partir de agora vale". E um clique nas 28 ferramentas de
leitura do Gmail escreveria 28 mensagens de consentimento.

Buraco de segurança no mesmo caminho: `retomarComResposta` gravava a retomada com
`entradaConfianca: "confiavel"` fixo, e `modoDoTurno` mapeava origem 'retomada' para 'conversa'. Uma
rotina que leu e-mail (entrada `nao_confiavel`, ADR-026) e perguntou algo à pessoa voltava confiável,
com o catálogo da conversa (criar, pausar e excluir rotina, ferramentas de escrita) e sem o gate
`efeitoExternoSoPorAprovacao` (EMENDA 15).

## Decisão

**Acesso se pede por botão: proposta e decisão de mesmo id, um clique.** Com o app conectado,
`pedir_acesso` cria as duas juntas, como `propor()` do ADR-043. O card da conversa e "Sua vez" decidem
pelo mesmo `POST decisoes/:id/decidir`, que chama `decidir-acesso.ts`: fecha a decisão, marca a
proposta confirmada (o card sai da conversa), concede o lote e continua. App ainda não conectado
continua sendo só o card de conexão; depois de conectar, pedido de LEITURA vira no lugar o card de um
clique (`confirmar-proposta.ts`). `confirmar` fica para as propostas anteriores e, quando a decisão
de mesmo id já existe, só a devolve.

**A frase é do domínio** (`fraseDoPedidoDeAcesso`): nome do app, verbo pelo `readOnlyHint` do catálogo
(ler, alterar), a rotina que pediu e o que fica de fora — curado por app em `naoIncluiNaLeitura` (Gmail:
enviar, apagar, arquivar) ou, sem curadoria, a contagem das ações de escrita. Nenhum nome de
ferramenta na frase: a lista técnica vai para o `<details>` do card. O resultado da ferramenta é
`{proposta_id, estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu
e encerre o turno"}`.

**Também na rotina, só leitura.** `pedir_acesso` entra no modo rotina. O domínio recusa escrita
(`nao_permitido`, pelo nível e pela ferramenta) e resolve `capacidades: []` para as ferramentas de
leitura do app. O pedido carrega `rotinaId`: permitir reativa a rotina se estava pausada e a dispara
AGORA em modo rotina (janela no instante do clique em ms, `preservarAgenda`); recusar pausa a rotina.
O pedido pendente de uma rotina é chaveado por (agente, conector, rotina), sem olhar turno nem
capacidades, e `pedir_a_pessoa` por (agente, tipo, rotina): o disparo seguinte reaproveita o card em
vez de abrir outro. No prompt da rotina entram só os slugs dos apps; o catálogo de cada conexão
(~4-5 mil tokens) fica de fora, porque execuções com mais de 1 h entre si perdem o cache ephemeral_1h.

**Consentimento por lote.** `concederLote` escreve UMA mensagem imutável para N capacidades do mesmo
app; cada concessão aponta para ela (a unicidade do banco continua por capacidade). O painel do bot
agrupa por app e nível ("Gmail · só leitura · 28 ações") e revoga o grupo com um registro
(`revogarLote`). Só `decidir-acesso.ts` e a concessão manual da tela Conectores (rota de pessoa) chamam
`conceder`/`concederLote` — regra do eslint, provada em `tests/conformidade/conceder-so-pela-pessoa.test.ts`;
o nome `conceder-acessos-da-rotina.ts` fica reservado para a concessão junto do nascimento da rotina.

**Retomada ligada a uma rotina continua rotina.** `rotinaDoTurno` segue `retomaTurnoId` até 5 saltos.
`modoDoTurno` dá 'rotina' à retomada ligada, com o `exigeAprovacao` da rotina, sessão CLI nova e sem
gravar a sessão dela na conversa (como a rotina, ADR-035). O gate passa a vir da rotina ligada
(`rotina?.exigeAprovacao === true`), não de `origem === 'rotina'`. `retomarComResposta` mantém a
confiança do turno que parou e acrescenta a entrada original da rotina, que a sessão nova não teria.

**EMENDA 16 inalterada.** Pergunta ≠ permissão; `pedir_a_pessoa` continua na rotina para o que não é
acesso a app. O prompt só proíbe usá-lo para pedir acesso.

## Alternativas descartadas

- **A rotina concede a si mesma a leitura, sem botão.** Conceder é ato da pessoa (ADR-013); o botão
  de um clique já tira o atrito sem tirar o ato.
- **Manter os dois passos com cópia melhor.** O erro era estrutural — dois objetos, e o agente
  anunciava acesso no primeiro. Texto não impede o modelo de ler `{proposta_id}` como concessão.
- **Escrita na rotina por botão.** A rotina roda sem ninguém olhando; efeito externo segue item a item
  por `pedir_aprovacao` (EMENDA 15), e a concessão de escrita segue pela conversa.

## Validação

`tests/unit/domain/pedido-acesso.test.ts` (normalização, leitura, frase), `pedir-acesso-rotina`,
`pedir-acesso-sem-gemeas` (decisão de mesmo id; dedupe da rotina entre disparos),
`pedir-a-pessoa-rotina`, `retomar-apos-acesso` (sem passo de confirmar; permitir dispara turno origem
'rotina'; recusar pausa), `conceder` (lote → uma mensagem), `tests/unit/web/decisoes-chat` e
`navegacao-sem-rail`, `assentar-turno-sessao-rotina`. `tests/integration/acesso-rotina.test.ts` roda
o fluxo no Postgres e prova a correção de segurança: a retomada de uma rotina `nao_confiavel`
continua `nao_confiavel`, em modo rotina, com o gate e sessão nova, e a de rotina confiável tem a
ferramenta de escrita negada (`alcance_insuficiente`). Agente excluído e restaurado (geração nova,
ADR-034) com o pedido reaberto: a concessão fica, a rotina da geração antiga não é reativada nem
disparada — a mesma trava de `retomarAposAcesso`; conferido em 2026-09-24 que o teste falha sem ela.
Nenhuma migração.

Verde em 2026-09-24: lint, typecheck (4 projetos), fence:domain, 104 arquivos / 575 testes unit,
73 / 261 integration, 8 / 57 conformidade e 19 / 65 concurrency (1 pulado).

## Gatilho de reversão

- Se, em 30 dias de uso, mais da metade dos pedidos de acesso vindos de rotina forem recusados
  ("Pausar rotina") ou o grupo de leitura for revogado em até 24 h depois de permitido, "todas as
  ferramentas de leitura do app" está largo demais: a rotina volta a pedir capacidades exatas do
  catálogo, mantendo o botão único.
- Se aparecer mais de uma proposta de acesso pendente para o mesmo (agente, conector, rotina), a chave
  de dedupe está errada — medir por consulta em `propostas` com `payload->>'rotinaId'`.
- Se, em 3 UATs, a retomada de rotina em sessão nova refizer a execução inteira em vez de continuar,
  rever a sessão: retomar a sessão da PRÓPRIA rotina, nunca a da conversa.

## Não implementado

A concessão junto do nascimento da rotina (`concederAcessosDaRotina`). As retomadas de `retomarTurno`
(frase da pessoa) e de `assentarAprovacao` ainda gravam `confiavel`; o modo e o gate de rotina já valem
para elas por `modoDoTurno`, mas a confiança não. Escrita pedida por rotina.

## Emenda de 2026-09-24 — rotina se trava sozinha

**Contexto.** Mesmo com o botão de um clique, a rotina de Gmail da Nina seguiu rodando 3x/dia sem a
concessão: cada execução gastava um turno de modelo (~US$ 0,09), descobria no meio que não tinha acesso,
falhava e deixava um card. O servidor sabe ANTES de gastar: a fonte da rotina cita o app (o mesmo
casamento que `confiancaDaFonte` já faz, ADR-026) e as concessões do agente estão no banco. E a chave de
dedupe desta ADR — (agente, conector, ROTINA) — dava dois cards para a mesma concessão quando duas
rotinas do mesmo agente liam o Gmail.

**Decisão.** Pré-voo em `dispararRotina`, depois de reivindicar a janela (ADR-011 inalterado) e antes de
enfileirar o turno, no agendador e no "executar agora" — menos no disparo que `decidirAcesso` faz logo
depois de a pessoa permitir (`aposConceder`).

- **O que a rotina precisa** (`src/domain/rotina-acessos.ts`, puro). `conectoresCitados(fonte,
  registrados)`: o casamento exato de `confiancaDaFonte` (slug ou nome contido, sem caixa), só sobre os
  conectores que a pessoa REGISTROU — "regressão linear" não cita o Linear que não existe;
  `confiancaDaFonte` passou a usá-la, com o mesmo resultado. `necessidadesDaRotina`: os `acessos`
  declarados, quando a rotina os tiver (a coluna nasce no PR "rotina nasce com o acesso"; presente,
  mesmo vazio, ganha da fonte), senão os apps citados, pedindo leitura. Somam-se os apps que um turno da
  rotina já pediu por `pedir_acesso` e seguem com card aberto — a rotina falharia igual na janela
  seguinte. `faltaDeAcesso`: `sem_conexao` (app não registrado ou desligado), `sem_acesso` (sem
  concessão) ou nada.
- **A regra da capacidade.** Rotina sem `acessos` declarados se satisfaz com UMA ferramenta de leitura
  concedida no app; declarada exige todas as que declarou. Por quê: o escopo é nomeado (E6.2) — o card
  pede as ferramentas de leitura do catálogo, pelo nome, resolvidas quando o card nasce, nunca depois; o
  `readOnlyHint` é dado TIPADO, capturado na sonda (ADR-013), não inferido de texto; e a concessão é
  revogável por capacidade (o grupo "só leitura" do painel revoga em lote, cada linha segue sendo uma
  capacidade). "Tem alguma leitura do Gmail" é o que o servidor consegue afirmar sem interpretar a
  instrução; pedir as 28 de novo porque a pessoa revogou uma travaria a rotina por um detalhe que o
  modelo contornaria. App citado sem nenhuma ferramenta de leitura no catálogo não trava: não haveria o
  que pedir por botão.
- **Um card por (agente, app).** Índice único parcial `propostas_acesso_de_rotina_aberta (tenant_id,
  owner_id, agente_id, payload->>'conector') WHERE kind = 'acesso' AND estado = 'pendente' AND payload ?
  'rotinaId'` (migração 0026). Todo INSERT de pedido com `rotinaId` passa por
  `propostas.criarAcessoDeRotina` (ON CONFLICT DO NOTHING, e devolve o que já estava) via
  `garantirPedidoDeAcesso` — o pré-voo, o `pedir_acesso` de turno de rotina e o "Continuar tarefa" do card
  de conexão; um INSERT direto daria 23505 no meio da ferramenta. O card reaproveitado serve a qualquer
  rotina do agente. Card de conexão com o app já ligado sai (confirmada) e vira o de um clique, da mesma
  rotina; card de um clique com a decisão fechada sai (recusada) e nasce outro. Antes do índice, a 0026
  fecha as sobras que o banco diário podia ter (o pedido 'pendente' cuja decisão venceu → recusada; por
  (dona, agente, app) fica o mais antigo, os outros recusados com a decisão fechada por
  'regra:pedido_de_acesso_unico'), entre NO FORCE/FORCE.
- **Trava.** `concessoes.travar(agente, conector)` — `pg_advisory_xact_lock`, como `agentes.excluir` — no
  pré-voo (em ordem de conector, antes de ler as concessões) e no começo de `decidirAcesso`, antes de
  tocar qualquer linha. Sem ela, um tick no meio do clique lia "sem concessão" e depois "sem card
  pendente" e abria um card para um acesso que acabava de ser dado.
- **A janela parada.** `desfecho_rotina += 'bloqueada'` (0026, no fim do enum); o motivo
  (`sem_conexao | sem_acesso | aguardando_resposta`, `MOTIVOS_BLOQUEIO_ROTINA`) vai em
  `rotina_execucoes.motivo`, text com CHECK, sem enum. A execução nasce SEM turno, poda para as 20, emite
  `rotina_bloqueada` (frame `rotina.executou`) e NÃO escreve no chat — o card já está lá. A agenda anda
  como num disparo normal. `SaidaDisparo` ganha `{ bloqueada, propostaId, proximaExecucao }`; o agendador
  conta `bloqueadas`; "executar agora" devolve `turnoId: null` com o bloqueio, a rota leva
  `ids.bloqueada` e `ids.propostaId`, e a web abre a conversa onde o card está.
- **Pergunta pendente.** Só no agendador: a pergunta de `pedir_a_pessoa` de uma execução anterior da
  mesma rotina ainda aberta para a janela (`aguardando_resposta`, sem card) — o fio segura a janela
  (emenda da ADR-045). "Executar agora" é ato da pessoa e roda.
- **Card sem turno.** O card do pré-voo nasce com `turnoId` nulo e com `geracao` (a geração de execução
  do agente, ADR-034) no payload: agente excluído e restaurado com o card reaberto concede, mas não
  reativa nem dispara a rotina da geração antiga — a mesma trava que `execucaoBloqueada` dá ao card com
  turno. Conferido em 2026-09-24 que o teste falha sem ela.
- **Vencimento.** O pedido de acesso de rotina que vence (varredor) sai como recusada e PAUSA a rotina,
  com a linha única "Rotina pausada: ninguém liberou o acesso ao {App} em 24h. Reative quando quiser."
  no lugar da de vencimento (`pausarRotina` ganhou `texto`). Reativar faz o pré-voo abrir um card novo;
  "Reabrir" no card vencido continua valendo (`decidirAcesso` não exige a proposta pendente) e fecha o
  card novo igual como gêmea.
- **Web.** `RotinaDto.bloqueio {motivo, app, slug, desde, decisaoId, rodaNaHora, naoRodaram}`; lista e
  painel do bot: tag âmbar "parada · falta acesso ao {App}" (ou "falta conectar o {App}") com o mesmo
  botão "Permitir e rodar agora" (ou "Conectar"); se o card é de OUTRA rotina do agente (`rodaNaHora`
  falso), o botão diz só "Permitir acesso" — permitir roda a dona do card, e esta na próxima janela.
  Histórico "parada (sem acesso)". Barra lateral: "rotina parada" em âmbar
  quando há pedido de rotina aberto. Card no chat e em "Sua vez" (`rotinaParada` no item): tag "rotina
  parada" + "desde ontem 13:00" (`desdeQuando`, no fuso da rotina) e "Não rodaram: ontem 13:00, ontem
  18:00 e hoje 08:00. Nenhuma tentativa gastou crédito."; o relógio do card diz "a rotina pausa sozinha
  em 18h" (o Record de prazos por tipo recebe o item, e segue exaustivo).

**Alternativas descartadas.**

- **Deixar o turno rodar e pedir no meio** (o que esta ADR fazia): correto, mas paga um turno por janela
  para descobrir o que o banco já sabia.
- **Classificar a fonte com o modelo** ("esta rotina usa o Gmail?"): texto do modelo decidindo trava é
  interpretação, não dado; o casamento de nomes já é a regra de confiança da fonte.
- **Card por rotina** (a chave anterior): duas rotinas do mesmo agente pediam a mesma concessão em dois
  cards, e decidir um deixava o outro órfão.
- **Uma linha no chat por janela parada:** era o ruído que se queria tirar; o histórico da rotina guarda
  cada janela e o card conta quantas não rodaram.
- **Pausar já na primeira janela sem acesso:** tira da pessoa o "Permitir e rodar agora"; a pausa fica
  para quando o card vence sem resposta.

**Validação.** unit `domain/rotina-acessos` (citação só sobre registrados; declarado ganha da fonte;
`sem_conexao` × `sem_acesso` × ok; uma leitura basta na legada), `use-cases/disparar-rotina` (janela sem
turno e sem mensagem; um card em três janelas; agenda anda; permitir roda na hora e libera; "executar
agora" com `turnoId` nulo; conexão vira um clique; card de `pedir_acesso` segura e concessão manual
libera; pergunta pendente só no agendador; app não registrado não trava), `web/rotinas-parada`;
integração `rotina-bloqueio` (a Nina ponta a ponta: três janelas, um card, a tela, permitir, 24 h sem
resposta → recusada + pausa + a linha, reativar → card novo, "Reabrir" → roda; agente restaurado não
dispara a rotina antiga; duas rotinas, um card de conexão que vira de um clique) e `varredor-expiracao`;
concorrência `rotina-bloqueio-um-pedido` (duas rotinas no mesmo tick → um card; a segunda espera a
trava; o clique contra o tick → o tick espera e roda, nenhum card novo; `criarAcessoDeRotina` em duas
conexões → nunca 23505); conformidade `motivos-enum` ('bloqueada' no fim de `desfecho_rotina`; os
motivos de bloqueio passam no CHECK). A limpeza da 0026 foi conferida num banco descartável com
duplicatas semeadas: a vencida recusada, a mais antiga mantida, a sobra recusada com a decisão fechada
pela regra, a de outro app e a da conversa intactas.

Verde em 2026-09-24, sobre a `main` a6d0114, com a 0026 aplicada num banco descartável: lint, typecheck
(4 projetos), fence:domain; unit 128 arquivos/761 testes, integration 80/292, conformidade 8/60,
concurrency 24/75 (1 pulado).

**Gatilho de reversão.**

- Citação acidental: se em 30 dias 2 rotinas pararem por um app que a fonte cita mas a rotina não usa
  (medido por execução 'bloqueada' seguida de "Pausar rotina" ou de edição da fonte), a fonte deixa de
  travar — só os `acessos` declarados travam — e volta a decidir só a confiança (ADR-026).
- Leitura larga demais: se em 30 dias mais da metade dos cards do pré-voo forem recusados ou vencerem,
  o card passa a pedir as capacidades exatas que a rotina declarar, mantendo o botão único.
- Se aparecer mais de um pedido de rotina pendente para o mesmo (agente, app), o índice caiu ou alguém
  inseriu por fora de `criarAcessoDeRotina` — medir por consulta em `propostas` agrupando por
  `payload->>'conector'`.

**Não implementado.** O card de CONEXÃO não tem decisão e por isso não vence: a rotina que espera uma
conexão fica parada (cada janela 'bloqueada', sem turno) até a pessoa conectar ou pausar. Permitir
roda na hora só a rotina do card; outra rotina do mesmo agente que esperava o mesmo app roda na
próxima janela dela. O segundo "executar agora" no mesmo minuto cai na janela já reivindicada e não
traz o bloqueio. Os `acessos` declarados (PR 6) têm só o formato aqui.

## Emenda de 2026-09-24 — rotina nasce com o acesso

**Contexto.** A rotina de Gmail da Nina nasceu em 18/09 com fonte "Gmail do Marlon", e nada pediu o
acesso que ela obviamente precisava: falhou desde a primeira execução. A emenda anterior para a janela
antes de gastar um turno, mas o card só aparece DEPOIS da primeira janela — horas depois de a pessoa ter
estado ali, criando a rotina. A pessoa está presente na criação: é o momento certo de consentir.

**Decisão.** A rotina DECLARA o que lê ou altera, e confirmar a rotina concede.

- **Coluna.** `rotinas.acessos jsonb` (0027), com CHECK `rotinas_acessos_lista` (null ou lista), sem
  backfill. null = rotina anterior: o pré-voo segue lendo a fonte. Presente, mesmo vazia, a declaração
  ganha da fonte (`necessidadesDaRotina`, como a emenda anterior já previa). Cada item é o
  `AcessoPedido` já normalizado (`conector`, `capacidades`, `nivel`, `naoPedido`).
- **Ferramentas.** `criar_rotina` e `atualizar_rotina` aceitam `acessos: [{conector, capacidades, nivel,
  nao_pedido}]` — os argumentos de `pedir_acesso`, `additionalProperties: false`. Em `atualizar_rotina` é
  a lista NOVA e inteira; só entra na proposta se muda a declaração, e só declarar já é mudança.
- **Validação no domínio** (`normalizarPedidoAcesso` em modo `declaracao`, via
  `normalizarAcessosDeclarados`): app registrado ou do marketplace, capacidades do catálogo sondado, um
  item por app. Leitura com `[]` num app conectado vira as ferramentas de leitura do catálogo AGORA e fica
  GUARDADA na proposta — é o que o card mostra e o que confirmar concede. App por conectar fica com `[]` e
  `conectar`. Escrita exige os nomes exatos, mesmo com o app por conectar. Erro volta tipado à ferramenta
  (`{erro}`), como as outras validações da rotina.
- **Conceder ao confirmar** (`conceder-acessos-da-rotina.ts`, o nome reservado). `ativarRotina` — o
  caminho do chat (`confirmarProposta`) e o da decisão 'rotina' em "Sua vez" (`decisoes.ts`), os dois por
  `services.rotinas.ativar` sobre a transação corrente — grava os acessos na rotina e concede, na MESMA
  transação, o que é de app conectado e habilitado: por app, a trava (agente, conector) do pré-voo e
  `concederLote`, com UMA mensagem de consentimento por app. App por conectar é pulado; o pré-voo abre o
  card quando ele conectar. Leitura declarada sem capacidades vira as de leitura do catálogo de agora
  (o botão só libera depois de conectar). A segunda ativação não concede de novo, e `concederLote` não
  escreve mensagem para o que já estava concedido. `aplicarAtualizacaoRotina` concede o que a mudança
  declara; app que sai da lista não é revogado (revogar é pela tela, por capacidade).
- **Escrita declarada no turno de rotina.** `pedir_acesso` em turno de rotina aceita também a escrita que
  a rotina declarou para o app (pelo nome); escrita fora da declaração segue `nao_permitido`. O gate da
  rotina (EMENDA 15) não muda: efeito externo continua item a item por `pedir_aprovacao`.
- **Pré-voo.** Declaração com capacidades exige todas concedidas (como já era); leitura declarada com
  `[]` se comporta como a rotina legada (uma de leitura basta; o card resolve as de leitura quando nasce).
- **Web.** O card da rotina proposta (chat e "Sua vez") ganha a linha em destaque "Precisa" por app:
  ícone, "Ler seu Gmail" / "Alterar seu {App}" / "Ler e alterar…" pelo `readOnlyHint`, "Não inclui: enviar,
  apagar, arquivar." (curadoria, que agora também chega à web pelo marketplace mesclado) e as ações no
  `<details>`. Botão principal "Criar rotina e permitir leitura" (ou "…e permitir acesso" com escrita),
  secundário "Deixar de lado". App por conectar: "Conectar {App}" vem primeiro (`abrir-conexao`) e o botão
  de criar fica desabilitado com "Liberado assim que o {App} conectar." O mesmo na mudança de rotina que
  traz acessos ("Aplicar mudança e permitir leitura"). "Sua vez" passa a carregar os conectores.
- **Prompt.** A linha de `criar_rotina` manda declarar `acessos` quando a rotina lê ou altera um app: um
  item por app, slug e nível, `[]` para leitura, nomes exatos para escrita.

**Alternativas descartadas.**

- **Inferir o acesso da fonte na criação** ("Gmail do Marlon" → Gmail): é interpretação de texto; a fonte
  segue só como a rede da rotina antiga, e quem declara é o modelo, com a pessoa conferindo no card.
- **Conceder sem mostrar o que** ("Confirmar" como antes): o consentimento seria implícito; o botão agora
  diz que libera e a linha "Precisa" diz o quê.
- **Um pedido de acesso separado logo depois da rotina:** dois cards para uma decisão, e o segundo chega
  quando a pessoa já saiu da conversa.

**Validação.** unit `domain/pedido-acesso` (modo declaração; escrita declarada no turno de rotina),
`domain/rotina-acessos` (`normalizarAcessosDeclarados`, `mesmosAcessos`, leitura `[]` → legada),
`use-cases/criar-rotina-acessos` (leitura resolvida e guardada; escrita sem nomes, app inventado e
capacidade fora do catálogo recusados sem proposta; confirmar concede com um consentimento e pula o app
por conectar; atualizar só com acessos; `pedir_acesso` com escrita declarada), `domain/prompt-sistema`,
`web/rotina-precisa` (linha "Precisa", rótulos, botão desabilitado + "Conectar Gmail", "Sua vez");
integração `rotina-nasce-com-acesso` (confirmar concede na mesma transação — desfeita a confirmação num
savepoint, não sobra concessão nem rotina —, um consentimento, idempotente, e a primeira janela roda sem
card; app por conectar pulado e o pré-voo abre o card de conexão; a mudança concede ao ser aplicada; o
CHECK recusa `acessos` que não é lista); conformidade `conceder-so-pela-pessoa` (o arquivo reservado agora
importa `concederLote`).

Verde em 2026-09-24, sobre a `main` dc3f5b2, com a 0027 aplicada num banco descartável: lint, typecheck
(4 projetos), fence:domain; unit 130 arquivos/780 testes, integration 81/296, conformidade 8/60,
concurrency 24/75 (1 pulado).

**Gatilho de reversão.**

- Se, em 30 dias, mais de 1 em cada 5 rotinas criadas com `acessos` tiver o grupo concedido revogado em
  até 24 h, ou for excluída sem nenhuma execução, o consentimento embutido está largo demais: a
  confirmação volta a só criar a rotina e o acesso vira um card de um clique logo abaixo, no mesmo chat.
- Se aparecer rotina nova (criada depois desta emenda) com `acessos` null cuja fonte cita um app
  registrado — medido por consulta em `rotinas` com `criado_em` posterior e `acessos is null` — o modelo
  não está declarando: a declaração vira obrigatória no schema de `criar_rotina` (lista, mesmo vazia).

**Não implementado.** O card de acesso do pré-voo que já estava aberto para o app quando a mudança de
rotina concedeu não fecha sozinho: vale o clique (idempotente) ou o vencimento. A lista de rotinas e o
painel do bot ainda não mostram os acessos declarados.

## Emenda de 2026-09-29 — um card por app no painel do bot

O painel agrupava por app **e** nível: quem concedeu leitura e depois escrita via Gmail, Slack e ClickUp
em dois cards cada (medido em 2026-09-29 no painel da Clarice: 11 cards para 7 apps). Agora é UM card
por app, com o logo do Marketplace (`logoApp`, ADR-057) no lugar da inicial. O nível vira a linha de
baixo do nome ("só leitura", "pode alterar", "pode ler e alterar"); a lista aberta separa "Consulta" de
"Altera" quando há as duas; "Revogar" tira tudo do app com um `revogarLote` e "Deixar só leitura" tira
só as de escrita — o que o card de escrita separado permitia antes. A chave é o slug, não o conector:
dois registros do mesmo app continuam uma ferramenta. A classificação segue o `readOnlyHint` da sonda.

## Emenda de 2026-10-18 — o registro de autorização mora no cartão encolhido

Plano do chat limpo, Parte 3 (PR 4; [ADR-114](adr-114-chat-limpo.md), emenda do PR 4). Depois do Permitir, o cartão do
pedido de acesso não some mais deixando a linha "Acesso permitido · Gmail" no fim da conversa: ele **encolhe no lugar**
(a âncora do pedido, a última fala do turno que pediu), com a frase do pedido como título e "Acesso permitido · Gmail ✓"
como resultado. O consentimento continua sendo a mensagem imutável e citável da ADR-013, gravada na mesma transação da
concessão; o texto inteiro dela continua legível no cartão encolhido, em **"Ver registro de autorização"**, como era na
linha. O "Sempre permitir" (ADR-042) segue o mesmo desenho: "Sempre permitir editar no Google Sheets" e "Regra nova",
com o cadeado e o registro atrás do mesmo "Ver registro de autorização".

Para encolher no lugar, o payload do `consentimento` dado por um pedido (`decidirAcesso` → `concederLote`) ganha a
decisão, o turno que pediu e a frase do pedido (`decisaoId`, `turnoId`, `frase`); o da tela Conectores, do cartão
"Liberar" e o da rotina não têm pedido e encolhem onde estão. A regra permanente ganha payload próprio
(`regra_permanente { decisaoId, turnoId, acoes }`); a linha antiga, sem payload, continua reconhecida pela frase e
desenhada como antes. O consentimento dado pela aprovação automática (`decidido_por` de regra) não encolhe: não houve
cartão nem clique, e ele mora na Atividade do bot (ADR-114).

## Emenda de 2026-10-30 — o card comum da NOD-399

Na conversa, o card de proposta passou a ser o componente comum da NOD-399 (`web/lib/card-proposta.ts`, protótipo
v2 aprovado pelo Marlon). O que muda aqui:

- O secundário de toda proposta na conversa é **"Agora não"**: substitui o "Deixar de lado" e o "Não permitir". A
  exceção é o pedido de acesso de uma rotina parada, que mantém **"Pausar rotina"**, porque a consequência é outra.
- Na mudança de rotina sem acessos, o verbo passa a ser **"Salvar"**. Com acessos, continua "Aplicar mudança e
  permitir…" (o botão é o mesmo de "Sua vez"), e a criação continua "Criar rotina e permitir…".
- A linha "Precisa" vira "Vai poder" no card. As ações técnicas e os grupos para desmarcar ficam em Detalhes,
  recolhido.
- "Sua vez" continua com os rótulos de antes ("Deixar de lado", "Aplicar mudança"): a tela não entrou na NOD-399.
- A mecânica (`decidir-proposta`, `permitir-acesso`, a concessão em lote) não muda.
