import { randomBytes } from "node:crypto";
import { desafioDe, PRAZO_PAREAMENTO_MS } from "../src/services/pareamento-maquina.ts";
import { abrirLoopback, paginaDoLoopback } from "./loopback.ts";

/**
 * Pareamento pelo navegador (ADR-069, RFC 8252 "loopback" + PKCE da RFC 7636): o app abre uma porta
 * só em 127.0.0.1, manda o navegador ao nod com o desafio, recebe de volta um código de uso único e o
 * troca pela chave com o verificador, que nunca saiu deste processo. A chave não passa por URL nem
 * pelo histórico do navegador.
 */
export class FalhaPareamento extends Error {
  readonly codigo: "sem_resposta" | "recusado" | "servidor_fora";
  constructor(codigo: FalhaPareamento["codigo"]) { super(codigo); this.codigo = codigo; }
}

export type PedidoNoNavegador = { porta: number; estado: string; desafio: string; nome: string };

export function urlDePareamento(servidor: string, p: PedidoNoNavegador): string {
  const u = new URL("/", servidor);
  u.searchParams.set("parear-mac", "1");
  u.searchParams.set("porta", String(p.porta));
  u.searchParams.set("estado", p.estado);
  u.searchParams.set("desafio", p.desafio);
  u.searchParams.set("nome", p.nome.slice(0, 60));
  return u.toString();
}

export async function parearPeloNavegador(o: {
  servidor: string;
  nome: string;
  abrir(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
  prazoMs?: number;
}): Promise<string> {
  const verificador = randomBytes(32).toString("base64url");
  let codigo: string;
  try {
    const l = await abrirLoopback({
      prazoMs: o.prazoMs ?? PRAZO_PAREAMENTO_MS,
      paginaOk: paginaDoLoopback("Pronto", "Este Mac está conectado ao nod. Pode fechar esta aba e voltar ao app."),
      paginaErro: paginaDoLoopback("Pedido inválido", "Volte ao app do nod e clique em Entrar com Google de novo."),
    });
    o.abrir(urlDePareamento(o.servidor, { porta: l.porta, estado: l.estado, desafio: desafioDe(verificador), nome: o.nome })).catch(() => l.fechar());
    codigo = (await l.retorno).get("codigo") ?? "";
  } catch { throw new FalhaPareamento("sem_resposta"); }
  if (!codigo) throw new FalhaPareamento("sem_resposta");

  let r: Response;
  try {
    r = await (o.fetchImpl ?? fetch)(new URL("/api/pareamento/trocar", o.servidor), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo, verificador }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new FalhaPareamento("servidor_fora"); }
  if (r.status === 400 || r.status === 403) throw new FalhaPareamento("recusado");
  if (!r.ok) throw new FalhaPareamento("servidor_fora");
  const { chave } = (await r.json()) as { chave?: unknown };
  if (typeof chave !== "string" || chave.length === 0 || chave.length > 1024) throw new FalhaPareamento("servidor_fora");
  return chave;
}
