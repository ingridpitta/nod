# ADR-051 — O artefato do nod

Status: aceito · Data: 2026-09-28 · Emenda ADR-013, ADR-024
(catálogo por modo) e ADR-026 (marca de não confiável no resultado de uma ferramenta nod).

## Contexto

O nod roda cada turno como `claude -p` headless com `--tools ""`. A ferramenta de artefato do claude.ai
**não existe** nesse modo. Em 2026-09-28 o Marlon pediu à Ada a checklist de ToDo do dia "num artefato do
Claude". A Ada não tinha como, e contornou escrevendo HTML no computador do bot:

- 7 pedidos em 11 min, 9 aprovações, 18 turnos, US$ 5,94;
- o arquivo nunca abriu para ele.

A conversa também não mostrava HTML: `web/lib/texto-formatado.ts` escapa tudo. Faltava ao nod um artefato
próprio:
- o bot publica HTML que aparece DENTRO da conversa;
- a página é interativa (checkbox) e o que a pessoa marca fica salvo;
- a página tem versões: a rotina do meio-dia da Ada atualiza a mesma checklist.

## Decisão

1. **Duas ferramentas nod** (`src/contracts/ferramentas-artefato.ts`, espalhadas em `FERRAMENTAS_NOD`):
   - `publicar_artefato { titulo, html, artefato_id? }`: sem `artefato_id` nasce a v1; com ele, a próxima
     versão do MESMO artefato, que tem de ser deste agente. Grava uma mensagem `kind = 'artefato'` na
     conversa do turno, com payload só de ids (`{kind, artefatoId, versao, titulo}`), e emite
     `mensagem_criada` como as outras falas. Devolve `{artefato_id, versao}`. Sem efeito externo:
     `readOnlyHint = false`.
   - `ler_artefato { artefato_id }`: título, versão atual, o estado que a pessoa salvou e o HTML, cortado em
     60 000 caracteres com marca. É leitura (`readOnlyHint = true`). O estado vem ANTES do HTML no JSON.
   - Erro de domínio volta tipado em `{erro}`, como nas ferramentas de rotina, e sempre antes de gravar.
2. **Modos.** As duas ferramentas entram em `conversa` e `rotina`. A `retomada` cai num dos dois
   (`modoDoTurno`), então também as tem. Ficam de fora:
   - sala: o estado é por pessoa e a sala tem várias; a RLS do artefato não tem perna de sala;
   - criação;
   - peer: quem lê é outro bot;
   - delegação: o resultado volta ao remetente, não à pessoa.
3. **Turno não confiável.** `catalogoReduzido` (`src/domain/confianca.ts`) mantém TODA ferramenta nod. As
   duas ficam, de propósito: publicar não sai do nod (é uma mensagem na conversa da própria pessoa) e a
   página roda sem rede. A marca vai junto do conteúdo: a mensagem do artefato herda a
   `confiancaEntrada` do turno e o card mostra "não confiável". O resultado de `ler_artefato` chega ao
   modelo como NÃO confiável (o proxy o envolve), porque o estado foi escrito por código do bot rodando no
   navegador.
4. **Banco (0031).** `artefatos`, `artefato_versoes` (UNIQUE tenant+artefato+versão, `mensagem_id`) e
   `artefato_estados` (UNIQUE tenant+artefato+owner: um estado por pessoa). As três tabelas passam por
   `nod_escopar_tabela`, sem perna extra. Tetos por CHECK:
   - título ≤ 120 caracteres;
   - HTML ≤ 500 000 caracteres;
   - estado ≤ 64 KB, medidos no texto do jsonb.

   O repositório só grava o estado quando ele cabe na forma normalizada do jsonb; sem caber, a resposta é
   400, nunca um CHECK virando 500. `ALTER TYPE kind_mensagem ADD VALUE 'artefato'`.
5. **Rotas (L6).**
   - `GET artefatos/:id`: a versão atual e o estado da pessoa.
   - `GET artefatos/:id/versoes/:versao`: é a que a web usa, porque cada card mostra a SUA versão.
   - `PUT artefatos/:id/estado {dados}`.

   O HTML sai como JSON, nunca como página desta origem.
