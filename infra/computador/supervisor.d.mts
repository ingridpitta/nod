import type { Server } from "node:net";
export const ID_VALIDO: RegExp;
export const TIPOS: readonly string[];
export const TIPOS_DA_TELA: readonly string[];
export const TIPOS_QUE_FIXAM: readonly string[];
export const VARREDURA_MS: number;
export const MARCA_TROCA_EM_CURSO: string;
export const PRAZO_ABRIR_TELA_MS: number;
export const PRAZO_ACAO_MS: number;
export const PRAZO_FECHAR_TELA_MS: number;
export const PRAZO_LIMPAR_STORAGE_MS: number;
export const PRAZO_VIVO_MS: number;
export const TOQUE_VIVO_MS: number;
export const BATIMENTO_MS: number;
export const DISPLAY_BASE: number;
export function memoriaDaArvore(pid: number | undefined): number | null;
export function binariosDoAmbiente(env?: Record<string, string | undefined>): Record<string, string | null>;
export function chromiumDoPlaywright(env?: Record<string, string | undefined>): string;
export function destinoDoResolv(arquivo?: string): string;
export type Supervisor = {
  tratar(cmd: unknown): Promise<{ id: string; desfecho: "ok" | "falhou" | "esperando_tela"; motivo?: string; quem?: string[]; resultado?: Record<string, unknown>; progresso?: { pct: number; etapa: string }; supervisorPub?: string; logins?: { parte: number; total: number; dados: string } }>;
  carregar(): Promise<void>;
  /** NOD-365: apaga as pastas que saíram desta máquina há 30 dias ou mais; devolve os ids apagados. */
  varrer(): Promise<string[]>;
  estados(): Array<{ computadorId: string; ligado: boolean; supervisorPub: string; ligadoDesde: number | null; memoriaTotalMb: number; operacao: { tipo: string; pct: number; etapa: string } | null; telas: Array<{ agenteId: string; estado: string; ultimaAcaoEm: number | null; titulo: string | null; memoriaMb: number | null }> }>;
  ouvir(f: (m: unknown) => void): () => void;
  /** NOD-95: a pessoa está ao vivo na tela; conta como ação dela. */
  tocarTela(computadorId: string, agenteId: string): void;
  assentar(): Promise<void>;
  encerrar(): Promise<void>;
};
export function criarSupervisor(op: {
  raiz?: string; run?: string; terminal?: string; resolv?: string | null; x11?: string; bin?: Record<string, string | null>; sandbox?: boolean; xvfbArgs?: string[];
  /** O tela.mjs a rodar (padrão: NOD_PC_TELA ou o do lado do supervisor). */
  tela?: string; ambienteTela?: Record<string, string>; leitura?: () => { memoria: unknown; processador: unknown }; agora?: () => number; log?: (m: string) => void; batimentoMs?: number; varreduraMs?: number;
  /** Chamado logo depois do `ok` do Atualizar: no serviço, sai para o systemd subir de novo com os arquivos novos. */
  aoAtualizar?: () => void;
  /** NOD-433: gancho do teste; segura o fecharTela depois do `fechada` da tela, antes do recolhimento. */
  antesDeRecolher?: (agenteId: string) => Promise<void>;
}): Supervisor;
export function servirControle(s: Supervisor): Server;
export function escutarControle(servidor: Server, caminho: string): Promise<void>;
export function mandarAoFilho(proc: { connected?: boolean; send(m: unknown, cb?: (e: Error | null) => void): unknown } | null | undefined, mensagem: unknown, aoFalhar?: (e: unknown) => void): boolean;
