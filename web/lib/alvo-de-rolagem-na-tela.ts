import { criarMemoriaDeAlvos, type Elemento } from "./alvo-de-rolagem.ts";
import { rolaveisPorChave } from "./rolagem-guardada.ts";

/** ADA-12: a memória dos alvos (alvo-de-rolagem.ts, pura) ligada ao DOM, e a reserva da altura no redesenho mais curto. */

/**
 * A memória ligada ao DOM: ouve a rolagem (em captura, a caixa e os roláveis de dentro) e o tamanho do conteúdo; quando o
 * conteúdo muda de tamanho (o comentário que chega, o log que cresce, a vista que volta a crescer), leva cada rolável ao
 * alvo. Com o gesto em curso (o dedo ou o embalo, `segura`) não escreve: tenta de novo em `esperaMs`, e a rolagem segue
 * da pessoa. A caixa escondida (a troca Conversa | Quadro) não tem posição: a memória a esquece.
 *
 * Quem rola e os roláveis de dentro são resolvidos uma vez por desenho (`renovar`), não a cada evento de rolagem (ADR-061:
 * o caminho do scroll não busca no DOM; ele só lê as medidas de quem rolou).
 */
export function criarAlvosDeRolagem(doc: Document, o: { caixa: () => HTMLElement | null; conteudo: () => HTMLElement | null; segura: () => boolean; esperaMs: number; aoRolarDaPessoa?: () => void }) {
  const mem = criarMemoriaDeAlvos();
  let observado: HTMLElement | null = null;
  let caixa: HTMLElement | null = null;
  let internos: [string, HTMLElement][] = [];
  let tentar: ReturnType<typeof setTimeout> | null = null;
  const janela = doc.defaultView as (Window & typeof globalThis) | null;
  const escondida = (): boolean => !caixa || caixa.clientHeight === 0;
  function aoMudarDeTamanho(): void {
    if (tentar) { clearTimeout(tentar); tentar = null; }
    if (escondida()) { mem.esquecer(); return; }
    if (o.segura()) { tentar = setTimeout(aoMudarDeTamanho, o.esperaMs); return; }
    sincronizar();
    aplicar();
  }
  const ro = janela && typeof janela.ResizeObserver === "function" ? new janela.ResizeObserver(() => aoMudarDeTamanho()) : null;

  /** Resolve de novo a caixa, o conteúdo observado e os roláveis de dentro (a chamar a cada desenho). */
  function renovar(): void {
    caixa = o.caixa();
    const c = o.conteudo();
    internos = [];
    // Revisão 4: o campo de texto fica fora (a ADA-7 o restaura; o corte do texto apagado não é do navegador).
    if (c) for (const [k, el] of rolaveisPorChave(c)) if (el instanceof HTMLElement && el.tagName !== "TEXTAREA") internos.push([k, el]);
    if (c === observado || !ro) return;
    if (observado) ro.unobserve(observado);
    observado = c;
    if (c) ro.observe(c);
  }
  function cadaUm(f: (chave: string, el: Elemento) => void): void {
    if (escondida()) return;
    if (caixa) f("caixa", caixa);
    for (const [k, el] of internos) if (el.isConnected) f(k, el);
  }
  /** Registra a rolagem cujo evento ainda não chegou (o desenho vem antes dele no mesmo frame). */
  function sincronizar(): void { cadaUm((k, el) => mem.aoRolar(k, el)); }
  function aplicar(): void { cadaUm((k, el) => mem.aplicar(k, el)); }

  // Revisão 2: primeiro o alvo do evento (sem ler layout), e só a rolagem da caixa ou de um rolável dela lê as medidas
  // (a posição e o tamanho, como o rolagem-na-tela); a rolagem da conversa ao lado não força layout.
  const aoRolar = (ev: Event): void => {
    const alvo = ev.target === doc ? doc.scrollingElement : ev.target;
    if (!alvo) return;
    const achado: [string, HTMLElement] | undefined = caixa && alvo === caixa ? ["caixa", caixa] : internos.find(([, el]) => el === alvo);
    if (!achado || escondida()) return;
    const antes = achado[0] === "caixa" ? mem.alvo("caixa") : null;
    mem.aoRolar(achado[0], achado[1]);
    // Revisão 3: a pessoa rolou a caixa (o alvo mudou; o corte e o eco não o mudam): quem guarda a altura a solta.
    const depois = achado[0] === "caixa" ? mem.alvo("caixa") : null;
    if (depois && depois.topo !== antes?.topo) o.aoRolarDaPessoa?.();
  };
  doc.addEventListener("scroll", aoRolar, { capture: true, passive: true });

  return {
    /** Antes de regravar a mesma vista: a rolagem que o evento ainda não contou entra no alvo. */
    antes(): void { renovar(); sincronizar(); },
    /** Depois de regravar: os roláveis novos e, no redesenho ao vivo, a posição escolhida. */
    depois(aoVivo: boolean): void { renovar(); if (aoVivo) aplicar(); },
    /** A vista mudou, ou a regravação é da pessoa (filtro, painel, edição): quem a fez decide a posição. */
    esquecer(): void { mem.esquecer(); renovar(); },
    alvo: mem.alvo,
  };
}

