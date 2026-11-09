export function lerTexto(caminho: string, inicio?: number, esperada?: string): Promise<{
  texto: { conteudo: string; inicio: number; proximo: number | null; total: number; revisao: string };
}>;
export function gravarTexto(caminho: string, texto: string, esperada: string): Promise<{ saida: string; revisao: string }>;
