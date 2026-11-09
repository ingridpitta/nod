import { LIMITE_POR_FAMILIA, MIME_PDF, MIME_ZIP, MIMES_AUDIO, MIMES_IMAGEM, MIMES_MIDIA_DO_BOT, MIMES_VIDEO, type ExibicaoMidia, type FamiliaMidia, type MimeMidia, type MotivoRecusaMidia } from "../contracts/anexo.ts";
import { duracaoMs } from "./duracao-audio.ts";

/**
 * Mídia que o bot gera (definido em 2026-10-23, NOD-323, ADR-126). Puro: bytes entram, tipo e medidas saem. O tipo vem
 * dos MAGIC BYTES, nunca da extensão — um `.png` que é zip vira cartão de zip; bytes que não reconhece são recusados.
 * SVG e HTML não estão na lista (executam script no navegador). O proxy decide com isto e o servidor confere de novo.
 */

export function ehMimeMidia(mime: string): mime is MimeMidia {
  return (MIMES_MIDIA_DO_BOT as readonly string[]).includes(mime);
}

export function familiaDaMidia(mime: string): FamiliaMidia | null {
  if (mime === "image/gif") return "gif";
  if ((MIMES_IMAGEM as readonly string[]).includes(mime)) return "imagem";
  if ((MIMES_VIDEO as readonly string[]).includes(mime)) return "video";
  if ((MIMES_AUDIO as readonly string[]).includes(mime)) return "audio";
  if (mime === MIME_PDF) return "pdf";
  if (mime === MIME_ZIP) return "zip";
  return null;
}

export function exibicaoDe(familia: FamiliaMidia, semBytes: boolean): ExibicaoMidia {
  if (semBytes) return "cartao_grande";
  return familia === "pdf" || familia === "zip" ? "cartao" : "midia";
}

const ascii = (b: Uint8Array, i: number, s: string): boolean => {
  if (i < 0 || i + s.length > b.length) return false;
  for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false;
  return true;
};
const be16 = (b: Uint8Array, i: number): number => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const be32 = (b: Uint8Array, i: number): number => (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
const le16 = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const le24 = (b: Uint8Array, i: number): number => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);

const MARCAS_MP4 = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4VH", "M4VP", "dash", "3gp4", "3gp5", "3gp6"]);

/** O mime pelos primeiros bytes (basta o cabeçalho, 64 KiB), ou null quando não é um tipo que o chat mostra. */
export function farejarMidia(b: Uint8Array): MimeMidia | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n")) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a")) return "image/gif";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) return "image/webp";
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) return "audio/wav";
  if (ascii(b, 0, "%PDF-")) return "application/pdf";
  if (ascii(b, 0, "PK\x03\x04") || ascii(b, 0, "PK\x05\x06")) return "application/zip";
  if (ascii(b, 4, "ftyp")) {
    // Revisão 3 do #507 (M6): só as marcas de vídeo/áudio MP4 conhecidas — HEIC, AVIF e outros ISO-BMFF ficam de fora.
    const marca = String.fromCharCode(...b.subarray(8, 12));
    if (marca === "qt  ") return "video/quicktime";
    if (marca === "M4A " || marca === "M4B " || marca === "M4P ") return "audio/mp4";
    return MARCAS_MP4.has(marca) ? "video/mp4" : null;
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(b, 0, "OggS")) return "audio/ogg";
  // ID3v2 de verdade (QA 2 do #507): versão 2 a 4, revisão não 0xFF e o tamanho em syncsafe (cada byte < 0x80).
  if (ascii(b, 0, "ID3") && b.length >= 10 && (b[3] === 2 || b[3] === 3 || b[3] === 4) && b[4] !== 0xff
    && [6, 7, 8, 9].every((i) => (b[i] ?? 0xff) < 0x80)) return "audio/mpeg";
  // Quadro MPEG de áudio sem ID3: sincronia de 11 bits, versão e camada válidas, bitrate e taxa não reservados.
  if (b.length >= 4 && b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0 && ((b[1] ?? 0) & 0x18) !== 0x08 && ((b[1] ?? 0) & 0x06) !== 0
    && ((b[2] ?? 0) & 0xf0) !== 0xf0 && ((b[2] ?? 0) & 0x0c) !== 0x0c) return "audio/mpeg";
  return null;
}

