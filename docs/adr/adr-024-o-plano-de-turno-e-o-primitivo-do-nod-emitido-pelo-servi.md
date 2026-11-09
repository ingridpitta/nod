# ADR-024 — O plano de turno é o primitivo do nod, emitido pelo servidor e consumido pelo proxy

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

Todo turno do nod é precedido por um PLANO DE TURNO emitido pelo servidor e entregue como payload do verbo PUXAR do ADR-021. O plano carrega: localidade, machine_id, executor, superficie, decidido_por, catálogo de ferramentas já resolvido (com tier de confiança e readOnlyHint por servidor), autoria composta pré-preenchida, confianca_entrada, token de turno e expiração. O proxy MCP local é o único consumidor. Plano ausente, expirado ou com catálogo vazio significa tools/list vazio e todo tools/call negado.

## Contexto

O ADR-013 já dizia que o proxy monta o catálogo do turno, classifica negação, corta resultado e constrói a aprovação, e o ADR-022 já dizia que a localidade é regra declarativa. Faltava o OBJETO que carrega essas decisões do servidor até a máquina. Sem ele, cada uma dessas quatro responsabilidades acaba lendo de um lugar diferente, e a autoria composta do ADR-023 vira enxerto. O hermes-agent tem o modelo de catálogo (toolsets.py) mas resolve tudo LOCALMENTE lendo config.yaml — não achei em nenhum lugar dele um servidor remoto que decida o catálogo do turno. O OMB tem a montagem por turno mas a autoridade é o harness local.

## Alternativas rejeitadas

### Configuração por bot, estática, como bot.mcpServers do OMB

Configuração estática não tem onde pendurar o resultado de uma regra que roda por turno. O ADR-022 decidiu que a localidade é resolvida a cada turno; um registro estático força a regra a rodar em outro lugar e a decisão a viajar por um canal separado.

### O proxy resolve o catálogo lendo um arquivo local sincronizado

É o modelo do Hermes e a autoridade fica na máquina, contra o ADR-013. Um arquivo local desatualizado ou editado à mão vira autoridade silenciosa.

### Um sexto verbo na ponte só para catálogo

O ADR-021 fixou cinco verbos. O catálogo é um campo do trabalho que já viaja no PUXAR; não justifica emenda.

## Evidência

toolsets.py::resolve_toolset (formato {description, tools, includes} com includes recursivos e detecção de ciclo, ~60 linhas) dá o formato do catálogo. server/drivers/claude.ts:1404 dá a montagem por turno em mcp.json 0600 num tmpdir descartado. server/mcp-gate.ts dá o consumo. A lacuna — resolver remotamente — não existe em nenhum dos dois e é a contribuição do nod.

## Consequências

- A autoria composta do ADR-023 nasce carimbada, em vez de ser enxertada — tools/mcp_tool_scope.py documenta o custo do enxerto como uma cicatriz de ~300 linhas.
- O fail-closed do ADR-013 vira propriedade estrutural, não código de política: sem plano, não há catálogo.
- Cria dependência dura do trabalho do dia com o servidor, o que exige estado renderizado de degradação (ver ADR-029).
- O plano é o lugar natural para o campo confianca_entrada, que resolve a lavagem de marca do ADR-026.

## Reversibilidade

Média. O formato do plano pode evoluir por versionamento de campo, mas trocar o portador (de plano para configuração estática) desfaz o ADR-013.


## Emenda 2026-10-13 — o hash do token de turno vai para o banco (NOD-214, revisa a EMENDA 3)

**O que muda.** Revisto em 2026-10-13: o token de turno deixa de viver **só** na memória do servidor. O puxar grava o
sha256 dele, o epoch, a identidade do turno e o necessário para recompor o plano em `turno_credenciais` (0073, sob RLS
por pessoa). O token em claro nunca é gravado. Depois de um reinício, o token que chega e falta na memória
(`autorizarComBanco`: proxy MCP, rotas internas, voz) é procurado pelo hash e volta para a memória. O plano é recomposto
pelo mesmo caminho do emitir, com o token que já existe (`planoOuRecompor`), sem cunhar outro. A linha sai quando o
turno assenta (entrega ou lease).

**Desvio do plano da issue.** Com RLS FORCE, procurar o hash sem escopo nunca acha a linha. Por isso o token passa a
levar o escopo alegado na frente, como a chave de máquina (ADR-031): `base64url(JSON{t,p}) "." base64url(24 bytes)`.
O escopo não autoriza nada sozinho: o hash cobre o token inteiro, e a identidade gravada tem de bater com o escopo
alegado. Token no formato antigo segue valendo só pela memória.

**Gatilho de reversão.** Um vazamento de `turno_credenciais` permitir agir como um turno (só se o sha256 de 24 bytes
aleatórios for invertível), ou a busca pelo hash aparecer como custo no p95 das rotas internas.
