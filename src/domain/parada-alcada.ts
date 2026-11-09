import type { MotivoNegacao } from "../contracts/motivos.ts";

export type ClasseParada = "TERMINAL" | "TRANSITORIA";

/**
 * Falta de alçada encerra o turno (TERMINAL); falha técnica segue (TRANSITORIA) — E5.1 / ADR-013.
 * Motivo vem do enum único de src/contracts/motivos.ts (ADR-004).
 * alcance_insuficiente é TRANSITÓRIA quando vem de efeitoExternoSoPorAprovacao (EMENDA 15):
 * o agente deve usar pedir_aprovacao — por isso recebe o contexto.
 */
export function classificarNegacao(motivo: MotivoNegacao, _agora: number, contexto: { viaGateDeRotina?: boolean } = {}): ClasseParada {
  switch (motivo) {
    case "capacidade_desligada":
    case "teto_canal":
    case "fora_do_catalogo":
    case "plano_ausente":
    case "plano_expirado":
    case "catalogo_vazio":
    case "parada_ativa":
      return "TERMINAL";
    case "alcance_insuficiente":
      return contexto.viaGateDeRotina ? "TRANSITORIA" : "TERMINAL";
    case "conector_indisponivel":
    case "args_invalidos":
    case "falha_tecnica":
    case "timeout_transporte":
      return "TRANSITORIA";
  }
}
