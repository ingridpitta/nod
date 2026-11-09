# ADR-036 — Harness por agente, escolha automática e catálogo progressivo

Definido em 2026-09-18. Complementa ADR-012, ADR-014, ADR-019 e o documento de modelos.

## Decisão

Harness é o software que executa o agente; modelo é a inteligência usada por ele. Novos agentes nascem com `harness=auto` e `modelo=auto`. O servidor resolve a escolha antes de emitir o plano, usando apenas harnesses prontos no computador que puxou a tarefa. Ordem editorial: Claude Code/Sonnet, depois Codex/GPT-5.6 Sol. A preferência explícita da máquina precede essa ordem quando disponível. Uma escolha explícita do agente nunca troca de fornecedor silenciosamente.

O ambiente de desenvolvimento mantém `NOD_EXECUTOR=catcher`, explicitamente identificado como simulação. `NOD_EXECUTOR=auto`, ou produção sem essa variável, ativa a descoberta dos harnesses integrados. Falta de conta no modo real nunca rebaixa a execução para simulação. `NOD_MODELO` continua sendo um override administrativo para novos agentes; use `auto` para habilitar a escolha automática. A migração 0013 não altera modelos existentes.

A preferência é copiada para o turno ao enfileirar, inclusive em rotinas, delegação, retomada e duplicação. O plano captura o harness e o modelo resolvidos; `executor` mantém o significado anterior de local/catcher nos contratos e na autoria. Não há migração destrutiva de eventos antigos. A fila de computadores remotos só reivindica tarefas compatíveis com os harnesses anunciados; anúncios são vinculados à chave e ao escopo, nunca ao corpo.

## Experiência

Nenhum campo adicional na criação. Na conversa, um atalho discreto abre o seletor. No perfil, a opção recomendada vem antes de “Personalizar modelo”. Um único dropdown associa modelo e harness, com grupos, descrições curtas, navegação nativa por teclado e opções desconectadas desabilitadas. “Automático” restaura os padrões em qualquer momento. Detalhes técnicos e disponibilidade ficam em uma segunda expansão. Editar uma preferência não concede novos acessos.

## Execução e isolamento

Claude mantém `--tools ""`, `--strict-mcp-config` e a allowlist do plano. A descoberta de produção usa `auth status` (JSON por padrão), versão e help, sem inferência paga. Os scripts de sonda empírica continuam separados.

Codex usa `exec --json`, `--ignore-user-config`, `--ignore-rules`, `--ephemeral`, `--strict-config`, sandbox read-only, aprovação externa pelo proxy nod e ferramentas nativas de execução, navegador, plugins e apps desabilitadas. Versões sem as flags de isolamento são recusadas antes do prompt. A autenticação vem do CLI da pessoa; chaves OpenAI herdadas e variáveis de banco são removidas. Um launcher 0600 contém o token e chama o proxy MCP; o token não entra em argv. O diretório temporário é apagado no finally. Os eventos JSONL são normalizados; custo desconhecido permanece null.

O fluxo com seleção de harness recompõe contexto a partir do histórico e memória do nod e não usa resume nativo, evitando misturar sessões entre fornecedores/modelos. Isso limita o histórico explícito às últimas 20 mensagens de até 1.000 caracteres cada, conforme o contrato existente; a memória persistida complementa o contexto. Trocar modelo limpa também a sessão legada da conversa. Não existe repetição automática depois de efeitos externos.

## Limites desta entrega

Claude Code e Codex têm drivers. Cursor e Hermes aparecem como integrações em preparação, sem permitir seleção. Grok é tratado como modelo/provedor a ser exposto por um harness compatível, não como um executável inventado. Nenhum driver ACP ou API xAI é simulado como integração pronta.

O catálogo de modelos é editorial, não uma garantia de habilitação na assinatura. O estado de login não prova saldo, cota ou acesso a cada modelo. Erros do fornecedor durante uma tarefa seguem o encerramento existente do nod. Descoberta dinâmica de modelos e uma integração ACP exigem testes próprios antes de serem habilitadas.

Adicionar um harness requer: declarar id/catálogo, implementar o SPI, sondagem sem inferência, parser e política de ferramentas, registrar nos hosts, validar anúncio remoto e adicionar testes de processo/MCP/interrupção. Alterar somente o catálogo não habilita execução.

## Validação local

