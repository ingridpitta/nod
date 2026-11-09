# ADR-032 — Bots como contatos e colaboração visível

Status: aceito · Data: 2026-09-17

## Decisão

A primeira versão prioriza as jornadas do Grok Bot: criar bots, conversar, consultar outros bots,
trabalhar em salas e agendar rotinas. A execução passa pelo Claude Code instalado na máquina,
usando o modelo via assinatura da pessoa (ADR-014). Não há dependência da API do Grok nem modelo offline.

A pessoa pode criar um bot informando nome, especialidade e instruções num formulário. Um perfil
com nome e descrição nasce confirmado: o preenchimento da pessoa já é a confirmação. A criação
conversacional sem perfil continua disponível pela API. Isso amplia a EMENDA 17, que limitava a
criação inicial ao nome opcional; não muda a confirmação das propostas feitas pelo modelo.

O plano de turno inclui um diretório dos outros bots confirmados, visíveis e não ocultos da mesma
dona, com id, nome, especialidade e até 500 caracteres de descrição. São no máximo 50 entradas,
ordenadas por nome. O modelo usa o id em `perguntar_a_bot`; o nome permanece aceito quando não é
ambíguo. O diretório descreve capacidades, não concede acessos a conectores.

O pedido a outro bot gera uma mensagem de handoff na conversa de origem. A pergunta guarda a
conversa e o turno de origem no payload tipado. A resposta retorna para essa conversa, inclusive
quando é uma sala. A continuação recebe a tarefa original como contexto do plano. Continua sendo
um salto: a resposta do colega não pode iniciar delegações recursivas. A autoria e a marca de
conteúdo não confiável permanecem distintas da fala humana (ADR-023/026).

Salas não reaproveitam uma única sessão CLI entre identidades de bots. Cada turno recebe até 20
mensagens recentes (até 1000 caracteres cada) com autor e confiança no contexto do plano. Conversas
privadas continuam a usar resume; quando não há sessão, também recebem esse histórico limitado.
Uma continuação de consulta recebe até 8000 caracteres da tarefa original, pela ligação tipada.

Rotinas podem nascer pelo formulário (a pessoa já confirma) ou pelo prompt (proposta a confirmar).
`POST rotinas/:id/executar` executa uma rotina, inclusive pausada, sem alterar o estado nem a próxima
execução. A janela por minuto deduplica cliques e disputa com o scheduler; portanto um segundo teste
no mesmo minuto não dispara outro turno. O resultado segue para a conversa e o histórico existentes.
As rotinas dependem do servidor e da máquina local ligados.

## Interface

A referência visual fornecida em 2026-09-17 guia a navegação clara, contatos com avatares coloridos,
conversa central e painel de detalhes com perfil, colegas e rotinas. Em telas menores, o painel é
aberto pelo botão Detalhes; em celulares os bots são acessíveis pela Frota. Estados de simulação,
trabalho em curso e indisponibilidade usam dados reais. Controles decorativos sem ação foram removidos.

## Limites desta versão

Computador remoto, anexos, voz e execução local de comandos/arquivos arbitrários ficam fora desta
entrega. O acesso externo existente continua via conectores MCP e concessões. O computador remoto
seguirá o desenho do pré-ADR de mãos remotas, mantendo o processo do modelo e o caminho de perguntas
na máquina local. Não há desktop fictício nem indicação de acesso já concedido.

## Referências

- https://docs.x.ai/grok-bot/get-started
- https://docs.x.ai/grok-bot/chat-and-collaboration
- https://docs.x.ai/grok-bot/skills-routines-and-automations
- https://x.ai/bot/guides/how-i-run-multiple-teams-of-grok-bots
- https://github.com/milind-soni/OpenMausBot — inspiração funcional; nenhum código copiado.

## Reversão

Revisar a limitação de um salto quando existirem tarefas persistidas com árvore de delegação,
cancelamento e orçamento por cadeia. Revisar o contexto limitado de sala quando a carga real pedir
resumo persistido ou sessões por (sala, agente). A ligação ao turno de origem evita inferência por texto.
