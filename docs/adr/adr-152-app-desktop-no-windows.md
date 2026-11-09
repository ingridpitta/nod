# ADR-152 — O app desktop no Windows

Status: proposta (2026-11-05, ADA-229) · Estende a [ADR-151](adr-151-instalador-do-motor-no-windows.md) (o app usa o
script `/windows` para instalar e subir o motor) e a [ADR-149](adr-149-atualizacao-automatica-do-app-do-mac.md) (o
mesmo feed e o mesmo coordenador de atualização, agora com `plataforma=windows`).

## Contexto

No Windows o nod é um comando (`irm https://nodbot.ai/windows | iex`) e um terminal. A pessoa quer o mesmo app do Mac:
um instalador, um ícone e a conversa numa janela, com a máquina conectada sem copiar código.

## Decisão

1. **Mesma base Electron do Mac, processo principal próprio.** `desktop/windows/main.ts` entra no build com
   `scripts/desktop/build.mjs --windows`; o `desktop/main.ts` do Mac (launchd, VM, Keychain) não roda no Windows.
   Ícone, `preload-web`, partition `nod-web` e o coordenador de `desktop/atualizacao.ts` são os mesmos.
2. **O executor continua sendo o motor da ADR-151**, por fora do Electron (Node portátil, tarefa agendada, reinício em
   falha). O app não roda turnos: conecta, instala, vigia e mostra.
3. **Conectar pelo fluxo de dispositivo** (`/api/pareamento/dispositivo`, `plataforma: "win32"`). O app abre o navegador
   sozinho e mostra o código só para conferência; a chave vai para `%APPDATA%\nod-motor\conexao.json` com
   `guardarConexao`, o mesmo arquivo que o motor lê.
   **Revisto em 2026-11-05 (primeiro teste real, vídeo do Marlon):** o fluxo de dispositivo exige uma conta já
   existente para confirmar o código, e o link `?parear-maquina=` aberto numa aba sem sessão caía no espaço provisório
   da web (sem máquina), travando no onboarding. Pessoa nova não tinha caminho. Agora o app faz como o Mac
   (NOD-345/NOD-406): sem conexão guardada e sem a marca `equipe`, pede `POST /api/conta/provisorio` (forma "app") com
   o verificador da instalação cifrado pelo DPAPI (`safeStorage`) e recebe a chave de máquina do espaço provisório, que
   vai ao mesmo `conexao.json`; a conta é criada de dentro (o provisório vira a conta, a chave segue válida). O Conectar
   por código fica para quem já tem conta (e marca `equipe`, para uma conexão perdida não virar provisório). Na web, o
   código de máquina pendente conta como pareamento e vai à tela de entrar (#679), e os textos "neste Mac" do
   onboarding leem o sistema do user-agent (`web/lib/plataforma-da-tela.ts`).
4. **Instalar = o script `/windows` num PowerShell oculto.** Como a conexão já existe, o script pula o pareamento e só
   instala Git, Node, IAs e motor e sobe a tarefa. O app mostra o progresso e o resultado (`NOD_INSTALACAO_RESULTADO`).
5. **Janela = `POST /api/maquina/sessao`** com a chave da máquina, cookie `nod_sessao` na partition `nod-web`. 401 apaga a
   conexão e volta para o Conectar.
6. **Vigia do motor a cada 30 s**: tarefa `nod-motor-<SID>` ou `node.exe` com o `app` do motor; parado, religa pela
   tarefa.
7. **Atualização própria, sem electron-updater.** Feed `GET /api/maquina/atualizacao?plataforma=windows&arch=x64`,
   objeto `${v}/nod-${v}-win-x64.exe`, sha256 em `NOD_APP_ATUALIZACAO_SHA256` com a chave `win-x64=`. Sem a chave, 204
   (nada a oferecer). O app baixa, confere o sha256 e roda o NSIS com `/S --updated --force-run`
   (o silencioso sozinho não reabre o app).
8. **Instalador NSIS de 1 clique, por usuário**, sem UAC, atalhos no Menu Iniciar e na Área de Trabalho, abre o app no
   fim. Montado pelo electron-builder com `electron-builder-windows.yml` (sem os extraResources do Mac), em
   `%LOCALAPPDATA%\Programs\nod`. O nome estável continua `nod-windows-x64.exe` no bucket `nodbot-downloads`, então
   `/download/windows` não muda, mas passa a ser o app. O `.exe` da ADA-226 (só o instalador do motor) sai da release e
   segue testado na CI até ser removido (follow-up).
9. **Assinatura atrás de flag** (`NOD_WINDOWS_ASSINAR=1` + `WIN_CSC_LINK`), desligada até o certificado (NOD-471). Até lá o
   SmartScreen avisa na primeira execução, como no OpenMausBot.

10. **Login das IAs pela janela (revisão de 5/11/2026, segundo teste real).** A janela web levava zero ponte, então o
    "Entrar" dos cartões de IA caía no texto de fora do app ("rode `claude auth login`") e a pessoa travava. A janela
    passa a ter a ponte mínima `window.nodDesktop` com `iaEntrar`/`iaInstalar` (`preload-web-windows.ts`, só contratos),
    e o processo principal roda o login do próprio CLI como o Mac (ADR-077): sem shell, desanexado, sem janela, ambiente
    limpo; o `.cmd` do npm vira `node <script>` (ADR-147) com o Node do motor. Quem percebe o login é a vigia do motor.
    O resto da ponte do Mac (avisos, contas, mídia, teste das IAs) segue de fora: a web trata tudo como opcional.

## Consequências

- Dois processos principais no desktop: correção de navegação ou sessão feita num deve ser conferida no outro.
- O app depende do script `/windows`: se ele mudar o contrato (`NOD_INSTALACAO_RESULTADO`, ramo com conexão), o app
  quebra. O teste do app na CI Windows instala de verdade.

## Gatilho de reversão

Se o Node portátil ou a tarefa agendada derem mais trabalho que o motor dentro do Electron (`ELECTRON_RUN_AS_NODE`),
reavaliar o item 2.
