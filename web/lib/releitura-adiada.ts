/**
 * NOD-260 (definido em 2026-10-15, J1): a releitura de Trabalhos que os frames de turno pedem, juntada numa por janela.
 * Um lote de turnos começando e acabando (dez frentes despachadas juntas) mandava dez `GET trabalhos` seguidos; aqui o
 * primeiro pedido abre a janela e os que chegam dentro dela vão junto — uma releitura só, no fim da janela. A janela não
 * recomeça a cada pedido: frames sem parar ainda releem uma vez por janela.
 *
 * Puro: o relógio vem de fora (`agendar` devolve como cancelar), o que torna o teste um timer falso.
 */
export type ReleituraAdiada = {
  /** Pede a releitura: abre a janela, ou vai junto com a que está aberta. */
  pedir(): void;
  /** A janela está aberta: a releitura sai no fim dela (quem relê agora deixa para ela). */
  pendente(): boolean;
  /** Fecha a janela sem reler (a página saiu). */
  cancelar(): void;
};

export function criarReleituraAdiada(janelaMs: number, agendar: (fn: () => void, ms: number) => () => void, reler: () => void): ReleituraAdiada {
  let cancelarAgendada: (() => void) | null = null;
  return {
    pedir() {
      if (cancelarAgendada) return;
      cancelarAgendada = agendar(() => {
        cancelarAgendada = null;
        reler();
      }, janelaMs);
    },
    pendente: () => cancelarAgendada !== null,
    cancelar() {
      cancelarAgendada?.();
      cancelarAgendada = null;
    },
  };
}
