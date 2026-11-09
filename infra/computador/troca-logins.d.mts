// NOD-365: tipos de troca-logins.mjs. A loja de logins muda de máquina só cifrada.
import type { Buffer } from "node:buffer";

export const PARTE_BYTES: number;
export const TETO_LOJA_BYTES: number;
export const VALIDADE_IMPORTACAO_MS: number;
export const PRAZO_SAIDA_MS: number;
export const MARCA_SAIDA: string;
export const VERSAO_PACOTE: number;
export function nomeValido(n: unknown): boolean;
export function empacotar(logins: string, teto?: number): Promise<Buffer>;
export function partir(pacote: Buffer, tamanho?: number): string[];
export function desempacotar(pacote: Buffer): Array<{ nome: string; dados: Buffer }>;
export function gravarLoja(logins: string, arquivos: Array<{ nome: string; dados: Buffer }>): Promise<void>;
export function recuperar(logins: string): Promise<void>;
export function marcarSaida(pasta: string, agora: number): Promise<void>;
export function desmarcarSaida(pasta: string): Promise<void>;
export function saiuEm(pasta: string): Promise<number | null>;
export function venceu(desde: number | null, agora: number): boolean;
