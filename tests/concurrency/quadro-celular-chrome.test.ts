import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { criarCatcherDriver } from "../../src/adapters/executor/drivers/catcher.ts";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADA-18 (celular F3): o quadro no celular no app inteiro e no Chrome de verdade, a 390×844 com toque e `pointer: coarse`.
 * A lista agrupada, a visão no título gravada no Exibir, as colunas com snap sem rolagem lateral da página, o toque longo
 * que abre Mover para… (sem select nativo) e o computador a 1280×800 sem nada do celular (critério 13). Sem a web montada
 * (npx vite build) ou sem Chrome, pula, como quadro-link-chrome.test.ts.
 */

const WEB = join(process.cwd(), "dist/web");
const chrome = existsSync(join(WEB, "index.html")) ? (() => { try { return acharChrome(); } catch { return null; } })() : null;
if (process.env.NOD_QA_EXIGE_CHROME === "1" && !chrome) throw new Error("ADA-18: o CI precisa da web montada (npx vite build) e do Chromium para o e2e do quadro no celular");

const descrever = chrome ? describeIntegracao : describe.skip;
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("ADA-18: o quadro no celular (Chrome real, 390×844)", () => {
  let srv: ServidorCompleto;
  let cdp: Cdp;
  let dir: string;
  let agente: Agente;
  let codigo = "";
  const agentes: string[] = [];
  const conversas: string[] = [];

  async function celular(): Promise<void> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
  }
  async function computador(): Promise<void> {
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "hover" }, { name: "pointer", value: "fine" }] });
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }

  beforeAll(async () => {
    srv = await servidorCompleto({
      env: { NOD_STATIC_DIR: WEB, NOD_QUADROS: "todos", NOD_PRAZO_DECISAO_MS: "86400000" },
      drivers: ({ urlNod }) => [criarCatcherDriver({ urlNod, atrasoMs: 0 })],
    });
    await srv.json("POST", "onboarding/concluir", {});
    await srv.json("PUT", "preferencias", { experimentos: { quadro: true } });
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Celia" });
    agente = r.agente;
    agentes.push(r.agente.id);
    conversas.push(r.conversa.id);
    await srv.json("POST", `agentes/${agente.id}/quadro`, { meta: "Celular F3" });
    for (const titulo of ["Primeira do celular", "Segunda do celular", "Terceira do celular"]) await srv.json("POST", `agentes/${agente.id}/quadro/tarefas`, { titulo });
    const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
    codigo = quadro!.tarefas.find((t) => t.titulo === "Primeira do celular")!.codigo!;
    dir = mkdtempSync(join(tmpdir(), "ada18-celular-"));
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9500 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
    await cdp.enviar("Network.enable");
    await celular();
  }, 120_000);

  afterAll(async () => {
    cdp?.fechar();
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  }, 30_000);

  async function ate(expressao: string, oQue: string, ms = 20_000): Promise<void> {
    for (let t = 0; t < ms; t += 100) {
      if (await avaliar<boolean>(cdp, `!!(${expressao})`)) return;
      await espera(100);
    }
    throw new Error(`esperei ${ms} ms por ${oQue}`);
  }
  const json = async <T>(expr: string): Promise<T> => JSON.parse(await avaliar<string>(cdp, `JSON.stringify(${expr})`)) as T;
  const clicar = (sel: string) => avaliar(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.getClientRects().length) ?? document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("não achei ${sel.replace(/"/g, "'")}"); el.click(); return true; })()`);
  const exibido = async (): Promise<Record<string, unknown> | undefined> => {
    const p = await srv.json<{ quadroExibir?: Record<string, Record<string, unknown>> }>("GET", "preferencias");
    const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
    return p.quadroExibir?.[quadro!.id];
  };

  /** Abre o quadro pelo link da tarefa (o caminho que o app já tem) e volta à lista. */
  async function abrirQuadro(pronto = "#quadro .qd-cel .qd-cl"): Promise<void> {
    // Reaproveita a página quando o quadro já está na tela e sem folha: depois de umas 5 navegações seguidas no mesmo
    // Chrome, a seguinte fica em "Abrindo o quadro…". Medido no QA do PR #700 (2026-11-08): cada página que sai vai para o
    // back/forward cache com o EventSource de /eventos aberto; com 5 delas, o limite de 6 conexões por host do HTTP/1.1
    // enche e os fetches da página nova ficam na fila (o servidor responde ao Node em 56 ms). Com o Chrome em
    // --disable-features=BackForwardCache as 7 provas passam sem reaproveitar. Anterior ao PR (web/main.ts não fecha o
    // stream no pagehide); follow-up.
    if (await avaliar<boolean>(cdp, `!!document.querySelector(${JSON.stringify(pronto)}) && !document.querySelector("#quadro .qd-folha")`)) return;
    await cdp.enviar("Page.navigate", { url: `${srv.url}/?tarefa=${encodeURIComponent(codigo)}` });
    const entrar = `[data-act="entrar"][data-pessoa="${srv.pessoa.pessoaId}"]`;
    await ate(`document.querySelector(${JSON.stringify(entrar)}) || document.querySelector("#quadro .qd-tarefa") || document.querySelector(${JSON.stringify(pronto)})`, "a tela de entrar, a tarefa ou o quadro");
    if (await avaliar<boolean>(cdp, `!!document.querySelector(${JSON.stringify(entrar)})`)) await clicar(entrar);
    await ate(`document.querySelector('#quadro [data-act="voltar-ao-quadro"]') || document.querySelector(${JSON.stringify(pronto)})`, "a tarefa aberta ou o quadro");
    if (await avaliar<boolean>(cdp, `!!document.querySelector('#quadro [data-act="voltar-ao-quadro"]')`)) await clicar('#quadro [data-act="voltar-ao-quadro"]');
    await ate(`document.querySelector(${JSON.stringify(pronto)})`, "o quadro");
    await espera(200);
  }

  it("critério 13: no computador (1280×800) nada do celular aparece; a grade está lá", async () => {
    await computador();
    try {
      await abrirQuadro("#quadro .qd-quadro");
      const m = await json<{ cel: boolean; grade: boolean }>(`({ cel: !!document.querySelector("#quadro .qd-cel"), grade: [...document.querySelectorAll("#quadro .qd-quadro")].some((e) => e.getClientRects().length) })`);
      expect(m).toEqual({ cel: false, grade: true });
    } finally {
      await celular();
    }
  }, 60_000);

  it("critério 1: a lista agrupada (linhas de 52 px, cabeçalho de 13 px), o título é a visão e não há select nativo", async () => {
    await abrirQuadro();
    const m = await json<{ linha: number; cab: number; topo: number; selects: number; grade: boolean; docX: [number, number] }>(`(() => {
      const li = [...document.querySelectorAll("#quadro .qd-cel .qd-cl")].find((e) => e.getClientRects().length);
      const cab = document.querySelector("#quadro .qd-cel .qd-cg-cab");
      const selects = [...document.querySelectorAll("#quadro select")].filter((e) => e.getClientRects().length).length;
      const grade = [...document.querySelectorAll("#quadro .qd-quadro")].some((e) => e.getClientRects().length);
      return { linha: li.getBoundingClientRect().height, cab: parseFloat(getComputedStyle(cab).fontSize), topo: Math.round(li.getBoundingClientRect().top), selects, grade, docX: [document.documentElement.scrollWidth, innerWidth] };
    })()`);
    expect(m.linha).toBeGreaterThanOrEqual(52);
    expect(m.cab).toBe(13);
    expect(m.selects).toBe(0);
    expect(m.grade).toBe(false);
    expect(m.docX[0]).toBeLessThanOrEqual(m.docX[1]);
    // A 1ª tarefa do protótipo fica a 231 px do topo; o app tem a barra do bot por cima, então a régua aqui é "acima da dobra
    // e sem a grade": registra a medida para o relatório do QA.
    expect(m.topo).toBeLessThan(844 / 2);
    expect(await avaliar<string>(cdp, `document.querySelector('#quadro [data-act="cel-visao"]').getAttribute("aria-label")`)).toBe("Celular F3, visão Lista");
  }, 60_000);

  it("critérios 2 e 8: Colunas pelo título fica gravada no Exibir; colunas de 280 px com snap, a página não rola de lado", async () => {
    await abrirQuadro();
    await clicar('#quadro [data-act="cel-visao"]');
    await ate(`document.querySelector('#quadro .qd-cel-folha [data-visao="colunas"]')`, "a folha da visão");
    await clicar('#quadro .qd-cel-folha [data-visao="colunas"]');
    await ate(`document.querySelector("#quadro .qd-cel-cols .qd-cc")`, "as colunas");
    for (let i = 0; i < 50 && (await exibido())?.["visao"] !== "colunas"; i++) await espera(100);
    expect((await exibido())?.["visao"]).toBe("colunas");
    const m = await json<{ larg: number; snap: string; docX: [number, number]; espia: boolean; pontos: number }>(`(() => {
      const cols = document.querySelector("#quadro .qd-cel-cols"); const cc = cols.querySelectorAll(".qd-cc");
      return { larg: cc[0].getBoundingClientRect().width, snap: getComputedStyle(cols).scrollSnapType, docX: [document.documentElement.scrollWidth, innerWidth],
        espia: cc.length > 1 && cc[1].getBoundingClientRect().left < innerWidth, pontos: document.querySelectorAll("#quadro .qd-cel-pontos .qd-cel-ponto").length };
    })()`);
    expect(m.larg).toBe(280);
    expect(m.snap).toContain("x");
    expect(m.snap).toContain("mandatory");
    expect(m.docX[0]).toBeLessThanOrEqual(m.docX[1]);
    expect(m.espia).toBe(true);
    expect(m.pontos).toBeGreaterThan(1);
    // Rolar o carrossel acende o 2º ponto.
    await avaliar(cdp, `document.querySelector("#quadro .qd-cel-cols").scrollTo({ left: 292, behavior: "instant" })`);
    await ate(`document.querySelectorAll("#quadro .qd-cel-ponto")[1]?.classList.contains("qd-cel-ponto-on")`, "o 2º ponto aceso");
    // Recarregar mantém a visão (vem do servidor).
    await abrirQuadro();
    await ate(`document.querySelector('#quadro .qd-cel[data-visao="colunas"]')`, "a visão Colunas depois de recarregar");
    await clicar('#quadro [data-act="cel-visao"]');
    await clicar('#quadro .qd-cel-folha [data-visao="lista"]');
    await ate(`document.querySelector('#quadro .qd-cel[data-visao="lista"]')`, "a volta à Lista");
  }, 90_000);

  it("revisão do PR #700: a visão trocada pelo chat (gerir_quadro exibir) chega à tela aberta quando o turno termina", async () => {
    await abrirQuadro();
    await ate(`document.querySelector('#quadro .qd-cel[data-visao="lista"]')`, "a Lista");
    const acoes = [{ tipo: "exibir", visao: "colunas" }];
    await srv.json("POST", `conversas/${conversas[0]}/mensagens`, { texto: `Mostra em colunas.\n[[tool: gerir_quadro ${JSON.stringify({ acoes })}]]\n[[texto: Feito.]]` });
    for (let i = 0; i < 100 && (await exibido())?.["visao"] !== "colunas"; i++) await espera(100);
    expect((await exibido())?.["visao"]).toBe("colunas");
    // Sem recarregar: a tela que já estava aberta passa a Colunas.
    await ate(`document.querySelector('#quadro .qd-cel[data-visao="colunas"]')`, "a visão Colunas vinda do chat", 10_000);
    await clicar('#quadro [data-act="cel-visao"]');
    await clicar('#quadro .qd-cel-folha [data-visao="lista"]');
    await ate(`document.querySelector('#quadro .qd-cel[data-visao="lista"]')`, "a volta à Lista");
  }, 60_000);

  it("critérios 9 e 11: segurar a linha 500 ms abre o menu; Mover para… lista as colunas em 56 px e move a tarefa", async () => {
    await abrirQuadro();
    const p = await json<{ x: number; y: number; id: string }>(`(() => {
      const li = [...document.querySelectorAll("#quadro .qd-cel .qd-cl[data-tarefa]")].find((e) => e.getClientRects().length && e.textContent.includes("Segunda do celular"));
      const r = li.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: li.dataset.tarefa };
    })()`);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
    await espera(700);
    await cdp.enviar("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    // O clique de soltar (que cai no fundo da folha) não pode fechá-la.
    await espera(300);
    await ate(`document.querySelector('#quadro .qd-cel-folha [data-act="cel-tarefa-passo"][data-passo="mover"]')`, "o menu do toque longo");
    // O clique ao soltar não abriu a tarefa.
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await clicar('#quadro .qd-cel-folha [data-passo="mover"]');
    await ate(`document.querySelector('#quadro .qd-cel-folha [data-act="tarefa-mover-para"][data-coluna="fazendo"]')`, "a lista do Mover");
    const alt = await avaliar<number>(cdp, `document.querySelector('#quadro .qd-cel-folha [data-act="tarefa-mover-para"][data-coluna="fazendo"]').getBoundingClientRect().height`);
    expect(Math.round(alt)).toBe(56);
    expect(await avaliar<number>(cdp, `[...document.querySelectorAll("#quadro select")].filter((e) => e.getClientRects().length).length`)).toBe(0);
    await clicar('#quadro .qd-cel-folha [data-act="tarefa-mover-para"][data-coluna="fazendo"]');
    await ate(`!document.querySelector("#quadro .qd-cel-folha")`, "a folha fechada");
    for (let i = 0; i < 50; i++) {
      const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
      if (quadro!.tarefas.find((t) => t.id === p.id)?.status === "fazendo") break;
      await espera(100);
    }
    const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
    expect(quadro!.tarefas.find((t) => t.id === p.id)?.status).toBe("fazendo");
    // O mesmo lote do computador: o Mover cria um lote com Desfazer.
    expect(quadro!.ultimoLote?.tarefaIds).toContain(p.id);
  }, 60_000);

  it("revisão do PR #700: a folha prende o foco (Tab e Shift+Tab circulam dentro dela; plano §7)", async () => {
    await abrirQuadro();
    await clicar('#quadro [data-act="cel-visao"]');
    await ate(`document.activeElement?.closest?.("#quadro .qd-cel-folha")`, "o foco na folha da visão");
    const n = await avaliar<number>(cdp, `document.querySelectorAll("#quadro .qd-cel-folha button").length`);
    const tab = async (shift: boolean) => {
      const base = { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
      await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
      await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    };
    const fora: string[] = [];
    for (const shift of [false, true]) {
      for (let i = 0; i < n + 2; i++) {
        await tab(shift);
        if (!(await avaliar<boolean>(cdp, `!!document.activeElement?.closest?.("#quadro .qd-cel-folha")`))) fora.push(await avaliar<string>(cdp, `document.activeElement?.outerHTML.slice(0, 80) ?? "nada"`));
      }
    }
    expect(fora).toEqual([]);
    await avaliar(cdp, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await ate(`!document.querySelector("#quadro .qd-cel-folha")`, "a folha fechada pelo Esc");
  }, 60_000);

  it("QA do PR #700: o quadro regravado com a folha aberta (tarefa nova de fora) deixa o foco no mesmo item da folha", async () => {
    await abrirQuadro();
    await clicar('#quadro [data-act="cel-visao"]');
    await ate(`document.activeElement?.closest?.("#quadro .qd-cel-folha")`, "o foco na folha da visão");
    await avaliar(cdp, `document.querySelector('#quadro .qd-cel-folha [data-visao="minhas"]').focus()`);
    await srv.json("POST", `agentes/${agente.id}/quadro/tarefas`, { titulo: "Chegou com a folha aberta" });
    const { quadro } = await srv.json<{ quadro: QuadroDto | null }>("GET", `agentes/${agente.id}/quadro`);
    const tarefa = quadro!.tarefas.find((t) => t.titulo === "Chegou com a folha aberta")!;
    await ate(`document.querySelector('#quadro .qd-cel [data-tarefa="${tarefa.id}"]')`, "a tarefa nova no quadro");
    expect(await avaliar<string>(cdp, `document.activeElement?.dataset?.visao ?? document.activeElement?.tagName`)).toBe("minhas");
    await avaliar(cdp, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await ate(`!document.querySelector("#quadro .qd-cel-folha")`, "a folha fechada pelo Esc");
  }, 60_000);

  it("critério 12: o ⋯ do topo leva a Ordem das colunas e ao prazo, sem select", async () => {
    await abrirQuadro();
    await clicar('#quadro [data-act="cel-topo"]');
    await ate(`document.querySelector('#quadro .qd-cel-folha [data-act="col-folha"]')`, "a folha do ⋯");
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qd-cel-folha [data-act="cel-topo-passo"][data-passo="prazo"]')`)).toBe(true);
    await clicar('#quadro .qd-cel-folha [data-act="col-folha"]');
    await ate(`document.querySelector("#quadro .qd-folha:not(.qd-cel-folha)")`, "a Ordem das colunas");
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-cel-folha")`)).toBe(true);
  }, 60_000);
});
