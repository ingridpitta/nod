# ADR-034 — Gestão de agentes e exclusão recuperável

Status: aceito em 2026-09-17.

A referência de produto é o [menu enviado pela pessoa e a documentação oficial do Grok Bot](https://docs.x.ai/grok-bot/bots).
Ocultar preserva o trabalho e não pausa rotinas. Duplicar reaproveita a configuração, sem histórico
ou memória. Excluir precisa retirar o agente de operação, não apenas da lista.

## Decisão

- Menu na barra lateral (botão e clique direito) e no chat; teclado com setas e Escape.
- Nome, título, missão, modelo, forma e cor editáveis. Salvar missão/título é confirmação explícita
  do perfil. Propostas do modelo continuam exigindo a confirmação existente.
- Fixação, seção e marcação manual de não lido persistem no servidor. Abrir o chat limpa a marcação.
  Seções são nomes atribuídos a bots; nascem ao mover o primeiro bot e desaparecem quando vazias.
- Só a dona altera a organização/perfil ou exclui/restaura. Bots visíveis da equipe podem ser
  copiados para um novo agente, sem herdar permissões. O dono do novo recurso é quem o cria.
- Duplicar mantém o avatar, corrigindo a regra anterior de gerar outra forma/cor. Também copia
  rotinas, **pausadas e com aprovação ligada**. Não copia concessões, memória, mensagens, sessão do
  CLI, fixação, seção ou estado de leitura. Nome com sufixo respeita o limite de 60 caracteres.
- Exclusão é recuperável: `excluido_em` retira o perfil da frota ativa e bloqueia novos trabalhos.
  A gestão separa ativos, ocultos e excluídos. Não há purga definitiva nesta rodada.
- Excluir pausa rotinas próprias, revoga concessões próprias, interrompe turnos próprios pendentes,
  solicita parada dos que estão rodando e encerra propostas/decisões próprias pendentes. Arquivos,
  contas conectadas e efeitos externos já realizados são preservados.
- Restaurar recupera perfil e histórico; não devolve concessões nem reativa rotinas automaticamente.
  A trilha de auditoria é preservada. Exclusão recuperável não é uma promessa de apagar dados pessoais.

## Concorrência e escopo

Migrações 0011 e 0012 adicionam metadados às tabelas já escopadas. Nenhuma policy é ampliada.
O agente tem uma geração de execução, incrementada ao excluir. Turnos capturam essa geração na
criação; rotinas a capturam na criação/ativação. A fila, o lease e o gate de ferramentas recusam
trabalho de gerações antigas. A agenda apresenta rotinas antigas como pausadas até ativação explícita.
Isso protege inclusive turnos/rotinas de outra pessoa sobre um agente de equipe, sem escrever fora
do escopo de quem excluiu. Decidir uma aprovação antiga também não revalida seu turno.

Triggers de criação/ativação e exclusão usam a mesma trava consultiva por tenant/agente. A leitura
sob RLS continua normal: `SELECT FOR SHARE` exigiria também a policy de escrita e impediria uma
pessoa de trabalhar com um agente de equipe que ela pode ler. Não usamos SECURITY DEFINER nem
mudança temporária de identidade para contornar as policies.

O limite de interrupção é o mesmo do restante do nod: um efeito externo já em execução pode terminar.
A interface informa isso ao confirmar exclusão. Restaurar não revalida tokens/planos de gerações antigas.

## Validação

`tests/integration/gestao-agentes.test.ts` cobre o ciclo, cópia, isolamento de dono e geração entre
pessoas. `tests/concurrency/gestao-agentes-http.test.ts` verifica os endpoints reais. O roteiro visual
está em [UAT da gestão](../uat-gestao-agentes.md).

## Emenda de 2026-09-28 — duplicar de verdade

**Contexto.** O Marlon duplicou o Dev 1 esperando o mesmo bot, e a cópia veio sem as 7 concessões do
GitHub. Pela regra acima, também viria sem memória e com as rotinas pausadas. Para quem duplica o
PRÓPRIO bot, "reaproveitar a configuração" deixava de fora justamente o que faz o bot funcionar.

**Decisão.**

- **A dona duplicando o próprio bot leva o bot inteiro:** perfil e avatar (como antes), memória,
  concessões, regras "Sempre permitir" ativas (ADR-042) e rotinas no **mesmo estado**. Uma rotina
  ativa continua ativa. A cópia nasce em Aprovar automaticamente e não herda o modo do original (emenda
  2026-10-20, NOD-316; ADR-059 §1); a caixa de duplicar diz isso. A conversa da cópia registra "Rotina ativa: …",
  como na confirmação.
- **Todo acesso nasce com consentimento novo, na conversa da cópia.** Concessões passam por
  `concederLote` (a mesma mensagem e os mesmos eventos de um "Dar acesso"). Regras ganham uma mensagem
  `permissao-permanente` e mantêm o item de origem. O clique em Duplicar é o consentimento, e fica
  citável na conversa da cópia (ADR-013). Capacidade fora do catálogo e regra que hoje não poderia
  nascer (`nuncaPermanente`, ADR-047) não são propagadas. `duplicar-agente.ts` entra na lista de quem
  pode chamar `concederLote` (`eslint.config.mjs`, ADR-044) porque só a rota de pessoa o chama.
- **Bot de equipe duplicado por outra pessoa não muda:** vem só o perfil, rotinas pausadas e com
  aprovação, sem memória nem permissões. Quem não deu o acesso não o herda.
- Continuam fora: histórico, sessão do CLI, fixação, seção, leitura e o computador do bot (a cópia
  ganha o próprio vínculo, ADR-037). A pasta de trabalho é vínculo local da conversa e também não vem.

**Custo aceito.** Rotina ativa duplicada roda nos dois bots. A caixa de confirmação avisa isso antes
do clique.

**Gatilho de reversão.** Se aparecer efeito externo duplicado por rotina copiada ativa (dois envios da
mesma coisa), volta a regra de copiar as rotinas pausadas, mantendo a cópia de memória e acessos.

**Emenda de 2026-10-20 (NOD-289, auditoria de 15/10).** A cópia da dona vai para a mesma máquina do
original (`maquina_id`, ADR-090) só se a chave dela estiver viva; revogada ou vencida (ADR-102), ou bot
de outra pessoa, a cópia nasce sem máquina. Pedida ao Nod (`gerir_bots`, com ou sem card), as rotinas
da cópia vêm sempre pausadas e o resultado avisa "rotinas da cópia vieram pausadas; ative em Rotinas":
sem a caixa da dona, ninguém via a rotina rodar em dobro (aplica o gatilho de reversão acima a esse
caminho). A caixa da dona continua como está. O nome é o primeiro livre entre "X (cópia)",
"X (cópia 2)"…, dentro de 60 caracteres, comparando a pasta sem maiúsculas com todos os bots (ocultos e
excluídos inclusive), e a pasta distinta sai junto. O "computador do bot" que fica de fora acima é o de
computer-use (ADR-037), não a máquina-alvo.

## Emenda de 2026-09-29 — não lido é o "lido até" da conversa

A marcação manual (`agentes.nao_lido`, 0011) era o único não lido: nada marcava quando o bot respondia,
a rotina entregava ou alguém escrevia numa sala. Para saber, era preciso abrir bot por bot, e sala não
tinha sinal nenhum (canvas "Nod — tela do agente", página "Não lidos").

- **0039 `leituras`:** uma linha por pessoa e conversa com o `lido_ate`, o `criado_em` da última mensagem
  vista, lido do próprio banco. `ms()` trunca os microssegundos e deixaria a última mensagem contando
  como nova. Não lida é a mensagem de texto ou artefato de quem não é a pessoa, criada depois dele. Aviso
  do sistema, execução de rotina e a troca interna entre bots não contam.
- **Na migração:** cada conversa ganha a linha de quem a lê, lida até ali. O bot que a pessoa tinha
  marcado continua com a última fala como nova. `agentes.nao_lido` fica sem uso, porque outras cópias
  do Nod na main usam o mesmo banco. Sai numa migração depois desta.
- **"Marcar como não lido"** (menu do bot e `PATCH organizacao`) põe o `lido_ate` logo antes da última
  fala. Abrir a conversa com a janela na frente, ou "Marcar como lido", leva até a última mensagem.
- **Na web:** o ponto cinza do mascote passa a vir desses dados. A prévia nova fica em tinta escura e a
  sala ganha o ponto à direita. Com algo não lido, o ícone entre a busca e o + abre a tela Não lidos, a
  conversa mais recente em cima. A linha "Novas" marca onde a pessoa parou quando ela abre a conversa
  ou volta para a janela; a fala que chega enquanto ela olha é lida sem linha.

**Validação.** `tests/integration/nao-lidos.test.ts` (6 casos: contagem, microssegundos, três últimas,
marcar não lido, oculto, sala e marcar tudo, isolamento entre pessoas) e `tests/unit/web/nao-lidos.test.ts`
(9 casos), verdes num banco efêmero com a 0039.

**Gatilho de reversão.** Se a leitura de `nao-lidos` passar de 100 ms no p95 com o histórico real,
porque a contagem varre as mensagens de cada conversa, a contagem vira um contador mantido na
escrita da mensagem.
