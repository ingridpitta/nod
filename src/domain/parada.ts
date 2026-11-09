import type { FaixaParada } from "../contracts/turno.ts";

export type TentativaInterrupcao = { turnoId: string; interrompido: boolean; motivo: string | null };

/**
 * Faixa de Parar (E5.4): contagens honestas — o que foi interrompido, o que NÃO foi (com motivo,
 * nunca catch vazio) e o que já tinha sido entregue. Sem nada rodando, nadaRodando=true e a
 * web escreve isso como texto.
 */
export function montarFaixaParada(entrada: {
  pendentesInterrompidos: readonly string[];
  despachando: readonly TentativaInterrupcao[];
  entregues: readonly { id: string; em: number }[];
}): FaixaParada {
  const interrompidas = entrada.pendentesInterrompidos.length + entrada.despachando.filter((t) => t.interrompido).length;
  const naoInterrompidas = entrada.despachando.filter((t) => !t.interrompido).map((t) => ({ turnoId: t.turnoId, motivo: t.motivo ?? "motivo não informado" }));
  return {
    interrompidas,
    naoInterrompidas,
    jaEntregues: entrada.entregues.map((e) => ({ id: e.id, em: e.em })),
    nadaRodando: entrada.pendentesInterrompidos.length === 0 && entrada.despachando.length === 0,
  };
}
