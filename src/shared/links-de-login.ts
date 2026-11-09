import type { IaComConta } from "../contracts/contas-ia.ts";

/**
 * Os endereços oficiais de login (definido em 2026-10-09, movido do desktop/login-ia.ts em 2026-10-13 para o servidor
 * também conferir o link que a VM manda, ADR-102). Host E caminho exatos, só https, sem porta nem usuário. Medidos:
 * auth.openai.com/codex/device (Codex 0.147.0) e claude.com/cai/oauth/authorize (Claude Code 2.1.296).
 * claude.ai/oauth/authorize é o endereço das versões anteriores do Claude Code (não medido aqui; mesmo dono).
 */
export const LINKS_OFICIAIS: Record<IaComConta, readonly { host: string; caminho: string }[]> = {
  "codex-cli": [{ host: "auth.openai.com", caminho: "/codex/device" }],
  "claude-cli": [
    { host: "claude.com", caminho: "/cai/oauth/authorize" },
    { host: "claude.ai", caminho: "/oauth/authorize" },
  ],
};

/** O link, se for um dos oficiais desta IA; senão null (nunca mostrado, nunca aberto). */
export function linkOficial(ia: IaComConta, valor: string): string | null {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") return null;
  const host = url.hostname.toLowerCase();
  return LINKS_OFICIAIS[ia].some((l) => l.host === host && l.caminho === url.pathname) ? url.href : null;
}
