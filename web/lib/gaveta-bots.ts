import { areaVisivel, CONSULTA_CELULAR } from "./celular.ts";
import { MARCA_HISTORICO, voltarPeloHistorico } from "./inicio-celular.ts";

/** O toque abre as ações da mensagem (relatar) só se não caiu num link, botão ou campo dentro dela. */
export const SELETOR_INTERATIVO = "a, button, input, textarea, select, summary, label, [role='button'], [contenteditable='true']";

/** Quanto dura a entrada do chat pela direita (protótipo nod-379 v3: 280 ms). Com movimento reduzido, nada anima. */
// definido em 2026-10-28: protótipo nod-379 v3 aprovado.
export const MS_ENTRADA_DO_CHAT = 280;

export interface Celular {
  /** true quando a consulta de celular casa agora. */
  ativo(): boolean;
  /** A tela inicial está à vista (só no celular). */
  botsAbertos(): boolean;
  /** Mostra a inicial sem mexer no histórico (a busca do ⌘K). */
  abrirBots(): void;
  /** Esconde a inicial sem empilhar no histórico (Seu espaço, onboarding, o bot da conversa saiu). */
  fecharBots(): void;
  /** Entrar numa conversa a partir da inicial: empilha uma entrada no histórico (o voltar do navegador volta à inicial). */
  entrarNaConversa(): void;
  /** O ‹ da conversa: desempilha a entrada nossa ou, sem ela (link, recarregar), só mostra a inicial. */
  voltarAoInicio(): void;
  /** Sem sessão não há inicial: a entrada (no palco) não fica inerte. O render chama a cada desenho. */
  definirSessao(ativa: boolean): void;
}

/**
 * NOD-379 (protótipo nod-379 v3; emenda da ADR-094): no celular a barra de bots (#sidebar) deixa de ser gaveta e vira a
 * tela inicial — o app abre nela, ocupando a tela inteira. Tocar num bot esconde a inicial e o chat entra da direita; o
 * ‹ do cabeçalho (`data-act="abrir-bots"`) e o voltar do navegador mostram a inicial de novo, na mesma rolagem (a barra
 * só é escondida, nunca refeita por isso). No computador nada disto liga: a barra é a coluna de sempre.
 * Também liga o `inert` da parte escondida, a altura acima do teclado e o toque que mostra as ações da mensagem.
 */
