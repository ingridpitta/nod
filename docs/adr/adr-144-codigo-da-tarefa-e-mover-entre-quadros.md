# ADR-144 — O código da tarefa é do quadro, o histórico tem autor e a tarefa muda de quadro sem acionar ninguém

Status: aceita (2026-11-02, NOD-416) · Estende [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (a ação
`quadro.mover_tarefa`) · Convive com a [ADR-140](adr-140-colunas-do-quadro-por-grupo.md) (colunas por grupo) e a
[ADR-141](adr-141-quadro-fluxo-continuo-meta-opcional.md) (fluxo contínuo).

## Contexto

A NOD-416 é a jornada de criar uma tarefa e encontrá-la no quadro. Até aqui, a tarefa criada sem status ia para A fazer e
o bot responsável começava sozinho. O card mostrava o id do Linear ou `#` com 4 caracteres do uuid, um código que não é
do quadro, não é sequencial e não tem link. A tarefa aberta não editava nada e não havia histórico. Também não dava para
passar uma tarefa para o quadro de outro bot.

## Decisão

1. **Criar cai no Backlog e não aciona ninguém.** Sem `status`, o `criar_tarefa` (tela e `gerir_quadro`) usa a primeira
   coluna de Não iniciado que não aciona (`colunaDeEntrada`). Para começar, a pessoa ou o bot passa `status: "afazer"`.
   - "Aciona" é a regra da main (NOD-417, ADR-142), sem predicado à parte: `acionaNaColuna` (A fazer, ou qualquer coluna
     de Iniciado fora de "Precisa de você" e Bloqueado) e `responsavelDe` (a passagem da coluna). Entre as de espera,
     `colunaDeEntrada` prefere a sem responsável; só com passagem em todas, a primeira delas. Sem nenhuma que não acione,
     a tarefa cai na de espera de sempre e o lote a marca para não começar (revisão 7 do PR #623).
   - O `importar_linear` fica de fora, de propósito (revisão 7): o item vem com o status do Linear e, sem status, cai em
     A fazer (`colunaDeEspera`) e o responsável começa, como antes da NOD-416. Trazer do Linear é trazer trabalho já
     escolhido para fazer; criar à mão é anotar. Quem quer só trazer passa `status: "backlog"` em cada item.
2. **O código é do quadro**, prefixo mais número (`ZE-12`), migração 0137:
   - O prefixo tem até 3 letras do nome do bot anfitrião, sem acento. Na colisão entre quadros do mesmo dono, ganha 2,
     3… (`prefixoDoNome`, puro). Fica fixo: renomear o bot não muda o prefixo.
   - O número vem de `quadros.proximo_numero`, sob a trava do quadro, então nunca repete. A tarefa de antes da 0137 é
     numerada no backfill. A que um servidor velho criou durante o deploy é numerada no próximo lote (`numero` nulável).
   - Criar e desfazer queima o código: o número não volta. Se o quadro desfeito (ou removido) já tinha tarefa com
     código, o prefixo dele também fica queimado, reservado pelos códigos que sobram: criar o quadro de Zé com uma
     tarefa, desfazer e criar de novo dá `ZE2`, depois `ZE3`… O quadro desfeito sem nenhuma tarefa não reserva nada.
   - `quadro_tarefa_codigos` guarda todo código que a tarefa já teve. O link antigo resolve, e a volta ao mesmo quadro
     reaproveita o código de lá.
   - O `TarefaDto` traz `codigo` e o `branch` sugerido (`ze-12-titulo-em-slug`). O resumo do bot traz o `codigo`, e o
     `gerir_quadro` aceita o código em `tarefa`, também o de antes de mudar de quadro (pela tabela de códigos).
3. **Histórico com autor** (`quadro_tarefa_historico`): criada, status, responsável, quadro e restaurada (o Desfazer
   devolveu a tarefa excluída, por quem desfez). Cada linha guarda de, para,
   autor (pessoa, agente ou regra) e hora. O autor sai de três fotos da tarefa, comparadas por função pura
   (`mudancasDaTarefa`):
   - antes do lote;
   - o que o autor pediu;
   - o resultado final.
   O que mudou entre o antes e o pedido é do autor. O que mudou entre o pedido e o final é da regra: começar leva a
   Fazendo, o bot sem conversa volta à espera e a coluna que saiu leva as tarefas dela. O histórico é gravado num INSERT
   só por lote. A tarefa que um lote exclui não ganha linha de "excluída": ela some do quadro, as linhas dela ficam no
   banco e só aparecem de novo se o Desfazer a devolver (com a linha "restaurada"). Uma linha de exclusão pediria outro
   valor na CHECK de `campo` e uma tela para tarefa excluída, que não existe. Remover o quadro apaga o histórico das
   tarefas dele; os códigos ficam, sem tarefa, e reservam o prefixo e o número: o quadro novo não reusa o
   prefixo e o link velho dá "não encontrada" (revisão 5 do PR #623).
4. **Mudar de quadro** (`mover_quadro`, ação `quadro.mover_tarefa`, `POST /agentes/:id/quadro/tarefas/:tid/mover`,
   risco `muda`):
   - A tarefa ganha o código do destino.
   - Cai na mesma coluna, se o destino tem; senão, na padrão do mesmo grupo (`statusNoDestino`).
   - A passagem do destino não vale no mover (revisão 7 do PR #623). A coluna de mesmo id ou a padrão do grupo que tem
     `responsavelDe` de outro bot é trocada pela primeira do mesmo grupo sem passagem (ou com a passagem do próprio
     responsável), fora "Precisa de você" e Bloqueado; em Não iniciado, também fora das que acionam
     (`colunaDoGrupoSemPassagem`). Sem nenhuma, fica a padrão. Cair numa coluna que aciona não começa ninguém: o mover
     só muda de lugar, e quem deve começar é a pessoa, mudando o Status depois.
   - A tarefa de Andamento sem turno vivo (nunca rodou ou o turno acabou) que perde a coluna no destino fica no grupo
     Andamento (o "grupo equivalente" da issue), mas fora da coluna de execução (Fazendo, ou a 1ª de andamento da
     pessoa), onde pareceria rodando: a do destino com o mesmo nome, senão a 1ª de Andamento que não é a de execução,
     "Precisa de você" nem Bloqueado e não tem responsável (não aciona ninguém) — no quadro padrão, Em revisão. Sem
     nenhuma assim, cai na de execução como antes, sem criar execução: o indicador do cartão vem do turno, e sem turno
     vivo ele não acende. Com o turno vivo, cai em Fazendo e o turno segue. O `voltarPara` da tarefa que espera (Precisa
     de você, Bloqueado) segue a mesma regra. Revisão 8 do PR #623; a QA anterior mandava para a entrada (Não iniciado),
     o que trocava de grupo. Suposição: "Em revisão" é a coluna neutra do Andamento; se a pessoa a usa como etapa que
     deveria acionar, ela põe responsável na coluna e o mover a pula.
   - Mantém o responsável, o turno e o histórico, com uma linha nova de "quadro". Os comentários (NOD-417) vão junto:
     `quadro_comentarios.quadro_id` muda com a tarefa, e remover o quadro de origem não os apaga (revisão 7).
   - Não começa nem para nenhum turno.
   - Vai sozinha no lote: sem lote próprio e sem Desfazer (voltar é mover de novo). Na tela, a pessoa escolhe o quadro
     e confirma no botão "Mover" (revisão do PR #623; WCAG 3.2.2).
   - Pelo bot, só num turno limpo e fora do fim da corrente (emenda da ADR-135). A rota confere que a tarefa está no
     quadro do `:id`; o quadro de um bot excluído não é destino.
   - Trava sempre o advisory dos prefixos antes (se algum quadro ainda não tem prefixo) e depois os dois quadros em
     ordem de id, a mesma ordem do lote e da criação do quadro (sem deadlock entre eles). Origem e destino seguem pelas
     linhas que a trava devolveu; o quadro que não voltou (removido enquanto o pedido esperava) recusa com
     `quadro_sumiu` antes de qualquer escrita (revisão 7).
   - A recusa que a tela distingue (`ja_neste_quadro`, `fora_do_quadro`, `tarefa_sumiu`, `quadro_sumiu`,
     `mudou_de_quadro`) viaja como chave tipada da falha até o erro (`ErroDoMover`); a rota a põe em `motivo` sem
     comparar texto (revisão 7).
   - O Desfazer de um lote velho do quadro de origem não puxa a tarefa de volta. A barreira é `mudouDeQuadroDepois`:
     mover tira o Desfazer do último lote **nos dois quadros**, o de origem (a tarefa saiu, `de`) e o de destino (entrou,
     `quadro_id`). Se o último lote de um deles é anterior ao mover, ele não se desfaz mais: o recibo não oferece o
     Desfazer e o `desfazer` falha com "uma tarefa mudou de quadro (entrou ou saiu deste) depois do último lote". O lote
     feito depois do mover se desfaz normalmente. A consulta (`SQL_MUDOU_DE_QUADRO_DEPOIS`) tem um `exists` por índice
     parcial da 0137; `tests/conformidade/mudou-de-quadro-indice.test.ts` prova, num banco novo com 60 mil linhas e o
     ANALYZE do dono, que o ramo de `quadro_id` usa `_entrou` e o de `de` usa `_saiu`, cada um com a sua coluna na
     Index Cond (revisão 7). Sem estatísticas os dois índices empatam, por isso o teste não roda como `nod_app`.
   - No quadro velho, o código antigo vira `nao_encontrado` com a dica "agora é MA-3, no quadro de Maria". O id (uuid)
     não muda no mover, e o bot que procura a tarefa pelo id no quadro velho também ouve a dica ("a tarefa … está no
     quadro de Maria, como MA-3"). O próprio `mover_quadro` pelo id acha a tarefa em qualquer quadro da pessoa, sem
     precisar de dica (revisão 7).
5. **O link** `?tarefa=ZE-12` usa `GET /quadro/tarefas/:codigo`, sob RLS: outro dono recebe 404. O link abre a conversa
   do bot e a tarefa em tela cheia no Quadro. A tarefa aberta põe o código atual na URL (`replaceState`), e voltar ao
   quadro tira. O código desconhecido mostra "Tarefa ZE-12 não encontrada." Sem sessão, o código fica guardado na sessão
   do navegador até o login. Se a tarefa saiu do quadro entre a busca do código e a leitura, o quadro abre e a região
   viva diz "Tarefa não encontrada neste quadro." (revisão 7).
6. **Na tela:**
   - "Nova tarefa…" fica na barra.
   - A tarefa aberta tem Status, agrupado por grupo, e Responsável como `<select>`. Cada mudança é um lote com Desfazer.
     Pelo teclado, a seta só escolhe: a mudança vale no Enter ou ao sair do campo (WCAG 3.2.2); com o mouse, na hora.
     O Status não oferece "Precisa de você" (pede pergunta) e o Responsável não oferece o Nod.
   - Quando a mudança faz um bot começar, o recibo diz "Ada começou", com o Desfazer do lote. Tudo passa por uma função
     só (`mudarNaTarefaAberta`). Mudar o Status para uma coluna com responsável pede o mesmo "Confirmar · Não iniciar
     ainda" do card (NOD-417), embaixo do campo; Esc ou clicar fora desiste e o select volta ao valor de verdade.
   - "Mover para" lista os outros quadros da pessoa (`GET /quadros`). Depois de mover, a tela vai junto: abre a conversa
     do bot destino com a tarefa aberta no Quadro (o caminho do link) e diz lá "… foi para o quadro de Caio como CA-1".
     Sem o bot à mão, fica no quadro de origem com o mesmo aviso (QA do PR #623). O select ocupa a linha, corta com
     reticências e leva o nome no `title`.
   - A tarefa aberta mostra o branch e o Histórico ("Você · Status: Backlog → A fazer · 14:32").

## Consequências

- Os bots que contavam com o começo automático passam a mandar `status: "afazer"`. A descrição do `gerir_quadro`
  explica isso.
- O responsável continua sendo um bot ou ninguém. "Precisa de você" é a pessoa, e a outra pessoa (squad) fica para a v2.
- O backfill do prefixo em SQL e a regra em TS podem divergir em nome exótico. O efeito é só cosmético e acontece uma
  vez.
- Comentários e anexos da tarefa aberta ficam para a NOD-417 e a NOD-419.

## Gatilho de reversão

Se o quadro deixar de ser um por bot, ou se a pessoa pedir outro prefixo, o prefixo passa a ser escolhido por ela, e os
códigos antigos continuam resolvendo pela tabela de códigos. Se mover sem Desfazer fizer alguém perder uma tarefa, o
mover vira lote com Desfazer.
