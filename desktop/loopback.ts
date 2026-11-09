import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";

/**
 * A porta de volta do navegador do sistema (RFC 8252 "loopback"): só em 127.0.0.1, porta escolhida pelo sistema, um
 * `estado` aleatório que a volta tem de trazer. Usada pelo pareamento (ADR-069) e pelo Google no app (ADR-157). A URL que
 * chega em `/retorno` com o estado certo resolve `retorno` com os parâmetros; qualquer outra coisa recebe 400.
 */
export class FalhaLoopback extends Error {
  readonly codigo: "sem_resposta";
  constructor() { super("sem_resposta"); this.codigo = "sem_resposta"; }
}

export type Loopback = { porta: number; estado: string; retorno: Promise<URLSearchParams>; fechar(): void };

const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const paginaDoLoopback = (titulo: string, texto: string) =>
  `<!doctype html><meta charset="utf-8"><title>nod</title><body style="font:16px -apple-system,'Segoe UI',sans-serif;max-width:420px;margin:80px auto;color:#23312a"><h1 style="font-size:24px">${titulo}</h1><p>${texto}</p></body>`;

export async function abrirLoopback(o: { prazoMs: number; paginaOk: string; paginaErro: string }): Promise<Loopback> {
  const estado = randomBytes(24).toString("base64url");
  let resolver!: (p: URLSearchParams) => void;
  let rejeitar!: (e: Error) => void;
  const retorno = new Promise<URLSearchParams>((r, j) => { resolver = r; rejeitar = j; });
  // Quem não espera o retorno (a página desistiu) não deixa rejeição solta.
  retorno.catch(() => undefined);
  let srv: Server | null = null;
  const fechar = () => { clearTimeout(limite); srv?.close(); srv = null; rejeitar(new FalhaLoopback()); };
  const limite = setTimeout(fechar, o.prazoMs);
  limite.unref();
  srv = createServer((req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || u.pathname !== "/retorno" || !iguais(u.searchParams.get("estado") ?? "", estado)) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(o.paginaErro);
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(o.paginaOk);
    resolver(u.searchParams);
    clearTimeout(limite);
    srv?.close();
    srv = null;
  });
  const porta = await new Promise<number>((ok, falha) => {
    srv!.on("error", () => { fechar(); falha(new FalhaLoopback()); });
    srv!.listen(0, "127.0.0.1", () => ok((srv!.address() as { port: number }).port));
  });
  return { porta, estado, retorno, fechar };
}
