import { ErroDeDominio } from "../../domain/erro.ts";

/**
 * Utilitários de PCM16 (definido em 2026-10-04, ADR-071). Tudo em memória: nada aqui escreve em disco. O PCM é sempre
 * little-endian com sinal (LEI16); com mais de um canal, `pcm` vem intercalado (L R L R …) e `misturarParaMono` junta.
 */

export type Wav = { taxa: number; canais: number; pcm: Int16Array };

const FORMATO_PCM = 1;
const FORMATO_EXTENSIVEL = 0xfffe;

/**
 * Lê um WAVE PCM16. Aceita chunks extras (LIST, FLLR, `fact`…) antes ou depois de `fmt `/`data`, como os que o `say`
 * do macOS e o Google escrevem. Tamanho de `data` maior que o arquivo (WAV de streaming, 0xFFFFFFFF) é cortado no fim.
 */
export function lerWav(buf: Buffer): Wav {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new ErroDeDominio("entrada_invalida");
  let taxa = 0;
  let canais = 0;
  let bits = 0;
  let formato = 0;
  let dados: Buffer | null = null;
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const tamanho = buf.readUInt32LE(pos + 4);
    const inicio = pos + 8;
    const fim = Math.min(buf.length, inicio + tamanho);
    if (id === "fmt " && fim - inicio >= 16) {
      formato = buf.readUInt16LE(inicio);
      canais = buf.readUInt16LE(inicio + 2);
      taxa = buf.readUInt32LE(inicio + 4);
      bits = buf.readUInt16LE(inicio + 14);
    } else if (id === "data") {
      dados = buf.subarray(inicio, fim);
      if (taxa > 0) break;
    }
    // chunks têm tamanho par: o byte de enchimento não entra no tamanho declarado
    pos = inicio + tamanho + (tamanho % 2);
  }
  if (!dados || taxa <= 0 || canais <= 0 || bits !== 16 || (formato !== FORMATO_PCM && formato !== FORMATO_EXTENSIVEL)) throw new ErroDeDominio("entrada_invalida");
  return { taxa, canais, pcm: bytesParaPcm(dados) };
}

/** WAVE PCM16 mono com cabeçalho mínimo de 44 bytes. */
export function montarWav(pcm: Int16Array, taxa: number): Buffer {
  const dados = pcmParaBytes(pcm);
  const cab = Buffer.alloc(44);
  cab.write("RIFF", 0, "ascii");
  cab.writeUInt32LE(36 + dados.length, 4);
  cab.write("WAVE", 8, "ascii");
  cab.write("fmt ", 12, "ascii");
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(FORMATO_PCM, 20);
  cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(taxa, 24);
  cab.writeUInt32LE(taxa * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write("data", 36, "ascii");
  cab.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cab, dados]);
}

/** Bytes LEI16 → amostras. Copia (o Buffer pode estar desalinhado e o Int16Array exige alinhamento de 2). */
export function bytesParaPcm(bytes: Buffer): Int16Array {
  const n = Math.floor(bytes.length / 2);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = bytes.readInt16LE(i * 2);
  return pcm;
}

/** Amostras → bytes LEI16 (explícito, independe da ordem de bytes da máquina). */
export function pcmParaBytes(pcm: Int16Array): Buffer {
  const b = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) b.writeInt16LE(pcm[i] ?? 0, i * 2);
  return b;
}

/** Reamostragem linear (definido em 2026-10-04: basta para voz; o STT e o alto-falante não pedem mais que isso). */
export function reamostrar(pcm: Int16Array, de: number, para: number): Int16Array {
  if (de <= 0 || para <= 0) throw new ErroDeDominio("entrada_invalida");
  if (de === para || pcm.length === 0) return pcm.slice();
  const n = Math.max(1, Math.round((pcm.length * para) / de));
  const saida = new Int16Array(n);
  const passo = de / para;
  for (let i = 0; i < n; i++) {
    const x = i * passo;
    const a = Math.min(pcm.length - 1, Math.floor(x));
    const b = Math.min(pcm.length - 1, a + 1);
    const f = x - a;
    saida[i] = Math.round((pcm[a] ?? 0) * (1 - f) + (pcm[b] ?? 0) * f);
  }
  return saida;
}

/** Média dos canais de um PCM intercalado. */
export function misturarParaMono(pcm: Int16Array, canais: number): Int16Array {
  if (canais <= 1) return pcm.slice();
  const n = Math.floor(pcm.length / canais);
  const saida = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let soma = 0;
    for (let c = 0; c < canais; c++) soma += pcm[i * canais + c] ?? 0;
    saida[i] = Math.round(soma / canais);
  }
  return saida;
}

/** Pedaços de até `amostrasPorPedaco` (o último pode ser menor). São vistas (`subarray`) do mesmo buffer. */
export function fatiar(pcm: Int16Array, amostrasPorPedaco: number): Int16Array[] {
  if (amostrasPorPedaco <= 0) throw new ErroDeDominio("entrada_invalida");
  const pedacos: Int16Array[] = [];
  for (let i = 0; i < pcm.length; i += amostrasPorPedaco) pedacos.push(pcm.subarray(i, Math.min(pcm.length, i + amostrasPorPedaco)));
  return pedacos;
}

export function silencio(ms: number, taxa: number): Int16Array {
  return new Int16Array(Math.max(0, Math.round((ms * taxa) / 1000)));
}

export function duracaoMs(pcm: Int16Array, taxa: number): number {
  return (pcm.length * 1000) / taxa;
}

/** Raiz da média dos quadrados, em unidades de amostra (0–32768). */
export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let soma = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    soma += v * v;
  }
  return Math.sqrt(soma / pcm.length);
}

export function concatenar(pedacos: readonly Int16Array[]): Int16Array {
  let n = 0;
  for (const p of pedacos) n += p.length;
  const saida = new Int16Array(n);
  let pos = 0;
  for (const p of pedacos) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}
