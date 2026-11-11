/**
 * O card otimista do mover sem piscar e sem mentir (comparação Multica × nod, T1, T2, T3, T4 e T6; 2026-11-10).
 * - T6: o otimista não herda a fila antiga (`naFilaDesde`, `motivoFila`): "na fila há 40 min" logo depois de soltar mentia.
 * - T2: o frame que chega com a mudança ainda no ar traz o card na coluna antiga; a mudança pendente é reaplicada sobre
 *   ele, em vez de trocada (o card voltava e avançava de novo).
 * - T1: sem rede, o card volta ao que era antes (como o quadro compartilhado já fazia).
 * - T4: um relógio de 1 min redesenha o quadro quando o minuto vira, com a aba visível; com card na fila ele relê.
 */
import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ComOtimista } from "./estado-do-trabalho.ts";

/** A mudança que está no ar: a tarefa, a coluna de onde saiu e o que o otimista pôs nela. */
export type MudancaNoAr = { tarefa: string; de: string; para: string; patch: Partial<TarefaDto> & ComOtimista };

/** O patch do card otimista: a coluna nova, o responsável dela e, se vai começar, "começando" sem a fila antiga. */
export function patchDoMover(para: string, agenteId: string | null | undefined, comeca: boolean): MudancaNoAr["patch"] {
  return {
    status: para,
    ...(agenteId !== undefined ? { agenteId } : {}),
    // T6: a fila e o "trabalhando há" de antes não valem para o card que acabou de mudar.
    naFilaDesde: null,
    motivoFila: null,
    ...(comeca ? { execucao: "fila" as const, otimista: true as const, trabalhandoDesde: null } : {}),
  };
}

/** O quadro com a mudança aplicada à tarefa dela. */
export function aplicarMudanca(q: QuadroDto, m: MudancaNoAr): QuadroDto {
  return { ...q, tarefas: q.tarefas.map((x) => (x.id === m.tarefa ? { ...x, ...m.patch } : x)) };
}

/**
 * T2: o quadro que chega (um frame) com a mudança ainda no ar. Se o servidor ainda mostra a tarefa na coluna de onde ela
 * saiu, a mudança é reaplicada; se já mostra em outro lugar (a mudança valeu, ou outra pessoa a moveu), vale o servidor.
 */
export function reaplicarNoAr(novo: QuadroDto, m: MudancaNoAr | null): QuadroDto {
  if (!m) return novo;
  const t = novo.tarefas.find((x) => x.id === m.tarefa);
  if (!t || t.status !== m.de) return novo;
  return aplicarMudanca(novo, m);
}

/** T1: sem rede, a tarefa volta ao que era antes (só ela: o resto do quadro pode ter vindo de um frame). */
export function desfazerMudanca(q: QuadroDto, antes: TarefaDto): QuadroDto {
  return { ...q, tarefas: q.tarefas.map((x) => (x.id === antes.id ? antes : x)) };
}

/** T3: o arraste com outra mudança no ar não sai calado. */
export const ESPERE_A_ANTERIOR = "Espere a mudança anterior terminar e solte de novo.";

/**
 * T4: o que o relógio do quadro faz neste tique. Nada com a aba escondida, sem quadro ou no mesmo minuto do último
 * desenho; com card na fila (o despacho pode ter falhado sem frame) relê; senão só redesenha (o "há X" anda).
 */
export function tiqueDoRelogio(o: { agora: number; minutoDesenhado: number; visivel: boolean; quadro: Pick<QuadroDto, "tarefas"> | null }): "nada" | "redesenhar" | "reler" {
  if (!o.visivel || !o.quadro || Math.floor(o.agora / 60_000) === o.minutoDesenhado) return "nada";
  return o.quadro.tarefas.some((t) => t.execucao === "fila") ? "reler" : "redesenhar";
}

/** definido em 2026-11-10: o relógio confere a cada 15 s (o minuto vira no máximo 15 s antes de a tela andar). */
export const TIQUE_MS = 15_000;
