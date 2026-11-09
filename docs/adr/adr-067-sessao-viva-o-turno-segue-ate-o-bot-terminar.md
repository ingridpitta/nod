# ADR-067 — Sessão viva: o turno segue até o bot terminar

Status: aceito · Data: 2026-10-01 · Revê a [ADR-040](adr-040-o-turno-e-limitado-por-atividade-nao-por-contagem-de-passos.md)
(sai o vigia de atividade). Emenda a [ADR-024](adr-024-o-plano-de-turno-e-o-primitivo-do-nod-emitido-pelo-servi.md), na validade do plano e do token de turno,
e a [ADR-052](adr-052-o-kit-do-terminal-com-o-nod-decidindo.md), no kit do terminal, que ganha `Monitor` e `TaskStop`.
Decisões do Marlon em 2026-10-01, depois do diagnóstico "a esteira trava depois do PR".

## Contexto

O Marlon: "uma task no Claude pode rodar por horas. Talvez o Claude tenha um limite do Bash, mas ele consegue
retomar. É como se o Claude não ficasse limitado apenas a um turno (que é o nosso caso), e talvez esse seja o
principal problema que precisamos atacar."

Medido no diário entre 03:15 e 09:00 de 01/10, com o #100 já no ar e os Devs usando o terminal em rotina e em pedido de
colega:

- O Dev 1 abriu o PR #505 e escreveu "O CI ainda está rodando. Vou acompanhar até acabar." O turno morreu no vigia
  (`turno_travado`).
- O Dev 4 morreu duas vezes no meio do QA (52 e 17 min, 63 e 7 chamadas). A segunda tentativa só veio uma hora depois,
  na rotina seguinte.
- A revisão dos PRs #423 e #414 pelo Dev 1 morreu no `npm install` e nunca foi retomada.
- Quase todo turno terminava com "fica para o próximo turno" ou "a resposta chega em outro turno".

Medido no Claude Code 2.1.286, com Haiku e os scripts da sessão:

| Medição | Resultado |
|---|---|
| `-p` com um prompt só e `Bash` com `run_in_background` | o comando é **morto** quando o modelo encerra a resposta (`task_updated status:killed`) |
| `--input-format stream-json` com o stdin **aberto** | o comando sobrevive; ao terminar, o CLI chama o modelo **sozinho** (`task_notification` e outro `result`) |
| Mensagem escrita no stdin com o modelo trabalhando | entra na mesma volta ("Disparado\n\n4"), como mensagem no meio do turno no Claude Code |
| Duas mensagens e o stdin fechado logo depois | o CLI atende as duas antes de sair |
| `Monitor` | aparece como tarefa em segundo plano; cada linha do script acorda o modelo; o fim vem em `task_updated completed` |
| Bash sem `timeout` | vai para segundo plano aos 120 s; com `BASH_DEFAULT_TIMEOUT_MS`, espera o comando acabar |
| `total_cost_usd` e `usage` | o custo é acumulado na sessão; o `usage` é da volta |

Além do turno de uma resposta só, cinco relógios cortavam trabalho longo:

- o vigia de 5 min em silêncio e de 8 min com ferramenta aberta (ADR-040);
- o timeout do Bash do CLI (2 min por padrão, 10 no máximo);
- a validade de **1 h** do plano e do token de turno: depois disso, toda ferramenta e todo comando eram negados;
- o `prazoEm` de 24 h nas pastas e no computador;
- o prazo absoluto do driver Codex.

## Decisão

**O turno do Claude Code é uma sessão viva.** O driver abre o CLI com a entrada em `stream-json` e não fecha o stdin
depois do prompt. Depois de cada `result`:

1. Se há comando em segundo plano (`Bash` com `run_in_background` ou `Monitor`, contados por `system/task_*`), a volta
   vira **fala intermediária** e a sessão espera. Quando o comando termina, o CLI chama o modelo de novo.
2. Se nada roda em segundo plano, o laço pergunta ao servidor (`ocioso`) se a pessoa mandou mensagem. Se mandou, a
   mensagem entra na sessão e a volta vira fala intermediária.
