import { seletoresDoFoco } from "./foco-do-bloco.ts";
import { htmlDaPilula, type PartesDaPilula } from "../telas/pilula-do-bot.ts";

/**
 * A pílula do bot na tela (definido em 2026-10-18, chat limpo, PR 8; revisão de engenharia do plano, item 17). As decisões
 * moram em web/lib/pilula.ts e o HTML em web/telas/pilula-do-bot.ts; aqui, o DOM:
 *
 * - **um esqueleto que fica**: o botão e o painel nascem uma vez por bot, e cada desenho troca só o miolo que mudou (o texto
 *   do botão, o cabeçalho, a lista, o pé). Regravar o painel a cada passo de uma frente cortaria a animação no meio e
 *   tiraria o foco do item;
 * - **o painel é absoluto**, ancorado acima do campo, com `contain: layout paint` e desenhado já no tamanho final; a
 *   animação é `clip-path: inset(…)` saindo do retângulo da pílula (mais `opacity`), sem mexer no fluxo da timeline nem no
 *   campo (o protótipo animava `width`/`max-height`, que reflui a cada quadro);
 * - **escondida = `hidden`**: durante a saída (opacidade e deslize) a pílula já fica `inert`; no fim, `hidden`. Com
 *   movimento reduzido, tudo na hora;
 * - **o foco**: ao alargar, o primeiro item; ao fechar com o foco dentro, a pílula. Quem fecha porque a fala entrou na vista
 *   (main.ts) leva o foco à fala antes.
 */

/** definido em 2026-10-18: a maior duração das transições da pílula no CSS (o `clip-path` do painel, .42 s), com folga. */
export const FIM_DA_TRANSICAO_MS = 460;

export type DesenhoDaPilula =
  | null
  | { tipo: "legado"; html: string }
  | { tipo: "pilula"; partes: PartesDaPilula; aberta: boolean; escondida: boolean };

export type PilulaNaTela = {
  desenhar(d: DesenhoDaPilula): void;
  /** O foco está dentro do painel (ou no botão da pílula)? */
  focoDentro(): boolean;
  /** O foco volta ao botão da pílula (Esc, "fechar"). */
  focarBotao(): void;
};

type Esqueleto = { raiz: HTMLElement; chave: string; botao: HTMLButtonElement; memoria: HTMLElement; painel: HTMLElement; cab: HTMLElement; corpo: HTMLElement; pe: HTMLElement; partes: PartesDaPilula; aberta: boolean; escondida: boolean };

