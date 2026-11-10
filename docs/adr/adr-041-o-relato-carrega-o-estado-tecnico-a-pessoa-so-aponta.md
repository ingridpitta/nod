# ADR-041 — O relato carrega o estado técnico; a pessoa só aponta

**Status** novo · **Origem** não havia caminho para dizer "isso está errado", e o diagnóstico da falha
morria em stdout

## Decisão

Relatar comportamento indesejado custa **dois cliques e nenhum dado técnico**: a pessoa aponta uma
mensagem, escolhe uma categoria de uma união fechada e diz se anexa só aquela mensagem ou os últimos
15 minutos. Todo o resto — sinais write-ahead do turno (ADR-009), motivo de falha e de interrupção,
modelo, harness, executor, custo, reenvios, confiança do conteúdo, versão do app e o `correlation_id`
do erro que ela viu — é **copiado pelo servidor** do que já estava tipado e persistido.

O relato segue a forma da trilha (ADR-004): metadados tipados em `relatos`, prosa em `relato_prosa`,
**apagável** por `nod_poda`. O trecho de conversa é snapshot, porque a conversa muda depois e o relato
precisa registrar o que a pessoa VIU.

A janela é ancorada no **id** da mensagem, nunca no instante reconstruído, e a duração é constante do
servidor: o cliente manda o alcance, jamais o intervalo.

O diagnóstico da execução que não concluiu (`erro_cru` do fornecedor, nomes das ferramentas chamadas,
negações de permissão, sessão do CLI) passa a **persistir** em `turno_diagnosticos`, gravado pela ponte
na mesma transação que assenta o turno, e só quando `desfecho <> 'sucesso'`.

## Contexto

O nod já produzia um diagnóstico excelente e o jogava fora. `erroCru` — a causa crua que o CLI devolve —
virava uma linha de log em `ponte-interna.ts`, e log vai para stdout, que **some num Electron
empacotado**. `ferramentasChamadas` chegava inteiro do stream e era reduzido a uma contagem no evento
`turno_encerrado` (`assentar-turno.ts`). Quem investigasse um comportamento ruim reportado por uma
pessoa tinha `motivo_falha = 'erro_execucao'` e mais nada.

Ao mesmo tempo, não existia nenhuma superfície para a pessoa reclamar. A evidência morava na cabeça
dela, em prosa, num canal fora do produto — e o time recebia "o bot respondeu mal" sem turno, sem
modelo, sem sinal.

## Alternativas rejeitadas

### Pedir à pessoa que descreva o problema num campo de texto

É o que existe em todo lugar e é o que produz relato inútil. A pessoa não sabe qual harness rodou, nem
que o turno morreu com `sem_progresso` depois de `promptSubmitted`. Pedir prosa transfere a ela um
trabalho que o servidor faz melhor, e ainda assim entrega menos.

### Persistir o trace inteiro de todo turno

Resolveria o diagnóstico com folga, mas paga custo em **todo** turno para servir um relato que é raro,
e transforma `tool_result` (que carrega conteúdo de arquivo e de conector) em retenção permanente —
exatamente o que o ADR-002 evita. Guardar só quando a execução falhou mantém o volume ligado ao
problema.

### Alterar `assentar-turno.ts` para gravar o diagnóstico

Foi a primeira ideia e foi recusada: aquele caminho é a transação única de mensagem + turno + outbox
(ADR-010), percorrida por todo turno bem-sucedido. A gravação entrou na ponte, ao lado do log que já
existia, com a condição de desfecho — o fluxo de sucesso não ganhou uma linha de trabalho.

### Criar a issue no Linear direto do relato

A esteira existe (`docs/roadmap/criar-issue-no-linear.md`, trilha `investigação`) e é o destino natural.
Foi adiado de propósito: sem ver o formato real dos primeiros relatos, automatizar a promoção enche o
board de ruído. Promover continua sendo decisão humana até haver evidência.

## Evidência

Medido em 2026-09-21 ao escrever o teste HTTP: a janela voltava **vazia** incluindo a própria mensagem
apontada. O Postgres grava `clock_timestamp()` com microssegundos (`18:24:28.352292`) e a conversão
para `EpochMs` trunca em milissegundos (`.352`), de modo que `criado_em <= ${ate}` exclui a linha que
originou o recorte. Por isso a âncora entra por `id`, e não por comparação de tempo — um teste de
integração pegou o que a leitura do código não pegava.

## Consequências

- Três tabelas novas, todas sob `nod_escopar_tabela`: `relatos`, `relato_prosa`, `turno_diagnosticos`.
- Duas delas são apagáveis por `nod_poda`, porque guardam prosa: a da pessoa e a do fornecedor.
- `KindEvento` ganha `relato_criado` e `TipoFrame` ganha `relato.criado`. O frame **não invalida nada**:
  relato é registro, não estado vivo da conversa.
