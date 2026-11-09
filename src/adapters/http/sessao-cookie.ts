import { createHmac, timingSafeEqual } from "node:crypto";
import type { Escopo } from "../../shared/types.ts";

/**
 * Primitivas do cookie de sessão assinado (HMAC-SHA256): `nod_sessao` = base64url(JSON{tenantId,
 * pessoaId}) "." assinatura. Separadas de sessao.ts para sessao-google.ts reusar sem ciclo de import.
 */
export const COOKIE_SESSAO = "nod_sessao";

export function assinar(payload: string, segredo: string): string {
  return createHmac("sha256", segredo).update(payload).digest("base64url");
}

/** Compara duas strings em tempo constante (o comprimento diferente sai antes, sem lançar). */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Devolve o payload de `payload.assinatura` quando a assinatura casa; senão null. */
export function lerAssinado(valor: string | undefined, segredo: string): string | null {
  if (!valor) return null;
  const [payload, assinatura, sobra] = valor.split(".");
  if (!payload || !assinatura || sobra !== undefined) return null;
  return iguaisEmTempoConstante(assinatura, assinar(payload, segredo)) ? payload : null;
}

/**
 * NOD-345 (ADR-124 §4): com `sid`, o cookie aponta uma linha de `sessoes` e só vale enquanto ela não for revogada. Sem
 * `sid` é o cookie de antes (e o dos testes), que vale até o corte da pessoa (sessoes_corte).
 */
export function cunharCookie(escopo: Escopo, segredo: string, sid?: string | null): string {
  const corpo: { tenantId: string; pessoaId: string; sid?: string } = { tenantId: escopo.tenantId, pessoaId: escopo.pessoaId };
  if (sid) corpo.sid = sid;
  const payload = Buffer.from(JSON.stringify(corpo), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

const UUID_SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O cookie inteiro: escopo e o sid (null = cookie sem sessão no banco). */
export function lerSessaoDoCookie(valor: string | undefined, segredo: string): { escopo: Escopo; sid: string | null } | null {
  const payload = lerAssinado(valor, segredo);
  if (!payload) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Escopo> & { sid?: unknown };
    if (typeof obj.tenantId !== "string" || typeof obj.pessoaId !== "string" || !obj.tenantId || !obj.pessoaId) return null;
    if (obj.sid !== undefined && (typeof obj.sid !== "string" || !UUID_SID.test(obj.sid))) return null;
    return { escopo: { tenantId: obj.tenantId, pessoaId: obj.pessoaId }, sid: typeof obj.sid === "string" ? obj.sid : null };
  } catch {
    return null;
  }
}

export function lerCookieSessao(valor: string | undefined, segredo: string): Escopo | null {
  return lerSessaoDoCookie(valor, segredo)?.escopo ?? null;
}

/**
 * Quanto o aparelho guarda o cookie do login Google (definido em 2026-10-10, ADR-094). Sem Max-Age ele é cookie de sessão
 * do navegador, e o iPhone apaga esse tipo quando o sistema fecha o app instalado em segundo plano: a pessoa voltava ao
 * Nod e caía no login do Google de novo. Isto só muda quanto o APARELHO guarda; o cookie assinado não tem validade
 * própria no servidor, nem antes nem depois.
 */
export const PERMANENCIA_SESSAO_S = 30 * 24 * 60 * 60;

/** Cabeçalho Set-Cookie da sessão. `seguro` = só HTTPS (modo google com redirect https); `maxAgeS` = guardar no aparelho. */
export function cabecalhoCookieSessao(escopo: Escopo, segredo: string, seguro: boolean, maxAgeS?: number, sid?: string | null): string {
  return `${COOKIE_SESSAO}=${cunharCookie(escopo, segredo, sid)}; HttpOnly; SameSite=Strict; Path=/${maxAgeS ? `; Max-Age=${maxAgeS}` : ""}${seguro ? "; Secure" : ""}`;
}


/** Apaga o cookie de sessão (sair). Mesmos atributos do que cunha, para o navegador casar o cookie. */
export function cabecalhoApagarSessao(seguro: boolean): string {
  return `${COOKIE_SESSAO}=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/${seguro ? "; Secure" : ""}`;
}
