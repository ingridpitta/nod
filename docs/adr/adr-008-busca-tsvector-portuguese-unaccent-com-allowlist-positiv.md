# ADR-008 — Busca tsvector portuguese + unaccent com allowlist positiva

**Status** revisado

## Decisão

Fixar AGORA só o que é caro em base populada: a configuração de busca própria (unaccent + portuguese_stem) criada como OBJETO DE BANCO, a coluna TSVECTOR GENERATED ALWAYS AS STORED, e a ALLOWLIST POSITIVA (o que não está na lista vira NULL). ESPERAM até haver conteúdo: o índice GIN, a extensão btree_gin, e o procedimento genérico de rebuild. Quando o índice vier, nasce escopado por (owner_id, search_tsv). Busca continua não sendo fronteira de acesso: devolve ids e a releitura reaplica a policy.

## O que mudou

Índice GIN, btree_gin e rebuild-busca.sql saem do primeiro commit e esperam volume. A configuração e a allowlist ficam.

## Por quê

Este é o ADR onde a pergunta 'o que pode simplesmente ESPERAR?' dá a resposta mais clara, e nenhuma das quatro frentes a fez. Três coisas se separam. A CONFIGURAÇÃO é cara e recorrente — trocar depois é DROP COLUMN + ADD COLUMN gerada + CREATE INDEX com a tabela em ACCESS EXCLUSIVE, e o Buzz nem tentou em base populada. Fica. A ALLOWLIST protege por omissão e o Buzz provou o custo de aprender errado (0001 nasceu com denylist, 0005 fez DROP+ADD, 0008 inverteu). Fica. O ÍNDICE e o REBUILD são caros só depois de haver volume — e um time pequeno que ainda não gerou um único documento pode viver com ILIKE por seis meses.


## Emenda de 2026-10-28 (NOD-380): busca de mensagens por pedaço, por varredura do tenant sob a RLS

A busca do celular acha mensagens por PEDAÇO de palavra ("desig" acha "design"), sem acento e sem caixa. O tsvector desta
ADR é por radical de palavra inteira e não acha prefixo nem meio de palavra; por isso as mensagens usam
`nod_sem_acento(texto) like '%…%'` (função IMMUTABLE da 0116), com o escape do LIKE feito depois de normalizar, e a busca de
documentos continua como está. O resto da decisão vale: a busca não é fronteira de acesso (roda como nod_app sob a RLS de
`mensagens` e `conversas`, sem policy nova).

**Sem índice trigram, contra o que a issue pedia.** `mensagens` tem RLS com FORCE, e sob RLS o planner só usa como condição
de índice um filtro LEAKPROOF; `textlike` e `nod_sem_acento` não são, e o GIN `gin_trgm_ops` nunca entra no plano do nod_app
(provado na revisão do PR #551: com RLS o filtro vira `Filter` depois do btree do tenant; sem RLS, o mesmo índice vira
`Bitmap Index Scan`). Marcar LEAKPROOF exige superusuário (o Cloud SQL não dá), e SECURITY DEFINER não escapa do FORCE.
Alternativas recusadas por agora: uma função de candidatos sob um papel BYPASSRLS (abre a fronteira da ADR-003) e uma
tabela de busca à parte (tem o mesmo problema sob RLS). A consulta varre as mensagens do tenant, com `statement_timeout` de
4 s; estourado, a web mostra "Não deu para buscar nas mensagens · Tentar de novo" e mantém Bots e Salas. Para não esgotar o
pool, cada instância aceita no máximo 2 buscas em voo por pessoa, 3 por tenant e 4 no total (menos com pool pequeno: um terço
do `NOD_DB_POOL_MAX`); acima disso responde 429, e a web repete por até 4,8 s. O pedido que a web aborta (a pessoa digitou
outra letra) antes de a consulta sair não a manda; a que já saiu vai até o fim (cancelar pelo driver dentro da
transação prendia a conexão), e é esse o teto que o gatilho abaixo vigia. O banco devolve só uma janela de 2000
caracteres em volta do acerto, e o trecho tem teto de entrada (fala de 1 MB não trava o Node).

**Gatilho de reversão**: busca de mensagens com p95 acima de 2 s, ou timeouts em produção, ou um tenant com mais de
100 mil mensagens de texto. Aí abrir uma ADR sobre a função de candidatos com BYPASSRLS (só ids, com o tenant explícito, e
a consulta de fora sob a RLS decidindo o que a pessoa lê).