- O `correlation_id` do `ErroApi` passa a atravessar até o estado da web. Continua fora do que se
  renderiza (ADR-002); serve para o relato citá-lo.
- A versão do build entra no bundle por `define` do Vite. É rótulo de build, nunca identificador.
- A classe `.msg-actions` existia em `estilos.css` sem nenhum render desde a folha original; o ícone de
  relato é o primeiro botão a usá-la.

## Gatilho de reversão

Reabrir se (a) a categoria fechada não couber: mais de um quinto dos relatos caindo em `outro` por 30
dias significa que a lista está errada — a resposta é corrigir as categorias, nunca abrir para texto
livre; (b) `turno_diagnosticos` crescer além do que a poda dá conta, indicando que a condição de
desfecho não está filtrando o suficiente; (c) a janela de 15 minutos provar-se curta ou longa demais —
se a maioria dos relatos úteis precisar de contexto anterior à janela, a constante muda, e se ninguém
usar o alcance `janela`, ele sai; ou (d) a promoção manual para o Linear virar gargalo, momento em que
a integração adiada volta à mesa com o formato real dos relatos já conhecido.

## Emenda (2026-10-05, NOD-158) — o snapshot sai redigido

O snapshot do relato continua fiel: formato, tamanho e o **nome** do segredo são preservados, e só o
valor some (`ANTHROPIC_API_KEY=«redigido: 51 caracteres»`). Passam pelo redator único
`src/domain/segredos.ts` o `erro_cru` de `turno_diagnosticos` (redigido antes do corte de 8 KiB), o
texto da pessoa e o trecho em `relato_prosa`, os valores do log e o `cause` da recusa HTTP (`erros.ts`,
redigido antes do corte de 200). A mensagem gravada na conversa não
muda. Os padrões são de alta precisão (prefixos de chave, Bearer, JWT, PEM, `chave=valor` com nome de
segredo, `--token`, senha em URL), então UUID, sha e código continuam legíveis.

Contrato para quem exporta (NOD-138, diagnóstico; NOD-44, conversa): use `redigirECortar` antes de
qualquer corte. Cortar primeiro parte o segredo, e o pedaço que sobra não é mais reconhecido.

## Emenda (2026-10-05, NOD-138) — log local e diagnóstico do app do Mac

Esta emenda está no arquivo `adr-041-o-relato-carrega-o-estado-tecnico-a-pessoa-so-aponta.md`. O número 041 também
é usado por `adr-041-chave-composio-do-tenant-catalogo-vindo-do-provedor.md`, que trata de outro assunto.

O relato continua cobrindo só a resposta ruim vista pelo servidor. Para o problema que é do app do Mac, o app passa a
guardar o próprio log e a exportar um diagnóstico local:

- **Local e retenção:** o `log()` do app (não o do servidor) grava a mesma linha redigida do stdout em
  `~/Library/Logs/nod/nod.log`, com modo `0600` e duas gerações de 1 MiB (`nod.1.log`). Quedas de processo entram
  como `app_processo_caiu`, só com metadados de lista fechada.
- **Exportação:** pelo menu **nod › Exportar diagnóstico…**, um `.txt` em pt-BR montado por
  `src/domain/diagnostico-app.ts`. O texto é redigido (`redigirSegredos`) antes do corte de 256 KiB, a pasta pessoal
  vira `~` e e-mail vira `«e-mail»`.
- **O que nunca entra:** a chave do Mac, o cookie de sessão, o e-mail, o nome do Mac, o texto das conversas e o
  `erroCru` dos turnos.
- **Não sobe:** o diagnóstico fica no Mac. A pessoa decide se manda ao suporte. Ele não vai ao servidor nem é
  anexado ao relato.

Gatilho de reversão: reabrir se o suporte precisar do estado do servidor junto (aí o diagnóstico vira parte do
relato) ou se 2 MiB não cobrirem o intervalo entre o problema e a exportação.

## Emenda (2026-10-18, ADR-113) — o relato sai do besouro para a bandeira

