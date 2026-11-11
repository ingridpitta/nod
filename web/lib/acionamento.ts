/**
 * Espelho de src/domain/acionamento.ts (ADR-018: a web só importa tipos de src); tests/unit/web/acionamento-espelho.test.ts
 * confere que os dois respondem igual à tabela. A regra única de "vai começar" (2026-11-10, o PreviewIssueTrigger do
 * Multica): o otimista do mover, a dica ao arrastar e a nota do "Mover para…" decidem por ela, como o servidor.
 */
import type { IdColuna } from "../../src/contracts/quadro.ts";

export type ColunaDoAcionamento = { id: IdColuna; grupo: string; responsavel?: string | null };
export type Mao = { status: IdColuna; agenteId: string | null };

export type ContextoDoAcionamento = {
  colunas: readonly ColunaDoAcionamento[];
  /** O bot que faz a mudança (null = a pessoa, ou o bot na conversa com ela). */
  autorAgenteId?: string | null;
  /** Há turno vivo (rodando ou na fila) desta tarefa. */
  viva?: boolean;
  /** O responsável de `depois` veio da coluna (a passagem, ADR-142), não de uma troca explícita. */
  pelaColuna?: boolean;
  /** O passo é o `terminei`, que só anda para a frente (aciona mesmo a etapa seguinte do próprio autor). */
  terminei?: boolean;
};

const grupo = (cs: readonly ColunaDoAcionamento[], id: IdColuna) => cs.find((c) => c.id === id)?.grupo ?? null;
/** Anda: no andamento, fora de Bloqueado e da espera da pessoa (ADR-162). */
const anda = (cs: readonly ColunaDoAcionamento[], id: IdColuna) => grupo(cs, id) === "iniciado" && id !== "voce" && id !== "bloqueado";
/** Onde a passagem aciona ao entrar: A fazer e as que andam (espelha acionaNaColuna). */
const aciona = (cs: readonly ColunaDoAcionamento[], id: IdColuna) => id === "afazer" || anda(cs, id);
/** Recebe passagem: Não iniciado e Andamento, fora Bloqueado, a espera da pessoa e Cancelado (espelha aceitaPassagem). */
const recebe = (c: ColunaDoAcionamento) => (c.grupo === "nao_iniciado" || c.grupo === "iniciado") && c.id !== "voce" && c.id !== "bloqueado" && c.id !== "cancelado";

/** A mudança `antes` → `depois` faz o responsável começar? Só na transição, nunca por estar parada num estado. */
export function regraDeComecar(antes: Mao | null, depois: Mao, x: ContextoDoAcionamento): boolean {
  const autor = x.autorAgenteId ?? null;
  if (!depois.agenteId) return false;
  const mudouColuna = antes === null || antes.status !== depois.status;
  const trocou = antes === null || antes.agenteId !== depois.agenteId;
  const handoff = x.pelaColuna === true && mudouColuna && aciona(x.colunas, depois.status);
  // O bot que se devolve a própria tarefa não se reinicia (revisão do PR #612: virava laço); o `terminei` para a etapa
  // seguinte dele mesmo é trabalho novo.
  if (autor && antes?.agenteId === autor && depois.agenteId === autor && !(handoff && x.terminei)) return false;
  // A fazer: entrar, ou ganhar (trocar de) responsável estando nela.
  if (depois.status === "afazer") return trocou || mudouColuna;
  // Multica (WillEnqueueRun, fonte status): sair do Backlog para uma coluna que anda aciona o responsável da tarefa.
  if (antes?.status === "backlog" && mudouColuna && anda(x.colunas, depois.status)) return depois.agenteId !== autor;
  // Handoff: a coluna nomeia quem pega. Outro bot começa com ou sem turno vivo (o anterior segue ou é parado, ADR-142);
  // o mesmo responsável começa a etapa nova só sem turno vivo (o que já roda cobre a etapa, como no Multica).
  if (handoff) return (depois.agenteId !== autor || x.terminei === true) && (trocou || !x.viva);
  // Troca de responsável numa coluna que anda (atribuir, NOD-417/418): o novo começa, a não ser que seja o autor.
  if (trocou && anda(x.colunas, depois.status)) return depois.agenteId !== autor;
  return false;
}

export type PreviaDeMover = {
  /** O responsável depois de soltar (o da coluna, se ela tem; senão o de antes). */
  agenteId: string | null;
  /** A mão muda (a coluna nomeia outro responsável). */
  passa: boolean;
  /** Soltar faz o responsável começar. */
  aciona: boolean;
};

/** O que soltar a tarefa `t` na coluna `para` faz (a prévia do mover; o servidor decide pela mesma regra). */
export function previaDeMover(t: Mao, para: IdColuna, x: Omit<ContextoDoAcionamento, "pelaColuna">): PreviaDeMover {
  const c = x.colunas.find((k) => k.id === para);
  const resp = c && recebe(c) && para !== t.status ? (c.responsavel ?? null) : null;
  const agenteId = resp ?? t.agenteId;
  const depois = { status: para, agenteId };
  return { agenteId, passa: resp !== null && resp !== t.agenteId, aciona: regraDeComecar(t, depois, { ...x, pelaColuna: resp !== null }) };
}

/**
 * A dica ao arrastar e a nota do "Mover para…"/folha do celular (o "board.drop_hint_run"/"drop_hint" do Multica): quem
 * pega e se começa. Null = nada a dizer (coluna sem responsável, ou o mesmo responsável sem acionar).
 */
export function dicaDeMover(p: PreviaDeMover, nomeDe: (agenteId: string) => string | null | undefined, soltar = true): string | null {
  if (!p.agenteId) return null;
  const quem = nomeDe(p.agenteId) ?? "o responsável";
  const pre = soltar ? "Soltar passa para" : "Passa para";
  if (p.passa) return p.aciona ? `${pre} ${quem}, que começa agora` : `${pre} ${quem}`;
  return p.aciona ? (soltar ? `Ao soltar, ${quem} começa agora` : `${quem.charAt(0).toUpperCase()}${quem.slice(1)} começa agora`) : null;
}

/** A prévia pela tela: quem move é a pessoa; turno vivo = a execução do card rodando ou na fila. */
export function previaDaTarefa(t: { status: string; agenteId: string | null; execucao?: string | null }, para: string, colunas: readonly ColunaDoAcionamento[]): PreviaDeMover {
  return previaDeMover({ status: t.status, agenteId: t.agenteId }, para, { colunas, autorAgenteId: null, viva: t.execucao === "rodando" || t.execucao === "fila" });
}

/** O nome de quem a prévia aponta: o responsável nomeado na coluna, senão o da tarefa. */
export function nomeNaPrevia(colunas: readonly { responsavel?: string | null; responsavelNome?: string | null }[], t: { agenteId: string | null; agenteNome?: string | null }): (id: string) => string | null {
  return (id) => colunas.find((c) => c.responsavel === id)?.responsavelNome ?? (id === t.agenteId ? (t.agenteNome ?? null) : null);
}
