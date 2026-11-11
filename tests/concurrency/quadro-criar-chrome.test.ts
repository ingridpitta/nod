import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-415 (ADR-141) no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - sem quadro: o form "criar quadro" com a meta opcional; Criar sem meta nasce no fluxo contínuo (sem fração);
 *  - quadro mínimo (2026-11-10): uma linha só, o nome com o chevron abre o menu do quadro (setas, Esc, foco volta);
 *  - "Meta…" abre o campo no menu; Enter grava e a meta aparece em cinza ao lado do nome; Esc desiste; vazio tira;
 *  - "Prazo…" abre o select no menu e grava na hora;
 *  - "Remover quadro" confirma e volta ao "criar quadro"; recusar a confirmação não chama a API.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-415: o CI precisa do Chrome para provar o quadro (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
const agora = 1_700_000_000_000;
let q = null;
let n = 0;
const chamadas = [];
window.__trilha = [];
const lote = () => ({ id: "L" + (++n), quadroId: "q1", autor: { tipo: "pessoa" }, resumo: "mudou", tarefaIds: [], desfeitoEm: null, criadoEm: agora });
const api = {
  quadro: async () => ({ quadro: q && structuredClone(q) }),
  conversa: async () => ({ mensagens: [] }),
  enviar: async () => ({ ok: true }),
  responderTarefa: async () => ({ ok: true, quadro: q, lote: null, desfeito: false }),
  desfazerLoteQuadro: async () => ({ ok: true, quadro: q, lote: null, desfeito: true }),
  criarQuadro: async (a, campos) => {
    chamadas.push(["criar", campos]);
    q = { id: "q1", agenteId: "a", meta: campos.meta ?? null, prazo: campos.prazo ?? null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
      agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 0, tarefas: [] };
    const l = lote(); q.ultimoLote = l;
    return { ok: true, quadro: q, lote: l, comecaram: [], desfeito: false };
  },
  editarQuadro: async (a, campos) => {
    chamadas.push(["editar", campos]);
    q = { ...q, ...(campos.meta !== undefined ? { meta: campos.meta } : {}), ...(campos.prazo !== undefined ? { prazo: campos.prazo } : {}) };
    const l = lote(); q.ultimoLote = l;
    return { ok: true, quadro: q, lote: l, comecaram: [], desfeito: false };
  },
  removerQuadro: async () => { chamadas.push(["remover"]); q = null; return { ok: true, quadro: null, lote: null, comecaram: [], desfeito: false, removido: true }; },
};
window.__chamadas = chamadas;
window.__confirma = true;
window.__comQuadro = () => { q = { id: "33333333-3333-4333-8333-333333333333", agenteId: "a", meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 0, tarefas: [] }; };
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: () => null, hora: () => "10:00", recolherEm: 60_000, juntarEm: 10,
    trilha: (e) => window.__trilha.push(e), confirmar: (texto) => { chamadas.push(["confirmar", texto]); return window.__confirma; } } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "criar.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-415 no Chrome real: criar, meta, prazo e remover pela tela", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod415-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const texto = (sel: string) => avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
  const chamadas = () => avaliar<unknown[][]>(cdp, "window.__chamadas");
  const tecla = (sel: string, key: string) => avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
  const enviarForm = (sel: string) => avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);

  it("cria sem meta, ganha meta e prazo, tira a meta e remove", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    // A página age como focada (o Chrome sem janela não dispara blur/focusout de verdade sem isso).
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector('#quadro [data-form="criar-quadro"]')`);
    expect(await texto("#quadro .qd-sem-quadro")).toContain("Ada ainda não tem quadro");

    // Criar sem meta: o fluxo contínuo. Quadro mínimo (2026-11-10): uma linha só, o nome com o chevron e nada mais.
    await enviarForm('#quadro [data-form="criar-quadro"]');
    await ate(`document.querySelector("#quadro .qm-cab-bt")`);
    expect((await chamadas())[0]).toEqual(["criar", { meta: null, prazo: null }]);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .qd-barra, #quadro .qd-meta, #quadro .qm-cab-meta, #quadro .qd-flag, #quadro .qd-pessoas-links")`)).toBe(true);
    // O nome e o funil na mesma linha da barra.
    expect(await avaliar<boolean>(cdp, `document.querySelector("#quadro .qm-cab-bt").closest(".qm-barra") === document.querySelector('#quadro [data-act="fil-abrir"]').closest(".qm-barra")`)).toBe(true);
    const abrirMenu = async () => {
      if (!(await avaliar<boolean>(cdp, `!!document.querySelector("#qm-pop-quadro")`))) await avaliar(cdp, `document.querySelector("#quadro .qm-cab-bt").click()`);
      await ate(`document.querySelector("#qm-pop-quadro")`);
    };

    // O menu com teclado: abre no 1º item, a seta para cima dá a volta, Esc fecha e o foco volta ao nome.
    await abrirMenu();
    await ate(`document.activeElement?.dataset.act === "editar-meta"`);
    expect(await texto("#qm-pop-quadro")).toContain("Em teste · só você vê");
    await tecla("#qm-pop-quadro [data-act='editar-meta']", "ArrowUp");
    await ate(`document.activeElement?.dataset.act === "remover-quadro"`);
    await tecla("#qm-pop-quadro [data-act='remover-quadro']", "ArrowDown");
    await ate(`document.activeElement?.dataset.act === "editar-meta"`);
    await tecla("#qm-pop-quadro [data-act='editar-meta']", "Escape");
    await ate(`!document.querySelector("#qm-pop-quadro") && document.activeElement?.classList.contains("qm-cab-bt")`);

    // Meta… → campo no próprio menu; Esc desiste sem chamar a API e o foco volta ao item.
    await abrirMenu();
    await avaliar(cdp, `document.querySelector('#quadro [data-act="editar-meta"]').click()`);
    await ate(`document.activeElement?.id === "qd-meta-in"`);
    await tecla("#qd-meta-in", "Escape");
    await ate(`!document.querySelector("#qd-meta-in") && document.activeElement?.dataset.act === "editar-meta"`);
    expect((await chamadas()).filter((c) => c[0] === "editar")).toHaveLength(0);
    // Sair do campo sem Enter nem Esc também desiste (QA do PR #617).
    await avaliar(cdp, `document.querySelector('#quadro [data-act="editar-meta"]').click()`);
    await ate(`document.activeElement?.id === "qd-meta-in"`);
    await avaliar(cdp, `document.activeElement.blur()`);
    await ate(`!document.querySelector("#qd-meta-in")`);
    expect((await chamadas()).filter((c) => c[0] === "editar")).toHaveLength(0);

    // Enter grava a meta: ela aparece em cinza ao lado do nome; o progresso fica no topo do menu.
    await abrirMenu();
    await avaliar(cdp, `document.querySelector('#quadro [data-act="editar-meta"]').click()`);
    await ate(`document.querySelector("#qd-meta-in")`);
    await avaliar(cdp, `document.querySelector("#qd-meta-in").value = "Lançar o quadro"`);
    await enviarForm('#quadro [data-form="editar-meta"]');
    await ate(`document.querySelector("#quadro .qm-cab-meta")`);
    expect(await texto("#quadro .qm-cab-meta")).toBe("Lançar o quadro");
    await abrirMenu();
    expect(await texto("#qm-pop-quadro")).toContain("nenhuma tarefa ainda");
    expect(await texto("#qc-faixa")).toContain("Meta trocada.");

    // Prazo… abre o select no menu; a troca grava na hora e o prazo aparece ao lado da meta.
    await avaliar(cdp, `document.querySelector('#quadro [data-act="qmenu-prazo"]').click()`);
    await ate(`document.activeElement?.id === "qd-prazo"`);
    const amanha = await avaliar<string>(cdp, `document.querySelector("#qd-prazo").options[2].value`);
    await avaliar(cdp, `(() => { const s = document.querySelector("#qd-prazo"); s.value = ${JSON.stringify(amanha)}; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await ate(`document.querySelector("#qd-prazo")?.value === ${JSON.stringify(amanha)} && window.__chamadas.some((c) => c[0] === "editar" && c[1].prazo)`);
    expect((await chamadas()).at(-1)).toEqual(["editar", { prazo: amanha }]);
    await ate(`/Lançar o quadro · até/.test(document.querySelector("#quadro .qm-cab-meta")?.textContent ?? "")`);

    // Vazio tira a meta: volta ao fluxo contínuo (só o prazo fica ao lado do nome).
    await abrirMenu();
    await avaliar(cdp, `document.querySelector('#quadro [data-act="editar-meta"]').click()`);
    await ate(`document.querySelector("#qd-meta-in")`);
    await avaliar(cdp, `document.querySelector("#qd-meta-in").value = ""`);
    await enviarForm('#quadro [data-form="editar-meta"]');
    await ate(`/^até/.test(document.querySelector("#quadro .qm-cab-meta")?.textContent ?? "")`);
    expect(await texto("#qc-faixa")).toContain("Meta tirada");

    // Remover (no menu): recusar a confirmação não chama a API; aceitar volta ao "criar quadro".
    await avaliar(cdp, "window.__confirma = false");
    await abrirMenu();
    await avaliar(cdp, `document.querySelector('#quadro [data-act="remover-quadro"]').click()`);
    await esperar(100);
    expect((await chamadas()).some((c) => c[0] === "remover")).toBe(false);
    expect(String((await chamadas()).at(-1)?.[1])).toContain("não dá para desfazer");
    await avaliar(cdp, "window.__confirma = true");
    await abrirMenu();
    await avaliar(cdp, `document.querySelector('#quadro [data-act="remover-quadro"]').click()`);
    await ate(`document.querySelector('#quadro [data-form="criar-quadro"]')`);
    expect((await chamadas()).at(-1)).toEqual(["remover"]);
    expect(await texto("#qc-faixa")).toContain("voltou a ser um bot comum");
  }, 60_000);
  it("NOD-474: abrir Tarefas grava uma vez; blur/focus e redraw não duplicam", async () => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__comQuadro(); window.__montar()");
    await ate("window.__trilha.length === 1");
    expect(await avaliar(cdp, "window.__trilha")).toEqual([{ acao: "quadro_aberto", quadroId: "33333333-3333-4333-8333-333333333333", via: "tela" }]);
    await avaliar(cdp, `window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus")); window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" })`);
    expect(await avaliar<number>(cdp, "window.__trilha.length")).toBe(1);
    await avaliar(cdp, "window.__q.reler()");
    await esperar(100);
    expect(await avaliar<number>(cdp, "window.__trilha.length")).toBe(1);

    // Um link destinado a outro bot é ignorado por inteiro: não pode contaminar a origem da próxima abertura manual.
    await avaliar(cdp, `window.__q.abrirTarefa("outro-bot", "t1"); window.__q.trocar("conversa"); window.__q.trocar("quadro")`);
    await ate("window.__trilha.length === 2");
    expect(await avaliar(cdp, "window.__trilha[1]")).toEqual({ acao: "quadro_aberto", quadroId: "33333333-3333-4333-8333-333333333333", via: "tela" });
  });
});
