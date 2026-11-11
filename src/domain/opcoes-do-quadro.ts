/**
 * Quadro minimalista (definido em 2026-11-10): a validação das Opções do quadro (src/contracts/quadro-opcoes.ts), a
 * mesma no PUT /preferencias/quadros/:id/exibir (exibirDoQuadro) e na op `exibir` do gerir_quadro (paridade, ADR-135).
 * Cada campo é opcional; o que vem tem de ser do tipo certo. Devolve só os campos que vieram.
 */
import { AGRUPAMENTOS_DO_QUADRO, LIMITES_OPCOES, ORDENS_DO_QUADRO, PROPRIEDADES_DO_CARD, VISTAS_DO_QUADRO, type OpcoesDoQuadro } from "../contracts/quadro-opcoes.ts";

export const CAMPOS_DAS_OPCOES = ["vista", "agrupar", "ordenar", "inverter", "ocultas", "propriedades"] as const;

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
  return r;
}

/** Quantos campos das Opções vieram (0 = nenhum). */
export const temOpcoes = (o: OpcoesDoQuadro): boolean => CAMPOS_DAS_OPCOES.some((k) => o[k] !== undefined);

const NOME_DA_ORDEM: Readonly<Record<NonNullable<OpcoesDoQuadro["ordenar"]>, string>> = { manual: "manual", criacao: "data de criação", atualizacao: "atualização", prioridade: "prioridade", titulo: "título" };

/** As partes da frase do gerir_quadro exibir que dizem o que mudou nas Opções (vazio = nenhuma). */
export function fraseDasOpcoes(o: OpcoesDoQuadro): string[] {
  return [
    o.vista && `a visão no computador agora é ${o.vista === "lista" ? "Lista" : "Quadro"}`,
    o.agrupar && `agrupado por ${o.agrupar === "responsavel" ? "responsável" : "status"}`,
    o.ordenar && `ordenado por ${NOME_DA_ORDEM[o.ordenar]}`,
    o.inverter !== undefined && `a ordem ${o.inverter ? "invertida" : "na direção normal"}`,
    o.ocultas && (o.ocultas.length ? `${o.ocultas.length === 1 ? "1 coluna escondida" : `${o.ocultas.length} colunas escondidas`}` : "todas as colunas à mostra"),
    o.propriedades && (o.propriedades.length ? `o card mostra ${o.propriedades.join(", ")}` : "o card só com o título"),
  ].filter((x): x is string => !!x);
}
