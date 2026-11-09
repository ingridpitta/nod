// NOD-97 PR 5: tipos de login-senhas.mjs. As senhas salvas do Chrome em comum entre as telas; o valor cifrado nunca é
// decifrado aqui (viaja como base64).

/** Uma linha da tabela `logins` do Chrome, sem o id; o BLOB cifrado vira `{ b64 }`. */
export type LinhaDeSenha = Record<string, string | number | null | { b64: string } | { big: string }>;
export type ObjetoDoEsquema = { type: string; name: string; sql: string };
export type ParMeta = { key: string; value: string | null };
export type LoginDataLido = { esquema: ObjetoDoEsquema[]; meta: ParMeta[]; linhas: LinhaDeSenha[] };
export type LojaDeSenhas = {
  versao: number;
  em: number;
  esquema: ObjetoDoEsquema[];
  meta: ParMeta[];
  linhas: Record<string, { l: LinhaDeSenha; em: number }>;
};

export function arquivoDasSenhas(logins: string): string;
export function loginDataDo(perfil: string): string;
export const CHAVE_DA_SENHA: readonly string[];
export function senhasVazias(): LojaDeSenhas;
export function chaveDaLinha(l: LinhaDeSenha): string;
export function instanteDaLinha(l: LinhaDeSenha): number;
export function realmDe(url: string): string | null;
export function lerLoginData(arquivo: string): LoginDataLido;
export function exportarDoPerfil(perfil: string, tmpDir: string): Promise<LoginDataLido | null>;
export function fundirSenhas(loja: LojaDeSenhas, lido: Partial<LoginDataLido>, agora: number): boolean;
export function recolherSenhas(arquivoLoja: string, chave: Buffer, perfil: string, tmpDir: string, agora?: number, marcas?: Map<string, string | null> | null): Promise<"gravou" | "igual" | "parado" | "sem_dados">;
export function lerSenhas(arquivoLoja: string, chave: Buffer): Promise<LojaDeSenhas>;
export function importarNoPerfil(perfil: string, loja: LojaDeSenhas): number;
export function esquecerSenhas(arquivoLoja: string, perfis: string[]): Promise<void>;
