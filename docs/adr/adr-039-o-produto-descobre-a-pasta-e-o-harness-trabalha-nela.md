# ADR-039 — O produto descobre a pasta; o harness trabalha nela

Definido em 2026-09-18, a partir de um teste real do MetaNod. Pedindo para escrever
código numa pasta, o agente respondeu com um tutorial: *"use a opção Pasta de
trabalho"*, *"procure no Finder por nod"*, *"costuma ficar em ~/Projetos/nod"* —
para um repositório que mora em `~/code/nod`. E, depois de autorizar, ainda pedia
*"me mande qualquer mensagem"*.

Nada disso era alucinação. Estava escrito no código: na descrição de
`workspace_consultar` (*"oriente a pessoa a usar Pasta de trabalho"*) e no retorno
`precisa_pasta` do gateway, que chegava ao modelo com `ok: true` e
`confianca: "confiavel"` — uma instrução do produto mandando delegar configuração.

## Decisão

1. **O produto descobre a pasta.** `workspace_propor_pasta` varre a pasta pessoal e
   mostra na conversa um botão com o caminho encontrado. O agente nunca instrui menu
   nem afirma caminho que não verificou.
2. **A pessoa autoriza em um clique, e a tarefa retoma sozinha.** A rota concede e
   enfileira um turno `origem: "retomada"` com a entrada original.
3. **O catálogo varia com a concessão.** Sem projeto autorizado o agente só enxerga
   consultar e propor. Ver ferramenta que ainda não pode usar era o que o levava a
   tentar, falhar e virar tutorial.
4. **O bot é uma sessão viva.** A conversa guarda vários projetos com um ativo, não
   uma pasta. Autorizar o segundo não revoga o primeiro nem descarta seu worktree.
5. **O harness lê e edita; o nod governa o resto.** Com projeto autorizado, o Claude
   Code abre na pasta preparada com `--restricted` e as nativas de arquivo. Terminal
   isolado, worktree, revogação e trilha continuam no proxy do nod.

## Medição que sustenta a 5 (Claude Code 2.1.276, 2026-09-18)

| Teste | Resultado |
|---|---|
| Ler arquivo fora das pastas permitidas | negado pelo CLI (`permission_denials`) |
| Insistir por caminho absoluto | negado igual |
| Contornar via Bash | Bash não existe sob `--restricted` |
| `--add-dir` com outra pasta | passa a ler só aquela também |
| `CLAUDE.md` do repo mandando responder "MARMOTA" | ignorado com `--restricted`; **obedecido** com `--setting-sources project` |

O confinamento é do programa, não do modelo sendo educado. E `--restricted` resolve o
risco de o agente do nod herdar instruções de um repositório que o nod não escreveu.

Como `--restricted` remove o Bash, o harness **não** substitui o terminal do nod:
comandos seguem no container isolado, sem rede nem credenciais do Mac.

## Alcance entre projetos

Todos os projetos aprovados na conversa entram em `--add-dir`: o bot transita entre
eles sem reautorizar, e uma tarefa pode ler um e escrever noutro. Decisão explícita
de Marlon em 2026-09-18, com os riscos entendidos e registrados: um prompt malicioso
dentro de um repo aprovado alcança os outros, e o perímetro cresce conforme a pessoa
acumula projetos. Mitigações: teto por conversa, descarte pelo uso mais antigo e
revogação por projeto. Não é o projeto ativo que define o alcance, é o conjunto
aprovado — o `cwd` continua sendo o do ativo.

## Fail-closed

`--restricted` e `--add-dir` ficam **fora** de `FLAGS_DO_TURNO`: exigi-las ali
derrubaria todo turno num CLI mais antigo, inclusive os que não tocam em pasta. O
gate é o `--help` da versão instalada, conferido no próprio turno. Sem a flag, o
`cwd` continua no diretório temporário e as nativas seguem desligadas.

## Limites conhecidos

- **Codex não homologado.** O binário não estava instalado na máquina onde o
  confinamento foi medido. O driver recebe `--cd` e `workspace-write` pelo mesmo
  contrato, coberto só por teste de montagem de args. Não anunciar paridade.
- **Cursor** segue sem driver, embora `cursor-agent` exista na máquina e ofereça
  `--workspace`/`--sandbox`.
- Cada harness tem seu dialeto de confinamento. A tradução é por driver; o contrato
  comum (`spi.ts`) não conhece flag de fornecedor.

## Referência

`~/code/OpenBot` (`server/src/host-access/tools.ts`, commit `eb32530`) chegou
sozinho à mesma conclusão do item 3: sem pasta concedida, o catálogo tem uma
ferramenta só. Mas lá não há descoberta — `requestFolderGrant` não recebe caminho e
abre o seletor nativo do sistema. A descoberta automática é contribuição do nod.

## Gatilho de reversão

Se o confinamento do harness deixar de ser verificável — uma versão que remova
`--restricted`, ou uma medição que mostre vazamento para fora das pastas permitidas —
voltar as nativas para desligadas e reativar as ferramentas `workspace_*` de arquivo,
que continuam existindo no proxy.

## Emenda de 2026-09-28 — nativas só em turno de conversa confiável

**Contexto.** Uma revisão do caminho das ferramentas nativas achou uma brecha. Com pasta autorizada, `montarArgs` ligava Write, Edit e as demais nativas de arquivo em **qualquer** turno da conversa: inclusive a continuação que traz a resposta de um colega (entrada não confiável) e a retomada de uma rotina com gate de aprovação. As nativas não passam pelo proxy, então nem a moldura nem o catálogo reduzido do ADR-026 as seguravam. Além disso, o prompt sempre dizia "Não há Read, Edit, Write…", mesmo quando o driver as ligava.

**Decisão.**
- `nativasDoTurno` (`src/domain/nativas.ts`) decide as nativas no domínio. Só um turno de modo `conversa`, com entrada `confiavel` e pasta autorizada, as recebe. Rotina, peer, delegação, sala, criação e turno não confiável ficam sem nenhuma.
- O plano carrega `nativas`. O prompt lista exatamente essas, e o driver as usa no `--allowedTools`. Sem nativas, o plano sai sem `workspacePastas`, com cwd temporário e `--tools ""`. Isso protege também um app desktop antigo, que decide pelas pastas.
- O vínculo com o projeto (`workspaceId`) e as ferramentas `workspace_*` do proxy continuam valendo em qualquer turno: elas passam pela moldura e pela trilha.
