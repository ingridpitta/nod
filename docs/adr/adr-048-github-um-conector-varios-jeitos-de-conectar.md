# ADR-048 — GitHub: um conector, vários jeitos de conectar, e o gh roda no Mac de quem o logou

Status: aceito · Data: 2026-09-24 (revisto no mesmo dia) · Emenda ADR-013, ADR-015, ADR-021, ADR-041,
ADR-042 e ADR-044.

## Contexto

Marlon pediu ao Taga que o Dev 1 revisasse o PR #466. O Dev 1 não tinha acesso ao GitHub. O `gh`
do Mac do Marlon estava logado, mas o claude-cli roda com `--tools ""` e `--strict-mcp-config`
(`claude-cli.ts:94-131`), então nem Bash nem os servidores MCP da própria pessoa chegam ao modelo.
Isso é de propósito: o proxy é o ponto de decisão (ADR-013).

O único GitHub do nod era o do Composio:
- pede OAuth no navegador, chave de projeto e auth config no painel;
- usa nomes de ferramenta do Composio (`GITHUB_GET_A_PULL_REQUEST`…). Trocar o jeito de conectar
  trocaria os nomes, e com eles as concessões e as regras de "Sempre permitir".

**Revisão do mesmo dia.** A primeira versão desta ADR rodava o `gh` no processo do servidor. Isso só
serve a quem roda o nod inteiro no próprio Mac. A distribuição real é um servidor compartilhado com
apps macOS (docs/release-desktop.md): os conectores rodam no servidor e o proxy do Mac só repassa
`tools/call`. Ali o gh do servidor não é o de ninguém. E, no modo local com várias pessoas no
cadastro, o gh do Mac servia a todas. O pedido é "zero trabalho para cada pessoa": usar o gh que ela
já tem logado no próprio Mac.

## Decisão

**Um conector `github`, com nomes de capacidade estáveis.** São nove:
- leitura (`readOnlyHint: true`): `pr_ver`, `pr_diff`, `pr_arquivos`, `pr_comentarios`, `pr_checks`,
  `arquivo_ler`, `issue_ver`;
- escrita: `pr_comentar`, `pr_revisar` (`comment`, `approve` ou `request_changes`).

Concessões e regras se prendem a `github__<capacidade>`, nunca ao jeito de conectar. No banco o
conector é `stdio` com `comando = 'nod:github'`, uma marca: quem registra à mão não pode usar o
prefixo `nod:`.

**O jeito é decidido POR TURNO** (`escolherJeitoGithub`, domínio puro):
1. o gh logado na **máquina do turno**, e só se ela é da dona do conector;
2. o token pessoal da dona;
3. o login Composio da dona;
4. o GitHub App da organização, **só em turno de rotina** (ninguém olhando).

Em turno interativo o App nunca entra, nem como último recurso: ele publicaria como `app[bot]` no
lugar da pessoa, e a revisão de um App não conta como aprovação da pessoa no PR (a regra de proteção
de branch que exige N aprovações humanas não a soma). Quando nenhum jeito serve, a frase diz o que a
pessoa faz.

### O gh roda na máquina do turno

- **O anúncio.** Ao conectar, o app desktop roda `gh auth status` e anuncia `github: { gh }` junto do
  inventário (`AnuncioMaquina`, ponte do ADR-021). Anúncio ausente (app antigo) = sem gh. No modo
  local o servidor É o Mac e consulta o próprio gh; a dona é a pessoa em `NOD_DONO_DA_MAQUINA` (e-mail
  ou id). Sem ela, o gh não serve a ninguém.
- **O plano.** Quando a máquina que puxa o turno anunciou o gh e é da pessoa do turno (a chave de
  máquina é por pessoa, ADR-031), as ferramentas do conector `github` DESSA pessoa saem marcadas
  `execucao: "maquina"`. O login do gh só serve a quem o fez.
- **A chamada.** O servidor mantém TODOS os portões de `chamarFerramenta`: parada, catálogo,
  concessão ativa, gate de rotina, schema e trilha (e os da ADR-047: o nunca-permanente recusa aprovar PR/merge/review
  ANTES do desvio para a máquina). Para ferramenta marcada ele devolve
  `executarLocal { capacidade, argumentos }` em vez de chamar o conector.
- **A execução.** O proxy só executa se o plano que ele já puxou concorda com a marca. Ele valida os
  argumentos no domínio e roda `gh api` por `execFile`, nunca shell; o corpo do POST vai pelo stdin.
  Corta o resultado ao orçamento, envolve na moldura de não confiável (ADR-026) e relata o código
  fechado em `POST /api/interno/execucoes-locais`, que vira a linha `execucao_local` da trilha.
- **O bundle.** O desktop carrega só `conectores-locais/github/maquina.ts` e o backend gh: sem banco,
  sem HTTP de servidor e sem `src/obs`.

### Escrita aprovada que roda no Mac

- **O carimbo.** `pedir_aprovacao` marca o item com `destino.execucao = "maquina"` a partir do plano
  já puxado; o agente não escolhe onde.
