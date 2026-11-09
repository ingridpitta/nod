# ADR-068 — Arquivo do Mac para qualquer app

Status: aceito · Data: 2026-10-01 · Estende a [ADR-057](adr-057-marketplace-com-o-catalogo-publico-do-composio.md)
(os apps do Composio) e a [ADR-067](adr-067-sessao-viva-o-turno-segue-ate-o-bot-terminar.md) (o bot que grava o vídeo
na sessão viva agora consegue entregá-lo). Proposta 2 do diagnóstico "a esteira trava depois do PR", aprovada pelo
Marlon em 2026-10-01.

## Contexto

O manual do time pede o vídeo da funcionalidade na task, e o Milton o publica no #novidades-produto. Em 01/10 havia
quatro vídeos prontos parados em `~/nod/Dev 1`, `~/nod/Dev 2` e `~/nod/Dev 4`. Os bots relatavam: "o conector do
ClickUp só aceita upload por chave S3, então não consegui anexar".

As ferramentas do Composio que recebem arquivo pedem `{name, mimetype, s3key}`, e o `s3key` precisa ser de um arquivo
que já está no armazenamento do Composio. O nod fala com o Composio pelo MCP, que só leva JSON, e o arquivo do Mac nunca
chegava lá. No catálogo do nod em 01/10, **13 ferramentas em 6 apps** usam esse mesmo formato:

| App | Ferramentas |
|---|---|
| Gmail | anexo em enviar, rascunho, responder e atualizar rascunho |
| Google Drive | criar, enviar, envio retomável e atualizar |
| Slack | enviar arquivo, foto do perfil |
| ClickUp | anexo na task |
| Notion | enviar arquivo |
| Supabase | deploy de function |

O Marlon perguntou "o quanto isso vai servir para novos apps" e se seria preciso "chamar a ferramenta de escrita toda
vez".

## Decisão

**O bot chama a ferramenta do próprio app, uma vez só, com o caminho do Mac no `s3key`. O nod sobe o arquivo e troca o
caminho pela chave antes de chamar o app.** Nada é específico de app: vale para todo campo `{name, mimetype, s3key}`,
inclusive de app novo do Composio.

- **Caminho do Mac:** começa com `/` ou `~/`. Uma chave do Composio nunca começa assim
  (`47563/gmail/GET_ATTACHMENT/response/12345`), e o arquivo que já veio de outro app segue com a chave dele.
- **Onde:** em `conectores-vivos.chamar`, o ponto por onde passam a chamada direta e o card aprovado (`decidir`).
  Isso acontece depois da decisão do modo, então **nada sai do Mac sem a aprovação que a escrita pede**. No manual, o
  card mostra o caminho.
- **Como:**
  1. `POST https://backend.composio.dev/api/v3.1/files/upload/request`, com o `x-api-key` do próprio conector e
     `{toolkit_slug, tool_slug, filename, mimetype, md5}`;
  2. `PUT` dos bytes no `new_presigned_url` (`x-ms-blob-type: BlockBlob` no Azure);
  3. a chamada ao app vai com a `key`.

  Cada arquivo sobe uma vez por chamada. Nome e mimetype saem do que o bot deu ou do nome do arquivo.
- **Prazo:** a chamada que leva arquivo usa um cliente próprio com 10 min (`CHAMADA_COM_ARQUIVO_MS`). O app baixa o
  arquivo do Composio e o envia, o que passa dos 15 s de uma consulta.
- **Cercas:** credencial do Mac nunca sai (a mesma regra das nativas, ADR-055). O teto é de 1 GB, o limite de upload
  do Slack, porque o arquivo passa pela memória.
- **Erros legíveis:**
  - arquivo inexistente;
  - credencial;
  - acima do teto;
  - app sem chave do Composio;
  - servidor compartilhado.

  Todos voltam ao modelo como erro do conector com o motivo, sem chamar o app e sem marcar o conector como falho.
- **Só no nod local.** O servidor está no Mac da pessoa e lê o arquivo. No servidor compartilhado (ADR-045), a chamada
  com caminho volta com "o envio de arquivo só funciona com o nod local".
- **O bot fica sabendo:**
  - no plano, a descrição de cada `s3key` de arquivo diz "Arquivo do Mac: ponha aqui o caminho…" (`comArquivoDoMac`;
    a validação não muda);
  - o parágrafo do terminal no prompt diz como mandar vídeo, print ou PDF a um app.

## Alternativas descartadas

- **Uma ferramenta `enviar_arquivo` do nod**, por app. Era a primeira proposta. Obrigaria código por app, e o bot
  teria duas ferramentas para a mesma escrita.
- **Subir no proxy, no Mac, antes da chamada.** Funcionaria também no servidor compartilhado, mas o arquivo sairia do
  Mac antes de o modo decidir. No manual, um card recusado já teria vazado o arquivo.
- **Link do arquivo em vez do arquivo**, com GitHub ou Drive público. O Slack e o ClickUp mostram o vídeo inline só
  com o arquivo, e o link do repositório privado não abre para o solicitante.

## Custo aceito

- **No total e no automático, o bot manda qualquer arquivo do Mac que conseguir ler** (menos credencial) para um app
  com escrita concedida. É o mesmo alcance que ele já tinha pelo terminal.
- **O arquivo fica no armazenamento do Composio**, com a política de retenção deles.
- **Arquivo grande passa inteiro pela memória do servidor local**, até 1 GB.

## Validação

- `tests/unit/domain/arquivo-do-mac.test.ts`:
  - acha o arquivo no anexo do ClickUp e no `file` do Slack, único ou em lista;
  - troca só o que subiu;
  - nome e mimetype;
  - credencial recusada;
  - a dica no schema, no objeto e na lista, sem mudar a validação.
- `tests/unit/services/conectores-vivos-arquivo.test.ts`, com Composio e sessão MCP falsos:
  - pede o link com `x-api-key`, slug, ferramenta e md5;
  - sobe os bytes por PUT com o mimetype;
  - chama o app com a chave;
  - `~/` é a home;
  - o mesmo arquivo sobe uma vez;
  - os quatro erros voltam legíveis sem chamar nada;
  - chave do Composio segue direto.
- **Teste real no diário depois do deploy:** um bot envia um arquivo pequeno ao Slack, sem canal (o arquivo fica
  privado de quem enviou).

## Gatilho de reversão

- Um arquivo que ninguém pediu sai para um app, por instrução lida de fora. Voltar a pedir aprovação para toda chamada
  com caminho do Mac, em qualquer modo, como cerca.

## Não implementado

- **Servidor compartilhado:** a subida pelo Mac, em duas fases (decidir, depois subir pelo proxy).
- **Concessões:** quem recebe a escrita com arquivo é decisão do Marlon. Hoje o Milton, que publica no
  #novidades-produto, tem `SLACK_SEND_MESSAGE` mas não tem o upload; o Dev 2 e o Dev 4, que gravam os vídeos, não têm
  Slack.
