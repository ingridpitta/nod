import type { CapacidadesHarness, CatalogoHarness } from "../../src/contracts/harness.ts";
import type { Aceita } from "./anexos.ts";

/**
 * NOD-207 (ADR-083): a web decide anexo e pasta pelas capacidades que o catálogo da API traz (`EstadoExecutor.harnesses`),
 * nunca pelo id do harness. O bot `auto` (ou sem harness) vale o harness do legado (`catalogo.legado`).
 *
 * Catálogo ainda não carregado: o bot `auto`/sem harness segue como antes (anexa tudo, mostra a pasta); o bot com um
 * harness fixo não ganha nada até o catálogo chegar.
 */
type Catalogo = CatalogoHarness | null | undefined;

const ehDoLegado = (harness: string | null | undefined): boolean => !harness || harness === "auto";

/** As capacidades do harness do bot no catálogo; null = catálogo ausente ou harness fora dele. */
export function capacidadesDoBot(catalogo: Catalogo, harness: string | null | undefined): CapacidadesHarness | null {
  if (!catalogo) return null;
  const id = ehDoLegado(harness) ? catalogo.legado : harness;
  return catalogo.opcoes.find((h) => h.id === id)?.capacidades ?? null;
}

/** O que o composer oferece anexar: sem PDF na lista = "sem_pdf"; lista vazia = nenhum anexo (undefined). */
export function aceitaDoBot(catalogo: Catalogo, harness: string | null | undefined): Aceita | undefined {
  if (!catalogo && ehDoLegado(harness)) return "tudo";
  const tipos = capacidadesDoBot(catalogo, harness)?.anexos ?? [];
  if (tipos.length === 0) return undefined;
  return tipos.includes("pdf") ? "tudo" : "sem_pdf";
}

/** A gaveta mostra o caminho da pasta do bot só quando o harness dele trabalha nela (`pastaDeTrabalho`). */
export function mostraCaminhoDaPasta(catalogo: Catalogo, harness: string | null | undefined): boolean {
  if (!catalogo && ehDoLegado(harness)) return true;
  return capacidadesDoBot(catalogo, harness)?.pastaDeTrabalho ?? false;
}
