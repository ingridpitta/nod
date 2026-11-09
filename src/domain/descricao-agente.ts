import type { Agente } from "../contracts/agente.ts";

/**
 * Estado do agente em uma linha para a frota: 'sem acessos · nunca executou' até a primeira
 * concessão e a primeira execução. Contagens, nunca interpretação de texto.
 */
export function descricaoEstado(_agente: Pick<Agente, "confirmado">, estado: { concessoes: number; execucoes: number }): string {
  const acessos = estado.concessoes === 0 ? "sem acessos" : estado.concessoes === 1 ? "1 acesso" : `${estado.concessoes} acessos`;
  const execucoes = estado.execucoes === 0 ? "nunca executou" : estado.execucoes === 1 ? "executou 1 vez" : `executou ${estado.execucoes} vezes`;
  return `${acessos} · ${execucoes}`;
}

/** definido em 2026-09-24 (sidebar no estilo do Grok): a prévia da última mensagem cabe numa linha. */
export const PREVIA_MAX = 140;

/**
 * A última mensagem da conversa como prévia de uma linha: sem marcação de ênfase/código, o link `[x](url)` vira só
 * `x` (NOD-455: o "Abrir no quadro" do aviso não aparece cru na barra), espaços e
 * quebras colapsados, cortada em PREVIA_MAX com reticências. Texto vazio vira null (a linha mostra o título).
 */
export function previaDaMensagem(texto: string): string | null {
  const limpo = texto.replace(/\[([^\]\n]*)\]\([^)\s]*\)/g, "$1").replace(/^\s*[#>]+\s*/gm, "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
  if (!limpo) return null;
  return limpo.length > PREVIA_MAX ? `${limpo.slice(0, PREVIA_MAX - 1).trimEnd()}…` : limpo;
}
