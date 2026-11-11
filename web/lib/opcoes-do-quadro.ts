/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon; referência: o board do Multica). A parte pura das Opções
 * do quadro (visão, agrupar, ordenar, colunas à mostra, propriedades do card) e dos Filtros por campo. Quem guarda o
 * estado é web/lib/barra-do-quadro.ts; quem desenha, web/telas/opcoes-quadro.ts e web/telas/quadro-real.ts.
 *
 * As Opções vão para as preferências de quem lê (o mesmo Exibir da 0149, por quadro). Os Filtros ficam na memória da tela
 * (por quadro, enquanto a página está aberta): são do momento, como a busca.
 */
import type { ExibirDoQuadro } from "../../src/contracts/raio-x.ts";
import type { TarefaDto } from "../../src/contracts/quadro.ts";
import type { AgrupamentoDoQuadro, OrdemDoQuadro, Prioridade, PropriedadeDoCard, VistaDoQuadro } from "../../src/contracts/quadro-opcoes.ts";

/* As listas do contrato (src/contracts/quadro-opcoes.ts), repetidas aqui porque a web só faz `import type` de src/
   (ADR-018). O `satisfies` e o `Exato` abaixo quebram o typecheck se uma das duas mudar sem a outra. */
type Exato<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const PRIORIDADES = ["sem", "urgente", "alta", "media", "baixa"] as const satisfies readonly Prioridade[];
export const VISTAS_DO_QUADRO = ["quadro", "lista"] as const satisfies readonly VistaDoQuadro[];
export const AGRUPAMENTOS_DO_QUADRO = ["status", "responsavel"] as const satisfies readonly AgrupamentoDoQuadro[];
export const ORDENS_DO_QUADRO = ["manual", "criacao", "atualizacao", "prioridade", "titulo", "prazo"] as const satisfies readonly OrdemDoQuadro[];
export const PROPRIEDADES_DO_CARD = ["prioridade", "descricao", "responsavel", "datas", "linear", "pr", "comentarios", "labels", "prazo"] as const satisfies readonly PropriedadeDoCard[];
export const PROPRIEDADES_PADRAO: readonly PropriedadeDoCard[] = ["prioridade", "responsavel", "datas", "linear", "pr", "labels", "prazo"];
export const LIMITES_OPCOES = { ocultas: 30, idColuna: 60, filtros: 50, valorDoFiltro: 200 } as const;
const _completas: [Exato<(typeof PRIORIDADES)[number], Prioridade>, Exato<(typeof VISTAS_DO_QUADRO)[number], VistaDoQuadro>, Exato<(typeof AGRUPAMENTOS_DO_QUADRO)[number], AgrupamentoDoQuadro>,
  Exato<(typeof ORDENS_DO_QUADRO)[number], OrdemDoQuadro>, Exato<(typeof PROPRIEDADES_DO_CARD)[number], PropriedadeDoCard>] = [true, true, true, true, true];
void _completas;
export const PESO_DA_PRIORIDADE: Readonly<Record<Prioridade, number>> = { urgente: 4, alta: 3, media: 2, baixa: 1, sem: 0 };
export const NOME_DA_PRIORIDADE: Readonly<Record<Prioridade, string>> = { sem: "Sem prioridade", urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };

/** As Opções como a tela usa: tudo resolvido (o ausente vira o padrão; o valor desconhecido, também). */
export interface OpcoesEfetivas {
  vista: VistaDoQuadro;
  agrupar: AgrupamentoDoQuadro;
  ordenar: OrdemDoQuadro;
  inverter: boolean;
  ocultas: ReadonlySet<string>;
  props: ReadonlySet<PropriedadeDoCard>;
}

const de = <T extends string>(lista: readonly T[], v: unknown, padrao: T): T => (lista as readonly unknown[]).includes(v) ? (v as T) : padrao;

export function opcoesEfetivas(e: Partial<ExibirDoQuadro> | null | undefined): OpcoesEfetivas {
  const props = Array.isArray(e?.propriedades) ? e.propriedades.filter((p) => (PROPRIEDADES_DO_CARD as readonly string[]).includes(p)) : PROPRIEDADES_PADRAO;
  return {
    vista: de(VISTAS_DO_QUADRO, e?.vista, "quadro"),
    agrupar: de(AGRUPAMENTOS_DO_QUADRO, e?.agrupar, "status"),
    ordenar: de(ORDENS_DO_QUADRO, e?.ordenar, "manual"),
    inverter: e?.inverter === true,
    ocultas: new Set(Array.isArray(e?.ocultas) ? e.ocultas : []),
    props: new Set(props),
  };
}

/** As Opções mudaram do padrão (o ponto discreto no ícone). */
export function opcoesAjustadas(o: OpcoesEfetivas): boolean {
  const padrao = new Set(PROPRIEDADES_PADRAO);
  return o.vista !== "quadro" || o.agrupar !== "status" || o.ordenar !== "manual" || o.inverter || o.ocultas.size > 0
    || o.props.size !== padrao.size || [...o.props].some((p) => !padrao.has(p));
}

