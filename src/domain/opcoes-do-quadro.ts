/**
 * Quadro minimalista (definido em 2026-11-10): a validação das Opções do quadro (src/contracts/quadro-opcoes.ts), a
 * mesma no PUT /preferencias/quadros/:id/exibir (exibirDoQuadro) e na op `exibir` do gerir_quadro (paridade, ADR-135).
 * Cada campo é opcional; o que vem tem de ser do tipo certo. Devolve só os campos que vieram.
 */
import { AGRUPAMENTOS_DO_QUADRO, CAMPOS_DO_FILTRO, LIMITES_OPCOES, ORDENS_DO_QUADRO, PROPRIEDADES_DO_CARD, VISTAS_DO_QUADRO, type OpcoesDoQuadro } from "../contracts/quadro-opcoes.ts";

export const CAMPOS_DAS_OPCOES = ["vista", "agrupar", "ordenar", "inverter", "ocultas", "propriedades", "filtros", "negados", "rapido"] as const;
/** O filtro rápido: Todas, Comigo, Trabalhando ou um agente (o id, até 80). */
const RAPIDO = /^(todos|comigo|trabalhando|agente:[^\s]{1,80})$/;

const umDe = (lista: readonly string[], v: unknown): boolean => typeof v === "string" && lista.includes(v);

export function lerOpcoesDoQuadro(v: Record<string, unknown>): OpcoesDoQuadro | { erro: string } {
  const r: OpcoesDoQuadro = {};
  if (v.vista !== undefined) {
    if (!umDe(VISTAS_DO_QUADRO, v.vista)) return { erro: `vista: ${VISTAS_DO_QUADRO.join(" ou ")}` };
    r.vista = v.vista as OpcoesDoQuadro["vista"];
  }
  if (v.agrupar !== undefined) {
    if (!umDe(AGRUPAMENTOS_DO_QUADRO, v.agrupar)) return { erro: `agrupar: ${AGRUPAMENTOS_DO_QUADRO.join(" ou ")}` };
    r.agrupar = v.agrupar as OpcoesDoQuadro["agrupar"];
  }
  if (v.ordenar !== undefined) {
    if (!umDe(ORDENS_DO_QUADRO, v.ordenar)) return { erro: `ordenar: ${ORDENS_DO_QUADRO.join(", ")}` };
    r.ordenar = v.ordenar as OpcoesDoQuadro["ordenar"];
  }
  if (v.inverter !== undefined) {
    if (typeof v.inverter !== "boolean") return { erro: "inverter é true ou false" };
    r.inverter = v.inverter;
  }
  if (v.ocultas !== undefined) {
    const o = v.ocultas;
    if (!Array.isArray(o) || o.length > LIMITES_OPCOES.ocultas) return { erro: `ocultas é a lista dos ids das colunas (até ${LIMITES_OPCOES.ocultas})` };
    if (!o.every((x) => typeof x === "string" && x.trim().length > 0 && x.length <= LIMITES_OPCOES.idColuna)) return { erro: `ocultas: cada id é texto de 1 a ${LIMITES_OPCOES.idColuna} caracteres` };
    const ids = (o as string[]).map((x) => x.trim());
    if (new Set(ids).size !== ids.length) return { erro: "ocultas repete coluna" };
    r.ocultas = ids;
  }
  if (v.propriedades !== undefined) {
    const p = v.propriedades;
    if (!Array.isArray(p) || !p.every((x) => umDe(PROPRIEDADES_DO_CARD, x))) return { erro: `propriedades: lista de ${PROPRIEDADES_DO_CARD.join(", ")}` };
    if (new Set(p).size !== p.length) return { erro: "propriedades repete item" };
    r.propriedades = p as OpcoesDoQuadro["propriedades"];
  }
  // 2026-11-10: o funil e o filtro rápido lembrados por quadro.
  if (v.filtros !== undefined) {
    const f = v.filtros;
    if (!Array.isArray(f) || f.length > LIMITES_OPCOES.filtros) return { erro: `filtros é a lista de {campo, valor} (até ${LIMITES_OPCOES.filtros})` };
    const ok = f.every((x) => !!x && typeof x === "object" && umDe(CAMPOS_DO_FILTRO, (x as { campo?: unknown }).campo)
      && typeof (x as { valor?: unknown }).valor === "string" && (x as { valor: string }).valor.length > 0 && (x as { valor: string }).valor.length <= LIMITES_OPCOES.valorDoFiltro);
    if (!ok) return { erro: `filtros: campo é ${CAMPOS_DO_FILTRO.join(", ")} e valor é texto de 1 a ${LIMITES_OPCOES.valorDoFiltro}` };
    r.filtros = (f as { campo: NonNullable<OpcoesDoQuadro["filtros"]>[number]["campo"]; valor: string }[]).map((x) => ({ campo: x.campo, valor: x.valor }));
  }
  if (v.negados !== undefined) {
    const n = v.negados;
    if (!Array.isArray(n) || !n.every((x) => umDe(CAMPOS_DO_FILTRO, x)) || new Set(n).size !== n.length) return { erro: `negados: lista sem repetir de ${CAMPOS_DO_FILTRO.join(", ")}` };
    r.negados = n as OpcoesDoQuadro["negados"];
  }
  if (v.rapido !== undefined) {
    if (typeof v.rapido !== "string" || !RAPIDO.test(v.rapido)) return { erro: "rapido: todos, comigo, trabalhando ou agente:<id>" };
    r.rapido = v.rapido;
  }
  return r;
}

/** Quantos campos das Opções vieram (0 = nenhum). */
export const temOpcoes = (o: OpcoesDoQuadro): boolean => CAMPOS_DAS_OPCOES.some((k) => o[k] !== undefined);

const NOME_DA_ORDEM: Readonly<Record<NonNullable<OpcoesDoQuadro["ordenar"]>, string>> = { manual: "manual", criacao: "data de criação", atualizacao: "atualização", prioridade: "prioridade", titulo: "título", prazo: "prazo" };

/** As partes da frase do gerir_quadro exibir que dizem o que mudou nas Opções (vazio = nenhuma). */
export function fraseDasOpcoes(o: OpcoesDoQuadro): string[] {
  return [
    o.vista && `a visão no computador agora é ${o.vista === "lista" ? "Lista" : "Quadro"}`,
    o.agrupar && `agrupado por ${o.agrupar === "responsavel" ? "responsável" : "status"}`,
    o.ordenar && `ordenado por ${NOME_DA_ORDEM[o.ordenar]}`,
    o.inverter !== undefined && `a ordem ${o.inverter ? "invertida" : "na direção normal"}`,
    o.ocultas && (o.ocultas.length ? `${o.ocultas.length === 1 ? "1 coluna escondida" : `${o.ocultas.length} colunas escondidas`}` : "todas as colunas à mostra"),
    o.propriedades && (o.propriedades.length ? `o card mostra ${o.propriedades.join(", ")}` : "o card só com o título"),
    o.filtros && (o.filtros.length ? `${o.filtros.length === 1 ? "1 filtro" : `${o.filtros.length} filtros`} no funil` : "sem filtros no funil"),
    o.rapido && (o.rapido === "todos" ? "sem filtro rápido" : `filtro rápido ${o.rapido === "comigo" ? "Comigo" : o.rapido === "trabalhando" ? "Trabalhando" : "por agente"}`),
  ].filter((x): x is string => !!x);
}
