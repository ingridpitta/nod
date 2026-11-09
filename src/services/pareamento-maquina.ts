import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Escopo } from "../shared/types.ts";

/**
 * Pareamento do app do Mac pelo navegador (ADR-069): o app nunca recebe a chave pela URL. Puro e SEM
 * banco (src/services), em memória como o token de turno — um pedido vive minutos e um reinício do
 * servidor só obriga a pessoa a clicar de novo.
 *
 *   app: verificador aleatório ──sha256──► desafio (vai na URL que abre o navegador)
 *   navegador, com sessão: abrir(escopo, nome, desafio) ──► código de uso único (volta ao app pelo 127.0.0.1)
 *   app: trocar(código, verificador) ──► escopo + nome; quem chama emite a chave DENTRO do escopo
 *
 * O código sozinho não vale nada: sem o verificador, que nunca saiu do app, a troca falha. Toda
 * tentativa consome o código, certa ou errada.
 */
export type PedidoPareamento = { escopo: Escopo; nome: string };

export interface PareamentoMaquina {
  abrir(e: { escopo: Escopo; nome: string; desafio: string }): string;
  trocar(e: { codigo: string; verificador: string }): PedidoPareamento | null;
}

/** definido em 2026-10-03: 5 min entre clicar em Conectar no navegador e o app trocar o código (leva segundos). */
export const PRAZO_PAREAMENTO_MS = 300_000;
/** definido em 2026-10-03: teto de pedidos abertos em memória; o mais antigo sai antes. */
const MAX_PEDIDOS = 1_000;
/** sha256 em base64url sem padding: 43 caracteres. */
export const DESAFIO = /^[A-Za-z0-9_-]{43}$/;
/** O verificador do app: 32 bytes aleatórios em base64url (43). Aceita até 128, como o PKCE (RFC 7636). */
const VERIFICADOR = /^[A-Za-z0-9_-]{43,128}$/;
const CODIGO = /^[A-Za-z0-9_-]{43}$/;

export const desafioDe = (verificador: string): string => createHash("sha256").update(verificador, "utf8").digest("base64url");

export function criarPareamentoMaquina(agora: () => number = Date.now): PareamentoMaquina {
  const pedidos = new Map<string, PedidoPareamento & { desafio: string; ate: number }>();
  const varrer = () => { const t = agora(); for (const [c, p] of pedidos) if (p.ate <= t) pedidos.delete(c); };
  return {
    abrir({ escopo, nome, desafio }) {
      if (!DESAFIO.test(desafio)) throw new Error("desafio_invalido");
      varrer();
      while (pedidos.size >= MAX_PEDIDOS) pedidos.delete(pedidos.keys().next().value as string);
      const codigo = randomBytes(32).toString("base64url");
      pedidos.set(codigo, { escopo, nome, desafio, ate: agora() + PRAZO_PAREAMENTO_MS });
      return codigo;
    },
    trocar({ codigo, verificador }) {
      if (!CODIGO.test(codigo) || !VERIFICADOR.test(verificador)) return null;
      const p = pedidos.get(codigo);
      pedidos.delete(codigo);
      if (!p || p.ate <= agora()) return null;
      const esperado = Buffer.from(p.desafio, "utf8");
      const recebido = Buffer.from(desafioDe(verificador), "utf8");
      if (esperado.length !== recebido.length || !timingSafeEqual(esperado, recebido)) return null;
      return { escopo: p.escopo, nome: p.nome };
    },
  };
}
