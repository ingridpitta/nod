import type { ERROS_DITADO as ErrosDitado, ErroDitado, MsgDitadoServidor } from "../../src/contracts/ditado.ts";

/**
 * O protocolo do ditado do lado do renderer (definido em 2026-10-11, ADR-095), sem DOM: os eventos que o motor
 * (web/lib/ditado.ts) emite e a leitura das mensagens do servidor, conferidas campo a campo.
 */

/** Espelho de `ERROS_DITADO` com o tipo da origem (a web só importa tipos de src/). */
const ERROS: typeof ErrosDitado = ["sem_permissao", "sem_consentimento", "ja_ditando", "voz_fora", "falhou"];

export type FalhaDitado = ErroDitado | "microfone-negado" | "microfone-restrito" | "microfone-indisponivel" | "caiu";

export type EventoDitado =
  /** O servidor está pronto e o microfone já mandou o primeiro quadro: a fala já vai ao STT. */
  | { t: "gravando" }
  /** Energia do último quadro, de 0 a 1 (para o nível que pulsa). */
  | { t: "nivel"; valor: number }
  | { t: "transcrevendo" }
  | { t: "texto"; texto: string; teto: boolean }
  | { t: "erro"; codigo: FalhaDitado };

/** Energia RMS de um quadro PCM16, de 0 a 1. */
export function energiaPcm(q: Int16Array): number {
  if (q.length === 0) return 0;
  let soma = 0;
  for (const a of q) soma += (a / 32768) * (a / 32768);
  return Math.sqrt(soma / q.length);
}

export function lerMsgDitado(texto: string): MsgDitadoServidor | null {
  let o: unknown;
  try {
    o = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const m = o as Record<string, unknown>;
  if (m.t === "pronto" && typeof m.maxS === "number") return { t: "pronto", maxS: m.maxS };
  if (m.t === "texto" && typeof m.texto === "string") return m.teto === true ? { t: "texto", texto: m.texto, teto: true } : { t: "texto", texto: m.texto };
  if (m.t === "erro" && (ERROS as readonly unknown[]).includes(m.codigo)) return { t: "erro", codigo: m.codigo as ErroDitado };
  return null;
}
