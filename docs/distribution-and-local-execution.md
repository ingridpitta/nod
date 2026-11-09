# Alvos de distribuição e execução local

Três perguntas respondidas com o código na mão. A investigação leu o OpenMausBot e o Buzz.

---

## É um monorepo?

Não é monorepo, e não precisa virar. O ADR-018 está confirmado e não deve ser reaberto — a premissa que parecia ter caído não caiu.

O raciocínio que faz a pergunta parecer urgente é: "três alvos de distribuição, cada um com dependências incompatíveis, logo precisa de workspaces". Fui verificar no OpenMausBot, que é a referência que o próprio ADR-018 cita, e o repositório desmente isso em três linhas:

1. O pnpm-workspace.yaml lista EXATAMENTE três packages: ".", "apps/docs" e "cloudflare/control-plane". Nada mais.
2. O Electron NÃO é workspace. É devDependency do package.json da raiz (linhas 114-116: electron ^43.4.0, electron-builder ^26.15.3, electron-updater ^6.8.9), e a pasta electron/ é apenas o valor do campo "main": "electron/main.mjs" (linha 18). Convive no mesmo package.json que o React do front-end e o servidor Node, sem cerimônia nenhuma. Dependência npm não é runtime: o Dockerfile do servidor simplesmente não invoca `electron`.
3. O companion/ TEM package.json próprio (@openmausbot/companion, private, com bin) e MESMO ASSIM não está na lista de packages: — não é workspace. É compilado por um tsconfig próprio (tsconfig.companion.build.json). E ios/ e android/ não têm package.json nenhum: usam Package.swift/XcodeGen e settings.gradle.kts. Swift e Kotlin nem entram no grafo npm, então três alvos de distribuição não exercem pressão nenhuma sobre a decisão de workspaces.

A regra que o código demonstra e que vale escrever no nod: o que separa código é TSCONFIG POR ALVO DE BUILD; workspace só entra quando houver um segundo artefato npm que alguém de fora instale. Alvo de distribuição não é alvo de build — desktop e mobile são shells que consomem a mesma web/.

Mais um ponto que reduz a urgência a zero: o esqueleto que "não tem desktop nem mobile" não é código commitado. O repositório do nod hoje tem README.md, docs/ e prototypes/ — a árvore está em docs/skeleton.md. O custo da correção não é refatorar, é editar um documento.

ESTRUTURA FINAL: um package.json na raiz, quatro tsconfig (base, core, server, web) e — quando e se o desktop existir — um quinto tsconfig para o shell, mais um job de CI. A árvore completa está no campo esqueleto.

---

## Um app web consegue usar o modelo que roda na minha máquina?

A resposta curta é NÃO, e a sua intuição do inhouse estava certa — mas por um motivo diferente do que parece, e esse motivo é a coisa mais importante desta rodada inteira.

Primeiro, é preciso desfazer um erro de enquadramento que está na própria pergunta: no caso do Claude Code não existe "modelo rodando local na sua máquina". O modelo roda na Anthropic. O que era local no inhouse era o PROCESSO e a CREDENCIAL. Quando você fechava o laptop, não era o modelo que morria — era o processo filho. Essa distinção muda a pergunta de "como o web alcança o modelo local?" para "onde mora o executor?", e essa segunda pergunta o nod já respondeu no ADR-017: no container. (Se um dia entrar inferência genuinamente local — Ollama, llama.cpp — a conclusão sobre a ponte continua idêntica, porque o obstáculo é a fronteira do processo, não o modelo.)

Segundo, sobre o "nem precisei autenticar" do OpenMausBot: não houve detecção de credencial, não houve leitura de Keychain, não houve OAuth. Houve herança de processo. O mecanismo tem três passos. (a) O app reconstrói o PATH à mão em server/env-path.ts, porque um app aberto pelo Finder no macOS herda um PATH pelado sem ~/.local/bin nem /opt/homebrew/bin — a função augmentedPath() concatena diretórios conhecidos e ainda roda `$SHELL -l -i -c 'printf "__OMB_PATH__%s" "$PATH"'` em background para capturar o que só existe no seu .zshrc. (b) Achado o binário, ele roda `claude --version` para saber se existe, e depois `claude auth status --json` para saber se está logado — claudeAuthStatus() em server/drivers/claude.ts:63. Para o Cursor é `cursor-agent status --format json`; para o Codex, `codex login status`. Ele PERGUNTA ao CLI; nunca inspeciona a credencial. (c) E o passo que explica tudo: claudeEnvironment() em claude.ts:150 monta o ambiente do processo filho como `{ ...source, PATH: augmentedPath(), ... }` — verifiquei a linha. O filho herda HOME, herda a sessão de Keychain do usuário logado naquele macOS, herda tudo. O CLI então resolve a própria credencial sozinho, e o harness nunca soube onde ela estava.

