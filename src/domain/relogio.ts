export type TipoPrazo = "decisao" | "execucao";

/**
 * Relógio de DECISÃO conta parede (não pausa com humano olhando).
 * Relógio de EXECUÇÃO pausa em aprovação.
 */
export function tipoRelogio(natureza: "gate-aprovacao" | "watchdog-turno" | "expiracao-fila"): TipoPrazo {
  switch (natureza) {
    case "gate-aprovacao":
    case "expiracao-fila":
      return "decisao";
    case "watchdog-turno":
      return "execucao";
  }
}

export function prazoVenceu(entrada: {
  natureza: "gate-aprovacao" | "watchdog-turno" | "expiracao-fila";
  iniciaEm: number;
  prazoMs: number;
  pausadoMs: number;
  agora: number;
}): boolean {
  const tipo = tipoRelogio(entrada.natureza);
  const decorrido =
    tipo === "decisao"
      ? entrada.agora - entrada.iniciaEm
      : entrada.agora - entrada.iniciaEm - entrada.pausadoMs;
  return decorrido >= entrada.prazoMs;
}
