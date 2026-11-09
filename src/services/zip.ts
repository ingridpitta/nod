/**
 * NOD-346 (ADR-126 §4): um .zip mínimo, só "stored" (sem compressão), com CRC-32 e nomes em UTF-8. Basta para a
 * exportação dos dados (texto e uma foto já comprimida) e evita uma dependência nova. Sem ZIP64: o teto da exportação
 * (50 MB, 0110) fica muito abaixo dos 4 GB.
 */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ArquivoZip = { nome: string; dados: Uint8Array | string };

/** Data e hora no formato DOS (o zip não tem fuso; vai em UTC). */
function dataDos(ms: number): { hora: number; dia: number } {
  const d = new Date(ms);
  const ano = Math.max(1980, d.getUTCFullYear());
  return {
    hora: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    dia: ((ano - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export function montarZip(arquivos: readonly ArquivoZip[], agora: number): Uint8Array {
  const enc = new TextEncoder();
  const { hora, dia } = dataDos(agora);
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  const nomes = new Set<string>();
  for (const a of arquivos) {
    if (!a.nome || a.nome.startsWith("/") || a.nome.split("/").includes("..") || nomes.has(a.nome)) throw new Error("zip: nome inválido ou repetido");
    nomes.add(a.nome);
    const nome = enc.encode(a.nome);
    const dados = typeof a.dados === "string" ? enc.encode(a.dados) : a.dados;
    const crc = crc32(dados);
    const local = new Uint8Array(30 + nome.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true); // versão para extrair
    v.setUint16(6, 0x0800, true); // bit 11: nome em UTF-8
    v.setUint16(8, 0, true); // stored
    v.setUint16(10, hora, true);
    v.setUint16(12, dia, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, dados.length, true);
    v.setUint32(22, dados.length, true);
    v.setUint16(26, nome.length, true);
    v.setUint16(28, 0, true);
    local.set(nome, 30);

    const central = new Uint8Array(46 + nome.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, dia, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, dados.length, true);
    c.setUint32(24, dados.length, true);
    c.setUint16(28, nome.length, true);
    c.setUint32(42, deslocamento, true);
    central.set(nome, 46);

    locais.push(local, dados);
    centrais.push(central);
    deslocamento += local.length + dados.length;
  }
  const tamanhoCentral = centrais.reduce((s, b) => s + b.length, 0);
  const fim = new Uint8Array(22);
  const f = new DataView(fim.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, arquivos.length, true);
  f.setUint16(10, arquivos.length, true);
  f.setUint32(12, tamanhoCentral, true);
  f.setUint32(16, deslocamento, true);
  const saida = new Uint8Array(deslocamento + tamanhoCentral + 22);
  let p = 0;
  for (const b of [...locais, ...centrais, fim]) {
    saida.set(b, p);
    p += b.length;
  }
  return saida;
}

/** Lê um zip "stored" (o que montarZip faz): para o teste conferir o conteúdo sem dependência. */
export function lerZip(zip: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let fim = zip.length - 22;
  while (fim >= 0 && v.getUint32(fim, true) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error("zip: sem diretório central");
  const total = v.getUint16(fim + 10, true);
  let p = v.getUint32(fim + 16, true);
  const dec = new TextDecoder();
  const saida = new Map<string, Uint8Array>();
  for (let i = 0; i < total; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error("zip: entrada central inválida");
    const crc = v.getUint32(p + 16, true);
    const tam = v.getUint32(p + 20, true);
    const n = v.getUint16(p + 28, true);
    const extra = v.getUint16(p + 30, true);
    const coment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const nome = dec.decode(zip.subarray(p + 46, p + 46 + n));
    const nl = v.getUint16(local + 26, true);
    const el = v.getUint16(local + 28, true);
    const dados = zip.subarray(local + 30 + nl + el, local + 30 + nl + el + tam);
    if (crc32(dados) !== crc) throw new Error(`zip: CRC errado em ${nome}`);
    saida.set(nome, dados);
    p += 46 + n + extra + coment;
  }
  return saida;
}
