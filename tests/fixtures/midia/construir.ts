/** Arquivos mínimos de cada formato de mídia (NOD-323): só o cabeçalho que o farejador e as medidas leem. */
const txt = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
export const concat = (...partes: Uint8Array[]): Uint8Array => {
  const saida = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { saida.set(p, i); i += p.length; }
  return saida;
};
const be32 = (n: number) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const be16 = (n: number) => Uint8Array.from([(n >>> 8) & 255, n & 255]);
const le16 = (n: number) => Uint8Array.from([n & 255, (n >>> 8) & 255]);
const le24 = (n: number) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const caixa = (tipo: string, ...conteudo: Uint8Array[]) => { const c = concat(...conteudo); return concat(be32(8 + c.length), txt(tipo), c); };

export function png(w: number, h: number): Uint8Array {
  return concat(Uint8Array.from([0x89]), txt("PNG\r\n\x1a\n"), be32(13), txt("IHDR"), be32(w), be32(h), Uint8Array.from([8, 6, 0, 0, 0]), new Uint8Array(40));
}
export function jpeg(w: number, h: number): Uint8Array {
  const app0 = concat(Uint8Array.from([0xff, 0xe0]), be16(16), txt("JFIF\0"), new Uint8Array(9));
  const sof = concat(Uint8Array.from([0xff, 0xc2]), be16(17), Uint8Array.from([8]), be16(h), be16(w), new Uint8Array(10));
  return concat(Uint8Array.from([0xff, 0xd8]), app0, sof, Uint8Array.from([0xff, 0xd9]));
}
export function gif(w: number, h: number): Uint8Array {
  return concat(txt("GIF89a"), le16(w), le16(h), new Uint8Array(20));
}
export function webp(w: number, h: number, tipo: "VP8X" | "VP8L" | "VP8 " = "VP8X"): Uint8Array {
  const cab = (t: string, c: Uint8Array) => concat(txt("RIFF"), le32(4 + 8 + c.length), txt("WEBP"), txt(t), le32(c.length), c);
  if (tipo === "VP8X") return cab("VP8X", concat(new Uint8Array(4), le24(w - 1), le24(h - 1)));
  if (tipo === "VP8 ") return cab("VP8 ", concat(new Uint8Array(3), Uint8Array.from([0x9d, 0x01, 0x2a]), le16(w), le16(h), new Uint8Array(4)));
  const bits = (w - 1) | ((h - 1) << 14);
  return cab("VP8L", concat(Uint8Array.from([0x2f]), le32(bits)));
}
/** mp4/mov com `mvhd` (duração) e uma `tkhd` de vídeo w×h. */
export function mp4(w: number, h: number, ms: number, marca = "isom"): Uint8Array {
  const timescale = 1000;
  const mvhd = caixa("mvhd", Uint8Array.from([0, 0, 0, 0]), be32(0), be32(0), be32(timescale), be32(ms), new Uint8Array(80));
  const tkhd = caixa("tkhd", Uint8Array.from([0, 0, 0, 3]), new Uint8Array(20), new Uint8Array(52), be32(w * 65536), be32(h * 65536));
  return concat(caixa("ftyp", txt(marca), be32(0), txt(marca)), caixa("moov", mvhd, caixa("trak", tkhd)), caixa("mdat", new Uint8Array(32)));
}
export const webm = () => concat(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), new Uint8Array(30));
export const pdf = () => txt("%PDF-1.7\n%âãÏÓ\n1 0 obj\n");
export const zip = () => concat(txt("PK\x03\x04"), new Uint8Array(30));
export const svg = () => txt('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const html = () => txt("<!doctype html><html><script>alert(1)</script>");
