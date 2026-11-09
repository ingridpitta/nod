import type { PuxadaDeContas } from "../src/contracts/contas-ia.ts";
import type { OpcoesRemover } from "../src/contracts/remover-computador.ts";

/**
 * O que a tela pede ao app do Mac sobre as contas (definido em 2026-10-13, ADR-102): "Sair do Mac" de uma conta e
 * "Desconectar o Mac" com "sair das contas". O login pela tela é só da VM (no Mac a pessoa entra pela ponte do app, com o
 * navegador daqui), então os `logins` da puxada são ignorados. Sem Electron: o main.ts injeta a ponte e as ações.
 */
export const INTERVALO_CONTAS_NO_MAC_MS = 3_000;
/** Revisão do PR #306: tentativas de logout por conta antes de confirmar a saída mesmo assim (com aviso no log). */
export const TENTATIVAS_DE_SAIR_NO_MAC = 3;

export type DepsContasNoServidor = {
  ponte: {
    puxar(): Promise<PuxadaDeContas | null | "sem_rota">;
    saiu(impressoes: string[], desconectada: boolean): Promise<boolean>;
  };
  /** Sai da conta neste Mac (logout com a variável dela e, fora a de sempre, a pasta sai). false = não estava aqui. */
  sair(impressao: string): Promise<boolean>;
  /** As impressões de todas as contas logadas aqui (o "sair das contas" do desconectar). */
  todas(): string[];
  /**
   * O Mac foi desconectado pela tela: a conexão para e a tela de conectar volta. ADA-245: `remover` = foi removido por
   * outro lugar (outra tela, o chat) e a limpeza deste Mac (remover-daqui.ts) roda junto.
   */
  desconectar(remover?: OpcoesRemover): Promise<void>;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  registrar?(evento: string, campos: Record<string, string>): void;
};

export function iniciarContasNoServidor(d: DepsContasNoServidor): { parar(): void } {
  let parado = false;
  let timer: { cancelar(): void } | null = null;
  const tentativas = new Map<string, number>();

  async function sairDe(impressoes: readonly string[]): Promise<string[]> {
    const feitas: string[] = [];
    for (const i of impressoes) {
      // Sem a conta aqui (false), a saída é confirmada: o servidor só apaga o vínculo. Se o logout falhou (exceção), não:
      // a saída fica pendente e o servidor pede de novo na próxima puxada (revisão do PR #306).
      const saiu = await d.sair(i).then(() => true, (e: unknown) => { d.registrar?.("conta_sair_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); return false; });
      const n = (tentativas.get(i) ?? 0) + 1;
      if (saiu || n >= TENTATIVAS_DE_SAIR_NO_MAC) {
        if (!saiu) d.registrar?.("conta_sair_desistiu", { tentativas: String(n) });
        tentativas.delete(i);
        feitas.push(i);
      } else tentativas.set(i, n);
    }
    return feitas;
  }

  async function volta(): Promise<void> {
    if (parado) return;
    const r = await d.ponte.puxar().catch(() => null);
    if (parado) return;
    if (r === "sem_rota") return; // servidor sem contas (modo local ou antigo): nada a puxar
    if (r) {
      // ADA-245: removido com "Continuar ligado": as contas ficam (sem logout), como no motor (motor/contas.ts). Vem sem
      // `desconectar` (revisão do PR #694, desconectarNaPuxada): o app antigo ignoraria `remover` e sairia das contas.
      if (r.remover?.manterConexao) {
        await d.ponte.saiu([], true);
        parado = true;
        await d.desconectar(r.remover);
        return;
      }
      if (r.desconectar) {
        const todas = d.todas();
        const feitas = await sairDe(todas);
        // Logout pendente: confirma o que saiu e tenta de novo na próxima puxada (a chave vence em 2 min de todo jeito).
        if (feitas.length < todas.length) {
          await d.ponte.saiu(feitas, false);
          if (!parado) timer = d.agendar(() => void volta(), INTERVALO_CONTAS_NO_MAC_MS);
          return;
        }
        await d.ponte.saiu(feitas, true);
        parado = true;
        await d.desconectar(r.remover);
        return;
      }
      if (r.sair.length > 0) await d.ponte.saiu(await sairDe(r.sair), false);
    }
    if (!parado) timer = d.agendar(() => void volta(), INTERVALO_CONTAS_NO_MAC_MS);
  }

  timer = d.agendar(() => void volta(), 0);
  return {
    parar() {
      parado = true;
      timer?.cancelar();
    },
  };
}
