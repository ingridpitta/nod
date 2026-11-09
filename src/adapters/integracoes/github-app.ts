import { createPrivateKey, createSign } from "node:crypto";
import { ErroDeDominio } from "../../domain/erro.ts";

/**
 * GitHub App da organização (ADR-048, jeito 5): o executor de servidor, com o Mac da pessoa
 * desligado, gera um token de instalação e o entrega ao conector nativo pelo backend REST.
 * JWT RS256 com node:crypto — sem dependência nova. O token de instalação vale 1 h; o JWT, 10 min
 * no máximo (docs do GitHub), e aqui 9 min com 60 s de folga para relógio adiantado.
 */
const B64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function chavePrivadaValida(pem: string): boolean {
  try {
    const k = createPrivateKey(pem);
    return k.asymmetricKeyType === "rsa";
  } catch {
    return false;
  }
}

/** JWT do App: iss = app id, iat 60 s no passado, exp 9 min à frente. `agoraMs` por parâmetro (teste). */
export function jwtDoApp(appId: string, chavePem: string, agoraMs: number): string {
  const agora = Math.floor(agoraMs / 1000);
  const cabeca = B64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = B64(JSON.stringify({ iat: agora - 60, exp: agora + 9 * 60, iss: appId }));
  const assinatura = createSign("RSA-SHA256").update(`${cabeca}.${corpo}`).sign(createPrivateKey(chavePem));
  return `${cabeca}.${corpo}.${B64(assinatura)}`;
}

export type TokenDeInstalacao = { token: string; expiraEm: number };

/**
 * POST /app/installations/{id}/access_tokens. Falha vira ErroDeDominio de integração: 401/403/404 =
 * app, instalação ou chave errados (integracao_autenticacao); o resto, provedor fora do ar. Nem o
 * JWT nem o token vão para log ou mensagem.
 */
export async function criarTokenDeInstalacao(p: { appId: string; instalacaoId: string; chavePem: string; agora: number; base?: string; fetchImpl?: typeof fetch }): Promise<TokenDeInstalacao> {
  const f = p.fetchImpl ?? fetch;
  let r: Response;
  try {
    r = await f(`${(p.base ?? "https://api.github.com").replace(/\/+$/, "")}/app/installations/${encodeURIComponent(p.instalacaoId)}/access_tokens`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwtDoApp(p.appId, p.chavePem, p.agora)}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "nod" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ErroDeDominio("conector_indisponivel");
  }
  if (r.status === 401 || r.status === 403 || r.status === 404) throw new ErroDeDominio("integracao_autenticacao");
  if (r.status !== 201 && r.status !== 200) throw new ErroDeDominio("conector_indisponivel");
  const corpo = (await r.json().catch(() => null)) as { token?: unknown; expires_at?: unknown } | null;
  const expira = typeof corpo?.expires_at === "string" ? Date.parse(corpo.expires_at) : Number.NaN;
  if (typeof corpo?.token !== "string" || !/^[A-Za-z0-9_]{20,255}$/.test(corpo.token) || !Number.isFinite(expira)) throw new ErroDeDominio("conector_indisponivel");
  return { token: corpo.token, expiraEm: expira };
}

/**
 * Cache por tenant: um token de instalação serve todas as rotinas do tenant até 5 min antes de vencer
 * (definido em 2026-09-24: folga maior que o teto de uma chamada de conector, 15 s, com sobra).
 */
export function criarCofreDeTokensDoApp<E extends { tenantId: string }>(o: { agora: () => number; gerar: (escopo: E) => Promise<TokenDeInstalacao | null> }) {
  const postos = new Map<string, TokenDeInstalacao>();
  const emCurso = new Map<string, Promise<TokenDeInstalacao | null>>();
  return {
    async token(escopo: E): Promise<TokenDeInstalacao | null> {
      const tenantId = escopo.tenantId;
      const posto = postos.get(tenantId);
      if (posto && posto.expiraEm - 5 * 60_000 > o.agora()) return { token: posto.token, expiraEm: posto.expiraEm - 5 * 60_000 };
      // Uma geração por tenant por vez: dez rotinas que acordam juntas pedem UM token ao GitHub.
      let pedido = emCurso.get(tenantId);
      if (!pedido) {
        pedido = o.gerar(escopo).finally(() => emCurso.delete(tenantId));
        emCurso.set(tenantId, pedido);
      }
      const novo = await pedido;
      if (!novo) {
        postos.delete(tenantId);
        return null;
      }
      postos.set(tenantId, novo);
      return { token: novo.token, expiraEm: novo.expiraEm - 5 * 60_000 };
    },
    esquecer(tenantId: string) {
      postos.delete(tenantId);
    },
  };
}
