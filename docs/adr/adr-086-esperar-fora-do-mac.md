# ADR-086 — Esperar fora do Mac: "me chame às 16:00"

Status: aceito · Data: 2026-10-08 · Segue a [ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md) (o segundo dos três PRs
do "sem teto, sem desperdício", decisão do Marlon em 2026-10-08) e conversa com a [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md)
(sessão viva, comando demorado sem limite de tempo).

## Contexto

Esperar um colega já não ocupa o Mac: o turno de quem pediu acaba, e a resposta volta como retomada com `--resume`
(ADR-058, ADR-084). Mas o bot que espera algo **de fora** (o CI no GitHub, um deploy, a resposta de alguém) não tinha como
sair: a ADR-067 manda acompanhar até concluir, então ele ficava num laço com `sleep` ou checando de tempos em tempos,
com o processo do CLI e a memória dele presos no Mac por horas. Do lado da tela, a task que espera um colega aparecia
como quem trabalha. O #208 (tempo da task) trocou o relógio por "esperando X", e esta ADR completa com o "fora do Mac".

## Decisão

1. **Ferramenta `me_chame_as({ em_minutos, motivo })`** (contracts/ferramentas-trabalho.ts; use-cases/me-chame-as.ts),
   de 1 a 1440 minutos. Nos modos criação, conversa, rotina e delegação; fica de fora da sala (várias pessoas) e da
   ligação (ao vivo). Ela enfileira a **retomada do próprio turno** com `turnos.acordar_em` (0065), com a mesma
   profundidade, confiança, procuração e trabalho, e a marca de conteúdo de fora se o turno a tinha. O resultado manda
   encerrar o turno.
2. **Sem varredor.** O `reivindicar` só entrega turno pendente com `acordar_em` nulo ou já passado; até lá ele não está
   "na fila" (`pendentesRenderizaveis`). A volta é na mesma sessão, pelo caminho de toda retomada.
3. **Estado.** O trabalho fica `rodando` enquanto a volta está marcada (há turno pendente e ele já começou, regra de
   `estadoDoTrabalho`). `TrabalhoDto.acordaEm` traz a próxima volta.
4. **Tela.**
   - A linha da task diz "volta às 16:05", com o ponto vazado da espera.
   - O cartão do tempo ganha "fora do Mac desde HH:MM · volta sozinho" (colega) ou "fora do Mac · volta às HH:MM".
   - Seu espaço › Este Mac ganha o grupo "Fora do Mac", separado de quem trabalha.
   - A linha do cartão é só texto: "Trabalhando" + "Esperando" continuam somando o "Aberta há".
5. **Prompt.** Com a ferramenta no catálogo, entra uma linha: para esperar algo de fora que demora, nada de laço com
   `sleep`; chame `me_chame_as`, diga o que espera e encerre. O comando do próprio bot (testes, build) continua no
   terminal em segundo plano (ADR-067); tirá-lo do Mac é o PR3.

## Revisão do #212 (9 revisores)

- A chamada só ANOTA o pedido no turno (`despertar_em`, `despertar_motivo`); a volta nasce no assentamento, se o turno
  concluiu, sem Parar e com a task aberta. A marca de conteúdo de fora já é final, o Parar cancela a volta, fica uma
  volta por turno, e o trabalho é o de agora (a rede de 2 min pode ter promovido o turno).
- Voltas seguidas apontam para a mesma origem (não alongam a cadeia de SALTOS_DE_RETOMADA). O teto é de 24 voltas, e o
  mínimo passa a 5 min.
- A volta usa o modelo e o harness do turno.
- `retomadaNaFila` e `vivosDaConversa` ignoram a volta futura: uma aprovação não gruda nela e a conversa não mostra o bot
  "em curso".
