# ADA-32 (ADR-151): confere, no runner Windows, o que o instalador deixou (rodado com NOD_INSTALAR_ATE=pareamento).
# Uso: conferir-instalacao.ps1 -Servidor http://127.0.0.1:8765 -Versao 1.2.3
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Servidor, [Parameter(Mandatory = $true)][string]$Versao)
$ErrorActionPreference = 'Stop'
function Exigir([bool]$Condicao, [string]$Texto) { if (-not $Condicao) { throw ('instalador do Windows: ' + $Texto) } }

if ($env:NOD_INSTALACAO_RESULTADO -ne 'ok') { throw ('instalador do Windows: resultado ' + $env:NOD_INSTALACAO_RESULTADO + ' (veja %LOCALAPPDATA%\nod\instalador.log)') }
$pasta = Join-Path $env:LOCALAPPDATA 'nod'
$node = Join-Path $pasta 'node\node.exe'
$app = Join-Path $pasta 'motor\app'

Exigir (Test-Path -LiteralPath $node) 'sem o Node portatil'
Exigir ((& $node --version) -eq 'v24.19.0') 'o Node nao e o 24.19.0'
$manifesto = Invoke-RestMethod -Uri ($Servidor + '/api/motor/manifesto') -UseBasicParsing
foreach ($p in $manifesto.arquivos.PSObject.Properties) {
  $arquivo = Join-Path $app $p.Name
  Exigir (Test-Path -LiteralPath $arquivo) ('sem ' + $p.Name)
  Exigir ((Get-FileHash -LiteralPath $arquivo -Algorithm SHA256).Hash.ToLowerInvariant() -eq $p.Value) ($p.Name + ' nao confere com o manifesto')
}
Exigir (-not (Test-Path -LiteralPath ($app + '.novo'))) 'sobrou motor\app.novo'
$saida = (& (Join-Path $pasta 'bin\nod.cmd') versao | Out-String).Trim()
Exigir ($saida -eq $Versao) ('nod versao escreveu "' + $saida + '" (esperado ' + $Versao + ')')

$nomeDaTarefa = 'nod-motor-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$tarefa = Get-ScheduledTask -TaskName $nomeDaTarefa -TaskPath '\'
Exigir ($null -ne $tarefa) ('sem a Tarefa Agendada ' + $nomeDaTarefa)
Exigir ($tarefa.Actions[0].Execute -like '*\conhost.exe') 'a tarefa nao roda pelo conhost'
Exigir ($tarefa.Actions[0].Arguments -like ('*' + $app + '\nod-motor.mjs" rodar')) 'a tarefa nao roda o motor instalado'
Exigir ($tarefa.Principal.RunLevel -eq 'Limited') 'a tarefa pede admin'
Exigir ($tarefa.Settings.ExecutionTimeLimit -eq 'PT0S') 'a tarefa tem limite de tempo'
Exigir ($null -eq (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $nomeDaTarefa -ErrorAction SilentlyContinue)) 'sobrou a chave Run com a tarefa registrada'

$pathUsuario = [Environment]::GetEnvironmentVariable('Path', 'User')
foreach ($p in @((Join-Path $pasta 'bin'), (Join-Path $pasta 'node'), (Join-Path $env:APPDATA 'npm'))) {
  Exigir ((($pathUsuario -split ';') | Where-Object { $_.TrimEnd('\') -ieq $p }).Count -eq 1) ('o Path do usuario nao tem ' + $p + ' uma vez so')
}
$claude = Join-Path $env:APPDATA 'npm\claude.cmd'
Exigir (Test-Path -LiteralPath $claude) 'sem o Claude Code'
Write-Host 'instalacao conferida'
