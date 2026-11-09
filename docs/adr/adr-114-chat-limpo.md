# ADR-114 — Chat limpo: na conversa só fala e o que é com você

Status: proposto; parte do servidor no PR 1 do [plano do chat limpo](../plano-chat-limpo.md) (PR #390), a tela, a janela
e os gatilhos no PR 2 (ver **Emenda do PR 2**), a troca agrupada no PR 3 (ver **Emenda do PR 3**), o cartão encolhido no
PR 4 (ver **Emenda do PR 4**), as etiquetas e os divisores de data no PR 6 (ver **Emenda do PR 6**), o progresso na fala no PR 7 (ver **Emenda do PR 7**), a pílula que se alarga no PR 8 (ver **Emenda do PR 8**), a fala viva na NOD-348 (ver **Emenda da NOD-348**), o resumo das ações na NOD-353 (ver **Emenda da NOD-353**), os vários balões na NOD-358 (ver **Emenda da NOD-358**) · Data: 2026-10-18 · Migração 0091. A regra da tela, a janela que conta só o chat e os gatilhos de reversão entram no PR 2, junto da primeira
mudança visível, com as emendas das ADR-029, ADR-041, ADR-083 e ADR-110. Era a ADR-113 com a migração 0090; renumerada
em 2026-10-18 porque o PR B da Fase 2 (#392, reações e citação) entra antes com a ADR-113 e a `0090_reacoes.sql`.

## Contexto

Produção, 30 dias até 17/10, conta Gamefik, só contagens: 20.684 itens nas conversas; numa conversa com 20 itens ou mais,
só 59% são falas (mediana de 48 conversas). O print do Eng 1 de 17/10 tinha 20 linhas de sistema e nenhuma fala. O que
mais polui: avisos genéricos (turno interrompido, memória anotada, compactação, bot criado, task fechada), recibos de
aprovação, linhas de frentes e tasks, trocas de IA e de conta, ferramentas negadas e "Respondi ao pedido".

O código não tinha um campo que dissesse o que cada mensagem é: cerca de 45 produtores gravavam `sistema` só com texto, e
a web separava dois casos por regex. Esconder só na web também não servia: a janela da conversa é de 200 mensagens, e numa
conversa como a do Eng 1 elas seriam quase todas avisos.

## Decisão (parte do servidor)

1. **O assunto é gravado na escrita.** `mensagens.assunto` (0091, nulo, CHECK só de forma) guarda o que a mensagem é, numa
   união fechada (`ASSUNTOS`, `src/contracts/destino-no-chat.ts`). `NovaMensagem` exige o assunto **no tipo** para
   `sistema` e `resultado_aprovacao` sem payload: o compilador obriga cada produtor a escolher, sem padrão implícito. Com
   payload, o assunto sai do kind, do payload e da autoria (`assuntoDe`); o `consentimento` da aprovação automática tem o
   mesmo payload do manual e se distingue por `autoria.decidido_por`. `atualizarSistema` e a linha da ligação recalculam o
   assunto quando regravam o payload. Fala é `null`.
2. **A tabela `DESTINO` diz para onde cada assunto vai** (`src/domain/destino-no-chat.ts`, só no servidor): `chat`,
   `anexo` (não vira linha, mas a web precisa dele na janela para desenhar outra coisa: `trabalho_aberto`,
   `frentes_abertas`, `frentes_terminadas`, `recado_a_frente`, `pedido_respondido`) ou `atividade`, com a categoria do
   filtro (frentes, bloqueios, máquina e IA). Limite do plano, troca de IA, computador fora e IA ausente são marcados
   `chat` com destino temporal: a web os esconde quando deixam de valer e a Atividade os lista sempre. Mudar uma regra é
   mudar a tabela, sem regravar o banco. Assunto desconhecido ou nulo fica no chat.
3. **Ficam no chat**, além das falas, da conversa com outros bots, das rotinas e do que é com você: a criação do bot (a
   primeira linha da conversa), o turno que terminou sem resposta (órfão, interrompido por falha, retorno do lote que
   caiu), o recibo automático com item que falhou, a negação terminal e a de plano ausente. As linhas de rotina (criar,
   mudar, pausar, reativar, apagar, mudança não aplicada) ganham o payload `rotina_evento`. Na dúvida, chat.
   **O que pede ação da pessoa fica no chat** (decidido pelo orquestrador em 18/10, no lugar do Marlon, na QA do PR 1; o
   plano mandava os dois para a Atividade): a queda da máquina (`turno.queda_da_maquina`, a linha do card "Retomar") e a
   pergunta vencida (`decisao.vencida`, "você pode reabrir"). Se o card for dispensado ou vencer, a linha continua no chat
   dizendo o que houve. O assunto do "Turno interrompido: {motivo}" sai de uma função só (`assuntoDaInterrupcao`), usada
   pelo produtor e pelo backfill, para a linha nova e a antiga terem o mesmo assunto.
4. **O destino vai pronto no DTO** (`Mensagem.destino`), resolvido pelo servidor na leitura e **só na conversa própria**;
   a sala fica como hoje (lá a conversa entre bots é o conteúdo). A web nunca importa a tabela (ADR-018).
5. **A Atividade do bot** é `GET agentes/:id/atividade?dia=AAAA-MM-DD&fuso=…`: a página é o dia (sem cursor), até 500
   itens, os mais recentes primeiro, com `truncados` e `diaAnterior` até o nascimento do bot; `contagem=1` devolve só o
   total, com os mesmos filtros. Três fontes: as mensagens da conversa própria com destino `atividade`, `anexo` ou
   temporal; as negações de conector indisponível da `trilha` (uma linha por conector e causa, com "N vezes"), por faixa
   de tempo no índice parcial novo `trilha_negacoes_por_agente`; e os trabalhos que começaram ou terminaram no dia (a
   linha "Abriu a task" do mesmo trabalho não repete). Título e detalhe vêm prontos do servidor. Bot de outra pessoa: 404.
6. **A memória não é fonte da rota**: `pressao_memoria` mora em `events`, que não tem índice, e criar um numa migração que
   roda com o servidor antigo no ar travaria a tabela mais escrita. A Atividade mostra a linha "Agora" do estado que a web
   já tem; o histórico da memória fica fora.
7. **A migração só adiciona** e leva `SET LOCAL lock_timeout = '5s'`: o índice na trilha trava as escritas dela enquanto
   é construído (medido em 2026-10-18 num banco sintético: 282 ms com 500 mil linhas), e sem a trava em 5 s o deploy
   falha e para em vez de segurar o servidor.
8. **O backfill** (`scripts/backfill-assunto.ts`, depois do deploy) reconhece as linhas antigas pelo texto inteiro contra
   os moldes do catálogo de `redacao.ts` e dos textos fixos; a primeira linha da conversa própria é a criação do bot. Sem
   casamento: `sistema.generico`, e o `--seco` imprime quantas foram antes de gravar. `--refazer` corrige um molde errado
   sem migração. `scripts/medir-chat-limpo.ts` é a régua das metas.

## Alternativas descartadas

- **Esconder na web, por texto.** A janela de 200 continuaria cheia de avisos, e a web voltaria a separar por regex.
- **Padrão implícito "sem assunto vai para a Atividade", com teste de grep.** Troca um erro de compilação por um sumiço
  silencioso de um aviso que devia ficar.
- **A tabela importada pela web.** Quebra a regra travada pelo eslint (a web só faz `import type` de `src/`).
- **Cursor por `(em, id)` na Atividade.** Não atravessa as linhas agrupadas da trilha; o dia é a página.
- **Índice em `events` para a memória.** Trava a tabela mais escrita durante a construção.

## Gatilho de reversão

Os gatilhos da tela (relatos de "não vi que o bot foi bloqueado", Atividade aberta logo depois de abrir a conversa em
mais de 30% das aberturas) entram com o PR 2. Para esta parte:

- o `--seco` em produção com mais de 5% das linhas sem payload caindo em `sistema.generico`: os moldes não cobrem o que
  está gravado; acrescentar os que faltam (ou `MOLDES_ANTIGOS`) antes do PR 2;
- a rota da Atividade com p95 acima de 50 ms em produção (ou o `EXPLAIN` com a conversa real do Eng 1 no PR 2): o índice
  coberto `(tenant_id, conversa_id, criado_em) include (assunto, id)` em `mensagens`, numa migração aditiva.

## Emenda do PR 2 (2026-10-18) — a janela, a tela e os gatilhos

**A regra da tela.** No chat da conversa própria ficam só as falas, a conversa com outros bots, as rotinas, o que é com
você e as entregas. A web decide pelo `destino` do DTO, nunca por texto nem por uma tabela própria:

1. `atividade` não aparece no chat. `anexo` também não vira linha (sai "Abriu a task", "Virou a frente", "Começou a
   frente", "Começou N frentes", "N frentes terminaram", "Repassou um recado", "Respondi ao pedido de" e o
   "… terminou · 39 min" acima do resultado), mas continua dando o título e a origem das tasks, e a rotina que abriu
   frentes não vira resultado antes da hora. A linha "Rotina executou" (`rotina.execucao`) também é `anexo` (revisão do
   PR 2): a execução silenciosa não grava linha nenhuma, então é ela que diz à web que a execução teve resultado; fora da
   janela, o balão "da rotina …" virava "rodou 1 vez · nada para você". Os três de destino que muda com o tempo que a web sabe medir saem quando
   deixam de valer: o limite do plano que passou (`limiteVigente`), a troca de IA decidida e o computador que voltou. A
   negação de plano ausente fica sempre: depois de a IA voltar ela ainda diz "mande a mensagem de novo" (diverge do plano,
   que a punha entre os quatro que somem).
2. Sem aviso genérico no chat, sai o recolhimento "N avisos do sistema · ver". A sala e a mensagem sem `destino` (servidor
   anterior durante o deploy) seguem o desenho de antes, com o recolhimento.
3. A pílula de memória, que morava embaixo da última "Abriu a task", vira um ponto discreto na linha do dono, com a frase
   no `title` e no nome acessível, levando a Trabalhos (o disco cheio que segura tudo leva a Este Mac ou a Máquinas). Amarela
   e vermelha são ponto; nada de faixa nem texto âmbar no chat (decisão tomada 5). O bot sem linha do dono, com trabalho
   aberto, ganha uma linha só com o ponto. "Fazer aqui" e "Fazer depois da …" vão para o topo da tela da task e para a
   linha dela em Trabalhos.

**A janela conta só o chat.** `listarComTurno` com `comDestino` traz as 200 mais recentes que são item de chat (assunto
nulo ou de destino `chat`, menos a fala do bot num turno de trabalho, que conta como `anexo`) e, desde a mais antiga delas,
os `anexo`, até 300; os `atividade` ficam fora da resposta. Quando os anexos batem no teto, o mais antigo deles vira o
piso e os itens de chat de antes dele também saem (revisão do PR 2): a janela encurta, mas não fica com a fala da pessoa
sem o resultado da task, sem a pergunta da task ou sem a linha "Rotina executou". Duas CTEs `materialized` e um join pela chave primária — com
`id in (… union all …)` o Postgres refazia a passada dos anexos para cada linha da conversa (medido em 2026-10-18 num banco
de teste: conversa sintética do Eng 1, 300 falas com 20 avisos cada, 6.300 linhas; 20 s e 5,5 milhões de buffers com o
`in`, 5 ms de execução com o join; `listarComTurno` inteiro em 11 ms de mediana, e 46 ms com 50.000 avisos depois das
falas). O índice coberto `include (assunto, id)` não foi preciso. O `EXPLAIN` com a conversa real do Eng 1 fica para
quando houver leitura de produção (esta entrega não tocou produção).

**Sem o backfill.** O PR 2 pode entrar antes de o `backfill-assunto.ts` rodar em produção. Por isso:

- no SQL da janela, a linha sem assunto conta como item de chat — conservador: nada some por causa da janela; numa
  conversa antiga cabem menos itens visíveis até o backfill rodar (no limite, a janela é a das 200 mais recentes, como
  antes do PR 2);
- na leitura, a linha sem assunto ganha o assunto que o backfill gravaria (`assuntoNaLeitura`, que chama
  `assuntoDaLinhaAntiga`: kind, payload, autoria e o texto contra os moldes; a primeira linha `sistema` da conversa é a
  criação do bot), e o destino sai dele. O aviso antigo sai do chat na tela já no deploy;
- a Atividade lista a linha sem assunto pelo mesmo caminho (entra como candidata quando não é fala e fica se o assunto
  lido é da Atividade), e a contagem resolve as candidatas do mesmo jeito, então `contagem=1` e o `total` continuam
  batendo.

Quando o backfill rodar, o assunto gravado é o mesmo que a leitura calcula e nada muda na tela; só a janela das conversas
antigas volta a caber 200 itens visíveis. `tests/integration/janela-do-chat.test.ts` cobre os dois casos.

**A Atividade no painel.** Em Atalhos, logo abaixo de Trabalhos, "Atividade · N hoje" (só no bot da pessoa; o número é o
dia inteiro, decisão tomada 1, pedido por `contagem=1` com o painel à vista e relido, juntado numa releitura por segundo,
nos frames `mensagem.nova`, `negacao` e `trabalho.mudou` do bot). O nível mostra o dia: filtros Tudo / Frentes / Bloqueios /
Máquina e IA (`aria-pressed`; item sem categoria só em "Tudo"), a hora, o título e o detalhe, "N vezes", a linha "Agora" da
memória no topo de hoje, "e mais N itens deste dia, no Raio-X", "Dia anterior ›" (e "‹ Dia seguinte" num dia passado). A
frente abre a tela dela; a mensagem abre ali mesmo o texto inteiro (`ItemDeAtividade.texto`, quando o detalhe o corta) com
o "Relatar"; a linha da trilha não leva "Relatar" (decisão 14).

**O relato** conta 100 itens de chat, como a janela, e leva junto o que estava na Atividade nos mesmos 15 min, desde o
corte, marcado `naAtividade` no trecho (emenda da ADR-041).

## Emenda do PR 3 (2026-10-18) — a conversa com outros bots numa linha

Na conversa própria, a conversa com outros bots é uma linha por troca, "Conversou com Ze 1 e Nina · 4 mensagens ⌄", que
abre no lugar (protótipo "2C · Agrupada por bot"); a regra, a resposta do lote e o nome estão na emenda da ADR-099 item 8.
Na web: `PlanoMensagem` ganha `{ tipo: "troca", chave, agenteId, mensagens }`, o HTML sai de `htmlTroca`
(`web/telas/linhas-do-chat.ts`) e `juntarTrocas` junta as vizinhas na ordem da tela (depois de "a linha desce para depois
da fala que a anunciou", que vale também para a troca que começa num `handoff`); aberta, é um `<details data-disclosure>`,
e o estado aberto sobrevive ao re-render. A mensagem sem `destino` (sala, servidor de antes) segue com as linhas de antes.
`TipoLinha` ganha `"troca"` (validado em `telemetria-linhas.ts`): "mostrada" a cada troca desenhada (`troca:<chave>`) e
"aberta" quando a pessoa abre a troca, para o gatilho de 30% da ADR-083. Nenhuma migração: os campos novos são do payload.

## Emenda do PR 4 (2026-10-18) — o cartão encolhe com o resultado

Decidido, o cartão de aprovação, proposta, acesso, pasta ou regra **encolhe no lugar** (protótipo "3A", escolhido pelo
Marlon) em vez de sumir e deixar um recibo no fim: o título do pedido e uma linha com o resultado ("Aprovado por você ·
feito 08:14 ✓", "Recusado por você", "Aprovado · 1 de 3 não saiu", "Acesso permitido · Gmail", "Regra nova", "acme
aberta para o Dev 1", "Confirmado por você"). É o gesto da pergunta respondida: `web/telas/cartao-encolhido.ts` usa as
classes do cartão dela (`cartao-pergunta respondida`, `pq-escolhida`, `pq-estado`) sem mexer em `cartao-pergunta.ts`.
"ver o e-mail" do protótipo é "detalhes" (os itens; decisão tomada 4); o acesso e a regra levam "Ver registro de
autorização" (emenda da ADR-044).

**Onde fica.** Na âncora do pedido: a última mensagem do turno que pediu **antes do recibo** — a mesma de quando o cartão
estava aberto (`ancoraDoPedido`); o turno que segue depois da decisão ("Enviado.") fica depois do cartão. O recibo leva
o turno: `resultado_aprovacao` já é gravado no turno da decisão; o `consentimento` do pedido ganha `decisaoId`, `turnoId`
e `frase`; "permitiu para sempre" ganha o payload `regra_permanente { decisaoId, turnoId, acoes }`; `pasta_aberta` ganha
`turnoId`; a proposta confirmada ou recusada (`confirmar-proposta.ts`, `confirmar-perfil.ts`, `recusar-proposta.ts`) ganha
`proposta_decidida { propostaId, tipo, titulo, estado, turnoId }` (o turno da proposta ou, na de rotina, o da decisão de
mesmo id) e o assunto novo `proposta.resultado`, de destino `chat`; as de antes, sem payload, continuam
`proposta.decidida` na Atividade. Sem turno (recibo antigo com payload, consentimento sem pedido) ou com a âncora fora
da janela, o cartão encolhe na posição do próprio recibo. O "permitiu para sempre" antigo (sem payload) continua a linha
de antes; o recibo automático e o consentimento da aprovação automática continuam na Atividade (não houve cartão). O
cartão aberto de mesmo id não é desenhado enquanto "Sua vez" não foi relida, e o pedido ainda aberto do mesmo turno vem
depois do já encolhido. "Preciso da sua decisão para continuar" continua só para o que está aberto.

**Foco e anúncio.** O cartão encolhido nasce num desenho depois do frame e da releitura, quando o botão clicado já não
existe: o clique **na conversa** guarda o id decidido (`web/lib/foco-do-encolhido.ts`, 2 min) e, no primeiro desenho do
cartão com ele, o foco vai ao título (`tabindex="-1"`) e a região `aria-live` única da conversa (`#anuncio-pergunta`;
desde a NOD-348 há também `#anuncio-turno`, do estado do turno)
diz "Aprovado: …"; com o foco já no campo, só o anúncio. Decidido em "Sua vez" ou em outra aba, nada. Só esse cartão
anima o encolher, uma vez, e `prefers-reduced-motion` desliga.

**Divergências do plano.** O "Pedido aberto; nada foi concedido ainda." da confirmação de um pedido de acesso
(`confirmar-proposta.ts`, a conexão e o pedido antigo) não vira cartão encolhido: confirmar só abre a decisão, o cartão
segue aberto, e a linha fica na Atividade como antes (ADR-044: "Confirmado… vale" mentia). O campo do tipo da proposta é
`tipo`, não `kind` (o nome é do discriminante do payload). O consentimento leva também a `frase` do pedido, para o título
do cartão não depender de reler a decisão. O cartão da regra tem o título "Sempre permitir editar no Google Sheets" e o
resultado "Regra nova", em vez da linha única do plano, porque o título é o pedido em todos os cartões. Nenhuma migração.

**Gatilho de reversão.** 3 relatos em 14 dias (ADR-041) de "não vi o resultado da aprovação" ou equivalente — o cartão
encolheu lá em cima, na fala que pediu, longe do fim onde a pessoa olhava: o recibo volta a ser também uma linha no fim
(a tela "3C" do protótipo), com o cartão encolhido no lugar.

## Emenda do PR 6 (2026-10-18) — etiquetas e divisores de data; a narração fica para depois

**Etiquetas.** "rodou em <máquina>" e "catcher" saem do balão: quem usa o Nod não precisa saber em que máquina a resposta
rodou. O dado continua o mesmo (a autoria da fala, ADR-016) e aparece na faixa do modo dev, ao lado do custo, e no
cabeçalho do Raio-X (`ondeRodou`, `web/telas/modo-dev.ts`; o botão da faixa leva `data-onde`). O "onde" é o da última
fala do bot no turno (`ondeDoTurno`), não o da mensagem que leva a faixa: o recibo da aprovação, gravado com a autoria
padrão do agente, diria "catcher" (revisão do PR 6). A faixa fica na última mensagem do turno que não é da pessoa: o
recibo da aprovação que a pessoa decide depois da fala leva a autoria dela e, contado como o último, deixava o turno sem
faixa (QA do PR 6). "não confiável" e "parcial" ficam: dizem algo do texto que a pessoa está lendo. A linha
efêmera do turno vivo antes da primeira ferramenta ("trabalhando · catcher · 3 s") não é fala e fica como está.

**Divisores de data** (como o "Today 00:25" do Grok; protótipos Main e F1). Além do topo, um divisor quando o dia muda ou
quando passam 30 min ou mais (decisão tomada 6) entre dois itens à vista: "Hoje 08:00" no topo e na troca de dia, só
"15:40" no mesmo dia, "Ontem 22:10", "17/10 15:02" e, de outro ano, "17/10/2025 15:02". Regras:

1. Calculado sobre os blocos já na ordem da tela, depois de esconder o que foi para a Atividade ou é `anexo`, de juntar as
   trocas e de encolher os cartões (`comDivisores`, `web/telas/divisores-de-data.ts`): um aviso escondido não abre bloco
   nem segura um bloco aberto. O topo é o primeiro item à vista, não a primeira mensagem da janela.
2. A pausa conta desde o último instante já mostrado: o fim da troca ("até 15:09"), do fio e dos avisos recolhidos da sala
   (`LinhaDaConversa` ganha `em` e `ate`); a linha que desce para depois da fala que a anunciou é mais antiga e não abre
   bloco, nem na virada do dia. O `ate` só vale até o item à vista seguinte: a troca fica na posição do pedido, e a resposta
   do colega que chega horas depois não esconde os divisores da conversa embaixo dela (revisão do PR 6). Para isso o bloco
   leva os instantes que mostra (`instantes`: a troca, a junta, o fio) e a pausa conta do último deles antes do item
   seguinte (QA do PR 6: cortar o `ate` no próprio item seguinte zerava a pausa, e a conversa das 23:45, 44 min depois da
   troca das 23:00, ficava sem divisor). A linha que junta várias execuções de rotina ("rodou 5 vezes · 09:10 a 09:50") conta pelo instante da primeira:
   o plano dela não leva as mensagens. O bloco sem tempo — o pedido ancorado e o cartão encolhido que subiu para a fala
   que pediu — fica embaixo do divisor da fala a que pertence: decidido três horas depois, o divisor entra depois do
   cartão, antes do "Enviado.".
3. A pausa é a mesma constante que separa duas trocas vizinhas (`PAUSA_QUE_ABRE_BLOCO_MS`, que substitui
   `PAUSA_QUE_SEPARA_TROCAS_MS` de `linhas-do-chat.ts`): na tela do Eng 1, as trocas das 15:02, das 15:40 e das 17:20 são
   três linhas, cada uma embaixo do seu divisor. A troca de dia também separa duas trocas (23:50 e 00:10).
4. Chave `sep:<id da primeira mensagem do bloco>` (o topo era `sep`): a fala nova sem pausa não mexe em nenhum bloco; com
   pausa, entram o divisor dela e ela. Quando a mensagem mais antiga sai da janela, o divisor do topo nasce de novo com a
   chave nova (um `<div>` a mais refeito; antes ele ficava).
5. `role="separator"` com o texto inteiro no `aria-label` ("Hoje 15:40"), mesmo quando só a hora aparece.
6. A linha "Novas" fica embaixo do divisor: quando vem no bloco da mensagem e quando fica sozinha no lugar da mensagem que
   sumiu (esse bloco não tem tempo; o divisor do item seguinte entra antes dele).
7. **Vale também na sala** e na conversa sem `destino` (servidor de antes): lá nada some, e o divisor só marca as pausas.
   Decidido nesta entrega (o plano não dizia): a sala não perde nada, e uma régua de tempo só para as duas é mais simples
   de explicar.
8. "Hoje" e "Ontem" leem o relógio da máquina, como `textoFormatado`, e não `estado.agora`: o histórico é lembrado com o
   dia de extra (`partesDaTimeline`, `web/main.ts`), e ler `estado.agora` o refaria inteiro a cada tick de 15 s
   (`divisores-de-data.test.ts` prova com `lembrar`).

Estilo: `.time-sep[role="separator"]`, 12 px em `--ink-3`, mais perto do bloco de baixo, como no protótipo; o divisor da
tela da task, sem `role`, continua como antes. Nenhuma migração, nenhum contrato novo.

**Adiado: a narração.** `NARRACAO_MAX_CHARS`/`comporFala` com a chave do Modo WhatsApp (colar só quando a resposta final
é um toco de até 80 caracteres), a linha "Progresso" sem "relatório" e a emenda da ADR-112 não entram neste PR. O plano
exige uma semana de medição de `blocosColados` antes (a execução do Raio-X grava desde o PR 1, em produção em 18/10), e o
Marlon decidiu medir o Modo WhatsApp em produção até ~20/10 sem mudar o comportamento dele no meio. Nem
`src/domain/stream-json.ts` nem `src/domain/prompt-sistema.ts` mudaram. Entra num PR próprio, com a medição em mãos; o
critério do plano ("a parcela de falas com bloco colado cai à metade da semana medida") vale para ele.

**Gatilho de reversão.** 3 relatos em 14 dias (ADR-041) de "não sei onde o bot rodou" fora do modo dev: a etiqueta volta
ao balão só quando a fala rodou numa máquina diferente da de costume do bot (`maquinaPadraoId`). Relatos de conversa
"picada" pelos divisores: a pausa sobe para 60 min, mudando só a constante.

## Emenda do PR 7 (2026-10-18) — o progresso mora na fala; o cartão ao vivo vira linha

Plano, Parte 4 · 4b; protótipo "4 · Progresso na fala + pílula que se alarga", no estado com a fala à vista. A pílula que
se alarga (4c) é o PR 8; até lá a linha do dono acima do campo continua dizendo as frentes.

**O progresso na fala** (`web/telas/progresso-na-fala.ts`). A fala do bot do turno que gravou `frentes_abertas` (a última
do turno à vista, a mesma que `linhaDepoisDaFala` acha) leva, dentro do balão e depois do texto, um cartão com a barra (um
segmento por frente: pronta, rodando, precisa de você, esperando, parada, falhou, sem notícia) e "3 de 5 prontas · Hero
w3 e Hero w5 rodando · ver as 5", que abre a lista no lugar (`<details data-disclosure>`, que sobrevive ao re-render):
prontas com ✓ e a hora, as que andam com o último passo e o tempo, parada com ■, falhou com !. Cada título abre a frente.
Regras:

1. O estado vem de `trabalhosConhecidos`; a frente que saiu da lista, de `frentes_terminadas` (anexo, na janela), que
   também vence a lista quando ela ainda diz "aberta". Sem nenhum dos dois, "sem notícia" — nunca "pronta". O último passo
   é o da linha do dono (`passoDaFrente`, `web/lib/trabalhos.ts`: a narração do turno vivo da frente, senão `situacaoDe`).
2. A frente da rede, sem fala antes (as falas do turno promovido são da frente), entra embaixo do balão da pessoa que virou
   a frente: a mensagem dela leva o `trabalhoId` da rede, e a abertura é o `trabalho_aberto` de origem `rede`.
3. Sem a abertura na janela, ou sem a fala à vista (a rotina que abriu frentes, cujo "comecei…" segue escondido; o pedido de
   um colega, dentro da troca; o lote aberto dentro de uma task), não há bloco. Só na conversa limpa: na sala e no servidor
   sem `destino` continua a linha "Começou N frentes".
4. Uma frente só (o `abrir_task` de sempre) é uma linha: o ponto, o título e o passo (ou "pronta às 01:09"), sem barra nem
   "ver as".
5. Ordem dentro da fala: balão (com o progresso) → reações (decisão 20). No balão da pessoa (rede), o cartão vem embaixo
   dele, alinhado à direita.
6. Até dois títulos, somando até 40 caracteres, vão por nome no resumo ("Hero w3 e Hero w5 rodando"); mais que isso, a
   contagem ("2 rodando"). O protótipo abrevia para "w3 e w5", o que a tela não sabe fazer com um título qualquer.

**Desempenho (ADR-061).** O histórico é lembrado pelo que lê do estado (`web/lib/lembrar.ts`); se o bloco lesse o ao vivo e
o relógio ali, o histórico seria refeito a cada pedaço de texto de qualquer frente. Ele deixa só um lugar vazio na fala
(`<div class="progresso-lugar" data-progresso>`, `display: contents`), e na tela o bloco é desenhado dentro dele
(`criarProgressoNaTela`, de `web/main.ts`): os lugares são achados quando o histórico é regravado, nunca a cada quadro, e a
cada desenho só o lugar cujo bloco mudou é trocado, com a lista aberta e o foco guardados. A fala não é regravada.
`comProgressoNaFala` faz o mesmo numa string, para `renderHistoricoDaTimeline`. O teste prova com `lembrar` que mudar
`atividades` e `agora` não refaz o histórico nem muda a fala, só o bloco do lugar.

QA do PR 7 (2026-10-18), `scripts/carga-tela`, cenário novo `frentes` (5 frentes na conversa de 300 mensagens, cada uma
narrando e chamando ferramenta por ciclo): na primeira versão o bloco morava dentro do bloco da fala, e a fala inteira era
regravada 57 vezes por minuto (cada vez perdendo a seleção de texto nela), com o caminho "histórico mudou" de
`regravarTimeline` rodando 35 vezes em 30 s contra 8 na base (~11 ms cada, máx. 23 ms; sem tarefa longa). Com o lugar
trocado sozinho, a fala não é regravada nenhuma vez: o bloco é trocado 12 a 28 vezes por rodada a menos de 1 ms cada (máx.
3,3 ms), e o histórico volta às regravações da base (5 a 7). Os quatro cenários de antes não mudam além do ruído da máquina
(números no comentário do QA no PR #398). Gatilho de
reversão: se o lugar trocado sozinho custar mais que regravar a fala no `carga-tela` (`nod:progresso`), o bloco vira um
`BlocoDaTimeline` próprio embaixo da fala.

**O cartão ao vivo vira linha** (emendado pela NOD-348: o mascote e o relógio voltam à linha; ver **Emenda da
NOD-348**). O turno que já chamou ferramenta é "Clarice está trabalhando · ver etapas", com o ponto
que pulsa (protótipo "Conversa típica"); "ver etapas" abre o que o cartão grande mostrava (o passo de agora, a lista de
tarefas do bot, a contagem e as etapas). O vigia fica à vista, embaixo da linha, porque pede ação. Sai o cabeçalho
"● ao vivo" (mascote, nome e hora, num bloco `vivo-cab:` à parte); o balão em streaming fica, alinhado às falas. Sem
relógio na linha: a presença do cabeçalho da conversa já diz "Trabalhando". O protótipo põe o avatar do bot na linha; aqui é
o ponto que pulsa do plano — o mascote dentro de um bloco que muda a cada etapa reiniciaria a animação, motivo pelo qual o
cabeçalho morava à parte.

**Telemetria.** `TipoLinha` ganha `frentes`: o resumo do bloco é "mostrado" (`frentes:<id da abertura>`) e "aberto" no
clique em "ver as N", para o gatilho da ADR-099 ("detalhe das frentes aberto em mais de 30%"); a pílula alargada do PR 8
conta no mesmo tipo (o plano chamava o tipo de "pílula"; o nome diz o que o gatilho mede). Nenhuma migração, nenhum
contrato novo além do tipo.

**Ajustes do QA (2026-10-18).** A largura mínima do cartão vai na coluna da fala (`bubble-wrap` com o lugar do progresso,
`min(86%, 440px)`): no balão, `min(100%, 440px)` era 100% de uma coluna do tamanho do texto e o cartão de uma fala curta
ficava com ~215 px. O aviso de repetição do vigia, à vista embaixo da linha, saía em três linhas por um seletor largo
(`.atividade-vigia p b:first-child`, de 2026-10-06); agora só o título é bloco.

**Fica para o PR 8**, com a pílula: o ponto da memória no bloco (hoje na linha do dono; os dois juntos seriam dois pontos),
a região `aria-live` que diz "Hero w3 pronta" e a emenda da ADR-099 item 10 (feitos; ver a **Emenda do PR 8**).

**Gatilho de reversão.** O de 30% da ADR-099, medido agora em "ver as N" (tipo `frentes`): aberto em mais de 30% das vezes em
2 semanas, a lista volta aberta por padrão. Relatos de "não vejo o que o bot está fazendo" com o cartão ao vivo recolhido
(3 em 14 dias, ADR-041): o passo de agora volta à vista na linha, ao lado de "está trabalhando".

## Emenda do PR 8 (2026-10-18) — a pílula que se alarga

Plano, Parte 4 · 4c; protótipo D4BE2-pilula-alarga; emenda o item 10 da ADR-099. A linha do dono acima do campo dá lugar à
pílula do bot (`web/telas/pilula-do-bot.ts`, decisões puras em `web/lib/pilula.ts`, DOM em `web/lib/pilula-na-tela.ts`).

1. **Fechada**, uma pílula clean centrada acima do campo, flutuando sobre a base da timeline (que ganha 70 px de espaço
   embaixo só com ela à vista): o ponto (vivo com frente rodando, vazado só com espera ou fila), o texto e o resto em
   cinza, e a seta. O texto prioriza as frentes: um lote, o título dele (`tituloDoLote` do PR 5, que o servidor manda em
   cada frente do lote — "5 frentes de hero"; sem ele, o da frente sozinha ou "N frentes") e "3 de 5 prontas" (a frente sozinha diz o passo); vários lotes, "2 lotes · 4 de 7 prontas"; sem frentes, a espera ou a fila
   pela prioridade da linha do dono. O estado de cada frente é o mesmo do bloco na fala (`frentesNaFala`): a pílula e a
   fala nunca discordam. O total do lote é `lote.frentes`, que conta a frente que já saiu da lista.
2. **Some quando a fala com o progresso está à vista**, no esquema da pílula da pergunta do #389: os lugares do bloco na
   fala (`[data-progresso]`, do QA do PR 7) são procurados quando o histórico muda, e o bloco de agora dentro de cada um
   (`.progresso[data-frentes]`, o filho do lugar) é medido com `getBoundingClientRect` no evento de rolagem que já existe
   (`criarRolagem`, que avisa só quando o conjunto à vista muda); à vista = pelo menos 24 px do bloco dentro da janela.
   Todo lote da pílula precisa ter o bloco à vista. Espera e fila a seguram à vista. Como `criarProgressoNaTela` troca o
   bloco sem regravar a fala, a rolagem nunca guarda o bloco (ele sairia do documento a cada passo de uma frente): o render
   mede de novo (`rolagem.progressoTrocado`) quando o desenho troca algum lugar, antes de a pílula decidir. O ponto da
   memória (item 5) entra no bloco pelo mesmo desenho (`criarProgressoNaTela().desenhar(…, memoria)`).
3. **Alargada** (o clique; `faixaTrabalhosAberta` guarda o estado, que sobrevive ao re-render da região): as frentes, as
   seções "Esperando" e "Na fila", a frase da memória e o pé com "Ver na conversa ↑" (só com a fala na janela carregada) e
   "Parar". O painel é absoluto, ancorado acima do campo, com `contain: layout paint`, desenhado no tamanho final; anima
   `clip-path: inset(…)` saindo do retângulo da pílula (largura medida no clique, em `--pilula-w`) e `opacity`, e as linhas
   entram uma depois da outra (o "entra" do protótipo). O esqueleto (botão e painel) nasce uma vez por bot e cada desenho
   troca só o miolo que mudou: regravar o painel a cada passo cortaria a animação e tiraria o foco. Medido em 2026-10-18 no
   Chrome headless sobre um banco efêmero: o `clip-path` vai do retângulo da pílula ao painel em ~0,42 s e volta em ~0,34 s;
   com movimento reduzido, na hora. No celular, alargada vira folha de baixo para cima (`transform`), com o fundo que fecha.
4. **Acessibilidade.** A pílula é `<button aria-expanded aria-controls>`; alargada, `role="region"` com nome ("Frentes de
   Orquestrador de Sites"), foco no primeiro item; Esc e "fechar" devolvem o foco à pílula. Escondida, ela fica `inert` na
   saída e `hidden` no fim (nunca só opacidade). Quando ela some (a fala entrou na vista) com o foco nela, aberta ou não, o
   foco vai para o "ver as N" do bloco (ou o título da frente sozinha); aberta, ela fecha. A região viva única da conversa
   (`#anuncio-pergunta`, a mesma das ações na fala) diz só quando uma frente do bot termina ("Hero w3 · Terminal retrô
   pronta", "… parada", "… não terminou"), nunca a cada passo nem ao abrir a conversa. Alvo de 36 px (44 px no celular).
5. **Memória:** o ponto da memória do Mac sai da linha do dono para o lado da pílula (botão com a frase no `title` e no nome
   acessível, levando a Trabalhos, Este Mac ou Máquinas) e para o bloco de progresso que ainda anda, ao lado do número
   (`role="img"` com a frase); a frase inteira só dentro da pílula alargada e na Atividade. O ponto continua amarelo ou
   vermelho como no PR 2 (o plano dizia "ponto cinza"; mantida a cor do PR 2, que já estava em produção, sem faixa nem
   texto âmbar).
6. **"Esperando você" sai da pílula** (decisão tomada 2): a pergunta tem o cartão e a pílula "Nina perguntou algo". Os
   atalhos que abriam a linha do dono quando a pergunta está fora da janela carregada abrem a pílula, se houver.
7. **Telemetria:** a pílula com frentes conta "mostrada" quando aparece e "aberta" quando alarga, no tipo `frentes`, chave
   `frentes:pilula:<lotes>` — o gatilho de 30% da ADR-099 soma "ver as N" e a pílula alargada.

Saem `renderLinhaDoDono`, o detalhe da linha aberta e os passos de cada frente nele (`frenteAberta` no estado); o servidor
sem o dono (anterior ao I10) continua com a faixa de tasks de antes. `scripts/carga-tela` não foi rodado nesta entrega.

**Gatilho de reversão.** 3 relatos em 14 dias (ADR-041) de "não vi que o bot ainda estava trabalhando" com a fala fora da
vista e a pílula escondida, ou de "a pílula cobre a conversa": a pílula volta a ficar sempre à vista, em fluxo, como a
linha do dono.

## Emenda da NOD-348 (2026-10-23) — a fala viva: mascote e relógio na linha

Protótipo v2 do Gil (nod-prototipos/nod-348) e decisões da Ada; emenda o parágrafo "O cartão ao vivo vira linha" da
**Emenda do PR 7**. O turno vivo é uma fala só (`renderFalaViva` em `web/telas/conversa.ts`): o mascote do bot em
`<nod-mascote>` ("trabalhando" com ferramenta, "disponível" pensando ou escrevendo), o nome e a linha viva com o estado
("Pensando", "Escrevendo", "Usando Linear", "Abrindo frentes") e o tempo ("12 s", "1 min 4 s"). O texto em streaming
fica no balão e a linha desce para o rodapé; sem texto, a linha fica ao lado do nome. Com ferramenta, as etapas e as
tarefas vão para "ver etapas" (trocado pelo resumo das ações na NOD-353; ver **Emenda da NOD-353**) — e o balão continua (revisão 2 do #508: a resposta final de um turno com ferramenta não
fica escondida no recolhido), com a narração de antes da ferramenta (`antes`, QA 2 do #508: a ferramenta que chega não
esvazia o balão, que encolhia e crescia de novo, e o texto que volta substitui a narração curta, que fica em "ver etapas", e o balão pode encolher até ~8 linhas no celular nessa troca, de propósito: segurar a altura levaria o pulo para a troca pela gravada; revisões 5 a 7; a viva e a parada mostram o que a fala gravada vai mostrar, pela regra do `comporFala`: narração curta fica de fora, a longa entra; revisão 4). Quando o texto vira mensagem — no fim do turno ou num `turno.fala` no meio dele — a fala
fica parada ("Respondeu · 12 s", sem o "ver etapas", uma entrada de `falasSaindo` por fala no estado) até a releitura que saiu depois
dela trazer a fala gravada, por no máximo 15 s: sem isso a conversa ficava um quadro sem fala e pulava ~95 px
(QA do #508). Cada `turno.fala` é uma parada própria, e o `turno.interrompido` não as tira (revisão 4). Fica
registrado: a releitura que já estava no ar quando o frame chegou mostra a fala duas vezes até o GET seguinte (médio,
revisão 4). "Na fila" fica como estava, sem mascote. Emenda também o item 3 da ADR-061 (no ao vivo, o
bloco do turno que escreveu não é mais regravado inteiro: só as partes que mudaram) e a frase "a região `aria-live` única
da conversa (`#anuncio-pergunta`)" da **Emenda do PR 4**: agora há duas, a das ações e a do turno.

1. **O mascote volta para dentro da fala.** O motivo do PR 7 (o bloco que muda a cada etapa reiniciaria a animação) cai
   com o morph: `regiaoPorBlocos` aceita `morfar` no bloco, e quando a raiz e as partes (`[data-parte]`) batem, troca só
   as partes cujo HTML mudou e copia a classe da raiz e os atributos do mascote, que nunca sai do documento
   (`decidirBloco`, `planoDoMorph` e `aplicarMorph` em `web/lib/morph.ts`, usados por `web/lib/regioes.ts`). O bloco é
   recriado, o caminho de antes, quando o mascote aparece ou some, quando há chave de parte repetida ou quando a fala na
   tela não tem a forma esperada (raiz `[data-morfar]`, `.bubble-wrap`, o mascote). A cor e a forma do bot não entram
   no morph (mudam com a frota relida, o caso raro).
2. **O relógio volta para a linha.** O PR 7 o tirava porque o histórico seria refeito a cada segundo; aqui o tempo não
   passa pelo estado: `criarRelogioDaFala` (`web/lib/fala-viva.ts`) reescreve só o texto de `[data-desde]` a cada 1 s,
   para quando não há fala viva e com a aba escondida.
3. **Leitor de tela.** A linha viva não é região viva; `#anuncio-turno` diz o estado depois de 1 s estável ("Ada está
   pensando") e "Ada respondeu" uma vez quando o turno encerrado deixou fala. Interrompido não anuncia.
4. **NOD-216 segue:** o mascote só anima com trabalho real (o turno rodando); movimento reduzido desliga a entrada, a troca e
   o brilho do texto, e o relógio continua.

**Gatilho de reversão.** Medido no `carga-tela` (`scripts/carga-tela/medir.ts` agrega toda medida `nod:`) com
`localStorage nod.medir=1`: `regiaoPorBlocos` grava `nod:fala:morph` em cada fala trocada no lugar e
`nod:fala:recriada` em cada fala recriada; `nod.semMorph=1` força a recriação. Se, no mesmo cenário, a média de
`nod:fala:morph` passar a de `nod:fala:recriada` com `nod.semMorph=1`, ou se o mascote reiniciar a animação a cada etapa (visto no QA ou
em 3 relatos em 14 dias, ADR-041), a fala viva volta ao ponto que pulsa do PR 7, sem relógio (reverter o PR #508).

## Emenda da NOD-353 (2026-10-26) — o resumo das ações fica na fala

Protótipo v2 do Gil (`p348-acoes`); emenda a **Emenda da NOD-348** e revoga, só para este resumo, "a atividade não vai
para o chat": as ações do turno passam a ser **registro** da fala do bot. O "ver etapas" sai; no lugar, entre o nome e o
balão, um `<details class="fala-acoes">` recolhido por padrão com a frase das ações que terminaram ("Pesquisou na web e
abriu uma página"; `fraseDasAcoes` em `web/lib/atividade.ts`: únicas na ordem do primeiro uso, verbos seguidos do mesmo
objeto juntos no plural). Aberto: uma ação por linha, a que roda no presente ("Usando Gmail"), as outras no passado, e a
que deu erro com **Falhou** em `--danger`. O resumo nasce quando a primeira ação termina.

1. **Fim de cada ação ao vivo.** O trecho da ponte `{ferramenta}` ganha `id` (o `tool_use.id`) e entra `{fim, falhou}`
   (do `tool_result.isError`); o servidor republica `turno.atividade` com o `id` e o frame novo `turno.acao_fim`. Sem
   `id` (app antigo), a ação fecha como feita na próxima ferramenta, no texto ou no fim do turno — nunca Falhou inventado.
2. **Registro.** `ResultadoTurno.ferramentasFalharam` (índices em `ferramentasChamadas`) e a fala final grava
   `payload {kind:"acoes_do_turno", acoes:[{rotulo, falhou?}]}` (`acoesDoTurno` em `src/domain/acoes-do-turno.ts`; teto
   de 200 linhas, a mesma ação seguida com o mesmo desfecho numa linha só). Sem migração: `payload` já é jsonb. A fala
   com o resumo continua fala (`assuntoDe` → null), e a resposta entregue ao colega a aceita (`linhas-do-chat.ts`).
3. **Sem pulo.** A viva, a parada final (`vivo:`) e a gravada desenham o mesmo `details` com a mesma chave
   (`data-disclosure="acoes-‹turno›"`): o aberto e o foco continuam na troca. O resumo é do turno inteiro e fica numa fala
   só: a final; sem fala final (o texto já saiu numa fala do meio, `jaFalado`), a última fala do meio do turno o guarda
   (`acoesNaUltimaFalaDoTurno`). As outras falas do meio ficam sem resumo.
4. **Acessibilidade.** Summary com 24 px (44 px no celular), `:focus-visible` com `--focus-ring`, seta que gira em 160 ms
   (sem transição com movimento reduzido). Fora de região viva: a troca do presente pelo passado não é anunciada.

Fica registrado: a tarefa do bot (checklist) segue dentro do aberto só na fala viva, até a NOD-359; o desktop antigo degrada sem
Falhou. **Gatilho de reversão:** 3 relatos em 14 dias (ADR-041) de "o resumo atrapalha a leitura" ou de Falhou que não
aconteceu: o resumo volta a ser só da fala viva (o payload fica gravado, sem tela).

## Emenda da NOD-358 (2026-10-26) — um balão por parágrafo

A resposta do bot sai em vários balões, um por parágrafo, como uma pessoa manda no WhatsApp (protótipo `.p348-baloes`,
tela j3-2). O mascote, o nome e a hora continuam aparecendo uma vez por fala, e copiar, ouvir, responder, reagir e buscar
continuam valendo para a mensagem inteira: todos já leem `fala.texto` e o `[data-mensagem]`, não o balão. A fala da
pessoa, o cartão da pergunta e o de tela não se dividem.

1. **A regra** (`dividirEmBaloes`, em `web/lib/baloes.ts`, pura). O corte só acontece em linha em branco da prosa, então
   o código (a linha em branco dentro da cerca é código) e a tabela ficam inteiros. Não há corte quando:
   - o bloco de cima termina em ":", também dentro da ênfase (`**Próximos passos:**`) ou seguido de emoji: a frase que
     apresenta uma lista fica com ela;
   - a lista ou a citação continua embaixo (lista solta, linha recuada e o passo a passo com código entre os itens);
   - já apareceu um título `#` no balão: dali até o fim é documento;
   - já há 5 balões.

   O texto sem nenhuma fronteira sai num balão só, com o HTML de antes. Cada balão é um pedaço exato do texto; com
   divisão, o último perde as quebras do fim (na fala viva e na gravada, para a troca não ganhar uma linha). CRLF
   separa como LF (e o texto com CRLF sai com LF, ao vivo e no final). A divisão de cada texto fica numa memória de 400 entradas, porque a timeline é redesenhada a cada
   quadro. medido em 2026-10-26: 2,35 ms → 0,5 ms por redesenho de 200 falas típicas (bancada em Node da revisão 1 do
   PR #522, antes e depois da memória e da leitura de trás para frente). A guarda é `razaoDeCrescimento` (NOD-194),
   também para a lista com continuações recuadas: cada corte lê só o último bloco (revisão 4 do PR #522; o mutante que
   relê o balão inteiro dá razão ~17, acima do teto de 8). O código logo depois de um item é do passo a passo, com ou
   sem ":" no item. O ":" e o título são lidos sem regex quadrática (só o fim aparado da linha; revisão 5). O recuo da continuação e o começo do texto também são lidos sem varredura repetida (revisão 7). Limitação aceita (revisão 8): depois de 200 narrações guardadas, quando um relatório longo sai da lista, os balões
   seguintes ganham chave nova e entram de novo com a animação, uma vez.

   Limitações conhecidas, aceitas: a cerca `~~~` e a de quatro crases não são vistas como código (uma linha em branco
   dentro delas pode cortar; o `textoFormatado` também só conhece a de três crases); e a fala de um parágrafo que termina
   em quebra de linha mostra a quebra na fala parada e na gravada, mas não ao vivo (como antes da NOD-358, a gravada
   fica byte a byte); e a explicação sem recuo entre itens numerados ("1. **A**\n\nExplicação.\n\n2. **B**") divide a
   lista, porque no markdown ela já são duas listas (o `start` do segundo item fica) e, ao vivo, juntar exigiria segurar
   o parágrafo até o próximo item decidir (revisão 3 do PR #522); o código recuado com 4 espaços depois de prosa, a
   citação ou a tabela no meio de uma lista e o marcador "•" (que o texto formatado também não lê como lista) dividem
   (revisão 4 e QA); e um "```" no meio da frase abre código, como no `textoFormatado` (a mesma regex de cerca: dividir
   de outro jeito faria o balão e o desenho discordarem). Com o morph desligado (`nod.semMorph`), cada pedaço recria
   o bloco e os balões depois do primeiro repetem a entrada: é a medida de comparação, não o caminho normal.
2. **Ao vivo** (`parcial`). Na fala viva, o começo do bloco seguinte que ainda pode continuar a lista de cima ("1",
   "-", "``") espera decidir antes de aparecer. Assim os balões só crescem: o anterior não muda, nada se junta de volta,
   e o morph da NOD-348 troca só a parte `balao-N` que cresceu. O balão é `data-no-lugar`: o `aplicarMorph` muda o
   conteúdo e os atributos do nó que já está na tela (`trocarConteudo`, em `web/lib/morph.ts`), sem nó novo, para a animação
   de entrada não recomeçar nem ser cortada a cada pedaço (revisão 2 do PR #522). O balão único ao vivo fica como a fala
   de um parágrafo gravada (sem `data-balao`, a largura de antes, para o fim do turno não pular; revisão 3 do PR #522):
   quando o segundo nasce, o primeiro passa à largura do texto uma vez. O texto que volta depois da
   ferramenta e substitui a narração curta não cresce, é outro: a geração entra na chave das partes (`balao-gN`):
   cada trecho guarda a geração em que foi escrito (quantas narrações curtas vieram antes dele, `falaComposta`), e o
   balão leva a do trecho onde começa. Os balões da narração saem enquanto os novos entram, e os do relatório longo
   mantêm a chave quando ele passa de texto final a relatório (revisão 4 do PR #522); o balão dele que puxa o texto seguinte
   (título, BALOES_MAX, ":", lista, citação ou código aberto) muda no lugar quando a narração puxada é substituída, e o
   relatório guardado perde as quebras do começo: aceito, a fala gravada é esse mesmo texto (revisão 6). A contagem inclui as narrações que já saíram da lista
   guardada (`curtasDescartadas`), para a geração não cair depois de 200 ferramentas (revisão 5). Quando o texto final
   repete um relatório, o relatório sai do texto composto (a regra de `comporFala`) e os balões mudam no lugar: aceito,
   é o mesmo texto da fala gravada. O balão novo entra com opacidade e 4 px de subida em
   240 ms; com movimento reduzido, ele só aparece. A fala parada (`saindo`) divide como a gravada, para a troca não pular.
3. **Medidas.** Com 2 balões ou mais, cada um tem a largura do próprio texto (`fit-content`), com 6 px entre eles. As
   tags ("parcial", "não confiável") e o progresso vão no último. O balão 0 guarda a chave da mensagem na memória do
   texto formatado; os outros usam `id~i`.

**Gatilho de reversão.** Se em 14 dias chegarem 3 relatos (ADR-041) de resposta picada no meio de uma ideia, ou de lista
ou código dividido, a fala volta a um balão só (`dividirEmBaloes` devolvendo `[texto]`).

## Gatilhos de reversão (PR 2)

- 3 relatos em 14 dias (ADR-041) de "não vi que o bot foi bloqueado" ou equivalente: a negação volta ao chat como uma
  linha quando o turno termina sem fala do bot depois dela.
- A Atividade aberta até 60 s depois de abrir a conversa em mais de 30% das aberturas em 2 semanas: algo que importava
  saiu do chat; rever a tabela. Medido pela telemetria das linhas: `TipoLinha` "atividade", uma "mostrada" a cada abertura
  da conversa própria (`atividade:<conversa>:<instante>`) e a "aberta" com a mesma chave (`web/lib/atividade-do-bot.ts`);
  a taxa aparece no Modo dev junto das outras.
- A janela da conversa com p95 acima de 50 ms em produção: o índice coberto `(tenant_id, conversa_id, criado_em) include
  (assunto, id)` em `mensagens`, numa migração aditiva.
