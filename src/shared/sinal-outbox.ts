/**
 * "O outbox ganhou linha", dentro do processo (definido em 2026-10-09, #218). O events.repo avisa ao gravar e o
 * despachante (src/adapters/fundo/despachar-outbox.ts) volta ao passo curto na hora, em vez de esperar o passo ocioso.
 *
 * É só um despertador: o aviso sai ANTES do commit de quem gravou, e quem garante a entrega continua sendo a consulta
 * do despachante (o passo curto dura alguns segundos depois do aviso). Linha gravada por outro processo não avisa e
 * sai no passo ocioso, como antes saía no passo fixo.
 */
const ouvintes = new Set<() => void>();

export function avisarOutbox(): void {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Devolve quem para de ouvir (o `parar()` do despachante). */
export function ouvirOutbox(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
