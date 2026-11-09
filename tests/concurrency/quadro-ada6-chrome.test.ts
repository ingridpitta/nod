import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADA-6 no Chrome de verdade, a 390×844 com toque: as ligações que o teste de HTML não pega (revisão A5). O cartão-
 * mensagem abre com o Ler tudo, sobrevive ao frame sem perder a rolagem nem o foco (B1), mora fora da região viva (B2),
 * fecha com o Esc e com o clique fora (sem puxar o foco, A1). As sugestões somem ao digitar, o contador só aparece a
 * partir de 3500, o Mover do recibo da nova tarefa move, o Desfazer do Responder devolve o texto ao campo (A3) e nenhum
 * card fica sob a pílula (critério 2). Sem Chrome, pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADA-6: o CI precisa do Chrome (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { COLUNAS_PADRAO, colunasDto } from "./src/domain/colunas.ts";
const agora = Date.now();
const tarefa = (id, titulo, status, extra = {}) => ({ id, quadroId: "q1", titulo, descricao: "Descrição", status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "Ada", codigo: "ADA-" + id.slice(1), numero: Number(id.slice(1)), branch: "", ...extra });
const inicial = () => ({ id: "q1", agenteId: "a", prefixo: "ADA", modoConversa: "individual", meta: "Lançar o quadro", prazo: null, cumpridoEm: null, resumo: null,
  criadoEm: agora, atualizadoEm: agora, metaDesde: agora, agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 14, colunas: colunasDto(COLUNAS_PADRAO), tarefas: [
    tarefa("t1", "Trocar o token do Linear", "voce", { pergunta: "Qual workspace?", voltarPara: "revisao" }),
    tarefa("t2", "Destravar o deploy", "bloqueado", { pergunta: "Falta a chave" }),
    ...Array.from({ length: 12 }, (_, i) => tarefa("t" + (i + 3), "Tarefa número " + (i + 3) + " com um título razoável", i % 2 ? "fazendo" : "backlog")),
  ] });
let q = inicial();
let versao = 0;
const fala = (id, autor, texto) => ({ id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, parcial: false, criadoEm: Date.now(),
  autoria: autor === "eu" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" } });
let mensagens = [];
const lote = (id, tarefaIds, autor) => ({ id, quadroId: "q1", autor, resumo: "", tarefaIds, desfeitoEm: null, criadoEm: Date.now() });
let antesDoLote = null;
window.__mudancas = [];
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  quadros: async () => ({ quadros: [] }),
  historicoTarefa: async () => ({ historico: [] }),
  comentariosDaTarefa: async () => ({ comentarios: [], atividade: [], criadaPor: null }),
  trabalhosDaTarefa: async () => ({ execucoes: [], recados: [], conversaId: "c9", semAgente: false }),
  conversa: async () => ({ mensagens: structuredClone(mensagens) }),
  enviar: async (c, texto) => { mensagens.push(fala("m" + mensagens.length, "eu", texto)); return { ok: true, ids: { mensagem: "m" + (mensagens.length - 1) } }; },
  criarTarefa: async (a, campos) => { const t = tarefa("t" + (q.tarefas.length + 1), campos.titulo, "backlog"); q = { ...q, tarefas: [...q.tarefas, t], ultimoLote: lote("LN", [t.id], { tipo: "pessoa" }) };
    return { ok: true, quadro: structuredClone(q), lote: q.ultimoLote, comecaram: [], desfeito: false }; },
  mudarTarefa: async (a, id, campos) => { window.__mudancas.push([id, campos]); q = { ...q, tarefas: q.tarefas.map((t) => t.id === id ? { ...t, ...(campos.status ? { status: campos.status } : {}) } : t), ultimoLote: lote("LM", [id], { tipo: "pessoa" }) };
    return { ok: true, quadro: structuredClone(q), lote: q.ultimoLote, comecaram: [], desfeito: false }; },
  responderTarefa: async (a, id, resposta) => { antesDoLote = structuredClone(q); q = { ...q, tarefas: q.tarefas.map((t) => t.id === id ? { ...t, status: "revisao", pergunta: null, resposta } : t), ultimoLote: lote("LR", [id], { tipo: "pessoa" }) };
    return { ok: true, quadro: structuredClone(q), lote: q.ultimoLote, desfeito: false }; },
  desfazerLoteQuadro: async (a, loteId) => { if (loteId === "LR" && antesDoLote) { q = { ...antesDoLote, ultimoLote: { ...lote("LR", ["t1"], { tipo: "pessoa" }), desfeitoEm: Date.now() } }; antesDoLote = null; }
    return { ok: true, quadro: structuredClone(q), lote: q.ultimoLote, desfeito: true }; },
};
window.__botResponde = () => {
  q = { ...q, ultimoLote: lote("L1", ["t3"], { tipo: "agente", agenteId: "a" }) };
  mensagens.push(fala("m" + mensagens.length, "bot", "Pus **três** tarefas em ordem:\\n\\n- ADA-3 primeiro\\n- ADA-4 depois\\n- ADA-5 no fim\\n\\n" + "Mais contexto para o cartão rolar. ".repeat(60)));
  window.__q.aoFrame({ tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
// Revisão 2 (M3): outra fala do bot no mesmo pedido (o fecho que troca o "Vou olhar").
window.__botFala = (texto) => { mensagens.push(fala("m" + mensagens.length, "bot", texto)); window.__q.aoFrame({ tipo: "mensagem.nova", dados: { conversaId: "c1" } }); };
// Revisão 2 (M2): o bot (ou outro aparelho) leva a tarefa para outra coluna.
window.__levar = (id, status) => { versao++; q = { ...q, atualizadoEm: agora + versao, tarefas: q.tarefas.map((t) => t.id === id ? { ...t, status, mudadoEm: agora + versao } : t) };
  window.__q.aoFrame({ tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: null, tarefas: id } }); };
// Um frame qualquer (o quadro mudou de verdade): a faixa e a vista são desenhadas de novo.
window.__frame = () => { versao++; q = { ...q, atualizadoEm: agora + versao, tarefas: q.tarefas.map((t) => t.id === "t4" ? { ...t, mudadoEm: agora + versao } : t) };
  window.__q.aoFrame({ tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: null, tarefas: "t4" } });
  window.__q.aoFrame({ tipo: "mensagem.nova", dados: { conversaId: "c1" } }); };
window.__montar = (recolherEm = 60_000) => {
  q = inicial(); mensagens = []; window.__mudancas = [];
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => id === "a" ? { avatar: "<span>A</span>", nome: "Ada" } : null,
    agentes: () => [{ id: "a", nome: "Ada" }], hora: () => "10:00", recolherEm, juntarEm: 10 } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
`;

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

descrever("ADA-6: resposta legível, sugestões e recibos (Chrome real, 390×844)", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-ada6-"));
    const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
    let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
    html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
    html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
    writeFileSync(join(dir, "p.html"), html);
    url = pathToFileURL(join(dir, "p.html")).href;
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9650 + (process.pid % 140), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string): Promise<void> => {
    for (let i = 0; i < 100; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr}`);
  };
  const json = async <T>(expr: string): Promise<T> => JSON.parse(await avaliar<string>(cdp, `JSON.stringify(${expr})`)) as T;
  const ativo = (): Promise<string> => avaliar<string>(cdp, `(() => { const a = document.activeElement; return a === document.body ? "body" : (a?.id || a?.dataset?.act || a?.className || a?.tagName || ""); })()`);
  const tecla = async (key: string, code: number): Promise<void> => {
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code });
  };
  /** NOD-460: a tarefa nova nasce pelo "+" da coluna Backlog (o campo abre no lugar dela). */
  const novaTarefa = async (titulo: string): Promise<void> => {
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='col-nova-tarefa'][data-status='backlog']")].find((e) => e.offsetParent).click()`);
    await ate(`[...document.querySelectorAll("#quadro input.qd-nova-in")].some((e) => e.offsetParent)`);
    await avaliar(cdp, `(() => { const i = [...document.querySelectorAll("#quadro input.qd-nova-in")].find((e) => e.offsetParent); i.value = ${JSON.stringify(titulo)}; i.form.requestSubmit(); })()`);
  };
  /** Critério 2: rolado até o fim, o último card termina acima da faixa e da pílula; nada rola na horizontal. */
  const sobreposicao = (): Promise<{ sob: boolean; ultimo: number; topo: number; docX: [number, number]; rola: string[] }> => json(`(() => {
    const v = document.getElementById("quadro"); v.scrollTop = v.scrollHeight;
    const cards = [...document.querySelectorAll("#quadro .qd-conteudo .qd-l, #quadro .qd-conteudo .qd-card, #quadro .qd-conteudo .qd-cl-bt")].filter((e) => e.getClientRects().length);
    const ult = cards.at(-1).getBoundingClientRect().bottom;
    const s = document.getElementById("qc-sobre").getBoundingClientRect(); const p = document.querySelector(".qc-pil").getBoundingClientRect();
    const topo = Math.min(p.top, s.height ? s.top : 1e9);
    // Revisão 2 (M4): o transbordo fica dentro de #quadro (absoluto, overflow auto), não no documento: mede ali e em cada
    // elemento rolável (o cabeçalho, a linha da faixa com as ações). Título com reticências (overflow hidden) não rola.
    const rola = [v, ...v.querySelectorAll("*"), document.getElementById("qc-sobre"), ...document.querySelectorAll("#qc-sobre *")]
      .filter((e) => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && (e === v || !["hidden", "clip"].includes(getComputedStyle(e).overflowX)))
      .map((e) => e.tagName + "." + [...e.classList].join("."));
    return { sob: ult > topo + 1, ultimo: ult, topo, docX: [document.documentElement.scrollWidth, innerWidth], rola };
  })()`);

  beforeAll(async () => {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp.enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }, { name: "pointer", value: "coarse" }] });
  }, 30_000);

  const montar = async (recolherEm?: number): Promise<void> => {
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    await avaliar(cdp, `window.__montar(${recolherEm ?? ""})`);
    await ate(`document.querySelector("#quadro [data-act='abrir-tarefa']")`);
    await esperar(200);
  };

  it("critérios 5 e 6: a pílula vazia mostra até 3 sugestões, que somem ao digitar; o contador só a partir de 3500", async () => {
    await montar();
    const s = await json<{ hidden: boolean; chips: string[] }>(`({ hidden: document.getElementById("qc-ideias").hidden, chips: [...document.querySelectorAll("#qc-ideias .qc-ideia")].map((b) => b.textContent) })`);
    expect(s.hidden).toBe(false);
    expect(s.chips).toEqual(["Responder ADA-1", "Por que ADA-2 travou?", "Resumo do quadro"]);
    await avaliar(cdp, `document.getElementById("qc-txt").focus()`);
    await cdp.enviar("Input.insertText", { text: "a" });
    expect(await avaliar<boolean>(cdp, `document.getElementById("qc-ideias").hidden`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `document.getElementById("qc-conta").hidden`)).toBe(true);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "x".repeat(3499); t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await avaliar<boolean>(cdp, `document.getElementById("qc-conta").hidden`)).toBe(true);
    await cdp.enviar("Input.insertText", { text: "y" });
    expect(await json(`[document.getElementById("qc-conta").hidden, document.getElementById("qc-conta").textContent]`)).toEqual([false, "3.500/4.000"]);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await avaliar<boolean>(cdp, `document.getElementById("qc-ideias").hidden`)).toBe(false);
    // A sugestão de texto só preenche a pílula: nada é enviado.
    await avaliar(cdp, `document.querySelectorAll("#qc-ideias .qc-ideia")[2].click()`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toContain("resumo do quadro");
    expect(await avaliar<number>(cdp, `document.querySelectorAll("#qc-faixa .qc-resp").length`)).toBe(0);
  }, 60_000);

  it("critérios 1 e 2: Ler tudo abre o cartão fora da região viva; o frame não perde rolagem nem foco; Esc e clique fora fecham", async () => {
    await montar();
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "organiza o quadro"; t.form.requestSubmit(); })()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Mexendo")`);
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.querySelector('#qc-faixa [data-act="qc-ler"]')`);
    // Revisão 4 (B3): com a faixa à vista, as sugestões somem (a pílula vazia não as mostra por cima da resposta).
    expect(await avaliar<boolean>(cdp, `document.getElementById("qc-ideias").hidden`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-ler"]').getAttribute("aria-controls")`)).toBe(false);
    const fechado = await sobreposicao();
    expect(fechado.sob, `último card ${fechado.ultimo} × topo ${fechado.topo}`).toBe(false);
    expect(fechado.docX[0]).toBeLessThanOrEqual(fechado.docX[1]);
    expect(fechado.rola, "nada rola na horizontal no quadro nem na faixa").toEqual([]);

    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-ler"]').click()`);
    await ate(`document.querySelector("#qc-msg .qc-msg-corpo")`);
    const c = await json<{ vivo: boolean; li: number; strong: number; foco: boolean; acima: boolean }>(`(() => {
      const m = document.getElementById("qc-msg"); const corpo = m.querySelector(".qc-msg-corpo");
      return { vivo: !!m.closest("[aria-live]"), li: m.querySelectorAll("li").length, strong: m.querySelectorAll("strong").length,
        foco: document.activeElement === corpo, acima: m.getBoundingClientRect().bottom <= document.querySelector(".qc-pil").getBoundingClientRect().top };
    })()`);
    expect(c).toEqual({ vivo: false, li: 3, strong: 1, foco: true, acima: true });
    expect(await avaliar<string>(cdp, `document.querySelector('#qc-faixa [data-act="qc-ler"]').textContent`)).toBe("Fechar");
    expect(await avaliar<boolean>(cdp, `!!document.getElementById("quadro")`), "sem trocar de aba").toBe(true);
    const aberto = await sobreposicao();
    expect(aberto.sob, `cartão aberto: último card ${aberto.ultimo} × topo ${aberto.topo}`).toBe(false);
    expect(aberto.rola).toEqual([]);

    // B1: o frame não regrava o cartão (mesmo nó, mesma rolagem, foco no corpo).
    await avaliar(cdp, `(() => { const b = document.querySelector("#qc-msg .qc-msg-corpo"); window.__corpo = b; b.scrollTop = 120; b.focus({ preventScroll: true }); })()`);
    const antes = await avaliar<number>(cdp, `document.querySelector("#qc-msg .qc-msg-corpo").scrollTop`);
    expect(antes, "o cartão precisa rolar para o teste valer").toBeGreaterThan(50);
    await avaliar(cdp, "window.__frame()");
    await esperar(400);
    expect(await json(`(() => { const b = document.querySelector("#qc-msg .qc-msg-corpo"); return [b === window.__corpo, b.scrollTop, document.activeElement === b]; })()`)).toEqual([true, antes, true]);

    // Esc fecha e devolve o foco ao Ler tudo.
    await tecla("Escape", 27);
    await ate(`!document.getElementById("qc-msg")`);
    expect(await ativo()).toBe("qc-ler");

    // Clique fora (no quadro) fecha sem puxar o foco para a faixa (A1).
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-ler"]').click()`);
    await ate(`document.getElementById("qc-msg")`);
    await avaliar(cdp, `(() => { const h = document.querySelector("#quadro .qd-conteudo h1, #quadro .qd-conteudo .qd-meta, #quadro .qd-conteudo"); h.click(); })()`);
    await ate(`!document.getElementById("qc-msg")`);
    expect(await ativo()).not.toBe("qc-ler");
  }, 90_000);

  it("critério 3: o recibo da nova tarefa tem Abrir · Mover para A fazer, e o Mover move", async () => {
    await montar();
    await novaTarefa("Revisar o onboarding");
    await ate(`document.querySelector('#qc-faixa [data-act="qc-mover"]')`);
    const acoes = await json<string[]>(`[...document.querySelectorAll("#qc-faixa .qc-acoes button")].map((b) => b.textContent)`);
    expect(acoes[0]).toBe("Abrir");
    expect(acoes[1]).toMatch(/^Mover para /);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-mover"]').click()`);
    await ate("window.__mudancas.length > 0");
    expect(await json(`window.__mudancas`)).toEqual([["t15", { status: "afazer" }]]);
  }, 60_000);

  it("critério 3: o recibo do Responder tem Desfazer, e desfazer volta a tarefa e devolve o texto ao campo", async () => {
    await montar();
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t1']")].find((e) => e.offsetParent).click()`);
    await ate(`document.querySelector("#quadro form[data-id='t1'] textarea")`);
    await avaliar(cdp, `(() => { const t = document.querySelector("#quadro form[data-id='t1'] textarea"); t.value = "O workspace é o Gamefik"; t.form.requestSubmit(); })()`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-desfazer"][data-id="LR"]')`);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-desfazer"]').click()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Desfeito")`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa").textContent`)).toContain("A resposta voltou ao campo");
    expect(await avaliar<string>(cdp, `document.querySelector("#quadro form[data-form='responder-tarefa'][data-id='t1'] textarea")?.value ?? ""`)).toBe("O workspace é o Gamefik");
    // Revisão 4 (A1): o Comentar e o Recado ao agente usam o mesmo data-id e não recebem a resposta (um Enter a publicaria).
    const outros = await json<string[]>(`[...document.querySelectorAll("#quadro form[data-id='t1']:not([data-form='responder-tarefa']) textarea")].map((t) => t.value)`);
    expect(outros.length, "a tarefa aberta tem outros campos").toBeGreaterThan(0);
    expect(outros.every((v) => v === "")).toBe(true);
  }, 60_000);
  it("revisão 2: o Mover do recibo confere a tarefa agora (a que o bot já levou não volta) e mostra as ações sem rolar", async () => {
    await montar();
    await novaTarefa("Revisar o onboarding");
    await ate(`document.querySelector('#qc-faixa [data-act="qc-mover"]')`);
    expect((await sobreposicao()).rola, "a linha do recibo com as ações não rola").toEqual([]);
    await avaliar(cdp, `window.__levar("t15", "fazendo")`);
    await esperar(300);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-mover"]')?.click()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("nada foi movido")`);
    expect(await json(`window.__mudancas`)).toEqual([]);
  }, 60_000);

  it("revisão 2: fala nova do mesmo pedido durante a leitura mantém foco e rolagem; o fecho curto fecha o cartão e a faixa recolhe", async () => {
    await montar(1500);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "organiza o quadro"; t.form.requestSubmit(); })()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Mexendo")`);
    await avaliar(cdp, "window.__botResponde()");
    await ate(`document.querySelector('#qc-faixa [data-act="qc-ler"]')`);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-ler"]').click()`);
    await ate(`document.querySelector("#qc-msg .qc-msg-corpo")`);
    await avaliar(cdp, `(() => { const b = document.querySelector("#qc-msg .qc-msg-corpo"); b.scrollTop = 100; b.focus({ preventScroll: true }); })()`);
    const antes = await avaliar<number>(cdp, `document.querySelector("#qc-msg .qc-msg-corpo").scrollTop`);
    expect(antes).toBeGreaterThan(50);
    await avaliar(cdp, `window.__botFala("Atualizei: " + "mais uma linha longa do fecho do bot. ".repeat(60))`);
    await ate(`document.querySelector("#qc-msg .qc-msg-corpo")?.textContent.includes("Atualizei")`);
    expect(await json(`(() => { const b = document.querySelector("#qc-msg .qc-msg-corpo"); return [b.scrollTop, document.activeElement === b]; })()`)).toEqual([antes, true]);
    // O fecho curto não tem cartão: quem lia volta à faixa, que recolhe sozinha (lendo não fica preso).
    await avaliar(cdp, `window.__botFala("Pronto.")`);
    await ate(`!document.getElementById("qc-msg")`);
    await ate(`!document.getElementById("qc-faixa").textContent.includes("Pronto")`);
  }, 60_000);
  it("QA 1: o Mover do recibo recusa a tarefa que outro levou para Fazendo, mesmo com o campo da nova tarefa ainda focado", async () => {
    // Com o campo focado a releitura do frame espera (campoComFocoNoToque): o quadro local fica velho. O Mover relê antes.
    await montar();
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='col-nova-tarefa'][data-status='backlog']")].find((e) => e.offsetParent).click()`);
    await ate(`[...document.querySelectorAll("#quadro input.qd-nova-in")].some((e) => e.offsetParent)`);
    await avaliar(cdp, `[...document.querySelectorAll("#quadro input.qd-nova-in")].find((e) => e.offsetParent).focus()`);
    await cdp.enviar("Input.insertText", { text: "Revisar o onboarding" });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await ate(`document.querySelector('#qc-faixa [data-act="qc-mover"]')`);
    expect(await avaliar<boolean>(cdp, `document.activeElement.matches("input.qd-nova-in")`)).toBe(true);
    await avaliar(cdp, `window.__levar("t15", "fazendo")`);
    await esperar(1500);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-mover"]')?.click()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("nada foi movido")`);
    expect(await json(`window.__mudancas`)).toEqual([]);
  }, 60_000);
});
