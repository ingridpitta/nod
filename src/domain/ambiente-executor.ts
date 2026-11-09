export type RegimeAmbiente = "local" | "servidor";

/**
 * Regime LOCAL (ADR-015 revisado, ADR-014 invertido): o CLI é o da pessoa e resolve a própria
 * credencial pelo Keychain; o filho HERDA o ambiente menos a DENYLIST. A sonda de 2026-09-16 mediu
 * (run.sh): removendo exatamente estas variáveis, init.apiKeySource ficou 'none'
 * (cobrança na assinatura claude.ai); com ANTHROPIC_API_KEY herdada viraria API sem aviso.
 * NOD_.* também sai: o filho não vê segredo de sessão, URL do banco nem chave de cifra.
 */
const PREFIXOS_NEGADOS = ["CLAUDE_CODE_", "ANTHROPIC_", "NOD_"] as const;
/**
 * revisto em 2026-10-09 (revisão do PR 1, ADR-093): ELECTRON_RUN_AS_NODE também sai. Com ela herdada, todo app Electron
 * que um bot abrisse viraria node; quem precisa do Electron como node (o proxy MCP, o hook) a recebe explícita.
 */
const NOMES_NEGADOS = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "ELECTRON_RUN_AS_NODE"] as const;

/** Regime SERVIDOR: parte de {} e copia só a allowlist (ADR-015 B). Sem chave de fornecedor nesta rodada. */
const ALLOWLIST_SERVIDOR = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR"] as const;

export function chaveNegada(nome: string): boolean {
  if ((NOMES_NEGADOS as readonly string[]).includes(nome)) return true;
  return PREFIXOS_NEGADOS.some((p) => nome.startsWith(p));
}

/**
 * ADA-11 (ADR-147): no Windows o filho sem `SystemRoot` não acha nem o Winsock, e o nome das variáveis não tem caixa
 * (`Path` = `PATH`). A allowlist do servidor ganha o mínimo do Windows, lido sem caixa e gravado com o nome de sempre.
 */
const ALLOWLIST_WINDOWS = ["SystemRoot", "windir", "SystemDrive", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "ComSpec", "PATHEXT", "TEMP", "TMP", "ProgramData", "ProgramFiles"] as const;

function lerSemCaixa(source: Readonly<Record<string, string | undefined>>, nome: string): string | undefined {
  const alvo = nome.toUpperCase();
  for (const [k, v] of Object.entries(source)) if (k.toUpperCase() === alvo && v !== undefined) return v;
  return undefined;
}

/** ADR-147: grava `PATH` tirando as outras grafias (`Path`), que no Windows são a mesma variável e duplicariam. */
export function comPath(env: Readonly<Record<string, string>>, valor: string, windows: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (!(windows && k.toUpperCase() === "PATH")) out[k] = v;
  out.PATH = valor;
  return out;
}

export function montarAmbiente(regime: RegimeAmbiente, source: Readonly<Record<string, string | undefined>>, plataforma?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (regime === "local") {
    for (const [k, v] of Object.entries(source)) {
      if (v === undefined || chaveNegada(k)) continue;
      out[k] = v;
    }
    return out;
  }
  const windows = plataforma === "win32";
  for (const k of windows ? [...ALLOWLIST_SERVIDOR, ...ALLOWLIST_WINDOWS] : ALLOWLIST_SERVIDOR) {
    const v = windows ? lerSemCaixa(source, k) : source[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const ALLOWLIST_AMBIENTE_SERVIDOR = ALLOWLIST_SERVIDOR;

/**
 * definido em 2026-09-24 (ADR-048): conector NATIVO do nod (hoje só o GitHub, `comando` = marca
 * `nod:…`) recebe, além da allowlist do servidor, o mínimo que o `gh` precisa para achar a conta já
 * logada: o usuário (o Keychain do macOS é por usuário) e onde a configuração do gh mora. Conector de
 * terceiro continua só com a allowlist do servidor mais o próprio env: esta lista não vale para ele.
 */
const ALLOWLIST_NATIVO_EXTRA = ["USER", "LOGNAME", "XDG_CONFIG_HOME", "GH_CONFIG_DIR", "GH_HOST"] as const;

export function montarAmbienteConectorNativo(source: Readonly<Record<string, string | undefined>>, plataforma?: string): Record<string, string> {
  const out = montarAmbiente("servidor", source, plataforma);
  for (const k of ALLOWLIST_NATIVO_EXTRA) {
    const v = source[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
