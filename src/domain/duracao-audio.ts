/**
 * Duração de um arquivo de áudio lida só do cabeçalho (definido em 2026-10-22, NOD-329), sem decodificar: decide se o
 * memo passa do limite do STT síncrono (60 s) antes de gastar uma chamada. Puro: bytes entram, ms (ou null) sai.
 *
 * - wav: `byteRate` do `fmt ` e o tamanho do `data` (tamanho 0 ou além do arquivo → o que sobra do arquivo).
 * - mp3: pula o ID3v2; com cabeçalho Xing/Info ou VBRI, frames × amostras por frame; senão CBR (bytes × 8 / bitrate).
 * - m4a/mp4: `moov/mvhd` (duração / timescale), versões 0 e 1.
 * - ogg: granule da última página; Opus a 48 kHz menos o pre-skip do OpusHead, Vorbis com a taxa do cabeçalho.
 *
 * Sem certeza (cabeçalho truncado, formato que não reconhece), devolve null: quem chama trata como "não sei" e deixa o
 * provedor decidir.
 */

export function duracaoMs(bytes: Uint8Array, mime: string): number | null {
  const tipo = tipoDoMime(mime) ?? farejar(bytes);
  if (!tipo) return null;
  const ms = LEITORES[tipo](bytes);
  return ms !== null && Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null;
}

type Tipo = "wav" | "mp3" | "mp4" | "ogg";

const LEITORES: Record<Tipo, (b: Uint8Array) => number | null> = { wav: duracaoWav, mp3: duracaoMp3, mp4: duracaoMp4, ogg: duracaoOgg };

function tipoDoMime(mime: string): Tipo | null {
  const m = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave" || m === "audio/vnd.wave") return "wav";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/mp4" || m === "audio/m4a" || m === "audio/x-m4a" || m === "audio/aac" || m === "video/mp4") return "mp4";
  if (m === "audio/ogg" || m === "audio/opus" || m === "application/ogg") return "ogg";
  return null;
}

function ascii(b: Uint8Array, i: number, n: number): string {
  if (i < 0 || i + n > b.length) return "";
  let s = "";
  for (let k = 0; k < n; k++) s += String.fromCharCode(b[i + k] ?? 0);
  return s;
}

function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}
function u32le(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
}
function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
}

function farejar(b: Uint8Array): Tipo | null {
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WAVE") return "wav";
  if (ascii(b, 0, 4) === "OggS") return "ogg";
  if (ascii(b, 4, 4) === "ftyp") return "mp4";
  if (ascii(b, 0, 3) === "ID3" || ((b[0] ?? 0) === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0)) return "mp3";
  return null;
}

// ---- wav ------------------------------------------------------------------------------------------------------------

function duracaoWav(b: Uint8Array): number | null {
  if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WAVE") return null;
  let i = 12;
  let byteRate = 0;
  while (i + 8 <= b.length) {
    const id = ascii(b, i, 4);
    const tam = u32le(b, i + 4);
    const dados = i + 8;
    if (id === "fmt ") {
      if (dados + 12 > b.length) return null;
      byteRate = u32le(b, dados + 8);
    } else if (id === "data") {
      if (byteRate <= 0) return null;
      const resto = b.length - dados;
      const tamanho = tam === 0 || tam > resto ? resto : tam;
      return (tamanho / byteRate) * 1000;
    }
    i = dados + tam + (tam % 2);
  }
  return null;
}

// ---- mp3 ------------------------------------------------------------------------------------------------------------

