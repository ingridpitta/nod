import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  // NOD-327: o worker do pdf.js (pdfjs-dist) sai do Vite como .mjs; módulo com outro tipo + nosniff o navegador recusa.
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  // definido em 2026-10-04 (ADR-070): as fontes da web (web/public/fontes) e a licença que vai junto.
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  // definido em 2026-10-10 (ADR-094): o app instalável no celular — manifesto e ícones.
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
};

/** Um ano: o nome dos arquivos de /assets/ leva o hash do conteúdo (Vite), então um deploy novo é outro nome. */
const IMUTAVEL = "public, max-age=31536000, immutable";

/**
 * Cache de cada arquivo da web (definido em 2026-10-10, ADR-094). O HTML, o sw.js e o manifesto revalidam sempre: um
 * deploy precisa chegar ao app instalado no celular na próxima abertura, e um sw.js preso no cache prenderia o worker
 * velho. As fontes guardam uma semana (o nome não muda entre deploys) e os ícones um dia.
 */
export function cacheDoArquivo(arquivo: string): string {
  if (arquivo.startsWith("/assets/")) return IMUTAVEL;
  // A fonte não muda entre deploys do mesmo nome de arquivo: uma semana de cache poupa ~80 KB por abertura.
  if (extname(arquivo) === ".woff2") return "public, max-age=604800";
  if (arquivo.startsWith("/icons/") || arquivo.startsWith("/logos/")) return "public, max-age=86400";
  return "no-cache";
}

/**
 * NOD-328: o renderizador de diagramas roda num iframe sandbox de origem opaca e importa /diagrama/sandbox.js e os chunks
 * de /assets como módulo, com `Origin: null` — sem CORS o navegador recusa. São arquivos públicos do bundle (os mesmos
 * para qualquer pessoa, sem sessão nem cookie), então `*` não expõe nada; o HTML e a API ficam sem o cabeçalho.
 */
export function corsDoArquivo(arquivo: string): Record<string, string> {
  if (extname(arquivo) !== ".js") return {};
  return arquivo.startsWith("/assets/") || arquivo.startsWith("/diagrama/") ? { "access-control-allow-origin": "*" } : {};
}

/** Serve o bundle da web (NOD_STATIC_DIR) com fallback para index.html em rotas sem extensão. */
export function criarEstatico(dir: string | undefined): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    if (!dir || req.method !== "GET") return false;
    const caminho = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    const arquivo = normalize(caminho === "/" ? "/index.html" : caminho);
    if (arquivo.includes("..")) return false;
    try {
      const buf = await readFile(join(dir, arquivo));
      res.writeHead(200, { "content-type": TIPOS[extname(arquivo)] ?? "application/octet-stream", "cache-control": cacheDoArquivo(arquivo), "x-content-type-options": "nosniff", ...corsDoArquivo(arquivo) });
      res.end(buf);
      return true;
    } catch {
      if (extname(arquivo) !== "") return false;
      try {
        const buf = await readFile(join(dir, "index.html"));
        res.writeHead(200, { "content-type": TIPOS[".html"], "cache-control": "no-cache", "x-content-type-options": "nosniff" });
        res.end(buf);
        return true;
      } catch {
        return false;
      }
    }
  };
}
