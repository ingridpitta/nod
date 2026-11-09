# ADR-122 — O computador da pessoa roda no motor

Status: aceita (PR 1 da NOD-96: decisão, dados e contratos; o comportamento entra nos PRs 2 a 7, atrás de
`NOD_COMPUTADORES=motor`) · Data: 2026-10-22 · Revê a [ADR-037](adr-037-computadores-por-bot.md) (um computador por
bot, container Docker no servidor); emenda a [ADR-090](adr-090-o-motor-numa-maquina-linux-da-pessoa.md) item 10 e a
[ADR-085](adr-085-uso-do-mac-segura-trabalho-novo.md)/[ADR-097](adr-097-agentes-entram-trabalho-pesado-faz-fila.md)
(as telas entram pela mesma régua). Plano do Arquiteto no comentário de 22/10 (11:52) da NOD-96; protótipo v2
aprovado (`53c1c07`). O plano chamava esta ADR de "ADR-118": 117 a 121 já estavam tomadas por PRs abertos.

## Contexto

Decisões do Marlon em 21/10: "quero compartilhar o computador para todos os bots, assim como o Grok Bot faz", com o
mesmo modelo do Grok: **uma máquina por pessoa**, disco comum, **tela e Chrome por bot**, em paralelo e sem fila,
**cookies compartilhados**. O computador roda **na máquina da pessoa, pelo motor** (ADR-090), e tem de funcionar numa
VM Linux como a `nod-motor-teste`. Medido nela em 21/10: GCP e2-standard-8 (8 vCPU, 31 GB), Debian 12 bookworm,
kernel 6.1, **sem Docker, sem Podman e sem `/dev/kvm`**; com `bwrap`, user namespaces sem privilégio e systemd 252.
"Pode recriar do zero": a máquina nasce nova, sem migrar os volumes por bot. Memória: "igual fazemos nos bots" — sem
número fixo de telas, a régua e o modo de uso que já existem.

O computador por bot (ADR-037) está desligado em produção (sem `NOD_COMPUTADORES=docker`) e ficou fora da ADR-090.

## Decisão

1. **Um computador por pessoa, uma tela por bot.** A unidade é (tenant, dona): uma linha em `computadores` com
   `modelo = 'por_pessoa'` e uma linha por bot em `computador_telas` (0106). Cada tela é um Xvfb `:1NN`, um openbox e um
   Chromium com perfil próprio (fork de `perfil-base`), em paralelo; a única espera é por memória. O controle (Assistindo
   / no controle), a política (supervisionado / autônomo), o pedido de ajuda e a reserva da ação passam a ser **da
   tela**: assumir pausa só aquele bot. As aprovações continuam por bot ("o resto desta tarefa" de A não libera B).
   `agentes.computador_id` deixa de ser único: os bots da pessoa apontam para o mesmo computador.
2. **Cookies comuns por loja única + CDP, não por symlink.** Dois Chromes no mesmo SQLite `Cookies` não é seguro (cache
   em memória por processo, lock e WAL por processo). Uma loja só, `logins/principal/cookies.enc` (AES-256-GCM, como o
   checkpoint de hoje): a tela manda ao supervisor o diff depois de cada ação, o supervisor funde (último a escrever por
   `lastAccess` e sequência), grava atômico e repassa às outras telas por `addCookies`/`clearCookies`; quem abre depois
   sobe com a loja aplicada. Alvo: menos de 1 s entre telas. Só cookies nesta versão (senhas e storage na NOD-97).
3. **Um keyring por máquina, com o Safe Storage determinístico.** Um gnome-keyring, desbloqueado com
   `HMAC(NOD_CREDENTIAL_KEY, "nod-computador:"+id)` (como hoje), que vai no comando `iniciar` selado para a chave X25519
   do supervisor e nunca toca o disco. A senha "Chromium Safe Storage" é gravada antes do primeiro Chrome como
   `HKDF(chave da máquina, "login:principal:chrome-safe-storage-v1")`: todos os forks decifram os mesmos blobs, e ela
   sobrevive a Atualizar e Redefinir.
