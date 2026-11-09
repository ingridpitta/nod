# Onboarding, jornada A: pessoa nova, nada instalado

Spec escrita com `/spec` em 2026-11-06, a partir do mapa do onboarding (22 atritos, 3 causas de raiz), das respostas do Marlon no mapa, da crítica do agente de interface e do protótipo. Rascunho: as decisões marcadas como **assumidas** foram tomadas na crítica e cabe ao Marlon reverter antes do plano.

Protótipos neste PR: `prototypes/onboarding-2026-11/jornadas.html#a` (clicável, com simulação de falhas) e `prototypes/onboarding-2026-11/prancha-a.html` (16 telas lado a lado). Fontes editáveis: protótipo https://claude.ai/artifact/512SXTVrFLRSs3uwqXY8jt · prancha https://claude.ai/artifact/WqK7sEopZc4dwURXKkTQis · mapa https://claude.ai/artifact/6AwEPFPqaTYrni13qRgdco.

## Contexto

Quem chega ao nod pela primeira vez precisa de três coisas em sequência: uma conta, uma IA neste computador e um motivo para voltar (um bot que faz algo). Hoje o onboarding é uma ligação por voz (ADR-077, `web/telas/onboarding.ts`, 725 linhas) desenhada para o Mac; no Windows a tela da IA "só piscou" (teste do Marlon em 05/11) e a primeira mensagem terminou em "Turno interrompido: a IA não conseguiu abrir neste Mac". O Marlon pediu em 05/11: tirar a voz do onboarding, onboarding por texto com opção de pular, e "conectar uma IA deveria ser mais mágico". Esta jornada é a base das outras três (B, C e D nascem dela).

## Estado atual (verificado em 2026-11-06 sobre `origin/main` 316340a7a)

| Peça | Onde | O que faz hoje | Lacuna |
| --- | --- | --- | --- |
| Conta | `web/telas/conta-no-chat.ts` (ADR-124): `cadastrar(email, senha)`, `verificar(codigo)`, `reenviar()` | Criar conta pede senha E código; entrar pede senha | O app promete "nunca vê sua senha" nas telas de IA e pede senha na conta |
| Google | `desktop/parear.ts` (ADR-069, loopback 127.0.0.1 + PKCE), `web/telas/parear-mac.ts` "Conectar este Mac?" | O app abre o navegador, a pessoa entra com Google e confirma o pareamento | Só existe no app do Mac; o texto é "este Mac" |
| Etapas | `src/db/migrations/0049_onboarding.sql`: `onboarding_etapa IN ('ola','executor','chamando','entrevista','configurando','concluido')`, por pessoa | Progresso por pessoa | Nenhuma etapa é por máquina; a etapa `executor` nunca volta noutro computador |
| Mostrar ou não | `src/use-cases/onboarding.ts:82` `mostrar = concluidoEm === null && etapa !== "concluido" && (etapa !== null \|\| meus.length === 0) && !guiaExcluida` | Mostra uma vez por pessoa | Reinstalação limpa no mesmo e-mail não mostra nada |
| IA no app | `web/telas/cartao-ia.ts` (cartão único, 3 passos), `desktop/instalar-ia.ts` (npm no prefixo do app, ADR-093), `desktop/login-ia.ts` (`claude auth login --claudeai`, código colado no stdin), `motor/preparo-do-login.ts` (VM/Windows) | Instalar e entrar dentro do app | A etapa "executor" do onboarding depende da ponte `nodDesktop.iaTestar`; no Windows a ponte é o motor e a etapa passa sem esperar |
| Erro da IA | `src/domain/redacao.ts:196` `lancamento_falhou: "a IA não conseguiu abrir neste Mac"`; `src/domain/stream-json.ts:493` | Texto técnico na conversa | Diz "Mac" no Windows; o erro do spawn é descartado (`claude-cli.ts` ~748) |
| Conversa guiada | `onboarding-controle.ts` (ligação, consentimento de mídia, "Configurar sem voz") | Entrevista por voz com as ferramentas `anotar_entrevista`, `concluir_entrevista`, `propor_bot` | Três perguntas (nome, time, objetivo); o Marlon pediu texto e pular |

## Mudança proposta

A jornada vira cinco momentos, todos dentro do app (telas da prancha entre parênteses):