A prova de que isso é deliberado, e não acidente: o comentário acima de claudeAuthStatus diz que a credencial pode estar no Keychain do macOS ou num JSON dependendo da plataforma, e por isso não é inspecionada. E há um bug histórico documentado no próprio teste (claude.test.ts:2409-2411, issue #108): a versão antiga LIA ~/.claude/.credentials.json e reportava usuários logados como deslogados, justamente porque no macOS o token mora no Keychain. Eles cometeram o erro oposto e reverteram.

Terceiro, e é aqui que a pergunta se fecha: herança de processo não atravessa a fronteira do container, e não existe ponte do navegador para a máquina. Não é uma lacuna de engenharia a ser vencida — é uma barreira ativa, construída de propósito nos dois lados. Verifiquei a linha: em companion/src/proxy.ts, o handler recusa com 403 QUALQUER requisição que traga header Origin, ANTES de olhar o token, e o comentário logo acima diz literalmente "A native app sends no Origin. Anything that does is a browser that has found this port, and a browser has no business on it". Do outro lado, o harness faz bind fixo em 127.0.0.1 e rejeita Host não-loopback como defesa contra DNS rebinding. Um SPA em nod.app sempre manda Origin. Nunca vai passar. E a prova por contradição está no mesmo repositório: se a detecção automática funcionasse no servidor, o arquivo claude-login-auth.ts — 400+ linhas só para capturar um link PKCE de um pipe e aceitar um código colado à mão — não existiria.

O que isso significa para o nod, concretamente: o app instalado não é uma feature de distribuição, é o PRÉ-REQUISITO da execução local. E o ADR-014 (CLI no container com API key por tenant) já é, na prática, a admissão de que a detecção automática não existe no servidor — só que o ADR registrou o QUE sem registrar o PORQUÊ forte. A chave por tenant não é conveniência: é a única opção quando o executor não é a máquina do usuário. O corolário, que precisa estar escrito para a pergunta não voltar em seis meses: o nod hospedado NUNCA terá o momento "nem precisei autenticar" que você viu. Todo cliente passa por configurar uma chave. Isso é real e não tem contorno dentro do modo container.

E a boa notícia, que compensa a perda: o que amarrava o inhouse ao seu laptop não era o modelo estar local, era o HARNESS estar local. O nod já mudou o harness de lugar (ADR-017), e com isso a pergunta deixa de ser um problema a resolver e vira um custo que você não precisa pagar. O OpenMausBot precisou construir pareamento por QR, sidecar companion, responder Bonjour, suporte a Tailscale e túnel Cloudflare — milhares de linhas de conectividade que existem SÓ para atravessar um NAT até um laptop, e que ainda assim exigem que "o Mac esteja ligado e não dormindo" (está na documentação deles, sem rodeios). O nod não precisa de nenhuma dessas peças. Não gaste um trimestre reconstruindo a amarra que você acabou de cortar.

---

## Os mecanismos, um por um

### Reconstrução de PATH (augmentedPath)

Um app macOS aberto pelo Finder herda um PATH pelado — sem ~/.local/bin, sem /opt/homebrew/bin. Então o app monta um PATH sintético: diretórios registrados por ele + process.env.PATH + uma lista fixa de diretórios conhecidos que existem no disco (~/.local/bin, ~/.npm-global/bin, ~/.claude/local, /opt/homebrew/bin, /usr/local/bin, ~/.volta/bin, ~/.bun/bin, ~/.asdf/shims e todos os ~/.nvm/versions/node/*/bin, do mais novo ao mais velho). Windows tem lista separada e ainda precisa parsear shims .cmd do npm e shebangs à mão, porque libuv ignora PATHEXT. Em paralelo, uma vez só e em background, roda `$SHELL -l -i -c 'printf "__OMB_PATH__%s" "$PATH"'` para capturar exports que só existem no .zshrc — best-effort, nunca bloqueia, e por isso a PRIMEIRA sonda pode dar falso negativo.

**No OpenMausBot.** `server/env-path.ts (augmentedPath, knownDirs, windowsKnownDirs, probeLoginShellPath, findCliCandidates); server/procs.ts:25 resolveCli delega para resolveCliSpawn; endpoint GET /api/cli-candidates alimenta um dropdown manual porque a heurística erra`

**Para o nod.** NÃO serve enquanto o executor for container. Num container o PATH é o que o Dockerfile definiu, determinístico. Só passaria a importar se houvesse executor local — e aí o custo é real e recorrente: a lista é mantida à mão e cada gerenciador de versão novo exige um commit. Nunca se distingue 'não instalado' de 'instalado fora do PATH que o app enxerga'; o próprio produto assume o 'ou' na mensagem de erro.

### Sonda de disponibilidade em dois passos (existe? / está logado?)

Passo A: roda `<cli> --version` com timeout de 8s. Se falhar, o snapshot devolve na hora { state: 'unavailable', reason: '<cli> CLI not found' } e a investigação PARA — nunca se pergunta sobre login. Passo B, só se o binário existe, e o dialeto muda por fornecedor. Claude: `claude auth status --json`, faz JSON.parse do stdout e exige status.loggedIn === true; o erro do exec é deliberadamente descartado (o CLI fake do teste sai com código 1 quando deslogado e ainda assim é o stdout que decide); do payload saem só três campos de exibição, cada um sanitizado (email com regex e ≤254 chars, orgName ≤160, authMethod). Cursor: primeiro um atalho — se CURSOR_API_KEY ou CURSOR_AUTH_TOKEN estiverem preenchidas, retorna true SEM executar nada; senão tenta `cursor-agent status --format json` e depois `cursor-agent status` em texto, com um firstJsonValue() que tolera banner antes do payload e um decodificador que varre oito chaves candidatas. Codex: `codex login status` com regex /^logged in\b/im, e para o email sobe um servidor JSON-RPC inteiro (`codex app-server`, initialize → initialized → account/read).

**No OpenMausBot.** `server/drivers/claude.ts:62-95 (claudeAuthStatus) e :1860-1874 (snapshot); server/drivers/acp/cursor.ts (probeCursorAuth, firstJsonValue, decodeCursorAuthStatus); server/drivers/codex.ts:1267-1278; server/drivers/codex-identity.ts`

**Para o nod.** SERVE, e é o mecanismo mais barato de copiar (2-3 dias). Vale como ADR-019: o nod pergunta ao CLI, nunca lê a credencial. Com duas emendas próprias. (1) Presença de variável de ambiente NUNCA é prova de autenticação — o atalho do Cursor produz falso positivo silencioso (chave expirada passa como verde na UI, falha só depois de mandar a mensagem), e no modelo do ADR-014, onde TODA autenticação é por chave, esse caminho deixa de ser raro e vira o único. (2) O parse é um contrato não-versionado com um binário de terceiro; o pin de versão do ADR-014 sem teste de contrato contra o binário REAL no CI só congela o problema — no dia do upgrade obrigatório, todos os tenants ficam 'deslogados' ao mesmo tempo.

### Herança de ambiente do processo filho — a explicação do 'nem precisei autenticar'

É isto, e só isto. claudeEnvironment() monta o ambiente do filho como `{ ...source, PATH: augmentedPath(), NPM_CONFIG_LOGLEVEL: 'error' }` — verifiquei a linha. O spread de process.env carrega HOME, e com HOME vem o acesso à sessão de Keychain do usuário logado naquele macOS. O CLI filho resolve a própria credencial sozinho e o harness nunca soube onde ela estava. Há higiene ativa em cima disso: as chaves de workspace do próprio harness são removidas, CLAUDECODE e CLAUDE_CODE_ENTRYPOINT são apagadas para o CLI não se confundir com a sessão pai, e se nenhuma injeção local foi feita e a instância não declarou ANTHROPIC_API_KEY explicitamente, essa chave é DELETADA — porque uma chave herdada em silêncio converteria uma assinatura Pro/Max em cobrança pay-as-you-go. O mesmo ambiente é usado na sonda e no turno real, de propósito, para o setup não afirmar um login que o turno depois removeria.

**No OpenMausBot.** `server/drivers/claude.ts:150-183 (claudeEnvironment); o comentário acima da função explica a razão da paridade sonda/turno; server/procs.ts:61 (spawn) e claude.ts:1428 (spawnCli)`

**Para o nod.** NÃO é transportável, e essa é a resposta técnica definitiva da pergunta 3. Num container não existe Keychain, não existe o seu ~/.claude, e `claude auth status --json` responde loggedIn: false. Mais grave: o modo local é a NEGAÇÃO da premissa do ADR-015, que exige o ambiente do executor montado a partir de objeto VAZIO com allowlist fixa, nunca spread de process.env — e o teste de aceitação E10.3 (provar que uma chave solta no servidor não chega ao executor) não é sequer expressável para um executor que herda por construção.

### Contrato de snapshot e gate pré-spawn

O registro chama inst.snapshot() dentro de try/catch; qualquer exceção vira { state: 'unavailable', reason: <mensagem> }. A UI lê três estados distintos: needsCli() é snapshot.state !== 'available' (mostra o card de instalar, com o comando por plataforma), needsSignIn() é state === 'available' && authenticated === false (mostra o card de entrar, com o comando de login), e o campo reason é renderizado literalmente com role="alert". Antes do turno, se o driver declara requireAuthenticationBeforeSpawn e a sonda dá false, o turno nem spawna: emite turn.started, depois runtime.error com a nota de login e flag setup: true, e fecha com stopReason 'auth_required'.

**No OpenMausBot.** `server/harness/registry.ts:236-246; src/components/EngineSetup.tsx:31 e :36; server/drivers/acp/core.ts:451-459; contrato em server/contracts.ts:370-380`

**Para o nod.** SERVE, e é o que vale copiar mesmo sem executor local. Separar 'não instalado' de 'instalado e deslogado' é o que permite a UI oferecer o botão certo em vez de uma mensagem genérica; e recusar o turno ANTES de gastar evita cobrar o tenant por um turno que ia falhar. No nod, 'não instalado' vira 'imagem sem o CLI' (falha de deploy, não do usuário) e 'deslogado' vira 'chave do tenant inválida' — mas a forma de três estados continua idêntica. Ressalva medida: a sonda é cara (até três exec de 8s por engine, em série, sem memoização visível) — cachear com TTL curto desde o dia 1 é barato; retrofitar depois que a UI assume leitura síncrona é caro.

### A barreira de Origin — por que o navegador não atravessa

O sidecar que atende o celular recusa com 403 qualquer requisição que traga header Origin, ANTES de olhar o bearer token, e faz socket.destroy() no upgrade de WebSocket pelo mesmo motivo. O comentário no código diz o raciocínio: um app nativo não manda Origin; se veio Origin, é um navegador que achou esta porta, e um navegador não tem o que fazer aqui. Do outro lado, o harness faz bind fixo em 127.0.0.1 sem opção e rejeita Host não-loopback, como defesa contra DNS rebinding. E o sidecar consegue falar com o harness porque ele NÃO repassa o Host nem o Origin do dispositivo — ele fala 'como ele mesmo, da máquina que o harness já aceita servir'.

**No OpenMausBot.** `companion/src/proxy.ts (o bloco de recusa vem logo antes de bearerToken e options.authenticate — verificado); companion/src/index.ts (três sockets: 127.0.0.1:8811 controle, 0.0.0.0:8810 dispositivos, harness em 127.0.0.1:8799); README do companion`

**Para o nod.** Serve como resposta, não como código. Contornar isso exigiria CORS com a origem de nod.app (reabrindo o vetor de rebinding que ambos fecharam de propósito), TLS para localhost com certificado que o navegador valide (o README deles analisa e rejeita: exigiria pinning no pareamento e re-pinning a cada regeneração), e ainda esbarraria no bloqueio do Chrome para requisições de HTTPS público para HTTP local. Nenhum dos dois repositórios tentou. Para o nod a leitura é: não construa a ponte.

### Pareamento — o que ele resolve e o que ele NÃO resolve

Existem DOIS pareamentos distintos que não compartilham credencial, e confundi-los é erro de arquitetura. (a) Pareamento de DISPOSITIVO: o registro gera um token no pareamento, entrega uma vez e persiste apenas o SHA-256 (nunca o token), com comparação timingSafeEqual, janela de 120s, 5 tentativas, máximo 20 dispositivos, e um código de 6 dígitos só como fallback humano do QR de alta entropia. Isso autoriza um app NATIVO já instalado a falar com o sidecar. (b) Pareamento de SESSÃO: POST /api/auth/pairing devolve código e QR apontando para <publicUrl>/pair — isso é sign-in web, não acesso à máquina. O modelo de confiança em camadas está dito no código: no loopback não há autenticação nenhuma e está certo não haver, porque o socket de loopback É a credencial; quando sai do loopback, vira token.

**No OpenMausBot.** `companion/src/devices.ts (DeviceRegistry, redeem, tokenHash); server/cli.ts:428 mintPairing e :439 runPair; server/pair-cli.ts; docs/desktop-companion.md ('The two connection types intentionally do not share credentials')`

**Para o nod.** NÃO serve — e é importante dizer por quê. Pareamento resolve autorização e notificação, nunca execução local. Chamar isso de 'ponte para o modelo local' seria erro. Como o harness do nod roda em container com HTTPS e identidade de tenant sob RLS (ADR-003), o nod não precisa de pareamento QR, nem de sidecar, nem de Bonjour, nem de Tailscale, nem de túnel Cloudflare. É uma economia grande e ainda não está registrada em ADR nenhum.

### Sign-in headless por PKCE colado à mão (o caminho servidor)

Quando não há laptop, o OpenMausBot spawna `claude auth login` com pipes, captura do stdout o link PKCE filtrando por host permitido (claude.com, claude.ai, console.anthropic.com, platform.claude.com), mostra o link na UI, aceita o código colado UMA vez, escreve no stdin do CLI e confirma com `claude auth status --json`. O cabeçalho do arquivo é a peça jurídica: nada do sign-in é armazenado ali, e afirma que a Anthropic permite um usuário final logar no binário não modificado com a própria assinatura, mas proíbe qualquer fluxo que intermedeie credenciais da claude.ai — razão pela qual não existe código de cliente OAuth no repositório. Não existe controller equivalente para o Cursor: lá, no servidor, é API key e ponto final.

**No OpenMausBot.** `server/drivers/claude-login-auth.ts (ClaudeLoginController, spawn na linha ~330, claudeSignInLink)`

**Para o nod.** NÃO copiar. São 400+ linhas de captura de PKCE por pipe com implicações jurídicas que o próprio cabeçalho enumera — escopo demais para 2-3 pessoas começando do zero, e desnecessário sob o ADR-014. Mas a EXISTÊNCIA desse arquivo é a melhor evidência disponível de que a detecção automática não funciona no servidor: se funcionasse, ele não teria sido escrito. E atenção: aquele cabeçalho é comentário de código de terceiro, não parecer jurídico — se o nod cogitar 'traga sua assinatura', isso precisa de leitura dos termos atuais por um humano.

### O contra-exemplo que confirma a regra (driver do Factory droid)

É o único driver que LÊ arquivo de credencial: checa a existência de ~/.factory/auth.v2.file, auth.v2.loginkeychain e auth.v2.keyring. E o comentário admite a fragilidade: qual arquivo existe depende de um feature flag que o droid busca por conta, então checar um nome só reporta um login recém-feito como deslogado — e os nomes foram lidos do binário 0.196.0 por engenharia reversa.

**No OpenMausBot.** `server/drivers/acp/droid.ts:25-43`

**Para o nod.** Serve como argumento de custo para o ADR-019. Três nomes de arquivo descobertos por engenharia reversa de um binário, e ainda frágil — exatamente o erro que o driver do Claude cometeu (issue #108) e abandonou. Com 2-3 engenheiros, não há orçamento para manter engenharia reversa de credenciais de três fornecedores.

### Empacotamento desktop com dois modos de boot

O mesmo binário Electron tem os dois modos que parecem ser uma escolha de arquitetura, e a bifurcação é um if/else no boot — verifiquei a linha. Se existe acesso remoto configurado, ele sobe um relay de loopback e NUNCA inicia o servidor embutido; senão, faz utilityProcess.fork do servidor compilado (não spawn de `node` — é o Node do próprio Electron, então o usuário não precisa ter Node instalado), com supervisor de reinício com backoff [1s, 2s, 4s] e 60s de uptime estável antes de zerar tentativas, seleção de porta com fallback (8799, 18799, 28799), verificação de identidade do filho por PID e segredos passados por postMessage em vez de env ou disco. A janela carrega http://127.0.0.1:<porta> nos dois casos — o front-end não sabe a diferença. O preço do modo remoto está declarado: screenPreview, ditado e controle local viram available: false com reasonCode 'remote-server'.

**No OpenMausBot.** `electron/main.mjs (bifurcação de boot verificada em ~2490; startServerOn em :968 com utilityProcess.fork); electron/server-supervisor.mjs; electron/capabilities.cjs:152 (reasonCode 'remote-server'); electron-builder.yml`

**Para o nod.** Serve como seguro para o futuro, não como trabalho agora. A leitura que importa: escolher cliente fino hoje NÃO fecha a porta do executor embutido depois, porque é o mesmo binário com um flag de boot. Isso remove a urgência da decisão. Quando e se o desktop chegar, a evidência atual favorece Electron sobre Tauri — não por tamanho de binário, mas porque o WebKitGTK cobra código de plataforma que WKWebView e WebView2 dão de graça (o Buzz precisou de um módulo só para reativar getUserMedia no Linux e outro que adivinha GPU NVIDIA lendo /sys/class/drm antes de qualquer init, porque o WebKit lê a variável uma vez por processo e não há segunda chance).

### Notificação com o app fechado — a assimetria iOS/Android

No iOS do OpenMausBot não existe APNs: as notificações são LOCAIS, montadas a partir de frames que chegam por um stream SSE já aberto. Sem stream, sem notificação. A janela de graça ao fundo é de 25 segundos (beginBackgroundTask + sleep), depois o iOS suspende o processo e o stream é fechado de propósito, para o cursor ser gravado num ponto conhecido. A Live Activity na Dynamic Island tem a mesma limitação declarada: exata enquanto o app está vivo, silenciosa junto com ele. No Android existe algo que o iOS não pode ter: um foreground service opt-in (tipo connectedDevice, START_STICKY, com receptor de boot) que segura o processo fora da classe 'cached' indefinidamente, então um frame chega mesmo com o app fechado — e o doc comment é honesto: a notificação persistente é o preço disso, não um bug a esconder. No Buzz, que investiu mais em push que qualquer outro projeto lido, o gateway APNs é um serviço inteiro com PostgreSQL dedicado, App Attest, dois chaveiros AEAD e Helm chart — e o payload que sai de tudo isso é uma constante compilada que só diz 'reconecte', sem conteúdo nenhum; o conteúdo é buscado depois pela extensão de notificação, autenticado. E o perfil Android (FCM) é declarado não-conforme: nem eles chegaram lá.

**No OpenMausBot.** `ios/App/Notifications.swift, ios/App/Session.swift (linger de 25s), ios/App/LiveActivities.swift, ios/README.md:245, ios/TESTING.md:290; android AndroidManifest.xml:207 + AlwaysOnConnectionService.kt; Buzz: crates/buzz-push-gateway/src/model.rs:15 e docs/nips/NIP-PL.md:231`

**Para o nod.** Serve para calibrar expectativa e para uma decisão de produto. A tese do nod é encurtar o tempo entre 'o agente preparou' e 'alguém decidiu' — sem notificação, um app mobile não encurta nada, só oferece um lugar diferente de olhar, e o segundo lugar não é usado. Por isso a notificação primária do nod deve ser e-mail e/ou WhatsApp com link direto para o item: canais que o time já domina, funcionam em qualquer telefone, e custam dias. E uma linha vale ser copiada desde já: payload de notificação constante, sem conteúdo — no minuto em que uma notificação mencionar alguém pelo nome, isso deixa de ser elegância e vira proteção de dado pessoal.

---

## Onde o modelo roda

DECISÃO: um único modo de execução. O executor do nod mora no container (ADR-014 + ADR-017), com CLI do fornecedor e API key por tenant. O executor local NÃO entra no produto da v1 — entra, se você quiser, como ferramenta interna de engenharia do time, explicitamente fora do escopo vendido, sem SLA e fora de qualquer proposta comercial. Enquanto essa linha estiver escrita, ferramenta interna não vira feature sem ADR novo.

O trade-off, dito sem suavizar — o que se GANHA: isolamento entre clientes com garantia auditável (RLS do ADR-003 tem significado quando há mais de um tenant no mesmo executor; num laptop, não tem); teto de gasto que corresponde a dinheiro de verdade; a fila funciona com todo laptop fechado, que é a promessa oposta à do OpenMausBot ("o Mac precisa estar ligado e não dormindo"); uma matriz de teste só, rodando no CI; e a economia de não construir pareamento QR, sidecar, Bonjour, Tailscale e túnel Cloudflare — milhares de linhas que existem só para atravessar NAT até um laptop.

O que se PERDE: o momento que te impressionou. Ninguém abre o nod e vê "já está logado". Todo cliente configura uma chave de API, e essa é a primeira fricção do onboarding. Um cliente que já paga Claude Max não pode usar essa assinatura no nod — vai contratar uma chave à parte, e essa objeção comercial vai aparecer. Tenha a resposta pronta: no modo hospedado o nod garante isolamento entre clientes, teto de gasto real e trilha de auditoria, e nenhuma das três sobrevive à assinatura pessoal. Perde-se também o próprio time de engenharia como usuário do produto no fluxo que ele preferiria — é o que mais dói culturalmente, e é o que justifica manter o executor local como ferramenta interna.

O que NÃO se perde, apesar de parecer: o argumento de venda "os dados nunca saem da máquina do cliente". Essa perda é ilusória, porque os dados já vão para a Anthropic nos dois modos — o modelo nunca foi local. Vender isso teria sido impreciso.

Por que não os dois modos: "dois modos = dobro de bug" é o cenário otimista, porque supõe dois caminhos co-testáveis. Não são. As garantias que o CI prova — allowlist de ambiente (ADR-015), conformidade de RLS no catálogo (ADR-003), fumaça do CLI pinado (ADR-014) — não rodam na máquina do cliente. Você não dobra os testes; você fica com metade do produto sem teste, e é a metade que roda em ambiente que o operador do nod não administra. Some o pré-requisito medido: empacotamento em 3 SOs, assinatura e notarização, supervisor de processo, auto-update (que no .deb simplesmente não existe). É um trimestre com o produto parado.

Quatro pontos que exigem validação humana e que eu não decido: (a) a leitura jurídica sobre assinatura pessoal em plataforma hospedada — o que existe é comentário de código de outro projeto, não parecer; (b) a decisão comercial de nunca oferecer "traga sua assinatura" como diferencial; (c) a implicação de LGPD de cada tenant rodar CLI de terceiro com dado pessoal sensível sob infraestrutura do nod — o ADR-014 já registra que --strict-mcp-config impede LER config mas não impede o CLI ESCREVER transcrição, cache ou log de crash, e por isso existe o diretório por turno apagado ao fim; vale confirmar com jurídico que a mitigação basta para dado pessoal sensível; (d) perguntar a 5 dos ~70 clientes se instalariam um app de fornecedor no notebook corporativo e se isso passa pela TI deles — essa resposta vale mais que toda a comparação Electron vs Tauri.

---

## Alvos de distribuição

| | Alvo | Decisão | Quando | Tecnologia |
|---|---|---|---|---|
| 1 | 1. Web responsiva (o esqueleto que já existe) | **FAZER** | Agora, desde o primeiro commit de web/ | A mesma web/ do ADR-018: reducer puro + SSE. Nenhuma tecnologia nova. |
| 2 | 2. PWA instalável | **FAZER** | Logo em seguida — dias, não semanas | manifest.webmanifest + service worker + ícone em web/. Não é alvo de b |
| 3 | 3. Notificação por canal que já existe (e-mail / WhatsApp com link direto ao item) | **FAZER, e antes de qualquer app** | Junto com o PWA, e é o item de maior retorno da lista inteir | Nenhuma nova. Envio a partir do container do ADR-017, link direto para |
| 4 | 4. Desktop mac + Windows como CLIENTE FINO | **ADIAR com gatilho escrito** | Talvez depois. Gatilho escrito: um cliente pagante pedir not | Electron (não Tauri), janela carregando a URL do container, notificaçã |
| 5 | 5. iOS nativo como wrapper fino | **ADIAR** | Talvez depois. Gatilho escrito: push com app fechado virar r | WebView nativo cuja única razão de existir é registrar o token APNs e  |
| 6 | 6. Android nativo | **ADIAR, e decidir separado do iOS** | Calcular separado do iOS, nunca em bloco | Se vier: o mesmo wrapper WebView. A diferença é que o Android tem fore |
| 7 | 7. Linux desktop | **NÃO FAZER** | Provavelmente nunca | — |
| 8 | 8. Daemon / executor local na máquina do usuário | **NÃO FAZER como produto** | Não | — |

### 1. Web responsiva (o esqueleto que já existe)

**Decisão.** FAZER. É o produto.

**Entrega única.** É o único alvo com custo marginal ZERO de distribuição: sem assinatura, sem notarização, sem loja, sem auto-update, sem matriz de SO. Você corrige um bug e todo mundo tem a correção no próximo carregamento. Para um produto que ainda não tem uma linha de código, essa velocidade de iteração vale mais que qualquer app.

**Custo.** Zero adicional. A única exigência concreta é disciplina: a fila precisa ser legível em 400px de largura desde o primeiro commit. Fazer agora custa nada; retrofitar depois é caro.

**Tecnologia.** A mesma web/ do ADR-018: reducer puro + SSE. Nenhuma tecnologia nova.

### 2. PWA instalável

**Decisão.** FAZER. Não prometa push aqui: Web Push em PWA no iOS existe mas exige o usuário adicionar à tela de início, e isso é atrito real que precisa ser medido, não assumido.

**Entrega única.** Ícone na tela inicial e abertura em tela cheia — 80% da sensação de 'ter app' por 1% do custo, tanto no telefone quanto no desktop.

**Custo.** 1-2 semanas de uma pessoa, incluindo estados offline honestos (estado negativo escrito, nunca área em branco — é a disciplina 6 do esqueleto).

**Tecnologia.** manifest.webmanifest + service worker + ícone em web/. Não é alvo de build novo, é um arquivo.

### 3. Notificação por canal que já existe (e-mail / WhatsApp com link direto ao item)

**Decisão.** FAZER, e antes de qualquer app. Se a notificação passar a mencionar alguém pelo nome, o payload deve carregar só o link — nunca o conteúdo.

**Entrega única.** Fecha o laço da decisão. É o único item da lista que efetivamente encurta o tempo entre 'o agente preparou' e 'alguém decidiu', que é a tese do nod. Sem ele, qualquer app mobile é só um segundo lugar para olhar — e o segundo lugar não é usado.

**Custo.** 3 a 5 dias. Sem conta Apple, sem FCM, sem servidor de push, sem alvo de build novo. O time já sabe operar esses canais.

**Tecnologia.** Nenhuma nova. Envio a partir do container do ADR-017, link direto para o par (tenantId, id) do ADR-003.

### 4. Desktop mac + Windows como CLIENTE FINO

**Decisão.** ADIAR com gatilho escrito. Escolher cliente fino agora não fecha a porta do executor embutido depois: é o mesmo binário com um if/else no boot.

**Entrega única.** Notificação nativa com o app fechado e ícone na dock. É o que o navegador não dá.

**Custo.** 3 a 5 semanas de construção, MAIS meio dia por semana em regime, para sempre — e esse recorrente é o que ninguém orça: certificado Apple expira anualmente e quebra o release no dia, upgrade de Electron é obrigatório por CVE de Chromium algumas vezes ao ano e revalida a matriz inteira, e o electron-updater exige dois patches mantidos à mão contra a forma do upstream. Some 1-2 semanas na primeira vez para assinatura/notarização macOS (USD 99/ano, e a ordem notarizar → staple → re-hash é obrigatória: o staple reescreve bytes e um feed com hash velho faz o updater rejeitar toda atualização). Windows sem assinar por enquanto — mas copie literalmente o gate de CI deles, porque setar publisherName sem assinar de verdade rejeita TODA atualização de TODA a base instalada.

**Tecnologia.** Electron (não Tauri), janela carregando a URL do container, notificação nativa, deep link, auto-update por GitHub Releases. NÃO embute servidor, NÃO embute Node, NÃO embute sidecars — o que elimina quase toda a dor de assinatura aninhada.

### 5. iOS nativo como wrapper fino

**Decisão.** ADIAR. E quando vier: centenas de linhas, não dezenas de milhares. NÃO reimplemente o protocolo em Swift — o OpenMausBot pagou ~31 mil linhas de Swift e ~66 mil de Kotlin reimplementando o mesmo protocolo à mão. Copie uma linha do Buzz: payload de push constante, sem conteúdo, que só acorda o app.

**Entrega única.** Notificação com o app completamente fechado no iOS. Não há outro caminho: a janela de fundo do iOS é de 25 segundos e não existe foreground service.

**Custo.** 2 a 4 semanas, mais conta Apple Developer e um Mac para builds (ponto único de falha humano num time de 3). NÃO são as 5.246 linhas do gateway do Buzz — aquilo resolve ser gateway público multi-app, problema que o nod não tem.

**Tecnologia.** WebView nativo cuja única razão de existir é registrar o token APNs e abrir a URL certa ao tocar na notificação. Envio de APNs a partir do container do ADR-017 — uma chamada HTTP/2 a mais.

### 6. Android nativo

**Decisão.** ADIAR, e decidir separado do iOS. O cálculo dos dois é genuinamente diferente e tratá-los em bloco leva à decisão errada nos dois.

**Entrega única.** Notificação confiável com app fechado a custo muito menor que o iOS — ao preço de uma notificação persistente visível.

**Custo.** Menor que o iOS, e sem conta Apple. Mas o PWA no Android já recebe Web Push de verdade, o que reduz muito a necessidade.

**Tecnologia.** Se vier: o mesmo wrapper WebView. A diferença é que o Android tem foreground service opt-in que entrega notificação com app fechado SEM nenhum servidor de push.

### 7. Linux desktop

**Decisão.** NÃO FAZER. RH corporativo brasileiro é Windows e Mac.

**Entrega única.** Nada que os outros alvos não entreguem para o público do nod.

**Custo.** .deb e .rpm NÃO têm auto-update — a solução do OpenMausBot é copiar 'sudo apt-get install' para o clipboard e abrir um terminal em branco, porque deixar o updater fazer isso levanta prompt de root do polkit dentro de um app de chat e substitui o binário com o processo ainda rodando. Some AppArmor, divergência Xorg/Wayland e uma cauda de manutenção permanente. O próprio OpenMausBot marca Linux inteiro como Beta e desabilita controle local no Wayland.

**Tecnologia.** —

### 8. Daemon / executor local na máquina do usuário

**Decisão.** NÃO FAZER como produto. Se quiser, ferramenta interna — fora do escopo vendido, sem SLA, e não vira feature sem ADR novo.

**Entrega única.** A única coisa que nenhum outro alvo entrega: herança de credencial ('nem precisei autenticar') e, se um dia houver, inferência genuinamente local. Hoje isso vale para você e para 2 engenheiros — não para os ~70 clientes.

**Custo.** Um trimestre e o pré-requisito inteiro do alvo 4, mais canal de saída para o núcleo, mais a matriz de PATH em 3 SOs. E nega a premissa do ADR-015 (ambiente montado do zero) de forma que o teste E10.3 deixa de ser expressável.

**Tecnologia.** —

---

## Esqueleto final

```
nod/
├── package.json                 # UM pacote. Sem workspaces (ADR-018).
├── tsconfig.base.json           # strict, target moderno, paths
├── tsconfig.core.json           # types: [] e lib sem DOM — o COMPILADOR guarda o core
├── tsconfig.server.json         # include: core, db, http, drivers, agent, contracts
├── tsconfig.web.json            # include: web, contracts (só type)
├── eslint.config.js             # fronteiras que o compilador não cobre (db/ ↛ http/)
├── Dockerfile                   # CLI pinado por versão EXATA. SEM as libs do Chrome.
├── Dockerfile.browser           # imagem separada para E11 (~30 libs Chrome)
├── .github/workflows/ci.yml     # tipos, lint, unit, conformidade de RLS, fumaça do CLI,
│                                #   + teste de CONTRATO contra o binário real (ADR-019)
│
├── contracts/                   # O ARTEFATO MAIS CARO. Uma pessoa só até estabilizar.
│   ├── evento.ts                # RuntimeEvent: denials[], source, AUTORIA COMPOSTA
│   ├── decisao.ts               # DecisaoId = { tenantId, id } — o par, sempre
│   ├── item-aprovacao.ts        # item tipado: estado, origem, autoria da marcação
│   ├── turno.ts                 # os 4 sinais de aceitação como campos obrigatórios
│   ├── frame.ts                 # frame SSE com tenantId no envelope
│   └── sonda.ts                 # NOVO (ADR-019): { state, reason, authenticated }
│                                #   — os três estados que a UI precisa distinguir
│
├── core/                        # ZERO I/O. Recebe `now` como parâmetro.
│   ├── dado-pessoal.ts          # classifica por ORIGEM. Default: TOCA. (ADR-002)
│   ├── aprovacao-item.ts        # origem sensível nasce desmarcada
│   ├── parada-alcada.ts         # negação TERMINAL vs TRANSITÓRIA (E5.1)
│   ├── retomada-turno.ts        # classifyResumeFailure + mayReplay (E9.1)
│   ├── fila-frota.ts            # ordenação, agrupamento, estado do item
│   ├── relogio.ts               # os DOIS relógios: decisão e execução
│   ├── rotina-janela.ts         # instante canônico do cron + fuso IANA
│   ├── canal-responde.ts        # política de 3 valores; menção sempre vence
│   ├── canal-orcamento.ts       # 4 regras + quebra-anel; rotina isenta
│   ├── montagem-ferramentas.ts  # catálogo ∩ agente ∩ alcance do canal
│   ├── ambiente-executor.ts     # allowlist nomeada; parte de {} (E10.3)
│   ├── prontidao-motor.ts       # NOVO (ADR-019): (sonda, política) → pode spawnar?
│   │                            #   função pura; o gate pré-spawn com motivo tipado
│   └── redacao.ts               # texto de recusa que encerra, nunca convida
│
├── db/                          # Postgres. Único helper de transação com SET LOCAL.
│   ├── tx.ts                    # SET LOCAL nod.tenant_id. ÚNICO caminho.
│   ├── migrations/
│   ├── conformidade.test.ts     # pg_policies, pg_constraint, pg_proc (A-RLS-1..5)
│   ├── rebuild-busca.sql
│   └── repos/
│
├── http/                        # rotas, SSE, snapshot REST
│   ├── sse.ts                   # buffer POR TENANT
│   ├── snapshot-frota.ts        # o endpoint de toda abertura fria
│   ├── notificacao.ts           # NOVO: e-mail/WhatsApp com LINK, sem conteúdo.
│   │                            #   Nenhum dado pessoal sai no corpo.
│   └── rotas/
│
├── agent/                       # execução de turno
│   ├── despacho.ts              # reivindica → roda FORA de tx → assenta
│   ├── mcp-proxy.ts             # O PONTO DE DECISÃO (ADR-013)
│   ├── varredor-expiracao.ts
│   └── scheduler-rotina.ts
│
├── drivers/                     # SPI: um arquivo por motor + um registro
│   ├── spi.ts                   # Driver / Instance / Adapter
│   ├── claude-cli.ts
│   └── sonda.ts                 # NOVO (ADR-019): pergunta ao CLI, nunca lê credencial.
│                                #   Cache com TTL curto + invalidação por evento.
│
└── web/                         # reducer puro + transporte encapsulado
    ├── manifest.webmanifest     # NOVO: PWA instalável. Dias de trabalho, caro depois.
    ├── sw.js                    # service worker — shell offline honesto
    ├── estado/reducer.ts        # (estado, acao) → estado. Sem I/O, sem Date.now().
    └── lib/live-events.ts       # transporte atrás de interface de 4 campos + JITTER


═══ OS ALVOS, e por que NÃO aparecem como pastas ═══

Não há pasta desktop/ nem mobile/ nesta árvore, e isso é a decisão, não um esquecimento.

  ALVO 1  web responsiva  → é web/. Já está aqui.
  ALVO 2  PWA instalável  → é web/manifest.webmanifest + web/sw.js. Já está aqui.
  ALVO 3  notificação     → é http/notificacao.ts. Já está aqui.

Os três alvos da v1 são arquivos dentro da árvore existente. Nenhum é pasta nova,
nenhum é pacote, nenhum é workspace.

SE E QUANDO os gatilhos do ADR-020 dispararem, a árvore ganha — nesta forma:

  ├── tsconfig.desktop.json     # mais UM tsconfig. Não é package.json.
  └── desktop/
      └── main.mjs              # shell Electron: carrega a URL do container.
                                # Cliente fino. Não embute servidor, Node nem sidecar.

  ├── mobile/                   # fora do grafo npm por natureza (Swift/Kotlin).
                                # Wrapper WebView: registra APNs, abre a URL.
                                # Centenas de linhas, não dezenas de milhares.

A regra, em uma linha: pacote único enquanto tudo é o mesmo processo; tsconfig novo
por alvo de build; package.json separado SÓ quando houver artefato npm que alguém de
fora instale. É exatamente o que o OpenMausBot faz — electron/ é devDependency da raiz
e valor de "main"; companion/ tem package.json e mesmo assim está fora do workspace;
ios/ e android/ não têm package.json nenhum.
```

## Riscos

- A primeira fricção do onboarding passa a ser configurar uma chave de API, para todo cliente, sem exceção. É o preço direto de manter só o modo container, e não tem contorno. Mitigação possível: transformar isso num passo guiado do onboarding com validação real da chave (nunca 'a variável está setada'), para que a falha apareça na hora e não depois da primeira mensagem.
- Objeção comercial previsível: um cliente que já paga Claude Max vai perguntar por que não pode usar aquela assinatura. A resposta precisa estar pronta antes da primeira venda: no modo hospedado o nod garante isolamento entre clientes, teto de gasto real e trilha de auditoria, e nenhuma das três sobrevive à assinatura pessoal. Isso é argumento, não desculpa — mas precisa ser dito por alguém que decidiu, não improvisado numa call.
- Risco de contrato com binário de terceiro: toda a sonda do ADR-019 depende do formato de saída de um CLI que o fornecedor pode mudar sem aviso. O pin de versão exata do ADR-014 congela o problema até o upgrade obrigatório — e no dia do upgrade, TODOS os tenants ficam 'deslogados' ao mesmo tempo. Sem teste de contrato contra o binário real no CI, esse é o tipo de incidente que consome uma semana de um time de três.
- Risco de identidade cruzada: se em algum momento o email ou a organização que o CLI reporta for usado para qualquer decisão de permissão, trocar de conta no CLI vira escalada de privilégio no produto. A proibição precisa estar escrita ANTES de alguém implementar, porque desentrelaçar depois é migração de permissão, não refatoração.
- Risco de push subestimado: todo o roadmap mobile repousa em Web Push em PWA funcionar bem o bastante, e ninguém mediu a taxa de instalação de PWA entre gestores de RH em cliente B2B brasileiro. Mitigação obrigatória: notificação primária por e-mail e WhatsApp, canais que o time já domina. Web Push é bônus, nunca dependência.
- Risco de LGPD que precisa de jurídico, não de engenharia: cada tenant roda um CLI de terceiro com dado pessoal sensível sob infraestrutura do nod. O ADR-014 já registra que --strict-mcp-config impede o CLI LER configuração mas não impede ESCREVER transcrição, cache ou log de crash, e por isso existe o diretório por turno apagado ao fim. Alguém do jurídico precisa confirmar que essa mitigação basta para dado pessoal sensível — isso não é decisão de arquitetura.
- Risco jurídico secundário, hoje sem resposta: a afirmação de que a Anthropic permite assinatura pessoal em plataforma hospedada vem de um comentário de código de outro projeto, não de um parecer. Se a ideia de 'traga sua assinatura' voltar em qualquer forma, a leitura dos termos atuais do fornecedor precisa vir antes do ADR, não depois.
- Risco de fila invisível se o desktop nunca vier: sem app instalado e sem push nativo, a pessoa só descobre um item novo quando abre o e-mail, o WhatsApp ou o navegador. Se a medição mostrar que a decisão demora por falta de aviso — mesmo com os canais no ar — o gatilho 2 do ADR-020 dispara e o cálculo do desktop muda. Isso é um risco a MEDIR, não a prevenir com código agora.
- Risco de custo recorrente subestimado, para quando o desktop vier: certificado Apple expira anualmente e quebra o release no dia; upgrade de Electron é obrigatório por CVE de Chromium algumas vezes ao ano e revalida a matriz inteira; o auto-update exige dois patches mantidos à mão contra a forma do upstream. Meio dia por semana em regime para mac+Windows, 1-2 dias por semana somando iOS nativo — 10 a 20% da capacidade de um time de três, permanentemente fora do produto. Esse número precisa entrar na conversa no dia em que o gatilho disparar, não depois.
- Risco de numeração de ADR: as quatro áreas de investigação propuseram ADR-019 e ADR-020 diferentes entre si. Se qualquer um for escrito sem conciliar, o repositório ganha dois arquivos com o mesmo número. A alocação proposta aqui (019 = sonda; 020 = ordem de distribuição; o resto vira emenda) precisa ser confirmada antes de qualquer redação.
