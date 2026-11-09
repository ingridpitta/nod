# ADR-055 — Terminal de verdade no Mac, como o inhouse

Status: aceito · Data: 2026-09-28 · Revê ADR-052 (decisões 2, 3 e 4: pasta, confinamento e sandbox) · Estende ADR-037 (0032, "o resto desta tarefa") e ADR-042

## Contexto

Com o kit da ADR-052, o Dev 1 respondeu às 16:33 que o `gh` estava instalado, mas que havia "rede bloqueada" e "token inválido". A rede era o sandbox. O token era um falso diagnóstico: fora do sandbox, o `gh auth status` mostrava `marlonwlv` logado, com escopo `repo`. De dentro, o `gh` não conseguia confirmar o login e respondia "inválido".

O histórico do Chico e do Dev 1 (24 a 28/09) mostra o mesmo padrão:
- revisar um PR pedia de dois a três cards;
- os PRs não podiam ser listados;
- o dono do repositório era adivinhado errado;
- a saída de terminal aprovado no computador do bot não voltava;
- uma revisão completa custou US$ 9,16 em 229 chamadas.

O Marlon decidiu: "eu não quero que ele tenha um sandbox no meu mac. Quero que ele opere mais parecido com o inhouse e tenha acesso real ao meu mac e terminal." No inhouse (`~/code/inhouse`), o Claude Code roda com o ambiente da pessoa: PATH, HOME e Keychain. As edições são aceitas sozinhas, e o Bash e o resto passam por `canUseTool`, que vira um pedido de aprovação na tela.

Perguntado, ele escolheu:
- **comandos como o inhouse:** o que só lê roda direto, o que muda algo pede aprovação;
- **arquivos em qualquer lugar do Mac.**

## Decisão

1. **Sem sandbox.** O `--settings` do turno leva só o hook do nod. O Bash é o terminal do Mac da pessoa, com rede e com o `gh`, o `git` e o `npm` logados dela (o env do filho já era o dela, menos a denylist do CLI).
2. **Arquivos em qualquer lugar do Mac.** As nativas de arquivo deixam de ser confinadas. A pasta pessoal entra em `--add-dir`, e o cwd continua sendo `~/nod/<bot>`.
3. **Credenciais ficam de fora.** Chaves SSH, AWS, o login do gh, `.netrc`, `.npmrc`, `.pem` e o Keychain não abrem pelas ferramentas de arquivo (`decidirNativa`). Comando que os toca nunca é "leitura" (`tocaCredencial`), e o mesmo vale para `env`, `printenv` e `gh auth token`. Ler uma chave e depois mandá-la para fora (WebFetch, um comentário) é o caminho de um texto malicioso num PR.
4. **Cada comando passa pelo servidor.** O hook manda o comando para `POST /api/interno/nativas`, e `autorizarComando` decide, nesta ordem:
   1. **só lê** (`classificarComando`, conservador: na dúvida, "altera") e o turno não leu a web → roda;
   2. a pessoa já aprovou **este mesmo comando** nesta tarefa (`comandoAprovadoNaCadeia`) → roda;
   3. ela respondeu **"Pode fazer e o resto desta tarefa"** num comando, o turno está limpo e fora do gate de rotina (`turnos.terminal_liberado_em`, 0034) → roda;
   4. senão → **card** na conversa, com o destino `terminal` e o comando inteiro em fonte de código.

   São leitura:
   - `git status`, `diff`, `log`, `show` e `fetch`;
   - `gh pr list`, `view`, `diff` e `checks`, e `gh api` só com GET e sem campos;
   - `ls`, `cat` e `rg`;
   - rodar testes, lint e tipos.

   Pedem aprovação:
   - substituição de comando e redirecionamento para arquivo;
   - variável na frente do comando, binário por caminho e segundo plano;
   - `git -c`.
