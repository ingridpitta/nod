import type { ControleComputador } from "../contracts/computador.ts";
import type { Deps } from "./tipos.ts";

/**
 * NOD-96 (ADR-122): onde mora o pedido de ajuda do computador de um bot, já travado. No computador da pessoa
 * ('por_pessoa') é a tela do bot (`computador_telas`); no docker por bot, a linha `computadores` dele. A linha do
 * computador da pessoa nunca guarda o pedido de ajuda (ele é por tela), e o docker não escreve nela (`travar` só
 * devolve o 'por_bot'). A ordem das travas é a do portão (tela → computador): aqui só se trava um dos dois.
 */
export type AjudaDoComputador = {
  ajudaDecisaoId: string | null;
  controle: ControleComputador;
  configurar(c: { controle?: ControleComputador; ajuda: null; ajudaDecisaoId: null; atividadeEm?: number }): Promise<void>;
  /** A "Devolver ao bot" da pessoa no registro de atividade (a da tela leva só a tela, sem `agente_id`). */
  registrarDevolver(): Promise<unknown>;
};

export async function ajudaDoComputador(repos: Pick<Deps["repos"], "computadores" | "computadorTelas">, agenteId: string): Promise<AjudaDoComputador | null> {
  const v = await repos.computadores.buscarVinculo(agenteId);
  if (!v) return null;
  const p = await repos.computadores.daPessoa();
  if (p && p.id === v.id) {
    const achada = await repos.computadorTelas.buscar(p.id, agenteId);
    const t = achada && await repos.computadorTelas.travar(achada.id);
    return t && {
      ajudaDecisaoId: t.ajudaDecisaoId, controle: t.controle,
      configurar: (c) => repos.computadorTelas.configurar(t.id, c),
      registrarDevolver: () => repos.computadores.registrar({ computadorId: p.id, telaId: t.id, autor: "pessoa", tipo: "devolver", estado: "concluida" }),
    };
  }
  const c = await repos.computadores.travar(v.id);
  return c && {
    ajudaDecisaoId: c.ajudaDecisaoId, controle: c.controle,
    configurar: (a) => repos.computadores.configurar(c.id, a),
    registrarDevolver: () => repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: "devolver", estado: "concluida" }),
  };
}
