import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-429: os dois comentários finais do Marlon provados no Chrome de verdade, com o CSS e o JS do app (sem servidor):
 *  - j4-5: a recusa da trava ("Feito só aceita vindo de Em revisão · Mandar para Em revisão") cabe no card, na coluna
 *    mais estreita (192 px) e na lista do celular (390);
 *  - j7-1: a troca Conversa ↔ Quadro desliza nos dois sentidos (conteúdo, 220 ms) e, com Reduzir movimento, vira um
 *    fade sem deslocamento.
 * NOD-445: o par Conversa | Quadro virou a pílula de páginas (Conversa, Tarefas e os apps do bot), com a
 * doca na mola, os pontinhos, a roda, o arrasto no toque e o anúncio para o leitor de tela.
 * Sem Chrome na máquina, o teste é pulado (o CI instala o do playwright).
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { estadoInicial, reduzir } from "./web/estado/reducer.ts";
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { atalhoDoTeclado, SELETOR_CAMPO } from "./web/lib/atalhos.ts";
import { contextoDaPilula, executarNaPilula } from "./web/lib/setas-da-pilula.ts";
import { renderCabecalhoConversa } from "./web/telas/conversa.ts";
import { aoGuardarOrdem, definirPaginas, esquecerPaginas, ordemDoAgente, paginasDoAgente } from "./web/lib/ordem-das-paginas.ts";
import { cenario } from "./tests/helpers/paginas-do-bot.ts";
// As páginas como o servidor as daria (Conversa, Tarefas, Painel, Doc). O "servidor" é o sessionStorage: o PUT da ordem
// grava lá (e em __salvos), e a página recarregada lê de volta, como o GET das páginas faria em outro aparelho.
const SERVIDOR = "teste.servidor.ordem";
const guardada = JSON.parse(sessionStorage.getItem(SERVIDOR) ?? "null");
definirPaginas(guardada ? { ...cenario(3), ordem: guardada } : cenario(3));
const PAGINAS = paginasDoAgente("a");
window.__salvos = [];
aoGuardarOrdem((ag, ids) => { window.__salvos.push(ag + ":" + JSON.stringify(ids)); sessionStorage.setItem(SERVIDOR, JSON.stringify(ids)); });
window.__zerarOrdem = () => { sessionStorage.removeItem(SERVIDOR); definirPaginas(cenario(3)); window.__salvos = []; };
import { card, linha } from "./web/telas/quadro.ts";
const C = "c1";
const conversa = { conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
  mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [] };
const e = { ...reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 }), sessao: { pessoaId: "p", tenantId: "t" },
  tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
  frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square", ownerId: "p" }] } };
const recusa = { texto: "Feito só aceita vindo de Em revisão", acao: "Mandar para Em revisão", recusa: true };
const tarefa = { id: "NOD-512", titulo: "Ligar o quadro ao turno do agente", aviso: recusa, tags: ["web"], quando: "agora" };
window.__card = card(tarefa);
window.__linha = linha(tarefa);
/** Monta o palco como o main.ts: o cabeçalho real da conversa (com ou sem o quadro) e a troca nos nós vivos. */
window.__montar = (comQuadro) => {
  const cab = document.getElementById("cabecalho");
  cab.classList.add("cabecalho-pilula");
  cab.innerHTML = renderCabecalhoConversa(e, "a", { comQuadro, paginas: PAGINAS });
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  window.__trocas = [];
  // ADA-8: a busca e o menu do segurar, como o main liga (aqui contados).
  window.__busca = { abriu: 0, fechou: 0 };
  window.__menus = [];
  window.__buscaAberta = false;
  const busca = { ativa: () => true, aberta: () => window.__buscaAberta, pode: () => true, abrir: () => { window.__busca.abriu++; }, fechar: () => { window.__busca.fechou++; } };
  const menuDaPilula = (_el, itens, ir) => { window.__menus.push(itens.map((i) => i.tipo === "buscar" ? "buscar" : i.nome + (i.atual ? "*" : ""))); window.__irPara = ir; };
  // Quem ouve a troca (o main lê a conversa na volta) precisa ver o modo novo no momento da chamada.
  const q = criarQuadroNaTela(document, { busca, menuDaPilula, aoTrocar: (m) => window.__trocas.push(m + ":" + q.modo()) });
  q.sincronizar(comQuadro ? { chave: C, nome: "Ada", paginas: PAGINAS } : { chave: null, nome: "" });
  window.__quadro = q;
};
/** Com o agente e a ordem guardada (arrastar um ícone muda a casa): monta como o main, que redesenha ao mudar a ordem. */
window.__montarComOrdem = () => {
  const cab = document.getElementById("cabecalho");
  cab.classList.add("cabecalho-pilula");
  const desenhar = () => { cab.innerHTML = renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: PAGINAS, ordem: ordemDoAgente("a", PAGINAS) }); };
  desenhar();
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const q = criarQuadroNaTela(document, { aoMudarOrdem: () => { desenhar(); q.sincronizar({ chave: C, nome: "Ada", agenteId: "a", paginas: PAGINAS }); } });
  q.sincronizar({ chave: C, nome: "Ada", agenteId: "a", paginas: PAGINAS });
  window.__quadro = q;
  // NOD-461: o despachante como o do main (registrado depois do quadro, como lá), com o mesmo contexto e a mesma execução.
  window.__acoes = [];
  document.addEventListener("keydown", (ev) => {
    const alvo = ev.target;
    const t = { code: ev.code, key: ev.key, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey, shiftKey: ev.shiftKey, isComposing: ev.isComposing, keyCode: ev.keyCode };
    const a = atalhoDoTeclado(t, { lugar: window.__lugar ?? "outro", emCampo: !!alvo.closest?.(SELETOR_CAMPO), dialogo: false, celular: false, paginas: q.totalDePaginas(), ...contextoDaPilula(document, alvo, ev) });
    if (a) { ev.preventDefault(); window.__acoes.push(a.tipo); executarNaPilula(document, a, q); }
  });
};
/**
 * NOD-445 (revisão 2, achado 1): a primeira visita ao bot na sessão, como o main: a conversa abre ANTES de o GET das
 * páginas voltar (só a Conversa na pílula) e cada render chama \`sincronizar\` de novo. \`__chegaramPaginas(ordem)\` é a
 * resposta do servidor chegando (o \`aoLer\` do main, que redesenha).
 */
