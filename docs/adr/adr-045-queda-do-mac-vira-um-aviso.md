# ADR-045 — A queda do Mac vira um aviso, não um card por turno

Status: aceito · Data: 2026-09-24 · Emenda ADR-007, ADR-010, ADR-011 e ADR-017. EMENDA 16 inalterada.

## Contexto

Medido no banco diário em 24/09: 43 decisões `retomar_turno` em 7 dias, 100% de turnos de ROTINA
interrompidos por `maquina_sem_contato`, quase todas de madrugada. É o "dark wake": o Mac acorda por
instantes, o agendador (no mesmo processo) dispara, o Mac volta a dormir no meio do turno. Ao acordar,
o varredor de lease criava um card "Retomar" **e** uma mensagem por turno; 24 h depois o varredor de
expiração escrevia outra. Retomar uma rotina não faz sentido — a próxima janela já roda sozinha — e
a frase "o computador parou de responder" era lida como o computador DO BOT (ADR-037).

A mesma queda chegava por três caminhos, com três desfechos diferentes: o varredor (card + mensagem),
a entrega que chega com o lease vencido antes do varredor (mensagem de "trabalho incompleto" e, na
rotina, execução `falhou`) e a entrega tardia depois do varredor (a fala cortada entrava no chat).
Responder a um pedido de rotina gravava uma SEGUNDA linha de execução para a mesma janela.

## Decisão

**Incidente não é decisão.** A falta de infraestrutura vira UM aviso com começo e fim (tabela
`incidentes`, 0021), nunca um card por turno. Quedas a menos de 3 h uma da outra mesclam no mesmo
aviso (a medição de 24/09); fechado, ele fica 12 h em "Sua vez" ou até "Entendi". Aviso fechado E
dispensado não recebe queda nova — a próxima abre outro. No modo compartilhado o servidor nota a queda
com o Mac ainda fora: o aviso fica EM CURSO (`voltou_em` nulo, um por pessoa pelo índice
`incidente_em_curso`) até o varredor ver a máquina puxando de novo (contato mais novo que
`OFFLINE_MS`); a web relê "Sua vez" a cada tick enquanto houver aviso em curso, sem evento novo. No
modo local o varredor roda no próprio Mac, então notar já é ter voltado.

**Uma regra só** (`src/use-cases/interromper-por-maquina.ts`): rotina → execução `interrompida`
(desfecho novo, silencioso como `sem_novidade`), sem decisão e sem mensagem; conversa → a retomada
anterior da MESMA conversa fecha por `regra:retomada_substituida` (inclusive reaberta — `fecharPorRegra`
passa a aceitar `reaberta`) e nasce uma, com a frase; sempre → o aviso e a métrica `pos_restart`
(contada na borda). As três portas terminam igual: o varredor; a entrega NÃO-sucesso com o lease
vencido e sem Parar (`desfechoDaEntrega` → `maquina_sem_contato`; sucesso é trabalho terminado); e a
entrega tardia, cuja fala cortada de rotina não entra no chat (o sucesso tardio entra: o entregável da
rotina é a fala). A ordem das travas é a mesma nas portas: linhas de turno → trava por pessoa dos
incidentes → decisões (conversas) → janelas (rotinas) → o incidente. O varredor interrompe TODOS os
órfãos antes de qualquer consequência, então nunca segura a trava por pessoa esperando uma linha de
turno; decisões antes de janelas é a ordem do varredor de expiração (`vencerPendentes` → janela do
gate), que acorda junto depois de uma noite de sono.

**Uma linha por janela.** `registrarDesfechoRotina` trava a janela (`rotinaJanelas.travar`, FOR UPDATE)
e atualiza a execução dela se já existe (`daJanela` + `atualizarDesfecho`): o desfecho mais recente
substitui o anterior.

**Uma execução aberta por rotina, no agendador.** Com o turno da janela anterior pendente ou rodando,
o disparo agendado só reagenda (log `rotina_janela_pulada`). "Executar agora" e "Permitir e rodar
agora" (ADR-044) são atos da pessoa e nunca são pulados.

**O agendador espera 3 min ao acordar.** Relógio que salta mais de 3 intervalos entre dois ticks é o
processo que ficou suspenso; a espera corta o "dark wake" na origem. Definido, NÃO medido: o log
`processo_acordou {parado_ms}` existe para medir.

**Servidor reiniciado não é o Mac.** No modo compartilhado, turno cujo último sinal (lease − LEASE_MS)
é de antes de o processo subir cai como `reinicio_servidor`, sem aviso do Mac (`pos_restart` com
origem `restart_servidor`). No modo local reiniciar o servidor É fechar o nod no Mac.

**Nomes.** `maquina_sem_contato` → "seu Mac parou de responder (repouso, sem rede ou nod fechado)";
o botão do cabeçalho vira "Computador do bot"; o glossário define os dois e o "aviso".

**Limpeza (0021).** As `retomar_turno` abertas de turnos de rotina (e das retomadas deles, até 5
saltos) fecham por `regra:rotina_nao_retoma`, com o desfecho de ADR-042, entre NO FORCE/FORCE em
`decisoes` e `turnos` (regra da 0005).

## Alternativas descartadas

- **Manter o card de rotina e vencer mais cedo.** Continua um card por turno, só some antes; o
  problema é existir.
- **Registrar a queda de rotina como `falhou`.** Mistura erro da rotina com o Mac dormindo e dispara o
  texto "falhou por erro técnico" no chat — o flood que esta decisão acaba.
- **Impedir o Mac de dormir (power assertion).** Troca bateria por rotina; é decisão da pessoa, não do
  produto, e não resolve rede caída nem nod fechado.

## Validação

