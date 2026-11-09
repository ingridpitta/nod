export interface DadosDoStorage {
  localStorage: [string, string][];
  indexedDB: { nome: string; versao: number; lojas: unknown[] }[];
  pulados: string[];
}
export interface ItemDoStorage { origem: string; em: number; hash: string; dados: DadosDoStorage }
export interface EstadoDoStorage { geracao: number; versoes: Record<string, { em: number; hash: string }> }
export const TETO_STORAGE_BYTES: number;
export const INTERVALO_COLETA_MS: number;
export const PRAZO_COLETA_MS: number;
export function comPrazo<T, S = null>(promessa: Promise<T>, ms: number, seVencer?: S): Promise<T | S>;
export interface RitmoDeColeta { liberar(origem: string, forcar?: boolean): boolean; parar(): void }
export function ritmoDeColeta(o: { intervalo?: number; aoVencer: () => void; agora?: () => number }): RitmoDeColeta;
export function pastaDoStorage(logins: string): string;
export function arquivoDaOrigem(pasta: string, origem: string): string;
export function origemDe(url: unknown): string | null;
export function hostCasa(host: string, dominio: string): boolean;
export function origemTemLogin(origem: string, cookies: readonly Record<string, unknown>[], agora?: number): boolean;
export function hashDosDados(dados: unknown): string;
export function estadoVazio(): EstadoDoStorage;
export function decidir(estado: EstadoDoStorage, origem: string, em: number, hash: string): "gravar" | "igual" | "velho";
export function lerEstado(pasta: string, chave: Buffer): Promise<EstadoDoStorage>;
export function gravarOrigem(pasta: string, chave: Buffer, item: { origem: string; em: number; hash: string; dados: unknown }): Promise<"gravou" | "igual" | "velho" | "grande">;
export function lerTudo(pasta: string, chave: Buffer): Promise<{ geracao: number; itens: ItemDoStorage[] }>;
export function limparStorage(pasta: string, chave: Buffer): Promise<number>;
export function coletarNaPagina(): Promise<DadosDoStorage>;
export function restaurarNaPagina(a: { dados: unknown; manter?: string[] }): Promise<void>;
export function restaurarOrigem(pagina: { evaluate(f: unknown, arg?: unknown): Promise<unknown> }, dados: unknown, prazo?: number): Promise<string>;
