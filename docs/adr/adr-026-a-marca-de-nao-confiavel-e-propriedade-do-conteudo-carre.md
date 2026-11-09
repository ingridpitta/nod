# ADR-026 — A marca de não-confiável é propriedade do conteúdo, carregada no envelope

**Status** novo · **Origem** comparação OpenMausBot × hermes-agent nas quatro features core

## Decisão

A marca de DADO NÃO CONFIÁVEL acompanha o CONTEÚDO e nunca é derivada do nome da ferramenta que o produziu. Conteúdo que entra por conector, navegador, arquivo de cliente ou mensagem de outro bot nasce marcado, e a marca viaja em confianca_entrada no plano de turno e no envelope de delegação. Turno com entrada não confiável recebe catálogo REDUZIDO, resolvido pela regra no servidor. Na fronteira com o modelo, o conteúdo é envolvido em delimitador com instrução de tratar como dado, e a própria string do delimitador é defangada dentro do conteúdo, sem atalho de 'já embrulhado'.

## Contexto

A emenda de vocês sobre conteúdo externo já existe, mas a delegação entre bots é o canal que a contorna, porque a mensagem parece interna. Verifiquei que o Hermes já tem o mecanismo certo — agent/tool_dispatch_helpers.py:515 _maybe_wrap_untrusted e :510 _neutralize_delimiters, este último com regex case-insensitive e comentário explícito de que não há fast-path de já-embrulhado porque seria forjável pelo atacante. Mas o ESCOPO está errado: _UNTRUSTED_TOOL_NAMES cobre web_extract e web_search mais os prefixos browser_ e mcp_, e message_agent não está na lista. O bot marca o PDF do cliente quando o lê via mcp_ e DESMARCA quando o repassa a outro bot. A delegação lava a marca.

## Alternativas rejeitadas

### Manter a derivação pelo nome da ferramenta, como o Hermes

É exatamente o bug. O nome da ferramenta descreve a ORIGEM IMEDIATA, não a procedência do conteúdo.

### Instrução no system prompt para desconfiar de mensagens de outros bots

Prompt não é gate. Quando o prompt falha no OMB o pedido é recusado, porque há uma camada abaixo; quando falha no Hermes o pedido é executado. Essa é a diferença que justifica a fronteira estrutural.

## Evidência

_maybe_wrap_untrusted e _neutralize_delimiters (verificados no código, incluindo o comentário sobre não haver fast-path forjável). peer-provenance.ts do OMB pela redação que dá ao modelo um caminho de ação — 'diga quem pediu em vez de fazer' — e não só uma proibição. peer-roster.ts:143 peerName() removendo colchetes é o MESMO bug de escape em outro sistema: quem portar sem isso reabre os dois.

## Consequências

- Custo de token real: a moldura adiciona algo em torno de 80 tokens por conteúdo marcado. O Hermes já pensou nisso com _UNTRUSTED_WRAP_MIN_CHARS = 32, que não embrulha conteúdo curto — copiem o limiar.
- O catálogo reduzido para turno não confiável precisa ser uma regra nomeada no servidor, não uma constante no proxy.
- Exige decidir o que o modelo FAZ com um pedido legítimo dentro de um bloco não confiável; a resposta do OMB é boa e é a copiável.

## Reversibilidade

Alta no mecanismo, baixa na disciplina: se a primeira leva de conectores entrar sem o campo, todo conteúdo já ingerido fica sem procedência.

