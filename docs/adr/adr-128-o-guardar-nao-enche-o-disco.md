# ADR-128 — O guardar não enche o disco

Status: aceita · Data: 2026-10-26 · Revê a ADR-096 §4 (guardar antes de apagar) e a ADR-116 (clone sujo sem objetos).

## Contexto

Em 26/10, às 11h36 (14:36 UTC), o disco da VM dos bots (`nod-motor-teste`, 197 GB) chegou a 0 livre. Todo turno que
caía nela morria na largada (`laco_turno_excecao`), e a tela mostrava "Turno interrompido: a IA parou por um erro"
(11 turnos entre 11h15 e 12h). O disco foi aumentado para 300 GB à mão. Medido na VM:

- **O bot Leonardo ocupava 95 GB.** Seis tasks tinham cada uma um clone raso do gamefik de 14 a 18 GB, quase tudo em
  `.git/objects`, com 39 a 65 pacotes. Nenhum commit desses clones estava fora do GitHub.
- **A própria limpeza engordava esses clones.** Para provar que o clone está no remoto, `provaNoRemoto` (QA do #413)
  busca por id as pontas do remoto que faltam. Os clones tinham uma `refs/remotes/origin/codex/…` de uma branch apagada
  no GitHub, e por isso a prova dava `fora` com ou sem fetch. Mesmo assim o fetch rodava a cada passada. Num clone raso
  ele traz o histórico inteiro das branches que não passam pela fronteira (~500 MB). Como ele não grava ref nenhuma, a
  passada seguinte não anuncia esses objetos e baixa tudo de novo. Os pacotes cresceram todo dia desde 20/10.
- **O clone raso ia inteiro para o guardado.** `cloneSemObjetos` recusava `shallow`. Então o `tar` levava os 15 GB,
  passava do teto de 2 GB e a pasta ficava (`grande_demais`). Eram 28 pastas assim em 17/10 e 73 em 26/10.
- **O guardado grande demais custava disco e voltava sempre.** O `tar` escrevia o `.parcial` até o fim para só então
  medir. A passada apertada (a cada 30 min) repetia isso nas mesmas 73 pastas. Com pouco espaço, o `.parcial` acabou com
  o disco (87 `limpeza_guardar_falhou` com `tar` saindo 2 em 26/10, contra 0 a 3 por dia antes).

## Decisão

1. **Sem fetch em clone raso** (`provaNoRemoto`). Sem as pontas que faltam, a base fica menor e `fora` só pode dar sim
   a mais: o clone é guardado, nunca apagado a mais. O clone raso cujo remoto andou não prova mais que é idêntico e
   segue o caminho do guardado.
2. **O clone raso também vai sem `.git/objects`** (`cloneSemObjetos`). As outras exigências ficam: índice vazio, nada
   só no reflog, HEAD solto com ref, remoto respondendo, bundle conferido com os pré-requisitos sob a base. A fronteira
   só corta histórico que veio do remoto. Testado: o bundle de um clone raso se cria, se confere e refaz o commit local
   num clone novo. **Revisto na revisão do #528:** só quando toda fronteira está sob a base do remoto
   (na prática, o remoto não andou desde o clone); senão o `.git` vai inteiro.
3. **O guardado nunca leva o disco abaixo do vermelho da ADR-085 (3 GB).** O teto do `.tar.gz` passa a ser o menor
   entre 2 GB e o livre menos 3 GB. Sem folga, a pasta fica sem `tar` (`sem_espaco`, motivo novo no relato).
4. **O `tar` é cortado no teto.** Um vigia lê o tamanho do `.parcial` a cada 2 s e aborta o `tar` quando passa (o
   `ExecutarComando` ganhou `sinal`). Passou do máximo = `grande_demais`; passou só da folga do disco = `sem_espaco`.
5. **A pasta grande demais fica um dia sem novo `tar`.** Isso vale em memória, enquanto o motor vive. A atualização do
   motor reinicia e tenta de novo.
6. O `limpeza_guardar_falhou` passa a levar o fim do `stderr` do `tar`. Em 26/10, só o código 2 não dizia a causa.

## Revisão do #528 (2026-10-26)

- **Clone raso só vai sem objetos se toda fronteira (`.git/shallow`) está sob uma ponta do remoto.** Com a branch
  squashada e apagada no servidor, o pai da fronteira some de lá, o bundle não o exige e o clone novo do LEIA não
  consegue buscar o bundle (reproduzido). Nesse caso o `.git/objects` vai inteiro, como antes; a espera de um dia do
  `grande_demais` evita que isso volte a encher o disco.
- **O teto do `tar` é medido depois dos bundles**, e o vigia também lê o livre: o disco que cai abaixo do piso no meio
  corta o `tar` (`sem_espaco`). A pasta cortada por falta de espaço espera 6 h (a grande demais, 24 h).
- **Sem leitura do livre** (erro ou NaN), não há `tar`: `sem_espaco`.
- Na VM, o motor roda com `KillMode=mixed`: o restart da atualização (ADR-100) mata o `tar` filho junto.

## Fora

- **O portão de disco não segura o turno de trabalho já começado** (ADR-085, de propósito). Com o disco em 0, esse
  turno morre com "erro" genérico. Dizer "disco cheio" na tela é outra mudança.
- **O fetch da prova em clone completo** também não grava ref e baixa de novo a cada passada o que o remoto andou desde
  a última busca. Lá é incremental (o histórico está todo no clone), mas ainda é desperdício. Medir antes de mexer.
- **O espaço que os clones rasos da VM já têm, quando o remoto andou** (revisão 2 do #528). Sem fetch, a fronteira
  não fica sob a base, e o `.git` vai inteiro (o seguro): esses clones seguem `grande_demais`, com um `tar` cortado em
  2 GB por pasta por dia. O disco não enche, mas o espaço não volta sozinho. Provar a fronteira sem baixar objetos
  (`git fetch --negotiate-only`) é outra mudança; até lá, esses clones saem à mão.

## Riscos aceitos

- **Clone raso com remoto que andou fica mais tempo.** Ele não é apagado sem guardar como idêntico: vai pelo guardado,
  na task encerrada.
- **Bundle de clone raso.** O bundle não tem teto próprio; o `tar` que vem depois é medido contra o livre já sem ele.
- **No macOS, o vigia pode não parar o `tar`.** Se o `taskpolicy` não repassar o sinal, o `tar` segue até o fim com o
  `.parcial` já apagado. O espaço volta quando ele termina. Não foi medido.

## Gatilho de reversão

- Relato de commit perdido de um clone raso guardado sem objetos: voltar a recusar `shallow` em `cloneSemObjetos`.
- `limpeza_disco_apertado` vermelho por mais de um dia com `sem_espaco` crescendo: o que enche está fora do guardado,
  e é preciso medir de novo.
