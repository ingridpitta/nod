import type { RotaNaCatraca } from "../../domain/acoes/paridade.ts";
import type { Db } from "../../shared/types.ts";
import { comporApp } from "./compor.ts";
import type { Rota } from "./roteador.ts";

/**
 * As rotas do app composto, como a catraca de paridade as enxerga (NOD-391, ADR-135 §5). Compõe o app nos dois modos
 * (local e compartilhado) com todas as famílias opcionais ligadas — contas, nuvem, computadores —, para nenhuma rota de
 * pessoa ficar de fora por uma flag desligada. Só lista: não sobe servidor nem laço de fundo, e fecha o que abriu.
 */
const ENV_COMPLETO = {
  NOD_EXECUTOR: "catcher",
  NOD_LOGIN: "stub",
  NOD_SESSAO_SEGREDO: "segredo-da-catraca-de-paridade-0000000000",
  NOD_CREDENTIAL_KEY: "0".repeat(63) + "2",
  NOD_MAQUINA_NUVEM: "gcp",
  NOD_CONTAS: "1",
  NOD_MINHA_CONTA: "1",
  NOD_COMPUTADORES: "docker",
  NOD_LIMPEZA_TASKS: "desligada",
  NOD_VOZ_STT: "falso",
  NOD_VOZ_TTS: "falso",
} as const;

export function paraACatraca(r: Rota): RotaNaCatraca {
  const pessoa = !r.publica && !r.interno && !r.maquina;
  return { metodo: r.metodo, padrao: r.padrao.source, pessoa, ...(r.acao ? { acao: r.acao } : {}) };
}

export async function rotasDaParidade(db: Db, envBase: Record<string, string | undefined> = {}): Promise<RotaNaCatraca[]> {
  const todas: RotaNaCatraca[] = [];
  for (const modo of [{}, { NOD_MODO: "compartilhado" }]) {
    const app = comporApp({ db, env: { ...envBase, ...ENV_COMPLETO, ...modo }, listarPessoas: async () => [] });
    try {
      todas.push(...app.rotas.map(paraACatraca), ...(app.contas?.rotas ?? []).map(paraACatraca));
    } finally {
      await app.fechar();
    }
  }
  return todas;
}
