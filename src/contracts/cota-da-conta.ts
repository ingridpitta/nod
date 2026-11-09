import type { SituacaoDaCota } from "./cota.ts";
import type { EpochMs } from "./ids.ts";
import type { JanelaDoPlano } from "./uso-do-plano.ts";

/**
 * NOD-302 (continuação da NOD-253): a cota de uma conta de IA pela última leitura que um turno dela trouxe — as janelas
 * ainda vigentes (5 horas e semana), a situação (livre, reserva ou limite) e quando volta. Vai em `ContaIa.cota`
 * (contas-ia.ts, que reexporta este tipo); saiu de lá para o contrato caber em 200 linhas (NOD-12).
 */
export type CotaDaContaDto = {
  cincoHoras: JanelaDoPlano | null;
  semana: JanelaDoPlano | null;
  situacao: SituacaoDaCota;
  voltaEm: EpochMs | null;
  medidoEm: EpochMs;
  /** NOD-12 (ausente = servidor anterior): a máquina que mediu; a tela diz "no <Mac>" com a conta em mais de uma. */
  maquinaId?: string | null;
  /** NOD-12: quando a janela renovou desde a leitura (a tela diz "renovou às …" sem o número velho); null = vigente. */
  renovou?: { cincoHoras: EpochMs | null; semana: EpochMs | null };
};