export type Medidas = { largura?: number; altura?: number; duracaoMs?: number };

const valida = (n: number): number | undefined => (Number.isInteger(n) && n >= 1 && n <= 100000 ? n : undefined);
const par = (largura: number, altura: number): Medidas => {
  const l = valida(largura);
  const a = valida(altura);
  return l && a ? { largura: l, altura: a } : {};
};

function dimensoesJpeg(b: Uint8Array): Medidas {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return {};
    const m = b[i + 1] ?? 0;
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return par(be16(b, i + 7), be16(b, i + 5));
    const tam = be16(b, i + 2);
    if (tam < 2) return {};
    i += 2 + tam;
  }
  return {};
}

function dimensoesWebp(b: Uint8Array): Medidas {
  if (ascii(b, 12, "VP8 ")) return par(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff);
  if (ascii(b, 12, "VP8L")) {
    const b1 = b[21] ?? 0, b2 = b[22] ?? 0, b3 = b[23] ?? 0, b4 = b[24] ?? 0;
    return par(1 + (((b2 & 0x3f) << 8) | b1), 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)));
  }
  if (ascii(b, 12, "VP8X")) return par(1 + le24(b, 24), 1 + le24(b, 27));
  return {};
}

/** Largura e altura do vídeo pelo `tkhd` da primeira trilha com imagem (ponto fixo 16.16). Procura a caixa pelo nome. */
function dimensoesMp4(b: Uint8Array): Medidas {
  for (let i = 4; i + 4 < b.length; i++) {
    if (!ascii(b, i, "tkhd")) continue;
    const v = b[i + 4];
    const base = i + 8 + (v === 1 ? 32 : 20) + 52;
    if (base + 8 > b.length) return {};
    const m = par(Math.round(be32(b, base) / 65536), Math.round(be32(b, base + 4) / 65536));
    if (m.largura) return m;
  }
  return {};
}

/** As medidas que a prévia usa para reservar o espaço certo (sem pulo de layout). Sem certeza, sem a medida. */
export function medidasDe(mime: MimeMidia, b: Uint8Array): Medidas {
  switch (mime) {
    case "image/png": return ascii(b, 12, "IHDR") ? par(be32(b, 16), be32(b, 20)) : {};
    case "image/gif": return par(le16(b, 6), le16(b, 8));
    case "image/jpeg": return dimensoesJpeg(b);
    case "image/webp": return dimensoesWebp(b);
    case "video/mp4": case "video/quicktime": {
      const d = duracaoMs(b, "audio/mp4");
      return { ...dimensoesMp4(b), ...(d !== null ? { duracaoMs: d } : {}) };
    }
    case "audio/mpeg": case "audio/mp4": case "audio/wav": case "audio/ogg": {
      const d = duracaoMs(b, mime);
      return d !== null ? { duracaoMs: d } : {};
    }
    default: return {};
  }
}

export type Classificacao = { mime: MimeMidia; familia: FamiliaMidia; semBytes: boolean };

/** O tipo pelos bytes e se cabe no limite da família; null = tipo que o chat não mostra. */
export function classificar(cabeca: Uint8Array, tamanho: number): Classificacao | null {
  const mime = farejarMidia(cabeca);
  const familia = mime ? familiaDaMidia(mime) : null;
  if (!mime || !familia) return null;
  return { mime, familia, semBytes: tamanho > LIMITE_POR_FAMILIA[familia] };
}

/**
 * A dica que o modelo segue para cada recusa (texto fixo por código: nunca o erro do sistema, que pode ter caminho).
 * O modelo repete à pessoa o que faltou ("anexei 2; 1 não deu porque…").
 */
