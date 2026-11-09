# ADR-019 — A sonda de disponibilidade pergunta ao CLI, nunca lê a credencial

**Status** revisado

## Decisão

Mantidas as três regras acopladas sem tirar uma vírgula: (1) presença de variável de ambiente nunca é prova de autenticação; (2) a identidade que o CLI reporta é cosmética e PROIBIDA para autorização; (3) contrato de snapshot com três estados e gate pré-spawn que recusa o turno antes de gastar. Acréscimo: a sonda vira o mecanismo de INVENTÁRIO. O app local publica o snapshot no servidor junto com o heartbeat. O servidor guarda por pessoa: motor, disponível, autenticado, motivo, VERSÃO DO CLI e instante. Nunca credencial, nunca token, e o email do fornecedor NÃO é gravado.

## O que mudou

Ganha o papel de inventário. A versão do CLI entra porque alimenta os flag floors.

## Por quê

Não só sobrevive como fica mais central: o cenário que ele descrevia deixa de ser hipótese e vira o caminho principal. A regra (2) fica MAIS importante e é a que eu mais defenderia numa discussão: com o time inteiro logado com contas pessoais, a tentação de 'ela já está logada como fulana@acme.com.br no Claude, usa isso como login do nod' é enorme e economizaria uma tela. É armadilha — a pessoa troca a conta do CLI para um Gmail pessoal e o nod não pode nem piscar. Autorização vem do servidor. E a distinção que a UI precisa é de duas linhas: 'não tenho o CLI instalado' e 'tenho o CLI mas não estou logada' são botões diferentes — com o time inteiro se instalando sozinho, essa diferença é a maior parte do suporte.

## Emenda de 2026-10-05 — conta logada que não responde

**O que foi medido.** Em produção, em 2026-10-05, uma pessoa entrou no Claude Code com uma conta cuja organização
desativou o uso por assinatura. `claude auth status` dizia `loggedIn: true`, o app anunciou a IA como pronta e todo
turno voltou com a recusa do fornecedor no lugar da resposta. A ligação de boas-vindas ficou muda e a conversa mostrou
a frase em inglês como se o bot a tivesse dito. A conferência de login (sem turno) não distingue esse caso.

**O que muda.**

- **Os três estados continuam.** `nao_autenticado` ganha um código opcional `causa`: `conta_sem_acesso` (a recusa da
  organização) ou `teste_falhou` (logada, não respondeu, motivo desconhecido). A frase que a pessoa lê é do servidor
  (`MOTIVO_DA_CAUSA`); texto vindo do Mac nunca vira motivo.
- **Teste de verdade, pedido pela tela.** Cada driver ganha `testar(pergunta)`: um turno de uma frase, sem ferramentas e
  sem servidor MCP, com o mesmo isolamento do turno. O onboarding o roda durante o "olá" (`nodDesktop.iaTestar`) e só
  chama a ligação com uma IA que respondeu. Custa um turno da assinatura por IA logada; por isso não roda sozinho no
  boot nem a cada sonda.
- **O turno também reprova.** Um turno que não deu certo e cujo texto é a recusa vira falha por `nao_autenticado` com
  `causaSemIa`, sem a frase como fala (`comContaSemAcesso`). O servidor marca aquela IA da máquina como fora na hora.
- **O veredito mora no app do Mac** (`desktop/vigia-ias.ts`), preso à conta: guarda um hash do que o CLI diz sobre o
  login. Mudou a conta, ou passaram 24 h, a IA é testada de novo sozinha. Enquanto vale, a IA é anunciada como
  `nao_autenticado` com a causa, mesmo depois de reabrir o app. O `codex login status` não diz qual é a conta, então
  o fim de um login aberto pelo app também dispara o teste. O reteste automático tem freio (1 min, dobrando até 1 h):
  medido em 2026-10-05, a saída do estado do login não muda entre chamadas, e o freio cobre o dia em que mudar.
- **Medido com os CLIs reais** (2026-10-05, Claude Code 2.1.289 e Codex 0.147.0, `npm run sonda:teste-ia`): o teste
  responde em ~13 s por IA; as duas são testadas ao mesmo tempo.
- **Bot em automático troca de IA sozinho.** Turno de conversa com `harness=auto` e `modelo=auto`, reprovado por
  `causaSemIa`, com outra IA pronta na mesma máquina: o pedido é repetido nela e a conversa ganha uma linha dizendo por
  quem o bot passou a responder. IA ou modelo escolhidos à mão e turnos de rotina não trocam: recebem o aviso.
