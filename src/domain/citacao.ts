import type { Confianca, PayloadMensagem } from "../contracts/mensagem.ts";
import { propagarConfianca } from "./confianca.ts";

/**
 * Responder a uma fala qualquer (definido em 2026-10-18, ADR-113, plano "pergunta com botões", Parte 3b). Puro: o caso de
 * uso lê a fala citada e chama estas funções.
 */

/**
 * definido em 2026-10-18: o trecho cabe no rótulo acima do balão (duas linhas curtas na coluna da conversa) e na caixa
 * "Respondendo" do campo, que ainda corta com reticências no CSS. 120 letras dão a primeira frase de uma resposta típica
 * do bot sem levar um parágrafo inteiro para a entrada do turno.
 */
export const TRECHO_CITACAO_MAX = 120;

/** "Faltam dois: o T3 e o T5…": espaços juntados, corte na palavra (como `inicioDaPergunta` da web). */
export function trechoDaCitacao(texto: string, max = TRECHO_CITACAO_MAX): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  const letras = [...limpo];
  if (letras.length <= max) return limpo;
  const corte = letras.slice(0, max).join("");
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > max / 2 ? corte.slice(0, espaco) : corte).replace(/[\s,.;:!?-]+$/u, "")}…`;
}

/**
 * O prefixo que o bot lê, na entrada do turno e no histórico: "(respondendo a: «trecho»)" e o texto da pessoa embaixo.
 * As aspas « » de dentro do trecho viram ‹ ›: um "»)" na fala citada fecharia a citação e o resto da linha pareceria
 * escrito pela pessoa (revisão do PR 392, 2026-10-18).
 */
export function comCitacao(texto: string, trecho: string): string {
  return `(respondendo a: «${trecho.replace(/«/g, "‹").replace(/»/g, "›")}»)\n${texto}`;
}

const PREFIXO = /^\(respondendo a: «[^\n]*»\)\n/u;

/**
 * O texto sem o prefixo da citação: o título de uma task que nasce da fala (a rede de 2 min usa a entrada do turno) não
 * deve começar por "(respondendo a: …".
 */
export function semCitacao(texto: string): string {
  return texto.replace(PREFIXO, "");
}

/** O texto de uma mensagem como o bot o lê no histórico: com a citação, quando a fala da pessoa respondeu a outra. */
export function textoParaOBot(m: { texto: string; payload: PayloadMensagem | null }): string {
  return m.payload?.kind === "resposta_a_fala" ? comCitacao(m.texto, m.payload.respondeA.trecho) : m.texto;
}

/**
 * A confiança da fala que cita (ADR-062, revisão de engenharia do plano): citar uma fala `nao_confiavel` (conteúdo de
 * conector ou de outro bot) faz a mensagem e o turno nascerem não confiáveis. A citação não lava a confiança do trecho.
 */
export function confiancaDaCitacao(citada: Confianca): Confianca {
  return propagarConfianca(["confiavel", citada]);
}
