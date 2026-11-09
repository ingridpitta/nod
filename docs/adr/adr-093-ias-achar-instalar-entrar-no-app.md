# ADR-093 — Achar, instalar e entrar nas IAs dentro do app do Mac

**Status** aceito · decidido e implementado em 2026-10-09 (plano "IAs: conexão, troca e escolha de modelo", PR 1;
aprovado pelo Marlon no canvas da troca de IA). Emenda as ADR-014 (CLI do fornecedor) e ADR-077 (onboarding).

## Contexto

Teste do Breno em produção (09/10, app 0.4.0-rc.6): ele não conseguiu trocar do Claude para o Codex. No app do Mac:

- o PATH vinha de `$SHELL -l -c`, que não lê o `.zshrc` onde o nvm é carregado, então o Codex de um `npm -g` no nvm
  não era achado; e o `#!/usr/bin/env node` do Codex não achava o node;
- `nod:ia-entrar` rodava o login desanexado e jogava a saída fora (sem link, sem código, erro mudo); `nod:ia-instalar`
  só abria a página oficial;
- a vigia parava de sondar a outra IA quando uma estava pronta;
- sem node, a sonda do Codex dizia "Atualize o Codex".

O Marlon: "aqui não podemos errar; conferir o link, conferir que leva à página correta".

## Decisão

1. **PATH em camadas** (`src/adapters/executor/caminho.ts`): PATH do processo › instaladores conhecidos
   (~/.local/bin, ~/.claude/local, Homebrew, volta, asdf, bun, mise) › TODAS as versões do nvm (a do `alias/default`
   primeiro) › PATH do shell de login (`$SHELL -l`, sem `-i`: o .zshrc não é mais preciso, com marcador, em segundo plano, 10 s, com cache; resolve no marcador
   do fim, mesmo com um job do .zshrc segurando o stdout). Todo filho de CLI recebe esse PATH. **Nada do nod entra
   nele** (revisão): nem as ferramentas instaladas, nem o node do nod. O ambiente dos drivers nunca leva
   `ELECTRON_RUN_AS_NODE` (denylist em `ambiente-executor.ts`).
2. **Escolha do binário pela versão** (revisão; `desktop/ferramentas.ts`, `escolherBinario`): o que o nod instalou
   disputa com o primeiro achado fora do nod, cada um com o `--version` em cache (chave: caminho, tamanho e data). O do
   nod só vale quando é igual ou mais novo; assim um `claude update` ou `brew upgrade` da pessoa nunca fica escondido.
   Ganhando, o caminho vai ao driver explícito (`cfg.bin`/`cfg.bins`). O log `ia_binario` diz o escolhido, a camada,
   a versão e o que perdeu.
3. **O Codex do nod roda o binário nativo** (revisão): `<prefixo>/lib/node_modules/@openai/codex/node_modules/
   @openai/codex-<plataforma>-<arq>/vendor/<tripla>/bin/codex` (ou içado em `lib/node_modules`), lido no `codex.js`
   da 0.162.1, com o ambiente que o `codex.js` daria (`CODEX_MANAGED_BY_NPM=1`, `CODEX_MANAGED_PACKAGE_ROOT`) só para
   o driver do Codex (`cfg.envPorDriver`). Sem o `codex.js`, não há node no caminho: o Electron como node não vaza
   para os comandos dos bots. O Claude do npm já é o binário nativo.
4. **Instalar com um clique sem depender do Node do Mac** (`desktop/instalar-ia.ts`): o app leva o próprio npm
   (devDependency `npm` com versão exata, em `Contents/Resources/npm` por `extraResources`) e o roda com o Electron
   como node (`ELECTRON_RUN_AS_NODE=1`), com o "node do nod" (`ferramentas/node-do-nod/node`, 2 linhas de sh) no PATH
   **só do npm** — os scripts de instalação (o `install.cjs` do Claude Code) precisam de `node`.
   - **npm isolado** (revisão): `--userconfig` e `--globalconfig` em arquivos do nod, `--registry=https://registry.npmjs.org/`,
     `--include=optional`, `--ignore-scripts=false`, cache próprio e nenhum `npm_config_*` herdado; um `~/.npmrc` com
     `ignore-scripts`, `omit=optional`, outro `registry` ou `before` não manda mais (conferido com o npm empacotado). O
     proxy continua vindo de `HTTPS_PROXY`/`HTTP_PROXY`.
   - **Do piso para cima, com idade mínima** (revisão): o pedido é `<pacote>@>=PISO_CLI` com `--min-release-age=2`
     (existe no npm 11.17). Se nenhuma versão do piso para cima tiver 2 dias, tenta uma vez sem a idade — nunca abaixo
     do piso.
   - **Prefixo por IA e troca atômica** (revisão): cada instalação vai para `ferramentas/<ia>/v-<carimbo>`; o
     binário de lá tem de responder ao `--version` (sem o node do nod no PATH) no piso, e só então o link
     `ferramentas/<ia>/atual` é trocado por rename. Falhou ou foi cancelada, a pasta nova some e o `atual` não muda.
     A versão anterior fica (um bot pode estar rodando o binário dela); as mais velhas saem. Prefixos separados deixam
     Claude e Codex instalarem ao mesmo tempo.
