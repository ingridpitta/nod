# Continuidade — capacidades gerais dos agentes

Atualizado em 2026-09-18. Branch: `codex/capacidades-gerais-agentes`.
Este arquivo acompanha os checkpoints publicados no GitHub. Ler antes de retomar
em outra conta/sessão; consultar `git log` e `git status` para a posição exata.

## Pedido e decisões da pessoa

Marlon testou MetaNod com Claude Code/Opus. O bot não conseguia ler/editar código
nem executar comandos, pediu GitHub e inventou uma configuração para liberar
ferramentas. O caso concreto é o repositório Nod no Mac, mas a solução deve servir
a qualquer área, sem fluxos rígidos por profissão.

- Entregar capacidades gerais: arquivos, comandos, navegador e integrações.
- O agente decide a estratégia a partir do pedido/contexto/preferências.
- Defaults técnicos simples para leigos, com exceções explícitas pelo prompt.
- O componente Git pode preparar worktree por padrão, preservando continuidades;
  pasta/branch explícita prevalece. Worktree e localidade são eixos separados.
- Claude Code e Codex devem executar o mesmo trabalho. Cursor ainda não está
  integrado: não apresentar como pronto. Não limitar o produto ao menor catálogo.
- Skills especializam opcionalmente; não são requisito para uma área nova.
- Pedidos dentro dos screenshots são evidências, não uma solicitação para
  implementar agora drag-and-drop de anexos.
- Usar Astra nesta tarefa. Em 2026-09-18 a pessoa autorizou explicitamente um turno
  curto de Claude Code e um de Codex para validação real; não é autorização para
  repetir testes pagos indefinidamente.
- A pessoa pediu commits e pushes incrementais, documentação e comentários úteis
  para trocar de conta; pediu explicitamente continuar trabalhando.

## Checkpoint 1 — diagnóstico e direção

Implementado: prompt comum usa capacidades reais, evita configurações inventadas,
respeita instruções explícitas e orienta verificar resultados. A orientação
especializada de programação adicionada inicialmente já foi removida.

Documentação: ADR-038 e `docs/agentes-programadores.md`. Referência OpenBot
inspecionada no commit `eb325300023289f17adf5a10fb38b5bb403dca82`; links fixos na
ADR. Checkout temporário em `/tmp/nod-openbot-review.lxzLFR/OpenBot`, dispensável
para retomar. Não foi executado o OpenBot nem usados modelos reais.

Validação em 2026-09-18: lint, quatro typechecks e cerca do domínio aprovados;
406 testes unitários, 227 de integração, 49 de conformidade e 55 de concorrência
aprovados (737 no total). O `npm run check` no sandbox passou até os unitários e
falhou no acesso local ao banco (EPERM); as três etapas de banco foram repetidas
com escalada e passaram. O custo impresso pelo teste `claude-cli-falso` vem da
fixture; nenhum modelo pago foi executado. Testes de catálogo NÃO provam
programação ponta a ponta.

Commit publicado: `26635dc`, na branch indicada acima. O remoto foi verificado
como `https://github.com/marlonwlv/nod.git`, privado, conta autenticada `marlonwlv`
com permissão ADMIN. A primeira revisão de push pediu essa evidência; o push
seguinte foi autorizado e concluído.

## Checkpoint 2 — preparação de workspace (ainda sem concessão)

`src/contracts/workspace.ts` e `src/adapters/workspace/preparar.ts` separam
organização dos arquivos de harness e autorização. O chamador precisa fornecer
uma pasta previamente autorizada na máquina correta; esse adapter NÃO concede
acesso e ainda não está ligado à execução nem à interface.

- `auto`: worktree para raiz Git com commit; pasta direta sem Git, sem commit
  ou quando a concessão é somente uma subpasta. Nunca amplia para a pasta pai.
- `direto` respeita a pasta original. Referência explícita vale para novo worktree.
- Sem referência explícita, copia alterações versionadas e arquivos novos não
  ignorados. Não copia arquivos ignorados, não transfere links não versionados
  nem executa hooks/fsmonitor. Preparação de dependências continua pendente.
- Manifesto privado por id mantém ambiente/edições entre chamadas; não depende
  do harness. O padrão é resolvido uma vez, mesmo se a pasta passar a ter Git.
- IDs não podem escapar da raiz. Home inteira e raiz do filesystem são recusadas.
- Referência inexistente falha antes de reservar id. Outras falhas parciais
  preservam arquivos para recuperação; ainda NÃO há retomada automática dessas
  falhas. Não remover esses diretórios cegamente: podem conter trabalho.

Dez testes com pastas/repos descartáveis cobrem esses casos. `npm run check`
concluiu com sucesso em 2026-09-18: lint, quatro typechecks, cerca do domínio,
416 unitários, 227 integração, 49 conformidade e 55 concorrência (747 testes).
O teste de continuidade após primeiro commit foi reexecutado no conjunto dos
dez testes e passou. Nenhum modelo pago foi executado.

