import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADA-4 no Chrome de verdade (o CSS e o JS do app, a API falsa na página): a pílula do quadro é otimista, à prova de
 * duplo Enter e nunca fica presa. Cobre: o campo vazio na hora (<100 ms) e a fala "Enviando…"; duplo Enter e
 * Enter+clique = 1 POST com a mesma chave; a falha de rede devolve o texto e o Tentar de novo reusa a chave; o status
 * vivo vem do turno.atividade do turno do pedido (o de outro turno é ignorado); a falha do turno = "Parou no meio · Ver
 * na Conversa"; o ■ Parar → "Parado por você."; o card do lote pisca (e, com Reduzir movimento, só contorna).
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADA-4: o CI precisa do Chrome para provar a pílula (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { COLUNAS_PADRAO, colunasDto } from "./src/domain/colunas.ts";
import { frameDaFerramenta } from "./src/domain/rotulo-ferramenta.ts";
import { ErroApi } from "./web/lib/erro-api.ts";
const agora = 1_700_000_000_000;
/**
 * Revisão 6 do #646: o relógio acelerado. Com window.__acelerar, os timers de 20 s a 100 s (o silêncio de 90 s, a
 * conferência de 60 s, o prazo de 25 s do envio) disparam em 30 ms e o Date.now() avança o que eles esperariam.
 */
let avanco = 0;
const nowReal = Date.now.bind(Date);
Date.now = () => nowReal() + avanco;
const timerReal = window.setTimeout.bind(window);
window.__acelerar = false;
window.setTimeout = (fn, ms, ...args) => (window.__acelerar && typeof ms === "number" && ms >= 20_000 && ms <= 100_000
  ? timerReal(() => { avanco += ms; fn(...args); }, 30)
  : timerReal(fn, ms, ...args));
const tarefa = (id, titulo, status, extra = {}) => ({ id, quadroId: "q1", titulo, descricao: "", status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "Ada", ...extra });
let q = { id: "q1", agenteId: "a", meta: "Pílula", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 1, colunas: colunasDto(COLUNAS_PADRAO), tarefas: [tarefa("t1", "Uma tarefa", "fazendo")] };
const fala = (id, autor, texto) => ({ tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: agora,
  autoria: autor === "eu" ? { autor_tipo: "pessoa", autor_id: "p" } : { autor_tipo: "agente", autor_id: "a" } });
let mensagens = [];
const chamadas = [];
/** "ok" responde na hora; "segura" espera window.__soltar(); "falha" é a rede caindo. */
window.__modo = "ok";
window.__vivos = [];
let soltar = null;
const quadrosPresos = [];
window.__seguraQuadro = false;
/** Revisão 8: solta só a leitura do quadro mais nova (as leituras terminam fora de ordem). */
window.__soltarQuadroUltimo = () => { quadrosPresos.pop()?.(); };
window.__soltarQuadro = () => { window.__seguraQuadro = false; quadrosPresos.splice(0).forEach((r) => r()); };
window.__soltar = () => { const s = soltar; soltar = null; s?.(); };
const gravadas = new Map();
const api = {
  // Revisão 5: com window.__seguraQuadro, a leitura do quadro espera window.__soltarQuadro().
  quadro: async () => { if (window.__seguraQuadro) await new Promise((r) => { quadrosPresos.push(r); }); return { quadro: structuredClone(q) }; },
  // Os turnos vivos como o servidor manda (turnosEmCurso): vazio = o turno do pedido já acabou.
  conversa: async () => (chamadas.push(["conversa"]), { mensagens: structuredClone(mensagens), turnosEmCurso: window.__vivos.map((id) => ({ id, estado: "despachando", desde: agora, mensagemId: null })), turnosPendentes: [] }),
  enviar: async (c, texto, anexos, idEnvio) => {
    chamadas.push(["enviar", texto, idEnvio]);
    // Revisão 14: o servidor deduplica pela chave (a mesma fala não é gravada duas vezes).
    if (gravadas.has(idEnvio) && window.__modo === "ok") return { ok: true, ids: { mensagem: gravadas.get(idEnvio), turno: "T1" } };
    // Revisão 14: o POST chega (a fala é gravada), mas a resposta cai na volta.
    if (window.__modo === "grava-e-cai") {
      gravadas.set(idEnvio, "m" + mensagens.length);
      mensagens.push(fala("m" + mensagens.length, "eu", texto));
      throw new ErroApi(0, "servidor_indisponivel", "O nod não respondeu.");
    }
    if (window.__modo === "falha") throw new ErroApi(0, "servidor_indisponivel", "O nod não respondeu.");
    if (window.__modo === "segura") await new Promise((r) => { soltar = r; });
    if (window.__modo === "pendura") await new Promise(() => {});
    // Revisão 7: o POST chega ao servidor (a fala é gravada), mas a resposta HTTP nunca volta.
    if (window.__modo === "pendura-grava") {
      const id = "m" + mensagens.length;
      mensagens.push(fala(id, "eu", texto));
      window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1", turnoId: "T1", mensagem_id: id, kind: "texto" } });
      await new Promise(() => {});
    }
    // Revisão 7: a regra do servidor recusa (4xx): tentar o mesmo falha igual.
    if (window.__modo === "recusa") throw new ErroApi(409, "id_envio_reusado", "essa fala já saiu com outro texto.");
    if (window.__modo === "segura-recusa") { await new Promise((r) => { soltar = r; }); throw new ErroApi(409, "id_envio_reusado", "essa fala já saiu com outro texto."); }
    if (window.__modo === "segura-falha") { await new Promise((r) => { soltar = r; }); throw new ErroApi(0, "servidor_indisponivel", "O nod não respondeu."); }
    mensagens.push(fala("m" + mensagens.length, "eu", texto));
    return { ok: true, ids: { mensagem: "m" + (mensagens.length - 1), turno: "T1" } };
  },
  // Revisão 7: mudar uma tarefa na mão (o recibo da ação) com o pedido da pílula em curso.
  mudarTarefa: async () => (chamadas.push(["mudar"]), { quadro: structuredClone(q), lote: null }),
  pararConversa: async (c) => { chamadas.push(["parar", c]); return { nadaRodando: false }; },
};
window.__chamadas = chamadas;
/** O payload do turno.atividade como o servidor manda (emUso é {texto, frentes}). */
window.__ferramenta = (nome) => frameDaFerramenta(nome, "u1");
let seq = 10;
window.__frame = (tipo, dados) => window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo, dados: { conversaId: "c1", turnoId: "T1", ...dados } });
/** O bot cria t5 (lote L1) e responde, como o servidor. */
window.__botResponde = () => {
  q = { ...q, tarefas: [...q.tarefas, tarefa("t5", "Gravar o vídeo", "afazer")],
    ultimoLote: { id: "L1", quadroId: "q1", autor: { tipo: "agente", agenteId: "a" }, resumo: "criou 1 tarefa", tarefaIds: ["t5"], desfeitoEm: null, criadoEm: agora } };
  mensagens.push(fala("m" + mensagens.length, "bot", "Pus Gravar o vídeo em A fazer."));
  window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L1", tarefas: "t5" } });
  window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
/** Revisão 11: o bot cria t5 (lote L1) no meio do turno, ainda sem responder. */
window.__botCria = () => {
  q = { ...q, tarefas: [...q.tarefas, tarefa("t5", "Gravar o vídeo", "afazer")],
    ultimoLote: { id: "L1", quadroId: "q1", autor: { tipo: "agente", agenteId: "a" }, resumo: "criou 1 tarefa", tarefaIds: ["t5"], desfeitoEm: null, criadoEm: agora } };
  window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo: "quadro.mudou", dados: { quadroId: "q1", agenteId: "a", loteId: "L1", tarefas: "t5" } });
};
/** A fala do bot gravada sem frame nenhum (o mensagem.nova e o turno.encerrado se perderam). */
window.__falaSemFrame = (texto) => { mensagens.push(fala("m" + mensagens.length, "bot", texto)); };
/** Uma fala final do bot (a do meio do turno na sessão viva, ou a última) e o mensagem.nova dela. */
window.__falaDoBot = (texto, turno = null) => {
  mensagens.push({ ...fala("m" + mensagens.length, "bot", texto), turnoId: turno });
  window.__q.aoFrame({ streamId: "s", seq: seq++, pessoaId: "p", tipo: "mensagem.nova", dados: { conversaId: "c1" } });
};
window.__montar = (reduzido) => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  document.getElementById("composer").innerHTML = "<textarea></textarea>";
  const t = criarQuadroNaTela(document, { reduzido: () => reduzido, dados: { api: () => api, agente: (id) => id === "a" ? { avatar: '<span class="avatar">A</span>', nome: "Ada" } : null,
    hora: () => "10:00", recolherEm: window.__recolherEm ?? 60_000, juntarEm: 10, ...(window.__validade ? { validadeDaChaveMs: window.__validade } : {}) } });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
