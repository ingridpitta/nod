# ADR-135 — Registro único de ações e catraca de paridade tela × chat

Status: aceita · Data: 2026-10-28 · NOD-391 (projeto "Tudo pelo chat") · Emenda da ADR-082 (o risco do lote passa a sair
do registro; o excluir pelo Nod desliga o computador)

## Contexto

O projeto "Tudo pelo chat" quer que tudo o que a pessoa faz na tela possa ser pedido no chat. Hoje não há uma lista do
que a tela faz: as rotas de pessoa ficam espalhadas em ~30 arquivos (124 rotas que mudam algo), e o lote do Nod
(`gerir_bots`, ADR-082) tem o próprio enum e a própria tabela de risco. Sem lista, não dá para medir o que falta. E os
dois caminhos já divergiam: excluir um bot pela tela desligava o computador dele; pelo Nod, não.

## Decisão

1. **Registro único** em `src/domain/acoes/` (um arquivo por domínio, puro; os tipos em `src/contracts/acoes.ts`). Cada
   ação de pessoa que muda algo tem um id `dominio.verbo`, título, risco, se mostra cartão no chat, o estado no chat e,
   quando o chat já faz, o schema dos argumentos. `IdAcao` sai do registro: uma rota que declara um id fora dele não
   compila.
2. **Quatro estados no chat.** `vivo`: o chat faz pelo mesmo executor da tela, com teste de contrato. `parcial`: o chat faz,
   mas diverge ou falta parâmetro (o registro diz o quê). `falta`: a onda dona (NOD-393 a NOD-397, NOD-400) vai ligar.
   `nunca`: exceção escrita (senha, sessão, pareamento, credencial, o próprio chat, o cartão que é a resposta da pessoa,
   estado de tela, onboarding).
3. **Risco → modo de aprovação**: `leitura` nunca vira cartão; `muda` segue o modo do bot; `arriscada` vira cartão no
   manual e no automático; `pessoa_confirma` é sempre da pessoa, também em "Ignorar todas as aprovações". O lote deriva o
   risco de cada tipo do registro (`riscoDe` quando depende dos argumentos; `deFora` para a cerca 3 da ADR-082). O
   comportamento é o mesmo de antes: um teste compara o derivado com a regra antiga em toda combinação.
4. **Executor único e efeito pós-commit.** O piloto `bots.*` (criar, duplicar, editar, mover, excluir, mudar_modo) passa
   pela mesma função na rota e no lote (`src/use-cases/acoes/bots.ts`); o que cada caminho escolhe é parâmetro escrito
   (o lote cria já na seção, duplica com as rotinas pausadas e só confirma o modo total com o cartão aprovado pela
   pessoa). O modelo padrão do bot criado sem modelo (`NOD_MODELO`) vem dos `Deps`, igual nos dois caminhos. O efeito fora do banco vira `Deps.aposCommit`: roda depois do commit. Na rota, a falha sobe como antes; pelo
   Nod (e no clique do cartão do lote), a ação já commitou, então a falha vira aviso no log (`efeito_apos_commit_falhou`).
   O efeito agendado por uma ação do lote que o savepoint dela desfaz é descartado junto.
   **As duas diferenças tela × chat do piloto:** (a) *corrigida*: excluir pelo Nod agora desliga o computador do bot,
   como a tela; (b) *mantida e escrita*: duplicar pelo Nod cria a cópia com as rotinas pausadas (`rotinasPausadas: true`,
   o aviso volta ao Nod), enquanto a tela copia as rotinas no estado do original. O teste de contrato
   (`tests/integration/paridade-bots.test.ts`, um caso por id) fixa as duas; o desligamento no app composto está em
   `tests/concurrency/computadores-http.test.ts`.
