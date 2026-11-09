# ADR-101 — Várias contas por IA: um diretório por conta, troca manual por padrão

Status: aceito (opção 2 do Marlon, 2026-10-12) · Data: 2026-10-12 · Estende a [ADR-019](adr-019-a-sonda-de-disponibilidade-pergunta-ao-cli-nunca-le-a-cr.md)
(a sonda pergunta ao CLI, nunca lê a credencial) · Issue: NOD-211

**Veredito: viável com ressalvas.** A parte técnica funciona com o que os dois CLIs já oferecem. A ressalva está nos
termos: nenhum dos dois fornecedores proíbe ter várias contas, mas a troca *automática* no limite esbarra em cláusulas
contra contornar limites. Além disso, a política da conta corporativa da Lumen para esse uso não foi encontrada.

## Contexto

O Marlon quer várias contas do Claude Code e do Codex logadas ao mesmo tempo, com o nod trocando sozinho de conta
quando uma bate no limite. Hoje o app do Mac guarda **uma** conta por IA: `contasDasIas: Map<IaDesktop, ContaDaIa>` em
`desktop/main.ts`, e o login da NOD-209 roda com `ambienteDaIa(ia, cfg)`. Já existe a troca de **IA** (Claude↔Codex) em
`harness=auto` (emenda de 05/10 da ADR-019). Falta a troca de **conta** dentro da mesma IA.

A investigação abaixo foi feita na `nod-motor-teste` (Linux), com Claude Code 2.1.296 e Codex 0.162.x. Nenhum arquivo de
credencial foi lido: quem respondeu foi sempre o CLI.

### 1. Logins independentes por diretório (inclui o Keychain do macOS)

- **Claude.** A documentação oficial tem a seção "Log in with multiple accounts" (code.claude.com/docs/en/authentication)
  com `CLAUDE_CONFIG_DIR=~/.claude-work`. Ela diz que a variável "keys the macOS Keychain entry to that directory too".
  O binário 2.1.296 confirma: o serviço do Keychain é `Claude Code-credentials` sem a variável e
  `Claude Code-credentials-<sha256(dir)[:8]>` com ela. A conta do item é `$USER`. No Linux a credencial vai para
  `$CLAUDE_CONFIG_DIR/.credentials.json`.
  - Medido: `CLAUDE_CONFIG_DIR=<vazio> claude auth status` respondeu `loggedIn:false`, e a conta padrão continuou
    `loggedIn:true`. O diretório novo recebeu só `.claude.json` e `backups/`.
- **Codex.** `CODEX_HOME` isola tudo. Com `cli_auth_credentials_store = "file"` (o padrão), a credencial fica em
  `$CODEX_HOME/auth.json`. No keyring, o serviço é `Codex Auth` e a chave é `cli|<sha256(CODEX_HOME canônico)[:16]>`
  (`codex-rs/login/src/auth/storage.rs`; as duas strings aparecem no binário).
  - Medido: `CODEX_HOME=<vazio> codex login status` respondeu "Not logged in".
- O filtro de ambiente do executor (`src/domain/ambiente-executor.ts` nega `CLAUDE_CODE_`, `ANTHROPIC_` e `NOD_`; o Codex
  nega `OPENAI_*`) **não** barra `CLAUDE_CONFIG_DIR` nem `CODEX_HOME`.
- **Não testado:** um Mac real com duas entradas no Keychain, e duas contas reais logadas ao mesmo tempo. A VM tem uma
  única conta e não faz OAuth interativo.

### 2. O login da NOD-209 apontando para o diretório da conta

Funciona sem mudar o protocolo. `claude auth login`/`claude auth status` e o `account/read` do app-server do Codex
respeitam a variável, e o resultado volta pelo mesmo caminho (`lerConta`). O que muda é o encanamento do app do Mac:

- `ambienteDaIa` passa a receber a conta e injeta `CLAUDE_CONFIG_DIR`/`CODEX_HOME`;
- os mapas por IA (`contasDasIas`, o estado do login e a validade de 10 min) passam a ser chaveados por conta.

**Não testado:** o fluxo pela UI no Mac.

### 3. Detectar o limite sem gastar turno pago

- **Claude.** `claude -p /usage --output-format json` (ou `/cost`, o comando `uso` que o nod já tem, `gratis: true`)
  respondeu com `total_cost_usd: 0`, `num_turns: 0` e 0 tokens, trazendo "Current session: X% used · resets …" e
  "Current week …". Durante o turno, o `rate_limit_event` já é tratado (NOD-171/179: `limite_do_plano`,
  `limiteVoltaEm`).
- **Codex.** `account/rateLimits/read` no app-server devolve `rateLimits.primary`/`secondary` (`usedPercent`,
  `windowDurationMins` e `resetsAt` em segundos), `rateLimitReachedType` e `rateLimitsByLimitId`. Também há a notificação
  `account/rateLimits/updated`. O erro de turno `usage_limit_reached` já é reconhecido em `src/domain/erro-fornecedor.ts`.
  - Medido sem login: erro -32600 "codex account authentication required to read rate limits". Isso confirma que o
    método existe e é por conta.
  - **Não testado:** o formato da resposta com uma conta logada.

