# ADR-149 — Atualização automática do app do Mac pelo autoUpdater nativo (Squirrel.Mac)

Status: Aceita (2026-11-04, NOD-132; emenda aprovada pela Ada com o "executar agora" do Marlon) · Emenda o item (4) da
[ADR-020](adr-020-distribuicao-app-local-primeiro-web-obrigatoria-um-so-ad.md).

## Contexto

A ADR-020 (4) parou na versão mínima: o servidor manda `x-nod-versao-minima`, o app abaixo dela recebe 426
(`atualize_app`) e a pessoa baixa o DMG novo à mão. Na prática, cada release vira uma rodada de mensagens pedindo para
baixar e arrastar o app, e a versão mínima não pode subir sem deixar gente parada. A ADR-020 recusou o
`electron-updater` pelo custo (15.949 linhas vendorizadas no projeto de referência), não pela ideia de atualizar.

O Electron já traz o `autoUpdater` nativo, que no Mac é o Squirrel.Mac: zero dependência nova, baixa um ZIP, confere
que o app novo tem a **mesma assinatura de código** (Developer ID, Team 5FFF5696N4, NOD-133) e troca o app no lugar ao
reiniciar.

## Decisão

1. **autoUpdater nativo, sem `electron-updater` e sem dependência nova.** Só no Mac e só no app empacotado em
   /Applications; fora disso a atualização fica desligada com o motivo no menu (`desktop/atualizacao.ts`).
2. **O feed é do servidor do nod.** `GET /api/maquina/atualizacao?arch=arm64|x64`, com a chave da máquina, no protocolo
   de servidor do Squirrel (`serverType: "default"`; no modo `json` o 204 vira erro). Fica **fora da trava 426** de propósito: é o caminho do app velho voltar a trabalhar. Responde
   200 só com versão **estritamente maior** que `x-nod-versao`, sempre da mesma arquitetura; nunca há downgrade (versão
   ruim se corrige publicando outra mais nova). Versão inválida, igual ou menor ou flag desligada: 204. Falha ao assinar a
   URL: 503 (o app mostra o erro com o link do download, em vez de dizer que está em dia). A URL de cada objeto é
   reaproveitada por 3 min, para não chamar o `signBlob` a cada checagem.
3. **Os ZIPs ficam num bucket GCP privado** (`nod-exemplos-atualizacoes`, acesso uniforme, prevenção de acesso
   público). O servidor devolve uma URL assinada V4 de 10 min, assinada pela própria conta de serviço da VM via IAM
   `signBlob` (sem chave privada no disco, sem biblioteca do Google), com um papel custom que só tem
   `iam.serviceAccounts.signBlob` (não o `serviceAccountTokenCreator` inteiro; menor privilégio, sem escalada: é a própria SA da VM). A URL nunca vai para log, nem no servidor nem no
   app.
4. **Ligar e desligar é config.** `NOD_APP_VERSAO_PUBLICADA` vazia = desligada; preenchida, anuncia aquela versão e
   exige `NOD_APP_ATUALIZACAO_SHA256=arm64=<hex>,x64=<hex>`: o feed manda o `sha256` do ZIP. O Squirrel.Mac do
   Electron 43 (commit 0e5d146b) ainda não o confere (a conferência entrou em c4a95b0c); até o Electron trazê-la, a
   defesa é só a assinatura de código, e o hash prende o anúncio ao ZIP que o script conferiu. Formato, bucket ou hash inválidos derrubam o boot
   (a cor nova nunca fica saudável). Publicar é `scripts/desktop/publicar-atualizacao.sh v<versão>` (confere o SHA-256
   da release, nunca sobrescreve e só imprime o hash depois do upload) e depois as duas linhas no
   `infra/gcp/config.env` + deploy.
5. **O release gera e verifica o ZIP.** `electron-builder --mac dmg zip`; o `.app` de dentro do ZIP passa por
   `codesign --deep --strict`, `stapler validate` e `spctl` antes do upload, e entra no `SHA256-<arch>.txt`.
6. **Procura e aviso só no nativo.** 30 s depois de conectar e a cada 4 h, pelo menu (**Procurar atualizações…**) e na
   hora quando o servidor responde `atualize_app`. Pronta, o menu ganha **Reiniciar para atualizar (x.y.z)**, sai uma
   notificação e a tela de conexão mostra a linha. Sem faixa na web.
7. **Reiniciar nunca derruba trabalho sem perguntar.** Procura pelo menu responde numa caixa (em dia ou erro). Enquanto o
   Squirrel não responde, nenhuma procura nova reconfigura o feed (evita dois downloads). Em ligação, recusa; com turno no Mac ou tela aberta no
   computador do bot, confirma ("Reiniciar agora interrompe o trabalho"). Prazo da tela: 5 min na procura e 25 min no download (acima dos 20 min
   do Squirrel); 60 s depois do `quitAndInstall` sem o app fechar, sai (o ShipIt instala). Antes do `quitAndInstall`, para a ponte, a gravação da janela e a VM local. O lock de
   instância única é solto em `before-quit-for-update` (NOD-137), nunca em `before-quit`.

Fora de escopo: Windows, canal beta, progresso em %, subir `VERSAO_MINIMA_APP` (cada um é uma issue nova).

## Alternativas recusadas

- **`electron-updater`**: o motivo da ADR-020 continua de pé (custo de dependência e de código).
- **ZIP público no GitHub Releases**: o repo é privado; abrir os ZIPs exporia builds a quem não é do time e tiraria do
  servidor a decisão de quem recebe o quê.
- **Feed estático (`RELEASES.json` no bucket)**: o servidor perderia a régua "só maior, só da mesma arquitetura" e a
  chave da máquina como porta.

## Gatilho de reversão

Reverter para a ADR-020 (4) pura (esvaziar `NOD_APP_VERSAO_PUBLICADA` e, se preciso, tirar o código) se acontecer
qualquer um destes:

- uma atualização deixar um Mac sem abrir o app ou sem conseguir conectar, sem recuperação pelo DMG;
- o Squirrel.Mac exigir dependência nova, módulo nativo ou permissão extra do macOS para seguir funcionando;
- a URL assinada (ou a chave da máquina) aparecer em algum log, diagnóstico exportado ou relatório de erro.

Desligar é uma linha e um deploy; os apps que já baixaram instalam quando o app termina (o ShipIt já fica armado:
Cmd+Q, logout ou queda), e os que não baixaram seguem como estão.

## Riscos aceitos e o que falta antes de ligar a flag

- O Electron 43 não confere o `sha256` nem barra downgrade (`ElectronSquirrelPreventDowngrades` fora do Info.plist; o
  patch exige x.y.z sem rc). Quem escreve no bucket ou controla o servidor pode entregar qualquer build assinado pelo
  Team. Mitigação: escrita no bucket só pela conta de publicação; o app só procura no servidor oficial do build (mesma
  origem https de `__NOD_SERVIDOR_PADRAO__`; "Outro servidor" não atualiza); issue de seguimento para o bloqueio de
  downgrade.
- O lock de instância única solto em `before-quit-for-update` abre uma janela curta para uma segunda instância (NOD-137).
- UAT num Mac real (baixar, reiniciar, relançar, Keychain) antes de preencher `NOD_APP_VERSAO_PUBLICADA`.
