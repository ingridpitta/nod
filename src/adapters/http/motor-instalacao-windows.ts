/**
 * ADA-32 (ADR-151): a instalação do motor num Windows 10 22H2/11 x64 da pessoa, num comando só:
 * `irm https://nodbot.ai/windows | iex`. O site redireciona para `https://app.nodbot.ai/windows`, que redireciona para
 * `GET /api/motor/instalar-windows`, que devolve este PowerShell com o endereço e a versão do servidor embutidos (o
 * mesmo contrato do `/motor` do Linux, ADR-090). Sem admin e sem winget obrigatório:
 *
 *   conferência ── Git for Windows (winget --scope user → winget → instalador assinado /CURRENTUSER)
 *     └─ para o motor que estiver rodando ── Node portátil fixo (sha256) ── Path do usuário
 *     └─ Claude Code e Codex pelo npm do Node do nod ── motor (sha256 do manifesto, troca atômica)
 *     └─ nod.cmd / nod-motor.cmd ── Tarefa Agendada no login (ou a chave Run) ── pareamento (abre o navegador) ── no ar
 *
 * Rodar de novo atualiza e nunca toca a conexão (`%APPDATA%\nod-motor\conexao.json`). ADA-245: as IAs que o npm do nod
 * instalou (e que não existiam antes) entram na marca `%APPDATA%\nod-motor\ias-do-nod.json`, lida pelo `nod-motor desinstalar`. O texto inteiro é um bloco
 * `& { … }` invocado na última linha: se o download cortar no meio, o PowerShell recusa o parse e nada roda pela
 * metade. O script nunca chama `exit` (fecharia a janela de quem colou o comando). Todo valor do servidor entra entre
 * aspas simples (o PowerShell não expande nada nelas) e é validado antes: nenhum tem aspas simples.
 */
import { CONVITE } from "../../shared/convite.ts";
import { ARQUIVOS_DO_MOTOR } from "../../domain/atualizacao-do-motor.ts";
import { PISO_CLI } from "../executor/flag-floors.ts";
import { NODE_DO_MOTOR } from "./motor-instalacao.ts";

/**
 * O começo do nome da Tarefa Agendada (e do valor na chave Run) que sobe o motor no login. A tarefa fica na raiz do
 * Agendador, que é da máquina: o nome leva o SID do usuário (`nod-motor-<SID>`) para cada conta ter a sua.
 */
export const TAREFA_DO_MOTOR_WINDOWS = "nod-motor";

/** `https://host[:porta]` ou `http://` só em loopback (o servidor de teste da CI). */
const SERVIDOR_NO_SCRIPT = /^(https:\/\/[a-z0-9.-]+(:\d{1,5})?|http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?)$/;
const VERSAO_NO_SCRIPT = /^[0-9A-Za-z.+-]+$/;

/** O servidor que o script do Windows aceita: HTTPS (o `irm` da pessoa) ou HTTP só em loopback (a CI). */
export function servidorDoWindowsValido(servidor: string | null | undefined): servidor is string {
  return typeof servidor === "string" && SERVIDOR_NO_SCRIPT.test(servidor);
}
const NOME_SEGURO = /^[A-Za-z0-9._-]+$/;