5. **Catraca** (`tests/conformidade/paridade.test.ts`, sobre o app composto nos dois modos, com as famílias opcionais
   ligadas). A: toda rota de pessoa que muda algo (não GET, sem `interno`, `maquina` ou `publica`) declara `Rota.acao`.
   B: toda ação é usada por uma rota de pessoa, salvo `semRotaDePessoa` com o motivo (a conta mora em `/api/conta`). C: o
   número de vivas não cai abaixo de `docs/paridade.piso.json`, e o piso não cai em relação ao da `origin/main` (o CI
   busca a main antes); quem liga uma ação sobe o piso no mesmo PR. D: o
   `docs/paridade.md` é o gerado por `npm run paridade` (que sob CI só confere).

## Desvios registrados

- **Um PR só**, com os passos em commits (a regra do fluxo do Faustino), em vez de dois PRs empilhados.
- **O registro é lista de dados, não fábrica de rotas.** A rota continua escrita à mão e só declara o id; gerar rotas do
  registro mexeria em 124 handlers de uma vez, sem ganho para a medição.
- **`contas_ia.trocar_executor`** só existe no modo local (`POST /executor`); no compartilhado a rota não existe. A
  catraca compõe os dois modos, então a ação conta.
- **Parciais:** `rotinas.criar` (a tela manda fonte, limites e política sem dado; o lote preenche com padrões),
  `acessos.dar` (o lote só concede, sem o nível Nenhum nem revogar, e pela decisão do pedido de acesso) e
  `relatos.registrar` (a ferramenta do Nod e o botão gravam por casos de uso diferentes, sem teste de contrato). Viram
  vivas nas ondas donas.

- **`TIPOS_ACAO_LOTE` continua `as const` em `src/contracts/ferramentas-do-nod.ts`**: contracts não importa domain. Um
  teste de lista fechada amarra o enum aos `tipoNoLote` do registro; o risco (`riscoDaAcao`) já sai do registro.
- **A conta (`/api/conta`) fica fora da catraca A**: as rotas de conta são `publica` (sessão própria); os ids `conta.*`
  usam `semRotaDePessoa` com o motivo. Revisitar quando a conta ganhar caminho no chat.
- **"Vivo" não liga o handler ao executor por tipo**: o contrato de cada id é o teste de integração, não a catraca.
- **O efeito pós-commit pelo Nod roda antes de a ferramenta (ou o clique no cartão do lote) responder** (até 20
  desligamentos em série num lote).
  Aceito no piloto; se pesar, disparar depois da resposta, como a limpeza do NOD-374.
- **As ações `quadro.*` (NOD-442) são `muda` com `cartaoNoChat: false`**: o `gerir_quadro` aplica direto, sem o cartão
  do modo do bot. O quadro é da pessoa, todo lote tem Desfazer na tela, e o que tem efeito fora (o turno que a tarefa
  abre) segue as aprovações do bot responsável. O turno não limpo não escreve a meta, não responde nem desfaz, e o que
  ele escreve fica marcado de fora (`de_fora`). Gatilho de reversão: um lote de bot que a pessoa precisou desfazer por
  engano mais de uma vez por semana, ou uma tarefa excluída sem volta, passa as ações destrutivas (excluir, trocar de
  responsável) a seguir o modo, como o `gerir_bots` com o `riscoDaAcao`.
- **As leituras `conversas.marcar_lida`, `marcar_nao_lida`, `marcar_tudo_lido` e `desfazer_leitura` (NOD-449,
  2026-11-01) são `muda` com `cartaoNoChat: false`**: o `nao_lidos` de qualquer bot aplica direto, sem o cartão do modo.
  Só mexem no "lido até" da própria pessoa, não têm efeito fora, e toda marcação tem Desfazer (o aviso da tela e o recibo
  do chat), que só volta se o "lido até" não mudou desde então. Só o turno limpo (entrada confiável e não contaminado)
  marca; o turno de fora só lista, e procuração de outra pessoa ou corrente (profundidade > 0) nem lista. Gatilho de
  reversão: uma marcação feita por bot que a pessoa não pediu e precisou desfazer mais de uma vez por semana passa as
  marcações pelo chat a seguir o modo do bot.