- **A decisão.** Quando a pessoa aprova, o servidor não executa. O item fica sem desfecho e a
  conversa diz "aguarda seu Mac". Na tela, o item aparece como "aguardando seu Mac".
- **O Mac puxa.** O app desktop pergunta a cada 5 s, pelo verbo novo `itens-locais` da ponte, pelos
  itens aprovados da própria pessoa. O servidor continua sem discar a máquina (ADR-021).
  - O item fica reservado 2 min para a máquina que o puxou. Enquanto a reserva vive, ninguém o
    recebe de novo, nem a própria máquina (revisto em 2026-09-25: comentar e revisar no GitHub não
    são idempotentes, e o mesmo Mac repuxava e comentava duas vezes quando o relato falhava).
  - O Mac executa pelo gh e relata em `itens-locais/resultado`. O app guarda o desfecho até o
    servidor aceitar o relato e, a cada volta, reenvia só o relato; item que já rodou naquele Mac
    nunca roda de novo. Limite: fechar o app entre rodar e relatar perde essa memória.
  - Só a máquina que anunciou o gh recebe itens e relata. Reserva perdida (o servidor reiniciou)
    não recusa o relato; só a reserva viva de outra máquina recusa.
- **O fechamento.** Com todos os itens relatados, a decisão fecha como fecharia no servidor: mensagem
  de resultado + turno de retomada. Relato repetido não sobrescreve.
- **O prazo.** O Mac que não aparece em 24 h (o mesmo prazo de decidir), contadas da decisão,
  transforma o item em `falhou_na_execucao` no varredor de expiração.
- **"Sempre permitir" em turno vivo.** A decisão nasce fechada por regra e o item também espera o Mac.
  O `aguardar` do proxy só responde "decidida" quando os itens da máquina têm desfecho, e a fala "Fiz
  sem perguntar" sai no relato, sem retomada.
- **Modo local.** O servidor É o Mac e executa na hora, se ele é da dona.
- **Sem coluna nova.** O estado "aguardando seu Mac" é derivado: decisão decidida, item marcado,
  `destino.execucao = 'maquina'` e desfecho nulo.

### Registro sem configuração

O conector nasce habilitado e com o catálogo quando o gh da pessoa foi anunciado por um Mac dela.
Isso vale em dois momentos:
- quando a pessoa clica em "Conectar" no card do GitHub;
- quando um agente chama `pedir_acesso("github")`. Aí o card de acesso já sai com o botão de permitir
  (ADR-044), e `capacidades: []` resolve pelo nível.

A "sonda" do conector nativo não spawna nada nem toca a rede. O catálogo é o contrato, e cada jeito
já foi conferido na entrada:
- o gh pelo anúncio do Mac;
- o token pelo `GET /user` antes de guardar;
- o Composio pelo Verificar;
- o App pelo token de instalação gerado antes de guardar.

Por isso a sonda funciona na transação aberta de quem pede e nunca bate na URL velha do Composio.
Com só o Composio pronto, `pr_diff` e `pr_checks` ficam fora do catálogo (não têm par lá).

### Troca do `github` do Composio pelo nativo

Só o clique da pessoa troca. O agente nunca troca, e o conector que a pessoa registrou à mão (stdio
ou HTTP fora do Composio) nunca é trocado.

A troca mantém o id e leva junto os acessos (`migracaoDoComposio`):
- cada concessão com nome GITHUB_* vira os nomes estáveis, com o MESMO consentimento. O par direto
  vem da tabela e só ele migra. Ferramenta sem par perde a concessão, e o agente pede de novo com
  `pedir_acesso` (revisto em 2026-09-25: virar o nível inteiro alargava — "ver quem sou eu" virava
  as sete leituras, arquivo_ler inclusive, e "dar estrela" virava comentar em PR sem clique);
- "Sempre permitir" só migra o par exato de escrita, e a regra antiga fica inativa com motivo
  (ADR-042: regra permanente nunca alarga).

### Onde mora a credencial e em nome de quem o GitHub mostra a ação

| Jeito | Onde roda | Credencial | Autor no GitHub |
|---|---|---|---|
| gh | Mac da dona (proxy do turno; app desktop para itens aprovados) | Keychain do Mac. O nod nunca lê nem copia | A conta logada no gh |
| Token | Servidor | `env_cifrado` do conector (`GITHUB_TOKEN`), conferido no GitHub antes de guardar | A dona do token |
| Composio | Servidor | `env_cifrado` (`COMPOSIO_URL`, `COMPOSIO_API_KEY`); o OAuth mora no Composio | A conta autorizada no Composio |
| GitHub App | Servidor, só turno de rotina | `github_app_configuracoes` (0029): app id, instalação, chave privada cifrada; token de instalação só em memória, gerado uma vez por tenant por vez | O App (`nome[bot]`), cuja revisão não vale como aprovação humana |

**Cadastro do App.** Só quem está em `NOD_ADMINS` cadastra (e-mails ou ids). O nod não tem papel de
admin no cadastro de pessoas (ADR-030). Vazio = ninguém cadastra pela tela.

