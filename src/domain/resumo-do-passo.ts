import type { PassoDoRun } from "../contracts/quadro-comentarios.ts";

/**
 * Os passos do run persistidos (ADR-165, definido em 2026-11-10): o resumo de UMA linha do argumento da ferramenta,
 * montado no executor (app do Mac, motor, laço local) e redigido duas vezes — no executor, antes de sair, e no servidor,
 * antes de gravar e publicar. Nunca o argumento inteiro nem a saída. Puro: o desktop e o motor importam daqui.
 */

/** O teto do resumo que o executor manda (o do banco é RESUMO_DO_PASSO_MAX, 160). */
export const RESUMO_NO_EXECUTOR_MAX = 120;

const TAPADO = "••••";

/** Chaves com prefixo conhecido (as de `redigir` da linha do tempo, mais as que o Multica e o gitleaks pegam). */
const CHAVES_CONHECIDAS =
  /\b(?:sk-[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{8,}|rk_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{16,}|npm_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ya29\.[0-9A-Za-z_-]{20,})/g;
/** JWT (três partes base64url, a primeira começa por `eyJ`). */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
/** Chave privada colada (o cabeçalho PEM e o que vier depois na mesma linha). */
const CHAVE_PRIVADA = /-----BEGIN [A-Z ]*PRIVATE KEY-----.*/g;
/** URL com credencial: `esquema://usuário:senha@host`. */
const URL_COM_CREDENCIAL = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;
/** `Bearer <token>` (cabeçalho de autorização). */
const BEARER = /\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
/** `token=…`, `senha: …`, `"password": "…"`, `--api-key …`: o nome fica, o valor sai. */
const NOME_DE_SEGREDO = "(?:token|senha|password|passwd|pwd|secret|segredo|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|authorization|credential|credencial|cookie)";
/**
 * O nome com prefixo e sufixo em snake_case/kebab-case (`db_password`, `github_token`, `aws_secret_access_key`). Revisão do
 * PR #16: com `\b` antes do nome, `db_password` passava (o `_` é letra para o `\b`).
 */
const NOME_COMPOSTO = `(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_-])*${NOME_DE_SEGREDO}(?:[_-][A-Za-z0-9]+)*`;
/** O valor de `Authorization: token x` / `Bearer x` / `Basic x`: o esquema e o valor saem juntos. */
const VALOR = `(?:(?:bearer|basic|token)\\s+)?[^\\s"'&,;)]+`;
const ATRIBUICAO = new RegExp(`(${NOME_COMPOSTO}["']?)(\\s*[:=]\\s*)(["']?)${VALOR}`, "gi");
const FLAG = new RegExp(`(--(?:[a-z0-9]+-)*${NOME_DE_SEGREDO}(?:-[a-z0-9]+)*)([= ])(["']?)[^\\s"']+`, "gi");
/** O nome sozinho seguido de um valor longo (`token abc…`, `aws_secret_access_key abc…`), como o `redigir` da linha do tempo. */
const NOME_E_VALOR_LONGO = new RegExp(`(${NOME_COMPOSTO})(\\s+)[A-Za-z0-9._~+/=-]{16,}`, "gi");
/** A senha como opção curta da linha de comando: `mysql -pX`, `sshpass -p X`, `redis-cli -a X`, `curl -u user:senha`. */
const SENHA_NA_OPCAO = /(\bmysql(?:dump|admin)?\b[^|;&]*?\s-p)(\S+)|(\bsshpass\s+-p\s*)(\S+)|(\bredis-cli\b[^|;&]*?\s-a\s+)(\S+)|(\s(?:-u|--user)[= ]?\s*[^\s:]+:)(\S+)/g;
/** `CHAVE=valor` de env (nome em maiúsculas, como `export OPENAI_API_KEY=…` ou `PGPASSWORD=… psql`). */
const ENV = /\b([A-Z][A-Z0-9_]{2,})=("[^"]*"|'[^']*'|\S+)/g;
/** Candidato a trecho longo de base64/hex; quem decide é `pareceSegredo` (um caminho comprido não é segredo). */
const TRECHO_LONGO = /[A-Za-z0-9+/_=-]{32,}/g;

/** Um pedaço (entre barras) de 32 ou mais com maiúscula, minúscula e dígito (base64), ou só hexadecimal. */
function pareceSegredo(trecho: string): boolean {
  return trecho.split("/").some((s) => {
    const p = s.replace(/=+$/, "");
    if (p.length < 32) return false;
    if (/^[0-9a-f]+$/i.test(p)) return true;
    return /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p);
  });
}