/** O PowerShell de instalação do motor no Windows (puro: texto in, texto out). Lança com servidor ou versão inválidos. */
export function scriptDeInstalacaoWindows(o: { servidor: string; versao: string; convite?: string | null }): string {
  if (!servidorDoWindowsValido(o.servidor) ||!VERSAO_NO_SCRIPT.test(o.versao)) throw new Error("servidor_ou_versao_invalida");
  const convite = o.convite && CONVITE.test(o.convite) ? o.convite : "";
  const constantes = [NODE_DO_MOTOR, PISO_CLI["claude-cli"], PISO_CLI["codex-cli"], ...ARQUIVOS_DO_MOTOR];
  if (!constantes.every((c) => NOME_SEGURO.test(c))) throw new Error("constante_invalida");
  const arquivos = ARQUIVOS_DO_MOTOR.map((a) => `'${a}'`).join(", ");
  return String.raw`# Nod: instala ou atualiza o motor neste Windows (ADR-151). Servido por ${o.servidor}/windows
# Uso: irm ${o.servidor}/windows | iex   (rodar de novo atualiza; a conexao fica)
# Tudo roda dentro do bloco & { ... } abaixo: se o download cortar no meio, o PowerShell recusa o texto inteiro e nada
# roda pela metade. Nunca ha exit aqui (fecharia a janela de quem colou o comando): as falhas saem por throw.
# PSScriptAnalyzer: Write-Host de proposito (o script fala com quem colou o comando; nada vai para o pipeline).
& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$NodServidor = '${o.servidor}'
$NodVersao = '${o.versao}'
$NodConvite = '${convite}'
$NodeVersao = '${NODE_DO_MOTOR}'
$PisoClaude = '${PISO_CLI["claude-cli"]}'
$PisoCodex = '${PISO_CLI["codex-cli"]}'
$ArquivosDoMotor = @(${arquivos})
$Marca = '[nod] '
$env:NOD_INSTALACAO_RESULTADO = ''
if ($env:OS -ne 'Windows_NT' -or -not $env:LOCALAPPDATA -or -not $env:APPDATA) {
  $env:NOD_INSTALACAO_RESULTADO = 'falhou'
  Write-Host ([string][char]0x2717 + ' Este comando é para o Windows. No Linux, use: curl -fsSL ' + $NodServidor + '/motor | sh') -ForegroundColor Red
  return
}
# A raiz do Agendador e da maquina: com um nome so, a segunda conta do PC sobrescreveria (ou adotaria) a tarefa da primeira.
function NomeDaTarefaDe([string]$Sid) { return '${TAREFA_DO_MOTOR_WINDOWS}-' + $Sid }
$NomeDaTarefa = NomeDaTarefaDe ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
$Pasta = if ($env:NOD_PASTA) { $env:NOD_PASTA } else { Join-Path $env:LOCALAPPDATA 'nod' }
$PastaNode = Join-Path $Pasta 'node'
$NodeExe = Join-Path $PastaNode 'node.exe'
$App = Join-Path (Join-Path $Pasta 'motor') 'app'
$MotorMjs = Join-Path $App 'nod-motor.mjs'
$PastaBin = Join-Path $Pasta 'bin'
$PastaNpm = Join-Path $env:APPDATA 'npm'
$Conexao = Join-Path (Join-Path $env:APPDATA 'nod-motor') 'conexao.json'
$MarcaDasIas = Join-Path (Join-Path $env:APPDATA 'nod-motor') 'ias-do-nod.json'
$Log = Join-Path $Pasta 'instalador.log'
$ChaveRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$Taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
$ArgumentosDoMotor = '--headless "' + $NodeExe + '" "' + $MotorMjs + '" rodar'
$Tmp = Join-Path $Pasta ('tmp-' + [guid]::NewGuid().ToString('n'))
$Estado = @{ Parado = $false; Iniciado = $false; Modo = '' }

function Passo([string]$Texto) { Write-Host ([string][char]0x2713 + ' ' + $Texto) -ForegroundColor Green }
function Aviso([string]$Texto) { Write-Host ('! ' + $Texto) -ForegroundColor Yellow }
function Falhar([string]$Texto) { throw ($Marca + $Texto) }
function Registrar([string]$Texto) {
  try { Add-Content -LiteralPath $Log -Value ((Get-Date -Format o) + ' ' + $Texto) -Encoding UTF8 } catch { $null = $_ }
}

# Um programa de fora com a saida no log. O Continue e local: no PowerShell 5.1, stderr redirecionado com Stop vira erro.
function Rodar([string]$Exe, [string[]]$Argumentos) {
  $ErrorActionPreference = 'Continue'
  & $Exe @Argumentos 2>&1 | ForEach-Object { Registrar ([string]$_) }
  return $LASTEXITCODE
}
function SaidaDe([string]$Exe, [string[]]$Argumentos) {
  $ErrorActionPreference = 'Continue'
  try { return ((& $Exe @Argumentos 2>$null) -join ' ').Trim() } catch { return '' }
}
function VersaoDe([string]$Texto) {
  if ($Texto -match '(\d+)\.(\d+)\.(\d+)') { return [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3]) }
  return $null
}
function Sha256([string]$Arquivo) { return (Get-FileHash -LiteralPath $Arquivo -Algorithm SHA256).Hash.ToLowerInvariant() }

# Antivirus segurando um arquivo: 3 tentativas com 2 s.
function Tentar([scriptblock]$Bloco) {
  for ($i = 1; $i -le 3; $i++) {
    try { & $Bloco; return } catch { if ($i -eq 3) { throw }; Start-Sleep -Seconds 2 }
  }
}
function Remover([string]$Caminho) {
  if (Test-Path -LiteralPath $Caminho) { Tentar { Remove-Item -LiteralPath $Caminho -Recurse -Force } }
}
# Troca a pasta inteira: Destino vira Destino.anterior e Novo vira Destino; se a segunda troca falhar, a anterior volta.
function Trocar([string]$Novo, [string]$Destino) {
  $anterior = $Destino + '.anterior'
  Remover $anterior
  if (Test-Path -LiteralPath $Destino) { Tentar { Move-Item -LiteralPath $Destino -Destination $anterior } }
  try { Tentar { Move-Item -LiteralPath $Novo -Destination $Destino } }
  catch {
    Registrar ('troca de ' + $Destino + ': ' + $_.Exception.Message)
    if ((Test-Path -LiteralPath $anterior) -and -not (Test-Path -LiteralPath $Destino)) { Move-Item -LiteralPath $anterior -Destination $Destino }
    Falhar ('Não deu para trocar ' + $Destino + ' (um antivírus ou outro programa segurando o arquivo?). A versão anterior ficou. Rode de novo.')
  }
}

function Baixar([string]$Url, [string]$Destino) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest -Uri $Url -OutFile $Destino -UseBasicParsing; return }
    catch {
      Registrar ('download ' + $Url + ': ' + $_.Exception.Message)
      if ($i -eq 3) { Falhar ('Não deu para baixar ' + $Url + '. Confira a internet ou o proxy e rode de novo.') }
      Start-Sleep -Seconds 2
    }
  }
}

# O Path do registro (Maquina + Usuario): o que um processo novo, como a tarefa do login, recebe.
function PathRegistrado { return (@([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';') }

# O Path da sessao com o que o registro tem agora (Maquina + Usuario), sem repetir pasta.
function AtualizarPathDaSessao {
  $vistos = @{}
  $lista = New-Object System.Collections.Generic.List[string]
  $tudo = @((PathRegistrado), $env:Path) -join ';'
  foreach ($parte in ($tudo -split ';')) {
    $p = $parte.Trim()
    $k = $p.TrimEnd('\').ToLowerInvariant()
    if ($k -and -not $vistos.ContainsKey($k)) { $vistos[$k] = $true; $lista.Add($p) }
  }
  $env:Path = $lista -join ';'
}

# A chave Environment do usuario (HKCU). Uma funcao so para os testes trocarem pelo registro falso.
function ChaveDoAmbiente { return [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment') }
# Gravar uma variavel pelo .NET avisa o Windows (WM_SETTINGCHANGE): o terminal novo ja ve o Path novo. O valor e a pasta
# do nod ($Pasta do bloco); quem chama nao pode ter um parametro $Pasta (o PowerShell acharia o dele primeiro).
function MarcarInstalacao { [Environment]::SetEnvironmentVariable('NOD_INSTALADO_EM', $Pasta, 'User') }

# Poe as pastas no Path do usuario (HKCU, sem duplicar, mantendo o tipo ExpandString) e na sessao.
function PorNoPathDoUsuario([string[]]$Pastas) {
  $chave = ChaveDoAmbiente
  $mudou = $false
  try {
    $atual = [string]$chave.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $itens = New-Object System.Collections.Generic.List[string]
    foreach ($item in ($atual -split ';')) { if ($item.Trim()) { $itens.Add($item.Trim()) } }
    foreach ($p in $Pastas) {
      $alvo = $p.TrimEnd('\')
      $ja = $false
      foreach ($item in $itens) { if ([Environment]::ExpandEnvironmentVariables($item).TrimEnd('\') -ieq $alvo) { $ja = $true } }
      if (-not $ja) { $itens.Add($p); $mudou = $true }
    }
    if ($mudou) { $chave.SetValue('Path', ($itens -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString) }
  } finally { $chave.Close() }
  if ($mudou) { MarcarInstalacao }
  $env:Path = $env:Path + ';' + ($Pastas -join ';')
  AtualizarPathDaSessao
}

# O Path com a pasta no comeco e sem outras copias dela (o motor usa o primeiro binario que acha no Path).
function PathComNaFrente([string]$Atual, [string]$Pasta) {
  $alvo = $Pasta.TrimEnd('\')
  $itens = New-Object System.Collections.Generic.List[string]
  $itens.Add($Pasta)
  foreach ($item in ($Atual -split ';')) {
    $limpo = $item.Trim()
    if (-not $limpo) { continue }
    if ([Environment]::ExpandEnvironmentVariables($limpo).TrimEnd('\') -ieq $alvo) { continue }
    $itens.Add($limpo)
  }
  return ($itens -join ';')
}

# Poe a pasta na frente do Path do usuario (HKCU) e da sessao: uma IA velha em outra pasta do usuario deixa de vencer.
function PorNaFrenteDoPathDoUsuario([string]$PastaNaFrente) {
  $chave = ChaveDoAmbiente
  try {
    $atual = [string]$chave.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $novo = PathComNaFrente $atual $PastaNaFrente
    if ($novo -cne $atual) {
      $chave.SetValue('Path', $novo, [Microsoft.Win32.RegistryValueKind]::ExpandString)
      MarcarInstalacao
    }
  } finally { $chave.Close() }
  # A sessao fica na ordem Maquina;Usuario, a mesma do motor: uma IA velha no Path da maquina continua vencendo aqui.
  AtualizarPathDaSessao
}

function Conferir {
  if ($ExecutionContext.SessionState.LanguageMode -ne 'FullLanguage') { Falhar 'O PowerShell desta máquina está em modo restrito (política da empresa). O nod não instala assim: fale com quem cuida das máquinas.' }
  $arq = $env:PROCESSOR_ARCHITEW6432
  if (-not $arq) { $arq = $env:PROCESSOR_ARCHITECTURE }
  if ($arq -ne 'AMD64') { Falhar 'Por enquanto o nod roda só em Windows x64.' }
  $servidor = $false
  try { $servidor = (Get-CimInstance -ClassName Win32_OperatingSystem).ProductType -ne 1 } catch { $null = $_ }
  if ($servidor) { Aviso 'Windows Server: o nod é testado no Windows 10 e 11 (segue assim mesmo).' }
  elseif ([Environment]::OSVersion.Version.Build -lt 19045) { Falhar 'O nod precisa do Windows 10 22H2 ou do Windows 11 (atualize pelo Windows Update).' }
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { $null = $_ }
  try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch { $null = $_ }
}

# So vale o git.exe com o Git Bash ao lado (...\Git\cmd ou ...\Git\bin -> ...\Git\bin\bash.exe), como o motor confere
# (acharGitBash): um git do MSYS2, do Cygwin ou solto passaria aqui e o motor sairia com 3 em todo login.
function ComGitBash([string]$Git) {
  $raiz = Split-Path -Parent (Split-Path -Parent $Git)
  return (Test-Path -LiteralPath (Join-Path (Join-Path $raiz 'bin') 'bash.exe'))
}
function AcharGit {
  AtualizarPathDaSessao
  foreach ($c in @(Get-Command git.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
    if (ComGitBash $c.Source) { return $c.Source }
  }
  foreach ($base in @($env:ProgramW6432, $env:ProgramFiles, (Join-Path $env:LOCALAPPDATA 'Programs'))) {
    if (-not $base) { continue }
    $cmd = Join-Path (Join-Path $base 'Git') 'cmd'
    $git = Join-Path $cmd 'git.exe'
    if ((Test-Path -LiteralPath $git) -and (ComGitBash $git)) { $env:Path = $env:Path + ';' + $cmd; return $git }
  }
  return $null
}

# Sem winget (Windows 10 sem o App Installer novo): o instalador oficial, so com a assinatura do projeto.
function InstalarGitPeloInstalador {
  Write-Host 'Baixando o instalador oficial do Git for Windows...'
  try { $rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest' -UseBasicParsing -Headers @{ 'User-Agent' = 'nod-instalador' } }
  catch { Registrar ('releases do Git: ' + $_.Exception.Message); return }
  $ativo = $rel.assets | Where-Object { $_.name -match '^Git-[0-9.]+-64-bit\.exe$' } | Select-Object -First 1
  if (-not $ativo) { Registrar 'releases do Git: sem o instalador 64-bit'; return }
  $url = [string]$ativo.browser_download_url
  if (-not $url.StartsWith('https://github.com/git-for-windows/git/releases/download/', [StringComparison]::Ordinal)) {
    Falhar ('O instalador do Git não veio do github.com/git-for-windows (' + $url + '). Nada foi instalado.')
  }
  $exe = Join-Path $Tmp $ativo.name
  Baixar $url $exe
  # O CN exato do certificado (nao um pedaco do Subject: um certificado valido com O=Johannes Schindelin passaria).
  $assinatura = Get-AuthenticodeSignature -FilePath $exe
  $cn = ''
  if ($assinatura.SignerCertificate) { $cn = $assinatura.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) }
  if ($assinatura.Status -ne 'Valid' -or $cn -cne 'Johannes Schindelin') {
    Falhar 'O instalador do Git baixado não tem a assinatura do projeto Git for Windows. Nada foi instalado.'
  }
  $p = Start-Process -FilePath $exe -ArgumentList @('/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/SUPPRESSMSGBOXES', '/CURRENTUSER') -Wait -PassThru
  Registrar ('instalador do Git: ' + $p.ExitCode)
}

function GarantirGit {
  $git = AcharGit
  if (-not $git) {
    $winget = Get-Command winget.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($winget) {
      Write-Host 'Instalando o Git for Windows (winget, só para este usuário)...'
      $r = Rodar $winget.Source @('install', '--id', 'Git.Git', '-e', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements')
      Registrar ('winget (usuario): ' + $r)
      $git = AcharGit
      if (-not $git) {
        Aviso 'O Windows pode pedir permissão (UAC) para instalar o Git for Windows. Aceite para seguir.'
        $r = Rodar $winget.Source @('install', '--id', 'Git.Git', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements')
        Registrar ('winget: ' + $r)
        $git = AcharGit
      }
    }
    if (-not $git) { InstalarGitPeloInstalador; $git = AcharGit }
  }
  if (-not $git) { Falhar 'O Git for Windows não instalou. Instale com: winget install --id Git.Git -e (ou em https://git-scm.com/download/win) e rode este comando de novo.' }
  # O motor acha o git pelo Path (conferirGitForWindows) e a tarefa do login nao herda esta sessao: um Git achado so na
  # pasta padrao (fora do Path do registro) vai para o Path do usuario, senao o motor sairia com 3 em todo login.
  $pastaDoGit = $git.Substring(0, $git.LastIndexOfAny([char[]]@('\', '/')))
  $registrado = $false
  foreach ($item in ((PathRegistrado) -split ';')) {
    $limpo = $item.Trim()
    if ($limpo -and [Environment]::ExpandEnvironmentVariables($limpo).TrimEnd('\') -ieq $pastaDoGit.TrimEnd('\')) { $registrado = $true }
  }
  if (-not $registrado) { PorNoPathDoUsuario @($pastaDoGit) }
  Passo ('Git for Windows (' + (SaidaDe $git @('--version')) + ')')
}

function PidsDoMotor {
  $alvo = $App + '\'
  return @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($alvo, [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
    ForEach-Object { $_.ProcessId })
}

# Rodar de novo = atualizar: para a tarefa, espera o node.exe do nosso app sair (30 s) e so entao mata esses pids.
function PararMotor {
  $tarefa = Get-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -ErrorAction SilentlyContinue
  $rodando = $tarefa -and $tarefa.State -eq 'Running'
  if (-not $rodando -and (PidsDoMotor).Count -eq 0) { return }
  Aviso 'O motor está rodando: ele para agora (um turno no meio volta para a fila) e sobe de novo no fim.'
  $Estado.Parado = $true
  if ($rodando) {
    Stop-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\'
    $ate = (Get-Date).AddSeconds(30)
    while ((PidsDoMotor).Count -gt 0 -and (Get-Date) -lt $ate) { Start-Sleep -Seconds 1 }
  }
  # A arvore inteira (taskkill /T): o Claude ou o Codex de um turno no meio sao filhos do motor e, so com o node.exe
  # morto, seguiriam mexendo no repositorio enquanto o turno volta para a fila (e prenderiam o node.exe na troca).
  foreach ($id in (PidsDoMotor)) {
    $null = Rodar $Taskkill @('/PID', [string]$id, '/T', '/F')
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  Passo 'motor parado para a troca'
}

function InstalarNode {
  $atual = ''
  if (Test-Path -LiteralPath $NodeExe) { $atual = SaidaDe $NodeExe @('--version') }
  if ($atual -eq ('v' + $NodeVersao)) { Passo ('Node ' + $NodeVersao); return }
  Write-Host ('Baixando o Node ' + $NodeVersao + '...')
  $nome = 'node-v' + $NodeVersao + '-win-x64'
  $zip = Join-Path $Tmp ($nome + '.zip')
  $somas = Join-Path $Tmp 'SHASUMS256.txt'
  $base = 'https://nodejs.org/dist/v' + $NodeVersao + '/'
  Baixar ($base + 'SHASUMS256.txt') $somas
  Baixar ($base + $nome + '.zip') $zip
  $linha = Get-Content -LiteralPath $somas | Where-Object { $_ -match ('^[0-9a-f]{64}\s+' + [regex]::Escape($nome + '.zip') + '$') } | Select-Object -First 1
  if (-not $linha -or (Sha256 $zip) -ne ($linha -split '\s+')[0]) { Falhar 'O Node baixado não confere (sha256). Nada foi trocado: rode de novo.' }
  $extraido = Join-Path $Tmp 'node'
  New-Item -ItemType Directory -Path $extraido -Force | Out-Null
  $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (Test-Path -LiteralPath $tar) {
    $r = Rodar $tar @('-xf', $zip, '-C', $extraido)
    if ($r -ne 0) { Falhar 'Não deu para extrair o Node (disco cheio?). Nada foi trocado: rode de novo.' }
  } else { Expand-Archive -LiteralPath $zip -DestinationPath $extraido -Force }
  $novo = $PastaNode + '.novo'
  Remover $novo
  Move-Item -LiteralPath (Join-Path $extraido $nome) -Destination $novo
  Trocar $novo $PastaNode
  Remover ($PastaNode + '.anterior')
  Passo ('Node ' + $NodeVersao)
}

function VersaoDoBinario([string]$Nome) {
  $c = Get-Command $Nome -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  return VersaoDe (SaidaDe $c.Source @('--version'))
}

# ADA-245: a marca das IAs que o nod instalou (%APPDATA%\nod-motor\ias-do-nod.json, {"claude":"2.1.3"}). So quando a IA
# nao existia antes e o npm do nod deixou o shim no prefixo: a IA que ja era da pessoa nunca entra, e o
# nod-motor desinstalar so tira do %APPDATA%\npm o que esta marcado. Rodar de novo nao perde uma marca antiga.
function MarcarIaDoNod([string]$Binario, [string]$Prefixo) {
  try {
    $shim = Join-Path $Prefixo ($Binario + '.cmd')
    if (-not (Test-Path -LiteralPath $shim)) { return }
    $versao = VersaoDe (SaidaDe $shim @('--version'))
    $marca = @{}
    if (Test-Path -LiteralPath $MarcaDasIas) {
      $lida = Get-Content -LiteralPath $MarcaDasIas -Raw | ConvertFrom-Json
      foreach ($p in $lida.PSObject.Properties) { $marca[$p.Name] = $p.Value }
    }
    $marca[$Binario] = if ($versao) { [string]$versao } else { 'sim' }
    New-Item -ItemType Directory -Path (Split-Path -Parent $MarcaDasIas) -Force | Out-Null
    [IO.File]::WriteAllText($MarcaDasIas, ($marca | ConvertTo-Json -Compress))
    Registrar ('marca: ' + $Binario + ' instalado pelo nod')
  } catch { Registrar ('marca das IAs: ' + $_.Exception.Message) }
}

# O npm do Node do nod, chamado pelo node (e nao pelo npm.cmd: o cmd.exe leria o >= do pacote como redirecionamento).
function InstalarIa([string]$Pacote, [string]$Binario, [string]$Piso, [string]$Nome) {
  $antes = VersaoDoBinario $Binario
  if ($antes -and $antes -ge [version]$Piso) { Passo ($Nome + ' ' + $antes); return $true }
  Write-Host ('Instalando o ' + $Nome + '...')
  $npm = Join-Path $PastaNode 'node_modules\npm\bin\npm-cli.js'
  $r = Rodar $NodeExe @($npm, 'install', '-g', '--prefix', $PastaNpm, '--no-fund', '--no-audit', '--loglevel=error', ($Pacote + '@>=' + $Piso))
  if (-not $antes) { MarcarIaDoNod $Binario $PastaNpm }
  $depois = VersaoDoBinario $Binario
  if ($depois -and $depois -ge [version]$Piso) { Passo ($Nome + ' ' + $depois); return $true }
  # Uma versao velha antes no Path (ex.: o instalador nativo em ~\.local\bin) esconderia a que acabou de instalar no
  # prefixo do nod, no terminal e no motor (ele pega o primeiro do Path e recusaria a velha como cli_antigo). O prefixo
  # do nod vai para a frente do Path do usuario; so conta se a nova passar a ser a primeira.
  $doNod = Join-Path $PastaNpm ($Binario + '.cmd')
  if (Test-Path -LiteralPath $doNod) {
    $versaoDoNod = VersaoDe (SaidaDe $doNod @('--version'))
    if ($versaoDoNod -and $versaoDoNod -ge [version]$Piso) {
      PorNaFrenteDoPathDoUsuario $PastaNpm
      $agora = VersaoDoBinario $Binario
      if ($agora -and $agora -ge [version]$Piso) { Passo ($Nome + ' ' + $agora); return $true }
      $velho = Get-Command $Binario -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
      Aviso ('Há um ' + $Nome + ' mais antigo no Path da máquina (' + $velho.Source + '), antes do ' + $versaoDoNod + ' do nod: o motor usaria esse. Atualize ou remova esse e rode este comando de novo.')
      return $false
    }
  }
  Aviso ($Nome + ' não instalou agora (npm saiu com ' + $r + '). Rode de novo depois; detalhes em ' + $Log)
  return $false
}

function InstalarIas {
  $temClaude = InstalarIa '@anthropic-ai/claude-code' 'claude' $PisoClaude 'Claude Code'
  $temCodex = $false
  if ($env:NOD_SEM_CODEX -ne '1') { $temCodex = InstalarIa '@openai/codex' 'codex' $PisoCodex 'Codex' }
  if (-not $temClaude -and -not $temCodex) {
    Falhar ('Nenhuma IA instalou (Claude Code ou Codex). Instale à mão com: npm install -g @anthropic-ai/claude-code e rode este comando de novo.')
  }
}

# O motor da versao do servidor: o sha256 de cada arquivo confere com o manifesto antes de trocar.
function InstalarMotor {
  try { $manifesto = Invoke-RestMethod -Uri ($NodServidor + '/api/motor/manifesto') -UseBasicParsing }
  catch { Registrar ('manifesto: ' + $_.Exception.Message); Falhar ('O servidor ' + $NodServidor + ' não respondeu o manifesto do motor. Confira a internet ou o proxy e rode de novo.') }
  $novo = $App + '.novo'
  Remover $novo
  New-Item -ItemType Directory -Path $novo -Force | Out-Null
  foreach ($arquivo in $ArquivosDoMotor) {
    $destino = Join-Path $novo $arquivo
    Baixar ($NodServidor + '/api/motor/arquivos/' + $arquivo) $destino
    $esperado = [string]$manifesto.arquivos.$arquivo
    if (-not $esperado -or (Sha256 $destino) -ne $esperado.ToLowerInvariant()) {
      Remover $novo
      Falhar ('O arquivo ' + $arquivo + ' do motor não confere com o manifesto do servidor. Nada foi trocado: rode de novo.')
    }
  }
  Trocar $novo $App
  Passo ('motor ' + $manifesto.versao)
}

# .cmd e nao .ps1: roda com qualquer ExecutionPolicy. Chama o Node e o motor por caminho absoluto (%~dp0).
function CriarComandos {
  New-Item -ItemType Directory -Path $PastaBin -Force | Out-Null
  $linhas = @('@echo off', '"%~dp0..\node\node.exe" "%~dp0..\motor\app\nod-motor.mjs" %*')
  foreach ($nome in @('nod.cmd', 'nod-motor.cmd')) { Set-Content -LiteralPath (Join-Path $PastaBin $nome) -Value $linhas -Encoding ASCII }
  Passo 'comando nod (num terminal novo: nod estado)'
}

# Sobe no login por Tarefa Agendada do proprio usuario, sem admin; se a politica recusar, a chave Run do usuario.
function RegistrarInicio {
  try {
    $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $acao = New-ScheduledTaskAction -Execute $Conhost -Argument $ArgumentosDoMotor -WorkingDirectory $env:USERPROFILE
    $gatilho = New-ScheduledTaskTrigger -AtLogOn -User $usuario
    $quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited
    $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -Action $acao -Trigger $gatilho -Principal $quem -Settings $ajustes -Description 'Nod: o motor desta máquina (ADR-151)' -Force | Out-Null
    Remove-ItemProperty -Path $ChaveRun -Name $NomeDaTarefa -ErrorAction SilentlyContinue
    $Estado.Modo = 'tarefa'
    Passo ('inicia sozinho no login (Tarefa Agendada ' + $NomeDaTarefa + ')')
  } catch {
    Registrar ('tarefa agendada recusada: ' + $_.Exception.Message)
    # A tarefa de uma instalacao anterior subiria junto com a chave Run: dois motores com a mesma chave no login.
    # Se ela nao sai, fica so ela (roda o mesmo app, pelos mesmos caminhos).
    Unregister-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -Confirm:$false -ErrorAction SilentlyContinue
    if (Get-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -ErrorAction SilentlyContinue) {
      $Estado.Modo = 'tarefa'
      Aviso ('O Windows não deixou recriar a Tarefa Agendada ' + $NomeDaTarefa + ': fica a da instalação anterior.')
      return
    }
    # O New-ItemProperty cria o valor, nao a chave: num perfil sem a chave Run ele falharia. Sem -Force no New-Item
    # (numa chave que existe, ele a recriaria vazia).
    if (-not (Test-Path -LiteralPath $ChaveRun)) { New-Item -Path $ChaveRun | Out-Null }
    New-ItemProperty -Path $ChaveRun -Name $NomeDaTarefa -Value ('"' + $Conhost + '" ' + $ArgumentosDoMotor) -PropertyType String -Force | Out-Null
    $Estado.Modo = 'run'
    Aviso 'O Windows não deixou criar a Tarefa Agendada: o motor inicia no login pela chave Run do usuário (sem reinício automático se cair).'
  }
}

function IniciarMotor {
  if ($Estado.Modo -eq 'tarefa') { Start-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' }
  else { Start-Process -FilePath $Conhost -ArgumentList $ArgumentosDoMotor -WindowStyle Hidden | Out-Null }
  $Estado.Iniciado = $true
}

# Depois de uma falha: o motor que estava rodando volta (a troca que falhou deixou a versão anterior no lugar).
function RetomarMotor {
  if ($Estado.Parado -and -not $Estado.Iniciado -and (Test-Path -LiteralPath $Conexao)) {
    # Pela tarefa se ela existe; senao (instalacao pela chave Run), direto, como o login faria.
    try {
      if (Get-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' -ErrorAction SilentlyContinue) { Start-ScheduledTask -TaskName $NomeDaTarefa -TaskPath '\' }
      elseif (Test-Path -LiteralPath $MotorMjs) { Start-Process -FilePath $Conhost -ArgumentList $ArgumentosDoMotor -WindowStyle Hidden | Out-Null }
    } catch { Registrar ('retomar o motor: ' + $_.Exception.Message) }
  }
}

# Start-Process e nao &: dentro de uma funcao, a saida do & vira o retorno (o codigo de pareamento sumiria da tela e
# o retorno seria uma lista, nunca 0). Sem -Wait: no PowerShell 5.1 ele espera a arvore toda (o navegador aberto).
function Parear {
  $argumentos = @($MotorMjs, 'parear', $NodServidor, '--abrir')
  if ($NodConvite) { $argumentos += @('--convite', $NodConvite) }
  $linha = ($argumentos | ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }) -join ' '
  $p = Start-Process -FilePath $NodeExe -ArgumentList $linha -NoNewWindow -PassThru
  $null = $p.Handle
  $p.WaitForExit()
  return [int]$p.ExitCode
}

function Principal {
  Conferir
  New-Item -ItemType Directory -Path $Pasta -Force | Out-Null
  Registrar ('instalando o motor ' + $NodVersao + ' de ' + $NodServidor)
  Write-Host ('Nod: instalando o motor ' + $NodVersao + ' neste Windows')
  New-Item -ItemType Directory -Path $Tmp -Force | Out-Null
  try {
    GarantirGit
    PararMotor
    InstalarNode
    PorNoPathDoUsuario @($PastaBin, $PastaNode, $PastaNpm)
    InstalarIas
    InstalarMotor
    CriarComandos
    RegistrarInicio
  } finally { Remover $Tmp }
  # NOD_INSTALAR_ATE=pareamento: para antes de parear e de subir o motor (a CI e o suporte).
  if ($env:NOD_INSTALAR_ATE -eq 'pareamento') { Passo 'parei antes do pareamento (NOD_INSTALAR_ATE=pareamento)'; return }
  if (Test-Path -LiteralPath $Conexao) {
    IniciarMotor
    Write-Host ''
    Write-Host 'Motor atualizado e no ar. Estado: nod estado'
    return
  }
  Write-Host ''
  if ((Parear) -ne 0) { Falhar ('O pareamento não terminou. Rode de novo: nod parear ' + $NodServidor) }
  IniciarMotor
  Write-Host ''
  Write-Host 'Pronto: o motor está no ar e volta sozinho quando você entrar no Windows. Estado: nod estado'
}

try {
  Principal
  $env:NOD_INSTALACAO_RESULTADO = 'ok'
} catch {
  $env:NOD_INSTALACAO_RESULTADO = 'falhou'
  Registrar ($_ | Out-String)
  $mensagem = [string]$_.Exception.Message
  Write-Host ''
  if ($mensagem.StartsWith($Marca)) { Write-Host ([string][char]0x2717 + ' ' + $mensagem.Substring($Marca.Length)) -ForegroundColor Red }
  else { Write-Host ([string][char]0x2717 + ' A instalação parou: ' + $mensagem) -ForegroundColor Red }
  Write-Host ('Rode o comando de novo. Detalhes em ' + $Log)
  RetomarMotor
}
}
`;
}
