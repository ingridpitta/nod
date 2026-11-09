# ADR-013 — O proxy MCP é o ponto de decisão do produto

**Status** revisado

## Decisão

O proxy MCP sobrevive INTEIRO e roda onde o CLI roda: local no executor local, no container no executor de servidor. A autoridade é LOCAL (loopback), como sempre foi. Mantidas as quatro responsabilidades: montar as ferramentas do turno, classificar negação em terminal ou transitória, cortar resultado acima do orçamento antes de entrar no contexto, e construir a aprovação tipada item a item. ADIA: a reverificação de alcance de canal derivado de composição viva (E6.4) na borda de cada chamada — vira allowlist por pessoa mais capacidades por agente, com o alcance de canal reverificado na borda do DESPACHO (que continua valendo, porque a fila durável ficou mais longa, não mais curta). RECUSADA a proposta de endpoint de decisão síncrono no servidor com fail-closed. O que FICA do instinto correto daquela proposta: o EVENTO grava quem decidiu e sob qual versão de regra, desde o primeiro turno.

## O que mudou

Adia a reverificação de alcance na borda de cada CHAMADA (mantém na borda do despacho). Recusa a autoridade remota proposta. Grava decidido_por no evento.

## Por quê

Uma frente propôs mover a autoridade da decisão para o servidor, com consulta HTTP e fail-closed em cada chamada de ferramenta, e sustentou isso dizendo que 'o openmausbot já separa PROCESSO local de AUTORIDADE remota'. VERIFIQUEI LINHA A LINHA E A AFIRMAÇÃO É FALSA. O control-client consulta um endpoint de LOOPBACK: o próprio cabeçalho dele diz que o cache existe para não virar 'two dozen LOOPBACK round trips', e container-mcp.ts:18-19 escreve 'the token guards a loopback endpoint'. A segunda prova citada (connector-proxy.ts) também é loopback: OMB_HARNESS_URL é http://127.0.0.1:8799. Pior: o registro que o control-client consulta (computer-control.ts) é uma trava física entre a mão do humano e a mão do agente no MESMO mouse, e o cabeçalho diz 'State is per-boot and in-memory ON PURPOSE' — perder o estado no restart é a feature. Promover isso a modelo de autoridade de política com trilha probatória é copiar a forma de algo cujo conteúdo é oposto. E a proposta não comprava o que prometia: a própria frente escreveu que a pessoa é admin da máquina e pode trocar o binário do proxy — mas quem troca o binário também troca o que ele REPORTA, então a trilha escrita a partir do relato não é probatória contra o dono da máquina. Em troca, pagaria uma consulta WAN com 2s de timeout no caminho de cada tools/call. O que o proxy sempre defendeu é o AGENTE, e o agente não é admin da máquina: o proxy local o contém exatamente como o proxy no container continha. E no dia do SaaS o executor volta ao container, o proxy volta junto, e a autoridade volta a ser loopback sozinha.


## Consequência registrada (2026-09-16, EMENDA 29)

Hoje o proxy chama o servidor por `tools/call` em loopback (mesmo processo, `PonteInterna` in-process). Quando a ponte pull HTTP entrar, o código de decisão (catálogo, concessão, parada) continua rodando no app local contra o PLANO DE TURNO já puxado — nunca consulta WAN por chamada. Isto está em `riscos` do plano e é a razão de o proxy consumir só o plano (ADR-024).

## Gatilho de reversão

Reabrir (mover a autoridade para o servidor) se aparecer um incidente em que o AGENTE — não o dono da máquina — contornou o proxy local, ou se um segundo executor remoto precisar de decisão sem plano puxado. Trocar o binário do proxy pelo dono da máquina NÃO é gatilho: a trilha nunca foi probatória contra o dono.

## Emenda de 2026-09-28 — corte que não perde dado

**Contexto.** O corte fixo de 8.000 caracteres ("cabe num turno haiku", 16/09) fazia o bot trabalhar com um pedaço da resposta. O corte caía no meio de um item, e a marca dizia "orçamento do turno", que o bot repetia à pessoa como um limite de turno. Casos: o ClickUp da Ada, o Gmail da Teodora e 70 de 104 arquivos de um PR do Dev 1. Nenhum bot roda em haiku hoje. O Claude Code do terminal passa 25.000 tokens inline e, acima disso, salva a resposta num arquivo que o modelo lê por partes.

**Decisão.**
- **Orçamento de 75.000 caracteres por resposta** (`ORCAMENTO_RESULTADO_CHARS`), equivalente ao inline do terminal.
- **O proxy continua o único ponto de corte**, e o corte passou a entender JSON:
  - compacta sem perda (tira espaçamento e campos vazios);
  - corta por **itens inteiros** da maior lista, mantendo as chaves irmãs e citando a paginação da fonte;
  - só no último caso corta por caracteres.
- **`ler_mais {ref}`, ferramenta de origem `proxy`:** o proxy guarda o resto durante o turno e o entrega em partes, com a mesma moldura. Ela não vai ao servidor: o resto já passou pela decisão do servidor na chamada original. É leitura pura, então fica também no catálogo reduzido.
- **O servidor GitHub nativo e o `gh` da máquina deixam de cortar antes.** O corte duplo perdia a marca.
- **Contra o desvio para arquivo, que o bot não lê** (`--tools ""`): o filho recebe `MAX_MCP_OUTPUT_TOKENS` com o dobro do orçamento, e o `tools/list` anota `_meta.anthropic/maxResultSizeChars`. Medido com o CLI real em `scripts/sonda-saida-mcp.ts`.

## Emenda de 2026-10-25 — o revisor do Automático no servidor (ADR-115)

O revisor do Automático passou a rodar no servidor do Nod, chamando a API da Anthropic na conta do Nod enquanto o hook
espera ([ADR-115](adr-115-automatico-com-revisor-na-ia-da-pessoa.md), "Revisor no servidor"). É uma dependência remota
síncrona do Nod, **aceita**: vale só para o que já ia ao revisor no Automático; a queda dela é o cartão (o comportamento
de antes), nunca negação nem liberação; e a decisão continua do servidor, que o hook já consulta desde a ADR-055. O que
esta ADR recusou — o proxy consultar o servidor a cada `tools/call` com fail-closed — continua recusado.
