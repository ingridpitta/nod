# ADR-085 — Uso do Mac: o Mac apertado segura trabalho novo em segundo plano

> Emendada pela [ADR-163](adr-163-tarefa-do-quadro-e-trabalho.md): a tarefa do quadro roda num trabalho próprio (origem `quadro`), sem teto próprio (o freio é o portão de recursos desta ADR-085) e fora dos bastidores.

Status: aceito · Data: 2026-10-08 · emenda 2026-10-09 (memória crítica e disco, #219) · emenda 2026-10-09 (a tela fala por máquina, abaixo) · emenda 2026-10-12 (o motivo "cota", ADR-099 §7, abaixo) · o processador do item 1 foi
emendado pela [ADR-091](adr-091-regua-do-processador-cpu-e-fila.md) (uso da CPU e fila, 2026-10-09) · Emenda a [ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) §4 ("sem teto:
o limite é a máquina"). Decisão do Marlon em 2026-10-08: o caminho "sem teto, sem desperdício", aprovado no protótipo
"Nod — Ritmo do Mac" (canvas VmT4WwEbgfZ14PbLy4En8d, pranchas 1–3).

## Contexto

Em 06/10 o diário rodou 8 bots ao mesmo tempo e o Mac chegou a carga 265 em 12 núcleos (22 por núcleo). Medido no
diário, 7 dias até 08/10: nos minutos com algum turno, o p50 é 3 turnos ao mesmo tempo, o p90 é 7 e o máximo é 23.
Cada `claude -p` ocupa ~300 MB; quem derruba o Mac são os comandos que os bots disparam (baterias de teste, um `grep -r`
de 2 h sobre `~/nod`, que tem 109 GB), e isso é processador, que a ADR-083 não mede.

A ADR-083 rejeitou um teto de trabalhos ("a máquina varia de 8 a 36 GB; um teto de 8 travaria o pico de 25") e ficou com
a pressão de memória do macOS, que só avisa e fecha quem espera a pessoa. O Marlon pediu um controle em Configurações e
escolheu, entre teto fixo e "sem teto, sem desperdício", o segundo: nada de número de bots; a pessoa diz quanto do Mac
eles podem usar, e o Mac apertado segura o que ainda não começou.

## Decisão

1. **Processador.** O amostrador da ADR-083 (`src/adapters/executor/amostrador-memoria.ts`) também lê `vm.loadavg` a
   cada 30 s: a carga do último minuto por núcleo vira nível (`nivelDoProcessador`, `src/domain/memoria-mac.ts`) —
   amarela a partir de 0,7, vermelha a partir de 1,0. `LeituraMemoria.processador` é opcional: app anterior não manda.
   `NOD_SIMULAR_PROCESSADOR` (carga por núcleo) força a leitura em testes e UAT.
2. **A leitura vai no `puxar`.** Antes ela só ia na renovação, ou seja, só com turno rodando; um Mac parado não tinha
   leitura e o servidor não saberia que ele está apertado pelo que a pessoa faz nele. Agora o laço manda
   `daMaquina()` em todo `puxar` (`PonteInterna.puxar(pessoaId, maquina?)`), e o servidor a guarda por Mac em
   `trabalhosVivos` (`daMaquina`), como a da renovação.
3. **Uso do Mac** (`preferencias.uso_do_mac`, 0064; Seu espaço › Este Mac): `pouco` | `equilibrado` (padrão) | `livre`.
   `deveSegurar` decide pelo Mac que pede: `livre` nunca segura; `equilibrado` segura com a memória em alerta (amarela)
   ou o processador cheio (vermelha); `pouco` também com o processador começando a apertar (amarela). Sem leitura, nada
   é segurado.
4. **O que espera.** No `reivindicar`, com o Mac apertado, só **trabalho novo em segundo plano** fica `pendente`: turno
   de trabalho de origem `rotina` ou `colega` com `iniciado_em` nulo e sem ninguém esperando (`seguravelPeloMac`,
   `src/domain/memoria-mac.ts`). Conversa, ligação, task aberta pela pessoa e continuação de trabalho já começado seguem.
   Nada que roda é interrompido. Revisão do PR #209:
   - **Quem a pessoa espera não é segurado** (`trabalhos.pessoa_esperando`, 0064): "Executar agora" e "Permitir e rodar
     agora" numa rotina, e o pedido a colega feito num turno de conversa, sala ou ligação (fora de task).
   - **Espera máxima de 1 h** (`ESPERA_MAXIMA_FUNDO_MS`). Depois ele roda mesmo com o Mac apertado: rotina que nunca
     roda e pedido de colega que nunca volta (o colega que pediu fica esperando sem aviso, o sintoma da ADR-084) são
     piores que um Mac lento por alguns minutos.
   - **Um de cada vez** (`ESPACO_FUNDO_MS`, 30 s): logo depois de um trabalho novo em segundo plano começar num Mac, o
     próximo daquele Mac espera 30 s, mesmo com o Mac folgado e mesmo o que passou da espera máxima. A leitura é de até
     30 s atrás e a carga é a média do último minuto: sem o espaço, quando o Mac alivia, tudo o que esperava começa na
     mesma leitura verde e o pico de 06/10 volta. Vale para `pouco` e `equilibrado`; `livre` e Mac sem leitura não
     espaçam.
5. **Tela.** `TrabalhosDto` ganha `processador`, `cargaProcessador` e `segurando` (pelo pior Mac da pessoa: com dois
   Macs, um apertado já diz "ocupado", embora o puxar decida por Mac), e cada trabalho ganha `seguravel` (a regra do
   item 4, calculada no servidor). A mudança só do processador também vira o frame `memoria.mudou`. A linha do trabalho segurado diz "esperando o Mac aliviar"; "Todos os trabalhos" mostra a pílula "Seu Mac
   está ocupado" (a de memória, quando existe, fica sozinha); Seu espaço › Este Mac mostra o resumo, as barras de
   memória e processador, quem trabalha (com a memória) e quem espera, e o seletor do uso.
6. **Memória por trabalho.** A memória de um trabalho só aparece com turno vivo. Antes a última leitura ficava gravada
   e "Todos os trabalhos" somava 18 × 200–400 MB de tasks sem processo, enquanto o topo dizia 606 MB.

7. **Robustez da leitura** (revisão do #209). No `puxar` HTTP, a leitura entra uma vez por pedido (repetida a cada
   250 ms durante a espera de 20 s ela passava por cima da mais nova da renovação); leitura com defeito vira "sem
   leitura", nunca 400; processador fora do formato é ignorado, não a leitura toda. O "uso do Mac" é lido fora da
   transação do puxar e guardado por 30 s (`USO_VALE_MS`); um erro na leitura usa o último valor ou o padrão. O evento
   de pressão que não foi gravado (a transação desfez) volta o "visto", e a próxima leitura o refaz. A leitura do Mac
   que desconectou sai na hora, e a vencida sai na próxima leitura. Fora do macOS (sem `NOD_SIMULAR_*`) o amostrador
   não produz leitura da máquina.
8. **Medir.** Logs `fundo_segurado` / `fundo_solto` (na mudança, por Mac, com o uso e os níveis) e `fundo_comecou`
   (cada trabalho novo em segundo plano que começa, com `espera_ms`). No banco, `iniciado_em - criado_em` dos trabalhos
   `rotina`/`colega` dá a espera de cada um.

## Alternativas rejeitadas

- **Teto fixo de bots ("Ritmo": Leve 2, Equilibrado 4, Livre).** Prototipado e descartado pelo Marlon em 08/10: trava
  quando muita coisa chega junto, e o número certo depende do Mac. O motivo da ADR-083 continua.
- **Limite de memória em GB.** Técnico demais para a pessoa e chega tarde: não dá para tirar memória de quem já roda.
- **Segurar também a task da pessoa.** Ela pediu e está esperando; a regra da conversa vale para ela.
- **Segurar sem prazo.** Rejeitado na revisão do #209: o trabalho segurado não aparecia em lugar nenhum além da linha
  "esperando o Mac aliviar", e uma rotina das 9 h podia não rodar no dia.
- **Soltar tudo na primeira leitura verde.** Rejeitado na revisão do #209 (o "um de cada vez" do item 4).

## Limitação conhecida

A task que um bot abre com `abrir_task` numa conversa nasce com origem `pessoa` e não é segurada, mesmo quando o bot
coordenador abre várias de uma vez. Separar "a pessoa pediu" de "o bot decidiu abrir" pede marcar quem pediu em cada
`abrir_task`; fica para quando os logs `fundo_*` mostrarem picos vindos daí.

## Não implementado (segue em PRs próprios)

- "Esperando fora do Mac": mostrar a espera por colega (que já não ocupa processo) como "esperando X", e "me chame às
  16:00".
- Comando longo fora do Mac: o bot dispara a bateria de testes pelo Nod, sai do Mac e volta quando ela termina.

## Gatilho de reversão

- `fundo_comecou` com `espera_ms` na espera máxima (1 h) mais de uma vez por semana, com o Mac em `equilibrado`: rever
  os limiares de carga (0,7 e 1,0) ou o que conta como "segundo plano".
- Pressão vermelha de memória mais de um dia por semana em algum Mac, mesmo com o uso em `pouco`: reabrir o teto.

## Emenda de 2026-10-09 — memória crítica e disco no mesmo portão (#219, épico #221)

Em 09/10 o Mac do Marlon (16 GB, 466 GB) ficou inutilizável com o Nod rodando: swap em 5,4 de 6 GB, disco do usuário
em 97% (17 GB livres) e load ~430. O portão acima olha o processador e a memória em alerta, trata a memória crítica como
a de alerta e não olha o disco. Cada task nova cria worktree, `node_modules` e banco de teste; cada `claude -p` usa
~210–270 MB. Os limiares e o que cada nível segura foram decididos pelo coordenador do épico #221 em 09/10, na ausência
do Marlon, que autorizou merge e deploy (ver "Como voltar atrás").

1. **Disco na leitura.** O amostrador lê o espaço do volume de `~/nod` (o da casa, antes de a pasta existir) com
   `statfs`, sem processo novo, a cada 30 s: `LeituraMemoria.disco = { livreMb, totalMb }`, livre = `bavail`. Vai no
   `puxar` e na renovação, como o processador. É opcional: app anterior não manda a chave; o app novo que não conseguiu
   medir manda `null` (Este Mac diz "sem leitura", e não "atualize o app"); leitura fora do formato é ignorada sozinha
   (`discoValido`, ponte-validacao.ts). Fora do macOS não há leitura da máquina (item 7), então nada é medido
   nem segurado. `NOD_SIMULAR_DISCO` ("8" = 8 GB livres de 500; "17/466") força a leitura em testes e UAT. O número da
   amostra só sobe quando o disco muda de nível, não a cada MB gravado.
   O número é o livre que o macOS informa aos apps (`statfs`). Ele pode ser um pouco menor que o do Finder, que soma o
   espaço "purgável" que o sistema libera sozinho; Este Mac diz isso no detalhe.
2. **Dois limites absolutos de disco, num lugar só** (`DISCO_ALERTA_MB` = 10 GB, `DISCO_CRITICO_MB` = 3 GB,
   `nivelDoDisco`, src/domain/memoria-mac.ts). Sem regra percentual: 5% de 466 GB (23 GB) seguraria um disco grande
   com folga de sobra. A tela recebe o nível e os dois limites do servidor (`DiscoDoMac`), nunca os repete.
   **Histerese** (revisão do #224): o disco sai do crítico só acima de 3,5 GB (`DISCO_SAI_CRITICO_MB`) e do alerta só
   acima de 11 GB (`DISCO_SAI_ALERTA_MB`). O servidor guarda o nível anterior de cada Mac (trabalhos-vivos.ts) e o
   amostrador usa a mesma regra. Sem isso, um disco parado perto do limite trocaria de nível a cada 30 s, e a pílula e o
   frame piscariam junto.
3. **O que cada nível segura** (`portaoDoMac`), pela leitura de um Mac:

   | Leitura | Pouco / Equilibrado | O quanto precisar |
   |---|---|---|
   | Disco crítico (< 3 GB) | nada novo começa | nada novo começa |
   | Memória crítica | segundo plano novo, **sem** a espera máxima de 1 h | nada espera |
   | Disco em alerta (< 10 GB) | segundo plano, com a espera máxima | nada espera |
   | Memória em alerta / processador | como antes (`deveSegurar`) | nada espera |

   - "Segundo plano" é o de antes (`seguravelPeloMac`): rotina e pedido de colega que ainda não começaram. O pedido
     explícito da pessoa ("Executar agora", task pedida na conversa) passa, inclusive com a memória crítica.
   - "Nada novo começa" (`segurarNovo` no `reivindicar`) só entrega turno de trabalho com `iniciado_em` preenchido e sem
     `acordar_em`. Vale para a task da pessoa, o "Executar agora", o que passou da espera máxima e a volta marcada. É a
     única trava que vale em "O quanto precisar": sem espaço, commit, npm e Postgres falham no meio, em qualquer
     escolha.
   - "Sem a espera máxima" (`fundoSemPrazo`): com a memória crítica, o segundo plano novo que já espera há mais de 1 h
     continua esperando, em vez de rodar mesmo assim.
   - **Volta marcada** (revisão do #224, decisão do coordenador do #221): a volta ("me chame às 16:00", ADR-086) de uma
     task já começada é o próximo passo de algo que já começou. Só o disco crítico a segura. Memória em alerta ou
     crítica, disco em alerta, processador e o espaço entre dois começos não a seguram mais; isso revoga a revisão do
     #212, em que ela seguia as regras do Mac apertado. Quando o disco crítico a segura, `esperaDoMac` dá o motivo, e a
     linha diz "esperando espaço no disco" em vez de "volta às 16:00" já passado.
   - Conversa, ligação e o turno seguinte de uma task que já começou nunca esperam. Nada que roda é morto ou pausado.
   - O Mac do Marlon de 09/10 (17 GB livres) não seguraria nada pelo disco.
4. **Sem espera máxima no disco crítico.** O item 4 rejeitou "segurar sem prazo" porque a espera não aparecia em lugar
   nenhum; agora ela aparece na linha da task, na pílula e em Este Mac, com o motivo. Rotina não empilha enquanto espera
   (a execução seguinte é `pulada` com a anterior aberta, ADR-045).
5. **Motivo visível** (frase base "esperando…" do #208). `GET trabalhos` ganha `motivoEspera` (`processador`, `memoria`
   ou `disco`, pela gravidade: disco crítico, memória crítica, disco em alerta, memória em alerta, processador),
   `seguraTudoNovo` e `disco` (o pior Mac: o de menos espaço livre). Cada trabalho segurado ganha `esperaDoMac`
   (`esperaDoMac` do domínio, a mesma regra do `reivindicar`). A linha diz "esperando o Mac liberar memória",
   "esperando espaço no disco" ou, pelo processador, "esperando o Mac aliviar". `segurando` continua (o pior Mac segura
   algo). O disco mudar de nível também vira o frame `memoria.mudou` (`disco` no evento).
6. **Uma pílula só, sem modal.** Com o disco segurando, a pílula "Pouco espaço no disco · N trabalhos esperam espaço no
   disco · Ver ›" (para Este Mac) toma o lugar da de memória em "Todos os trabalhos". No chat, embaixo da última task
   aberta, ela só aparece com o disco crítico, quando a task da pessoa também espera. Sem disco segurando, fica a de
   memória (quando há) ou "Seu Mac está ocupado", como antes. O menu da conta diz "Disco quase cheio" ao lado de Este
   Mac.
7. **Este Mac** mostra memória, processador e disco em barras, com o status curto à vista ("crítica", "8,4 GB livres") e
   o porquê atrás de um clique (`<details>`): o que o macOS disse e o que espera por isso, pelo uso escolhido; o livre,
   o total e os dois limites do disco, que o número pode ser um pouco menor que o do Finder, e onde ficam as pastas dos
   bots. A barra não some no hover da linha. O grupo de quem espera leva o motivo ("Esperando
   espaço no disco · 2").
8. **Medir.** `fundo_segurado` / `fundo_solto` saem também na troca de motivo, com `motivo`, `tudo_novo`, `sem_prazo` e
   `disco_livre_mb`. A espera de cada trabalho continua em `iniciado_em - criado_em`.

Fora desta emenda:
- o swap em Este Mac (a issue cita; pede `vm.swapusage` a cada 30 s e mais um campo na leitura);
- a memória e o disco usados só pelos bots (o disco de `~/nod` pede `du`, caro em 254 GB; fica com a limpeza das tasks,
  #216);
- um botão de limpeza em Este Mac;
- ler o livre "para uso importante" do macOS (`NSURLVolumeAvailableCapacityForImportantUsageKey`, que conta o purgável
  como o Finder), em vez do `statfs`: pede código nativo no app (follow-up).

Como voltar atrás (as escolhas que o Marlon não viu), cada uma em `portaoDoMac` e nas constantes ao lado dele:
- **Limites:** mudar `DISCO_ALERTA_MB` / `DISCO_CRITICO_MB`, e a histerese em `DISCO_SAI_*_MB`.
- **Disco crítico também em "O quanto precisar":** mover a linha do disco vermelho para depois de `if (uso === "livre")`.
- **Memória crítica:**
  - segurar também o pedido da pessoa: devolver `tudoNovo: "memoria"`;
  - manter a espera máxima: `semPrazo: false`;
- **Volta marcada de novo sob as regras do Mac apertado (#212):** devolver a cláusula de `acordar_em` com
  `segurarFundo`/`espacarFundo` no `reivindicar` (git log desta emenda) e o `fundo` em `esperaDoMac`.

Gatilho de reversão:
- `fundo_segurado` com `tudo_novo` por mais de um dia seguido em Macs com a limpeza das tasks (#216) já no ar: rever
  `DISCO_CRITICO_MB` ou o APFS (`bavail` não conta o espaço "purgável" que o Finder mostra como disponível).
- `fundo_comecou` de rotina com `espera_ms` acima de 1 h sob memória crítica mais de uma vez por semana: rever o
  `semPrazo`.

## Emenda de 2026-10-09 — a tela fala por máquina

Em 09/10 o diário tinha os 16 bots presos à VM `nod-motor-teste` (ADR-090/092, 2 núcleos). A VM estava cheia (CPU em
100%, 2,8 a 3,9 processos por núcleo, medido nela) e o Mac estava folgado (0,42). A tela dizia "Seu Mac está ocupado ·
4 trabalhos esperam o Mac aliviar" e "os bots usam 1,1 GB do seu Mac". O `puxar` já decidia certo: cada máquina puxa com
a própria leitura (item 4), e o `reivindicar` só entrega a ela o turno que tem ela como alvo. O erro era o item 5, que
juntava as máquinas "pelo pior Mac" e chamava a junta de "Mac".

1. **Cada trabalho espera pela máquina dele.** `GET trabalhos` calcula o portão de cada máquina viva da pessoa e, para
   cada trabalho aberto, a máquina dele: a do turno vivo (`turnos.machine_id`) ou o alvo do turno na fila, pela regra do
   `reivindicar` (o "desta vez", a máquina do bot e o padrão da pessoa, cada um só com a chave viva). A regra do alvo
   mora num lugar só (`alvoDoTurno`, src/repositories/alvo-da-maquina.ts), usado pelo `reivindicar` e pela lista. Sem
   alvo, no modo local, o Mac do servidor (ADR-092); no compartilhado, qualquer uma, e o trabalho só espera se todas as
   máquinas com leitura o seguram (`esperaNaMaquina`, src/domain/memoria-mac.ts). Sem leitura da máquina dele, nada
   espera, mesmo com outra cheia.
2. **O DTO.** Cada trabalho aberto ganha `maquina` (id, nome, se é Mac) e `esperaDoMac` sempre presente (null = não
   espera). `TrabalhosDto.maquinas` traz cada máquina com a leitura, a memória dos bots nela e o que o portão dela segura.
   Os campos de topo (`pressao`, `processador`, `segurando`, `motivoEspera`, `disco`…) continuam pelo pior, para quem
   lê o formato de antes. A web nova não os usa para o texto. A mudança de nível de UMA máquina também vira o frame
   `memoria.mudou`, mesmo quando a pior não muda.
3. **A tela.** A linha diz "esperando nod-motor-teste aliviar", "esperando nod-motor-teste liberar memória" ou "esperando
   espaço no disco em nod-motor-teste". Para o Mac, as frases de antes. A pílula nomeia quem segura: só o Mac, "Seu Mac
   está ocupado" (o "Ver" leva a Este Mac); só a VM, "nod-motor-teste está ocupada · 4 trabalhos esperam ela aliviar" (o
   "Ver" leva a Máquinas); as duas, "2 máquinas ocupadas". O topo diz "os bots usam 400 MB do seu Mac e 700 MB na
   nod-motor-teste". Este Mac mostra só a leitura e os trabalhos do Mac, e uma linha diz que o uso escolhido vale também
   para as outras máquinas. Em Máquinas, o cartão de cada máquina conectada ganha o status curto ("Ocupada · 2 trabalhos
   esperam ela aliviar") e os números atrás do clique. A pílula de memória ("Pouca memória no seu Mac") é só do Mac.
4. **O "uso do Mac" continua um só por pessoa** e vale para todas as máquinas. O uso por máquina fica para quando o
   Marlon decidir.

Gatilho de reversão: se um trabalho aparecer "esperando <máquina>" e a mesma máquina o entregar no `puxar` seguinte
(log `fundo_comecou` com a máquina do trabalho logo depois de a tela dizer que ele esperava, sem a leitura ter mudado),
a regra da tela e a do `reivindicar` divergiram: voltar a ler `alvoDoTurno` nos dois lados antes de mexer no texto.

## Emenda de 2026-10-12 — o motivo "cota" (ADR-099 §7)

A [ADR-099](adr-099-um-dono-por-bot.md) §7 pôs a cota da IA ao lado da máquina como limite do trabalho. Decisão do Marlon
em 12/10: com 99% da cota usada, na janela de 5 h ou na semana, o que vier primeiro, trabalho novo de fundo para de
nascer, e 1% fica para a conversa com a pessoa. Quando o provedor dá o sinal de limite, o trabalho espera a janela abrir
em vez de falhar.

1. **A leitura.** É a que o próprio CLI manda a cada turno: o `rate_limit_event` do Claude Code, gravado em
   `uso_do_plano` (NOD-179). Ela traz `utilization` de 0 a 1 e o `resetsAt` de cada janela. A outra fonte é o limite que
   o turno devolveu (`preferencias.ias_no_limite`, 0068). Não há migração nova. A regra pura é `cotaDasIas`
   (src/domain/cota-da-ia.ts):
   - **reserva**: uma janela em 99% ou mais que ainda não renovou;
   - **limite**: uma janela em 100%, o limite gravado pelo turno, ou a última leitura "esgotado" há menos de 1 h;
   - uma janela já renovada não segura nada; uma janela sem horário de renovação vale 1 h desde a leitura.
2. **O portão, por IA.** O `reivindicar` ganha o motivo "cota", ao lado da memória, do processador e do disco:
   - com a IA do turno na reserva, espera o fundo **novo**: a task (frente) que nunca rodou, de qualquer origem, inclusive
     a aberta pela pessoa, e o turno de rotina ou de pedido de colega sem task;
   - com a IA no limite, espera **todo** o fundo: também o próximo turno de uma task já começada e a volta marcada;
   - a conversa com a pessoa nunca espera: o turno de conversa, de sala, a retomada que ela pediu e a ligação.

   A IA do turno é a fixada; no Automático, o turno só espera se todas as IAs que podem pegá-lo na máquina seguram, e o
   plano do turno de fundo pula a IA segurada (`noLimite`). A regra está uma vez em SQL e uma vez em
   `tipoParaCota`/`cotaSegura`; tests/integration/cota-da-ia.test.ts confere as duas turno a turno.
3. **Volta sozinha.** A task que bate no limite no meio do turno, sem outra IA para trocar, não vai para "não terminou".
   Nasce a retomada da mesma task com `acordar_em` na renovação, e a task ganha a linha "A cota do Claude Code chegou ao
   limite. Esta task espera e volta sozinha às 14:30, de onde parou." (`aposLimiteNoFundo`, assentar-turno.ts). A
   conversa com a pessoa continua com o aviso de sempre (ADR-036, NOD-171).
4. **A tela.** `GET trabalhos` traz `cota` (situação, IAs e quando o fundo volta), e cada task segurada traz
   `esperaDaCota`. A pílula de Trabalhos diz "A cota da IA está no fim · 2 esperam · trabalho de fundo volta às 17:30 · a
   conversa com você segue". A linha da task diz "esperando a cota da IA". No Automático a tela aproxima pelas IAs que a
   pessoa já usou, porque a lista não conhece as IAs prontas da máquina.
5. **O log.** `cota_segura` / `cota_solta` saem na mudança, por pessoa, e `cota_limite_task_espera` sai quando uma task
   passa a esperar a renovação.

Limite: o Codex não tem leitura de porcentagem no Nod. O app-server dele emite `account/rateLimits/updated`, mas isso não
foi homologado no CLI real. Para ele vale só o sinal de limite, com prazo de 1 h sem horário. A reserva de 1% garante
alguns turnos de conversa, não trabalho longo. O próximo turno da task já começada ainda pode gastar a reserva até o
limite: só o fundo novo para na reserva, por decisão do Marlon.

Gatilho de reversão: a conversa com a pessoa receber "limite atingido" mais de uma vez por semana com o portão no ar
(log `ia_no_limite` de turno de conversa logo depois de `cota_segura` com reserva). Nesse caso, a reserva ficou pequena
para o que segue rodando, e o caminho é segurar também o fundo que já começou na reserva, não aumentar o 1%.

## Emenda de 2026-10-22 — as telas do computador entram pela mesma régua (ADR-122, NOD-96)

Abrir a tela de um bot no computador da pessoa ([ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md)) é
trabalho novo na máquina e passa pelo mesmo `deveSegurar(uso, memória, processador, regra)`, com a leitura local do
motor e o modo de uso da pessoa. Se segura, o supervisor fecha a tela ociosa mais antiga e reavalia; sem ociosa, a tela
fica em `esperando` (fila por ordem de chegada) e a ferramenta espera no turno. Em Livre nunca segura. Não há número
fixo de telas.

## Emenda de 2026-10-26 — a memória do Mac só com trabalho rodando nele (NOD-372)

O Marlon via "Pouca memória no seu Mac · 3 trabalhos abertos" com tudo rodando na nod-motor-teste. Com as máquinas no
DTO, a pílula de memória (amarela e vermelha) só aparece com ≥ 1 trabalho `rodando`, fora de espera e numa máquina que é
Mac (`rodandoNoMac`, web/lib/trabalhos.ts), e conta só esses: "· 2 rodando aqui". Vale no topo de Trabalhos, no topo da
linha do dono, na "Abriu a task", na pílula do bot e na linha "Agora" da Atividade (ADR-114). O "Seu Mac está ocupado"
por memória, sem nada rodando no Mac nem esperando por ele, também sai do topo (`maquinasDoAviso`): senão ele tomaria o
lugar da pílula que sumiu. O disco que segura tudo e as outras pílulas das máquinas seguem como antes. O servidor
anterior, sem `maquinas`, segue com "N trabalhos abertos".

Gatilho de reversão: se a pessoa travar o Mac por memória sem aviso do nod com um trabalho dele de fato rodando no Mac
(o `maquina` do DTO veio de outra máquina ou null), a regra leu o dado errado: corrigir o `ondeRoda`, não voltar a contar
todos os abertos.
