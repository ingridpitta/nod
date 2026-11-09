# ADR-109 — Um comando parado segura o bot: a conversa mostra e deixa interromper só o comando

Status: proposto (não implementado; conferido na main `61b42986` em 2026-10-16: não há `interromper-comando` nem o aviso
"há N min em `comando`") · Data: 2026-10-05 · Emenda à ADR-067 (sessão viva, Bash sem teto). Implementação: issue
[#153](https://github.com/gamefik/nod/issues/153). Renumerada de ADR-078 para ADR-109 em 2026-10-16 (NOD-305): a
main já tinha a [ADR-078](adr-078-limite-da-assinatura-na-ligacao.md) do limite da assinatura na ligação.

## Contexto

Medido no nod diário em 2026-10-05, das 21:56 às 22:34. A bot Ada, num turno de delegação, rodou em primeiro plano

```
grep -rl -i Detalhamento de produto ~/code/nod/docs ~/nod
```

sem aspas no padrão: virou uma busca por "Detalhamento" nos arquivos `de` e `produto` e em todo o `~/nod` (as pastas
de todas as bots, com os `node_modules` de cada worktree). O grep ficou **37 minutos** a 87% de CPU. Como a ADR-067
tirou o teto do Bash (`BASH_DEFAULT_TIMEOUT_MS` e `BASH_MAX_TIMEOUT_MS` no máximo, para um teste de 20 minutos não
morrer aos 120 s), o CLI esperou. Enquanto isso:

- a mensagem do Marlon para a Ada ("Olá Ada… poderia passar para o Leonardo…") ficou `pendente` na fila dela, porque os
  turnos de um bot são em série;
- a conversa mostrava a Ada "trabalhando", com a lista de ferramentas do trecho vivo, mas nada dizia **há quanto tempo**
  nem **em quê**; para a pessoa, "o nod travou";
- a única saída na tela era o Parar, que derruba o turno inteiro (e a delegação em curso), não o comando.

Resolveu-se à mão: `kill -TERM` no grep; o Bash devolveu, a bot seguiu e a fila andou.

O mesmo acontece com qualquer leitura sem fim (`find /`, `grep -r` sem pasta, `tail -f`, `gh run watch` de um CI
preso): nenhuma delas é "trabalho" que valha minutos, mas nenhuma é interrompida.

## Decisão

1. **O teto continua fora** (a ADR-067 vale): o Bash do bot é o terminal da pessoa, e um teste de 20 minutos ou um
   `gh run watch` legítimos não podem morrer por relógio. Paridade com o terminal, não com um limite nosso.
2. **A conversa diz há quanto tempo e em quê.** O trecho vivo já leva o nome da ferramenta (`{ferramenta}` em
   `TrechoVivo`); passa a levar também o instante de início e, para o Bash, os primeiros ~80 caracteres do comando
   (já redigidos pelo mesmo caminho dos segredos, NOD-158). A partir de **2 minutos** no mesmo comando, a bolha
   "trabalhando" vira "há N min em `comando…`", atualizada pelo relógio da tela.
3. **Interromper só o comando.** Ao lado desse aviso, o botão **Interromper comando** manda `POST
   turnos/:id/interromper-comando`. O executor (o laço da máquina, ADR-021; no Mac ou no Linux, ADR-090) mata o
   grupo de processos do comando em curso (SIGTERM, depois SIGKILL em 5 s), e o CLI recebe a saída como receberia um
   Ctrl-C: código ≠ 0 e a mensagem "interrompido pela pessoa pelo nod". O **turno continua**; é a bot que decide o
   que fazer com o comando que falhou. Nada mais é interrompido: delegações, outras ferramentas e o resto da fila ficam
   como estão.
4. **Teto só para o que ninguém mandou.** Comando iniciado pelo próprio nod (sonda, hook, `gh` do GitHub nativo) tem
   teto próprio, como hoje. Comando do bot não ganha teto nesta ADR.

## Alternativas descartadas

- **Voltar o teto do Bash (120 s, como o Claude Code sem variável):** o CLI em `-p` mata o Bash em segundo plano ao
  encerrar e a bot tende a "acompanhar depois" (ADR-067 mediu os dois); o teste de 20 min voltaria a morrer.
- **Teto só para comandos de leitura (grep/find/ls/cat):** classificar o comando pelo texto é frágil (`grep` dentro de
  um `npm run`, `rg` por pipe) e não resolve `gh run watch`.
- **Matar sozinho aos N minutos:** decide pela pessoa o que é "muito"; o aviso na tela com o botão deixa a decisão com
  quem está vendo.

## Gatilho de reversão

Se o botão virar rotina (mais de uma interrupção manual por dia por pessoa, medido em `turno_encerrado.ferramentas` com
o novo motivo `comando_interrompido`), a leitura é que o aviso não basta: volta o teto, por comando de leitura ou geral,
com o valor que os dados mostrarem.
