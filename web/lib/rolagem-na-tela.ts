import { chaveDoProgresso, progressoNaTela, SEM_PROGRESSO, type ProgressoNaTela } from "./pilula.ts";
import { depoisDeRolar, distanciaDoFim, permanenciaDaLinha, pilulaDaPergunta, pilulaDasNovas, type LinhaNaJanela, type Medida, type Permanencia, type PerguntaNaJanela } from "./rolagem.ts";

/**
 * A rolagem da conversa na tela (definido em 2026-10-05): o estado "colada no fim" e a pílula da base, ligados à caixa
 * que rola. As decisões moram em web/lib/rolagem.ts, sem DOM, onde os testes as alcançam.
 */
export type Rolagem = {
  /**
   * Depois de regravar a timeline: a conversa que mudou abre colada; colada, desce até o fim. `null` = a tela não é
   * chat. `historicoMudou` = o histórico (onde moram a linha "Novas" e as sugestões da conversa vazia) foi mexido.
   */
  depoisDeDesenhar(conversaId: string | null, historicoMudou: boolean): void;
  /** Volta a acompanhar o fim (a pessoa mandou mensagem). */
  colar(): void;
  /** Para de acompanhar ANTES de levar a outro ponto (pergunta, aprovação): senão o próximo crescimento puxa de volta. */
  soltar(): void;
  /** A pílula das novas: leva a linha "Novas" para o alto da janela. */
  irParaNovas(): void;
  /** A pessoa já viu a linha "Novas" que entrou acima desta mensagem? */
  jaViu(mensagemId: string): boolean;
  /**
   * O progresso na fala trocou de bloco sem regravar a timeline (`criarProgressoNaTela`, PR 7): mede de novo, para a pílula
   * do bot (PR 8) decidir com o bloco de agora — uma frente nova no lote muda o `data-frentes` sem rolagem nenhuma.
   */
  progressoTrocado(): void;
};

/**
 * `caixa` é a região que rola (#timeline); `lugarDaPilula`, logo acima do campo. `aoMudarProgresso` (chat limpo, PR 8) ouve
 * o progresso na fala entrando e saindo da vista: a pílula do bot some com ele à vista.
 */
