import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * Revisão 5 do PR #625 (NOD-418) no Chrome de verdade: a região role=status das Execuções é um nó persistente, criado
 * vazio na montagem e fora do bloco que o desenho recria. A mudança de estado do trabalho (o frame `quadro.mudou` e a
 * releitura) troca só o texto desse MESMO nó; o redesenho sem mudança de estado não o reescreve; e a seção redesenhada
 * não tem região role=status própria (a recriada a cada innerHTML não é lida pelo leitor de tela).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-418: o CI precisa do Chrome para provar a região de status (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
const agora = 1_700_000_000_000;
const tarefa = (id, titulo, status) => ({ id, quadroId: "q1", titulo, descricao: "", status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: "tu1", criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: "rodando", agenteNome: "Ada" });
const q = { id: "q1", agenteId: "a", meta: "Meta", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 1, tarefas: [tarefa("t1", "Escrever o executor", "fazendo")] };
let estado = "rodando";
let leituras = 0;
const exec = () => ({ id: "e1", numero: 1, origem: "inicio", turnoId: "tu1", turnoAtual: "tu1", motivo: estado === "falhou" ? "A máquina caiu." : null,
  criadoEm: agora, comecouEm: agora, ultimaFrase: null, tentativa: null, esperando: false, novaTentativaEm: null, saida: null, volta: null, estado });
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  conversa: async () => ({ mensagens: [] }),
  trabalhosDaTarefa: async () => { leituras++; return { execucoes: [exec()], recados: [], conversaId: "c1", semAgente: false }; },
  repetirTrabalho: async () => ({ ok: true }), cancelarTrabalho: async () => ({ ok: true }), recadoTrabalho: async () => ({ ok: true }),
};
window.__leituras = () => leituras;
window.__mudar = (novo) => {
  estado = novo;
  window.__q.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t1" } });
};
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: () => ({ avatar: "<span>A</span>", nome: "Ada" }),
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, agentes: () => [{ id: "a", nome: "Ada" }] } });
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
  const arq = join(dir, "trabalhos.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("revisão 5 do PR #625: a região de status das Execuções no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod418-"));
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

  it("o mesmo nó persiste e só o texto dele muda, na mudança de estado", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector("#quadro .qd-card")`);
    // A região existe desde a montagem, vazia, antes de qualquer tarefa aberta.
    expect(await avaliar(cdp, `(() => { const r = document.querySelector('#quadro [role="status"][aria-atomic="true"]'); return r ? [r.id, r.textContent] : null; })()`)).toEqual(["qd-trab-anuncio", ""]);
    await avaliar(cdp, `window.__no = document.querySelector('#quadro [role="status"][aria-atomic="true"]')`);
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="t1"]')].find((b) => b.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-trab .qd-trab-atual[data-estado='rodando']")`);
    // A primeira leitura não anuncia; a seção redesenhada não tem região role=status própria.
    expect(await avaliar(cdp, "window.__no.textContent")).toBe("");
    expect(await avaliar(cdp, `document.querySelectorAll('#quadro .qd-trab [role="status"]').length`)).toBe(0);
    // O trabalho falhou: o frame relê e o anúncio entra no MESMO nó.
    await avaliar(cdp, `window.__mudar("falhou")`);
    await ate(`document.querySelector("#quadro .qd-trab-atual[data-estado='falhou']")`);
    await ate(`window.__no.textContent === "Trabalho #1: falhou"`);
    expect(await avaliar(cdp, `window.__no.isConnected && document.getElementById("qd-trab-anuncio") === window.__no`)).toBe(true);
    expect(await avaliar(cdp, `document.querySelectorAll('#quadro [role="status"][aria-atomic="true"]').length`)).toBe(1);
    // A releitura sem mudança de estado (outro frame) e o redesenho (abrir os anteriores) não reescrevem o texto.
    await avaliar(cdp, `window.__no.textContent = "marca"`);
    const antes = await avaliar<number>(cdp, "window.__leituras()");
    await avaliar(cdp, `window.__mudar("falhou")`);
    await ate(`window.__leituras() > ${antes}`);
    await esperar(100);
    expect(await avaliar(cdp, "window.__no.textContent")).toBe("marca");
    expect(await avaliar(cdp, `document.getElementById("qd-trab-anuncio") === window.__no`)).toBe(true);
  }, 60_000);
});
