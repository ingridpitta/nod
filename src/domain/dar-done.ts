/**
 * P7 da comparação Multica (definido em 2026-11-10): a resposta à "pronta para o Done" que fecha a tarefa. O botão manda
 * "Dar Done"; a pessoa que escreve diz "pode fechar", "fecha", "done", "aprovado, pode fechar". A regra: sem acento, caixa
 * e pontuação, tiradas as palavras de cortesia (ok, sim, aprovado, pode, por favor…), o que sobra tem de ser exatamente um
 * pedido de fechar. Qualquer negação ("não", "ainda", "espera") ou palavra a mais ("fecha depois do deploy") não fecha: na
 * dúvida a tarefa volta à etapa anterior e o texto vira comentário, que aciona o bot (é ele quem pergunta).
 */
const normalizar = (texto: string): string[] =>
  texto.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

/** Cortesia em volta do pedido: não muda o sentido. */
const CORTESIA = new Set(["ok", "okay", "sim", "aprovado", "aprovada", "aprovo", "pode", "podes", "por", "favor", "pf", "pfv", "pls", "please", "ja", "obrigado", "obrigada", "valeu", "beleza", "blz", "show", "perfeito", "otimo", "isso", "entao", "a", "e", "tarefa", "ela", "essa", "esta"]);

/** O que pede para fechar, depois de tirada a cortesia. */
const PEDIDOS = new Set(["dar done", "da done", "de done", "done", "fechar", "fecha", "feche", "fechou", "finalizar", "finaliza", "concluir", "conclui", "marcar como feito", "manda para feito", "manda pra feito", "mover para feito", "move para feito"]);

const NEGACAO = new Set(["nao", "nem", "ainda", "espera", "esperar", "aguarda", "aguarde", "depois", "antes", "sem", "voltar", "volta", "nunca", "jamais"]);

export function ehDarDone(texto: string): boolean {
  const palavras = normalizar(texto);
  if (palavras.length === 0 || palavras.length > 8 || palavras.some((p) => NEGACAO.has(p))) return false;
  const nucleo = palavras.filter((p) => !CORTESIA.has(p)).join(" ");
  return PEDIDOS.has(nucleo);
}
