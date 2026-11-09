import type { EpochMs } from "../contracts/ids.ts";
import type { ContaNoLimite } from "../contracts/turno.ts";

/**
 * Várias contas por IA, com troca manual por padrão (definido em 2026-10-12, ADR-101 item 6, opção 2 do Marlon). Puro:
 * `agora` por parâmetro. Quem guarda as contas é o app do Mac (desktop/contas-mac.ts): apelido e plano nunca saem dele
 * (ADR-019). O servidor e a conversa só veem a POSIÇÃO ("conta 1", "conta 2") e o estado.
 *
 * As regras:
 *  1. "Perguntar antes" é o padrão: no limite, o nod oferece as outras contas livres (todas, inclusive as corporativas)
 *     e a pessoa troca com um clique. Nada troca sozinho.
 *  2. "Trocar sozinho" é por IA e vem desligado. Ligado, o turno é refeito na próxima conta ELEGÍVEL da ordem.
 *  3. NOD-308 (decisão do Marlon na NOD-221, 19/10): a conta corporativa (Team, Enterprise, Business, Edu) segue a
 *     mesma regra da pessoal: toda conta livre é elegível. "Corporativa" fica só como selo na tela.
 *  4. A conta preferida (a 1) volta a ser usada assim que renova: é a conta onde a pessoa escolheu começar, não uma troca.
 */

export type ModoDaTroca = "perguntar" | "automatico";

export type ContaGuardada = {
  /** "padrao" é a conta de sempre (~/.claude, ~/.codex); as outras, um id opaco com a pasta própria. */
  id: string;
  /** Só no app do Mac (ADR-019). */
  apelido: string;
  /** O plano que o CLI informou ("max", "team", "plus", "business"…), minúsculo; null = o CLI não disse. */
  plano: string | null;
  /** definido em 2026-10-12 (Ada/Marlon): o antigo opt-in da corporativa. NOD-308: não pesa mais na troca (fica por compat). */
  entraNaTrocaAutomatica: boolean;
  /** Até quando a conta está no limite (o horário do fornecedor ou o prazo de 1 h); null = livre. */
  noLimiteAte: EpochMs | null;
};

export type ContasDaIa = {
  modo: ModoDaTroca;
  /** Na ordem da pessoa: a primeira é a conta 1. */
  contas: ContaGuardada[];
  /** A conta que a pessoa (ou a troca sozinha) escolheu enquanto a preferida está no limite; null = a preferida. */
  escolhida: string | null;
};

export const ID_CONTA_PADRAO = "padrao";
/** definido em 2026-10-12: teto de contas por IA (o protótipo mostra até 3; folga para a pessoa que tem mais). */
export const CONTAS_POR_IA_MAX = 6;
export const APELIDO_MAX = 40;
/** O id de uma conta extra: letras minúsculas, números e hífen (vira nome de pasta). */
const FORMA_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** definido em 2026-10-12: planos de empresa ou instituição (Claude: team/enterprise; ChatGPT: business/enterprise/edu). */
const PLANOS_CORPORATIVOS = new Set(["team", "enterprise", "business", "edu"]);
/** definido em 2026-10-12: planos pessoais conhecidos (Claude: free/pro/max; ChatGPT: free/plus/pro). */
const PLANOS_PESSOAIS = new Set(["free", "pro", "max", "plus"]);

export function contasIniciais(): ContasDaIa {
  return { modo: "perguntar", contas: [{ id: ID_CONTA_PADRAO, apelido: "Conta 1", plano: null, entraNaTrocaAutomatica: false, noLimiteAte: null }], escolhida: null };
}

/** Corporativa: plano de empresa, ou plano que o CLI não informou (o lado seguro). */
export function ehCorporativa(plano: string | null): boolean {
  if (plano === null) return true;
  const p = plano.trim().toLowerCase();
  if (PLANOS_CORPORATIVOS.has(p)) return true;
  // "claude_max", "chatgpt_plus", "max_20x": o plano pessoal pode vir com prefixo ou sufixo.
  return ![...PLANOS_PESSOAIS].some((x) => p === x || p.split(/[^a-z0-9]+/).includes(x));
}

