/**
 * As opções da pergunta de pedir_a_pessoa (plano "pergunta com botões", Parte 1, definido em 2026-10-18). A mesma régua
 * decide duas coisas: quais opções são repetidas na normalização (src/use-cases/pedir-a-pessoa.ts) e se a resposta da
 * pessoa É uma das opções (`via: "opcao"` em `resposta_a_pedido`) — clique, letra ou texto digitado igual. É a régua da
 * medição do clique: `resposta_a_pedido.texto` igual a uma das `opcoes`, sem diferença de espaços nem de caixa.
 * A web tem um espelho (`indiceDaOpcao`, web/lib/perguntas.ts) para o payload antigo, sem `via`; o teste confere os dois.
 */

/** O texto da opção como ele é exibido: espaços seguidos viram um e as pontas saem. */
export function textoDaOpcao(bruta: string): string {
  return bruta.replace(/\s+/g, " ").trim();
}

/** A chave que compara duas opções (ou a resposta com uma opção): o texto exibido, sem caixa. */
export function chaveDaOpcao(texto: string): string {
  return textoDaOpcao(texto).toLocaleLowerCase("pt-BR");
}

/** O índice da opção que a resposta repete, ou null quando a resposta é outra coisa (ou não há opções). */
export function opcaoRespondida(resposta: string, opcoes: readonly string[] | undefined): number | null {
  if (!opcoes?.length) return null;
  const chave = chaveDaOpcao(resposta);
  if (chave === "") return null;
  const i = opcoes.findIndex((o) => chaveDaOpcao(o) === chave);
  return i === -1 ? null : i;
}
