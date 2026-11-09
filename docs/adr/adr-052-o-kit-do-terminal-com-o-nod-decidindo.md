# ADR-052 — O kit do terminal, com o nod decidindo

Status: aceito, revisto pela [ADR-055](adr-055-terminal-de-verdade-como-o-inhouse.md) (sem sandbox; arquivos no Mac inteiro; cada comando pelo servidor) · Data: 2026-09-28 · Revê ADR-036 (o Claude mantém `--tools ""`) · Estende ADR-039 · Emenda ADR-026

## Contexto

O nod rodava o Claude Code com `--tools ""`: sem Read, Write, Bash, web ou artefato. Nos dados de 16/09 a 28/09, o que mais doeu foi o que o Claude Code faz no terminal:

- mexer nos arquivos da pessoa e rodar comandos;
- entregar um arquivo que ela consiga abrir;
- ler a web.

O único atalho era o computador do bot:

- 68% de todas as aprovações foram "Ação no computador do bot";
- 29% delas falharam depois de aprovadas;
- em 11 casos a saída nunca voltou.

Casos: a Ada levou 7 pedidos, 9 aprovações e 18 turnos por um checklist em HTML. O Chico disse "isso é bem ruim" sem o `gh`. A Vera pediu três vezes para criar uma pasta.

O ADR-013 exige que o nod seja o ponto de decisão. Ligar nativas "por fora" do proxy é exatamente o contorno que o gatilho de reversão dele descreve. O ADR-026 exige que o conteúdo de fora seja marcado.

## Medição (scripts/sonda-nativas.ts, CLI 2.1.283, 2026-09-28)

| Pergunta | Resultado |
|---|---|
| Hook `PreToolUse` via `--settings` em `-p` | Roda para toda nativa. O `deny` barra a chamada. O caminho chega resolvido (`/private/var/…` onde o turno passou `/var/…`). |
| `--restricted` | O hook roda. Sem `--tools`, ele tira Bash e WebFetch do `init`. |
| Sandbox do Bash (`--settings`) | Escrita fora da pasta: "operation not permitted". Rede: "deny network-outbound". |
| WebFetch e WebSearch com o login de assinatura | Funcionam. O hook é consultado nas duas. |
| O que restringe as nativas | Só `--tools` (a lista exata). `--allowedTools` apenas aprova. |

**Ponta a ponta, com o servidor do nod e o Claude real (instância efêmera, 2026-09-28):**
- **Positivo:** Write criou `~/nod/<bot>/teste.txt`, Bash rodou `ls`, WebFetch leu example.com (o turno ficou contaminado) e `publicar_artefato` publicou. A trilha tem as quatro chamadas.
- **Negativo:** Write fora da pasta foi negado pelo hook; Bash gravando fora deu "operation not permitted"; `curl` pelo Bash foi bloqueado pelo sandbox. Nenhum arquivo saiu da pasta.

## Decisão

1. **Kit do terminal** (`NATIVAS_DO_TERMINAL`): Read, Edit, Write, Glob, Grep, NotebookEdit, Bash, WebFetch e WebSearch.
   - Vale em turno de conversa ou criação, confiável, no harness Claude Code real (`nativasDoTurno`, `terminal`).
   - Rotina, peer, delegação, sala e turno não confiável continuam sem nativas.
   - O Codex continua só com as ferramentas do proxy.
2. **Pasta do bot no Mac da pessoa:** `~/nod/<nome do bot>` (`pastaDoBot`).
   - É o cwd do turno; o driver a cria.
   - As pastas de projeto autorizadas entram por `--add-dir`.
   - Sem `--restricted`: `--setting-sources project` com o cwd numa pasta que o nod controla.
3. **O nod decide cada nativa:** o hook `PreToolUse` do nod (`hook-nativas.ts`) vai no `--settings` do turno. É local e fail-closed, como o proxy.
   - Caminho de arquivo só dentro da pasta do bot e das autorizadas, comparando o caminho REAL: link simbólico e `..` que saem são negados.
   - Bash só no sandbox, sem escape (`allowUnsandboxedCommands: false`).
   - Ferramenta fora do kit é negada.
   - Toda chamada é confirmada em `POST /api/interno/nativas`, que exige a nativa no plano e grava a trilha (`nativa__<ferramenta>`). Sem confirmação, nada roda.
   - O `matcher` do hook lista só as nativas. As ferramentas MCP do nod (`mcp__*`) passam direto pelo hook: quem decide sobre elas é o proxy. Medido ao vivo em 2026-09-28: com `"*"`, o hook negava `publicar_artefato` como "fora do kit".
4. **Bash no sandbox nativo do Claude Code:** grava só nas pastas do bot e não acessa a rede. Para a web, WebFetch e WebSearch.
5. **Conteúdo de fora contamina o turno (0033, `turnos.contaminado_em`).** O servidor, e não o hook, decide que WebFetch e WebSearch marcam o turno. Daí em diante:
   - escrita em conector só por item aprovado, o mesmo gate da rotina;
   - "Sempre permitir" não vale.

   É o equivalente dinâmico do catálogo reduzido, que não encolhe no meio do turno. `delegar_tarefa` trata plano com nativas como conteúdo de fora.
6. **Prompt:** a linha das ferramentas diz as nativas que o turno tem, a pasta do bot, que o Bash é protegido, e manda usar o artefato para o que é visual.
7. **Sem o hook na máquina** (app antigo), o driver não liga o kit e acrescenta ao prompt que Bash e web não estão disponíveis.

## Consequências

- O que a pessoa faz no Claude Code, o bot faz no nod: arquivos, scripts, web e entrega por artefato. O computador do bot volta a ser para o que precisa de navegador com login ou isolamento.
- Arquivo lido da pasta do bot ou de projeto autorizado não contamina o turno: é da pessoa, que escolheu a pasta. A web contamina.
- **Comando que precisa de rede ou de sair da pasta não roda nesta versão.** Aprovar esse comando no Mac, com card e "e o resto desta tarefa", fica para depois. O GitHub continua pelo conector que roda o `gh` no Mac (ADR-048).

## Gatilho de reversão

Qualquer um destes leva a desligar o kit (`nativasDoTurno` sem `terminal`) e voltar às ferramentas do proxy:

- uma versão do CLI em que o hook deixe de ser consultado para alguma nativa;
- uma medição de escrita fora da pasta ou de rede no sandbox;
- um contorno do hook feito pelo agente.

A sonda roda a cada versão nova do CLI.
