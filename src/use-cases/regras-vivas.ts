import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { semprePermitirNoCatalogo } from "../domain/plano-turno.ts";
import type { Deps } from "./tipos.ts";

/**
 * "Sempre permitir" lido AGORA (definido em 2026-09-30, ADR-062). O plano congelava as regras no começo do turno, e
 * o clique no card só valia "a partir do próximo turno": quem aprovava rápido continuava no mesmo turno e via o mesmo
 * card de novo (o do print do Milton saiu 34 s depois do clique). O modo já é lido na hora (ADR-059 §3) pelo mesmo
 * motivo — quem decide é o servidor, não o proxy (ADR-013 não pede o valor congelado, pede a decisão no servidor).
 * Turno não confiável continua sem regra nenhuma (ADR-042 claim 6). Revogar também vale na hora.
 */
export async function semprePermitirVivo(deps: Pick<Deps, "repos">, agenteId: string, plano: Pick<PlanoTurno, "catalogo" | "confiancaEntrada">): Promise<string[]> {
  if (plano.confiancaEntrada === "nao_confiavel") return [];
  const [permissoes, conectores] = await Promise.all([deps.repos.permissoesPermanentes.ativasDoAgente(agenteId), deps.repos.conectores.listar()]);
  const nomes = permissoes.flatMap((p) => {
    const slug = conectores.find((c) => c.id === p.conectorId)?.slug;
    return slug ? [`${slug}__${p.capacidade}`] : [];
  });
  return semprePermitirNoCatalogo(nomes, plano.catalogo.ferramentas);
}
