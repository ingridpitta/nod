import type { OpQuadro } from "../contracts/quadro.ts";
import { CORES_LABEL, LIMITES_LABEL, type CamposDeLabel, type CorLabel, type LabelDto, type OpLabel } from "../contracts/quadro-labels.ts";

/**
 * Labels e prazo das tarefas, puro (definido em 2026-11-10). Lê os campos que chegam de fora (a ferramenta e a rota),
 * troca os nomes de label pelos ids do catálogo (criando os que faltam, como no Linear) e aplica o conjunto na tarefa.
 * O banco é a 0159; o caso de uso, src/use-cases/quadro-labels.ts.
 */

type ErroOp = { erro: string };
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** O nome como fica guardado: sem espaço nas pontas nem repetido no meio. */
export const normalizarNomeLabel = (s: string): string => s.trim().replace(/\s+/g, " ");
const chave = (s: string) => normalizarNomeLabel(s).toLocaleLowerCase("pt-BR");

export function ehCorLabel(v: unknown): v is CorLabel {
  return typeof v === "string" && (CORES_LABEL as readonly string[]).includes(v);
}

/** A cor de uma label criada sem cor: fixa pelo nome (a mesma label nasce com a mesma cor em qualquer quadro), nunca cinza. */
export function corPadraoDaLabel(nome: string): CorLabel {
  const cores = CORES_LABEL.filter((c) => c !== "cinza");
  let h = 0;
  for (const ch of chave(nome)) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return cores[h % cores.length]!;
}

