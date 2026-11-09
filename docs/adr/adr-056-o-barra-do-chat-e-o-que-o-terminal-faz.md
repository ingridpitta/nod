# ADR-056 — O "/" do chat e o que mais o terminal faz

Status: aceito · Data: 2026-09-28 · Estende ADR-055 (kit do terminal) e ADR-054 (modo dev). Canvas "Nod — tela do
agente", página "Comandos /".

## Contexto

O Marlon vive descobrindo coisas que faz no Claude Code do terminal e não consegue no nod. A última foi pedir ao Dev 1
"quero usar a skill de /review nesse PR". A emenda da ADR-055 deu ao bot as ferramentas `Skill` e `Agent`. Faltava
o resto: o chat não tinha "/", e o `ROADMAP.md` registra as lacunas que ainda precisam de medição.

Medido no Claude Code 2.1.284 (as sondas gratuitas leem só o `init` ou comandos que não chamam o modelo; as outras
custaram centavos com haiku):
- **Skill no começo do prompt:** `/nome args` roda a skill em `-p` sem depender do modelo (`/sonda 420` respondeu com
  o argumento).
- **Comandos grátis:** `/context` e `/cost` respondem sem chamar o modelo (US$ 0), em inglês.
- **`/compact`** funciona numa sessão retomada. Ao vivo, porém, o resultado dele foi a saída do `/context` anterior:
  o último texto que sobra na sessão compactada.
- **`/clear` não serve.** Numa sessão retomada, ele emite `conversation_reset` com um id novo e o `result` traz um
  terceiro id. Retomada pelo id original, a sessão ainda lembrava a palavra guardada antes.
- **O catálogo sai do `init`:**
  - o `init` lista `skills`, `slash_commands`, `terminal_slash_commands` e os plugins, com o caminho de cada um;
  - com o `--add-dir` da pasta da pessoa, são 310 comandos: as 92 skills dela e as de 4 plugins.
  - Skill de plugin vem como `plugin:skill`, com o arquivo em `<caminho>/skills/<skill>/SKILL.md`.
  - Algumas skills do plugin vercel têm um cabeçalho maior que 4 KB.
  - Os comandos `hm-*` da pessoa não têm frontmatter.
- **CLAUDE.md:** o de um repositório que é só `--add-dir` não carrega; com
  `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`, carrega (visto pelo `/context`).
- **Tarefas:**
  - `TaskCreate {subject, description}` responde "Task #1 created successfully: …";
  - `TaskUpdate {taskId, status}` usa os status `pending`, `in_progress` e `completed`;
  - `TaskList` devolve linhas como `#2 [in_progress] Checar SQL`.
- **Esforço:** `--effort` aceita `low`, `medium`, `high`, `xhigh` e `max` (`--help`).

## Decisão

1. **CLAUDE.md dos projetos.** No kit do terminal, o filho recebe `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`.
   Com isso entram as regras da pasta da pessoa e dos projetos autorizados na conversa. O modo de pastas antigo
   (`--restricted`) continua ignorando o CLAUDE.md de propósito.
2. **A lista de tarefas do bot no cartão de atividade.**
   - `TaskCreate`, `TaskGet`, `TaskList` e `TaskUpdate` entram no kit, e o hook as deixa passar: só organizam a
     sessão.
   - Um redutor puro (`domain/tarefas-do-bot.ts`) monta a checklist dos eventos. Ela chega pelos dois caminhos do
     cartão: o frame `turno.tarefas` no servidor e o trecho vivo `{tarefas}` pela ponte do Mac.
   - As nativas ganham rótulos em português no cartão ("Rodou um comando" no lugar de "Usou Bash").
3. **Esforço do bot (0037).** `agentes.esforco` (null = padrão do modelo) vai no card "Inteligência do agente" e no
   `/modelo`, e vira `--effort` só quando o help da versão instalada traz a flag. Mudar o esforço não recomeça a
   sessão.
