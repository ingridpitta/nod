/**
 * NOD-437 (revisão 2 e 4 do PR #632): o PATCH de recolher um time sai um instante depois do clique, só com o estado
 * final e só se ele mudou. Assim o duplo clique (que renomeia) não grava nada, e cliques rápidos não viram PATCHes em
 * corrida: uma fila por time garante a ordem de chegada. Relógio injetável para o teste.
 */
export type Relogio = { agendar: (fn: () => void, ms: number) => number; cancelar: (t: number) => void };

export type RecolherAdiado = {
  /** A pessoa mudou o time `id` de `antes` para `novo` (a tela já mostra `novo`). */
  pedir(id: string, antes: boolean, novo: boolean): void;
  /** Envia já o que está esperando (a página vai fechar). */
  enviarJa(): void;
  /** Há PATCH esperando ou em voo para o time (a frota relida não deve desfazer o otimista). */
  pendente(id: string): boolean;
};

export function criarRecolherAdiado(enviar: (id: string, recolhido: boolean) => Promise<unknown>, relogio: Relogio, esperaMs = 300): RecolherAdiado {
  const esperando = new Map<string, { original: boolean; novo: boolean; timer: number }>();
  const fila = new Map<string, Promise<unknown>>();

  function sair(id: string): void {
    const p = esperando.get(id);
    if (!p) return;
    esperando.delete(id);
    if (p.novo === p.original) return;
    const vez = (fila.get(id) ?? Promise.resolve()).then(() => enviar(id, p.novo)).catch(() => undefined);
    fila.set(id, vez);
    void vez.finally(() => { if (fila.get(id) === vez) fila.delete(id); });
  }

  return {
    pedir(id, antes, novo) {
      const p = esperando.get(id) ?? { original: antes, novo, timer: 0 };
      relogio.cancelar(p.timer);
      p.novo = novo;
      p.timer = relogio.agendar(() => sair(id), esperaMs);
      esperando.set(id, p);
    },
    enviarJa() {
      for (const [id, p] of [...esperando]) { relogio.cancelar(p.timer); sair(id); }
    },
    pendente: (id) => esperando.has(id) || fila.has(id),
  };
}