export function criarCelular(aoMudar: () => void = () => undefined): Celular {
  const consulta = window.matchMedia(CONSULTA_CELULAR);
  const movimentoReduzido = window.matchMedia("(prefers-reduced-motion: reduce)");
  const app = document.querySelector<HTMLElement>(".app");
  const sidebar = document.getElementById("sidebar");
  const stage = document.querySelector<HTMLElement>(".stage");
  // O app abre na inicial (o main a esconde quando o onboarding pendente abre o guia).
  let noInicio = true;
  let timerEntrada = 0;
  let comSessao = false;
  // O ‹ fez history.back() e o popstate ainda não chegou. Se a pessoa entra num bot nesse meio-tempo, a entrada é
  // empilhada quando ele chegar (antes, o popstate atrasado trazia a inicial por cima da conversa recém-aberta).
  let esperandoPop = false;
  // Recarregar (ou o iOS restaurar a aba) mantém o history.state: a marca de antes não vale para este documento, que abre
  // na inicial. Sem limpar, o ‹ daria back() para o documento anterior e entrar num bot não empilharia nada.
  if (voltarPeloHistorico(window.history.state)) window.history.replaceState(null, "");

  function pintar(): void {
    const ligado = consulta.matches && comSessao;
    const mostrar = ligado && noInicio;
    app?.classList.toggle("bots-abertos", mostrar);
    // Escondida, a parte de fora não recebe Tab nem leitor de tela.
    if (sidebar) sidebar.inert = ligado && !mostrar;
    if (stage) stage.inert = mostrar;
    // A gaveta do bot (#detalhes) é irmã do palco e fica por cima da inicial: mostrar a inicial (o voltar do navegador
    // com ela aberta) a fecha. Fechada, no celular ela é display: none (interface.css), sem foco nem leitor de tela.
    if (mostrar) app?.classList.remove("detalhes-abertos");
  }

  function mudar(proximo: boolean, animar = false): void {
    if (noInicio === proximo) return;
    // A origem do foco é lida antes de a barra ficar inerte e ser redesenhada.
    if (!proximo && consulta.matches) lembrarOrigem();
    noInicio = proximo;
    clearTimeout(timerEntrada);
    app?.classList.remove("chat-entrando");
    if (animar && !proximo && consulta.matches && !movimentoReduzido.matches) {
      app?.classList.add("chat-entrando");
      timerEntrada = window.setTimeout(() => app?.classList.remove("chat-entrando"), MS_ENTRADA_DO_CHAT + 40);
    }
    pintar();
    aoMudar();
    if (!consulta.matches) return;
    // O foco anda depois do redesenho que vem a seguir (o navegar troca o cabeçalho logo depois).
    queueMicrotask(() => { if (noInicio === proximo) moverFoco(proximo); });
  }

  // O foco não fica numa parte que acabou de ficar inerte (leitor de tela e teclado perderiam a posição): entrando na
  // conversa vai ao ‹; voltando, à linha de onde a pessoa saiu (ou ao avatar). Sem rolar a tela.
  let conversaDeOrigem = "";
  let focoNaInicial = false;
  function lembrarOrigem(): void {
    const ativo = document.activeElement;
    focoNaInicial = !!ativo && !!sidebar?.contains(ativo);
    conversaDeOrigem = (ativo instanceof HTMLElement && focoNaInicial && ativo.dataset.conversa) || "";
  }
  function moverFoco(paraInicio: boolean): void {
    const ativo = document.activeElement;
    if (!paraInicio) {
      const perdido = !ativo || ativo === document.body || !!sidebar?.contains(ativo);
      if (focoNaInicial && perdido) document.querySelector<HTMLElement>('.stage [data-act="abrir-bots"]')?.focus({ preventScroll: true });
      return;
    }
    if (ativo && sidebar?.contains(ativo)) return;
    const linha = conversaDeOrigem ? sidebar?.querySelector<HTMLElement>(`[data-conversa="${CSS.escape(conversaDeOrigem)}"]`) : null;
    (linha ?? sidebar?.querySelector<HTMLElement>(".me-topo"))?.focus({ preventScroll: true });
  }

  function ajustarAltura(): void {
    const area = areaVisivel(window.visualViewport, consulta.matches);
    const raiz = document.documentElement.style;
    if (area) {
      raiz.setProperty("--altura-visivel", `${area.altura}px`);
      raiz.setProperty("--topo-visivel", `${area.topo}px`);
      // NOD-381: com o teclado aberto a caixa fica 8 px acima dele (o iOS mantém a área segura de baixo, 34 px).
      // Revisão 4: compara com o clientHeight (a viewport de layout, que o teclado não encolhe) e só com um campo em foco.
      document.documentElement.classList.toggle("teclado-aberto", tecladoAberto(area.altura, document.documentElement.clientHeight, document.activeElement));
    } else {
      document.documentElement.classList.remove("teclado-aberto");
      raiz.removeProperty("--altura-visivel");
      raiz.removeProperty("--topo-visivel");
    }
  }

  // O voltar do navegador (ou o gesto de voltar do iPhone) desempilha a entrada da conversa: a inicial volta.
  window.addEventListener("popstate", (ev) => {
    if (esperandoPop) {
      esperandoPop = false;
      if (!noInicio && consulta.matches) window.history.pushState({ [MARCA_HISTORICO]: "conversa" }, "");
      return;
    }
    if (!consulta.matches || voltarPeloHistorico(ev.state)) return;
    mudar(true);
  });
  // ADA-2 F5 (ADR-156 §2, emenda da ADR-113): o toque simples na mensagem não abre mais nada no celular; as ações da fala
  // (a barra e o ⋯) vão para o menu do toque longo (web/main.ts, abrirMenuSeguradoDaFala).
  // Virar celular (girar, encolher a janela) começa na inicial; virar computador volta à coluna de sempre.
  consulta.addEventListener("change", () => {
    noInicio = true;
    clearTimeout(timerEntrada);
    app?.classList.remove("chat-entrando");
    pintar();
    ajustarAltura();
    aoMudar();
  });
  window.visualViewport?.addEventListener("resize", ajustarAltura);
  window.visualViewport?.addEventListener("scroll", ajustarAltura);
  window.addEventListener("resize", ajustarAltura);
  pintar();
  ajustarAltura();

  return {
    ativo: () => consulta.matches,
    botsAbertos: () => consulta.matches && comSessao && noInicio,
    definirSessao: (ativa) => {
      if (comSessao === ativa) return;
      comSessao = ativa;
      pintar();
    },
    abrirBots: () => { if (consulta.matches) mudar(true); },
    fecharBots: () => { if (consulta.matches) mudar(false); },
    entrarNaConversa: () => {
      if (!consulta.matches) return;
      if (noInicio && !esperandoPop && !voltarPeloHistorico(window.history.state)) window.history.pushState({ [MARCA_HISTORICO]: "conversa" }, "");
      mudar(false, true);
    },
    voltarAoInicio: () => {
      if (!consulta.matches) return;
      // A inicial aparece já (dois toques no ‹ não fazem dois back()); o popstate depois não muda nada. Sem entrada
      // nossa, history.back() sairia do app.
      if (!noInicio && !esperandoPop && voltarPeloHistorico(window.history.state)) {
        esperandoPop = true;
        window.history.back();
      }
      mudar(true);
    },
  };
}

/** NOD-381: o teclado está aberto quando a área visível ficou 100 px menor que a de layout e há um campo de texto em foco. */
export function tecladoAberto(alturaVisivel: number, alturaDoLayout: number, foco: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  const editavel = !!foco && (foco.tagName === "TEXTAREA" || foco.tagName === "INPUT" || foco.isContentEditable === true);
  return editavel && alturaVisivel < alturaDoLayout - 100;
}
