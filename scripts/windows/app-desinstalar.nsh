; ADA-245 (jornada D): o desinstalador do app do Windows (electron-builder-windows.yml, nsis.include) tambem remove o
; motor: roda `nod-motor desinstalar` (motor/desinstalar.ts) com o Node e o motor da instalacao da ADR-151, em
; %LOCALAPPDATA%\nod. O nod-motor roda de dentro da pasta que sai, entao a pasta sai segundos depois dele (a limpeza
; destacada do modo "terminal").
;
; Quando NAO roda: na atualizacao do app (o NSIS novo roda o desinstalador antigo com --updated) e quando o motor ja
; nao esta la (o "Remover o nod deste computador" do app ja limpou e o Fechar so tira o app de Aplicativos).
; As escolhas: /MANTERIAS e /MANTERCONEXAO respondem sem perguntar. Sem elas e sem /S, pergunta; o desinstalador de
; 1 clique fica silencioso depois do "Tem certeza?", entao as perguntas vao sem /SD, e qualquer resposta que nao vier
; (silencioso de verdade, /S) cai no lado que guarda: as IAs e a conexao ficam, como no desinstalador da ADA-226.

!macro NodTemOpcao OPCAO
  ; $R2 = "1" quando OPCAO esta na linha de comando (o == do NSIS ignora maiusculas). Sem GetOptions: so a presenca conta.
  StrCpy $R2 ""
  StrCpy $R1 "${OPCAO}"
  StrLen $R3 $R1
  StrLen $R4 $R0
  StrCpy $R5 0
  ${DoWhile} $R5 < $R4
    StrCpy $R6 $R0 $R3 $R5
    ${If} $R6 == $R1
      StrCpy $R2 "1"
      ${ExitDo}
    ${EndIf}
    IntOp $R5 $R5 + 1
  ${Loop}
!macroend

!macro customUnInstall
  ${IfNot} ${isUpdated}
  ${AndIf} ${FileExists} "$LOCALAPPDATA\nod\node\node.exe"
  ${AndIf} ${FileExists} "$LOCALAPPDATA\nod\motor\app\nod-motor.mjs"
    Var /GLOBAL NodOpcoes
    StrCpy $NodOpcoes ""
    System::Call 'kernel32::GetCommandLine() t .R0'
    !insertmacro NodTemOpcao "/S"
    StrCpy $R7 $R2
    !insertmacro NodTemOpcao "/MANTERIAS"
    ${If} $R2 == "1"
    ${OrIf} $R7 == "1"
      StrCpy $NodOpcoes "$NodOpcoes --manter-ias"
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Tirar também o Claude e o ChatGPT instalados pelo nod?$\r$\n$\r$\nSeus logins neles são seus e ficam." IDYES +2
      StrCpy $NodOpcoes "$NodOpcoes --manter-ias"
    ${EndIf}
    !insertmacro NodTemOpcao "/MANTERCONEXAO"
    ${If} $R2 == "1"
    ${OrIf} $R7 == "1"
      StrCpy $NodOpcoes "$NodOpcoes --manter-conexao"
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION "Continuar ligado à sua conta?$\r$\n$\r$\nAssim, instalar de novo entra sem login. Sem isso, a conexão deste computador é apagada." IDNO +2
      StrCpy $NodOpcoes "$NodOpcoes --manter-conexao"
    ${EndIf}
    DetailPrint "Removendo o nod deste computador..."
    nsExec::ExecToLog '"$LOCALAPPDATA\nod\node\node.exe" "$LOCALAPPDATA\nod\motor\app\nod-motor.mjs" desinstalar$NodOpcoes'
    Pop $R8
    DetailPrint "nod-motor desinstalar saiu com $R8"
    ${If} $R8 != "0"
      ; Revisao do PR #694: o motor de antes da ADA-245 nao conhece `desinstalar` (o app atualiza, o motor no Windows
      ; nao). A limpeza em PowerShell do desinstalador do .exe vai dentro deste desinstalador e roda no lugar dele,
      ; com as mesmas escolhas; depois a pasta do motor sai, como no modo "terminal" do motor.
      InitPluginsDir
      File "/oname=$PLUGINSDIR\desinstalar.ps1" "${PROJECT_DIR}\scripts\windows\desinstalar.ps1"
      StrCpy $R9 ""
      StrCpy $R0 $NodOpcoes
      !insertmacro NodTemOpcao "--manter-ias"
      ${If} $R2 == "1"
        StrCpy $R9 "$R9 -ManterIas"
      ${EndIf}
      !insertmacro NodTemOpcao "--manter-conexao"
      ${If} $R2 == "1"
        StrCpy $R9 "$R9 -ManterConexao"
      ${EndIf}
      nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\desinstalar.ps1"$R9'
      Pop $R8
      DetailPrint "desinstalar.ps1 saiu com $R8"
      RMDir /r "$LOCALAPPDATA\nod"
    ${EndIf}
  ${EndIf}
!macroend