1. **Abrir** (A1): um botão, "Entrar ou criar conta". Rodapé: "Com Google, ou com um código que chega no seu e-mail. O nod nunca vê sua senha."
2. **Conta** (A2–A5): uma tela só. Google abre o navegador e volta pelo loopback que já existe no `parear.ts`; e-mail manda um código de 6 dígitos e nada de senha. E-mail novo cria a conta na hora. **Assumido:** conta sem senha (a crítica apontou a contradição com "nunca vê sua senha"). A5 (confirmar o computador no site) só aparece quando o login começou pelo site, não pelo app.
3. **Este computador** (2a–2g): uma tela por máquina mostrando o que o app detectou. Claude é a linha principal; ChatGPT a segunda, com o mesmo botão "Instalar e entrar". Estados: já logado (2a), instalado sem login (2b), nada (2c), esperando o login no navegador (2d), erro na instalação (2e), login demorou (2f, só aqui aparece o campo do código), conta sem acesso ao plano (2g). "Pular por agora" leva ao app sem IA (jornada C). Sem a linha "Outras IAs" aqui (**assumido**; ela fica no card de conexão da jornada C).
4. **Conversa com o Nod** (3a–3e): por texto, duas perguntas. O Nod confirma o nome tirado do e-mail ("Posso te chamar de Ana?") e pergunta o que os bots devem fazer, com chips. **Assumido:** a pergunta do tamanho do time sai. "Pular as perguntas" no topo. O card de proposta usa o `.cp` de `web/card-proposta.css` (continuação da fala do bot). Criar mostra três passos na própria fala do Nod; o card vira a linha "Bruna criada · Abrir"; o bot novo abre com sugestões, a primeira sem precisar de app conectado.
5. **Bots**: a barra com o Nod e o bot novo. Fim da jornada.

### Detalhes de implementação

- **Conta sem senha.** Nova rota pública em `/api/conta` para pedir o código por e-mail e a `verificar(codigo)` de hoje aceitando login além de cadastro. A ação `conta.entrar` (`src/domain/acoes/conta.ts`, `nunca` no chat) cobre as duas; o cartão da conversa (`conta-no-chat.ts`) muda para a tela única. Senha continua existindo para quem já tem (não se remove coluna: NOD-186).
- **Google no app.** `desktop/parear.ts` já faz loopback + PKCE para o pareamento; a mesma porta recebe a volta do Google. No Windows o motor precisa do mesmo loopback (ver "Fora do escopo": decisão aberta).
- **Etapas por máquina.** A `preferencias.onboarding_etapa` continua por pessoa para a conversa. A tela "Este computador" não usa etapa de servidor: o app decide pelo estado da IA desta máquina (`src/contracts/estado-ia.ts` no Mac; inventário do motor no Windows) e guarda "já vi esta tela" no arquivo local da máquina (`contas-locais`/`conexao.json`), para a jornada B.
- **Novos valores de etapa.** A conversa por texto usa `entrevista` e `configurando` como hoje; `chamando` deixa de ser alcançável. Nada de `DROP`; o CHECK da 0049 não muda.
- **Copy sem sistema operacional.** `redacao.ts:196` passa a "a IA não conseguiu abrir neste computador" e os textos de `login-ia.ts:144` e `maquinas.ts` que dizem "neste Mac" ganham o nome da plataforma pela ponte.
- **Erro do spawn.** `lancamento_falhou` leva o motivo do spawn (`ENOENT`, código de saída) para o log, nunca para a conversa.
- **Acessibilidade.** Foco vai para o título a cada tela; linhas de estado com `role="status"`; o composer sem `outline: none`; o protótipo mostra o comportamento.

## No chat

Nenhuma ação nova de pessoa com caminho possível no chat: conta e login são `nunca` (`conta.entrar`); instalar e entrar na IA é ponte do app (`PonteIas`), sem rota de pessoa; o card de proposta reutiliza `decidirPropostaDeBot` (`src/use-cases/onboarding.ts:193`) e o id de criar bot já registrado em `src/domain/acoes/bots.ts`. Se o plano criar uma rota nova para "já vi Este computador", ela é `leitura`/estado de tela e entra como `nunca` (exceção "estado de tela", ADR-135 §2).

## Critérios de aceite

