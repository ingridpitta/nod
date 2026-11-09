# Inteligência dos agentes

Novos agentes usam **Automático**. Nenhuma escolha de harness ou modelo é necessária na criação. O nod usa uma conta conectada e seu modelo recomendado: Claude Code/Sonnet ou Codex/GPT-5.6 Sol. Agentes existentes preservam a configuração anterior.

Para personalizar, clique no atalho de inteligência no cabeçalho da conversa ou abra **Perfil → Inteligência do agente → Personalizar modelo**. O dropdown agrupa modelos pelo harness e explica sua finalidade. Modelos de harnesses desconectados ficam desabilitados. Voltar a **Automático** desfaz a personalização.

A escolha vale para novas tarefas, rotinas e pedidos a colegas. Cada colega usa a própria inteligência. Duplicação preserva a configuração, sem copiar memória ou histórico. Tarefas já enfileiradas mantêm a preferência registrada. O histórico, a memória e os acessos permanecem no nod.

## Configuração do ambiente

- `NOD_EXECUTOR=auto`: escolhe um harness conectado. É o padrão em produção quando a variável não existe.
- `NOD_EXECUTOR=catcher`: simulação explícita, sem CLI nem custo, mantida no desenvolvimento.
- `NOD_EXECUTOR=claude-cli` ou `codex-cli`: preferência da máquina; agentes personalizados podem usar outro harness disponível.
- `NOD_MODELO=auto`: padrão para novos agentes. Um alias Claude como `sonnet` mantém a compatibilidade anterior, mas fixa esse fornecedor para esses agentes.
- `NOD_CLAUDE_BIN` e `NOD_CODEX_BIN`: caminhos opcionais para instalação fora do PATH.

A descoberta normal verifica instalação e login sem executar turnos pagos. `NOD_MODELO_SONDA` continua restrito aos scripts de sonda empírica; `e2e:aceite` (antes `e2e:haiku`) continua pago e separado. O modelo da ligação não sai daqui: é do servidor (`NOD_MODELO_LIGACAO_CLAUDE`/`_CODEX`, ADR-072, emenda de 2026-10-05).

A API aceita `PATCH /api/t/:tenant/agentes/:id` com `{"harness":"codex-cli","modelo":"gpt-6-astra"}` ou `{"harness":"auto","modelo":"auto"}`. O escopo e as permissões do agente continuam obrigatórios. Combinações incompatíveis retornam entrada inválida.

Claude Code e Codex estão integrados. Cursor e Hermes ficam identificados como **Em preparação**. O catálogo não garante acesso a todos os modelos da assinatura. Veja [ADR-036](adr/adr-036-harnesses-e-modelos.md) para isolamento, extensão e limites.

Para validar a experiência pela interface e por harness real, siga o [UAT manual de harnesses e modelos](uat-harnesses-e-modelos.md).