6. **Web.** A mensagem vira um card: `▣ título · vN · hora`, "Tela cheia" e "Baixar .html".
   - O HTML roda num `<iframe sandbox="allow-scripts" srcdoc>`, carregado quando o card aparece.
   - O `srcdoc` começa pela meta CSP `default-src 'none'; style-src 'unsafe-inline'; script-src
     'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'`. Depois vem uma
     ponte pequena: `window.nod = { estado, salvar(dados) }` posta `{nod:"estado"}` ao pai, e um
     ResizeObserver posta `{nod:"altura"}`. O HTML do bot vem por último.
   - O pai só aceita mensagem cuja `source` é a janela daquele iframe e cuja origem é a opaca (`"null"`).
     Ele confere forma e tamanho, junta as marcações por 600 ms e grava por PUT. A altura fica entre 120 e
     2 000 px.
   - Versão anterior fica recolhida e não grava estado. Só a versão atual grava.
   - O card na timeline é uma string com um slot vazio. O iframe entra depois do render
     (`web/telas/artefatos-vivos.ts`), então marcar um checkbox não regrava a região.
   - Quando a timeline é regravada, o iframe é estacionado e volta ao slot novo sem recarregar
     (`Element.moveBefore`). Sem esse suporte, ele é recriado do cache, já com o estado mais novo.
   - O app não tinha CSP própria (`web/index.html`, `estatico.ts`), então nada bloqueia o `srcdoc` e nada
     foi mudado ali.
7. **Proxy.** O resultado de `ler_artefato` passa pelo corte de todo resultado (emenda de 2026-09-28 do
   ADR-013: 75 000 caracteres, com o resto em `ler_mais`). Os 60 000 de HTML que a ferramenta promete
   cabem. O estado vem antes do HTML no JSON: se algo for cortado, é o fim do HTML, nunca o que a pessoa
   marcou.
8. **Prompt.** Quando `publicar_artefato` está no catálogo, uma linha manda o bot usá-lo para o que é
   visual ou de marcar. Ela pede HTML autocontido, `window.nod.estado` e `window.nod.salvar` com chaves
   estáveis, nova versão com `artefato_id`, `ler_artefato` antes de atualizar e nunca o computador do bot.

## Segurança

O HTML é do bot e é **não confiável**: pode ter vindo de um turno que leu e-mail ou site.

- **Sem allow-same-origin.** A página tem origem opaca. Não lê cookie de sessão, storage nem o DOM do nod,
  e não chama a API com a sessão da pessoa. Sem `allow-popups`, `allow-forms`, `allow-top-navigation` e
  `allow-modals`, ela também não abre janela, não envia formulário, não navega a aba e não abre alerta.
- **Sem rede.** A CSP é a primeira coisa do `<head>`: uma meta CSP só vale no head e para o que vem depois.
  Fetch, XHR, WebSocket, imagem, fonte, CSS e iframe de fora não carregam. `x-dns-prefetch-control: off` e
  WebRTC desligado na ponte são defesa extra; não são prova. Uma segunda CSP do bot só restringiria mais.
- **postMessage filtrado.** A mensagem só passa se a `source` é a janela DAQUELE iframe, e o pai confere
  forma e tamanho. O servidor confere de novo, com a RLS da pessoa. A ponte posta para `"*"`, porque o
  pai não tem origem que a página conheça, e o que ela posta é só o estado que ela mesma já tem.
- **Tetos.** Os tetos da decisão 4 valem no schema, no domínio e no CHECK. O `estado` embutido no
  `<script>` tem `<` escapado, para um `</script>` no dado não fechar a tag. O caractere NUL é recusado
  antes do banco.
- **Canal que sobra: a página navegar a si mesma.** `location` ou meta refresh: o sandbox não impede que o
  iframe navegue a si mesmo, e a CSP não cobre navegação. Então, no navegador:
  - o dado que a página tem (o HTML e o estado) pode sair na URL de uma navegação;
  - a web fecha o iframe no segundo `load` ("O artefato tentou abrir outra página e foi fechado"), e a
    página de fora nunca fica no card;
  - o pedido, porém, já saiu.

  Clique em link que sairia da página não navega: a ponte cancela. Link é inerte no artefato; o
  `target=_blank` já não abria, por falta de allow-popups.

  No app desktop, `will-frame-navigate` recusa toda navegação de subframe para fora de
  `about:srcdoc`/`about:blank` (`desktop/main.ts`), e o canal fecha.
