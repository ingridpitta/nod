/**
 * Quadro minimalista (definido em 2026-11-10, pedido do Marlon; referência: o funil do Multica). Os campos do painel de
 * Filtros, cada um descrito por um DESCRITOR: o nome, os valores (do quadro ou fixos), o predicado puro e se há dado para
 * mostrá-lo. O painel (web/telas/opcoes-quadro.ts) só lista os descritores com dado; cada campo tem o modo "é / não é".
 *
 * Extensível: Label e Prazo já estão na lista, escondidos enquanto as tarefas não trazem `labels` / `prazo` (outra frente
 * cria esses campos no banco). Quando ela entregar os predicados puros (porLabel, porPrazo), quem integra os passa a
 * `camposDoFiltro({ porLabel, porPrazo })`; até lá valem os de reserva daqui, com a mesma assinatura.
 */
import type { TarefaDto } from "../../src/contracts/quadro.ts";
import type { CampoDoFiltro as CampoDoContrato, Prioridade } from "../../src/contracts/quadro-opcoes.ts";
import { ehComigo, normalizar, trabalhandoAgora } from "./vista-do-quadro.ts";
import type { ColunaDto } from "../../src/contracts/quadro.ts";

const PRIORIDADES_F: readonly Prioridade[] = ["sem", "urgente", "alta", "media", "baixa"];
const NOME_PRI: Readonly<Record<Prioridade, string>> = { sem: "Sem prioridade", urgente: "Urgente", alta: "Alta", media: "Média", baixa: "Baixa" };

/** Uma label da tarefa, como a outra frente deve entregar no DTO (ausente = a tarefa de antes, sem labels). */
export interface LabelDaTarefa { id: string; nome: string; cor?: string | null }
/**
 * A tarefa como o filtro a lê: o DTO de hoje mais os campos que a outra frente vai trazer. `prazo`: "AAAA-MM-DD" (ou epoch
 * ms); null = sem prazo; ausente = o servidor ainda não manda prazo (o campo fica escondido).
 */
export type TarefaDoFiltro = TarefaDto & { prazo?: string | number | null };
/** O prazo da tarefa: o `prazoEm` do DTO (0161) ou o `prazo` de antes. */
export const prazoDa = (t: TarefaDoFiltro): string | number | null | undefined => ("prazo" in t ? t.prazo : t.prazoEm);

/** Os campos do funil, na ordem do menu (Label e Prazo só aparecem com dado). */
export const CAMPOS_DO_FILTRO = ["tipo", "status", "agente", "prioridade", "responsavel", "criador", "relacao", "data", "label", "prazo"] as const satisfies readonly CampoDoContrato[];
export type CampoDoFiltro = (typeof CAMPOS_DO_FILTRO)[number];
/* 2026-11-10: a lista mora também no contrato (o servidor valida os filtros lembrados); o Exato quebra o typecheck se divergir. */
type Exato<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _mesmosCampos: Exato<CampoDoFiltro, CampoDoContrato> = true;
void _mesmosCampos;
/** Uma condição: campo = valor. Dentro do mesmo campo vale qualquer uma (OU); entre campos, todas (E). */
export interface CondicaoDoFiltro { campo: CampoDoFiltro; valor: string }
/** O modo de cada campo: "é" (o padrão) ou "não é" (a tarefa passa quando NENHUM dos valores escolhidos casa). */
export type ModoDoCampo = "e" | "nao";
/** Quem lê o quadro (para "Relação comigo") e o relógio (para "Data" e "Prazo"). */
export interface ContextoDoFiltro { pessoaId: string | null; dona: boolean; agora: number; /** T5: as travas das colunas ("só a pessoa" conta como comigo). */ colunas?: readonly Pick<ColunaDto, "id" | "trava">[] }

export interface ValorDoCampo { valor: string; nome: string }
/** O predicado puro de um campo: a tarefa casa com aquele valor? */
export type PredicadoDeCampo = (t: TarefaDoFiltro, valor: string, ctx: ContextoDoFiltro) => boolean;

export interface DescritorDeCampo {
  campo: CampoDoFiltro;
  nome: string;
  /** Os valores possíveis; os que dependem do quadro (colunas, responsáveis, quem pediu, labels) vêm de `tarefas`. */
  valores: (tarefas: readonly TarefaDoFiltro[]) => ValorDoCampo[];
  passa: PredicadoDeCampo;
  /** Há dado para mostrar o campo (padrão: sempre). Label e Prazo só com o campo vindo do servidor. */
  temDado?: (tarefas: readonly TarefaDoFiltro[]) => boolean;
}

const DIA = 86_400_000;
const meiaNoite = (ms: number): number => new Date(new Date(ms).setHours(0, 0, 0, 0)).getTime();

/**
 * O responsável do card: o id do bot ou "sem". revisto em 2026-11-10 (ADR-162): a tarefa que espera a pessoa continua com
 * o mesmo responsável (a espera é a marca, não "Você" no lugar do bot); "esperando por mim" é o campo Relação comigo.
 */