/**
 * A conta é corporativa para a troca? Plano de empresa ou desconhecido, menos a conta 1 de sempre ("padrao") sem plano
 * lido: o app ainda não guarda o plano dela, e marcá-la corporativa por isso tiraria toda conta 1 da troca.
 */
export const contaCorporativa = (c: Pick<ContaGuardada, "id" | "plano">): boolean =>
  !(c.id === ID_CONTA_PADRAO && c.plano === null) && ehCorporativa(c.plano);

const livre = (c: ContaGuardada, agora: EpochMs) => c.noLimiteAte === null || c.noLimiteAte <= agora;

/**
 * A conta que o próximo turno usa: a preferida se está livre (ela volta quando renova); senão a escolhida, se livre;
 * senão a preferida (o CLI devolve o limite de novo, e a decisão abaixo pergunta outra vez).
 */
export function contaEmUso(cfg: ContasDaIa, agora: EpochMs): ContaGuardada {
  const [preferida] = cfg.contas;
  if (!preferida) throw new Error("contas sem a conta 1");
  if (livre(preferida, agora)) return preferida;
  const escolhida = cfg.contas.find((c) => c.id === cfg.escolhida);
  return escolhida && livre(escolhida, agora) ? escolhida : preferida;
}

export const posicaoDa = (cfg: ContasDaIa, id: string): number => cfg.contas.findIndex((c) => c.id === id) + 1;

/** O que o Mac decide quando a conta em uso bate no limite (vai ao servidor em `contaNoLimite`). Posições começam em 1. */
export type DecisaoNoLimite = ContaNoLimite;

/**
 * Marca a conta `id` no limite até `ate` e decide. "Trocar sozinho" ligado e alguma conta livre: troca para a primeira
 * da ordem (NOD-308: corporativa ou não; `foraDaTroca` segue no contrato, sempre vazio). Desligado: pergunta com todas
 * as livres. Nenhuma livre: todas no limite, com a volta mais cedo (a conta que destrava primeiro).
 */
export function decidirNoLimite(cfg: ContasDaIa, p: { id: string; ate: EpochMs | null; agora: EpochMs }): { cfg: ContasDaIa; decisao: DecisaoNoLimite } {
  const contas = cfg.contas.map((c) => (c.id === p.id ? { ...c, noLimiteAte: p.ate ?? p.agora + PRAZO_SEM_HORARIO_MS } : c));
  const de = contas.findIndex((c) => c.id === p.id) + 1;
  const voltaDe = p.ate;
  const livres = contas.map((c, i) => ({ c, i })).filter(({ c }) => livre(c, p.agora));
  if (livres.length === 0) {
    const voltas = contas.map((c) => c.noLimiteAte).filter((t): t is number => t !== null);
    return { cfg: { ...cfg, contas, escolhida: null }, decisao: { tipo: "todas_no_limite", noLimite: contas.map((_, i) => i + 1), voltaEm: voltas.length > 0 ? Math.min(...voltas) : null } };
  }
  if (cfg.modo === "automatico") {
    const alvo = livres[0]!;
    return { cfg: { ...cfg, contas, escolhida: alvo.c.id }, decisao: { tipo: "trocou", de, para: alvo.i + 1, voltaEm: voltaDe, foraDaTroca: [] } };
  }
  // QA do NOD-211 (2026-10-12): a escolha antiga ("Seguir com a conta 2" de ontem) ficava guardada e o turno seguinte
  // ia nela sozinho, enquanto a conversa perguntava. Ao perguntar, nada fica escolhido: quem escolhe agora é a pessoa.
  return { cfg: { ...cfg, contas, escolhida: null }, decisao: { tipo: "perguntar", de, livres: livres.map(({ i }) => i + 1), foraDaTroca: [], voltaEm: voltaDe } };
}

