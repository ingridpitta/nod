/**
 * ADA-12: a posição que a pessoa escolheu, guardada à parte do scrollTop. O conteúdo da tarefa aberta encolhe por um
 * instante (a releitura, o trabalho novo com o log vazio) e o navegador corta o scrollTop no máximo do conteúdo menor;
 * o desenho seguinte guardava esse valor cortado e a posição descia como uma catraca (medido em 2026-11-02 no Chrome a 1440 px: 1718 → 1633). Aqui o
 * corte do navegador não muda o alvo: só a rolagem da pessoa muda. Quem estava colada no fim segue o fim (o comentário
 * novo aparece); quem estava no meio fica no meio.
 */

/**
 * Até quantos px do fim a pessoa conta como colada nele.
 * definido em 2026-11-03: um toque de roda ou de dedo perto do fim, sem exigir o fim exato (o arredondamento do zoom).
 */
export const COLADO_PX = 24;
/**
 * Por quanto tempo depois do corte o alvo antigo ainda vale. Passado isso, o conteúdo encolheu de verdade e a posição de
 * agora vira o alvo (o conteúdo que cresce muito depois não puxa a tela de volta).
 * definido em 2026-11-03: a releitura que volta curta e enche de novo é o juntarEm de 250 ms mais um GET (estimado, não
 * medido); 3 s cobre uma segunda releitura atrasada sem deixar o alvo velho vivo.
 */
export const CORTE_MS = 3000;

export type Alvo = { readonly topo: number; readonly esq: number; readonly colado: boolean };
export type Medidas = {
  readonly scrollTop: number; readonly scrollLeft: number;
  readonly scrollHeight: number; readonly clientHeight: number;
  readonly scrollWidth: number; readonly clientWidth: number;
};

/** Se a posição de agora é o corte do navegador (abaixo do alvo e no máximo do conteúdo), em cada eixo. */
export function corteDoNavegador(alvo: Alvo | null, m: Medidas): { v: boolean; h: boolean } {
  const maxV = Math.max(0, m.scrollHeight - m.clientHeight);
  const maxH = Math.max(0, m.scrollWidth - m.clientWidth);
  return {
    v: !!alvo && m.scrollTop < alvo.topo - 1 && m.scrollTop >= maxV - 1,
    h: !!alvo && m.scrollLeft < alvo.esq - 1 && m.scrollLeft >= maxH - 1,
  };
}

/**
 * O alvo depois de uma rolagem vista. É corte do navegador (o alvo fica) quando a posição caiu abaixo do alvo e parou no
 * máximo do conteúdo; senão foi a pessoa (ou quem trocou a vista) e a posição nova vira o alvo. Cada eixo por si.
 */
export function alvoDepoisDaRolagem(alvo: Alvo | null, m: Medidas): Alvo {
  const maxV = Math.max(0, m.scrollHeight - m.clientHeight);
  const { v: corteV, h: corteH } = corteDoNavegador(alvo, m);
  return {
    topo: corteV && alvo ? alvo.topo : m.scrollTop,
    esq: corteH && alvo ? alvo.esq : m.scrollLeft,
    // Revisão 8: quem desceu até o fim de algo que mal rola (até COLADO_PX) também está colado; só quem nunca saiu do topo
    // de um conteúdo sem rolagem não está (é a tarefa que cabe inteira, que o desenho trata).
    colado: corteV && alvo ? alvo.colado : (maxV > COLADO_PX || m.scrollTop > 0) && maxV - m.scrollTop <= COLADO_PX,
  };
}

/** Onde a caixa deve estar: no fim se a pessoa estava colada nele; senão no alvo, até onde o conteúdo de agora deixa. */
export function posicaoDoAlvo(alvo: Alvo, m: Medidas): { topo: number; esq: number } {
  const maxV = Math.max(0, m.scrollHeight - m.clientHeight);
  const maxH = Math.max(0, m.scrollWidth - m.clientWidth);
  return { topo: alvo.colado ? maxV : Math.min(alvo.topo, maxV), esq: Math.min(alvo.esq, maxH) };
}

export type Elemento = Medidas & { scrollTop: number; scrollLeft: number };

/**
 * A memória dos alvos de uma vista: a caixa que rola ("caixa") e os roláveis de dentro do conteúdo (a grade, a folha,
 * pela chave do rolagem-guardada). O que a memória viu por último (`visto`) separa a rolagem nova da que ela mesma
 * escreveu.
 */
export function criarMemoriaDeAlvos(agora: () => number = Date.now) {
  type Entrada = { alvo: Alvo; visto: { t: number; l: number }; cortadoEm: number | null };
  const alvos = new Map<string, Entrada>();
  /** O alvo cortado há mais de CORTE_MS: a posição de agora passa a ser o alvo (o conteúdo encolheu de verdade). */
  function expirar(e: Entrada, el: Elemento): void {
    if (e.cortadoEm === null || agora() - e.cortadoEm <= CORTE_MS) return;
    e.alvo = alvoDepoisDaRolagem(null, el);
    e.cortadoEm = null;
  }
  return {
    /** Uma rolagem possível em `el`: a posição igual à última vista é ignorada (é o eco do que a memória escreveu). */
    aoRolar(chave: string, el: Elemento): void {
      const e = alvos.get(chave);
      if (e && Math.abs(el.scrollTop - e.visto.t) < 0.5 && Math.abs(el.scrollLeft - e.visto.l) < 0.5) return;
      // O rolável que nasceu no começo e ninguém rolou não tem alvo (a regravação o recria no começo de novo).
      if (!e && !el.scrollTop && !el.scrollLeft) return;
      if (e) expirar(e, el);
      const corte = corteDoNavegador(e?.alvo ?? null, el);
      const cortadoEm = corte.v || corte.h ? e?.cortadoEm ?? agora() : null;
      alvos.set(chave, { alvo: alvoDepoisDaRolagem(e?.alvo ?? null, el), visto: { t: el.scrollTop, l: el.scrollLeft }, cortadoEm });
    },
    /** Leva `el` ao alvo. Só escreve o que muda (escrever o mesmo valor corta o embalo do toque no iOS). */
    aplicar(chave: string, el: Elemento): void {
      const e = alvos.get(chave);
      if (!e) return;
      expirar(e, el);
      const p = posicaoDoAlvo(e.alvo, el);
      if (Math.abs(el.scrollTop - p.topo) > 0.5) el.scrollTop = p.topo;
      if (Math.abs(el.scrollLeft - p.esq) > 0.5) el.scrollLeft = p.esq;
      e.visto = { t: el.scrollTop, l: el.scrollLeft };
      // Revisão 3: o alvo que o conteúdo de agora não alcança está cortado (o relógio do CORTE_MS começa aqui, não só no
      // evento de rolagem, que o eco da escrita não gera); o alvo alcançado de novo encerra o corte.
      const c = corteDoNavegador(e.alvo, el);
      if (c.v || c.h) e.cortadoEm ??= agora(); else e.cortadoEm = null;
    },
    alvo: (chave: string): Alvo | null => alvos.get(chave)?.alvo ?? null,
    /** A vista mudou (outra tarefa, outra página): quem a trocou decide a posição. */
    esquecer(): void { alvos.clear(); },
  };
}