- **As ações `canvas.comentar` e `canvas.resolver_comentario` (ADA-13, 2026-11-04, ADR-150) são `muda` com
  `cartaoNoChat: false`**: o `gerir_canvas` aplica direto, sem o cartão do modo do bot. O canvas é da pessoa, comentar
  não tem efeito fora, e resolver tem o reabrir (`resolvido: false`) na tela e no chat. O turno que leu conteúdo de fora
  comenta (o comentário fica `nao_confiavel`, marcado de fora na tela) e resolve ou reabre os comentários de bot e de
  importação, mas não resolve o da pessoa: esse só sai num turno limpo ou pela tela. Gatilho de reversão: a pessoa
  precisar reabrir um comentário resolvido por bot por engano mais de uma vez por semana passa o resolver a seguir o modo.

## Alternativas descartadas

- Anotar o id num comentário e medir por regex: não compila, e a rota nova passaria sem id.
- Lista à parte, fora do código (planilha ou issue): sai de sincronia no primeiro PR.

## Gatilho de reversão

Se a catraca barrar PRs sem relação com o chat mais de uma vez por semana (o id virando burocracia), trocar o A por um
aviso e manter só o C e o D.

## Emenda (NOD-398): o registro também alimenta o fuzz e o bot de QA

- **Fuzz** (`tests/concurrency/fuzz-acoes.test.ts`, gerador puro em `src/domain/fuzz/`, plano por servidor em
  `tests/helpers/fuzz.ts`): a lista de ações vem do `REGISTRO_DE_ACOES`, nunca do teste. Cada rota com `acao` recebe N
  entradas absurdas geradas do schema (N=20 no CI, 200 no `fuzz-noturno.yml`). Invariantes: nunca 5xx, servidor de pé,
  erro sem diff no banco da pessoa e banco de outras pessoas intacto (uma do mesmo tenant, uma de outro). Roda em dois
  servidores (padrão; compartilhado + contas + nuvem). **Cobertura** = ao menos uma chamada da ação chegou ao HANDLER
  (404 "rota não encontrada" e 401 de sessão do roteador não contam); ação que não chegou em nenhum servidor falha o
  teste. As `conta.*` (`semRotaDePessoa`) contam pela rota de `/api/conta` delas (`CAMINHOS_DAS_ACOES_DE_CONTA`) e,
  ali, a cobertura é POR ROTA (método + padrão): cada rota de conta montada tem de ler a entrada ao menos uma vez; 429
  e 403 sem `motivo` (a trava de Origin) não contam. Rota de conta sem ação conhecida leva fuzz como sintética. O
  retrato da pessoa inclui as tabelas de conta sem RLS (ADR-124) ligadas a ela (`sqlDoRetratoDaConta`), e o cliente
  do fuzz adota o `Set-Cookie` como um navegador. Invariante de decisão: toda ação de lote `arriscada` ou
  `pessoa_confirma` chamada por `gerirBots` nos modos em que deve esperar nunca roda sem cartão. As que destroem (DELETE) rodam depois das outras, e as públicas
  por último. A rede fora do loopback fica bloqueada no processo (Socket.connect), e nenhum processo-filho roda (ChildProcess.spawn vira um executável inexistente: ENOENT, como numa máquina sem `gh`; revisão 8, porque `apps.conectar` do GitHub chamava o `gh` logado da máquina e subia o MCP; na revisão 9 também spawnSync/execSync/execFileSync). Socket unix só o do Postgres e os do `NOD_HOME` do fuzz, que é um diretório temporário (o `~/.nod` de quem roda não é tocado). Os ids do caminho vêm por recurso (`porRecurso`: bot, conversa e rotina reais da pessoa e da outra), para a rota passar da busca da entidade. Depois de um sucesso o fuzz espera a fila de turnos da pessoa esvaziar e o retrato repetir antes de tomar a referência: o turno que `rotinas.executar` ou uma mensagem disparam escreve depois da resposta e não pode cair na conta do caso seguinte. A semente sai no log e reproduz
  (`FUZZ_SEMENTE`). Sentinelas: `tests/unit/fuzz-sentinelas.test.ts` (500, escrita no erro, outra pessoa, queda, ação
  nova pelo mesmo plano do teste, handler alcançado) e `tests/integration/fuzz-retrato.test.ts` (o retrato real enxerga
  escrita deixada por um erro, inclusive UPDATE que não muda a contagem). O guarda dos achados corrigidos (corpo `null`, byte nulo, surrogate, modo inválido) é o unit `entrada-absurda`, determinístico; o fuzz N=20 pode não sortear esses casos.
