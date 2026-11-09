import type { Conector } from "../contracts/conector.ts";
import { APPS_MARKETPLACE } from "../contracts/marketplace.ts";

/**
 * "Conteúdo de fora" (ADR-026, emendada pela ADR-062 em 2026-09-30): o que um app devolve pode ter sido escrito por
 * alguém de fora da empresa, e é por aí que um texto tentaria mandar no bot. Decide o SERVIDOR, por curadoria
 * (`conteudoInterno` em APPS_MARKETPLACE), nunca o modelo. Sem curadoria, é de fora: app do catálogo público, MCP
 * próprio e todo app novo, até alguém revisar.
 */
export function conectorTrazConteudoDeFora(conector: Pick<Conector, "slug">): boolean {
  return !APPS_MARKETPLACE.some((a) => a.slug === conector.slug && a.conteudoInterno === true);
}