export const DICA_RECUSA: Record<MotivoRecusaMidia, string> = {
  fora_da_pasta: "O arquivo fica fora da sua pasta (~/nod/<sua pasta>). Copie-o para dentro dela e anexe de novo.",
  credencial: "É um arquivo de credencial (chaves, tokens): o nod nunca o mostra no chat. Não tente de novo.",
  nao_existe: "O arquivo não existe nesse caminho. Confira o nome com ls e anexe de novo.",
  nao_e_arquivo: "O caminho é uma pasta ou um arquivo especial. Anexe arquivos, um por caminho.",
  tipo_nao_suportado: "O conteúdo não é imagem, gif, vídeo, áudio, pdf nem zip (SVG e HTML não entram). Converta (por exemplo para PNG ou PDF) ou diga à pessoa onde o arquivo está.",
  vazio: "O arquivo está vazio. Gere-o de novo antes de anexar.",
  falha_envio: "O envio ao nod falhou. Tente anexar de novo uma vez; se falhar de novo, diga à pessoa onde o arquivo está.",
  limite_por_turno: "Passou do limite de mídias por turno. Anexe só as mais importantes.",
};

/** A linha discreta abaixo da fala (j5-6), por código. Sem caminho: o chat não mostra caminho da máquina. */
export const TEXTO_RECUSA: Record<MotivoRecusaMidia, string> = {
  fora_da_pasta: "fica fora da pasta do bot",
  credencial: "é um arquivo de credencial",
  nao_existe: "não foi encontrado",
  nao_e_arquivo: "não é um arquivo",
  tipo_nao_suportado: "é de um tipo que o chat não mostra",
  vazio: "está vazio",
  falha_envio: "não chegou ao nod",
  limite_por_turno: "passou do limite por resposta",
};

/**
 * O caminho que o servidor aceita guardar (relativo a `~/nod`, começando pela pasta do bot): nada absoluto, sem `..`,
 * sem `~`, sem barra invertida nem controle, até 1024. É só para o app do Mac achar o arquivo; quem abre confere de novo.
 */
/**
 * QA 2 do #507: pasta ou arquivo oculto (`.git/`, `.env.png`, `.oculta/x.png`) e o que tem cara de env (`png.env`,
 * `x.env.local`) nunca vão para o chat — a mídia do bot é o que ele gerou à vista, não configuração.
 */
export function segmentoOculto(segmento: string): boolean {
  return segmento.startsWith(".") || /(^|\.)env(\.|$)/i.test(segmento);
}

export function caminhoRelativoSeguro(caminho: string, pastaDoBot: string): boolean {
  if (caminho.length < 1 || caminho.length > 1024) return false;
  if ([...caminho].some((c) => c.charCodeAt(0) < 0x20 || c === "\\") || caminho.startsWith("/") || caminho.startsWith("~")) return false;
  const partes = caminho.split("/");
  if (partes.some((p) => p === ".." || p === "." || p === "")) return false;
  if (partes.some(segmentoOculto)) return false;
  const raiz = pastaDoBot.split("/")[0];
  return !!raiz && partes[0] === raiz && partes.length >= 2;
}

/** Um link local da fala final (J6): `![alt](caminho)` ou `[texto](caminho)` apontando para a máquina, fora de código. */
export type LinkLocal = { inicio: number; fim: number; imagem: boolean; texto: string; caminho: string };

const NAO_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;
/**
 * Revisão do #507 (M2): o `[texto](caminho)` sem `!` só é pedido de anexo quando aponta para mídia (imagem, vídeo, áudio) ou entregável (pdf, zip).
 * Fala de bot de código é cheia de `[laco.ts](src/x.ts)`, `[README](docs/a.md)`: esses ficam como estão, sem recusa.
 */
const EXT_DE_MIDIA = /\.(?:png|jpe?g|gif|webp|mp4|m4v|mov|webm|mp3|m4a|wav|ogg|oga|pdf|zip)$/i;