- **Bot de QA** (`src/domain/qa/roteiro.ts` + `tests/concurrency/qa-pelas-acoes.test.ts`): o roteiro é uma lista de
  ids do registro, pedidos PELO CHAT (`gerir_bots`, como a pessoa pede ao Nod) e, onde o chat não alcança, pela rota
  achada pela `acao`, nunca por caminho escrito à mão. Depois de cada passo confere o
  estado pelas mesmas leituras da tela. O relatório sai também quando um passo lança. O CI publica `qa-relatorio.md`
  com o print final (390 e 1440) como artefato.
- **`tela.capturar`** (`ACOES_TELA`): nova ação do registro, uma LEITURA (risco `leitura`) servida por POST porque leva
  corpo (tela e largura). Exceção à §1 (o registro é de ações que mudam algo): ela entra para o fuzz, o QA e a catraca
  de paridade a enxergarem, e por isso aparece na contagem de paridade. Atrás de `NOD_CAPTURA_TELA=1` (desligada em produção: 503 `indisponivel` sem subir o Chrome).
  Só telas de uma lista fechada e larguras 390 e 1440. O Chrome fala CDP por pipe (nenhuma porta aberta), resolve só o
  loopback (`--host-resolver-rules`), leva só o cookie `nod_sessao`, roda uma captura por vez com fila limitada e
  prazo em toda espera, e morre com o grupo de processos no fim.
- **Achados do fuzz corrigidos no mesmo PR**: corpo JSON `null` e texto com byte nulo viravam 500; agora `lerCorpo`
  os recusa e o roteador responde 400 `entrada_invalida`. O SQLSTATE 22021/22P05 vindo de outro lugar continua 500.
  Idem `mudar_modo` com modo fora de `manual|automatico|total`: virava cartão e estourava no JSON do Postgres; agora a
  validação do lote recusa. **Mudanças de comportamento em produção** (o critério 8 pedia nenhuma; suposição aceita e
  registrada aqui, revisão 7): (a) corpo `null`, byte nulo e `mudar_modo` inválido: de 500 para 400; (b) surrogate
  UTF-16 solto (meio emoji) em qualquer texto do corpo da pessoa (`lerCorpo` com `daPessoa`) e em qualquer campo de uma
  ação do lote (`validarLote`, que vale também para o `gerir_bots` do modelo): antes, numa coluna `text` passava e o
  Postgres gravava U+FFFD (2xx), e num `jsonb` dava 500; agora é 400 e o lote inteiro é recusado com o campo no motivo,
  para o modelo corrigir e chamar de novo. Escolhido recusar em todo campo, e não só nos que vão a `jsonb`, porque o
  mesmo texto troca de coluna com o tempo e o U+FFFD gravado em silêncio é dado corrompido. Gatilho de reversão: um
  cliente real (app, ponte) que mande surrogate solto de forma legítima.
