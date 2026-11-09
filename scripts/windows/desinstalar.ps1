# ADA-226 + ADA-245: o que o desinstalador do Nod (desinstalar-nod.exe, em Configuracoes > Aplicativos) roda antes de
# apagar %LOCALAPPDATA%\nod. A mesma limpeza do `nod-motor desinstalar` (motor/desinstalar.ts), em PowerShell porque o
# node.exe que rodaria o motor mora na pasta que sai:
#   - para o motor: a Tarefa Agendada e a chave Run (nod-motor-<SID>, ADR-151) e a arvore de node.exe da pasta do Nod;
#   - tira as pastas do Nod do Path do usuario e apaga %LOCALAPPDATA%\nod-motor (os dados do motor);
#   - sem -ManterIas: tira do %APPDATA%\npm so o Claude/Codex que a marca %APPDATA%\nod-motor\ias-do-nod.json diz que
#     o Nod instalou (sem marca, a IA era da pessoa e fica);
#   - sem -ManterConexao: apaga a conexao (conexao.json, contas-locais.json, maquina.json; a pasta inteira quando
#     nada dela precisa ficar). Com -ManterConexao, instalar de novo entra sem login.
# O Git e o resto do %APPDATA%\npm ficam sempre. ASCII de proposito: o Windows PowerShell 5.1 le .ps1 sem BOM como ANSI.
param(
  [switch]$ManterConexao,
  [switch]$ManterIas
)
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::Default } catch { $null = $_ }

$pasta = Join-Path $env:LOCALAPPDATA 'nod'
$dados = Join-Path $env:LOCALAPPDATA 'nod-motor'
$config = Join-Path $env:APPDATA 'nod-motor'
$npm = Join-Path $env:APPDATA 'npm'
$marca = Join-Path $config 'ias-do-nod.json'
$nome = 'nod-motor-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value

# Apaga com novas tentativas (antivirus, um arquivo ainda aberto). $true quando o caminho nao existe mais.
function Apagar([string]$Caminho) {
  for ($i = 0; $i -lt 5 -and (Test-Path -LiteralPath $Caminho); $i++) {
    Remove-Item -LiteralPath $Caminho -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $Caminho) { Start-Sleep -Seconds 1 }
  }
  return -not (Test-Path -LiteralPath $Caminho)
}

$tarefa = Get-ScheduledTask -TaskName $nome -TaskPath '\' -ErrorAction SilentlyContinue
if ($null -ne $tarefa) {
  Stop-ScheduledTask -TaskName $nome -TaskPath '\' -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $nome -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output 'Tarefa do motor removida.'
}
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name $nome -ErrorAction SilentlyContinue

# O motor e o Node portatil do Nod: so os processos cujo executavel mora na pasta do Nod.
$prefixo = $pasta.TrimEnd('\') + '\'
$processos = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefixo, [StringComparison]::OrdinalIgnoreCase) })
# Com a arvore: os filhos do motor (claude, codex, shells dos turnos) seguram arquivos da pasta e sobreviveriam ao pai.
$todos = @(Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue)
$arvore = [System.Collections.Generic.List[int]]::new()
$fila = [System.Collections.Generic.Queue[int]]::new()
foreach ($p in $processos) { $fila.Enqueue([int]$p.ProcessId) }
while ($fila.Count -gt 0) {
  $id = $fila.Dequeue()
  if ($arvore.Contains($id)) { continue }
  $arvore.Add($id)
  foreach ($f in $todos) { if ($f.ParentProcessId -eq $id -and $f.ProcessId -ne $id) { $fila.Enqueue([int]$f.ProcessId) } }
}
# Dos filhos para o pai: o pai morto antes nao recria o filho.
for ($i = $arvore.Count - 1; $i -ge 0; $i--) { Stop-Process -Id $arvore[$i] -Force -ErrorAction SilentlyContinue }
foreach ($id in $arvore) { Wait-Process -Id $id -Timeout 15 -ErrorAction SilentlyContinue }
if ($processos.Count -gt 0) { Write-Output 'Motor parado.' }

# O Path do usuario sem as pastas do Nod, mantendo o tipo ExpandString (como a ADA-32 grava).
$tirar = @((Join-Path $pasta 'bin'), (Join-Path $pasta 'node'))
$chave = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -ne $chave) {
  try {
    $atual = [string]$chave.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $itens = @($atual -split ';' | Where-Object { $_ -ne '' })
    $ficam = @($itens | Where-Object { $item = [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\'); -not ($tirar | Where-Object { $_ -ieq $item }) })
    if ($ficam.Count -ne $itens.Count) {
      $chave.SetValue('Path', ($ficam -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      Write-Output 'Path do usuario limpo.'
    }
  } finally { $chave.Close() }
}
# Apagar pelo .NET avisa o Windows (WM_SETTINGCHANGE): o terminal novo ja ve o Path novo.
[Environment]::SetEnvironmentVariable('NOD_INSTALADO_EM', $null, 'User')

if (Apagar $dados) { Write-Output 'Dados do motor removidos.' } else { Write-Output ('Nao deu para apagar ' + $dados + '. Apague a mao.') }

# As IAs: so as que a marca diz que o Nod instalou (os tres shims e a pasta do pacote no prefixo do npm).
$marcaFica = $false
if ($ManterIas) {
  $marcaFica = $true
  Write-Output 'O Claude e o ChatGPT ficam neste computador.'
} else {
  $instaladas = @()
  if (Test-Path -LiteralPath $marca) {
    try {
      $lida = Get-Content -LiteralPath $marca -Raw | ConvertFrom-Json
      foreach ($ia in @('claude', 'codex')) { if ($lida.$ia -is [string] -and $lida.$ia -ne '') { $instaladas += $ia } }
    } catch { $instaladas = @() }
  }
  $pacotes = @{ claude = @('@anthropic-ai', 'claude-code'); codex = @('@openai', 'codex') }
  foreach ($ia in $instaladas) {
    $caminhos = @((Join-Path $npm $ia), (Join-Path $npm ($ia + '.cmd')), (Join-Path $npm ($ia + '.ps1')), (Join-Path (Join-Path (Join-Path $npm 'node_modules') $pacotes[$ia][0]) $pacotes[$ia][1]))
    $ok = $true
    foreach ($c in $caminhos) { if (-not (Apagar $c)) { $ok = $false } }
    if ($ok) { Write-Output ($ia + ' instalado pelo Nod removido.') } else { $marcaFica = $true; Write-Output ('Nao deu para remover ' + $ia + '. Apague a mao em ' + $npm + '.') }
  }
  if ($instaladas.Count -eq 0) { Write-Output 'Nenhuma IA instalada pelo Nod: as IAs deste computador ficam.' }
}

if ($ManterConexao) {
  # A conexao fica; a marca sai quando as IAs que ela apontava sairam (senao uma remocao futura tiraria uma IA que a
  # pessoa reinstalou por conta propria).
  if (-not $marcaFica) { $null = Apagar $marca }
  Write-Output 'Nod removido deste Windows. Continua ligado a sua conta: instalar de novo entra sem login.'
} else {
  $sair = if ($marcaFica) { @((Join-Path $config 'conexao.json'), (Join-Path $config 'contas-locais.json'), (Join-Path $config 'maquina.json')) } else { @($config) }
  $ok = $true
  foreach ($c in $sair) { if (-not (Apagar $c)) { $ok = $false } }
  if ($ok) { Write-Output 'Nod removido deste Windows. A conexao deste computador foi apagada: instalar de novo pede login.' } else { Write-Output ('Nao deu para apagar a conexao em ' + $config + '. Apague a mao.') }
}
exit 0
