# ADR-146 — As páginas do bot na pílula e os apps que a pessoa cria

Status: aceita (2026-11-02, NOD-445) · Estende [ADR-135](adr-135-registro-unico-de-acoes-e-paridade.md) (as ações
`paginas.*`) e a [ADR-141](adr-141-quadro-fluxo-continuo-meta-opcional.md) (o quadro vira a página Tarefas).

## Contexto

O par Conversa | Quadro da NOD-429 virou, no protótipo do Gil, uma pílula de páginas: a doca com mola, os pontinhos e
os ícones, com a Conversa, Tarefas e apps que a própria pessoa pede ao bot ("cria um app de vagas para a Nina"). O
Bloco 1 tinha apps de exemplo e a ordem guardada no navegador. A NOD-445 liga isso ao servidor.

## Decisão

1. **Um app é de um bot e de uma pessoa** (0145, `apps_do_bot`, escopada por `nod_escopar_tabela`). Guarda nome, ícone,
   fonte (`tarefas | conector | arquivo | bot`, com `fonte_ref`), forma (`lista | quadro | painel | doc`), quem vê (só
   `so_eu` no MVP; `todos` entra com a NOD-443) e a regra do "pede você". **O app só exibe**: o retrato (`dados`) é
   gravado pelo bot com os acessos dele; as ações saem pela conversa. Nome único por bot, sem acento e sem caixa
   (`nome_chave`, índice parcial nos não removidos).