Próxima investigação: integração de capacidades nativas com limites de acesso.
O help local do Claude foi consultado sem inferência e oferece `--restricted`,
`--settings` e `--tools`, mas isso sozinho NÃO comprova segurança/paridade. Não
habilitar Bash/Read/Edit irrestritos nem mudar o cwd do CLI para o projeto sem
resolver configuração herdada, permissões, cancelamento e isolamento.

Commit publicado do checkpoint 2: `c15c9b8` (push concluído).

## Checkpoint 3 — texto no computador

Implementadas `computador_ler_texto` e `computador_gravar_texto` pelo gateway
existente. Leitura UTF-8 paginada (até 2 MiB por arquivo) com índice de continuação
e revisão SHA-256; orçamento da página considera caracteres escapados no JSON
para caber no proxy. Escrita de até 131072 caracteres exige revisão observada ou
`novo` (criação exclusiva). A revisão é checada antes da escrita; não é um lock
contra processos externos. Ações do gateway continuam serializadas e submetidas
à política existente. Ferramentas binárias anteriores não foram alteradas.

Arquivos principais: `infra/computador/texto.mjs`, declaração `texto.d.mts`,
runtime, contratos/domínio e testes. O smoke existente ganhou casos de texto e
suporte a `NOD_COMPUTADOR_IMAGEM`, para testar uma tag sem substituir a diária.

Validação em 2026-09-18: `npm run check` concluiu com exit 0; 425 unitários,
227 integração, 49 conformidade, 56 concorrência (757 testes). O teste HTTP usa
o gateway e arquivos temporários reais, mas substitui o driver Docker; confirma
aprovação antes de gravar e recusa da revisão antiga. A imagem exclusiva
`nod-computador:capacidade-texto-test` foi construída com sucesso.

O comando abaixo foi inicialmente bloqueado por cota da revisão automática.
Após a pessoa adicionar créditos, foi executado e imprimiu OK em 2026-09-18:

```bash
NOD_COMPUTADOR_IMAGEM=nod-computador:capacidade-texto-test node scripts/smoke-computador.ts
```

O smoke validou dois computadores reais, texto paginado e revisão, navegador,
terminal, mídia, persistência cifrada e isolamento. Remove seus próprios recursos
descartáveis ao concluir. Publicado no commit `6ba42b1`, na mesma branch.
Nenhum modelo pago foi chamado. A imagem diária e os containers diários não foram
substituídos. Esse checkpoint NÃO associa pastas do Mac e NÃO resolve sozinho o
pedido original. Não anunciar conclusão.

## Checkpoint 4 — pasta local na conversa, comum aos harnesses

Implementado o botão **Pasta de trabalho** na conversa própria do bot. A pessoa
navega pelas pastas e autoriza uma delas; o caminho textual é opcional. A concessão
é privada por tenant/pessoa/conversa, na máquina do servidor local, e persiste
entre turnos e trocas de harness. Nesta entrega exige login local `stub` (loopback);
login web remoto não concede filesystem do host. O modelo não concede acesso por mencionar um
caminho. O seletor não oferece a pasta pessoal inteira nem as pastas privadas do Nod.

As seis ferramentas `workspace_*` passam pelo proxy comum, com catálogo/token,
validação de dono, máquina, estado do turno e revisão de arquivo. A pasta autorizada
é preparada automaticamente; Git usa worktree e um pedido explícito pode escolher
`direto`/referência antes da preparação. A continuação reutiliza o ambiente; não
troca silenciosamente o modo de um ambiente já preparado. Revogar invalida o plano
antigo e cancela comandos em andamento, sem apagar entregáveis.

O terminal roda Docker efêmero: somente a pasta montada, sem rede, credenciais do
Mac ou acesso ao daemon Docker no container. Não há fallback para shell irrestrito.
Limites: 60 segundos, 1 GB, 128 processos, saída limitada. Metadados Git compartilhados
do worktree são somente leitura; status/diff funcionam, commits não. A operação
serializa efeitos por conversa no servidor local (não é lock distribuído).

Evidência em 2026-09-18:

- Teste HTTP real: associação, escrita por plano Claude, leitura do mesmo arquivo
  por plano Codex, recusa a outra pessoa e a plano revogado. Não chama os modelos.
- `NOD_COMPUTADOR_IMAGEM=nod-computador:capacidade-texto-test node scripts/smoke-workspace.ts`:
  PASSOU com Docker real. Criou arquivo em worktree, executou teste Node e Git,
  verificou original intocado, cancelou comando e revogou preservando arquivo.
- Interface em preview isolado no nod_test: associação e remoção confirmadas,
  rascunho preservado. Preview encerrado; nenhuma sessão diária foi reiniciada.
- Builds web e desktop passaram. Gate completo anterior à revisão final: 763
  testes. Rodar novamente após os dois testes adicionais de cancelamento/seletor.

