/**
 * definido em 2026-10-28 (NOD-42): as regras puras de como a busca na conversa se revela e do gesto no celular.
 * - Computador: "⌘F busca" aparece na pílula por 3 s, uma vez só, na primeira conversa longa (> 3 alturas da área).
 * - Celular: a pílula desce 6 px uma vez, na primeira rolagem longa para trás (> 1,5 altura acima do fim); com movimento
 *   reduzido, não desce (e a marca não é gasta: o dia em que a pessoa desligar a preferência, ela ainda vê).
 * - Puxar a pílula 36 px para baixo abre; empurrar o miolo aberto 36 px para cima fecha. O segurar e o eixo do gesto
 *   moram, desde a ADA-8, em web/lib/gesto-da-pilula.ts (um tempo só, 450 ms, para a pílula inteira).
 */

export const DICA_MS = 3000;
export const MARCA_DICA = "nod.busca.dica";
export const MARCA_CUTUCAO = "nod.busca.cutucao";

export type Medidas = { conteudo: number; area: number };

export function conversaLonga(m: Medidas): boolean {
  return m.area > 0 && m.conteudo > 3 * m.area;
}

export function deveMostrarDica(c: { jaMostrou: boolean; celular: boolean } & Medidas): boolean {
  return !c.jaMostrou && !c.celular && conversaLonga(c);
}

/** `distanciaDoFim` = quanto falta rolar para chegar ao fim (scrollHeight − scrollTop − clientHeight). */
export function deveCutucar(c: { jaCutucou: boolean; celular: boolean; reduzido: boolean; distanciaDoFim: number; area: number }): boolean {
  return !c.jaCutucou && c.celular && !c.reduzido && c.area > 0 && c.distanciaDoFim > 1.5 * c.area;
}

/** Quanto a pílula acompanha o dedo enquanto puxa: metade do arrasto, até 30 px (o protótipo). */
export function deslocamentoDoPuxar(dy: number): number {
  return Math.max(0, Math.min(30, dy / 2));
}

export type Marcas = { ler(chave: string): string | null; gravar(chave: string, valor: string): void };

export function lerMarca(m: Marcas, chave: string): boolean {
  try { return m.ler(chave) === "1"; } catch { return false; }
}

export function gravarMarca(m: Marcas, chave: string): void {
  try { m.gravar(chave, "1"); } catch { /* sem localStorage (modo privado): a dica pode voltar, sem quebrar nada */ }
}

/**
 * No Mac o `registerAccelerator: false` do menu não vale (só Linux e Windows): a mesma tecla pode chegar pela página e
 * pelo item Editar › Buscar. A segunda vinda da mesma ação, até 300 ms depois e pela outra via, é a mesma tecla (2ª
 * revisão do PR 560, 2026-10-28).
 */
export const ECO_DO_MENU_MS = 300;
export type ViaDaBusca = { acao: string; via: "tecla" | "menu"; em: number };
export function ecoDoMenu(ultima: ViaDaBusca | null, nova: ViaDaBusca): boolean {
  return !!ultima && ultima.acao === nova.acao && ultima.via !== nova.via && nova.em - ultima.em >= 0 && nova.em - ultima.em < ECO_DO_MENU_MS;
}

/**
 * O filtro com memória: a vinda que é eco não vira a "última" (3ª revisão do PR 560: senão o 2º ⌘G rápido, comparado
 * com o eco do 1º, era descartado também). Devolve true quando a ação deve rodar.
 */
export function criarFiltroDeEco(): (nova: ViaDaBusca) => boolean {
  let ultima: ViaDaBusca | null = null;
  return (nova) => {
    if (ecoDoMenu(ultima, nova)) { ultima = null; return false; }
    ultima = nova;
    return true;
  };
}

/**
 * O Esc global (foco fora do miolo) fecha a busca? Não com uma camada por cima dela (Seu espaço, ligação em tela cheia,
 * onboarding, diálogo), no ditado, nem com o foco num campo — esses têm o próprio Esc antes (4ª revisão do PR 560).
 */
export function escFechaABusca(c: { aberta: boolean; camadaPorCima: boolean; ditado: boolean; emCampo: boolean }): boolean {
  return c.aberta && !c.camadaPorCima && !c.ditado && !c.emCampo;
}

/**
 * O clique que o navegador gera ao soltar o dedo depois de um gesto da pílula (QA do PR 560). Depois de SEGURAR, o menu
 * já está aberto e o clique cai no fundo dele (fechava o menu na hora): engole onde cair, menos no item do menu. Depois
 * de ARRASTAR, só no cabeçalho (não abre o painel do bot).
 */
export type GestoAnterior = "segurar" | "arrastar" | null;
export function cliqueDepoisDoGesto(gesto: GestoAnterior, onde: { noCabecalho: boolean; noMenu: boolean }): boolean {
  if (gesto === "segurar") return !onde.noMenu;
  return gesto === "arrastar" && onde.noCabecalho;
}
