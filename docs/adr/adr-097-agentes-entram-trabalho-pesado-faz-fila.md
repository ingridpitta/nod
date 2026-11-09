# ADR-097 — Agentes entram, trabalho pesado faz fila

> Emendada pela [ADR-147](adr-147-motor-no-windows-nativo.md): a fila do forno fica desligada no Windows.

Status: proposta, com as fases 0 e 1 em produção desde 12/10 (ver "Entrega") · Data: 2026-10-11 · Emenda a [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (o portão que
segura trabalho novo) e a [ADR-091](adr-091-regua-do-processador-cpu-e-fila.md) (a régua do processador). Plano de
entrega em [plano-agentes-e-trabalho-pesado.md](../plano-agentes-e-trabalho-pesado.md); telas em
[prototipos/agentes-e-trabalho-pesado](../prototipos/agentes-e-trabalho-pesado/README.md).

## Contexto

Em 11/10 o Marlon viu "processador cheio (91%)" com só 3 bots trabalhando na `nod-motor-teste` (e2-highcpu-8: 8 vCPU,
8 GB, sem swap), a VM que ele tinha aumentado justamente para rodar mais coisas em paralelo. A expectativa dele, e a de
quem vai usar o nod: uma máquina de 8 núcleos e 8 GB roda pelo menos uma dezena de agentes ou tasks ao mesmo tempo, e
não só tasks de código (operacionais, vídeo, imagem, ferramentas, análise de dados).

Medido na VM às 13:38 UTC (amostra de 30 s por `/proc/*/stat`, agrupada pela pasta da task):

- Cada `claude -p` gastava de 3% a 6% de um núcleo e ~300 MB (290 a 340 MB). O agente passa quase todo o tempo
  esperando o modelo.
- O peso vinha dos comandos que os bots rodavam: testes de integração do gamefik com um Postgres embutido por arquivo
  (96% num único Postgres), o vitest do nod (um processo por núcleo) e `tsc --noEmit` (1,6 núcleo, ~1 GB). Cada
  ferramenta usa todos os núcleos que vê, então uma suíte sozinha já enche a máquina.
- Memória: 5,4 GB usados e 2,5 GB disponíveis. A tela dizia "os bots usam 925 MB" porque conta só o processo do Claude.
- Dois Postgres de tasks antigas do Eng 1 continuavam de pé (pai = init).

No `mac_leitura` (a cada 5 min) a VM ficou quase o dia todo perto de 0%, com rajadas às 04:07, 05:37 e 13:23–13:38
UTC. A régua da ADR-091 lê ~30 s, e o portão (`fundo_segurado`, motivo processador) segurou trabalho novo de 30 s a
2,5 min por vez nessas rajadas. A memória piscou amarela às 13:37 e fez a tela de Trabalhos mostrar "pouca memória",
enquanto o cartão da máquina dizia "memória folgada".

No mesmo dia, às 14:35 UTC, a memória acabou: ~4 GB em 29 processos node (vitest, tsc) e 3,4 GB em ~17 Postgres
embutidos de teste. O OOM killer matou um node de 500 MB, e o systemd, com `OOMPolicy=stop` (o padrão), derrubou o
`nod-motor.service` inteiro, com todos os `claude -p` e Postgres. Depois a VM ficou ~20 min travada trocando páginas, sem
swap, e 6 turnos viraram "turno interrompido". Às 16:20 UTC a VM passou para e2-standard-8 (8 vCPU, 32 GB), ainda sem
swap e sem nenhuma das proteções abaixo.

O problema não é o tamanho da máquina. O portão trata o agente e o trabalho pesado como a mesma coisa: barra a entrada
de um agente novo, que custaria 5% de um núcleo, porque um comando de outro agente encheu o processador por um
minuto. E numa máquina maior a porcentagem de pico não cai, porque os testes abrem um processo por núcleo; só dura menos.

## Decisão

Separar o agente do trabalho pesado que ele dispara. **Agentes entram pela memória; comando pesado faz fila; a máquina
é repartida entre as tasks.** O usuário não precisa saber o que é núcleo, swap ou cgroup.

1. **Medir a task inteira.** O consumo de uma task passa a ser o do agente mais tudo o que ele abriu (a árvore de
   processos no Mac, o grupo da task na VM). É o número da tela e o que o portão usa. As telas passam a ler a mesma
   leitura, sem uma dizer "folgada" e outra "pouca memória".
2. **O processador deixa de barrar a entrada.** Processador cheio deixa tudo mais lento, não derruba nada. A régua da
   ADR-091 continua, olhando o uso sustentado (minutos, não 30 s), e serve à tela e à fila do item 3. Memória e disco
   continuam segurando trabalho novo como hoje (ADR-085, ADR-096).
3. **Agente entra se cabe na memória.** Cabe mais um agente se, tirando ~400 MB para ele, sobra a reserva dos comandos
   pesados. Na VM de 8 GB isso dá 10 a 12 agentes ao mesmo tempo. O que a pessoa pede na conversa continua começando
   sempre (ADR-085).
4. **Fila do forno para comandos pesados.** Os outros agentes seguem enquanto um comando espera: conversam, chamam
   ferramentas e esperam o modelo normalmente.
   - **Onde espera:** dentro do próprio comando, não no hook. O hook do Claude Code tem prazo (`TETO_HOOK_S`), e uma
     suíte na fila pode esperar mais que isso. O hook que o nod já põe antes de cada comando de terminal (`PreToolUse`,
     `claude-cli.ts`) só reescreve `npm run check` para `nod-vaga -- npm run check`. O `nod-vaga` pede a vaga à máquina,
     espera e roda o comando, como a ficha do jobserver do GNU make ou o `sem` do GNU parallel. O terminal do bot não
     tem prazo (ADR-067). A reescrita pelo hook ainda precisa ser confirmada na versão do CLI em uso.
   - **O que é pesado:** o nod não adivinha pelo nome; mede. Cada comando, por task e repositório, tem o pico de memória
     anotado (o comando e tudo o que ele abriu). A reserva da próxima vez é o maior pico das últimas 5 execuções mais
     15%, e sobe se o comando morrer por falta de memória. É a regra do VPA do Kubernetes, sem aprendizado de máquina.
     O que nunca passou de pouco (git, ls, leitura de arquivo) não espera. Comando nunca visto roda se há folga e passa
     a ser medido.
   - **Nada espera para sempre:** sem nenhum comando pesado rodando, o próximo roda mesmo que a estimativa passe da folga.
   - **Quantos por vez** não é número fixo: é o que cabe na memória livre. Com os números de 11/10, 2 a 3 em 8 GB.
5. **Repartir a máquina entre as tasks.** Na VM (Linux), cada task roda no seu grupo de controle (cgroup v2):
   - **Processador:** peso (`cpu.weight`), sem teto. Sozinha, a task usa todos os núcleos; com disputa, cada uma tem a
     sua fatia. O agente tem peso maior que os comandos dele, para a conversa seguir respondendo.
   - **Memória:** teto duro alto (`memory.max` = a máquina menos a reserva do sistema e dos agentes), não cota fixa. Uma
     task pesada sozinha usa quase tudo; o teto só impede que ela tome a memória que as outras já usam. Se estourar, o
     Linux mata um processo dessa task, não o motor nem as outras. O teto brando (`memory.high`) só entra junto com
     quem age sobre ele (systemd-oomd), porque sozinho ele só trava a task.
   - **Permissão e queda:** a unidade do motor ganha `Delegate=yes` (o motor cria os grupos das tasks sem ser root) e
     `OOMPolicy=continue` (um OOM mata o processo, não o serviço inteiro, como em 11/10).
   - **Swap:** o instalador liga swap comprimido em memória (zram), o padrão do Fedora desde a versão 33 (50% da memória,
     até 8 GB). Um pico de memória fica lento em vez de travar a VM.
   - **Mac:** sem cgroup. Os comandos de fundo rodam com prioridade baixa (`taskpolicy -c utility`, como a limpeza da
     ADR-096).
6. **Bots econômicos.** As instruções do nod pedem ao bot que, durante o trabalho, rode só os testes do que mexeu, e a
   suíte completa uma vez antes do PR. Vale para todo usuário e diminui a fila do item 4.
7. **Task terminada encerra o que abriu.** Inclusive o que saiu do grupo do turno: o Postgres de teste abre sessão
   própria e escapava do SIGKILL no grupo. Ele sai pela marca `NOD_GRUPO` no fim do turno e pelo prefixo da instância
   no boot (PR #254, `executor/fugitivos.ts`).
8. **Falar com o usuário em linguagem simples.** A tela separa "trabalhando" de "esperando a vez de rodar os testes".
   Com o tempo de fila medido, o nod recomenda máquina ("hoje seus bots esperaram 40 min na fila; com 32 GB caberiam
   ~8 comandos por vez").

### No Mac, numa VM e em várias máquinas

- **VM:** a máquina é só dos bots. Vale tudo o que está acima: grupo por task, swap, fila do forno com a memória
  inteira, menos a do sistema.
- **Mac (Este Mac):** a máquina é da pessoa, que usa outros apps ao mesmo tempo. A memória tem uma fatia "seus apps",
  e os bots usam só o que a opção "O quanto os bots podem usar" libera. Sem cgroup, o nod não limita a memória de cada
  task. Por isso a fila do forno deixa mais folga, e os comandos de fundo rodam com prioridade baixa para o Mac não
  ficar lento. Quando quem aperta são os apps da pessoa, a tela diz isso. O "Ver como acelerar" do Mac oferece deixar os
  bots usarem mais, conectar uma VM para os bots pesados ou espalhar as rotinas.
- **Várias máquinas:** cada máquina tem o seu forno, e a fila é por máquina. Trabalhos mostra o total, com o resumo
  por máquina atrás de um clique; a máquina de cada task aparece no detalhe dela. Para a distribuição há duas
  variantes, e o Marlon escolhe:
  - **o nod escolhe (recomendada):** o bot marcado para "qualquer máquina" começa cada task nova na máquina com folga
    em que ele está pronto (login das IAs, GitHub, repositórios). A task em andamento não muda de máquina, porque os
    arquivos dela estão lá. Não pede nada do usuário e escala para milhares.
  - **o usuário move:** o bot fica fixo numa máquina, como na ADR-092 hoje, e o card da máquina cheia sugere mover um
    bot para a que está folgada.

### O que é do nod e o que é do usuário

É do nod tudo que exige conhecimento técnico ou se repetiria igual para cada usuário: medir, dividir a máquina,
enfileirar, limpar, ensinar o bot a economizar e explicar. É do usuário o que é escolha de dinheiro, prioridade ou do
próprio projeto: o tamanho da máquina, o quanto dela dá para os bots (opção que já existe), quantos bots e rotinas põe
na mesma máquina, e o peso do próprio projeto (como os testes do gamefik com um Postgres por arquivo). O nod aponta; o
usuário decide e, se quiser, pede a um bot para otimizar.

### Padrões de mercado (pesquisa de 11/10)

| Peça | De onde vem |
|---|---|
| Processador não barra, memória barra | Kubernetes: processador "comprime" (falta só deixa lento), memória não; consenso de não pôr teto de processador |
| Agente entra se cabe na memória | O escalonador do Kubernetes, que põe o pod onde a reserva de memória cabe |
| Fila do forno | O gerenciador de recursos do Bazel: cada ação pede recursos ao rodar e espera se não há |
| Pesado aprendido medindo | Autopilot (Google, EuroSys 2020) e VPA do Kubernetes: histórico de picos com margem, aumento depois de OOM. O Bazel com estimativa fixa errou 160 vezes (50 MB para 8 GB) |
| Espera dentro do comando | Jobserver do GNU make e `sem` do GNU parallel |
| Teto duro alto, peso no processador | cgroup v2 / systemd; `memory.high` sozinho trava sem monitor (documentação do kernel) |
| Swap comprimido | Fedora 33+: zram com systemd-oomd |
| O nod escolhe a máquina | Escolha de nó do Kubernetes; bot fixo = afinidade de nó |
| A régua de 30 s de hoje | É o `make -l` (carga média), cujo atraso é problema conhecido; esta ADR sai dele |

Quem roda muitos agentes resolve de dois jeitos. As plataformas na nuvem (OpenHands, Devin, Cursor) dão um contêiner ou
uma VM por sessão. As ferramentas locais (Conductor, Claude Squad) não cuidam de recursos, e quem as usa relata um teto
de 4 a 8 agentes por máquina. A fila de comandos pesados dentro do agente não tem um padrão pronto: é a parte nova
desta ADR, e por isso usa o mecanismo conhecido mais próximo (o jobserver).

## Entrega (12/10)

| Fase | PR | Situação |
|---|---|---|
| 0a · task encerra o que abriu (item 7) | #254 | produção desde 11/10 |
| 0b · `OOMPolicy=continue` e swap no instalador | #255 | produção; na VM desde 12/10 01:44 UTC (zram de 8 GB) |
| 0c · memória da task inteira e o pico | #256 | produção desde 11/10 |
| 1a · o processador deixa de segurar no Equilibrado (item 2) | #259 | produção desde 12/10 04:37 UTC |
| 1b · fila do forno com `nod-vaga` (item 4) | #262 | produção e VM desde 12/10 04:37 UTC; primeiros picos anotados no mesmo dia |
| 1b · chave pelo repositório | #271 | aberto |
| 1c · bots econômicos (item 6) | #263 | produção desde 12/10 04:37 UTC |
| 2 · grupo por turno na VM e o pesado mais gentil (item 5) | #272 | aberto |
| 3 · tela e recomendação de máquina (item 8) | — | espera a tela da [ADR-099](adr-099-um-dono-por-bot.md) |

O que a implementação mudou em relação ao texto acima:

- **Item 3, a reserva de ~400 MB por agente, não entrou.** A memória segura trabalho novo pelo nível de hoje (alerta
  abaixo de 20% livres na VM). O número fixo espera os picos que a 0c e a fila estão anotando.
- **Item 2:** o processador segue segurando no "Pouco", que é a escolha da pessoa de deixar o Mac folgado para ela. A
  régua sustentada de minutos fica para a fase 3, com a tela.
- **Item 4, o que entra na fila:** a classificação de aprovação não serve (para ela, testes, lint e tipos "só leem").
  Ficam fora os programas que não pesam (git sem hook, ls, sed, cat…) e o que já se mostrou abaixo de 256 MB. Entram o
  Bash e o Monitor, também em segundo plano, porque é como o prompt manda rodar teste demorado. Quem tem a vez há 20
  min deixa de segurar a fila, para um servidor de desenvolvimento não a prender. A chave do histórico é o repositório
  pela origem do git (#271); a primeira versão usava o nome da pasta, que na task muda a cada task.
- **Item 4, a reescrita pelo hook,** foi confirmada no Claude Code da VM: os primeiros comandos de tasks reais
  apareceram no histórico da fila em 12/10.
- **Item 5:** cada task tem também 2 GB de swap (`memory.swap.max`). Medido num cgroup v2: só com `memory.max`, a task
  que passa do teto vai para o swap e segue; com o swap dela esgotado, leva SIGKILL dentro do próprio grupo. O
  "agente com peso maior que os comandos" saiu como nice 10 no comando que pega a vez da fila, no Linux e no Mac. No
  Mac, isso fica no lugar do `taskpolicy`, que pede o mesmo e não existe no Linux.
- **ADR-099:** as frentes dela são linhas de `trabalhos` com sessão própria. O grupo da fase 2 é por turno, então vale
  igual para elas.

## Consequências

- O número de agentes ao mesmo tempo passa a ser limitado pela memória, não pelo primeiro pico de teste. Na VM de
  11/10, de ~3 a 4 para 10 a 12 (estimativa; a fase 0 do plano mede antes de calibrar).
- Comando pesado pode esperar. A tela precisa mostrar isso, ou o bot parece parado.
- A fila do item 4 cobre o Claude Code, que tem o hook. O Codex fica protegido pelo grupo da task (item 5), sem fila,
  até ter um ponto equivalente.
- Mais estado no motor: grupo por task, histórico de pico por comando, swap. No Mac só a prioridade baixa e a medição.
- Os valores ficam com padrões e são calibrados com a medição da fase 0, sem decisão prévia: reserva por agente
  (~400 MB), janela da régua sustentada (3 min) e ordem da fila (o que a pessoa pediu na conversa primeiro, depois a
  ordem de chegada). A distribuição entre máquinas (o nod escolhe ou o usuário move) se decide quando chegar a vez dela.
- Ficam para depois: a fila do Codex e os detalhes das telas (fase 3).

## Emenda de 2026-10-22 — as telas do computador fazem a mesma fila (ADR-122, NOD-96)

As telas por bot do computador da pessoa ([ADR-122](adr-122-o-computador-da-pessoa-roda-no-motor.md)) seguem a regra
desta ADR: o bot sempre entra; o que é pesado (abrir mais um Chrome) espera a régua. A fila é a tela em `esperando`,
pela ordem de `esperando_desde` (`computador_telas`, 0106); a espera aparece com quem está usando a máquina e nunca é
erro. A memória por tela (≈ 0,5 GB, estimada) é medida no PR 2 da NOD-96 e não entra na decisão.

## Emenda de 2026-10-22 — a VM do computador no Mac (NOD-93)

No Mac, a VM do computador (ADR-123) entra como um bloco na fatia dos bots e segue o modo de uso: Pouco 2 GiB,
Equilibrado 3 GiB, Livre 4 GiB, com teto de 25% da RAM (suposição até medir). Sem memória para ligá-la, é espera
(`esperando_memoria`), não erro.
