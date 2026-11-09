/** A mensagem barrada volta antes do que a pessoa já começou a escrever; nenhum dos dois textos se perde. */
export function textoDepoisDaCota(enviado: string, atual: string): string {
  const a = atual.trim();
  if (!a) return enviado;
  if (a === enviado.trim()) return atual;
  return `${enviado}\n${atual}`;
}

/** Efeito inteiro do 429, injetado para a UI provar o fluxo sem DOM falso. */
export async function reagirACota(p: { enviado: string; atual: string; retirarFala(): void; repor(texto: string): void; abrirConta(): Promise<void> }): Promise<void> {
  p.retirarFala();
  p.repor(textoDepoisDaCota(p.enviado, p.atual));
  await p.abrirConta();
}