1. Windows e Mac limpos, e-mail novo: Abrir → Conta (código por e-mail) → Este computador (2c) → Instalar e entrar → 2d → 2a → Conversa (2 perguntas) → bot criado, em até 5 minutos sem abrir terminal.
2. O mesmo fluxo com Google: o navegador abre, a escolha da conta volta ao app sozinha, sem código colado.
3. Nenhuma tela do onboarding diz "Mac" num Windows nem "Windows" num Mac (teste de texto por plataforma).
4. Pular em "Este computador" leva aos bots; a primeira mensagem sem IA segue a jornada C (nunca "Turno interrompido").
5. Com `claude` já logado antes de instalar o nod, a tela 2a aparece e o botão Continuar leva à conversa (o caso que "piscou" em 05/11).
6. Reinstalação limpa (`%LOCALAPPDATA%\nod` e `%APPDATA%\nod-motor` apagados) com o mesmo e-mail mostra "Este computador" de novo; a conversa com o Nod não se repete.
7. "Pular as perguntas" conclui o onboarding (`onboarding_etapa = 'concluido'`) e o Nod responde uma linha explicando onde ficam os bots.
8. O card de proposta usa `.cp`; Criar mostra os três passos; o bot novo abre com chips e a primeira sugestão funciona sem app conectado.
9. Testes escritos e verdes; `npm run check` verde; paridade sem id novo.
10. Nada do fluxo por ligação regride para quem está no meio dele (etapa `chamando` em produção, se houver, é levada a `entrevista`).

## Plano de testes

| Camada | O quê | Quantos |
| --- | --- | --- |
| Unit | desenho das telas Abrir/Conta/Este computador por estado (`tests/unit/web/onboarding*.test.ts`), regra `mostrar` por pessoa × "já vi" por máquina, `redacao.ts` por plataforma | +8 |
| Integration | conta por código (pedir, verificar, login e cadastro), `withRollback` | +4 |
| Concurrency/e2e | `e2e:fumaca` ganha a jornada A com o catcher (conta → IA → conversa → bot) | +1 |
| Aceite | `docs/aceite-desktop.md` ganha o roteiro de Windows e Mac limpos | roteiro |

## Rollback

Código: reverter o PR volta a imagem; o banco não muda (sem migração nova além de, se preciso, colunas aditivas). Produto: a tela nova fica atrás de `NOD_ONBOARDING_TEXTO=1` no servidor na primeira release; desligar devolve o fluxo por ligação.

## Esforço (por componente)

Conta sem senha 1,5 d (rota + cartão + testes) · Este computador 2 d (tela por estado, ponte Mac + motor Windows, "já vi" local) · Conversa por texto 1,5 d (duas perguntas, chips, card `.cp`, três passos) · copy e erro do spawn 0,5 d · e2e e aceite 0,5 d. Total ~6 dias de uma pessoa; com agentes, 3 PRs de um dia.

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `web/telas/onboarding.ts`, `onboarding-controle.ts`, `onboarding-teste.ts` | fluxo por texto, telas Abrir e Este computador, sem ligação |
| `web/telas/conta-no-chat.ts`, `web/lib/api.ts` | tela única de conta, código por e-mail, sem senha |
| `src/adapters/http/` rota `/api/conta` | pedir código, verificar como login |
| `src/use-cases/onboarding.ts:82` | regra `mostrar` continua por pessoa; etapa `chamando` fora do caminho |
| `desktop/parear.ts`, `motor/` | loopback do Google também no Windows |
| `src/domain/redacao.ts:196`, `desktop/login-ia.ts:144`, `web/telas/maquinas.ts` | "neste computador" |
| `web/card-proposta.css`, `web/telas/confirmar-criar-bot.ts` | card de proposta no onboarding |
| `docs/adr/adr-149-onboarding-por-texto.md` | revisa ADR-077 (ligação sai do onboarding) e ADR-124 (conta sem senha) |

## Fora do escopo

- Pareamento no Windows pelo loopback (hoje só no app do Mac): decisão aberta, PR próprio.
- Prompts do sistema operacional no fluxo (Gatekeeper, UAC, SmartScreen): mapear antes, não desenhar agora.
- O bot "Nod" ter o mesmo nome do app: decisão do Marlon.
- Jornadas B, C e D (PRs irmãos).

## Relacionado

- ADR-077 (ligação), ADR-093 (IAs no app), ADR-101/102/105 (contas), ADR-124 (identidade progressiva), ADR-135 (ações).
- Teste de 05/11 e os 22 atritos no mapa (Claude Docs).
