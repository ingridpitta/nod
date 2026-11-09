import type { TransporteConector } from "../contracts/conector.ts";
import { ErroDeDominio } from "./erro.ts";

const HEADERS_RESERVADOS = ["host", "content-length", "connection", "transfer-encoding", "mcp-session-id", "mcp-protocol-version", "content-type", "accept"];

/**
 * O nome de UMA chave serve para o transporte (definido em 2026-10-28, NOD-50: o cartão de credencial troca uma chave só;
 * a mesma regra do env inteiro abaixo). stdio = nome de variável de ambiente; http = header não reservado.
 */
export function nomeDeChaveValido(chave: string, transporte: TransporteConector): boolean {
  if (chave.length === 0 || chave.length > 128) return false;
  if (transporte === "stdio") return /^[A-Za-z_][A-Za-z0-9_]*$/.test(chave) && !variavelDeSistema(chave);
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(chave) && !HEADERS_RESERVADOS.includes(chave.toLowerCase());
}

/**
 * Variáveis que mudam o processo e não o app (revisão do PR #553): o cartão de credencial nasce de um pedido do BOT, e o
 * env do conector sobrescreve o ambiente do spawn — um bot sob injeção que pedisse NODE_OPTIONS, LD_PRELOAD ou PATH
 * transformaria a chave colada em execução de código na sonda. A spec já dizia "nunca variável de sistema".
 */
const VARIAVEIS_DE_SISTEMA = new Set(["PATH", "HOME", "SHELL", "USER", "LOGNAME", "PWD", "TMPDIR", "TEMP", "TMP", "IFS", "ENV", "BASH_ENV", "PROMPT_COMMAND", "EDITOR", "VISUAL", "PAGER", "GIT_SSH", "GIT_SSH_COMMAND", "GIT_ASKPASS", "SSH_ASKPASS", "SSH_AUTH_SOCK", "PERL5OPT", "PERL5LIB", "RUBYOPT", "RUBYLIB", "GEM_HOME", "GEM_PATH", "CLASSPATH", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "MAVEN_OPTS", "GRADLE_OPTS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR"]);
const PREFIXOS_DE_SISTEMA = ["NODE_", "NPM_", "LD_", "DYLD_", "PYTHON", "BUN_", "DENO_", "UV_", "PIP_", "XDG_", "NOD_"];

export function variavelDeSistema(chave: string): boolean {
  const k = chave.toUpperCase();
  return VARIAVEIS_DE_SISTEMA.has(k) || PREFIXOS_DE_SISTEMA.some((p) => k.startsWith(p));
}

/**
 * A chave que o BOT pode pedir pelo cartão (revisão 2 do PR #553): a lista de bloqueio acima não fecha a classe (sempre há
 * outra variável que muda o processo, como JDK_JAVA_OPTIONS), então é por PERMISSÃO (abaixo).
 */
const NOME_DE_CREDENCIAL = /(^|_)(API_?KEY|APIKEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|PAT|AUTH|CREDENTIALS?|BEARER|CLIENT_ID|CLIENT_SECRET)(_|$)/;

/**
 * Nome com cara de credencial que ainda muda o processo ou o destino: config do git, caminho de arquivo (…_FILE, …_PATH), ou
 * endereço (…_URL, …_HOST, …_ENDPOINT, proxy — a chave real iria a um servidor que o bot escolheu; revisão 8).
 */
const NAO_E_SO_CREDENCIAL = /^GIT_|_(FILE|PATH|DIR|CREDENTIALS)$|(^|_)(URL|URI|HOST|HOSTNAME|ENDPOINT|BASE|PROXY|DOMAIN|SERVER|ORIGIN|ADDR|ADDRESS|PORT)(_|$)/;

/**
 * Revisão 4 do PR #553: stdio só troca a chave que a pessoa já declarou ao registrar o conector — um bot sob injeção não
 * leva a pessoa a colar uma chave nova (OPENAI_API_KEY…) num pacote de terceiro; chave nova se acrescenta na tela de apps.
 * http: só header já declarado com nome de credencial (X-API-Key, …-Token) ou Authorization; nunca Cookie, Origin e afins.
 */
export function chavePedivel(chave: string, transporte: TransporteConector, declaradas: readonly string[]): boolean {
  if (!nomeDeChaveValido(chave, transporte)) return false;
  const k = chave.toUpperCase().replace(/-/g, "_");
  if (NAO_E_SO_CREDENCIAL.test(k)) return false;
  // stdio (revisão 8): declarada E com nome de credencial — OUTRA_VAR declarada não é segredo e o cartão não a troca.
  if (transporte === "stdio") return declaradas.includes(chave) && NOME_DE_CREDENCIAL.test(k);
  // http (revisão 5): também só o header já declarado — um header novo mandaria a chave colada a cada chamada ao
  // servidor do conector. Authorization é a exceção: é o header de credencial que qualquer servidor espera.
  // Revisão 7: Authorization também só se já declarado (antes valia sempre e acrescentava um header novo).
  return declaradas.some((d) => d.toLowerCase() === chave.toLowerCase()) && (NOME_DE_CREDENCIAL.test(k) || k === "AUTHORIZATION");
}

/**
 * Revisão 7 do PR #553: conector que o nod gere — nativo (`nod:`) ou do Composio (a sessão do toolkit aponta para ele, ou a
 * URL é do Composio). A chave do Composio é do time e se troca pelo alvo 'composio' ou na tela de apps; pelo cartão, um
 * segredo qualquer colado iria para backend.composio.dev.
 */
export function conectorGeridoPeloNod(c: { id: string; comando?: string | null; url?: string | null }, conectorDaSessaoComposio: string | null | undefined): boolean {
  if (c.comando?.startsWith("nod:") || c.id === conectorDaSessaoComposio) return true;
  // Domínio puro (sem URL): o host é o que vem entre "//" e o primeiro "/", ":", "?" ou "#" (sem credencial "user@").
  const host = (/^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?([^/?#:]*)/i.exec(c.url ?? "")?.[1] ?? "").toLowerCase().replace(/\.$/, "");
  return host === "composio.dev" || host.endsWith(".composio.dev");
}

/** definido em 2026-09-17: credenciais stdio são env; HTTP recebe apenas os headers explicitamente cadastrados. */
export function validarCredenciais(env: unknown, transporte: TransporteConector): Record<string, string> {
  if (typeof env !== "object" || env === null || Array.isArray(env)) throw new ErroDeDominio("entrada_invalida");
  const legivel: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === true) throw new ErroDeDominio("env_placeholder_chave_nova");
    const chaveValida = transporte === "stdio" ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) : /^[A-Za-z][A-Za-z0-9_-]*$/.test(k);
    if (typeof v !== "string" || !chaveValida || (transporte === "http" && (/[\r\n]/.test(v) || HEADERS_RESERVADOS.includes(k.toLowerCase())))) throw new ErroDeDominio("entrada_invalida");
    legivel[k] = v;
  }
  return legivel;
}
