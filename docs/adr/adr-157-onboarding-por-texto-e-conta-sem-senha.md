# ADR-157 — Onboarding por texto e conta sem senha

Status: proposta (2026-11-07, ADA-242) · Revisa a [ADR-077](adr-077-onboarding-por-ligacao.md) (a ligação sai do
onboarding quando `NOD_ONBOARDING_TEXTO=1`) e a [ADR-124](adr-124-identidade-progressiva-uso-sem-conta-e-conversao.md) (conta por código de
e-mail, sem senha; Google também dentro do app). Spec: `docs/specs/onboarding-jornada-a.md`.

## Contexto

No teste de 05/11 o onboarding por ligação "só piscou" no Windows e a primeira mensagem terminou em "a IA não conseguiu
abrir neste Mac". A tela de conta pedia senha enquanto as telas de IA prometiam "o nod nunca vê sua senha", e o Google
para conta não valia no app (o navegador do sistema não tem o cookie do app). O Marlon pediu onboarding por texto, com
opção de pular, e conectar a IA "mais mágico".

## Decisão

1. **Tudo atrás de `NOD_ONBOARDING_TEXTO=1`.** Desligada, a rota de código responde 404 e a tela continua a de hoje
   (ligação, cadastro com senha). O servidor anuncia a flag em `/api/sessao/modo` (`onboardingTexto`).
2. **Conta sem senha.** `POST /api/conta/codigo {email}` emite o código `verificacao` sem `senhaHash`, com os mesmos
   limites de `cadastrar` e a mesma resposta para e-mail com e sem conta. `verificar` com esse código: e-mail novo
   cria a conta com a identidade `email` (migração 0155, só amplia o CHECK); e-mail com conta abre a escolha de sempre
   sem identidade nova (código não dá senha). Pessoa de antes das contas continua indo para o Google (ADR-030). Senha
   continua para quem já tem (NOD-186).
3. **Google no app por loopback + troca com prova.** O processo principal do app abre `127.0.0.1:<porta>` com um
   `estado` aleatório; a página pede `POST /api/conta/google {app: true, porta, estado}` com o desafio do segredo do
   processo principal (`x-nod-app-desafio`, NOD-345) e recebe `/api/sessao/google?conta-app=<bilhete>`. O bilhete
   (assinado, 10 min) leva sessão, porta, estado e desafio. Na volta do Google o servidor **não liga nada**: guarda a
   identidade num código `google_app` de uso único (60 s) e redireciona ao loopback. O app troca o código em
   `POST /api/conta/google/trocar` (sem Origin) com a prova; só então o serviço roda a mesma `voltaGoogle` da web.
   Assim um link com o bilhete de outra pessoa não liga o Google de quem clica: sem a prova, o código morre.
4. **"Este computador" por máquina.** A tela decide pelo estado da IA desta máquina (`EstadoIa` da ponte do app;
   inventário do motor como reserva), sem etapa de servidor. "Já vi esta tela" mora no app (`nodDesktop.esteComputador`,
   arquivo local); reinstalação limpa mostra a tela de novo. App sem a ponte nova: sem "já vi", a tela aparece enquanto a
   IA não estiver pronta.
5. **Conversa por texto.** `ola → entrevista → configurando → concluido`; `chamando` deixa de ser alcançável e quem
   estiver nela é lido como `entrevista` (sem UPDATE). Duas perguntas (nome e objetivo) e "Pular as perguntas", que
   conclui (`onboarding_etapa = 'concluido'`).

## Computador novo (jornada B, ADA-243, definido em 2026-11-08)

1. **"Já vi" por máquina vale também para quem já concluiu.** Conta existente num computador sem o "já vi" local vê
   "Oi de novo · este computador" com o estado da IA DESTA máquina; a conversa com o Nod não recomeça.
2. **Esta máquina na web.** A ponte `nodDesktop.estaMaquina()` devolve a chave pareada desta instalação (Mac: o
   `machineId` da sessão; Windows: o `maquina.json` que o motor grava ao conectar). Sem a ponte (web pura, app antigo),
   a web diz "não sei" e nunca chuta a máquina pelo nome.
3. **Tela B "Onde os bots trabalham".** Com a IA pronta aqui e a padrão nula, outra ou desligada. "Trabalhar neste
   computador" usa o mesmo `PUT /maquinas/padrao` do seletor; "Manter" não cria estado (só o "já vi").
4. **Aviso por máquina, sem flag (bug).** A barra, o topo do bot e a fila olham a máquina do bot (a dele, senão a
   padrão) e, para "qualquer uma", esta máquina: "Sem IA neste computador", "Trabalha no {nome}, que está desligado".
   O motivo de IA ausente no Windows/Linux nomeia a máquina, em vez de "neste Mac".
5. **`maquinas.definir_padrao` vivo no chat** (`gerir_maquinas`, risco `muda`, sem cartão), o mesmo executor da tela;
   revisa o NOD-396 só para essa ação. "Aqui" sem máquina conhecida faz o bot listar e perguntar.

## Consequências

- Nenhuma ação nova no chat: `conta.entrar` (`nunca`) cobre código e Google no app (ADR-135). A jornada B sobe
  `maquinas.definir_padrao` de `falta` para `vivo` (§ Computador novo).
- A prova real no Windows depende da VM de QA (ADA-233/235); até lá valem os testes por plataforma e o roteiro de
  `docs/aceite-desktop.md`.

## Gatilho de reversão

Se a taxa de conclusão do onboarding por texto ficar abaixo da do onboarding por ligação nas duas primeiras semanas
com a flag ligada, ou se o Google no app falhar em mais de 5% das tentativas por porta/loopback, desligar a flag e
reabrir a decisão.
