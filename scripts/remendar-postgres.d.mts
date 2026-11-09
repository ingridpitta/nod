// Tipos de scripts/remendar-postgres.mjs (o script roda no postinstall com node puro, sem tsx).
export interface Troca {
  /** Texto que só existe depois da troca: é ele que diz "já aplicada". */
  readonly feita: string;
  readonly antes: string;
  readonly depois: string;
}
export const TROCAS: readonly Troca[];
export function remendar(arquivos?: string[]): number;
export function remendado(arquivos?: string[]): boolean;
