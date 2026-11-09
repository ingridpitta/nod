# ADR-035 — Agendamentos acordam o agente para executar sua missão

Data: 2026-09-17. Escopo: consulta entre agentes e contexto de execução; não autoriza escrita externa delegada.

## Contexto

A pessoa definiu o fluxo: o agendamento acorda o agente que lê emails; esse agente interpreta o resultado e consulta/delega a um colega conforme sua missão permanente. A rotina não contém a decisão de encaminhamento. O catálogo anterior retirava `perguntar_a_bot` de todo turno iniciado por rotina, impedindo essa etapa.

Os UATs também observaram que reutilizar a conversa para disparos automáticos pode misturar a etapa de configurar o monitor com a execução. Houve respostas de ativação/ausência de novidades sem chamada à fonte. A causa desse comportamento do modelo não foi isolada; a sessão independente torna explícitos a missão, o modo e o catálogo atuais em cada execução automática.

## Decisão

- Permitir `perguntar_a_bot` ao agente acordado por rotina. A escolha do colega continua sendo do agente, seguindo sua missão.
- Preservar o corte de segundo salto: o destinatário e a continuação não ganham ferramenta de delegação. Preservar escopo por pessoa, concessões próprias do destinatário e marca de conteúdo não confiável.
- Rotinas e turnos peer iniciam sessão CLI independente com contexto recente reconstruído pelo servidor. Não substituem a sessão interativa salva da conversa. Conversas interativas do mesmo executor continuam usando resume.
- O prompt de execução distingue configurar/ativar uma rotina de realizar a consulta agora, exige ferramenta real para afirmações sobre fontes e respeita a política sem dado.

## Limites e validação

Isso não transforma consulta textual em execução autônoma de escrita. A criação delegada de tarefas exige autorização persistida com destino/operação e controle de idempotência; não se deve reclassificar conteúdo de outro agente como confiável para contornar a restrição.

Validação dirigida: catálogo de rotina com consulta a colega e leitura, sem escrita filtrada; destinatário sem segundo salto; sessão interativa reaproveitada, sessões de rotina/peer novas; testes existentes de fila e sessão por executor. UAT real deve comprovar origem rotina → chamada de leitura → pedido ao colega → chamada real pelo colega → retorno à origem. Texto de sucesso isolado não é evidência suficiente.
