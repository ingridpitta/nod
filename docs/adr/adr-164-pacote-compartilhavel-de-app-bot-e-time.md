# ADR-164 — O pacote compartilhável de app, bot e time (`nod-pacote.json`)

Status: aceita (2026-11-11, ADA-283, épico ADA-281) · Estende a [ADR-150](adr-150-app-canvas-de-prototipos.md) (o Canvas
vira o primeiro pacote), a [ADR-051](adr-051-artefato-do-nod.md) (o sandbox das telas) e a
[ADR-160](adr-160-open-core-por-exportacao-e-historico-zerado.md) (cobrança em `fechado/`).

## Contexto

Para terceiros publicarem bots e apps, o nod precisa de um formato estável. Até aqui o que existe é interno: o Canvas
fixo no código (`SLUG_CANVAS`, ADR-150), os apps que o bot monta (ADR-146) e os pedidos de compartilhar bot (ADA-86) e
time (ADA-176). Esta ADR fixa o formato e as regras de segurança; o importador e a loja vêm depois.

## Decisão

1. **Um arquivo só, `nod-pacote.json`, para os três tipos** (`app`, `bot`, `time`), com `formato: 1`. É JSON
   declarativo: **o pacote nunca traz código que rode no servidor**. Contrato em `src/contracts/pacote.ts`, validador
   puro em `src/domain/pacote.ts` (`lerPacote` devolve todos os problemas de uma vez).
2. **Manifesto**: `slug` (`autor/nome`, minúsculas, dígitos e hífen), `nome`, `descricao`, `autor` {nome, url https?},
   `versao` (semver), `nodMinimo` (semver), `preco` {`gratis` | `unico` {centavos, moeda} | `assinatura` {centavos,
   moeda, periodo}}, `permissoes[]` {id, motivo, implica?}, `apps_conectados[]` {slug, nivel ler|escrever, motivo,
   opcional?} e `ferramentas[]`. App de terceiro traz `telas[]` {id, titulo, html}; bot traz `bot` {nome, titulo,
   descricao, instrucoes, rotinas[]}; time traz `time` {bots[], secoes[]}.
3. **Fechado por padrão**: campo desconhecido em qualquer nível é rejeitado (abrir o formato depois é fácil, fechar não).
   Campo com nome de segredo (`token`, `senha`, `api_key`, `secret`…) é rejeitado com motivo próprio: o pacote nunca
   leva credencial, a pessoa conecta o app na conta dela. Memória, conversas, segredos, máquina e contas de IA nunca
   viajam num bot ou time.
4. **Permissões num vocabulário fechado**: as da plataforma (`conversa.ler|escrever`, `quadro.ler|escrever`,
   `arquivos.ler`), as do próprio app no namespace do slug (`<nome>.<acao>`, ex.: `canvas.ver_comentar`; outro app não
   pede `canvas.*`) e os apps conectados, que viram `conector:<slug>:<nivel>` (`escrever` cobre `ler`). `implica` só
   aponta para outra permissão do próprio app pedida no mesmo pacote. **Instalar não concede nada**: a pessoa dá cada
   permissão por bot, na tela; um bot não se dá acesso (a regra da ADR-150 §8 vale para todo pacote).
5. **Sandbox do app de terceiro**: as telas rodam como as do Canvas, em `<iframe sandbox="allow-scripts" srcdoc>` com a
   CSP sem rede da ADR-051, sem mesma origem, até 2 MB por tela e 8 MB por pacote. Os dados entram só pela ponte do nod,
   no escopo das permissões dadas àquele bot. **Terceiro não traz ferramenta do chat** (é código do servidor); só o
   pacote `nativo`, que descreve código que já mora no nod, lista ferramentas. `nativo` e o autor `nod` são reservados;
   como o arquivo não tem assinatura, `nativo` só vale para um slug que o código do nod conhece (`FERRAMENTAS_NATIVAS`) e
   só com as ferramentas e as permissões que o código diz (`PERMISSOES_NATIVAS`, que inclui os apps conectados: um
   `nod/canvas` forjado não pede `quadro.escrever` nem `conector:gmail:escrever`). Terceiro não usa como nome de app um namespace da plataforma nem o nome de um
   nativo (`NOMES_RESERVADOS`: `maria/quadro` não pede `quadro.apagar`, `maria/canvas` não pede `canvas.*`) nem se
   apresenta com `autor.nome` "nod" (comparado em NFKC: `ｎｏｄ` também é "nod"). Texto com caractere bidi ou invisível
   (U+202E, U+200B, U+2066…) é rejeitado (Trojan Source: inverteria nome ou esconderia instrução), e `autor.url` não
   leva usuário e senha. JSON com mais de 16 níveis é rejeitado antes de qualquer recursão, e o tamanho é
   medido sem montar o texto inteiro; o leitor devolve no máximo 100 problemas (`MAX_PROBLEMAS`).
6. **Preço é dado, não cobrança**: o núcleo valida e mostra; cobrar fica em `fechado/` (ADR-160).
7. **Versões e quem já instalou** (`decidirAtualizacao`): integridade por sha256 do JSON canônico (chaves em ordem).
   Entra sozinha a versão maior que não pede nada a mais. Pede o consentimento de novo a que pede permissão nova
   (inclusive trocar `ler` por `escrever` ou um app conectado novo), fica mais cara, passa a ser paga ou é major; até a
   pessoa aceitar, a instalada continua valendo. Ficam bloqueados o downgrade, o slug ou o tipo diferente, a mesma versão com
   conteúdo diferente e o pacote cujo `nodMinimo` este nod não alcança.
8. **A prova**: `pacotes/canvas/nod-pacote.json` empacota o Canvas (`nod/canvas`, nativo, níveis como permissões,
   `gerir_canvas`). `tests/unit/domain/pacote-canvas.test.ts` é o contrato com o runtime: níveis, ferramentas, slug,
   nome e descrição do cartão têm de bater, com um mutante que prova que divergir quebra.
9. **Ações: nenhuma ação nova.** Instalar, desinstalar e dar acesso seguem `falta` no chat (NOD-394).

## Alternativas descartadas

- **Zip com código JS de servidor (plugin)**: precisaria de um sandbox de SO por app; o `vm` e o permission model não
  são fronteira (ADR-150).
- **Reaproveitar `concessoes` dos conectores para as permissões**: conector tem catálogo, proxy e consentimento do
  fornecedor; app do nod é outra coisa.
- **Aceitar campo desconhecido (tolerante)**: um pacote feito para um nod futuro instalaria pela metade, calado.

## Riscos aceitos e gatilhos

- **Sem assinatura do autor**: o hash garante integridade, não origem. **Gatilho**: o primeiro pacote de terceiro na
  loja → assinatura (ed25519) por autor verificado e revisão antes de publicar.
- **A versão instalada ainda não é gravada** (o Canvas é o único pacote e tem uma versão). **Gatilho**: o importador
  (ADA-175/176) ou a segunda versão de um pacote → coluna `pacote_versao`/`pacote_hash` na instalação.
- **Telas na mesma origem de processo** (Spectre), como na ADR-051. **Gatilho**: o mesmo dela → origem separada.
- **O formato 1 pode faltar campo** (ícone, capturas, idiomas). **Gatilho**: o pedido real → campo opcional novo no
  formato 1; mudar o sentido de um campo existente → `formato: 2`.
