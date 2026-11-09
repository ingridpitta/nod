; ADA-226: o instalador .exe do Nod no Windows (montado por scripts/windows/gerar-exe.mjs).
; Por usuario, sem admin: roda o instalador da ADA-32 (ADR-151) num PowerShell escondido, com a saida nesta janela,
; cria os atalhos "Nod" e o desinstalador em Configuracoes > Aplicativos. O Electron no Windows segue na Fase 3.
; /S instala sem janela; /SERVIDOR=<https://...> so para a CI e o suporte (o .ps1 valida o endereco).
Unicode true
ManifestDPIAware true

!ifndef VERSAO
  !define VERSAO "0.0.0"
!endif
!ifndef VERSAO_NUM
  !define VERSAO_NUM "0.0.0.0"
!endif
!ifndef SAIDA
  !define SAIDA "nod-windows-x64.exe"
!endif
!ifndef ICONE
  !define ICONE "nod.ico"
!endif
!define SERVIDOR_PADRAO "https://app.nodbot.ai"
!define CHAVE_DESINSTALAR "Software\Microsoft\Windows\CurrentVersion\Uninstall\nod"
!define DESINSTALADOR "desinstalar-nod.exe"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "Nod"
Caption "Instalar o Nod"
OutFile "${SAIDA}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\nod"
ShowInstDetails show
ShowUninstDetails show
SetCompressor /SOLID lzma
BrandingText "Nod ${VERSAO}"

VIProductVersion "${VERSAO_NUM}"
VIAddVersionKey "ProductName" "Nod"
VIAddVersionKey "CompanyName" "Gamefik"
VIAddVersionKey "FileDescription" "Instalador do Nod"
VIAddVersionKey "FileVersion" "${VERSAO}"
VIAddVersionKey "ProductVersion" "${VERSAO}"
VIAddVersionKey "LegalCopyright" "Gamefik"

Var Servidor
Var PowerShell
Var Opcoes

!define MUI_ICON "${ICONE}"
!define MUI_UNICON "${ICONE}"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "A instalação ainda não terminou. Quer mesmo sair?"

!define MUI_WELCOMEPAGE_TITLE "Instalar o Nod"
!define MUI_WELCOMEPAGE_TEXT "O instalador prepara este computador para o Nod e o conecta à sua conta.$\r$\n$\r$\nNo meio da instalação o navegador abre com um código: entre na sua conta e confirme. Depois disso o Nod abre sozinho.$\r$\n$\r$\nClique em Instalar para começar."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "O Nod está pronto"
!define MUI_FINISHPAGE_TEXT "O Nod está instalado e conectado. Ele também fica no Menu Iniciar e na Área de Trabalho."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o Nod"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirONod
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "PortugueseBR"

; O NSIS e 32 bits: pelo Sysnative o PowerShell e o de 64 bits (o Agendador e o Path do usuario sao os mesmos, mas o
; Node e o Git que a ADA-32 instala sao x64). Caminho absoluto: nada do Path da pessoa entra no lugar.
!macro AcharPowerShell
  StrCpy $PowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${IfNot} ${FileExists} "$PowerShell"
    StrCpy $PowerShell "$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

; Dois instaladores (ou instalador e desinstalador) ao mesmo tempo rodariam duas ADA-32 na mesma pasta (o clique duplo
; enquanto o SmartScreen demora). A trava e do processo: o Windows a solta quando ele sai. 183 = ERROR_ALREADY_EXISTS.
!macro UmInstaladorPorVez
  System::Call 'Kernel32::CreateMutex(p 0, i 0, t "Local\nod-instalador") p .r8 ?e'
  Pop $7
  ${If} $7 == 183
    MessageBox MB_ICONEXCLAMATION|MB_OK "O instalador do Nod já está aberto. Termine aquele antes de abrir outro." /SD IDOK
    SetErrorLevel 5
    Abort
  ${EndIf}
!macroend

