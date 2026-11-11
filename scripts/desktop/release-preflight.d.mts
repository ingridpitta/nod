export const SECRETS_DE_RELEASE: readonly (readonly [variavel: string, secret: string])[];
export function validarPreflight(entrada: { env: Record<string, string | undefined>; versao: string; ref?: string }): string[];
export function relatorioPreflight(entrada: { erros: string[]; seco: boolean; actions: boolean }): { codigo: 0 | 1; saida: string; erro: string };
