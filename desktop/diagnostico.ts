import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { CamposLog } from "../src/obs/log.ts";

/**
 * Log local e diagnóstico do app do Mac (definido em 2026-10-05, NOD-138). Sem Electron, para testar em tmpdir;
 * desktop/main.ts liga as peças. O stdout do app empacotado se perde: o destino do log() grava aqui.
 *
 * - `nod.log` com modo 0600; passou de `maxBytes`, vira `nod.1.log` (duas gerações, no máximo 2 × maxBytes).
 * - Ler e escrever nunca seguem symlink (O_NOFOLLOW) nem arquivo com outro nome apontando para ele (nlink === 1):
 *   um `nod.log` trocado não vira um jeito de ler ou sobrescrever outro arquivo da pessoa.
 * - Tudo síncrono: o registro de queda roda no uncaughtExceptionMonitor, onde um stream assíncrono não esvazia.
 */
export const ARQUIVO_LOG = "nod.log";
export const ARQUIVO_LOG_ANTERIOR = "nod.1.log";
/** definido em 2026-10-05 (spec da NOD-138): 1 MiB por geração, duas gerações. */
export const MAX_BYTES_LOG = 1_048_576;

const ehRegularUnico = (s: { isFile(): boolean; nlink: number }) => s.isFile() && s.nlink === 1;

function existe(caminho: string) {
  try { return lstatSync(caminho); } catch { return null; }
}

