/**
 * Instância única e estado da janela web (definido em 2026-10-05, NOD-137). Abrir o nod de novo (segunda cópia, Dock,
 * clique no aviso) traz a janela atual para a frente, inclusive minimizada; a janela web reabre onde a pessoa deixou,
 * sempre inteira numa tela que existe. Sem Electron: tipos estruturais, testável no vitest
 * (tests/unit/desktop/janela.test.ts). Tela cheia não é lembrada (reabre em janela normal); maximizada é.
 */

export type EstadoJanela = { x: number; y: number; largura: number; altura: number; maximizada: boolean };
/** A área útil de um monitor (workArea do Electron). */
export type Area = { x: number; y: number; width: number; height: number };
export type JanelaFocavel = { isDestroyed(): boolean; isMinimized(): boolean; restore(): void; show(): void; focus(): void };
export type JanelaMedivel = { isDestroyed(): boolean; isMinimized(): boolean; isFullScreen(): boolean; isMaximized(): boolean; getNormalBounds(): Area };

/**
 * NOD-93 (passo 10): a janela de primeiro uso da VM local. Quando o download do disco começa (o disco desta versão não
 * está no cache: a primeira vez, ou depois de atualizar o app), o app traz a janela e abre o painel do computador com a
 * janela de primeiro uso do protótipo v2 (`primeiroUso`: a cena do mascote por etapa, parada com prefers-reduced-motion,
 * a barra com os MB e o ghost "Continuar em segundo plano"; web/lib/computador-pessoa.ts htmlJanelaDoPreparo), uma vez
 * por sessão. Em segundo plano, o download segue e o progresso fica no anel do menu.
 */
export function abrirPrimeiroUsoDaVm(anterior: string | null, atual: string, jaAbriu: boolean): boolean {
  return !jaAbriu && atual === "baixando" && anterior !== "baixando";
}

/** O minWidth da janela web; numa tela mais estreita, vale a largura da tela. */
export const LARGURA_MINIMA = 900;

/** Minimizada volta antes de aparecer; nula ou destruída, nada. */
export function focarJanela(w: JanelaFocavel | null | undefined): void {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

/**
 * O estado a gravar agora, ou null quando não se grava: destruída (getNormalBounds lança) ou minimizada. `anterior` é o
 * último estado gravado.
 * - Em tela cheia (UAT da NOD-137, 2026-10-05): o anterior sem maximizada. Fechou em tela cheia, abre em janela normal no
 *   tamanho de antes, mesmo que tenha entrado na tela cheia maximizada; sair da tela cheia mede de novo.
 * - Maximizada: os bounds normais do anterior. No macOS o getNormalBounds() só anda com maximize()/setBounds()/minimizar
 *   do próprio Electron; depois do zoom da pessoa (duplo clique na barra, Option+verde) ele devolve os bounds da criação.
 * Passa pela mesma regra da leitura: um tamanho zerado não entra na memória e reabriria a janela sem altura.
 */
export function medirEstadoJanela(w: JanelaMedivel, anterior: EstadoJanela | null): EstadoJanela | null {
  if (w.isDestroyed() || w.isMinimized()) return null;
  if (w.isFullScreen()) return anterior && { ...anterior, maximizada: false };
  const maximizada = w.isMaximized();
  if (maximizada && anterior) return { ...anterior, maximizada };
  const b = w.getNormalBounds();
  return lerEstadoJanela({ x: b.x, y: b.y, largura: b.width, altura: b.height, maximizada });
}

const inteiro =(v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** O conteúdo de userData/janela.json (texto ou já lido): só inteiros, tamanho positivo e maximizada booleana. Copiado. */
export function lerEstadoJanela(bruto: unknown): EstadoJanela | null {
  let v = bruto;
  if (typeof v === "string") {
    try { v = JSON.parse(v) as unknown; } catch { return null; }
  }
  if (typeof v !== "object" || v === null) return null;
  const { x, y, largura, altura, maximizada } = v as Record<string, unknown>;
  if (!inteiro(x) || !inteiro(y) || !inteiro(largura) || !inteiro(altura) || largura <= 0 || altura <= 0 || typeof maximizada !== "boolean") return null;
  return { x, y, largura, altura, maximizada };
}

function intersecao(e: EstadoJanela, a: Area): number {
  const l = Math.min(e.x + e.largura, a.x + a.width) - Math.max(e.x, a.x);
  const h = Math.min(e.y + e.altura, a.y + a.height) - Math.max(e.y, a.y);
  return l > 0 && h > 0 ? l * h : 0;
}

function limitar(v: number, min: number, max: number): number { return Math.min(Math.max(v, min), max); }

/**
 * Os bounds com que a janela web nasce: no monitor de maior interseção com o estado gravado, com o tamanho entre o mínimo
 * (900, limitado à área) e a área útil, e a posição presa dentro dela. Sem estado ou sem interseção (monitor desconectado):
 * centralizada no principal. `principal` vem à parte porque getAllDisplays() não garante a ordem.
 */
export function resolverEstadoJanela(estado: EstadoJanela | null, telas: { principal: Area; todas: readonly Area[] }, padrao: { largura: number; altura: number }): EstadoJanela {
  let area: Area | null = null;
  let melhor = 0;
  if (estado) {
    for (const a of telas.todas) {
      const i = intersecao(estado, a);
      if (i > melhor) { melhor = i; area = a; }
    }
  }
  const alvo = area ?? telas.principal;
  const base = estado ?? { ...padrao, x: 0, y: 0, maximizada: false };
  const largura = Math.min(Math.max(base.largura, Math.min(LARGURA_MINIMA, alvo.width)), alvo.width);
  const altura = Math.min(base.altura, alvo.height);
  const maximizada = estado?.maximizada ?? false;
  if (!estado || !area) {
    return { x: alvo.x + Math.round((alvo.width - largura) / 2), y: alvo.y + Math.round((alvo.height - altura) / 2), largura, altura, maximizada };
  }
  return { x: limitar(estado.x, alvo.x, alvo.x + alvo.width - largura), y: limitar(estado.y, alvo.y, alvo.y + alvo.height - altura), largura, altura, maximizada };
}