- **Limites aceitos**: (1) o cookie de teste não é sessão de conta, então boa parte das rotas de conta responde
  403/429: mede que não quebram e que o handler responde, não o caminho feliz delas. (2) A "base plausível" sai do
  schema da ação, que nem sempre é o corpo que a rota exige (ex.: `bots.criar` sem `dono`): ela pode dar 400; a
  cobertura exige o handler, não 2xx. (3) A `tela.capturar` abre só a URL de loopback do próprio servidor; o bloqueio
  de rede do Chrome é por resolução de nome e pelo `Fetch` da página: não cobre UDP/DNS feitos por processos-filho do
  Chrome nem outro processo da máquina (por isso a flag fica desligada em produção). O `Fetch` vale só para a aba: o
  service worker (web/pwa.ts) é tirado do `navigator` antes do primeiro script; worker dedicado e iframe fora de
  processo continuam fora do filtro (hoje o app não usa worker, e o iframe de artefato tem CSP `default-src 'none'`).
  No modo compartilhado a flag é ignorada mesmo ligada (responde `indisponivel`). Um pedido que desiste na fila só sai
  dela na vez dele (pode gerar `CapturaOcupada` a mais; uma captura por vez, sem efeito no banco). (4) O `fuzz-noturno.yml` (N=200)
  só deixa o job vermelho: ainda não avisa ninguém. (5) O banco da outra pessoa é conferido depois de todo sucesso e a cada 25
  chamadas; a violação diz o intervalo de casos onde está o culpado. (6) O runner self-hosted não é efêmero: o cache do
  Playwright e o diretório de trabalho persistem entre jobs, então um PR malicioso poderia envenenar o Chromium usado
  pelos seguintes. Hoje o repo é privado e só o time abre PR; se ficar público ou aceitar fork, o job de captura passa a
  conferir o hash do Chromium ou vai para runner efêmero. Onde o AppArmor barra userns (ubuntu 24.04) o Chrome roda com
  `--no-sandbox`, só ali e só abrindo o próprio loopback. (7) O bot de QA confere cada passo duas vezes: pelas mesmas rotas que a tela usa e pela tela de verdade (o app no
  Chrome em 1440, com o print só depois de o DOM mostrar o esperado na barra lateral; um print por passo no relatório).
  Não clica a interface: prova a ação e o que a tela mostra, não o clique. (8) A sentinela de ponta a ponta (uma rota quebrada de propósito no servidor completo) não
  entrou: as sentinelas unitárias do executor, do veredito de decisão e da cobertura por rota usam o mesmo
  `executarFuzz` e os mesmos predicados do teste de conformidade. (9) A semente do PR sai do commit (`GITHUB_SHA`); o
  noturno sorteia a dele. Nenhuma resposta pode conter o nome ou a descrição do bot da outra pessoa (vazamento por leitura).
  (10) O fuzz roda em `tests/concurrency` (serial): grava linhas de verdade e, no fim, varre pelo catálogo toda tabela
  com `owner_id` das três pessoas e reprova se sobrar linha. A meta do PR é o fuzz (N=20) em menos de 90 s, somando
  só o `executarFuzz` dos dois servidores (sem boot nem o teste do invariante); o tempo de cada rodada vai ao resumo do
  job. O teto que reprova (`FUZZ_TETO_S=150`, só no job integration) tem folga para a fila da VM compartilhada, onde o
  relógio de parede mede a fila (AGENTS.md, "Teste sob carga"): pega a regressão grande, não a oscilação. O
  desktop-release roda o mesmo check sem teto. Medido em 2026-10-28: ~55 s no servidor
  padrão + ~22 s no compartilhado. Fora do CI a semente sai do HEAD local. Revisão 9, com os ids reais: ~84 s local (61 + 23). (11) O `daPessoa` do `lerCorpo` vale também nas rotas públicas de máquina (ponte, pareamento): todas recebem texto que vai ao banco. (12) Aceitos sem mudança: o QA mostra o print do passo da rotina na conversa, não numa tela de rotinas; a semente do PR é a do merge commit (`GITHUB_SHA`), então muda a cada push; o fuzz não exercita rate limit além do que as rotas de conta já respondem; o Chrome resolve só `127.0.0.1` fixo; a varredura das sobras lê o `information_schema` (tabela sem `owner_id` não entra; o retrato pega o resto). (13) Chegar ao handler conta para a cobertura de 100%, mas a ação que só recebeu 404 (não achou a entidade) ou 403 (guarda) não leu a entrada: o log de cada servidor lista essas ações (hoje ~34: cartões, decisões, salas, trabalhos, máquinas, voz, memória, incidentes, nuvem e SSH, cujas entidades o fuzz não semeia). Semear cada uma é a NOD-409; até lá a lista (`SO_404_403_ACEITAS`) é um teto (como ele reprova, ver os itens 16 e 17). A captura abre sempre `127.0.0.1`: com `NOD_HOST` fora do loopback (`hostServeLoopback`) o capturador não sobe e a rota responde 503. (14) O job integration da main já leva 17 a 21 min; o teto do job é 40 min (com 20 o job derrubava sozinho). Medido no runner (run 40796452653): o fuzz levou 122 s (78 + 44) e o job 26,7 min contra ~17,5 min da main na mesma janela (+77 s de `vite build`, +3 min no concurrency, o resto é carga do runner). **Suposição pendente da PM:** o critério 7 (≤ +2 min, fuzz < 90 s) está cumprido só localmente (~76–85 s); na CI vale o teto `FUZZ_TETO_S=150`. Gatilho de reversão: se a PM não aceitar, o servidor compartilhado vai só para o noturno (−45 s) e o build passa a usar cache. (15) Revisão 11: o 400 de corpo quebrado (`CORPOS_QUEBRADOS`) não conta como leitura da entrada; seis ações oscilam pela semente e ficam no teto até a NOD-409. `hostServeLoopback` não aceita mais `::1` nem `localhost` (a página abre em 127.0.0.1). (16) Revisão 12: o teto das ações só 404/403 oscila com a amostra (a semente do PR muda a cada push); no PR (N=20) ele só avisa no log, e reprova com N >= 100 (noturno). A guarda de host usa o host efetivo do listen (`o.host` do boot vence o env), loga `captura_tela_desligada_pelo_host` e tem teste de ponta a ponta (NOD_HOST=localhost → 503). (17) Revisões 13 a 16: as ações novas (fora de `ACOES_CONHECIDAS_NOD398`, a foto de 134 ações quando a NOD-398 entrou, travada por teste) que em nenhum dos dois servidores passaram de 404/403/401/429 reprovam já no PR delas; as que já existiam só avisam no PR e reprovam no noturno. A regra depende da amostra: uma ação nova que busca antes de validar pode oscilar, e um 400/409 antes da busca conta como leitura. Não contam como leitura 404/403/401/429 nem o 400 que o `lerCorpo` dá quando a rota pede o corpo, antes de ler qualquer campo (JSON inválido, `null` no topo, byte nulo ou surrogate solto num campo; corpo vazio e topo que não é objeto chegam à rota e o 400 dela conta, como qualquer outro status desses casos); 5xx já reprova como violação e não conta; a ação lida no servidor padrão não é fuzzada de novo no compartilhado (o acúmulo ajuda a que não chegou ao handler no primeiro). Ação nova que não dá para semear sai só por `ISENCOES_DE_ACOES_NOVAS`, com o id da issue que vai semeá-la (o teste exige `NOD-n` e uma ação do registro; vale no PR e no noturno; a trava é convenção que a revisão confere: nada confere se a issue existe); `SO_404_403_ACEITAS` só pode ter ações da foto, e a foto é travada por tamanho e hash. Fica aceito: a guarda de host olha o nome configurado, não o socket (`NOD_HOST=::` com `bindv6only=1` abriria 127.0.0.1 de outro serviço; configuração rara, flag desligada em produção). (18) O upload do artefato `qa-relatorio` não reprova o job (a cota de artefatos do repositório cheia derrubou a CI com todos os testes verdes); o teste do QA já reprova se não gravar o relatório, e ele vai também ao resumo do job.

