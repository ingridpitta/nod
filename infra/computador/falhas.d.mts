export const CODIGOS_RUNTIME: readonly string[];
export function primeiraLinha(texto: unknown): string | null;
export function codigoDaAcao(erro: unknown): "tela_alterada" | "acao_falhou";
export function codigoDaSubida(erro: unknown): string;
export function falhaDe(codigo: string, erro: unknown): Error & { codigo: string };
export const TRAVAS_DO_PERFIL: readonly string[];
export const PRAZO_NAVEGADOR_MS: number;
