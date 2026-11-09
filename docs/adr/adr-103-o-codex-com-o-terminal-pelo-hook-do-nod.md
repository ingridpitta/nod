# ADR-103 — O Codex com o terminal, pelo hook do nod (paridade, etapa 1)

> Emendada pela [ADR-147](adr-147-motor-no-windows-nativo.md): no Windows o terminal do Codex fica atrás de `NOD_CODEX_TERMINAL_WINDOWS`.

Status: aceito (pedido do Marlon, 2026-10-14: "dar as capacidades do Codex que estão recomendadas") · Data: 2026-10-14 ·
Emenda a [ADR-036](adr-036-harnesses-e-modelos.md) (o Codex "só com o proxy"), a
[ADR-052](adr-052-o-kit-do-terminal-com-o-nod-decidindo.md) e a
[ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) (item 8: "Codex continua sem nativas") · Mantém a
[ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (o modo decide) e a ADR-083 §6 (o chat no app-server)

## Contexto

Em 13/10 o Chico, num bot do ChatGPT, respondeu que não tinha acesso ao terminal. Não era bug: desde a ADR-036 o Codex
rodava "só com o proxy" — shell, edição de arquivo, web, skills, subagentes e AGENTS.md desligados, sandbox só de
leitura, thread efêmera — porque o nod não tinha como fazer cada comando passar pelo servidor, que no Claude é o hook
PreToolUse (ADR-052). O Marlon fixou a premissa em 14/10: **paridade total** com o Codex e o Claude Code usados direto.
A página "Paridade com o terminal" (https://claude.ai/artifact/3BMRieZKiXTFLSw7tLM6gP) comparou item a item e trouxe uma
recomendação por item; esta ADR é a etapa 1, o Codex. A etapa 2 (o que fica limitado por escolha) é do Marlon, na página.

O Codex já tem o mesmo tipo de hook (estável no 0.147.0 e no 0.162.0). Medido em 14/10 com turnos reais, sondas no
scratchpad da sessão e, para o que fica, `scripts/sonda-codex-terminal.ts`:

- O hook de `-c hooks=…` **só roda confiado**. `--dangerously-bypass-hook-trust` (flag da raiz) não o faz rodar no
  `app-server`. A confiança vale pelo hash do hook e se grava pelo próprio app-server (`hooks/list` + `config/batchWrite`
  em `hooks.state."<chave>".trusted_hash`, como o codex-acp). Por `-c` ela não pega.
- Entrada: `tool_name` (`Bash` para o shell e o `exec_command`; `apply_patch` com o patch inteiro em
  `tool_input.command`), `tool_input`, `cwd` (o caminho real), `turn_id`. O hook herda o ambiente do app-server.
- Saída: negar = JSON `permissionDecision: "deny"` ou exit 2 com o motivo no stderr, e o modelo lê o motivo; permitir =
  stdout vazio (o JSON de allow puro conta como falha do hook, e a ferramenta segue).
- **Falha aberto:** hook que estoura o `timeout` ou quebra deixa a ferramenta rodar. O comando do hook não passa por
  shell (`cmd || exit 2` não negou).
- A busca na web é ferramenta hospedada: o hook não a vê.
- Thread com escrita (`workspace-write` ou sem sandbox) grava `[projects."<pasta>"]` no `config.toml` da conta, e a pasta
  mãe confiada não evita; `config/batchWrite` com `value: null` tira a entrada.
- `thread/resume` continua a thread (o modelo lembrou o comando do turno anterior) e `thread/fork` copia com a memória.
  `turn/steer` aceito no 0.162.0, com a resposta no mesmo turno.

## Decisão

1. **O chat do Codex no app-server ganha o kit do terminal**, com a mesma regra de QUANDO do Claude
   (`nativasDoTurno`, ADR-066): sem sandbox (`danger-full-access`, como a ADR-055), na pasta do bot (`~/nod/<bot>` ou a
   da task) pelo caminho real, e cada nativa passa pelo hook do nod (`hook-nativas.ts`), que pergunta ao servidor. As
   nativas do plano são as do Codex, pelo nome que o hook recebe: `Bash`, `apply_patch`, `view_image`, `spawn_agent`,
   `web_search` (NATIVAS_DO_TERMINAL_CODEX). O `apply_patch` fora da pasta segue o modo como o Write; os caminhos saem do
   patch (`caminhosDoPatch`).
2. **O hook é confiado pela API do app-server** antes da thread. O comando do hook é fixo por máquina (o node e o
   script); a config do turno vai pela variável `NOD_HOOK_CONFIG`, então o hash não muda e a confiança se grava uma vez
   por conta. O matcher é fixo: `^(Bash|apply_patch|view_image|spawn_agent)$|^mcp__`.
3. **Contra o falha-aberto:** o hook nega sozinho em `PRAZO_HOOK_CODEX_MS` (a espera da aprovação + 15 s), e o timeout
   que o Codex recebe fica 45 s acima. O ELECTRON_RUN_AS_NODE do app vai pelo `/usr/bin/env`.
4. **Sem o hook, isolado e dito.** Máquina sem o script, hook que não carrega ou que não fica confiado: o turno roda de
   novo com o isolamento de antes e o aviso do Claude (AVISO_SEM_TERMINAL). O `codex exec` de reserva roda sempre
   isolado e com o aviso.
5. **O resto do Codex da pessoa liga junto:** web (com a marca de conteúdo de fora vinda do item `webSearch` do stream,
   pela mesma rota do hook), skills, AGENTS.md (o prompt manda ler o do repositório, que fica abaixo da pasta do bot),
   subagentes, leitura e geração de imagem, e a configuração dela (o app-server nunca aceitou `--ignore-user-config`).
   Continuam desligados o navegador e o uso do computador (recomendação: só depois do hook provado no terminal).
6. **MCPs da pessoa, com guarda:** nos modos da dona (conversa, criação, rotina) o servidor do nod entra como
   `mcp_servers.nod={…}`, junto dos servidores do `config.toml` dela, e cada chamada a um que não é o nod vai ao servidor
   como a nativa `mcp_da_pessoa`: decidida pelo modo como um comando que muda algo (nunca é leitura), com card "quer
   usar um app seu", trilha e contaminação. Fora desses modos, a tabela é só a do nod e apps/plugins da conta ficam
   desligados: num pedido de colega o MCP usaria as credenciais dela a pedido de outra pessoa.
7. **A thread fica:** não é mais efêmera; o id volta como `sessaoCli` e o turno seguinte a continua (`thread/resume`) ou a
   copia na rede de 2 min (`thread/fork`). Thread que a conta não tem vira uma nova. O anexo também vai ao app-server
   (imagem como `localImage`). `CAPACIDADES_HARNESS["codex-cli"]`: terminal, pasta, retomar e bifurcar.
8. **A entrada `[projects]` que a thread grava sai no fim do turno** quando a pasta não estava lá antes.
9. **O servidor só promete o terminal do Codex a quem consegue.** O plano leva o kit ao Codex só quando a máquina do
   turno anunciou `terminal` para ele (`AnuncioMaquina.capacidades`, app ou motor desta versão, com o hook). O app ou o
   motor de antes anuncia o Codex sem terminal (ou não anuncia nada) e segue isolado, com o prompt de antes; sem isso o
   prompt diria "você tem o terminal" a um Codex que não tem. A versão do app sobe para 0.4.0-rc.11.

## Alternativas descartadas

- **Só as aprovações do app-server (`on-request`).** Nenhuma política pergunta todo comando (`untrusted` aposentada;
  `on-request` sem sandbox quase nunca pergunta). O hook é o único porteiro universal.
- **`--dangerously-bypass-hook-trust`.** Medido: não faz o hook rodar no app-server 0.147.0.
- **Rodar o Codex sem nada, como o OpenMausBot.** Paridade máxima, mas sem trilha, cerca nem modo de aprovação.
- **Codex pelo codex-acp.** Mais uma camada que muda toda semana; o app-server direto já existe no nod.

## Consequências

- O `config.toml` da conta ganha uma entrada `hooks.state` com o hash do hook do nod (uma por instalação do app ou do
  motor). É o que o codex-acp também faz.
- A pílula "ferramenta negada" do Codex vem de um arquivo do turno: o comando barrado não vira item no stream, e o hook
  anota cada negação.
- O hook continua sem ver o `write_stdin` de um processo interativo já aprovado nem a busca na web; a web é marcada pelo
  stream, logo depois de começar.
- Medido só com fake: `view_image`, `spawn_agent` e o MCP da pessoa pelo hook (a documentação diz que passam). PDF segue
  fora: o app-server não tem entrada de arquivo.

## Gatilho de reversão

Uma versão do Codex em que o hook confiado deixe de rodar, ou em que `config/batchWrite` deixe de gravar a confiança:
`scripts/sonda-codex-terminal.ts` reprova, e o terminal do Codex sai (`CAPACIDADES_HARNESS["codex-cli"].terminal =
false`) até haver outro porteiro. Rode a sonda a cada versão nova do Codex.
