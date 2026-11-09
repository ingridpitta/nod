# Aceite do app desktop por arquitetura

Roteiro do §4 de [processo-de-release.md](processo-de-release.md). Rode-o inteiro **em cada arquitetura** (um Mac
Intel `x64` e um Mac com chip M `arm64`) com os DMGs baixados do rascunho da release, nunca com um build local. Marque
cada item `ok` ou `falha`. Uma falha de assinatura, login, executor ou compatibilidade impede a release estável.

Os itens citam o código pelo nome da função ou da constante, não pela linha. Se o comportamento observado divergir do
código citado, registre a divergência: ela é falha até alguém explicar.

## Registro

Copie um bloco por arquitetura para as notas da release, junto do registro da versão em
[processo-de-release.md](processo-de-release.md#recuperação-e-lições-por-versão).

```text
Pessoa:
Mac (modelo, chip, arquitetura):
macOS (versão e build):
IA usada (Claude Code ou Codex, versão):
Versão do app / tag / SHA:
Data:
Resultado por seção:
  A Actions:              ok | falha
  B Instalação limpa:     ok | falha
  C Primeira abertura:    ok | falha
  D Primeiro turno:       ok | falha
  E Parar:                ok | falha
  F Fechar e reabrir:     ok | falha
  G Revogar a chave:      ok | falha
  H1 Atualizar da preview: ok | falha
  H2 Atualizar da 0.2.0-rc.1: ok | falha | não feito nesta arquitetura
  I Auto-update:          não se aplica até a NOD-132
Desfecho do Keychain em H1: (a) mesma chave | (b) tela de conexão e chave nova
Custo dos turnos do aceite (US$ ou % do plano):
Observações e falhas:
```

## A. Actions

- [ ] **Execução do `desktop-release` verde nas duas arquiteturas.** Observar: no run da tag, o job `verify` e os dois
  jobs `mac` (`arm64` e `x64`) verdes, com os passos `Smoke da janela` (`smoke-window.mjs`), e, em
  `Verificar assinatura e notarização`, `smoke-proxy.mjs`, `codesign`, `stapler` e `spctl`. O job `draft` criou o
  rascunho com os dois DMGs e os `SHA256-*.txt`. Reprova se: algum passo foi pulado, desligado ou falhou; o rascunho
  não traz os dois DMGs; o run não corresponde ao SHA da tag.

## B. Instalação limpa

Num usuário novo do macOS (Ajustes do Sistema → Usuários e Grupos), sem `~/Library/Application Support/nod`. Baixe o
DMG de novo pelo navegador nesse usuário, para ele vir com quarentena; o `nod.app` que o H1 deixou em `/Applications` é
substituído ao arrastar (**Substituir**).

> **Rode H1 antes de B.** `/Applications` é compartilhada entre os usuários do Mac: instalar o DMG novo em B, mesmo num
> usuário novo, substitui a preview do usuário principal, e H1 perde a origem. Faça H1 no usuário principal primeiro e
> só depois crie o usuário novo para B.

- [ ] **DMG baixado pelo GitHub abre normalmente.** Observar: abrir o DMG, arrastar **nod** para **Aplicativos** e abrir
  com dois cliques, sem aviso de desenvolvedor não identificado. Reprova se: o macOS bloqueia, pede **Abrir mesmo
  assim** em Privacidade e Segurança, ou só abre removendo a quarentena (`xattr`) ou desligando o Gatekeeper.
- [ ] **Assinatura, ticket e Gatekeeper no app instalado.** Rodar:

  ```bash
  codesign --verify --deep --strict --verbose=2 /Applications/nod.app
  xcrun stapler validate /Applications/nod.app
  spctl --assess --type execute --verbose=2 /Applications/nod.app
  lipo -archs /Applications/nod.app/Contents/MacOS/nod
  ```

  Observar: `valid on disk` e `satisfies its Designated Requirement`; `The validate action worked!`; `accepted` com
  `source=Notarized Developer ID`; `lipo` mostra só a arquitetura deste Mac (`x86_64` no Intel, `arm64` no chip M).
  Reprova se: qualquer comando falha, o `spctl` diz `rejected`, ou o `lipo` mostra a arquitetura errada (DMG trocado).

## C. Primeira abertura

- [ ] **Servidor já preenchido.** Observar: a tela "Conectar ao nod" abre com o endereço HTTPS do servidor do time, que
  vem do build (`SERVIDOR_PADRAO`, de `NOD_SERVIDOR_PADRAO` em `scripts/desktop/build.mjs`). Reprova se: o campo vem
  vazio ou com outro endereço num usuário novo.
- [ ] **Entrar com Google e Conectar este Mac.** Observar: **Entrar com Google** abre o navegador padrão; depois do
  login, a página mostra **Conectar este Mac**; ao clicar, o app volta sozinho para a frente e abre o nod
  (`parearPeloNavegador`, ADR-069), e **Chaves** no navegador mostra uma chave nova com o nome deste Mac. Reprova se:
  o app não volta, pede para colar uma chave, mostra "O navegador não confirmou a tempo" ou "O nod não confirmou
  este Mac" (`mensagens.sem_resposta`, `mensagens.recusado`) sem que a pessoa tenha demorado ou recusado.
- [ ] **A conexão fica guardada.** Observar: `~/Library/Application Support/nod/conexao.enc` existe com modo
  `-rw-------` e não é texto legível (`guardar()` cifra com `safeStorage`, chave no Keychain). Reprova se: o arquivo
  falta, está legível ou com outra permissão.

## D. Primeiro turno

- [ ] **A IA é encontrada sem gastar turno.** Observar: com Claude Code (macOS 13+) ou Codex instalado e autenticado,
  o nod mostra a IA como pronta logo depois de conectar, sem turno no uso do plano (a sonda do
  `criarRegistryDetalhado` roda com `sondaSemTurno`, vigiada por `criarVigiaDasIas`). Se a versão está abaixo do
  `PISO_CLI`, aparece "desatualizada" com o comando de atualizar. Reprova se: a IA instalada aparece como "não
  encontrada"; o uso do plano sobe só por abrir o app.
- [ ] **Um turno real curto responde.** Observar: mandar "responda só ok" a um bot fixado na IA deste Mac; a resposta
  chega na conversa, e **Exportar diagnóstico** mostra a execução sem erro. Reprova se: o turno fica parado na fila,
  termina em erro ou a resposta vem de outro Mac. Anote o custo do turno no registro.

## E. Parar

- [ ] **Parar interrompe o turno.** Observar: mandar um pedido longo (por exemplo, "conte de 1 a 500 por extenso") e
  clicar em **Parar** durante a resposta; em até uns 2 segundos o texto para de crescer e o turno fecha como parado.
  O laço renova a cada 1 s (`iniciarLaco`, `renovar`) e aborta o executor quando o servidor manda parar. Reprova se:
  o texto continua chegando, o processo `claude`/`codex` segue vivo no Monitor de Atividade, ou o próximo turno
  não roda.

## F. Fechar e reabrir

- [ ] **Reabrir reconecta sem pedir nada.** Observar: Cmd+Q e abrir de novo; o app passa pela tela de conexão só de
  relance e abre o nod, sem login, sem chave nova em **Chaves** e sem pedir o Keychain (`ler()` decifra a conexão
  salva e `conectar()` usa a mesma chave). O URL salvo ganha do `SERVIDOR_PADRAO`. Reprova se: pede login ou chave,
  cria chave nova, ou fica na tela de conexão com mensagem.

## G. Revogar a chave

- [ ] **Revogar derruba o app.** Observar: com o app aberto, revogar a chave deste Mac em **Chaves**, no navegador; o
  app volta à tela de conexão com "Esta chave não é mais válida. Gere uma nova em Chaves no navegador."
  (`mensagens.chave_invalida`: o servidor responde 401/403, `conectar()` ou o laço chamam `falha()`, que para tudo e
  mostra a tela). Reprova se: o app continua conectado, trava, fica em laço de reconexão ou mostra outra mensagem.
- [ ] **Entrar de novo funciona.** Observar: **Entrar com Google** de novo conecta e cria uma chave nova em **Chaves**;
  um turno curto responde. Reprova se: a chave revogada volta a valer ou o novo pareamento falha.

## H1. Atualizar a partir da última preview publicada

Com a última preview instalada e conectada (a mais recente da [lista de releases](https://github.com/gamefik/nod/releases), sem assinatura), instalar o DMG novo por cima
(arrastar para **Aplicativos** e **Substituir**). A preview e o app assinado têm o mesmo `appId` (`app.nod.desktop`) e
a mesma pasta `Application Support/nod`; a assinatura nova é que pode mudar o acesso ao item do Keychain.

- [ ] **Instalar por cima.** Observar: o macOS pode pedir a senha do Mac uma vez para liberar o Keychain ao app novo;
  no aviso, digite a senha e clique em **Sempre permitir**. Depois abre normalmente. Com **Permitir**, o macOS
  pergunta de novo a cada abertura: isso não é falha do app; registre em Observações e repita com **Sempre
  permitir**. Reprova se: pede **Abrir mesmo assim**, pede a senha a cada abertura mesmo depois de **Sempre
  permitir**, trava ou abre tela
  branca.
- [ ] **Um dos dois desfechos aprovados.** Registre qual:
  - **(a)** o app reconecta com a mesma chave, sem chave nova em **Chaves** (`ler()` decifrou a conexão da preview);
  - **(b)** o app cai na tela de conexão (o `safeStorage` não decifrou a conexão da preview, `ler()` devolve `null`);
    a pessoa clica em **Entrar com Google**, conecta, e revoga a chave antiga em **Chaves**.

  Reprova se: trava, tela branca, laço entre tela de conexão e nod, mensagem de erro sem saída, ou, em (b), a chave
  antiga não aparece para revogar.
- [ ] **O microfone pode ser pedido de novo.** Observar: ao abrir uma ligação, o macOS pode perguntar de novo pelo
  microfone (NOD-165); aceitar e a ligação funciona. Reprova se: a ligação fica muda sem pergunta e sem aviso.
- [ ] **Compatibilidade com o servidor.** Observar: o servidor do time aceita esta versão (`conectar()` não recebe 426
  nem `x-nod-versao-minima` acima dela). Reprova se: aparece "Atualize o nod para continuar"
  (`mensagens.atualize_app`) com o app novo.

## H2. Atualizar a partir da 0.2.0-rc.1

Em **uma** arquitetura basta. A 0.2.0-rc.1 usava outro `appId` (`br.com.lumen.nod`, hoje é `app.nod.desktop`) e não tinha **Entrar com Google**: é o
pior caso.

- [ ] **O app novo abre e conecta.** Observar: com a 0.2.0-rc.1 instalada e conectada, instalar o DMG novo por cima
  (**Substituir**). Vale o mesmo critério de H1: (a) reconecta com a configuração salva, ou (b) cai na tela de
  conexão, conecta com **Entrar com Google** e a chave da 0.2.0-rc.1 é revogada em **Chaves**. Se (a) reconectou num
  servidor antigo, o URL salvo ganha do `SERVIDOR_PADRAO` (o handler `nod:estado` usa `configuracao?.url ?? SERVIDOR_PADRAO`, com a `configuracao` vinda de `ler()`); trocar por **Outro servidor ou chave manual**
  deve funcionar. Reprova se: trava, tela branca, laço, não deixa trocar o endereço, ou aparecem dois **nod** no Dock.

## I. Auto-update entre duas candidatas assinadas

**Não se aplica até a NOD-132** estar na versão. Quando estiver: com uma candidata assinada instalada, publicar a
seguinte e confirmar que o app avisa, baixa, reinicia na versão nova e reconecta como em F. Reprova se: não avisa,
baixa sem assinatura válida, ou perde a conexão.

## J. Jornada A: pessoa nova, nada instalado (ADA-242, `NOD_ONBOARDING_TEXTO=1`)

Spec `docs/specs/onboarding-jornada-a.md`, ADR-157. Rodar **duas vezes**: num Mac limpo e num Windows limpo (VM de QA,
ADA-233/235), sem Claude nem Codex instalados e sem pasta do app (`este-computador.json` ausente). Servidor com a flag
ligada e o Google configurado.

- [ ] **Conta sem senha.** Abrir o app, **Usar e-mail**: o cartão pede só o e-mail e manda um código; com o código, a
  conta existe. Reprova se: aparece campo de senha ou o código não chega.
- [ ] **Google dentro do app.** Numa segunda máquina limpa, **Continuar com Google**: o navegador do sistema abre; ao
  terminar lá, a aba diz "Pode fechar esta aba" e o app segue sozinho para "Conta criada" (ou a escolha, se o e-mail já
  tem conta). **Cancelar** no meio fecha a espera e nada muda. Reprova se: o app pede para colar algo, a conta liga sem
  o app voltar, ou o navegador mostra erro de redirect.
- [ ] **Este computador (2c → 2d → 2a).** Depois do "olá", a tela "Este computador" mostra Claude (recomendado) e
  ChatGPT com **Instalar e entrar**. Clicar no do Claude: instala, abre o login no navegador (2d, "Eu continuo daqui");
  ao entrar lá, a tela vira 2a ("O Claude já está aqui", "Conectado como …") e **Continuar** leva à conversa.
  Reprova se: aparece "Mac" no Windows (ou "Windows" no Mac), "Outras IAs" nesta tela, ou a ligação toca.
- [ ] **Estados de falha.** Com a rede cortada durante **Instalar e entrar**: 2e ("A instalação não terminou", **Tentar
  de novo**). Abrindo o login e não terminando por 2 min: 2f (**Conferir de novo**, **Abrir de novo**; no Mac, o campo
  do código do Claude). Com uma conta de organização sem acesso: 2g (**Entrar com outra conta**).
- [ ] **Pular por agora.** Numa máquina limpa, **Pular por agora**: vai à conversa por texto e o app abre sem IA (os
  bots avisam que estão sem IA). Fechar e reabrir o app: a tela "Este computador" **não** volta nesta máquina; numa
  reinstalação limpa (pasta do app apagada; no Windows, `%APPDATA%\nod-motor`), volta.
- [ ] **Conversa por texto.** Na conversa do Nod: "Posso te chamar de X?" (X do e-mail) e "o que você quer que os bots
  façam por você?" com os cinco chips; escolher um mostra os cards de sempre (Novo bot, app, rotina). **Pular as
  perguntas** encerra e deixa uma linha dizendo onde montar um bot. Reprova se: pergunta o tamanho do time ou não
  há como pular.
- [ ] **Flag desligada.** Com `NOD_ONBOARDING_TEXTO` desligada, o onboarding é o de antes (ligação, cadastro com senha,
  sem Google no app). Reprova se: algo da jornada A aparece.

## K. Computador novo com conta existente (jornada B, ADA-243)

Com `NOD_ONBOARDING_TEXTO=1` no servidor, uma conta que já concluiu o onboarding e cuja máquina padrão é um Mac
**desligado**. Num Windows limpo (VM de QA, ADA-233):

- [ ] **Oi de novo.** Instalar, entrar com o mesmo e-mail. Observar: o diálogo "Oi de novo, {nome}" com
  "este computador · {nome do PC}" e o estado real da IA daqui (pronta / instalada sem login / nada). A conversa com o
  Nod não recomeça. Reprova se: aparece "Mac", a conversa de boas-vindas volta, ou o estado é o do Mac.
- [ ] **Tela B.** Entrar no Claude Code pelo botão; quando ficar pronto, "Continuar". Observar: "Hoje seus bots
  trabalham no {Mac}, que está desligado." com **Manter no {Mac}** e **Trabalhar neste computador**. Escolher
  **Trabalhar neste computador** e mandar uma mensagem a um bot: responde daqui. Em Configurações › Computadores, este PC
  é a padrão (o mesmo seletor). Reprova se: a padrão não muda, ou o bot espera o Mac.
- [ ] **Manter.** Repetir com outra VM e escolher **Manter**. Mandar mensagem a um bot: a fila diz "Eu trabalho no
  {Mac}, que está desligado; começo quando ele voltar, ou mude meu computador em Configurações › Computadores" e o topo
  do bot diz "Trabalha no {Mac}, que está desligado". Reprova se: aparece "Turno interrompido" ou some mensagem.
- [ ] **Sem IA aqui.** Antes de entrar na IA, a barra e a fila dizem "Sem IA neste computador", nunca "Disponível".
- [ ] **Uma vez por máquina.** Fechar e reabrir: o diálogo não volta. Desinstalar apagando `%APPDATA%\nod-motor` e
  reinstalar: volta. Reprova se: aparece a cada abertura ou nunca mais depois da reinstalação limpa.
- [ ] **Pelo chat.** Pedir a um bot "trabalha neste computador a partir de agora": ele pergunta qual máquina (lista pelo
  nome) ou, com o nome, muda a padrão (`maquinas.definir_padrao`); a tela de computadores mostra o mesmo estado.

## L. Remover o nod deste computador (ADA-245, jornada D)

**Só com `NOD_ONBOARDING_TEXTO=1` no servidor** (a flag fica desligada até este roteiro passar). Em **Computadores**,
menu **…** do próprio computador, **Remover**. A spec é [onboarding-jornada-d](specs/onboarding-jornada-d.md).

- [ ] **Diálogo com os números de verdade.** Observar: o texto diz quantos bots rodam aqui e o nome do computador que
  assume (ou "esperam um computador", se for o único). Reprova se: número ou nome não batem com **Computadores**, ou
  aparece "motor", "máquina", "chave" ou "parear".
- [ ] **Windows, tudo marcado como padrão** (Tirar também ✓, Continuar ligado ✗). Observar no PowerShell, depois do Fim:
  `Get-ScheduledTask -TaskName 'nod*'` vazio; `Test-Path $env:LOCALAPPDATA\nod` e `Test-Path $env:LOCALAPPDATA\nod-motor`
  falsos; `Test-Path $env:USERPROFILE\.local\bin\claude.cmd` falso; o computador some de **Computadores** e
  reinstalar pede login. Reprova se: algum sobra, ou a tela de Fim fecha sozinha.
- [ ] **Windows, Tirar também ✗ e Continuar ligado ✓.** Observar: `claude.cmd` continua; `%LOCALAPPDATA%\nod\conexao.json`
  continua; reinstalar conecta sem login. Reprova se: pede login ou some o `claude.cmd`.
- [ ] **Fechar no Windows encerra o app.** Observar: **Fechar** na tela de Fim fecha a janela e o processo. Reprova se:
  o app fica aberto ou volta para a tela de conexão.
- [ ] **Mac.** Observar: com Tirar também ✓, `ls ~/Library/Application\ Support/nod/ferramentas` sem a IA que o nod
  instalou; o `.app` continua em **Aplicativos**; o computador sai de **Computadores**. **Fechar** volta para
  Computadores. Reprova se: o `.app` some, a IA fica, ou o computador segue na lista.
- [ ] **Pelo chat.** Observar: "remova o nod do <nome>" mostra o card **Remover o nod de <nome>?**; **Remover** chega
  ao mesmo estado da tela (bots no padrão, computador fora da lista, limpeza em instantes se ligado). Reprova se: roda
  sem o card ou o estado difere.
