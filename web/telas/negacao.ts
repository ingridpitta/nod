import type { Negacao } from "../../src/contracts/negacao.ts";
import { esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";

/**
 * Fail-closed RENDERIZADO por CLASSE, com relógio (ADR-029): nunca recusa seca, nunca silêncio.
 *  - conector_indisponivel → "conector <nome> indisponível: <motivo> desde HH:MM (há N min)"
 *  - plano_ausente         → "nenhum trabalho começa: <motivo> desde HH:MM"
 * definido em 2026-10-27 (NOD-384): a ferramenta negada não é mais desenhada aqui (saiu de Provedores de IA, o único
 * lugar que usava estas funções); ela segue na pílula da conversa, na Atividade e no Raio-X (src/domain/estado-degradacao.ts).
 */
const MOTIVO: Record<Negacao["motivo"], string> = {
  capacidade_desligada: "capacidade desligada",
  teto_canal: "teto do canal atingido",
  alcance_insuficiente: "alcance insuficiente — peça aprovação",
  fora_do_catalogo: "fora do catálogo deste turno",
  plano_ausente: "plano de turno ausente",
  plano_expirado: "plano de turno expirado",
  catalogo_vazio: "catálogo vazio",
  conector_indisponivel: "conector indisponível",
  parada_ativa: "parada ativa pela pessoa",
  args_invalidos: "argumentos inválidos",
  falha_tecnica: "falha técnica",
  timeout_transporte: "a conexão com o app demorou demais",
};

/** O motivo em palavras, sem a frase inteira (a linha de "Fora do ar" em Seu espaço). */
export function textoMotivo(m: Negacao["motivo"]): string {
  return MOTIVO[m];
}

/** As classes que estas funções desenham: a ferramenta negada não aparece mais fora da conversa (NOD-384). */
export type NegacaoNaTela = Negacao & { classe: Exclude<Negacao["classe"], "ferramenta_negada"> };

export function naTela(n: Negacao): n is NegacaoNaTela {
  return n.classe !== "ferramenta_negada";
}

export function textoNegacao(n: NegacaoNaTela, agora: number): string {
  switch (n.classe) {
    case "conector_indisponivel":
      return `conector ${n.nome} indisponível: ${MOTIVO[n.motivo]} desde ${hora(n.desde)} (${haQuanto(agora - n.desde)})`;
    case "plano_ausente":
      return `nenhum trabalho começa: ${MOTIVO[n.motivo]} desde ${hora(n.desde)} (${haQuanto(agora - n.desde)})`;
  }
}

export function renderNegacao(n: NegacaoNaTela, agora: number): string {
  return `<div class="negacao negacao-${esc(n.classe)}" role="status"><span class="neg-classe">${esc(n.classe.replace("_", " "))}</span> ${esc(textoNegacao(n, agora))}</div>`;
}

export function renderNegacoes(lista: readonly NegacaoNaTela[], agora: number, vazio = ""): string {
  if (lista.length === 0) return vazio ? `<p class="mudo">${esc(vazio)}</p>` : "";
  const porClasse = new Map<NegacaoNaTela["classe"], NegacaoNaTela[]>();
  for (const n of lista) porClasse.set(n.classe, [...(porClasse.get(n.classe) ?? []), n]);
  return [...porClasse.entries()].map(([classe, ns]) => `<section class="negacoes"><h4>${esc(classe.replace("_", " "))} · ${ns.length}</h4>${ns.map((n) => renderNegacao(n, agora)).join("")}</section>`).join("");
}
