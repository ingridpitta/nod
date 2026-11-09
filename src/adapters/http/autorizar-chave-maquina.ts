import { abrirTxEscopada } from "../../db/tx.ts";
import { maquinaTokensRepo } from "../../repositories/maquina-tokens.repo.ts";
import { casaHash, escopoAlegado, hashDaChave } from "../../services/token-maquina.ts";
import type { Db, Escopo } from "../../shared/types.ts";

export type IdentidadeDeMaquina = Escopo & { chaveId: string };

/**
 * Valida uma chave de máquina ANTES de existir sessão (ADR-031):
 *
 *   escopoAlegado(chave) ──► abrirTxEscopada(escopo alegado) ──► buscarVivaPorHash(sha256(chave INTEIRA))
 *        │ (não confiável)          │ RLS: só linhas dessa pessoa        │ revogada/expirada não volta
 *        └─ malformado → null       └─ escopo mentiroso → 0 linhas       └─ timingSafeEqual → identidade
 *
 * Nunca busque pelo hash sem escopo: com RLS FORCE isso não acha a linha — como nod_app lança
 * "unrecognized configuration parameter", como nod_dono volta VAZIO em silêncio (medido em 2026-09-16);
 * um teste rodando como dono passaria sem provar nada.
 *
 * definido em 2026-09-17: o roteador aplica esta autorização a /api/maquina em modo compartilhado,
 * depois de recusar Origin e antes de ler o corpo da requisição.
 */
export async function autorizarChaveMaquina(db: Db, chave: unknown, agora: number): Promise<IdentidadeDeMaquina | null> {
  const escopo = escopoAlegado(chave);
  // O typeof é só para o TS estreitar: escopoAlegado já recusou tudo que não é string.
  if (!escopo || typeof chave !== "string") return null;
  const hash = hashDaChave(chave);
  return abrirTxEscopada(db, escopo)(async (trx) => {
    const repo = maquinaTokensRepo(trx, escopo);
    const achada = await repo.buscarVivaPorHash(hash, agora);
    if (!achada || !casaHash(achada.hash, hash)) return null;
    await repo.marcarUso(achada.id, agora);
    return { ...escopo, chaveId: achada.id };
  });
}