- **Medido em 2026-09-28** (Chromium headless do gstack, uma página de teste com o iframe de
  `iframeDoArtefato` e o filtro de `lerMensagemDoArtefato`):
  - `fetch` e `<img>` externos recusados pela CSP;
  - `document.cookie` lança SecurityError;
  - `window.nod` não é reatribuível;
  - o estado inicial chega inteiro, inclusive um `</script>` dentro dele;
  - `salvar` de 70 KB é recusado já na página;
  - a mensagem de outro iframe é descartada, com origem "null" e `source` diferente;
  - a altura chega pelo ResizeObserver;
  - o clique no link não navega;
  - `location.href = "https://…"` SAIU (a requisição apareceu na rede) e o iframe foi fechado no segundo
    `load`.
- **Arquivo baixado.** O `.html` baixado leva a mesma CSP e a mesma ponte (`documentoDoArtefato`). Aberto
  fora do nod, continua sem rede, mas roda fora do sandbox: é arquivo da pessoa, como qualquer download.

## Alternativas descartadas

- **Renderizar o HTML direto na conversa, sanitizado** (DOMPurify ou similar). Sem script não há checkbox
  que salva. Com script, o código do bot rodaria com a sessão da pessoa.
- **Servir o artefato numa rota do nod (`/artefatos/:id.html`) com CSP `sandbox`.** Funciona, mas cria uma
  página HTML na MESMA origem da API. Um erro de cabeçalho vira XSS com a sessão. O `srcdoc` num iframe
  sandbox nunca tem essa origem.
- **Origem separada (subdomínio de artefatos).** É o isolamento mais forte. Custa DNS, certificado e
  cookie por ambiente, e não existe no dev local nem no desktop. Fica para quando houver deploy
  compartilhado.
- **Estado no `localStorage` do iframe.** O sandbox sem allow-same-origin não tem storage persistente, e o
  estado não chegaria ao bot (`ler_artefato`) nem a outro computador.
- **Publicar pelo computador do bot.** É o que a Ada fez: 18 turnos e nada na tela.

## Gatilho de reversão

- Se, em 30 dias, um artefato for fechado pelo segundo `load` sem a pessoa ter clicado num link, a página
  tentou sair sozinha. Isso passa a contar como incidente. Considerar tirar `allow-scripts` de artefato
  publicado em turno não confiável.
- Se o estado de algum artefato passar de 32 KB, metade do teto, ou se `ler_artefato` for cortado pelo
  proxy em mais de 1 de cada 10 leituras, rever os tetos antes de alguém depender deles.
- Se o nod ganhar deploy compartilhado com domínio próprio, mover o artefato para uma origem separada. O
  `srcdoc` fica como caminho do desktop.

## Não implementado

- **Artefato em sala.** Precisaria de perna de sala na RLS e decidir se o estado é por pessoa ou da sala.
- **Listar os artefatos do agente no prompt.** O id chega ao modelo pelo resultado da ferramenta e pelo
  texto da mensagem, que está no histórico. Numa rotina com mais de 20 falas desde a publicação, o bot
  precisa ter guardado o id com `lembrar`.
- **Conferência no app de verdade.** Os testes provam o HTML do card, o sandbox, a CSP e o filtro. Uma
  segunda página de teste, com o CSS do app e `criarArtefatosVivos`, mostrou num Chromium (2026-09-28):
  - o card com a v2 e a v1 recolhida;
  - a altura seguindo o conteúdo;
  - a timeline regravada com o MESMO iframe (`moveBefore`, sem novo `load`);
  - a v1 abrindo sob demanda;
  - a tela cheia abrindo e fechando;
  - um clique no iframe chegando ao `salvar`.

  Não foi visto com servidor, SSE e sessão reais, nem o "Baixar", nem o `will-frame-navigate` num
  Electron.
