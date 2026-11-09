import type { Conector } from "../../src/contracts/conector.ts";

/**
 * definido em 2026-10-26 (NOD-374): o app aparece como "Fora do ar" (Provedores, ficha do bot, marketplace) só quando a
 * falha persistiu (`foraDoArDesde`) ou o acesso foi recusado (que já nasce com `foraDoArDesde`). A falha aberta que ainda
 * espera a confirmação não pinta nada. `foraDoArDesde` ausente (Conector montado à mão, sem o disjuntor) conta como visível.
 */
export function falhaVisivel(c: Pick<Conector, "ultimaFalha" | "foraDoArDesde">): boolean {
  // Mesma regra de src/domain/disjuntor-conector.ts (falhaVisivel): a web não importa valor de src (ADR-018).
  return c.ultimaFalha !== null && c.foraDoArDesde !== null;
}
