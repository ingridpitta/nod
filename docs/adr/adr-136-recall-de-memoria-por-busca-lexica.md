# ADR-136 — Recall de memória por busca léxica antes de cada turno

Status: aceita · Data: 2026-10-28 · NOD-60 · Estende a ADR-008 (busca `nod_pt` e a emenda NOD-380 sob a RLS)

## Contexto

O prompt de texto levava as 40 memórias MAIS ANTIGAS do bot (`MEMORIAS_NO_PROMPT`). Da 41ª em diante, nada novo chegava
ao modelo: o bot dizia "Anotei" e esquecia no turno seguinte. Mandar todas não escala (custo e ruído), e uma busca
semântica pede modelo de embedding, chave e latência a mais em todo turno.

## Decisão

1. **Cabe inteira, vai inteira.** Até 40 memórias e 6 mil caracteres, o prompt leva todas, na ordem de sempre, e a busca
   nem roda.
2. **Não cabe: núcleo + busca do turno.** Por prioridade: as 15 preferências mais recentes, as 10 mais recentes que ainda
   não entraram e até 15 achadas pela busca. As vagas que sobram vão para as próximas mais recentes (contam no núcleo):
   um bot de 60 memórias sem nada achado leva as 40 mais novas, não 10. Teto de 40 linhas e 6 mil caracteres; o texto
   maior que 1.500 caracteres entra cortado ("…"), então nenhuma memória some para sempre. As preferências dividem um
   sub-teto de 2.500 caracteres: as 15 entram e, quando longas, são cortadas por igual para não expulsar as recentes.
   A linha não preferencial que ainda estouraria o teto é pulada. Quando a busca achou algo, o núcleo para em 6 mil menos 1.600 (`RESERVA_DO_RECALL`), para que a
   achada caiba mesmo com preferências longas; o preenchimento usa o teto inteiro. A saída volta à ordem de criação. A escolha é pura (`src/domain/recall-memoria.ts`).
3. **Busca léxica, sem modelo.** Coluna gerada `search_tsv` (`nod_pt`: portuguese + unaccent, migração 0123) e
   `memorias.buscarPorTexto` com OU entre os termos e `ts_rank` normalizado pelo tamanho (1). A consulta é a mensagem da pessoa ou do colega; na
   rotina (e na retomada dela), a instrução; nas outras retomadas, a fala do turno que começou a cadeia mais a da
   retomada (que pode trazer a resposta da pessoa ao pedido do bot). Cortada em 2 mil caracteres. A busca roda num savepoint: se falhar, o turno segue com o núcleo e
   o log registra `recall_de_memoria_falhou`. Ligação de voz segue com o próprio prompt (15 recentes).
4. **Sem GIN (desvio do critério "usando o GIN").** Sob a RLS com FORCE, o `@@` (`ts_match_vq`) não é LEAKPROOF e o
   planner não o usa como condição de índice — o mesmo mecanismo da emenda NOD-380 da ADR-008. A busca vai pelo índice
   do bot (`agente_memorias_por_agente`) e filtra a coluna já calculada. Medido em 2026-10-28: EXPLAIN como nod_app com
   5 mil memórias num bot, sem o GIN no plano. O GIN só custaria escrita.
5. **Visível.** O Raio-X do turno mostra "Memória: N de T no prompt · núcleo · busca do turno".
6. **Cache.** A memória fica na parte volátil (NOD-155) e, no claude-cli, a volátil vai na mensagem do turno, depois do
   histórico (NOD-188, `volatilNaMensagem`): variar o recall por turno não invalida o cache do histórico retomado. No
   codex o `promptSistema` vai inteiro como instrução: lá o recall variável muda as instruções do turno.

## Consequências

- Sinônimo e paráfrase sem termo em comum não acham ("documento da empresa" não acha "CNPJ"). O núcleo cobre o recente.
- Uma query a mais por turno, só quando a memória não cabe inteira (e, na retomada, a leitura da cadeia de turnos).
- **Desvio de "até 40, nada muda":** o teto de 6 mil caracteres vale sempre (a issue pede os dois). Um bot com até 40
  memórias que passa de 6 mil fica com as que cabem, das mais recentes, e texto acima de 1.500 entra cortado. O Raio-X
  mostra "N de T"; medir em produção quantos bots caem nesse caso.
- Entrada de fora (sala, colega) escolhe por palavra que memórias do próprio bot entram: só reordena o que o bot já
  tem, não expõe memória de outro bot.
- A migração reescreve `agente_memorias` (coluna gerada STORED) sob ACCESS EXCLUSIVE, com `lock_timeout` de 5 s; a
  versão anterior não lê a coluna.
- Os tetos são constantes datadas; ajustar é mudar um número.

## Gatilho de reversão

Se o Raio-X ou relatos mostrarem que a busca léxica erra o que importa com frequência (paráfrase), trocar
`buscarPorTexto` por busca semântica (pgvector) mantendo a mesma escolha pura. Se o p95 da emissão do plano subir por
causa da busca (bot com dezenas de milhares de memórias), abrir ADR de candidatos fora da RLS, como na emenda NOD-380.