## Emenda (NOD-415, ADR-141): `quadro.remover` arriscada sem cartão

`quadro.remover` é `arriscada` e não tem Desfazer, mas pelo chat sai sem cartão: o `gerir_quadro` não tem a fila de
cartões do `gerir_bots`. No lugar do cartão, três travas no servidor: o bot só remove o **próprio** quadro; só num turno
limpo em que a pessoa falou com ele (conversa ou ligação, profundidade 0, nada de fora); e com o nome dele em `bot`
(o bot tem de perguntar antes e repetir quem é). A tela confirma antes. Gatilho de reversão: um quadro removido sem a
pessoa querer → `quadro.remover` ganha cartão (ou lixeira com Desfazer).

### Emenda NOD-430 (2026-11-02): pelo chat, excluir o quadro vira cartão `quadro_exclusao`

A emenda acima (sem cartão) valeu enquanto o bot só removia o **próprio** quadro. Com a NOD-430 qualquer bot da pessoa
pode pedir para excluir o quadro de **outro** bot, e o caminho do chat passa a ser um cartão, como o `excluir_rotina`:

- **Quando o bot propõe:** só num turno da pessoa (conversa ou ligação, profundidade 0, sem procuração) e limpo
  (confiável e nada de fora entrou), com o nome do dono do quadro em `bot`. Tarefa, rotina, pedido de colega ou turno
  contaminado recebem a recusa e nada é proposto (`proporExclusaoDoQuadro`, `src/use-cases/quadro-exclusao.ts`).