5. **A espera acontece no próprio turno.** O hook espera a decisão em fatias até `ESPERA_APROVACAO_NO_TURNO_MS` (420 s, como o proxy desde a 0032). O teto do hook no CLI é `TETO_HOOK_S`, 450 s.
   - **Aprovado dentro da espera:** confirma de novo e o comando roda no mesmo turno.
   - **Recusado:** o modelo lê "a pessoa não aprovou".
   - **A espera acabou:** o hook nega e diz que o pedido continua na conversa. Quando ela aprovar, a retomada manda refazer o comando, que passa sem novo card pelo passo 2.
6. **O card não é editável e não vira regra.** Aprova-se exatamente o comando. "Sempre permitir" (ADR-042) não vale para o terminal, porque a regra de conector cobre a ferramenta inteira. Para não repetir o card numa tarefa, existe "e o resto desta tarefa", e só a dona decide.
7. **Web contamina:** depois de WebFetch ou WebSearch (0033), até a leitura pede.
8. **Escopo inalterado:** só em conversa ou criação confiável, no harness Claude Code, com o hook. Rotina, peer, delegação, sala e Codex continuam sem nativas.

## Medição

`scripts/sonda-nativas.ts`, revista para os pontos desta ADR. Medido em 2026-09-28 (CLI 2.1.283, haiku, US$ 0,09 no total):

| Ponto | Resultado |
|---|---|
| Bash sem sandbox | Gravou fora da pasta (`e.txt`). O `curl https://example.com` rodou sem erro; com o sandbox da ADR-052 dava "deny network-outbound". |
| Hook que espera 40 s antes de permitir | O CLI aguardou, e o comando rodou depois (`f.txt`, 49 s no ponto). |
| `deny` do hook | Continua barrando: o Write fora da área não criou `b.txt`. |
| Hook consultado | 8 de 8 chamadas (Write ×3, Bash ×4, WebFetch). |

Rode a sonda a cada versão nova do CLI e registre o resultado aqui.

## Alternativas descartadas

- **Manter o sandbox e abrir só a rede do GitHub** (`allowedDomains`). O `gh` também precisa do Keychain, e o sandbox o escondia (é daí o "token inválido"). Tudo que não fosse GitHub continuaria preso, e não era o que a pessoa pediu.
- **Tudo liberado, sem card**, como `--dangerously-skip-permissions`. Um texto num PR ou numa página rodaria qualquer comando com as credenciais dela.
- **Tudo pede aprovação.** Uma revisão de PR viraria dezenas de cliques.
- **Regra permanente por prefixo de comando** ("sempre permitir `git push`"). Pede uma tabela e uma tela próprias. Fica para quando "o resto desta tarefa" se mostrar insuficiente.

## Gatilho de reversão

- Qualquer comando que altera algo rodar sem card, sem aprovação na cadeia e sem liberação da tarefa, visto na trilha (`nativa__Bash` sem decisão correspondente). Isso volta o Bash a ficar só com o card.
- Uma credencial lida por um bot sem pedido da pessoa. Isso liga o card também para a leitura de fora do repositório.
- Mais de 1 em cada 3 cards de terminal recusados em 30 dias: a classificação de leitura está estreita demais ou o modelo está tentando coisa demais. A revisão é a lista de `comando.ts`.

## Não implementado

- **Regra permanente por comando.**
- **Leitura de conteúdo de fora pelo Bash** (`gh pr diff`, `curl` aprovado) ainda não contamina o turno; só WebFetch e WebSearch contaminam.
- **Codex** continua só com o proxy.

## Emenda de 2026-09-28: as skills do terminal

O Marlon pediu ao Dev 1 "quero usar a skill de /review nesse PR". O Dev 1 respondeu: "Não tenho ferramenta de
skills nem de slash commands neste ambiente". A resposta era verdade.

Medido no CLI 2.1.284, lendo só o `init` (sem chamar o modelo):
- **As skills já vinham carregadas, mas não podiam ser chamadas.** Como o nod rodava, o `init` listava 18 skills,
  só as embutidas. Com o `--add-dir` da pasta da pessoa, que esta ADR já passa, vinham 305 skills (o `review` entre
  elas) e os 4 plugins dela. O `--strict-mcp-config` continuou barrando os servidores MCP dos plugins. Faltava só a
  ferramenta `Skill` no `--tools`.