4. **Isolamento por uids + systemd + bwrap + comandos assinados, no lugar do container.** Na VM-alvo não há Docker,
   Podman nem KVM, e o instalador não deve pôr um daemon de container. Quatro camadas:
   - **uids próprios**: `nod-pc` (supervisor, Xvfb, Chrome, keyring) e `nod-pc-term` (terminal). O `nod` (motor e CLIs
     dos bots) não lê `/var/lib/nod-computador/<id>/{perfis,logins,keyring}` (0700); com outro uid, o `ptrace` não
     alcança o Chrome.
   - **unidade systemd** `nod-computador.service`, ativada por socket (0660, grupo `nod`), com `NoNewPrivileges`,
     `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `PrivateDevices`, `ProtectKernel*`, `OOMScoreAdjust=300` e
     **`IPAddressDeny`** para loopback, faixas privadas, CGNAT, link-local e **169.254/16 (metadata)**: o egress da
     ADR-037 feito no kernel, por cgroup, sem proxy nem rebinding de DNS.
   - **bwrap por tela**: só o próprio perfil, `logins/` em leitura e `/workspace`; o resto do sistema em leitura. Com
     userns, o **Chrome volta ao próprio sandbox**. CDP só por pipe.
   - **comandos assinados**: os CLIs dos bots rodam como `nod` e alcançariam o socket. O servidor assina cada comando
     (`ComandoComputador.assinatura`, Ed25519, semente `HKDF(NOD_CREDENTIAL_KEY, "nod-computador-assina:"+id)`); o
     supervisor confere a assinatura, a validade de 2 min e o id não repetido. A chave X25519 do supervisor fica em
     `computadores.supervisor_pub` no primeiro contato (TOFU) e só troca pelo Redefinir.
   O terminal (`nod-pc-term`) só escreve em `/workspace`, não tem `DISPLAY` e tem o mesmo `IPAddressDeny`. Vale para o
   terminal do bot; o Terminal do dock, que a pessoa usa pelo VNC (PR #600), roda como `nod-pc` num bwrap próprio e
   com o display da tela: ver os riscos aceitos 1 a 3 da ADR-138.
5. **Admissão pela régua e espera em fila.** Antes de abrir uma tela, o supervisor aplica `deveSegurar(uso, memória,
   processador, regra)` com a leitura local do motor e o modo de uso da pessoa (Pouco / Equilibrado / Livre; o `uso` vai
   em cada comando). Se segura, fecha a tela ociosa mais antiga e reavalia; sem ociosa, responde `esperando_tela` com
   quem está usando, e a tela vai para `esperando` (fila por `esperando_desde`). A ferramenta espera no próprio turno, em
   fatias, como a aprovação; em Livre nunca segura. Falta de memória é espera, nunca erro.
6. **Onde roda.** `computadores.maquina_id` (contrato da NOD-94; nulo = "onde o nod roda") e `hospedeira_id` (onde o
   disco está agora). O despachante escolhe `maquina_id`, senão `hospedeira_id`, senão a única máquina Linux que anuncia
   `computador: pronto`, senão a máquina padrão, senão a de contato mais recente; nunca a máquina do turno. Mac com VM local
   anuncia computador (ADR-127). O motor anuncia `AnuncioComputador` (`pronto | faltam_pacotes | sem_suporte`, com `falta`).
7. **Atualizar, Redefinir e Sair de todos os sites** são da máquina inteira, uma de cada vez
   (`computadores.operacao*`, com progresso de 0 a 100 e a etapa). Atualizar troca binários e preserva workspace,
   perfis e logins; Redefinir apaga tudo menos `logins/`, recria `perfil-base` e esquece a chave do supervisor; Sair de
   todos zera a loja. Durante a operação a ação espera ("atualizando"), não falha.
8. **Legado recriado do zero.** Ao passar ao motor, os computadores por bot da pessoa são arquivados
   (`arquivado_em`), os bots deixam de apontar para eles, os containers param e os volumes ficam 30 dias sem uso pelo
   produto; a pessoa vê uma vez "entre nos sites de novo". Nada é migrado.
9. **Com a flag desligada, nada muda.** `NOD_COMPUTADORES` diferente de `motor` não cria linha `por_pessoa`; o modo
   `docker` segue um computador por bot.

### Desvio do plano: o índice único tem discriminador

O plano pedia `UNIQUE (tenant_id, owner_id) WHERE arquivado_em IS NULL`. Isso quebraria a flag desligada (o modo
docker cria uma linha por bot da mesma pessoa) e o deploy falharia em quem já tem dois bots com computador. A 0106
acrescenta `computadores.modelo` (`por_bot`, padrão, ou `por_pessoa`) e o índice vale só para `modelo = 'por_pessoa'`.
As colunas de `computadores` que passam a ser da tela (controle, política, ajuda, reserva) ficam paradas no modelo
`por_pessoa` e saem numa migração posterior.

## Medido

- **Memória por tela, medida em 22/10 na `nod-motor-teste`** com `scripts/medir-tela.mjs` (PSS somado por árvore de
  processos, via `smaps_rollup`; Xvfb 1280×800×24 + openbox + Chromium 1243 do Playwright, um perfil por tela, aba em
  `pt.wikipedia.org/wiki/Brasil`, 20 s depois de abrir):

  | telas | PSS total | por tela | Xvfb | openbox | Chromium |
  |---|---|---|---|---|---|
  | 1 | 576 MB | 576 MB | 15 MB | 11 MB | 549 MB |
  | 3 | 1286 MB | 429 MB | 39 MB | 15 MB | 1233 MB |
  | 6 | 2314 MB | 386 MB | 75 MB | 23 MB | 2217 MB |

  A primeira tela custa ≈ 0,58 GB; cada tela a mais, ≈ 0,35 GB (as bibliotecas do Chromium se dividem no PSS). A
  estimativa de ≈ 0,5 GB por tela típica se confirma; site pesado passa disso. O processo da tela (Node + Playwright)
  não entrou na medida (≈ 50 MB estimados). A admissão não usa o número: usa a régua.

## Registrado, sem medida

- **Risco do TOFU:** um processo malicioso já presente no primeiro boot poderia fixar a chave dele. A janela é curta; a
  correção é o Redefinir.
- **Alvo Debian 12 bookworm.** Ubuntu 24.04 restringe userns por AppArmor e o bwrap e o sandbox do Chrome falham: o
  motor anuncia `sem_suporte`. Trixie entra como smoke secundário no PR 7.
- **Chromium fixado pela versão do Playwright do repo** (em `/opt/nod-motor/chromium`), não o do apt, cuja versão
  diverge da API do Playwright. A segurança dele depende do Atualizar (NOD-295); alerta quando passar de 60 dias.
- Portas fora de 80/443 passam a ser permitidas; as faixas privadas e a metadata seguem bloqueadas.

### Desvios do PR 2 (supervisor, isolamento e instalação)

- **TOFU da chave do servidor:** o supervisor não tem a NOD_CREDENTIAL_KEY. O primeiro `iniciar` traz `servidorPub`
  (Ed25519), que fica em `estado/servidor.pub`; antes disso, todo comando é recusado. O Redefinir não a troca.
- **scrot** entra no apt: a tela captura com ele, como o runtime do container.
- **Áudio fica fora do PR 2:** o pulseaudio é instalado, mas a tela não o liga.
- **Atualizar** só fecha as telas e desliga a máquina, preservando perfis, logins e workspace; a troca dos arquivos
  é a reinstalação (o script reinicia o serviço).
- **Os arquivos do computador ficam fora do atualizador automático (ADR-100):** só o script os instala. O manifesto
  segue com os três arquivos do motor.
- **DNS só pelo stub do systemd-resolved (127.0.0.53).** No GCE o resolvedor é 169.254.169.254, o mesmo IP da
  metadata, então liberar o IP do resolvedor abriria a metadata. A tela e o terminal leem
  `/run/systemd/resolve/stub-resolv.conf` como `/etc/resolv.conf` (`BindReadOnlyPaths` nas units; no bwrap, montado
  no realpath, porque o bwrap não monta sobre symlink) e o egress libera só `127.0.0.53/32`. Quem fala com o
  resolvedor da nuvem é o resolved, fora da sandbox. O script instala o systemd-resolved quando falta (levando os
  servidores do resolv.conf, menos os 127.x) e o motor anuncia `faltam_pacotes: ["systemd-resolved"]` sem o stub.
- **O run de cada tela fica sob `--tmpfs`** no bwrap, como a raiz das telas, e a pasta dos sockets do supervisor
  (`/run/nod-computador`) também fica escondida. Só os binds da própria tela aparecem.
- **Grupo próprio para o `term.sock`: `nod-pc-ctl`**, só com o supervisor e o motor. O `nod-pc-arquivos` segue só para
  os arquivos.
- **Recusa de assinatura** (sem chave fixada, assinatura inválida, repetido, vencido) responde `acao_falhou`, sem
  motivo novo; o detalhe vai para o log do supervisor.
- **O motor só anuncia `computador`** quando `/opt/nod-motor/computador` existe. Assim, máquina instalada sem a flag
  manda o mesmo anúncio de antes.
- Endurecimento das units: além do plano, `ProtectKernelLogs` e `ProtectControlGroups`. As units ainda não rodaram
  sob systemd numa VM limpa: a primeira instalação de verdade é o smoke do PR 7.

## Emenda 2026-10-24 (NOD-97 PR 3): o DISPLAY de cada tela tem cookie

O §4 diz que o terminal "não tem `DISPLAY`", mas não ter a variável não fecha o servidor X. O Xvfb também escuta no
socket abstrato `@/tmp/.X11-unix/X1NN`, que é por network namespace: não some no `PrivateTmp` nem no bwrap, e nenhuma
das camadas isola a rede local. Sem `-auth`, o Xvfb aceitava qualquer processo da máquina, inclusive o motor, os
CLIs dos bots (uid `nod`), o terminal (`nod-pc-term`) e a tela de outro bot. Quem abrisse o DISPLAY via a tela, digitava
nela e lia o clipboard, sem passar pelos comandos assinados.

- **Cada tela tem um cookie `MIT-MAGIC-COOKIE-1` só dela**, de 16 bytes aleatórios, novo a cada subida. Fica em
  `<run>/<id>/telas/<agente>/Xauthority` (0600, uid `nod-pc`): o run é 0700 e, no bwrap, o tmp das outras telas
  fica sob `--tmpfs`. O arquivo é escrito em Node (`arquivoXauthority`, uma entrada FamilyWild no número do display)
  para não depender do pacote `xauth`.
- **O Xvfb sobe com `-auth <arquivo>` e `-nolisten local`** (`argsDoXvfb`), além do `-nolisten tcp` de antes: fica só o
  socket do caminho, que o bwrap monta em `/tmp/.X11-unix`. Openbox, Chromium, xdotool, xclip e scrot recebem
  `XAUTHORITY`.
- **Teste:** com Xvfb de verdade (pula se a máquina não o tem), sem o cookie ou com outro cookie a conexão é recusada,
  com o cookie é aceita e o socket abstrato não existe. O que já era garantido segue coberto: o terminal não vê
  `logins/`, os perfis e o keyring (0700, outro uid) e roda sem `DISPLAY`.

## Emenda 2026-10-24 (NOD-97 PR 4): o storage das origens com login é em comum

Só cookies não bastam: muitos sites guardam a sessão em `localStorage` ou IndexedDB. Agora o storage dessas origens
também é um só entre as telas, como a loja de cookies do §2.

- **Só as origens com login.** Uma origem é "com login" quando há cookie httpOnly vivo que vai para o host dela. O resto
  do storage fica no perfil de cada bot.
- **A tela coleta na própria aba** (`coletarNaPagina`, via `page.evaluate`):
  - no máximo uma vez a cada 10 s por origem, depois de cada ação; a coleta que o ritmo segura não se perde, agenda
    uma rodada para o fim da janela da origem;
  - de forma forçada antes de `navegar` (a origem que a aba deixa), ao fechar e no SIGTERM;
  - com prazo de 5 s por aba: página cujo `indexedDB.databases()` não resolve fica fora da rodada sem segurar a
    resposta da ação;
  - manda `{tipo:'storage', origem, em, hash, dados}`, e só quando o hash muda.
  - Fica fora o que não cabe no JSON: um banco com Blob, File ou CryptoKey sai inteiro e vai para `pulados`. O
    `pulados` não entra no hash (muda de perfil para perfil sem o conteúdo compartilhado mudar); sem isso, dois bots
    trocavam versões do mesmo conteúdo.
- **O supervisor grava e repassa:**
  - faz LWW por origem (`em` maior vence; o mesmo hash não regrava);
  - cifra em `logins/principal/storage/<sha256(origem)>.enc` com AES-256-GCM e HKDF `login:principal:storage-v1`;
  - grava o índice cifrado `estado.enc {geracao, versoes}`. O plano dizia `estado.json`, mas a lista de origens já
    revela onde a pessoa tem conta;
  - repassa às outras telas abertas e manda tudo no config de cada tela nova;
  - recusa origem acima de 5 MB (fica só no bot).
  - **Desvio do plano:** o plano previa um lockfile `O_EXCL` na pasta do storage. O único processo que escreve ali é o
    supervisor, e ele já serializa as mensagens de storage na fila da máquina (a mesma dos cookies), então o lock
    virou essa fila. A leitura da tela que abre não entra na fila: como a origem é gravada antes do índice, `lerTudo`
    aceita o arquivo da origem uma versão à frente do `estado.enc`. Gatilho de reversão: um segundo escritor (outro
    processo ou outra máquina) na mesma pasta traz o lockfile de volta.
- **A tela aplica só onde não quebra o site.** O que chega fica pendente e é aplicado em dois momentos:
  - na subida;
  - ao navegar para a origem, quando nenhuma aba está nela.

  A aplicação vai a uma página vazia da origem (`page.route`, com o service worker desligado por CDP) e roda
  `restaurarOrigem`. Trocar sob o site vivo o deixaria pela metade, então uma origem aberta noutra aba espera.
- **Regra da restauração: só troca o que veio.** Corrigido na rodada 3 do #515: a versão anterior apagava todo banco
  local fora dos `pulados` do remetente, e o receptor perdia os próprios bancos (inclusive os com Blob).
  - O `localStorage` da origem é trocado inteiro.
  - Um banco IndexedDB só é apagado e regravado quando está no snapshot (`dados.indexedDB`). Banco do receptor que
    não veio, inclusive os `pulados` do remetente, fica como está.
  - Antes de restaurar, o receptor coleta a própria aba. Os bancos que ele não consegue coletar (os `pulados` dele,
    ex.: com Blob) não são apagados nem substituídos, mesmo que o snapshot traga um banco de mesmo nome: a versão
    local ganha, porque não teria como voltar. Sem essa coleta (prazo vencido), a origem não é restaurada.
  - Depois, o receptor coleta de novo e guarda como versão da origem o hash do que ficou, não o do snapshot. Com o
    hash do snapshot, o banco que ficou só no receptor faria a próxima coleta parecer mudança, e os dois bots
    trocariam versões sem fim.
  - Consequência aceita: um banco apagado num bot não some dos outros por esta via; "Sair de todos os sites" é o
    caminho para limpar. Gatilho de reversão: um site cujo logout depende de apagar um banco IndexedDB e que deixe
    os outros bots logados.
- **Sem `storageState`/`setStorageState` do Playwright:**
  - o `storageState` abre uma aba escondida por origem a cada coleta;
  - o `setStorageState` limpa os cookies e o storage do contexto inteiro.

  Os scripts seguem o formato do StorageScript do 1.63, por origem.
- **Teste:**
  - unitário, das regras (login, LWW, teto, cifra);
  - ida e volta no Chromium de verdade, com `localStorage` e IndexedDB com índice, chave composta, Date, Map, Set,
    BigInt e Uint8Array (pula sem Chromium);
  - no Chromium de verdade, o receptor com um banco que não veio e um banco com Blob de mesmo nome do snapshot
    mantém os dois intactos;
  - concorrência no supervisor: repasse, tela nova, origem sem login fica no bot, LWW com a origem aberta pendente,
    reabrir mantém, disco cifrado; e dois bots gravando a mesma origem 100 vezes ao mesmo tempo, com um leitor que
    confere a cada passo que o índice e a origem decifram e, no fim, que o LWW ficou com a última volta.

## Emenda 2026-10-24 (NOD-97 PR 5): as senhas salvas do Chrome são em comum

Com cookies e storage em comum, faltava a senha que o Chrome salva: sem ela, cada bot pedia de novo o login que outro
já tinha feito. Agora o `Login Data` é um só entre as telas, pelo mesmo caminho da loja de cookies do §2.

- **Ninguém decifra a senha.** O campo `password_value` vem cifrado pelo Safe Storage do keyring da máquina (§3, a
  mesma chave em todos os perfis) e viaja como BLOB em base64, byte a byte igual. O nod nunca tem a senha em claro.
- **O supervisor recolhe e funde:**
  - lê uma cópia do `Login Data` do perfil do bot (com `integrity_check`) depois de cada ação e quando a tela fecha;
  - só copia quando o mtime ou o tamanho do arquivo mudou desde a última leitura (`marcasSenhas`, que zera ao
    desligar a máquina);
  - funde por linha única do Chrome (`origin_url`, `username_element`, `username_value`, `password_element`,
    `signon_realm`) em LWW por `date_password_modified` (ou `date_created`, na linha antiga);
  - cifra em `logins/principal/senhas.enc` com AES-256-GCM e HKDF `login:principal:senhas-v1`, junto com o esquema e
    a `meta` do arquivo de origem.
- **A tela importa antes de abrir o Chrome.** As senhas vão no config da tela, e ela as grava no `Login Data` do perfil
  antes do Chrome subir (ele trava o arquivo em uso). Se o perfil não tem o arquivo, ele é criado pelo esquema que
  veio na loja. A importação é upsert com LWW: a linha local mais nova (ainda não recolhida, por exemplo depois de uma
  queda do supervisor) não é sobrescrita.
- **Datas do Chrome acima de 2^53.** As datas são microssegundos desde 1601 (~1,3e16). São lidas como BigInt
  (`setReadBigInts`), viajam no JSON como `{big: "..."}` e voltam BigInt ao gravar. Sem isso, a leitura de um
  `Login Data` real lançava `RangeError` e nenhuma senha era recolhida.
- **O bot não vê a senha.** Um init script em toda página (`mascaraDeSenha`) põe `-webkit-text-security: disc` nos
  campos que o Chrome preenche e nos que já foram `type=password`, e continua cobrindo quando o site troca o campo para
  `type=text` ("mostrar senha"). O valor fica no campo (o site funciona); só não aparece no screenshot nem no texto. O
  CSS não atravessa shadow DOM, então o `attachShadow` é embrulhado e cada root ganha o mesmo estilo e observador.
  Quando o Chrome preenche, a tela avisa uma vez por origem, e o chat mostra a linha cinza com o selo "‹bot› não vê a
  senha".
- **Desvio do plano: sem relançar o Chrome ocioso.** O plano relançava o Chrome de outro bot, ocioso, quando chegasse
  uma senha mais nova, para ela valer já. O PR só aplica a senha na próxima abertura da tela daquele bot: relançar sob
  o bot fecha as abas dele e perde o estado da página, e a tela ociosa já fecha sozinha (o servidor manda `fechar_tela` aos 15 min). Gatilho de
  reversão: um bot pedir de novo uma senha que outro já salvou, com a tela aberta, em mais de 1 de cada 10 logins
  em 14 dias de log.
- **Fica de fora o shadow DOM declarativo `closed`.** Ele não passa pelo `attachShadow` e ninguém de fora o alcança;
  a máscara não chega lá. O shadow DOM aberto, o declarativo aberto e o `closed` criado por script são cobertos.
- **Teste:**
  - unitário, das regras (LWW, esquema, datas BigInt, upsert sem sobrescrever a linha local mais nova, recolher só
    quando o mtime muda);
  - ida e volta no Chromium de verdade: exporta de um perfil, cria o `Login Data` noutro e o BLOB volta igual;
  - máscara no Chromium de verdade: `type` trocado para `text`, campo criado depois, shadow DOM aberto e fechado, e
    uma senha marcadora que não aparece no texto, no título nem no screenshot (com controle sem a máscara);
  - concorrência no supervisor: a senha de um bot vai para a loja e para a tela do outro, e a marcadora não aparece
    nos resultados, nos logs nem no disco.

## Emenda 2026-10-24 (NOD-97 PR 5 e PR 6): senhas salvas em comum e as operações que as esquecem

**PR 5 — senhas em comum.** O Chrome guarda as senhas no `Login Data` (SQLite) de cada perfil; o campo de valor fica
cifrado pelo Safe Storage do keyring da máquina (v11, a mesma chave em todos os forks). Ninguém aqui decifra esse
campo: o supervisor copia as linhas como estão (BLOB em base64) para `logins/principal/senhas.enc` (cifra própria,
HKDF `login:principal:senhas-v1`) e as põe no `Login Data` de um perfil antes do Chrome dele abrir.

- **Chave única** da linha = o UNIQUE do Chrome (`origin_url`, `username_element`, `username_value`,
  `password_element`, `signon_realm`); **LWW** por `date_password_modified` (sem ela, `date_created`). O esquema do
  `Login Data` só é recriado quando o perfil ainda não tem o arquivo.
- **Exportação** lê uma cópia parada (Chrome fechado, journal vazio); **importação** só com o Chrome fechado.
- **Máscara:** a tela nunca manda o valor da senha; um `addInitScript` marca os campos de senha e a observação só diz
  se a origem **tem** uma senha preenchida (`senhaPreenchida: { origem }`), nunca o valor.

**PR 6 — esquecer e limpar.** Duas operações da pessoa, no mesmo padrão de Atualizar/Redefinir/Sair de todos (enum
`operacao_computador`, estendido na migração 0112; progresso e etapas; aviso no chat por tela aberta):

- **Esquecer senhas salvas** (`esquecer_senhas`): espera as telas que estão abrindo, fecha as abertas, apaga
  `senhas.enc`, o `Login Data` e o `Login Data For Account` (com journal/WAL) de cada perfil (base e por bot) e
  religa as telas que estavam abertas. Os cookies e o storage ficam. A foto do supervisor reconcilia o estado das telas
  religadas (o banco não as marca fechadas). Se o `rm` falha, as telas são religadas mesmo assim e a operação termina
  `falhou` (`acao_falhou`), sem deixar a fila da máquina travada.
- **Sair de todos os sites** passa a levar também o **storage** em comum. `limparStorage` sobe a **geração** do
  storage (gravada no índice) e zera o índice. Como a pessoa pode sair com telas fechadas e origens fora da aba, a
  limpeza não depende de cada aba aberta:
  - a tela aberta recebe `limpar_storage {geracao}`, limpa por CDP (`Storage.clearDataForOrigin`) todas as origens
    que ela conhece (as abertas, as pendentes, as que já foram para o índice e todas as que um frame dela visitou,
    anotadas em `nod-origens.json` no perfil, com teto de 5000) e grava a geração no perfil (`nod-storage-geracao`).
    As visitadas cobrem o site que guarda a sessão só em IndexedDB/localStorage, sem cookie de login, que não entra
    no índice. Para a página viva não regravar a sessão que tem na memória (o SPA que renova o token), as abas vão
    para `about:blank` antes da limpeza e voltam ao endereço em que estavam depois, já deslogadas; as idas e voltas
    são em paralelo e com prazo curto (a volta espera só o commit), para a tela responder dentro dos 15 s do
    supervisor mesmo com abas em sites lentos. Se a limpeza falha, as origens visitadas continuam anotadas para o
    próximo Sair de todos. O storage particionado de iframes de terceiros não é coberto;
  - a tela que abre depois recebe a geração no config e, se o perfil é de uma geração mais velha, apaga
    `Local Storage`, `Session Storage` e `IndexedDB` do perfil antes do Chrome subir.

  A tela responde a `limpar_cookies` e a `limpar_storage` (antes `limpar_cookies` não respondia e o supervisor só
  não travava porque matava a tela no timeout — corrigido). A operação termina `falhou` (`acao_falhou`) quando
  qualquer limpeza não acontece: a loja de cookies não grava, `limparStorage` falha, ou uma tela aberta responde
  `erro` (ou não responde em 15 s) a `limpar_cookies` ou a `limpar_storage`. Mesmo assim o resto segue: as outras
  telas são limpas, cada erro vai para o log com o bot, e a fila da máquina não fica travada.
- **Etapas:** a primeira etapa de cada operação é a da lista que o painel mostra ("Saindo das contas",
  "Esquecendo senhas"), não um "Preparando" genérico.
- **Desvio do plano (PR 6).** O plano pedia uma rota própria, `POST /computador/esquecer-senhas {confirmar:true}`,
  que devolvia `relancados`, sem migração, e uma linha "Senhas salvas esquecidas" no chat. O PR fez outra coisa:
  - **operação do computador**, como Atualizar/Redefinir/Sair de todos: `POST /computador` com
    `operacao: "esquecer_senhas"`, sob o escopo da pessoa, `travarDaPessoa` e RLS. Ganha progresso, etapas, registro
    com autor `pessoa` e a recusa de uma segunda operação em curso. O bot não tem ferramenta para dispará-la;
  - **confirmação só na UI**, igual a Redefinir e Sair de todos: a API não pede `confirmar:true`;
  - **sem `relancados` na API**: o motor devolve `{}`. Quantas telas religaram só aparece no supervisor e no estado
    das telas;
  - **aviso por tela aberta** no chat (o mesmo de Sair de todos), no lugar da linha "Senhas salvas esquecidas";
  - **migração 0112**, que estende o enum `operacao_computador`, contra o "nenhuma migração" do plano.

  Motivo: um caminho só para as quatro operações da pessoa (trava, auditoria, idempotência e painel) em vez de uma
  rota com regras próprias. Gatilho de reversão: uma integração fora do painel precisar disparar o esquecer com
  confirmação no servidor ou ler `relancados`.
- **Teste:**
  - supervisor apaga senhas e `Login Data` e segue ligado; falha no `rm` ou na limpeza vira `acao_falhou` e a fila
    segue;
  - esquecer espera a tela que estava abrindo e a religa;
  - Sair de todos zera a loja e o storage, e a tela fechada reabre sem o storage (Chromium real);
  - CDP limpa uma origem que não está aberta em nenhuma aba (Chromium real);
  - `esquecerSenhas` apaga `Login Data For Account`;
  - `operarDaPessoa`/motor de `esquecer_senhas`;
  - painel com a ação Esquecer senhas, a confirmação (texto literal do plano) e as etapas.

## Emenda 2026-10-28: ligado em produção

`NOD_COMPUTADORES=motor` no `infra/gcp/config.env`; o `deploy.sh` leva a linha ao env da cor nova, limpa de espaços e
CR (o servidor compara por igualdade exata, e um `motor\r` desligaria em silêncio). Vai junto `NOD_URL_PUBLICA`
(`https://<NOD_DOMINIO>`): o script de `/motor` passa a apontar sempre para o domínio, também quando servido pelo
endereço provisório. Nenhuma outra variável é exigida pelo modo motor: as chaves de assinatura e do keyring derivam
da `NOD_CREDENTIAL_KEY`; `NOD_COMPUTADORES_MAX` e `NOD_COMPUTADOR_IMAGEM` são do modo `docker`, e
`NOD_COMPUTADOR_OCIOSO_MIN` (varredor de ociosidade) fica no padrão de 15 min. Reverter: esvaziar a linha e rodar o
deploy (a tela some e as rotas dão 404; o arquivado do modelo por bot não volta; reverter a imagem por tag não desliga).

