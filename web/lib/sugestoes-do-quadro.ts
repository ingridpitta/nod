/**
 * ADA-6: as sugestões da pílula vazia (até 3), tiradas do próprio quadro. Somem quando a pessoa digita. Nenhuma manda nada
 * sozinha: "Responder X" abre a tarefa que espera a pessoa; as outras só preenchem a pílula, e quem envia é ela (Enter).
 * O texto que preenche usa só o código da tarefa, nunca o título (que pode ter vindo de fora).
 */
import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { comColunas } from "./colunas.ts";
import { FORMATO_CODIGO } from "./quadro-dados.ts";

export type Sugestao =
  | { tipo: "abrir"; rotulo: string; tarefaId: string }
  | { tipo: "texto"; rotulo: string; texto: string };

export const MAX_SUGESTOES = 3;

/**
 * Revisão M1: só o código do quadro (ZE-12) entra no chip e no texto. O id do Linear (que vem de fora) e o provisório
 * (#ABCD) não: sem código, a sugestão que precisaria dele não aparece (a de abrir usa um rótulo neutro).
 */
function codigoSeguro(t: TarefaDto): string | null {
  const c = t.codigo?.trim() ?? "";
  return c && !c.startsWith("#") && FORMATO_CODIGO.test(c) && c !== t.linearId ? c : null;
}

export function sugestoesDoQuadro(q: Pick<QuadroDto, "tarefas" | "colunas"> | null, aberta: string | null): Sugestao[] {
  // Com uma tarefa aberta a pílula manda recado sobre ela: as sugestões do quadro não cabem ali.
  if (!q || aberta) return [];
  // Revisão M6 (ADR-140): viva é a tarefa numa coluna de Não iniciado ou de Andamento, pelo grupo, não pelo id da coluna.
  const grupo = new Map(comColunas(q).colunas.map((c) => [c.id, c.grupo]));
  const vivas = q.tarefas.filter((t) => { const g = grupo.get(t.status); return g === "nao_iniciado" || g === "iniciado"; });
  const s: Sugestao[] = [];
  // Revisão 4 (M2, ADR-143): no quadro com várias pessoas, só a pendência que a própria pessoa decide vira "Responder".
  const espera = q.tarefas.find((t) => t.status === "voce" && (!t.decide || t.decide.voce));
  if (espera) { const c = codigoSeguro(espera); s.push({ tipo: "abrir", rotulo: c ? `Responder ${c}` : "Responder o que espera você", tarefaId: espera.id }); }
  const travada = q.tarefas.find((t) => t.status === "bloqueado" && codigoSeguro(t));
  const ct = travada ? codigoSeguro(travada) : null;
  if (ct) s.push({ tipo: "texto", rotulo: `Por que ${ct} travou?`, texto: `Por que a ${ct} está bloqueada e do que ela precisa?` });
  if (vivas.length) s.push({ tipo: "texto", rotulo: "Resumo do quadro", texto: "Me dá um resumo do quadro: o que andou, o que está parado e com quem." });
  else s.push({ tipo: "texto", rotulo: "Por onde começo?", texto: "Me ajuda a montar as primeiras tarefas deste quadro." });
  if (s.length < MAX_SUGESTOES && vivas.length) s.push({ tipo: "texto", rotulo: "O que está parado?", texto: "O que está parado no quadro e por quê?" });
  return s.slice(0, MAX_SUGESTOES);
}

/** O contador da pílula: só a partir de 3500 caracteres (antes ele é ruído). */
export const CONTADOR_A_PARTIR = 3500;
export function contadorDaPilula(n: number, limite: number): string | null {
  if (n < CONTADOR_A_PARTIR) return null;
  const f = (x: number): string => x.toLocaleString("pt-BR");
  return `${f(n)}/${f(limite)}`;
}
