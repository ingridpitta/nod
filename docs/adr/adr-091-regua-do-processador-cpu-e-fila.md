# ADR-091 — A régua do processador em duas: o uso da CPU e a fila

**Status** aceito · decidido pelo Marlon em 2026-10-09 (opção C, entre quatro apresentadas na conversa) e implementado
no mesmo dia. Os limiares abaixo são uma proposta inicial: o Marlon calibra com o log `mac_leitura`.

Emenda a ADR-085 (o processador do "uso do Mac"). Não muda a memória nem o disco (#219).

## Contexto

A ADR-085 media o processador pelo `vm.loadavg`: a carga média do último minuto, dividida pelos núcleos. A partir de
1,0 por núcleo, a tela dizia "Processador cheio" e, no "Equilibrado", o trabalho novo em segundo plano esperava.

O `loadavg` do macOS conta quem usa um núcleo, quem espera a vez e também quem está parado esperando o disco. Em
09/10, às 06:22, o Mac do Marlon marcava 36 de carga em 12 núcleos (3,0 por núcleo), e a tela dizia "Processador cheio".
Só que a soma do `%CPU` dava menos de 9 núcleos ocupados. O resto era a fila do disco: um `du` em ~250 GB num disco
quase cheio, com o `fseventsd` e o Armazenamento do sistema. Segurar os 5 trabalhos foi provavelmente a decisão certa
(cada task nova cria worktree e `node_modules`, e isso é mais disco), mas o motivo e o rótulo estavam errados.

O Marlon escolheu, entre quatro opções (A: deixar como está; B: trocar pela CPU; C: as duas, cada uma com seu nome; D:
só renomear), a C.

## Decisão

1. **Processador = uso da CPU.** É a fração do tempo em que os núcleos trabalharam desde a amostra anterior, a cada
   ~30 s, por `os.cpus()` (sem processo novo; vale também no motor Linux da ADR-090). É o "% de CPU" do Monitor de
   Atividade. Amarela a partir de **70%**, vermelha a partir de **90%**. Para sair do nível, 5 pontos abaixo
   (histerese, porque a fração oscila mais que o `loadavg`). A primeira amostra mede por 1 s. Uma amostra fora da
   batida (quando um turno novo começa) com menos de 10 s desde a última reaproveita o valor anterior.
2. **Fila = a carga por núcleo de antes, com limiares altos.** Amarela a partir de **1,5**, vermelha a partir de
   **2,0**. Com os núcleos cheios ela fica perto de 1; acima de 2 há mais processos esperando a vez do que núcleos para
   atendê-los, quase sempre por causa do disco.
3. **O portão olha o pior dos dois.** `portaoDoMac` e `deveSegurar` não mudam: recebem `processador = pior(CPU, fila)`.
   O motivo continua `processador` ("esperando o Mac aliviar"). O caso de 09/10 (CPU 75%, fila 3,0) segura como antes.
4. **Os níveis se recalculam no servidor.** O app manda os números crus (`processador.uso` e `processador.carga`) e um
   `nivel`, que é o pior dos dois (é o que um servidor anterior lê). O servidor recalcula com as constantes de
   `src/domain/memoria-mac.ts` (`niveisDoProcessador`). Calibrar não pede app novo. A leitura de um app anterior (sem
   `uso`) vale como na ADR-085: o nível mandado é o do processador, e não há fila.
5. **A tela.** Em Este Mac, a barra "Processador" passa a ser o uso da CPU, com o porquê atrás do clique ("os núcleos
   passaram 75% do tempo ocupados"). A linha "Fila" só aparece quando aperta ("crescendo", "engarrafada"), com o
   porquê atrás do clique. Com Este Mac aberta, os números são relidos a cada 30 s, porque só a mudança de nível vira
   frame.
6. **Medir.** O log `mac_leitura` sai a cada 5 min por Mac, com `uso`, `carga`, os níveis e o disco livre. O
   `fundo_segurado` / `fundo_solto` passa a levar `uso_cpu` e `carga`.
7. **Simular.** `NOD_SIMULAR_PROCESSADOR` passa a ser o uso da CPU (0 a 1; acima de 1 vale 1, então o "1.2" antigo
   continua sendo "cheio"). `NOD_SIMULAR_FILA` é a carga por núcleo.

## Junto: a leitura que sumia da tela (bug, 09/10)

O Marlon relatou que a leitura "às vezes não aparece na tela ou demora muito para aparecer". Havia duas causas.

- **Duas pessoas, um Mac.** No modo local, o servidor roda um laço por pessoa conectada na mesma máquina (no diário, o
  Marlon e a Ana). O `trabalhosVivos` guardava uma leitura por Mac, com o dono de quem puxou por último. Metade do
  tempo, a tela do Marlon dizia "O Mac ainda não mandou leitura" e "sem leitura de memória". O log mostrava o
  `fundo_segurado`/`fundo_solto` alternando entre as duas pessoas no mesmo `machine_id`. Agora a leitura é do Mac, e o
  Mac guarda quem o usa (cada pessoa com a hora do último envio, que vale 2 min). O estado do log de segurar passa a
  ser por Mac e pessoa.
- **A primeira leitura não avisava a tela.** "O primeiro verde não vira frame": a tela aberta antes da primeira
  leitura (logo depois de o servidor subir) ficava em "ainda não mandou leitura" até o nível mudar. Agora a primeira
  leitura de uma pessoa (no boot, ou depois de 2 min sem nenhuma) sempre vira o frame `memoria.mudou`.

## Alternativas rejeitadas

- **A — deixar como está:** o rótulo mente e o número mistura duas coisas, o que torna a calibração impossível.
- **B — só a CPU:** perde o disco engarrafado, que foi o que motivou a ADR-085 (o `grep -r` de 2 h sobre `~/nod`). Em
  09/10 ela soltaria 5 trabalhos em cima de um disco sufocado. E a porcentagem trava em 100%: não distingue "12 núcleos
  cheios" de "12 cheios e 200 na fila".
- **D — só renomear:** barato e honesto, mas não diz se o peso vem do processador ou do disco.

## Gatilho de reversão

- `mac_leitura` com `fila` vermelha e `uso` abaixo de 50% por mais de uma hora num dia normal (sem `du` nem varredura
  manual): a fila está segurando à toa; subir `FILA_VERMELHA`.
- `fundo_segurado` com `motivo: processador` mais de 2 h por dia em `equilibrado`, com o Marlon dizendo que o Mac
  estava bem: subir `USO_CPU_VERMELHO` ou a histerese.
- O Mac lento sem nenhum `fundo_segurado` no período: baixar os limiares.

Como voltar atrás: as constantes `USO_CPU_*` e `FILA_*` em `src/domain/memoria-mac.ts`. Para voltar à régua única,
`niveisDoProcessador` pode devolver o nível da ADR-085 (`nivelDoProcessador`, que continua no domínio) para o portão.
