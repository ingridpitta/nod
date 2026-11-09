import type { Deps } from "./tipos.ts";

/**
 * NOD-268 (revisão do PR #319): a máquina que vai pegar a próxima fala do bot — a mesma ordem de `alvoDoTurno`
 * (repositories/alvo-da-maquina.ts) sem o "desta vez" (vale só para os turnos que já estavam na fila): a máquina do bot,
 * senão o padrão da pessoa; cada nível só vale com a chave viva (não revogada). null = qualquer máquina.
 *
 * O vencimento da chave (`expira_em`) não chega ao DTO: uma chave vencida e não revogada ainda conta aqui; o
 * `reivindicar` a pula e o turno segue para o próximo nível — no pior caso, a linha nomeia a máquina vencida.
 * NOD-94: a máquina só-computador não vale em nível nenhum, como em `alvoDoTurno`.
 */
export async function alvoDoBot(deps: Pick<Deps, "repos">, agenteId: string): Promise<{ id: string; nome: string } | null> {
  const [agente, preferencias, chaves] = await Promise.all([deps.repos.agentes.buscar(agenteId), deps.repos.preferencias.buscar(), deps.repos.maquinaTokens.listar()]);
  for (const id of [agente?.maquinaId ?? null, preferencias.maquinaPadraoId ?? null]) {
    const chave = id ? chaves.find((k) => k.id === id && k.revogadaEm === null && k.papel !== "computador") : undefined;
    if (chave) return { id: chave.id, nome: chave.nome };
  }
  return null;
}