const BITRATES_KBPS = {
  // [versão MPEG1][camada I, II, III]
  v1: [
    [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  ],
  // MPEG2 e 2.5
  v2: [
    [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  ],
} as const;
const TAXAS_HZ = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as const;

type FrameMp3 = { taxa: number; bitrateBps: number; amostras: number; mpeg1: boolean; mono: boolean };

function lerFrameMp3(b: Uint8Array, i: number): FrameMp3 | null {
  if (i + 4 > b.length || b[i] !== 0xff || ((b[i + 1] ?? 0) & 0xe0) !== 0xe0) return null;
  const versao = ((b[i + 1] ?? 0) >> 3) & 0x3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reservado
  const camadaBits = ((b[i + 1] ?? 0) >> 1) & 0x3; // 3 = I, 2 = II, 1 = III
  const idxBitrate = ((b[i + 2] ?? 0) >> 4) & 0xf;
  const idxTaxa = ((b[i + 2] ?? 0) >> 2) & 0x3;
  if (versao === 1 || camadaBits === 0 || idxBitrate === 0 || idxBitrate === 15 || idxTaxa === 3) return null;
  const camada = 4 - camadaBits; // 1, 2 ou 3
  const mpeg1 = versao === 3;
  const kbps = (mpeg1 ? BITRATES_KBPS.v1 : BITRATES_KBPS.v2)[camada - 1]?.[idxBitrate] ?? 0;
  const taxa = TAXAS_HZ[versao as 0 | 2 | 3][idxTaxa] ?? 0;
  if (!kbps || !taxa) return null;
  const amostras = camada === 1 ? 384 : camada === 2 ? 1152 : mpeg1 ? 1152 : 576;
  const mono = (((b[i + 3] ?? 0) >> 6) & 0x3) === 3;
  return { taxa, bitrateBps: kbps * 1000, amostras, mpeg1, mono };
}

function duracaoMp3(b: Uint8Array): number | null {
  let inicio = 0;
  if (ascii(b, 0, 3) === "ID3") {
    if (b.length < 10) return null;
    const tam = (((b[6] ?? 0) & 0x7f) << 21) | (((b[7] ?? 0) & 0x7f) << 14) | (((b[8] ?? 0) & 0x7f) << 7) | ((b[9] ?? 0) & 0x7f);
    const rodape = ((b[5] ?? 0) & 0x10) !== 0 ? 10 : 0;
    inicio = 10 + tam + rodape;
  }
  // o primeiro frame pode vir depois de bytes de preenchimento: procura nos primeiros 4 KB
  let frame: FrameMp3 | null = null;
  const limite = Math.min(b.length - 4, inicio + 4096);
  for (; inicio <= limite; inicio++) {
    frame = lerFrameMp3(b, inicio);
    if (frame) break;
  }
  if (!frame) return null;

  // Xing/Info (depois do side info) ou VBRI (32 bytes depois do cabeçalho)
  const sideInfo = frame.mpeg1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = inicio + 4 + sideInfo;
  const tag = ascii(b, xing, 4);
  if (tag === "Xing" || tag === "Info") {
    const flags = u32be(b, xing + 4);
    if (flags & 0x1) {
      const frames = u32be(b, xing + 8);
      if (frames > 0) return ((frames * frame.amostras) / frame.taxa) * 1000;
    }
  }
  if (ascii(b, inicio + 4 + 32, 4) === "VBRI") {
    const frames = u32be(b, inicio + 4 + 32 + 14);
    if (frames > 0) return ((frames * frame.amostras) / frame.taxa) * 1000;
  }
  let fim = b.length;
  if (fim - 128 >= inicio && ascii(b, fim - 128, 3) === "TAG") fim -= 128;
  return (((fim - inicio) * 8) / frame.bitrateBps) * 1000;
}

// ---- mp4 / m4a ------------------------------------------------------------------------------------------------------

type Caixa = { tipo: string; dados: number; fim: number };

function caixas(b: Uint8Array, de: number, ate: number): Caixa[] {
  const lista: Caixa[] = [];
  let i = de;
  while (i + 8 <= ate) {
    let tam = u32be(b, i);
    const tipo = ascii(b, i + 4, 4);
    let cabecalho = 8;
    if (tam === 1) {
      if (i + 16 > ate) break;
      const alto = u32be(b, i + 8);
      if (alto !== 0) break; // caixa acima de 4 GB: fora do que um memo tem
      tam = u32be(b, i + 12);
      cabecalho = 16;
    } else if (tam === 0) {
      tam = ate - i;
    }
    if (tam < cabecalho || i + tam > ate) {
      lista.push({ tipo, dados: i + cabecalho, fim: ate });
      break;
    }
    lista.push({ tipo, dados: i + cabecalho, fim: i + tam });
    i += tam;
  }
  return lista;
}

function duracaoMp4(b: Uint8Array): number | null {
  const moov = caixas(b, 0, b.length).find((c) => c.tipo === "moov");
  if (!moov) return null;
  const mvhd = caixas(b, moov.dados, moov.fim).find((c) => c.tipo === "mvhd");
  if (!mvhd) return null;
  const versao = b[mvhd.dados] ?? 0;
  let timescale: number;
  let duracao: number;
  if (versao === 1) {
    if (mvhd.dados + 32 > b.length) return null;
    timescale = u32be(b, mvhd.dados + 20);
    duracao = u32be(b, mvhd.dados + 24) * 2 ** 32 + u32be(b, mvhd.dados + 28);
  } else {
    if (mvhd.dados + 20 > b.length) return null;
    timescale = u32be(b, mvhd.dados + 12);
    duracao = u32be(b, mvhd.dados + 16);
  }
  if (!timescale || duracao === 0xffffffff) return null;
  return (duracao / timescale) * 1000;
}

// ---- ogg ------------------------------------------------------------------------------------------------------------

function duracaoOgg(b: Uint8Array): number | null {
  if (ascii(b, 0, 4) !== "OggS" || b.length < 27) return null;
  const segmentos = b[26] ?? 0;
  const carga = 27 + segmentos;
  let taxa: number;
  let preSkip = 0;
  if (ascii(b, carga, 8) === "OpusHead") {
    taxa = 48000;
    preSkip = u16le(b, carga + 10);
  } else if (ascii(b, carga, 7) === "\x01vorbis") {
    taxa = u32le(b, carga + 12);
  } else {
    return null;
  }
  if (!taxa) return null;
  // última página: procura "OggS" de trás para a frente
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] !== 0x4f || ascii(b, i, 4) !== "OggS") continue;
    const baixo = u32le(b, i + 6);
    const alto = u32le(b, i + 10);
    if (alto === 0xffffffff && baixo === 0xffffffff) continue; // página sem granule (pacote incompleto)
    if (alto > 0x1fffff) return null;
    const granule = alto * 2 ** 32 + baixo;
    return (Math.max(0, granule - preSkip) / taxa) * 1000;
  }
  return null;
}