## Emenda 2026-10-28 (NOD-365): o computador muda de máquina

O computador da pessoa pode morar em outra máquina dela ("Onde o computador mora"). A loja de logins vai cifrada, como
está no disco, em partes de 384 KiB pela ponte (`exportar_logins` na origem, `importar_logins` no destino); o servidor
só repassa e nunca decifra. A chave da loja deriva do id do computador, então a loja é portável entre máquinas.

- **TOFU ampliado:** `exportar_logins` e `importar_logins` também fixam a `servidorPub` (como o `iniciar`), porque o
  destino de uma troca nunca recebeu um `iniciar`. **Risco aceito:** um processo local como `nod` na máquina nova,
  antes da primeira troca, poderia fixar uma chave dele e recusar os comandos do servidor. O efeito é negação de
  serviço (a troca falha e o banco volta à origem); ele não lê a loja, que segue cifrada com uma chave que só o
  servidor deriva. A correção é a mesma do TOFU original: o Redefinir.
- **Uma coisa de cada vez no supervisor:** `iniciar`, `exportar_logins`, `importar_logins` e `marcar_saida` andam em
  série por computador; com uma exportação aberta, `iniciar` e `abrir_tela` recusam com `atualizando` (vence em
  10 min). O driver espera o `iniciar` em voo antes de começar a troca.
