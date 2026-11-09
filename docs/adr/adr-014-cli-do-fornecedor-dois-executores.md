# ADR-014 — CLI do fornecedor: dois executores

**Status** invertido

## Decisão

Dois executores, mesmo SPI. (A) LOCAL, o caminho padrão: o CLI é o que já está na máquina da pessoa, o nod NÃO instala e NÃO pina versão, e o processo filho HERDA o ambiente para o CLI resolver a própria credencial. Some o pin exato, some a imagem, some o teste de fumaça contra imagem construída. Entram: a resolução de caminho do binário (o PATH pelado de app aberto pelo Finder) e a tabela de flag floors, que fica MAIS necessária. (B) SERVIDOR, só para rotinas noturnas: o ADR-014 original sobrevive inteiro — container, CLI pinado em versão exata, teste de fumaça no CI, chave da organização. Em ambos: --strict-mcp-config e --setting-sources project desde o primeiro dia, e diretório de trabalho por turno apagado ao fim.

## O que mudou

A inversão. O CLI sai do container e vai para a máquina no caminho padrão; o container fica vivo no caminho noturno.

## Por quê

A premissa que sustentava 'CLI no container' era que a organização pagava a conta de todos os turnos de 70 clientes. Cada pessoa já paga a própria assinatura e já está logada. Duas coisas que o código obriga a incluir e que o container não tinha: (1) augmentedPath() existe porque app aberto pelo Finder herda PATH pelado, e eles rodam o shell de login em background para capturar exports do .zshrc — isso é trabalho real que a inversão traz; (2) a linha que impede a chave da organização 'riding along in the parent env' de 'flip a subscription login to pay-as-you-go' é obrigatória, porque é a diferença entre o turno sair da assinatura da pessoa (custo zero) ou cair na fatura da empresa sem ninguém perceber. Os flag floors ficam mais necessários: agora é uma versão de CLI por pessoa em vez de uma pinada, e sem eles a colega que não atualiza há quatro meses tem todo turno falhando com erro de argumento.


## Refinamento (2026-09-16, EMENDA 11)

Diretório de trabalho por turno é literal: o driver usa `mkdtemp` como cwd do processo (com o `mcp.json` 0600 dentro) e apaga no `finally`; a sonda de 2026-09-16 provou que `--resume` funciona de qualquer cwd. Não existe `Agente.cwd`; `NOD_HOME` guarda só `machine-id`. Nesta rodada servidor e máquina são o mesmo processo: o regime (B) fica só como `locality` no SPI.

## Gatilho de reversão

Reabrir (voltar o CLI ao container no caminho padrão) se a assinatura pessoal deixar de cobrir o uso diário (custo medido por pessoa/mês acima do que a chave da empresa custaria), ou se mais de um colega por mês ficar com turnos falhando por versão de CLI abaixo dos flag floors apesar do aviso escrito.

## Emenda de 2026-10-06 — os flag floors viraram recusa (NOD-171)

O "aviso escrito" do gatilho acima virou código: abaixo do `PISO_CLI` o harness é `ausente` com causa `cli_antigo`
(ADR-019, emenda de 2026-10-06) e o bot fixado nele recebe a negação "desatualizado" com o comando de atualizar, em vez
de turnos falhando com erro de argumento. O bot no automático segue na outra IA pronta. O gatilho de reversão continua
contando colegas com turnos falhando por versão: agora eles aparecem como `cli_antigo` no inventário.

## Emenda de 2026-10-06 — cwd estável no turno de texto do claude-cli (NOD-188)

A EMENDA 11 vale para o `mcp.json` e a config do hook, que continuam num `mkdtemp` por turno apagado no `finally`. O
cwd do processo, quando o turno não tem pasta do bot nem projeto, passou a ser `<cwdBase>/texto-<agenteId>`, estável
por bot, como o da ligação (`ligacao-<agenteId>`). O CLI grava o cwd em cada turno do transcrito e o reenvia no
`--resume`: um cwd novo por turno reescrevia o histórico e derrubava o cache da conversa longa. Medição e decisão na
emenda da NOD-188 da ADR-080.

## Emenda de 2026-10-23 — o nod atualiza o CLI (NOD-9)

Abaixo do piso, o CLI deixa de ser só recusa: o app do Mac roda o atualizador do próprio fornecedor (`claude update`,
`src/adapters/executor/atualizar-cli.ts`) na brecha ou no clique, com a reserva do instalador do nod (ADR-093). O turno
que chega durante a atualização espera (`aguardarAtualizacao`) em vez de ser negado; o que pede um modelo acima da
versão instalada dispara a atualização (`aoPrecisarDeVersao`). Binário configurado (`NOD_*_BIN`) continua intocado.
