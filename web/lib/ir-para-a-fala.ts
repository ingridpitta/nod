import { passoDoAlvo, vizinhaDesenhada } from "./busca-celular.ts";

/**
 * NOD-363 (extraído do NOD-380): levar a uma fala que pode estar fora da janela do chat. O alvo marcado faz cada leitura
 * da conversa sair com `?ate=` (a janela cresce até a fala, contínua, e não encolhe nas releituras); a espera olha o que
 * a resposta disse (`veio`) e o desenho da timeline. Sem DOM aqui: a busca do celular e a Biblioteca injetam o mundo.
 */
export type AlvoDaFala = { conversaId: string; mensagemId: string; veio?: boolean; veioEm?: number; desenhado?: boolean };

export type MundoDaFala<E> = {
  /** A conversa aberta na tela (conversa ou sala), ou null. */
  conversaDaTela(): string | null;
  alvo(): AlvoDaFala | null;
  trocarAlvo(a: AlvoDaFala | null): void;
  /** Os ids da conversa no estado, na ordem dela. */
  idsDaConversa(conversaId: string): readonly string[];
  /** A fala desenhada na timeline, ou null. */
  desenhada(mensagemId: string): E | null;
  /** Relê a conversa (a leitura sai com o `ate` do alvo, se houver). */
  reler(conversaId: string): void;
  agendar(fn: () => void, ms: number): unknown;
  agora(): number;
};

export const ESPERA_ALVO_MS = 20_000;
export const INTERVALO_ALVO_MS = 120;

/**
 * Marca o alvo, relê e espera a timeline desenhar a fala. A fala que veio e não se desenha (recolhida no meio de um turno)
 * leva à vizinha desenhada; a que não veio (apagada, ou além do teto do `ate`) chama `aoFalhar(true)`; o prazo vencido,
 * `aoFalhar(false)`. A tela que trocou de conversa chama `aoCancelar`; `valendo()` falso (o menu fechou) para e chama `aoParar`.
 */
export function levarAFalaComAte<E>(
  m: MundoDaFala<E>,
  conversaId: string,
  mensagemId: string,
  c: { aoChegar(el: E, vizinha: boolean): void; aoFalhar(antiga: boolean): void; aoCancelar?(): void; aoParar?(): void; valendo?(): boolean },
): void {
  const atual = m.alvo();
  if (atual?.conversaId !== conversaId || atual.mensagemId !== mensagemId) m.trocarAlvo({ conversaId, mensagemId });
  m.reler(conversaId);
  const desiste = m.agora() + ESPERA_ALVO_MS;
  const meu = (): AlvoDaFala | null => {
    const a = m.alvo();
    return a?.conversaId === conversaId && a.mensagemId === mensagemId ? a : null;
  };
  const chegar = (el: E, vizinha: boolean): void => {
    const a = meu();
    if (a) a.desenhado = true;
    c.aoChegar(el, vizinha);
  };
  const tentar = (): void => {
    // Revisão 2 (achado 5): o menu que outro diálogo removeu sem `close` para aqui; quem marcou o alvo o solta.
    if (c.valendo && !c.valendo()) return c.aoParar?.();
    if (m.conversaDaTela() !== conversaId) return c.aoCancelar?.();
    const el = m.desenhada(mensagemId);
    const a = meu();
    const passo = passoDoAlvo({ desenhada: el !== null, veio: a?.veio, veioEm: a?.veioEm, agora: m.agora(), desiste });
    if (passo === "levar" && el !== null) return chegar(el, false);
    if (passo === "antiga") return c.aoFalhar(true);
    if (passo === "vizinha") {
      const perto = vizinhaNoEstado(m, conversaId, mensagemId);
      if (perto !== null) return chegar(perto, true);
    }
    if (m.agora() < desiste) m.agendar(tentar, INTERVALO_ALVO_MS);
    else c.aoFalhar(false);
  };
  m.agendar(tentar, 0);
}

function vizinhaNoEstado<E>(m: MundoDaFala<E>, conversaId: string, mensagemId: string): E | null {
  const perto = vizinhaDesenhada(m.idsDaConversa(conversaId), mensagemId, (x) => m.desenhada(x) !== null);
  return perto === null ? null : m.desenhada(perto);
}