export const NOME_DA_ORDEM: Readonly<Record<OrdemDoQuadro, string>> = { manual: "Manual", criacao: "Data de criação", atualizacao: "Atualização", prioridade: "Prioridade", titulo: "Título", prazo: "Prazo" };
/** 2026-11-10 (o "Switch to Manual ordering" do Multica): soltar o card na própria coluna fora do Manual diz por que a ordem não muda. */
export const dicaDaOrdem = (o: OrdemDoQuadro): string => `A ordem segue ${NOME_DA_ORDEM[o]}: para reordenar à mão, volte para Manual nas Opções do quadro.`;
export const NOME_DO_AGRUPAMENTO: Readonly<Record<AgrupamentoDoQuadro, string>> = { status: "Status", responsavel: "Responsável" };
export const NOME_DA_PROPRIEDADE: Readonly<Record<PropriedadeDoCard, string>> = { prioridade: "Prioridade", descricao: "Descrição", responsavel: "Responsável", datas: "Datas", linear: "Linear", pr: "PR", comentarios: "Comentários", labels: "Labels", prazo: "Prazo" };

/** A prioridade de uma tarefa (a de antes da 0160, ou um valor desconhecido, é "sem"). */
export const prioridadeDe = (t: Pick<TarefaDto, "prioridade">): Prioridade => de(PRIORIDADES, t.prioridade, "sem");

/** O prazo da tarefa em número para ordenar (AAAA-MM-DD ou epoch ms); sem prazo = null. */
function prazoParaOrdenar(t: Pick<TarefaDto, "prazoEm"> & { prazo?: string | number | null }): number | null {
  const p = "prazo" in t && t.prazo !== undefined ? t.prazo : t.prazoEm;
  if (p === null || p === undefined || p === "") return null;
  const n = typeof p === "number" ? p : Date.parse(`${p}T00:00:00Z`);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ordena uma lista de tarefas (estável). Manual = a ordem do quadro (a de arrastar). Criação e atualização: a mais nova
 * primeiro; prioridade: urgente primeiro (sem prioridade por último); título: A→Z; prazo (2026-11-10): o mais perto
 * primeiro. `inverter` vira o sentido; sem prazo fica por último nos dois sentidos.
 */
export function ordenarTarefas<T extends Pick<TarefaDto, "ordem" | "criadoEm" | "mudadoEm" | "titulo" | "prioridade"> & Partial<Pick<TarefaDto, "prazoEm">>>(ts: readonly T[], ordem: OrdemDoQuadro, inverter = false): T[] {
  if (ordem === "prazo") {
    const com = ts.filter((t) => prazoParaOrdenar(t) !== null);
    const sem = ts.filter((t) => prazoParaOrdenar(t) === null);
    const sentido = inverter ? -1 : 1;
    return [...com.map((t, i) => ({ t, i })).sort((a, b) => sentido * (prazoParaOrdenar(a.t)! - prazoParaOrdenar(b.t)!) || a.i - b.i).map((x) => x.t), ...sem];
  }
  const chave = (a: T, b: T): number => {
    switch (ordem) {
      case "criacao": return b.criadoEm - a.criadoEm;
      case "atualizacao": return b.mudadoEm - a.mudadoEm;
      case "prioridade": return PESO_DA_PRIORIDADE[prioridadeDe(b)] - PESO_DA_PRIORIDADE[prioridadeDe(a)];
      case "titulo": return a.titulo.localeCompare(b.titulo, "pt-BR", { sensitivity: "base" });
      default: return a.ordem - b.ordem;
    }
  };
  const sentido = inverter ? -1 : 1;
  return ts.map((t, i) => ({ t, i })).sort((a, b) => sentido * chave(a.t, b.t) || a.i - b.i).map((x) => x.t);
}

/* ---------- Filtros por campo: os descritores moram em web/lib/campos-do-filtro.ts ---------- */
export * from "./campos-do-filtro.ts";
import { responsavelDe } from "./campos-do-filtro.ts";

/* ---------- Agrupar por responsável ---------- */

export interface GrupoDeResponsavel { chave: string; tarefas: TarefaDto[] }

/** As tarefas por responsável: os bots (mais tarefas primeiro), depois "voce" e "sem". */
export function gruposPorResponsavel(ts: readonly TarefaDto[]): GrupoDeResponsavel[] {
  const m = new Map<string, TarefaDto[]>();
  for (const t of ts) { const k = responsavelDe(t); m.set(k, [...(m.get(k) ?? []), t]); }
  const peso = (k: string): number => (k === "sem" ? 2 : k === "voce" ? 1 : 0);
  return [...m].map(([chave, tarefas]) => ({ chave, tarefas })).sort((a, b) => peso(a.chave) - peso(b.chave) || b.tarefas.length - a.tarefas.length);
}

/** "há 5 min", "há 2 h", "há 3 d" (o "Atualizado há…" do card). */
export function haQuantoTempo(desde: number, agora: number): string {
  const min = Math.max(0, Math.floor((agora - desde) / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}
