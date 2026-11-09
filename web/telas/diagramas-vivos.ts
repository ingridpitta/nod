import { cabeNoLimite, chaveDoDiagrama, documentoDoRenderizador, iframeDoRenderizador, lerMensagemDoDiagrama, limparDiretivas, PRAZO_MS, rotuloDoDiagrama, svgSeguro, type TemaDoDiagrama, VezDoRenderizador } from "../lib/diagrama.ts";

/**
 * O lado VIVO do diagrama no balão do bot (NOD-328), só no navegador (main.ts), no molde de artefatos-vivos.ts: o
 * `figure.md-diagrama` vem na timeline como string (texto-formatado.ts) com o card de código dentro; aqui, depois de
 * cada render, o código vai ao renderizador sandbox (um iframe oculto por página) e o SVG que volta, conferido, entra
 * como `<img src="blob:">` na figure. Qualquer falha deixa o card.
 */

export type DepsDiagramas = {
  /** O módulo do renderizador e as pastas que a CSP do iframe libera (o build e o dev servem em lugares diferentes). */
  urlModulo: string;
  fontes: readonly string[];
};

type Desenho = { url: string; largura: number; altura: number };
type Pedido = { id: string; chave: string; codigo: string; tema: TemaDoDiagrama };

/** definido em 2026-10-22 (plano da NOD-328): 64 desenhos guardados; o que sai do cache libera o blob. */
const CACHE_MAX = 64;
/** definido em 2026-10-22: o renderizador que não carregou (offline) só é tentado de novo depois de 30 s. */
const ESPERA_APOS_FALHA_MS = 30_000;

