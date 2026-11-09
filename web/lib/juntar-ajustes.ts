/**
 * definido em 2026-10-30 (NOD-20, revisão 1 M2): puro (sem DOM), para o teste rodar no projeto unit. Quem usa passa o
 * relógio (window na tela).
 */
export type Relogio = { setTimeout: (f: () => void, ms: number) => number; clearTimeout: (id: number) => void };

/** NOD-20: a pausa depois do último ajuste de voz antes de salvar (uma versão por escolha, não por opção percorrida). */
export const ESPERA_AJUSTE_VOZ_MS = 1_200;

/**
 * Junta os ajustes que chegam em sequência e chama `fn` uma vez, com o último valor de cada campo, `ms` depois do último.
 * `agora()` despacha o pendente na hora (o diálogo fechou).
 */
export function juntarAjustes<T extends object>(fn: (a: T) => void, ms: number, relogio: Relogio): ((a: T) => void) & { agora: () => void } {
  let pendente: T | null = null;
  let timer: number | null = null;
  const disparar = (): void => {
    if (timer !== null) relogio.clearTimeout(timer);
    timer = null;
    const a = pendente;
    pendente = null;
    if (a) fn(a);
  };
  const enviar = (a: T): void => {
    pendente = { ...(pendente ?? {}), ...a } as T;
    if (timer !== null) relogio.clearTimeout(timer);
    timer = relogio.setTimeout(disparar, ms);
  };
  return Object.assign(enviar, { agora: disparar });
}
