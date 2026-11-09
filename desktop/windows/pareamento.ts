/**
 * ADA-229 (ADR-152, item 3): conectar o app do Windows pelo fluxo de dispositivo, o mesmo do motor (`nod-motor parear`),
 * com `plataforma: "win32"`. O app abre o navegador no link e mostra o código só para conferência: a pessoa não copia
 * nada. Só o 400 (código vencido ou usado) encerra; 5xx, 429 ou rede caída seguem tentando até o prazo. Sem Electron:
 * fetch, abrir e esperar são injetados (tests/unit/desktop/windows/pareamento.test.ts).
 */
export class FalhaPareamentoWindows extends Error {
  readonly codigo: "servidor_fora" | "vencido" | "recusado";
  constructor(codigo: FalhaPareamentoWindows["codigo"]) { super(codigo); this.codigo = codigo; }
}

export type PedidoDispositivo = { codigoDispositivo: string; codigoPessoa: string; intervaloS: number; prazoS: number };

export type DepsPareamento = {
  servidor: string;
  nome: string;
  abrir(url: string): Promise<void>;
  mostrarCodigo(codigo: string): void;
  fetchImpl?: typeof fetch;
  esperar?(ms: number): Promise<void>;
  agora?(): number;
  /** Cancelado (a pessoa fechou a janela ou clicou em Cancelar): para o laço sem erro de rede. */
  cancelado?(): boolean;
};

export const linkDePareamento = (servidor: string, codigoPessoa: string) => `${servidor}/?parear-maquina=${encodeURIComponent(codigoPessoa)}`;

const textoCurto = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const numeroPositivo = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** O corpo do 201 de /api/pareamento/dispositivo, ou null se veio torto. O intervalo fica entre 1 s e 30 s. */
export function lerPedidoDispositivo(bruto: unknown): PedidoDispositivo | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const { codigoDispositivo, codigoPessoa, intervaloS, prazoS } = bruto as Record<string, unknown>;
  if (!textoCurto(codigoDispositivo, 256) || !textoCurto(codigoPessoa, 32) || !numeroPositivo(intervaloS) || !numeroPositivo(prazoS)) return null;
  return { codigoDispositivo, codigoPessoa, intervaloS: Math.min(Math.max(intervaloS, 1), 30), prazoS };
}

const esperarPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pede o código, abre o navegador e espera a confirmação; devolve a chave da máquina. */
export async function parearPorDispositivo(o: DepsPareamento): Promise<string> {
  const f = o.fetchImpl ?? fetch;
  const esperar = o.esperar ?? esperarPadrao;
  const agora = o.agora ?? Date.now;
  const nome = o.nome.trim().slice(0, 60) || "windows";
  let r: Response;
  try {
    r = await f(`${o.servidor}/api/pareamento/dispositivo`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome, plataforma: "win32" }), signal: AbortSignal.timeout(15_000) });
  } catch { throw new FalhaPareamentoWindows("servidor_fora"); }
  if (r.status === 400 || r.status === 403) throw new FalhaPareamentoWindows("recusado");
  if (!r.ok) throw new FalhaPareamentoWindows("servidor_fora");
  const p = lerPedidoDispositivo(await r.json().catch(() => null));
  if (!p) throw new FalhaPareamentoWindows("servidor_fora");
  o.mostrarCodigo(p.codigoPessoa);
  // Não abrir o navegador não para o pareamento: o código está na janela e o link fica no botão.
  await o.abrir(linkDePareamento(o.servidor, p.codigoPessoa)).catch(() => undefined);
  const ate = agora() + p.prazoS * 1000;
  while (agora() < ate) {
    await esperar(p.intervaloS * 1000);
    if (o.cancelado?.()) throw new FalhaPareamentoWindows("vencido");
    const t = await f(`${o.servidor}/api/pareamento/dispositivo/trocar`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigoDispositivo: p.codigoDispositivo }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!t || (t.status !== 201 && t.status !== 400)) continue;
    if (t.status === 400) throw new FalhaPareamentoWindows("vencido");
    const { chave } = ((await t.json().catch(() => ({}))) ?? {}) as { chave?: unknown };
    if (!textoCurto(chave, 1024)) throw new FalhaPareamentoWindows("servidor_fora");
    return chave;
  }
  throw new FalhaPareamentoWindows("vencido");
}
