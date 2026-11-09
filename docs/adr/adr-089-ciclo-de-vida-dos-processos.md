# ADR-089 — Ciclo de vida dos processos: órfãos no religar, hook que solta, laço de sleep

> Emendada pela [ADR-147](adr-147-motor-no-windows-nativo.md): no Windows o grupo de processo vira a árvore vista (pid + início) e o `taskkill`.

Status: aceito · Data: 2026-10-09 · Issue #217, parte do épico #221 (performance no Mac). Emenda a
[ADR-083](adr-083-trabalhos-paralelos-a-conversa-coordena.md) (grupos de processo) e a
[ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) (o hook do terminal); conversa com a
[ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (sem teto de tempo) e a
[ADR-086](adr-086-esperar-fora-do-mac.md) (`me_chame_as`). Revista no mesmo dia pela revisão independente do PR #223.

## Contexto

Em 09/10 o Mac do Marlon parou com load ~430 e o swap cheio. Entre o que segurava memória sem trabalho:

- dois `claude -p` **órfãos (pai = 1) vivos havia 7h30**, de um servidor religado às 21:40Z de 08/10. Um rodava
  `while :; do gh run list …; sleep 30; done` (Cecília esperando o CI), o outro laços com `sleep 10/15`. O resultado não
  chegava a ninguém, e a task retomada (ADR-084) passava a ter dois processos na mesma pasta;
- o hook do terminal, numa espera de aprovação que o servidor já tinha soltado (`soltar: true`, Mac apertado),
  repetindo a consulta sem pausa por até 7 min.

As causas: o `exit` do Node (que mata os grupos `detached`, ADR-083) não roda num SIGKILL, numa queda ou num SIGHUP sem
ouvinte — os religamentos de 08/10 às 15:42Z, 17:07Z e 21:40Z não têm `sinal_recebido` no log; o `dev.mjs` só sinalizava
a ponta (`npx`/`mise`) e o tsx, no meio, dá SIGKILL no filho que não confirma o sinal em ~60 ms; o hook só olhava
`estado === "decidida"`; e nada impedia o bot de esperar com `sleep` no próprio terminal, o que mantém a sessão viva
(`emFundo.size > 0` segura a entrada do CLI aberta).

Decisão do Marlon que vale aqui: **sem teto de tempo** para sessão ou comando longo (ADR-067). Ataca-se o desperdício
(órfão, laço apertado, laço de espera), nunca o trabalho demorado de verdade.

## Decisão

1. **Grupos anotados em arquivo, e o boot mata as sobras provadas** (`executor/grupos-orfaos.ts`, `processo.ts`).
   - Cada grupo vivo fica num JSON da instância, gravado de forma síncrona a cada spawn e fim: o pid do líder, o relógio
     antes e depois do spawn, o binário e a **marca**. O arquivo também anota o dono (pid e início do processo do nod).
   - **A marca.** Com o registro ligado, todo spawn leva `NOD_GRUPO=<prefixo da instância>-<aleatório>` no ambiente,
     herdado pelos netos (o Bash do modelo, o servidor MCP). Nada é morto sem ler essa marca num processo vivo do grupo
     (`ps -E` no Mac, `/proc/<pid>/environ` no Linux). Não deu para ler o ambiente: não mata.
   - **Um arquivo por instância.** O servidor usa `~/.nod/grupos-vivos/servidor-<hash de DATABASE_URL|porta>.json`: o
     diário e uma instância temporária de teste no mesmo Mac não se matam. O app do Mac usa
     `<userData>/executor/grupos-vivos.json` (uma cópia por pessoa, pelo `requestSingleInstanceLock`).
   - **Quando roda.** No servidor, logo depois do `listen` dar certo e antes de qualquer turno (`OpcoesBoot.aposEscutar`):
     uma segunda cópia da mesma instância não pega a porta e nunca mata nada. No app, antes do primeiro `conectar`.
   - **Conferência.** Um `ps -A` (com `LC_ALL=C`, porque no Mac em português o `lstart` sai "Sex  9 Out"). Anotação sem
     marca ou de antes do boot da máquina (`kern.boottime`, `/proc/stat btime`) é descartada: os pids recomeçaram.
     - Líder vivo: precisa ainda ser líder do grupo, ter nascido entre os dois relógios do spawn, rodar o binário anotado
       **e** carregar a marca. Aí o grupo leva SIGKILL.
     - Líder morto (o `claude` saiu e deixou o `while … sleep`): só com o boot da máquina conhecido, todos os membros
       nascidos depois do spawn, e a marca lida em ao menos um membro vivo. Aí o grupo inteiro leva SIGKILL: o filho
       `detached` abre uma sessão própria, os grupos dela só nascem dos descendentes dele, e o sistema não dá a processo
       novo um número de grupo ou sessão em uso — um membro vivo com a marca prova que o grupo é o anotado. O macOS não
       mostra o ambiente dos binários da Apple (`/bin/zsh`, `/bin/sleep`): um resto feito só deles fica (`orfao_sem_prova`).
   - **Nunca o próprio grupo.** O servidor que um bot da mesma instância subiu (`kill -9` no servidor e `npm run dev &`,
     sem setsid) nasce dentro do grupo anotado, com a marca herdada. O grupo deste processo e o de cada ancestral (pela
     cadeia de ppid do `ps`) nunca são mortos (`orfao_e_meu_grupo`); sem o próprio pid no `ps`, nada morre. O log
     `orfao_encerrado` sai antes do kill.
   - Logs: `orfao_encerrado`, `orfao_e_meu_grupo`, `orfao_sem_prova`, `grupos_de_outra_copia_viva` (dono anotado vivo, com folga de 60 s
     entre o relógio do Node e o `lstart`), `orfaos_sem_ps`.
   - Fim normal: o `exit` (servidor) e o `will-quit` (app) matam os grupos e anotam a lista vazia.
2. **Sinais pelo mesmo caminho.** O servidor trata SIGHUP como SIGINT/SIGTERM (drenagem; o segundo sai com 130, pelo
   `exit`). O mesmo sinal repetido em menos de 3 s é eco de quem repassou e não conta como segundo. O `dev.mjs` sobe o
   servidor com `node` direto, como o `npm start` (sem o tsx, que dava SIGKILL no filho sem drenagem). Como o filho `api`
   é o próprio servidor, SIGINT, SIGTERM e SIGHUP chegam a ele na hora, sem esperar o `ps` (o `kill -INT` de um script
   também); o Ctrl+C do terminal, que chega pelo grupo ao mesmo tempo, vira eco e fica um só `sinal_recebido`. O Vite
   recebe o sinal pela árvore (npm → vite) no mesmo grupo.
3. **O hook solta.** `soltar: true` encerra a espera na hora com `AINDA_ESPERANDO`, como o proxy já fazia nas
   ferramentas MCP; entre duas consultas passa ao menos 1 s. A rota `/decisoes/:id/aguardar` passa a devolver `soltar: true`
   também quando uma retomada já ficou com a decisão — antes devolvia "pendente" e o turno seguia vivo até 7 min junto
   com a retomada.
4. **O laço de espera é negado** (`domain/espera-em-laco.ts`, na rota `/interno/nativas` que o hook chama, para Bash e
   Monitor), em qualquer modo, antes de card e trilha:
   - laço (`while`, `until`, `for`, `select`) cujo maior `sleep` dentro é de **10 s ou mais** (`SLEEP_DE_ESPERA_S`);
   - `sleep` fora de laço que, **somado** no mesmo comando, passa de 60 s (`SLEEP_MAXIMO_S`);
   - o que roda dentro de `timeout N` com 0 < N ≤ 10 min (`TIMEOUT_QUE_LIMITA_S`, sufixos s/m/h/d) passa inteiro: tem fim
     garantido. `timeout 0` desliga o limite e não libera nada.

   A mensagem aponta o `me_chame_as` quando ele está no catálogo do turno; sem ele (sala, ligação), manda encerrar dizendo
   o que falta. Fica `espera_em_laco_negada` no log (o tipo e os segundos, nunca o comando). A leitura é de shell: aspas,
   comentários e corpo de heredoc são dados; `$(…)`, crase, `bash -c`, `eval` e `bash <<EOF` entram. Passam
   `until pg_isready; do sleep 1; done`, o `docker compose ps | grep healthy` com `sleep 2`, o lote com `sleep 1` por limite
   de API, `sleep 2 && curl`, `tail -f | grep` no Monitor e todo comando longo de verdade.

   **Os limiares (10 s e o `timeout` até 10 min) foram decididos pelo coordenador na revisão do #223, na ausência do
   Marlon.** A primeira versão negava todo `while`/`until` com `sleep` e barrava trabalho legítimo. Os laços medidos em
   09/10 dormiam 10, 15 e 30 s e continuam negados. Para voltar atrás: `SLEEP_DE_ESPERA_S = 0` nega todo laço com sleep, e
   `TIMEOUT_QUE_LIMITA_S = 0` deixa de liberar o laço dentro de `timeout`.

## Por que no servidor e não no hook

A regra 4 mora na rota que o hook já chama a cada comando, e não no `decidirNativa` local: o servidor tem o catálogo do
turno (sabe se há `me_chame_as`), o log fica no lugar de sempre e a regra vale para os Macs com o app atual sem esperar
uma versão nova. O hook só repassa a negação, como faz com toda resposta não-OK.

## Alternativas rejeitadas

- **Teto de tempo por comando ou sessão.** Contra a decisão do Marlon (ADR-067): mata o trabalho legítimo junto.
- **Tabela no banco para os grupos.** O app do Mac não tem banco, e o registro precisa ser gravado no `exit`, que só
  aceita trabalho síncrono.
- **Matar por nome (`pkill claude`).** Mataria o Claude Code da própria pessoa e os bots de outra instância.
- **Conferir só pid, início e nome do comando.** A revisão achou 14 grupos alheios com líder morto numa máquina, e uma
  anotação antiga casou com um deles: sem a marca, o ramo "líder morto" mataria outro programa.
- **Filhos do `dev.mjs` em grupo próprio (`detached`).** O Vite em segundo plano pararia ao ler o terminal (SIGTTIN), e o
  SIGKILL no grupo de um bot que rodou o `dev.mjs` deixaria o servidor e o Vite para trás.

## Limitações conhecidas

- O Codex não passa pelo hook (`approval_policy="never"` no sandbox dele): a regra 4 só vale para o harness com o hook.
- Resto de grupo feito só de binários da Apple (o laço em `/bin/zsh` com `/bin/sleep`, líder já morto) não é provado e
  fica, no Mac. Com o líder vivo (o caso medido em 09/10), a prova vem dele.
- O laço escondido num script em arquivo (`bash espera.sh`) não é lido. Guarda contra o hábito, não contra quem esconde.
- Um SIGKILL no próprio `dev.mjs` ainda deixa o servidor vivo (sem órfão de bot: o servidor segue dono deles).
- O hook novo (regra 3, lado do hook) chega ao Mac com a próxima versão do app; a regra 4 e o `soltar` da retomada
  valem já no deploy do servidor.

## Gatilho de reversão

- `orfao_encerrado` em boot depois de um religamento limpo (com `sinal_recebido`): o registro está deixando grupo para
  trás no fim normal — rever `soltarGrupo`.
- Uma pessoa relata um processo dela (fora do nod) morto no boot: rever a prova pela marca antes de qualquer outra coisa.
- `espera_em_laco_negada` seguida de o bot desistir de um comando legítimo no mesmo turno: a leitura tem falso positivo —
  corrigir o caso e pôr no teste. Bots voltando a esperar o CI com laço de `sleep 9`: subir a regra para todo laço.
