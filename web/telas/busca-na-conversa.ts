import { termoValido, type Ocorrencia } from "../lib/buscar-na-conversa.ts";
import { criarMaquinaDaBusca } from "../lib/maquina-da-busca.ts";
import { comportamentoDaRolagem } from "../lib/movimento.ts";

/**
 * definido em 2026-10-28 (NOD-42, protótipo v3 aprovado): a busca na conversa (⌘F). A pílula do bot no topo estica e vira
 * o campo; nada novo fixo na tela (ADR-114). O miolo (campo, contagem, ˄ ˅ ×) nasce UMA vez e é religado no cabeçalho a
 * cada render: o `regiao("cabecalho")` troca o innerHTML quando a presença do bot muda, e o nó do campo (com texto, foco e
 * cursor) tem de sobreviver. O realce é a CSS Custom Highlight API: não mexe no DOM da timeline, então convive com o morph
 * e com a regravação por blocos. Sem a API, só rola e marca o balão da atual.
 *
 * Fora de escopo (issue): pensamento recolhido não conta (o `<details>` fechado só entra pelo `<summary>`), nem a gaveta,
 * nem a Atividade; a raiz é só a timeline.
 */

import { coletarSegmentos, encaixarNoCabecalho, HTML_DO_MIOLO, soltarDoCabecalho } from "../lib/varredura-da-busca.ts";

export const TETO_DE_REALCES = 1000;

type HighlightCtor = new (...r: Range[]) => unknown;
type Registro = { set(nome: string, h: unknown): void; delete(nome: string): void };

function apiDeRealce(): { Highlight: HighlightCtor; registro: Registro } | null {
  const g = globalThis as { Highlight?: HighlightCtor; CSS?: { highlights?: Registro } };
  return g.Highlight && g.CSS?.highlights ? { Highlight: g.Highlight, registro: g.CSS.highlights } : null;
}

export type DepsDaBusca = {
  /** A área que rola com a timeline (`#timeline`). */
  raiz: () => HTMLElement | null;
  /** O começo do que está carregado, para o "desde". */
  desde: () => Date | null;
  reduzido: () => boolean;
  /** Esc / ×: devolve o foco ao campo de mensagem. */
  aoFechar: () => void;
  /** O cabeçalho mudou de forma (abriu/fechou): quem desenha o resto ajusta. */
  aoMudar?: () => void;
};

export type BuscaNaConversa = ReturnType<typeof criarBuscaNaConversa>;