- **Como sai:** o `remover_quadro` do `gerir_quadro` não apaga; abre o cartão `quadro_exclusao` (proposta + decisão,
  mesmo id) na conversa e na Sua vez (Excluir / Agora não). Um segundo pedido para o mesmo quadro, com o cartão ainda
  pendente, reaproveita o cartão; remover o quadro (pela tela ou pelo cartão) fecha os pendentes dele.
- **Revisão obsoleta:** o cartão guarda a impressão do quadro (ids das tarefas e último lote). Na decisão, com o quadro
  travado, se ele mudou ou sumiu o cartão fecha como recusado e a rota responde 409 (o molde da NOD-159), sem apagar.
- **Modo automático (ou total):** confirma na hora pelo modo (`arriscada: true`, só porque a pessoa pediu agora na
  conversa) e o resultado volta com `aplicada: true`.
- **Quem fica registrado:** remover o quadro não gera lote (`lote: null`), e os lotes do quadro saem junto com ele
  (`ON DELETE CASCADE`); não há Atividade para mostrar quem removeu. O registro é o evento `quadro_mudou` com
  `removido: true` (autoria: a pessoa quando ela clica Excluir; o bot quando o modo confirma, ADR-042: a regra não vira
  ato da pessoa) e a decisão do cartão (`confirmada` pela pessoa ou fechada pela regra do modo).

A tela continua removendo direto (aba Quadro → Remover quadro, com confirmação). O gatilho de reversão da emenda
NOD-415 está cumprido pelo cartão.

## Emenda (NOD-416, ADR-144): `quadro.mover_tarefa` muda sem cartão e sem Desfazer

`quadro.mover_tarefa` é `muda`, mas não tem Desfazer (voltar é mover de novo) nem cartão: vai sozinho no lote. No lugar
do Desfazer, duas travas no servidor quando o autor é um bot: só num turno limpo, em que nada de fora entrou
(`origemConfiavel`, ADR-062), como o Desfazer e as colunas; e não no fim da corrente de bots (`podeRepassar`, ADR-063).
A rota confere que a tarefa está no quadro do `:id` e não aceita como destino o quadro de um bot excluído. A tela pede
a escolha do quadro e o botão "Mover" (sem agir no `change`). Gatilho de reversão: uma tarefa movida sem a pessoa
querer → o mover vira lote com Desfazer (ou ganha cartão).

## Emenda (NOD-437): os times de bots pelo chat

As ações `times.*` (criar, renomear, ordenar, recolher) e o `bots.mover` em lote são `muda` e, pelo `gerir_times` de
qualquer bot, rodam direto em todo modo, sem card: só reorganizam a barra da própria pessoa, nenhum bot some e tudo se
desfaz pela tela ou pedindo de novo. As cercas no servidor: turno de conversa ou criação, profundidade 0, sem procuração
de colega, não parado e limpo (nada de fora). `times.excluir` é `arriscada`: com bots, vira card (o lote dos bots, tipo
`excluir_time`) no manual e no automático e roda direto só no "Ignorar todas as aprovações" (`decidirPeloModo`, sem
revisor na v1); time vazio sai direto. Gatilho de reversão: um time excluído ou reorganizado por um bot sem a pessoa
querer → as `times.*` passam a seguir o modo (card no manual).
