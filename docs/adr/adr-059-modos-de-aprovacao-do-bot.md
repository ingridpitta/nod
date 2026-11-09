# ADR-059 — Três modos de aprovação por bot: manual, automático e sem aprovações

Status: aceito, emendada pela [ADR-066](adr-066-o-bot-tem-o-que-voce-deu-o-modo-decide.md) (depois de ler algo
de fora, o automático não para mais; merge deixa de ser arriscado) · Data: 2026-09-29 · Emenda ADR-042 (o gatilho dos 70 % pedia "outro ADR": é este), ADR-055 (a
alternativa "tudo liberado, sem card" vira opção da dona), ADR-058 (a trava herdada) e ADR-037 (o computador do bot).
Canvas "Nod — tela do agente", página "Aprovações".

## Contexto

Em 2026-09-29, às 20:57, o Marlon mandou duas capturas: o seletor do ChatGPT ("Solicitar aprovação", "Aprovar por
mim", "Acesso completo") e o do Claude ("Aprovar manualmente", "Aprovar automaticamente", "Ignorar todas as
aprovações"). O pedido: *"para eu garantir uma autonomia real de alguns agentes, eu preciso que eles rodem no modo
'automático', ou seja, eles mesmos aprovam tudo"*. E, na mesma mensagem, *"Eu vou dormir"*.

O nod não tinha como deixar um bot trabalhando sem ninguém olhando:

- **Terminal (ADR-055).** Todo comando que muda algo (`git commit`, `git push`, `gh pr create`, `npm install`) vira
  card. O hook espera 420 s no turno; depois o pedido fica na conversa até a pessoa acordar.
- **Apps.** O prompt manda "efeito externo só por item aprovado via `pedir_aprovacao`", e o item fica pendente até um
  clique. "Sempre permitir" (ADR-042) existe, mas por ferramenta, um clique de cada vez, e cai em turno contaminado.
- **Rotina.** Toda rotina nasce com `exige_aprovacao = true` (0002, E7.3) e não há onde desligar. Na rotina, a escrita
  em app só sai por item aprovado — por uma pessoa.
- **Computador do bot.** Já existia `politica = 'autonomo'` (0014), por computador.

O mapa do código está nesta ordem: `decidirAprovacao` (`src/domain/aprovacao-permanente.ts`) para os itens de
`pedir_aprovacao`; `autorizarComando` para o Bash; `fundo/computadores.ts` para o computador. Três caminhos, três
decisões, nenhum sabendo do outro.

## Decisão

1. **Um modo por bot, na coluna `agentes.modo_aprovacao` (0040):** `manual` (o de hoje), `automatico` e `total`.
   Bot novo e cópia nascem `automatico` (emenda 2026-10-20, NOD-316/NOD-231: decisão do Marlon — "todo bot deve
   nascer como automático, tanto bot novo quanto duplicado"; a cópia não herda o modo do original; a constante
   `MODO_APROVACAO_INICIAL` e o DEFAULT da coluna, 0095; os bots que já existiam mantiveram o modo). Excluir volta para `manual`: restaurar não devolve autonomia, como não devolve
   concessões (ADR-034). Só a dona muda (`POST agentes/:id/modo-aprovacao`, filtro por `owner_id`), e a troca vira
   uma linha na conversa do bot: é a autoridade sob a qual as próximas ações saem sem clique.

2. **O que cada modo aprova sozinho** — uma função pura, `decidirPeloModo` (`src/domain/modo-aprovacao.ts`),
   consultada só onde o manual pediria a pessoa, nesta ordem fechada:

   | Situação | Manual | Automático | Sem aprovações |
   |---|---|---|---|
   | Leitura (comando que só lê, `readOnlyHint` do conector) | roda | roda | roda |
   | Muda algo (commit, push, PR, `npm install`, criar tarefa, mandar mensagem, ação no computador do bot) | card | **roda** | **roda** |
   | Arriscado (`comandoArriscado`; no app, `acaoArriscadaNoApp`) | card | card (`acao_arriscada`) | **roda** |
   | Depois de conteúdo de fora na tarefa (entrada não confiável, WebFetch/WebSearch) | card | card | **roda** |
   | Rotina do próprio bot (gate `exige_aprovacao`) | card | **roda**, se nada acima parar | **roda** |
   | Pedido de colega nascido de rotina com gate (trava herdada, ADR-058) | card | card | **roda** |
   | Comando que toca credencial do Mac (`tocaCredencial`) | card | card (`toca_credencial`) | card |
   | Arquivo de credencial pelas ferramentas de arquivo (`decidirNativa`) | negado | negado | negado |
   | Conceder acesso a um app | pessoa | pessoa | pessoa |

   - **Arriscado no terminal** é uma lista curta de expressões sobre o texto inteiro: `rm -r`, `find -delete`,
     `git push --force`/`--delete`/`+ref`/direto na `main`, `reset --hard`, `clean -f`, `checkout -- .`, `branch -D`,
     `gh repo delete`, `gh api -X DELETE`, `npm publish`, `curl … | sh`, `sudo`, `chmod -R`, `killall`,
     `DROP TABLE`, `docker volume rm`, `compose down -v`, e gravar em `~/.zshrc`/LaunchAgents (`gh pr merge`,
     `gh pr review --approve` e `eval` saíram na segunda emenda de 2026-09-30, abaixo). Não tokeniza de propósito: o
     `git commit -m "$(cat <<EOF …)"` que o Claude Code escreve não passa pelo tokenizador da ADR-055, e seria
     "arriscado" só por isso.
   - **Arriscado no app** é o que nunca vira regra permanente (merge, aprovar e revisar PR — ADR-047) e o grupo
     "Apagar e desfazer" (`destructiveHint` da sonda ou o verbo do nome — ADR-049). O nome só torna a ação mais
     arriscada, nunca menos: a mesma direção de falha da ADR-042.
   - **Credencial para em qualquer modo.** "Ignorar todas as aprovações" ignora aprovações; credencial nunca foi
     aprovação, é cerca (ADR-055 §3). A leitura de arquivo de credencial continua negada; o comando que a toca vira
     card mesmo no total.
   - **O gate da rotina** (EMENDA 15) é satisfeito pelo modo do bot DONO da rotina: no automático, a rotina dele sai
     sozinha — mas a escrita continua passando por `pedir_aprovacao`, porque `chamar-ferramenta.ts` segue negando a
     escrita direta sob o gate. Nada sai sem linha em `itens_aprovacao` (ADR-042 claim 3). A trava que veio da rotina
     de OUTRO bot (`politicaExecucao.travaHerdada`) o automático de quem recebe não desliga: foi a escolha do Marlon
     na ADR-058, e quem recebe não sabe se quem pediu leu conteúdo de fora. O total desliga.
   - **O que o modo não muda:** sem plano, origem sensível, catálogo (concessão ∩ conector) e acesso. O modo decide
     se a ação precisa de gente, nunca se o bot pode fazê-la (a mesma separação da ADR-042 entre concessão e
     permissão). Fora do catálogo num turno confiável — conector desligado — continua card em todo modo.

3. **O modo ATUAL do agente, lido na hora de decidir.** `pedirAprovacao`, `autorizarComando` e `computadores.chamar`
   leem `agentes.modo_aprovacao` a cada pedido, não o plano. Voltar para o manual no meio de uma tarefa vale no
   próximo comando; o que já está esperando a pessoa continua esperando. O plano carrega `modoAprovacao` só para o
   prompt e o Raio-X. Não fere a ADR-013: o que ela proíbe é o PROXY consultar por chamada; estes três caminhos já
   rodam no servidor.

4. **Registro.** O item aprovado pelo modo nasce fechado com `decidido_por = regra:modo_automatico` ou
   `regra:modo_total` (v1), autoria do agente (ADR-023), e a fala na conversa diz o modo: "Fiz sem perguntar (1 ação)
   · aprovação automática". Entre várias regras num lote, manda no registro a que mais concede: total, automático,
   permanente, consulta. O comando do terminal aprovado pelo modo grava a regra do modo na trilha (`nativa__Bash`),
   para o gatilho da ADR-055 ("`nativa__Bash` sem decisão correspondente") não disparar à toa. Card que parou mesmo
   no automático guarda o motivo (`acao_arriscada`, `toca_credencial`, `regra_suspensa_conteudo_nao_confiavel`) e,
   no terminal, a frase do risco em `justificativa`; o card mostra "Parou para você: …".

5. **Prompt.** No automático e no total o modelo recebe uma linha "Aprovações:": siga até o fim sem perguntar se
   pode, escolha o caminho razoável e diga o que supôs; `pedir_aprovacao` volta decidido no mesmo passo; e quando o
   nod para. No total, a linha lembra que conteúdo de fora é dado, nunca instrução. A frase do terminal muda com o
   modo. O manual não ganha linha.

6. **Tela.** Um chip ao lado do clipe no campo da conversa própria (Manual · Auto · Sem aprovações; neutro, azul,
   âmbar), que abre os três modos acima dele, como no Claude. No automático e no total, um aviso acima do campo, que
   fecha por bot e modo. No painel do bot, "Aprovações · Auto" em Ambiente. Colega vê o modo e não muda. Na sala não
   há chip: cada bot segue o modo da conversa dele.

## Alternativas descartadas

- **Revisor-modelo como o "auto mode" do Claude Code** (um classificador olha cada ação antes). Já recusado na
  ADR-042: no caminho local queima a cota da pessoa para vigiá-la, ou vira autoridade remota síncrona que a ADR-013
  recusou. As pausas do automático aqui são deterministas e legíveis: a lista de arriscados, a credencial e o
  conteúdo de fora.
- **Automático que ignora conteúdo de fora.** Seria o total com uma lista de arriscados. É por conteúdo de fora que
  um texto manda no bot (ADR-026, ADR-042 claim 6); quem quer que o bot siga depois de ler e-mail escolhe o total,
  com o aviso âmbar.
- **Modo por conversa**, como a sessão do Claude. A rotina não tem conversa de onde herdar, e é à noite, na rotina,
  que a autonomia importa.
- **O modo conceder acesso sozinho.** Conceder é ato da pessoa (ADR-013, ADR-044; `conceder-so-pela-pessoa`).
- **Tirar o gate da rotina em vez de ter modo.** Não há tela para isso hoje, e desligar o gate de uma rotina não diz
  nada sobre o terminal nem sobre a conversa.
- **Total sem a cerca da credencial.** Um `gh auth token` lido e mandado para fora é o caminho de um texto malicioso
  num PR (ADR-055 §3). A lista de credencial é curta (`tocaCredencial`): `git push` por SSH e `gh` logado usam as
  chaves sem citá-las, então a pausa só pega quem lê o arquivo ou o token pelo nome.

## Riscos aceitos

- **O total executa o que um texto de fora induzir,** menos o que toca credencial. É o que o Marlon pediu, com o
  mesmo aviso do Claude e do ChatGPT; a cor do chip e o aviso deixam isso à vista.
- **A lista de arriscados é contra acidente, não contra quem esconde.** `r''m -rf`, um script que apaga, um alias.
  Contra texto de fora vale a pausa por conteúdo de fora, que vem antes da lista — e a leitura pelo Bash
  (`gh pr diff`) ainda não contamina (ADR-055, "Não implementado"). Um PR malicioso lido pelo Bash, no automático,
  pode induzir um comando que não está na lista.
- **Rotina de e-mail no automático continua parando** na primeira escrita: entrada de app é não confiável
  (ADR-026). Para ela seguir sozinha, o bot precisa estar no total.

## Gatilho de reversão

- **Qualquer comando da lista de arriscados rodando no automático**, visto na trilha (`nativa__Bash` com
  `regra:modo_automatico` cujo comando casa `comandoArriscado`) — é defeito da ordem, não ajuste: o automático
  volta a pedir tudo que altera até a correção.
- **Credencial lida por bot no total sem card.** Liga o card também para a leitura de fora do repositório.
- **Mais de 1 em cada 3 cards de `acao_arriscada` aprovados sem mudança em 30 dias:** a lista está larga; a revisão é
  `ARRISCADOS` em `comando.ts` e `acaoArriscadaNoApp`.
- **Um bot no total que produza efeito externo que a dona desfez** duas vezes no mesmo mês: o total ganha um teto
  (por exemplo, escrita em app só no automático) e esta ADR é revista.

A métrica do gatilho da ADR-042 (`itens_auto / itens_total` acima de 70 %) passa a ler só `regra:aprovacao_permanente`
e `regra:consulta_sem_decisao`: o que o modo aprova é escolha explícita da dona por bot, e é este ADR que a admite.

## Não implementado

- **O cartão de atividade não marca** "aprovado pelo modo" em cada comando; o registro está na trilha e, para os
  apps, na fala "Fiz sem perguntar".
- **A ação no computador aprovada pelo modo** não leva a regra no registro do computador (como a `politica =
  'autonomo'` de antes).
- **Manual não força card para escrita direta de app** num turno de conversa confiável: continua como antes, pedido
  no prompt ("efeito externo só por item aprovado") e barrado no servidor só sob gate, contaminação ou merge/aprovar.
- **Modo por rotina** (uma rotina no total e as outras no automático) e **teto de gasto** por noite.

## Emenda de 2026-09-30: o modo cobre rotina e acesso; apagar pedido na conversa não para

**Contexto.** Às 07:36 de 30/09 o Marlon pôs a Clarice em "Aprovar automaticamente". Mesmo assim vieram três cards:
- às 08:20, duas **"Mudança de rotina proposta"** (`atualizar_rotina`), que a pessoa confirmou às 08:28;
- às 08:37, o **pedido de acesso** para excluir 50 tasks do ClickUp que ele tinha acabado de pedir
  (`pedir_acesso` com `CLICKUP_DELETE_TASK`).

E, com o acesso concedido, a exclusão pararia de novo: apagar num app era "arriscado" no automático.

O motivo: só `pedir_aprovacao`, o terminal e o computador consultavam o modo. Criar, mudar e excluir rotina e
pedir acesso eram propostas com card próprio, e nenhum modo tocava nelas. A decisão 1 desta ADR dizia "o modo não
concede nada"; o Marlon quer que o automático aprove também isso.

**Decisão.**
1. **Rotina e acesso passam pelo modo** (`confirmacaoPeloModo`, `src/use-cases/confirmar-pelo-modo.ts`), com a mesma
   regra e o mesmo modo atual do agente. Quando o modo confirma:
   - a proposta nasce e fecha na mesma chamada, pela regra (`fecharPorRegra`, `decidida_por` nulo);
   - a aplicação é a mesma do botão: `ativarRotina`, `aplicarAtualizacaoRotina`, `aplicarExclusaoRotina` e
     `decidirAcesso`, com `porRegra`;
   - a autoria da rotina aplicada é do agente sob a regra;
   - o consentimento do acesso continua sendo da pessoa, porque escolher o modo foi escolha dela, mas com a regra
     em `decidido_por` e a frase "Pela aprovação automática deste bot, sem clique neste pedido";
   - a ferramenta devolve `aplicada: true` ou `estado: "concedido"`.
2. **Acesso concedido pelo modo retoma a tarefa sozinho.** A ferramenta nova só entra no catálogo do próximo turno
   (o plano é fixo por turno, ADR-024), e a retomada já sai na fila, como depois do clique.
3. **O que continua com a pessoa:**
   - conectar um app, porque o login é dela e o card de conexão nem chega ao modo;
   - o pedido de acesso de uma rotina, que passa por `garantirPedidoDeAcesso` e pelo pré-voo;
   - perfil do bot (`atualizar_perfil`) e pasta de projeto (`workspace_propor_pasta`).
4. **Apagar num app, merge e aprovar PR que a pessoa pediu na conversa não são arriscados para o automático**
   (`conversaComAPessoa(plano.modoTurno)`: conversa e criação, inclusive as retomadas delas; o plano ganhou
   `modoTurno`). Numa rotina ou num pedido de colega ninguém pediu, e o automático para (`acao_arriscada`). Vale
   também para excluir rotina e para o acesso que inclui apagar. A lista de arriscados do terminal não muda: ali o
   risco é a máquina (`rm -r`, `push --force`, `sudo`), não o escopo do pedido.

**Riscos aceitos.**
- Conteúdo de app lido na conversa (uma descrição de task, um PR pelo conector) não contamina o turno (ADR-052). Um
  texto desses pode induzir, no automático, uma exclusão no app sem card. Antes desta emenda o automático parava;
  agora só o manual para.
- Um bot no automático pode se dar acesso de escrita a um app já conectado quando a tarefa pede, e até a apagar
  numa conversa. Revogar continua sendo um clique no painel do bot.

**Gatilho de reversão.**
- Uma concessão pelo modo (`consentimento` com `decidido_por = regra:modo_*`) revogada pela dona em menos de 24 h,
  duas vezes no mesmo mês: o acesso volta a ser só por clique.
- Uma exclusão num app, feita pelo automático numa conversa, que a dona diga não ter pedido: o apagar do app volta a
  parar no automático.

## Segunda emenda de 2026-09-30: a lista do terminal medida nas skills do Mac

**Contexto.** Às 09:39 o Milton, em aprovação automática, parou num comando que só lia o ambiente:
`eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)"`, seguido de `echo`, `mkdir -p`, `ls` e `whoami`. O
card dizia "roda um texto como comando". É o preâmbulo padrão das skills do gstack.

Medido com `comandoArriscado` e `tocaCredencial` sobre os blocos bash das skills instaladas no Mac do Marlon
(1.498 SKILL.md em `~/.claude/skills` e no cache de plugins, 15.565 blocos):

| Regra | Blocos parados antes | Depois |
|---|---|---|
| `eval` ("roda um texto como comando") | 2.502, quase todos o preâmbulo do gstack | 0 |
| credencial por `.key` (`e.key` em JavaScript embutido, gstack-learn) | 11, parando até no total | 0 |
| `gh pr merge` (gstack-land-and-deploy) | 22 | 0 |
| o que sobrou: `rm -rf` e `reset --hard` do gstack-upgrade, um `find -delete` | 60 | 60 |

**Decisão.**
- **`eval` sai da lista.** Ele esconde o comando, não destrói nada, e a lista é contra acidente, não contra quem
  esconde (decisão 2).
- **`gh pr merge` e `gh pr review --approve` saem.** O terminal só existe na conversa com a pessoa (ADR-052/055), e a
  emenda anterior já deixa merge e aprovar PR pedidos na conversa sair pelo app. `gh repo delete`, `release delete`,
  `secret` e `variable` continuam.
- **A credencial por extensão exige nome de arquivo:** `server.key`, `**/*.pem` e `"cert.p12"` param; `e.key`,
  `jq '.key'` e `obj.keyboard`, não.

**Como medir de novo:** `npx tsx scripts/medir-arriscados.ts` roda `comandoArriscado` e `tocaCredencial` sobre cada
bloco ```bash dos SKILL.md do Mac, sem chamar modelo. Toda mudança em `ARRISCADOS` ou `CREDENCIAL` deve vir com essa
contagem.

## Emenda de 2026-10-18: o botão só com ícone, o texto de hoje e a confirmação do total (Fase 4, PR 2)

**Contexto.** Plano dos modos de aprovação (`docs/plano-modos-de-aprovacao.md`, Parte 2 e a revisão de engenharia de
18/10) e protótipo aprovado pelo Marlon (canvas "Nod — modos de aprovação", telas "o menu com os três modos" e "o botão
do modo só com ícone"). O texto do automático estava errado em três lugares — o menu, a faixa acima do campo e a linha
gravada na troca — e um quarto no manual do Nod: diziam que ele para depois de ler a web ou um e-mail, o que deixou de
ser verdade na ADR-066. E o Nod em "Ignorar todas" punha outro bot nesse modo sem a pessoa.

**Decisão.** Revê o item 6 (Tela). Nenhuma regra de decisão muda.
1. **Botão só com ícone.** O chip vira uma pílula de 36 × 32 px com o ícone do modo (mão, ⏩, triângulo), sem o nome
   curto nem a seta. O nome vai no `aria-label` e numa dica que aparece no hover e no foco do teclado ("Aprovar
   automaticamente · clique para mudar"; quem não é a dona: "… · só a dona do bot muda"). No total, pílula e ícone em
   âmbar (`--warning-soft`, `--warning-line`, `--warning`). No celular o alvo de toque é 44 × 44 px, com a pílula no meio
   (o botão ocupa 36 px no campo e o toque passa 4 px para cada lado, para não cortar o "Mensagem" a 390 px), e a dica
   não aparece (o nome segue no `aria-label`). O painel do bot continua com "Aprovações · Auto".
2. **Texto de hoje.** Uma fonte só no servidor, `DESCRICAO_MODO` (`src/domain/modo-aprovacao.ts`), usada na linha
   gravada na troca; a web repete as frases e um teste confere que são iguais. As frases dizem o que a regra faz hoje
   (o automático para no arriscado e na credencial; o total não abre arquivo de credencial e pede você nos comandos com
   ela). As frases do protótipo que falam do revisor e do total sem credencial entram com esses comportamentos.
3. **Ligar o total pede confirmação dentro do menu.** Clicar no terceiro item não troca o modo: abre, ancorado na
   opção, o aviso "Um texto de fora, como um e-mail ou um PR, pode levar {nome} a agir por conta própria. Use em bots que
   trabalham só com o que é seu." e os botões "Ignorar aprovações em {nome}" e "Agora não" (o foco vai para este; Esc
   fecha só o aviso; o segundo clique de um duplo clique, ou o que chega em menos de 500 ms depois de o aviso abrir, não
   conta, nem no "Ignorar aprovações" nem no "Agora não", porque o menu sobe e um dos dois cai sob o mouse). `POST agentes/:id/modo-aprovacao` exige `confirmado: true` para o total e responde 400
   (`entrada_invalida`) sem ele; manual e automático não pedem.
4. **A faixa acima do campo sai.** A pílula âmbar e a confirmação fazem o papel dela, ancoradas no elemento. As chaves
   `modo:*` de `preferencias.avisos_fechados` (0059) ficam sem uso; a rota de avisos fechados fica para outros avisos.
5. **`gerir_bots` que põe um bot no total é sempre card**, em qualquer modo do Nod, inclusive no total (motivo
   `ligar_total` no lote, `riscoDaAcao`/`decidirLote`). Só o card aprovado pela pessoa passa `confirmado: true` ao caso
   de uso, que é a segunda cerca.

**Gatilho de reversão.** Uma dona que diga ter ligado o total sem perceber (a confirmação não basta): o total passa a
pedir também a digitação do nome do bot.

## Emenda de 2026-10-19: apagar pedido na conversa passa pelo revisor (Fase 4, PR 5)

Revê o item 4 da emenda de 2026-09-30. Com a chave `NOD_REVISOR` ligada ([ADR-115](adr-115-automatico-com-revisor-na-ia-da-pessoa.md),
seção "PR 5"), apagar ou arquivar num app que a pessoa pediu na conversa deixa de sair sem olhar: vai ao revisor, como o
apagar de rotina ou de colega (decisão 4 do Marlon, 18/10; o cenário A4 do protótipo). O revisor libera em segundos o que
a pessoa pediu ou pede o ok dela num cartão. Merge e aprovar PR continuam saindo sozinhos. Com a chave desligada, o item
4 vale como estava. O gatilho de reversão da emenda de 30/09 ("uma exclusão que a dona diga não ter pedido") passa a valer
para a exclusão liberada pelo revisor.

## Emenda de 2026-10-19: "Ignorar todas as aprovações" de verdade (Fase 4, PR 6)

**Contexto.** Plano dos modos de aprovação, Parte 6, e decisões do Marlon de 18/10 (2: os bots que já estão no total
passam à regra nova; 5: credencial no Automático é sempre cartão; 7: subir arquivo de credencial a um app continua
recusado). Protótipo aprovado: telas Y1, Y2 e Y3 e o menu ("Main"). A [ADR-115](adr-115-automatico-com-revisor-na-ia-da-pessoa.md)
traz a decisão inteira; aqui, o que muda nesta ADR.

**Decisão.** Revê o item 2 (a tabela), o item 4 (registro) e o item 6 (texto do menu).
1. **A alternativa descartada "Total sem a cerca da credencial" vira a decisão.** No total, o comando que toca credencial
   do Mac e a leitura e a gravação de arquivo de credencial rodam sem cartão. Na tabela do item 2: "Comando que toca
   credencial" fica card · card · **roda**; "Arquivo de credencial pelas ferramentas de arquivo" fica negado · **card** ·
   **roda**. A chave do próprio nod continua pedindo a pessoa até no total.
2. **Registro.** `regra:modo_total` sobe para a **versão 2**. Toda ação que o total roda e que o manual pediria fica em
   `acoes_pelo_modo` (veredito nulo, sem decisão), com o gatilho (`credencial`, `arriscado`, `fora_da_pasta`, `comum`):
   é a fonte da Atividade do bot no filtro novo "Sem aprovação" (que também lista os apps e acessos aprovados pelo modo)
   e da linha discreta embaixo da fala, só para a credencial e o arriscado ("Usou o token do GitHub do seu Mac · ver na
   Atividade"; `qualCredencial` dá o nome).
3. **Texto.** O total no menu: "Faz tudo sem perguntar, até comandos com as credenciais do seu Mac. O que ele fez fica
   na Atividade." O aviso da confirmação: "Um texto de fora, como um e-mail ou um PR, pode levar {nome} a usar suas
   credenciais. Use em bots que trabalham só com o que é seu." A linha gravada na troca acompanha.
4. **Os bots que já estão no total** ganham a regra nova no deploy e uma linha na conversa de cada um ("Ignorar todas as
   aprovações agora também usa as credenciais do seu Mac sem pedir. O que ele fizer fica na Atividade."), escrita uma
   vez por `scripts/aviso-total-credenciais.ts` (no `deploy.sh`).

**Reverte** o gatilho de reversão "Credencial lida por bot no total sem card": é o comportamento pedido agora. No lugar
dele, o da ADR-115: uma credencial lida no total e mandada para fora sem a pessoa ter pedido.

**Riscos aceitos.** Um texto de fora pode levar o bot no total a usar uma credencial — o pedido do Marlon, com a
confirmação no menu, a pílula âmbar, a linha na fala e a Atividade. Até o app do Mac atualizar, o hook antigo ainda nega
o arquivo de credencial (o comando já roda, porque quem decide o comando é o servidor).

## Emenda de 2026-10-27: no celular o modo mora na folha do + (NOD-381)

No celular o botão do modo sai de dentro do campo e vira a linha "Modo de aprovação" da folha do + (web/telas/folha-mais.ts),
com o modo atual embaixo ("Ignorar todas as aprovações" em `--warning`) e o mesmo menu de hoje. Revê o item 6 só no
celular: o colega não tem a linha (a folha de um bot de outra pessoa só tem Anexar, critério de design da NOD-381) e vê o
modo na gaveta do bot (Ambiente, "Aprovações · …"), como já via. No computador nada muda.

O aviso âmbar que os riscos aceitos contam continua no campo, para a dona e para o colega: com o modo total, o + fica em
`--warning` com um ponto e o nome dele diz o modo; quando não há + (bot de colega sem anexo), o chip do total volta ao
campo, só leitura.
