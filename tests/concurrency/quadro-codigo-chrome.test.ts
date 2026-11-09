import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-430 (revisão 4 do PR #627) no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (o molde de
 * quadro-jornada-chrome.test.ts):
 *  - o código da tarefa na fala do bot (`nod-tarefa:<anfitrião>:<tarefa>`, textoFormatado) vira botão; o clique abre a
 *    tarefa no quadro do dono, com a conversa dele já na tela ou quando ela chega (o pedido espera o sincronizar);
 *  - "Sem quadro": a conversa do dono chega sem quadro (excluído) e o pedido cai; o quadro novo não abre a tarefa velha.
 * O clique vai pelo mesmo `data-act="abrir-tarefa-quadro"` do main.ts; o delegado aqui faz só o que ele faz no quadro
 * (abrirTarefaDe), sem a navegação (o main troca de conversa e chama sincronizar, que o teste chama na mão).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-430: o CI precisa do Chrome para provar o código da tarefa (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ADA = "a0000000-0000-4000-8000-000000000001";
const ENG = "a0000000-0000-4000-8000-000000000002";
const TAREFA = "10000000-0000-4000-8000-000000000001";

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { textoFormatado } from "./web/lib/texto-formatado.ts";
const agora = 1_700_000_000_000;
const ADA = "${ADA}", ENG = "${ENG}", TAREFA = "${TAREFA}";
const tarefa = (id, titulo, status) => ({ id, quadroId: "q1", titulo, descricao: "Descrição de " + titulo, status, agenteId: ENG, ordem: 1,
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "EngApp" });
const q = { id: "q1", agenteId: ENG, meta: "Lançar", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "EngApp", ultimoLote: null, feitas: 0, total: 2, tarefas: [tarefa(TAREFA, "Revisar o login", "afazer"), tarefa("10000000-0000-4000-8000-000000000002", "Outra", "backlog")] };
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  conversa: async () => ({ mensagens: [] }),
  comentariosDaTarefa: async () => ({ comentarios: [], atividade: [], criadaPor: null }),
};
window.__montar = () => {
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => ({ avatar: '<span class="avatar">E</span>', nome: id === ENG ? "EngApp" : "Ada" }),
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, agentes: () => [{ id: ADA, nome: "Ada" }, { id: ENG, nome: "EngApp" }] } });
  window.__q = t;
  // A fala da Ada com o código da tarefa no quadro do EngApp (o que o gerir_quadro devolve).
  document.getElementById("timeline").innerHTML = '<div class="fala">' + textoFormatado("Criei [1a2b](nod-tarefa:" + ENG + ":" + TAREFA + ") no quadro do EngApp.") + "</div>";
  document.addEventListener("click", (e) => {
    const b = e.target.closest('[data-act="abrir-tarefa-quadro"]');
    if (b) t.abrirTarefaDe(b.dataset.agente, b.dataset.tarefa);
  });
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "codigo.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-430 · o código da tarefa no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod430-"));
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

  async function abrir(): Promise<void> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector('#timeline [data-act="abrir-tarefa-quadro"]')`);
  }

  // O clique de verdade (Input.dispatchMouseEvent no centro do botão), não um .click() no elemento.
  const clicarNoCodigo = async (): Promise<void> => {
    const r = await avaliar<{ x: number; y: number }>(cdp, `(() => { const b = document.querySelector('#timeline [data-act="abrir-tarefa-quadro"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    for (const type of ["mousePressed", "mouseReleased"] as const) await cdp.enviar("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  };
  const tarefaAberta = () => avaliar<string | null>(cdp, `(() => { const t = document.querySelector("#quadro .qd-tarefa"); return t && t.offsetParent ? t.textContent : null; })()`);

  it("o código vira botão com o rótulo do que abre", async () => {
    await abrir();
    const b = await avaliar<{ texto: string; rotulo: string | null; agente: string; tarefa: string }>(cdp, `(() => { const b = document.querySelector('#timeline [data-act="abrir-tarefa-quadro"]'); return { texto: b.textContent, rotulo: b.getAttribute("aria-label"), agente: b.dataset.agente, tarefa: b.dataset.tarefa }; })()`);
    expect(b).toEqual({ texto: "1a2b", rotulo: "Abrir tarefa 1a2b no quadro", agente: ENG, tarefa: TAREFA });
  });

  it("com a conversa do dono na tela: o clique abre a tarefa no quadro dele", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c-eng", nome: "EngApp", agenteId: "${ENG}" })`);
    expect(await tarefaAberta()).toBeNull();
    await clicarNoCodigo();
    await ate(`(() => { const t = document.querySelector("#quadro .qd-tarefa"); return t && t.offsetParent; })()`);
    expect(await tarefaAberta()).toContain("Revisar o login");
  });

  it("na conversa da Ada: o pedido espera e abre quando a conversa do EngApp chega (a navegação do main)", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c-ada", nome: "Ada", agenteId: "${ADA}" })`);
    await clicarNoCodigo();
    await esperar(200);
    expect(await tarefaAberta()).toBeNull();
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c-eng", nome: "EngApp", agenteId: "${ENG}" })`);
    await ate(`(() => { const t = document.querySelector("#quadro .qd-tarefa"); return t && t.offsetParent; })()`);
    expect(await tarefaAberta()).toContain("Revisar o login");
  });

  it("Sem quadro: a conversa do EngApp chega sem quadro (excluído); o pedido cai e o quadro novo não abre a tarefa velha", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c-ada", nome: "Ada", agenteId: "${ADA}" })`);
    await clicarNoCodigo();
    // Chegou sem quadro: a vista do quadro não aparece e nada abre.
    await avaliar(cdp, `window.__q.sincronizar({ chave: null, nome: "EngApp", agenteId: "${ENG}" })`);
    await esperar(200);
    expect(await tarefaAberta()).toBeNull();
    expect(await avaliar<string>(cdp, "window.__q.modo()")).toBe("conversa");
    // Depois ganha um quadro: abre o quadro, mas não a tarefa pedida antes.
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c-eng", nome: "EngApp", agenteId: "${ENG}" })`);
    await avaliar(cdp, `window.__q.trocar("quadro")`);
    await ate(`document.querySelector("#quadro .qd-card")`);
    expect(await tarefaAberta()).toBeNull();
  });
});
