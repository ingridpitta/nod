# ADR-150 — O app Canvas de protótipos: dados no nod, telas em sandbox e importação isolada

Status: aceita (2026-11-04, ADA-13) · Estende a [ADR-051](adr-051-artefato-do-nod.md) (o sandbox do HTML do bot) e a
[ADR-146](adr-146-paginas-do-bot-e-apps.md) (a página embutida `canvas` na pílula, fora do limite de 12).

## Contexto

O canvas de protótipos do Gil (nod-prototipos, `window.CANVAS` + `_nod/canvas/canvas.js`) mostra as jornadas em
fileiras, com endereço `#J1-2`, tamanho real e comentários num SQLite na VM do Gil (comentarios.nodbot.ai). A ADA-13
transforma isso num app instalável do nod: o bot cria e atualiza o canvas pelo chat e a pessoa comenta dentro do nod.

## Decisão

1. **App nativo, não conector.** "Canvas · Do nod" é um cartão próprio no marketplace. Instalar é por pessoa
   (`canvas_instalacoes`); o nível é por bot (`canvas_acessos`: `ver_comentar` | `criar_publicar`). Não reusa
   `concessoes`, que é de conector com catálogo, proxy e consentimento por app.
2. **Os dados ficam no Postgres do nod** (0151, tudo escopado por `nod_escopar_tabela`): `canvas` (único por pessoa, bot
   e issue), `canvas_versoes` (a estrutura completa em jsonb), `canvas_blobs` (HTML, CSS, JS e miniaturas por sha256,
   deduplicados entre versões, até 2 MB cada) e `canvas_comentarios`.
3. **O comentário é preso ao endereço da tela**, não à versão. Versão nova mantém os comentários; tela que sai fica
   arquivada (nunca apagada) e volta se a tela voltar. Versão antiga é só leitura. Autor: `pessoa`, `bot` ou `importado`
   (o que veio do SQLite antigo pelo bot nunca se passa por pessoa).
4. **Cada tela roda em `<iframe sandbox="allow-scripts" srcdoc>` com a CSP da ADR-051** (sem rede, sem mesma origem,
   sem navegar; fecha no 2º load). O HTML só sai do servidor como JSON. Na vista do canvas o iframe tem
   `pointer-events:none` (pan, zoom e pino ficam no DOM do nod); a tela só fica interativa no tamanho real. Uma ponte
   no srcdoc aplica o contorno dos seletores `novo[]` e repassa o Esc. No máximo 12 iframes vivos (LRU).
5. **Importar avalia o JS do protótipo fora do processo do servidor.** A URL tem de estar na allowlist
   `NOD_CANVAS_ORIGENS` (padrão `https://gamefik.github.io/nod-prototipos/`), sem redirect e com tetos de bytes. Os
   scripts antes do motor (`telas.js`, `canvas.js`) rodam num processo filho `node --permission` (sem fs além do próprio
   script, sem filhos, sem addons, env vazio), dentro de `vm` sem geração de código por string, com 128 MB, 3 s por
   script e 8 s no total (o pai mata o filho; é o que segura o que trava fora do `vm`, como o Proxy lançado que o
   próprio Node inspeciona antes do catch). O permission model **não fecha a rede**: o filho apaga `fetch`, `WebSocket`, `EventSource` e
   afins do global antes de tudo, e o `vm` não vê `process` nem `require` (risco aceito abaixo). A busca inteira tem
   prazo de 90 s, além dos 15 s por arquivo. A saída é só JSON, validada pelo mesmo schema de `publicar`. O CSS, as
   fontes e as miniaturas são embutidos como `data:`. O que veio da URL grava a versão como não confiável, mesmo num
   turno limpo: todo turno que a ler depois fica sujo (ADR-082).
   Ids das telas: como o motor do Gil (`Jx-y` explícito, `Jx-0` para `hoje`, colisão vira `Jx-(90 + telas antes)`),
   e o contador anda com todo `Jx-y` válido. Duas diferenças: id explícito com o prefixo de outra jornada vira o
   automático (no Gil ele passa como veio), e jornada com id repetido vira `J(posição)` (no Gil as duas ficam com o
   mesmo id e o `#Jx` não sabe qual abrir). Nos dois casos os comentários antigos presos a esse id ficam soltos.
