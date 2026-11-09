import { base64DoDataUrl, bytesDoBase64 } from "./foto-base64.ts";

/**
 * NOD-346: a foto do perfil sai do navegador já pequena — no máximo 512 px no lado maior, em JPEG, e abaixo de 256 KB
 * (FOTO_MAX_BYTES do domínio). A qualidade desce até caber. Devolve o base64 puro (sem o prefixo `data:`), ou null quando
 * o arquivo não é uma imagem que o navegador consiga ler.
 */

const LADO_MAX = 512;
const LIMITE_BYTES = 256 * 1024;

export async function reduzirFoto(arquivo: Blob): Promise<string | null> {
  if (!/^image\/(png|jpeg)$/.test(arquivo.type)) return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    return null;
  }
  const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // JPEG não tem transparência: o PNG transparente ganha fundo branco em vez de preto.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const q of [0.86, 0.75, 0.6, 0.45]) {
    const b64 = base64DoDataUrl(canvas.toDataURL("image/jpeg", q));
    if (b64 && bytesDoBase64(b64) <= LIMITE_BYTES) return b64;
  }
  return null;
}
