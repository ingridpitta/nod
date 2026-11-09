import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import { contarAbertas, novasAbertas, novasMensagens, redigirAviso, type Aviso, type PedidoNovo } from "./avisos.ts";

/**
 * Quando avisar (definido em 2026-09-24, "aviso no Mac"): as regras de silêncio sobre o que avisos.ts
 * diz que é novo. Relógio, foco e saída são injetados — o teste roda com relógio falso, sem DOM.
 *
 *  - só com o nod FORA da frente (`document.hasFocus()` falso na hora de mostrar): na frente, o pedido
 *    já está na tela e o aviso seria ruído;
 *  - espera 2 s para juntar o que chega junto (uma rotina que pede três acessos vira um aviso);
 *  - revisto em 2026-10-28 (NOD-114): um aviso por BOT, nunca misturando bots, e no máximo um por 60 s por bot: o que
 *    chega no meio entra no próximo daquele bot;
 *  - duas entradas: "Sua vez" (aprovação, pergunta, precisa de você) e "Não lidos" (o aviso do bot, a rotina que não
 *    rodou, o turno que terminou); cada uma com a sua linha de base na primeira leitura;
 *  - nunca o mesmo pedido duas vezes;
 *  - nada nos 5 s depois de um gesto da pessoa (agir() em web/main.ts): o que nasce do próprio clique
 *    ela já sabe — o aviso espera, e só sai se ela não estiver mais na frente;
 *  - trocou a sessão, esquece tudo: a próxima leitura volta a ser só a linha de base.
 */
export const AGRUPAR_MS = 2_000;
export const INTERVALO_MS = 60_000;
export const SILENCIO_APOS_ACAO_MS = 5_000;

export type RelogioAvisador = {
  agora(): number;
  /** Agenda `fn` para daqui a `ms`; devolve o cancelamento. */
  esperar(ms: number, fn: () => void): () => void;
};

export type DepsAvisador = {
  relogio: RelogioAvisador;
  temFoco(): boolean;
  /** A pessoa ligou os avisos (e o navegador ou o macOS deixa). */
  ligado(): boolean;
  pessoaId(): string | null;
  mostrar(aviso: Aviso): void;
  /** O nome do bot pela frota (a fala dos não lidos não traz). Ausente ou null: "Seu bot". */
  nomeDoBot?(agenteId: string): string | null;
};

export type Avisador = {
  /** Depois de cada leitura de "Sua vez": guarda o que é novo e devolve o número do selo. */
  atualizar(suaVez: SuaVezDto): number;
  /** Depois de cada leitura de "Não lidos" (NOD-114): guarda as falas que avisam. */
  atualizarNaoLidos(naoLidos: NaoLidosDto): void;
  /** A pessoa agiu: nada de aviso nos próximos 5 s. */
  acaoPropria(): void;
  /** A sessão trocou. */
  reiniciar(): void;
};

/** O que o avisador guarda de cada bot: o lote que espera, desde quando, o último aviso e o timer. */
type DoBot = { pendentes: PedidoNovo[]; primeiroEm: number; ultimoAviso: number; cancelar: (() => void) | null; marcadoPara: number };

export function criarAvisador(deps: DepsAvisador): Avisador {
  let conhecidas: Set<string> | null = null;
  let conhecidasMsg: Set<string> | null = null;
  /** Ids das decisões abertas e chaves das falas não lidas na última leitura: o resolvido antes da hora não vira aviso. */
  let abertas = new Set<string>();
  let abertasMsg = new Set<string>();
  const avisados = new Set<string>();
  const bots = new Map<string, DoBot>();
  let ultimaAcao = Number.NEGATIVE_INFINITY;

  const doBot = (agenteId: string): DoBot => {
    let b = bots.get(agenteId);
    if (!b) bots.set(agenteId, (b = { pendentes: [], primeiroEm: 0, ultimoAviso: Number.NEGATIVE_INFINITY, cancelar: null, marcadoPara: Number.NaN }));
    return b;
  };
  const segueAberto = (p: PedidoNovo): boolean => p.ids.some((id) => abertas.has(id) || abertasMsg.has(id));

  function reagendar(agenteId: string): void {
    const b = doBot(agenteId);
    if (b.pendentes.length === 0) return;
    const quando = Math.max(b.primeiroEm + AGRUPAR_MS, b.ultimoAviso + INTERVALO_MS, ultimaAcao + SILENCIO_APOS_ACAO_MS);
    if (b.cancelar && quando === b.marcadoPara) return;
    b.cancelar?.();
    b.marcadoPara = quando;
    b.cancelar = deps.relogio.esperar(Math.max(0, quando - deps.relogio.agora()), () => disparar(agenteId));
  }

  function disparar(agenteId: string): void {
    const b = doBot(agenteId);
    b.cancelar = null;
    const lote = b.pendentes.filter((p) => segueAberto(p) && !p.ids.some((id) => avisados.has(id)));
    b.pendentes = [];
    // Na frente (ou desligado), o lote se perde de propósito: ela está vendo a tela.
    if (lote.length === 0 || deps.temFoco() || !deps.ligado()) return;
    const aviso = redigirAviso(lote, deps.pessoaId(), (id) => deps.nomeDoBot?.(id) ?? null);
    if (!aviso) return;
    for (const p of lote) for (const id of p.ids) avisados.add(id);
    b.ultimoAviso = deps.relogio.agora();
    deps.mostrar(aviso);
  }

  function acolher(novas: readonly PedidoNovo[]): void {
    const tocados = new Set<string>();
    for (const n of novas) {
      if (n.ids.some((id) => avisados.has(id))) continue;
      const b = doBot(n.agenteId);
      if (b.pendentes.length === 0) b.primeiroEm = deps.relogio.agora();
      b.pendentes.push(n);
      tocados.add(n.agenteId);
    }
    for (const id of tocados) reagendar(id);
  }

  return {
    atualizar(suaVez) {
      const r = novasAbertas(conhecidas, suaVez);
      conhecidas = r.conhecidas;
      abertas = new Set(suaVez.itens.filter((i) => i.estadoColuna !== "vencido").flatMap((i) => [i.decisao.id, ...i.gemeas]));
      acolher(r.novas);
      return contarAbertas(suaVez);
    },
    atualizarNaoLidos(naoLidos) {
      const r = novasMensagens(conhecidasMsg, naoLidos);
      conhecidasMsg = r.conhecidas;
      abertasMsg = r.abertas;
      acolher(r.novas);
    },
    acaoPropria() {
      ultimaAcao = deps.relogio.agora();
      for (const id of bots.keys()) reagendar(id);
    },
    reiniciar() {
      for (const b of bots.values()) b.cancelar?.();
      bots.clear();
      conhecidas = null;
      conhecidasMsg = null;
      abertas = new Set();
      abertasMsg = new Set();
      avisados.clear();
      ultimaAcao = Number.NEGATIVE_INFINITY;
    },
  };
}