/** O que o "Ir para a mensagem" da Biblioteca faz na tela (o menu aberto). */
export type MenuDoIr<E> = {
  aberto(): boolean;
  carregando(): void;
  /** Volta o item ao normal e mostra a nota da falha (`antiga`: não veio; senão, demorou). */
  falhou(antiga: boolean): void;
  fechar(): void;
  /** Fecha o menu e a gaveta sobreposta do celular, e só então rola (e realça só a fala pedida, não a vizinha). */
  irAte(el: E, vizinha: boolean): void;
};

export type ResultadoDoIr = "foi" | "vizinha" | "carregando" | "fora-da-tela";

/**
 * NOD-363: o clique em "Ir para a mensagem" na Biblioteca.
 * - Desenhada: vai na hora, sem rede (critério 3).
 * - No estado mas recolhida: vai à vizinha desenhada, sem rede e sem trocar o alvo (revisão 1, achado 1: a janela já crescida
 *   não encolhe até um `ate` mais recente).
 * - Fora do estado: o item vira "Carregando…" e a conversa relê com `?ate=`. Em geral a fala fora do estado é mais antiga
 *   que a janela e o `ate` só a faz crescer; um anexo novo que a Biblioteca viu antes da releitura do chat é a exceção
 *   (a janela vai até ele e, se falhar, o alvo de antes volta).
 * - A Biblioteca de outra conversa (a tela mudou): fecha o menu.
 * Devolve também o `soltar` (para o fechar do menu): a espera que não chegou devolve o alvo de antes (revisão 2, achado 1:
 * um Ir que falha não encolhe a janela que um Ir anterior, ou a busca, fez crescer).
 */
export function irParaFalaDaBiblioteca<E>(m: MundoDaFala<E>, ui: MenuDoIr<E>, conversaId: string, mensagemId: string): { resultado: ResultadoDoIr; soltar(): void } {
  const nada = { soltar: () => undefined };
  if (m.conversaDaTela() !== conversaId) { ui.fechar(); return { resultado: "fora-da-tela", ...nada }; }
  // Revisão 3 (achado M2, critério 5): ir a uma fala já carregada também segura a janela — sem alvo, a próxima fala nova
  // (SSE) relê as 200 recentes e a tiraria de debaixo de quem lê. Sem reler: o `ate` só vale na próxima leitura, e o
  // servidor nunca devolve menos que as 200 com ele. Um alvo já marcado nesta conversa fica (a janela já cresceu até ele).
  const segurar = (): void => { if (m.alvo()?.conversaId !== conversaId) m.trocarAlvo({ conversaId, mensagemId, veio: true, desenhado: true }); };
  const el = m.desenhada(mensagemId);
  if (el !== null) { segurar(); ui.irAte(el, false); return { resultado: "foi", ...nada }; }
  if (m.idsDaConversa(conversaId).includes(mensagemId)) {
    const perto = vizinhaNoEstado(m, conversaId, mensagemId);
    if (perto !== null) { segurar(); ui.irAte(perto, true); return { resultado: "vizinha", ...nada }; }
  }
  // Revisão 3 (B4): só um alvo desenhado (alguém lendo ali) é o de antes; o de outra espera não volta.
  const atual = m.alvo();
  const anterior = atual?.conversaId === conversaId && atual.mensagemId !== mensagemId && atual.desenhado ? atual : null;
  // Revisão 3 (B3): com a tela em outra conversa, o de antes não volta (o main já o soltou ao navegar).
  const soltar = (): void => { soltarAlvoNaoDesenhado(m, conversaId, mensagemId, m.conversaDaTela() === conversaId ? anterior : null); };
  ui.carregando();
  levarAFalaComAte(m, conversaId, mensagemId, {
    valendo: () => ui.aberto(),
    aoChegar: (x, vizinha) => ui.irAte(x, vizinha),
    aoParar: soltar,
    aoCancelar: () => { soltar(); ui.fechar(); },
    aoFalhar: (antiga) => {
      soltar();
      if (ui.aberto()) ui.falhou(antiga);
    },
  });
  return { resultado: "carregando", soltar };
}

/**
 * O alvo que não se desenhou (menu fechado no meio, falha) sai e a conversa relê com o `ate` de antes, ou sem nenhum
 * (revisão 1, achado 5: a janela volta de uma vez, em vez de ficar crescida por uma resposta já em voo). O alvo desenhado
 * fica: a pessoa está lendo ali, e ele sai quando ela volta ao fim (alvoNoFimDaConversa).
 */
