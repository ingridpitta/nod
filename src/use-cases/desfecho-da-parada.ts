import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Turno } from "../contracts/turno.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-10-15 (NOD-256, F2; decisão NOD-225): o turno que a parada aberta barrou (no despacho ou no próprio
 * Parar) não morre em silêncio. A rotina registra `interrompida`/`parada_aberta` com uma linha na conversa dela; o pedido
 * de colega avisa quem pediu, uma vez, sem esperar ninguém. O resto (a conversa da pessoa) não tem a quem avisar.
 * Reaproveitado pelo varredor da NOD-252.
 */
export async function desfechoDaParada(deps: Deps, turno: Turno, motivoDelegacao?: string): Promise<RuntimeEvent[]> {
  const rotina = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo: "parada_aberta", regra: "regra:parada" });
  if ("execucao" in rotina.data) return rotina.events ?? [];
  const bot = (await deps.repos.agentes.buscar(turno.agenteId))?.nome ?? "o bot";
  const aviso = await avisarFalhaDelegacao(deps, { turnoId: turno.id, motivo: motivoDelegacao ?? `${bot} está parado pela pessoa`, semEsperar: true });
  return aviso.events ?? [];
}