### 4. Termos de uso e política da Lumen

- **Anthropic.**
  - Os Consumer Terms não falam de ter várias contas.
  - A AUP proíbe "create multiple accounts, to avoid detection, circumvent product guardrails…" e "Intentionally
    bypass… restrictions… including by circumvention of the account sign-up or log-in process".
  - A página Legal & compliance do Claude Code diz que "Advertised usage limits for Pro and Max plans assume ordinary,
    individual usage". Permite "an end user … signing in to the unmodified Claude Code binary with their own Claude
    subscription" e proíbe "collect, store, or intermediate Claude.ai credentials or session tokens".
  - A própria documentação ensina a manter várias contas. **Zona cinzenta.**
- **OpenAI.**
  - Os Terms of Use proíbem "circumvent any rate limits or restrictions or bypass any protective measures" e o
    compartilhamento de conta.
  - A ajuda oficial apoia ter várias contas (troca de conta, até 2 ativas), mas diz que "ChatGPT will not automatically
    switch you to another account".
  - A ajuda do Codex lista as saídas no limite: créditos, esperar o reset ou fazer upgrade. **Zona cinzenta, com risco
    maior.**
- **Lumen.** Não achei, no repo nem no Slack, uma política sobre várias contas ou troca automática. Há indícios:
  - o Claude Team/Enterprise da Lumen foi liberado ao time em 27/03/2026;
  - existe um guia "Claude na Lumen – Guia do Time" no Notion, que não li;
  - a org já bateu o spend limit;
  - existe uma POL-SEG em PDF, que não li.
  - **Falta confirmar com o Marlon ou o admin.**

### 5. A conversa em andamento continua na conta nova?

- **Claude: sim, se `projects/` for compartilhado.** A sessão é um arquivo local em `$CLAUDE_CONFIG_DIR/projects`, e não
  depende da conta.
  - Medido: um turno gravou uma palavra secreta. Com outro `CLAUDE_CONFIG_DIR` sem `projects/`, o resultado foi "No
    conversation found with session ID". Com `projects` como symlink para o diretório comum, `--resume` lembrou a
    palavra no mesmo `session_id`.
  - Perde-se só o cache de prompt: o contexto é reenviado e cobrado na conta nova.
- **Codex: sim, sem nada novo.** Os drivers já são efêmeros (`retomaSessao=false`) e recebem o histórico recente no
  plano.

## Decisão

1. **Uma conta = um diretório** no app do Mac. A conta "Padrão" é o diretório de sempre, e as outras ficam em
   `~/Library/Application Support/nod/contas/<ia>/<id>/`. O motor recebe, por turno, só o **id** da conta. O app resolve
   o diretório e injeta `CLAUDE_CONFIG_DIR`/`CODEX_HOME`. Não usamos `CLAUDE_SECURESTORAGE_CONFIG_DIR`.
2. **Compartilhado por symlink entre as contas do Claude:** `projects/`, para o `--resume` atravessar a troca, além de
   `settings.json`, `skills/`, `agents/`, `commands/` e `plugins/`, para a pessoa não perder a configuração dela. Nunca
   compartilhado: `.credentials.json`, `.claude.json` e o Keychain.
3. **A ADR-019 vale inteira.**
   - E-mail, organização, plano e apelido ficam **só no app do Mac**. Nada vai a servidor, inventário, log ou banco.
   - O servidor conhece a conta pelo id opaco e pelo estado (`em_uso`, `disponivel`, `no_limite` até T, `sem_acesso`).
   - Quem informa a conta é o CLI (`auth status`, `account/read`). Nunca lemos arquivo de credencial.
   - Remover uma conta é `claude auth logout`/`codex logout` com a variável dela, seguido de apagar o diretório.
   - A conversa passa pelo servidor, então as notas dela citam a conta pela **posição** ("conta 1", "conta 2"), nunca pelo
     apelido, e-mail ou organização. O apelido aparece só no cartão do app do Mac.
4. **O limite é lido sem turno.** Usamos `claude -p /usage` e `account/rateLimits/read`, e no turno, `rate_limit_event`
   e `usage_limit_reached`.