- Na delegação, a entrega espera a volta (`aguardando_volta`).
- "Precisa de você" vence a volta (`aguardandoDespertar` depois da decisão).
- A rotina com volta marcada segue aberta (a próxima janela é pulada).
- A volta vencida segue as regras do Mac apertado (ADR-085). Revogado em 2026-10-09 (emenda da ADR-085, revisão do
  #224): a volta é o próximo passo de uma task já começada, e só o disco crítico a segura.
- A tela diz "amanhã às" quando a volta não é hoje.
- A 0065 usa `lock_timeout`, e o ROLLBACK interrompe as voltas pendentes antes de tirar a coluna.

## Alternativas rejeitadas

- **Tabela `despertares` com varredor.** Mais uma tabela, mais um laço de 30 s e a duplicação do que a retomada já faz.
  A coluna na fila resolve com a precisão do `puxar` (1 s).
- **Deixar o bot em `sleep`.** É o que a ADR-085 quer evitar: processo e memória presos sem trabalho.
- **Hora absoluta ("16:00") no argumento.** O servidor não guarda o fuso da pessoa; minutos não dependem disso. A frase
  devolvida ao bot sai no fuso de São Paulo (como `horaDaFrase`), e a tela formata no fuso dela.

## Limitações conhecidas

- Duas chamadas no mesmo turno marcam duas voltas. O bot é orientado a chamar uma vez; desfazer a anterior pediria um
  motivo de interrupção novo.
- O Parar da task cancela a volta como cancela todo turno pendente dela.

## Gatilho de reversão

- Turnos com `acordar_em` que voltam e chamam `me_chame_as` de novo mais de 10 vezes seguidas: o bot está usando a volta
  como laço. Rever a orientação ou pôr um teto por trabalho.

## Emenda em 2026-10-12 (ADR-099, parte 1)

Em 11/10 a tela Trabalhos dizia "Trabalhando · 13" com um trabalhando de fato (onze voltas marcadas do Ze 1 e duas tasks
esperando colega), e uma task voltou 12 vezes seguidas sem nada novo, acima das 10 do gatilho acima, sem aviso. A
[ADR-099](adr-099-um-dono-por-bot.md) "um dono por bot" (PR #265, ainda proposta; §5 e §10, "esperar não é trabalhar")
muda duas coisas daqui:

- **A volta marcada não conta como trabalhando** (substitui o item 3 na tela). O estado gravado continua `rodando` (sem
  migração), mas a leitura deriva a espera (`esperaDoTrabalho`, src/domain/trabalho.ts; `foraDoMac` na web): `rodando`,
  sem turno vivo, com volta marcada ou colega por responder. Trabalhos e a gaveta do bot ganham o grupo **Esperando**
  entre Trabalhando e Na fila; o topo diz "1 trabalhando · 11 esperando · …"; o chip da barra só pisca com algo
  trabalhando e, só com espera, mostra o ponto vazado. A conversa coordenadora recebe a task como `"estado":"esperando"`.
- **O gatilho de reversão vira regra** (`VOLTAS_SEM_NOVIDADE = 3`, src/contracts/ferramentas-trabalho.ts). No
  assentamento, antes de nascer a volta, se as três últimas voltas da mesma cadeia (as que retomam a mesma origem)
  terminaram sem nada novo, a quarta não nasce: o turno ganha uma decisão `pergunta` da dona com a frase "voltou 3 vezes
  sem novidade esperando: <motivo>" e o balão com "Pode seguir esperando" / "Pode parar de esperar" (autoria
  `regra:voltas_sem_novidade`). A task vai para "Precisa de você"; a resposta retoma o turno pela rota da pergunta, e a
  volta seguinte começa outra cadeia. "Nada novo" = a volta concluiu e só marcou outra, sem abrir decisão e sem pedir
  algo a colega (src/domain/voltas-sem-novidade.ts); a fala final não conta, porque toda volta deixa uma. O teto de 24
  voltas fica como rede.

## Emenda em 2026-10-12 (ADR-099, parte 2)

Pela [ADR-099](adr-099-um-dono-por-bot.md) (item 4), esperar o que um comando acompanha até o fim (CI, deploy, processo)
passa a ser `esperar_comando`: o Nod roda o comando fora do CLI, na máquina e na pasta do turno, e o fim acorda o bot uma
vez, com o código de saída e as últimas linhas (tabela `esperas`, migração 0070). Em 11/10 foram 67 voltas por horário e
cerca de US$ 114 olhando a mesma CI sem novidade.

- `me_chame_as` fica para hora marcada e para o que nenhum comando acompanha (a resposta de alguém). O prompt e a negação
  do laço com sleep (ADR-089) apontam `esperar_comando` quando ele está no catálogo, que é o de todo turno com terminal nos
  modos deste ADR. Sem terminal (Codex, máquina sem o hook), nada muda.
- A volta da espera nasce pelo mesmo caminho da volta marcada (`enfileirarVolta`): retomada do turno de origem, no mesmo
  trabalho e na mesma sessão, com `acordar_em` = a hora do fim. Ela conta no teto de `VOLTAS_SEGUIDAS_MAX`.
- Uma volta por turno, de qualquer dos dois tipos: quem marcou `me_chame_as` não deixa espera, e vice-versa.
