# ADR-015 — Credenciais: dois regimes opostos

**Status** revisado

## Decisão

Dois regimes com posturas OPOSTAS. (A) LOCAL: não existe credencial da organização para guardar. A assinatura é da pessoa, mora no Keychain, e o nod NUNCA a lê, transporta ou persiste. Some tenant_credential do caminho local e some o health check de decifra. O ambiente parte de {...source} com DENYLIST curta apagando ANTHROPIC_API_KEY herdada e qualquer chave da organização. (B) SERVIDOR: UMA chave da organização como secret do PaaS — sem tabela, sem cifra, sem health check. Aqui o ambiente CONTINUA partindo de objeto vazio com allowlist fixa. O teto de gasto pré-turno é MANTIDO e vale só para o servidor. Três mitigações obrigatórias hoje: a montagem de ambiente é UMA função pura com o regime como parâmetro; a leitura da chave passa por UMA função; a tabela de gasto nasce com owner_id e executor.

## O que mudou

A tabela de credencial e a cifra passam a guardar só a chave da organização. O ambiente local inverte de allowlist para denylist.

## Por quê

A alternativa que este ADR rejeitou ('um secret do PaaS por tenant', porque provisionar cliente viraria deploy) não se aplica quando o número de secrets é UM e não muda ao adicionar pessoa. O motivo da rejeição evaporou junto com o multi-tenant. A inversão do ambiente no caminho local contraria o ADR-015 e precisa de defesa: claudeEnvironment() parte de {...source} de propósito para preservar a identidade de Keychain E a paridade entre sonda e turno — 'Keeping the probe and turn environments identical prevents setup from claiming an API-key login that the turn itself would deliberately remove'. Se eu montasse do zero no local, a sonda diria 'autenticado' e o turno falharia. São regimes diferentes porque as ameaças são opostas: no servidor, esquecer de bloquear vaza; no local, esquecer de herdar quebra o CLI, e o dado sensível é justamente o que eu QUERO que o filho alcance.

