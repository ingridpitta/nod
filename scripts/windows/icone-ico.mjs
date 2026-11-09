// ADA-226: o .ico do instalador do Windows a partir do icon.png do desktop, sem dependência nova.
// Lê PNG RGBA 8 bits sem entrelaçamento (o icon.png é assim), reduz por média de área e grava um .ico com as
// imagens em PNG (Windows Vista em diante e o makensis aceitam).
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const TAMANHOS_DO_ICONE = [16, 24, 32, 48, 64, 128, 256];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decodifica um PNG RGBA de 8 bits (tipo de cor 6, sem entrelaçamento). */
export function lerPngRgba(buf) {
  if (!buf.subarray(0, 8).equals(ASSINATURA)) throw new Error("icone: não é PNG");
  let largura = 0;
  let altura = 0;
  const idat = [];
  for (let i = 8; i < buf.length; ) {
    const tamanho = buf.readUInt32BE(i);
    const tipo = buf.toString("latin1", i + 4, i + 8);
    const dados = buf.subarray(i + 8, i + 8 + tamanho);
    if (tipo === "IHDR") {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      if (dados[8] !== 8 || dados[9] !== 6 || dados[12] !== 0) throw new Error("icone: só PNG RGBA 8 bits sem entrelaçamento");
    } else if (tipo === "IDAT") idat.push(dados);
    else if (tipo === "IEND") break;
    i += 12 + tamanho;
  }
  if (!largura || !altura) throw new Error("icone: PNG sem IHDR");
  const cru = inflateSync(Buffer.concat(idat));
  const linha = largura * 4;
  const px = Buffer.alloc(linha * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (linha + 1)];
    const ori = y * (linha + 1) + 1;
    for (let x = 0; x < linha; x++) {
      const v = cru[ori + x];
      const a = x >= 4 ? px[y * linha + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * linha + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * linha + x - 4] : 0;
      const p = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filtro];
      if (p === undefined) throw new Error("icone: filtro PNG desconhecido");
      px[y * linha + x] = (v + p) & 0xff;
    }
  }
  return { largura, altura, px };
}

/** Reduz por média de área, com a cor ponderada pelo alfa (sem halo escuro na borda). */
export function reduzir(img, lado) {
  const out = Buffer.alloc(lado * lado * 4);
  const fx = img.largura / lado;
  const fy = img.altura / lado;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = Math.floor(y * fy); sy < Math.floor((y + 1) * fy); sy++) {
        for (let sx = Math.floor(x * fx); sx < Math.floor((x + 1) * fx); sx++) {
          const i = (sy * img.largura + sx) * 4;
          const al = img.px[i + 3];
          r += img.px[i] * al;
          g += img.px[i + 1] * al;
          b += img.px[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * lado + x) * 4;
      if (a > 0) {
        out[o] = Math.round(r / a);
        out[o + 1] = Math.round(g / a);
        out[o + 2] = Math.round(b / a);
      }
      out[o + 3] = Math.round(a / Math.max(n, 1));
    }
  }
  return { largura: lado, altura: lado, px: out };
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABELA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, "latin1");
  const cab = Buffer.alloc(4);
  cab.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([cab, t, dados, crc]);
}

/** Codifica RGBA em PNG (filtro 0 em toda linha). */
export function gravarPng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.largura, 0);
  ihdr.writeUInt32BE(img.altura, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const linha = img.largura * 4;
  const cru = Buffer.alloc((linha + 1) * img.altura);
  for (let y = 0; y < img.altura; y++) img.px.copy(cru, y * (linha + 1) + 1, y * linha, (y + 1) * linha);
  return Buffer.concat([ASSINATURA, bloco("IHDR", ihdr), bloco("IDAT", deflateSync(cru, { level: 9 })), bloco("IEND", Buffer.alloc(0))]);
}

/** Um .ico com uma imagem PNG por tamanho. */
export function icoDePng(png, tamanhos = TAMANHOS_DO_ICONE) {
  const img = lerPngRgba(png);
  const imagens = tamanhos.map((t) => ({ t, png: gravarPng(reduzir(img, t)) }));
  const cab = Buffer.alloc(6);
  cab.writeUInt16LE(0, 0);
  cab.writeUInt16LE(1, 2);
  cab.writeUInt16LE(imagens.length, 4);
  let deslocamento = 6 + 16 * imagens.length;
  const diretorio = imagens.map(({ t, png: p }) => {
    const e = Buffer.alloc(16);
    e[0] = t >= 256 ? 0 : t;
    e[1] = t >= 256 ? 0 : t;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += p.length;
    return e;
  });
  return Buffer.concat([cab, ...diretorio, ...imagens.map((i) => i.png)]);
}
