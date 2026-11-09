// Revisão 20 do PR #600: a captura que vai ao bot, com o dock, mostra só a janela do Chrome. O resto da tela (a faixa
// do dock com os títulos das janelas, o Terminal e os Arquivos que a pessoa deixou abertos) vira preto. PNG de 8 bits
// sem entrelaçamento (o que o scrot grava), decodificado e regravado com o zlib do Node, sem dependência nova.
import { Buffer } from 'node:buffer';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BYTES_POR_PIXEL = { 0: 1, 2: 3, 4: 2, 6: 4 };

function blocos(png) {
  if (png.length < 8 || !png.subarray(0, 8).equals(ASSINATURA)) throw new Error('png_invalido');
  const lista = [];
  for (let i = 8; i + 12 <= png.length;) {
    const tamanho = png.readUInt32BE(i);
    const tipo = png.toString('latin1', i + 4, i + 8);
    lista.push({ tipo, dados: png.subarray(i + 8, i + 8 + tamanho) });
    i += 12 + tamanho;
    if (tipo === 'IEND') break;
  }
  return lista;
}

function bloco(tipo, dados) {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(dados.length, 0);
  cab.write(tipo, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), dados])) >>> 0, 0);
  return Buffer.concat([cab, dados, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodifica um PNG de 8 bits (cinza, RGB, cinza+alfa ou RGBA) em linhas cruas. Outro formato lança `png_invalido`. */
export function decodificarPng(png) {
  const lista = blocos(png);
  const ihdr = lista.find((b) => b.tipo === 'IHDR')?.dados;
  if (!ihdr || ihdr.length < 13) throw new Error('png_invalido');
  const largura = ihdr.readUInt32BE(0), altura = ihdr.readUInt32BE(4);
  const [profundidade, cor, , , entrelacado] = [ihdr[8], ihdr[9], ihdr[10], ihdr[11], ihdr[12]];
  const bpp = BYTES_POR_PIXEL[cor];
  if (profundidade !== 8 || !bpp || entrelacado !== 0 || !largura || !altura) throw new Error('png_invalido');
  const cru = inflateSync(Buffer.concat(lista.filter((b) => b.tipo === 'IDAT').map((b) => b.dados)));
  const passo = largura * bpp;
  if (cru.length < (passo + 1) * altura) throw new Error('png_invalido');
  const pixels = Buffer.alloc(passo * altura);
  for (let y = 0; y < altura; y++) {
    const filtro = cru[y * (passo + 1)];
    const linha = cru.subarray(y * (passo + 1) + 1, (y + 1) * (passo + 1));
    const saida = pixels.subarray(y * passo, (y + 1) * passo);
    const acima = y > 0 ? pixels.subarray((y - 1) * passo, y * passo) : null;
    for (let i = 0; i < passo; i++) {
      const a = i >= bpp ? saida[i - bpp] : 0, b = acima ? acima[i] : 0, c = acima && i >= bpp ? acima[i - bpp] : 0;
      const x = linha[i];
      if (filtro === 0) saida[i] = x;
      else if (filtro === 1) saida[i] = (x + a) & 0xff;
      else if (filtro === 2) saida[i] = (x + b) & 0xff;
      else if (filtro === 3) saida[i] = (x + ((a + b) >> 1)) & 0xff;
      else if (filtro === 4) saida[i] = (x + paeth(a, b, c)) & 0xff;
      else throw new Error('png_invalido');
    }
  }
  return { largura, altura, cor, bpp, pixels };
}

/** Codifica as linhas cruas num PNG (filtro 0). */
export function codificarPng({ largura, altura, cor, bpp, pixels }) {
  const passo = largura * bpp;
  const cru = Buffer.alloc((passo + 1) * altura);
  for (let y = 0; y < altura; y++) pixels.copy(cru, y * (passo + 1) + 1, y * passo, (y + 1) * passo);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = cor;
  return Buffer.concat([ASSINATURA, bloco('IHDR', ihdr), bloco('IDAT', deflateSync(cru)), bloco('IEND', Buffer.alloc(0))]);
}

/**
 * Pinta de preto (e opaco) tudo fora do retângulo `janela` ({x, y, largura, altura} na raiz). Sem janela, a tela
 * inteira fica preta: sem saber onde está o Chrome, nada da tela vai ao bot. PNG que não lê lança `png_invalido`.
 */
export function mascararForaDaJanela(png, janela) {
  const img = decodificarPng(png);
  const { largura, altura, bpp, pixels } = img;
  const x0 = janela ? Math.max(0, janela.x) : 0, x1 = janela ? Math.min(largura, janela.x + janela.largura) : 0;
  const y0 = janela ? Math.max(0, janela.y) : 0, y1 = janela ? Math.min(altura, janela.y + janela.altura) : 0;
  const temAlfa = bpp === 2 || bpp === 4;
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      if (y >= y0 && y < y1 && x >= x0 && x < x1) continue;
      const i = (y * largura + x) * bpp;
      pixels.fill(0, i, i + bpp);
      if (temAlfa) pixels[i + bpp - 1] = 0xff;
    }
  }
  return codificarPng(img);
}
