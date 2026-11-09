# ADR-126 — Mídia gerada pelo bot aparece no chat

Status: aceita · Data: 2026-10-23 · Estende ADR-046 e ADR-120; usa a cerca da ADR-055 e o assentar da ADR-087. NOD-323, PR #507.
(O plano chamava de ADR-121; o número já era do caminho B da VM, e 122, 124 e 125 estão em PRs abertos.)

## Contexto

O bot gera imagem, GIF, vídeo e áudio na pasta dele (`~/nod/<bot>`), mas o chat só mostrava o caminho do Mac
ou um `![](arquivo.png)` quebrado. O protótipo v3.1 da NOD-323 (J1–J6) pede a mídia abaixo do balão, em tela cheia
com navegação, um player mínimo, cartões para o que não cabe e um caminho para o arquivo grande que ficou no Mac.

## Decisão

1. **Quem lê o arquivo é a máquina, não o servidor.** A ferramenta `anexar_midia` (origem proxy, só no turno com
   pasta do bot) e a rede de segurança do fim do turno (J6, que acha `![]()`/`[]()` locais na fala) usam o mesmo
   módulo (`src/adapters/executor/midia-local.ts`): realpath contido em `~/nod/<1º segmento da pasta>`, cerca de
   credencial (`caminhoRecusado`), `O_NOFOLLOW` + `fstat` (só arquivo regular), tipo por magic bytes
   (`src/domain/midia.ts`), dimensões e duração do cabeçalho. Sobe por `POST /api/interno/midias` com o token do turno.
2. **O servidor revalida tudo** (magic bytes, mime na lista, limite por família, nome, caminho relativo sem `..`) e
   grava em `anexos` com `origem='bot'`, solto no turno, idempotente por sha256; o assentar prende à fala final.
   Migração `0110_midia_do_bot.sql`, aditiva, com ROLLBACK. SVG e HTML ficam de fora.
3. **Limites por família:** imagem 20 MiB, vídeo 50 MiB, áudio 25 MiB, arquivo 20 MiB; teto de mídias por turno.
   Acima do limite, só os metadados sobem (`sem_bytes`): a web mostra o cartão "grande demais", e nada é servido.
4. **Leitura com Range** (206/416, `substring` do bytea, sem arrastar 50 MB) e `?baixar=1` para attachment, com a
   CSP sandbox e o nosniff de sempre.
5. **Web:** a mídia do bot vai abaixo do balão (a da pessoa continua acima). Imagem única na proporção real, grade
   2/3, linha mista de 180 px, +N; GIF com Pausar e 1º quadro em canvas (movimento reduzido abre parado); vídeo com
   capa; memo de áudio com velocidade em ciclo (sem onda: fica para a NOD-329); um tocando por vez; falha com Tentar
   de novo; tela cheia em `<dialog>`; "Baixar tudo" no ⋯ (um download a cada 400 ms); `[texto](nod-anexo:<uuid>)`
   no texto vira botão que abre a mídia daquela mensagem.
6. **Mostrar no Finder (J5):** a API `GET …/anexos/:id/local` devolve só `{caminhoRelativo, maquinaId}` da mídia do
   bot da própria pessoa naquela conversa. A web só oferece o botão no app do Mac da mesma máquina. O caminho que a
   página manda ao app é dado de fora: o processo principal confere de novo (`desktop/midia-mac.ts`: sem `..`,
   absoluto, `~`, NUL ou `\`, realpath dentro de `~/nod/<pasta>`, nunca credencial, só arquivo regular) e valida o
   remetente do IPC antes de `shell.showItemInFolder`. O app anterior não tem a ponte (`midia?` opcional).

## Consequências

- Bytes de mídia no Postgres (até 50 MiB por linha, STORAGE EXTERNAL). A mídia solta há mais de um dia é varrida.
- O Finder não foi provado num Mac real nesta máquina (só os testes do validador e o smoke da ponte).
- A cerca é a da ADR-055 (chaves e credenciais conhecidas) mais pasta ou arquivo oculto e nome com cara de env (`.git/`, `.env.png`, `png.env`), recusados no proxy e no servidor (`segmentoOculto`). A recusa aparece como "credencial".
- Tipo pelos bytes: no `ftyp`, só as marcas de MP4/QuickTime/M4A conhecidas (isom, iso2/4/5/6, mp41, mp42, avc1, M4V, dash, 3gp4-6, qt); HEIC, AVIF e outras ficam de fora. ID3 só com cabeçalho ID3v2 válido.
- Vagas do servidor: upload de mídia 2 por processo e 1 por turno; quem chega com as vagas cheias espera até 20 s antes do 503; o corpo tem ociosidade de 30 s e prazo total de 60 s + 128 KiB/s. Leitura inteira de anexo 4 por processo e 2 por pessoa; faixa (Range, até 2 MiB) 16 e 6. A resposta vai em pedaços de 256 KiB e a que fica 120 s sem um drain (o cliente que não lê) é derrubada. O progresso é o drain de cada pedaço: com uma escrita só, nenhum contador do socket anda. O drain só volta quando o kernel libera 1/3 do buffer de envio, que cresce até o teto do `tcp_wmem` (4 MiB no padrão; depende do sysctl do host): ~1,33 MiB por janela. Com 120 s segue quem anda a partir de ~11 KiB/s (folga de 2x sobre o piso de ~25 KiB/s), e quem não lê segura a vaga por até 120 s. Custo aceito: quem lê devagar de propósito segura a vaga enquanto anda (50 MiB a 25 KiB/s ≈ 34 min); com 4 vagas e 2 por pessoa, duas pessoas logadas tomam as leituras inteiras (as faixas, 16 vagas, seguem). Gatilho de reversão: leitura inteira em fila no log ou queixa de anexo que não abre. Atrás de um proxy que esvazia o socket rápido, essa proteção vale entre o processo e o proxy, para o buffer não ficar preso; a que anda, por lenta que seja, segue. Troca: a memória fica limitada a vagas × tamanho e a disponibilidade, a 120 s por vaga tomada por quem não lê.
- O proxy tenta o envio até 4 vezes: no 503 espera o retry-after; na falha de rede, 1 s, 2 s e 4 s com jitter; e não tenta de novo depois de 120 s do começo. Uma tentativa em curso pode passar desse prazo (o cliente corta cada uma em 120 s).

## Gatilho de reversão

Se o Postgres sofrer com mídia (p95 de leitura de anexo > 1 s ou a tabela `anexos` > 20 GB), mover os bytes para
storage de objetos com URL assinada, mantendo a mesma API.
