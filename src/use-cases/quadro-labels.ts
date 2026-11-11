import { randomUUID } from "node:crypto";
import type { OpQuadro, Quadro } from "../contracts/quadro.ts";
import { OPS_LABEL, type LabelDto, type OpLabel } from "../contracts/quadro-labels.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { acharLabel, corPadraoDaLabel, mexeEmLabelOuPrazo, nomeRepetidoNoCatalogo, resolverLabelsDasOps } from "../domain/quadro-labels.ts";
import { LIMITES_LABEL } from "../contracts/quadro-labels.ts";
import { recusaDoLimite } from "../domain/quadro.ts";
import type { Deps } from "./tipos.ts";
import { eventoQuadro, falha, leitorDoLote, limiteDe, montarQuadro, type PedidoLote, type ResultadoLote } from "./quadro.ts";

/**
 * Labels e prazo das tarefas (definido em 2026-11-10). O catálogo muda por ops próprias (criar_label, editar_label,
 * remover_label), sozinhas na chamada e sem Desfazer de lote (o inverso é a op contrária), como as pessoas do quadro.
 * As labels da tarefa vão no lote de sempre (criar_tarefa/mudar_tarefa, com Desfazer): antes de planejar, os nomes viram
 * ids do catálogo e o nome novo vira label (gravada só se o lote passar).
 */

export const ehOpDeLabel = (o: OpQuadro): o is OpLabel => (OPS_LABEL as readonly string[]).includes(o.tipo);

/** Quem pode mexer no catálogo: a dona pela tela, ou o bot a pedido dela num turno limpo (como as colunas). */
function recusaDoCatalogo(p: PedidoLote): string | null {
  if (p.pedidoPor) return "as labels do quadro são da dona: peça a ela (ou use uma das labels que já existem)";
  if (p.origemConfiavel === false) return "as labels só mudam num turno limpo, em que a pessoa falou com você e nada de fora entrou: peça a ela";
  if (limiteDe(p) === "normal") return recusaDoLimite("mexer nas labels do quadro");
  return null;
}

type Saida = { data: ResultadoLote; events?: RuntimeEvent[] };

/** As ops do catálogo, em ordem (tudo ou nada: a primeira recusa desfaz as anteriores pela transação de quem chamou). */
export async function aplicarOpsDeLabel(deps: Deps, p: PedidoLote, q: Quadro): Promise<Saida> {
  if (!p.ops.every(ehOpDeLabel)) return falha("entrada_invalida", "as ops de label (criar_label, editar_label, remover_label) vão numa chamada só com elas");
  const recusa = recusaDoCatalogo(p);
  if (recusa) return falha("nao_permitido", recusa);
  const repo = deps.repos.quadros;
  const catalogo: LabelDto[] = (await repo.labels(q.id)).map((l) => ({ id: l.id, nome: l.nome, cor: l.cor }));
  // Confere tudo antes de gravar (a falha devolve dado, não exceção: a transação não volta sozinha).
  const passos: (() => Promise<void>)[] = [];
  for (const [i, op] of (p.ops as OpLabel[]).entries()) {
    const erro = (e: string) => falha("entrada_invalida", p.ops.length > 1 ? `ação ${i + 1}: ${e}` : e);
    if (op.tipo === "criar_label") {
      if (nomeRepetidoNoCatalogo(catalogo, op.nome)) return erro(`já há uma label "${op.nome}" neste quadro`);
      if (catalogo.length >= LIMITES_LABEL.porQuadro) return erro(`o quadro já tem ${LIMITES_LABEL.porQuadro} labels`);
      const nova = { id: randomUUID(), nome: op.nome, cor: op.cor ?? corPadraoDaLabel(op.nome) };
      catalogo.push(nova);
      passos.push(() => repo.inserirLabels(q.id, [nova]));
      continue;
    }
    const l = acharLabel(catalogo, op.label);
    if (!l) return { data: { ok: false, erro: "nao_encontrado", detalhe: `label "${op.label}" não está no quadro` } };
    if (op.tipo === "editar_label") {
      if (op.nome && nomeRepetidoNoCatalogo(catalogo, op.nome, l.id)) return erro(`já há uma label "${op.nome}" neste quadro`);
      if (op.nome) l.nome = op.nome;
      if (op.cor) l.cor = op.cor;
      const c = { ...(op.nome ? { nome: op.nome } : {}), ...(op.cor ? { cor: op.cor } : {}) };
      passos.push(async () => { await repo.editarLabel(q.id, l.id, c); });
    } else {
      catalogo.splice(catalogo.indexOf(l), 1);
      passos.push(async () => { await repo.removerLabel(q.id, l.id); });
    }
  }
  for (const passo of passos) await passo();
  return {
    data: { ok: true, quadro: await montarQuadro(deps, q, leitorDoLote(deps, p)), lote: null, comecaram: [], desfeito: false },
    events: [eventoQuadro(deps, p, q, null, [])],
  };
}

/**
 * Antes do plano: troca os nomes de label das ops de tarefa pelos ids do catálogo. Só cria label nova quem pode mexer no
 * catálogo (recusaDoCatalogo); os outros aplicam as que existem. `gravar` põe as novas no banco (chame só com o lote ok).
 */
export async function prepararLabels(deps: Deps, p: PedidoLote, quadroId: string): Promise<{ ops: readonly OpQuadro[]; gravar: () => Promise<void> } | { erro: string; indice: number }> {
  const algum = p.ops.some((o) => (o.tipo === "criar_tarefa" || o.tipo === "mudar_tarefa") && mexeEmLabelOuPrazo(o));
  if (!algum) return { ops: p.ops, gravar: async () => {} };
  const catalogo = (await deps.repos.quadros.labels(quadroId)).map((l) => ({ id: l.id, nome: l.nome, cor: l.cor }));
  const r = resolverLabelsDasOps(p.ops, catalogo, randomUUID, recusaDoCatalogo(p) === null);
  if ("erro" in r) return r;
  return { ops: r.ops, gravar: () => deps.repos.quadros.inserirLabels(quadroId, r.novas) };
}
