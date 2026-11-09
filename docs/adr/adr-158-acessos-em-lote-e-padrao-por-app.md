# ADR-158 — Acessos dos apps em lote, padrão por app e o clique otimista

Status: aceita (2026-11-08, ADA-241) · Emenda a [ADR-044](adr-044-acesso-em-um-clique-tambem-na-rotina.md) (quem concede) e estende a
[ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (paridade tela × chat).

## Contexto

Feedback da Helena Pitta (Lumen) na gaveta "Quem pode usar o Gmail?": o nível (Nenhum / Ler / Ler e alterar) só mudava
bot a bot, cada clique esperava o servidor e todo bot novo nascia sem acesso. A meta do quadro é que tudo o que a tela
faz qualquer bot faça pela conversa.

## Decisão

1. **Um executor só** (`src/use-cases/acoes/acessos.ts`) para três ações do registro (`src/domain/acoes/acessos.ts`):
   `acessos.dar_em_lote`, `acessos.desfazer_lote` e `apps.padrao`. A rota da tela e a ferramenta `gerir_acessos` chamam
   o mesmo caso de uso; o contrato tela × chat está em `tests/integration/paridade-acessos.test.ts`.
2. **Dados** (migração 0156, aditiva, escopada por `nod_escopar_tabela`): `acessos_padrao` (o nível com que o bot novo
   nasce, por app; sem linha = Nenhum), `acessos_definidos` (a marca `pessoa` ou `padrao` de quem já teve o nível
   decidido) e `acessos_lotes` (antes, depois e a marca de antes de cada bot, com a chave de idempotência do clique).
3. **Regras do lote.** "Todos" com Ler não rebaixa quem tem Ler e alterar ou personalizado; a seleção manual recebe o
   nível exato. Ler e alterar exige `confirmado` (a tela pergunta ali mesmo). Até 100 bots por lote. A mesma chave
   devolve o mesmo lote (`ja_feito`); a chave em outro nível é recusada.
4. **Desfazer** vale por 24 h e uma vez (o lote fica travado `for update`): volta só quem ainda está como o lote deixou,
   com o conjunto exato e a marca de antes (quem era "não definido" volta a herdar o padrão). Quem mudou depois fica e
   é listado.
5. **Padrão do app.** Bot novo nasce com ele (`bots.criar`, `criar_bots` e o onboarding chamam `aplicarPadroes`); com
   `aplicar` (padrão: sim), quem segue o padrão (sem marca e sem acesso, ou marca `padrao` ainda no nível anterior)
   passa junto; a escolha da pessoa nunca é tocada. App desligado só guarda o padrão.
6. **Emenda à ADR-044.** `src/use-cases/acoes/acessos.ts` entra nas exceções do `no-restricted-imports` de
   `conceder/concederLote`: roda pelo clique da pessoa ou pelo modo do bot (`porRegra`), mas **Ler e alterar sempre vira
   card** (`acesso_escrita`, motivo `ligar_total` no risco), em qualquer modo; depois de conteúdo de fora, dar acesso
   também vira card. O padrão de escrita foi a dona quem confirmou, então vale também para bots criados por bot.
7. **Chat.** `gerir_acessos` (`acao`: `lote` | `desfazer` | `padrao`) reaproveita o card `lote_bots`; recusa fora da
   conversa (profundidade > 0); o recibo `acessos.mudados` diz "Pedido por {pessoa} via bot {bot}" e devolve o `lote_id`.
8. **Clique otimista** (`web/lib/acessos-otimistas.ts`): o nível aparece no próximo desenho, síncrono; cada par
   bot × app guarda o número do clique e o último vence; erro volta só os pares daquele clique, com aviso.

## Gatilho de reversão

Se o Desfazer por marca de antes gerar divergência entre "segue o padrão" na tela e o que o servidor aplica (bot que
deveria herdar e não herdou), trocar a marca por um campo explícito "nível escolhido" por bot × app.
