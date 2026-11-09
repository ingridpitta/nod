import type { LeituraMarcada } from "../contracts/nao-lidos.ts";
import { MAX_LEITURAS_DESFAZER } from "../contracts/nao-lidos.ts";

/** NOD-449: o instante que marcarLida devolve (µs, UTC, sem fuso). Qualquer outra forma não volta ao banco. */
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lê as leituras do Desfazer de um corpo sem tipo (a rota, o payload do recibo). null = forma inválida. */
export function lerLeituras(bruto: unknown): LeituraMarcada[] | null {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > MAX_LEITURAS_DESFAZER) return null;
  const saida: LeituraMarcada[] = [];
  for (const l of bruto as unknown[]) {
    if (typeof l !== "object" || l === null) return null;
    const { conversaId, antes, depois } = l as Record<string, unknown>;
    if (typeof conversaId !== "string" || !UUID.test(conversaId)) return null;
    if (!(antes === null || (typeof antes === "string" && INSTANTE.test(antes)))) return null;
    if (!(depois === null || (typeof depois === "string" && INSTANTE.test(depois)))) return null;
    // O Desfazer só volta para trás: um `antes` depois do `depois` empurraria o "lido até" para o futuro (revisão do PR #616).
    if (typeof antes === "string" && (depois === null || antes > depois)) return null;
    saida.push({ conversaId, antes, depois });
  }
  return saida;
}

/** Até quantos nomes a frase lista; acima disso diz só quantas ("5 conversas marcadas como lidas"). */
const NOMES_NA_FRASE = 3;

function quem(nomes: readonly string[]): string {
  if (nomes.length > NOMES_NA_FRASE) return `${nomes.length} conversas`;
  return nomes.length === 1 ? nomes[0]! : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** A frase do recibo no chat e do aviso da tela: "Bia marcada como lida", "Bia e Lia marcadas como lidas", "5 conversas …". */
export function fraseDoRecibo(nomes: readonly string[]): string {
  if (nomes.length === 0) return "Nada para marcar: tudo em dia";
  return nomes.length === 1 ? `${quem(nomes)} marcada como lida` : `${quem(nomes)} marcadas como lidas`;
}

/** Depois do Desfazer: "Bia voltou para Não lidos", "Bia e Lia voltaram para Não lidos". */
export function fraseDoDesfeito(nomes: readonly string[]): string {
  if (nomes.length === 0) return "Nada voltou para Não lidos";
  return `${quem(nomes)} ${nomes.length === 1 ? "voltou" : "voltaram"} para Não lidos`;
}
