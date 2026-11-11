/**
 * Labels e prazo na tarefa aberta (definido em 2026-11-10), no computador (o painel Propriedades) e no celular (logo
 * abaixo dos chips). Sutil: a label é um chip de contorno com um ponto da cor (nunca fundo chapado); o prazo é um campo
 * de data simples, com "Limpar". Adicionar label é um campo com a lista das do quadro (datalist): Enter aplica, e um nome
 * que não existe cria a label (como no Linear). Os toques voltam por data-act/data-form/data-campo para
 * web/lib/quadro-na-tela.ts, que manda o mesmo quadro.mudar_tarefa da conversa (labels, por_labels, tirar_labels, prazo_em).
 * Todo texto de fora passa por `esc`.
 */
import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { CorLabel, LabelDto } from "../../src/contracts/quadro-labels.ts";
import { esc } from "../lib/escape.ts";
import { rotuloDoPrazo } from "../lib/filtros-de-campo.ts";

/** As nove cores da paleta (o ponto pega a tinta dos mascotes pelo CSS: `.qd-label-ponto[data-cor]`). */
const CORES: readonly CorLabel[] = ["cinza", "azul", "verde", "ambar", "laranja", "vermelho", "rosa", "violeta", "turquesa"];
const cor = (c: string): CorLabel => (CORES.includes(c as CorLabel) ? (c as CorLabel) : "cinza");

/** Um chip de label (só leitura): o ponto e o nome. O card e o filtro podem reusar. */
export function chipDeLabel(l: LabelDto, tirar?: { tarefaId: string }): string {
  const x = tirar ? `<button type="button" class="qd-label-x" data-act="label-tirar" data-id="${esc(tirar.tarefaId)}" data-label="${esc(l.id)}" aria-label="Tirar a label ${esc(l.nome)}">×</button>` : "";
  return `<li class="qd-label"><span class="qd-label-ponto" data-cor="${cor(l.cor)}" aria-hidden="true"></span><span class="qd-label-nome">${esc(l.nome)}</span>${x}</li>`;
}

/** As labels da tarefa (com ×) e o campo de adicionar (busca nas do quadro; nome novo cria). */
export function campoDeLabels(t: Pick<TarefaDto, "id" | "labels">, q: Pick<QuadroDto, "labels">, onde: "lado" | "cel"): string {
  const da = t.labels ?? [];
  const resto = (q.labels ?? []).filter((l) => !da.some((x) => x.id === l.id));
  const id = `qd-t-label-${onde}`;
  const chips = da.length ? `<ul class="qd-labels" aria-label="Labels">${da.map((l) => chipDeLabel(l, { tarefaId: t.id })).join("")}</ul>` : "";
  return `<div class="qd-labels-campo">${chips}` +
    `<form class="qd-label-form" data-form="label-por" data-id="${esc(t.id)}"><label class="qd-sr" for="${id}">Adicionar label</label>` +
    `<input id="${id}" class="qd-label-in" name="label" list="${id}-lista" maxlength="40" placeholder="${da.length ? "Mais uma label" : "Adicionar label"}" autocomplete="off" enterkeyhint="done">` +
    `<datalist id="${id}-lista">${resto.map((l) => `<option value="${esc(l.nome)}"></option>`).join("")}</datalist></form></div>`;
}

/** O prazo da tarefa: o campo de data, como ele fica ("Hoje", "Vencida há 2 dias") e o Limpar. */
export function campoDePrazo(t: Pick<TarefaDto, "id" | "prazoEm">, o: { agora: number; fuso: string; onde: "lado" | "cel" }): string {
  const id = `qd-t-prazo-em-${o.onde}`;
  const r = t.prazoEm ? rotuloDoPrazo(t.prazoEm, o.agora, o.fuso) : null;
  return `<div class="qd-prazo-t"><label class="qd-sr" for="${id}">Prazo da tarefa</label>` +
    `<input type="date" id="${id}" class="qd-data" data-campo="prazo-tarefa" data-id="${esc(t.id)}" value="${esc(t.prazoEm ?? "")}">` +
    (r ? `<span class="qd-prazo-tom" data-tom="${r.tom}">${esc(r.texto)}</span><button type="button" class="qd-link qd-prazo-limpar" data-act="prazo-tarefa-limpar" data-id="${esc(t.id)}">Limpar</button>` : "") +
    `</div>`;
}

