/**
 * NOD-379 (protótipo nod-379 v3): no celular o ⋯ do bot sai e o menu dele abre no toque longo. O iOS não dispara
 * `contextmenu` no toque, então o gesto é medido aqui: segurar 450 ms sem arrastar (mais de 10 px cancela, para a rolagem
 * da lista continuar livre) dispara; o clique que vem depois do gesto é engolido, para não abrir a conversa por baixo.
 * Puro (relógio injetado) para o teste rodar sem janela; o main liga nos eventos de ponteiro.
 */
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const MS_TOQUE_LONGO = 450;
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const TOLERANCIA_PX = 10;

/** Quanto tempo depois de soltar o clique do próprio gesto ainda é engolido. */
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const MS_JANELA_CLIQUE = 400;

export type Relogio = { agendar(fn: () => void, ms: number): number; cancelar(id: number): void; agora(): number };

export type ToqueLongo<T> = {
  comecar(alvo: T, x: number, y: number): void;
  mover(x: number, y: number): void;
  soltar(): void;
  /** Um toque fora de um bot (no menu, por exemplo): o gesto anterior já acabou e o clique dele não vem mais. */
  esquecer(): void;
  /**
   * true uma vez, para o clique que vem logo depois de soltar um gesto que disparou: quem ouve o clique o descarta. Se o
   * navegador não mandar esse clique (o Chrome do Android não manda depois do contextmenu), o próximo clique — o item do
   * menu — passa: o sinal some no próximo toque e fora da janela.
   */
  engolirClique(): boolean;
};

/**
 * `disparar` devolve false quando não abriu nada (o alvo saiu da tela no meio do gesto): aí o clique ao soltar não é
 * engolido e o toque vale como um toque comum.
 */
export function criarToqueLongo<T>(relogio: Relogio, disparar: (alvo: T) => boolean | void, ms = MS_TOQUE_LONGO): ToqueLongo<T> {
  let atual: { alvo: T; x: number; y: number; timer: number } | null = null;
  let disparou = false;
  let soltouEm = -Infinity;
  const parar = () => {
    if (atual) relogio.cancelar(atual.timer);
    atual = null;
  };
  return {
    comecar(alvo, x, y) {
      parar();
      disparou = false;
      const timer = relogio.agendar(() => {
        atual = null;
        disparou = disparar(alvo) !== false;
        soltouEm = Infinity;
      }, ms);
      atual = { alvo, x, y, timer };
    },
    mover(x, y) {
      if (atual && Math.hypot(x - atual.x, y - atual.y) > TOLERANCIA_PX) parar();
    },
    soltar() {
      parar();
      if (disparou && soltouEm === Infinity) soltouEm = relogio.agora();
    },
    esquecer() {
      parar();
      disparou = false;
    },
    engolirClique() {
      const v = disparou && relogio.agora() - soltouEm <= MS_JANELA_CLIQUE;
      disparou = false;
      return v;
    },
  };
}

/** Distância entre o bot segurado e o menu, e do menu à borda da tela. */
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const VAO_MENU_SEGURADO = 8;
// definido em 2026-10-28: mesma margem de borda do abrirMenu (gestao-agentes.ts).
export const MARGEM_TELA = 12;

/**
 * Onde o menu do toque longo nasce: logo abaixo do bot se couber; senão logo acima; sem caber em nenhum, no lado com mais
 * espaço e com altura máxima (rola por dentro). Nunca cobre o bot segurado.
 */
export function lugarDoMenuSegurado(bot: { topo: number; base: number }, alturaMenu: number, alturaTela: number): { topo: number; alturaMaxima: number | null } {
  const abaixo = alturaTela - MARGEM_TELA - (bot.base + VAO_MENU_SEGURADO);
  const acima = bot.topo - VAO_MENU_SEGURADO - MARGEM_TELA;
  if (alturaMenu <= abaixo) return { topo: bot.base + VAO_MENU_SEGURADO, alturaMaxima: null };
  if (alturaMenu <= acima) return { topo: bot.topo - VAO_MENU_SEGURADO - alturaMenu, alturaMaxima: null };
  if (abaixo >= acima) return { topo: bot.base + VAO_MENU_SEGURADO, alturaMaxima: Math.max(0, abaixo) };
  return { topo: MARGEM_TELA, alturaMaxima: Math.max(0, acima) };
}

/** A altura máxima da lista do menu para o diálogo inteiro (lista + moldura) caber em `alturaMaxima`. */
export function alturaDaLista(alturaMaxima: number, alturaDialogo: number, alturaLista: number): number {
  return Math.max(0, alturaMaxima - (alturaDialogo - alturaLista));
}

/**
 * A barra foi redesenhada durante o toque longo: entre as linhas do mesmo bot (favorito e lista), a do mesmo tipo (a
 * primeira classe: `fixado` ou `bot-row`); sem ela, a primeira; sem nenhuma, -1.
 */
export function escolherRedesenhada(classeSegurada: string, classes: string[]): number {
  const tipo = classeSegurada.split(" ")[0];
  const i = classes.findIndex((c) => c.split(" ")[0] === tipo);
  return i !== -1 ? i : classes.length ? 0 : -1;
}

/** A dica "Segure um bot para ver as ações" aparece uma vez só (some no ✕, em 6 s ou no primeiro toque longo). */
export const CHAVE_DICA_TOQUE_LONGO = "nod.dicaToqueLongo";
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const MS_DICA = 6000;

export function dicaJaVista(storage: Pick<Storage, "getItem"> | null): boolean {
  try { return storage?.getItem(CHAVE_DICA_TOQUE_LONGO) === "1"; } catch { return true; }
}

export function marcarDicaVista(storage: Pick<Storage, "setItem"> | null): void {
  try { storage?.setItem(CHAVE_DICA_TOQUE_LONGO, "1"); } catch { /* sem storage: vale só nesta aba */ }
}
