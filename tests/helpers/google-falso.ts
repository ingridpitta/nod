/**
 * Duplo do Google para os testes do login (E1.2): nunca fala com a rede.
 *
 * `idTokenFalso` monta um JWT com assinatura LIXO de propósito. O login aceitar esse token é a prova
 * executável da decisão de não verificar RS256 (ver o cabeçalho de src/adapters/http/sessao-google.ts):
 * a confiança vem da chamada servidor→Google sobre TLS com client_secret, não da assinatura.
 */
export const CLIENT_ID = "cliente-de-teste.apps.googleusercontent.com";

export function idTokenFalso(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.assinatura-que-ninguem-confere`;
}

export function claimsBoas(agora: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    exp: Math.floor(agora / 1000) + 3600,
    hd: "acme.com.br",
    email: "marlon.wanderllich@acme.com.br",
    email_verified: true,
    ...extra,
  };
}

export type ChamadaAoGoogle = { url: string; corpo: URLSearchParams };

/** fetch falso do endpoint de token: devolve `resposta` e registra o que o nod mandou. */
export function googleFalso(resposta: () => Response | Promise<Response>): { fetchImpl: typeof fetch; chamadas: ChamadaAoGoogle[] } {
  const chamadas: ChamadaAoGoogle[] = [];
  const fetchImpl: typeof fetch = async (entrada, init) => {
    // Registra ANTES de produzir a resposta: um caso que rejeita ainda fica registrado.
    chamadas.push({ url: String(entrada), corpo: new URLSearchParams(String(init?.body ?? "")) });
    return resposta();
  };
  return { fetchImpl, chamadas };
}

export function respostaComIdToken(claims: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ id_token: idTokenFalso(claims), access_token: "ignorado" }), { status: 200, headers: { "content-type": "application/json" } });
}
