import type { Tela } from "../estado/reducer.ts";

/**
 * NOD-122: a gaveta do app no marketplace (web/telas/marketplace.ts, `role="dialog" aria-modal="true"`) prende o foco.
 * Ela é montada DENTRO da `.app` (#timeline › .tela-conectores), então deixar a `.app` inerte, como Seu espaço faz,
 * mataria a própria gaveta. Ficam inertes os irmãos de cada ancestral da gaveta até a `.app` (a barra lateral, o
 * cabeçalho, o composer, a grade do marketplace); o fundo escuro continua clicável para fechar.
 */

/** O app cuja gaveta está aberta por cima da grade, ou null. As configurações avançadas não mostram a gaveta. */
export function gavetaPrendeFoco(tela: Tela): string | null {
  return tela.tipo === "conectores" && !tela.avancado && tela.gaveta ? tela.gaveta.slug : null;
}

/** O mínimo de DOM que a busca dos irmãos lê (os testes passam objetos simples). */
export interface NoDom { parentElement: NoDom | null; children: ArrayLike<NoDom>; classList?: { contains(c: string): boolean } }

/**
 * Os irmãos de `alvo` e de cada ancestral dele, parando na `raiz` (que não entra nem tem irmãos olhados).
 * `manter` poupa um irmão (o fundo da gaveta). Sem a raiz entre os ancestrais, nada fica inerte.
 */
export function irmaosAteARaiz<T extends NoDom>(alvo: T, raiz: T, manter: (no: T) => boolean = () => false): T[] {
  const fora: T[] = [];
  let no: T = alvo;
  while (no !== raiz) {
    const pai = no.parentElement as T | null;
    if (!pai) return [];
    for (const irmao of Array.from(pai.children) as T[]) if (irmao !== no && !manter(irmao)) fora.push(irmao);
    no = pai;
  }
  return fora;
}

/**
 * O `inert` tira o resto da `.app` do Tab, mas sozinho deixa o Tab do último focável da gaveta sair para a barra do
 * navegador. Aqui o Tab dá a volta (APG, padrão de diálogo modal): do último vai ao primeiro e, com Shift, do primeiro
 * ao último. Devolve o índice que deve receber o foco, ou null quando o navegador já faz o certo sozinho.
 * `atual` é -1 quando o foco está fora da gaveta (no body, por exemplo); aí o Tab entra pelo começo, e o Shift+Tab, pelo fim.
 */
export function voltaDoTab(total: number, atual: number, paraTras: boolean): number | null {
  if (total <= 0) return null;
  if (atual < 0) return paraTras ? total - 1 : 0;
  if (paraTras && atual === 0) return total - 1;
  if (!paraTras && atual === total - 1) return 0;
  return null;
}

/** Onde o foco volta ao fechar, em ordem: quem abriu (`data-act`/`data-id`) e, se ele sumiu, o cartão do app. */
export function seletoresDaOrigem(origem: { act?: string; id?: string } | null, slug: string, escapar: (s: string) => string): string[] {
  const doCartao = `#app-${escapar(slug)} .app-card-abrir`;
  if (!origem?.act) return [doCartao];
  const comId = origem.id === undefined ? "" : `[data-id="${escapar(origem.id)}"]`;
  return [`.mkt [data-act="${escapar(origem.act)}"]${comId}`, doCartao];
}
