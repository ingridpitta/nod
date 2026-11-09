/**
 * Fixtures mínimas de áudio (NOD-329): só os cabeçalhos que `src/domain/duracao-audio.ts` lê, montados byte a byte e
 * com a duração conhecida. O conteúdo de áudio é zero (silêncio) — nenhum decodificador de verdade passa por aqui.
 */

function concat(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
const txt = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/** WAV PCM16 mono, `ms` de silêncio. `dataTamanhoZero`: imita gravador em streaming que não fecha o cabeçalho. */
export function wav(ms: number, taxa = 16_000, opcoes: { dataTamanhoZero?: boolean; chunkExtra?: boolean } = {}): Uint8Array {
  const byteRate = taxa * 2;
  const dados = new Uint8Array(Math.round((byteRate * ms) / 1000));
  const fmt = concat(txt("fmt "), u32le(16), u16le(1), u16le(1), u32le(taxa), u32le(byteRate), u16le(2), u16le(16));
  // chunk LIST de tamanho ímpar antes do data: testa o byte de preenchimento
  const extra = opcoes.chunkExtra ? concat(txt("LIST"), u32le(3), txt("abc"), new Uint8Array(1)) : new Uint8Array(0);
  const data = concat(txt("data"), u32le(opcoes.dataTamanhoZero ? 0 : dados.length), dados);
  const corpo = concat(txt("WAVE"), fmt, extra, data);
  return concat(txt("RIFF"), u32le(corpo.length), corpo);
}

/** Cabeçalho de frame MPEG1 Layer III, 128 kbps, 44,1 kHz, estéreo, sem padding (frame de 417 bytes). */
const FRAME_128K = Uint8Array.from([0xff, 0xfb, 0x90, 0x00]);
const BYTES_FRAME_128K = 417;

function frame(): Uint8Array {
  const f = new Uint8Array(BYTES_FRAME_128K);
  f.set(FRAME_128K, 0);
  return f;
}

/** MP3 CBR 128 kbps com `frames` frames (1152 amostras a 44,1 kHz cada), opcionalmente com ID3v2 e ID3v1. */
export function mp3Cbr(frames: number, opcoes: { id3?: boolean; id3v1?: boolean } = {}): Uint8Array {
  const partes: Uint8Array[] = [];
  if (opcoes.id3) partes.push(concat(txt("ID3"), Uint8Array.from([4, 0, 0, 0, 0, 0, 20]), new Uint8Array(20)));
  for (let i = 0; i < frames; i++) partes.push(frame());
  if (opcoes.id3v1) partes.push(concat(txt("TAG"), new Uint8Array(125)));
  return concat(...partes);
}

/** MP3 VBR com cabeçalho Xing dizendo `frames` frames (o arquivo em si só tem o frame do Xing). */
export function mp3Xing(frames: number, tag: "Xing" | "Info" = "Xing"): Uint8Array {
  const f = frame();
  // MPEG1 estéreo: side info de 32 bytes depois do cabeçalho de 4
  f.set(concat(txt(tag), u32be(0x1), u32be(frames)), 4 + 32);
  return f;
}

/** MP3 VBR com cabeçalho VBRI (Fraunhofer, 32 bytes depois do cabeçalho do frame) dizendo `frames` frames. */
export function mp3Vbri(frames: number): Uint8Array {
  const f = frame();
  // "VBRI", versão (2), atraso (2), qualidade (2), bytes (4), frames (4)
  f.set(concat(txt("VBRI"), new Uint8Array(6), u32be(0), u32be(frames)), 4 + 32);
  return f;
}

function caixa(tipo: string, ...conteudo: Uint8Array[]): Uint8Array {
  const corpo = concat(...conteudo);
  return concat(u32be(8 + corpo.length), txt(tipo), corpo);
}

/** M4A com `moov/mvhd` versão 0 (ou 1) de `ms` a timescale 44100, e um `mdat` vazio antes do moov. */
export function m4a(ms: number, versao: 0 | 1 = 0): Uint8Array {
  const timescale = 44_100;
  const duracao = Math.round((ms * timescale) / 1000);
  const mvhd =
    versao === 0
      ? caixa("mvhd", Uint8Array.from([0, 0, 0, 0]), u32be(0), u32be(0), u32be(timescale), u32be(duracao), new Uint8Array(80))
      : caixa("mvhd", Uint8Array.from([1, 0, 0, 0]), new Uint8Array(16), u32be(timescale), u32be(0), u32be(duracao), new Uint8Array(80));
  return concat(caixa("ftyp", txt("M4A "), u32be(0), txt("isomM4A ")), caixa("mdat", new Uint8Array(64)), caixa("moov", mvhd));
}

function paginaOgg(granule: number, carga: Uint8Array): Uint8Array {
  const g = new Uint8Array(8);
  new DataView(g.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(granule)), true);
  return concat(txt("OggS"), Uint8Array.from([0, 0]), g, new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), Uint8Array.from([1, carga.length]), carga);
}

/** Ogg Opus de `ms`, com pre-skip 312 (o padrão do libopus). */
export function oggOpus(ms: number): Uint8Array {
  const preSkip = 312;
  const head = concat(txt("OpusHead"), Uint8Array.from([1, 1]), u16le(preSkip), u32le(48_000), u16le(0), Uint8Array.from([0]));
  const tags = concat(txt("OpusTags"), u32le(0), u32le(0));
  const fim = Math.round((ms * 48_000) / 1000) + preSkip;
  return concat(paginaOgg(0, head), paginaOgg(0, tags), paginaOgg(fim, new Uint8Array(30)));
}

/** Ogg Vorbis de `ms` a 22,05 kHz. */
export function oggVorbis(ms: number): Uint8Array {
  const taxa = 22_050;
  const ident = concat(txt("\x01vorbis"), u32le(0), Uint8Array.from([1]), u32le(taxa), new Uint8Array(13));
  return concat(paginaOgg(0, ident), paginaOgg(Math.round((ms * taxa) / 1000), new Uint8Array(30)));
}

/**
 * MP3 VBR com Xing num frame mono: MPEG1 44,1 kHz (side info 17) ou MPEG2 Layer III 24 kHz a 32 kbps (side info 9 e
 * 576 amostras por frame; é o formato do mp3 de 24 kHz que o TTS do Google gera). `semFrames`: flags sem o bit de frames.
 */
export function mp3XingMono(frames: number, versao: "mpeg1" | "mpeg2", opcoes: { semFrames?: boolean } = {}): Uint8Array {
  const cabecalho = versao === "mpeg1" ? Uint8Array.from([0xff, 0xfb, 0x90, 0xc0]) : Uint8Array.from([0xff, 0xf3, 0x44, 0xc0]);
  const f = new Uint8Array(versao === "mpeg1" ? BYTES_FRAME_128K : 96);
  f.set(cabecalho, 0);
  f.set(concat(txt("Xing"), u32be(opcoes.semFrames ? 0x2 : 0x1), u32be(frames)), 4 + (versao === "mpeg1" ? 17 : 9));
  return f;
}

/** Ogg Opus de `ms` cuja última página não fecha pacote (granule -1): a duração vem da página anterior. */
export function oggOpusUltimaSemGranule(ms: number): Uint8Array {
  return concat(oggOpus(ms), paginaOgg(-1, new Uint8Array(30)));
}

export const MS_FRAME_128K = (1152 / 44_100) * 1000;
export const BYTES_POR_FRAME_128K = BYTES_FRAME_128K;
