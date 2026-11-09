# ADA-226: o nod-windows-x64.exe no Windows de verdade (windows-latest), como a pessoa o usaria, contra o servidor de
# teste em loopback, com NOD_INSTALAR_ATE=pareamento (o pareamento pede a conta de uma pessoa).
#   1. endereco invalido: sai com 2 e nao instala nada;
#   2. instalacao silenciosa (/S): codigo 0, o que a ADA-32 deixa (conferir-instalacao.ps1), atalhos e o desinstalador;
#   3. desinstalacao silenciosa: tira a tarefa, o Path, os atalhos e a chave; a conexao fica;
#   4. instalacao pela janela, so com cliques (Enter no botao Instalar e no Concluir, com "Abrir o Nod" marcado), com os
#      prints de cada passo em -Prints.
# Uso: testar-exe.ps1 -Exe dist\windows\nod-windows-x64.exe -Prints prints [-Porta 8765]
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Prints,
  [int]$Porta = 8765
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Exigir([bool]$Condicao, [string]$Texto) { if (-not $Condicao) { throw ('instalador .exe: ' + $Texto) } }

$Exe = (Resolve-Path -LiteralPath $Exe).Path
New-Item -ItemType Directory -Path $Prints -Force | Out-Null
$Prints = (Resolve-Path -LiteralPath $Prints).Path
$versao = (node -p "require('./package.json').version" | Out-String).Trim()
$servidor = 'http://127.0.0.1:' + $Porta
$pasta = Join-Path $env:LOCALAPPDATA 'nod'
$chave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\nod'
$atalhos = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'Nod.url'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Nod.url'))
$nomeDaTarefa = 'nod-motor-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Tirar([string]$Nome) {
  $tela = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $imagem = New-Object System.Drawing.Bitmap $tela.Width, $tela.Height
  $g = [System.Drawing.Graphics]::FromImage($imagem)
  try {
    $g.CopyFromScreen($tela.Location, [System.Drawing.Point]::Empty, $tela.Size)
    $imagem.Save((Join-Path $Prints ($Nome + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally { $g.Dispose(); $imagem.Dispose() }
  Write-Output ('print: ' + $Nome)
}

function Rodar([string[]]$Argumentos) {
  $p = Start-Process -FilePath $Exe -ArgumentList $Argumentos -PassThru
  $null = $p.Handle
  if (-not $p.WaitForExit(1200000)) { Stop-Process -Id $p.Id -Force; throw 'instalador .exe: passou de 20 min' }
  return $p.ExitCode
}

function ConferirAtalhosEChave {
  foreach ($a in $atalhos) {
    Exigir (Test-Path -LiteralPath $a) ('sem o atalho ' + $a)
    Exigir ((Get-Content -LiteralPath $a) -contains ('URL=' + $servidor)) ('o atalho ' + $a + ' nao abre ' + $servidor)
  }
  $info = Get-ItemProperty -Path $chave
  Exigir ($info.DisplayName -eq 'Nod') 'Aplicativos: sem o Nod'
  Exigir ($info.DisplayVersion -eq $versao) ('Aplicativos: versao ' + $info.DisplayVersion + ' (esperado ' + $versao + ')')
  Exigir ($info.QuietUninstallString -like '*desinstalar-nod.exe" /S') 'Aplicativos: sem a desinstalacao silenciosa'
  Exigir (Test-Path -LiteralPath (Join-Path $pasta 'desinstalar-nod.exe')) 'sem o desinstalador'
}

$srv = Start-Process -FilePath 'node' -ArgumentList @('node_modules\tsx\dist\cli.mjs', 'scripts\windows\servidor-de-teste.ts', [string]$Porta) -PassThru -NoNewWindow -RedirectStandardOutput "$env:RUNNER_TEMP\srv-exe.log" -RedirectStandardError "$env:RUNNER_TEMP\srv-exe.err"
try {
  $ate = (Get-Date).AddSeconds(60)
  while ($true) {
    try { $null = Invoke-WebRequest -Uri "$servidor/api/motor/manifesto" -UseBasicParsing; break } catch { if ((Get-Date) -gt $ate) { Get-Content "$env:RUNNER_TEMP\srv-exe.err"; throw 'o servidor de teste nao subiu' }; Start-Sleep -Seconds 1 }
  }

  Write-Output '== 1. endereco invalido'
  if (Test-Path $chave) { Remove-Item -Path $chave -Recurse -Force }
  $codigo = Rodar @('/S', '/SERVIDOR=http://exemplo.com')
  Exigir ($codigo -eq 2) ('endereco invalido saiu com ' + $codigo + ' (esperado 2)')
  Exigir (-not (Test-Path $chave)) 'endereco invalido registrou o Nod em Aplicativos'

  Write-Output '== 2. instalacao silenciosa'
  $codigo = Rodar @('/S', ('/SERVIDOR=' + $servidor))
  Exigir ($codigo -eq 0) ('a instalacao silenciosa saiu com ' + $codigo)
  $env:NOD_INSTALACAO_RESULTADO = 'ok'
  & .\scripts\windows\conferir-instalacao.ps1 -Servidor $servidor -Versao $versao
  ConferirAtalhosEChave
  Write-Output 'instalacao silenciosa conferida'

  Write-Output '== 3. desinstalacao silenciosa'
  $conexao = Join-Path $env:APPDATA 'nod-motor\conexao.json'
  $tinhaConexao = Test-Path -LiteralPath $conexao
  # A chave Run e a reserva da ADA-32 quando a politica recusa a tarefa; aqui a tarefa sobe, entao ela e plantada.
  $chaveRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  # Nem toda imagem do runner traz a chave Run no HKCU (run 41962535864): cria antes de plantar.
  if (-not (Test-Path $chaveRun)) { New-Item -Path $chaveRun -Force | Out-Null }
  New-ItemProperty -Path $chaveRun -Name $nomeDaTarefa -Value 'nod-teste' -PropertyType String -Force | Out-Null
  $null = Start-Process -FilePath (Join-Path $pasta 'desinstalar-nod.exe') -ArgumentList '/S' -PassThru -Wait
  # O NSIS roda uma copia do desinstalador no temporario e o original sai antes: espera a chave e a pasta sumirem.
  $ate = (Get-Date).AddSeconds(180)
  # E o desinstalador soltar a trava de um-por-vez: senao a janela do passo 4 sai com 5.
  $trava = $null
  while ((Test-Path $chave) -or (Test-Path -LiteralPath $pasta) -or [Threading.Mutex]::TryOpenExisting('Local\nod-instalador', [ref]$trava)) {
    if ($null -ne $trava) { $trava.Dispose(); $trava = $null }
    if ((Get-Date) -gt $ate) { throw 'instalador .exe: a desinstalacao nao terminou em 3 min' }
    Start-Sleep -Seconds 2
  }
  Exigir ($null -eq (Get-ScheduledTask -TaskName $nomeDaTarefa -TaskPath '\' -ErrorAction SilentlyContinue)) 'sobrou a tarefa do motor'
  Exigir ($null -eq (Get-ItemProperty -Path $chaveRun -Name $nomeDaTarefa -ErrorAction SilentlyContinue)) 'sobrou a chave Run do motor'
  foreach ($a in $atalhos) { Exigir (-not (Test-Path -LiteralPath $a)) ('sobrou o atalho ' + $a) }
  $pathUsuario = [string](Get-ItemProperty -Path 'HKCU:\Environment' -Name Path -ErrorAction SilentlyContinue).Path
  foreach ($p in @((Join-Path $pasta 'bin'), (Join-Path $pasta 'node'))) {
    Exigir (-not (($pathUsuario -split ';') | Where-Object { $_.TrimEnd('\') -ieq $p })) ('sobrou ' + $p + ' no Path')
  }
  Exigir ($null -eq [Environment]::GetEnvironmentVariable('NOD_INSTALADO_EM', 'User')) 'sobrou NOD_INSTALADO_EM'
  if ($tinhaConexao) { Exigir (Test-Path -LiteralPath $conexao) 'a desinstalacao apagou a conexao' }
  # ADA-245: os dados do motor saem junto (o /S mantem a conexao e as IAs, como antes).
  Exigir (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'nod-motor'))) 'sobrou %LOCALAPPDATA%\nod-motor'
  Write-Output 'desinstalacao conferida'

  Write-Output '== 4. instalacao pela janela'
  $janela = Start-Process -FilePath $Exe -ArgumentList ('/SERVIDOR=' + $servidor) -PassThru
  $null = $janela.Handle
  $wsh = New-Object -ComObject WScript.Shell
  Start-Sleep -Seconds 4
  Tirar '1-boas-vindas'
  Exigir ($wsh.AppActivate($janela.Id)) 'a janela do instalador nao apareceu'
  $wsh.SendKeys('{ENTER}')
  Start-Sleep -Seconds 20
  Tirar '2-instalando'
  $ate = (Get-Date).AddMinutes(20)
  while (-not (Test-Path $chave)) {
    if ($janela.HasExited) { throw ('instalador .exe: a janela fechou com ' + $janela.ExitCode + ' antes de terminar') }
    if ((Get-Date) -gt $ate) { Tirar '2-travou'; throw 'instalador .exe: a janela nao terminou em 20 min' }
    Start-Sleep -Seconds 3
  }
  Start-Sleep -Seconds 3
  Tirar '3-pronto'
  Exigir ($wsh.AppActivate($janela.Id)) 'a janela do instalador sumiu antes do Concluir'
  $wsh.SendKeys('{ENTER}')
  Exigir ($janela.WaitForExit(60000)) 'o Concluir nao fechou o instalador'
  Exigir ($janela.ExitCode -eq 0) ('a janela saiu com ' + $janela.ExitCode)
  Start-Sleep -Seconds 8
  Tirar '4-nod-aberto'
  & .\scripts\windows\conferir-instalacao.ps1 -Servidor $servidor -Versao $versao
  ConferirAtalhosEChave
  Write-Output 'instalacao pela janela conferida'
} finally {
  Stop-Process -Id $srv.Id -Force -ErrorAction SilentlyContinue
  $log = Join-Path $pasta 'instalador.log'
  if (Test-Path $log) { Get-Content $log -Tail 60 }
}
