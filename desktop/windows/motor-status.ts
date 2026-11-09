import { TAREFA_DO_MOTOR, type Comando } from "./instalacao.ts";

/**
 * ADA-229 (ADR-152, item 6): o vigia do motor. A cada 30 s um PowerShell curto e oculto diz se a tarefa
 * `nod-motor-<SID>` existe e se há um node.exe rodando o `nod-motor.mjs`; parado com a tarefa, o app religa pela tarefa.
 * A saída é uma linha JSON, lida aqui sem Electron (tests/unit/desktop/windows/motor-status.test.ts).
 */
export const INTERVALO_DO_VIGIA_MS = 30_000;

export type EstadoDoMotor = "rodando" | "parado" | "ausente" | "desconhecido";

export type LeituraDoMotor = { tarefa: string | null; processos: number; instalado: boolean };

const SCRIPT_DE_STATUS = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  "$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  `$t = Get-ScheduledTask -TaskName ('${TAREFA_DO_MOTOR}-' + $sid) -TaskPath '\\'`,
  "$p = @(Get-CimInstance -ClassName Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf('nod-motor.mjs', [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count",
  "$pasta = if ($env:NOD_PASTA) { $env:NOD_PASTA } else { Join-Path $env:LOCALAPPDATA 'nod' }",
  "$i = Test-Path -LiteralPath (Join-Path $pasta 'motor\\app\\nod-motor.mjs')",
  "$e = if ($t) { [string]$t.State } else { $null }",
  "ConvertTo-Json -Compress @{ tarefa = $e; processos = $p; instalado = $i }",
].join("; ");

const RELIGAR = `Start-ScheduledTask -TaskName ('${TAREFA_DO_MOTOR}-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) -TaskPath '\\'`;

const powershell = (systemRoot: string, script: string): Comando => ({
  arquivo: `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
  args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script],
});

export const comandoDeStatus = (systemRoot = "C:\\Windows"): Comando => powershell(systemRoot, SCRIPT_DE_STATUS);
export const comandoDeReligar = (systemRoot = "C:\\Windows"): Comando => powershell(systemRoot, RELIGAR);

/** A linha JSON do status, ou null se não veio (PowerShell quebrado, saída cortada). */
export function lerStatusDoMotor(saida: string): LeituraDoMotor | null {
  const linha = saida.split("\n").map((s) => s.trim()).filter(Boolean).pop();
  if (!linha) return null;
  let v: unknown;
  try { v = JSON.parse(linha); } catch { return null; }
  if (typeof v !== "object" || v === null) return null;
  const { tarefa, processos, instalado } = v as Record<string, unknown>;
  if (tarefa !== null && typeof tarefa !== "string") return null;
  if (typeof processos !== "number" || !Number.isInteger(processos) || processos < 0) return null;
  return { tarefa, processos, instalado: instalado === true };
}

/** Rodando = um node.exe com o motor; sem motor instalado nem tarefa = ausente (instalar); o resto = parado. */
export function estadoDoMotor(l: LeituraDoMotor | null): EstadoDoMotor {
  if (!l) return "desconhecido";
  if (l.processos > 0) return "rodando";
  if (!l.instalado && l.tarefa === null) return "ausente";
  return "parado";
}

/** Religar só com a tarefa existente e fora de execução (a tarefa "Running" sem processo está subindo). */
export const deveReligar = (l: LeituraDoMotor | null): boolean => !!l && l.processos === 0 && l.tarefa !== null && l.tarefa !== "Running" && l.tarefa !== "Disabled";

/** Uma rodada do vigia: a saída do PowerShell vira o estado e se é para religar pela tarefa. */
export function vigiar(saida: string): { estado: EstadoDoMotor; religar: boolean; tarefa: string | null } {
  const l = lerStatusDoMotor(saida);
  return { estado: estadoDoMotor(l), religar: deveReligar(l), tarefa: l?.tarefa ?? null };
}

export const TEXTO_DO_ESTADO: Record<EstadoDoMotor, string> = {
  rodando: "Motor no ar",
  parado: "Motor parado: religando",
  ausente: "Motor não instalado",
  desconhecido: "Conferindo o motor…",
};