- **A origem fica 30 dias:** recebe `marcar_saida` (`.saiu-em`) e a varredura apaga a pasta depois de 30 dias. A
  origens sem contato ficam em `computadores.saidas_pendentes_de` e recebem o `marcar_saida` no primeiro ligar em que
  estiver conectada; o destino que recebeu a loja e não ligou (a troca voltou) também é marcado.
- **Trazer de volta** para onde o nod roda grava `maquina_id` nulo e só a `hospedeira_id`.
- **Gatilho de reversão:** um caso de loja perdida ou trocada pela metade em 30 dias de log
  (`computador_troca_nao_revertida`) → a troca volta a exigir a origem desligada à mão e a cópia por SSH.

## Fora

(Tela ao vivo saiu daqui: [ADR-138](adr-138-tela-ao-vivo-por-vnc.md), 2026-10-29.)

Compartilhar por workspace (bots de colegas); mais de uma máquina por pessoa; compartilhar
extensões (NOD-97); rotear o navegador pelo Mac da pessoa; computador no Mac (NOD-93) e na
nuvem gerenciada (NOD-92/NOD-89).

## Gatilho de reversão

Mais de 1 em 10 aberturas de tela falhando por isolamento (bwrap, userns, systemd) em 14 dias de log, ou uma fuga
confirmada do uid `nod-pc` → voltar ao container, com **Podman rootless** instalado pelo motor.