3. Senão, a entrada fecha e o processo sai. A última volta vai na entrega, como sempre.

O turno acaba quando o bot termina, quando a pessoa aperta **Parar** (a renovação devolve `{ativo:false}`) ou quando a
máquina some (o lease vence). Esperar não gasta tokens.

**Mensagem nova no meio do trabalho (ponto 5).** Com a sessão aberta, a renovação leva `aceitaMensagens`. A cada 3 s
(`CHECAGEM_MENSAGENS_MS`) e sempre que o bot fica ocioso, o servidor:
- absorve as falas da pessoa que esperavam na fila desta conversa (`absorverNaSessao`, saem
  `interrompido/absorvido`);
- devolve o texto, e o executor o escreve na sessão do CLI.

Só fala da pessoa, sem anexo, e só no turno da conversa dela com o bot: conversa, criação, rotina ou a retomada de uma
delas. Ficam de fora, esperando o próximo turno:
- **pedido de colega e o que corre sob procuração:** a resposta vai ao outro bot;
- **sala:** passa pelos responders;
- **fala com anexo:** o próximo turno baixa o anexo inteiro.

**Fala intermediária.** A renovação leva `falas: {seq, texto}[]`. O servidor grava cada `seq` uma vez
(`gravarFalasDaSessao`): uma mensagem do bot com a mesma autoria e confiança da fala final, mais `mensagem_criada`. A
tela recebe `turno.fala`, relê a conversa e zera o texto ao vivo daquele turno, que segue "rodando". O executor só
descarta uma fala quando a renovação volta ativa; senão ela segue na próxima, ou antes da entrega. Turno de sala não
fala no meio: as voltas vão juntas na entrega.

**Sem relógios de trabalho:**
- **sai o vigia de atividade:** `INATIVIDADE_TURNO_MS`, `ISENCAO_FERRAMENTA_MS` e `VERIFICACAO_INATIVIDADE_MS`;
- **o plano vale enquanto o turno vive:** `expiraEm = PLANO_SEM_VALIDADE`;
- **o token de turno não expira por relógio:** some na entrega, quando o varredor assenta o turno pelo lease
  (`aoInterromper` → `revogar`) e no reinício do servidor;
- **o Bash do CLI sem teto:** `BASH_DEFAULT_TIMEOUT_MS` e `BASH_MAX_TIMEOUT_MS` em 2.147.483.647 ms, o maior atraso que
  o `setTimeout` do Node aceita (cerca de 24,8 dias);
- **pastas e computador** não olham mais o `prazoEm` do turno vivo;
- **o driver Codex** perde o prazo absoluto.

O lease fica: ele prova que a máquina vive e não mede trabalho.

**Kit do terminal.** Entram `Monitor`, que roda um comando como o Bash e passa pela mesma cerca do git (ADR-065) e
pela mesma decisão do servidor (`autorizarComando`, ADR-066), e `TaskStop`, que para um comando que o próprio bot pôs em
segundo plano. O prompt diz: "Comando demorado não tem limite de tempo: rode em segundo plano ou acompanhe com
Monitor e siga trabalhando. Não encerre dizendo que vai acompanhar depois. A pessoa pode mandar mensagem enquanto você
trabalha."

**Fechamento do turno** (`classificarSessao`):
- tokens somados por volta, custo do último `result`;
- texto só das voltas ainda não faladas;
- com um `result` só, o mesmo de sempre;
- Parar no meio de uma volta, ou com um comando ainda em segundo plano, sai **interrompido**, e não "sucesso" pela
  volta anterior.

**Comandos da conversa.** `/uso`, `/contexto` e `/compactar` continuam de uma vez só, pelo texto (0038), porque é assim
que o CLI os reconhece.

## Alternativas descartadas

- **Só subir o vigia e o timeout do Bash.** Era a primeira proposta. O Marlon: "não quero ter limite… se o usuário
  quiser parar, ele tem um botão no bot para PARAR". Além disso, o comando em segundo plano morria com o `-p` de
  qualquer jeito, e a validade de 1 h cortava a tarefa longa.
