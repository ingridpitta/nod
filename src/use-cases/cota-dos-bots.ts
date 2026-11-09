import type { CotaDaIa, SituacaoDaCota } from "../contracts/cota.ts";
import type { IdHarness } from "../contracts/harness.ts";
import { cotaDasIasComContas, iasConhecidas, situacaoDaIa, situacaoDoTurno } from "../domain/cota-da-ia.ts";
import { harnessFixado } from "../domain/harness.ts";
import type { Deps } from "./tipos.ts";

/**
 * A cota da IA vista por bot, fora de uma máquina (definido em 2026-10-16, NOD-302, continuação da NOD-253): a tela de
 * Trabalhos e o `pedir_a_bot` não sabem a máquina do próximo turno, então contam como logada a conta `pronta` em qualquer
 * máquina da pessoa (a regra que `listarTrabalhos` já usava). Uma leitura só para os dois.
 */
export type EsperaDoBot = { situacao: SituacaoDaCota; ia: IdHarness | null; voltaEm: number | null };

export type CotaDosBots = {
  cota: CotaDaIa[];
  /** As IAs que a pessoa já usou ou marcou no limite (iasConhecidas): o Automático pode cair em qualquer uma. */
  conhecidas: IdHarness[];
  /** A situação do bot pela IA dele (a fixa; no Automático, a menos segurada entre as IAs conhecidas) e quando volta. */
  doBot(bot: { harness?: string | null; modelo: string }): EsperaDoBot;
};

export async function lerCotaDosBots(deps: Pick<Deps, "repos" | "agora">): Promise<CotaDosBots> {
  const [preferencias, usos, usosPorConta, lista, modo] = await Promise.all([deps.repos.preferencias.buscar(), deps.repos.usoDoPlano.listar(), deps.repos.usoDoPlano.listarPorConta(), deps.repos.contasIa.listar(), deps.repos.contasIa.modo()]);
  const naAlgumaMaquina = new Set(lista.vinculos.filter((v) => v.estado === "pronta" && v.sairPedidoEm === null).map((v) => v.contaId));
  const cota = cotaDasIasComContas({ usos, usosPorConta, limites: preferencias.iasNoLimite, contas: { contas: lista.contas, naMaquina: naAlgumaMaquina, escolhidas: modo.escolhidas }, agora: deps.agora() });
  const conhecidas = iasConhecidas(usos, preferencias.iasNoLimite);
  return {
    cota,
    conhecidas,
    doBot(bot) {
      const t = { harness: bot.harness ?? "auto", modelo: bot.modelo };
      const situacao = cota.length === 0 ? "livre" : situacaoDoTurno(t, cota, conhecidas);
      if (situacao === "livre") return { situacao, ia: null, voltaEm: null };
      const fixo = harnessFixado(t.harness, t.modelo);
      // No Automático o bot sai quando a primeira das IAs que o seguram renova.
      const seguram = cota.filter((c) => (fixo ? c.ia === fixo : conhecidas.includes(c.ia)) && situacaoDaIa(cota, c.ia) !== "livre").sort((a, b) => a.voltaEm - b.voltaEm);
      return { situacao, ia: seguram[0]?.ia ?? fixo ?? null, voltaEm: seguram[0]?.voltaEm ?? null };
    },
  };
}

/** A espera do bot pela cota agora (o `pedir_a_bot` diz a espera e a hora a quem pediu). */
export async function situacaoDoBotPelaCota(deps: Pick<Deps, "repos" | "agora">, bot: { harness?: string | null; modelo: string }): Promise<EsperaDoBot> {
  return (await lerCotaDosBots(deps)).doBot(bot);
}