2. **Limite de 12 páginas por bot além da Conversa, e Tarefas conta** (é um app que vem pronto). Tarefas aparece
   sozinha quando o bot tem quadro, e o quadro não passa pelo limite; por isso a vaga de Tarefas fica sempre reservada:
   **até 11 apps**, com quadro ou não (revisão 3 do #626). Assim o quadro criado depois nunca leva o bot a 13.
3. **A ordem é do servidor** (`paginas_do_bot`, por bot e pessoa), a mesma em todos os aparelhos. Qualquer página se
   move, a Conversa inclusive; a primeira é a tela inicial. A Conversa nunca sai. Ids da ordem: `conversa`, `tarefas`,
   `app:<uuid>`; o que falta na ordem guardada entra no fim, o que sobra é ignorado.
4. **Criar passa pelo card Criar / Ajustar** (`kind_proposta` e `tipo_decisao` ganham `app`): nada nasce até a pessoa
   confirmar. Ajustar é propor de novo o mesmo app: o card novo fecha só o pendente do mesmo bot com o mesmo nome (sem
   acento nem caixa); cards de outros apps na conversa seguem confirmáveis, e a ferramenta devolve os fechados. O Ajustar
   trava a proposta antiga antes da decisão, na mesma ordem do Criar (revisão 4 do #626: a ordem inversa dava 40P01 com o
   Criar do mesmo card); se o Criar já ganhou, o card não sai nem conta como substituído. Depois das travas o propor
   revalida o nome e o limite: se o Criar esperado fez o app, nada fecha e a ferramenta devolve `nome_em_uso` com a
   instrução de ajustar pelo `editar` (revisão 5 do #626). O card substituído fecha por regra (`regra:app_substituido`,
   `decidida_por` nulo, ADR-042), não como recusa da pessoa. Editar, ordenar, remover e restaurar aplicam direto.
   **Remover é suave** (`removido_em`): a tela mostra Desfazer (`restaurar`), e o dado de origem nunca é apagado. O botão
   Desfazer existe só na tela; **pelo chat, o Desfazer é a instrução de restaurar** que o `remover` devolve
   (`{op: "restaurar", app: <id>}`), e a pessoa também pode pedir pelo nome. **Retenção: só o último removido de cada
   nome** (revisão 5 do #626): ao remover, os removidos anteriores do bot com o mesmo nome (sem acento nem caixa) são
   apagados de vez; o restaurar pelo nome já só alcançava o mais recente. Removidos de nomes diferentes ficam.
5. **Ações no registro** (ADR-135): `paginas.criar_app` (decidir o card), `paginas.editar_app`, `paginas.ordenar`,
   `paginas.remover_app`, `paginas.restaurar_app`, com rotas `GET /agentes/:id/paginas`, `PUT …/paginas/ordem`,
   `DELETE …/apps/:app`, `POST …/apps/:app/restaurar`, e a ferramenta `gerir_apps` (listar, propor, editar, ordenar,
   remover, restaurar; restaurar aceita o id ou o nome, e pelo nome volta o removido mais recente). O prefixo é `paginas.*` porque `apps.*` já é dos conectores. O frame `paginas.mudaram`
   (outbox, só ids) faz a web reler.
6. **A web**: a doca desenha a ordem do servidor e mover é otimista (o PUT confirma; falhou, relê). Segurar o ícone (ou
   botão direito, Shift+F10) abre o menu: mover, editar pela conversa e remover (só app). "+ pedir um app" escreve a
   frase na caixa; no limite, uma linha explica. ⌘[ / ⌘] trocam de página no app do Mac (Ctrl+[ / Ctrl+] no navegador do Mac, Alt+[ / Alt+] fora do Mac: `MOD_DE` em
   `web/lib/atalhos.ts`). NOD-461: ⌥← / ⌥→ (Alt fora do Mac) trocam de página de qualquer lugar da conversa e
   ⌥⇧← / ⌥⇧→ levam a página atual uma posição (`setaDaPilula`); a doca espia 1,4 s. Ficam com o campo que já tem texto
   no Mac (onde andam por palavra; fora dele a tecla é engolida sem trocar, para não perder o texto nem voltar), com quem já tratou a tecla (o cabeçalho de coluna) e com um menu aberto; com a
   pílula de uma página a tecla é engolida, para não virar o voltar do navegador num bot e não no outro. Alt+Shift é a
   troca de layout do Windows só quando solto sozinho: com a seta, chega ao app. A página do app desenha
   pelo `AppDto.estado`, que o servidor calcula com `estadoDoApp`: vazio (uma frase e um exemplo; o app recém-criado, sem
   retrato, também), erro de fonte (uma linha e "Pedir acesso de novo", sem vermelho) e as quatro formas. O esqueleto
   (carregando) aparece só num app vazio enquanto o GET das páginas está no ar (revisão 4 do #626). Com mais de um app, o nome da página vai no topo.

## Consequências

- O `gerir_apps` só altera nos turnos de conversa (não em tarefa nem rotina): o mesmo corte de confiança do `gerir_quadro`.
  Remover, reordenar e mudar a regra do "pede você" ou a fonte (`regra_pede`, `pede_quando`, `fonte`, `fonte_ref`, ao
  propor ou editar) pedem, além disso, o turno limpo (ADR-047): um texto de fora não escolhe o que acende o laranja nem de
  onde o app lê. Num turno sujo seguem nome, ícone, forma, o retrato e o restaurar, **só nos apps do próprio bot**: os de
  outro bot da pessoa recusam editar e restaurar com a frase de que o turno leu conteúdo de fora (revisão 7 do #626). A
  linha de erro da fonte (`erro_fonte`) de turno sujo é descartada e a ferramenta avisa (revisão 5 do #626): um texto de
  fora não põe o app em erro.
- O retrato (`dados`, `erro_fonte`) só é gravado pelo próprio bot dono do app, mesmo na conversa: outro bot da pessoa
  muda só a configuração (nome, ícone, forma, fonte, regra), porque o retrato é o que o dono leu com os acessos dele.
- **O "pede você" é calculado no servidor pela regra estruturada** (revisão 7 do #626). Antes, o laranja era só a marca
  `pede` que o bot grava nos itens, e o retrato de turno contaminado perde essas marcas; como atualizar um app de conector
  ou arquivo é ler a fonte, e ler a fonte contamina o turno, o laranja desses apps nunca acendia (o exemplo da issue,
  "vaga sem resposta há 2 dias", caía aí). Agora o app guarda, ao lado da frase (`regra_pede`, para a pessoa ler), a
  regra que o servidor avalia (`pede_quando`, coluna jsonb da 0145): `{coluna?, dias_desde?, valor_acima?, valor_abaixo?}`,
  todas as condições dadas valendo juntas, sobre os campos do item (`coluna` sem acento nem caixa; `desde`, uma data ISO
  que o item ganhou, para "há mais de N dias"; o número do `valor`, com vírgula decimal). O `paraDto` aplica a regra com o
  relógio do servidor a cada leitura (o "há 2 dias" acende com o tempo, sem regravar o retrato) e devolve o `pede` de cada
  item já calculado; a marca do bot é ignorada quando há regra estruturada. Vale em qualquer turno sem abrir brecha: o
  conteúdo de fora só preenche os campos do retrato; quem decide o que acende é a regra, que só muda em turno limpo ou no
  card que a pessoa confirma. Limite aceito: o retrato continua sendo o que o bot leu, então um texto de fora que mente
  sobre a coluna ou a data de um item acende (ou apaga) aquele item, como já mostraria o item errado. Sem `pede_quando`
  (apps antigos, regras que não cabem nos quatro campos), vale o jeito antigo: a frase + a marca `pede` de turno limpo.
  Sem frase, a regra estruturada se descreve ("coluna Sem resposta e há mais de 2 dias").
- O "pede você" de Tarefas vem do quadro lido (`status = voce`).
- A página do app esconde o composer do quadro: pedir é pela conversa.
- O teto da ordem pedida (tela e `gerir_apps`) é `MAX_ORDEM_GUARDADA` (20, o CHECK da 0145), uma constante só em
  `src/contracts/apps.ts` (revisão 7 do #626: o schema dizia 20 e o caso aceitava 40).
- **Dívida: o GET das páginas traz todos os retratos inteiros** (revisão 4 do #626). `GET /agentes/:id/paginas` devolve
  cada `AppDto` com `dados`, e a web relê tudo a cada `paginas.mudaram` (um GET por bot de cada vez, ver
  `web/lib/paginas-do-servidor.ts`). O teto, calculado em 2026-11-02 com os limites do domínio (11 apps × 200 itens de
  título 200 + detalhe 300 + coluna 40 + valor 40, texto de 20 000, regra e erro de 300, fonte_ref de 500, tudo ASCII,
  `JSON.stringify` de um caso cheio): **≈150 KB por app, ≈1,65 MB por GET**; com letras de 3 bytes em UTF-8 chega perto
  de 5 MB. A resposta da API não é comprimida (o Caddy só aplica `encode` ao bundle). O resumo sem `dados` daria
  ≈1,7 KB para os 11 apps. Ficou como dívida, não como mudança neste PR, porque o resumo + retrato ao abrir exige uma
  rota nova por app, um cache de retratos na web com a releitura só do app à vista no frame, o estado de leitura por app
  na página (o esqueleto) e o `pedeVoce`/`estado` continuando no resumo: mexe em `paginas-do-servidor`,
  `ordem-das-paginas`, `quadro-na-tela` e no `main`, perto de tudo o que este PR já mudou na web. O caso comum (poucos
  apps, retratos de dezenas de itens) fica em dezenas de KB. Gatilho: um bot com retrato perto do teto, ou o GET das
  páginas aparecendo no tempo de render da troca de conversa → resumo no GET e `GET …/apps/:app` ao abrir a página.

- A retenção de um removido por nome deixa crescer os removidos de nomes diferentes (no máximo um por nome já usado).
  Gatilho: um bot com dezenas de removidos, ou a lista de removidos aparecendo no tempo do `gravar` da ordem → prazo
  para os removidos (a lixeira com prazo do gatilho abaixo).

- Emenda ADA-9 (definido em 2026-11-04): a "view padrão" do bot é a primeira página (a casa) e se muda pelo chat com
  `gerir_apps ordenar` (Tarefas na posição 1 = abrir no Quadro), sem card e sem ferramenta própria, como o resto da ordem
  (§4). O resultado traz `tela_inicial`. Pelo chat, pedir o quadro num bot sem quadro recusa com o caminho (`criar_quadro`,
  com `quadro` = o nome do outro bot); a ordem inteira da tela segue tolerante (§3). Gatilho: a pessoa mudando a casa
  sem querer pelo chat → o `ordenar` da posição 1 vira card.

## Emenda ADA-8 (2026-11-04): o mapa de gestos da pílula

O toque na pílula tinha dois donos (a busca no `main.ts` e as páginas no `paginas-na-tela.ts`): segurar abria a doca aos
380 ms e o menu da busca aos 500 ms, a diagonal trocava a página **e** abria a busca, e os dois escreviam o `transform`
da cápsula. Agora há um reconhecedor só (`web/lib/gesto-da-pilula-na-tela.ts`, regras puras em `gesto-da-pilula.ts`),
com a física da busca, que era a referência que funcionava (plano em `docs/plano-gestos-da-pilula.md`):

- o eixo trava a 10 px e só com dominância de 1,5×, e o fim confere de novo com o deslocamento inteiro: a diagonal (também
  a que começa reta e entorta) não faz nada, e a pílula volta ao lugar assim que o arrasto entorta. Um segundo dedo larga
  o gesto; um toque novo com o gesto antigo aberto (o fim perdido no nó que a regravação tirou) começa do zero;
- ↓ 36 px é só a busca (↑ 36 px no miolo dela fecha); ↔ 36 px é só a página, e a pílula segue o dedo pela metade, até
  30 px (a "esticada de líquido" da NOD-445 sai); na ponta, um tranco;
- segurar 450 ms abre **um menu só**: "Buscar na conversa" e as páginas, com a atual marcada; não abre mais a doca;
- no toque (`any-pointer: coarse`), os pontinhos recebem toque (alvo de 44×24 px, a partir da borda da cápsula) e abrem e
  fecham a doca: é a alternativa visível ao gesto. Ficam um `span` com `aria-hidden` (desvio do plano, que previa um
  botão): repetem as abas, e teclado e leitor de tela já abrem a doca pelo foco na tablist. No mouse não recebem o
  ponteiro (o hover já abre a doca);
- segurar o ícone da doca aberta (o menu do ícone) passa de 380 ms para os mesmos 450 ms do segurar da pílula;
- a cápsula é `touch-action: none` quando há toque (`any-pointer: coarse`) (nenhum gesto novo no corpo; a rolagem da ADA-7 não muda);
- na web, a roda só troca no eixo horizontal (o trackpad de lado); a roda vertical do mouse passava pelo topo e trocava
  sem querer. Hover, foco e teclado seguem iguais.

## Gatilho de reversão

- Uma pessoa perde um app sem querer → remover vira card ou ganha lixeira com prazo.
- Pedido de dividir um app entre pessoas do mesmo bot antes da NOD-443 → `quem_ve` ganha `todos` e a ordem deixa de ser
  por pessoa.
- ADA-8: queixa de que trocar de página ficou mais difícil no celular (o eixo travado perde arrastos tortos) → baixar a
  dominância para 1,2× antes de voltar a esticada; pedido da roda vertical no mouse → volta só com um modificador
  (Shift + roda).