`tests/integration/varredor-lease.test.ts` (conversa: um Retomar e um aviso; duas quedas → um
Retomar, a anterior reaberta fechada por regra; rotina: 0 decisões, 0 mensagens, 1 `interrompida`,
idempotente; compartilhado: `reinicio_servidor` sem aviso, aviso em curso fechado na volta),
`incidentes` (mescla em 3 h, fechado+dispensado abre outro, índice único, RLS, "Sua vez", 404, limpeza
da 0021 executada do próprio arquivo), `rotina-scheduler` (21 janelas → 20; janela pulada),
`rotina-gate` (responder → uma linha), `turnos-fila` (lease vencido no `desfechoDaEntrega`); unit
`incidente`, `presenca`, `redacao`, `assentar-turno-queda`, `disparar-rotina`, web `incidentes`;
concorrência `varredor-lease-entrega` (as duas ordens de trava e cinco rodadas simultâneas: exatamente
uma `interrompida`, sem impasse); conformidade `motivos-enum` e `rls` pegam o enum e a tabela novos;
`rotas-http` ("Entendi" em aviso desconhecido ou id fora do formato → 404, nunca 500).

Verde em 2026-09-24, sobre a `main` com #44–#47: lint, typecheck (4 projetos), fence:domain; unit
108 arquivos/603 testes, integration 74/272, conformidade 8/58, concurrency 20/68 (1 pulado).

## Gatilho de reversão

- Se, em 14 dias de log, mais de 10% das rotinas disparadas nos 10 min depois de um `processo_acordou`
  terminarem `interrompida` por `maquina_sem_contato`, 3 min é pouco: subir a espera. Se nenhuma
  terminar assim e houver `processo_acordou` com `parado_ms` < 10 min em horário de uso, a espera só
  atrasa: baixar.
- Se uma rotina acumular `rotina_janela_pulada` por mais de 24 h seguidas, a guarda está escondendo
  um turno pendente preso: dar prazo ao turno de rotina pendente em vez de pular para sempre.
- Se aparecer mais de um aviso em curso por pessoa (o índice recusa: erro 23505 em log), a trava por
  pessoa foi contornada — rever quem chama `incidentes.abrir`.

## Não implementado

O aviso do computador do bot (PR3). A volta da máquina no modo compartilhado é notada pelo varredor
de lease (até 15 s depois do contato), não por evento. Sucesso tardio de rotina já derrubada entra no
chat, mas a execução continua `interrompida`. As retomadas de `retomarTurno` e `assentarAprovacao`
continuam gravando `confiavel` (ADR-044, "Não implementado").

## Emenda de 2026-09-24 — perguntas viram conversa

> Revista em 2026-10-18 pela emenda "a pergunta vira cartão" (fim deste arquivo): o balão com "Parei aqui", a faixa,
> o seletor "Responder | Outro assunto", a nota do campo, o clipe desligado e a citação "1 de 2" saíram.

