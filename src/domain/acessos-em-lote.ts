import type { CapacidadeConector } from "../contracts/conector.ts";
import { capacidadesDoNivel, doNivel, grupoDaCapacidade, type NivelDeAcesso } from "./grupos-de-acesso.ts";

/**
 * Permissões dos apps em lote e padrão por app (definido em 2026-11-07, ADA-241, ADR-158). Puro: quem lê e grava é o
 * executor (src/use-cases/acoes/acessos.ts).
 *
 * - O nível de um bot num app é o CONJUNTO concedido: só é Ler ou Ler e alterar quando bate exato; o resto com alguma
 *   concessão é "personalizado" (ações dadas uma a uma, pela rotina ou pelo card).
 * - Escolher um nível mexe só no que é dele (ler, criar, editar, comentar); "Nenhum" tira tudo (a regra da tela desde
 *   2026-09-25, revisão do PR #68).
 * - "Todos" com Ler nunca rebaixa quem tem mais (Ler e alterar ou personalizado); a seleção manual recebe exatamente o
 *   nível clicado (D8 da revisão de design).
 * - O Desfazer só volta o bot cujo conjunto ainda é o que o lote deixou: o que mudou depois, por outro caminho, fica.
 */

type Catalogo = readonly Pick<CapacidadeConector, "nome" | "readOnlyHint" | "destructiveHint">[];

export type NivelAtual = NivelDeAcesso | "personalizado";

/** definido em 2026-11-07: um lote mexe em até 100 bots (a tela e o chat); acima disso a pessoa divide. */
export const MAX_BOTS_POR_LOTE = 100;
/** definido em 2026-11-07: o Desfazer de um lote vale por 24 h (depois o "antes" já não diz nada à pessoa). */
export const PRAZO_DESFAZER_MS = 24 * 60 * 60 * 1000;

export const NIVEIS_DE_ACESSO: readonly NivelDeAcesso[] = ["nenhum", "leitura", "escrita"];

export function ehNivelDeAcesso(v: unknown): v is NivelDeAcesso {
  return typeof v === "string" && (NIVEIS_DE_ACESSO as readonly string[]).includes(v);
}

function mesmoConjunto(a: ReadonlySet<string>, b: readonly string[]): boolean {
  return a.size === new Set(b).size && b.every((x) => a.has(x));
}

/** O nível que o conjunto concedido é (a mesma regra de nivelDoBot na web). */
export function nivelDoConjunto(catalogo: Catalogo, concedidas: readonly string[]): NivelAtual {
  const s = new Set(concedidas);
  if (s.size === 0) return "nenhum";
  if (mesmoConjunto(s, capacidadesDoNivel(catalogo, "leitura"))) return "leitura";
  if (mesmoConjunto(s, capacidadesDoNivel(catalogo, "escrita"))) return "escrita";
  return "personalizado";
}

/** O que muda para um bot ir ao nível: o que revogar, o que conceder e o conjunto que fica. */
export function planoDoNivel(catalogo: Catalogo, atuais: readonly string[], nivel: NivelDeAcesso): { revogar: string[]; conceder: string[]; depois: string[] } {
  const desejadas = new Set(capacidadesDoNivel(catalogo, nivel));
  const revogar = atuais.filter((c) => !desejadas.has(c) && (nivel === "nenhum" || doNivel(catalogo, c)));
  const conceder = [...desejadas].filter((c) => !atuais.includes(c));
  const depois = [...atuais.filter((c) => !revogar.includes(c)), ...conceder].sort();
  return { revogar, conceder, depois };
}

/** O plano para voltar ao conjunto exato de antes (Desfazer): revoga o que não estava, concede o que saiu. */
/**
 * Revisão do PR #706: o Desfazer devolve escrita (qualquer ação fora do grupo Ler, inclusive apagar) a algum bot? Volta
 * de Ler e alterar é dar acesso de escrita: espera a pessoa (card no chat; o executor recusa a regra do modo).
 */
export function desfazerDevolveEscrita(catalogo: Catalogo, antes: Readonly<Record<string, readonly string[]>>, depois: Readonly<Record<string, readonly string[]>>): boolean {
  return Object.keys(depois).some((id) => (antes[id] ?? []).some((c) => {
    const cap = catalogo.find((x) => x.nome === c);
    return cap !== undefined && grupoDaCapacidade(cap) !== "ler" && !(depois[id] ?? []).includes(c);
  }));
}

export function planoDeVolta(atuais: readonly string[], antes: readonly string[]): { revogar: string[]; conceder: string[] } {
  return { revogar: atuais.filter((c) => !antes.includes(c)), conceder: antes.filter((c) => !atuais.includes(c)) };
}

const ORDEM: Record<NivelAtual, number> = { nenhum: 0, leitura: 1, escrita: 2, personalizado: 3 };

/**
 * Quem o lote toca. `todos`: Ler não rebaixa quem já tem Ler e alterar ou personalizado (D8); Nenhum e Ler e alterar
 * valem para todos. Seleção manual: todos os escolhidos, no nível exato. Quem já está no nível também fica de fora
 * (nada a fazer, e o Desfazer não o toca).
 */
export function alvosDoLote(bots: readonly { agenteId: string; atual: NivelAtual }[], nivel: NivelDeAcesso, todos: boolean): { alvos: string[]; mantidos: string[] } {
  const alvos: string[] = [];
  const mantidos: string[] = [];
  for (const b of bots) {
    const rebaixaria = todos && nivel === "leitura" && ORDEM[b.atual] > ORDEM.leitura;
    if (b.atual === nivel || rebaixaria) mantidos.push(b.agenteId);
    else alvos.push(b.agenteId);
  }
  return { alvos, mantidos };
}

/**
 * O bot segue o padrão do app? Não definido (sem marca e sem concessão no app), ou marcado como 'padrao' e ainda no
 * nível do padrão anterior — se alguém mudou o conjunto por outro caminho (rotina, card), ele deixou de seguir.
 */
export function segueOPadrao(marca: "pessoa" | "padrao" | null, atual: NivelAtual, padraoAnterior: NivelDeAcesso): boolean {
  if (marca === "pessoa") return false;
  if (marca === null) return atual === "nenhum";
  return atual === padraoAnterior;
}

/** "3 bots com Ler no Gmail" — a frase do recibo e do toast. */
export function fraseDoLote(n: number, nivel: NivelDeAcesso, app: string): string {
  const rotulo = nivel === "nenhum" ? "sem acesso ao" : nivel === "leitura" ? "com Ler no" : "com Ler e alterar no";
  return `${n} ${n === 1 ? "bot" : "bots"} ${rotulo} ${app}`;
}

export const ROTULO_DO_NIVEL: Record<NivelDeAcesso, string> = { nenhum: "Nenhum", leitura: "Ler", escrita: "Ler e alterar" };