- **A fala barrada é repetida.** Quando uma IA fica pronta, o servidor repete a fala mais recente de cada conversa que
  foi barrada por falta de IA nos últimos 30 minutos (`repetirBarradosPorIa`).

**Exceção à ADR-009, deliberada.** Reconhecer a recusa exige ler texto do fornecedor: é a única pista que existe. A
leitura só escolhe entre dois códigos fechados, e o que não casa com a frase conhecida fica `teste_falhou`. Um turno
que deu certo nunca é reclassificado, mesmo citando a frase.

**Diagnóstico remoto.** O `erroCru` do executor do Mac era descartado na validação da entrega, então o diagnóstico de
todo turno falho em produção ficava vazio. Ele passa a atravessar com teto de 8.000 caracteres, só para o diagnóstico
gravado da pessoa (ADR-041), e continua fora do log do servidor (`erroCruNoLog: false` na ponte das máquinas).

**Gatilho de reversão.** Se o fornecedor mudar a frase e a recusa voltar a aparecer como fala, o caso cai em
`teste_falhou` no onboarding (a IA continua reprovada) mas passa despercebido no turno: acrescentar a frase nova em
`src/domain/conta-da-ia.ts`. Se o teste do onboarding reprovar contas boas (lentidão do fornecedor), o teto de 90 s do
turno de teste é o primeiro a rever.


## Emenda de 2026-10-06 — piso de versão por CLI (NOD-171)

**Contexto.** A versão do CLI já entrava no inventário "porque alimenta os flag floors", mas nenhum piso recusava nada:
um Codex de quatro meses atrás era anunciado como pronto e todo turno fixado nele falhava com erro de argumento.

**Decisão.**
- `PISO_CLI` (`src/adapters/executor/flag-floors.ts`) guarda a versão mínima de cada CLI: as versões aprovadas no UAT
  de 2026-10-06 (`claude-cli` 2.1.290, `codex-cli` 0.159.0). O piso do Codex fica numa linha só, isolado, até o Marlon
  escolher entre 0.159.0 e 0.159.2: trocar é essa linha.
- Abaixo do piso, a sonda (completa e sem turno) devolve `ausente` com `causa: "cli_antigo"`, `versao` e `minima`, sem
  gastar turno nem perguntar o login. O turno lança `executor_indisponivel` com a mesma causa antes de qualquer prompt.
  Pré-release conta (`0.159.0-alpha.3` < `0.159.0`); sem versão legível não recusa (o `--version` que falhou já é
  `ausente`).
- A ponte aceita `cli_antigo` de um Mac com versões no formato `x.y.z[-pre]`; a frase é sempre a do servidor.
- A tela diz "desatualizado" (versão instalada e mínima, e o comando de atualizar), nunca "não instalado": o
  onboarding, a frota, o seletor de Inteligência e a negação na conversa.

**Gatilho de reversão.** Se um piso recusar uma versão boa (o fornecedor lançou uma versão com numeração fora do
semver), baixar a linha do `PISO_CLI` e publicar o app e o servidor: o Mac sonda com o piso que veio no app.


## Emenda de 2026-10-08 — o resultado da sonda chega ao servidor com turno rodando (NOD-199)

O que a vigia do Mac sonda de novo (login novo, CLI atualizado, IA que volta no teste) é reanunciado pela rota só de
inventário da ponte ([ADR-021, emenda de 2026-10-08](adr-021-a-ponte-de-execucao-o-app-local-puxa-o-servidor-nunca-di.md)),
não pelo `conectar`: o servidor passa a saber da IA nova sem recusar nem limpar o turno que roda. Anúncio que falhou é
repetido no passo de 30 s da vigia, mesmo com todas as IAs prontas.

## Emenda de 2026-10-15 — o e-mail da conta vai ao servidor (ADR-105)

"O email do fornecedor NÃO é gravado" deixa de valer para as contas de IA: o anúncio das contas leva o e-mail e a
organização, e `contas_ia` os guarda para a tela de Provedores dizer qual conta é qual em qualquer máquina. A regra (2)
continua inteira: a identidade é cosmética, nada autoriza nem casa conta por ela. O inventário da sonda continua sem
e-mail. Detalhes e gatilho de reversão na [ADR-105](adr-105-email-da-conta-de-ia-no-servidor.md).
