import type { ConexaoMotor } from "../../motor/conexao.ts";

/**
 * ADA-229 (ADR-152, item 5): a janela do app entra com a chave da máquina, como no Mac. `POST /api/maquina/sessao`
 * devolve o cookie `nod_sessao`, que o processo principal grava na partition `nod-web`. 401 = chave revogada (apaga a
 * conexão e volta ao Conectar); 426 = app velho demais (atualizar); o resto = servidor fora (tentar de novo). O 403 entra
 * no resto: o servidor só o dá com Origin (ou vem de um proxy), e apagar o conexao.json desligaria o motor também.
 */
export type ResultadoDaSessao =
  | { tipo: "ok"; cookie: string }
  | { tipo: "chave_invalida" }
  | { tipo: "atualize_app" }
  | { tipo: "servidor_fora" };

export async function abrirSessao(c: ConexaoMotor, versao: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoDaSessao> {
  let r: Response;
  try {
    r = await fetchImpl(`${c.url}/api/maquina/sessao`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": versao, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  } catch { return { tipo: "servidor_fora" }; }
  if (r.status === 401) return { tipo: "chave_invalida" };
  if (r.status === 426) return { tipo: "atualize_app" };
  if (!r.ok) return { tipo: "servidor_fora" };
  const cookie = cookieDaSessao(r.headers.get("set-cookie"));
  return cookie ? { tipo: "ok", cookie } : { tipo: "servidor_fora" };
}

/** O valor do `nod_sessao` no set-cookie, ou null. */
export function cookieDaSessao(setCookie: string | null): string | null {
  const v = setCookie?.match(/(?:^|[;,]\s*)nod_sessao=([^;,\s]+)/)?.[1];
  return v && v.length <= 4096 ? v : null;
}

/** A partition da janela do nod (a mesma do Mac): o cookie da sessão vai nela. */
export const PARTITION_DA_JANELA = "nod-web";

/** O cookie `nod_sessao` como o processo principal o grava na partition. */
export function cookieDaJanela(url: string, valor: string) {
  return { url, name: "nod_sessao", value: valor, path: "/", httpOnly: true, secure: url.startsWith("https:"), sameSite: "strict" as const };
}