/** Corta em `max` caracteres (pontos de código, nunca meio emoji), com reticências dentro do teto. */
function cortar(texto: string, max: number): string {
  const cs = Array.from(texto);
  if (cs.length <= max) return texto;
  return `${cs.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/**
 * Uma linha, sem segredo, em até `max` caracteres. O segredo sai ANTES do corte (um corte no meio de uma chave deixaria o
 * começo dela sem casar com a regra). Regras: as do `redigir` de web/telas/linha-do-tempo.ts (sk-, ghp_, github_pat_,
 * xox, AKIA, glpat-, Bearer/token/senha/password/secret, base64/hex longos), mais URL com `usuário:senha@`, `CHAVE=valor`
 * de env, `--token x`, JWT e chave privada.
 */
export function redigirResumo(texto: string, max: number): string {
  const linha = texto.replace(/\s+/g, " ").trim();
  const limpo = linha
    .replace(CHAVE_PRIVADA, TAPADO)
    .replace(URL_COM_CREDENCIAL, `$1${TAPADO}@`)
    .replace(CHAVES_CONHECIDAS, TAPADO)
    .replace(JWT, TAPADO)
    .replace(BEARER, `$1$2${TAPADO}`)
    .replace(SENHA_NA_OPCAO, (_m, a1, _v1, a2, _v2, a3, _v3, a4) => `${a1 ?? a2 ?? a3 ?? a4}${TAPADO}`)
    .replace(FLAG, `$1$2$3${TAPADO}`)
    .replace(ATRIBUICAO, `$1$2$3${TAPADO}`)
    .replace(NOME_E_VALOR_LONGO, `$1$2${TAPADO}`)
    .replace(ENV, `$1=${TAPADO}`)
    .replace(TRECHO_LONGO, (t) => (pareceSegredo(t) ? TAPADO : t));
  return cortar(limpo, max);
}

/** `bash -lc '<cmd>'` / `sh -c "<cmd>"`: o invólucro é ruído numa linha (o padrão do Multica, trace-event-presenter.ts). */
const INVOLUCRO_SHELL = /^(?:\/[\w./-]*\/)?(?:zsh|bash|sh|fish)\s+(?:-[a-z]+\s+)*(['"])([\s\S]+)\1$/;

export function semInvolucroShell(comando: string): string {
  return INVOLUCRO_SHELL.exec(comando.trim())?.[2] ?? comando;
}

/** Só o nome do arquivo, sem o diretório (o caminho diz da máquina da pessoa: a pasta, o usuário). */
function nomeDoArquivo(caminho: string): string {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

/** A URL sem a credencial, a busca nem o fragmento (o `?token=` fica no Mac). Domínio puro: sem o `URL` global. */
function urlCurta(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#]+)([^?#]*)/i.exec(url.trim());
  return m ? `${m[1]}${m[2] === "/" ? "" : m[2]}` : "";
}

/** O input como objeto: o Codex manda os argumentos do MCP como texto JSON. */
function comoObjeto(input: unknown): Record<string, unknown> | null {
  if (typeof input === "string") {
    try {
      return comoObjeto(JSON.parse(input) as unknown);
    } catch {
      return null;
    }
  }
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
}

/**
 * O resumo do argumento de uma chamada, já redigido, em até RESUMO_NO_EXECUTOR_MAX; undefined = nada a dizer. Prioridade
 * do Multica (traceToolArgSummary), adaptada: a busca (`query`; numa ferramenta de busca, o `pattern` também) → o arquivo
 * (só o nome) → o padrão → a descrição → o comando (sem o `bash -lc`) → a URL sem a busca. As chaves do nod em português
 * (`consulta`, `caminho`, `comando`, `descricao`) contam como as do CLI. Nunca o conteúdo de um Write, o patch ou o prompt
 * de um subagente: só esses campos.
 */
export function resumoDaFerramenta(nome: string, input: unknown): string | undefined {
  const o = comoObjeto(input);
  if (!o) return undefined;
  const s = (...chaves: string[]): string => {
    for (const k of chaves) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v;
      // O Codex manda o comando como lista (`["bash", "-lc", "…"]`).
      if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string")) return (v as string[]).join(" ");
    }
    return "";
  };
  const busca = s("query", "consulta", "busca", "termo") || (classeDaFerramenta(nome) === "busca" ? s("pattern") : "");
  const arquivo = nomeDoArquivo(s("file_path", "notebook_path", "path", "caminho", "arquivo"));
  const cru = busca || arquivo || s("pattern") || s("description", "descricao") || semInvolucroShell(s("command", "cmd", "comando")) || urlCurta(s("url"));
  const r = redigirResumo(cru, RESUMO_NO_EXECUTOR_MAX);
  return r ? r : undefined;
}

const COMANDO = new Set(["Bash", "BashOutput", "KillShell", "KillBash", "Monitor", "TaskStop", "shell", "local_shell", "exec_command", "unified_exec"]);
const ARQUIVO = new Set(["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead", "apply_patch", "view_image", "LS"]);
const BUSCA = new Set(["Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch", "web_search"]);

/**
 * O ícone e o agrupamento do passo de ferramenta: Bash/shell → comando; Read/Write/Edit/arquivo → arquivo;
 * Grep/Glob/WebSearch/busca → busca; MCP (o nod e os conectores) → app (o terminal, os arquivos e as buscas do nod
 * contam como os nativos); o resto → outro.
 */
export function classeDaFerramenta(nome: string): PassoDoRun["classe"] {
  if (COMANDO.has(nome)) return "comando";
  if (ARQUIVO.has(nome)) return "arquivo";
  if (BUSCA.has(nome)) return "busca";
  const m = /^mcp__.+?__(.+)$/.exec(nome);
  if (!m) return "outro";
  const curto = m[1]!;
  if (/(^|_)terminal$/.test(curto)) return "comando";
  if (/(^|_)(ler|gravar)_arquivo$|(^|_)arquivos$/.test(curto)) return "arquivo";
  if (/^buscar_/.test(curto)) return "busca";
  return "app";
}

/** O nome curto da ferramenta (o grupo de 3 ou mais iguais seguidas): a nativa como veio, a MCP sem `mcp__servidor__`. */
export function nomeCurtoDaFerramenta(nome: string): string {
  const curto = /^mcp__.+?__(.+)$/.exec(nome)?.[1] ?? nome;
  return Array.from(curto).slice(0, 80).join("") || "ferramenta";
}
