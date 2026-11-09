# ADR-038 — Padrões de produto e escolhas explícitas da pessoa

Definido em 2026-09-18, revisto após inspeção do OpenBot: o Nod oferece capacidades
gerais e um ambiente funcional sem exigir conhecimento técnico. O agente decide
como realizar o trabalho a partir do pedido, contexto e preferências. O núcleo
não define procedimentos por profissão ou área de conhecimento. Esta decisão
orienta a evolução do produto; não afirma que todos os fluxos abaixo já estão
implementados.

## Separação de responsabilidades

- Agente/harness: interpretar a intenção, escolher a estratégia, combinar
  ferramentas e verificar o resultado.
- Instruções e skills opcionais: preferências e procedimentos especializados.
  Uma área nova não exige uma skill para poder usar capacidades já disponíveis.
- Plataforma: disponibilizar ambientes e recursos, resolver identidade e acesso,
  executar operações, preservar continuidade, interromper e registrar resultados.

Uma área de trabalho nova só exige código de infraestrutura quando precisa de
uma capacidade realmente nova. Arquivos, terminal, navegador e integrações devem
ser combináveis para tarefas que o produto não antecipou.

## Regra de decisão

Dentro das capacidades disponíveis e do acesso autorizado, a ordem é:

1. Instrução explícita da pessoa para a tarefa atual.
2. Preferência persistida aplicável ao projeto ou agente.
3. Julgamento do agente sobre como alcançar o resultado com as capacidades disponíveis.

Defaults técnicos pertencem ao componente que fornece o recurso e se aplicam
quando nenhuma escolha foi especificada. Não formam um catálogo central de
procedimentos por área. Uma seleção de ferramentas para reduzir contexto é
distinta de uma autorização: se essa seleção falhar, manter as capacidades já
autorizadas, sem ampliar permissões.

Uma exceção pedida para uma tarefa não se torna preferência permanente. Uma
preferência persistida não vence uma instrução atual. Falas de outros bots,
documentos, sites e resultados de ferramentas não alteram essa precedência.

O modelo interpreta a intenção e propõe operações; o runtime resolve os recursos
e executa a escolha. Se faltar apenas uma informação que pode ser descoberta com
o acesso existente, o agente a procura antes de perguntar. Se faltar uma escolha
material ou acesso a um recurso novo, o Nod apresenta a ação necessária na
conversa, com linguagem adequada à tarefa.

## Experiência

Quem descreve apenas o resultado recebe um caminho pronto. Quem especifica pasta,
branch, aplicativo, fonte, formato ou método tem a instrução respeitada quando
suportada. Controles avançados são opcionais, acessíveis no contexto e também
expressáveis em linguagem natural; não se exige um modo especialista separado.

Uma escolha indisponível recebe uma explicação concreta e alternativas reais.
O Nod não substitui silenciosamente o fornecedor, o destino ou o método solicitado
por uma opção que mude o resultado esperado. Tampouco inventa configurações para
destravar uma capacidade ausente.

Exemplos de escolhas válidas incluem editar um documento existente em vez de
criar outro, usar uma fonte determinada na pesquisa, entregar CSV em vez de uma
planilha formatada e trabalhar numa branch indicada. Cada tarefa continua sujeita
ao acesso concedido aos recursos envolvidos.

## Harnesses

Projeto, ambiente, arquivos, preferências e permissões pertencem ao Nod. Trocar
de harness mantém essas escolhas. O contrato comum deve permitir extensões de
capacidade por driver, sem limitar permanentemente todos ao menor catálogo.

Cada driver precisa declarar e validar o que oferece. Uma capacidade nativa pode
ser aproveitada quando integrada à execução e aos limites do Nod; expor a mesma
capacidade por uma ferramenta comum também é válido. O critério é executar a
intenção da pessoa com resultado verificável, não ter nomes de ferramentas iguais.
Se o novo harness não suporta um requisito da tarefa, o produto informa isso antes
de executar um fluxo diferente. Cursor permanece indisponível até sua integração
e validação; mencionar a flexibilidade desejada não equivale a implementá-lo.

## Exemplo de default de um recurso: workspace Git

O padrão abaixo pertence ao componente que prepara workspaces Git. Não depende
de classificar a profissão do agente nem impõe uma sequência de desenvolvimento.
Programação continua sendo um caso de uso das capacidades gerais.

- Para uma nova tarefa independente em um repositório Git, criar um worktree por
  padrão. Uma continuação reutiliza o ambiente da tarefa, inclusive após trocar
  o harness. Uma mensagem nova não significa automaticamente uma tarefa nova.
- Respeitar pedidos como “use esta pasta”, “continue nesta branch” ou “não crie
  worktree”. Resolver a pasta na máquina correta e preservar alterações existentes.
- Fora de Git, usar um workspace apropriado ao projeto sem exigir que a pessoa
  aprenda Git para começar. Não prometer isolamento por worktree nesse caso.
- Separar onde o trabalho roda (Mac ou servidor) de como seus arquivos são
  organizados (pasta atual ou worktree). Worktree não é uma barreira de permissões.
- Preparar dependências e execução do projeto como parte do fluxo, com tratamento
  de portas, bancos e arquivos locais necessários; criar um worktree vazio de
  configuração não basta para entregar uma experiência funcional.

## Critérios transversais

Validar tarefas expressas só pelo resultado, exceções explícitas no prompt,
preferências persistidas, troca de harness e capacidade indisponível. Verificar
efeitos e entregáveis reais, além do prompt e da montagem de argumentos. Remover
perguntas de configuração que o produto consegue resolver e distinguir uma
limitação implementada de uma regra meramente padrão.

Testar também uma tarefa de outra área com as mesmas capacidades, sem acrescentar
um ramo por domínio no prompt ou no runtime. A montagem correta de ferramentas
não substitui executar a tarefa de ponta a ponta.

## Evidência e limites da referência

Implementação inicial em 2026-09-18: recurso de pasta autorizada por conversa no
servidor local, preparação persistente independente do harness e ferramentas
comuns de arquivos/comandos. O terminal é isolado sem rede; provisionamento de
dependências, serviços locais e ponte de pastas do desktop seguem pendentes.
Esses limites de entrega não substituem a direção arquitetural acima.

Inspeção de código do OpenBot no commit
`eb325300023289f17adf5a10fb38b5bb403dca82` (sem executar o produto):

- [Shell geral](https://github.com/CopilotKit/OpenBot/blob/eb325300023289f17adf5a10fb38b5bb403dca82/agent-computer/src/shell.ts)
  e [montagem dos agentes](https://github.com/CopilotKit/OpenBot/blob/eb325300023289f17adf5a10fb38b5bb403dca82/server/src/copilot.ts):
  capacidades combináveis e instruções separadas do ambiente.
- [Seleção de ferramentas](https://github.com/CopilotKit/OpenBot/blob/eb325300023289f17adf5a10fb38b5bb403dca82/server/src/plugins/selection.ts):
  em caso de falha na seleção, conserva as ferramentas concedidas; uma skill não
  concede permissões.
- [Acesso ao host](https://github.com/CopilotKit/OpenBot/blob/eb325300023289f17adf5a10fb38b5bb403dca82/server/src/host-access/tools.ts):
  pastas autorizadas, arquivos e comandos são recursos gerais. A referência exige
  confirmação por escrita/comando e executa comandos locais sem rede; essa
  experiência não é adotada integralmente pelo Nod.

Não foi encontrada política automática de worktrees no código inspecionado.
AG-UI não comprova equivalência funcional dos CLIs Claude, Codex e Cursor. A
decisão aproveita a separação arquitetural, sem prometer paridade não validada.