/** Os trechos de código (cercas ``` / ~~~ e `inline`), onde um link é exemplo e não pedido de anexo. */
function trechosDeCodigo(texto: string): [number, number][] {
  const trechos: [number, number][] = [];
  const cerca = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$)/gm;
  for (const m of texto.matchAll(cerca)) trechos.push([m.index, m.index + m[0].length]);
  const dentroDeCerca = (i: number) => trechos.some(([a, b]) => i >= a && i < b);
  for (const m of texto.matchAll(/(`+)[^`\n]+?\1/g)) if (!dentroDeCerca(m.index)) trechos.push([m.index, m.index + m[0].length]);
  return trechos;
}

export function linksLocais(texto: string): LinkLocal[] {
  const codigo = trechosDeCodigo(texto);
  const emCodigo = (i: number) => codigo.some(([a, b]) => i >= a && i < b);
  const saida: LinkLocal[] = [];
  const re = /(!?)\[([^\]\n]{0,300})\]\(\s*(<[^>\n]+>|[^\s()]+)(?:\s+"[^"\n]*")?\s*\)/g;
  for (const m of texto.matchAll(re)) {
    if (emCodigo(m.index)) continue;
    const bruto = m[3] ?? "";
    const caminho = bruto.startsWith("<") ? bruto.slice(1, -1).trim() : bruto;
    if (!caminho || NAO_LOCAL.test(caminho)) continue;
    let decodificado = caminho;
    try { decodificado = decodeURI(caminho); } catch { /* fica o que veio */ }
    if (m[1] !== "!" && !EXT_DE_MIDIA.test(decodificado)) continue;
    saida.push({ inicio: m.index, fim: m.index + m[0].length, imagem: m[1] === "!", texto: m[2] ?? "", caminho: decodificado });
  }
  return saida;
}

/**
 * Reescreve a fala com os links que viraram anexo (J6): `![alt](caminho)` anexado SAI do texto (a mídia aparece abaixo);
 * `[texto](caminho)` anexado vira `[texto](nod-anexo:<id>)`, que a web abre na tela cheia. O que não anexou: a imagem
 * vira só o alt (o caminho da máquina não aparece no chat) e o link fica como estava.
 */
export function reescreverLinks(texto: string, links: readonly LinkLocal[], idDe: (caminho: string) => string | null): string {
  // Revisão 3 do #507 (M4): só a linha da imagem que saiu é arrumada — o resto (bloco de código, espaços de propósito)
  // fica byte a byte. A imagem anexada some; se a linha dela ficou vazia, a linha sai, sem deixar duas em branco.
  const SAIU = "\u0000";
  let saida = "";
  let ultimo = 0;
  let saiuAlgo = false;
  for (const l of [...links].sort((a, b) => a.inicio - b.inicio)) {
    if (l.inicio < ultimo) continue;
    saida += texto.slice(ultimo, l.inicio);
    const id = idDe(l.caminho);
    if (l.imagem && id) { saida += SAIU; saiuAlgo = true; }
    else if (l.imagem) saida += l.texto;
    else saida += id ? `[${l.texto}](nod-anexo:${id})` : texto.slice(l.inicio, l.fim);
    ultimo = l.fim;
  }
  if (ultimo === 0) return texto;
  saida += texto.slice(ultimo);
  if (!saiuAlgo || texto.includes(SAIU)) return saida.split(SAIU).join("");
  const linhas = saida.split("\n");
  const fora: string[] = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i] ?? "";
    if (!linha.includes(SAIU)) { fora.push(linha); continue; }
    const limpa = linha.split(SAIU).join("").replace(/[ \t]+$/, "");
    if (limpa.trim() !== "") { fora.push(limpa); continue; }
    // A linha só tinha a imagem: sai; e, entre duas em branco, uma delas também.
    if ((fora.at(-1) ?? "") === "" && (linhas[i + 1] ?? "").trim() === "" && i + 1 < linhas.length) i++;
  }
  return fora.join("\n").replace(/^\n+|\n+$/g, "");
}

/** `nod-anexo:<uuid>` — o link que a J6 escreve e a web desenha. */
export const LINK_ANEXO = /^nod-anexo:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
