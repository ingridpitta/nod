# ADR-028 — A fronteira do proxy é a fronteira dos mecanismos de produto

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

Nenhum turno do nod pode executar fora da máquina onde o proxy MCP roda. Se um dia houver computador dedicado, ele segue o modelo VPS — processo do agente e proxy permanecem locais, apenas as MÃOS são remotas — e nunca o modelo em que o turno inteiro roda na máquina remota.

## Contexto

O ADR-013 pôs o proxy no caminho de tudo. A consequência que ninguém tinha escrito: no instante em que o turno sai da máquina do proxy, Sua vez, aprovação tipada, pergunta≠permissão e silêncio renderizado param de valer TODOS DE UMA VEZ, e param EM SILÊNCIO.

## Alternativas rejeitadas

### Permitir turno remoto com o proxy do outro lado

O proxy é local por ADR-013 porque a credencial de CLI é da pessoa por ADR-019. Um proxy do outro lado precisaria de uma segunda cópia da credencial fora do servidor, contra a emenda de segredo.

### Aceitar a degradação e avisar o usuário

A degradação é silenciosa por construção. Não há evento para renderizar quando a resposta é 'unavailable'.

## Evidência

server/drivers/boxagent.ts:294, verificado literalmente: `respondToRequest: async () => "unavailable" as const, // this engine has no asks to answer`. O agente na box não consegue nem PERGUNTAR — e o teto da conversa do nod, que escala para a pessoa e nunca tenta de novo, depende de existir caminho de volta. server/vps-computer.ts:1-3 mostra o modelo compatível: 'The agent process stays local'.

## Consequências

- Fecha a porta para computador de nuvem por bot enquanto os mecanismos de produto forem os decididos.
- Dá critério mecânico para avaliar qualquer proposta futura: se o turno sai da máquina do proxy, a resposta é não.

## Reversibilidade

Alta enquanto nada tiver sido construído; é uma decisão de não fazer.

