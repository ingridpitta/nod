/**
 * NOD-460: o que o quadro em tela cheia mostra. Filtro rápido (Todas · Comigo · um chip por agente · "n trabalhando") e a
 * busca por título ou código, sem acento nem caixa. Tudo é estado da tela (não vai ao servidor) e puro: quem guarda o
 * estado e redesenha é web/lib/quadro-na-tela.ts; quem desenha é web/telas/quadro-real.ts.
 */
import type { ColunaDto, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "./escape.ts";

/** O filtro rápido da barra. `agente:<id>` = só as tarefas daquele bot. */
export type Filtro = "todos" | "comigo" | "trabalhando" | `agente:${string}`;

/** Até onde a busca lê (o título tem 200; mais que isso não acha nada a mais). */
export const LIMITE_BUSCA = 200;
/** Quantos agentes viram chip na barra; o resto vai no "+N". */
export const CHIPS_A_VISTA = 4;

export function ehFiltro(f: unknown): f is Filtro {
  return f === "todos" || f === "comigo" || f === "trabalhando" || (typeof f === "string" && /^agente:.+/.test(f));
}

export const agenteDoFiltro = (f: Filtro): string | null => (f.startsWith("agente:") ? f.slice("agente:".length) : null);

/** Um caractere (ou o par de surrogates) na forma de comparar: minúsculo e sem acento. */
const normalizarUm = (c: string): string => c.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");

/** Sem acento e sem caixa ("Ação" e "acao" são iguais). */
export function normalizar(s: string): string {
  let r = "";
  for (const c of s) r += normalizarUm(c);
  return r;
}

/** O termo da busca como a tela compara: aparado, no teto e normalizado; "" = sem busca. */
export function termoDaBusca(busca: string): string {
  return normalizar(busca.trim().slice(0, LIMITE_BUSCA)).trim();
}

/**
 * A tarefa espera quem lê ("Comigo"). ADR-162 (sem a coluna Precisa de você): a pergunta pendente do bot (a marca
 * `esperaPessoa`, menos quando é outra pessoa que decide, NOD-443 D6), Bloqueado e a coluna "só a pessoa tira daqui"
 * (NOD-419) — o mesmo que o servidor chama de espera da pessoa (esperaPessoa em src/domain/avisos-quadro.ts).
 */
export function ehComigo(t: Pick<TarefaDto, "status" | "decide" | "esperaPessoa">, colunas: readonly Pick<ColunaDto, "id" | "trava">[] = []): boolean {
  if (t.esperaPessoa) return !(t.decide && !t.decide.voce);
  // A marca `voce` de antes da ADR-162 (o status ainda existe no servidor) também é comigo, como o funil contava.
  return t.status === "bloqueado" || t.status === "voce" || colunas.find((c) => c.id === t.status)?.trava?.soPessoa === true;
}

/**
 * T5 (comparação Multica × nod, 2026-11-10): o bot está trabalhando agora nesta tarefa. A execução que o servidor calculou
 * ou, sem ela, a linha de estado do card (a frente aberta conta como trabalhando). Uma regra só para o card, a pílula de
 * agentes ativos, o filtro rápido e o funil ("Status do agente: Trabalhando agora"); antes as contagens não batiam.
 */
export function trabalhandoAgora(t: Pick<TarefaDto, "execucao" | "estadoLinha">): boolean {
  return (t.execucao ?? (t.estadoLinha?.tipo === "trabalhando" ? "rodando" : null)) === "rodando";
}

export function passaNoFiltro(t: Pick<TarefaDto, "status" | "decide" | "agenteId" | "execucao" | "esperaPessoa" | "estadoLinha">, f: Filtro, colunas: readonly Pick<ColunaDto, "id" | "trava">[] = []): boolean {
  if (f === "todos") return true;
  if (f === "comigo") return ehComigo(t, colunas);
  if (f === "trabalhando") return trabalhandoAgora(t);
  return t.agenteId === agenteDoFiltro(f);
}

/** Passa na busca quando o termo (já normalizado) está no título ou no código do quadro ou do Linear ("ZE-12", "12"). */
export function passaNaBusca(t: Pick<TarefaDto, "titulo" | "codigo"> & { linearId?: string | null }, termo: string): boolean {
  if (!termo) return true;
  return normalizar(t.titulo).includes(termo) || normalizar(t.codigo ?? "").includes(termo) || normalizar(t.linearId ?? "").includes(termo);
}

export const passaNaVista = (t: TarefaDto, f: Filtro, termo: string, colunas: readonly Pick<ColunaDto, "id" | "trava">[] = []): boolean => passaNoFiltro(t, f, colunas) && passaNaBusca(t, termo);

/**
 * O texto escapado, com cada ocorrência do termo dentro de `<mark class="qd-mark">`. A comparação é sem acento e sem
 * caixa, mas o que aparece é o texto original ("Ação" acha "acao" e marca "Ação").
 */
export function marcar(texto: string, termo: string): string {
  if (!termo) return esc(texto);
  // Cada caractere normalizado aponta para o começo e o fim do caractere original de onde veio; o acento solto (que
  // some na forma de comparar) estende o fim do anterior, para a marca não cortar "a" de "á" decomposto.
  let norm = "";
  const ini: number[] = [];
  const fim: number[] = [];
  let i = 0;
  for (const c of texto) {
    const n = normalizarUm(c);
    if (!n.length && fim.length) fim[fim.length - 1] = i + c.length;
    for (let k = 0; k < n.length; k++) { ini.push(i); fim.push(i + c.length); }
    norm += n;
    i += c.length;
  }
  let r = "";
  let desde = 0;
  for (let de = norm.indexOf(termo); de >= 0; de = norm.indexOf(termo, de + termo.length)) {
    const a = ini[de]!;
    const b = fim[de + termo.length - 1]!;
    if (a < desde) continue;
    r += esc(texto.slice(desde, a)) + `<mark class="qd-mark">${esc(texto.slice(a, b))}</mark>`;
    desde = b;
  }
  return r + esc(texto.slice(desde));
}

export interface ChipDeAgente { agenteId: string; n: number }

/** Os agentes com tarefa no quadro, do que tem mais para o que tem menos (empate: na ordem em que aparecem). */
export function agentesComTarefa(tarefas: readonly Pick<TarefaDto, "agenteId">[]): ChipDeAgente[] {
  const n = new Map<string, number>();
  for (const t of tarefas) if (t.agenteId) n.set(t.agenteId, (n.get(t.agenteId) ?? 0) + 1);
  return [...n].map(([agenteId, k]) => ({ agenteId, n: k })).sort((a, b) => b.n - a.n);
}

/**
 * Os chips à vista e os do "+N". O agente escolhido que estaria no "+N" vem para a vista (no lugar do último), para o
 * filtro ligado ficar sempre à mostra.
 */
export function chipsDaBarra(tarefas: readonly Pick<TarefaDto, "agenteId">[], filtro: Filtro, vista = CHIPS_A_VISTA): { vista: ChipDeAgente[]; mais: ChipDeAgente[] } {
  const todos = agentesComTarefa(tarefas);
  const escolhido = agenteDoFiltro(filtro);
  const a = todos.slice(0, vista);
  const resto = todos.slice(vista);
  const i = escolhido ? resto.findIndex((c) => c.agenteId === escolhido) : -1;
  if (i >= 0 && a.length) {
    const [veio] = resto.splice(i, 1);
    resto.unshift(a.pop()!);
    a.push(veio!);
  }
  return { vista: a, mais: resto };
}

/** Quantas tarefas o filtro e a busca deixam à vista. */
export const contarNaVista = (tarefas: readonly TarefaDto[], f: Filtro, termo: string, colunas: readonly Pick<ColunaDto, "id" | "trava">[] = []): number => tarefas.filter((t) => passaNaVista(t, f, termo, colunas)).length;

/**
 * A linha do vazio inline (ajuste aprovado: sem modal). Null = há o que mostrar ou não há filtro nem busca (o vazio de
 * cada coluna basta). `nomeDoAgente` dá o nome do chip escolhido.
 */
export function fraseDoVazio(f: Filtro, busca: string, nomeDoAgente: (id: string) => string | null): string | null {
  const termo = busca.trim().slice(0, LIMITE_BUSCA);
  const ag = agenteDoFiltro(f);
  const nome = ag ? nomeDoAgente(ag) ?? "deste agente" : "";
  const onde = f === "todos" ? "no quadro" : f === "comigo" ? "nas suas tarefas" : f === "trabalhando" ? "nas que estão rodando" : `nas tarefas de ${nome}`;
  if (termo) return `Nada com “${termo}” ${onde}.`;
  if (f === "todos") return null;
  if (f === "comigo") return "Nada esperando você agora.";
  if (f === "trabalhando") return "Ninguém está trabalhando agora.";
  return `${nome} não tem tarefa neste quadro.`;
}
