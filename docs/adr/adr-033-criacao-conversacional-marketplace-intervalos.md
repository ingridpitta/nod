# ADR-033 — Criação conversacional, Marketplace e rotinas por intervalo

Status: aceito · Data: 2026-09-17 · Emenda ADR-011, ADR-013, ADR-015 e ADR-032.

## Experiência

O `+` cria imediatamente um bot privado, com nome sugerido sem colisão com os nomes visíveis,
abre seu chat e publica uma saudação persistida com opções de missão. Essa saudação não consome
um turno do CLI. A pessoa descreve a missão no chat e confirma o perfil proposto pelo modelo.
A API de criação com perfil completo permanece compatível. O menu de nova conversa reúne busca,
criação e grupos. As consultas entre bots ficam recolhidas por turno de origem, com contagem,
participantes e detalhes expansíveis; autoria e conteúdo originais permanecem persistidos.

## Integrações

Por escolha explícita da pessoa, Composio faz o login dos apps pelo navegador; MCPs próprios
continuam disponíveis por comando local ou URL. O catálogo inicial tem Slack, GitHub, Gmail,
Notion, Linear, Google Sheets, Google Calendar e ClickUp. Não são instalações implícitas.

A chave do projeto Composio é cifrada no servidor, com tenant e pessoa, e nunca devolvida à web
ou ao modelo. Configurações e sessões têm RLS e visibilidade obrigatoriamente privada. O usuário
remoto é `nod:<tenant>:<pessoa>`. Cada app ganha uma sessão restrita ao seu toolkit. O nod verifica
status, dono e toolkit da conta antes de vincular a conta explicitamente à sessão e sondar o MCP.
A chave, o login e a concessão de uma capacidade são etapas diferentes. Conectar não concede
ferramentas aos bots. Sessões de login expiradas podem ser refeitas pelo Marketplace.

Usamos ferramentas concretas pré-carregadas, com busca, execução múltipla, workbench e gestão
remota de conexões desativados. Meta-executores `COMPOSIO_*` não entram no catálogo concedível.
Assim cada efeito continua passando pela concessão e aprovação do proxy do nod. Uma conexão
sugerida no chat usa `pedir_acesso` com capacidades vazias; produz um card para conectar e
retomar a tarefa. O modelo recebe o catálogo atualizado no turno seguinte.

MCP HTTP com dados pessoais exige HTTPS. HTTP sem TLS só é aceito em loopback e com declaração
`nao-toca`. Cabeçalhos HTTP recebem apenas credenciais explicitamente cadastradas, nunca o
ambiente do processo. Redirecionamentos são recusados. O cliente lê JSON ou SSE incrementalmente,
ignora notificações, limita a resposta a 1 MiB e percorre até 20 páginas do catálogo. Campos
nullable/alternativos do JSON Schema são preservados e validados.

## Rotinas

Minutos e horas aceitam valores fixos, listas, asterisco e passos (`*/5`, `0 */2`). A agenda
continua ancorada no relógio, com uma janela canônica UTC por execução, e não no último término.
O calendário mantém a semântica existente, inclusive dias úteis. Horários inexistentes no avanço
do horário de verão são pulados; a hora repetida tem dois instantes UTC distintos.

O domínio já aceitava UTC, mas o CHECK da tabela exigia barra no nome do fuso. O teste real de
2026-09-17 reproduziu uma falha ao confirmar a proposta com UTC. A migração 0010 corrige esse
CHECK. Offset numérico continua recusado. Rotinas exigem o nod e o computador ligados.

## Validação e limites

Testes cobrem chave cifrada e privada, identidade da conta, login ainda pendente, ativação sem
concessões, cabeçalhos, SSE, paginação e ausência de meta-executores. A jornada de servidor completo
cria bot interativo, propõe uma rotina de cinco minutos, confirma, pausa e verifica a entrega.
O login OAuth real depende de chave e autorização da conta do usuário; os testes locais do contrato
não substituem esse aceite com o provedor. Não implementamos instalação de bots de terceiros,
computador remoto nem OAuth genérico para qualquer servidor MCP.

## Referências

- https://docs.x.ai/grok-bot/get-started
- https://x.ai/bot/guides
- https://github.com/milind-soni/OpenMausBot — referência, sem código copiado.
- https://docs.composio.dev/docs/sessions-via-mcp
- https://docs.composio.dev/reference/api-reference/tool-router/postToolRouterSession
- https://github.com/ComposioHQ/composio/blob/next/ts/packages/core/src/models/ToolRouter.ts