window.__montarSemPaginas = () => {
  esquecerPaginas();
  const cab = document.getElementById("cabecalho");
  cab.classList.add("cabecalho-pilula");
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  window.__trocas = [];
  const q = criarQuadroNaTela(document, { aoTrocar: (m) => window.__trocas.push(m + ":" + q.modo()) });
  const desenhar = () => {
    const ps = paginasDoAgente("a");
    cab.innerHTML = renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: ps, ordem: ordemDoAgente("a", ps) });
    q.sincronizar({ chave: C, nome: "Ada", agenteId: "a", paginas: ps });
  };
  desenhar();
  window.__desenhar = desenhar;
  window.__chegaramPaginas = (ordem) => { definirPaginas({ ...cenario(3), ordem }); desenhar(); };
  window.__quadro = q;
};
/** O app à vista some do servidor (removido em outro aparelho): a próxima leitura das páginas já não o traz. */
window.__removerNoOutro = (id) => {
  const d = cenario(3);
  definirPaginas({ ...d, apps: d.apps.filter((a) => a.id !== id), ordem: d.ordem.filter((o) => o !== "app:" + id) });
  const ps = paginasDoAgente("a");
  document.getElementById("cabecalho").innerHTML = renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: ps });
  window.__quadro.sincronizar({ chave: C, nome: "Ada", paginas: ps });
};
/** O render regrava o cabeçalho (mascote, presença): a doca é outro nó. */
window.__regravar = () => {
  document.getElementById("cabecalho").innerHTML = renderCabecalhoConversa(e, "a", { comQuadro: true, paginas: PAGINAS });
  window.__quadro.sincronizar({ chave: C, nome: "Ada", paginas: PAGINAS });
};
`;

/** O index.html de verdade, com todos os CSS do app embutidos na ordem dele e o JS do teste no lugar do main.ts. */
async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "quadro.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-429 no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod429-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000); // o abrirChrome espera a porta até 80 s (a 1ª abertura no runner é lenta): o erro dele aparece antes do prazo do hook
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  /** 1440 é o computador; 390 é o celular de verdade (toque, sem hover: a CONSULTA_CELULAR do mobile.css casa). */
  async function abrir(largura: number, reduzido: boolean, comQuadro = true, deitado = false, montagem = `window.__montar(${comQuadro})`): Promise<void> {
    const celular = largura < 700 || deitado;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: deitado ? 390 : celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: reduzido ? "reduce" : "no-preference" },
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
      { name: "any-hover", value: celular ? "none" : "hover" }, { name: "any-pointer", value: celular ? "coarse" : "fine" },
    ] });
    await cdp.enviar("Page.navigate", { url });
    for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montar")); i++) await esperar(50);
    await avaliar(cdp, montagem);
    await pintado();
  }

  /**
   * NOD-465: espera a tela montada ser calculada e pintada, como a pessoa a vê antes de clicar. Sem isso, na máquina
   * carregada o clique pode chegar antes de qualquer frame: os pontinhos (nós novos) nunca tiveram estilo calculado, o
   * Chrome não tem de onde partir e não cria a transição de largura (getAnimations() vazio, "expected 0 to be greater than 0").
   * A leitura do layout força o estilo de todo o cabeçalho; os dois rAF garantem um frame pintado depois dela.
   */
  const pintado = () => avaliar(cdp, `(document.body.getBoundingClientRect(), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))))`);

  /**
   * Clica numa aba e devolve os quadros-chave das animações de quem entra e de quem sai. Com `pausarEm`, para tudo (o
   * deslize e a transição do indicador) nesse ponto, no mesmo passo do clique: a máquina carregada não chega ao fim antes.
   */
  const PAGINA: Record<string, number> = { conversa: 0, quadro: 1 };
  const aba = (modo: string) => `#cabecalho .pg-ic[data-pagina="${PAGINA[modo] ?? modo}"]`;
  const trocar = (modo: string, pausarEm?: number) => avaliar<{ quadro: string[]; timeline: string[]; ms: number; easing: string; ponto: number }>(cdp, `(() => {
    document.querySelector('${aba(modo)}').click();
    // Lido no mesmo tique do clique: na máquina carregada a mola do pontinho (350 ms) acaba antes da próxima ida ao CDP.
    const ponto = document.querySelector("#cabecalho .pg-pt.pg-pt-atual")?.getAnimations().length ?? 0;
    ${pausarEm === undefined ? "" : `for (const a of document.getAnimations()) { a.pause(); a.currentTime = ${pausarEm}; }`}
    const kf = (id) => (document.getElementById(id).getAnimations()[0]?.effect.getKeyframes() ?? []).map((k) => (k.transform ?? "-").replace("(0px)", "(0)"));
    const t = document.getElementById("quadro").getAnimations()[0]?.effect.getTiming();
    return { quadro: kf("quadro"), timeline: kf("timeline"), ms: t?.duration ?? 0, easing: t?.easing ?? "", ponto };
  })()`);
  /** Espera as animações e transições em curso acabarem de fato (prazo fixo estoura na máquina carregada) e mais um respiro. */
  const acabar = () => avaliar(cdp, `Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))).then(() => new Promise((r) => setTimeout(r, 50)))`);
  const xDaVista = () => avaliar<number>(cdp, `new DOMMatrix(getComputedStyle(document.getElementById("quadro")).transform).m41`);
  const NOME = ["conversa", "quadro", "painel", "doc"];
  const estadoFinal = () => avaliar<{ atual: string; quadroOculto: boolean; timelineVis: string; timelineInert: boolean; selecionada: string | null }>(cdp, `(() => {
    const n = ${JSON.stringify(NOME)};
    return { atual: n[Number(document.querySelector("#cabecalho .qd-pil").dataset.pagina)], quadroOculto: document.getElementById("quadro").hidden,
      timelineVis: getComputedStyle(document.getElementById("timeline")).visibility, timelineInert: document.getElementById("timeline").inert,
      selecionada: n[Number(document.querySelector('#cabecalho .pg-ic[aria-selected="true"]')?.dataset.pagina)] ?? null };
  })()`);
  const pontoAtual = () => avaliar<number>(cdp, `Number(document.querySelector("#cabecalho .pg-pt.pg-pt-atual")?.dataset.pagina ?? -1)`);

  /** Onde o aviso de recusa fica em relação ao seu card (ou linha), dentro da vista real do quadro. */
  const medirRecusa = (sel: string) => avaliar<{ dentro: boolean; transborda: boolean; linhas: number; title: string; largura: number }>(cdp, `(() => {
    const av = document.querySelector(${JSON.stringify(sel)} + " .qd-aviso-recusa");
    const box = av.closest(".qd-card, .qd-l");
    const a = av.getBoundingClientRect(), b = box.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(av).lineHeight);
    return { dentro: a.left >= b.left - 0.5 && a.right <= b.right + 0.5, transborda: box.scrollWidth > box.clientWidth + 1, linhas: Math.round(a.height / lh), title: av.title, largura: b.width };
  })()`);

  it("j4-5 · 1440px: na coluna real do quadro (a mais estreita), a recusa da trava fica dentro do card, quebrando linha, com o texto inteiro no title", async () => {
    await abrir(1440, true);
    await trocar("quadro");
    await acabar();
    // A coluna mais estreita da grade: o card entra nela, como a NOD-415 vai pôr.
    await avaliar(cdp, `(() => {
      const cols = [...document.querySelectorAll("#quadro .qd-so-largo .qd-col:not(.qd-col-recolhida)")];
      const alvo = cols.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)[0];
      alvo.querySelector(".qd-col-lista").innerHTML = window.__card;
    })()`);
    const r = await medirRecusa("#quadro .qd-so-largo");
    expect(r.largura).toBeLessThan(240);
    expect(r.dentro).toBe(true);
    expect(r.transborda).toBe(false);
    expect(r.linhas).toBeGreaterThanOrEqual(2);
    expect(r.title).toBe("Feito só aceita vindo de Em revisão · Mandar para Em revisão");
  }, 30_000);

  it("j4-5 · 390px (celular, toque): o quadro vira lista, e a recusa na linha fica dentro dela; a cápsula da pílula cabe na tela", async () => {
    await abrir(390, true);
    await trocar("quadro");
    await acabar();
    expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector("#quadro .qd-so-largo")).display`)).toBe("none");
    await avaliar(cdp, `document.querySelector("#quadro .qd-so-estreito .qd-lg-lista").innerHTML = window.__linha`);
    const l = await medirRecusa("#quadro .qd-so-estreito");
    expect(l.dentro).toBe(true);
    expect(l.transborda).toBe(false);
    expect(l.title).toBe("Feito só aceita vindo de Em revisão · Mandar para Em revisão");
    const pil = await avaliar<{ esq: number; dir: number; abas: number[]; nomes: string[] }>(cdp, `(() => {
      const r = document.querySelector("#cabecalho .qd-pil").getBoundingClientRect();
      const abas = [...document.querySelectorAll("#cabecalho .pg-ic")];
      return { esq: r.left, dir: r.right, abas: abas.map((a) => a.getBoundingClientRect().width), nomes: abas.map((a) => a.getAttribute("aria-label")) };
    })()`);
    expect(pil.esq).toBeGreaterThanOrEqual(0);
    expect(pil.dir).toBeLessThanOrEqual(390);
    // Só ícones no celular (a CONSULTA_CELULAR casou), e o nome segue para o leitor de tela.
    expect(pil.abas).toEqual([44, 44, 44, 44]);
    expect(pil.nomes).toEqual(["Conversa", "Tarefas", "Painel", "Doc"]);
  }, 30_000);

  for (const [largura, deitado] of [[390, false], [844, true]] as const) {
    it(`revisão 4 do PR 606: celular ${deitado ? "deitado (844×390, a grade)" : "em pé (390, a lista)"}: todo alvo do quadro e da cápsula tem 44 px e nada rola de lado`, async () => {
      await abrir(largura, false, true, deitado);
      await trocar("quadro");
      await acabar();
      const r = await avaliar<{ pequenos: string[]; rolagem: number; botoes: number }>(cdp, `(() => {
        // Os ícones da doca fechada estão recolhidos (largura 0): só contam com a doca aberta, onde têm 44 px.
        const bts = [...document.querySelectorAll("#quadro button, #cabecalho .qd-pil button")].filter((b) => b.getClientRects().length && !(b.closest(".pg-doca") && !b.closest(".pg-aberta")));
        const pequenos = bts.filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.className + ":" + Math.round(b.getBoundingClientRect().height));
        return { pequenos, rolagem: document.documentElement.scrollWidth, botoes: bts.length };
      })()`);
      expect(r.botoes).toBeGreaterThan(5);
      expect(r.pequenos).toEqual([]);
      expect(r.rolagem).toBeLessThanOrEqual(largura);
    }, 30_000);
  }

  it("j7-1 · 1440px: ida e volta deslizam de lado (220 ms) e o pontinho da página anda", async () => {
    await abrir(1440, false);
    expect(await pontoAtual()).toBe(0);
    const ida = await trocar("quadro", 110);
    expect(ida.ms).toBe(220);
    expect(ida.easing).toMatch(/cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/);
    expect(ida.quadro).toEqual(["translateX(48px)", "translateX(0)"]);
    expect(ida.timeline).toEqual(["translateX(-48px)", "translateX(0)"].reverse());
    // O pontinho da página nova alonga já no clique (transição de largura, com mola no CSS).
    expect(await pontoAtual()).toBe(1);
    expect(ida.ponto).toBeGreaterThan(0);
    await avaliar(cdp, `for (const a of document.getAnimations()) a.play()`);
    await acabar();
    expect(await avaliar<number>(cdp, `document.querySelector("#cabecalho .pg-pt.pg-pt-atual").getBoundingClientRect().width`)).toBeCloseTo(14, 0);
    expect(await estadoFinal()).toEqual({ atual: "quadro", quadroOculto: false, timelineVis: "hidden", timelineInert: true, selecionada: "quadro" });
    // ADR-162 (PR #723): "Precisa de você" deixou de ser coluna (virou a marca `voce`); o quadro padrão tem 7 colunas.
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#quadro .qd-so-largo .qd-col").length`)).toBe(7);
    expect(await avaliar<string>(cdp, `document.getElementById("pg-anuncio").textContent`)).toBe("página 2 de 4, Tarefas");

    const volta = await trocar("conversa");
    expect(volta.quadro).toEqual(["translateX(0)", "translateX(48px)"]);
    expect(volta.timeline).toEqual(["translateX(-48px)", "translateX(0)"]);
    await acabar();
    expect(await pontoAtual()).toBe(0);
    expect(await estadoFinal()).toEqual({ atual: "conversa", quadroOculto: true, timelineVis: "visible", timelineInert: false, selecionada: "conversa" });
  }, 30_000);

  it("NOD-445 · de Tarefas a um app, só o conteúdo da vista desliza; a conversa fica por baixo e volta direto do app", async () => {
    await abrir(1440, false);
    await trocar("quadro");
    await acabar();
    const r = await avaliar<{ kf: string[]; titulo: string }>(cdp, `(() => {
      document.querySelector('${aba("2")}').click();
      const c = document.querySelector("#quadro > *");
      for (const a of document.getAnimations()) a.pause();
      return { kf: (c.getAnimations()[0]?.effect.getKeyframes() ?? []).map((k) => (k.transform ?? "-").replace("(0px)", "(0)")), titulo: document.querySelector("#quadro .pg-app h2")?.textContent ?? "" };
    })()`);
    expect(r.kf).toEqual(["translateX(48px)", "translateX(0)"]);
    expect(r.titulo).toBe("Painel");
    await avaliar(cdp, `for (const a of document.getAnimations()) a.play()`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "painel", quadroOculto: false, timelineInert: true, selecionada: "painel" });
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["quadro:quadro"]);
    await trocar("conversa");
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa", quadroOculto: true, timelineInert: false });
    // Voltar à vista pelo trocar("quadro") de fora (o main) volta à última página dela.
    await avaliar(cdp, `window.__quadro.trocar("quadro")`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "painel" });
  }, 30_000);

  it("NOD-445 · hover abre a doca na mola macia (no máximo um fio além do alvo) e sair fecha sem rebote; a roda troca uma página por gesto", async () => {
    await abrir(1440, false);
    const nome = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .pilula-bot").getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    expect(await avaliar<number>(cdp, `document.querySelector("#cabecalho .pg-doca").getBoundingClientRect().width`)).toBe(0);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: nome.x, y: nome.y });
    // Amostra a largura a cada quadro até assentar: a mola passa do alvo antes de parar.
    const m = await avaliar<{ max: number; fim: number; alvo: number; aberta: boolean }>(cdp, `new Promise((ok) => {
      const d = document.querySelector("#cabecalho .pg-doca");
      let max = 0, n = 0, parada = 0, antes = -1;
      const passo = () => {
        const w = d.getBoundingClientRect().width;
        max = Math.max(max, w);
        parada = w > 0 && Math.abs(w - antes) < 0.01 ? parada + 1 : 0;
        antes = w;
        if (parada > 10 || ++n > 300) ok({ max, fim: w, alvo: d.firstElementChild.scrollWidth, aberta: d.parentElement.classList.contains("pg-aberta") });
        else requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    })`);
    expect(m.aberta).toBe(true);
    expect(m.fim).toBeCloseTo(m.alvo, 0);
    // Pedido do Marlon (2026-11-02): abrir mais suave, sem balançar.
    expect(m.max).toBeLessThan(m.alvo + 2);
    // A roda: um gesto de trackpad (vários eventos) anda uma página só. O gesto é disparado na página com o relógio
    // dela controlado (8 eventos a cada 100 ms, 700 ms ao todo, mais que a trava de 380 ms) e, entre um evento e outro,
    // espera a troca assentar: é o pior caso, o do CI carregado (os 6 eventos do CDP levaram mais que a trava e a troca
    // já tinha acabado, então o meio do gesto andou outra página). Não depende de quanto o CDP demora entre eventos.
    // O relógio do gesto termina 2 s atrás do real, então a roda de verdade logo depois já é outro gesto.
    expect(await avaliar<number>(cdp, `(async () => {
      const real = Date.now;
      let t = real() - 2000;
      Date.now = () => t;
      try {
        const alvo = document.querySelector("#cabecalho .pilula-bot");
        let canceladas = 0;
        for (let i = 0; i < 8; i++, t += 100) {
          if (!alvo.dispatchEvent(new WheelEvent("wheel", { deltaX: 30, bubbles: true, cancelable: true }))) canceladas++;
          await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null)));
        }
        return canceladas;
      } finally { Date.now = real; }
    })()`)).toBe(8);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    // ADA-8: a roda vertical do mouse sobre a pílula não troca (passar rolando pelo topo trocava sem querer).
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 500))`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseWheel", x: nome.x, y: nome.y, deltaX: 0, deltaY: 30 });
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    // Um gesto novo de lado, pela roda de verdade (CDP), anda mais uma.
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 500))`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseWheel", x: nome.x, y: nome.y, deltaX: 30, deltaY: 0 });
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "painel" });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 600 });
    // Fechar só encolhe: nenhum quadro cresce de novo (o rebote abaixo de zero tremia a pílula).
    const f = await avaliar<{ cresceu: number; fim: number }>(cdp, `new Promise((ok) => {
      const d = document.querySelector("#cabecalho .pg-doca");
      let antes = d.getBoundingClientRect().width, cresceu = 0, n = 0;
      const passo = () => {
        const w = d.getBoundingClientRect().width;
        cresceu = Math.max(cresceu, w - antes);
        antes = w;
        if (++n > 90) ok({ cresceu, fim: w }); else requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    })`);
    expect(f.cresceu).toBeLessThan(0.5);
    expect(f.fim).toBeLessThan(1);
  }, 30_000);

  /** ADA-8: o centro do nome do bot (a alça da pílula) e um dedo por CDP nele. */
  async function dedo(): Promise<{ c: { x: number; y: number }; toque: (type: string, x: number, y: number) => Promise<unknown> }> {
    const c = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .pilula-bot").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await avaliar(cdp, `window.__painel = 0; document.addEventListener("click", (e) => { if (e.target.closest('[data-act="alternar-detalhes"]')) window.__painel++; })`);
    const toque = (type: string, x: number, y: number) => cdp.enviar("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    return { c, toque };
  }
  const transformDaPilula = () => avaliar<string>(cdp, `document.querySelector("#cabecalho .qd-pil").style.transform`);
  /** Espera a condição na página (o evento do CDP chega à página depois de o comando voltar; prazo fixo falha no CI). */
  async function ate(expr: string, ms = 4000): Promise<void> {
    for (let t = 0; t < ms && !(await avaliar<boolean>(cdp, `!!(${expr})`)); t += 50) await esperar(50);
  }

  it("ADA-8 · 390px (toque): deslizar ↔ segue o dedo (só translateX, até 30 px, sem esticar) e vai à próxima página; não abre a busca nem o painel", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dx of [-12, -25, -45, -60, -90]) await toque("touchMove", c.x + dx, c.y + 3);
    await ate(`document.querySelector("#cabecalho .qd-pil").style.transform === "translateX(-30px)"`);
    const t = await transformDaPilula();
    expect(t).toMatch(/^translateX\(-30px\)$/);
    await toque("touchEnd", c.x - 90, c.y + 3);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
    expect(await avaliar<{ abriu: number }>(cdp, `window.__busca`)).toMatchObject({ abriu: 0 });
    // A mola devolve a pílula ao lugar.
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 1200))`);
    expect(await transformDaPilula()).toBe("");
  }, 30_000);

  it("ADA-8 · 390px (toque): ↔ abaixo de 36 px volta sem trocar", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dx of [-12, -24, -34]) await toque("touchMove", c.x + dx, c.y);
    await toque("touchEnd", c.x - 34, c.y);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
  }, 30_000);

  it("ADA-8 · 390px (toque): a diagonal (40 → e 40 ↓) não troca de página nem abre a busca", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const d of [8, 16, 28, 40]) await toque("touchMove", c.x - d, c.y + d);
    expect(await transformDaPilula()).toBe("");
    await toque("touchEnd", c.x - 40, c.y + 40);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<{ abriu: number }>(cdp, `window.__busca`)).toMatchObject({ abriu: 0 });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
  }, 30_000);

  it("ADA-8 · 390px (toque): puxar ↓ abre só a busca (a pílula desce, nunca troca a página)", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dy of [12, 25, 45, 60]) await toque("touchMove", c.x - dy / 5, c.y + dy);
    await ate(`document.querySelector("#cabecalho .qd-pil").style.transform === "translateY(30px)"`);
    expect(await transformDaPilula()).toBe("translateY(30px)");
    await toque("touchEnd", c.x - 12, c.y + 60);
    await ate(`window.__busca.abriu > 0`);
    await acabar();
    expect(await avaliar<{ abriu: number }>(cdp, `window.__busca`)).toMatchObject({ abriu: 1 });
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
  }, 30_000);

  it("ADA-8 · 390px (toque): segurar abre só o menu (busca + páginas, a atual marcada), a doca não abre; escolher uma página vai a ela", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    await ate(`window.__menus.length > 0`);
    expect(await avaliar<string[][]>(cdp, `window.__menus`)).toEqual([["buscar", "Conversa*", "Tarefas", "Painel", "Doc"]]);
    expect(await avaliar<boolean>(cdp, `document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`)).toBe(false);
    await toque("touchEnd", c.x, c.y);
    await acabar();
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
    await avaliar(cdp, `window.__irPara(2)`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "painel" });
  }, 30_000);

  // QA do #651 (2026-11-04): os mutantes do tempo do segurar (150 e 1500 ms no lugar de SEGURAR_MS) passavam no teste
  // acima, que só espera o menu chegar. Aqui o relógio é o da página, do pointerdown ao menu.
  it("ADA-8 · 390px (toque): o menu do segurar abre aos 450 ms do toque, nem antes nem muito depois", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await avaliar(cdp, `(() => {
      document.addEventListener("pointerdown", () => { window.__t0 = performance.now(); }, true);
      const a = window.__menus, push = a.push.bind(a);
      a.push = (...x) => { window.__tMenu = performance.now() - window.__t0; return push(...x); };
    })()`);
    await toque("touchStart", c.x, c.y);
    await ate(`window.__menus.length > 0`);
    await toque("touchEnd", c.x, c.y);
    const t = await avaliar<number>(cdp, `window.__tMenu`);
    expect(t).toBeGreaterThanOrEqual(440);
    expect(t).toBeLessThan(1000);
  }, 30_000);

  it("ADA-8 · 390px (toque): o ↔ lento (o dedo trava o eixo e passa dos 450 ms no caminho) não abre o menu e troca a página", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    await toque("touchMove", c.x - 14, c.y);
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    for (const dx of [-30, -60]) await toque("touchMove", c.x + dx, c.y);
    await toque("touchEnd", c.x - 60, c.y);
    await acabar();
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
  }, 30_000);

  it("ADA-8 · 390px (toque): segurar no miolo da busca aberta não abre o menu da pílula", async () => {
    await abrir(390, false);
    await dedo();
    await avaliar(cdp, `(() => { window.__buscaAberta = true; const b = document.createElement("div"); b.className = "pilula-bot bnc-pb bnc-pilula"; b.style.cssText = "position:fixed;top:4px;left:60px;width:270px;height:44px;pointer-events:auto;touch-action:none"; b.innerHTML = "<span>miolo</span>"; document.getElementById("cabecalho").append(b); })()`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 26, id: 1 }] });
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 900))`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await acabar();
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    expect(await avaliar<{ abriu: number; fechou: number }>(cdp, `window.__busca`)).toEqual({ abriu: 0, fechou: 0 });
  }, 30_000);

  it("ADA-8 · 390px (toque): tocar nos pontinhos abre a doca; tocar num ícone vai à página e a doca fecha", async () => {
    await abrir(390, false);
    await dedo();
    const p = await avaliar<{ x: number; y: number; w: number; h: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .pg-pontos").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
    // O alvo é maior que o desenho (44×24) e sobe por dentro da cápsula: um toque 9 px acima do centro ainda acerta.
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y - 9, id: 1 }] });
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ate(`document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`);
    await acabar();
    expect(await avaliar<boolean>(cdp, `document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`)).toBe(true);
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 600))`);
    const ic = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('#cabecalho .pg-ic[data-pagina="1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ic.x, y: ic.y, id: 1 }] });
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ate(`document.querySelector("#cabecalho .qd-pil").dataset.pagina === "1"`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    await ate(`!document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`);
    expect(await avaliar<boolean>(cdp, `document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`)).toBe(false);
  }, 30_000);

  it("ADA-8 · 390px (toque): a diagonal de dedo de verdade (começa de lado, termina a 45°) não troca nem busca, e a pílula volta ao lugar", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    // Trava no x (−9, 4 → −14, 6) e entorta até (−40, 40).
    for (const [dx, dy] of [[-9, 4], [-14, 6], [-20, 15], [-30, 28], [-40, 40]] as const) await toque("touchMove", c.x + dx, c.y + dy);
    await ate(`document.querySelector("#cabecalho .qd-pil").style.transform === ""`);
    expect(await transformDaPilula()).toBe("");
    await toque("touchEnd", c.x - 40, c.y + 40);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<{ abriu: number }>(cdp, `window.__busca`)).toMatchObject({ abriu: 0 });
    // E o que começa para baixo e entorta para o lado também não abre a busca.
    await toque("touchStart", c.x, c.y);
    for (const [dx, dy] of [[4, 9], [6, 14], [20, 22], [40, 40]] as const) await toque("touchMove", c.x + dx, c.y + dy);
    await toque("touchEnd", c.x + 40, c.y + 40);
    await acabar();
    expect(await avaliar<{ abriu: number }>(cdp, `window.__busca`)).toMatchObject({ abriu: 0 });
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
  }, 30_000);

  it("ADA-8 · 390px (toque): o cabeçalho regravado no meio do gesto não trava a pílula nem abre o menu sozinho", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    await toque("touchMove", c.x - 14, c.y);
    await avaliar(cdp, `window.__regravar()`);
    for (const dx of [-30, -60]) await toque("touchMove", c.x + dx, c.y);
    await toque("touchEnd", c.x - 60, c.y);
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    // O toque seguinte é um gesto novo (nada ficou preso): deslizar de volta anda uma página.
    // Revisão 2 do #651: o primeiro gesto troca (o fim chega mesmo com o nó regravado) e o seguinte volta.
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    expect(await transformDaPilula()).not.toMatch(/translate/);
    await toque("touchStart", c.x, c.y);
    for (const dx of [14, 30, 60]) await toque("touchMove", c.x + dx, c.y);
    await toque("touchEnd", c.x + 60, c.y);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
  }, 30_000);

  it("ADA-8 · 390px (toque, WebKit): regravado com o dedo parado, o ↔ que o Safari entrega ao nó solto troca a página e não abre o menu", async () => {
    await abrir(390, false);
    await dedo();
    // O WebKit (iOS) entrega move e up ao nó em que o toque começou, mesmo fora do DOM; o Chrome do CDP redireciona ao nó
    // vivo, então os eventos vão à mão para o nó antigo (que não leva ao documento).
    await avaliar(cdp, `(() => {
      const el = document.querySelector("#cabecalho .pilula-bot");
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (tipo, dx) => new PointerEvent(tipo, { pointerId: 41, pointerType: "touch", isPrimary: true, clientX: x + dx, clientY: y, bubbles: true, cancelable: true });
      el.dispatchEvent(ev("pointerdown", 0));
      window.__regravar();
      for (const dx of [-14, -30, -60]) el.dispatchEvent(ev("pointermove", dx));
      el.dispatchEvent(ev("pointerup", -60));
    })()`);
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
  }, 30_000);

  it("ADA-8 · 390px (toque): depois do ↔, um clique sem toque no cabeçalho (teclado, leitor de tela) não é engolido", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dx of [-14, -30, -60]) await toque("touchMove", c.x + dx, c.y);
    await toque("touchEnd", c.x - 60, c.y);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 500))`);
    // O Enter do teclado (ou o toque duplo do TalkBack) gera o clique sem pointerdown.
    await avaliar(cdp, `document.querySelector('#cabecalho [data-act="alternar-detalhes"]').click()`);
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(1);
  }, 30_000);

  it("ADA-8 · 390px (toque): dois dedos (a pinça) não trocam a página nem abrem o menu", async () => {
    await abrir(390, false);
    const { c } = await dedo();
    const t = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.enviar("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await t("touchStart", [{ x: c.x, y: c.y, id: 1 }]);
    await t("touchMove", [{ x: c.x - 14, y: c.y, id: 1 }]);
    await t("touchStart", [{ x: c.x - 14, y: c.y, id: 1 }, { x: c.x + 40, y: c.y + 4, id: 2 }]);
    for (const dx of [-30, -60]) await t("touchMove", [{ x: c.x + dx, y: c.y, id: 1 }, { x: c.x + 40 - dx, y: c.y + 4, id: 2 }]);
    await t("touchEnd", []);
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    expect(await transformDaPilula()).toBe("");
  }, 30_000);

  it("ADA-8 · 390px (toque): com a doca aberta os pontinhos somem e deixam de ser alvo (nenhum alvo invisível); tocar fora fecha", async () => {
    await abrir(390, false);
    await dedo();
    const p = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .pg-pontos").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const tocar = async (): Promise<void> => {
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
      await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await tocar();
    await ate(`document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`);
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 600))`);
    expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector("#cabecalho .pg-pontos")).pointerEvents`)).toBe("none");
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y + 200, id: 1 }] });
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ate(`!document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`);
    expect(await avaliar<boolean>(cdp, `document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")`)).toBe(false);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<number>(cdp, `window.__painel`)).toBe(0);
  }, 30_000);

  it("ADA-8 · 390px (toque): um segundo dedo na pílula, com o primeiro na conversa, não começa gesto", async () => {
    await abrir(390, false);
    const { c } = await dedo();
    const t = (type: string, pts: { x: number; y: number; id: number }[]) => cdp.enviar("Input.dispatchTouchEvent", { type, touchPoints: pts });
    const longe = { x: c.x, y: c.y + 300, id: 1 };
    await t("touchStart", [longe]);
    await t("touchStart", [longe, { x: c.x, y: c.y, id: 2 }]);
    for (const dx of [-14, -30, -60]) await t("touchMove", [longe, { x: c.x + dx, y: c.y, id: 2 }]);
    await t("touchEnd", [longe]);
    await t("touchEnd", []);
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
    expect(await transformDaPilula()).toBe("");
  }, 30_000);

  it("ADA-8 · 390px (toque): o touchcancel no meio do ↔ solta sem trocar e a pílula volta ao lugar", async () => {
    await abrir(390, false);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dx of [-14, -30, -60]) await toque("touchMove", c.x + dx, c.y);
    await ate(`document.querySelector("#cabecalho .qd-pil").style.transform !== ""`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 1200))`);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await transformDaPilula()).toBe("");
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
  }, 30_000);

  it("ADA-8 · 390px (toque): na busca aberta, empurrar ↑ 36 px no miolo fecha; ↓ e ↔ não fazem nada", async () => {
    await abrir(390, false);
    await dedo();
    // A pílula da busca aberta, como o main a desenha no topo (o miolo é a alça; campo e botões não).
    await avaliar(cdp, `(() => { window.__buscaAberta = true; const b = document.createElement("div"); b.className = "pilula-bot bnc-pb bnc-pilula"; b.style.cssText = "position:fixed;top:4px;left:60px;width:270px;height:44px;pointer-events:auto;touch-action:none"; b.innerHTML = "<span>miolo</span>"; document.getElementById("cabecalho").append(b); })()`);
    const m = { x: 195, y: 26 };
    const t = (type: string, x: number, y: number) => cdp.enviar("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    // ↓ na busca aberta: nada.
    await t("touchStart", m.x, m.y);
    for (const dy of [12, 30, 60]) await t("touchMove", m.x, m.y + dy);
    await t("touchEnd", m.x, m.y + 60);
    await acabar();
    // ↔ na busca aberta: nada.
    await t("touchStart", m.x, m.y);
    for (const dx of [-12, -30, -60]) await t("touchMove", m.x + dx, m.y);
    await t("touchEnd", m.x - 60, m.y);
    await acabar();
    expect(await avaliar<{ abriu: number; fechou: number }>(cdp, `window.__busca`)).toEqual({ abriu: 0, fechou: 0 });
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    // ↑ 40: fecha.
    await t("touchStart", m.x, m.y + 10);
    for (const dy of [-12, -25, -40]) await t("touchMove", m.x, m.y + 10 + dy);
    await t("touchEnd", m.x, m.y - 30);
    await ate(`window.__busca.fechou > 0`);
    await acabar();
    expect(await avaliar<{ abriu: number; fechou: number }>(cdp, `window.__busca`)).toEqual({ abriu: 0, fechou: 1 });
    expect(await avaliar<unknown[]>(cdp, `window.__menus`)).toEqual([]);
  }, 30_000);

  it("ADA-8 · 390px (toque, movimento reduzido): ↔ troca a página sem a pílula seguir o dedo", async () => {
    await abrir(390, true);
    const { c, toque } = await dedo();
    await toque("touchStart", c.x, c.y);
    for (const dx of [-14, -30, -60]) { await toque("touchMove", c.x + dx, c.y); expect(await transformDaPilula()).toBe(""); }
    await toque("touchEnd", c.x - 60, c.y);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    expect(await transformDaPilula()).toBe("");
  }, 30_000);

  it("ADA-8 · 1440px (mouse): os pontinhos não recebem o ponteiro (o hover já abre a doca; nada pisca)", async () => {
    await abrir(1440, false);
    expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector("#cabecalho .pg-pontos")).pointerEvents`)).toBe("none");
  }, 30_000);

  it("Arrastar o ícone de Tarefas para a 1ª posição: ela vira a casa (guardada no servidor) e o agente passa a abrir nela", async () => {
    // Uma montagem só (o __montar do abrir() ligaria outra pílula, sem agente, no mesmo documento).
    const montar = async (): Promise<void> => {
      await cdp.enviar("Page.navigate", { url });
      for (let i = 0; i < 100 && !(await avaliar<boolean>(cdp, "!!window.__montarComOrdem")); i++) await esperar(50);
      await avaliar(cdp, `window.__montarComOrdem()`);
    };
    await abrir(1440, false);
    await avaliar(cdp, `window.__zerarOrdem()`);
    await montar();
    const nome = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .pilula-bot").getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: nome.x, y: nome.y });
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 900))`);
    const ic = (i: number) => avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('#cabecalho .pg-ic[data-pagina="${i}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const de = await ic(1);
    const para = await ic(0);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: de.x, y: de.y, button: "left", clickCount: 1 });
    for (const t of [0.2, 0.5, 0.8, 1.1]) await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: de.x + (para.x - de.x) * t - 4, y: de.y, button: "left", buttons: 1 });
    expect(await avaliar<boolean>(cdp, `document.querySelector("#cabecalho .pg-doca").classList.contains("pg-reordenando")`)).toBe(true);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: para.x - 4, y: de.y, button: "left", clickCount: 1 });
    await acabar();
    expect(await avaliar<string[]>(cdp, `window.__salvos`)).toEqual(['a:["tarefas","conversa","app:id-painel","app:id-doc"]']);
    expect(await avaliar<string[]>(cdp, `[...document.querySelectorAll("#cabecalho .pg-ic")].map((b) => b.dataset.pagina)`)).toEqual(["1", "0", "2", "3"]);
    expect(await avaliar<string>(cdp, `document.querySelector("#cabecalho .pg-ic.pg-casa").dataset.pagina`)).toBe("1");
    // O clique do fim do arrasto não trocou de página; o anúncio diz a posição nova.
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<string>(cdp, `document.getElementById("pg-anuncio").textContent`)).toBe("Tarefas, página 1 de 4");
    // Abrir o agente de novo (outra montagem, como ao clicar nele na lista) cai direto em Tarefas, sem animação.
    await montar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro", quadroOculto: false, timelineInert: true });
    // NOD-461: teclas de verdade (CDP), pelo despachante do palco (o mesmo caminho do main: atalhoDoTeclado e setas-da-pilula).
    const tecla = (key: "ArrowLeft" | "ArrowRight", shift = false) => cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: key, windowsVirtualKeyCode: key === "ArrowLeft" ? 37 : 39, modifiers: shift ? 9 : 1 });
    const aberta = () => avaliar<boolean>(cdp, `new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(document.querySelector("#cabecalho .qd-pil").classList.contains("pg-aberta")))))`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 700 });
    await avaliar(cdp, `document.activeElement?.blur?.()`);
    // Na ponta (Tarefas é a 1ª na ordem arrastada), ⌥← é engolida e nada muda.
    await tecla("ArrowLeft");
    expect(await avaliar<string[]>(cdp, `window.__acoes`)).toEqual(["pagina"]);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    // ⌥→ do body anda na ordem ARRASTADA (Tarefas, Conversa…): vai à Conversa, e a doca espia e fecha sozinha.
    await tecla("ArrowRight");
    expect(await aberta()).toBe(true);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    await esperar(1700);
    expect(await aberta()).toBe(false);
    await tecla("ArrowLeft");
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    // Campo com texto: no Mac a tecla é do campo (anda por palavra); fora dele é engolida sem trocar (nem voltar).
    // (Um campo fora do palco: com Tarefas à vista a conversa e o composer ficam inert.)
    await avaliar(cdp, `(() => { const t = document.createElement("textarea"); t.id = "campo-falso"; t.value = "oi"; document.body.append(t); t.focus(); window.__lugar = "app-mac"; })()`);
    await tecla("ArrowRight");
    await tecla("ArrowRight", true);
    expect(await avaliar<string[]>(cdp, `window.__acoes`)).toEqual(["pagina", "pagina", "pagina"]);
    await avaliar(cdp, `window.__lugar = "outro"`);
    await tecla("ArrowRight");
    expect(await avaliar<string>(cdp, `window.__acoes.at(-1)`)).toBe("engolir");
    await avaliar(cdp, `document.getElementById("campo-falso").remove()`);
    // Com um menu aberto, nada; quem já tratou a tecla (o cabeçalho de coluna dá preventDefault antes) também ganha.
    await avaliar(cdp, `(() => { const m = document.createElement("div"); m.id = "menu-falso"; m.setAttribute("role", "menu"); m.textContent = "x"; document.body.append(m); })()`);
    await tecla("ArrowRight");
    await avaliar(cdp, `document.getElementById("menu-falso").remove()`);
    await avaliar(cdp, `(() => { const b = document.createElement("button"); b.id = "col-falsa"; b.addEventListener("keydown", (e) => e.preventDefault()); document.body.append(b); b.focus(); })()`);
    await tecla("ArrowRight");
    await avaliar(cdp, `document.getElementById("col-falsa").remove()`);
    expect(await avaliar<number>(cdp, `window.__acoes.length`)).toBe(4);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    // ⌥⇧→ do body leva Tarefas à 2ª posição (grava a ordem, anuncia) e a doca espia.
    await tecla("ArrowRight", true);
    expect(await aberta()).toBe(true);
    expect(await avaliar<string[]>(cdp, `window.__salvos`)).toEqual(['a:["conversa","tarefas","app:id-painel","app:id-doc"]']);
    expect(await avaliar<string>(cdp, `document.getElementById("pg-anuncio").textContent`)).toBe("Tarefas, página 2 de 4");
    // No ícone focado, ⌥⇧← a traz de volta e o foco segue o ícone.
    await avaliar(cdp, `document.querySelector('#cabecalho .pg-ic[data-pagina="1"]').focus()`);
    await tecla("ArrowLeft", true);
    expect(await avaliar<string>(cdp, `document.activeElement?.dataset?.pagina ?? ""`)).toBe("1");
    expect(await avaliar<string[]>(cdp, `window.__salvos`)).toEqual(['a:["conversa","tarefas","app:id-painel","app:id-doc"]', 'a:["tarefas","conversa","app:id-painel","app:id-doc"]']);
    // QA: na ponta, ⌥⇧← não grava nem espia; ⌥→ no ícone focado troca e o foco vai junto (sem espiar).
    await tecla("ArrowLeft", true);
    expect(await avaliar<number>(cdp, `window.__salvos.length`)).toBe(2);
    await tecla("ArrowRight");
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    expect(await avaliar<string>(cdp, `document.activeElement?.dataset?.pagina ?? ""`)).toBe("0");
    // QA: um menu escondido no DOM não trava; com o mouse em cima, a espiada não fecha a doca.
    await avaliar(cdp, `(() => { document.activeElement?.blur?.(); const m = document.createElement("div"); m.id = "menu-oculto"; m.setAttribute("role", "menu"); m.hidden = true; document.body.append(m); })()`);
    const naPil = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector("#cabecalho .qd-pil").getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
    // O mouse já em cima (a doca aberta pelo hover) quando a tecla chega: a espiada não a fecha por baixo dele.
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: naPil.x, y: naPil.y });
    await esperar(600);
    await tecla("ArrowLeft");
    await avaliar(cdp, `document.getElementById("menu-oculto").remove()`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "quadro" });
    await esperar(1700);
    expect(await aberta()).toBe(true);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 700 });
    await avaliar(cdp, `window.__zerarOrdem()`);
  }, 30_000);

  it("NOD-445 revisão 2 · primeira visita na sessão: as páginas chegam depois de a conversa abrir e, com Tarefas em 1º, o bot abre no quadro", async () => {
    // Uma montagem só (a do __montar ligaria outra pílula no mesmo documento).
    await abrir(1440, false, true, false, `window.__montarSemPaginas()`);
    // Antes da resposta: só a Conversa, à vista.
    expect(await avaliar<{ modo: string; oculto: boolean }>(cdp, `({ modo: window.__quadro.modo(), oculto: document.getElementById("quadro").hidden })`)).toEqual({ modo: "conversa", oculto: true });
    await avaliar(cdp, `window.__chegaramPaginas(["tarefas", "conversa", "app:id-painel", "app:id-doc"])`);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro", quadroOculto: false, timelineInert: true, selecionada: "quadro" });
    // Abrir na casa não é uma troca da pessoa (sem animação, ninguém ouve uma volta).
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual([]);
    // A casa vale uma vez: voltar à conversa e redesenhar (outro frame, a mesma resposta) não puxa de novo para o quadro.
    await trocar("conversa");
    await acabar();
    await avaliar(cdp, `window.__chegaramPaginas(["tarefas", "conversa", "app:id-painel", "app:id-doc"])`);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa", quadroOculto: true });
  }, 30_000);

  it("NOD-445 revisão 2 · primeira visita: se a pessoa já saiu do lugar antes de as páginas chegarem (a busca, um anexo), a casa não a arrasta", async () => {
    await abrir(1440, false, true, false, `window.__montarSemPaginas(); window.__quadro.trocar("conversa")`);
    await avaliar(cdp, `window.__chegaramPaginas(["tarefas", "conversa", "app:id-painel", "app:id-doc"])`);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa", quadroOculto: true });
  }, 30_000);

  it("NOD-445 revisão 2 · 390px: o app à vista é removido em outro aparelho, a tela volta à conversa avisando quem ouve, e o composer não cobre o pé do card", async () => {
    await abrir(390, true);
    // O fim da conversa é um card (o Criar / Ajustar do app): o pé dele tem de ficar acima do composer na volta.
    await avaliar(cdp, `document.getElementById("timeline").innerHTML = '<div class="timeline">' + "<p>conversa</p>".repeat(30) + '<div class="decisao" id="card-fim" style="height:120px">card<footer id="pe-do-card">Criar · Ajustar</footer></div></div>'`);
    await avaliar(cdp, `window.__quadro.irPara(2)`);
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "painel" });
    await avaliar(cdp, `window.__trocas = []; window.__removerNoOutro("id-painel")`);
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 0))`);
    await acabar();
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["conversa:conversa"]);
    expect(await avaliar<{ atual: number; oculto: boolean; inert: boolean }>(cdp, `({ atual: Number(document.querySelector("#cabecalho .qd-pil").dataset.pagina), oculto: document.getElementById("quadro").hidden, inert: document.getElementById("timeline").inert })`)).toEqual({ atual: 0, oculto: true, inert: false });
    const m = await avaliar<{ pe: number; composer: number; composerVisivel: boolean }>(cdp, `(() => {
      const tl = document.getElementById("timeline");
      tl.scrollTop = tl.scrollHeight;
      document.getElementById("pe-do-card").scrollIntoView({ block: "end" });
      const c = document.getElementById("composer");
      return { pe: document.getElementById("pe-do-card").getBoundingClientRect().bottom, composer: c.getBoundingClientRect().top,
        composerVisivel: !c.inert && !c.classList.contains("qd-saiu") && getComputedStyle(c).visibility !== "hidden" };
    })()`);
    expect(m.composerVisivel).toBe(true);
    expect(m.pe).toBeLessThanOrEqual(m.composer + 0.5);
  }, 30_000);

  it("NOD-445 · a dica aparece uma vez só, sob a pílula, com o texto do ponteiro", async () => {
    await abrir(1440, false);
    await avaliar(cdp, `localStorage.removeItem("nod.paginas.dica"); window.__regravar()`);
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 50))`);
    expect(await avaliar<string>(cdp, `document.querySelector(".pg-dica")?.textContent ?? ""`)).toBe("passe o mouse ou deslize de lado na pílula · Alt ← → troca");
    await avaliar(cdp, `window.__quadro.irPara(1)`);
    // Abrir a doca (aqui pelo foco) guarda a marca.
    await avaliar(cdp, `document.querySelector('${aba("quadro")}').focus()`);
    expect(await avaliar<string | null>(cdp, `localStorage.getItem("nod.paginas.dica")`)).toBe("1");
  }, 30_000);

  it("j7-1 · voltar no meio da ida inverte do ponto onde está, sem salto, e assenta na Conversa", async () => {
    await abrir(1440, false);
    // Pausa a ida em 80 ms (sem depender do relógio da máquina, que sob carga atrasa o primeiro quadro) e mede de lá.
    await avaliar(cdp, `document.querySelector('${aba("quadro")}').click(); for (const a of document.getAnimations()) { a.pause(); a.currentTime = 80; }`);
    const antes = await xDaVista();
    expect(antes).toBeGreaterThan(2);
    expect(antes).toBeLessThan(46);
    await avaliar(cdp, `document.querySelector('${aba("conversa")}').click()`);
    const depois = await xDaVista();
    // A mesma animação anda para trás a partir dos 80 ms (não recomeça nem segue para a frente). Sem medir o relógio: depois do
    // `ready` a taxa pendente do reverse() já vale, então ela é negativa e o tempo não passou de 80 (a CI da main pegou o
    // "currentTime < 80" com a máquina carregada, sem nenhum quadro entre o play e a leitura).
    const inv = await avaliar<{ taxa: number; t: number }>(cdp, `(async () => {
      for (const a of document.getAnimations()) a.play();
      const a = document.getElementById("quadro").getAnimations()[0];
      await a.ready;
      return { taxa: a.playbackRate, t: Number(a.currentTime) };
    })()`);
    expect(inv.taxa).toBeLessThan(0);
    expect(inv.t).toBeLessThanOrEqual(80);
    expect(inv.t).toBeGreaterThan(0);
    expect(Math.abs(depois - antes)).toBeLessThan(6);
    // Espera a volta acabar de fato (não um prazo fixo, que a máquina carregada estoura) e mais um quadro para o assentar.
    await acabar();
    expect(await estadoFinal()).toEqual({ atual: "conversa", quadroOculto: true, timelineVis: "visible", timelineInert: false, selecionada: "conversa" });
    // A inversão também avisa quem ouve, já com o modo novo.
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["quadro:quadro", "conversa:conversa"]);
  }, 30_000);

  it("revisão 2 do PR 606: quem ouve a troca (a leitura da conversa na volta) já vê o modo novo", async () => {
    await abrir(1440, false);
    await trocar("quadro");
    await acabar();
    await trocar("conversa");
    await acabar();
    expect(await avaliar<string[]>(cdp, `window.__trocas`)).toEqual(["quadro:quadro", "conversa:conversa"]);
  }, 30_000);

  it("revisão 2 do PR 606: depois que a pessoa clica fora da aba, a regravação não puxa o foco de volta (← → não trocam sem querer)", async () => {
    await abrir(1440, false);
    const clicar = async (x: number, y: number) => {
      for (const type of ["mousePressed", "mouseReleased"]) await cdp.enviar("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
    };
    // A aba só tem tamanho com a doca aberta: o foco abre (o hover também).
    await avaliar(cdp, `document.querySelector('${aba("conversa")}').focus()`);
    await acabar();
    await avaliar(cdp, `new Promise((ok) => setTimeout(ok, 700))`);
    const xy = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('${aba("conversa")}').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await clicar(xy.x, xy.y);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.pagina ?? ""`)).toBe("0");
    // Regravar com o foco ainda na aba: o foco vai para a aba nova.
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.pagina ?? ""`)).toBe("0");
    await clicar(700, 700); // o vazio da conversa: o foco cai no body
    expect(await avaliar<string>(cdp, `document.activeElement.tagName`)).toBe("BODY");
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.tagName`)).toBe("BODY");
  }, 30_000);

  it("j7-1 · teclado: → vai a Tarefas com o foco na aba, ⇧→ não troca, End vai ao último app e o foco sobrevive à regravação do cabeçalho", async () => {
    await abrir(1440, false);
    await avaliar(cdp, `document.querySelector('${aba("conversa")}').focus()`);
    const tecla = async (modifiers = 0) => {
      await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers });
      await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers });
    };
    await avaliar(cdp, `window.__teclas = []; document.addEventListener("keydown", (e) => window.__teclas.push(e.key + ":" + e.shiftKey), true)`);
    await tecla(8); // ⇧→ (seleção/atalho): não é a seta da aba
    expect(await avaliar<string[]>(cdp, `window.__teclas`)).toEqual(["ArrowRight:true"]);
    expect(await estadoFinal()).toMatchObject({ atual: "conversa" });
    await tecla();
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.pagina`)).toBe("1");
    await acabar();
    await avaliar(cdp, `window.__regravar()`);
    expect(await avaliar<string>(cdp, `document.activeElement.dataset.pagina`)).toBe("1");
    // A doca nova nasce aberta (o foco está nela), sem mola desde o zero.
    expect(await avaliar<number>(cdp, `document.querySelector("#cabecalho .pg-doca").getBoundingClientRect().width`)).toBeGreaterThan(100);
    expect(await estadoFinal()).toMatchObject({ atual: "quadro", selecionada: "quadro" });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
    await acabar();
    expect(await estadoFinal()).toMatchObject({ atual: "doc", selecionada: "doc" });
    expect(await avaliar<string>(cdp, `document.getElementById("pg-anuncio").textContent`)).toBe("página 4 de 4, Doc");
  }, 30_000);

  it("flag desligada: a pílula é a de sempre e a troca não mexe no palco (nem no inert de outra camada)", async () => {
    await abrir(1440, false, false);
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#cabecalho .qd-pil, #cabecalho .pg-doca").length`)).toBe(0);
    await avaliar(cdp, `document.getElementById("timeline").inert = true; window.__quadro.sincronizar({ chave: null, nome: "" })`);
    expect(await avaliar<boolean>(cdp, `document.getElementById("timeline").inert`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.getElementById("quadro").hidden`)).toBe(true);
  }, 30_000);

  for (const largura of [1440, 390]) {
    it(`j7-1 · ${largura}px com Reduzir movimento: fade curto, sem transform no conteúdo nem nos ícones da doca`, async () => {
      await abrir(largura, true);
      const ida = await trocar("quadro");
      expect(ida.ms).toBe(120);
      expect(ida.quadro).toEqual(["-", "-"]);
      expect(ida.timeline).toEqual(["-", "-"]);
      await esperar(40);
      expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector("#cabecalho .pg-ic")).transform`)).toBe("none");
      await acabar();
      // A aba escolhida tem marca própria (fundo), sem depender de movimento.
      expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector('#cabecalho .pg-ic[aria-selected="true"]')).backgroundColor`)).not.toBe("rgba(0, 0, 0, 0)");
      expect(await estadoFinal()).toMatchObject({ atual: "quadro", quadroOculto: false, timelineVis: "hidden" });
      const volta = await trocar("conversa");
      expect(volta.quadro).toEqual(["-", "-"]);
    }, 30_000);
  }
});