5. **Login dentro do app** (`desktop/login-ia.ts`): Codex com `codex login --device-auth` (o app lê o link e o código),
   Claude com `claude auth login --claudeai` por pipe (o CLI abre o navegador e conclui pelo localhost; o link de
   reserva mostra um código, que a pessoa cola no app e vai ao stdin). Conferência pelo status a cada 2 s por 2 min,
   depois "Verificar de novo". O nod nunca lê nem guarda token. Com a pessoa já logada no Codex (trocando de conta), o
   status não muda e o CLI sai com 0 até no SIGTERM: só a frase "Successfully logged in." (achada nas strings do
   binário 0.147.0) prova o login novo (revisão). Cancelar enquanto o status inicial responde não abre o login.
   **O código colado do Claude não foi medido** (exigiria completar um login): o app aceita uma linha só de ASCII
   imprimível sem espaço (8 a 2048) e escreve `código + "\n"` no stdin; esse caminho precisa de teste humano antes
   da release.
6. **Só links oficiais, por host E caminho**: `auth.openai.com/codex/device`, `claude.com/cai/oauth/authorize`,
   `claude.ai/oauth/authorize`. Fora da lista, o link não é mostrado nem aberto. A página nunca passa endereço nem
   argumento: só escolhe a IA, e o único texto dela que chega a um processo é o código colado, validado, pelo stdin.
   A página recebe só o host do link (revisão); a URL com o `state` fica no processo principal, que a abre.
7. **A vigia continua sondando a outra IA** a cada 60 s (só a sonda grátis, sem trocar o registro da que está pronta).
8. **Estado único por IA** (`src/contracts/estado-ia.ts`, montado por `src/domain/estado-ia.ts`): treze estados,
   com `config_invalida` e `sem_node` separados de "falta entrar" e "não instalada". As causas novas (`sem_node`,
   `config_invalida`) vão só na tela do Mac; o servidor de hoje as reduz ao estado sem causa (`ponte-validacao.ts`).
   Exposto em `window.nodDesktop.ias`; os IPC antigos (`iaEntrar`, `iaInstalar`) continuam até o PR da web.

## Alternativas descartadas

- **Baixar o Node oficial com sha256 (block/buzz)**: mais um download, mais uma verificação e ~45 MB por versão; o
  Electron já é um Node 24 assinado com o app.
- **Exigir o npm do Mac (OpenMausBot)**: é justamente o que falta na máquina de quem mais precisa do clique.
- **Instalador oficial do Claude (`claude.ai/install.sh`)**: exige shell e `curl | bash`; o pacote npm instala o
  mesmo binário nativo assinado pela Anthropic (medido: Team ID Q6L2SF6YDW), e o Codex já é npm.
- **Abrir o Terminal com o login (`.command`, block/buzz)**: tira a pessoa do app e esconde o erro do nod.

## Consequências e gatilhos de reversão

- O app cresce ~17 MB (o npm). Reverter se o electron-builder deixar de copiar `npm/node_modules` (a segunda entrada
  de `extraResources` existe porque a primeira descarta essa pasta).
- O "node do nod" só serve ao npm, e os scripts de instalação herdam `ELECTRON_RUN_AS_NODE=1` (o `install.cjs` do
  Claude só copia arquivos). Nenhum processo de bot o recebe (revisão). Gatilho: um pacote cujo script de instalação
  abra outro Electron; a saída é um bootstrap JS que apaga a variável antes de carregar o script.
- O `codex.js` pode mudar onde guarda o binário nativo: o nod procura os dois lugares que o `codex.js` 0.162.1
  procura; sem achar, a instalação falha na verificação e o `atual` não muda.
- O app é ad-hoc nas pré-releases: o Gatekeeper avalia os binários que ele executa (ver memória do modal). Os binários
  instalados são assinados pelos fornecedores (Codex: Team ID 2DC432GLL2).
- A página de login fica atrás do Cloudflare: a conferência automática chega só aos redirecionamentos
  (`auth.openai.com/codex/device` → `auth.openai.com/oauth/authorize`; `claude.com/cai/…` → `claude.ai/oauth/…`).
  O conteúdo da página e os casos de conta Business/organização exigem o teste humano antes da release.
- Mudou o endereço que um CLI imprime: o login falha com `link_nao_oficial` (o log diz só o host) até a lista ser
  atualizada aqui, com a medida nova.

## Emenda de 2026-10-23 — atualizar dentro do app (NOD-9)

O cartão da IA desatualizada ganha "Atualizar" (`iaAtualizar` na ponte). O caminho oficial é o atualizador do CLI; o
instalador desta ADR vira a reserva quando ele falha por permissão, versão ilegível ou falta de atualizador. Uma
atualização por vez no app inteiro; o estado (`atualizacao` em `EstadoIa`) leva só códigos, e as frases são da web
(`web/lib/atualizacao-ia.ts`). Gatilho de reversão: o `claude update` deixar de existir ou de respeitar o prefixo de
quem instalou — volta a ser só o instalador.
