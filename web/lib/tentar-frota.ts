/**
 * NOD-379 (QA 2): o "Tentar de novo" da inicial do celular relê a frota NA HORA. Antes ele só marcava a invalidação, e
 * com a rede caída a releitura ficava presa atrás das tentativas da passada anterior (ou na fila da sonda): o toque não
 * fazia nada até o retry automático. Agora o toque tira a frota da fila da sonda e pede direto; se a rede cair de novo,
 * ela volta para a fila (a sonda a devolve quando o nod responder).
 */
export type TentarFrota<A> = {
  /** A leitura da frota (`buscarFrota`): a ação a aplicar, ou null se uma leitura mais nova passou na frente. */
  buscar: () => Promise<A | null>;
  aplicar: (acao: A) => void;
  /** A frota sai da fila de "quando a rede voltar": quem pede agora é o toque. */
  tirarDaFila: () => void;
  /** Falhou por rede: volta para a fila e a sonda é lembrada. */
  voltarParaFila: () => void;
  ehRede: (e: unknown) => boolean;
  /** Redesenha (o aviso "Não deu para carregar…" continua, com o botão). */
  redesenhar: () => void;
};

export async function tentarFrotaAgora<A>(t: TentarFrota<A>): Promise<void> {
  t.tirarDaFila();
  try {
    const acao = await t.buscar();
    if (acao) t.aplicar(acao);
  } catch (e) {
    if (t.ehRede(e)) t.voltarParaFila();
    t.redesenhar();
  }
}
