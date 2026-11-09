# ADR-153 — Quadro ↔ bot é N:N; o projeto é da pessoa

Status: proposta (2026-11-07, ADA-14) · Revisa a 0133 ("um quadro por bot anfitrião") · Emenda a
[ADR-141](adr-141-quadro-fluxo-continuo-meta-opcional.md) §4, a [ADR-144](adr-144-codigo-da-tarefa-e-mover-entre-quadros.md)
§2 e a [ADR-146](adr-146-paginas-do-bot-e-apps.md) §2. Plano: [docs/planos/ADA-14.md](../planos/ADA-14.md).

## Contexto

Desde a 0133, `quadros_um_por_agente` amarra um quadro a um bot, e a URL, o `gerir_quadro` e a página Tarefas acham o
quadro pelo bot. A ADA-14 pede vários quadros por bot, agrupados ou não em projetos, e um quadro em mais de um bot. A
tarefa, o código, as colunas, a passagem e os membros já são por quadro; só o eixo bot → quadro muda.

## Decisão

1. **`quadro_bots`** (N:N) diz em que bots o quadro aparece; um é o padrão de cada bot (índice parcial). `quadros.agente_id`
   segue como **bot dono** (prefixo inicial, aviso de risco sem responsável único, nome conferido no remover) e também
   tem linha em `quadro_bots`.
2. **Projeto é da pessoa** (`projetos`, nome único sem acento/caixa, descrição, meta e prazo opcionais, arquivável); o
   quadro está em 0 ou 1 projeto. Progresso só com meta, pela regra do quadro (ADR-141).
3. **O quadro aberto é escolhido dentro do app Quadro** (o seletor); a pílula (ADA-8) continua o único caminho até ele.
   Ao abrir: o último aberto naquele bot (`preferencias.quadro_aberto`), senão o padrão.
4. **As rotas `/agentes/:id/quadro…` ganham `?quadro=`**; sem ele, o padrão. O quadro tem de estar vinculado ao bot (senão
   404). Os ids de ação não mudam.
5. **O prefixo vem do nome do quadro** quando ele nasce (o bot só para o quadro migrado e o sem nome) e é fixo.
6. **Remover** apaga um quadro; o padrão passa ao próximo vínculo; o bot volta a agente comum só no último. Excluir o bot
   dono passa o dono ao próximo vínculo antes.
7. **Migração em duas fases:** a 0152 cria e faz o backfill (todo quadro de hoje vira o padrão do seu bot) mantendo o
   índice único; a 0156 (era 0153; renumerada no merge com a ADA-232) tira o índice depois de o servidor novo estar no ar. Flag `NOD_QUADROS_N` para o 2º quadro.

## Consequências

- `doAgente` sai do repo; cada chamada escolhe entre o padrão e o quadro explícito.
- A página Tarefas continua uma só por bot e conta 1 no limite de 12 páginas.
- Quem participa (ADR-143) não vê os projetos da dona.

## Gatilho de reversão

Se a pessoa precisar de quadros com regras diferentes por bot (passagem que vale num bot e não noutro), o vínculo
deixa de bastar e o quadro compartilhado vira cópia sincronizada.
