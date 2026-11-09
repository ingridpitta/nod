# ADR-107 — A sessão do CLI é da máquina onde nasceu

Status: aceito (NOD-281) · Data: 2026-10-15 · Emenda a
[ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (a retomada volta na sessão da cadeia) e mantém
[ADR-103](adr-103-o-codex-com-o-terminal-pelo-hook-do-nod.md) (thread que fica)

## Contexto

A sessão do Claude (`--resume`) e a thread do Codex (`thread/resume`) moram no disco da máquina que rodou o turno.
No modo compartilhado (a ponte), o turno seguinte pode cair em outra máquina da pessoa, com outra IA ou com outra
conta. Nesses casos o CLI rejeita a sessão (`sessao_rejeitada`) e a pessoa via um aviso no lugar da resposta. Por isso
o emitir saía com `permitirResume: false`, e todo turno ia com o histórico pelo prompt: mais lento e mais caro.

## Decisão

1. **A sessão guarda a máquina dela**: `conversas.sessao_maquina_id` e `trabalhos.sessao_maquina_id` (migração
   0079, só adição), gravadas junto com a sessão; `recomecar` e `largarSessao` zeram.
2. **O turno guarda a IA que de fato rodou** em `turnos.harness_efetivo` (`turnos.harness` é a preferência, muitas
   vezes `auto`). A conta continua em `turnos.conta_id` (0074): não criamos `sessao_conta_id` no turno.
3. **O emitir volta a permitir resume** e só retoma quando a sessão é da **mesma máquina** (só na ponte; fora dela a
   máquina é uma só), da **mesma IA** e, no Codex, da **mesma conta**. A máquina precisa anunciar `retomaSessao`
   para o harness escolhido; sem anúncio, o Codex não retoma. Sessão de antes da 0079 (sem máquina) não é retomada na
   ponte; a cadeia com `harness_efetivo` nulo (turno legado) é tratada como IA desconhecida e pode retomar.
4. **`sessao_rejeitada` na conversa repete uma vez sem resume**: larga a sessão, marca as parciais e põe o turno de
   novo na fila (`reenvios` 1, evento `turno_interrompido` com `repete_sem_resume`). Na segunda vez, ou se a pessoa
   pediu para parar, vai o aviso de sempre. No trabalho só larga a sessão (o próximo turno vem sem ela).
5. **A retomada de pedido parado mantém o executor original** (antes virava `catcher` na autoria).

## Gatilho de reversão

Se a taxa de `sessao_rejeitada` com resume ligado passar a do mês anterior à 0079, voltar o emitir para
`permitirResume: false` (uma linha em `compor.ts`); as colunas ficam, porque o código anterior não as lê.
