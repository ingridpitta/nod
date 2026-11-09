/**
 * definido em 2026-10-05 (NOD-161): o que o modelo já viu do computador no turno, em hashes. O hash é
 * calculado na borda (adapter, `node:crypto`); aqui só a decisão (ADR-018).
 */
export type HashesObservacao = { imagem: string; texto: string };

export type DecisaoObservacao = {
  omitirImagem: boolean;
  omitirTexto: boolean;
  /** O par que passa a valer como "o que o modelo viu" depois desta entrega. */
  entregue: HashesObservacao;
};

/**
 * Só igualdade exata com a ÚLTIMA entrega do mesmo turno e computador. Imagem e texto são decididos
 * cada um por si; sem anterior (primeira do turno) ou com `forcar`, vai tudo.
 */
export function deduplicarObservacao(anterior: HashesObservacao | undefined, atual: HashesObservacao, forcar: boolean): DecisaoObservacao {
  if (!anterior || forcar) return { omitirImagem: false, omitirTexto: false, entregue: atual };
  return { omitirImagem: anterior.imagem === atual.imagem, omitirTexto: anterior.texto === atual.texto, entregue: atual };
}