/** definido em 2026-10-12: sem horário do fornecedor, a conta fica 1 h no limite (o mesmo PRAZO_LIMITE_SEM_HORARIO_MS). */
export const PRAZO_SEM_HORARIO_MS = 60 * 60_000;

/** A pessoa escolheu "Seguir com a conta N" na conversa. null = posição inválida. */
export function usarConta(cfg: ContasDaIa, posicao: number): ContasDaIa | null {
  const c = cfg.contas[posicao - 1];
  if (!c) return null;
  return { ...cfg, escolhida: posicao === 1 ? null : c.id, contas: cfg.contas.map((x) => (x.id === c.id ? { ...x, noLimiteAte: null } : x)) };
}

/** Um turno deu certo na conta: ela sai do limite antes do prazo. */
export function contaVoltou(cfg: ContasDaIa, id: string): ContasDaIa {
  return cfg.contas.some((c) => c.id === id && c.noLimiteAte !== null) ? { ...cfg, contas: cfg.contas.map((c) => (c.id === id ? { ...c, noLimiteAte: null } : c)) } : cfg;
}

/** "1", "1 e 3", "1, 2 e 3". */
export function listaDePosicoes(ps: readonly number[]): string {
  if (ps.length <= 1) return ps.join("");
  return `${ps.slice(0, -1).join(", ")} e ${ps[ps.length - 1]}`;
}

/**
 * A frase da conversa, só com posições (ADR-101 item 3). `quando` dá a hora ("14:00", "09/10 às 14:00") e `quandoVolta`
 * a hora com a preposição ("às 14:00", "em 09/10 às 14:00"). Os textos do protótipo v3.
 */
export function fraseDaDecisao(d: DecisaoNoLimite, p: { ia: string; quando: (t: EpochMs) => string; quandoVolta: (t: EpochMs) => string; origem?: string }): string {
  const ate = (t: EpochMs | null) => (t !== null ? ` até ${p.quando(t)}` : "");
  if (d.tipo === "trocou") {
    // NOD-284 (suposição da NOD-230, 2026-10-15): a sala não refaz sozinha a fala cortada — nunca "Seguindo com" ali.
    if (p.origem === "sala") return `Conta ${d.de} do ${p.ia} no limite${ate(d.voltaEm)}. Fale de novo para seguir com a conta ${d.para}.`;
    const fora = d.foraDaTroca.length > 0 ? ` (${d.foraDaTroca.length === 1 ? "conta" : "contas"} ${listaDePosicoes(d.foraDaTroca)} fora da troca automática)` : "";
    return `Conta ${d.de} do ${p.ia} no limite${ate(d.voltaEm)}. Seguindo com a conta ${d.para}${fora}.`;
  }
  if (d.tipo === "perguntar") {
    const noLimite = `Conta ${d.de} do ${p.ia} no limite${ate(d.voltaEm)}.`;
    if (d.foraDaTroca.length > 0 && d.foraDaTroca.length === d.livres.length) {
      const um = d.foraDaTroca.length === 1;
      return `${noLimite} ${um ? "A conta" : "As contas"} ${listaDePosicoes(d.foraDaTroca)} ${um ? "está" : "estão"} fora da troca automática, então o nod não troca sozinho. Seguir com ${um ? "a conta" : "uma delas"}${um ? ` ${d.foraDaTroca[0]}` : ""}?`;
    }
    return `${noLimite} Seguir com ${d.livres.length === 1 ? `a conta ${d.livres[0]}` : `a conta ${listaDePosicoes(d.livres).replace(/ e /, " ou ")}`}?`;
  }
  return `Todas as contas do ${p.ia} estão no limite${d.voltaEm !== null ? `. A primeira volta ${p.quandoVolta(d.voltaEm)}` : ""}.`;
}

