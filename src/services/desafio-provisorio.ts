import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ANTIABUSO, bitsZeroAEsquerda, entradaDaProva, lerDesafio, respostaValida } from "../domain/salvaguardas-provisorio.ts";
import { hmacConta } from "./segredos-conta.ts";

/**
 * O desafio leve antes de abrir mais espaços provisórios do mesmo IP (NOD-408, ADR-137 §2). Prova de trabalho sem
 * serviço externo: o servidor emite um desafio assinado (HMAC com o segredo da sessão, amarrado ao IP e à validade) e o
 * cliente acha uma `resposta` tal que SHA-256(desafio:resposta) tem `bits` zeros à esquerda. Encarece a criação em
 * massa sem barrar a pessoa (1–3 s no navegador). O uso único fica com quem chama (`limites_conta`).
 */

function assinar(segredo: string, ip: string, expiraEm: number, nonce: string, bits: number): string {
  return hmacConta(segredo, "desafio_provisorio", ip, String(expiraEm), nonce, String(bits)).subarray(0, 18).toString("base64url");
}

export function emitirDesafio(segredo: string, ip: string, agora: number, bits: number = ANTIABUSO.bitsDoDesafio): { desafio: string; bits: number } {
  const expiraEm = agora + ANTIABUSO.validadeDoDesafioMs;
  const nonce = randomBytes(18).toString("base64url");
  return { desafio: `v1.${expiraEm}.${nonce}.${assinar(segredo, ip, expiraEm, nonce, bits)}`, bits };
}

export type VereditoDoDesafio = "ok" | "malformado" | "assinatura" | "vencido" | "resposta";

export function verificarDesafio(
  segredo: string,
  ip: string,
  p: { desafio: unknown; resposta: unknown },
  agora: number,
  bits: number = ANTIABUSO.bitsDoDesafio,
): VereditoDoDesafio {
  if (typeof p.desafio !== "string" || !respostaValida(p.resposta)) return "malformado";
  const d = lerDesafio(p.desafio);
  if (!d) return "malformado";
  const esperada = Buffer.from(assinar(segredo, ip, d.expiraEm, d.nonce, bits));
  const recebida = Buffer.from(d.assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return "assinatura";
  if (agora > d.expiraEm) return "vencido";
  const hash = createHash("sha256").update(entradaDaProva(p.desafio, p.resposta), "utf8").digest();
  return bitsZeroAEsquerda(hash) >= bits ? "ok" : "resposta";
}

/** O resolvedor (testes e ferramentas do servidor; a web e o app têm o seu, com a mesma conta). */
export function resolverDesafio(desafio: string, bits: number, limite = 50_000_000): string | null {
  for (let i = 0; i < limite; i++) {
    const r = String(i);
    if (bitsZeroAEsquerda(createHash("sha256").update(entradaDaProva(desafio, r), "utf8").digest()) >= bits) return r;
  }
  return null;
}
