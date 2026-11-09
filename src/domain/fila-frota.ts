import type { Decisao, EstadoColunaFila, ItemFila, TipoDecisao } from "../contracts/decisao.ts";

/** `trabalhoId`: o trabalho do turno da decisão (null = a conversa), para as gêmeas não cruzarem faixas (S4). */
export type DecisaoComNomes = Decisao & { agenteNome: string; trabalhoId?: string | null };

export type GrupoFila = { pessoaId: string; agenteId: string; agenteNome: string; itens: ItemFila[] };

export type FilaMontada = {
  itens: ItemFila[];
  grupos: GrupoFila[];
  vazio: boolean;
  /** Carimbo para "Nada esperando por você · última decisão em …" (ADR-007). */
  ultimaDecisaoEm: string | null;
};

function estadoColuna(d: Decisao, agora: number): EstadoColunaFila {
  if (d.estado === "reaberta") return "reaberto";
  if (d.estado === "vencida" || Date.parse(d.prazoDecisaoEm) <= agora) return "vencido";
  return "pendente";
}

/**
 * definido em 2026-09-24: só estes tipos se dobram em "×N". Acesso: turnos diferentes pedindo a
 * mesma coisa (pedir-acesso.ts só junta pedidos do MESMO turno); retomar_turno: o "Retomar" repetido
 * da mesma conversa. Aprovação, pergunta, falta_de_dado e permissão repetem a frase legitimamente com
 * itens ou respostas diferentes: nunca se dobram. medido em 2026-09-24 (tela do dono): a faixa dizia
 * "13 decisões esperando por você" e o ⚑ contava as gêmeas de acesso que o chat já escondia.
 */
export const TIPOS_QUE_AGRUPAM: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["acesso", "retomar_turno"]);

/**
 * Mesma decisora, agente, conversa, tipo e frase; null = este tipo nunca se dobra.
 * revisto em 2026-10-08 (revisão do épico, S4): e mesma FAIXA — o trabalho do turno da decisão (ADR-083). As tasks do
 * bot moram na conversa dele, e o "Retomar" de uma task fechava o da conversa e o das outras tasks junto.
 */
export function chaveDeGemea(d: Pick<Decisao, "tipo" | "decisorId" | "agenteId" | "conversaId" | "frase"> & { trabalhoId?: string | null }): string | null {
  return TIPOS_QUE_AGRUPAM.has(d.tipo) ? [d.decisorId, d.agenteId, d.conversaId, d.tipo, d.frase, d.trabalhoId ?? ""].join("\u0000") : null;
}

/** Aberta NA FILA: pendente ou reaberta com prazo por vir. Vencida nunca entra no grupo de uma aberta. */
function abertaNaFila(d: Decisao, agora: number): boolean {
  return (d.estado === "pendente" || d.estado === "reaberta") && estadoColuna(d, agora) !== "vencido";
}

/**
 * As gêmeas ABERTAS de `d` entre `candidatas` — as que a fila dobrou junto com ela. É a mesma regra
 * de montarFila: quem decide, recusa ou dispensa o item do grupo fecha exatamente estas.
 */
export function gemeasAbertas<T extends Decisao & { trabalhoId?: string | null }>(d: Decisao & { trabalhoId?: string | null }, candidatas: readonly T[], agora: number): T[] {
  const chave = chaveDeGemea(d);
  if (chave === null) return [];
  return candidatas.filter((c) => c.id !== d.id && abertaNaFila(c, agora) && chaveDeGemea(c) === chave);
}

/**
 * Monta "Sua vez" por PESSOA (decisor) e por agente (ADR-007 revisado). Item vencido continua
 * visível em cinza com desfecho, nunca suprimido. Instantes chegam em ISO UTC; aqui viram ms
 * relativos para o cliente só interpolar. Pedidos abertos iguais (chaveDeGemea) viram UM item — o
 * mais antigo, que vence primeiro — com os ids dos outros em `gemeas`: contadores contam grupos.
 */
export function montarFila(entrada: { decisoes: readonly DecisaoComNomes[]; agora: number; ultimaDecisaoEm?: string | null }): FilaMontada {
  const todos: ItemFila[] = entrada.decisoes.map((d) => {
    const criadoEm = Date.parse(d.criadoEm);
    const prazo = Date.parse(d.prazoDecisaoEm);
    return {
      decisao: d,
      estadoColuna: estadoColuna(d, entrada.agora),
      agenteNome: d.agenteNome,
      aguardandoHaMs: Math.max(0, entrada.agora - criadoEm),
      recusaAutomaticaEmMs: Math.max(0, prazo - entrada.agora),
      gemeas: [],
    };
  });
  const porCriacao = [...todos].sort((a, b) => Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm));
  const representantes = new Map<string, ItemFila>();
  const itens: ItemFila[] = [];
  for (const item of porCriacao) {
    const chave = abertaNaFila(item.decisao, entrada.agora) ? chaveDeGemea(item.decisao) : null;
    const representante = chave === null ? undefined : representantes.get(chave);
    if (representante) {
      representante.gemeas.push(item.decisao.id);
      continue;
    }
    if (chave !== null) representantes.set(chave, item);
    itens.push(item);
  }
  // reabertos primeiro (voltam ao topo), depois por criação; vencidos ficam onde a criação os põe (cinza, visíveis)
  itens.sort((a, b) => {
    const ra = a.estadoColuna === "reaberto" ? 0 : 1;
    const rb = b.estadoColuna === "reaberto" ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return Date.parse(a.decisao.criadoEm) - Date.parse(b.decisao.criadoEm);
  });
  const grupos: GrupoFila[] = [];
  for (const item of itens) {
    const chave = `${item.decisao.decisorId}:${item.decisao.agenteId}`;
    let g = grupos.find((x) => `${x.pessoaId}:${x.agenteId}` === chave);
    if (!g) {
      g = { pessoaId: item.decisao.decisorId, agenteId: item.decisao.agenteId, agenteNome: item.agenteNome, itens: [] };
      grupos.push(g);
    }
    g.itens.push(item);
  }
  return { itens, grupos, vazio: itens.length === 0, ultimaDecisaoEm: entrada.ultimaDecisaoEm ?? null };
}
