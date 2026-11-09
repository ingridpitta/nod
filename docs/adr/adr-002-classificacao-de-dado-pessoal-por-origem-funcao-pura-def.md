# ADR-002 — Classificação de dado pessoal por ORIGEM, função pura, default fechado

**Status** mantido

## Decisão

Inalterado. Classifica por procedência (conector, fonte, concessão), nunca por texto. Conector que não declarou: TOCA dado pessoal.

## O que mudou

Nada.

## Por quê

Este é o ADR que menos foi afetado pela mudança de premissa, e vale dizer por quê em voz alta porque várias revisões trataram 'dado pessoal sensível' como se fosse um problema de multi-tenant. Não é. Os ~240 clientes que uma só pessoa do time acompanha são dados que a organização opera todo dia, internamente, hoje. O nod interno vai ler exatamente esses dados. A LGPD não pergunta quantas empresas usam o software.


## Refinamento (2026-09-16): a mensagem de erro é canal de vazamento

Inverte-se o default do projeto de referência (onde `message` do DomainError vai crua ao browser): no nod a mensagem de erro só sai para o cliente se for declarada segura. `ErroDeDominio` (`src/domain/erro.ts`) carrega um `codigo` de união fechada e o detalhe em `cause`; `src/adapters/http/erros.ts` traduz o código por uma tabela FIXA (status + texto em pt-BR) e qualquer outro `Error` vira 500 `{codigo:'falha_interna', correlation_id}` mais uma linha de log — nunca `err.message`. O log (`src/obs/log.ts`) também nunca ecoa o campo `texto`. Isto protege o CHECK do ADR-004: de nada adianta proibir prosa na trilha se a mesma prosa sai pela resposta HTTP. Prova: `tests/integration/erros-seguros.test.ts`.

## Gatilho de reversão

Reabrir se (a) um conector declarado `nao_toca` entregar dado pessoal sensível — um incidente registrado basta: a classificação por ORIGEM teria falso-negativo, e a inspeção de conteúdo, hoje descartada, volta à mesa; (b) o default fechado ("não declarou = toca") deixar mais da metade dos conectores registrados sem declaração por 30 dias — sinal de que declarar custa demais e a classificação virou papel, não mecanismo; ou (c) a tabela fixa de `src/adapters/http/erros.ts` precisar de mensagem interpolada com dado do pedido para a pessoa entender o erro — aí o canal fechado está escondendo informação necessária, e a resposta é um mecanismo de mensagem segura por campo declarado, nunca voltar a expor `err.message`.

## Refinamento (2026-09-21): a classificação está NEUTRALIZADA, não removida

Decisão do Marlon, registrada como premissa de produto: o nod não está sendo construído para
tratar dado pessoal sensível. `CLASSIFICAR_ORIGEM_SENSIVEL = false` em `src/use-cases/pedir-aprovacao.ts`
desliga o cálculo — nenhum item novo nasce sensível, e o CHECK `item_sensivel_marcado_exige_pessoa`
passa a ser vacuamente verdadeiro.

A decisão acima fica como estava, e o mecanismo inteiro permanece no código: coluna, CHECK, enum,
declaração por conector e a função pura. Remover custaria ~78 arquivos e migração nova, com quatro
efeitos irreversíveis: `origem_sensivel` é carimbo do instante da criação e não existe coluna que
guarde qual conector originou o item (o `architecture.html:224` já dizia "impossível de retroagir");
a trilha é imutável por trigger e cada evento já gravou `sensiveis: N` (ADR-004); mensagens de
`resultado_aprovacao` já escritas trazem "(sensível, não aprovado)" no texto permanente; e o
Postgres não remove valor de enum. Neutralizar preserva a leitura do histórico e torna a volta uma
constante.

Consequência obrigatória: `VERSAO_APROVACAO_PERMANENTE` sobe de 1 para 2 (ADR-042), porque o
conjunto de itens que a regra "sempre permitir" deixa passar AUMENTOU.

O que NÃO depende desta premissa e continua valendo: trilha sem texto livre (ADR-004), erro que
nunca ecoa `message` (o refinamento de 2026-09-16 acima) e rótulo de métrica em união fechada
(ADR-017). As pessoas que usam o nod também são titulares.

Fica em aberto, e não é decisão de engenharia: o parecer jurídico nomeado em `product-spec.html:456`
("a regra de quando um item é 'dado pessoal sensível' é decisão jurídica"). Se o nod passar a
operar esse tipo de dado, este refinamento é o que se reverte primeiro.

### Gatilho de reversão deste refinamento

Reabrir (voltar `CLASSIFICAR_ORIGEM_SENSIVEL` para `true`) se qualquer conector registrado passar a
entregar dado pessoal sensível, ou se o parecer jurídico acima concluir que o nod trata
esse dado. Não é medição: é um fato sobre o negócio, e um só basta.
