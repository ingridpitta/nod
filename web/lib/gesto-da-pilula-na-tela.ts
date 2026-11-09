/**
 * ADA-8 (definido em 2026-11-04, docs/plano-gestos-da-pilula.md; emenda ADA-8 da ADR-146): o único dono do dedo na pílula do
 * topo. Antes eram dois reconhecedores no mesmo toque (a busca no main.ts e as páginas no paginas-na-tela.ts): segurar
 * abria a doca aos 380 ms e o menu aos 500 ms, a diagonal trocava a página e abria a busca, e os dois escreviam o
 * `transform` da cápsula. Agora: o eixo trava a 10 px (1,5× de dominância; a diagonal não faz nada), ↓ é só a busca,
 * ↔ é só a página, e segurar 450 ms é um menu só (a busca e as páginas). As regras puras moram em gesto-da-pilula.ts.
 *
 * O cabeçalho é regravado a toda hora: tudo é delegado no documento e o `transform` vai no nó vivo.
 */
import { cliqueDepoisDoGesto, deslocamentoDoPuxar, type GestoAnterior } from "./descoberta-da-busca.ts";
import { acompanhar, eixoDoGesto, fimDoGestoDaPilula, itensDoMenuDaPilula, SEGURAR_MS, type Eixo, type ItemDoMenuDaPilula } from "./gesto-da-pilula.ts";
import { passoDaMola } from "./paginas.ts";

/** A busca na conversa, vista pela pílula (o main liga; sem ela, a pílula só troca de página). */
export interface BuscaDaPilula {
  /** O gesto da busca vale aqui (no celular, numa tela que tem busca). */
  ativa(): boolean;
  aberta(): boolean;
  /** Dá para abrir agora (nenhuma camada por cima). */
  pode(): boolean;
  abrir(): void;
  fechar(): void;
}

export interface DonoDoToque {
  busca?: BuscaDaPilula;
  /** Posições da pílula (a ordem de exibição). Menos de 2 páginas = nenhuma troca. */
  total(): number;
  atual(): number;
  irPara(posicao: number): void;
  /** Os nomes das páginas, na ordem da pílula (o menu do segurar). */
  nomes(): string[];
  reduzido(): boolean;
  /** O menu do segurar (o main desenha); sem ele, segurar não faz nada. */
  menu?(ancora: HTMLElement, itens: ItemDoMenuDaPilula[]): void;
  /** O toque é de outro (o ícone da doca aberta: segurar = menu do ícone, arrastar = ordem). */
  deOutro(alvo: Element): boolean;
}

export interface ToqueNaPilula {
  /** O tranco da ponta (a roda pede quando não há página para aquele lado). */
  tranco(lado: -1 | 1): void;
}

type Gesto = {
  id: number;
  x: number;
  y: number;
  buscaAberta: boolean;
  podeBuscar: boolean;
  paginas: boolean;
  /** Como achar o nó vivo depois de uma regravação do cabeçalho. */
  seletor: string;
  el: HTMLElement;
  eixo: Eixo | null;
  segurar: ReturnType<typeof setTimeout> | null;
  /** Desliga os ouvintes postos no nó do começo (o fim e o move que o WebKit entrega ao nó solto). */
  ouvintes: AbortController;
};

const TRANCO_PX = 14;
/** Depois de um arrasto o navegador ou não gera clique ou o gera logo: a marca do "arrastar" morre depois disto. */
const ENGOLIR_ARRASTO_MS = 350;