export function soltarAlvoNaoDesenhado(m: Pick<MundoDaFala<unknown>, "alvo" | "trocarAlvo" | "reler">, conversaId: string, mensagemId: string, anterior: AlvoDaFala | null = null): boolean {
  const a = m.alvo();
  if (a?.conversaId !== conversaId || a.mensagemId !== mensagemId || a.desenhado) return false;
  m.trocarAlvo(anterior);
  m.reler(conversaId);
  return true;
}

/**
 * NOD-380/NOD-363: o que a resposta da conversa diz do alvo. Só a resposta pedida com o `ate` do alvo conta: uma leitura
 * sem ele, já em voo antes do clique, não vira "antiga demais". Muda o alvo no lugar (é o mesmo objeto da espera).
 */
export function notarVeio(alvo: AlvoDaFala | null, conversaId: string, ate: string | undefined, ids: readonly string[], agora: number): void {
  if (!ate || alvo?.conversaId !== conversaId || alvo.mensagemId !== ate) return;
  alvo.veio = ids.includes(ate);
  if (alvo.veio) alvo.veioEm ??= agora;
}

/** A tela e o DOM que o mundo da fala lê (tipos estruturais: os testes rodam sem a lib DOM). */
export type TelaDaFala = { tipo: string; conversaId?: string };
export function criarMundoDaFala<E>(d: {
  tela(): TelaDaFala;
  alvo: { ler(): AlvoDaFala | null; gravar(a: AlvoDaFala | null): void };
  mensagens(conversaId: string): readonly { id: string }[] | undefined;
  noTimeline(seletor: string): E | null;
  escapar(s: string): string;
  invalidar(chave: string): void;
  agendar(fn: () => void, ms: number): unknown;
  agora(): number;
}): MundoDaFala<E> {
  return {
    conversaDaTela: () => { const t = d.tela(); return (t.tipo === "conversa" || t.tipo === "sala") && t.conversaId ? t.conversaId : null; },
    alvo: () => d.alvo.ler(),
    trocarAlvo: (a) => d.alvo.gravar(a),
    idsDaConversa: (id) => (d.mensagens(id) ?? []).map((x) => x.id),
    desenhada: (id) => d.noTimeline(`#timeline [data-mensagem="${d.escapar(id)}"]`),
    reler: (id) => d.invalidar(`conversa:${id}`),
    agendar: d.agendar,
    agora: d.agora,
  };
}

/** O item Ir e a região de status do menu, e o que fazer com a nota (tipos estruturais). */
export type ItemDoIrNoMenu = { textContent: string | null; setAttribute(n: string, v: string): void; removeAttribute(n: string): void };
export function criarMenuDoIr<E>(d: {
  item: ItemDoIrNoMenu | null;
  status: { textContent: string | null } | null;
  aberto(): boolean;
  marcar(item: ItemDoIrNoMenu): void;
  desmarcar(item: ItemDoIrNoMenu): void;
  textoCarregando: string;
  nota(antiga: boolean): string;
  trocarNota(html: string | null): void;
  posicionar(): void;
  focarNota(): void;
  fechar(): void;
  irAte(el: E, vizinha: boolean): void;
}): MenuDoIr<E> {
  return {
    aberto: d.aberto,
    carregando: () => {
      if (d.item) d.marcar(d.item);
      d.trocarNota(null);
      if (d.status) d.status.textContent = d.textoCarregando;
    },
    falhou: (antiga) => {
      if (d.item) d.desmarcar(d.item);
      if (d.status) d.status.textContent = "";
      d.trocarNota(d.nota(antiga));
      d.posicionar();
      d.focarNota();
    },
    fechar: d.fechar,
    irAte: d.irAte,
  };
}

/**
 * Revisão 3 (achado M1): a fala trocada com um colega mora num `<details class="troca">` fechado. Abrir os `details`
 * fechados acima dela antes de rolar (o redesenho os reabre pelo `data-disclosure`); senão a rolagem e o foco caem num nó
 * invisível e nada acontece.
 */
export type NoComDetalhes = { closest(seletor: string): { open: boolean } | null };
export function abrirDetalhesAcima(el: NoComDetalhes): void {
  for (let d = el.closest("details:not([open])"), voltas = 0; d && voltas < 20; d = el.closest("details:not([open])"), voltas++) d.open = true;
}
