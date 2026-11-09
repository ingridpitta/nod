import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { scriptDeInstalacaoWindows } from "../../../src/adapters/http/motor-instalacao-windows.ts";

/**
 * ADA-32 (ADR-151): as funções do instalador do Windows rodando de verdade no PowerShell (o pwsh do Linux), com o que é
 * só do Windows (Tarefa Agendada, assinatura, processos) trocado por funções falsas. O driver tira cada `function` do
 * script gerado pela AST do PowerShell e as define no escopo do teste; o trecho do teste vem depois e substitui o que
 * precisar. Sem pwsh na máquina (NOD_PWSH ou `pwsh` no PATH), pula: a CI do Linux (ubuntu-latest) tem o pwsh.
 */
const PWSH = process.env.NOD_PWSH ?? "pwsh";
const temPwsh = spawnSync(PWSH, ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
const pasta = mkdtempSync(join(tmpdir(), "nod-instalador-pwsh-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

const instalador = join(pasta, "instalar-nod.ps1");
writeFileSync(instalador, `\uFEFF${scriptDeInstalacaoWindows({ servidor: "https://app.nodbot.ai", versao: "1.2.3" })}`);
const driver = join(pasta, "driver.ps1");
writeFileSync(driver, String.raw`param([string]$Instalador, [string]$Trecho)
$ErrorActionPreference = 'Stop'
$erros = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$null, [ref]$erros)
if ($erros.Count -gt 0) { throw ('o instalador nao faz parse: ' + $erros[0].Message) }
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { . ([scriptblock]::Create($f.Extent.Text)) }
. ([scriptblock]::Create([IO.File]::ReadAllText($Trecho)))
`);

let n = 0;
function rodar(trecho: string): { status: number | null; saida: string } {
  const arquivo = join(pasta, `trecho-${++n}.ps1`);
  writeFileSync(arquivo, trecho);
  const r = spawnSync(PWSH, ["-NoProfile", "-NonInteractive", "-File", driver, "-Instalador", instalador, "-Trecho", arquivo], { encoding: "utf8" });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

// Cada trecho sobe um pwsh (~0,7 s; o do Git sobe quatro): o teto padrão de 5 s do unit estoura num runner com carga.
describe.skipIf(!temPwsh)("instalador do Windows no PowerShell (ADR-151)", { timeout: 60_000 }, () => {
  it("Parear mostra o código na tela e devolve só o código de saída do motor (0 e 3)", () => {
    const dir = join(pasta, "com espaço");
    mkdirSync(dir, { recursive: true });
    const motor = join(dir, "nod-motor.sh");
    writeFileSync(motor, '#!/bin/sh\necho "CODIGO-1234 $*"\nexit "$SAIDA_FALSA"\n');
    chmodSync(motor, 0o755);
    for (const codigo of [0, 3]) {
      const { status, saida } = rodar(String.raw`
$NodeExe = '/bin/sh'
$MotorMjs = '${motor}'
$NodServidor = 'https://app.nodbot.ai'
$NodConvite = ''
$env:SAIDA_FALSA = '${codigo}'
$r = Parear
Write-Host ('RETORNO=' + (ConvertTo-Json -InputObject $r -Compress))
`);
      expect(status, saida).toBe(0);
      expect(saida).toContain("CODIGO-1234 parear https://app.nodbot.ai --abrir");
      expect(saida).toContain(`RETORNO=${codigo}`);
    }
  });

  it("PararMotor derruba a árvore do motor (taskkill /T /F), não só o node.exe: o turno no meio não segue órfão", () => {
    const { status, saida } = rodar(String.raw`
$NomeDaTarefa = 'nod-motor'
$Taskkill = 'taskkill.exe'
$Estado = @{ Parado = $false; Iniciado = $false; Modo = '' }
$script:chamadas = New-Object System.Collections.Generic.List[string]
$script:vivos = @(4242)
function Get-ScheduledTask { return $null }
function PidsDoMotor { return $script:vivos }
function Rodar([string]$Exe, [string[]]$Argumentos) { $script:chamadas.Add($Exe + ' ' + ($Argumentos -join ' ')); $script:vivos = @(); return 0 }
function Stop-Process { param($Id, [switch]$Force, $ErrorAction) $script:chamadas.Add('Stop-Process ' + $Id); $script:vivos = @() }
function Start-Sleep { param($Seconds) }
PararMotor
Write-Host ('CHAMADAS=' + ($script:chamadas -join ' | '))
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("CHAMADAS=taskkill.exe /PID 4242 /T /F");
  });

  it("o instalador do Git só roda com o CN do Git for Windows e baixado do github.com/git-for-windows", () => {
    const cenario = (cn: string, url: string) => rodar(String.raw`
$Tmp = '${pasta}'
$Marca = '[nod] '
$script:instalou = $false
function Invoke-RestMethod { return [pscustomobject]@{ assets = @([pscustomobject]@{ name = 'Git-2.51.0-64-bit.exe'; browser_download_url = '${url}' }) } }
function Baixar([string]$Url, [string]$Destino) { }
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$pedido = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('${cn}', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
$cert = $pedido.CreateSelfSigned([DateTimeOffset]::Now.AddDays(-1), [DateTimeOffset]::Now.AddDays(1))
function Get-AuthenticodeSignature { param($FilePath) return [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $cert } }
function Start-Process { $script:instalou = $true; return [pscustomobject]@{ ExitCode = 0 } }
function Registrar([string]$Texto) { }
try { InstalarGitPeloInstalador } catch { Write-Host ('FALHOU=' + $_.Exception.Message) }
Write-Host ('INSTALOU=' + $script:instalou)
`);
    const oficial = "https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.1/Git-2.51.0-64-bit.exe";
    const bom = cenario("CN=Johannes Schindelin, O=Johannes Schindelin, S=Nordrhein-Westfalen, C=DE", oficial);
    expect(bom.saida).toContain("INSTALOU=True");
    for (const [cn, url] of [["CN=Outra Pessoa, O=Johannes Schindelin", oficial], ["CN=Johannes Schindelin Fake, O=X", oficial], ["CN=Johannes Schindelin, O=Johannes Schindelin", "https://evil.example/Git-2.51.0-64-bit.exe"]] as const) {
      const r = cenario(cn, url);
      expect(r.saida, `${cn} ${url}`).toContain("INSTALOU=False");
      expect(r.saida).toContain("FALHOU=[nod] ");
    }
  });

  // Revisão do PR #658 (codex): o motor também pega o primeiro binário do Path (resolverBinarioDetalhado). A IA nova no
  // prefixo do nod só conta se ela passar a vir antes da velha; com a velha no Path da máquina (antes do do usuário),
  // não conta: o motor recusaria o harness como cli_antigo.
  describe("IA velha antes no Path", () => {
    const cenario = (frenteResolve: boolean) => {
      const velha = join(pasta, "ia-velha");
      const npm = join(pasta, `npm-do-nod-${frenteResolve}`);
      mkdirSync(velha, { recursive: true });
      mkdirSync(npm, { recursive: true });
      writeFileSync(join(velha, "claude"), '#!/bin/sh\necho "1.0.0 (Claude Code)"\n');
      chmodSync(join(velha, "claude"), 0o755);
      return rodar(String.raw`
$PastaNpm = '${npm}'
$PastaNode = '${pasta}'
$NodeExe = 'node'
$Log = 'instalador.log'
$env:PATH = '${velha}' + [IO.Path]::PathSeparator + '/bin' # no Linux o nome é PATH
function Registrar([string]$Texto) { }
function Aviso([string]$Texto) { Write-Host ('AVISO=' + $Texto) }
function PorNaFrenteDoPathDoUsuario([string]$Pasta) {
  Write-Host ('FRENTE=' + $Pasta)
  if ($${frenteResolve}) { $env:PATH = $Pasta + [IO.Path]::PathSeparator + $env:PATH }
}
function Rodar([string]$Exe, [string[]]$Argumentos) {
  foreach ($nome in @('claude.cmd', 'claude')) {
    $cmd = Join-Path $PastaNpm $nome
    [IO.File]::WriteAllText($cmd, '#!/bin/sh' + [char]10 + 'echo "9.9.9 (Claude Code)"' + [char]10)
    chmod +x $cmd
  }
  return 0
}
$ok = InstalarIa '@anthropic-ai/claude-code' 'claude' '2.1.290' 'Claude Code'
Write-Host ('INSTALOU=' + $ok)
`);
    };

    it("põe o prefixo do nod na frente do Path do usuário e a IA nova conta", () => {
      const { status, saida } = cenario(true);
      expect(status, saida).toBe(0);
      expect(saida).toContain("FRENTE=");
      expect(saida).toContain("Claude Code 9.9.9");
      expect(saida).toContain("INSTALOU=True");
    });

    it("com a velha ainda na frente (Path da máquina), não conta e diz qual remover", () => {
      const { status, saida } = cenario(false);
      expect(status, saida).toBe(0);
      expect(saida).toContain("INSTALOU=False");
      expect(saida).toMatch(/AVISO=.*ia-velha/);
    });
  });

  it("PathComNaFrente põe a pasta no começo, sem repetir (nem com %VAR% ou \\ no fim)", () => {
    const { status, saida } = rodar(String.raw`
$env:NOD_TESTE_APPDATA = 'C:\Users\a\AppData\Roaming'
Write-Host ('R1=' + (PathComNaFrente 'C:\velha;%NOD_TESTE_APPDATA%\npm\;C:\outra' 'C:\Users\a\AppData\Roaming\npm'))
Write-Host ('R2=' + (PathComNaFrente '' 'C:\x'))
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("R1=C:\\Users\\a\\AppData\\Roaming\\npm;C:\\velha;C:\\outra");
    expect(saida).toContain("R2=C:\\x\n");
  });

  it("depois de uma falha, o motor parado volta mesmo sem a Tarefa Agendada (instalação pela chave Run)", () => {
    const motor = join(pasta, "nod-motor.mjs");
    writeFileSync(motor, "");
    const conexao = join(pasta, "conexao.json");
    writeFileSync(conexao, "{}");
    const { status, saida } = rodar(String.raw`
$NomeDaTarefa = 'nod-motor'
$MotorMjs = '${motor}'
$Conexao = '${conexao}'
$Conhost = 'conhost.exe'
$ArgumentosDoMotor = '--headless motor rodar'
$Estado = @{ Parado = $true; Iniciado = $false; Modo = '' }
$script:chamadas = New-Object System.Collections.Generic.List[string]
function Get-ScheduledTask { param($TaskName, $TaskPath, $ErrorAction) return $null }
function Start-ScheduledTask { $script:chamadas.Add('Start-ScheduledTask'); throw 'sem a tarefa' }
function Start-Process { param($FilePath, $ArgumentList, $WindowStyle) $script:chamadas.Add('Start-Process ' + $FilePath + ' ' + $ArgumentList) }
RetomarMotor
Write-Host ('CHAMADAS=' + ($script:chamadas -join ' | '))
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("CHAMADAS=Start-Process conhost.exe --headless motor rodar");
  });

  // Revisão do PR #658: um git.exe sem o Git Bash ao lado (MSYS2, Cygwin, um git solto) não é o Git for Windows: o
  // motor sai com 3 sem o bash, então o instalador segue procurando (ou instala) em vez de dar o Git por pronto.
  it("AcharGit só aceita o git.exe com o Git Bash ao lado (…\\Git\\bin\\bash.exe)", () => {
    const solto = join(pasta, "git-solto", "usr", "bin");
    const gfw = join(pasta, "gfw", "Git");
    for (const d of [solto, join(gfw, "cmd"), join(gfw, "bin")]) mkdirSync(d, { recursive: true });
    for (const f of [join(solto, "git.exe"), join(gfw, "cmd", "git.exe"), join(gfw, "bin", "bash.exe")]) { writeFileSync(f, "#!/bin/sh\n"); chmodSync(f, 0o755); }
    const achar = (path: string) => rodar(String.raw`
function AtualizarPathDaSessao { }
$env:ProgramW6432 = ''; $env:ProgramFiles = ''; $env:LOCALAPPDATA = '${join(pasta, "sem-programas")}'
$env:PATH = '${path}'
Write-Host ('GIT=' + (AcharGit))
`);
    const so = achar(solto);
    expect(so.status, so.saida).toBe(0);
    expect(so.saida).toMatch(/GIT=\s*$/m);
    const ambos = achar(`${solto}:${join(gfw, "cmd")}`);
    expect(ambos.saida).toContain(`GIT=${join(gfw, "cmd", "git.exe")}`);
  });

  // Revisão do PR #658 (M3): a tarefa fica na raiz do Agendador, que é da máquina. Com o mesmo nome para todas as
  // contas, a segunda conta sobrescreveria (ou adotaria, na reserva) a tarefa da primeira. O SID entra no nome.
  it("o nome da Tarefa Agendada leva o SID do usuário: duas contas no mesmo PC não dividem a tarefa", () => {
    const { status, saida } = rodar(String.raw`
Write-Host ('A=' + (NomeDaTarefaDe 'S-1-5-21-111-1001'))
Write-Host ('B=' + (NomeDaTarefaDe 'S-1-5-21-111-1002'))
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("A=nod-motor-S-1-5-21-111-1001");
    expect(saida).toContain("B=nod-motor-S-1-5-21-111-1002");
  });

  // QA do PR #658: no Linux o WindowsIdentity lança, e o RegistrarInicio caía no catch antes do Register-ScheduledTask
  // (os testes da reserva passavam pelo motivo errado e o caminho da tarefa criada nunca rodava). Troca só essa chamada.
  const comIdentidadeFalsa = String.raw`
$fonte = (Get-Item function:RegistrarInicio).ScriptBlock.ToString()
$troca = '[Security.Principal.WindowsIdentity]::GetCurrent().Name'
if (-not $fonte.Contains($troca)) { throw 'RegistrarInicio sem o WindowsIdentity' }
Set-Item function:RegistrarInicio ([scriptblock]::Create($fonte.Replace($troca, "'PC\ana'")))
`;

  // QA do PR #658: com a Tarefa Agendada criada, a chave Run de uma instalação anterior sai (nunca as duas no login).
  it("RegistrarInicio com a Tarefa Agendada criada apaga a chave Run e fica no modo tarefa", () => {
    const { status, saida } = rodar(String.raw`${comIdentidadeFalsa}
$NomeDaTarefa = 'nod-motor-S-1-5-21-9'
$ChaveRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Conhost = 'conhost.exe'
$ArgumentosDoMotor = '--headless motor rodar'
$env:USERPROFILE = '/tmp'
$Estado = @{ Parado = $false; Iniciado = $false; Modo = '' }
$script:chamadas = New-Object System.Collections.Generic.List[string]
function Registrar([string]$Texto) { Write-Host ('LOG=' + $Texto) }
function Aviso([string]$Texto) { }
function New-ScheduledTaskAction { return 1 }
function New-ScheduledTaskTrigger { return 1 }
function New-ScheduledTaskPrincipal { return 1 }
function New-ScheduledTaskSettingsSet { return 1 }
function Register-ScheduledTask { param($TaskName, $TaskPath, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force) $script:chamadas.Add('Register ' + $TaskName) }
function Unregister-ScheduledTask { $script:chamadas.Add('Unregister') }
function Get-ScheduledTask { return $null }
function Test-Path { return $true }
function New-Item { $script:chamadas.Add('New-Item') }
function New-ItemProperty { $script:chamadas.Add('Run') }
function Remove-ItemProperty { param($Path, $Name, $ErrorAction) $script:chamadas.Add('RemoveRun ' + $Name) }
RegistrarInicio
Write-Host ('MODO=' + $Estado.Modo + ' CHAMADAS=' + ($script:chamadas -join ' | '))
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("MODO=tarefa CHAMADAS=Register nod-motor-S-1-5-21-9 | RemoveRun nod-motor-S-1-5-21-9\n");
  });

  // Revisão do PR #658: a reserva pela chave Run cria a chave quando ela falta (o New-ItemProperty só cria o valor) e
  // não deixa a tarefa de uma instalação anterior viva ao lado dela (dois motores com a mesma chave no login).
  describe("RegistrarInicio quando a Tarefa Agendada é recusada", () => {
    const cenario = (temChave: boolean, tarefaAntiga: boolean, removeTarefa: boolean) => rodar(String.raw`${comIdentidadeFalsa}
$env:USERPROFILE = '/tmp'
$NomeDaTarefa = 'nod-motor'
$ChaveRun = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$Conhost = 'conhost.exe'
$ArgumentosDoMotor = '--headless motor rodar'
$Estado = @{ Parado = $false; Iniciado = $false; Modo = '' }
$script:chamadas = New-Object System.Collections.Generic.List[string]
$script:chave = $${temChave}
$script:tarefa = $${tarefaAntiga}
function Registrar([string]$Texto) { Write-Host ('LOG=' + $Texto) }
function Aviso([string]$Texto) { Write-Host ('AVISO=' + $Texto) }
function New-ScheduledTaskAction { return 1 }
function New-ScheduledTaskTrigger { return 1 }
function New-ScheduledTaskPrincipal { return 1 }
function New-ScheduledTaskSettingsSet { return 1 }
function Register-ScheduledTask { throw 'Acesso negado' }
function Get-ScheduledTask { if ($script:tarefa) { return [pscustomobject]@{ TaskName = 'nod-motor' } } }
function Unregister-ScheduledTask { $script:chamadas.Add('Unregister'); if ($${removeTarefa}) { $script:tarefa = $false } }
function Test-Path { return $script:chave }
function New-Item { param($Path, [switch]$Force) if ($script:chave) { throw 'a chave ja existe' }; $script:chamadas.Add('New-Item ' + $Path); $script:chave = $true }
function New-ItemProperty { param($Path, $Name, $Value, $PropertyType, [switch]$Force) if (-not $script:chave) { throw 'sem a chave' }; $script:chamadas.Add('Run ' + $Name) }
function Remove-ItemProperty { }
RegistrarInicio
Write-Host ('MODO=' + $Estado.Modo + ' CHAMADAS=' + ($script:chamadas -join ' | '))
`);

    it("sem a chave Run no perfil, cria a chave e grava o valor", () => {
      const { status, saida } = cenario(false, false, true);
      expect(status, saida).toBe(0);
      expect(saida).toContain("LOG=tarefa agendada recusada: Acesso negado");
      expect(saida).toContain("MODO=run CHAMADAS=Unregister | New-Item HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run | Run nod-motor");
    });

    it("com a chave, só grava o valor (sem recriar a chave)", () => {
      const { status, saida } = cenario(true, false, true);
      expect(status, saida).toBe(0);
      expect(saida).toContain("MODO=run CHAMADAS=Unregister | Run nod-motor");
    });

    it("a tarefa antiga que não sai fica no lugar da chave Run (nunca as duas)", () => {
      const { status, saida } = cenario(true, true, false);
      expect(status, saida).toBe(0);
      expect(saida).toContain("MODO=tarefa CHAMADAS=Unregister");
      expect(saida).not.toContain("Run nod-motor");
    });

    it("a tarefa antiga que sai dá lugar à chave Run", () => {
      const { status, saida } = cenario(true, true, true);
      expect(status, saida).toBe(0);
      expect(saida).toContain("MODO=run CHAMADAS=Unregister | Run nod-motor");
    });
  });
  // Revisão do PR #658 (rodada final): o script roda dentro de `& { … }`, então $Pasta é do bloco e $script:Pasta é
  // vazio (o escopo de quem colou o comando). O marcador NOD_INSTALADO_EM saía vazio (apagava a variável) ou, com o
  // parâmetro $Pasta, com a pasta do npm. Aqui roda de verdade dentro de um bloco & { … }, com o registro falso.
  it("os dois caminhos do Path marcam NOD_INSTALADO_EM com a pasta do nod, dentro do & { … } do script", () => {
    const { status, saida } = rodar(String.raw`
function ChaveDoAmbiente {
  $c = [pscustomobject]@{ Valor = 'C:\velha' }
  $c | Add-Member -MemberType ScriptMethod -Name GetValue -Value { param($n, $d, $o) return $this.Valor }
  $c | Add-Member -MemberType ScriptMethod -Name SetValue -Value { param($n, $v, $k) $this.Valor = $v }
  $c | Add-Member -MemberType ScriptMethod -Name Close -Value { }
  return $c
}
function MarcarInstalacao { Write-Host ('MARCA=' + $Pasta) }
function AtualizarPathDaSessao { }
& {
  $Pasta = 'C:\Users\a\AppData\Local\nod'
  PorNaFrenteDoPathDoUsuario 'C:\Users\a\AppData\Roaming\npm'
  PorNoPathDoUsuario @('C:\Users\a\AppData\Local\nod\bin')
}
`);
    expect(status, saida).toBe(0);
    expect(saida.match(/^MARCA=.*$/gm)).toEqual(["MARCA=C:\\Users\\a\\AppData\\Local\\nod", "MARCA=C:\\Users\\a\\AppData\\Local\\nod"]);
  });
  // Revisão do PR #658 (codex): o Git achado só na pasta padrão (fora do Path do registro) entrava só no Path desta
  // sessão. A tarefa do login não herda a sessão e o motor (que acha o git pelo Path) sairia com 3 em todo login.
  describe("GarantirGit grava no Path do usuário a pasta do Git que o registro não tem", () => {
    const cenario = (registrado: string) => rodar(String.raw`
$script:gravou = @()
function AcharGit { return 'C:\Users\a\AppData\Local\Programs\Git\cmd\git.exe' }
$env:NOD_TESTE_LAD = 'C:\Users\a\AppData\Local'
function PathRegistrado { return '${registrado}' }
function PorNoPathDoUsuario([string[]]$Pastas) { $script:gravou += $Pastas }
function SaidaDe([string]$Exe, [string[]]$Argumentos) { return 'git version 2.51.0.windows.1' }
GarantirGit
Write-Host ('GRAVOU=' + ($script:gravou -join '|'))
`);

    it("fora do registro: vai para o Path do usuário", () => {
      const { status, saida } = cenario("C:\\Windows;%USERPROFILE%\\bin");
      expect(status, saida).toBe(0);
      expect(saida).toContain("GRAVOU=C:\\Users\\a\\AppData\\Local\\Programs\\Git\\cmd\n");
    });

    it("já no registro (com %VAR% ou \\ no fim): não mexe", () => {
      const { status, saida } = cenario("C:\\Windows;%NOD_TESTE_LAD%\\Programs\\Git\\cmd\\");
      expect(status, saida).toBe(0);
      expect(saida).toMatch(/GRAVOU=\s*$/m);
    });
  });

  // QA do PR #658: os critérios de aceite rodando de verdade (antes só havia conferência de texto do script).
  describe("InstalarMotor confere o sha256 do manifesto antes de trocar", () => {
    const cenario = (nome: string, adulterar: boolean) => {
      const base = join(pasta, `motor-${nome}`);
      const app = join(base, "motor", "app");
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, "nod-motor.mjs"), "motor velho");
      return { app, r: rodar(String.raw`
$App = '${app}'
$ArquivosDoMotor = @('nod-motor.mjs', 'proxy.mjs')
$NodServidor = 'https://app.nodbot.ai'
$Marca = '[nod] '
function Registrar([string]$Texto) { }
function Start-Sleep { }
function Passo([string]$Texto) { Write-Host ('PASSO=' + $Texto) }
$conteudo = @{ 'nod-motor.mjs' = 'motor novo'; 'proxy.mjs' = 'proxy novo' }
function HashDe([string]$Texto) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Texto))) -replace '-', '').ToUpperInvariant() }
function Invoke-RestMethod { param($Uri, [switch]$UseBasicParsing) return [pscustomobject]@{ versao = '1.2.3'; arquivos = [pscustomobject]@{ 'nod-motor.mjs' = (HashDe $conteudo['nod-motor.mjs']); 'proxy.mjs' = (HashDe $conteudo['proxy.mjs']) } } }
function Baixar([string]$Url, [string]$Destino) {
  $nome = Split-Path -Leaf $Url
  $texto = $conteudo[$nome]
  if ($${adulterar} -and $nome -eq 'proxy.mjs') { $texto = 'proxy adulterado' }
  [IO.File]::WriteAllText($Destino, $texto)
}
try { InstalarMotor } catch { Write-Host ('FALHOU=' + $_.Exception.Message) }
`) };
    };

    it("tudo confere: o app novo entra no lugar", () => {
      const { app, r } = cenario("ok", false);
      expect(r.status, r.saida).toBe(0);
      expect(r.saida).toContain("PASSO=motor 1.2.3");
      expect(readFileSync(join(app, "nod-motor.mjs"), "utf8")).toBe("motor novo");
      expect(existsSync(`${app}.novo`)).toBe(false);
    });

    it("um arquivo adulterado: falha e nada é trocado", () => {
      const { app, r } = cenario("adulterado", true);
      expect(r.status, r.saida).toBe(0);
      expect(r.saida).toContain("FALHOU=[nod] O arquivo proxy.mjs do motor não confere com o manifesto do servidor");
      expect(r.saida).not.toContain("PASSO=motor");
      expect(readFileSync(join(app, "nod-motor.mjs"), "utf8")).toBe("motor velho");
      expect(existsSync(join(app, "proxy.mjs"))).toBe(false);
      expect(existsSync(`${app}.novo`)).toBe(false);
    });
  });

  describe("InstalarNode: Node portátil com o sha256 do SHASUMS256", () => {
    const cenario = (nome: string, versaoAtual: string, somaCerta: boolean) => {
      const base = join(pasta, `node-${nome}`);
      const tmp = join(base, "tmp");
      const pastaNode = join(base, "node");
      mkdirSync(tmp, { recursive: true });
      mkdirSync(pastaNode, { recursive: true });
      writeFileSync(join(pastaNode, "node.exe"), `#!/bin/sh\necho ${versaoAtual}\n`);
      chmodSync(join(pastaNode, "node.exe"), 0o755);
      return { pastaNode, r: rodar(String.raw`
$NodeVersao = '24.19.0'
$PastaNode = '${pastaNode}'
$NodeExe = Join-Path $PastaNode 'node.exe'
$Tmp = '${tmp}'
$Marca = '[nod] '
$env:SystemRoot = '${join(base, "sem-windows")}'
function Registrar([string]$Texto) { }
function Start-Sleep { }
function Passo([string]$Texto) { Write-Host ('PASSO=' + $Texto) }
$fonte = Join-Path '${base}' 'fonte'
New-Item -ItemType Directory -Path (Join-Path $fonte 'node-v24.19.0-win-x64') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $fonte 'node-v24.19.0-win-x64/node.exe'), 'node novo')
$zipPronto = Join-Path '${base}' 'pronto.zip'
Compress-Archive -Path (Join-Path $fonte 'node-v24.19.0-win-x64') -DestinationPath $zipPronto
$soma = if ($${somaCerta}) { (Get-FileHash -LiteralPath $zipPronto -Algorithm SHA256).Hash.ToLowerInvariant() } else { '0' * 64 }
$script:baixados = New-Object System.Collections.Generic.List[string]
function Baixar([string]$Url, [string]$Destino) {
  $script:baixados.Add((Split-Path -Leaf $Url))
  if ($Url.EndsWith('SHASUMS256.txt')) { [IO.File]::WriteAllText($Destino, ('1' * 64) + '  node-v24.19.0-x64.msi' + [char]10 + $soma + '  node-v24.19.0-win-x64.zip' + [char]10) }
  else { Copy-Item -LiteralPath $zipPronto -Destination $Destino }
}
try { InstalarNode } catch { Write-Host ('FALHOU=' + $_.Exception.Message) }
Write-Host ('BAIXOU=' + ($script:baixados -join '|'))
`) };
    };

    it("a mesma versão já instalada: não baixa nada", () => {
      const { pastaNode, r } = cenario("igual", "v24.19.0", true);
      expect(r.status, r.saida).toBe(0);
      expect(r.saida).toContain("PASSO=Node 24.19.0");
      expect(r.saida).toMatch(/BAIXOU=\s*$/m);
      expect(readFileSync(join(pastaNode, "node.exe"), "utf8")).toContain("echo v24.19.0");
    });

    it("outra versão e o zip confere: troca a pasta do Node", () => {
      const { pastaNode, r } = cenario("troca", "v20.0.0", true);
      expect(r.status, r.saida).toBe(0);
      expect(r.saida).toContain("BAIXOU=SHASUMS256.txt|node-v24.19.0-win-x64.zip");
      expect(r.saida).toContain("PASSO=Node 24.19.0");
      expect(readFileSync(join(pastaNode, "node.exe"), "utf8")).toBe("node novo");
      expect(existsSync(`${pastaNode}.anterior`)).toBe(false);
    });

    it("o zip não confere com o SHASUMS256: falha e o Node antigo fica", () => {
      const { pastaNode, r } = cenario("adulterado", "v20.0.0", false);
      expect(r.status, r.saida).toBe(0);
      expect(r.saida).toContain("FALHOU=[nod] O Node baixado não confere (sha256)");
      expect(readFileSync(join(pastaNode, "node.exe"), "utf8")).toContain("echo v20.0.0");
    });
  });

  it("InstalarIa com a IA já no piso não roda o npm (rodar de novo não reinstala)", () => {
    const bin = join(pasta, "ia-em-dia");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "claude"), '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
    chmodSync(join(bin, "claude"), 0o755);
    const { status, saida } = rodar(String.raw`
$env:PATH = '${bin}' + [IO.Path]::PathSeparator + '/bin'
$script:npm = 0
function Rodar([string]$Exe, [string[]]$Argumentos) { $script:npm++; return 0 }
function Passo([string]$Texto) { Write-Host ('PASSO=' + $Texto) }
$ok = InstalarIa '@anthropic-ai/claude-code' 'claude' '2.1.290' 'Claude Code'
Write-Host ('OK=' + $ok + ' NPM=' + $script:npm)
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("PASSO=Claude Code 9.9.9");
    expect(saida).toContain("OK=True NPM=0");
  });

  it("PorNoPathDoUsuario é idempotente: a pasta que já está (com %VAR% ou \\ no fim) não repete, nem no Path da sessão", () => {
    const { status, saida } = rodar(String.raw`
$env:NOD_TESTE_LAD = 'C:\Users\a\AppData\Local'
$script:reg = [pscustomobject]@{ Valor = 'C:\a;%NOD_TESTE_LAD%\nod\bin\'; Gravou = 0 }
$script:reg | Add-Member -MemberType ScriptMethod -Name GetValue -Value { param($n, $d, $o) return $this.Valor }
$script:reg | Add-Member -MemberType ScriptMethod -Name SetValue -Value { param($n, $v, $k) $this.Valor = $v; $this.Gravou++ }
$script:reg | Add-Member -MemberType ScriptMethod -Name Close -Value { }
function ChaveDoAmbiente { return $script:reg }
$script:marcas = 0
function MarcarInstalacao { $script:marcas++ }
function PathRegistrado { return 'C:\Windows;' + $script:reg.Valor }
$env:Path = 'C:\Windows'
PorNoPathDoUsuario @('C:\Users\a\AppData\Local\nod\bin')
Write-Host ('R1=' + $script:reg.Valor + ' GRAVOU=' + $script:reg.Gravou + ' MARCAS=' + $script:marcas)
PorNoPathDoUsuario @('C:\novo')
PorNoPathDoUsuario @('C:\novo', 'C:\Users\a\AppData\Local\nod\bin')
Write-Host ('R2=' + $script:reg.Valor + ' GRAVOU=' + $script:reg.Gravou + ' MARCAS=' + $script:marcas)
Write-Host ('SESSAO=' + $env:Path)
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("R1=C:\\a;%NOD_TESTE_LAD%\\nod\\bin\\ GRAVOU=0 MARCAS=0\n");
    expect(saida).toContain("R2=C:\\a;%NOD_TESTE_LAD%\\nod\\bin\\;C:\\novo GRAVOU=1 MARCAS=1\n");
    const sessao = (/^SESSAO=(.*)$/m.exec(saida)?.[1] ?? "").split(";").map((p) => p.replace(/\\$/, "").toLowerCase());
    expect(sessao).toContain("c:\\novo");
    expect(new Set(sessao).size).toBe(sessao.length);
  });

  it("AtualizarPathDaSessao junta registro e sessão sem repetir pasta (maiúsculas e \\ no fim)", () => {
    const { status, saida } = rodar(String.raw`
function PathRegistrado { return 'C:\Windows;C:\Users\a\bin\' }
$env:Path = 'c:\users\A\BIN;C:\x;C:\x\;;C:\WINDOWS'
AtualizarPathDaSessao
Write-Host ('SESSAO=' + $env:Path)
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("SESSAO=C:\\Windows;C:\\Users\\a\\bin\\;C:\\x\n");
  });

  it("Trocar: se a segunda troca falha, a versão anterior volta para o lugar", () => {
    const destino = join(pasta, "troca", "app");
    const novo = `${destino}.novo`;
    mkdirSync(destino, { recursive: true });
    mkdirSync(novo, { recursive: true });
    writeFileSync(join(destino, "velho.txt"), "velho");
    const { status, saida } = rodar(String.raw`
$Marca = '[nod] '
function Registrar([string]$Texto) { }
function Start-Sleep { }
function Move-Item { param($LiteralPath, $Destination) if ($LiteralPath -eq '${novo}') { throw 'preso pelo antivirus' }; Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination }
try { Trocar '${novo}' '${destino}' } catch { Write-Host ('FALHOU=' + $_.Exception.Message) }
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("FALHOU=[nod] Não deu para trocar");
    expect(readFileSync(join(destino, "velho.txt"), "utf8")).toBe("velho");
    expect(existsSync(`${destino}.anterior`)).toBe(false);
  });

  describe("Principal: a reexecução com conexão não pareia de novo e o motor volta", () => {
    const cenario = (nome: string, comConexao: boolean, saidaDoParear: number) => {
      const base = join(pasta, `principal-${nome}`);
      mkdirSync(base, { recursive: true });
      const conexao = join(base, "conexao.json");
      if (comConexao) writeFileSync(conexao, "{}");
      return rodar(String.raw`
$Pasta = '${base}'
$Tmp = Join-Path $Pasta 'tmp'
$Log = Join-Path $Pasta 'instalador.log'
$Conexao = '${conexao}'
$NodVersao = '1.2.3'
$NodServidor = 'https://app.nodbot.ai'
$Marca = '[nod] '
$PastaBin = 'bin'; $PastaNode = 'node'; $PastaNpm = 'npm'
$script:passos = New-Object System.Collections.Generic.List[string]
foreach ($f in @('Conferir', 'GarantirGit', 'PararMotor', 'InstalarNode', 'PorNoPathDoUsuario', 'InstalarIas', 'InstalarMotor', 'CriarComandos', 'RegistrarInicio', 'IniciarMotor')) {
  Set-Item ('function:' + $f) ([scriptblock]::Create('$script:passos.Add(''' + $f + ''')'))
}
function Parear { $script:passos.Add('Parear'); return ${saidaDoParear} }
try { Principal } catch { Write-Host ('FALHOU=' + $_.Exception.Message) }
Write-Host ('PASSOS=' + ($script:passos -join '|'))
`);
    };
    const instalacao = "Conferir|GarantirGit|PararMotor|InstalarNode|PorNoPathDoUsuario|InstalarIas|InstalarMotor|CriarComandos|RegistrarInicio";

    it("com a conexão: instala, sobe o motor e não pareia", () => {
      const { status, saida } = cenario("reexecucao", true, 0);
      expect(status, saida).toBe(0);
      expect(saida).toContain(`PASSOS=${instalacao}|IniciarMotor\n`);
    });

    it("sem a conexão: pareia e só então sobe o motor", () => {
      const { status, saida } = cenario("primeira", false, 0);
      expect(status, saida).toBe(0);
      expect(saida).toContain(`PASSOS=${instalacao}|Parear|IniciarMotor\n`);
    });

    it("o pareamento que não termina falha e não sobe o motor", () => {
      const { status, saida } = cenario("sem-parear", false, 3);
      expect(status, saida).toBe(0);
      expect(saida).toContain("FALHOU=[nod] O pareamento não terminou");
      expect(saida).toContain(`PASSOS=${instalacao}|Parear\n`);
    });
  });

  // O try/catch do fim do script (fora de função): a falha marca o resultado e devolve o motor que estava rodando.
  it("a falha no meio marca NOD_INSTALACAO_RESULTADO=falhou e chama o RetomarMotor", () => {
    const { status, saida } = rodar(String.raw`
$arvore = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$null, [ref]$null)
$fim = @($arvore.FindAll({ param($n) $n -is [System.Management.Automation.Language.TryStatementAst] -and $n.Body.Extent.Text -match '^\{\s*Principal' }, $true))
if ($fim.Count -ne 1) { throw 'sem o try do fim' }
$Marca = '[nod] '
$Log = 'instalador.log'
function Registrar([string]$Texto) { }
function Principal { throw '[nod] quebrou no meio' }
function RetomarMotor { Write-Host 'RETOMOU' }
. ([scriptblock]::Create($fim[0].Extent.Text))
Write-Host ('RESULTADO=' + $env:NOD_INSTALACAO_RESULTADO)
`);
    expect(status, saida).toBe(0);
    expect(saida).toContain("quebrou no meio");
    expect(saida).toContain("RETOMOU");
    expect(saida).toContain("RESULTADO=falhou");
  });
});