Medido em 2026-09-18: `npm run check` passou com 700 testes (377 unitários, 225 integração, 49 conformidade e 49 concorrência). `npm run build` e `npm run desktop:build` passaram. O proxy compilado respondeu ao initialize JSON-RPC usando Node 24.19.0; o runtime Electron não estava instalado neste checkout, portanto isso não valida o aplicativo nativo. A interface foi inspecionada no navegador, incluindo seleção, detalhes de disponibilidade, cancelamento e retorno do foco. Os testes de drivers usam CLIs falsos e incluem processo, interrupção e handshake MCP; não houve inferência paga nem aceite real das contas/modelos.

## Referências consultadas

- [OpenMausBot — Agent engines](https://docs.openmausbot.com/docs/providers): descoberta de instalação e login e normalização por drivers.
- [Hermes — Bot Mode](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/bot-mode.md): identidade do bot independente da conexão.
- [Codex — execução não interativa](https://developers.openai.com/codex/noninteractive) e [configuração](https://developers.openai.com/codex/config-reference): eventos JSONL, sandbox e MCP.
- [Claude Code — CLI](https://code.claude.com/docs/en/cli-reference): autenticação e modo não interativo.

## Emenda (2026-10-05): o Codex com ferramentas, medido

**Contexto.** O caminho do Codex nunca tinha rodado com o CLI real (os comentários do driver diziam "não
homologado"). No primeiro uso em produção, nove turnos seguidos de um bot terminaram com zero chamadas de
ferramenta: o bot respondia, mas dizia que "a ferramenta está indisponível" a cada pedido de acesso.

**Medido com o codex-cli 0.147.0 e o gpt-5.6-sol** (`scripts/sonda-codex-ferramentas.ts`):
- `features.code_mode_host=false`, que o nod passava para isolar, fazia toda chamada MCP falhar antes de chegar ao
  proxy. Nessa versão o modelo chama as ferramentas MCP por um trecho de código (`functions.exec`) que roda nesse host.
- Sem essa chave, o Codex cancelava a chamada sob `approval_policy="never"`. Com
  `default_tools_approval_mode = "approve"` no servidor `nod`, a chamada chega e o resultado volta.
- `--strict-config` com uma chave que a versão não conhece (`features.skip_host_skill_discovery` no 0.147.0) derrubava
  o turno antes do modelo, com código 1.

**Decisão.**
- O host de code mode fica ligado e o servidor `nod` é aprovado sem pergunta ao Codex. A decisão de rodar uma
  ferramenta continua sendo só do proxy do nod (modo de aprovação do bot, cartão na conversa).
- As chaves de isolamento passam a ser negociadas com a versão instalada, de graça, na sonda do driver. Cai o que a
  versão não conhece; `features.shell_tool`, `features.unified_exec`, as chaves fora de `features.*` e os campos
  obrigatórios do servidor não caem, e sem eles o Codex fica indisponível com o motivo dito à pessoa.
- O erro que o Codex devolve passa a ir para o diagnóstico do turno (`erroCru`). Antes era descartado.

**O que fica em aberto.** Visto de dentro (a segunda pergunta da sonda), o modelo ainda lista `collaboration.*`
(subagentes), apesar de `features.multi_agent=false`, e, no 0.147.0, as skills embutidas do Codex, porque a chave que
as escondia não existe nessa versão. Nenhum dos dois dá terminal, rede ou escrita fora do sandbox do turno, mas o
isolamento "só o proxy nod" não está provado para o Codex como está para o Claude. O laço de voz pelo app-server
(ADR-076) usa as mesmas chaves e continua sem homologação com o Codex real.

**Gatilho de reversão.** Se uma versão do Codex passar a dar arquivo ou rede ao código de `functions.exec`, o host
volta a ser desligado e o Codex sai do catálogo até haver outro caminho para as ferramentas MCP.

## Emenda (2026-10-06): a cota que o CLI informa é mostrada, nunca usada como gate (NOD-179)

**Contexto.** "Limites desta entrega" diz que o login não prova saldo nem cota. O Claude Code passou a informar a cota
a cada turno, de graça, no `rate_limit_event` do stream-json: quanto já foi usado na janela de 5 horas e na semana, e
quando cada uma renova. A pessoa não tinha como ver isso no nod sem rodar `/uso` (que no Codex nem existia).

**Decisão.**
- O driver do Claude Code entrega o último `rate_limit` do turno (`usoDoPlano` no resultado). O servidor valida
  pelo domínio (`usoDoPlanoValido`: utilização entre 0 e 1,5, horários plausíveis, harness igual ao que rodou o
  turno) e grava uma linha por pessoa e CLI (0056, `uso_do_plano`, com RLS). A leitura mais nova vence; dado
  inválido é descartado com log e a entrega segue.
- `GET /api/uso-do-plano` devolve só as linhas da pessoa, em dados crus; a tela formata no fuso dela (ADR-007) com
  `estadoDoMedidor`. A tela fica na NOD-12.
- **Nunca gate.** Nenhum turno é bloqueado, adiado ou desviado para outra IA por este número, nem perto do limite.
  O fim de cota continua sendo o erro do próprio fornecedor no turno (`limite_da_assinatura`, NOD-168).
- Sem ler credencial nem chamar API do fornecedor (ADR-015/019) e sem processo extra só para medir.
- `/uso` num bot de outra IA não vira `/cost`: responde "O uso do plano está em Seu espaço › Conexão."

**Gatilho de reversão.** Se o Claude Code deixar de mandar o `rate_limit_event` ou mudar o formato, a linha para de
ser atualizada (o `medido_em` envelhece) e a tela mostra a última leitura com a hora; nada no turno depende dela. Se
um dia o número virar critério de decisão, isso pede ADR nova, não esta emenda.

## Emenda (2026-10-06): fixado e indisponível recusa, limite do plano com motivo próprio (NOD-171)

**Harness fixado e indisponível.** O UAT de 2026-09-18 deixou a ressalva UX-01: no app do Mac, o bot fixado num harness
que o Mac não tinha pronto ficava com o turno pendente para sempre, e a negação falava em "motor pronto". Agora:
- `resolverHarness` diz qual harness faltou; o despacho recusa com o inventário dele, e a negação nomeia o harness e o
  estado (não instalado, sem conta conectada, desatualizado).
- A reivindicação recebe os harnesses prontos de todas as máquinas vivas da pessoa: o turno fixado num harness que
  nenhuma delas tem pronto é reivindicado e recusado, em vez de ficar pendente. Harness em `sonda_lenta` conta como
  "pode ficar pronto" e o turno espera a re-sonda.
- Modelo fora da lista vira `executor_indisponivel` com `modelo_invalido`, não `entrada_invalida`. A negação leva o
  `modelo` no payload e a tela pede outro modelo: a IA está pronta, então nunca diz que ela "já voltou".
- A repetição das falas barradas (`repetirBarradosPorIa`) não repete a fala fixada num harness que ainda não está
  pronto, para não gerar uma negação nova a cada anúncio do Mac.

**Limite do plano.** `limite_do_plano` entra no enum de motivos de falha (0058). No Claude Code ele vem do protocolo:
`rate_limit_event` com `status: "rejected"` na mesma rodada do `result`, com a hora em que o plano volta
(`limiteVoltaEm`); `isUsingOverage: true` não conta como limite. No Codex só existe texto (`usage_limit_reached`, "You've
hit your usage limit"), classificado em `limite_de_uso`. Nos dois casos a conversa ganha a mensagem de sistema com
`payload: { kind: "limite_do_plano", harness, voltaEm }`, e a tela diz quando volta (no Codex, "parece", porque a hora
não vem do protocolo). A prova é por
fixtures e CLI falso: não se leva uma conta ao limite de propósito.

**Lista editorial.** Só cresce: entra o modelo que o `model/list` do Codex real mostrou e que passou num turno real do
UAT (`docs/uat-harnesses-e-modelos.md`). Os padrões do automático (Sonnet e GPT-5.6 Sol) não mudaram.

**Gatilho de reversão.** Se a recusa imediata do fixado irritar mais que a espera (a pessoa estava instalando o CLI
naquele minuto), o caminho é estender o `sonda_lenta` a "instalando", não voltar à fila pendente sem aviso.

## Emenda (2026-10-10): modos, ordem, raciocínio e troca no limite (plano das IAs, PR 2)

**Por quê.** Teste do Breno em 09/10, em produção: a ligação de boas-vindas bateu no limite da assinatura do Claude, o
Codex não estava pronto, e nada trocava de IA sozinho; o botão "usar Codex" chamava `POST /executor`, que não existe no
servidor compartilhado (404). Decidido com o Marlon (canvas QYrgwbMiNRU4mn2SA1fAm2):

**Modos.** Todo bot nasce em **Automático** (`inteligencia_modo = 'auto'`): usa a primeira IA **pronta** da ordem que
não esteja no limite. Ele pode sair do padrão em **Uma IA só** (`'fixa'`): usa sempre a IA escolhida e, se ela não estiver
pronta, espera (a recusa nomeando a IA, como na emenda de 2026-10-06), nunca troca de fornecedor sozinho — nem no limite.

**Ordem.** É da pessoa (`preferencias.ordem_ias`, arrastada em Provedores de IA; nula = Claude e depois Codex). O bot
segue a dela; com `agentes.ordem_ias` ele tem a própria. A ordem é sempre completada com as IAs que faltarem, no fim.
No modo local sem ordem escolhida, o harness padrão do interruptor vai na frente (como antes).

**Modelo e raciocínio por IA.** `agentes.escolhas_ia = {<ia>: {modelo, raciocinio}}`, nos dois modos. IA sem escolha usa
o **Recomendado**: Opus no Claude e GPT-5.6 Sol no Codex, raciocínio médio. O automático, que usava o Sonnet, passa ao
Opus. Os níveis de cada modelo moram no catálogo (`HARNESSES[].modelos[].raciocinios`): no Claude, o `--effort` (low…max;
o Haiku só low…high, do protótipo, não medido por modelo); no Codex, o `effort` do `turn/start`, medido no `model/list`
do app-server 0.147.0 sem turno (com a conta logada e com HOME vazio, a lista é a mesma: Sol e Luna aceitam low…max, o
Sol também `ultra`, que fica de fora porque delega tarefas sozinho; os GPT-6 não aparecem nessa versão e ficam com
low…xhigh). O raciocínio que vai ao CLI é sempre um nível que o modelo aceita (`raciocinioValido`). Lacuna: o `codex exec`
(reserva, sem app-server) continua sem raciocínio — a chave `model_reasoning_effort` não foi provada num turno.

**Campos derivados.** `harness`, `modelo` e `esforco` continuam e passam a ser derivados (`derivadosDa`), gravados
junto pelo repositório: é o que os caminhos de enfileiramento copiam para o turno e o que o código anterior lê. Modo auto
= `auto/auto`; fixa = a IA e o modelo escolhido dela (`auto` = o recomendado); `esforco` = o raciocínio do Claude. O
`PATCH /agentes/:id` com `{harness, modelo, esforco}` (a tela de Inteligência de antes, o `gerir_bots`) é traduzido
(`inteligenciaDoLegado`): `auto/auto` = Automático sem modelo escolhido (os modelos saem, os raciocínios e a ordem
ficam), como era o "Automático" daquela tela. A tela nova usa `GET`/`PUT /agentes/:id/inteligencia` e `GET /ias`.

**Migração (0068).** `auto/auto` → Automático, ordem nula. **Fixo no Sonnet** (o padrão antigo, `sonnet`, com o Claude
escolhido ou não) → Automático (decisão do Marlon: só fica fixo quem escolheu outro modelo à mão). O `auto` antigo com
outro modelo do Claude já rodava fixado nele (`harnessFixado`) → "Uma IA só" no Claude, com o modelo. Harness fixo →
"Uma IA só" naquela IA, com o modelo dela. O esforço vira o raciocínio do Claude (e do Codex, no bot fixo nele, porque
ia ao `turn/start` também).

**Limite.** O turno que volta com `limite_do_plano` (protocolo do Claude Code: `rate_limit_event` `rejected`) ou com a
classe `limite_de_uso` (texto do Codex) grava a IA em `preferencias.ias_no_limite` até `renovaEm` — a hora do fornecedor
(até 8 dias à frente), senão **1 h** (o Codex não diz a hora). Vale para a ordem de todos os bots da pessoa:
- no Automático, a fala da pessoa é repetida na **próxima IA da ordem** pronta e fora do limite, e a conversa ganha a
  linha `ia_trocada` com `causa: "limite"` e `renovaEm`; sem outra IA, fica o aviso do limite de sempre, com a hora;
- a fila não entrega turno do Automático a uma máquina que só tem a IA no limite enquanto a pessoa tiver outra fora
  dele (`iasParaOAutomatico`); sem nenhuma fora do limite, vale a primeira pronta — o prazo é estimativa, e o próprio CLI
  diz se o limite continua, então o turno nunca fica preso;
- passado `renovaEm`, a IA volta a valer (o app do Mac testa de novo pela vigia); um turno que dá certo nela antes disso
  a tira do limite;
- `GET /ias` mostra a IA no limite como `nao_autenticado` com `causa: "limite"` e `renovaEm` (o Mac nunca anuncia essa
  causa), e a ponte publica `inventario.mudou` quando o limite muda ou quando um Mac reanuncia IAs diferentes.
Isto usa o ERRO do turno, não o número do uso do plano: a emenda de 2026-10-06 (NOD-179) continua — o medidor nunca é
gate. A ligação no limite com outra IA pronta continua **sozinha** por ela (emenda da ADR-078).

**Sem botão quebrado.** No servidor compartilhado o `GET /executor` diz `trocavel: false` e a tela não mostra o "usar"
(o `POST /executor` existe só no modo local). As causas novas do app (`sem_node`, `config_invalida`) atravessam o anúncio
com a frase do servidor, em vez de virar "não encontrado".

**Gatilho de reversão.** Se a troca no limite repetir respostas (a primeira IA tinha feito parte do trabalho) mais do que
ajuda, o caminho é perguntar antes de repetir (a linha âmbar "Continuar pelo ChatGPT" do PR da web), não desligar o
limite: a ordem e o prazo continuam valendo. Se o Opus no automático custar caro demais para quem tem plano pequeno, o
Recomendado muda numa linha do catálogo (`recomendado`), sem migração. Se o 1 h do Codex for curto (o limite dele é
semanal), troque `PRAZO_LIMITE_SEM_HORARIO_MS` ou ensine o horário a `erro-fornecedor.ts` com uma amostra real.

## Emenda (2026-10-12): a cota vira portão do trabalho de fundo (ADR-099 §7)

A emenda NOD-179 dizia que o número da cota nunca seria gate e que, se virasse, seria por ADR nova. A
[ADR-099](adr-099-um-dono-por-bot.md) §7 é essa ADR. Com 99% de uma janela usada, o trabalho novo de fundo espera, e o
1% fica para a conversa com a pessoa. No limite, todo o fundo espera a renovação em vez de falhar. Detalhe na emenda de
2026-10-12 da [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md). A conversa com a pessoa continua como acima: nunca é
segurada pelo número, e a troca de IA no limite segue igual.

## Emenda (2026-10-14): o Codex com o terminal

O "Codex continua só com o proxy" desta ADR caiu com a [ADR-103](adr-103-o-codex-com-o-terminal-pelo-hook-do-nod.md):
o chat do Codex no app-server tem o kit do terminal pelo hook PreToolUse do Codex, confiado pela API do app-server, e o
isolamento de antes fica para a máquina sem o hook e para o `codex exec` de reserva.

## Emenda (2026-10-22): o uso do plano na tela, por conta, e a leitura do Codex (NOD-12)

**Contexto.** A emenda NOD-179 deixou a tela para a NOD-12 e previa uma linha por CLI em Seu espaço › Conexão. Desde
então a tela virou Provedores de IA, uma lista de contas ([ADR-102](adr-102-contas-da-pessoa-em-todas-as-maquinas.md)/108), e a
leitura passou a ser gravada por conta (0077). O Codex não informava o uso.

**Decisão.**
- O uso mora **na linha de cada conta** em Seu espaço › Provedores de IA: duas barras (5 h e semana) com "% usado" e
  quando renova (`web/telas/uso-da-conta.ts`, protótipo do Gil no PR #414). Sem leitura, a linha diz por quê; leitura
  com mais de 6 h "pode ter mudado"; janela que renovou não mostra o número velho.
- Um limiar visual só: 80% muda o tom, **90% é âmbar** (`LIMIAR_ALERTA` desceu de 0,95 para 0,9, o mesmo do anel do
  seletor), 100% é o limite. Nunca vermelho: esgotar é aviso, não erro.
- Fora da lista, só dois sinais: o anel do seletor (agora da conta em uso) e a faixa do menu da conta, que aparece só
  quando as rotinas vão esperar (≥ 90% ou no limite, sem outra conta pronta na fila).
- O chat do Codex lê `account/rateLimits/read` do próprio app-server no fim da sessão (prazo de 2 s, melhor esforço),
  sem ler credencial nem abrir processo novo. A leitura entra pelo mesmo caminho da do Claude (`usoDoPlano` no
  resultado, gravada na conta do turno) e, por isso, **também alimenta o portão do fundo** (emenda de 2026-10-12). O
  `codex exec` de reserva não lê.
- `/uso` num bot de outra IA responde "O uso do plano está em Seu espaço › Provedores de IA."

**Gatilho de reversão.** Se o app-server do Codex mudar o formato ou deixar de responder, a conta fica sem leitura nova
e a tela diz que o ChatGPT não informou; o turno não depende dela. Se o âmbar em 90% virar ruído (a faixa aparecendo
sem que as rotinas esperem de fato), volta-se a 95% no domínio e no anel juntos.

## Emenda (2026-10-23): a mínima do modelo puxa a atualização (NOD-9)

O alvo da atualização automática é o maior entre `PISO_CLI` e a mínima do modelo pedido (`alvoDaAtualizacao`,
`src/domain/atualizacao-automatica.ts`). A recusa "desatualizado" só sai quando a atualização não chegou ao alvo
(`insuficiente`) ou não pôde rodar; o fornecedor nunca troca sozinho por isso.
