import type { RuntimeEvent } from "../contracts/evento.ts";
import { motivoEmPortugues } from "../domain/redacao.ts";
import { REGRA_PARAR, registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";

/**
 * definido em 2026-10-15 (NOD-252, F2 da auditoria): o turno que a parada (Parar, ou o bot excluído) interrompeu SEM
 * passar pelo assentamento — o despacho barrado pela parada aberta, o pendente que o Parar derrubou, o turno cuja
 * máquina estava fora quando a pessoa parou — não fica mudo. Rotina: a execução vai ao histórico como `interrompida`
 * (silenciosa, sem mensagem) com o motivo `parado_pela_pessoa` e a regra `regra:parar` — o mesmo registro do despacho
 * recusado da NOD-251 (registrarRecusaDaRotina), para a janela parada ter um só motivo, venha de onde vier. Delegação: quem pediu recebe o aviso, uma vez por raiz (avisarFalhaDelegacao), com o
 * mesmo texto do Parar com o Mac acordado. O resto (conversa, pedido de colega) é ignorado aqui: o pedido de colega
 * parado é do varredor de pedidos parados, que não o retoma (decidirPedidoParado).
 *
 * Chame só depois de o `interromper` ter MUDADO o estado (o UPDATE condicional): assim, com despacho e Parar
 * concorrentes, só quem interrompeu registra e avisa.
 */
export async function registrarInterrupcaoPorParada(
  deps: Pick<Deps, "repos" | "escopo" | "agora">,
  p: { turnoId: string },
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const rotina = await registrarDesfechoRotina(deps, { turnoId: p.turnoId, desfecho: "interrompida", motivo: "parado_pela_pessoa", regra: REGRA_PARAR });
  if (!("ignorado" in rotina.data)) {
    events.push(...(rotina.events ?? []));
    return events;
  }
  const aviso = await avisarFalhaDelegacao(deps, { turnoId: p.turnoId, motivo: motivoEmPortugues("parado_pela_pessoa") });
  if (!("ignorado" in aviso.data)) events.push(...(aviso.events ?? []));
  return events;
}
