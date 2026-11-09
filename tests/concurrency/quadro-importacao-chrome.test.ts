import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-422 (PR 1) no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - "Trazer do Linear…" abre o painel; o time pede a prévia (só lê); sem conector, a recusa pede para conectar;
 *  - mais de 500: o painel oferece trazer sem o Backlog, e a prévia volta com o filtro;
 *  - Trazer chama o importar com o filtro; a linha "Trazendo do Linear · N de M" se relê sozinha até o resultado;
 *  - no quadro que veio do Linear, a coluna sem responsável começa recolhida (decisão 5).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-422: o CI precisa do Chrome para provar o quadro (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
const agora = 1_700_000_000_000;
const chamadas = [];
const previa = { total: 2, precisamDeVoce: 0, semColuna: [], colunas: [
  { coluna: "fazendo", nome: "Implementando", estado: "Implementando", tarefas: 1, responsavel: "Faustino" },
  { coluna: "backlog", nome: "Backlog", estado: "Backlog", tarefas: 1, responsavel: null },
] };
const colunas = [
  { id: "backlog", nome: "Backlog", grupo: "nao_iniciado", fixa: true, daPessoa: false, recolhida: false, responsavel: null },
  { id: "fazendo", nome: "Implementando", grupo: "iniciado", fixa: true, daPessoa: false, recolhida: false, responsavel: "x", responsavelNome: "Faustino" },
  { id: "feito", nome: "Feito", grupo: "feito", fixa: true, daPessoa: false, recolhida: true, responsavel: null },
];
const tarefa = (id, status) => ({ id, quadroId: "q1", titulo: id, descricao: "", status, voltarPara: null, agenteId: null, ordem: 1, linearId: id, linearUrl: null, prUrl: null,
  pergunta: null, resposta: null, deFora: true, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null, execucao: null, agenteNome: null, numero: 1, codigo: id, branch: "" });
const imp = (o) => ({ id: "i1", quadroId: "q1", time: "NOD", filtro: "sem_backlog", estado: "trazendo", total: 2, trazidas: 0, erro: null, loteId: null, colunas: null, criadoEm: agora, atualizadoEm: agora, ...o });
let q = { id: "q1", agenteId: "a", prefixo: null, meta: null, prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora, metaDesde: agora,
  agenteNome: "Ada", colunas, ultimoLote: null, feitas: 0, total: 0, tarefas: [], importacao: null };
let leituras = 0;
window.__previa = "sem_conector";
const api = {
  quadro: async () => {
    leituras++;
    // A importação anda a cada releitura: 1 de 2, depois aplicada com as duas tarefas.
    if (q.importacao?.estado === "trazendo") {
      const n = q.importacao.trazidas + 1;
      q = n >= 2 ? { ...q, importacao: imp({ estado: "aplicada", trazidas: 2, colunas: 2 }), tarefas: [tarefa("NOD-1", "backlog"), tarefa("NOD-2", "fazendo")], total: 2 }
        : { ...q, importacao: imp({ trazidas: n }) };
    }
    return { quadro: structuredClone(q) };
  },
  conversa: async () => ({ mensagens: [] }),
  enviar: async () => ({ ok: true }),
  responderTarefa: async () => ({ ok: true, quadro: q, lote: null, desfeito: false }),
  desfazerLoteQuadro: async () => ({ ok: true, quadro: q, lote: null, desfeito: true }),
  criarQuadro: async () => ({ ok: true, quadro: q, lote: null, desfeito: false }),
  editarQuadro: async () => ({ ok: true, quadro: q, lote: null, desfeito: false }),
  removerQuadro: async () => ({ ok: true, quadro: null, lote: null, desfeito: false }),
  previaImportacao: async (a, time, filtro) => {
    chamadas.push(["previa", time, filtro]);
    if (window.__previa === "sem_conector") return { ok: false, erro: "sem_conector", detalhe: "x" };
    if (window.__previa === "demais" && !filtro) return { ok: false, erro: "demais", detalhe: "x" };
    return { ok: true, time, filtro, anfitriaoNome: "Ada", previa };
  },
  importarTimeLinear: async (a, time, filtro) => {
    chamadas.push(["importar", time, filtro]);
    q = { ...q, importacao: imp({ filtro }) };
    return { ok: true, importacao: q.importacao };
  },
};
window.__chamadas = chamadas;
window.__leituras = () => leituras;
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: () => null, hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, releImportacaoEm: 50 } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "importacao.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-422 no Chrome real: Trazer do Linear pela tela", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod422-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9800 + (process.pid % 150), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const texto = (sel: string) => avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)})?.textContent ?? ""`);
  const chamadas = () => avaliar<unknown[][]>(cdp, "window.__chamadas");
  const clicar = (sel: string) => avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).click()`);
  const pedirPrevia = async (time: string) => {
    await avaliar(cdp, `document.querySelector("#ci-time-in").value = ${JSON.stringify(time)}`);
    await avaliar(cdp, `document.querySelector('#quadro [data-form="importar-previa"]').requestSubmit()`);
  };

  it("sem conector recusa; mais de 500 oferece sem o Backlog; Trazer mostra o progresso até o resultado", async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, "window.__montar()");
    await ate(`document.querySelector('#quadro [data-act="trazer-linear"]')`);

    // Abre o painel com o foco no time; sem conector, a recusa pede para conectar e nada é importado.
    await clicar('#quadro [data-act="trazer-linear"]');
    await ate(`document.activeElement?.id === "ci-time-in"`);
    await pedirPrevia("nod");
    await ate(`document.querySelector("#quadro .ci-erro")`);
    expect(await texto("#quadro .ci-erro")).toContain("Conecte o Linear");
    expect((await chamadas())[0]).toEqual(["previa", "NOD", null]);

    // Mais de 500: a oferta de trazer sem o Backlog pede a prévia com o filtro.
    await avaliar(cdp, `window.__previa = "demais"`);
    await pedirPrevia("NOD");
    await ate(`document.querySelector('#quadro [data-act="importar-sem-backlog"]')`);
    await clicar('#quadro [data-act="importar-sem-backlog"]');
    await ate(`document.querySelector('#quadro [data-act="importar-confirmar"]')`);
    expect(await texto("#quadro .ci-painel")).toContain("Trazer 2 tarefas do Linear (NOD) para o quadro de Ada");
    expect(await texto("#quadro .ci-painel")).toContain("Só o que não está em Backlog.");
    expect((await chamadas()).filter((c) => c[0] === "importar")).toHaveLength(0);

    // Trazer: o importar sai com o filtro; a linha anda sozinha e termina no resultado; o painel fecha.
    await clicar('#quadro [data-act="importar-confirmar"]');
    await ate(`/Trouxe 2 tarefas/.test(document.querySelector("#quadro .qd-meta")?.textContent ?? "")`);
    expect((await chamadas()).filter((c) => c[0] === "importar")).toEqual([["importar", "NOD", "sem_backlog"]]);
    expect(await avaliar<boolean>(cdp, `!document.querySelector("#quadro .ci-painel")`)).toBe(true);
    expect(await texto("#qc-faixa")).toContain("Trazendo do Linear (NOD)");

    // Decisão 5: o Backlog (sem responsável) começa recolhido; Implementando (com responsável) abre.
    expect(await avaliar<boolean>(cdp, `document.querySelector('#quadro .qd-so-largo .qd-col-backlog').classList.contains("qd-col-recolhida")`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.querySelector('#quadro .qd-so-largo .qd-col-fazendo').classList.contains("qd-col-recolhida")`)).toBe(false);

    // Depois de aplicada, a releitura sozinha para.
    const antes = await avaliar<number>(cdp, "window.__leituras()");
    await esperar(300);
    expect(await avaliar<number>(cdp, "window.__leituras()")).toBe(antes);
  }, 60_000);
});