Function .onInit
  !insertmacro UmInstaladorPorVez
  ; A pasta e sempre a da ADA-32: /D= nao a troca (o desinstalador apagaria com RMDir /r a pasta que viesse no /D=).
  StrCpy $INSTDIR "$LOCALAPPDATA\nod"
  InitPluginsDir
  StrCpy $Servidor "${SERVIDOR_PADRAO}"
  ${GetParameters} $0
  Call LerServidor
FunctionEnd

; O valor de /SERVIDOR= vai ate o primeiro espaco. Nao use o GetOptions do FileFunc: ele corta o valor no primeiro "/" (o
; separador e o primeiro caractere da opcao), e "/SERVIDOR=http://127.0.0.1:8765" virava "http:" (medido em 2026-11-05
; no job windows da CI: a instalacao silenciosa saiu com 2 em 0,5 s, sem rodar a ADA-32).
Function LerServidor
  StrLen $2 $0
  StrCpy $3 0
  ${DoWhile} $3 < $2
    StrCpy $4 $0 10 $3
    ${If} $4 == "/SERVIDOR="
      IntOp $3 $3 + 10
      StrCpy $1 $0 "" $3
      StrCpy $5 0
      ${Do}
        StrCpy $4 $1 1 $5
        ${If} $4 == ""
        ${OrIf} $4 == " "
          ${ExitDo}
        ${EndIf}
        IntOp $5 $5 + 1
      ${Loop}
      StrCpy $Servidor $1 $5
      Return
    ${EndIf}
    IntOp $3 $3 + 1
  ${Loop}
FunctionEnd

Function AbrirONod
  ExecShell "open" "$Servidor"
FunctionEnd

Section "Nod" SecNod
  SetDetailsPrint both
  File "/oname=$PLUGINSDIR\instalar-pelo-exe.ps1" "instalar-pelo-exe.ps1"
  ; O servidor vai pelo ambiente do processo filho, nunca dentro da linha de comando. Pelo registrador: com o texto
  ; dentro do System::Call um " no endereco quebraria a chamada e o .ps1 validaria o valor herdado, nao este.
  StrCpy $1 $Servidor
  System::Call 'Kernel32::SetEnvironmentVariable(t "NOD_EXE_SERVIDOR", t r1) i .r9'
  !insertmacro AcharPowerShell
  DetailPrint "Instalando o Nod. Isso leva alguns minutos; não feche esta janela."
  nsExec::ExecToLog '"$PowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\instalar-pelo-exe.ps1"'
  Pop $0
  ${If} $0 != "0"
    DetailPrint "A instalação parou (código $0). Detalhes em $LOCALAPPDATA\nod\instalador.log"
    MessageBox MB_ICONSTOP|MB_OK "A instalação do Nod não terminou.$\r$\n$\r$\nO motivo está nesta janela e em $LOCALAPPDATA\nod\instalador.log. Confira a internet e abra o instalador de novo." /SD IDOK
    ${If} $0 == "1"
    ${OrIf} $0 == "2"
    ${OrIf} $0 == "3"
      SetErrorLevel $0
    ${Else}
      SetErrorLevel 4
    ${EndIf}
    Abort
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "/oname=$INSTDIR\nod.ico" "${ICONE}"
  File "/oname=$INSTDIR\desinstalar.ps1" "desinstalar.ps1"
  WriteUninstaller "$INSTDIR\${DESINSTALADOR}"

  ; Atalho de internet: "Abrir o Nod" e o Nod web, com o motor desta maquina conectado.
  WriteINIStr "$INSTDIR\Nod.url" "InternetShortcut" "URL" "$Servidor"
  WriteINIStr "$INSTDIR\Nod.url" "InternetShortcut" "IconFile" "$INSTDIR\nod.ico"
  WriteINIStr "$INSTDIR\Nod.url" "InternetShortcut" "IconIndex" "0"
  CopyFiles /SILENT "$INSTDIR\Nod.url" "$SMPROGRAMS\Nod.url"
  CopyFiles /SILENT "$INSTDIR\Nod.url" "$DESKTOP\Nod.url"

  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "DisplayName" "Nod"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "DisplayVersion" "${VERSAO}"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "Publisher" "Gamefik"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "DisplayIcon" "$INSTDIR\nod.ico"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "URLInfoAbout" "$Servidor"
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "UninstallString" '"$INSTDIR\${DESINSTALADOR}"'
  WriteRegStr HKCU "${CHAVE_DESINSTALAR}" "QuietUninstallString" '"$INSTDIR\${DESINSTALADOR}" /S'
  WriteRegDWORD HKCU "${CHAVE_DESINSTALAR}" "NoModify" 1
  WriteRegDWORD HKCU "${CHAVE_DESINSTALAR}" "NoRepair" 1
  DetailPrint "Pronto: o Nod está instalado e conectado."
