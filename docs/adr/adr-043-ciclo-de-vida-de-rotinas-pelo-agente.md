# ADR-043 — O agente cuida do ciclo de vida da rotina, não só do nascimento

Status: aceito · Data: 2026-09-21 · Emenda ADR-011, ADR-033 e ADR-034.

## Contexto

`criar_rotina` era a única ferramenta de rotina. A pessoa criava por conversa e, a partir dali,
qualquer mudança exigia sair do chat e ir na web. Pausar, reativar, mudar horário e excluir eram
possíveis pela interface, mas invisíveis para o agente.

O bloqueio de fundo não era a falta de ferramentas: `montarPromptSistema` injetava o diretório de
colegas e o catálogo de conectores, e nada sobre as rotinas do próprio agente. Sem isso "pausa a
rotina do relatório" era insolúvel — não havia id para resolver. `Rotina` também não tem campo
`nome`, e o teto é de 50 por agente: identificar por instrução livre não escala.

## Decisão

**O inventário de rotinas entra no prompt**, no formato do diretório de colegas: `{id, quando,
estado, instrucao}`, ordenado por id, com a instrução truncada em 160. Entra INTEIRO — cortar
esconderia justamente a rotina que a pessoa quer mexer — e só para quem tem ferramenta que age
sobre rotina existente; com `criar_rotina` sozinha seria contexto morto em prompt cacheado.

