import type { Memoria } from "../contracts/memoria.ts";

/**
 * NOD-60 (ADR-136): que memórias entram no prompt de texto de cada turno. Antes, o prompt levava as 40 MAIS ANTIGAS: da 41ª
 * em diante, nada novo chegava ao bot (ele dizia "Anotei" e esquecia no turno seguinte). Agora, quando a memória não cabe
 * inteira, entram um núcleo fixo (as preferências e as mais recentes) e as achadas pela busca léxica do turno (o repo,
 * `buscarPorTexto`). Sem modelo: a escolha é pura e a busca é uma query só.
 *
 * Os tetos são constantes ajustáveis; o prompt fica com a memória na parte volátil (NOD-155), então variar por turno não
 * quebra o cache.
 */
/** Definido em 2026-10-28 (NOD-60): o teto de linhas que já existia no prompt; os tetos abaixo vêm da issue. */
export const MEMORIAS_NO_PROMPT = 40;
/** Definido em 2026-10-28 (NOD-60): ~1.500 tokens; contado nas linhas como entram no prompt (com a quebra de linha). */
export const CHARS_DE_MEMORIA = 6000;
/** Definido em 2026-10-28 (NOD-60): uma memória longa entra cortada, nunca some; 3 delas ainda deixam espaço às outras. */
export const CHARS_POR_MEMORIA = 1500;
/** Espaço do teto guardado para o recall enquanto o núcleo é escolhido: uma linha cortada (`CHARS_POR_MEMORIA`) + folga. */
export const RESERVA_DO_RECALL = CHARS_POR_MEMORIA + 100;
/** Definido em 2026-10-28: teto conjunto das preferências; todas entram, cortadas por igual quando preciso. */
export const CHARS_DAS_PREFERENCIAS = 2_500;
/** Definido em 2026-10-28 (NOD-60): núcleo = todas as preferências até 15 + as 10 mais recentes (critério da issue). */
export const PREFERENCIAS_NO_NUCLEO = 15;
export const RECENTES_NO_NUCLEO = 10;
/** Definido em 2026-10-28 (NOD-60): até 15 achadas pela busca do turno (critério da issue). */
export const RECALL_POR_TURNO = 15;
/** Definido em 2026-10-28 (NOD-60): o começo da mensagem basta para achar o assunto e mantém a query barata. */
export const CONSULTA_MAX = 2000;
/** Quantas a busca devolve: o recall mais as que podem já estar no núcleo (essas não contam como recall). */
export const ACHADAS_POR_BUSCA = RECALL_POR_TURNO + PREFERENCIAS_NO_NUCLEO + RECENTES_NO_NUCLEO;

export type EscolhaDeMemorias = {
  /** As que entram, na ordem do prompt (criação, depois id). */
  memorias: Memoria[];
  /** Quantas o bot tem. */
  total: number;
  /** Quantas entraram pelo núcleo (todas, quando a memória cabe inteira). */
  nucleo: number;
  /** Quantas entraram só pela busca do turno. */
  recall: number;
};

/** A linha da memória no prompt (prompt-sistema.ts a escreve igual). */
export function linhaDaMemoria(m: Pick<Memoria, "tipo" | "texto">): string {
  return `- [${m.tipo}] ${m.texto}`;
}

const porCriacao = (a: Memoria, b: Memoria): number => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id);
const charsDa = (m: Pick<Memoria, "tipo" | "texto">): number => linhaDaMemoria(m).length + 1;

/** A memória como entra quando é preciso escolher: o texto longo vai cortado em CHARS_POR_MEMORIA, com "…". */
function cortada(m: Memoria, limite = CHARS_POR_MEMORIA): Memoria {
  if (m.texto.length <= limite) return m;
  // Por ponto de código: o corte não parte um emoji ao meio.
  let corte = "";
  for (const c of m.texto) {
    if (corte.length + c.length > limite - 1) break;
    corte += c;
  }
  return { ...m, texto: `${corte.trimEnd()}…` };
}

