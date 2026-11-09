# ADA-226: o que o nod-windows-x64.exe roda, num PowerShell escondido, com a saida na janela do instalador.
# Faz o mesmo que "irm <servidor>/windows | iex" (ADA-32, ADR-151). O servidor chega pela variavel NOD_EXE_SERVIDOR
# (o .exe a define; nunca vai interpolado na linha de comando). Sai com 0 so quando o script da ADA-32 terminou ok.
[Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSAvoidUsingInvokeExpression', '', Justification = 'e o irm | iex da ADA-32, com o texto conferido antes')]
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# O instalador le a saida na pagina de codigo ANSI do Windows: sem isso os acentos viram lixo na janela.
try { [Console]::OutputEncoding = [System.Text.Encoding]::Default } catch { $null = $_ }

$servidor = [string]$env:NOD_EXE_SERVIDOR
# \z e nao $: no .NET o $ casa antes de um \n final.
if ($servidor -cnotmatch '^(https://[A-Za-z0-9.-]+(:[0-9]{1,5})?|http://127\.0\.0\.1:[0-9]{1,5})\z') {
  Write-Output ('Endereço do servidor inválido: ' + $servidor)
  exit 2
}
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { $null = $_ }

Write-Output ('Baixando o instalador do Nod de ' + $servidor + '...')
try { $script = [string](Invoke-RestMethod -Uri ($servidor + '/windows') -UseBasicParsing) }
catch {
  Write-Output ('Não consegui falar com ' + $servidor + ': ' + $_.Exception.Message)
  Write-Output 'Confira a internet e rode o instalador de novo.'
  exit 3
}
if (-not $script.Contains('NOD_INSTALACAO_RESULTADO')) {
  Write-Output ('O endereço ' + $servidor + '/windows não devolveu o instalador do Nod.')
  exit 3
}

$env:NOD_INSTALACAO_RESULTADO = ''
# A pasta do .exe e sempre %LOCALAPPDATA%\nod (o desinstalador e o RMDir /r so conhecem ela): um NOD_PASTA herdado do
# suporte faria a ADA-32 instalar em outro lugar, que a desinstalacao deixaria no Path e com o motor de pe.
Remove-Item -Path Env:NOD_PASTA -ErrorAction SilentlyContinue
try { Invoke-Expression $script }
catch { Write-Output ('A instalação parou: ' + $_.Exception.Message) }
if ($env:NOD_INSTALACAO_RESULTADO -ne 'ok') { exit 1 }
exit 0