- **O hook continua decidindo tudo.** Uma sonda de US$ 0,065 com haiku mostrou que o hook do nod recebe `Skill`
  (com o nome da skill) e depois o `Bash` que ela manda rodar. Com subagente, o hook recebe `Agent` e depois o
  `Bash` de dentro do subagente, com o `agent_id` dele. O `init` lista o subagente como `Task`; o `--tools` aceita e
  o hook recebe `Agent`.

**Decisão.**
- **Kit:** `Skill` e `Agent` entram no kit do terminal (`NATIVAS_DE_SKILL`), só onde o kit já existe: conversa e
  criação confiáveis no Claude Code.
- **Hook:** deixa os dois passarem. O que a skill ou o subagente usar volta ao hook chamada por chamada, e o Bash
  continua indo ao servidor.
- **Prompt:** diz que "/nome" é pedido de skill. `AskUserQuestion` não existe em `-p`; quando a skill pedir uma
  pergunta à pessoa, ela vai por `pedir_a_pessoa`.

**Fora da emenda:**
- `AskUserQuestion` e os comandos só de terminal (`/doctor`, `/color`, `/reload-plugins`);
- as settings do usuário além do que o `--add-dir` já traz. `--setting-sources user` traria `env`, `permissions` e
  `autoMode` do `settings.json` para dentro do turno.

**Gatilho:** um `nativa__Bash` na trilha, de dentro de um subagente, sem decisão correspondente. Nesse caso o
`Agent` sai do kit.

## Emenda (2026-10-14)

O item 8 ("Codex continua sem nativas") e a linha "Codex continua só com o proxy" foram revistos pela
[ADR-103](adr-103-o-codex-com-o-terminal-pelo-hook-do-nod.md): o Codex tem o terminal sem sandbox, com o mesmo hook
do nod decidindo cada comando.

## Emenda de 2026-10-19: a credencial deixa de ser cerca no "Ignorar todas" (modos de aprovação, PR 6)

Revê o item 3 ("Credenciais ficam de fora") pela [ADR-115](adr-115-automatico-com-revisor-na-ia-da-pessoa.md), por
decisão do Marlon de 18/10. Produção, 30 dias até 17/10: 44 comandos pararam por credencial, inclusive em bots no
"Ignorar todas as aprovações", e 28 de 43 bots estão nesse modo.

- **O hook não nega mais sozinho.** A leitura e a gravação de arquivo de credencial pelas ferramentas de arquivo (Read,
  Glob, Grep, Write, Edit, NotebookEdit; no Codex, `apply_patch` e `view_image`) e o MCP da pessoa que cita uma vão ao
  servidor com o campo `credencial` (`decidirNativa`). O servidor decide pelo modo atual: **manual** nega com a frase de
  sempre; **automático** vira cartão (sem revisor); **total** roda e registra em `acoes_pelo_modo`.
- **Só com a confirmação explícita.** O hook só libera com `{ ok: true, credencial: "permitida" }`. Um servidor antigo
  (revertido) ignora o campo e responde `{ ok: true }` ao Read; sem a exigência, a credencial seria lida até no manual.
- **Hook antigo continua negando** (app do Mac ou motor ainda não atualizados): o lado seguro.
- **O que fica cerca em todo modo:** a chave do próprio nod (`~/.config/nod-motor/conexao.json`, `conexao.json`;
  `tocaChaveDoNod`) — não é credencial da pessoa, é a máquina falando com o servidor; mandar um arquivo de credencial a
  um app (`arquivo-do-mac.ts`, `caminhoRecusado`); e a espera (`esperar_comando`), que roda fora do CLI e não roda
  comando com credencial.
- `tocaCredencial` continua decidindo o que é credencial e que nunca é "leitura" livre.

**Gatilho de reversão** (o do item "uma credencial lida por um bot sem pedido da pessoa" passa a valer só fora do total):
uma credencial lida no total e mandada para fora sem a pessoa ter pedido, vista na Atividade → a credencial volta a ser
cerca no total (é voltar a linha da credencial em `decidirPeloModo`).