**Ambiente do gh.** O gh recebe só isto:
- a allowlist do servidor;
- `USER`, `LOGNAME`, `XDG_CONFIG_HOME`, `GH_CONFIG_DIR` e `GH_HOST`;
- `PATH` aumentado com `~/.local/bin` e Homebrew;
- `HOME`/`USER` da pessoa, quando faltam.

Nenhum segredo do nod (`NOD_*`) chega ao gh.

**Prazos.** Uma capacidade tem 12 s no total, abaixo dos 15 s de `CHAMADA_CONECTOR_MS`.
- `pr_comentarios` faz as duas requisições em paralelo.
- `pr_checks` divide o prazo entre as duas, que são sequenciais.
- No Composio, cada ferramenta tem 6 s.

**Erros.** Cada falha vira uma frase:
- sem login;
- sem permissão;
- não encontrado;
- repositório renomeado ou transferido (301: o redirect não é seguido e o token não vai a outra URL);
- rate limit;
- gh ausente.

## Alternativas descartadas

- **Liberar Bash ou o MCP do GitHub da pessoa no claude-cli.** Contorna o proxy, e junto a aprovação,
  a moldura de não confiável e a trilha (ADR-013).
- **Um conector por jeito.** Cada troca perderia concessões e regras.
- **O App como fallback de turno interativo.** O time todo publicaria como o bot, e a revisão não
  contaria como humana.
- **O servidor discar o Mac para os itens aprovados.** Contraria o ADR-021; o Mac puxa.
- **Coluna nova para "aguardando seu Mac".** O estado se deriva do que já existe; migração a mais no
  banco compartilhado não compra nada.

## Validação

- `tests/unit/domain/github.test.ts`: a ordem por turno e o App nunca interativo; argumentos
  maliciosos, incluindo `x/..git`, `x/...git` e `x/.git`; a marca da máquina; a migração dos acessos.
- `tests/unit/conectores-locais/github-gh.test.ts`: o lado da máquina contra um `gh` FALSO. Cobre
  argv separado, diff cortado, comentário pelo stdin, sem login, 404, gh ausente, argumento malicioso
  sem processo nenhum, pr_comentarios em paralelo e o prazo único de pr_checks.
- `tests/unit/mcp-proxy/execucao-local.test.ts`: o proxy executa, relata e emoldura, e recusa quando o
  plano não marca a ferramenta.
- `tests/unit/conectores-locais/github-rest.test.ts`: o backend REST, incluindo o 301.
- `tests/unit/conectores-locais/github-nativo.test.ts`: a precedência do servidor e a sonda estática.
- `tests/integration/github-conector.test.ts`, no Postgres com rollback:
  - o plano marca só o GitHub da dona, e os portões são aplicados antes de `executarLocal`;
  - aprovação espera o Mac, é puxada e fecha uma vez; expira em 24 h;
  - "Sempre permitir" espera no `aguardar`;
  - no modo local executa na hora;
  - troca do Composio com acessos migrados; conector manual intocado;
  - App só por admin.
- `tests/concurrency/github-maquina-http.test.ts`, no servidor compartilhado de verdade com dois Macs:
  - só o Mac com gh tem as ferramentas marcadas;
  - só ele puxa e relata os itens;
  - no modo local, o gh só serve à dona.

## Gatilho de reversão

- **Relatos de `sem_login` com o gh logado.** Se mais de 1 em 10 execuções na máquina relatarem
  `sem_login` com o gh logado, o ambiente mínimo não basta. Medir pela trilha `execucao_local` antes
  de alargar a lista.
- **Itens que expiram.** Se itens "aguardando seu Mac" expirarem em mais de 1 de 10 aprovações, o Mac
  aberto não é a regra do time. Oferecer o token ou o App como jeito do item aprovado.
- **Comentário sem clique.** Se aparecer um comentário ou revisão publicado sem clique que a pessoa
  não esperava, reabrir junto com a ADR-047 (tarefa delegada).

## Não implementado

- **Troca do gh sem reconectar.** O Mac só anuncia o gh ao conectar. Quem roda `gh auth login` depois
  precisa usar "Conexão / verificar conta de IA" no app (ou reiniciá-lo).
- **Estado do App na tela.** A tela do App só cadastra; o GET existe e a web não o lê.
- **Revogação do token de instalação.** Trocar o App esquece o token em memória; ele vence em até 1 h
  no GitHub.
- **Retomada no "Sempre permitir".** Se o turno vivo desistiu do `aguardar` antes do Mac relatar, o
  agente não recebe o resultado por retomada; a fala aparece na conversa.
- **Validação real.** Não houve UAT com dois Macs nem gh real contra um PR: só o gh falso e a ponte
  de verdade nos testes.

## Emenda de 2026-11-02 (NOD-421, [ADR-145](adr-145-token-do-servidor-para-os-prs-do-quadro.md))

O laço dos PRs do quadro usa um token GitHub do servidor, só de leitura e fora deste conector, escopado pela lista
`NOD_QUADRO_GITHUB_TENANTS` (vazia = nenhum tenant). É provisório: sai quando o conector por tenant servir a um laço de fundo.