/** Destino do log(): uma linha por chamada, com rotação. Erro sobe para o try/catch do log(). */
export function criarArquivoDeLog(o: { dir: string; maxBytes: number }): (linha: string) => void {
  const atual = join(o.dir, ARQUIVO_LOG);
  const anterior = join(o.dir, ARQUIVO_LOG_ANTERIOR);
  let tamanho: number | null = null;
  return (linha) => {
    let dados = `${linha}\n`;
    // Uma linha maior que a geração inteira estouraria o teto: fica só o aviso de que ela existiu.
    if (Buffer.byteLength(dados) > o.maxBytes) dados = `${JSON.stringify({ ts: new Date().toISOString(), nivel: "aviso", evento: "log_linha_descartada", bytes: Buffer.byteLength(dados) })}\n`;
    const bytes = Buffer.byteLength(dados);
    if (tamanho === null) {
      mkdirSync(o.dir, { recursive: true, mode: 0o700 });
      tamanho = existe(atual)?.size ?? 0;
    }
    if (tamanho + bytes > o.maxBytes) {
      // Dois log() no limite podem girar duas vezes: o segundo rename não acha o arquivo, e tudo bem.
      try { renameSync(atual, anterior); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      tamanho = 0;
    }
    const fd = openSync(atual, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const s = fstatSync(fd);
      if (!ehRegularUnico(s)) throw new Error("log_recusado");
      if ((s.mode & 0o777) !== 0o600) fchmodSync(fd, 0o600);
      writeSync(fd, dados);
      tamanho = s.size + bytes;
    } finally { closeSync(fd); }
  };
}

/** Cauda de um arquivo, sem a linha parcial do começo. `null` se ausente, symlink, hardlink ou não regular. */
function lerCauda(caminho: string, teto: number): string | null {
  let fd: number | null = null;
  try {
    const antes = lstatSync(caminho);
    if (!ehRegularUnico(antes)) return null;
    fd = openSync(caminho, constants.O_RDONLY | constants.O_NOFOLLOW);
    const s = fstatSync(fd);
    if (!ehRegularUnico(s) || s.ino !== antes.ino || s.dev !== antes.dev) return null;
    const inicio = Math.max(0, s.size - teto);
    const buf = Buffer.alloc(s.size - inicio);
    readSync(fd, buf, 0, buf.length, inicio);
    if (inicio === 0) return buf.toString("utf8");
    const quebra = buf.indexOf(0x0a);
    return quebra === -1 ? "" : buf.subarray(quebra + 1).toString("utf8");
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

/**
 * As duas gerações juntas (a anterior primeiro), até `teto` bytes do fim. `nod.log` recusado (symlink, hardlink)
 * devolve `""`: o diagnóstico sai do mesmo jeito, sem registros. O montador redige e corta de novo.
 */
export function lerCaudaDoLog(dir: string, teto: number): string {
  const atual = existe(join(dir, ARQUIVO_LOG));
  const novo = lerCauda(join(dir, ARQUIVO_LOG), teto);
  if (atual && novo === null) return "";
  const texto = novo ?? "";
  const falta = teto - Buffer.byteLength(texto);
  const velho = falta > 0 ? lerCauda(join(dir, ARQUIVO_LOG_ANTERIOR), falta) ?? "" : "";
  return velho + texto;
}

/** Grava o `.txt` exportado: 0600, sem seguir symlink nem escrever num hardlink. Lança se não puder. */
export function escreverDiagnostico(caminho: string, texto: string): void {
  const antes = existe(caminho);
  if (antes && !ehRegularUnico(antes)) throw new Error("destino_recusado");
  // Sem O_TRUNC na abertura: truncar antes do fstat zeraria o outro nome de um hardlink criado depois do lstat.
  const fd = openSync(caminho, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    if (!ehRegularUnico(fstatSync(fd))) throw new Error("destino_recusado");
    ftruncateSync(fd, 0);
    fchmodSync(fd, 0o600);
    writeSync(fd, texto);
  } finally { closeSync(fd); }
}

// ---- Quedas (padrão do OpenMausBot/electron/diagnostics.mjs) ----------------------------------------------------------
// Só metadados de união fechada: nada de URL, título, mensagem de erro, linha de comando ou caminho. Campo novo do
// Electron não vaza por acidente, porque o que não está na lista vira "desconhecido".
const MOTIVOS = new Set(["abnormal-exit", "clean-exit", "crashed", "integrity-failure", "killed", "launch-failed", "oom", "memory-eviction"]);
const TIPOS_FILHO = new Set(["Utility", "Zygote", "Sandbox helper", "GPU", "Pepper Plugin", "Pepper Plugin Broker", "Unknown"]); // idioma-fixo: nomes do Electron/JS, vão só ao log técnico
const ORIGENS_PRINCIPAL = new Set(["uncaughtException", "unhandledRejection"]);
const CLASSES_ERRO = new Set(["Error", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "TypeError", "URIError"]); // idioma-fixo: nomes do Electron/JS, vão só ao log técnico

export type EventoDeQueda =
  | { tipo: "janela"; principal: boolean; motivo: unknown; codigo: unknown }
  | { tipo: "processo_filho"; processo: unknown; motivo: unknown; codigo: unknown }
  | { tipo: "principal"; origem: unknown; erro: unknown };

const conhecido = (v: unknown, lista: Set<string>, outro = "desconhecido") => (typeof v === "string" && lista.has(v) ? v : outro);
const codigo = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
function classeDoErro(erro: unknown): string {
  try { return conhecido((erro as { name?: unknown } | null)?.name, CLASSES_ERRO, "Error"); } catch { return "Error"; } // idioma-fixo: nomes do Electron/JS, vão só ao log técnico
}

/** Os campos da linha `app_processo_caiu`; `null` quando não é queda (saída limpa) ou o formato é desconhecido. */
export function registroDeQueda(e: EventoDeQueda): CamposLog | null {
  try {
    if (e.tipo === "janela" || e.tipo === "processo_filho") {
      const motivo = conhecido(e.motivo, MOTIVOS);
      if (motivo === "clean-exit") return null;
      const onde = e.tipo === "janela" ? { superficie: e.principal ? "janela_principal" : "auxiliar" } : { processo_tipo: conhecido(e.processo, TIPOS_FILHO) };
      return { processo: e.tipo, ...onde, motivo, codigo_saida: codigo(e.codigo) };
    }
    if (e.tipo === "principal") return { processo: "principal", origem: conhecido(e.origem, ORIGENS_PRINCIPAL, "uncaughtException"), erro: classeDoErro(e.erro) };
  } catch { /* registrar a queda nunca pode ser pior que a queda */ }
  return null;
}

type Emissor = Pick<NodeJS.EventEmitter, "on" | "off">;

/**
 * Ouvintes de queda com as dependências injetadas (testáveis sem Electron). Só observam: o uncaughtExceptionMonitor
 * não muda o comportamento padrão de queda do Node. Durante o Cmd+Q (`encerrando`) nada é registrado.
 */
export function instalarOuvintesDeQueda(o: {
  app: Emissor;
  processo: Emissor;
  registrar: (campos: CamposLog) => void;
  encerrando: () => boolean;
  ehJanelaPrincipal: (conteudo: unknown) => boolean;
}): () => void {
  const anotar = (e: EventoDeQueda) => { if (o.encerrando()) return; const r = registroDeQueda(e); if (r) o.registrar(r); };
  const janela = (_ev: unknown, conteudo: unknown, d: { reason?: unknown; exitCode?: unknown } | undefined) =>
    anotar({ tipo: "janela", principal: o.ehJanelaPrincipal(conteudo), motivo: d?.reason, codigo: d?.exitCode });
  const filho = (_ev: unknown, d: { type?: unknown; reason?: unknown; exitCode?: unknown } | undefined) =>
    anotar({ tipo: "processo_filho", processo: d?.type, motivo: d?.reason, codigo: d?.exitCode });
  const principal = (erro: unknown, origem: unknown) => anotar({ tipo: "principal", origem, erro });
  o.app.on("render-process-gone", janela);
  o.app.on("child-process-gone", filho);
  o.processo.on("uncaughtExceptionMonitor", principal);
  return () => {
    o.app.off("render-process-gone", janela);
    o.app.off("child-process-gone", filho);
    o.processo.off("uncaughtExceptionMonitor", principal);
  };
}