export function criarRolagem(caixa: HTMLElement, lugarDaPilula: HTMLElement, suave: () => boolean, aoMudarProgresso: (p: ProgressoNaTela) => void = () => undefined): Rolagem {
  let conversa: string | null = null;
  let estado = { colada: true, topoAntes: 0 };
  /** A linha "Novas" (o data-novas dela) que já ficou na janela o bastante nesta visita. */
  let linhaVista: string | null = null;
  let permanencia: Permanencia = null;
  let observado: Element | null = null;
  let pilulaHtml = "";
  // A linha "Novas" e as sugestões moram no histórico: são procuradas quando ele muda, não a cada evento. Procurar na
  // timeline inteira (dezenas de milhares de nós numa conversa longa) a cada quadro de streaming é o que a ADR-061 tirou.
  let linha: HTMLElement | null = null;
  let cartao: HTMLElement | null = null;
  let vazia = false;
  // Os lugares do progresso na fala (`[data-progresso]`, PR 8), procurados quando o histórico muda, como a linha "Novas" e o
  // cartão da pergunta. O lugar fica; o bloco dentro dele é trocado sem regravar a fala (`criarProgressoNaTela`, QA do PR
  // 398), então a medida lê o bloco de agora pelo lugar (o filho, sem procurar), nunca um nó guardado que já saiu.
  let lugaresDoProgresso: HTMLElement[] = [];
  let chaveProgresso = chaveDoProgresso(SEM_PROGRESSO);

  const medida = (): Medida => ({ topo: caixa.scrollTop, altura: caixa.scrollHeight, janela: caixa.clientHeight });

  function irAoFim(): void {
    caixa.scrollTop = caixa.scrollHeight;
    estado = { colada: true, topoAntes: caixa.scrollTop };
  }

  function linhaNaJanela(): LinhaNaJanela | null {
    if (!linha?.isConnected) return null;
    const r = linha.getBoundingClientRect();
    const c = caixa.getBoundingClientRect();
    const chave = linha.dataset.novas ?? "";
    const p = permanenciaDaLinha(permanencia, chave, r.bottom > c.top && r.top < c.bottom, performance.now());
    permanencia = p.permanencia;
    if (p.vista) linhaVista = chave;
    return { acima: r.bottom <= c.top, vista: linhaVista === chave, total: Number(linha.dataset.total) || 0, desde: Number(linha.dataset.desde) || 0 };
  }

  /** O cartão aberto mais recente (plano "pergunta com botões", 2026-10-18), procurado como a linha "Novas". */
  function perguntaNaJanela(): PerguntaNaJanela | null {
    if (!cartao?.isConnected || !cartao.classList.contains("aberta")) return null;
    const r = cartao.getBoundingClientRect();
    const c = caixa.getBoundingClientRect();
    const posicao = r.top >= c.bottom ? "abaixo" : r.bottom <= c.top ? "acima" : "visivel";
    return { decisaoId: cartao.dataset.cartaoPergunta ?? "", nome: cartao.dataset.nome ?? "O bot", posicao };
  }

  /** O bloco que o lugar mostra agora (`.progresso[data-frentes]`, o filho dele); null com o lugar vazio. */
  function blocoNoLugar(lugar: HTMLElement): HTMLElement | null {
    const el = lugar.isConnected ? lugar.firstElementChild : null;
    return el instanceof HTMLElement && el.matches(".progresso[data-frentes]") ? el : null;
  }

  /** Mede os blocos de progresso (poucos, nos lugares achados antes) e avisa só quando o que está à vista mudou. */
  function medirProgresso(): void {
    const c = caixa.getBoundingClientRect();
    const medidas = conversa ? lugaresDoProgresso.flatMap((lugar) => {
      const el = blocoNoLugar(lugar);
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ ids: (el.dataset.frentes ?? "").split(" ").filter(Boolean), topo: r.top, base: r.bottom }];
    }) : [];
    const p = progressoNaTela(medidas, { topo: c.top, base: c.bottom });
    const chave = chaveDoProgresso(p);
    if (chave === chaveProgresso) return;
    chaveProgresso = chave;
    aoMudarProgresso(p);
  }

  function atualizarPilula(): void {
    medirProgresso();
    // A linha "Novas" é medida sempre (é a medida que a dá por vista); a pílula da pergunta ganha da das novas.
    const novas = conversa ? pilulaDasNovas(linhaNaJanela()) : "";
    const html = conversa ? pilulaDaPergunta(perguntaNaJanela()) || novas : "";
    if (html === pilulaHtml) return;
    pilulaHtml = html;
    lugarDaPilula.innerHTML = html;
  }

  // Colada, qualquer mudança de tamanho desce: o conteúdo crescendo (imagem, artefato, <details>) ou a caixa
  // encolhendo (o campo ganhando linhas, a faixa da pergunta). O callback roda depois do layout e antes da pintura.
  const observador = new ResizeObserver(() => {
    if (!conversa) return;
    if (estado.colada) irAoFim();
    atualizarPilula();
  });
  observador.observe(caixa);

  caixa.addEventListener("scroll", () => {
    if (!conversa) return;
    estado = depoisDeRolar(estado, medida());
    atualizarPilula();
  }, { passive: true });

  return {
    depoisDeDesenhar(conversaId, historicoMudou) {
      const outra = conversaId !== conversa;
      if (outra) {
        conversa = conversaId;
        estado = { colada: true, topoAntes: 0 };
        linhaVista = null;
        permanencia = null;
      }
      if (outra || historicoMudou) {
        linha = caixa.querySelector<HTMLElement>(".linha-novas");
        cartao = [...caixa.querySelectorAll<HTMLElement>(".cartao-pergunta.aberta")].at(-1) ?? null;
        lugaresDoProgresso = [...caixa.querySelectorAll<HTMLElement>("[data-progresso]")];
        const eraVazia = !outra && vazia;
        vazia = caixa.querySelector(".welcome-options") !== null;
        // A conversa vazia abre nas sugestões, no alto, e não acompanha o fim: quem rola até a opção D e começa a
        // digitar não volta ao topo quando o campo cresce. A primeira mensagem volta a acompanhar.
        if (vazia && !eraVazia) {
          caixa.scrollTop = 0;
          estado = { colada: false, topoAntes: 0 };
        } else if (!vazia && eraVazia) estado = { ...estado, colada: true };
      }
      // A casca da timeline é trocada quando a tela muda: o observador segue o conteúdo da vez.
      const conteudo = caixa.firstElementChild;
      if (conteudo !== observado) {
        if (observado) observador.unobserve(observado);
        if (conteudo) observador.observe(conteudo);
        observado = conteudo;
      }
      if (conversa && estado.colada) irAoFim();
      atualizarPilula();
    },
    colar() {
      irAoFim();
      atualizarPilula();
    },
    soltar() {
      estado = { ...estado, colada: false };
      // Com o card já no fim e a caixa no fim, não há para onde rolar e nenhum evento chega para colar de novo: a
      // conversa ficaria solta no fim, sem acompanhar a resposta. Confere depois que a rolagem suave teria começado.
      window.setTimeout(() => {
        if (conversa && !estado.colada && distanciaDoFim(medida()) <= 2) estado = { colada: true, topoAntes: caixa.scrollTop };
      }, 300);
    },
    irParaNovas() {
      if (!linha?.isConnected) return;
      // A primeira nova pode estar num fio de pergunta já resolvido, que fica recolhido: abre antes de medir.
      for (let d = linha.closest<HTMLDetailsElement>("details:not([open])"); d; d = linha.closest<HTMLDetailsElement>("details:not([open])")) d.open = true;
      estado = { ...estado, colada: false };
      linhaVista = linha.dataset.novas ?? "";
      // NOD-381: no celular o topo flutua sobre o chat e a caixa diz quanto ele cobre (scroll-padding-top); a nova
      // nunca para embaixo dele. Sem a medida (computador), a folga de sempre.
      const alvo = caixa.scrollTop + linha.getBoundingClientRect().top - caixa.getBoundingClientRect().top - folgaDoTopo(caixa);
      caixa.scrollTo({ top: Math.max(0, alvo), behavior: suave() ? "smooth" : "auto" });
      atualizarPilula();
    },
    jaViu(mensagemId) {
      return linhaVista === mensagemId;
    },
    progressoTrocado() {
      medirProgresso();
    },
  };
}

/** A folga acima da linha de novas: o scroll-padding-top da caixa (o topo flutuante do celular, NOD-381) ou 12 px. */
export function folgaDoTopo(caixa: Element): number {
  const lido = typeof getComputedStyle === "function" ? Number.parseFloat(getComputedStyle(caixa).scrollPaddingTop) : Number.NaN;
  return Number.isFinite(lido) && lido > 12 ? lido : 12;
}