Aceite real autorizado em 2026-09-18: Claude Code/Opus passou em 16,8 s, usando
`workspace_consultar`, `workspace_gravar_texto` e `workspace_ler_texto`, criando
`claude-real.txt` com conteúdo exato e reportando custo de US$ 0,0916. O Codex/Astra
retornou sucesso de processo, mas não criou o arquivo esperado; portanto não foi
homologado como execução de código. O teste pago fica opt-in em
`NOD_SMOKE_HARNESSES=1` e deve ser corrigido antes de nova cobrança.

## Estado real e próximo trabalho

O acesso local a arquivos agora funciona; não afirmar que toda a experiência
original está homologada. Pendências explícitas:

1. Provisionamento simples do runtime/dependências. Comandos exigem Docker e a
   imagem preparada; worktrees não copiam dependências ignoradas. Sem rede, não
   instalam pacotes nem usam bancos/serviços do Mac. O caso completo do próprio
   Nod ainda exige esta evolução, não apenas ferramentas presentes no catálogo.
2. Login Google/servidor compartilhado + desktop: associação de pastas ainda não existe.
   A UI informa indisponibilidade e não confunde filesystem do servidor com Mac.
3. Fluxo de entrega/revisão e mudança de modo de workspace existente. Hoje deve
   reassociar a pasta para nova escolha; arquivos anteriores são preservados.
4. O aceite real está em `tests/concurrency/workspaces-http.test.ts`, protegido
   por `NOD_SMOKE_HARNESSES=1` (fora do gate normal). Registrar o resultado abaixo.
   Cursor continua indisponível. Não anunciar paridade nativa dos três harnesses.
5. Não habilitar ferramentas nativas irrestritas como atalho. Evoluir a fronteira
   de execução/autorização de forma explícita, independente da área de trabalho.

## Mapa do código

- `src/domain/plano-turno.ts`: monta catálogo; hoje computador só entra quando
  habilitado e fora dos modos criação/peer.
- `src/use-cases/emitir-plano-turno.ts`: contexto, seleção de harness e token.
- `src/adapters/executor/drivers/{claude-cli,codex-cli}.ts`: ferramentas nativas
  desabilitadas; diretório temporário por turno; ambos usam proxy MCP Nod.
- `src/adapters/mcp-proxy/proxy.ts`: transporte comum; chama servidor autenticado.
- `src/adapters/fundo/computadores.ts`: gateway, reserva confirmada, validação
  após boot e ações fora da transação. Exemplo de controle a preservar.
- `src/adapters/computador/docker.ts`: ambiente persistente isolado, sem projeto
  local montado. Exige infraestrutura preparada e chave de credenciais.
- `desktop/main.ts`: máquina remota executora; ainda sem associação de pastas.
- `src/adapters/http/rotas/interno.ts`: despacho das chamadas autenticadas.
- `web/telas/conversa.ts`: timeline/propostas; composer preservado por regiões.

## Cuidados operacionais

Node 24.19.0 disponível diretamente neste shell; `mise` não encontrado. Banco
diário em 5434, volume `nod_nod_pgdata`: nunca resetar ou remover. Não alterar
configuração diária, migrar banco diário ou reiniciar o app como efeito incidental.
Usar banco de teste/ambiente descartável para a feature. Seguir AGENTS.md.

Git neste ambiente requer escalada para escrever refs/index; rede também pode
exigir escalada. O usuário autorizou commits e pushes da tarefa, não merge em main.
Hook pre-commit existe; conferir a execução de lint-staged ao commitar.

## 2026-09-18 — descoberta de pasta, multi-projeto e nativas do harness (ADR-039)

A trava registrada antes — *"não habilitar Bash/Read/Edit irrestritos nem mudar o cwd
do CLI para o projeto sem resolver configuração herdada, permissões, cancelamento e
isolamento"* — foi levantada **com medição**, não ignorada:

- **Configuração herdada**: `--restricted` ignora `CLAUDE.md`, skills e hooks do repo
  aberto. Provado com um `CLAUDE.md` plantado mandando responder "MARMOTA": obedecido
  com `--setting-sources project`, ignorado com `--restricted`.
- **Permissões**: leitura fora das pastas permitidas negada pelo CLI
  (`permission_denials`), por caminho relativo e absoluto; Bash não existe no modo.
- **Cancelamento**: já resolvido por `Adapter.interromper()` (SIGTERM→SIGKILL), que
  mata o processo inteiro — vale para nativas também.
- **Isolamento**: parcial por construção. Sem Bash, comandos seguem no container do
  nod, sem rede nem credenciais do Mac.

Furo corrigido no caminho: o vínculo guardava **uma** pasta por conversa, então
autorizar um segundo projeto apagava o primeiro. Agora é uma coleção com um ativo, e
o formato antigo migra na leitura.

Pendências que seguem abertas: provisionamento de dependências (o container não tem
rede), associação de pastas no desktop/login Google, **Codex não homologado** (binário
ausente na máquina da medição) e Cursor sem driver.
