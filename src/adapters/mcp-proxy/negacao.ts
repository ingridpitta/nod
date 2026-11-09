import type { Negacao } from "../../contracts/negacao.ts";
import type { MotivoNegacao } from "../../contracts/motivos.ts";
import { descreverNegacao } from "../../domain/estado-degradacao.ts";
import { classificarNegacao } from "../../domain/parada-alcada.ts";

/**
 * Negação RENDERIZADA (ADR-029): nome, causa e relógio, nunca recusa seca. `terminal` sai da regra
 * pura parada-alcada (E5.1). O proxy usa estas fábricas para o que decide localmente (plano ausente,
 * fora do catálogo, servidor fora) e o servidor para o que decide em chamar-ferramenta.
 */
export function negacaoPlanoAusente(
  motivo: Extract<MotivoNegacao, "plano_ausente" | "plano_expirado" | "catalogo_vazio">,
  desde: number,
  nome = "plano",
): Negacao {
  return { classe: "plano_ausente", nome, motivo, desde, terminal: true };
}

export function negacaoConectorIndisponivel(
  nome: string,
  desde: number,
  motivo: Extract<MotivoNegacao, "conector_indisponivel" | "timeout_transporte" | "falha_tecnica"> = "conector_indisponivel",
): Negacao {
  return { classe: "conector_indisponivel", nome, motivo, desde, terminal: classificarNegacao(motivo, desde) === "TERMINAL" };
}

export function negacaoFerramenta(nome: string, motivo: MotivoNegacao, desde: number, contexto: { viaGateDeRotina?: boolean } = {}): Negacao {
  return { classe: "ferramenta_negada", nome, motivo, desde, terminal: classificarNegacao(motivo, desde, contexto) === "TERMINAL" };
}

/** Redação que o MODELO lê: terminal manda não tentar outro caminho (E5.1); transitória diz que pode seguir. */
export function redigirNegacao(n: Negacao, agora: number): string {
  const descricao = descreverNegacao(n, agora);
  return n.terminal ? `negado (terminal): não tente outro caminho. ${descricao}` : `negado (transitório): ${descricao}. Você pode seguir por outro caminho.`;
}

export type ConteudoMcp = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Corpo de result do tools/call para uma negação: isError com a redação (nunca error JSON-RPC, salvo plano ausente). */
export function conteudoNegado(n: Negacao, agora: number): ConteudoMcp {
  return { content: [{ type: "text", text: redigirNegacao(n, agora) }], isError: true };
}
