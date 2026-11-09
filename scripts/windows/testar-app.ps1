# ADA-229 (ADR-152): o app desktop do Windows (nod-windows-x64.exe, NSIS de 1 clique do electron-builder) no Windows de
# verdade (windows-latest):
#   1. instalacao silenciosa (/S): codigo 0, o nod.exe em %LOCALAPPDATA%\Programs\nod, os atalhos nod.lnk no Menu
#      Iniciar e na Area de Trabalho e o nod em Aplicativos (HKCU), na versao do package.json;
#   2. abrir: o app fica de pe (a tela de Conectar), com um print em -Prints; fechar;
#   3. desinstalacao silenciosa: some o nod.exe, os atalhos e a chave de Aplicativos.
# Uso: testar-app.ps1 -Exe release\nod-windows-x64.exe -Prints prints
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Prints
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Exigir([bool]$Condicao, [string]$Texto) { if (-not $Condicao) { throw ('app do Windows: ' + $Texto) } }

$Exe = (Resolve-Path -LiteralPath $Exe).Path
New-Item -ItemType Directory -Path $Prints -Force | Out-Null
$Prints = (Resolve-Path -LiteralPath $Prints).Path
$versao = (node -p "require('./package.json').version" | Out-String).Trim()
$pasta = Join-Path $env:LOCALAPPDATA 'Programs\nod'
$app = Join-Path $pasta 'nod.exe'
$atalhos = @((Join-Path ([Environment]::GetFolderPath('Programs')) 'nod.lnk'), (Join-Path ([Environment]::GetFolderPath('Desktop')) 'nod.lnk'))
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

function Rodar([string]$Arquivo, [string[]]$Argumentos) {
  $p = Start-Process -FilePath $Arquivo -ArgumentList $Argumentos -PassThru
  $null = $p.Handle
  if (-not $p.WaitForExit(600000)) { Stop-Process -Id $p.Id -Force; throw ('app do Windows: ' + $Arquivo + ' passou de 10 min') }
  return $p.ExitCode
}

function ChaveDoApp {
  Get-ChildItem -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | ForEach-Object { Get-ItemProperty -Path $_.PSPath } | Where-Object { $_.DisplayName -like 'nod*' -and $_.UninstallString -like ('*' + $pasta + '*') }
}

function ProcessosDoApp {
  @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'nod.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($pasta, [StringComparison]::OrdinalIgnoreCase) })
}

function Esperar([scriptblock]$Condicao, [int]$Segundos, [string]$Texto) {
  $ate = (Get-Date).AddSeconds($Segundos)
  $ultimo = $null
  # Arquivo com exclusao pendente (o desinstalador ainda apagando) faz o Test-Path dar
  # "Access denied": conta como "ainda nao" e tenta de novo ate o prazo.
  while ($true) {
    try { if (& $Condicao) { return } } catch { $ultimo = $_.Exception.Message }
    if ((Get-Date) -gt $ate) { throw ('app do Windows: ' + $Texto + $(if ($ultimo) { ' (' + $ultimo + ')' } else { '' })) }
    Start-Sleep -Seconds 1
  }
}

Write-Output '== 1. instalacao silenciosa'
$codigo = Rodar $Exe @('/S')
Exigir ($codigo -eq 0) ('a instalacao saiu com ' + $codigo)
Exigir (Test-Path -LiteralPath $app) ('sem ' + $app)
foreach ($a in $atalhos) { Exigir (Test-Path -LiteralPath $a) ('sem o atalho ' + $a) }
$chave = ChaveDoApp
Exigir ($null -ne $chave) 'Aplicativos: sem o nod'
Exigir ($chave.DisplayVersion -eq $versao) ('Aplicativos: versao ' + $chave.DisplayVersion + ' (esperado ' + $versao + ')')
$alvo = (New-Object -ComObject WScript.Shell).CreateShortcut($atalhos[0]).TargetPath
Exigir ($alvo -eq $app) ('o atalho aponta para ' + $alvo)
Write-Output 'instalacao conferida'

Write-Output '== 2. abrir o app'
$null = Start-Process -FilePath $app -PassThru
Esperar { (ProcessosDoApp).Count -gt 0 } 60 'o app nao abriu'
Start-Sleep -Seconds 15
Exigir ((ProcessosDoApp).Count -gt 0) 'o app fechou sozinho'
Tirar 'app-aberto'
ProcessosDoApp | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Esperar { (ProcessosDoApp).Count -eq 0 } 30 'o app nao fechou'
Write-Output 'o app abriu e fechou'

Write-Output '== 3. desinstalacao silenciosa'
$desinstalador = Join-Path $pasta 'Uninstall nod.exe'
Exigir (Test-Path -LiteralPath $desinstalador) ('sem ' + $desinstalador)
$codigo = Rodar $desinstalador @('/S')
Exigir ($codigo -eq 0) ('a desinstalacao saiu com ' + $codigo)
# O desinstalador do NSIS se copia para o temporario e segue sozinho: espera o nod.exe sair.
Esperar { -not (Test-Path -LiteralPath $app) } 120 ('o nod.exe ficou em ' + $app)
foreach ($a in $atalhos) { Esperar { -not (Test-Path -LiteralPath $a) } 30 ('o atalho ficou: ' + $a) }
Esperar { $null -eq (ChaveDoApp) } 30 'Aplicativos: o nod ficou'
Write-Output 'desinstalacao conferida'