/** As duas linhas no painel Propriedades do computador (dt/dd). */
export function propriedadesDeLabelEPrazo(t: TarefaDto, q: QuadroDto, o: { agora: number; fuso: string; /** Só estas (a lateral esconde a vazia); ausente = as duas. */ so?: ReadonlySet<PropriedadeOpcional> }): string {
  return (!o.so || o.so.has("labels") ? `<dt>Labels</dt><dd>${campoDeLabels(t, q, "lado")}</dd>` : "") +
    (!o.so || o.so.has("prazo") ? `<dt><label for="qd-t-prazo-em-lado">Prazo</label></dt><dd>${campoDePrazo(t, { agora: o.agora, fuso: o.fuso, onde: "lado" })}</dd>` : "");
}

/* ---------- 2026-11-10 (a issue do Multica): a propriedade vazia some; "+ Propriedade" a traz de volta ---------- */

/** As propriedades que se escondem vazias e que o "+ Propriedade" traz (as editáveis aqui). */
export type PropriedadeOpcional = "prioridade" | "labels" | "prazo";
export const PROPRIEDADES_OPCIONAIS: readonly { id: PropriedadeOpcional; nome: string; foco: string }[] = [
  { id: "prioridade", nome: "Prioridade", foco: "qd-t-pri" },
  { id: "labels", nome: "Labels", foco: "qd-t-label-lado" },
  { id: "prazo", nome: "Prazo", foco: "qd-t-prazo-em-lado" },
];

/** A propriedade está vazia na tarefa (Prioridade "sem", nenhuma label, sem prazo). */
export function propriedadeVazia(t: Pick<TarefaDto, "prioridade" | "labels" | "prazoEm">, p: PropriedadeOpcional): boolean {
  if (p === "prioridade") return !t.prioridade || t.prioridade === "sem";
  if (p === "labels") return !(t.labels ?? []).length;
  return !t.prazoEm;
}

/** As que aparecem: as preenchidas e as que a pessoa trouxe pelo menu nesta tela (estado só local). */
export function propriedadesAVista(t: Pick<TarefaDto, "prioridade" | "labels" | "prazoEm">, mostradas: ReadonlySet<string>): Set<PropriedadeOpcional> {
  return new Set(PROPRIEDADES_OPCIONAIS.map((p) => p.id).filter((id) => !propriedadeVazia(t, id) || mostradas.has(id)));
}

/**
 * O "+ Propriedade" (discreto, como um link) e o menu das escondidas. Escolher uma a mostra com o campo focado; preencher
 * a mantém (deixa de estar vazia). Sem nenhuma escondida, nada.
 */
export function maisPropriedade(escondidas: readonly PropriedadeOpcional[], aberto: boolean): string {
  if (!escondidas.length) return "";
  const itens = PROPRIEDADES_OPCIONAIS.filter((p) => escondidas.includes(p.id));
  const menu = aberto ? `<div class="ta-prop-menu" role="menu" aria-label="Mostrar propriedade">${itens.map((p) => `<button type="button" role="menuitem" class="ta-prop-op" data-act="prop-mostrar" data-prop="${p.id}">${esc(p.nome)}</button>`).join("")}</div>` : "";
  return `<div class="ta-prop-mais"><button type="button" class="qd-link ta-prop-bt" data-act="prop-menu" aria-haspopup="menu" aria-expanded="${aberto}">+ Propriedade</button>${menu}</div>`;
}

/** No celular: uma seção curta abaixo dos chips (os alvos têm 44 px pelo CSS do celular). */
export function secaoDeLabelEPrazoCelular(t: TarefaDto, q: QuadroDto, o: { agora: number; fuso: string }): string {
  return `<section class="qd-t-campos" aria-label="Labels e prazo">${campoDeLabels(t, q, "cel")}${campoDePrazo(t, { ...o, onde: "cel" })}</section>`;
}