- **O nod acordar o bot de fora** ("continue"), com uma retomada por comando que terminasse. O processo do CLI teria
  saído e matado o comando; só serviria para esperas que vivem fora do Mac, como o CI no GitHub, e cada volta pagaria
  uma retomada.
- **Uma volta, um turno**, com o executor criando turnos no servidor a cada `result`. Mantém "um turno = uma resposta",
  mas a entrega a um colega, o Raio-X e o custo seriam partidos no meio de uma tarefa só.
- **Mensagem nova só depois do turno**, como era. É o que fazia o Dev esperar a rotina seguinte e a pessoa ficar sem
  poder corrigir a rota.

## Custo aceito

- **Um processo preso fica "trabalhando" até alguém apertar Parar.** O vigia que cortava não existe mais. O Monitor
  de um script que nunca acaba segura o turno do bot, e a fila dele espera; a mensagem da pessoa ainda entra. Desde
  2026-10-05 (NOD-73) a tela pelo menos avisa: ver a emenda abaixo.
- **Cada linha de um Monitor custa uma volta do modelo.** No teste com Haiku, cerca de US$ 0,017 por volta, com o
  contexto em cache. O prompt pede para filtrar a saída.
- **A sessão de horas fica pesada.** O autocompact do CLI resume no meio, como no terminal.
- **Mensagem perdida se o CLI morrer entre a resposta da renovação e a escrita no stdin.** A fila já a marcou
  absorvida. O laço registra `laco_mensagem_sem_sessao`. A janela é de milissegundos.
- **Pedido de colega não entra no meio:** espera o turno do Dev acabar.

## Validação

- `tests/unit/domain/stream-json.test.ts`, com a gravação real `s7-sessao-viva.jsonl`:
  - `tarefa_fundo` abre e fecha;
  - duas voltas juntam o texto, somam os tokens e ficam com o custo do último `result`;
  - a volta já falada não repete;
  - com um `result` só, o resultado é idêntico a `classificarResultado`;
  - Parar no meio, ou com comando em segundo plano, sai interrompido.
- `tests/integration/executor/claude-cli-falso.test.ts`, contra o CLI falso no cenário `sessao-viva`:
  - o comando em segundo plano segura a sessão;
  - a volta sozinha e a mensagem nova viram falas;
  - a entrada fecha quando nada mais roda;
  - o `BASH_*_TIMEOUT_MS` chega ao filho;
  - comando da barra continua de uma vez só;
  - Parar com comando pendente sai interrompido.
- `tests/unit/executor/laco.test.ts`:
  - horas com uma ferramenta aberta não interrompem; desde a NOD-73, avisam uma vez por nível;
  - fala com `seq`, uma vez;
  - fala não confirmada volta antes da entrega;
  - o ocioso traz a mensagem e depois para de pedir;
  - a checagem periódica traz a mensagem.
- `tests/unit/use-cases/sessao-viva.test.ts`:
  - grava a fala só em turno vivo, fora de sala e da mesma máquina;
  - absorve só fala da pessoa sem anexo, na conversa, e nunca em pedido de colega.
- `tests/concurrency/sessao-viva.test.ts`: laço, ponte in-process e Postgres reais. A fala sai com o turno rodando, a
  mensagem da pessoa entra no mesmo turno (a dela sai `absorvido`) e a conversa fica na ordem certa.
- Testes de nativas (Monitor e TaskStop), plano (sem validade), token (sem relógio, só revogar), ponte HTTP (`falas`) e
  reducer (`turno.fala`).

## Gatilho de reversão

- **Custo:** o gasto diário dos Devs mais que dobra sem dobrar as tasks em "feita", por Monitor ou espera mal usados.
  Revisar o prompt e a granularidade do Monitor antes de pôr relógio de volta.
- **Preso:** um bot fica "trabalhando" sem progresso mais de uma vez por semana sem ninguém notar. O aviso na tela
  entrou na NOD-73 (emenda abaixo); o corte automático só volta a ser avaliado se, mesmo com o aviso, o log
  `turno_sem_novidade` mostrar turnos de 40 min ou mais sem ninguém apertar Parar mais de uma vez por semana.
