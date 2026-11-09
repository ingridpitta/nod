import type { JeitoGithub } from "../../../contracts/github.ts";
import type { ArgsGithub } from "../../../domain/github.ts";
import { executarPorRest, MIDIA, TODAS, type BackendGithub, type RequisicaoGithub } from "./capacidades.ts";
import { codigoDoStatus, ErroGithub } from "./erros.ts";

export const API_GITHUB = "https://api.github.com";

export type OpcoesBackendRest = {
  /** Token pessoal (jeito `token`) ou token de instalação do GitHub App (jeito `app`). */
  token: string;
  jeito: Extract<JeitoGithub, "token" | "app">;
  /** Base da API; default api.github.com. O teste aponta para um servidor HTTP local. */
  base?: string;
  fetchImpl?: typeof fetch;
  /** Prazo da capacidade inteira; default PRAZO_CAPACIDADE_GITHUB_MS (capacidades.ts). */
  prazoMs?: number;
};

/** definido em 2026-09-24: 16 MiB, o mesmo teto do stdout do `gh`; acima disso é falha, não corte. */
const TETO_BYTES = 16 * 1024 * 1024;

/**
 * Jeitos 3 e 5 (ADR-048): a mesma rota REST do `gh api`, por fetch com o token no cabeçalho. O token
 * nunca vai para a URL nem para a mensagem de erro; redirect é recusado para ele não seguir a outro host.
 */
export function criarBackendRest(o: OpcoesBackendRest): BackendGithub {
  const base = (o.base ?? API_GITHUB).replace(/\/+$/, "");
  const f = o.fetchImpl ?? fetch;
  async function pedir(r: RequisicaoGithub, timeout: number): Promise<string> {
    if (!r.caminho.startsWith("repos/")) throw new ErroGithub("falha", o.jeito);
    let resp: Response;
    try {
      resp = await f(`${base}/${r.caminho}`, {
        method: r.metodo,
        headers: {
          authorization: `Bearer ${o.token}`,
          accept: MIDIA[r.aceitar ?? "json"],
          "x-github-api-version": "2022-11-28",
          "user-agent": "nod",
          ...(r.corpo ? { "content-type": "application/json" } : {}),
        },
        ...(r.corpo ? { body: JSON.stringify(r.corpo) } : {}),
        // 301/302/307: repositório renomeado ou transferido. Não segue (o token não vai a outra URL) e diz o que houve.
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new ErroGithub("falha", o.jeito);
    }
    if (resp.status >= 300 && resp.status < 400) throw new ErroGithub("movido", o.jeito);
    if (!resp.ok) throw new ErroGithub(codigoDoStatus(resp.status, resp.headers.get("x-ratelimit-remaining") === "0"), o.jeito);
    const bytes = await resp.arrayBuffer();
    if (bytes.byteLength > TETO_BYTES) throw new ErroGithub("falha", o.jeito);
    return new TextDecoder("utf-8").decode(bytes);
  }

  return {
    disponiveis: TODAS,
    executar: (args: ArgsGithub) => executarPorRest(args, pedir, o.prazoMs),
  };
}