export function ligarToqueDaPilula(doc: Document, d: DonoDoToque): ToqueNaPilula {
  const janela = doc.defaultView;
  let gesto: Gesto | null = null;
  let engolir: GestoAnterior = null;
  /** Até quando a marca vale (o "segurar" vale até o próximo toque: o dedo sai do menu quando quiser). */
  let engolirAte = 0;
  let mola = { x: 0, v: 0 };
  let quadroMola = 0;
  let eixoDaMola: "x" | "y" = "x";
  /** Quando foi o último toque (não mouse): o contextmenu só é barrado logo depois de um. */
  let ultimoToque = -Infinity;

  const vivo = (g: Gesto): HTMLElement | null => (g.el.isConnected ? g.el : doc.querySelector<HTMLElement>(g.seletor));
  const cap = (): HTMLElement | null => doc.querySelector<HTMLElement>("#cabecalho .qd-pil") ?? doc.querySelector<HTMLElement>("#cabecalho .pilula-bot:not(.bnc-pb)");

  function pintar(el: HTMLElement | null, eixo: "x" | "y", v: number): void {
    if (!el) return;
    el.style.transform = v ? (eixo === "x" ? `translateX(${v}px)` : `translateY(${v}px)`) : "";
  }
  function pararMola(): void {
    if (quadroMola) janela?.cancelAnimationFrame(quadroMola);
    quadroMola = 0;
    // Revisão 2 do #651: a mola cortada por um toque deixava a classe (transition: none) presa até o próximo gesto.
    cap()?.classList.remove("bnc-puxando");
  }
  /** Volta ao lugar numa mola curta (k 300, c 22), do ponto em que o dedo soltou. Reduzido: no lugar, sem mola. */
  function soltar(eixo: "x" | "y", de: number): void {
    pararMola();
    const el = cap();
    el?.classList.remove("bnc-puxando");
    if (!de || d.reduzido() || !janela?.requestAnimationFrame) { pintar(el, eixo, 0); return; }
    el?.classList.add("bnc-puxando");
    eixoDaMola = eixo;
    mola = { x: de, v: 0 };
    let antes = 0;
    const passo = (t: number): void => {
      const dt = antes ? Math.min(0.05, (t - antes) / 1000) : 1 / 60;
      antes = t;
      const r = passoDaMola(mola, 0, 300, 22, dt);
      mola = { x: r.x, v: r.v };
      const alvo = cap();
      pintar(alvo, eixoDaMola, r.parou ? 0 : r.x);
      if (r.parou) alvo?.classList.remove("bnc-puxando");
      quadroMola = r.parou ? 0 : janela.requestAnimationFrame(passo);
    };
    quadroMola = janela.requestAnimationFrame(passo);
  }
  const tranco = (lado: -1 | 1): void => soltar("x", -lado * TRANCO_PX);

  function alca(alvo: Element, buscaAberta: boolean): { el: HTMLElement; seletor: string } | null {
    if (buscaAberta) {
      // Aberta: empurrar vale de qualquer ponto do miolo, menos o campo e os botões da busca.
      if (alvo.closest("input, .bnc-bt")) return null;
      const el = alvo.closest<HTMLElement>("#cabecalho .bnc-pilula");
      return el ? { el, seletor: "#cabecalho .bnc-pilula" } : null;
    }
    const pil = alvo.closest<HTMLElement>("#cabecalho .qd-pil");
    if (pil) return { el: pil, seletor: "#cabecalho .qd-pil" };
    const bot = alvo.closest<HTMLElement>("#cabecalho .pilula-bot:not(.bnc-pb)");
    return bot ? { el: bot, seletor: "#cabecalho .pilula-bot:not(.bnc-pb)" } : null;
  }

  /** Larga o gesto sem efeito (a pílula volta ao lugar): dois dedos, ou um gesto antigo que não recebeu o fim. */
  function largar(g: Gesto): void {
    if (gesto === g) gesto = null;
    if (g.segurar) { clearTimeout(g.segurar); g.segurar = null; }
    g.ouvintes.abort();
    soltar(g.eixo === "y" ? "y" : "x", 0);
  }

  doc.addEventListener("pointerdown", (ev) => {
    // Depois de um arrasto o navegador não gera clique: o flag do gesto anterior morre no toque seguinte, qualquer que
    // seja o alvo (3ª revisão do PR 560: o primeiro toque no ✕ depois de puxar era engolido).
    engolir = null;
    if (ev.pointerType === "mouse") return;
    if (gesto) {
      // Revisão do #651: um segundo dedo larga o gesto (a pinça não troca a página nem abre a busca). Um toque primário
      // com um gesto ainda aberto é o fim que se perdeu (o WebKit entrega o pointerup ao nó que a regravação tirou do
      // DOM): o antigo morre e este começa, em vez de o antigo travar a pílula e abrir o menu sozinho.
      const velho = gesto;
      largar(velho);
      if (!ev.isPrimary) return;
    }
    // Um dedo secundário (o primeiro rolando a conversa) não começa gesto na pílula.
    if (!ev.isPrimary) return;
    ultimoToque = Date.now();
    const alvo = ev.target as Element | null;
    if (!alvo?.closest || d.deOutro(alvo)) return;
    const buscaAtiva = !!d.busca?.ativa();
    const buscaAberta = buscaAtiva && !!d.busca?.aberta();
    const a = alca(alvo, buscaAberta);
    if (!a) return;
    const podeBuscar = buscaAtiva && !buscaAberta && !!d.busca?.pode();
    const paginas = !buscaAberta && d.total() > 1 && !!doc.querySelector("#cabecalho .qd-pil .pg-doca");
    if (!buscaAberta && !podeBuscar && !paginas) return;
    pararMola();
    pintar(a.el, "x", 0);
    const g: Gesto = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, buscaAberta, podeBuscar, paginas, seletor: a.seletor, el: a.el, eixo: null, segurar: null, ouvintes: new AbortController() };
    gesto = g;
    // O nó solto do DOM ainda recebe o gesto (o documento não): ouvir nele também. O `fim` ignora o segundo aviso.
    // Revisão 3 do #651: o WebKit entrega ao nó solto o move também, não só o fim; sem ele o eixo nunca travava (o ↔
    // depois de uma regravação com o dedo parado não trocava, e o segurar abria o menu no meio do arrasto). Os ouvintes
    // morrem com o gesto (antes, o que não disparava ficava preso no nó a cada toque).
    const sinal = { signal: g.ouvintes.signal };
    a.el.addEventListener("pointermove", (e) => { if (!a.el.isConnected) mover(e); }, sinal);
    a.el.addEventListener("pointerup", (e) => fim(e, false), sinal);
    a.el.addEventListener("pointercancel", (e) => fim(e, true), sinal);
    const itens = (): ItemDoMenuDaPilula[] => itensDoMenuDaPilula({ podeBuscar: !!d.busca?.ativa() && !!d.busca?.pode(), paginas: paginas ? d.nomes() : [], atual: d.atual() });
    if (!buscaAberta && d.menu) g.segurar = setTimeout(() => {
      if (gesto !== g || g.eixo !== null) return;
      gesto = null;
      const lista = itens();
      // Segurou: o clique do fim não abre o painel do bot, nem com o menu vazio (uma página e sem busca).
      engolir = "segurar";
      engolirAte = Infinity;
      if (!lista.length) return;
      janela?.navigator?.vibrate?.(8);
      const el = vivo(g);
      if (el) d.menu?.(el, lista);
    }, SEGURAR_MS);
  }, true);

  function mover(ev: PointerEvent): void {
    const g = gesto;
    if (!g || ev.pointerId !== g.id) return;
    const dx = ev.clientX - g.x;
    const dy = ev.clientY - g.y;
    if (g.eixo === null) {
      const e = eixoDoGesto(dx, dy);
      if (e === null) return;
      g.eixo = e;
      if (g.segurar) { clearTimeout(g.segurar); g.segurar = null; }
    }
    const el = vivo(g);
    if (!el || d.reduzido()) return;
    // Entortou (o deslocamento inteiro já não domina no eixo travado): a pílula volta ao lugar, que é o que soltar fará.
    const reto = eixoDoGesto(dx, dy) === g.eixo;
    if (g.eixo === "y" && g.podeBuscar) { el.classList.add("bnc-puxando"); pintar(el, "y", reto ? deslocamentoDoPuxar(dy) : 0); }
    else if (g.eixo === "x" && g.paginas) { el.classList.add("bnc-puxando"); pintar(el, "x", reto ? acompanhar(dx) : 0); }
  }
  doc.addEventListener("pointermove", mover, true);

  function fim(ev: PointerEvent, cancelado: boolean): void {
    const g = gesto;
    if (!g || ev.pointerId !== g.id) return;
    gesto = null;
    if (g.segurar) clearTimeout(g.segurar);
    g.ouvintes.abort();
    const dx = ev.clientX - g.x;
    const dy = ev.clientY - g.y;
    const reto = eixoDoGesto(dx, dy) === g.eixo;
    const de = !reto ? 0 : g.eixo === "y" && g.podeBuscar ? deslocamentoDoPuxar(dy) : g.eixo === "x" && g.paginas ? acompanhar(dx) : 0;
    if (g.eixo === null) return;
    engolir = "arrastar";
    engolirAte = Date.now() + ENGOLIR_ARRASTO_MS;
    if (cancelado) { soltar(g.eixo === "y" ? "y" : "x", de); return; }
    const r = fimDoGestoDaPilula({ eixo: g.eixo, dx, dy, buscaAberta: g.buscaAberta, podeBuscar: g.podeBuscar, total: g.paginas ? d.total() : 0, atual: d.atual() });
    // A busca abre e a cápsula vai para o miolo dela: volta ao lugar sem mola.
    if (r.tipo === "buscar" || r.tipo === "fechar-busca") soltar("y", 0);
    else soltar(g.eixo === "y" ? "y" : "x", de);
    if (r.tipo === "buscar" && d.busca?.pode()) d.busca.abrir();
    else if (r.tipo === "fechar-busca") d.busca?.fechar();
    else if (r.tipo === "pagina") d.irPara(d.atual() + r.passo);
  }
  doc.addEventListener("pointerup", (ev) => fim(ev, false), true);
  doc.addEventListener("pointercancel", (ev) => fim(ev, true), true);

  // O clique do fim do gesto não abre o painel do bot (nem fica no item do menu que acabou de abrir).
  doc.addEventListener("click", (ev) => {
    const g = engolir;
    if (!g) return;
    engolir = null;
    // Revisão 3 do #651: a marca não espera o próximo toque. O clique sem toque (Enter, Espaço, o toque duplo do leitor
    // de tela) não tem pointerdown que a zere, e era engolido muito depois do arrasto.
    if (Date.now() > engolirAte) return;
    const alvo = ev.target as Element | null;
    if (!cliqueDepoisDoGesto(g, { noCabecalho: !!alvo?.closest?.("#cabecalho"), noMenu: !!alvo?.closest?.("[data-pilula]") })) return;
    ev.preventDefault();
    ev.stopPropagation();
  }, true);
  // O teclado também é um gesto novo: a ativação por tecla depois do segurar (o menu fechado no Esc) não é engolida.
  doc.addEventListener("keydown", () => { engolir = null; }, true);
  // Segurar não abre o menu do navegador (nem a lupa do iOS) por cima do nosso.
  doc.addEventListener("contextmenu", (ev) => {
    const alvo = ev.target as Element | null;
    if (Date.now() - ultimoToque > 1500) return;
    if (alvo?.closest?.("#cabecalho .qd-pil, #cabecalho .pilula-bot:not(.bnc-pb)") && !d.deOutro(alvo)) ev.preventDefault();
  }, true);

  return { tranco };
}
