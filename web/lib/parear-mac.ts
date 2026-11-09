/**
 * Pareamento do app do Mac pelo navegador (ADR-069), a parte pura: ler o pedido que o app pôs na URL,
 * guardá-lo enquanto a pessoa entra com o Google (a volta do Google cai em "/" e perde a query) e
 * montar o endereço de retorno no 127.0.0.1 do próprio Mac.
 */
export type PedidoPareamento = { porta: number; estado: string; desafio: string; nome: string };

export const PARAMETRO = "parear-mac";
export const CHAVE_GUARDADA = "nod.parear-mac";
const B64URL = /^[A-Za-z0-9_-]{22,128}$/;
const DESAFIO = /^[A-Za-z0-9_-]{43}$/;

export function lerPedido(p: { get(nome: string): string | null }): PedidoPareamento | null {
  if (p.get(PARAMETRO) !== "1") return null;
  const porta = Number(p.get("porta"));
  const estado = p.get("estado") ?? "";
  const desafio = p.get("desafio") ?? "";
  // Corta por code point (revisão 9): emoji na posição 60 não vira meio caractere, que o servidor recusa.
  const nome = [...(p.get("nome") ?? "").trim()].slice(0, 60).join("");
  if (!Number.isInteger(porta) || porta < 1024 || porta > 65535) return null;
  if (!B64URL.test(estado) || !DESAFIO.test(desafio) || nome === "") return null;
  return { porta, estado, desafio, nome };
}

/** O que sai da URL do navegador depois de lido: o pedido não fica no histórico nem num link copiado. */
export const PARAMETROS_DO_PEDIDO = [PARAMETRO, "porta", "estado", "desafio", "nome"] as const;

export function lerGuardado(texto: string | null): PedidoPareamento | null {
  if (!texto) return null;
  try {
    const o = JSON.parse(texto) as Record<string, unknown>;
    return lerPedido({ get: (k) => (k === PARAMETRO ? "1" : o[k] === undefined ? null : String(o[k])) });
  } catch { return null; }
}

/** Só 127.0.0.1: o código nunca sai do computador em que o app abriu a porta. */
export function urlDeRetorno(p: PedidoPareamento, codigo: string): string {
  return `http://127.0.0.1:${p.porta}/retorno?estado=${encodeURIComponent(p.estado)}&codigo=${encodeURIComponent(codigo)}`;
}
