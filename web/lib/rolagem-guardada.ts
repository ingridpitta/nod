/**
 * ADA-7: o quadro (e o quadro compartilhado) regrava o conteúdo com innerHTML a cada frame. Duas coisas saíam do lugar:
 * o foco devolvido com `focus()` rolava a tela até o elemento recriado (o título da tarefa aberta levava a vista ao
 * topo), e os roláveis de dentro do conteúdo (a grade das colunas, as colunas de uma página) nasciam com scroll 0.
 * Aqui fica o par guardar/restaurar e o foco que não rola.
 */

/** Os roláveis que nascem de novo a cada regravação. A chave é o seletor e a posição entre os iguais. */
export const ROLAVEIS_INTERNOS: readonly string[] = [".qd-grade", ".pg-colunas", ".qd-folha", ".qc-hist", ".qd-cel-cols"];

export type Posicao = { readonly topo: number; readonly esq: number };
export type RolagemGuardada = { readonly caixa: Posicao; readonly internos: ReadonlyMap<string, Posicao> };

/**
 * Revisão 5: o campo de texto com id (o recado, o comentário, a descrição) também rola por dentro (altura máxima com
 * overflow) e nascia com scroll 0 a cada regravação; a chave é o id, que o rascunho já usa.
 */
export const CAMPOS_ROLAVEIS = "textarea[id]";

type Rolavel = { scrollTop: number; scrollLeft: number; id?: string };
type Raiz = { querySelectorAll(sel: string): ArrayLike<Rolavel> };

/** ADA-12: os roláveis de dentro pela chave (a mesma da guarda), para a memória dos alvos ligar o evento ao rolável. */
export function rolaveisPorChave<R extends Rolavel>(raiz: { querySelectorAll(sel: string): ArrayLike<R> }): Map<string, R> {
  return chaves(raiz) as Map<string, R>;
}

function chaves(raiz: Raiz): Map<string, Rolavel> {
  const m = new Map<string, Rolavel>();
  for (const sel of ROLAVEIS_INTERNOS) {
    const els = raiz.querySelectorAll(sel);
    for (let i = 0; i < els.length; i++) { const e = els[i]; if (e) m.set(`${sel}#${i}`, e); }
  }
  const campos = raiz.querySelectorAll(CAMPOS_ROLAVEIS);
  for (let i = 0; i < campos.length; i++) { const e = campos[i]; if (e?.id) m.set(`textarea#${e.id}`, e); }
  return m;
}

/** Guarda a rolagem da caixa (a que persiste) e a dos roláveis internos que a regravação vai recriar. */
export function guardarRolagem(caixa: Rolavel, raiz: Raiz): RolagemGuardada {
  const internos = new Map<string, Posicao>();
  for (const [k, e] of chaves(raiz)) if (e.scrollTop || e.scrollLeft) internos.set(k, { topo: e.scrollTop, esq: e.scrollLeft });
  return { caixa: { topo: caixa.scrollTop, esq: caixa.scrollLeft }, internos };
}

/**
 * Devolve cada rolagem ao lugar. O navegador já limita ao máximo (o conteúdo que encolheu fica no fim); o rolável que
 * sumiu (a troca de largo para estreito) é ignorado. Só escreve quando muda: escrever o mesmo valor interromperia o
 * embalo do toque no iOS.
 */
export function restaurarRolagem(caixa: Rolavel, raiz: Raiz, r: RolagemGuardada): void {
  if (caixa.scrollTop !== r.caixa.topo) caixa.scrollTop = r.caixa.topo;
  if (caixa.scrollLeft !== r.caixa.esq) caixa.scrollLeft = r.caixa.esq;
  for (const [k, e] of chaves(raiz)) {
    const p = r.internos.get(k);
    if (!p) continue;
    if (e.scrollTop !== p.topo) e.scrollTop = p.topo;
    if (e.scrollLeft !== p.esq) e.scrollLeft = p.esq;
  }
}

/** O foco que volta depois de uma regravação não rola a tela (a pessoa fica onde estava). */
export function focarSemRolar(el: { focus(o?: { preventScroll?: boolean }): void } | null | undefined): void {
  el?.focus({ preventScroll: true });
}

/**
 * O card focado (sem id) volta a receber o foco depois da regravação: o mesmo `data-act` e `data-id`, na mesma forma
 * (a grade larga ou a lista estreita, que trazem o mesmo card). Sem isso o foco caía no body e o leitor de tela perdia
 * o lugar.
 */
export function seletorDoFocoDoCard(el: { dataset: Record<string, string | undefined>; closest(sel: string): unknown }): string | null {
  const act = el.dataset["act"];
  const id = el.dataset["id"];
  if (act !== "abrir-tarefa" || !id || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return null;
  const onde = el.closest(".qd-so-largo") ? ".qd-so-largo " : el.closest(".qd-so-estreito") ? ".qd-so-estreito " : "";
  return `${onde}[data-act="abrir-tarefa"][data-id="${id}"]`;
}
