# ADR-025 — Quem pede e quem paga são dois campos distintos da autoria composta

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

A autoria composta do ADR-023 ganha o campo conta_de_execucao, separado de sob_procuracao_de. sob_procuracao_de nomeia quem PEDIU o trabalho; conta_de_execucao nomeia de quem é a assinatura e a cota que o turno queima. Num turno normal os dois são a mesma pessoa. Numa delegação entre máquinas, não são — e a diferença é a única coisa que torna a trilha verdadeira. Toda delegação entre máquinas exige uma PROCURAÇÃO prévia no Postgres, com owner_id do dono da cota, classes de tarefa permitidas e teto diário; sem linha de procuração, a resposta é negada.

## Contexto

O ADR-014 invertido diz que o trabalho do dia roda LOCAL com a assinatura da pessoa. Logo, todo turno provocado por OUTRA pessoa queima assinatura alheia. Verifiquei por busca que nem o hermes-agent nem o OpenMausBot têm qualquer noção de cota no caminho de delegação — os únicos budgets são de tempo. Isso não é lacuna de leitura: ambos são monousuário ou mono-harness por desenho e a pergunta nunca precisou existir. O nod é a primeira topologia onde ela é obrigatória.

## Alternativas rejeitadas

### Um único campo de autoria, como hoje

O ADR-004 congela a trilha por trigger. Um campo único registra uma mentira em toda delegação cruzada e a torna permanente. Num time que audita quem tocou dado pessoal sensível, evidência que parece forte e não é vale menos que nenhuma evidência.

### Aprovação no momento da delegação, em vez de procuração prévia

Cria uma segunda fila de decisões com relógio, competindo com 'Sua vez', para um ato que se repete. Procuração prévia reaproveita 'Convidar (não promover)': o dono convida o bot do colega uma vez.

### Checar a cota antes de aceitar o envelope

O ADR-019 diz que a sonda pergunta ao CLI e nunca lê a credencial, então saldo real só se descobre na execução. Cota esgotada é um estado de resultado, não um gate de aceitação — e por isso precisa de render próprio com relógio, não de um recibo tardio.

## Evidência

agent/turn_author.py::bot_author_id já qualifica origem por máquina ('bot:<connection>/<profile>'), então o campo existe no Hermes — só não governa nada, e tui_gateway/methods_bot_relay.py:95 admite isso: 'the author labels memory only and grants nothing'. index.ts:9880 do OMB mostra a forma correta do outro lado: o remetente derivado do token, nunca do texto.

## Consequências

- Duas colunas no schema desde já, mesmo antes de a delegação entre máquinas existir — enxertar depois é retrabalho garantido.
- Exige decidir o que é uma 'classe de tarefa delegável', que é desenho de produto não resolvido e precisa de gente, não de código.
- Cota esgotada entra no enum de motivo de passe do ADR-004.

## Reversibilidade

Baixa depois que a trilha imutável começar a gravar. Por isso as colunas entram agora, ainda que fiquem iguais por meses.

