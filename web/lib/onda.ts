/**
 * Onda do memo de voz (definido em 2026-10-22, NOD-329): 48 barras de 0 a 1 calculadas NO NAVEGADOR (o servidor não
 * tem ffmpeg), só quando o memo entra na tela. Sem DOM: quem desenha é o render do memo (PR 4).
 *
 * - Decodifica com `OfflineAudioContext(1, 1, 8000)`: o `decodeAudioData` reamostra para a taxa do contexto, então o
 *   áudio inteiro fica em 8 kHz (60 s = 480 mil amostras por canal, ~1,9 MB), o que limita a memória.
 * - Cada barra é o pico absoluto do seu balde (no canal mais alto; a média zeraria um estéreo com fase invertida),
 *   normalizado pelo maior pico, com piso de 0,08 para a barra nunca sumir.
 * - Falha ao decodificar, áudio mudo, arquivo acima de 10 MB ou navegador sem `OfflineAudioContext` → barras planas
 *   (todas no piso); o áudio toca do mesmo jeito.
 * - Cache por `anexoId` (e o pedido em voo também, para dois renders não decodificarem o mesmo arquivo).
 */

export const BARRAS_ONDA = 48;
export const PISO_ONDA = 0.08;
export const TAXA_ONDA_HZ = 8000;
/** definido em 2026-10-22: 10 MB é o teto do STT síncrono e o maior memo que a transcrição aceita; acima, onda plana. */
export const LIMITE_BYTES_ONDA = 10 * 1024 * 1024;
/** definido em 2026-10-22: até 200 ondas guardadas (48 números cada); passou disso, sai a mais antiga. */
export const MAX_CACHE_ONDA = 200;

/** O que a onda precisa do AudioBuffer: os canais. */
export type AudioDecodificado = {
  numberOfChannels: number;
  length: number;
  getChannelData(canal: number): Float32Array;
};
export type Decodificador = (buf: ArrayBuffer) => Promise<AudioDecodificado>;

export function barrasPlanas(n = BARRAS_ONDA): number[] {
  return Array.from({ length: Math.max(0, n) }, () => PISO_ONDA);
}

/** Puro: picos absolutos por balde, normalizados para piso..1. Sem amostras ou tudo em silêncio → planas. */
export function picosDeCanais(
  canais: readonly Float32Array[],
  n = BARRAS_ONDA,
): number[] {
  const total = canais[0]?.length ?? 0;
  if (n <= 0) return [];
  if (total === 0 || canais.length === 0) return barrasPlanas(n);
  const brutos = new Array<number>(n).fill(0);
  for (let b = 0; b < n; b++) {
    const de = Math.floor((b * total) / n);
    const ate = Math.max(de + 1, Math.floor(((b + 1) * total) / n));
    let pico = 0;
    // o pico é o do canal mais alto: a média zeraria um estéreo com fase invertida (QA NOD-329)
    for (const c of canais) {
      for (let i = de; i < ate && i < total; i++) {
        const v = Math.abs(c[i] ?? 0);
        if (v > pico) pico = v;
      }
    }
    brutos[b] = pico;
  }
  const maior = Math.max(...brutos);
  if (!(maior > 0) || !Number.isFinite(maior)) return barrasPlanas(n);
  return brutos.map((p) => Math.max(PISO_ONDA, Math.min(1, p / maior)));
}

/** O decodificador do navegador: mono não é forçado aqui (o OfflineAudioContext mantém os canais); o cálculo pega o canal mais alto. */
export function decodificadorDoNavegador(): Decodificador | null {
  // tipado à mão: o onda.ts também é compilado pelo tsconfig.desktop, que não tem o lib DOM
  const Ctx = (
    globalThis as {
      OfflineAudioContext?: new (
        canais: number,
        comprimento: number,
        taxa: number,
      ) => { decodeAudioData(b: ArrayBuffer): Promise<AudioDecodificado> };
    }
  ).OfflineAudioContext;
  if (typeof Ctx !== "function") return null;
  return async (buf) => new Ctx(1, 1, TAXA_ONDA_HZ).decodeAudioData(buf);
}

/** Os picos e se a decodificação falhou (falha não fica no cache; arquivo grande ou mudo fica). */
async function calcular(
  buf: ArrayBuffer,
  n: number,
  decodificar: Decodificador | null,
): Promise<{ barras: number[]; falhou: boolean }> {
  if (buf.byteLength === 0 || buf.byteLength > LIMITE_BYTES_ONDA)
    return { barras: barrasPlanas(n), falhou: false };
  if (!decodificar) return { barras: barrasPlanas(n), falhou: true };
  try {
    const audio = await decodificar(buf.slice(0));
    const canais: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++)
      canais.push(audio.getChannelData(c));
    return { barras: picosDeCanais(canais, n), falhou: false };
  } catch {
    return { barras: barrasPlanas(n), falhou: true };
  }
}

/**
 * Os `n` picos de um arquivo de áudio. Nunca rejeita: qualquer falha vira barras planas. O `buf` é copiado antes de
 * decodificar (o `decodeAudioData` desanexa o ArrayBuffer, e quem chamou pode usar os bytes para tocar).
 */
export async function picos(
  buf: ArrayBuffer,
  n = BARRAS_ONDA,
  decodificar: Decodificador | null = decodificadorDoNavegador(),
): Promise<number[]> {
  return (await calcular(buf, n, decodificar)).barras;
}

export type CacheDeOndas = {
  /** Os picos do anexo: do cache, do pedido em voo ou carregando agora. Nunca rejeita (falha = planas, sem guardar). */
  doAnexo(
    anexoId: string,
    carregar: () => Promise<ArrayBuffer>,
  ): Promise<number[]>;
  /** Já calculada (para o primeiro render sair com a onda certa, sem piscar as planas). */
  pronta(anexoId: string): number[] | null;
  readonly tamanho: number;
};

export function criarCacheDeOndas(
  o: { decodificar?: Decodificador | null; max?: number; n?: number } = {},
): CacheDeOndas {
  const max = o.max ?? MAX_CACHE_ONDA;
  const n = o.n ?? BARRAS_ONDA;
  const prontas = new Map<string, number[]>();
  const emVoo = new Map<string, Promise<number[]>>();
  const decodificar =
    o.decodificar === undefined ? decodificadorDoNavegador() : o.decodificar;
  return {
    get tamanho() {
      return prontas.size;
    },
    pronta(anexoId) {
      return prontas.get(anexoId) ?? null;
    },
    doAnexo(anexoId, carregar) {
      const ja = prontas.get(anexoId);
      if (ja) return Promise.resolve(ja);
      const voando = emVoo.get(anexoId);
      if (voando) return voando;
      const p = (async () => {
        let ok: boolean;
        let barras: number[];
        try {
          const r = await calcular(await carregar(), n, decodificar);
          barras = r.barras;
          ok = !r.falhou;
        } catch {
          barras = barrasPlanas(n);
          ok = false;
        }
        // falha de rede ou de decodificação não fica guardada: o próximo render tenta de novo
        if (ok) {
          prontas.set(anexoId, barras);
          if (prontas.size > max) {
            const maisAntiga = prontas.keys().next().value;
            if (maisAntiga !== undefined) prontas.delete(maisAntiga);
          }
        }
        emVoo.delete(anexoId);
        return barras;
      })();
      emVoo.set(anexoId, p);
      return p;
    },
  };
}