export function criarBuscaNaConversa(deps: DepsDaBusca) {
  let miolo: HTMLElement | null = null;
  let aberta = false;
  let nos: (Text | null)[] = [];
  let observador: MutationObserver | null = null;
  let cabecalhoAtual: HTMLElement | null = null;
  let marcado: Element | null = null;

  const campo = (): HTMLInputElement | null => miolo?.querySelector<HTMLInputElement>(".bnc-termo") ?? null;
  const maquina = criarMaquinaDaBusca({
    termo: () => (aberta ? (campo()?.value ?? "") : ""),
    varrer: () => {
      const raiz = deps.raiz();
      if (!raiz) return null;
      const v = coletarSegmentos(raiz);
      nos = v.nos.map((n) => (n instanceof Text ? n : null));
      return v.segmentos;
    },
    desde: deps.desde,
    pintar,
    contagem: escreverContagem,
    relogio: { agendar: (fn, ms) => setTimeout(fn, ms), cancelar: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  });

  function montar(): HTMLElement {
    if (miolo) return miolo;
    const el = document.createElement("div");
    el.className = "bnc";
    el.innerHTML = HTML_DO_MIOLO;
    // A animação de esticar roda uma vez por abertura (o re-render do cabeçalho não a recomeça).
    el.addEventListener("animationend", (e) => (e.target as Element | null)?.classList.remove("bnc-abre"));
    el.addEventListener("click", (e) => {
      const alvo = (e.target as Element | null)?.closest<HTMLElement>("[data-bnc]");
      if (!alvo) return;
      e.preventDefault();
      const acao = alvo.dataset.bnc;
      if (acao === "fechar") fechar(true);
      else if (acao === "proxima") navegar(1);
      else if (acao === "anterior") navegar(-1);
    });
    const input = el.querySelector<HTMLInputElement>(".bnc-termo");
    input?.addEventListener("input", () => maquina.digitou());
    input?.addEventListener("keydown", (e) => {
      if (e.isComposing || e.key !== "Enter") return;
      e.preventDefault();
      maquina.enter(e.shiftKey);
    });
    // Esc em qualquer parte do miolo (campo ou ˄ ˅ ×) fecha e devolve o foco ao campo de mensagem.
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      fechar(true);
    });
    miolo = el;
    return el;
  }

  /**
   * Põe o miolo no cabeçalho recém-desenhado (ver `encaixarNoCabecalho`). Não mexe no foco: com a busca aberta, o
   * cabeçalho é regravado em volta do miolo (`regiaoEmVoltaDe` no main.ts), então o campo nunca o perde para o render.
   */
  function encaixar(cabecalho: HTMLElement | null): void {
    if (!aberta || !cabecalho) return;
    const el = montar();
    const lugar = el.querySelector<HTMLElement>(".bnc-lugar-pb");
    if (!lugar) return;
    cabecalhoAtual = cabecalho;
    encaixarNoCabecalho<ChildNode>(cabecalho, el, lugar);
  }

  function abrir(cabecalho: HTMLElement | null): void {
    const el = montar();
    if (!aberta) {
      aberta = true;
      el.querySelector(".bnc-pilula")?.classList.add("bnc-abre");
      ligarObservador();
    }
    encaixar(cabecalho);
    const input = campo();
    input?.focus({ preventScroll: true });
    input?.select();
    if (input && termoValido(input.value)) maquina.refazer();
    deps.aoMudar?.();
  }

  function fechar(devolverFoco: boolean): void {
    if (!aberta) return;
    aberta = false;
    maquina.limpar();
    observador?.disconnect();
    observador = null;
    limparRealce();
    nos = [];
    const el = miolo;
    if (el) {
      const lugar = el.querySelector<HTMLElement>(".bnc-lugar-pb");
      // O cabeçalho guardado no encaixe: se o render já tirou o miolo, o "buscando" sai assim mesmo (revisão do #560).
      if (lugar) soltarDoCabecalho<ChildNode>(cabecalhoAtual ?? (el.parentElement as HTMLElement | null), el, lugar);
      else el.remove();
      document.getElementById("cabecalho")?.classList.remove("buscando");
      cabecalhoAtual = null;
      el.querySelector(".bnc-pilula")?.classList.remove("bnc-abre");
      const input = campo();
      if (input) input.value = "";
      escreverContagem("", "", 0);
    }
    if (devolverFoco) deps.aoFechar();
    deps.aoMudar?.();
  }

  function ligarObservador(): void {
    const raiz = deps.raiz();
    if (!raiz || typeof MutationObserver === "undefined") return;
    // O relógio da fala viva (`[data-desde]`, `escreverTempos`) muda a cada segundo e não entra na busca: não refaz por ele (4ª revisão do PR 560).
    observador = new MutationObserver((registros) => {
      if (registros.some((r) => !(r.target instanceof Node && (r.target.nodeType === 3 ? r.target.parentElement : r.target as Element)?.closest?.("time, [data-desde]")))) maquina.timelineMudou();
    });
    observador.observe(raiz, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["open", "hidden"] });
  }

  function limparRealce(): void {
    const api = apiDeRealce();
    api?.registro.delete("nod-busca");
    api?.registro.delete("nod-busca-atual");
    marcado?.classList.remove("bnc-atual-sem-api");
    marcado = null;
  }

  function faixa(o: Ocorrencia): Range | null {
    const a = nos[o.inicio.segmento];
    const b = nos[o.fim.segmento];
    if (!a || !b || !a.isConnected || !b.isConnected) return null;
    const r = document.createRange();
    try {
      r.setStart(a, Math.min(o.inicio.offset, a.length));
      r.setEnd(b, Math.min(o.fim.offset, b.length));
    } catch { return null; }
    return r;
  }

  function navegar(passo: 1 | -1): void {
    if (aberta) maquina.navegar(passo);
  }

  function pintar(ocorrencias: readonly Ocorrencia[], atual: number, rolar: boolean): void {
    if (!ocorrencias.length) { limparRealce(); return; }
    const api = apiDeRealce();
    const o = ocorrencias[atual];
    const r = o ? faixa(o) : null;
    if (api) {
      // A atual sempre entra; as outras até o teto (a contagem segue certa).
      const todas: Range[] = [];
      for (let i = 0; i < ocorrencias.length && todas.length < TETO_DE_REALCES; i++) {
        if (i === atual) continue;
        const x = faixa(ocorrencias[i] as Ocorrencia);
        if (x) todas.push(x);
      }
      api.registro.set("nod-busca", new api.Highlight(...todas));
      if (r) api.registro.set("nod-busca-atual", new api.Highlight(r)); else api.registro.delete("nod-busca-atual");
    }
    const el = r ? (r.startContainer.parentElement?.closest<HTMLElement>("[data-mensagem]") ?? r.startContainer.parentElement) : null;
    if (!api) {
      marcado?.classList.remove("bnc-atual-sem-api");
      marcado = el;
      el?.classList.add("bnc-atual-sem-api");
    }
    if (rolar && r) rolarAte(r);
  }

  /** Centra a ocorrência na área que rola (a pílula e o campo cobrem as pontas). */
  function rolarAte(r: Range): void {
    const raiz = deps.raiz();
    if (!raiz) return;
    const caixa = r.getBoundingClientRect();
    const area = raiz.getBoundingClientRect();
    if (caixa.height === 0 && caixa.width === 0) {
      r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: comportamentoDaRolagem(deps.reduzido()) });
      return;
    }
    const meio = area.top + area.height / 2;
    const delta = caixa.top + caixa.height / 2 - meio;
    // Já à vista com folga: não mexe (Enter numa ocorrência vizinha não dá tranco).
    if (caixa.top > area.top + 110 && caixa.bottom < area.bottom - 110 && Math.abs(delta) < area.height / 3) return;
    raiz.scrollBy({ top: delta, behavior: comportamentoDaRolagem(deps.reduzido()) });
  }

  function escreverContagem(texto: string, anuncio: string | null, total: number): void {
    const el = miolo?.querySelector<HTMLElement>(".bnc-contagem");
    if (el) {
      el.classList.toggle("bnc-nada", texto.startsWith("Nada"));
      // "desde" vai num span próprio: no celular ele sai (o leitor continua ouvindo pelo anúncio). Só textContent.
      // "3/6 · desde 24/10" e "Nada desde 24/10": o "desde" sai no celular nos dois (5ª revisão do PR 560).
      const corte = texto.search(/ · desde | desde /);
      if (corte > 0) {
        const desde = document.createElement("span");
        desde.className = "bnc-desde";
        desde.textContent = texto.slice(corte);
        el.replaceChildren(texto.slice(0, corte), desde);
      } else el.textContent = texto;
    }
    const setas = miolo?.querySelectorAll<HTMLElement>(".bnc-sobe, .bnc-desce") ?? [];
    for (const s of setas) s.setAttribute("aria-disabled", String(total === 0));
    if (anuncio === null) return;
    const viva = miolo?.querySelector<HTMLElement>(".bnc-anuncio");
    if (viva) viva.textContent = anuncio;
  }

  return {
    aberta: () => aberta,
    /** O nó do miolo enquanto aberta: o cabeçalho é regravado em volta dele. */
    no: (): HTMLElement | null => (aberta ? miolo : null),
    abrir,
    fechar,
    encaixar,
    navegar,
    /** Para os testes e o QA: quantas ocorrências e qual a atual. */
    estado: maquina.estado,
  };
}
