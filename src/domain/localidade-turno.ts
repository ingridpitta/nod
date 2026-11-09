import type { Inventario } from "../contracts/inventario.ts";
import type { MotivoLocalidade } from "../contracts/motivos.ts";
import type { OrigemTurno } from "../contracts/turno.ts";

export const VERSAO_REGRA_LOCALIDADE = 1 as const;

export type Localidade =
  | { localidade: "local"; motivo: "tudo_local_nesta_rodada"; decididoPor: "regra:localidade"; regraVersao: 1 }
  | { recusado: true; motivo: Extract<MotivoLocalidade, "motor_ausente">; decididoPor: "regra:localidade"; regraVersao: 1 };

/**
 * Localidade por regra pura com motivo HONESTO (ADR-022): nesta rodada há um driver só, com
 * locality 'local' — conversa, sala, rotina e retomada rodam na máquina da pessoa (o servidor é
 * o mesmo processo). Turno cujo motor não está 'pronto' no inventário é RECUSADO com motivo,
 * nunca promovido em silêncio. O agente não escolhe.
 */
export function resolverLocalidade(entrada: {
  origem: OrigemTurno;
  tocaDadoPessoal: boolean;
  motorExigido: string;
  inventario: Inventario;
}): Localidade {
  if (entrada.inventario.estado !== "pronto") {
    return { recusado: true, motivo: "motor_ausente", decididoPor: "regra:localidade", regraVersao: VERSAO_REGRA_LOCALIDADE };
  }
  return { localidade: "local", motivo: "tudo_local_nesta_rodada", decididoPor: "regra:localidade", regraVersao: VERSAO_REGRA_LOCALIDADE };
}