6. **O servidor não chama comentarios.nodbot.ai.** Os comentários antigos chegam pelo bot (`comentarios[]` do
   `importar`), que os lê com a própria CLI. A API velha fica no ar, só leitura.
7. **Pelo chat**, a ferramenta `gerir_canvas` entra só no bot com acesso: `ver_comentar` lista, lê, comenta e resolve;
   `criar_publicar` também publica (até 200 KB por chamada) e importa. Publicar grava a mensagem `canvas` (só ids, como
   o artefato) com o card aprovado (J6-1). Roda também em turno com conteúdo de fora, guardando a confiança do turno.
   Entra nos modos do quadro (`conversa`, `criacao`, `rotina` e `delegacao`): a tarefa delegada ao Gil é o caminho
   principal do protótipo; fora deles (sala, frente, task), não.
8. **Ações**: `canvas.comentar` e `canvas.resolver_comentario` são `vivo` via `gerir_canvas`, `muda` com
   `cartaoNoChat: false` (a exceção está na ADR-135, com o gatilho de reversão): aplicam direto. O turno que leu conteúdo
   de fora comenta (fica não confiável) e resolve o que é de bot ou importado, nunca o comentário da pessoa. `canvas.instalar`,
   `canvas.desinstalar` e `canvas.dar_acesso` ficam `falta` (NOD-394, a onda dos `acessos.*`): um bot se dar acesso ao
   app é escalada de privilégio; a pessoa decide na tela.

## Alternativas descartadas

- **Servir o protótipo do github.io num iframe**: dependeria da rede de fora e do cache do Pages, e os comentários não
  teriam endereço estável no nod.
- **Avaliar o JS no processo do servidor com `vm`**: `vm` não é fronteira de segurança.
- **Origem separada para as telas**: dev e desktop não têm; a origem opaca do sandbox já isola sessão e cookies.

## Riscos aceitos e gatilhos

- O permission model do Node não é fronteira contra código malicioso; vale somado à allowlist (o repo do time), ao `vm`
  e aos tetos. **Gatilho**: abrir a allowlist para fora do time → mover a avaliação para um sandbox de SO (contêiner/gVisor).
- O processo filho do importar tem rede no SO (o Node não tem `--allow-net`, e `unshare -n` exige privilégio que a VM
  do nod não dá). A defesa é tirar as APIs de rede do global e o `vm` sem `process`/`require`; uma fuga do `vm` teria
  rede. **Gatilho**: o mesmo do item acima, ou o Node ganhar `--allow-net` → ligar a permissão.
- iframes srcdoc dividem processo com o nod quando o navegador não isola (Spectre). **Gatilho**: o mesmo da ADR-051
  (deploy com domínio próprio) → telas numa origem separada.
- O canvas aberto fica no parâmetro `?canvas=` da URL, com o `#Jx-y`: depois de recarregar, a página Canvas da conversa
  reabre esse canvas nesse endereço. Mas o reload não volta sozinho à página Canvas (a pílula não guarda a página), e um
  link colado em outra aba não abre a conversa do bot. **Gatilho**: pedido de link para mandar a alguém → rota própria,
  como o link da tarefa (NOD-416).
- Blobs órfãos não são coletados. **Gatilho**: `canvas_blobs` passar de 1 GB.

## Fora deste ADR (follow-ups)

Input e balão dentro do canvas, rodada "Enviar N", comparar versões, "Todos os canvas" com filtros, apresentar,
arrastar pino/post-it, compartilhar entre pessoas, formato antigo `_nod/jornada.js`, instalar pelo chat (NOD-394).
