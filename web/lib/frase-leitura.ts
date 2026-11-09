/**
 * NOD-449: a frase do aviso da tela ("Bia marcada como lida", "Bia e Lia marcadas como lidas", "5 conversas …"). É a mesma
 * do recibo do chat (src/domain/nao-lidos.ts); a web não importa o domínio (ADR-018), então um teste amarra as duas.
 */
const NOMES_NA_FRASE = 3;

export function fraseDoAviso(nomes: readonly string[]): string {
  if (nomes.length === 0) return "Nada para marcar: tudo em dia";
  const quem = nomes.length > NOMES_NA_FRASE ? `${nomes.length} conversas` : nomes.length === 1 ? nomes[0]! : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return nomes.length === 1 ? `${quem} marcada como lida` : `${quem} marcadas como lidas`;
}

export function fraseDaContagemNoAviso(n: number): string {
  return n === 1 ? "1 conversa marcada como lida" : `${n} conversas marcadas como lidas`;
}