4. **O "/" no campo (0038).**
   - **O catálogo:** o driver lê o catálogo do Mac com o `init` de cada turno e o frontmatter de cada SKILL.md, e o
     manda na entrega só quando muda. O servidor guarda um por pessoa; o "/" abre mesmo com o Mac fora do ar e diz
     de quando é a lista.
   - **A lista:** as que a pessoa usou com o bot, os comandos da conversa e as skills com a origem (gstack, posthog,
     Claude Code). Os comandos só de terminal avisam onde rodam, e nomes internos (`_…`) ficam de fora.
   - **Na mensagem:** a skill vai como `/nome args` no começo da mensagem, e a mensagem mostra o comando como chip.
5. **Comandos da conversa**, com o nome do terminal como apelido:
   - `/contexto` (`/context`) e `/uso` (`/cost`) viram turno com o comando do CLI no lugar e chegam em português;
   - `/compactar` (`/compact`) vira a linha "Conversa compactada · X → Y tokens", e o texto que o CLI devolve é
     descartado;
   - `/nova-sessao` (`/clear`) é do nod: zera a sessão, marca `conversas.recomeco_em` (o histórico do prompt só leva
     o que vier depois) e escreve a linha na conversa;
   - `/modelo` abre a escolha de modelo e esforço.

### Emenda (2026-10-28, NOD-23)

`/configurar` entra nos comandos da conversa, com os apelidos `/setup` e `/config`. Por isso `/config` deixa de ser
"só do terminal". Um comando ou skill do Mac com um desses nomes some da barra: o servidor sempre trata o nome como
o comando da conversa, então a skill nunca rodaria pelo chat. Na web, `/configurar` aparece só em bot próprio e
confirmado que não é o Nod.

## Alternativas descartadas

- **`--setting-sources user`.** Traria as skills, mas também `env`, `permissions` e `autoMode` do `settings.json`
  para dentro do turno. O `--add-dir` da pasta da pessoa já carrega as skills e os plugins.
- **Mandar `/clear` ao CLI.** A sessão original continua lembrando (ver Contexto).
- **Catálogo por uma sonda no boot.** Seria mais um processo por Mac. O `init` do turno é o que o CLI carregou de
  fato, e sai de graça. O custo: a lista aparece depois do primeiro turno no Claude Code, e a tela diz isso.
- **O chip dentro do campo.** Exigiria trocar o textarea por um campo editável e perder o que ele preserva entre
  frames (ADR-020). A dica acima do campo diz o mesmo, e a mensagem enviada mostra o chip.

## Gatilho de reversão

- Se o CLI mudar e `/nome args` no começo do prompt deixar de rodar a skill em `-p`, o nod passa a pedir ao modelo
  que chame `Skill`. A sonda desta ADR confere isso.
- Se uma skill rodar sem a pessoa ter escrito `/` (entrada de fora, rotina, colega), o "/" só vale para mensagem da
  pessoa. Hoje só a mensagem dela começa pelo texto dela; as outras entradas começam por texto do nod.
- Se o catálogo passar de 1 MB (CHECK da tabela) ou atrasar a entrega de forma visível no modo dev, ele sai da
  entrega e ganha uma rota própria da máquina.

## Não implementado

- **A pasta da skill:** a skill roda da pasta do bot (`~/nod/<bot>`). A do projeto da conversa só chega pelo
  `--add-dir`, e a dica ainda não diz qual é.
- **Descrições das embutidas:** 9 skills do Claude Code (`debug`, `verify`, `deep-research`…) ficam sem descrição,
  porque o CLI não a expõe. Duas têm descrição do nod (`code-review`, `security-review`).
- **Mensagens juntadas:** na fila que junta mensagens, um comando só roda se vier primeiro.
- **Codex:** fica fora, porque o stream dele não traz skills nem comandos.
- **Aviso de Mac fora do ar:** não existe; a lista mostra só a hora em que chegou.