- **Mensagem perdida:** `laco_mensagem_sem_sessao` aparece no log. Trocar a absorção por duas fases: o servidor só
  marca absorvida depois de o executor confirmar a escrita.

## Não implementado

- **Codex:** continua um prompt por turno, sem sessão viva nem mensagem no meio; só perdeu o prazo absoluto.
- **Anexo na mensagem do meio do trabalho:** espera o próximo turno.
- **Pedido de colega entrando na sessão viva do outro bot.**
- **Acordar o bot de fora** quando algo fora do Mac muda, como o CI do GitHub ou um merge. O bot espera com `Monitor`
  (`gh pr checks` em laço) dentro da sessão.

## Emenda (2026-10-05, NOD-73): vigia que avisa, não corta

O gatilho "Preso" disparou: o Marlon via bot "trabalhando" sem saber se estava andando. Voltou um vigia, mas **só de
aviso**: nenhum caminho dele chama `interromper()`, e o Parar continua sendo o único jeito de encerrar o turno.

- **Domínio puro** em `src/domain/vigia-turno.ts`. Dois avisos:
  - **sem novidade:** 10 min sem nenhum evento interpretado do CLI. Sobe de nível em 10, 20, 40… min (não repete a cada
    minuto) e some com o próximo evento (aviso com `mudoMs` 0). A espera de aprovação (até 450 s) fica abaixo do limiar.
  - **repetição:** a mesma chamada (nome + argumentos com chaves ordenadas e espaço normalizado) 5, 10 e 20 vezes no
    turno. Chamada sem argumentos não conta. Até 256 chaves (LRU); a chave guarda uma impressão, nunca o argumento.
- **Laço:** um `setInterval` de 60 s com o relógio do laço (`o.relogio`) pergunta ao vigia; os eventos do CLI passam
  por ele no mesmo sink. O aviso sai por `aoVigia` e para assim que o turno é entregue.
- **Os argumentos nunca saem do Mac.** O trecho `{ vigia }` da renovação leva só nome e números (`mudoMs`, `aberta`,
  `emFundo`, `repeticao: { nome, vezes }`). A validação do servidor é estrita: campo a mais, nome fora do formato ou
  limiar que não é 5, 10 ou 20 descartam o trecho. Na ponte do app, o aviso novo substitui o que ainda não saiu.
- **Servidor:** publica o frame `turno.vigia` com o nome curto ("Terminal", "Gmail") e registra `turno_sem_novidade`
  (uma linha por nível) e `turno_repeticao` (uma por limiar), por turno. É o dado que mede este gatilho.
- **Tela:** o reducer guarda o aviso no turno vivo (`vigia`, com o instante em que o silêncio começou) e ignora a
  ligação. A repetição mostra só o maior limiar atingido, numa linha que se atualiza.

**Validação:** `tests/unit/domain/vigia-turno.test.ts`, `tests/unit/executor/laco.test.ts` (horas com ferramenta
aberta avisam uma vez e não interrompem; 5 chamadas iguais avisam sem argumento), `tests/unit/ponte-http.test.ts`
(validação estrita), `tests/unit/aviso-vigia.test.ts` (rota renovar, log sem repetir) e
`tests/integration/executor/claude-cli-falso.test.ts` (cenário `repeticao`: o CLI falso real avisa em 5, 10 e 20).

## Emenda em 2026-10-12 (ADR-099, parte 2)

Esperar algo de fora não é mais comando em segundo plano do CLI ([ADR-099](adr-099-um-dono-por-bot.md), item 4). O Bash
em segundo plano segura o turno e a fila do bot enquanto o comando roda — é a regra deste ADR, e ela continua valendo para o
comando do próprio trabalho (testes, build, QA). Para a CI, o deploy ou o processo de outra pessoa, o bot chama
`esperar_comando`: o motor da máquina roda o comando num grupo próprio (ADR-089), fora do CLI e sem prazo, o turno encerra
na hora, e o fim do comando abre uma retomada na mesma sessão. O prompt do terminal deixou de citar a CI entre os comandos
demorados que se rodam em segundo plano.