**Contexto.** A pergunta de `pedir_a_pessoa` chegava duas vezes na conversa: a mensagem com o molde da
E5.2 ("parei: falta X; quem destrava: Y; não vou tentar de novo", ou "parei para perguntar a …") e, logo
abaixo, um card com a MESMA frase, uma caixa de texto de rótulo técnico ("o dado que faltava", "sua
resposta em texto") e "Responder e retomar". Dois lugares para escrever na mesma tela, e a pergunta
lida como formulário. O dono escolheu nos mockups (fileira 6) "A + B com citação automática": a
pergunta é uma mensagem, a próxima mensagem da pessoa responde, e respostas prováveis viram botões.

**Decisão.**

- **A pergunta é a fala do agente.** `pedir_a_pessoa` grava o `texto` do próprio agente, com payload
  `pedido_a_pessoa {decisaoId, opcoes?}` (jsonb: sem migração). A web desenha um balão azul claro — o
  azul de status, não o âmbar das decisões — com "Parei aqui até você responder" enquanto está aberta,
  "Respondida por você · HH:MM" depois, e "Sem resposta · venceu …" com o seu Reabrir quando vence
  (ADR-007 intacto: o balão é onde a vencida continua visível). `renderDecisoesDaConversa` não desenha
  mais `pergunta`, `falta_de_dado` e `permissao`; os outros tipos seguem como card. O molde da E5.2
  ficou só em `decisoes.frase`, a frase curta da fila ("Sua vez"); na conversa, "Parei aqui até você
  responder" diz em palavras que o agente não tenta de novo.
- **O campo responde.** Com pergunta aberta, uma faixa acima do campo diz "{agente} está esperando sua
  resposta · há … · vence em …", com "Ver pergunta" (leva ao balão) e "Deixar pra lá" (o
  `POST decisoes/:id/dispensar` do #46). O campo entra em modo resposta — placeholder "Responda à
  {agente}…", borda realçada, a dica "Sua próxima mensagem responde à pergunta…" — e enviar chama
  `POST decisoes/:id/responder`, a rota que já existia e que cria a retomada, em vez do envio comum.
  "Outro assunto" (também Esc e o × da citação) manda mensagem comum e deixa a pergunta aberta; a
  escolha vale até o próximo envio e é esquecida quando a conversa fica sem pergunta. Com duas ou mais
  abertas, o campo cita a mais antiga ("Respondendo à {agente} · “…” · 1 de 2") e passa à próxima ao
  enviar; "Responder a esta", no balão, troca a citada.
- **Anexo não vai na resposta.** A rota `responder` só leva texto. Em modo resposta o clipe fica
  desligado com o motivo na dica; colar ou soltar arquivo e enviar com arquivo já na fila recusam por
  escrito ("Na resposta à pergunta vão só palavras…") — o arquivo nunca some em silêncio.
- **Respostas prontas.** `opcoes` opcional em `pedir_a_pessoa`: até 4, até 60 caracteres cada
  (`src/contracts/pedido.ts`, fora de `ferramentas-nod.ts` pelo gatilho de 200 linhas da EMENDA 26).
  A normalização tira vazias, repetidas e longas — a longa SAI em vez de ser cortada, porque o toque
  manda o texto da opção como resposta e uma frase cortada seria uma resposta que ninguém escreveu. O
  toque usa a mesma rota `responder`; embaixo dos botões, "ou responda com suas palavras aí embaixo".
- **A resposta cita a pergunta.** A mensagem que `retomarComResposta` grava leva
  `resposta_a_pedido {decisaoId, agenteId, perguntaEm, retomada}`: a web rotula "respondendo à pergunta
  das HH:MM" e, com `retomada`, escreve "{agente} retomou com a sua resposta" sem gravar outra linha.
- **Sinais.** Na barra lateral, o agente que perguntou diz "esperando sua resposta" e ganha um selo azul
  de balão com a contagem, separado do ⚑ âmbar, que deixa de contar pergunta. A faixa do topo conta
  "pedidos" (decisões e perguntas). Em "Sua vez" a pergunta mostra a frase e "Responder na conversa",
  que abre a conversa com o campo já respondendo a ela; nenhuma caixa de texto na lista. Exceção: a
  decisora designada que não é dona da conversa (`quem_destrava`, EMENDA 1) não lê a conversa de outra
  pessoa (RLS de `conversas` e `mensagens`), então para ela a resposta em texto continua na lista.
- **Modelo.** A descrição de `pedir_a_pessoa` pede fala natural dirigida à pessoa, `opcoes` quando as
  respostas forem previsíveis e que o turno encerre sem repetir a pergunta em texto; a linha do
  inventário de rotinas manda as candidatas em `opcoes`.

**EMENDA 16 continua valendo.** A resposta é texto da pessoa, sempre por `responder`; `decidir` continua
recusando os três tipos (409). A opção pronta é uma sugestão de texto que a pessoa escolhe — o servidor
recebe as palavras, nunca um id de botão. Deixar pra lá continua não sendo responder: fecha sem texto e
sem retomada.

**Alternativas descartadas.** Manter o card e só esconder a frase repetida: continuariam duas caixas de
texto na tela. Responder por botão de decidir: quebra a EMENDA 16 e não serve a pergunta de julgamento.
Adivinhar na interface se a mensagem é resposta ou outro assunto: a escolha fica explícita no campo, e
quem distingue pedido de explicação de resposta é o agente (próximo PR).

**Validação.** web `perguntas-conversa` (balão sem card nem caixa de texto, a frase uma vez, faixa, modo
resposta, "1 de 2" e a troca da citada, opções como botões, "Outro assunto", depois de responder,
vencida com Reabrir, "Sua vez" com "Responder na conversa", enviar chama `responder` e não o envio
comum, anexo recusado), `decisoes-chat`, `navegacao-sem-rail` ("pedidos"; selo azul separado do ⚑);
unit `pedir-a-pessoa` (opções, payload, a rota `responder` grava a resposta ligada e cria a retomada),
`chamar-ferramenta`, `anti-tutorial`, `prompt-sistema`; integração `perguntas-conversa` (o jsonb das
duas mensagens no Postgres e a retomada); concorrência `e2e-catcher`.

Verde em 2026-09-24, sobre a `main` com #51–#54: lint, typecheck (4 projetos), fence:domain; unit
119 arquivos/701 testes, integration 77/283, conformidade 8/59, concurrency 22/70 (1 pulado).

**Gatilho de reversão.**

- Pessoas respondendo à pergunta errada: com duas ou mais abertas, se em 14 dias aparecerem 3 relatos
  (ADR-041) ou respostas corrigidas logo depois ("era sobre o PR 9"), a citação automática da mais
  antiga não basta — o campo passa a pedir a escolha explícita quando houver mais de uma.
- Confusão entre resposta e mensagem comum: se em 14 dias aparecerem 3 casos de "Outro assunto" que era
  resposta (a mesma pessoa manda de novo, em seguida, pelo modo resposta) ou de resposta que era outro
  assunto (a retomada recebe texto sem relação com a pergunta), o padrão deixa de ser responder e o
  campo passa a perguntar a cada envio enquanto houver pergunta aberta.

**Não implementado.** O fio da pergunta (próximo PR, migração 0025): hoje cada resposta fecha a decisão
mesmo quando é um pedido de explicação, e a pergunta seguinte abre outro pedido do zero — `fio_id`, a
rodada na faixa, o histórico do fio na entrada da retomada e o recolher "Pergunta resolvida · N
mensagens" ficam para lá. Também ficam de fora a linha "Você deixou uma pergunta pra lá" ao dispensar
e o anexo na resposta (a rota `responder` segue só com texto). Perguntas gravadas antes desta emenda não
têm balão ligado: continuam como texto comum, e a faixa e o campo funcionam por "Sua vez" (sem "Ver
pergunta").

## Emenda de 2026-09-24 — fio da pergunta

> Revista em 2026-10-18 pela emenda "a pergunta vira cartão" (fim deste arquivo): a rodada passou da faixa para o
> cartão, a faixa "lendo sua mensagem" saiu e o fio de uma rodada resolvido não recolhe mais.

**Contexto.** Conversa de verdade tem idas e vindas: o agente pergunta, a pessoa não entende e pede
explicação, o agente explica, a pessoa responde — às vezes mais de uma volta. Até aqui a primeira
mensagem da pessoa fechava a pergunta como "respondida" mesmo quando era um pedido de explicação, e se
o agente perguntasse de novo nascia um pedido do zero: faixa nova, contador novo, nenhum vínculo com o
anterior. A retomada de rotina, que roda em sessão nova, recebia só a última resposta e a frase da
última pergunta. O dono escolheu nos mockups (fileira 7) "a pergunta é um fio".

**Decisão.** A pergunta é um FIO que fica aberto enquanto o agente ainda precisa da pessoa e fecha
sozinho quando ele segue. Quem decide se a mensagem é resposta ou pedido de explicação é o agente —
perguntando de novo ou seguindo —, nunca a interface.

- **Migração 0025.** `decisoes.fio_id uuid` (NULL = a decisão começa o próprio fio) e o índice parcial
  `decisoes_por_fio (tenant_id, fio_id) WHERE fio_id IS NOT NULL`. Sem backfill. A coluna nasce travada
  para a decisora (a lista fechada da 0003 não a nomeia). Contrato: `Decisao.fioId`.
- **Rodada seguinte.** `pedir_a_pessoa` num turno que é retomada de uma pergunta RESPONDIDA (um dos três
  tipos, `turno_id` = `retomaTurnoId` do turno, desfecho `decidida`) cria a decisão com
  `fio_id = anterior.fioId ?? anterior.id`. Cada rodada tem prazo próprio (24 h a partir dela) e
  `opcoes` próprias. Duas respostas ao mesmo turno desempatam pela resposta que criou o turno
  (`resposta_a_pedido.turnoRetomadaId`, campo novo no jsonb). Sem pergunta no turno de cima, a busca
  sobe só por retomada INTERROMPIDA: o "Retomar" depois de uma queda continua o mesmo fio. A rodada não
  passa pela regra "a mesma pergunta da rotina" (ADR-044) — ela é o agente explicando, não repetindo.
- **Histórico na retomada.** Da 2ª rodada em diante, a entrada da retomada leva "Esta pergunta é a Nª
  rodada do mesmo fio…" e as últimas 10 mensagens do fio (perguntas, respostas e as falas do agente nas
  retomadas que perguntaram de novo), cada uma aparada em 400 caracteres. As linhas "Resposta de X ao
  seu pedido…" e "Entrada original da rotina" continuam.
- **Estados, sem coluna** (`src/domain/fio-da-pergunta.ts`): esperando você (última rodada aberta) →
  lendo sua mensagem (respondida, retomada na fila ou rodando) → resolvida (a retomada terminou sem
  perguntar de novo; turno interrompido também fecha, a queda tem o aviso dela) · deixada pra lá
  (dispensada) · vencida. `ConversaDto.fios` leva id, agente, estado, rodada, decisões e os ids das
  mensagens do fio; cada item de "Sua vez" leva `fio {id, rodada}`.
- **Web.** Da 2ª rodada, a faixa diz "{agente} ainda está esperando sua resposta · 2ª rodada · vence
  em …"; respondida, a faixa fica neutra ("Pergunta aberta · {agente} está lendo sua mensagem") e o
  campo volta ao modo normal. O fio aberto com duas ou mais mensagens ganha um trilho azul fino com
  "Pergunta aberta · N mensagens · Xª rodada" (a pergunta recém-chegada, sozinha, é só o balão).
  Resolvido, o fio inteiro recolhe num `<details>` verde "Pergunta resolvida · “início da primeira
  pergunta” · N mensagens · ver conversa", seguido de "{agente} seguiu com a sua resposta" — nada é
  apagado. O selo azul, a faixa de "pedidos" e o título de "Sua vez" contam FIOS, não rodadas. "Outro
  assunto" continua mandando mensagem comum e deixando o fio aberto.
- **Modelo.** A descrição de `pedir_a_pessoa` ganha: "Se a pessoa pedir esclarecimento em vez de
  responder, explique e chame pedir_a_pessoa de novo: a pergunta continua no mesmo fio. Pedido de
  explicação não é resposta."
- **Rotina.** Todas as rodadas são da mesma janela (cadeia de `rotinaDoTurno`, cujo teto de saltos
  subiu de 5 para 10). A pergunta aberta SEGURA o desfecho como o gate (`TIPOS_QUE_SEGURAM_A_EXECUCAO`):
  o 'executou' do turno que perguntou não conta, e o desfecho é do fio inteiro — 'executou' quando a
  retomada segue, 'passou_em_branco' quando a pergunta é deixada pra lá (`pedido_dispensado`) ou vence
  (`pergunta_sem_resposta`, novo, texto sem migração). Continua uma linha por janela; o chat ganha um
  marcador de execução só, no fim, em vez de um por rodada.

**Alternativas descartadas.** A interface adivinhar se a mensagem é resposta ou pergunta (o dono
recusou: quem entende a mensagem é o agente). Uma coluna de estado do fio: seria uma segunda fonte da
verdade ao lado da decisão e do turno, que já dizem tudo. Reaproveitar a MESMA decisão entre as rodadas
(reabrir): perderia o prazo e as opções de cada rodada e reescreveria o registro do que a pessoa
respondeu.

**Validação.** unit `domain/fio-da-pergunta` (os cinco estados; três rodadas são um fio, 3ª rodada;
mensagens do fio; histórico com 10 e aparado), `use-cases/fio-da-pergunta` (fio_id na rodada seguinte e
não nos outros casos, queda no meio, rodada não reaproveita a pergunta de outra janela, histórico na
retomada, estado na conversa, rotina resolvida e deixada pra lá), `web/fio-da-pergunta` (faixa "2ª
rodada", "lendo sua mensagem" com o campo normal, trilho com cabeçalho, resolvido num `<details>` só,
contadores por fio); integração `fio-da-pergunta` (migração aplicada; três rodadas pelas rotas HTTP até
o fio resolvido e o contador zerado; rotina com UMA linha 'executou' e a pergunta vencida como
'passou_em_branco'); `dispensar-decisao`, `rotina-gate` e `perguntas-conversa` ajustados à janela que
espera o fio e ao `turnoRetomadaId`.

Verde em 2026-09-24, sobre a `main` 94951ac: lint, typecheck (4 projetos), fence:domain; unit 122
arquivos/720 testes, integration 78/286, conformidade 8/59, concurrency 22/70 (1 pulado).

**Gatilho de reversão.**

- Fio que não fecha: se em 14 dias aparecerem 3 fios com 4 rodadas ou mais (o agente pergunta de novo
  em vez de seguir), a descrição passa a limitar as rodadas e a quarta pergunta vira pedido novo com o
  histórico do fio.
- Pessoa sem saber a que pergunta responde: se em 14 dias aparecerem 3 relatos (ADR-041) de resposta
  dada à rodada errada ou de "já respondi isso", o trilho passa a mostrar a rodada em cada balão e a
  faixa passa a citar a pergunta da rodada atual.

**Não implementado.** A decisora designada que não é dona da conversa responde em "Sua vez" sem ver o
fio (RLS de `mensagens`): a retomada leva o histórico, mas a tela dela mostra só a frase da rodada. Fio
que começou antes desta migração não tem rodadas ligadas.

## Emenda de 2026-10-09 — a queda nomeia a máquina Linux

**Contexto.** Com o motor numa VM Linux (ADR-090/092), o turno que perdia o lease na VM aparecia como "Turno
interrompido: seu Mac parou de responder", e o aviso dizia "Seu Mac ficou sem contato entre 15:32 e 15:36". O Mac estava
aberto na mesa: quem tinha caído era a VM, ou o motor dela reiniciando. A conexão viva da ponte sabe a plataforma, mas
some 90 s depois do último contato, antes de o varredor notar o lease vencido.

**Decisão.** A chave da máquina guarda o sistema que ela anunciou no `conectar` (`maquina_tokens.plataforma`, migração
0067, `'darwin'` ou `'linux'`, só escrita quando muda). Na queda (`maquina_sem_contato`), a máquina Linux é nomeada com
as causas dela: "a máquina nod-motor-teste parou de responder (desligada, sem rede ou motor parado)"
(`motivoDaQuedaEmPortugues`, `src/domain/redacao.ts`). O aviso da queda leva `maquina` no `IncidenteDto` e começa com
"A máquina nod-motor-teste ficou sem contato…". O Mac, a chave que ainda não se conectou depois da 0067 e o Mac sem
chave do modo local continuam com "seu Mac". A frase vale nas duas portas da regra (varredor e entrega tardia), porque
as duas passam por `aplicar`.

**Alternativa descartada.** Lembrar a plataforma só em memória, numa lista que não esquece a máquina depois dos 90 s.
Funcionaria enquanto o servidor não reinicia, mas cada deploy reinicia. A coluna tem o mesmo custo e sobrevive.

**Não implementado.** Um aviso mescla quedas pela janela de tempo (`destinoDaQueda`), e não por máquina. Se o Mac e a VM
caírem na mesma janela, o aviso nomeia a primeira. O histórico da rotina (`web/lib/execucao.ts`) e a leitura em voz da
retomada (`leitura-aprovacao.ts`) ainda dizem "seu Mac".

**Validação.** Integração `incidentes` (queda na chave Linux nomeia a VM na conversa e no aviso; `darwin`, chave sem
sistema e Mac sem chave ficam com "seu Mac"), unit `ponte-http` (só o `conectar` grava a plataforma) e
`web/incidentes` (a frase com e sem `maquina`). A migração passa pela ida e volta da conformidade.

## Emenda de 2026-10-15 — entrega tardia com sucesso conclui o turno (NOD-264, E8) e a aprovação segue na queda (NOD-261, E2)

**Contexto.** A ADR-010 diz que o turno interrompido nunca volta a `pendente`, e a entrega que chega depois do varredor
entra como anexo parcial. Mas quando a máquina sumiu (`maquina_sem_contato`) ou o servidor reiniciou
(`reinicio_servidor`) e o CLI terminou o trabalho com `result` de sucesso, o que chega é o trabalho acabado. Mesmo
assim a fala entrava como parcial, o card "Retomar" ficava aberto e a task ficava `precisa_de_voce` por um trabalho já
feito. No mesmo varredor, uma aprovação decidida enquanto o turno caía ficava sem continuação: a fila só a pegava quando
uma entrega chegava. E se a entrega viesse, ela podia criar uma segunda retomada.

**Decisão.**
1. Entrega tardia com sucesso, depois de uma queda (`maquina_sem_contato` ou `reinicio_servidor`) e sem retomada criada
   (`turnos.temRetomada`): a fala entra com `parcial: false` e `turnos.concluirTardia` muda o turno para `concluido`. É um
   UPDATE condicional (`estado = 'interrompido'`, motivo de queda, nenhum turno com `retoma_turno_id` dele), então a
   corrida com a retomada automática fica decidida no banco. O "Retomar" do turno fecha por regra
   (`regra:entrega_tardia_com_sucesso`), o evento é `turno_encerrado` com essa regra, e `sincronizarTrabalho` relê o
   estado. Não é requeue: o turno vai para terminal, nunca para `pendente` (gate `sem-requeue` continua verde).
2. Com retomada já criada, inclusive uma automática que ainda está na fila, o comportamento continua o de hoje: anexo
   parcial. O mesmo vale quando o UPDATE perde a corrida (a fala volta a parcial com `marcarParciaisDoTurno`).
3. Na queda, `aplicar` (comum ao varredor e à entrega com lease vencido) continua as aprovações já decididas do turno
   (`continuarAprovacoes`, uma continuação por decisão pela 0032). Se ao menos uma seguiu, o "Retomar" daquela queda
   fecha por `regra:aprovacao_continuada`. A entrega tardia que chegar depois encontra a decisão já reivindicada e não
   cria outra.
4. Quando um turno posterior do mesmo trabalho conclui, os "Retomar" de turnos anteriores fecham por
   `regra:retomar_superado`. Em `fatos`, um `retomar_turno` só conta como decisão pendente se for do último turno
   terminal.

**Alternativa descartada.** Reabrir o turno interrompido (voltar a `despachando` ou `pendente`) para a entrega assentar
pelo caminho normal. Isso fere a ADR-010 e reabre a janela em que o varredor e a retomada disputam o mesmo turno.
Promover direto para `concluido`, com a condição no UPDATE, não reabre nada.

**Gatilho de reversão.** Se aparecer turno promovido cuja fala estava cortada, a promoção passa a exigir também
`produced_output` e a ausência de tarefa em fundo pendente. Isso também vale se aparecer uma retomada que nasceu depois
da promoção sem ver o `concluido`.

**Validação.** Unitário `assentar-turno-queda` (tardia com sucesso sem retomada → `concluido`, fala inteira, card
fechado; com retomada na fila → parcial como antes); integração `aprovacao-na-queda` (varredor duas vezes + entrega tardia → uma
continuação só e o card fechado) e `retomar-superado` (card antigo + recado novo que conclui → `retomar_superado`, task
`terminado`, lote fechado; e os fatos só contam o card do último turno terminal).

## Emenda de 2026-10-18 — a pergunta vira cartão (plano "pergunta com botões", PR A)

**Contexto.** Produção, 18/09 a 17/10: 84% das perguntas já vinham com `opcoes`, mas só 25% das respostas foram um
clique numa opção, e 47% das faltas de dado foram fechadas no ×. Uma pergunta ocupava quatro camadas na tela (balão com
"Parei aqui", botões com duas frases de instrução, faixa acima do campo repetindo a pergunta, seletor "Responder à
pergunta | Outro assunto"), e a fila guardava o molde "parei: falta X; quem destrava: Y; não vou tentar de novo". O
Marlon aprovou em 18/10 o protótipo "Nod — pergunta com botões" (padrão do Grok Bot). Plano: `docs/plano-pergunta-com-botoes.md`
(PR #388), Partes 1, 2, 3a e 4; a 3b (citação de qualquer fala) e a 5 (ações na fala, reações) ficam para o PR B.

**Decisão.**

- **A pergunta bem feita (Parte 1).** A descrição de `pedir_a_pessoa` pede opções sempre que 2 a 4 respostas cobrirem
  e um campo novo, `recomendada` (índice em `opcoes`), com o motivo no `texto` e sem citar letra nem posição.
  `normalizarPedidoAPessoa`, que roda antes do schema, segue a recomendada pela origem (a repetida que saiu aponta para a
  gêmea que ficou), a põe em PRIMEIRO e grava `recomendada: 0` no payload; índice inválido, opção que saiu por tamanho ou
  lista vazia: sem recomendada, sem erro. `decisoes.frase` passa a ser o `texto` inteiro, sem corte (a entrada da
  retomada cita a frase e a retomada de rotina roda em sessão nova); sai `parei-falta-dado` de `redacao.ts`, e a pergunta
  das voltas sem novidade grava o texto de `perguntaDoAlarme`. `resposta_a_pedido` ganha `via: "opcao" | "texto"` e
  `opcao` (índice), calculados em `retomarComResposta` (fase 2, pela dona, que lê o balão) com a mesma régua da
  normalização (`src/domain/opcoes-da-pergunta.ts`: espaços e caixa não contam). `via` no corpo é ignorado: a EMENDA 16
  continua (a resposta é texto, nunca id de botão). Sem `turnoId` ou sem balão, sem `via`. jsonb, sem migração.
- **O cartão (Parte 2).** O balão `.pergunta` vira um cartão (`web/telas/cartao-pergunta.ts`): o `texto` como título, o ×
  (o `dispensar` de antes, `aria-label` "Deixar a pergunta pra lá"), a lista de opções com as letras A a D, "Recomendo" na
  A quando `recomendada` existe e "Ou responda no chat abaixo" ("Responda no chat abaixo" sem opções). Respondida por
  opção (`via: "opcao"`, ou texto igual a uma opção no payload antigo): encolhe para a escolhida com ✓, e a fala da pessoa
  não sai como balão. Respondida com outras palavras: "Respondida por você · HH:MM", e a fala fica com o rótulo de hoje.
  Vencida: "Sem resposta · …" com o Reabrir, apagada (ADR-007). Deixada pra lá: "Deixada pra lá". Dirigida a outra pessoa
  (`quem_destrava`): sem opções, "Esperando a resposta de outra pessoa" (`FioDaPergunta.decisorId`, novo). Fora de
  "aberta", nenhuma opção é clicável; aberta, as opções ficam desligadas enquanto `ocupado`. O estado sai primeiro de
  `ConversaDto.fios` e só depois de "Sua vez", para as opções não aparecerem um instante depois. Da 2ª rodada, "2ª rodada"
  no cartão. O pedido de ajuda do computador (`ajudaDoComputador` no payload, gravado por `pedirAjudaDoComputador`) leva
  "Assumir controle", sem "Ou responda no chat abaixo", e não é respondido pelo campo.
- **O campo (Parte 2).** Com pergunta aberta o campo não muda: saem a faixa ("está esperando sua resposta", "Ver pergunta",
  "Deixar pra lá"), a faixa neutra "lendo sua mensagem", o seletor, o placeholder "Responda à…", a borda realçada, a nota
  e o clipe desligado. O status "Esperando você" do cabeçalho fica. A mensagem digitada continua respondendo (decisão 1 do
  plano). Letra sozinha ("A", "b", "B.", "c)") vira o texto da opção antes de `responder` (campo da conversa e de "Sua
  vez"); letra além do total vai como digitada. Mensagem com anexo vai como mensagem comum e a pergunta segue aberta.
  "N coisas esperam você" fica só para os outros pedidos (aprovação, acesso). Fora da tela, a pílula "Nina perguntou algo
  ↓" leva ao cartão aberto (só com o cartão no DOM) e ganha da pílula das novas.
- **"Respondendo" (Parte 3a).** Com duas ou mais perguntas abertas, uma caixa presa ao campo diz "Respondendo" (sem "· N
  de M", como na tela S2; revisto na QA do PR #389) e o trecho da pergunta, apontando para a MAIS RECENTE (antes, a mais
  antiga), com "Trocar" e o × que manda a mensagem como assunto novo (o `outroAssunto` de antes; Esc faz o mesmo só com
  a caixa à vista). Só a pergunta apontada diz "Ou responda no chat abaixo". Substitui a citação "1 de 2" e o "Responder
  a esta".
- **"Sua vez" (Parte 4).** O item de pergunta tem o cabeçalho (avatar, nome, "há N", a origem genérica — "rotina",
  "pedido de outro bot" — e "Abrir conversa", que abre com o campo apontando para ela) e o mesmo cartão, respondendo por
  `responder`. Sem opções, o campo de resposta dentro do cartão vale para todas: isso desfaz a regra desta emenda de
  24/09 de não ter segunda caixa de texto na lista. Os balões vêm numa consulta só (`pedidosAPessoaDasDecisoes`,
  `turno_id = any(…)`, no índice `mensagens_por_turno`) como `SuaVezDto.itens[].pedido`; a decisora que não é dona da
  conversa não lê o balão (RLS de `mensagens`) e vê a frase (já a fala do bot) e o campo, sem opções nem "Abrir conversa".
  Saem a etiqueta âmbar e "Responder na conversa"; da 2ª rodada, "2ª rodada" ao lado de "Abrir conversa".
- **Prazo.** Nenhum "vence em" no cartão, nem na conversa nem em "Sua vez" (correção do orquestrador sobre a decisão 10 do
  plano: consistência com o protótipo aprovado, que não mostra prazo). O prazo de 24 h com recusa automática continua no
  servidor e como ordem da fila "Sua vez".
- **Fio.** O fio de UMA rodada resolvido não recolhe mais em "Pergunta resolvida": o cartão já encolheu para a resposta. O
  de duas rodadas ou mais recolhe como antes.
- **Cores.** Só tokens: o cinza claro da letra e da etiqueta do protótipo vira `--surface-raised`, e o cinza do texto
  apagado vira `--ink-3` (o do protótipo dava 2,9:1 sobre o fundo do cartão). Nenhum token novo; o escuro vem dos tokens.

**Alternativas descartadas.** Manter a faixa só com o prazo: era uma das quatro camadas, e o protótipo não tem prazo.
Copiar `opcoes` para uma coluna de `decisoes` para a decisora que não é dona ver as opções: migração no PR A para um caso
raro (decisão 6 do plano). Responder pela letra num atalho de teclado sem foco no campo: fora do escopo.

**Riscos aceitos e gatilhos de reversão** (substituem os desta emenda de 24/09 sobre "Outro assunto" e a citação):

- Prazo mudo: referência de 11% de pedidos vencidos em 30 dias. Se mais de 15% das perguntas vencerem em duas semanas,
  reavaliar mostrar o prazo no cartão (primeiro com menos de 2 h, como o plano propunha; depois sempre).
- Mensagem que vira resposta sem querer: com uma pergunta aberta nada no campo avisa. 3 relatos em 14 dias (ADR-041) de
  mensagem que virou resposta sem querer, e a caixa "Respondendo" passa a aparecer também com uma pergunta só.
- Resposta à pergunta errada com duas abertas: 3 relatos em 14 dias, e o campo passa a pedir a escolha explícita.
- O × mais à vista pode subir as dispensas: a meta do plano (menos de um quarto das faltas de dado dispensadas, contra 47%)
  é o número que acusa.
- A recomendada em A pode desencontrar um texto que cite posição: a descrição proíbe, e a resposta é o texto da opção.
- A descrição nova muda o comportamento do modelo sem eval automático: a medição semanal (`via` no payload) é o eval, e
  uma rodada de `npm run e2e:aceite` antes do merge confere que `recomendada` chega ao payload.
- Pergunta aberta fora da janela carregada: sem cartão e sem pílula; sobram o "Esperando você" do cabeçalho e "Sua vez".
- Pedido de ajuda do computador aberto antes do deploy não tem `ajudaDoComputador`: até ser respondido, aparece como
  pergunta comum (a mensagem digitada o fecharia). Raro e transitório.

**Validação.** unit `domain/opcoes-da-pergunta`, `use-cases/pedir-a-pessoa` (recomendada remapeada, reordem, inválida,
vazia; frase = texto nos três tipos; payload com `recomendada: 0` e `ajudaDoComputador`; `via` na resposta),
`chamar-ferramenta`, `domain/redacao`, `domain/voltas-sem-novidade`, `adapters/computadores-*`; web `perguntas-conversa`
(cada estado do cartão; balão da pessoa escondido com opção; payload antigo; aberto antes de "Sua vez"; letra dentro e
fora do total; anexo; ocupado; pílula; ajuda do computador; "Respondendo" com Trocar e ×; "Sua vez" com e sem opções,
sem balão, decisora que não é dona; espelho da régua do ✓), `fio-da-pergunta`, `conversa-depois`, `decisoes-chat`,
`trabalhos`, `cores-por-token`, `foco-forced-colors`; integração `perguntas-conversa` (frase = texto, `recomendada`,
`via`/`opcao` no jsonb, `via` do corpo ignorado, sem turno sem `via`), `sua-vez-pergunta` (dois pedidos no mesmo turno,
RLS da decisora que não é dona), `me-chame-as`, `esperar-comando`; concorrência `e2e-catcher` (pergunta → clique →
retomada com `via: "opcao"`).

## Emenda de 2026-10-20 — o fundo não se perde por nenhuma queda (NOD-309)

**Contexto.** O card "Retomar" desta ADR valia para toda queda, inclusive a do trabalho que ninguém está olhando: rotina,
pedido de colega, frente e retorno do lote ficavam parados até alguém clicar, e a rotina que caía ficava calada
(`interrompida`, só no histórico). O pendente de rotina sem prazo era o gatilho de reversão citado acima ("dar prazo ao
turno de rotina pendente em vez de pular para sempre"). Plano de engenharia da NOD-309, PRs 1 a 4 (#423, #436).

**Decisão.**

- **O fundo retoma sozinho** (`src/domain/espera-no-fundo.ts`, `src/use-cases/volta-do-fundo.ts`). Toda queda do fundo —
  cota, reinício do servidor, máquina sem contato e erro transitório do fornecedor (5xx, 529, rede) — vira ESPERA com
  volta marcada (ou "quando a máquina voltar"), um aviso por cadeia e um teto: 3 transitórias com backoff, 3 quedas de
  infraestrutura e 24 h desde o início da cadeia (`PRAZO_DO_FUNDO_MS`; a cota não tem teto de 24 h, só a hora de volta).
  Passado o teto, `falhou` com um aviso só a quem pediu. A conversa com a pessoa fica como antes: card "Retomar". O Parar
  (`parado_pela_pessoa`) nunca retoma. `espera_da_cota` vira caso de `espera_no_fundo`.
- **A rotina caída deixa de ser calada.** A volta que cai em ou depois da próxima execução fecha a janela como
  `nao_rodou` com motivo (`cota_da_ia`, `execucao_anterior_aberta`, `maquina_sem_contato`, `reinicio_servidor`,
  `erro_do_provedor`) e grava UMA linha na conversa da rotina: "Não rodou · <motivo>, volta às HH:MM. A rotina segue a
  agenda." (`rotina-nao-rodou`; outro dia, "em DD/MM às HH:MM"; sem hora, "na próxima execução da agenda"). A janela
  repetida não grava de novo (o desfecho já assentado devolve `inalterado`). Sem empilhar: a agenda segue.
- **O pendente ganha destino com motivo** (`decidirFundoPreso`, `cuidarDosTurnosOrfaos`). O turno de fundo que a máquina
  segura antes do despacho (nunca rodou) avisa aos 10 min (`AVISO_FUNDO_PRESO_MS`, assunto `fundo.espera`, uma vez por
  cadeia; ao remetente também, no pedido de colega) — menos quando alguma conta da IA está no limite, porque a nota da cota
  já fala. Pedido de colega, frente e retorno do lote desistem em 24 h (`vencido`, aviso único a quem pediu); task e
  rotina só avisam (a rotina fica com a janela seguinte). A janela de rotina presa antes do despacho fecha `nao_rodou`:
  `cota_da_ia` (volta no menor `no_limite_ate`) se alguma conta da pessoa está no limite, senão `maquina_sem_contato` sem
  hora — o servidor não distingue as duas antes do despacho. Faixa ocupada ou execução anterior aberta continuam
  `interrompida`/`vencido`.
- **A entrega tardia com sucesso** (emenda de 15/10) absorve a retomada pendente da mesma cadeia.

**Gatilho de reversão.** Se, em 14 dias de log, mais de 5% das cadeias de fundo terminarem `falhou` por
`tentativas_esgotadas`/`quedas_esgotadas` com o fornecedor de pé, o teto é curto: subir. Se a pessoa clicar "Retomar" num
fundo que já tinha volta marcada em mais de 10% das quedas, a espera automática está lenta demais para quem olha.

## Emenda de 2026-10-28 — a queda no fundo espera mais e não culpa a máquina que está em contato (NOD-386)

**Contexto.** Com a emenda de 20/10, o fundo que caía por reinício do servidor ou "máquina sem contato" voltava NA HORA,
e o teto de 3 quedas de infraestrutura contava a cadeia inteira: uma instabilidade de 8 min matou uma task do Revisor em
22/10 (`quedas_esgotadas`). Em 23/10 a `nod-motor-teste` estava em contato, mas o servidor recusou a entrega
(`503 banco_ocupado`); o motor parou de renovar e o turno caiu como `maquina_sem_contato` com "a máquina nod-motor-teste
parou de responder" — culpando a máquina pela falha do servidor. Diagnóstico na NOD-362, correção na NOD-386.

**Decisão.**

- **Espera crescente** (`esperaQuedaNoFundo`, `ESPERAS_QUEDA_NO_FUNDO_MS`): a volta da queda por reinício do servidor, ou
  com a máquina ainda em contato, fica marcada em ~30 s, 1, 2, 5 e 10 min (±25%, `comJitter`), em vez de "agora".
  A queda com a máquina realmente sem contato segue esperando a máquina voltar (sem hora), como antes.
- **Teto por janela**: 5 quedas em 2 h (`MAX_QUEDAS_NO_FUNDO_NA_JANELA`, `JANELA_QUEDAS_NO_FUNDO_MS`). Conta a hora do
  último sinal da queda (`coalesce(ultimo_sinal_em, criado_em)`, `quedasDaCadeia(raiz, exceto, desde)`); queda mais velha
  não conta. O teto de 24 h da cadeia (`PRAZO_DO_FUNDO_MS`) continua. `MAX_QUEDAS_POR_PEDIDO` (3) segue nos demais usos.
- **A máquina em contato não leva a culpa.** No modo compartilhado, quando o varredor vence o lease e a máquina do turno
  ainda está puxando (`maquinaVoltou`, a mesma régua da presença), a queda é do servidor: a linha é
  "O servidor do nod não respondeu a tempo. {pedido} volta {quando}, de onde parou." (`fundo-espera-servidor`,
  assunto `fundo.espera`; ao remetente também, no pedido de colega), a frase da conversa usa
  `MOTIVO_SERVIDOR_NAO_RESPONDEU` e NENHUM aviso de queda da máquina abre. O `motivo_interrupcao` gravado continua
  `maquina_sem_contato` (sem migração; o evento leva `servidor_falhou: 1`). Sem contato, tudo segue como hoje (linha da
  máquina e aviso). A porta da entrega (`aposQuedaDaMaquina`) e o modo local não mudam. A rotina cuja volta passa da
  próxima janela fica `nao_rodou` com o motivo novo `servidor_nao_respondeu` (`rotina_execucoes.motivo` é `text`, sem
  migração; uma imagem antiga mostraria o código cru, pelo `?? e.motivo` de `web/lib/execucao.ts`).
- **O aviso de fundo preso conta da volta marcada.** A volta com hora só fica pegável em `acordar_em`: os 10 min de
  `AVISO_FUNDO_PRESO_MS` contam de `greatest(criado_em, acordar_em)`, para todo fundo. E a linha do servidor (que promete
  uma hora) não conta como o aviso da cadeia: se a volta não for pega, o aviso de preso ainda sai uma vez
  (`ABERTURA_DA_ESPERA_DO_SERVIDOR`, em `fundosPresos`).

**Gatilho de reversão.** Se em 14 dias de log mais de 5% das cadeias de fundo com `servidor_falhou` terminarem em
`quedas_esgotadas`, a espera ou o teto estão curtos: subir. Se a pessoa clicar "Retomar" numa conversa cuja frase diz
"o servidor do nod não respondeu" e a máquina de fato estava fora (presença mentiu), voltar a culpar a máquina e revisar
`OFFLINE_MS`.
