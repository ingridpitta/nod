import { ICONE } from "./icones.ts";
import { esc } from "./render.ts";

/**
 * Seções da barra que recolhem (definido em 2026-10-04): com muitos bots, a barra não cabia mais. O título da seção
 * vira um botão; a seta aparece no hover e fica à vista com a seção recolhida. Recolhida, a seção só mostra o bot da
 * conversa aberta e os que estão com problema à vista (computador fora do ar, em ligação), e o aviso mais forte dos
 * bots escondidos sobe para o título — recolher nunca esconde um pedido. O que está recolhido fica neste navegador,
 * como o painel oculto, com a chave de cada pessoa.
 */
export const CHAVE_SECOES_RECOLHIDAS = "nod.secoesRecolhidas";

/** O sinal de um bot na barra: âmbar decisão, azul pergunta ou mensagem não lida (definido em 2026-09-24). */
export type AvisoBot = "decisao" | "pergunta" | "nao-lido" | "";

/** O aviso por escrito: no rótulo da linha do bot e no título da seção recolhida. */
export const ESPERA: Record<Exclude<AvisoBot, "">, string> = {
  decisao: "esperando sua decisão",
  pergunta: "esperando sua resposta",
  "nao-lido": "mensagem nova",
};

const ORDEM: readonly AvisoBot[] = ["decisao", "pergunta", "nao-lido"];

export function avisoMaisForte(avisos: readonly AvisoBot[]): AvisoBot {
  return ORDEM.find((a) => avisos.includes(a)) ?? "";
}

/** "Meus agentes" é a seção "" (0041); as da equipe não têm seção da pessoa e recolhem juntas. */
export function chaveDaSecao(pessoaId: string, secao: string | null): string {
  return `${pessoaId}:${secao === null ? "equipe" : `secao:${secao}`}`;
}

/** Um bot da seção, só no que a regra lê. `alerta`: computador fora do ar ou em ligação. */
export type BotNaSecao = { conversaId: string; aviso: AvisoBot; alerta: boolean };

/** Quem some da seção recolhida (na ordem dos bots) e o ponto do título: o aviso mais forte entre os que sumiram. */
export function estadoDaSecao(o: { chave: string; recolhidas: ReadonlySet<string>; conversaAberta: string | null; bots: readonly BotNaSecao[] }): { recolhida: boolean; escondidos: boolean[]; aviso: AvisoBot } {
  const recolhida = o.recolhidas.has(o.chave);
  const escondidos = o.bots.map((b) => recolhida && b.conversaId !== o.conversaAberta && !b.alerta);
  return { recolhida, escondidos, aviso: avisoMaisForte(o.bots.filter((_, i) => escondidos[i]).map((b) => b.aviso)) };
}

/** null: sem storage (aba privada, site bloqueado). */
function lerDoNavegador(): Set<string> | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CHAVE_SECOES_RECOLHIDAS) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return null;
  }
}

export function lerSecoesRecolhidas(): Set<string> {
  return lerDoNavegador() ?? new Set();
}

/**
 * Recolhe ou abre e grava. Parte do que está gravado — outra aba pode ter mudado outra seção —, não só do que esta aba
 * lembra. Devolve um conjunto NOVO (a barra lembra o desenho pela referência). Sem storage, vale só nesta aba.
 */
export function definirSecaoRecolhida(atuais: ReadonlySet<string>, chave: string, recolhida: boolean): Set<string> {
  const novas = new Set(lerDoNavegador() ?? atuais);
  if (recolhida) novas.add(chave);
  else novas.delete(chave);
  try { localStorage.setItem(CHAVE_SECOES_RECOLHIDAS, JSON.stringify([...novas])); } catch { /* sem storage */ }
  return novas;
}

/**
 * O título da seção: nome, seta e, recolhida, quantos bots tem e o ponto do aviso mais forte entre os escondidos.
 * O nome acessível vai com vírgulas ("Devs, 4 bots, esperando sua decisão"); sem elas o leitor de tela juntava tudo.
 */
export function cabecalhoSecao(nome: string, chave: string, o: { recolhida: boolean; total: number; aviso: AvisoBot }): string {
  const total = o.recolhida && o.total ? `<small aria-hidden="true">${o.total}</small>` : "";
  const ponto = o.recolhida && o.aviso ? `<i class="secao-aviso" data-aviso="${o.aviso}" aria-hidden="true"></i>` : "";
  const rotulo = o.recolhida ? [nome, o.total ? `${o.total} ${o.total === 1 ? "bot" : "bots"}` : "", o.aviso ? ESPERA[o.aviso] : ""].filter(Boolean).join(", ") : nome;
  return `<h3><button type="button" class="secao-cab" data-act="recolher-secao" data-chave="${esc(chave)}" aria-expanded="${o.recolhida ? "false" : "true"}" aria-label="${esc(rotulo)}" title="${o.recolhida ? "Mostrar" : "Recolher"} ${esc(nome)}"><span class="secao-nome">${esc(nome)}</span>${ICONE.seta}${total}${ponto}</button></h3>`;
}

/** O mínimo de um bot que decide onde ele mora na barra. */
type BotDaBarra = { ownerId: string; papel?: string | null; fixado: boolean; secao?: string | null };

/**
 * NOD-450: onde cada bot da frota mora na barra lateral — o Nod, a grade de fixados, "Meus agentes" (sem seção), as
 * seções da pessoa (em ordem alfabética) e os da equipe. É a mesma regra que o `renderSidebar` desenha; fora dele, o
 * teste prova que o bot recém-criado (com ou sem seção) entra na barra assim que a frota relida chega.
 * ADR-081: o Nod nunca entra numa seção; no celular (NOD-379) ele é sempre o primeiro favorito.
 */
export function gruposDaBarra<A extends BotDaBarra>(agentes: readonly A[], pessoaId: string, celular: boolean): { meus: A[]; nod: A | null; comuns: A[]; fixados: A[]; soltos: A[]; secoes: { nome: string; bots: A[] }[]; equipe: A[] } {
  const meus = agentes.filter((a) => a.ownerId === pessoaId);
  const nod = meus.find((a) => a.papel === "nod") ?? null;
  const comuns = meus.filter((a) => a.papel !== "nod");
  const nomes = [...new Set(comuns.filter((a) => !a.fixado && a.secao).map((a) => a.secao!))].sort((a, b) => a.localeCompare(b));
  return {
    meus,
    nod,
    comuns,
    fixados: [...(nod && (nod.fixado || celular) ? [nod] : []), ...comuns.filter((a) => a.fixado)],
    soltos: comuns.filter((a) => !a.fixado && !a.secao),
    secoes: nomes.map((nome) => ({ nome, bots: comuns.filter((a) => !a.fixado && a.secao === nome) })),
    equipe: agentes.filter((a) => a.ownerId !== pessoaId),
  };
}