/** Mantém todas as preferências, repartindo o orçamento entre as longas sem penalizar as curtas. */
function preferenciasNoOrcamento(preferencias: readonly Memoria[], teto: number): Memoria[] {
  if (preferencias.reduce((s, m) => s + charsDa(m), 0) <= teto) return [...preferencias];
  let minimo = 1;
  let maximo = CHARS_POR_MEMORIA;
  while (minimo < maximo) {
    const meio = Math.ceil((minimo + maximo) / 2);
    const chars = preferencias.reduce((s, m) => s + charsDa(cortada(m, meio)), 0);
    if (chars <= teto) minimo = meio;
    else maximo = meio - 1;
  }
  return preferencias.map((m) => cortada(m, minimo));
}

/** A memória inteira cabe no prompt: nada a escolher, e a busca nem precisa rodar. */
export function memoriaCabeInteira(todas: readonly Memoria[]): boolean {
  if (todas.length > MEMORIAS_NO_PROMPT) return false;
  let chars = 0;
  for (const m of todas) chars += charsDa(m);
  return chars <= CHARS_DE_MEMORIA;
}

/** O texto da busca do turno: a mensagem da pessoa, o pedido do colega ou a instrução da rotina. Vazio = sem busca. */
export function consultaDoTurno(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim().slice(0, CONSULTA_MAX).trim();
  return t === "" ? null : t;
}

/**
 * Escolhe as memórias do turno. Cabe inteira: todas, na ordem de sempre (núcleo = total). Não cabe: por prioridade,
 * as preferências (as 15 mais recentes), as 10 mais recentes que ainda não entraram e as achadas pela busca (na ordem de
 * relevância, até 15); a vaga que sobra vai para as próximas mais recentes (contam no núcleo). Para em 40 linhas e
 * 6 mil caracteres: o texto longo entra cortado em 1.500 e a linha que ainda estouraria é pulada (a seguinte tenta).
 * Achada que não é do bot (`todas` não a tem) é ignorada. A saída volta à ordem de criação.
 */
export function escolherMemoriasDoTurno(entrada: { todas: readonly Memoria[]; achadas?: readonly Memoria[] }): EscolhaDeMemorias {
  const ordenadas = [...entrada.todas].sort(porCriacao);
  const total = ordenadas.length;
  if (memoriaCabeInteira(ordenadas)) return { memorias: ordenadas, total, nucleo: total, recall: 0 };

  const doBot = new Map(ordenadas.map((m) => [m.id, cortada(m)]));
  const recentes = [...doBot.values()].reverse();
  const escolhidas = new Map<string, Memoria>();
  let chars = 0;
  // Com achadas, o núcleo (preferências + recentes) não passa do teto menos a reserva: sobra espaço para ao menos uma
  // achada cortada. O preenchimento final usa o teto inteiro.
  const tetoDoNucleo = (entrada.achadas?.length ?? 0) > 0 ? CHARS_DE_MEMORIA - RESERVA_DO_RECALL : CHARS_DE_MEMORIA;
  const tentar = (m: Memoria, teto = CHARS_DE_MEMORIA): boolean => {
    if (escolhidas.has(m.id) || escolhidas.size >= MEMORIAS_NO_PROMPT) return false;
    const c = charsDa(m);
    if (chars + c > teto) return false;
    escolhidas.set(m.id, m);
    chars += c;
    return true;
  };

  // Todas as preferências entram: se forem longas, dividem o sub-teto por corte, sem tirar as recentes.
  let nucleo = 0;
  const preferencias = recentes.filter((x) => x.tipo === "preferencia").slice(0, PREFERENCIAS_NO_NUCLEO);
  for (const m of preferenciasNoOrcamento(preferencias, Math.min(tetoDoNucleo, CHARS_DAS_PREFERENCIAS))) {
    if (tentar(m, tetoDoNucleo)) nucleo++;
  }
  let novas = 0;
  for (const m of recentes) {
    if (novas >= RECENTES_NO_NUCLEO) break;
    if (tentar(m, tetoDoNucleo)) { nucleo++; novas++; }
  }
  let recall = 0;
  for (const a of entrada.achadas ?? []) {
    if (recall >= RECALL_POR_TURNO) break;
    const m = doBot.get(a.id);
    if (m && tentar(m)) recall++;
  }
  for (const m of recentes) {
    if (escolhidas.size >= MEMORIAS_NO_PROMPT) break;
    if (tentar(m)) nucleo++;
  }
  return { memorias: [...escolhidas.values()].sort(porCriacao), total, nucleo, recall };
}
