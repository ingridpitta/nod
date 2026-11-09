import { log } from "../../obs/log.ts";
import type { Db } from "../../shared/types.ts";
import type { ServicoMinhaConta } from "../../use-cases/minha-conta.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-10-23 (NOD-346): uma volta por minuto — a exportação pedida fica pronta em até ~1 min. */
export const INTERVALO_MINHA_CONTA_MS = 60_000;

/**
 * Uma volta: cada pessoa prepara a exportação pedida e apaga as vencidas (paraCadaPessoa: uma que falha não impede as
 * outras); depois, com NOD_PURGA_CONTA, as exclusões que passaram dos 30 dias viram purga (cada uma na sua transação).
 */
export async function voltaMinhaConta(db: Db, servico: Pick<ServicoMinhaConta, "prepararExportacoes" | "purgarVencidas">, opcoes: OpcoesLaco = {}): Promise<{ exportacoes: number; purgadas: number }> {
  let exportacoes = 0;
  await paraCadaPessoa(db, async (escopo) => { exportacoes += await servico.prepararExportacoes(escopo); }, opcoes);
  const purgadas = await servico.purgarVencidas();
  return { exportacoes, purgadas };
}

export function iniciarLacoMinhaConta(p: { db: Db; servico: Pick<ServicoMinhaConta, "prepararExportacoes" | "purgarVencidas">; intervaloMs?: number; opcoes?: OpcoesLaco }): { parar(): Promise<void> } {
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await voltaMinhaConta(p.db, p.servico, p.opcoes);
    } catch (e) {
      log("erro", "laco_minha_conta_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      rodando = false;
    }
  };
  const timer = setInterval(() => {
    if (rodando) return;
    emVoo = tick().finally(() => {
      emVoo = null;
    });
  }, p.intervaloMs ?? INTERVALO_MINHA_CONTA_MS);
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
