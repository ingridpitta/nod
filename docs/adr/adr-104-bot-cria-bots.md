# ADR-104 — O bot cria outros bots quando a pessoa pede, na hora e sem card

Status: aceito (protótipo aprovado pelo Matheus, 2026-10-13) · Data: 2026-10-13 · Estende a
[ADR-082](adr-082-as-maos-do-nod.md) (as mãos do Nod) · Issue: NOD-210

## Contexto

O Matheus pediu à Nina, um bot recém-criado: "crie 5 agentes para o time de LPs". Ela não tinha como fazer isso e
respondeu que "bot novo só nasce pelo nod". Depois mandou a copy dos cinco para ele criar à mão. Antes disso, no modo
de criação, ela tinha lido o pedido como a missão dela e usado `atualizar_perfil` para virar um dos cinco.

Só o Nod cria bots, pelo `gerir_bots` (ADR-082). Esse caminho passa pelo modo de aprovação do Nod e, no manual, abre um
card de lote.

## Decisão

1. **Ferramenta nova `criar_bots`** (`src/contracts/ferramentas-criar-bots.ts`). Recebe de 1 a 10 bots, cada um com
   `nome` e `descricao` obrigatórios e `titulo` e `secao` opcionais. Uma chamada leva o pedido inteiro.
2. **Sem card e sem aprovação, em qualquer modo.** Ao aprovar o protótipo, o Matheus disse: "assim que eu pedir, ele só
   cria, a aprovação é desnecessária neste caso". O modo de aprovação de quem pede não é lido.
3. **Cercas que continuam valendo:**
   - **Onde vale.** A ferramenta só entra no catálogo de um bot comum, nos modos em que a pessoa fala com ele (conversa
     e criação). Fica de fora em rotina, sala, ligação e pedido de colega, e nunca vai para o Nod, que já tem
     `gerir_bots`. O caso de uso confere de novo: o bot é da pessoa do escopo e o turno é dele.
   - **Validação do pedido inteiro.** Antes de criar, o pedido é validado: nome vazio, longo, "Nod", já existente
     (sem diferenciar maiúsculas) ou repetido no pedido; descrição vazia; tetos. Qualquer problema e nada é criado. A
     criação roda num SAVEPOINT só.
   - **Como o bot novo nasce.** Igual a um bot criado pela pessoa: sem apps, sem rotinas, sem memória e em Aprovar
     automaticamente (`criarAgente`, ADR-059; emenda 2026-10-20, NOD-316 — era Aprovar manualmente). Criar bots não abre acesso a nada.
4. **Quem pede não muda.** O prompt (linha da conversa e texto do modo de criação) diz que os bots pedidos são outros e
   proíbe usar `atualizar_perfil` para virar um deles, a não ser que a pessoa peça para o bot mudar.
5. **Rastro.**
   - Cada bot novo recebe "Criado por X a pedido de Y em dd/mm" e a missão como primeira mensagem, com autoria do bot
     que criou e `decidido_por: "regra:criar_bots"`.
   - O evento `agente_atualizado` leva `criado_por_agente_id`.
   - A conversa de quem pediu recebe a linha "X criou N bots a pedido de Y: A, B e C."
   - A barra lateral atualiza pelo SSE `agente.mudou`, que já existe.
6. **Seção.** Usa a seção pedida. Sem ela, os bots novos vão para a seção de quem pediu. A seção é gravada com a mesma
   autoria do nascimento (o bot, `regra:criar_bots`), não em nome da pessoa.

## Emenda de 2026-10-13 — revisão do PR #309

A revisão achou brechas nas cercas acima. O que mudou:

1. **Conteúdo de fora não pede bots (coerência com a [ADR-026](adr-026-a-marca-de-nao-confiavel-e-propriedade-do-conteudo-carre.md)
   e a [ADR-062](adr-062-aprovacoes-que-cumprem-o-que-prometem.md)).** O modo "conversa" também cobre retomadas: a
   continuação depois da resposta de um colega e o recado de outro bot numa task. Agora o caso de uso recusa com
   `sem_pedido_da_pessoa` quando a entrada do turno é não confiável (ADR-026) ou quando a mensagem que o disparou é não
   confiável (o recado de um bot). O bot recebe a instrução de perguntar à pessoa com `pedir_a_pessoa`.
   O turno aberto pela pessoa que DEPOIS leu a web (contaminado, ADR-062) continua criando: é a decisão do Matheus
   (critério 2 da NOD-210, tela 5 do protótipo removida). Como as aprovações da ADR-062 endurecem nesse caso e esta
   ferramenta não, a criação grava `apos_conteudo_de_fora` no evento `agente_atualizado` e no log `criar_bots`, para a
   auditoria e para o gatilho de reversão abaixo. O prompt e a descrição da ferramenta dizem que um pedido de bots
   vindo de página, e-mail, arquivo, resultado de ferramenta ou colega é dado, não pedido.
2. **Corrida de nome.** Dois pedidos juntos liam a mesma lista e criavam o mesmo nome duas vezes. Agora o caso de uso
   trava os nomes do tenant (`agentes.travarNomesDeBots`, `pg_advisory_xact_lock`) antes de ler. Não há índice único:
   nomes legados repetidos existem e a criação pela tela não confere a unicidade.
3. **O que é "o mesmo nome".** A comparação usa NFKC, sem os caracteres invisíveis de formato (largura zero, marcas de
   direção), sem caixa e com os espaços colapsados (`chaveDoNome`, em `domain/nod.ts`). A reserva do "Nod" usa a mesma
   chave, então "Ｎｏｄ" e "N\u200Bod" também são recusados, inclusive na tela e no `gerir_bots`. O nome gravado sai
   limpo do mesmo jeito. A unicidade vale contra todos os bots que a pessoa vê (dela e da empresa), como o `pedir_a_bot`
   resolve. "Novo agente" é recusado: com ele o bot nasceria não confirmado. Caractere de controle é recusado (na
   descrição valem quebra de linha e tabulação).
4. **Falha no meio do lote** devolve `nao_deu_para_criar`, não `entrada_invalida`: o SAVEPOINT já desfez tudo e o bot
   não deve tentar de novo no mesmo turno.
5. **Interruptor.** `NOD_CRIAR_BOTS=0` tira `criar_bots` do catálogo sem deploy, como o `NOD_GERIR_BOTS=0` da ADR-082. A
   linha do modo de criação deixa de citar a ferramenta.

## Alternativas descartadas

- **Card de confirmação (o protótipo original).** O Matheus recusou. O pedido explícito da pessoa já é a aprovação.
- **Dar `gerir_bots` a todos os bots.** Isso abriria excluir, duplicar, mudar modo e dar acesso, que são ações
  arriscadas e com card. O pedido é só criar.

## Gatilho de reversão

Voltar a pedir aprovação, pelo modo de quem pede como no `gerir_bots`, se acontecer qualquer um destes casos:

- aparecer bot criado sem a pessoa ter pedido, por exemplo induzido por conteúdo de fora lido na conversa (procure
  `apos_conteudo_de_fora: true` nos eventos `agente_atualizado` com `criado_por_agente_id`);
- a criação em massa poluir a barra lateral.