5. **A ordem é da pessoa:** a primeira conta disponível é usada. Quando a preferida renova (`resetsAt`), ela volta a ser
   a primeira escolha no próximo turno. Com todas no limite, os bots param e dizem quando a primeira volta, sem laço de
   tentativas; se a outra IA (Codex ou Claude Code) tiver conta disponível, a nota oferece seguir com ela.
   - **Emenda NOD-268 (2026-10-15): o "sem laço" ficou com freio no código.** Em 15/10 uma conversa recebeu dezenas
     de notas e reenvios. Agora: (a) **teto de 1 reenvio** por fala (`TETO_REENVIOS`, em `aposTrocaDeConta`,
     `aposLimiteDaConta`, `aposLimite` e `repetirNaConversa`); passou do teto, a fala espera com `acordar_em` na hora
     da renovação (sem horário, 1 h) e, se já esperou, vale o aviso de sempre; (b) **a nota das contas não se repete**:
     com a mesma nota ainda aberta na conversa, o despacho não escreve outra, só adia a fala; (c) **"Seguir com" uma
     conta que a máquina do bot não tem** não reenvia: a conversa ganha uma linha dizendo onde ela falta; (d) **alarme**
     `reenvio_em_laco` no log quando a mesma fala passa de 3 turnos em menos de 5 min. Suposição registrada: o clique
     da pessoa em "Seguir com" não passa pelo teto (é ato dela), só pela dedup e pela checagem da máquina.
6. **Troca no limite: opção 2 do Marlon** (definido em 2026-10-12).
   - Ter várias contas e escolher a ordem manualmente está dentro dos termos. Trocar sozinho no momento do limite é
     exatamente o caso das cláusulas "circumvent rate limits" (OpenAI) e "ordinary, individual usage" (Anthropic). Por
     isso a troca sozinha existe, mas só ligada pela pessoa e com a responsabilidade dela.
   - **Padrão: "Perguntar antes".** Quando uma conta bate no limite, o nod avisa na conversa e oferece as outras contas
     logadas ("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2?"). A pessoa troca com um clique. Nada
     troca sozinho. Nessa pergunta entram todas as contas livres, inclusive as corporativas.
   - **"Trocar sozinho" é um toggle por provedor** (Claude Code e Codex, cada um com o seu), **desligado por padrão**.
     Ligar mostra um aviso curto: os termos da Anthropic/OpenAI proíbem contornar limites, e a responsabilidade é de
     quem liga. O texto final do aviso é do Gil (protótipo v3+). Ligado, o turno que falhou é refeito na próxima conta
     elegível da ordem, e a preferida volta quando renova (item 5).
   - **Conta corporativa só entra na troca automática se a pessoa marcar nela.** Cada conta tem o campo
     `entraNaTrocaAutomatica`, **padrão `false`**, que só pesa na conta corporativa (plano Team, Enterprise ou Business,
     lido do CLI): a pessoal entra na troca sem precisar marcar. Uma conta corporativa desmarcada fica fora da rotação
     mesmo com "Trocar sozinho" ligado. Plano que o CLI não informou conta como corporativo (o lado seguro). Se só
     sobrarem contas fora da rotação, o nod volta a perguntar ("A conta 2 está fora da troca automática… Seguir com a
     conta 2?") em vez de trocar. A conta 1 da ordem é escolha da pessoa e é sempre usada quando está livre.
     - **Emenda NOD-308 (2026-10-20; decisão do Marlon na NOD-221 item 3, 19/10): conta corporativa segue a mesma regra da pessoal; não há mais exceção por plano.** A corporativa nasce na fila pela regra
       da ADR-108 §2 (só a 1ª conta de cada IA nasce na fila), recebe fundo e troca sozinha quando ligada, e a pessoa a
       tira da fila como qualquer outra. "Corporativa" fica só como selo na tela. A migração **0095** liga a corporativa
       que estaria na fila se fosse pessoal. A política da Lumen (seção 4) continua não confirmada.
   - **A política da Lumen não está confirmada** (ver a seção 4). Até o Marlon ou o admin confirmar, vale o padrão
     conservador acima. Se a Lumen proibir, a opção some das contas da Lumen. Se a Lumen autorizar, o padrão pode virar
     marcado.
   - A conversa passa pelo servidor e cita só "conta 1", "conta 2" (item 3). O apelido aparece só no app do Mac.

## Fora do escopo

- Contas por bot (NOD-10) e a NOD-100.
- Compartilhar contas entre pessoas. Isso é proibido pelos dois fornecedores.

## Alternativas descartadas

- **`CLAUDE_SECURESTORAGE_CONFIG_DIR`** (separa só a credencial e mantém um `~/.claude` único). Não é documentada e pode
  sumir em qualquer versão. O symlink de `projects/` dá o mesmo resultado com a variável oficial.
- **Copiar ou trocar arquivos de credencial entre diretórios.** Viola a ADR-019 e a cláusula da Anthropic contra
  "intermediate … credentials".
- **Medir o limite com um turno de teste.** Gasta cota e a própria tentativa conta como uso.

## Gatilho de reversão

Rever esta decisão se:

- um dos fornecedores proibir explicitamente a troca entre contas próprias ou mandar aviso a uma conta da Lumen;
- `CLAUDE_CONFIG_DIR`/`CODEX_HOME` deixarem de separar o Keychain ou o keyring;
- `/usage` ou `account/rateLimits/read` passarem a custar turno;
- a Lumen publicar uma política sobre contas corporativas em ferramentas como o nod (muda o padrão do item 6).
