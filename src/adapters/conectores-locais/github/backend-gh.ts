import { execFile } from "node:child_process";
import type { ArgsGithub } from "../../../domain/github.ts";
import { executarPorRest, MIDIA, TODAS, type BackendGithub, type RequisicaoGithub } from "./capacidades.ts";
import { codigoDoStatus, ErroGithub } from "./erros.ts";

export type OpcoesBackendGh = {
  /** Ambiente do `gh`: PATH aumentado e HOME/USER para achar a conta já logada (ADR-048). */
  env: Record<string, string>;
  /** Binário; default `gh` resolvido pelo PATH de `env`. Injetável só no teste. */
  bin?: string;
  /** Prazo da capacidade inteira; default PRAZO_CAPACIDADE_GITHUB_MS (capacidades.ts). */
  prazoMs?: number;
};

/** definido em 2026-09-24: 16 MiB de stdout; o diff de um PR grande passa disso raramente e o corte vem depois. */
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Jeito 1 (ADR-048): o `gh` já logado nesta máquina, por `gh api`. SEMPRE execFile, NUNCA shell:
 * cada argumento chega ao `gh` como um item de argv. O caminho vem de executarPorRest, montado com
 * pedaços que o domínio validou — ele começa por `repos/`, então nunca é lido como opção. O corpo do
 * POST vai pelo stdin (`--input -`), nunca pela linha de comando.
 */
export function criarBackendGh(o: OpcoesBackendGh): BackendGithub {
  const bin = o.bin ?? "gh";
  function pedir(r: RequisicaoGithub, timeout: number): Promise<string> {
    if (!r.caminho.startsWith("repos/")) return Promise.reject(new ErroGithub("falha", "gh"));
    const argv = ["api", "--method", r.metodo, "-H", `Accept: ${MIDIA[r.aceitar ?? "json"]}`, r.caminho, ...(r.corpo ? ["--input", "-"] : [])];
    return new Promise((resolver, rejeitar) => {
      const filho = execFile(bin, argv, { env: o.env, timeout, maxBuffer: MAX_BUFFER, shell: false, windowsHide: true, encoding: "utf8" }, (e, stdout, stderr) => {
        if (!e) {
          resolver(stdout);
          return;
        }
        const err = e as { code?: string | number | null };
        if (err.code === "ENOENT") return rejeitar(new ErroGithub("gh_ausente", "gh"));
        if ((e as { killed?: boolean }).killed) return rejeitar(new ErroGithub("falha", "gh"));
        // `gh` sai com 4 quando precisa de login (gh help exit-codes).
        if (err.code === 4 || /gh auth login|not logged in|authentication required/i.test(stderr)) return rejeitar(new ErroGithub("sem_login", "gh"));
        if (/rate limit/i.test(stderr)) return rejeitar(new ErroGithub("limite", "gh"));
        const status = /\(HTTP (\d{3})\)/.exec(stderr)?.[1];
        rejeitar(new ErroGithub(status ? codigoDoStatus(Number(status)) : "falha", "gh"));
      });
      if (r.corpo) filho.stdin?.end(JSON.stringify(r.corpo));
      else filho.stdin?.end();
    });
  }

  return {
    disponiveis: TODAS,
    executar: (args: ArgsGithub) => executarPorRest(args, pedir, o.prazoMs),
  };
}