/** `lugar` é a região acima do campo (#faixa-trabalhos); `palco`, o pai dela e da timeline (ganha a classe que abre espaço). */
export function criarPilulaNaTela(lugar: HTMLElement, palco: HTMLElement, c: { reduzido: () => boolean; agendar: (fn: () => void, ms: number) => number; cancelar: (id: number) => void }): PilulaNaTela {
  let atual: Esqueleto | null = null;
  let legado: string | null = null;
  let saida = 0;
  let fechamento = 0;

  const dentro = (): boolean => {
    const ativo = document.activeElement;
    return atual !== null && ativo instanceof HTMLElement && atual.raiz.contains(ativo);
  };

  /** Troca o miolo de uma parte só quando mudou; o foco que morava nela volta ao mesmo botão (como `regiaoPorBlocos`). */
  function trocar(el: HTMLElement, antes: string, depois: string): void {
    if (antes === depois) return;
    const focado = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement : null;
    el.innerHTML = depois;
    if (focado && !focado.isConnected) {
      for (const seletor of seletoresDoFoco(focado.dataset)) {
        const alvo = el.querySelector<HTMLElement>(seletor);
        if (alvo) { alvo.focus({ preventScroll: true }); break; }
      }
    }
  }

  function montar(partes: PartesDaPilula, aberta: boolean, escondida: boolean): Esqueleto {
    lugar.innerHTML = htmlDaPilula(partes, { aberta, escondida });
    const raiz = lugar.firstElementChild as HTMLElement;
    const q = <T extends HTMLElement>(s: string): T => raiz.querySelector(s) as T;
    return { raiz, chave: partes.chave, botao: q(".pf-botao"), memoria: q(".pf-memoria-lugar"), painel: q(".pf-painel"), cab: q(".pf-cab"), corpo: q(".pf-miolo"), pe: q(".pf-pe"), partes, aberta, escondida };
  }

  /** O espaço embaixo da timeline e a pílula das novas acima desta só existem com a pílula à vista. */
  function marcarPalco(visivel: boolean): void {
    if (palco.classList.contains("com-pilula-frentes") !== visivel) palco.classList.toggle("com-pilula-frentes", visivel);
  }

  function esconder(e: Esqueleto, escondida: boolean): void {
    if (e.escondida === escondida) return;
    e.escondida = escondida;
    c.cancelar(saida);
    marcarPalco(!escondida);
    if (escondida) {
      // Sai do Tab já na saída; `hidden` quando a transição acaba (na hora com movimento reduzido).
      e.raiz.inert = true;
      e.raiz.classList.add("escondida");
      if (c.reduzido()) e.raiz.hidden = true;
      else saida = c.agendar(() => { if (atual === e && e.escondida) e.raiz.hidden = true; }, FIM_DA_TRANSICAO_MS);
      return;
    }
    e.raiz.hidden = false;
    e.raiz.inert = false;
    // O quadro com `escondida` precisa existir antes de tirá-la, senão a entrada não anima.
    if (!c.reduzido()) void e.raiz.offsetWidth;
    e.raiz.classList.remove("escondida");
  }

  function alargar(e: Esqueleto, aberta: boolean): void {
    if (e.aberta === aberta) return;
    e.aberta = aberta;
    c.cancelar(fechamento);
    const tinhaFoco = dentro();
    e.botao.setAttribute("aria-expanded", String(aberta));
    if (aberta) {
      // O painel nasce no retângulo da pílula: a largura dela vai para o `clip-path` inicial.
      e.raiz.style.setProperty("--pilula-w", `${Math.round(e.botao.parentElement?.getBoundingClientRect().width ?? 300)}px`);
      e.painel.hidden = false;
      if (!c.reduzido()) void e.painel.offsetWidth;
      e.raiz.dataset.estado = "aberta";
      // As linhas entram uma a uma só com movimento (o CSS também desliga, mas sem a classe não há o que desligar).
      if (!c.reduzido()) e.painel.classList.add("entrando");
      fechamento = c.agendar(() => e.painel.classList.remove("entrando"), FIM_DA_TRANSICAO_MS + 300);
      // Foco no primeiro item (plano, 4c); sem item, no "fechar".
      const primeiro = e.corpo.querySelector<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])") ?? e.cab.querySelector<HTMLElement>(".pf-fechar");
      primeiro?.focus({ preventScroll: true });
      return;
    }
    e.raiz.dataset.estado = "fechada";
    e.painel.classList.remove("entrando");
    // O foco que estava no painel volta à pílula antes de ele sumir (senão cai no <body>).
    if (tinhaFoco && !e.escondida) e.botao.focus({ preventScroll: true });
    if (c.reduzido()) e.painel.hidden = true;
    else fechamento = c.agendar(() => { if (atual === e && !e.aberta) e.painel.hidden = true; }, FIM_DA_TRANSICAO_MS);
  }

  return {
    desenhar(d) {
      if (!d || d.tipo === "legado") {
        c.cancelar(saida);
        c.cancelar(fechamento);
        atual = null;
        marcarPalco(false);
        const html = d?.html ?? "";
        if (legado !== html) { legado = html; lugar.innerHTML = html; }
        return;
      }
      legado = null;
      const { partes, aberta, escondida } = d;
      if (!atual || atual.chave !== partes.chave || !atual.raiz.isConnected) {
        c.cancelar(saida);
        c.cancelar(fechamento);
        atual = montar(partes, aberta, escondida);
        if (escondida) atual.raiz.classList.add("escondida");
        atual.raiz.inert = escondida;
        marcarPalco(!escondida);
        return;
      }
      const e = atual;
      trocar(e.botao, e.partes.botao, partes.botao);
      trocar(e.memoria, e.partes.memoria, partes.memoria);
      trocar(e.cab, e.partes.cab, partes.cab);
      trocar(e.corpo, e.partes.corpo, partes.corpo);
      trocar(e.pe, e.partes.pe, partes.pe);
      if (e.partes.rotulo !== partes.rotulo) e.painel.setAttribute("aria-label", partes.rotulo);
      e.partes = partes;
      // Fechar antes de esconder: o foco vai à pílula só quando ela continua à vista.
      if (!aberta) alargar(e, false);
      esconder(e, escondida);
      if (aberta) alargar(e, true);
    },
    focoDentro: dentro,
    focarBotao() {
      atual?.botao.focus({ preventScroll: true });
    },
  };
}
