/** NOD-346: as contas puras da foto (sem DOM), para os testes do servidor também importarem. */
export function base64DoDataUrl(url: string): string | null {
  const m = /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  return m?.[1] ?? null;
}

/** Bytes que um base64 representa (sem decodificar). */
export function bytesDoBase64(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}