function aleatorio(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A cor de um token já resolvida pelo navegador (rgb()), que o mermaid entende; color-mix e var() não. */
function corDoToken(sonda: HTMLElement, token: string): string {
  sonda.style.color = `var(${token})`;
  return getComputedStyle(sonda).color;
}

function lerTema(): TemaDoDiagrama {
  const sonda = document.createElement("span");
  sonda.hidden = true;
  document.body.append(sonda);
  const tema: TemaDoDiagrama = {
    escuro: matchMedia("(prefers-color-scheme: dark)").matches ? document.documentElement.dataset.theme !== "light" : document.documentElement.dataset.theme === "dark",
    fundo: corDoToken(sonda, "--surface"),
    superficie: corDoToken(sonda, "--surface-raised"),
    tinta: corDoToken(sonda, "--ink"),
    tinta2: corDoToken(sonda, "--ink-3"),
    linha: corDoToken(sonda, "--line"),
    linhaForte: corDoToken(sonda, "--line-strong"),
    // A fonte do sistema: a Geist é web font e não carrega dentro de um SVG em <img> (aceito no plano).
    fonte: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif",
  };
  sonda.remove();
  return tema;
}

export function criarDiagramasVivos(deps: DepsDiagramas) {
  const desenhos = new Map<string, Desenho>();
  const negativos = new Set<string>();
  const pendentes = new Map<string, Pedido>();
  const pedidosPorChave = new Map<string, string>();
  const codigos = new WeakMap<HTMLElement, string>();
  let quadro: HTMLIFrameElement | null = null;
  let canal = "";
  let pronto = false;
  let cargas = 0;
  let falhouEm = -Infinity;
  let prazoDaCarga = 0;
  const vez = new VezDoRenderizador();
  let prazoDaVez = 0;
  let tema: TemaDoDiagrama | null = null;
  let raizAtual: ParentNode = document;

  const ids = { has: (id: string) => pendentes.has(id) };

  function guardar(chave: string, d: Desenho): void {
    desenhos.delete(chave);
    desenhos.set(chave, d);
    while (desenhos.size > CACHE_MAX) {
      const [velha, saindo] = desenhos.entries().next().value ?? [];
      if (velha === undefined || !saindo) break;
      desenhos.delete(velha);
      URL.revokeObjectURL(saindo.url);
    }
  }

  function largar(): void {
    window.clearTimeout(prazoDaCarga);
    window.clearTimeout(prazoDaVez);
    vez.limpar();
    pendentes.clear();
    pedidosPorChave.clear();
    quadro?.remove();
    quadro = null;
    pronto = false;
  }

  function falhouACarga(): void {
    falhouEm = Date.now();
    largar();
  }

  function criarQuadro(): void {
    canal = aleatorio();
    const nonce = aleatorio();
    const caixa = document.createElement("div");
    caixa.innerHTML = iframeDoRenderizador(documentoDoRenderizador({ nonce, canal, urlModulo: deps.urlModulo, fontes: deps.fontes }));
    const novo = caixa.querySelector("iframe");
    if (!novo) return;
    quadro = novo;
    pronto = false;
    cargas = 0;
    // O srcdoc carrega UMA vez. Um segundo `load` é o renderizador indo para outro endereço: fora, e um novo no lugar.
    novo.addEventListener("load", () => {
      cargas += 1;
      if (cargas > 1 && quadro === novo) {
        largar();
        hidratar(raizAtual);
      }
    });
    // Sem o "pronto" no prazo (módulo que não baixa, CSP), o card fica e o renderizador espera 30 s.
    prazoDaCarga = window.setTimeout(() => {
      if (quadro === novo && !pronto) falhouACarga();
    }, PRAZO_MS);
    document.body.append(novo);
  }

  /** O relógio só corre para o diagrama da vez (VezDoRenderizador): os de trás na fila não gastam o prazo esperando. */
  function armarPrazo(): void {
    window.clearTimeout(prazoDaVez);
    const restante = vez.restante(Date.now());
    if (restante === null) return;
    prazoDaVez = window.setTimeout(() => {
      // Sem resposta no prazo: o da vez fica no card, e o renderizador (talvez preso nele) é trocado; os outros voltam a pedir.
      const p = pendentes.get(vez.daVez() ?? "");
      if (p) negativos.add(p.chave);
      largar();
      hidratar(raizAtual);
    }, restante);
  }

  function enviar(p: Pedido): void {
    quadro?.contentWindow?.postMessage({ nod: "diagrama", canal, id: p.id, codigo: p.codigo, tema: p.tema }, "*");
    vez.enviou(p.id, Date.now());
    armarPrazo();
  }

  function pedir(chave: string, codigo: string, t: TemaDoDiagrama): void {
    if (pedidosPorChave.has(chave)) return;
    if (!quadro) {
      if (Date.now() - falhouEm < ESPERA_APOS_FALHA_MS) return;
      criarQuadro();
    }
    const id = aleatorio();
    const p: Pedido = { id, chave, codigo, tema: t };
    pendentes.set(id, p);
    pedidosPorChave.set(chave, id);
    if (pronto) enviar(p);
  }

  function aplicar(figura: HTMLElement, d: Desenho, codigo: string): void {
    const img = figura.querySelector<HTMLImageElement>(":scope > img.md-diagrama-img");
    if (img?.getAttribute("src") === d.url) return;
    const nova = img ?? document.createElement("img");
    nova.className = "md-diagrama-img";
    nova.alt = "";
    nova.decoding = "async";
    nova.width = d.largura;
    nova.height = d.altura;
    nova.style.setProperty("--dg-largura", `${d.largura}px`); // piso de encolhimento (interface.css)
    nova.src = d.url;
    if (!img) figura.prepend(nova);
    figura.classList.add("pronto");
    figura.setAttribute("role", "img");
    figura.setAttribute("aria-label", rotuloDoDiagrama(codigo));
  }

  /** Depois de cada render da timeline: o desenho do cache entra na hora; o que falta vai ao renderizador. */
  function hidratar(raiz: ParentNode): void {
    raizAtual = raiz;
    const figuras = raiz.querySelectorAll<HTMLElement>("figure.md-diagrama");
    if (figuras.length === 0) return;
    tema ??= lerTema();
    for (const figura of figuras) {
      let codigo = codigos.get(figura);
      if (codigo === undefined) {
        codigo = limparDiretivas(figura.querySelector("code")?.textContent ?? "");
        codigos.set(figura, codigo);
      }
      if (!codigo.trim() || !cabeNoLimite(codigo)) continue;
      const chave = chaveDoDiagrama(tema, codigo);
      const d = desenhos.get(chave);
      if (d) {
        guardar(chave, d);
        aplicar(figura, d, codigo);
        continue;
      }
      if (negativos.has(chave)) continue;
      pedir(chave, codigo, tema);
    }
  }

  function aoReceber(ev: MessageEvent): void {
    if (!quadro) return;
    const m = lerMensagemDoDiagrama(ev, quadro.contentWindow, canal, ids);
    if (!m) return;
    if (m.tipo === "pronto") {
      pronto = true;
      window.clearTimeout(prazoDaCarga);
      for (const p of pendentes.values()) enviar(p);
      return;
    }
    if (m.tipo === "indisponivel") {
      falhouACarga();
      return;
    }
    const p = pendentes.get(m.id);
    if (!p) return;
    vez.respondeu(m.id, Date.now());
    armarPrazo();
    pendentes.delete(m.id);
    pedidosPorChave.delete(p.chave);
    if (m.tipo === "falhou" || !svgSeguro(m.svg)) {
      negativos.add(p.chave);
      return;
    }
    guardar(p.chave, { url: URL.createObjectURL(new Blob([m.svg], { type: "image/svg+xml" })), largura: m.largura, altura: m.altura });
    // Só a figura ainda na tela recebe; a do tema antigo continua com o desenho velho até o novo ficar pronto.
    hidratar(document);
  }
  window.addEventListener("message", aoReceber);

  // Trocar claro/escuro desenha de novo; o desenho antigo fica até o novo chegar (sem piscar).
  function temaMudou(): void {
    tema = null;
    hidratar(document);
  }
  new MutationObserver(temaMudou).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", temaMudou);

  return { hidratar };
}