export const responsavelDe = (t: Pick<TarefaDto, "agenteId">): string => t.agenteId ?? "sem";
/** Quem pediu a tarefa: a pessoa (id) ou "bot" (sem pedidoPor: o bot sozinho ou a dona antes da 0146). */
export const criadorDe = (t: Pick<TarefaDto, "pedidoPor">): string => t.pedidoPor ?? "bot";

/** O prazo em epoch ms (meia-noite local do dia); null = sem prazo ou ilegível. */
export function prazoEmMs(p: string | number | null | undefined): number | null {
  if (p === null || p === undefined || p === "") return null;
  if (typeof p === "number") return Number.isFinite(p) ? meiaNoite(p) : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(p);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export const VALORES_DO_PRAZO: readonly ValorDoCampo[] = [
  { valor: "vencida", nome: "Vencida" }, { valor: "hoje", nome: "Vence hoje" }, { valor: "semana", nome: "Vence esta semana" },
  { valor: "proximos7", nome: "Vence nos próximos 7 dias" }, { valor: "sem", nome: "Sem prazo" },
];

/** Reserva de porPrazo (a outra frente entrega o dela): vencida, hoje, esta semana (até domingo), próximos 7 dias, sem prazo. */
export const porPrazoReserva: PredicadoDeCampo = (t, valor, ctx) => {
  const p = prazoEmMs(prazoDa(t));
  if (valor === "sem") return p === null;
  if (p === null) return false;
  const hoje = meiaNoite(ctx.agora);
  if (valor === "vencida") return p < hoje;
  if (valor === "hoje") return p === hoje;
  if (valor === "proximos7") return p >= hoje && p <= hoje + 7 * DIA;
  if (valor === "semana") { const dow = new Date(hoje).getDay(); return p >= hoje && p <= hoje + ((7 - dow) % 7) * DIA; }
  return false;
};
/** Reserva de porLabel: a tarefa tem a label (pelo id); "sem" = sem label nenhuma. */
export const porLabelReserva: PredicadoDeCampo = (t, valor) => (valor === "sem" ? !t.labels?.length : !!t.labels?.some((l) => l.id === valor));

const fixos = (vs: readonly ValorDoCampo[]) => (): ValorDoCampo[] => [...vs];
const unicos = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * Os descritores, na ordem do menu. `porLabel` / `porPrazo`: os predicados da frente de Labels e Prazo (sem eles, os de
 * reserva). Os nomes de colunas, bots e pessoas vêm de quem desenha (o valor aqui é o id); quem desenha troca o nome.
 */
export function camposDoFiltro(o: { porLabel?: PredicadoDeCampo; porPrazo?: PredicadoDeCampo } = {}): DescritorDeCampo[] {
  return [
    { campo: "tipo", nome: "Tipo de responsável", valores: fixos([{ valor: "agente", nome: "Agente" }, { valor: "sem", nome: "Sem responsável" }]),
      passa: (t, v) => (responsavelDe(t) === "sem") === (v === "sem") },
    { campo: "status", nome: "Status", valores: (ts) => unicos(ts.map((t) => t.status)).map((s) => ({ valor: s, nome: s })), passa: (t, v) => t.status === v },
    { campo: "agente", nome: "Status do agente", valores: fixos([{ valor: "rodando", nome: "Trabalhando agora" }, { valor: "fila", nome: "Na fila" }, { valor: "falhou", nome: "Falhou" }]),
      passa: (t, v) => (v === "rodando" ? trabalhandoAgora(t) : t.execucao === v) },
    { campo: "prioridade", nome: "Prioridade", valores: fixos(PRIORIDADES_F.map((p) => ({ valor: p, nome: NOME_PRI[p] }))),
      passa: (t, v) => ((PRIORIDADES_F as readonly unknown[]).includes(t.prioridade) ? t.prioridade : "sem") === v },
    { campo: "responsavel", nome: "Responsável", valores: (ts) => unicos(ts.map(responsavelDe)).map((r) => ({ valor: r, nome: r })), passa: (t, v) => responsavelDe(t) === v },
    { campo: "criador", nome: "Criado por", valores: (ts) => unicos(ts.map(criadorDe)).map((c) => ({ valor: c, nome: c })),
      passa: (t, v, ctx) => criadorDe(t) === v || (v === ctx.pessoaId && ctx.dona && !t.pedidoPor) },
    { campo: "relacao", nome: "Relação comigo", valores: fixos([{ valor: "comigo", nome: "Esperando por mim" }, { valor: "criadas", nome: "Criadas por mim" }]),
      // T5: "Esperando por mim" é o mesmo Comigo do filtro rápido e da pílula (a pergunta, Bloqueado e "só a pessoa").
      passa: (t, v, ctx) => (v === "comigo" ? ehComigo(t, ctx.colunas ?? []) : !!ctx.pessoaId && (t.pedidoPor === ctx.pessoaId || (!t.pedidoPor && ctx.dona))) },
    { campo: "data", nome: "Data", valores: fixos([
      { valor: "criada:1", nome: "Criada hoje" }, { valor: "criada:7", nome: "Criada nos últimos 7 dias" }, { valor: "criada:30", nome: "Criada nos últimos 30 dias" },
      { valor: "atualizada:1", nome: "Atualizada hoje" }, { valor: "atualizada:7", nome: "Atualizada nos últimos 7 dias" }, { valor: "atualizada:30", nome: "Atualizada nos últimos 30 dias" }]),
      passa: (t, v, ctx) => {
        const [qual, dias] = v.split(":");
        const n = Number(dias);
        if (!Number.isFinite(n) || n <= 0) return true;
        // "Hoje" = desde a meia-noite local; 7 e 30 dias = a janela corrida.
        return (qual === "atualizada" ? t.mudadoEm : t.criadoEm) >= (n === 1 ? meiaNoite(ctx.agora) : ctx.agora - n * DIA);
      } },
    { campo: "label", nome: "Label", passa: o.porLabel ?? porLabelReserva,
      valores: (ts) => { const m = new Map<string, string>(); for (const t of ts) for (const l of t.labels ?? []) if (!m.has(l.id)) m.set(l.id, l.nome); return [...[...m].map(([valor, nome]) => ({ valor, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), { valor: "sem", nome: "Sem label" }]; },
      temDado: (ts) => ts.some((t) => !!t.labels?.length) },
    { campo: "prazo", nome: "Prazo", passa: o.porPrazo ?? porPrazoReserva, valores: fixos(VALORES_DO_PRAZO), temDado: (ts) => ts.some((t) => prazoDa(t) !== undefined) },
  ];
}

/** Os descritores padrão (com os predicados de reserva). */
export const CAMPOS_PADRAO: readonly DescritorDeCampo[] = camposDoFiltro();
export const NOME_DO_CAMPO: Readonly<Record<CampoDoFiltro, string>> = Object.fromEntries(CAMPOS_PADRAO.map((d) => [d.campo, d.nome])) as Record<CampoDoFiltro, string>;

/**
 * A tarefa passa nos filtros: por campo, "é" = casa com algum valor escolhido; "não é" = não casa com nenhum. Entre
 * campos, todos. Campo sem valor escolhido não filtra (o modo sozinho não esconde nada).
 */
export function passaNosFiltros(t: TarefaDoFiltro, filtros: readonly CondicaoDoFiltro[], ctx: ContextoDoFiltro, negados: readonly CampoDoFiltro[] = [], campos: readonly DescritorDeCampo[] = CAMPOS_PADRAO): boolean {
  if (!filtros.length) return true;
  const porCampo = new Map<CampoDoFiltro, string[]>();
  for (const f of filtros) porCampo.set(f.campo, [...(porCampo.get(f.campo) ?? []), f.valor]);
  for (const [campo, valores] of porCampo) {
    const d = campos.find((x) => x.campo === campo);
    if (!d) continue;
    const casa = valores.some((v) => d.passa(t, v, ctx));
    if (negados.includes(campo) ? casa : !casa) return false;
  }
  return true;
}

/** Liga ou desliga uma condição (o clique no item do submenu). */
export function alternarCondicao(filtros: readonly CondicaoDoFiltro[], c: CondicaoDoFiltro): CondicaoDoFiltro[] {
  const tem = filtros.some((f) => f.campo === c.campo && f.valor === c.valor);
  return tem ? filtros.filter((f) => !(f.campo === c.campo && f.valor === c.valor)) : [...filtros, c];
}

export const ehCampo = (v: unknown): v is CampoDoFiltro => (CAMPOS_DO_FILTRO as readonly unknown[]).includes(v);
export function ehCondicao(v: { campo?: unknown; valor?: unknown }): v is CondicaoDoFiltro {
  return ehCampo(v.campo) && typeof v.valor === "string" && v.valor.length > 0 && v.valor.length <= 80;
}

/** Os chips dos filtros ligados: um por campo ("Status: A fazer, Fazendo" ou "Status não é: Feito"), na ordem dos campos. */
export function chipsDosFiltros(filtros: readonly CondicaoDoFiltro[], nomeDoValor: (c: CondicaoDoFiltro) => string, negados: readonly CampoDoFiltro[] = []): { campo: CampoDoFiltro; texto: string }[] {
  return CAMPOS_DO_FILTRO.flatMap((campo) => {
    const vs = filtros.filter((f) => f.campo === campo);
    return vs.length ? [{ campo, texto: `${NOME_DO_CAMPO[campo]}${negados.includes(campo) ? " não é" : ""}: ${vs.map(nomeDoValor).join(", ")}` }] : [];
  });
}

/** Os itens do funil que casam com o que a pessoa digitou (o campo ou o valor, sem acento nem caixa). */
export function casaComBusca(termo: string, ...textos: string[]): boolean {
  const t = normalizar(termo.trim());
  return !t || textos.some((x) => normalizar(x).includes(t));
}
