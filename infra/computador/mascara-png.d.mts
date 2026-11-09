type ImagemCrua = { largura: number; altura: number; cor: number; bpp: number; pixels: Buffer };
export function decodificarPng(png: Buffer): ImagemCrua;
export function codificarPng(img: ImagemCrua): Buffer;
export function mascararForaDaJanela(png: Buffer, janela: { x: number; y: number; largura: number; altura: number } | null): Buffer;