**O modelo escolhe pelo id; o domínio valida.** As ferramentas recebem `rotina_id` tipado, nunca
uma descrição em texto para o servidor adivinhar. É a Regra 9 de `rotina-texto.ts` ("nenhum parser
de intenção sobrevive aqui") valendo também para o ciclo de vida. Quando o pedido servir para mais
de uma rotina, o prompt manda chamar `pedir_a_pessoa` em vez de escolher.

**Cinco ferramentas novas, em dois regimes:**

- `listar_rotinas`, `pausar_rotina`, `reativar_rotina` **aplicam direto**. São reversíveis em um
  clique e já são ato de um botão na web; pedir confirmação seria cerimônia que a própria interface
  não pede.
- `atualizar_rotina` e `excluir_rotina` **só propõem**, com proposta + decisão em "Sua vez". Mudar
  quando/o que a rotina faz sozinha e excluir não são reversíveis.

**Catálogo só em conversa e sala.** Fora de propósito em criação (não há rotina ainda) e peer
(mexer em rotina a pedido de outro bot burlaria o corte de segundo salto do ADR-035). E
deliberadamente fora do modo `rotina`: um turno acordado por agendamento que pudesse se pausar
sozinho viraria uma rotina que se desliga por conta própria, e aquele modo é "a própria execução".

**Exclusão é recuperável**, como a de agentes (ADR-034): `excluido_em` some das listagens, do teto
de 50 e do tick do scheduler, sem apagar linha. A trilha é imutável (ADR-004) e as execuções
passadas continuam. Não há purga nesta rodada. Um turno já em execução pode terminar — mesmo limite
do resto do nod.

**Atualização é parcial e revalidada inteira.** `validarAtualizacaoRotina` funde o pedido sobre a
rotina atual e chama o mesmo `validarRotinaNormalizada`, para não existir um segundo caminho de
validação divergindo do primeiro: cron novo com fuso antigo é checado junto. Pedido que não muda
nada é `entrada_invalida`, em vez de gastar a confirmação da pessoa numa proposta vazia.

## Escopo e concorrência

O agente só mexe em rotina DELE: `rotinas.buscar` é tenant-wide pela perna de leitura da RLS, então
sem o filtro por `agenteId` um bot pausaria a rotina de outro. `atualizar` e `excluir` repetem o
filtro `owner_id` de `atualizarEstado`/`reagendar` — a perna extra e 'equipe' só ABREM LEITURA.

Nenhuma policy é ampliada: a 0016 só acrescenta coluna e valores de enum. O `estado` continua
computado por `COLUNAS`, então geração antiga do agente (ADR-034) segue lendo como `pausada`.

Conferido em 2026-09-21: `nod_rotina_agente_ativo` é `BEFORE INSERT OR UPDATE OF estado ... WHEN
(NEW.estado = 'ativa')`, então atualizar e excluir não passam pelo trigger e não precisam de
tratamento de `agente inativo` (23514).

A ligação proposta↔rotina nos dois kinds novos é `payload.rotinaId`, e **não** a igualdade
`rotina.id == proposta.id == decisao.id` que o nascimento usa: aqui a rotina já existe e tem id.

## Validação

`tests/integration/rotinas-do-agente.test.ts` cobre o ciclo, isolamento entre agentes, proposta que
não aplica nada, atualização parcial, idempotência da confirmação e rotina excluída recusando toda
ferramenta. Esse último pegou um bug real: `alternar()` não checava `excluido_em`, e `pausar_rotina`
ainda aceitava rotina excluída.

Verde em lint, typecheck (4 projetos), fence:domain, 474 unit, 236 integration e 64 concurrency.

## Gatilho de reversão

Se a pessoa reclamar de confirmar demais — em especial se `atualizar_rotina` virar rotina de dois
passos no uso real —, rever o segundo regime: mudança que só mexe em texto (instrução/fonte/
entregável), sem tocar cron nem fuso, pode passar a aplicar direto como pausar. Excluir não.

Se o inventário no prompt passar a pesar (agente perto das 50 rotinas, com instruções longas),
o primeiro corte é a instrução — reduzir `INSTRUCAO_ROTINA_NO_PROMPT` —, nunca o número de rotinas.

## Não implementado

Restaurar rotina excluída (não há tela nem ferramenta; a linha continua no banco, então é possível
depois), purga definitiva, e edição de rotina de outra pessoa sobre agente de equipe.

## Emenda — ver_agenda (NOD-85, 2026-10-29)

O inventário no prompt e as ferramentas de escrita continuam só com as rotinas do agente do turno. A
NOD-85 abre uma exceção de LEITURA: `ver_agenda` ("o que roda amanhã?", "o que deu problema essa
semana?") projeta a agenda de TODAS as rotinas da própria pessoa, de todos os bots dela, porque a
pergunta é sobre o dia dela e não sobre um bot. Decidido pela PM (Ada) na issue.

- Só as rotinas cuja dona é a pessoa do escopo (`ownerId === pessoaId`). A de colega sobre bot de
  equipe fica fora: a instrução dela é texto de outra pessoa e não chega ao modelo como conteúdo
  confiável. Ela aparece só na tela (GET rotinas/agenda), sem ações.
- Só leitura (`readOnlyHint`), até 5 linhas com título curto; nada muda por ela. Mudar horário segue
  por `atualizar_rotina` (card), pausar pelo chat aplica direto, como na decisão acima.
- Nos modos em que a pessoa dona lê o histórico (conversa, criação, ligação), junto de
  `buscar_conversas`/`ler_conversa`; fora da sala e de turno feito a pedido de outro bot.

Gatilho de reversão: se um bot passar a agir sobre rotina de outro bot a partir do que leu na
agenda (pedir para pausar, mudar ou "rodar agora" uma rotina que não é dele), restringir
`ver_agenda` às rotinas do agente do turno e deixar a visão geral só na tela.

## Emenda NOD-412 (2026-11-11): pausar até uma data

`pausar_rotina` ganha `ate` (opcional), e a tela ganha "Pausar até amanhã / segunda / …". A data é hora LOCAL no fuso
da rotina (`AAAA-MM-DD` = 00:00 desse dia; `AAAA-MM-DDTHH:MM`), vira um instante absoluto (`rotinas.retomar_em`,
migração 0167) e vale de agora + 1 min a 366 dias. Continua aplicando direto, como a pausa sem data: é reversível em um
clique (Ativar limpa a data). O cartão de confirmação do protótipo da NOD-85 não entrou: contrariaria a decisão acima.

- Horário de verão: hora que não existe vale o primeiro instante depois do salto; hora repetida, a primeira ocorrência.
- Quem reativa é o agendador, no tick de 30 s, antes de procurar as vencidas, pela mesma porta da tela (`pausarRotina`,
  autoria `regra:retomar`). A próxima execução é recalculada a partir do instante da volta; as janelas perdidas na pausa
  não são repostas (a regra de reativar de 2026-09-16), mas a janela na hora exata da volta roda. A volta trava a linha e
  relê: data trocada, ou ativada e pausada sem data no meio, não é atropelada.
- O servidor antigo (cor velha do deploy, rollback de imagem) ativa sem saber da data: o trigger `nod_rotina_limpa_retomar`
  (0167) a apaga quando a pausada vira ativa.
- Rotina que não pode voltar quando a data chega (bot excluído, geração antiga, rotina excluída): a data é apagada e
  ela segue pausada, sem ser tentada a cada tick.
- `rotinas.pausar` e `rotinas.ativar` passam a `vivo` no registro de ações (ADR-135), com o contrato em
  tests/integration/paridade-pausar-rotina.test.ts.

Gatilho de reversão: se pessoas pausarem "até" e esquecerem que a rotina volta (reclamação de execução inesperada),
avisar na conversa da rotina uma hora antes da volta, ou pedir confirmação no chat quando a data passa de 7 dias.