A barra da fala ganhou reagir, responder e ⋯ ([ADR-113](adr-113-reacoes-e-citacao-na-fala.md), protótipo "Responder,
reagir e mais ações"). O relato fica nela, no terceiro botão, com o ícone de bandeira no lugar do besouro e o nome
"Reportar problema nesta resposta" ("nesta mensagem" na fala da pessoa). A ação é a mesma (`relatar-mensagem` →
`abrirReportarBug`), com o estado técnico de sempre; a linha de sistema (negação, parada) continua se relatando, só com a
bandeira e o ⋯. Nada muda no que o relato grava.

## Emenda (2026-10-18, ADR-114, chat limpo, PR 2) — o relato na Atividade e a janela de itens de chat

Os itens da Atividade que são mensagem levam o "Relatar" (abertos na lista, ancorados no id da mensagem, como sempre); a
linha que vem da trilha (app indisponível) não leva na v1. Na conversa própria, a janela do relato (`janelaAte` com
`comDestino`) conta 100 itens de chat, como a conversa — no Eng 1, 100 mensagens cruas davam umas 5 falas — e leva junto o
que estava na Atividade nos mesmos 15 min, desde o corte, marcado `naAtividade` no trecho: o relato registra o que a pessoa
viu. A sala e o relato contado ao Nod continuam com as mensagens cruas.

## Emenda (2026-10-20, NOD-292) — o turno do relato é o que explica a mensagem

O relato copiava o turno de `mensagens.turno_id`, que só a fala do bot tem: o relato sobre a fala da pessoa saía sem
estado técnico nem diagnóstico, justo quando a pessoa aponta a própria pergunta que não foi respondida. Agora o turno do
relato é o que EXPLICA a mensagem: o que produziu a fala do bot; o que a fala da pessoa disparou (`mensagem_origem_id`);
ou, se esse foi lido junto com outro (`absorvido`), o turno que respondeu por ele (`absorvido_por`, até 5 saltos). A fala
de bot sem turno não busca por origem. O `relato_criado` leva `turno_via` (`mensagem`, `disparado`, `absorvedor`,
`nenhum`); sem coluna nova — `relatos.turno_id` passa a guardar o turno-alvo.

## Emenda (2026-10-26, NOD-367) — Feedback mostra o texto de quem escreveu, também no relato do botão

A tela Relatos virou Configurações › Feedback, e quase todo relato aparecia como "Outra coisa": a categoria que pede
texto é justamente a que não diz nada sozinha. A listagem (`relatos.listar`) passa a trazer o título e os 160 primeiros
caracteres de `relato_prosa` também no relato do botão, e não só no contado ao Nod (0062). O título da linha é esse texto,
até 80 caracteres; sem texto, a categoria. A privacidade não muda: o join filtra `p.owner_id` pela pessoa da sessão, além
da RLS de `relato_prosa` (ADR-004), então o relato de outra pessoa continua sem prosa na lista — só a categoria, o tipo e
o estado técnico. O teste de integração `relatos.test.ts` ("NOD-367: na listagem…") prova os dois lados.

O "Enviar feedback" das Configurações não tem mensagem para apontar, então não anexa conversa nenhuma: leva à conversa
com o Nod, e o relato sai com origem `nod`. O anexo (`mensagem` ou `janela`) continua só no "Reportar" de uma mensagem.

Gatilho de reversão desta emenda: voltar ao título só pela categoria se aparecer prosa de uma pessoa na listagem de outra
(o teste de integração quebra antes), ou se o texto cortado na linha passar a expor dado sensível que a pessoa não espera
ver fora do detalhe — aí o título vira a categoria e o texto fica só ao abrir. O gatilho (a) acima passa a se medir pelo
`relatos.categoria`, não pelo título da tela, que agora mostra o texto.

## Emenda (2026-11-10, migração 0159, PR #726) — a triagem diária lê os relatos de todos os tenants

A triagem diária dos relatos roda pelo psql na nod-vm com a credencial que já existe (`DATABASE_URL_DONO`, nod_dono). É a
única exceção à prosa privada (ADR-004, emenda NOD-367 acima): quem tria lê `relatos` e `relato_prosa` de todos os tenants
e marca o relato com `estado` (`novo`, `no_backlog`, `feito`, `descartado`), `tarefa_ref` (ex. `ADA-123`) e `triado_em`.
O acesso passa só pelas funções `triagem_relatos`, `triagem_relato` e `triagem_marcar` (SECURITY INVOKER, `REVOKE ALL
FROM PUBLIC`), que ligam o GUC `nod.triagem` enquanto rodam. As policies `nod_triagem_*` são `TO nod_dono` (nod_app não ganha
leitura, nem do próprio tenant fora da pessoa) e o trigger `nod_triagem_so_rastreio` limita o UPDATE às três colunas da
triagem. Não há policy de INSERT nem de DELETE, e a `nod_purga` fica como estava. Provas: `tests/concurrency/triagem-relatos.test.ts`
e `tests/integration/triagem-relatos.test.ts`.

Limite que fica: nod_dono é a dona das tabelas. Quem tem essa credencial pode ligar o GUC à mão ou mudar o schema, então o
caminho fecha o uso do dia a dia, não a dona. Gatilho de reversão: tirar a leitura da prosa se o jurídico (LGPD) recusar
que um operador leia o texto de outro tenant. Nesse caso a triagem passa a ver só os metadados tipados.
