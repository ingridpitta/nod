/**
 * A ordem da barra lateral no servidor (0041). Um grupo é a grade de fixados ou uma seção ("" = Meus agentes); a ordem
 * dentro dele segue `agentesRepo.listar` — posição (null por último), depois a criação.
 */
export type BotNaBarra = { id: string; ownerId: string; fixado: boolean; secao?: string; posicao?: number | null; criadoEm: number; excluidoEm?: number | null };

const mesmoGrupo = (a: BotNaBarra, b: BotNaBarra): boolean => (a.fixado ? b.fixado : !b.fixado && (b.secao ?? "") === (a.secao ?? ""));

const naOrdem = (x: BotNaBarra, y: BotNaBarra): number => (x.posicao ?? Infinity) - (y.posicao ?? Infinity) || x.criadoEm - y.criadoEm;

/**
 * definido em 2026-10-06 (pedido do Marlon): a cópia de um bot nasce logo abaixo do original, no mesmo grupo. Devolve os
 * ids do grupo do original da pessoa na ordem atual, com a cópia inserida depois dele — a mesma forma que o arrasto grava.
 */
export function ordemComCopia(bots: readonly BotNaBarra[], original: BotNaBarra, copiaId: string): string[] {
  const grupo = bots
    .filter((b) => b.ownerId === original.ownerId && !b.excluidoEm && b.id !== copiaId && mesmoGrupo(original, b))
    .sort(naOrdem)
    .map((b) => b.id);
  const i = grupo.indexOf(original.id);
  grupo.splice(i < 0 ? grupo.length : i + 1, 0, copiaId);
  return grupo;
}
