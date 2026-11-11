/**
 * O "X vai começar" na lateral da tarefa aberta (2026-11-10): a nota curta sob o select de Status e de Responsável. A
 * decisão é a regra única do mover (web/lib/acionamento.ts, `regraDeComecar`, da frente "Mover previsível"); aqui só a nota.
 */
import { regraDeComecar as regraUnica } from "./acionamento.ts";

export type MaoDaTarefa = { status: string; agenteId: string | null };
export type ContextoDeComecar = {
  colunas: readonly { id: string; grupo: string; responsavel?: string | null }[];
  /** Há turno vivo (rodando ou na fila) desta tarefa. */
  viva?: boolean;
  /** O responsável de `depois` veio da coluna (a passagem), não de uma troca explícita. */
  pelaColuna?: boolean;
};

/** A regra única de "vai começar" (web/lib/acionamento.ts, espelho de src/domain/acionamento.ts): a mesma do mover e do servidor. */
export function regraDeComecar(antes: MaoDaTarefa | null, depois: MaoDaTarefa, x: ContextoDeComecar): boolean {
  return regraUnica(antes, depois, x);
}

/**
 * A nota sob o select: "Ada vai começar" quando a escolha acionaria o responsável; vazio quando não. `campo` diz o que o
 * select muda; numa coluna com responsável (a passagem), quem pega é o da coluna.
 */
export function notaDeComecar(o: {
  t: MaoDaTarefa;
  campo: "status" | "agente";
  valor: string;
  colunas: ContextoDeComecar["colunas"];
  viva: boolean;
  nome: (agenteId: string) => string | null;
}): string {
  const doColuna = o.campo === "status" ? o.colunas.find((c) => c.id === o.valor)?.responsavel ?? null : null;
  const depois: MaoDaTarefa = o.campo === "status" ? { status: o.valor, agenteId: doColuna ?? o.t.agenteId } : { status: o.t.status, agenteId: o.valor || null };
  if (!regraDeComecar(o.t, depois, { colunas: o.colunas, viva: o.viva, pelaColuna: !!doColuna })) return "";
  return `${o.nome(depois.agenteId!) ?? "O responsável"} vai começar`;
}
