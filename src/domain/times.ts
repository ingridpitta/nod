import { NOME_SEM_TIME, TETO_NOME_TIME, type Time } from "../contracts/time.ts";

/**
 * Os times de bots, puro (definido em 2026-11-02, NOD-437). A chave do nome é o que decide "é o mesmo time": sem
 * maiúsculas, sem acento e com os espaços colapsados ("Produção" = "producao" = " PRODUÇÃO "). A chave '' é o Sem time.
 */

export function chaveDoTime(nome: string): string {
  return nome.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** O nome como fica gravado: sem espaços nas pontas nem em sequência (a caixa e os acentos são da pessoa). */
export function nomeLimpo(nome: string): string {
  return nome.replace(/\s+/g, " ").trim();
}

export const CHAVE_SEM_TIME = chaveDoTime(NOME_SEM_TIME);

/**
 * A chave do time em que o bot está pela `agentes.secao`: a seção antiga escrita "Sem time" é o Sem time, como na barra
 * (QA do PR #632, bug 4). Para o nome de um time use chaveDoTime.
 */
export function chaveDaSecao(secao: string | null | undefined): string {
  const c = chaveDoTime(secao ?? "");
  return c === CHAVE_SEM_TIME ? "" : c;
}

export type ProblemaNome = "nome_vazio" | "nome_longo" | "nome_reservado" | "nome_repetido";

/** Por que o nome não serve para um time novo (ou para renomear `proprio`); null = serve. */
export function problemaDoNome(nome: string, times: readonly Pick<Time, "id" | "nome">[], proprio?: string): { problema: ProblemaNome; existente?: Pick<Time, "id" | "nome"> } | null {
  const limpo = nomeLimpo(nome);
  if (limpo === "") return { problema: "nome_vazio" };
  if (limpo.length > TETO_NOME_TIME) return { problema: "nome_longo" };
  const chave = chaveDoTime(limpo);
  if (chave === CHAVE_SEM_TIME) return { problema: "nome_reservado" };
  const existente = times.find((t) => t.nome !== "" && t.id !== proprio && chaveDoTime(t.nome) === chave);
  return existente ? { problema: "nome_repetido", existente } : null;
}

/** O time de um nome pedido: pela chave exata; "" ou "Sem time" é o Sem time. Sem exato, os parecidos (para perguntar). */
export function acharTime<T extends Pick<Time, "nome">>(pedido: string, times: readonly T[]): { time: T } | { parecidos: T[] } {
  const chave = chaveDoTime(pedido);
  const alvo = chave === "" || chave === CHAVE_SEM_TIME ? "" : chave;
  const exato = times.find((t) => chaveDoTime(t.nome) === alvo);
  if (exato) return { time: exato };
  if (alvo === "") return { parecidos: [] };
  const parecidos = times.filter((t) => {
    const c = chaveDoTime(t.nome);
    return c !== "" && (c.startsWith(alvo) || alvo.startsWith(c) || prefixoComum(c, alvo) >= Math.min(4, alvo.length));
  });
  return { parecidos };
}

function prefixoComum(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Os times na ordem da barra, com os que só existem em agentes.secao (escritos pelo servidor de antes ou pelo
 * criar_bots) materializados no fim, em ordem alfabética, e o Sem time no topo quando ainda não tem linha.
 * Devolve a lista e o que falta gravar (nome, posicao) para a tabela ficar igual.
 */
export function reconciliarTimes(times: readonly Time[], secoes: readonly string[]): { faltam: { nome: string; posicao: number }[] } {
  const chaves = new Set(times.map((t) => chaveDoTime(t.nome)));
  const faltam: { nome: string; posicao: number }[] = [];
  let proxima = times.reduce((m, t) => Math.max(m, t.posicao + 1), 0);
  if (!chaves.has("")) {
    // O Sem time nasce no topo: ele é gravado na primeira sincronização, junto com as seções, quando ainda não há
    // linha nenhuma (posição 0). Sem ele e com outros times (nunca deveria acontecer), vai para o fim.
    faltam.push({ nome: "", posicao: proxima++ });
    chaves.add("");
  }
  // A primeira grafia de cada chave vale ("engenharia" e "Engenharia" viram um time só).
  const porChave = new Map<string, string>();
  for (const s of secoes) if (!porChave.has(chaveDoTime(s))) porChave.set(chaveDoTime(s), nomeLimpo(s));
  const novas = [...porChave.entries()]
    // A seção antiga chamada "Sem time" é o Sem time (como na barra e no acharTime), não um time comum (revisão 2).
    .filter(([c]) => c !== "" && c !== CHAVE_SEM_TIME && !chaves.has(c))
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  for (const [, nome] of novas) faltam.push({ nome: nome.slice(0, TETO_NOME_TIME), posicao: proxima++ });
  return { faltam };
}

/** A lista em ordem (posição; empate pelo nome) com as posições renumeradas 0..n-1. */
export function emOrdem<T extends Pick<Time, "posicao" | "nome">>(times: readonly T[]): T[] {
  return [...times].sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome, "pt-BR")).map((t, i) => ({ ...t, posicao: i }));
}

/** A nova ordem dos ids depois de pôr `id` na posição `destino` (0-based, limitada à lista). */
export function reordenar(ids: readonly string[], id: string, destino: number): string[] {
  const resto = ids.filter((x) => x !== id);
  if (resto.length === ids.length) return [...ids];
  const d = Math.max(0, Math.min(resto.length, Math.trunc(destino)));
  return [...resto.slice(0, d), id, ...resto.slice(d)];
}

/** O texto do leitor de tela: "Produto, time 2 de 4". */
export function posicaoFalada(nome: string, indice: number, total: number): string {
  return `${nome === "" ? NOME_SEM_TIME : nome}, time ${indice + 1} de ${total}`;
}

/** Os nomes juntos como numa frase: "a Nara e o Otto" fica com quem escreve; aqui "Nara, Otto e Bia". */
export function listaFalada(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}