/** Normaliza o contas.json do Mac: o que não tem forma vira o padrão (a conta 1 sempre existe e é a "padrao"). */
export function normalizarContas(v: unknown): ContasDaIa {
  const base = contasIniciais();
  if (!v || typeof v !== "object") return base;
  const o = v as Record<string, unknown>;
  const modo: ModoDaTroca = o.modo === "automatico" ? "automatico" : "perguntar";
  const vistas = new Set<string>();
  const contas: ContaGuardada[] = [];
  for (const bruta of Array.isArray(o.contas) ? o.contas : []) {
    const c = normalizarConta(bruta);
    if (!c || vistas.has(c.id) || contas.length >= CONTAS_POR_IA_MAX) continue;
    vistas.add(c.id);
    contas.push(c);
  }
  if (!vistas.has(ID_CONTA_PADRAO)) contas.unshift(base.contas[0] as ContaGuardada);
  const escolhida = typeof o.escolhida === "string" && vistas.has(o.escolhida) ? o.escolhida : null;
  return { modo, contas: contas.slice(0, CONTAS_POR_IA_MAX), escolhida };
}

function normalizarConta(v: unknown): ContaGuardada | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !(o.id === ID_CONTA_PADRAO || FORMA_ID.test(o.id))) return null;
  return {
    id: o.id,
    apelido: apelidoValido(o.apelido) ?? "Conta",
    plano: typeof o.plano === "string" && /^[a-z0-9_-]{1,40}$/i.test(o.plano) ? o.plano.toLowerCase() : null,
    // definido em 2026-10-12: só `true` explícito marca; qualquer outra coisa é o padrão false.
    entraNaTrocaAutomatica: o.entraNaTrocaAutomatica === true,
    noLimiteAte: Number.isSafeInteger(o.noLimiteAte) && Number(o.noLimiteAte) > 0 ? Number(o.noLimiteAte) : null,
  };
}

/** O apelido que a pessoa digitou: sem quebra de linha, até APELIDO_MAX. */
export function apelidoValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const a = v.replace(/\s+/g, " ").trim();
  return a === "" || a.length > APELIDO_MAX ? null : a;
}

export const idDeContaValido = (v: unknown): v is string => typeof v === "string" && FORMA_ID.test(v) && v !== ID_CONTA_PADRAO;

/**
 * O `contaNoLimite` que chega da máquina (ponte-validacao.ts): extra, como o uso do plano. Fora do formato some e a
 * entrega segue com o limite de sempre. Posições de 1 a CONTAS_POR_IA_MAX, sem repetir; `voltaEm` até 31 dias à frente.
 */
export function contaNoLimiteValida(v: unknown, agora: EpochMs): ContaNoLimite | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const pos = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 1 && Number(x) <= CONTAS_POR_IA_MAX;
  const lista = (x: unknown): number[] | null => (Array.isArray(x) && x.length <= CONTAS_POR_IA_MAX && x.every(pos) && new Set(x).size === x.length ? [...x] : null);
  const volta = o.voltaEm === null || o.voltaEm === undefined ? null : Number.isSafeInteger(o.voltaEm) && Number(o.voltaEm) > 0 && Number(o.voltaEm) <= agora + 31 * 86_400_000 ? Number(o.voltaEm) : undefined;
  if (volta === undefined) return undefined;
  const fora = lista(o.foraDaTroca ?? []);
  if (o.tipo === "trocou" && pos(o.de) && pos(o.para) && o.de !== o.para && fora) return { tipo: "trocou", de: o.de, para: o.para, voltaEm: volta, foraDaTroca: fora };
  const livres = lista(o.livres);
  if (o.tipo === "perguntar" && pos(o.de) && livres && livres.length > 0 && !livres.includes(o.de) && fora && fora.every((p) => livres.includes(p))) return { tipo: "perguntar", de: o.de, livres, foraDaTroca: fora, voltaEm: volta };
  const noLimite = lista(o.noLimite);
  if (o.tipo === "todas_no_limite" && noLimite && noLimite.length > 0) return { tipo: "todas_no_limite", noLimite, voltaEm: volta };
  return undefined;
}
