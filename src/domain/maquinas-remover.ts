/**
 * ADA-245 (jornada D do onboarding): quem assume os bots quando a pessoa remove o nod de um computador. Puro: o executor
 * (src/use-cases/acoes/maquinas.ts) lê as chaves, os bots e o padrão, e grava o que estas funções decidem.
 *
 * Regra (spec docs/specs/onboarding-jornada-d.md, item 5): os bots do computador removido passam para o padrão; se o
 * removido É o padrão, o próximo computador de trabalho vira o padrão — o que está conectado agora primeiro, depois o
 * usado mais recentemente, depois o mais novo. Sem outro, ninguém assume e os bots esperam um computador.
 * O só-computador (NOD-94) nunca pega trabalho e não entra na escolha.
 */

import type { OpcoesRemover } from "../contracts/remover-computador.ts";

export type ComputadorParaEscolha = {
  id: string;
  nome: string;
  revogadaEm: number | null;
  papel?: "motor" | "computador";
  ultimoUsoEm: number | null;
  criadaEm: number;
};

/** A ordem da escolha: conectado agora, último uso, criado mais tarde; o id desempata (determinístico). */
export function proximoPadrao(computadores: readonly ComputadorParaEscolha[], removido: string, conectados: ReadonlySet<string>): { id: string; nome: string } | null {
  const candidatos = computadores.filter((c) => c.id !== removido && c.revogadaEm === null && c.papel !== "computador");
  candidatos.sort(
    (a, b) =>
      Number(conectados.has(b.id)) - Number(conectados.has(a.id)) ||
      (b.ultimoUsoEm ?? -1) - (a.ultimoUsoEm ?? -1) ||
      b.criadaEm - a.criadaEm ||
      a.id.localeCompare(b.id),
  );
  const c = candidatos[0];
  return c ? { id: c.id, nome: c.nome } : null;
}

/**
 * Os bots que rodam no computador `id`: os presos a ele e, se ele é o padrão, os que seguem o padrão (sem computador, ou
 * presos a um que não vale mais). `vivos` = os ids de computador que ainda valem (não revogados, de trabalho).
 */
export function botsDoComputador<B extends { id: string; maquinaId: string | null }>(bots: readonly B[], id: string, padraoId: string | null, vivos: ReadonlySet<string>): B[] {
  return bots.filter((b) => b.maquinaId === id || (padraoId === id && (b.maquinaId === null || !vivos.has(b.maquinaId))));
}

/**
 * O que muda no banco: os bots presos ao removido soltam (passam a seguir o padrão) e, se o removido era o padrão, o
 * padrão passa para `assume` (ou fica vazio). `assume` = quem os bots seguem depois.
 */
export function planoDeRemover(entrada: {
  id: string;
  padraoId: string | null;
  computadores: readonly ComputadorParaEscolha[];
  conectados: ReadonlySet<string>;
}): { ehPadrao: boolean; novoPadrao: { id: string; nome: string } | null | undefined; assume: { id: string; nome: string } | null } {
  const ehPadrao = entrada.padraoId === entrada.id;
  if (ehPadrao) {
    const proximo = proximoPadrao(entrada.computadores, entrada.id, entrada.conectados);
    return { ehPadrao, novoPadrao: proximo, assume: proximo };
  }
  const padrao = entrada.computadores.find((c) => c.id === entrada.padraoId && c.revogadaEm === null && c.papel !== "computador");
  // O padrão que não vale mais (revogado ou só-computador): a fila já o pula; o próximo o substitui, como se o removido fosse ele.
  if (!padrao) {
    const proximo = proximoPadrao(entrada.computadores, entrada.id, entrada.conectados);
    return { ehPadrao, novoPadrao: proximo, assume: proximo };
  }
  return { ehPadrao, novoPadrao: undefined, assume: { id: padrao.id, nome: padrao.nome } };
}

/**
 * Revisão do PR #694: o `desconectar` da puxada quando há um pedido de remover. Com "Continuar ligado" ele NÃO vai: o
 * cliente de antes da ADA-245 ignora `remover` e, com `desconectar`, sairia das contas e apagaria a conexão, o contrário
 * do que a pessoa escolheu. O cliente novo age pelo `remover` sozinho (motor/contas.ts, desktop/contas-no-servidor.ts).
 * Saindo da conta, vai: o cliente antigo ao menos sai das contas e confirma.
 */
export function desconectarNaPuxada(desconexaoPedida: boolean, remover: OpcoesRemover | null): boolean {
  return desconexaoPedida || (remover !== null && !remover.manterConexao);
}
