/** Revisão 2 do #646: o POST do comentário, do recado e da pílula que não volta não segura a tela em "enviando". */
export const PRAZO_DO_ENVIO_MS = 25_000;

/** A promessa ou, passado `ms`, a recusa (`envio_sem_resposta`). */
export function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([p, new Promise<never>((_, falhar) => { t = setTimeout(() => falhar(new Error("envio_sem_resposta")), ms); })]).finally(() => { if (t) clearTimeout(t); });
}
