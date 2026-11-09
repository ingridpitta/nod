import type { DestinoItem, ItemAprovacao } from "../contracts/item-aprovacao.ts";

export type PropostaItem = {
  texto: string;
  destino: DestinoItem;
  /** Se o dado do item veio de conector, a sensibilidade é a DELE (declaração), não a do destino. */
  origemSensivel: boolean;
};

/** definido em 2026-09-16: a justificativa é texto fixo do sistema, nunca do modelo (E4.2). */
export const JUSTIFICATIVA_SENSIVEL = "Nasceu desmarcado: o dado veio de origem que toca dado pessoal. Marque você mesmo se quiser executar.";

/**
 * Monta itens tipados (E4.1/E4.2). Origem sensível nasce desmarcada COM justificativa; o resto
 * nasce marcado. textoFinal começa igual ao original; a pessoa pode editar antes de decidir.
 */
export function montarItens(entrada: {
  tenantId: string;
  decisaoId: string;
  propostas: readonly PropostaItem[];
  agora: number;
}): ItemAprovacao[] {
  return entrada.propostas.map((p, idx) => ({
    tenantId: entrada.tenantId,
    id: `${entrada.decisaoId}:item:${idx}`,
    decisaoId: entrada.decisaoId,
    idx,
    textoOriginal: p.texto,
    textoFinal: p.texto,
    destino: p.destino,
    selecionado: !p.origemSensivel,
    origemSensivel: p.origemSensivel,
    justificativa: p.origemSensivel ? JUSTIFICATIVA_SENSIVEL : null,
    marcadoPor: null,
    marcadoEm: null,
    editadoPor: null,
    desfecho: null,
    motivoManual: null,
  }));
}
