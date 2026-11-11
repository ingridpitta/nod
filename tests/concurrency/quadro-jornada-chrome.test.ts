import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * NOD-442 no Chrome de verdade, com o CSS e o JS do app e uma API falsa na página (sem servidor):
 *  - o quadro de verdade desenha os cards; abrir uma tarefa mostra o detalhe com o painel lateral;
 *  - ajuste v2 do Gil (protótipo nod-442 @ fbfc5ec): acima de 700 px a caixa de recado segue o eixo e a largura da
 *    coluna da tarefa (o painel é coluna própria à direita); no protótipo, 574/574 a 1440 e 608/608 a 1508. Abaixo de
 *    700, nada muda: o painel desce para baixo da tarefa e a caixa ocupa a largura;
 *  - a conversa no quadro: enviar → "Mexendo no quadro…" → a resposta do bot com Desfazer → desfazer;
 *  - o frame `quadro.mudou` acende o card que mudou (ao vivo, sem trocar de tela).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
// No job do CI que instala o Chromium (NOD_QA_EXIGE_CHROME=1) a falta é erro, não pulo silencioso.
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("NOD-442: o CI precisa do Chrome para provar o quadro (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { COLUNAS_PADRAO, colunasDto } from "./src/domain/colunas.ts";
const agora = 1_700_000_000_000;
const tarefa = (id, titulo, status, extra = {}) => ({ id, quadroId: "q1", titulo, descricao: "Descrição de " + titulo, status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "Ada", ...extra });
const base = () => ({ id: "q1", agenteId: "a", meta: "Lançar a jornada do quadro", prazo: "2026-11-06", cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 1, total: 4, colunas: colunasDto(COLUNAS_PADRAO), tarefas: [
    tarefa("t1", "Escrever o executor das ações", "fazendo", { execucao: "rodando" }),
    tarefa("t2", "Trocar o token do Linear", "revisao", { pergunta: "Qual workspace do Linear?", voltarPara: "revisao", esperaPessoa: true }),
    tarefa("t3", "Abrir o PR da tela", "revisao", { prUrl: "https://github.com/gamefik/nod/pull/612", linearId: "NOD-442", linearUrl: "https://linear.app/x/NOD-442" }),
    tarefa("t4", "Plano da jornada", "feito"),
  ] });
let q = base();
const fala = (id, autor, texto) => ({ tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: agora,
  autoria: autor === "eu" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" } });
let mensagens = [];
const chamadas = [];
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  conversa: async () => ({ mensagens: structuredClone(mensagens) }),
  enviar: async (c, texto) => { chamadas.push(["enviar", texto]); mensagens.push(fala("m" + mensagens.length, "eu", texto)); return { ok: true, ids: { mensagem: "m" + (mensagens.length - 1) } }; },
  responderTarefa: async (a, id, resposta) => {
    chamadas.push(["responder", id, resposta]);
    // Como o servidor (NOD-420, voltarPara): a tarefa que esperava a pessoa volta à coluna de antes, com a resposta.
    const volta = q.tarefas.find((t) => t.id === id)?.voltarPara;
    if (volta) q = { ...q, tarefas: q.tarefas.map((t) => t.id === id ? { ...t, status: volta, resposta, mudadoEm: agora + 9 } : t) };
    return { ok: true, quadro: structuredClone(q), lote: null, desfeito: false };
  },
  // NOD-417: o card que muda de coluna (o mesmo mudar_tarefa da pessoa e do agente).
  mudarTarefa: async (a, id, campos) => { chamadas.push(["mudar", id, campos]); q = { ...q, tarefas: q.tarefas.map((t) => t.id === id ? { ...t, status: campos.status } : t) }; return { ok: true, quadro: q, lote: null, comecaram: [], desfeito: false }; },
  definirPassagem: async (a, id, p) => { chamadas.push(["passagem", id, p]); q = { ...q, colunas: q.colunas.map((c) => c.id === id ? { ...c, responsavel: p.agente, instrucoes: p.instrucoes } : c) }; return { ok: true, quadro: structuredClone(q), lote: null, desfeito: false }; },
  // NOD-420 (QA do PR #624): o prazo da coluna, como o servidor (o quadro volta com o prazoMin novo).
  prazoDaColuna: async (a, id, min) => { chamadas.push(["prazo", id, min]); q = { ...q, colunas: q.colunas.map((c) => c.id === id ? { ...c, prazoMin: min } : c) }; return { ok: true, quadro: structuredClone(q), lote: null, desfeito: false }; },
  desfazerLoteQuadro: async (a, lote) => { chamadas.push(["desfazer", lote]); q = { ...q, tarefas: q.tarefas.filter((t) => t.id !== "t5"), ultimoLote: null }; return { ok: true, quadro: q, lote: null, desfeito: true }; },
};
window.__chamadas = chamadas;
/** O bot "responde": cria uma tarefa (lote L1), fala na conversa e manda os frames, como o servidor. */
window.__botResponde = () => {
  q = { ...q, tarefas: [...q.tarefas, tarefa("t5", "Gravar o vídeo do roteiro", "afazer")],
    ultimoLote: { id: "L1", quadroId: "q1", autor: { tipo: "agente", agenteId: "a" }, resumo: "criou 1 tarefa", tarefaIds: ["t5"], desfeitoEm: null, criadoEm: agora } };
  mensagens.push(fala("m" + mensagens.length, "bot", "Pus **Gravar o vídeo** em A fazer."));
  window.__q.aoFrame({ streamId: "s", seq: 1, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L1", tarefas: "t5" } });
  window.__q.aoFrame({ streamId: "s", seq: 2, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/** O bot fala antes de mexer no quadro (uma fala intermediária do mesmo turno, sem lote). */
window.__botFalaAntes = () => {
  mensagens.push(fala("m" + mensagens.length, "bot", "Vou olhar o quadro."));
  window.__q.aoFrame({ streamId: "s", seq: 0, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/**
 * O aviso do quadro (NOD-420): fala confiável do bot com payload aviso_pessoa, como o servidor grava. A página é um
 * file:// com a api falsa: a geração pelo servidor (texto, confiança, autoria, payload) está provada em
 * tests/integration/quadro.test.ts; aqui só a tela (revisão 3 do PR #624, achado 3).
 */
window.__botAvisa = () => {
  mensagens.push({ ...fala("m" + mensagens.length, "bot", "Preciso de você no quadro, em NOD-9, Ada: a pergunta está no quadro"), payload: { kind: "aviso_pessoa" } });
  window.__q.aoFrame({ streamId: "s", seq: 3, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/** O frame que o servidor manda depois de mudar uma coluna (a tela relê o quadro e redesenha). */
window.__colunaMudou = (seq) => window.__q.aoFrame({ streamId: "s", seq, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "" } });
/** Outro aparelho (ou outro bot) mudou uma tarefa: só o frame chega. */
window.__mudouLa = () => {
  q = { ...q, tarefas: q.tarefas.map((t) => t.id === "t1" ? { ...t, status: "revisao", mudadoEm: agora + 5 } : t) };
  window.__q.aoFrame({ streamId: "s", seq: 3, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L2", tarefas: "t1" } });
};
/** NOD-419: Em revisão só sai para Feito, e a tela tem os agentes (o "Mover para…" do card). */
window.__comTrava = () => { q = { ...q, colunas: colunasDto(COLUNAS_PADRAO).map((c) => c.id === "revisao" ? { ...c, trava: { saiPara: ["feito"] } } : { ...c }) }; };
/** NOD-417: Fazendo com responsável (o Caio): mover para lá pede confirmação. */
window.__comPassagem = () => {
  q = { ...q, colunas: colunasDto(COLUNAS_PADRAO).map((c) => c.id === "fazendo" ? { ...c, responsavel: "c", responsavelNome: "Caio" } : { ...c }) };
};
/**
 * ADR-162: a pergunta do bot (a marca esperaPessoa) se responde na tarefa; o Responder no card (NOD-420) ficou só em
 * Bloqueado com pergunta. t2 travada em Bloqueado (com a mesma pergunta e voltarPara) para os testes do Responder.
 */
window.__bloqueada = () => { q = { ...q, tarefas: q.tarefas.map((t) => t.id === "t2" ? { ...t, status: "bloqueado", esperaPessoa: false } : t) }; };
window.__arrastes = 0;
// Só o arraste do card (o alvo é o li); arrastar um texto já selecionado no campo é do navegador.
document.addEventListener("dragstart", (e) => { if (e.target instanceof HTMLLIElement) window.__arrastes++; }, true);
/** O quadro que edita (ADR-142): com os agentes e a passagem, os cards são arrastáveis (li draggable="true"). */
window.__montar = (edita = false) => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const ad = '<span class="avatar">A</span>';
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => id === "a" ? { avatar: ad, nome: "Ada" } : null,
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10, ...(edita ? { agentes: () => [{ id: "a", nome: "Ada" }, { id: "c", nome: "Caio" }] } : {}) } });
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
  const arq = join(dir, "jornada.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("NOD-442 no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod442-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9000 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };

  async function abrir(largura: number, edita = false, passagem = false, bloqueada = false): Promise<void> {
    const celular = largura < 700;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: celular, maxTouchPoints: celular ? 5 : 1 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [
      { name: "prefers-reduced-motion", value: "reduce" },
      { name: "hover", value: celular ? "none" : "hover" }, { name: "pointer", value: celular ? "coarse" : "fine" },
    ] });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    if (passagem) await avaliar(cdp, "window.__comPassagem()");
    if (bloqueada) await avaliar(cdp, "window.__bloqueada()");
    await avaliar(cdp, `window.__montar(${edita})`);
    // ADA-18: no celular o quadro abre na Lista (sem .qd-card); o que vale é a tarefa clicável à vista.
    await ate(celular ? `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"]')].some((b) => b.offsetParent)` : `document.querySelector("#quadro .qd-card")`);
  }

  const abrirTarefa = async (id: string) => {
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="${id}"]')].find((b) => b.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-tarefa")`);
  };

  type Eixos = { caixa: { x: number; w: number }; coluna: { x: number; w: number }; lado: { x: number; y: number; w: number }; colunaFim: number; vista: number; rolagem: number };
  const eixos = () => avaliar<Eixos>(cdp, `(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const p = r("#quadro .qc-pil"), c = r("#quadro .qd-t-principal"), l = r("#quadro .qd-lado");
    return { caixa: { x: (p.left + p.right) / 2, w: p.width }, coluna: { x: (c.left + c.right) / 2, w: c.width }, lado: { x: l.left, y: l.top, w: l.width },
      colunaFim: c.bottom, vista: ((v, cs) => v.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))(document.querySelector("#quadro"), getComputedStyle(document.querySelector("#quadro"))), rolagem: document.getElementById("quadro").scrollWidth - document.getElementById("quadro").clientWidth };
  })()`);

  it("o quadro de verdade: os cards nas colunas, o código, a pergunta no card de Você e o PR como etiqueta", async () => {
    await abrir(1440);
    const r = await avaliar<{ cards: number; voce: string; pr: string; meta: string }>(cdp, `(() => ({
      cards: document.querySelectorAll("#quadro .qd-so-largo .qd-card").length,
      voce: document.querySelector('#quadro .qd-so-largo [data-id="t2"]').closest(".qd-card").textContent,
      pr: document.querySelector('#quadro .qd-so-largo [data-id="t3"]').closest(".qd-card").textContent,
      meta: document.querySelector("#quadro .qd-conteudo").textContent }))()`);
    expect(r.cards).toBe(4);
    // ADR-162: o card que espera a pessoa fica na coluna dele; 2026-11-10: com o chip com sino (a pergunta está na tarefa).
    expect(r.voce).toContain("Esperando você responder");
    expect(r.pr).toContain("PR #612");
    expect(r.pr).toContain("NOD-442");
    expect(r.meta).toContain("até 6 nov");
  });

  // O corte é a largura de conteúdo da vista do quadro (container query), não a da janela: em 768 e 1024 a barra lateral deixa a vista
  // com 700px ou menos, e vale o layout estreito (revisão rodada 5: o tablet também é medido).
  for (const largura of [768, 1024]) {
    it(`ajuste v2 do Gil · ${largura}px de janela: com a vista de 700px ou menos, nada muda (o painel desce, a caixa no eixo)`, async () => {
      await abrir(largura);
      await abrirTarefa("t3");
      const e = await eixos();
      process.stdout.write(`[NOD-442] ${largura}px: vista ${e.vista}px\n`);
      if (e.vista > 700) {
        expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(e.caixa.w - e.coluna.w)).toBeLessThanOrEqual(1);
        expect(e.lado.x).toBeGreaterThan(e.coluna.x + e.coluna.w / 2);
      } else {
        expect(e.lado.y).toBeGreaterThanOrEqual(e.colunaFim - 1);
        expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
        expect(e.caixa.w).toBeLessThanOrEqual(641);
      }
      expect(e.rolagem).toBeLessThanOrEqual(0);
    });
  }

  for (const largura of [1440, 1508, 1920, 2560]) {
    it(`ajuste v2 do Gil · ${largura}px: no detalhe com painel, a caixa de recado tem o eixo e a largura da coluna da tarefa; o painel é coluna à direita`, async () => {
      await abrir(largura);
      await abrirTarefa("t3");
      const e = await eixos();
      process.stdout.write(`[NOD-442] ${largura}px: eixo da caixa ${e.caixa.x.toFixed(1)} / eixo da coluna ${e.coluna.x.toFixed(1)}; larguras ${e.caixa.w.toFixed(1)} / ${e.coluna.w.toFixed(1)}\n`);
      expect(Math.abs(e.caixa.x - e.coluna.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(e.caixa.w - e.coluna.w)).toBeLessThanOrEqual(1);
      expect(e.lado.x).toBeGreaterThan(e.coluna.x + e.coluna.w / 2);
      expect(e.rolagem).toBeLessThanOrEqual(0);
    });
  }

  it("ADA-17 · 390px (celular): a tarefa usa a largura toda, sem o painel do lado; o composer da tarefa fica com a largura da tela", async () => {
    await abrir(390);
    await abrirTarefa("t3");
    const e = await avaliar<{ lado: boolean; bandeja: boolean; coluna: { x: number; w: number }; composer: { x: number; w: number }; pilula: boolean; rolagem: number }>(cdp, `(() => {
      const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: (b.left + b.right) / 2, w: b.width }; };
      const q = document.getElementById("quadro");
      return { lado: !!document.querySelector("#quadro .qd-lado"), bandeja: !!document.querySelector("#quadro .qd-tarefa-cel .qd-bandeja"),
        coluna: r("#quadro .qd-t-principal"), composer: r("#quadro .qd-cel-composer"),
        pilula: [...document.querySelectorAll("#quadro .qc-pil")].some((p) => p.offsetParent), rolagem: q.scrollWidth - q.clientWidth };
    })()`);
    expect(e.lado, "as propriedades vão para a folha, não para um painel").toBe(false);
    expect(e.bandeja).toBe(true);
    expect(e.coluna.w).toBeGreaterThan(340);
    expect(Math.abs(e.coluna.x - 195)).toBeLessThanOrEqual(2);
    expect(e.composer.w).toBeGreaterThan(370);
    expect(e.pilula, "com a tarefa aberta, o composer é o da tarefa").toBe(false);
    expect(e.rolagem).toBeLessThanOrEqual(0);
  });

  it("2026-11-10 · Mover para… uma coluna com responsável abre o diálogo de handoff; Mover para move e aciona", async () => {
    await abrir(1440, true, true);
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="tarefa-mover"][data-tarefa="t3"]')].find((b) => b.offsetParent).click()`);
    await ate(`[...document.querySelectorAll('#quadro [data-act="tarefa-mover-para"][data-coluna="fazendo"]')].some((b) => b.offsetParent)`);
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="tarefa-mover-para"][data-coluna="fazendo"]')].find((b) => b.offsetParent).click()`);
    // O diálogo do Multica: o título e quem pega; nada muda até Mover para.
    await ate(`document.querySelector("dialog#qd-handoff[open]")`);
    expect(await avaliar<string>(cdp, `document.querySelector("#qd-ho-titulo").textContent`)).toMatch(/^Mover .+ para Fazendo\?$/);
    expect(await avaliar(cdp, "window.__chamadas.filter((c) => c[0] === 'mudar')")).toEqual([]);
    await avaliar(cdp, `document.querySelector("#qd-handoff [data-ho='mover']").click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "mudar")`);
    expect(await avaliar(cdp, "window.__chamadas.filter((c) => c[0] === 'mudar')")).toEqual([["mudar", "t3", { status: "fazendo" }]]);
    expect(await avaliar<boolean>(cdp, `!document.querySelector('#quadro [data-act="col-soltar"], #quadro [data-act="col-soltar-sem"]')`)).toBe(true);
  });

  it("a resposta da tarefa em Você sai pela rota de responder, com o texto da pessoa", async () => {
    await abrir(1440);
    await abrirTarefa("t2");
    await avaliar(cdp, `(() => { const t = document.querySelector("#quadro .qd-resp-in"); t.value = "O do EngApp"; t.form.requestSubmit(); })()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    expect(await avaliar(cdp, "window.__chamadas.find((c) => c[0] === 'responder')")).toEqual(["responder", "t2", "O do EngApp"]);
  });

  /** Mouse e teclado de verdade (Input.*), não el.click(): é o que mostra se o draggable do card rouba o gesto. */
  const mouse = async (tipo: "mousePressed" | "mouseMoved" | "mouseReleased", x: number, y: number, cliques = 1) => {
    // O ponteiro chega ao ponto antes de apertar, como a mão (o hover do campo vem antes do clique).
    if (tipo === "mousePressed") await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await cdp.enviar("Input.dispatchMouseEvent", { type: tipo, x, y, button: "left", buttons: tipo === "mouseReleased" ? 0 : 1, clickCount: cliques });
  };
  const tecla = async (key: string, code: string, vk: number) => {
    await cdp.enviar("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    if (key === "Enter") await cdp.enviar("Input.dispatchKeyEvent", { type: "char", key, code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: vk });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  };

  it("NOD-420 · o botão Enviar do Responder diz de qual tarefa é (o título escapado)", async () => {
    await abrir(1440, true, false, true);
    expect(await avaliar<string | null>(cdp, `document.querySelector('#quadro .qd-so-largo li.qd-card[data-tarefa="t2"] .qd-card-resp-bt').getAttribute("aria-label")`))
      .toBe("Enviar resposta: Trocar o token do Linear");
  });

  it("NOD-420 · responder no card com Enter: no li arrastável o campo deixa digitar e selecionar; a tarefa volta à coluna de antes e o recibo aparece", async () => {
    await abrir(1440, true, false, true);
    const campo = '#quadro .qd-so-largo li.qd-card[data-tarefa="t2"] .qd-card-resp-in';
    const r0 = await avaliar<{ arrastavel: string | null; x: number; y: number; w: number; h: number }>(cdp, `(() => {
      const t = document.querySelector('${campo}'); t.scrollIntoView({ block: "center" }); const b = t.getBoundingClientRect();
      return { arrastavel: t.closest("li").getAttribute("draggable"), x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
    expect(r0.arrastavel).toBe("true");
    const meio = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
    // Clicar no campo foca o campo (não o card) e digitar escreve nele.
    await mouse("mousePressed", meio.x, meio.y);
    await mouse("mouseReleased", meio.x, meio.y);
    expect(await avaliar<string>(cdp, `document.activeElement?.className ?? ""`)).toContain("qd-card-resp-in");
    // Enter com o Responder vazio não envia o formulário (revisão do PR #624, achado 5).
    await avaliar(cdp, `window.__submits = 0; document.addEventListener("submit", () => { window.__submits++; }, true)`);
    await tecla("Enter", "Enter", 13);
    expect(await avaliar<number>(cdp, "window.__submits")).toBe(0);
    expect(await avaliar<string>(cdp, `document.querySelector('${campo}').value`)).toBe("");
    await cdp.enviar("Input.insertText", { text: "Pode publicar sim" });
    expect(await avaliar<string>(cdp, `document.querySelector('${campo}').value`)).toBe("Pode publicar sim");
    // Apertar na borda de dentro do campo (o padding, ainda é o textarea) e arrastar: não pega o card. Sem a
    // correção em quadro-na-tela.ts (o li perde o draggable com o ponteiro ou o foco no campo), aqui saía um dragstart.
    await mouse("mousePressed", r0.x + 3, r0.y + 5);
    for (const f of [0.25, 0.5, 0.75, 1]) await mouse("mouseMoved", r0.x + 3 + 60 * f, r0.y + 5 + 20 * f);
    await mouse("mouseReleased", r0.x + 63, r0.y + 25);
    expect(await avaliar<number>(cdp, "window.__arrastes")).toBe(0);
    await avaliar(cdp, `document.querySelector('${campo}').setSelectionRange(17, 17)`);
    // Selecionar com o mouse (apertar antes do texto, arrastar até o fim): seleciona o texto, não arrasta o card.
    const y = r0.y + 20, fimX = r0.x + r0.w - 16;
    await mouse("mousePressed", r0.x + 13, y);
    for (const f of [0.25, 0.5, 0.75, 1]) await mouse("mouseMoved", r0.x + 13 + (fimX - r0.x - 13) * f, y + (r0.h - 30) * f);
    await mouse("mouseReleased", fimX, r0.y + r0.h - 10);
    const sel = await avaliar<{ ini: number; fim: number; arrastes: number; foco: string }>(cdp, `(() => { const t = document.querySelector('${campo}');
      return { ini: t.selectionStart, fim: t.selectionEnd, arrastes: window.__arrastes, foco: document.activeElement?.className ?? "" }; })()`);
    process.stdout.write(`[NOD-420] seleção ${sel.ini}..${sel.fim}, dragstart ${sel.arrastes}\n`);
    expect(sel.arrastes).toBe(0);
    expect(sel.foco).toContain("qd-card-resp-in");
    expect(sel.fim - sel.ini).toBeGreaterThan(5);
    // Fora do campo (o ponteiro e o foco), o card volta a arrastar; de volta nele, o texto ficou.
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, button: "none", buttons: 0 });
    await avaliar(cdp, `document.activeElement.blur()`);
    expect(await avaliar<string | null>(cdp, `document.querySelector('${campo}').closest("li").getAttribute("draggable")`)).toBe("true");
    await mouse("mousePressed", meio.x, meio.y);
    await mouse("mouseReleased", meio.x, meio.y);
    expect(await avaliar<string>(cdp, `document.querySelector('${campo}').value`)).toBe("Pode publicar sim");
    // O fim do campo e Enter (a tecla de verdade): a resposta sai, a tarefa volta para Em revisão e o recibo diz isso.
    await tecla("End", "End", 35);
    await tecla("Enter", "Enter", 13);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    expect(await avaliar(cdp, "window.__chamadas.find((c) => c[0] === 'responder')")).toEqual(["responder", "t2", "Pode publicar sim"]);
    await ate(`document.querySelector('#quadro .qd-so-largo [data-id="t2"]')?.closest('.qd-col')?.textContent.includes("Em revisão")`);
    await ate(`document.getElementById("qc-faixa")?.textContent.includes("Voltou para Em revisão")`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa").textContent`)).toContain("Voltou para Em revisão · Ada segue");
    // Sem a pergunta, o card saiu da espera: nada do campo Responder nele.
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('${campo}')`)).toBe(false);
    expect(await avaliar<string | null>(cdp, `document.querySelector('#quadro .qd-so-largo li.qd-card[data-tarefa="t2"]').getAttribute("draggable")`)).toBe("true");
  });

  it("NOD-420 · o popover do prazo: o foco entra no campo ao abrir e volta ao ⋯ da coluna ao fechar (Esc e Cancelar)", async () => {
    await abrir(1440, true);
    const menu = `#quadro .qd-so-largo [data-act="col-menu"][data-coluna="revisao"]`;
    const abrirPrazo = async () => {
      await avaliar(cdp, `document.querySelector('${menu}').click()`);
      await ate(`document.querySelector('#qd-menu [data-act="col-prazo"][data-coluna="revisao"]')`);
      await avaliar(cdp, `document.querySelector('#qd-menu [data-act="col-prazo"][data-coluna="revisao"]').click()`);
      await ate(`document.activeElement?.id === "qd-prz-valor"`);
    };
    const focoNoMenu = `document.activeElement === document.querySelector('${menu}')`;
    await abrirPrazo();
    await tecla("Escape", "Escape", 27);
    await ate(`!document.querySelector(".qd-pop-prazo")`);
    expect(await avaliar<boolean>(cdp, focoNoMenu)).toBe(true);
    await abrirPrazo();
    await avaliar(cdp, `document.querySelector('.qd-pop-prazo [data-act="col-fechar"]').click()`);
    await ate(`!document.querySelector(".qd-pop-prazo")`);
    expect(await avaliar<boolean>(cdp, focoNoMenu)).toBe(true);
  });

  it("NOD-420 (QA do PR #624) · Salvar no editor de colunas devolve o foco ao controle que abriu (prazo → ⋯ da coluna; passagem → Passar para…), nunca ao body", async () => {
    await abrir(1440, true);
    const menu = `#quadro .qd-so-largo [data-act="col-menu"][data-coluna="revisao"]`;
    await avaliar(cdp, `document.querySelector('${menu}').click()`);
    await ate(`document.querySelector('#qd-menu [data-act="col-prazo"][data-coluna="revisao"]')`);
    await avaliar(cdp, `document.querySelector('#qd-menu [data-act="col-prazo"][data-coluna="revisao"]').click()`);
    await ate(`document.activeElement?.id === "qd-prz-valor"`);
    await avaliar(cdp, `(() => { document.getElementById("qd-prz-valor").value = "2"; document.getElementById("qd-prz-unidade").value = "h"; })()`);
    await avaliar(cdp, `document.querySelector('.qd-pop-prazo [type="submit"]').click()`);
    await ate(`!document.querySelector(".qd-pop-prazo") && document.getElementById("qc-faixa")?.textContent.includes("prazo de")`);
    // O servidor manda o quadro.mudou da própria mudança: a tela relê e redesenha. O foco tem de seguir no ⋯.
    await avaliar(cdp, "window.__colunaMudou(7)");
    await new Promise((r) => setTimeout(r, 150));
    const foco = `({ tag: document.activeElement?.tagName, act: document.activeElement?.dataset?.act, col: document.activeElement?.dataset?.coluna })`;
    expect(await avaliar(cdp, foco)).toEqual({ tag: "BUTTON", act: "col-menu", col: "revisao" });
    expect(await avaliar<boolean>(cdp, `document.activeElement === document.querySelector('${menu}')`)).toBe(true);
    const passa = `#quadro .qd-so-largo [data-act="col-passagem"][data-coluna="revisao"]`;
    await avaliar(cdp, `document.querySelector('${passa}').click()`);
    await ate(`document.querySelector(".qd-pop-passa textarea[name=instrucoes]")`);
    await avaliar(cdp, `document.querySelector(".qd-pop-passa textarea[name=instrucoes]").value = "Confira o PR antes de mover."`);
    await avaliar(cdp, `document.querySelector('.qd-pop-passa [type="submit"]').click()`);
    await ate(`!document.querySelector(".qd-pop-passa") && window.__chamadas.some((c) => c[0] === "passagem")`);
    await avaliar(cdp, "window.__colunaMudou(8)");
    await new Promise((r) => setTimeout(r, 150));
    expect(await avaliar(cdp, foco)).toEqual({ tag: "BUTTON", act: "col-passagem", col: "revisao" });
  });

  it("conversa no quadro: enviar → Mexendo no quadro… → a resposta do bot com Desfazer; o card novo acende; Desfazer tira", async () => {
    await abrir(1440);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "Põe gravar o vídeo em A fazer"; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
    await ate(`document.querySelector("#quadro .qc-aguarda")`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa").textContent`)).toContain("Mexendo no quadro");
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("");
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.querySelector("#quadro .qc-ok")`);
    const r = await avaliar<{ faixa: string; brilho: boolean; desfazer: boolean }>(cdp, `({ faixa: document.getElementById("qc-faixa").textContent,
      brilho: !!document.querySelector('#quadro .qd-so-largo [data-id="t5"]')?.closest(".qd-brilho"),
      desfazer: !!document.querySelector('#quadro [data-act="qc-desfazer"][data-id="L1"]') })`);
    expect(r.faixa).toContain("Pus Gravar o vídeo em A fazer.");
    expect(r.brilho).toBe(true);
    expect(r.desfazer).toBe(true);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="qc-desfazer"]').click()`);
    await ate(`!document.querySelector('#quadro .qd-so-largo [data-id="t5"]')`);
    expect(await avaliar(cdp, "window.__chamadas.find((c) => c[0] === 'desfazer')")).toEqual(["desfazer", "L1"]);
  });

  it("conversa no quadro: depois de uma fala intermediária do bot, a fala final ainda sobe na faixa com o Desfazer (codex rodada 6)", async () => {
    await abrir(1440);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "Põe gravar o vídeo em A fazer"; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
    await ate(`document.querySelector("#quadro .qc-aguarda")`);
    await avaliar(cdp, "window.__botFalaAntes()");
    await ate(`document.getElementById("qc-faixa").textContent.includes("Vou olhar o quadro.")`);
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pus Gravar o vídeo em A fazer.")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro [data-act="qc-desfazer"][data-id="L1"]')`)).toBe(true);
  });

  it("o aviso do quadro (payload aviso_pessoa) aparece como fala comum do bot, sem a tag de não confiável (revisão do PR #624)", async () => {
    await abrir(1440);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "Como está o quadro?"; t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-historico"]')`);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-historico"]').click()`);
    await avaliar(cdp, "window.__botAvisa()");
    await ate(`[...document.querySelectorAll("#qc-hist .qc-h-bot")].some((li) => li.textContent.includes("a pergunta está no quadro"))`);
    const r = await avaliar<{ faixa: string; tags: number }>(cdp, `({ faixa: document.getElementById("qc-faixa").textContent, tags: document.querySelectorAll("#qc-faixa .tag").length })`);
    expect(r.faixa).toContain("Preciso de você no quadro");
    expect(r.faixa).not.toContain("não confiável");
    expect(r.tags).toBe(0);
  });

  it("ao vivo: o frame quadro.mudou de outro aparelho move o card e o acende, sem trocar de tela", async () => {
    await abrir(1440);
    await avaliar(cdp, "window.__mudouLa()");
    await ate(`document.querySelector('#quadro .qd-so-largo [data-id="t1"]')?.closest(".qd-brilho")`);
    const col = await avaliar<string>(cdp, `document.querySelector('#quadro .qd-so-largo [data-id="t1"]').closest(".qd-col").textContent`);
    expect(col).toContain("Em revisão");
  });

  it("revisão 2 do PR #629 (a11y): a recusa da trava não some com o foco nela; o Esc a tira e o foco volta ao card", async () => {
    await abrir(1440, true);
    await avaliar(cdp, "window.__comTrava()");
    await avaliar(cdp, `window.__q.aoFrame({ streamId: "s", seq: 9, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L9", tarefas: "t3" } })`);
    await ate(`document.querySelector('#quadro .qd-so-largo .qd-col-trava')`);
    await avaliar(cdp, `document.querySelector('#quadro .qd-so-largo [data-act="tarefa-mover"][data-tarefa="t3"]').click()`);
    await ate(`document.querySelector('#quadro [data-act="tarefa-mover-para"][data-coluna="fazendo"]')`);
    await avaliar(cdp, `document.querySelector('#quadro [data-act="tarefa-mover-para"][data-coluna="fazendo"]').click()`);
    await ate(`document.activeElement?.matches('[data-act="tarefa-mandar"][data-id="t3"]')`);
    // Mais que os 8 s da recusa: com o foco no "Mandar para…", ela fica.
    await esperar(9000);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qd-so-largo [data-act="tarefa-mandar"][data-id="t3"]')`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.activeElement?.matches('[data-act="tarefa-mandar"]') ?? false`)).toBe(true);
    await avaliar(cdp, `document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await ate(`!document.querySelector('#quadro [data-act="tarefa-mandar"]')`);
    expect(await avaliar<boolean>(cdp, `document.activeElement?.matches('#quadro .qd-so-largo [data-act="abrir-tarefa"][data-id="t3"]') ?? false`)).toBe(true);
    expect(await avaliar(cdp, "window.__chamadas.filter((c) => c[0] === 'mudar')")).toEqual([]);
  }, 30_000);
});
