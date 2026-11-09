import type { EstadoDaTarefa, EventoStream, TarefaDoBot } from "../contracts/turno.ts";

/**
 * A lista de tarefas do bot (definido em 2026-09-28). No terminal a pessoa vê a checklist que o Claude Code monta
 * (TaskCreate/TaskUpdate); no nod ela era cortada — as ferramentas nem entravam no kit. Medido no CLI 2.1.284 (haiku):
 *  - TaskCreate {subject, description} → resultado "Task #1 created successfully: Ler o diff";
 *  - TaskUpdate {taskId, status: pending | in_progress | completed} → "Updated task #1 status";
 *  - TaskList {} → uma linha por tarefa, "#2 [in_progress] Checar SQL".
 * O id só existe no RESULTADO da criação, então a chamada fica pendente até o tool_result dela (pelo id do uso).
 * Puro: quem guarda o estado por turno é o adaptador (o laço do servidor e o app do Mac).
 */
export type { EstadoDaTarefa, TarefaDoBot };

export const FERRAMENTAS_DE_TAREFA = ["TaskCreate", "TaskGet", "TaskList", "TaskUpdate"] as const;
/** Tetos da lista que viaja no trecho vivo e no frame: um bot que cria tarefas sem parar não enche a tela. */
export const TETO_TAREFAS = 50;
export const TETO_TITULO_TAREFA = 200;

type Pendente = { tipo: "criar"; titulo: string } | { tipo: "atualizar"; taskId: string; status: string; titulo: string | null } | { tipo: "listar" };
export type AcompanhamentoDeTarefas = { tarefas: TarefaDoBot[]; pendentes: Record<string, Pendente> };

export const SEM_TAREFAS: AcompanhamentoDeTarefas = { tarefas: [], pendentes: {} };

const ESTADOS: Record<string, EstadoDaTarefa> = { pending: "pendente", in_progress: "andamento", completed: "feita" };

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, TETO_TITULO_TAREFA) : null;
}

function comTarefa(tarefas: TarefaDoBot[], t: TarefaDoBot): TarefaDoBot[] {
  const i = tarefas.findIndex((x) => x.id === t.id);
  if (i >= 0) return tarefas.map((x, j) => (j === i ? t : x));
  return tarefas.length >= TETO_TAREFAS ? tarefas : [...tarefas, t];
}

/** "#1 [completed] Ler o diff" → a lista inteira, do jeito que o CLI a vê agora. */
function daListagem(saida: string): TarefaDoBot[] | null {
  const tarefas: TarefaDoBot[] = [];
  for (const linha of saida.split("\n")) {
    const m = /^#(\S+)\s+\[(\w+)\]\s+(.+)$/.exec(linha.trim());
    const estado = m ? ESTADOS[m[2]!] : undefined;
    if (m && estado) tarefas.push({ id: m[1]!, titulo: m[3]!.slice(0, TETO_TITULO_TAREFA), estado });
  }
  return tarefas.length ? tarefas.slice(0, TETO_TAREFAS) : null;
}

/**
 * Aplica um evento do stream. `mudou` diz se a LISTA mudou (o adaptador só publica quando muda). Evento que não é de
 * tarefa passa sem custo; resultado com erro desfaz a pendência sem mexer na lista.
 */
export function reduzirTarefas(a: AcompanhamentoDeTarefas, ev: EventoStream): { acompanhamento: AcompanhamentoDeTarefas; mudou: boolean } {
  if (ev.tipo === "tool_use" && (FERRAMENTAS_DE_TAREFA as readonly string[]).includes(ev.nome)) {
    const input = (typeof ev.input === "object" && ev.input !== null ? ev.input : {}) as Record<string, unknown>;
    const pendente: Pendente | null =
      ev.nome === "TaskCreate" ? { tipo: "criar", titulo: texto(input.subject) ?? "Tarefa" }
        : ev.nome === "TaskUpdate" ? (texto(input.taskId) ? { tipo: "atualizar", taskId: texto(input.taskId)!, status: String(input.status ?? ""), titulo: texto(input.subject) } : null)
          : ev.nome === "TaskList" ? { tipo: "listar" }
            : null;
    return { acompanhamento: pendente ? { ...a, pendentes: { ...a.pendentes, [ev.id]: pendente } } : a, mudou: false };
  }
  if (ev.tipo !== "tool_result" || !a.pendentes[ev.toolUseId]) return { acompanhamento: a, mudou: false };
  const p = a.pendentes[ev.toolUseId]!;
  const { [ev.toolUseId]: _feito, ...pendentes } = a.pendentes;
  if (ev.isError) return { acompanhamento: { ...a, pendentes }, mudou: false };
  let tarefas = a.tarefas;
  if (p.tipo === "criar") {
    const id = /#(\S+?)\b/.exec(ev.texto)?.[1] ?? String(a.tarefas.length + 1);
    tarefas = comTarefa(tarefas, { id, titulo: p.titulo, estado: "pendente" });
  } else if (p.tipo === "atualizar") {
    const atual = tarefas.find((t) => t.id === p.taskId);
    if (p.status === "deleted") tarefas = tarefas.filter((t) => t.id !== p.taskId);
    else tarefas = comTarefa(tarefas, { id: p.taskId, titulo: p.titulo ?? atual?.titulo ?? `Tarefa ${p.taskId}`, estado: ESTADOS[p.status] ?? atual?.estado ?? "pendente" });
  } else {
    tarefas = daListagem(ev.texto) ?? tarefas;
  }
  const mudou = JSON.stringify(tarefas) !== JSON.stringify(a.tarefas);
  return { acompanhamento: { tarefas, pendentes }, mudou };
}