/**
 * A altura que o conteúdo tinha antes do redesenho ao vivo fica reservada (min-height) quando o desenho novo é mais curto,
 * por `ms`: a releitura que volta curta (o trabalho novo de log vazio, os comentários relidos) e logo enche não faz a tela
 * pular. A reserva não se estende (o conteúdo que encolheu de verdade solta no prazo), não solta com o gesto em curso
 * (soltar corta a rolagem no meio do embalo) e sai na troca de vista, na regravação da pessoa e quando a pessoa rola.
 *
 * Revisão 3: a reserva é só o que mantém a tela de agora (até o fundo da janela que rola, não a altura inteira de antes):
 * o encolher abaixo da tela não deixa branco nenhum, e o que encolhe dentro dela deixa no máximo o que já estava à vista.
 * Quem está colado no fim não reserva nada (segue o fim do conteúdo novo; quem chama decide).
 */
export function criarReservaDeAltura(o: { ms: number; segura: () => boolean; esperaMs: number }) {
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  function soltar(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (el) el.style.minHeight = "";
    el = null;
  }
  function vencer(): void {
    timer = o.segura() ? setTimeout(vencer, o.esperaMs) : null;
    if (!timer) soltar();
  }
  return {
    /**
     * A altura a reservar, medida antes de regravar (só na mesma vista, no redesenho ao vivo): a do conteúdo menos o que
     * dele (e do que vem depois na caixa) está abaixo da tela. O desenho novo mais curto que isso guarda o scrollTop de agora.
     */
    antes(c: HTMLElement, caixa: Elemento | null): number {
      const altura = c.getBoundingClientRect().height;
      if (!caixa) return altura;
      return altura - Math.max(0, caixa.scrollHeight - caixa.clientHeight - caixa.scrollTop);
    },
    /** Depois de regravar: reserva a altura de antes se o conteúdo encolheu. */
    depois(c: HTMLElement, altura: number): void {
      // Dentro do prazo o relógio não se estende, mas o desenho mais alto que a reserva (e logo mais curto) sobe a reserva.
      if (timer && el === c) {
        if (altura > parseFloat(c.style.minHeight || "0") + 1 && c.getBoundingClientRect().height < altura - 1) c.style.minHeight = `${altura}px`;
        return;
      }
      if (el && el !== c) soltar();
      if (c.getBoundingClientRect().height >= altura - 1) return;
      el = c;
      c.style.minHeight = `${altura}px`;
      timer = setTimeout(vencer, o.ms);
    },
    soltar,
    /** A pessoa rolou: a reserva sai assim que o gesto acabar (o encolher já não tira a tela de onde ela pôs). */
    aoRolarDaPessoa(): void {
      if (!timer) return;
      clearTimeout(timer);
      vencer();
    },
  };
}