/** Digita e aperta Enter no campo da pílula; devolve quanto o campo levou para esvaziar (ms) e o valor depois. */
window.__enter = (texto) => {
  const t = document.getElementById("qc-txt");
  if (texto !== undefined) t.value = texto;
  const t0 = performance.now();
  t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return { ms: performance.now() - t0, valor: t.value };
};
`;

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent" });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "pilula.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever("ADA-4: a pílula do quadro no Chrome real", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ada4-"));
    url = await pagina(dir);
    process.env.CARGA_CHROME = chrome!;
    ({ cdp } = await abrirChrome(9400 + (process.pid % 400), join(dir, "perfil")));
    await cdp.enviar("Page.enable");
  }, 120_000);
  afterAll(() => { cdp?.fechar(); rmSync(dir, { recursive: true, force: true }); });

  const ate = async (expr: string, ms = 5000): Promise<void> => {
    for (let i = 0; i < ms / 50; i++) { if (await avaliar<boolean>(cdp, `!!(${expr})`)) return; await esperar(50); }
    throw new Error(`não chegou: ${expr} — faixa: ${await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.textContent ?? ""`)}`);
  };
  const faixa = () => avaliar<string>(cdp, `document.getElementById("qc-faixa").textContent`);
  const enviados = () => avaliar<[string, string, string][]>(cdp, `window.__chamadas.filter((c) => c[0] === "enviar")`);

  async function abrir(reduzido = true, recolherEm?: number, validade?: number): Promise<void> {
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.enviar("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduzido ? "reduce" : "no-preference" }] });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    if (recolherEm !== undefined) await avaliar(cdp, `window.__recolherEm = ${recolherEm}`);
    if (validade !== undefined) await avaliar(cdp, `window.__validade = ${validade}`);
    await avaliar(cdp, `window.__montar(${reduzido})`);
    await ate(`document.querySelector("#quadro .qd-card") && document.getElementById("qc-txt")`);
  }

  it("o campo esvazia em <100 ms e a fala sobe como Enviando…; duplo Enter e Enter+clique mandam 1 POST com a mesma chave", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura"`);
    const r = await avaliar<{ ms: number; valor: string }>(cdp, `window.__enter("Cria a tarefa X")`);
    expect(r.valor).toBe("");
    expect(r.ms).toBeLessThan(100);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Enviando…")`);
    expect(await faixa()).toContain("Cria a tarefa X");
    expect(await avaliar<string | null>(cdp, `document.querySelector("#quadro form:has(#qc-txt)").getAttribute("aria-busy")`)).toBe("true");
    // O 2º Enter (a mesma fala outra vez) e o clique no Enviar enquanto o 1º voa: nada sai, o texto fica no campo.
    const r2 = await avaliar<{ valor: string }>(cdp, `window.__enter("Cria a tarefa X")`);
    expect(r2.valor).toBe("Cria a tarefa X");
    await avaliar(cdp, `document.querySelector("#quadro .qc-enviar").click()`);
    await esperar(100);
    expect(await enviados()).toHaveLength(1);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`!document.getElementById("qc-faixa").textContent.includes("Enviando…")`);
    const e = await enviados();
    expect(e).toHaveLength(1);
    expect(e[0]![2]).toMatch(/.+/);
  });

  it("a rede cai: o texto volta ao campo, a faixa diz Não saiu · Tentar de novo, e o Tentar reusa a MESMA chave", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "falha"`);
    await avaliar(cdp, `window.__enter("Pedido que cai")`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await faixa()).toContain("Não saiu.");
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido que cai");
    await avaliar(cdp, `window.__modo = "ok"`);
    await avaliar(cdp, `document.querySelector('#qc-faixa [data-act="qc-tentar"]').click()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 2`);
    const e = await enviados();
    expect(e[1]![1]).toBe("Pedido que cai");
    expect(e[1]![2]).toBe(e[0]![2]);
    // O texto que voltou ao campo sai dele no Tentar (senão o Enter mandaria de novo).
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("");
  });

  it("o status vivo vem do turno.atividade do pedido; o de outro turno é ignorado; a falha do turno = Parou no meio · Ver na Conversa", async () => {
    await abrir();
    await avaliar(cdp, `window.__enter("Olha o Linear")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    // O payload real (revisão 1 do #646): o presente do emUso.texto, nunca o rótulo no passado.
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Usando Linear")`);
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("Bash"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Rodando um comando")`);
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Usando Linear")`);
    await avaliar(cdp, `window.__frame("turno.atividade", { turnoId: "T9", emUso: "Outro bot mexendo" })`);
    await esperar(100);
    expect(await faixa()).not.toContain("Outro bot");
    await avaliar(cdp, `window.__frame("turno.interrompido", { turnoId: "T9", motivo: "erro" })`);
    await esperar(100);
    expect(await faixa()).toContain("Usando Linear");
    await avaliar(cdp, `window.__frame("turno.interrompido", { motivo: "executor_indisponivel", motivo_falha: "nao_autenticado" })`);
    // A janela curta (GRACA_MS) espera um turno que repita o do pedido; sem ele, "Parou no meio".
    await ate(`document.getElementById("qc-faixa").textContent.includes("Retomando…")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Parou no meio.")`, 8000);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-abrir-conversa"]')`)).toBe(true);
    // Sem turno vivo, o botão volta a ser Enviar.
    expect(await avaliar<string | null>(cdp, `document.querySelector("#quadro .qc-enviar").getAttribute("data-act")`)).toBeNull();
  });

  it("a troca de IA no limite não é Parou no meio: a faixa segue o turno que repete o do pedido; o de uma frente é ignorado", async () => {
    await abrir();
    await avaliar(cdp, `window.__enter("Pedido longo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__frame("turno.interrompido", { motivo: "executor_indisponivel", motivo_falha: "limite_do_plano", ia_no_limite: "claude" })`);
    await avaliar(cdp, `window.__frame("turno.iniciado", { turnoId: "T7", trabalho_id: "frente" })`);
    await avaliar(cdp, `window.__frame("turno.iniciado", { turnoId: "T2", repete_turno_id: "T1" })`);
    await avaliar(cdp, `window.__frame("turno.atividade", { turnoId: "T7", ...window.__ferramenta("Bash") })`);
    await avaliar(cdp, `window.__frame("turno.atividade", { turnoId: "T2", ...window.__ferramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES") })`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Usando Linear")`);
    await esperar(4500);
    expect(await faixa()).not.toContain("Parou no meio");
    expect(await faixa()).toContain("Usando Linear");
  });

  it("revisão 2: a fala do meio do turno vira o status (Parar continua); o fim do turno traz a resposta; o leitor de tela ouve só a frase", async () => {
    await abrir();
    await avaliar(cdp, `window.__vivos = ["T1"]`);
    await avaliar(cdp, `window.__enter("Organiza tudo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    // A faixa não é região viva; a frase curta vai à #qc-vivo.
    expect(await avaliar<string | null>(cdp, `document.getElementById("qc-faixa").getAttribute("aria-live")`)).toBeNull();
    await avaliar(cdp, `window.__falaDoBot("Vou organizar as tarefas.")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Vou organizar as tarefas.")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`)).toBe(true);
    await ate(`document.getElementById("qc-vivo").textContent.includes("Vou organizar")`, 7000);
    await avaliar(cdp, `window.__vivos = []`);
    await avaliar(cdp, `window.__falaDoBot("Pronto, organizei 3.")`);
    await avaliar(cdp, `window.__frame("turno.encerrado", { estado: "concluido" })`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pronto, organizei 3.")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`)).toBe(false);
    await avaliar(cdp, `window.__vivos = []`);
  }, 20_000);

  it("revisão 12: a fala de outro turno do anfitrião (um pedido pela Conversa) não vira o status nem a resposta do pedido", async () => {
    await abrir();
    await avaliar(cdp, `window.__vivos = ["T1"]`);
    await avaliar(cdp, `window.__enter("Organiza tudo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__falaDoBot("Resposta de outro pedido.", "T9")`);
    await esperar(400);
    expect(await faixa()).not.toContain("Resposta de outro pedido.");
    await avaliar(cdp, `window.__vivos = []`);
    await avaliar(cdp, `window.__frame("turno.encerrado", { estado: "concluido" })`);
    await esperar(400);
    expect(await faixa()).not.toContain("Resposta de outro pedido.");
    await avaliar(cdp, `window.__falaDoBot("Pronto, organizei 3.", "T1")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pronto, organizei 3.")`);
  }, 20_000);

  it("Enter + clique com o POST rápido não para o próprio pedido: o Parar só arma depois", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "ok"`);
    await avaliar(cdp, `(async () => { window.__enter("Rápido"); await new Promise((r) => setTimeout(r, 60)); document.querySelector("#quadro .qc-enviar").click(); })()`);
    await esperar(150);
    expect(await avaliar<boolean>(cdp, `window.__chamadas.some((c) => c[0] === "parar")`)).toBe(false);
    expect(await faixa()).not.toContain("Parando");
    expect(await enviados()).toHaveLength(1);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
  });

  it("■ Parar: o botão vira Parar com o campo vazio, manda o parar e termina em Parado por você.", async () => {
    await abrir();
    await avaliar(cdp, `window.__enter("Faz algo demorado")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    expect(await avaliar<string>(cdp, `document.querySelector("#quadro .qc-enviar").getAttribute("aria-label")`)).toBe("Parar a resposta de Ada");
    // Com texto no campo, o botão volta a Enviar (a pessoa pode mandar outra coisa).
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = "x"; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await avaliar<string | null>(cdp, `document.querySelector("#quadro .qc-enviar").getAttribute("data-act")`)).toBeNull();
    // Revisão 4 do #646: com texto no campo e o Parar já armado, nenhum timer de 0 ms em laço.
    const timers = await avaliar<number>(cdp, `(async () => { const o = window.setTimeout; let n = 0; window.setTimeout = (...a) => { n++; return o(...a); }; await new Promise((r) => o(r, 300)); window.setTimeout = o; return n; })()`);
    expect(timers).toBeLessThan(10);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await avaliar(cdp, `document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "parar")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Parando…")`);
    await avaliar(cdp, `window.__frame("turno.interrompido", { motivo: "parado_pela_pessoa" })`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Parado por você.")`);
    expect(await faixa()).not.toContain("Parou no meio");
  });

  it("a resposta com lote: o card novo pisca (animação qd-pulsa) e a faixa mostra a resposta", async () => {
    await abrir(false);
    await avaliar(cdp, `window.__enter("Põe gravar o vídeo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__botResponde()`);
    await ate(`document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')`);
    expect(await avaliar<string>(cdp, `getComputedStyle(document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')).animationName`)).toBe("qd-pulsa");
    await ate(`document.getElementById("qc-faixa").textContent.includes("Gravar o vídeo")`);
    // O pulso some sozinho (animationend ou 1,4 s).
    await ate(`!document.querySelector('#quadro .qd-card.pulsa')`, 3000);
  });

  it("revisão 11: o card pulsa quando o pedido vira trabalho (o lote no meio do turno), não só na resposta do fim", async () => {
    await abrir(false);
    await avaliar(cdp, `window.__enter("Põe gravar o vídeo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__botCria()`);
    await ate(`document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')`);
    // O turno segue: a faixa ainda é do pedido em curso (o Parar está lá), sem resposta.
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`)).toBe(true);
    await ate(`!document.querySelector('#quadro .qd-card.pulsa')`, 3000);
    // A resposta do fim, com o mesmo lote, não pulsa de novo.
    await avaliar(cdp, `window.__falaDoBot("Pus Gravar o vídeo em A fazer.")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Gravar o vídeo")`);
    await esperar(300);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qd-card.pulsa')`)).toBe(false);
  });

  it("revisão 14: o 1º POST chegou mas caiu; reenviar pelo Enter (mesma chave) pulsa o card, dá Desfazer e não fica em Mexendo", async () => {
    await abrir(false);
    await avaliar(cdp, `window.__modo = "grava-e-cai"`);
    await avaliar(cdp, `window.__enter("Põe gravar o vídeo")`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    // O turno do 1º POST rodou: criou t5 e respondeu, sem frame da resposta para a faixa.
    await avaliar(cdp, `window.__botCria()`);
    await ate(`document.querySelector('#quadro .qd-card[data-tarefa="t5"]')`);
    await avaliar(cdp, `window.__falaSemFrame("Pus Gravar o vídeo em A fazer.")`);
    await avaliar(cdp, `window.__modo = "ok"`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Põe gravar o vídeo");
    await avaliar(cdp, `window.__enter()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 2`);
    const e = await enviados();
    expect(e[1]![2]).toBe(e[0]![2]);
    await ate(`document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pus Gravar o vídeo")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-desfazer"]')`)).toBe(true);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`)).toBe(false);
  });

  it("revisão 11: a chave da fala que falhou vence: o mesmo texto depois da janela é um pedido novo (chave nova)", async () => {
    {
      await abrir(true, undefined, 300);
      await avaliar(cdp, `window.__modo = "falha"`);
      await avaliar(cdp, `window.__enter("sim")`);
      await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
      await avaliar(cdp, `document.getElementById("qc-txt").value = ""`);
      await avaliar(cdp, `window.__modo = "ok"`);
      // Dentro da janela, o mesmo texto reusa a chave (o servidor deduplica).
      await avaliar(cdp, `window.__modo = "falha"; window.__enter("sim")`);
      await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 2`);
      await avaliar(cdp, `document.getElementById("qc-txt").value = ""`);
      await esperar(500);
      await avaliar(cdp, `window.__modo = "ok"`);
      await avaliar(cdp, `window.__enter("sim")`);
      await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 3`);
      const e = await enviados();
      expect(e[1]![2]).toBe(e[0]![2]);
      expect(e[2]![2]).not.toBe(e[0]![2]);
    }
  });

  it("com Reduzir movimento, o pulso não anima: só o contorno", async () => {
    await abrir(true);
    await avaliar(cdp, `window.__enter("Põe gravar o vídeo")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__botResponde()`);
    await ate(`document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')`);
    const s = await avaliar<{ anim: string; contorno: string }>(cdp, `(() => { const c = getComputedStyle(document.querySelector('#quadro .qd-card.pulsa[data-tarefa="t5"]')); return { anim: c.animationName, contorno: c.outlineStyle }; })()`);
    expect(s.anim).toBe("none");
    expect(s.contorno).toBe("solid");
  });
  it("revisão 3: o delta e a atividade repetida não regravam a faixa nem o quadro; a atividade nova só troca o texto da faixa", async () => {
    await abrir();
    await avaliar(cdp, `window.__enter("Olha o Linear")`);
    await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Usando Linear")`);
    await esperar(100);
    await avaliar(cdp, `(() => {
      window.__mut = { faixa: 0, quadro: 0 };
      window.__card = document.querySelector("#quadro .qd-card");
      const faixa = document.getElementById("qc-faixa");
      window.__obs = new MutationObserver((ms) => { for (const m of ms) {
        // O relógio "há N s" anda sozinho a cada segundo: não conta.
        if (m.target.closest?.(".qc-tempo") || m.target.parentElement?.closest?.(".qc-tempo")) continue;
        if (faixa.contains(m.target)) window.__mut.faixa++; else if (!document.getElementById("qc-vivo")?.contains(m.target)) window.__mut.quadro++;
      } });
      window.__obs.observe(document.getElementById("quadro"), { childList: true, subtree: true, characterData: true, attributes: true });
    })()`);
    for (let i = 0; i < 10; i++) await avaliar(cdp, `window.__frame("turno.delta", { texto: "x${i}" })`);
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("mcp__nod__linear__LINEAR_SEARCH_ISSUES"))`);
    await esperar(150);
    expect(await avaliar<{ faixa: number; quadro: number }>(cdp, `window.__mut`)).toEqual({ faixa: 0, quadro: 0 });
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("Bash"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Rodando um comando")`);
    await esperar(100);
    const m = await avaliar<{ faixa: number; quadro: number }>(cdp, `window.__mut`);
    expect(m.faixa).toBeGreaterThan(0);
    expect(m.quadro).toBe(0);
    expect(await avaliar<boolean>(cdp, `window.__card === null || window.__card.isConnected`)).toBe(true);
    await avaliar(cdp, `window.__obs.disconnect()`);
  });

  it("revisão 3: a resposta não recolhe com o ponteiro em cima; ao sair, recolhe sozinha", async () => {
    {
      await abrir(true, 300);
      await avaliar(cdp, `window.__enter("Põe gravar o vídeo")`);
      await ate(`document.querySelector('#quadro .qc-enviar[data-act="qc-parar"]')`);
      // O ponteiro entra na faixa antes da resposta (o prazo curto do teste não corre contra o CDP).
      await avaliar(cdp, `document.getElementById("qc-faixa").firstElementChild.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }))`);
      await avaliar(cdp, `window.__botResponde()`);
      await ate(`document.getElementById("qc-faixa").textContent.includes("Gravar o vídeo")`);
      await esperar(700);
      expect(await faixa()).toContain("Gravar o vídeo");
      await avaliar(cdp, `document.getElementById("qc-faixa").firstElementChild.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: null }))`);
      await ate(`!document.getElementById("qc-faixa").textContent.includes("Gravar o vídeo")`, 3000);
    }
  });

  it("revisão 5: a fala que não saiu (só na faixa: o campo já tinha outra) volta ao campo quando outra a substitui", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-falha"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Pedido B"`);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido B");
    await avaliar(cdp, `window.__modo = "segura"`);
    const r = await avaliar<{ valor: string }>(cdp, `window.__enter("Pedido B")`);
    expect(r.valor).toBe("Pedido A");
    expect((await enviados()).map((e) => e[1])).toEqual(["Pedido A", "Pedido B"]);
    await avaliar(cdp, `window.__soltar()`);
    // Revisão 9 (M1): a fala A que voltou ao campo, mandada de novo depois de B, reusa a chave do 1º envio dela (o POST
    // pode ter chegado: o servidor deduplica em vez de o bot fazer o pedido duas vezes).
    await ate(`!document.getElementById("qc-faixa").textContent.includes("Enviando…")`);
    await avaliar(cdp, `window.__modo = "ok"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 3`);
    const e = await enviados();
    expect(e[2]![1]).toBe("Pedido A");
    expect(e[2]![2]).toBe(e[0]![2]);
    expect(e[1]![2]).not.toBe(e[0]![2]);
  });

  it("revisão 5: a resposta do pedido anterior, chegando durante a leitura do quadro, não pisa no Enviando do novo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "ok"`);
    await avaliar(cdp, `window.__enter("Pedido 1")`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 1`);
    await avaliar(cdp, `window.__seguraQuadro = true`);
    await avaliar(cdp, `window.__botResponde()`);
    await new Promise((r) => setTimeout(r, 150));
    await avaliar(cdp, `window.__modo = "segura"`);
    await avaliar(cdp, `window.__enter("Pedido 2")`);
    expect(await faixa()).toContain("Pedido 2");
    await avaliar(cdp, `window.__soltarQuadro()`);
    await new Promise((r) => setTimeout(r, 200));
    const f = await faixa();
    expect(f).toContain("Pedido 2");
    expect(f).not.toContain("Pus Gravar o vídeo");
    await avaliar(cdp, `window.__soltar()`);
  });

  it("revisão 6: a fala que voltou ao campo e foi editada não volta duplicada no envio seguinte", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "falha"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido A");
    await avaliar(cdp, `window.__modo = "segura"`);
    const r = await avaliar<{ valor: string }>(cdp, `window.__enter("Pedido A corrigido")`);
    expect(r.valor).toBe("");
    await avaliar(cdp, `window.__soltar()`);
  });

  it("revisão 6: a pessoa troca de conversa com o envio em voo e ele falha: ao voltar, o texto está no campo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-falha"`);
    await avaliar(cdp, `window.__enter("Não me perca")`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c2", nome: "Beto", agenteId: "b" })`);
    await avaliar(cdp, `window.__soltar()`);
    await esperar(100);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")?.value === "Não me perca"`);
  });

  it("revisão 8: o pedido falha com a pessoa na tela; ela troca de conversa e volta: o texto (editado) está no campo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "falha"`);
    await avaliar(cdp, `window.__enter("Não some")`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Não some");
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Não some, editado"`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c2", nome: "Beto", agenteId: "b" })`);
    await esperar(50);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")?.value === "Não some, editado"`);
  });

  it("revisão 8: Enter com texto novo durante o envio em voo não manda nada, mas avisa que espere", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura"`);
    await avaliar(cdp, `window.__enter("Primeiro")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Enviando…")`);
    const r = await avaliar<{ valor: string }>(cdp, `window.__enter("Segundo")`);
    expect(r.valor).toBe("Segundo");
    expect(await faixa()).toContain("Aguarde: o envio anterior ainda não voltou.");
    expect(await faixa()).toContain("Enviando…");
    expect(await enviados()).toHaveLength(1);
    await avaliar(cdp, `window.__soltar()`);
  });

  it("revisão 8: duas leituras da conversa terminando fora de ordem: a fala mais nova do bot fica na faixa", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "ok"`);
    await avaliar(cdp, `window.__enter("Pedido")`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 1`);
    await esperar(100);
    await avaliar(cdp, `window.__seguraQuadro = true`);
    await avaliar(cdp, `window.__falaDoBot("Fala velha")`);
    await esperar(100);
    await avaliar(cdp, `window.__falaDoBot("Fala nova")`);
    await esperar(100);
    await avaliar(cdp, `window.__soltarQuadroUltimo()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Fala nova")`);
    await avaliar(cdp, `window.__soltarQuadro()`);
    await esperar(150);
    expect(await faixa()).toContain("Fala nova");
    expect(await faixa()).not.toContain("Fala velha");
  });

  it("revisão 6: 90 s sem frame → Ainda trabalhando… e a conferência acha o fim que chegou sem frame", async () => {
    await abrir(true, 10_000_000);
    await avaliar(cdp, `window.__vivos = ["T1"]; window.__acelerar = true`);
    await avaliar(cdp, `window.__enter("Pedido longo")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Ainda trabalhando…")`);
    const antes = await avaliar<number>(cdp, `window.__chamadas.filter((c) => c[0] === "conversa").length`);
    await avaliar(cdp, `window.__vivos = []; window.__falaSemFrame("Terminei o pedido longo.")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Terminei o pedido longo.")`);
    expect(await avaliar<number>(cdp, `window.__chamadas.filter((c) => c[0] === "conversa").length`)).toBeGreaterThan(antes);
    await avaliar(cdp, `window.__acelerar = false`);
  });

  it("revisão 6: o POST que não volta vira Não saiu · Tentar de novo no prazo, com o texto de volta ao campo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "pendura"; window.__acelerar = true`);
    await avaliar(cdp, `window.__enter("Pedido pendurado")`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido pendurado");
    await avaliar(cdp, `window.__acelerar = false`);
  });

  it("revisão 6: a conexão volta sem o replay: a conferência acha o fim do pedido que perdeu os frames", async () => {
    await abrir(true, 10_000_000);
    await avaliar(cdp, `window.__vivos = ["T1"]`);
    await avaliar(cdp, `window.__enter("Pedido da queda")`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 1 && !document.getElementById("qc-faixa").textContent.includes("Enviando…")`);
    await esperar(150);
    await avaliar(cdp, `window.__vivos = []; window.__falaSemFrame("Feito na queda.")`);
    await avaliar(cdp, `window.__q.reler()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Feito na queda.")`);
  });

  /** Abre a tarefa t1 e troca o status dela no select (a ação do quadro que dá recibo na faixa). */
  async function mudarStatusNaMao(): Promise<void> {
    await avaliar(cdp, `[...document.querySelectorAll("#quadro [data-act='abrir-tarefa'][data-id='t1']")].find((e) => e.offsetParent).click()`);
    await ate(`document.getElementById("qd-t-status")`);
    await avaliar(cdp, `(() => { const s = document.getElementById("qd-t-status");
      s.value = [...s.options].map((o) => o.value).find((v) => v !== s.value && v !== "voce" && v !== "bloqueado" && v !== "cancelado");
      s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await ate(`window.__chamadas.some((c) => c[0] === "mudar")`);
    await esperar(100);
  }

  it("revisão 13: a fala recusada que ficou só na faixa não some com o recibo de outra ação", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-recusa"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Pedido B"`);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("não entrou")`);
    await mudarStatusNaMao();
    expect(await faixa()).toContain("Pedido A");
    expect(await faixa()).toContain("não entrou");
  });

  it("revisão 13: sai e volta à conversa com o POST em voo, digita outra coisa e ele falha: a fala aparece com Tentar de novo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-falha"`);
    await avaliar(cdp, `window.__enter("Pedido X")`);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c2", nome: "Beto", agenteId: "b" })`);
    await esperar(50);
    await avaliar(cdp, `window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")`);
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Pedido Y"`);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    expect(await faixa()).toContain("Pedido X");
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido Y");
  });

  it("revisão 7: mudar uma tarefa na mão com o pedido rodando não apaga a faixa: o status vivo e o Parar seguem", async () => {
    await abrir();
    await avaliar(cdp, `window.__vivos = ["T1"]`);
    await avaliar(cdp, `window.__enter("Crie 3 tarefas")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Mexendo no quadro")`);
    await mudarStatusNaMao();
    expect(await faixa()).toContain("Crie 3 tarefas");
    await avaliar(cdp, `window.__frame("turno.atividade", window.__ferramenta("Bash"))`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Rodando um comando")`);
    await avaliar(cdp, `window.__vivos = []; window.__botResponde()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pus Gravar o vídeo em A fazer.")`);
  });

  it("revisão 7: com o pedido em Não saiu (texto só na faixa), o recibo de outra ação não apaga o Tentar de novo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-falha"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Pedido B"`);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`document.querySelector('#qc-faixa [data-act="qc-tentar"]')`);
    await mudarStatusNaMao();
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-tentar"]')`)).toBe(true);
    expect(await faixa()).toContain("Pedido A");
  });

  it("revisão 7: o POST que chegou mas não respondeu no prazo não vira Não saiu: a conversa mostra o pedido e a faixa o segue", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "pendura-grava"; window.__vivos = ["T1"]; window.__acelerar = true`);
    await avaliar(cdp, `window.__enter("Pedido que chegou")`);
    await esperar(400);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-tentar"]')`)).toBe(false);
    expect(await faixa()).toContain("Pedido que chegou");
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("");
    await avaliar(cdp, `window.__acelerar = false; window.__vivos = []`);
    await avaliar(cdp, `window.__botResponde()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Pus Gravar o vídeo em A fazer.")`);
    expect(await enviados()).toHaveLength(1);
  });

  it("revisão 7: a recusa do servidor (4xx) diz o porquê sem Tentar de novo, e o texto volta ao campo", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "recusa"`);
    await avaliar(cdp, `window.__enter("Pedido recusado")`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Não saiu: essa fala já saiu com outro texto.")`);
    expect(await avaliar<boolean>(cdp, `!!document.querySelector('#qc-faixa [data-act="qc-tentar"]')`)).toBe(false);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido recusado");
  });

  it("revisão 12: a recusa (4xx) com o campo ocupado deixa a fala à vista na faixa e ela volta ao campo no próximo envio", async () => {
    await abrir();
    await avaliar(cdp, `window.__modo = "segura-recusa"`);
    await avaliar(cdp, `window.__enter("Pedido A")`);
    await avaliar(cdp, `document.getElementById("qc-txt").value = "Pedido B"`);
    await avaliar(cdp, `window.__soltar()`);
    await ate(`document.getElementById("qc-faixa").textContent.includes("Não saiu: essa fala já saiu com outro texto.")`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-txt").value`)).toBe("Pedido B");
    expect(await faixa()).toContain("Pedido A");
    expect(await faixa()).toContain("não entrou");
    await avaliar(cdp, `window.__modo = "segura"`);
    const r = await avaliar<{ valor: string }>(cdp, `window.__enter("Pedido B")`);
    expect(r.valor).toBe("Pedido A");
    await avaliar(cdp, `window.__soltar()`);
  });
});
