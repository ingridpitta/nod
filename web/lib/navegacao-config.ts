import { secaoAberta, type Estado, type PedidoSecao, type SecaoEspaco } from "../estado/reducer.ts";

/**
 * NOD-383: a navegação das Configurações no celular (lista estilo Ajustes, seção em tela cheia com ‹), em funções puras
 * para o teste provar o comportamento sem DOM. O `main.ts` só aplica o que elas devolvem.
 */

/** Para onde vai o foco ao abrir as Configurações (ou trocar de seção). */
export function focoAoAbrirEspaco(p: { pedido: PedidoSecao; secao: SecaoEspaco; celular: boolean; lista: boolean; jaAberto: boolean }): string {
  // "Ajuda" abre Geral no bloco Ajuda.
  if (p.pedido === "ajuda") return "#espaco #ajuda";
  // No celular a seção abre em tela cheia (o item tocado da lista some): o foco vai para o ‹ dela. A lista segue o desktop.
  if (p.celular && !p.lista) return "#espaco [data-act=cfg-lista]";
  return p.jaAberto ? `#espaco [data-secao="${p.secao}"]` : "#espaco .espaco-voltar";
}

/** O que o Esc faz com as Configurações abertas: no celular, numa seção, volta para a lista (como o ‹); senão fecha. */
export function escNoEspaco(celular: boolean, estado: Pick<Estado, "espaco">): "lista" | "fechar" {
  return celular && secaoAberta(estado) ? "lista" : "fechar";
}

/** O ‹ da seção: volta para a lista (fechando a Minha conta, que é um diálogo por cima) e foca o item de onde saiu. */
export function voltarParaLista(estado: Pick<Estado, "espaco">, minhaConta: boolean): { secao: SecaoEspaco; fecharMinhaConta: boolean; foco: string } | null {
  const secao = secaoAberta(estado);
  if (!secao) return null;
  return { secao, fecharMinhaConta: secao === "conta" && minhaConta, foco: `#espaco [data-secao="${secao}"]` };
}