export function dataValida(v: string): boolean {
  if (!DATA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function nomeDeLabel(v: unknown, campo: string): string | ErroOp {
  if (typeof v !== "string" || normalizarNomeLabel(v) === "") return { erro: `${campo}: label vazia` };
  const n = normalizarNomeLabel(v);
  if (n.length > LIMITES_LABEL.nome) return { erro: `${campo}: label passa de ${LIMITES_LABEL.nome} caracteres` };
  return n;
}

function listaDeLabels(v: unknown, campo: string): string[] | undefined | ErroOp {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) return { erro: `${campo} é a lista de labels (nome ou id)` };
  if (v.length > LIMITES_LABEL.porTarefa) return { erro: `${campo}: mais de ${LIMITES_LABEL.porTarefa} labels` };
  const out: string[] = [];
  for (const x of v) {
    const n = nomeDeLabel(x, campo);
    if (typeof n !== "string") return n;
    if (!out.some((o) => chave(o) === chave(n))) out.push(n);
  }
  return out;
}

/** Os campos de label e prazo de criar_tarefa e mudar_tarefa (ausente = não mexe). */
export function lerCamposDeLabel(v: Record<string, unknown>): CamposDeLabel | ErroOp {
  const labels = listaDeLabels(v.labels, "labels");
  if (ehErro(labels)) return labels;
  const por = listaDeLabels(v.por_labels, "por_labels");
  if (ehErro(por)) return por;
  const tirar = listaDeLabels(v.tirar_labels, "tirar_labels");
  if (ehErro(tirar)) return tirar;
  let prazo: string | null | undefined;
  if (v.prazo_em === null || v.prazo_em === "") prazo = null;
  else if (v.prazo_em !== undefined) {
    if (typeof v.prazo_em !== "string" || !dataValida(v.prazo_em.trim())) return { erro: "prazo_em fora do formato AAAA-MM-DD" };
    prazo = v.prazo_em.trim();
  }
  return { ...(labels ? { labels } : {}), ...(por ? { por_labels: por } : {}), ...(tirar ? { tirar_labels: tirar } : {}), ...(prazo !== undefined ? { prazo_em: prazo } : {}) };
}

const ehErro = (v: unknown): v is ErroOp => ehObjeto(v) && typeof v.erro === "string";

/** Uma op do catálogo (criar_label, editar_label, remover_label). */
export function lerOpLabel(v: Record<string, unknown>): OpLabel | ErroOp {
  if (v.cor !== undefined && !ehCorLabel(v.cor)) return { erro: `cor: ${CORES_LABEL.join(", ")}` };
  const cor = v.cor as CorLabel | undefined;
  switch (v.tipo) {
    case "criar_label": {
      const nome = nomeDeLabel(v.nome, "nome");
      if (ehErro(nome)) return nome;
      return { tipo: "criar_label", nome, ...(cor ? { cor } : {}) };
    }
    case "editar_label": {
      const label = nomeDeLabel(v.label, "label");
      if (ehErro(label)) return label;
      const nome = v.nome === undefined ? undefined : nomeDeLabel(v.nome, "nome");
      if (ehErro(nome)) return nome;
      if (nome === undefined && !cor) return { erro: "editar_label precisa de nome ou cor" };
      return { tipo: "editar_label", label, ...(nome ? { nome } : {}), ...(cor ? { cor } : {}) };
    }
    case "remover_label": {
      const label = nomeDeLabel(v.label, "label");
      if (ehErro(label)) return label;
      return { tipo: "remover_label", label };
    }
    default:
      return { erro: `tipo desconhecido: ${String(v.tipo)}` };
  }
}

/** A label do catálogo por id ou nome (sem caixa). */
export function acharLabel<T extends LabelDto>(catalogo: readonly T[], ref: string): T | null {
  const r = ref.trim();
  if (UUID.test(r)) return catalogo.find((l) => l.id === r.toLowerCase()) ?? null;
  return catalogo.find((l) => chave(l.nome) === chave(r)) ?? null;
}

/** O nome não pode repetir outra label do quadro (sem caixa). `menos` = a própria, ao renomear. */
export function nomeRepetidoNoCatalogo(catalogo: readonly LabelDto[], nome: string, menos?: string): boolean {
  return catalogo.some((l) => l.id !== menos && chave(l.nome) === chave(nome));
}

export type LabelsResolvidas = { ops: OpQuadro[]; novas: LabelDto[] };

/**
 * Troca, nas ops de tarefa, cada label (nome ou id) pelo id do catálogo. O nome que não existe vira label nova (`novas`,
 * com o id de `gerarId` e a cor padrão do nome), a não ser que `podeCriar` seja false (o turno sujo ou o bot sozinho:
 * o nome de uma label entra no turno das tarefas, como o nome de uma coluna). Tirar uma label que não existe não cria
 * nada (só some da lista). Puro: o caso de uso grava `novas` só depois que o lote passou.
 */
export function resolverLabelsDasOps(ops: readonly OpQuadro[], catalogo: readonly LabelDto[], gerarId: () => string, podeCriar: boolean): LabelsResolvidas | (ErroOp & { indice: number }) {
  const todas: LabelDto[] = [...catalogo];
  const novas: LabelDto[] = [];
  const out: OpQuadro[] = [];
  const ids = (refs: readonly string[] | undefined, criar: boolean): string[] | undefined | ErroOp => {
    if (refs === undefined) return undefined;
    const r: string[] = [];
    for (const ref of refs) {
      let l = acharLabel(todas, ref);
      if (!l && criar) {
        if (UUID.test(ref.trim())) return { erro: `label ${ref} não está no quadro` };
        if (!podeCriar) return { erro: `a label "${normalizarNomeLabel(ref)}" não existe e só se cria num turno limpo, a pedido da pessoa: use uma das labels do quadro` };
        if (todas.length >= LIMITES_LABEL.porQuadro) return { erro: `o quadro já tem ${LIMITES_LABEL.porQuadro} labels: remova alguma antes de criar outra` };
        l = { id: gerarId(), nome: normalizarNomeLabel(ref), cor: corPadraoDaLabel(ref) };
        todas.push(l);
        novas.push(l);
      }
      if (l && !r.includes(l.id)) r.push(l.id);
    }
    return r;
  };
  for (const [indice, op] of ops.entries()) {
    if (op.tipo !== "criar_tarefa" && op.tipo !== "mudar_tarefa") { out.push(op); continue; }
    const labels = ids(op.labels, true);
    if (ehErro(labels)) return { ...labels, indice };
    const por = ids(op.por_labels, true);
    if (ehErro(por)) return { ...por, indice };
    const tirar = ids(op.tirar_labels, false);
    if (ehErro(tirar)) return { ...tirar, indice };
    out.push({ ...op, ...(labels ? { labels } : {}), ...(por ? { por_labels: por } : {}), ...(tirar ? { tirar_labels: tirar } : {}) });
  }
  return { ops: out, novas };
}

/** As op tem algum campo de label ou prazo (o limite do bot sozinho e o turno sujo leem). */
export const mexeEmLabelOuPrazo = (op: CamposDeLabel): boolean => op.labels !== undefined || op.por_labels !== undefined || op.tirar_labels !== undefined || op.prazo_em !== undefined;

/** O conjunto novo de labels da tarefa (ids já resolvidos): `labels` troca tudo, depois soma `por` e tira `tirar`. */
export function aplicarLabels(atuais: readonly string[], c: CamposDeLabel): string[] {
  let r = c.labels ? [...c.labels] : [...atuais];
  for (const id of c.por_labels ?? []) if (!r.includes(id)) r.push(id);
  if (c.tirar_labels) r = r.filter((id) => !c.tirar_labels!.includes(id));
  return r.slice(0, LIMITES_LABEL.porTarefa);
}

/** As labels da tarefa como a tela e o bot leem, na ordem do catálogo (id que saiu do catálogo some). */
export function labelsDaTarefa(ids: readonly string[] | undefined, catalogo: readonly LabelDto[]): LabelDto[] {
  if (!ids || ids.length === 0) return [];
  return catalogo.filter((l) => ids.includes(l.id));
}

/** O prazo da tarefa no texto do turno ("12/11/2026"). */
export function prazoDaTarefaLegivel(prazo: string): string {
  const [a, m, d] = prazo.split("-");
  return `${d}/${m}/${a}`;
}
