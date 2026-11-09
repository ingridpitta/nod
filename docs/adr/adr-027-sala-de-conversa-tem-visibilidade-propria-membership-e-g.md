# ADR-027 — Sala de conversa tem visibilidade própria; membership é grant, não herança

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

Uma sala com bots de donos diferentes não herda o default privado do ADR-003 pelo owner_id de quem a criou. A sala tem visibility própria, e ser membro (ou ter um bot membro) é um grant explícito de leitura sobre o log daquela sala. O default continua privado: sala nova é visível só para quem a criou, e cada convite de bot concede leitura ao dono daquele bot.

## Contexto

O ADR-003 fixou owner_id + visibility com DEFAULT privado como a policy que importa. Aplicado ingenuamente a uma sala, ele produz o absurdo: uma sala criada pela Ana é invisível para o Bruno, cujo bot está falando nela e cuja cota está sendo queimada. Nenhum dos dois sistemas ajuda — o OMB é mono-harness e o Hermes é monousuário por desenho.

## Alternativas rejeitadas

### Sala herda o default privado pelo criador

Produz sala onde o dono de um bot membro não pode ler o que o próprio bot disse. Torna a autoria composta inauditável para quem mais precisa dela.

### Sala nasce pública para o workspace

Inverte o ADR-003 num objeto que vai carregar conversa sobre clientes. Default privado não é negociável.

## Evidência

Lacuna genuína: não há precedente em nenhum dos dois repositórios. server/config.ts:1049 customMcpServers(cfg, only) do OMB dá a forma do grant por lista, mas com default invertido ao do ADR-003.

## Consequências

- Uma decisão de produto precisa ser tomada antes de codar o grupo: se o dono de um bot membro vê o log INTEIRO ou só as falas do próprio bot.
- Conecta com o ADR-025: quem paga a cota tem interesse legítimo em ler o que foi feito com ela.

## Reversibilidade

Baixa depois que houver salas com histórico — mudar visibilidade retroativamente é decisão jurídica, não técnica.

