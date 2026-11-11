/**
 * A regra única de "vai começar" (definido em 2026-11-10, decisão do Marlon: copiar o PreviewIssueTrigger/WillEnqueueRun
 * do Multica, server/internal/service/issue_trigger.go). O servidor (deveComecar, planejarLote), o otimista da tela, a
 * dica ao arrastar e a nota do "Mover para…" decidem por ela; a web tem o espelho em web/lib/acionamento.ts (ADR-018: a
 * web não importa código de src) e tests/unit/web/acionamento-espelho.test.ts confere que os dois respondem igual.
 *
 * Mudar de coluna só aciona com handoff: entrar em A fazer (que leva ao andamento) ou numa coluna com responsável que
 * aciona (ADR-142). Coluna sem responsável mantém o responsável da tarefa e não roda nada: Em revisão → Fazendo não
 * reaciona ninguém. Ganhar ou trocar de responsável numa coluna que anda segue acionando o novo (NOD-417/418).
 */
import type { IdColuna } from "../contracts/quadro.ts";

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
