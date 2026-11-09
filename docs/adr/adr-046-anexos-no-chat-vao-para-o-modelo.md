# ADR-046 — Anexos no chat vão para o modelo

Status: aceito · Data: 2026-09-24 · Emenda ADR-012 (SPI do executor) e ADR-021 (rotas internas por token de turno).

## Contexto

A pessoa não tinha como mandar um arquivo na conversa: o composer era só texto. Os caminhos que já
existiam levam arquivo para outro lugar — o computador do bot (upload na tela Computador) e a pasta
autorizada da conversa (ADR de workspaces) — e nenhum deles faz o MODELO ver a imagem ou o PDF naquele
turno. Pedido do dia: "por hora apenas para o modelo".

Medido em 2026-09-24:
- `claude -p --input-format stream-json` com uma linha `{"type":"user","message":{"content":[texto, image, document]}}`
  leu um PNG e um PDF na mesma mensagem (US$ 0,016, haiku).
- Com todas as flags do turno do nod (`--include-partial-messages`, `--append-system-prompt`,
  `--session-id`, `--strict-mcp-config`, `--tools ""`) o turno com imagem respondeu certo, e o turno
  SEGUINTE, em texto puro com `--resume`, ainda lembrava da imagem (US$ 0,032 os dois).
- `codex exec --image` aceita só imagem, pela documentação; o Codex não estava instalado na máquina
  da medição. PDF no Codex não existe.

## Decisão

**O arquivo é da mensagem e vai para o modelo daquele turno.** Tabela `anexos` (0023, RLS por
`nod_escopar_tabela`, apagável por `nod_poda`): o upload (`POST conversas/:id/anexos`, corpo binário,
nome em `x-nod-nome`) cria o anexo SOLTO; o envio (`POST conversas/:id/mensagens` com `anexos: [ids]`)
o prende à mensagem na mesma tx da mensagem e do turno. Id de outra conversa, já enviado ou alheio
derruba a tx inteira. `turnos.entrada_anexos` guarda os ids.

**O plano leva metadados; os bytes descem pela rota interna.** `plano.entrada.anexos` tem id, nome,
tipo e tamanho — o proxy MCP também puxa o plano e não deve arrastar megabytes. O driver baixa em
`GET /api/interno/anexos/:id` com o token do turno; a rota só entrega id que está no plano daquele
turno (404 para qualquer outro, mesmo da mesma pessoa).

**A última milha é do driver, o resto é comum.** Claude: imagem e PDF viram blocos `image`/`document`
numa linha stream-json (`--input-format` só quando o help da versão instalada mostra a flag;
senão o turno segue com uma linha por anexo dizendo que não foi lido). Codex: imagem por `--image`,
texto de arquivo no prompt, PDF vira linha de "não lido". Texto (`.txt`, `.md`, `.csv`, `.json`) entra
como texto nos dois, cortado em 100 mil caracteres com marca. Falha ao baixar nunca some em silêncio
(ADR-029): o modelo recebe a linha e avisa a pessoa.

**Limites:** imagem (PNG, JPEG, GIF, WebP), PDF e texto; 10 MB por arquivo, 5 por mensagem. Conferidos
no navegador (espelho em `web/lib/anexos.ts`, testado contra `src/contracts/anexo.ts`), no caso de uso
e no CHECK da tabela. Agente com motor declarado `codex-cli` recebe recusa escrita para PDF no envio;
na tela, o clipe dele não oferece PDF.

**Só conversa própria.** Sala continua sem clipe: quem responde é decidido depois do envio, e o motor
de cada membro pode ser outro.

Servido de volta à tela com `x-content-type-options: nosniff` e `content-security-policy: sandbox`;
tipo de texto sempre como `text/plain`. O upload exige o cabeçalho próprio `x-nod-nome`, que força
preflight num POST de outra origem, além do cookie `SameSite=Strict`.

## Alternativas rejeitadas

- **Bytes dentro do plano (base64).** Um arquivo só, mas o plano é puxado pela ponte E pelo proxy MCP
  a cada turno, e fica em memória no token: 50 MB por turno em dois processos.
- **Salvar no disco da máquina e passar o caminho.** O servidor é a fonte da verdade da conversa; a
  máquina que roda o turno pode ser outra e o arquivo sumiria com o diretório temporário.
- **Mandar pelo computador do bot ou pela pasta autorizada.** Resolve outro problema: o modelo não vê
  o arquivo como conteúdo da mensagem, teria de abrir com ferramenta, e sem computador ou pasta não há
  caminho nenhum.

## Gatilho de reversão

Se o Codex, quando homologado, não aceitar `--image` como a documentação diz, o clipe do agente
Codex passa a oferecer só texto até a homologação — o resto da decisão fica. Se o banco crescer demais
com anexos (medir `pg_total_relation_size('anexos')`), mover `conteudo` para armazenamento de objetos
mantendo a mesma tabela de metadados e a mesma rota interna.

## Emenda (2026-10-22, ADR-120 · NOD-327)

Na conversa, o anexo que não é imagem — da pessoa ou do bot — deixa de ser chip que abre aba nova e vira o card de
arquivo da ADR-120: ícone da família, nome e Baixar. CSV e PDF abrem prévia num modal, lida da mesma rota de anexos
(sem mudar os cabeçalhos dela); `.txt`, `.md` e `.json` ficam como card só com Baixar. O que vai para o modelo não muda.