SectionEnd

Function un.onInit
  !insertmacro UmInstaladorPorVez
  ; A copia do desinstalador em outra pasta nao apaga aquela pasta: so a do Nod.
  StrCpy $INSTDIR "$LOCALAPPDATA\nod"
FunctionEnd

; ADA-245: a opcao esta na linha de comando ($R0)? $R1 = a opcao (ex.: "/MANTERIAS"); $R2 = "1" ou "". O == do NSIS
; ignora maiusculas. Sem o GetOptions (ver LerServidor) e sem valor: so a presenca da palavra conta.
Function un.TemOpcao
  StrCpy $R2 ""
  StrLen $R3 $R1
  StrLen $R4 $R0
  StrCpy $R5 0
  ${DoWhile} $R5 < $R4
    StrCpy $R6 $R0 $R3 $R5
    ${If} $R6 == $R1
      StrCpy $R2 "1"
      Return
    ${EndIf}
    IntOp $R5 $R5 + 1
  ${Loop}
FunctionEnd

; ADA-245 (jornada D): as duas escolhas do "Remover o nod deste computador" do app. /MANTERIAS e /MANTERCONEXAO
; respondem sem perguntar; sem elas a janela pergunta, e o /S (a CI, o suporte) mantem as duas, como antes da ADA-245.
Function un.EscolherOpcoes
  StrCpy $Opcoes ""
  System::Call 'kernel32::GetCommandLine() t .R0'
  StrCpy $R1 "/MANTERIAS"
  Call un.TemOpcao
  ${If} $R2 == "1"
    StrCpy $Opcoes "$Opcoes -ManterIas"
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION "Tirar também o Claude e o ChatGPT instalados pelo Nod?$\r$\n$\r$\nSeus logins neles são seus e ficam." /SD IDNO IDYES +2
    StrCpy $Opcoes "$Opcoes -ManterIas"
  ${EndIf}
  StrCpy $R1 "/MANTERCONEXAO"
  Call un.TemOpcao
  ${If} $R2 == "1"
    StrCpy $Opcoes "$Opcoes -ManterConexao"
  ${Else}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Continuar ligado à sua conta?$\r$\n$\r$\nAssim, instalar de novo entra sem login. Sem isso, a conexão deste computador é apagada." /SD IDYES IDNO +2
    StrCpy $Opcoes "$Opcoes -ManterConexao"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetDetailsPrint both
  !insertmacro AcharPowerShell
  ${If} ${FileExists} "$INSTDIR\desinstalar.ps1"
    Call un.EscolherOpcoes
    nsExec::ExecToLog '"$PowerShell" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\desinstalar.ps1"$Opcoes'
    Pop $0
  ${EndIf}
  Delete "$SMPROGRAMS\Nod.url"
  Delete "$DESKTOP\Nod.url"
  DeleteRegKey HKCU "${CHAVE_DESINSTALAR}"
  ; So apaga a pasta do Nod: o desinstalador mora nela (o NSIS roda uma copia do temporario).
  ${If} ${FileExists} "$INSTDIR\${DESINSTALADOR}"
    RMDir /r "$INSTDIR"
  ${EndIf}
SectionEnd
