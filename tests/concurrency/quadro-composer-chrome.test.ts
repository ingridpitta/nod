import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { acharChrome } from "../../src/adapters/tela/capturador-cdp.ts";
import { abrirChrome, avaliar, type Cdp } from "../../scripts/carga-tela/cdp.ts";

/**
 * ADA-5 no Chrome de verdade (definido em 2026-11-04): a pílula do Quadro é o composer do chat (web/lib/composer.ts), com
 * o CSS e o JS do app e uma API falsa na página. O que o main dá (barra, rascunhos, fila de anexos, Parar) é um dublê
 * que só registra; as teclas saem do CDP (Input.*), como as da pessoa.
 *  - o campo cresce até 170 px; @ abre a lista de bots; / abre a barra de comandos;
 *  - colar um arquivo anexa sem sair do Quadro; o Enviar leva os anexos prontos;
 *  - no celular o Enter quebra a linha e o envio é pelo botão; no computador o Enter envia;
 *  - Esc com texto não fecha a tarefa; "/" fora de campo foca a pílula;
 *  - o rascunho da pílula, da resposta e do comentário volta depois de trocar de bot e de recarregar;
 *  - a faixa é anunciada (aria-live="polite", na #qc-vivo) e o botão alterna Enviar ⇄ Parar.
 * Sem Chrome na máquina, o teste é pulado; no CI (NOD_QA_EXIGE_CHROME=1) a falta é erro.
 */

const RAIZ = new URL("../../", import.meta.url);
const chrome = ((): string | null => { try { return acharChrome() ?? null; } catch { return null; } })();
if (!chrome && process.env.NOD_QA_EXIGE_CHROME === "1") throw new Error("ADA-5: o CI precisa do Chrome para provar a pílula (npx playwright install chromium)");
const descrever = chrome ? describe : describe.skip;

const ENTRADA = `
import { criarQuadroNaTela } from "./web/lib/quadro-na-tela.ts";
import { criarControleDitado } from "./web/telas/ditado-controle.ts";
import { ditadoNaPilula } from "./web/telas/ditado.ts";
import { COLUNAS_PADRAO, colunasDto } from "./src/domain/colunas.ts";
const agora = 1_700_000_000_000;
const tarefa = (id, titulo, status, extra = {}) => ({ id, quadroId: "q1", titulo, descricao: "Descrição de " + titulo, status, agenteId: "a", ordem: Number(id.slice(1)),
  linearId: null, linearUrl: null, prUrl: null, pergunta: null, resposta: null, deFora: false, turnoId: null, criadoEm: agora, mudadoEm: agora, terminadaEm: null,
  execucao: null, agenteNome: "Ada", ...extra });
const q = { id: "q1", agenteId: "a", meta: "A pílula é o composer", prazo: null, cumpridoEm: null, resumo: null, criadoEm: agora, atualizadoEm: agora,
  agenteNome: "Ada", ultimoLote: null, feitas: 0, total: 2, colunas: colunasDto(COLUNAS_PADRAO), tarefas: [
    tarefa("t1", "Escrever o composer", "fazendo"),
    tarefa("t2", "Escolher o workspace", "voce", { pergunta: "Qual workspace?", voltarPara: "fazendo" }),
  ] };
const chamadas = [];
let mensagens = [];
const api = {
  quadro: async () => ({ quadro: structuredClone(q) }),
  conversa: async (c) => { chamadas.push(["conversa", c]); return { mensagens: structuredClone(mensagens) }; },
  // window.__segurar (uma Promise) segura a volta do servidor: a pessoa troca de bot no meio do envio.
  enviar: async (c, texto, ids) => { chamadas.push(["enviar", c, texto, ids]); await window.__segurar; if (window.__falhar) throw new Error("rede"); return { ok: true, ids: { mensagem: "m1" } }; },
  responderTarefa: async (a, id, texto) => { chamadas.push(["responder", id, texto]); await window.__segurar; return { quadro: structuredClone(q) }; },
  comentariosDaTarefa: async () => ({ comentarios: [], atividade: [], criadaPor: null }),
  comentarTarefa: async (a, id, texto) => { chamadas.push(["comentar", id, texto]); await window.__segurar; return { quadro: structuredClone(q) }; },
  // QA: o recado ao trabalho (NOD-418), para o rascunho do recado.
  trabalhosDaTarefa: async () => ({ execucoes: [], recados: [], conversaId: null, semAgente: false }),
  recadoTrabalho: async (a, id, texto) => { chamadas.push(["recado", id, texto]); await window.__segurar; return { ok: true, trabalho: { entregue: "novo" } }; },
};
const DTO = { doMacEm: 1, doMac: { versaoCli: "2", soDoTerminal: [], comandos: [{ nome: "qa", descricao: "QA.", origem: "gstack" }] },
  daConversa: [{ nome: "nova-sessao", apelidos: ["clear"], descricao: "Começa do zero", acao: "nod" }] };
// O armazém de rascunhos do main é por pessoa e sobrevive a recarregar: aqui, o sessionStorage da aba.
const rascunhos = { ler: (k) => sessionStorage.getItem("r:" + k) ?? "", guardar: (k, t) => (t ? sessionStorage.setItem("r:" + k, t) : sessionStorage.removeItem("r:" + k)) };
// A fila de anexos é por conversa, como a do main (anexosPendentes).
const filas = { c1: [], c2: [] };
const fila = filas.c1;
window.__chamadas = chamadas;
window.__dadoDoQuadro = q;
window.__fila = fila;
window.__filas = filas;
window.__chave = "c1";
window.__celular = false;
window.__montar = () => {
  document.getElementById("timeline").innerHTML = "<p>conversa</p>";
  const ad = '<span class="avatar">A</span>';
  const t = criarQuadroNaTela(document, { reduzido: () => true, dados: { api: () => api, agente: (id) => ({ avatar: ad, nome: id === "a" ? "Ada" : "Gil" }),
    hora: () => "10:00", recolherEm: 60_000, juntarEm: 10,
    composer: {
      celular: () => window.__celular,
      sugestoes: () => ["Gil", "Gabi"],
      barra: { contexto: () => ({ dto: DTO, recentes: [], atalhos: true, botProprio: true, bot: "Ada" }) },
      rascunhos,
      anexos: {
        aceita: () => window.__aceita === undefined ? "tudo" : window.__aceita,
        adicionar: (arqs) => { for (const a of arqs) filas[window.__chave].push(a.name); t.atualizarPilula(); },
        prontos: (c) => filas[c].map((n) => "anx-" + n),
        quantos: (c) => filas[c].length,
        retirar: (c, ids) => {
          const saem = filas[c].filter((n) => ids.includes("anx-" + n));
          for (const n of saem) filas[c].splice(filas[c].indexOf(n), 1);
          t.atualizarPilula();
          return { confirmar: () => {}, devolver: () => { filas[c].unshift(...saem); t.atualizarPilula(); } };
        },
      },
      comando: async (texto, c) => { if (!texto.startsWith("/nova-sessao")) return false; chamadas.push(["comando", c, texto]); await window.__segurar; return true; },
      parar: async () => { chamadas.push(["parar"]); },
      trabalhando: () => window.__trabalhando,
      ditado: { ativo: () => ditado.ativo(), concluirEnviando: () => ditado.concluir("enviar"), descartar: () => { chamadas.push(["descartou-na-troca"]); ditado.descartar(); } },
      aoCriarPilula: () => ditado.atualizar(),
    } } });
  // O ditado do main (ADR-095) com a raiz da pílula; o motor de áudio é o dublê (o microfone não existe aqui).
  const ditado = criarControleDitado({ tenantId: () => "t1", disponibilidade: async () => ({ disponivel: true, consentimentoNecessario: false, versaoConsentimento: 99 }),
    consentir: async () => undefined, raiz: () => t.pilula(), aoTexto: (texto, destino, campo) => { if (campo?.closest("#quadro")) ditadoNaPilula(campo, texto, destino); },
    avisar: (texto) => chamadas.push(["aviso", texto]), noApp: () => false });
  // Como o main (ADR-095): Esc com o ditado aberto descarta a gravação.
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ditado.ativo()) { ev.preventDefault(); chamadas.push(["descartou"]); ditado.descartar(); } });
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-act]");
    if (b?.dataset.act === "ditar") ditado.comecar();
    if (b?.dataset.act === "ditado-parar") ditado.concluir("campo");
    if (b?.dataset.act === "parar-conversa") chamadas.push(["parar-acao"]);
  });
  t.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" });
  t.trocar("quadro");
  window.__q = t;
};
window.__colar = (nome) => {
  const dt = new DataTransfer();
  dt.items.add(new File(["oi"], nome, { type: "image/png" }));
  document.getElementById("qc-txt").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
};
`;

// O motor do ditado (o worklet e o WebSocket) vira um dublê: guarda quem ouve os eventos e conta os "concluir".
const MOTOR_FALSO = "export function iniciarDitado(o) { window.__motor = o; return { concluir(q) { (window.__concluiu ??= []).push(q); }, descartar() { window.__descartado = true; } }; }";

async function pagina(dir: string): Promise<string> {
  const js = await build({ stdin: { contents: ENTRADA, resolveDir: RAIZ.pathname, loader: "ts" }, bundle: true, format: "iife", write: false, logLevel: "silent",
    plugins: [{ name: "motor-falso", setup(b) {
      b.onResolve({ filter: /lib\/ditado\.ts$/ }, () => ({ path: "motor-falso", namespace: "falso" }));
      b.onLoad({ filter: /.*/, namespace: "falso" }, () => ({ contents: MOTOR_FALSO, loader: "js" }));
    } }] });
  let html = readFileSync(new URL("web/index.html", RAIZ), "utf8");
  html = html.replace(/<link rel="stylesheet" href="\/([\w-]+\.css)" \/>/g, (_, f: string) => `<style>${readFileSync(new URL(`web/${f}`, RAIZ), "utf8")}</style>`);
  html = html.replace(/<script type="module" src="\/main.ts"><\/script>/, () => `<script>${js.outputFiles[0]!.text}</script>`);
  const arq = join(dir, "composer.html");
  writeFileSync(arq, html);
  return pathToFileURL(arq).href;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TECLAS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: "Enter", vk: 13, text: "\r" }, Escape: { code: "Escape", vk: 27 }, "/": { code: "Slash", vk: 191, text: "/" },
};

descrever("ADA-5: a pílula é o composer (Chrome real)", () => {
  let cdp: Cdp;
  let dir: string;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "ada5-"));
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
  const tecla = async (key: string, modifiers = 0) => {
    const t = TECLAS[key]!;
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk, modifiers, ...(t.text ? { text: t.text } : {}) });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk, modifiers });
  };
  const digitar = (texto: string) => cdp.enviar("Input.insertText", { text: texto });
  const focar = (sel: string) => avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).focus()`);
  const valor = (sel: string) => avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)})?.value ?? null`);

  async function abrir(largura = 1280, limpar = true): Promise<void> {
    const celular = largura < 700;
    await cdp.enviar("Emulation.setDeviceMetricsOverride", { width: largura, height: celular ? 844 : 900, deviceScaleFactor: 1, mobile: celular });
    await cdp.enviar("Page.navigate", { url });
    await ate("window.__montar");
    if (limpar) await avaliar(cdp, "sessionStorage.clear()");
    await avaliar(cdp, `window.__celular = ${celular}; window.__montar()`);
    await ate(`document.querySelector("#quadro .qd-card") && document.getElementById("qc-txt")`);
  }

  it("o campo cresce até 170 px e rola depois disso", async () => {
    await abrir();
    await focar("#qc-txt");
    const h0 = await avaliar<number>(cdp, `document.getElementById("qc-txt").getBoundingClientRect().height`);
    await digitar("linha\n".repeat(4));
    const h1 = await avaliar<number>(cdp, `document.getElementById("qc-txt").getBoundingClientRect().height`);
    await digitar("linha\n".repeat(20));
    const r = await avaliar<{ h: number; rola: boolean }>(cdp, `(() => { const t = document.getElementById("qc-txt"); return { h: t.getBoundingClientRect().height, rola: t.scrollHeight > t.clientHeight }; })()`);
    expect(h1).toBeGreaterThan(h0);
    expect(r.h).toBeGreaterThan(160);
    expect(r.h).toBeLessThanOrEqual(171);
    expect(r.rola).toBe(true);
  });

  it("@ abre a lista dos bots e o clique escolhe (como no chat); / abre a barra de comandos", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("oi @g");
    await ate(`!document.querySelector('#quadro [data-composer="mencao"]').hidden`);
    expect(await avaliar<string>(cdp, `document.querySelector('#quadro [data-composer="mencao"]').textContent`)).toContain("Gil");
    // Como no chat: a sugestão se escolhe no clique (o mousedown não tira o foco do campo).
    const p = await avaliar<{ x: number; y: number }>(cdp, `(() => { const r = document.querySelector('#quadro [data-composer="mencao"] .sug').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await cdp.enviar("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    expect(await valor("#qc-txt")).toBe("oi @Gil ");
    expect(await avaliar(cdp, `document.activeElement.id`)).toBe("qc-txt");
    expect(await avaliar(cdp, "window.__chamadas.length")).toBe(0);
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await digitar("/");
    await ate(`!document.querySelector('#quadro [data-composer="barra"]').hidden`);
    expect(await avaliar<string>(cdp, `document.querySelector('#quadro [data-composer="barra"]').textContent`)).toContain("nova-sessao");
    // Esc fecha a lista, não a tarefa nem o campo.
    await tecla("Escape");
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="barra"]').hidden`)).toBe(true);
    expect(await avaliar(cdp, `document.activeElement.id`)).toBe("qc-txt");
  });

  it("colar um arquivo anexa sem sair do Quadro e o Enter manda texto e anexos", async () => {
    await abrir();
    await focar("#qc-txt");
    await avaliar(cdp, `window.__colar("print.png")`);
    expect(await avaliar(cdp, "window.__fila")).toEqual(["print.png"]);
    expect(await avaliar(cdp, `window.__q.modo()`)).toBe("quadro");
    await digitar("olha isto");
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    const env = await avaliar<unknown[]>(cdp, `window.__chamadas.find((c) => c[0] === "enviar")`);
    expect(env).toEqual(["enviar", "c1", "olha isto", ["anx-print.png"]]);
    await ate(`document.getElementById("qc-txt").value === ""`);
    expect(await avaliar(cdp, "window.__fila.length")).toBe(0);
  });

  it("revisão 4: soltar um arquivo no Quadro anexa na pílula (sem o campo do chat na página) e marca onde soltar", async () => {
    await abrir();
    expect(await avaliar(cdp, `!!document.getElementById("composer-arquivos")`)).toBe(false);
    const r = await avaliar<{ marcado: boolean; impedido: boolean; solto: boolean; foco: string }>(cdp, `(() => {
      const dt = new DataTransfer(); dt.items.add(new File(["x"], "solto.png", { type: "image/png" }));
      const alvo = document.querySelector("#quadro .qd-conteudo") ?? document.body;
      alvo.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt }));
      const marcado = document.querySelector("#quadro .qc-pil").hasAttribute("data-soltando");
      const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      alvo.dispatchEvent(ev);
      return { marcado, impedido: ev.defaultPrevented, solto: !document.querySelector("#quadro .qc-pil").hasAttribute("data-soltando"), foco: document.activeElement?.id ?? "" };
    })()`);
    expect(r).toEqual({ marcado: true, impedido: true, solto: true, foco: "qc-txt" });
    expect(await avaliar(cdp, "window.__fila")).toEqual(["solto.png"]);
    expect(await avaliar(cdp, `window.__q.modo()`)).toBe("quadro");
  });

  it("revisão 5: de volta à Conversa (o #quadro escondido), soltar arquivo é do chat, não da pílula", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.trocar("conversa")`);
    await ate(`document.getElementById("quadro").hidden`);
    const r = await avaliar<{ impedido: boolean; marcado: boolean }>(cdp, `(() => {
      const dt = new DataTransfer(); dt.items.add(new File(["x"], "chat.png", { type: "image/png" }));
      const ent = new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: dt });
      document.body.dispatchEvent(ent);
      const marcado = document.querySelector("#quadro .qc-pil").hasAttribute("data-soltando");
      const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      document.body.dispatchEvent(ev);
      return { impedido: ent.defaultPrevented || ev.defaultPrevented, marcado };
    })()`);
    expect(r).toEqual({ impedido: false, marcado: false });
    expect(await avaliar(cdp, "window.__fila")).toEqual([]);
  });

  it("revisão 5: o rascunho de várias linhas volta (recarregar) com a altura dele, não numa linha só", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("um\ndois\ntrês\nquatro");
    const antes = await avaliar<number>(cdp, `document.getElementById("qc-txt").offsetHeight`);
    expect(antes).toBeGreaterThan(70);
    await abrir(1280, false);
    expect(await valor("#qc-txt")).toBe("um\ndois\ntrês\nquatro");
    expect(await avaliar<number>(cdp, `document.getElementById("qc-txt").offsetHeight`)).toBe(antes);
  });

  it("celular: o Enter quebra a linha e o envio é pelo botão", async () => {
    await abrir(390);
    await focar("#qc-txt");
    await digitar("primeira");
    await tecla("Enter");
    await digitar("segunda");
    expect(await valor("#qc-txt")).toBe("primeira\nsegunda");
    expect(await avaliar(cdp, "window.__chamadas.length")).toBe(0);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    expect(await avaliar(cdp, `window.__chamadas.find((c) => c[0] === "enviar")[2]`)).toBe("primeira\nsegunda");
  });

  it("revisão 7: no celular, o Enter da resposta e do comentário também quebra a linha; o envio é pelo botão", async () => {
    await abrir(390);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const resp = "#quadro .qd-tarefa textarea.qd-resp-in";
    const com = "#quadro [data-form=comentar-tarefa] textarea";
    await ate(`document.querySelector(${JSON.stringify(resp)}) && document.querySelector(${JSON.stringify(com)})`);
    await focar(resp);
    await digitar("um");
    await tecla("Enter");
    await digitar("dois");
    expect(await valor(resp)).toBe("um\ndois");
    await focar(com);
    await digitar("nota");
    await tecla("Enter");
    await digitar("mais");
    expect(await valor(com)).toBe("nota\nmais");
    await esperar(100);
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "responder" || c[0] === "comentar")`)).toBe(false);
    await avaliar(cdp, `document.querySelector(${JSON.stringify(resp)}).form.querySelector('button[type="submit"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    expect(await avaliar(cdp, `window.__chamadas.find((c) => c[0] === "responder")[2]`)).toBe("um\ndois");
  });

  it("Esc com texto só sai do campo (não fecha a tarefa); vazio, fecha como antes; / fora de campo foca a pílula", async () => {
    await abrir();
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="t1"]')].find((b) => b.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-tarefa") && document.querySelector("#quadro [data-form=comentar-tarefa] textarea")`);
    await focar("#quadro [data-form=comentar-tarefa] textarea");
    await digitar("um comentário");
    await tecla("Escape");
    expect(await avaliar(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    expect(await valor("#quadro [data-form=comentar-tarefa] textarea")).toBe("um comentário");
    // Na pílula, com texto, também só sai do campo.
    await focar("#qc-txt");
    await digitar("pedido");
    await tecla("Escape");
    expect(await avaliar(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    expect(await avaliar(cdp, `document.activeElement === document.getElementById("qc-txt")`)).toBe(false);
    await avaliar(cdp, `document.querySelector("#quadro .qd-conteudo").focus?.(); document.activeElement.blur()`);
    await tecla("/");
    expect(await avaliar(cdp, `document.activeElement.id`)).toBe("qc-txt");
    expect(await valor("#qc-txt")).toBe("pedido");
    // Campo do comentário vazio: o Esc fecha a tarefa (o de sempre).
    await avaliar(cdp, `(() => { const c = document.querySelector("#quadro [data-form=comentar-tarefa] textarea"); c.value = ""; c.focus(); })()`);
    await tecla("Escape");
    await ate(`!document.querySelector("#quadro .qd-tarefa")`);
  });

  it("revisão 4: sem tarefa aberta, o / é da busca do Quadro (NOD-460), não da pílula", async () => {
    await abrir();
    await ate(`document.querySelector("#quadro #qd-busca")`);
    await avaliar(cdp, `document.activeElement?.blur?.(); 0`);
    await tecla("/");
    expect(await avaliar(cdp, `document.activeElement.id`)).toBe("qd-busca");
    expect(await valor("#qc-txt")).toBe("");
  });

  it("os rascunhos da pílula, da resposta e do comentário voltam depois de trocar de bot e de recarregar", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("rascunho da pílula");
    await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="t2"]')].find((b) => b.offsetParent).click()`);
    await ate(`document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in") && document.querySelector("#quadro [data-form=comentar-tarefa] textarea")`);
    await focar("#quadro .qd-tarefa textarea.qd-resp-in");
    await digitar("a resposta");
    await focar("#quadro [data-form=comentar-tarefa] textarea");
    await digitar("o comentário");
    // Outro bot e de volta.
    await avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt") && document.getElementById("qc-txt").value === ""`);
    await avaliar(cdp, `window.__chave = "c1"; window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")?.value === "rascunho da pílula"`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    await ate(`document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in")?.value === "a resposta"`);
    await ate(`document.querySelector("#quadro [data-form=comentar-tarefa] textarea")?.value === "o comentário"`);
    // Recarregar a página.
    await abrir(1280, false);
    expect(await valor("#qc-txt")).toBe("rascunho da pílula");
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    await ate(`document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in")?.value === "a resposta"`);
    await ate(`document.querySelector("#quadro [data-form=comentar-tarefa] textarea")?.value === "o comentário"`);
    // Comentou: o rascunho dele sai.
    await avaliar(cdp, `document.querySelector("#quadro [data-form=comentar-tarefa] textarea").form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comentar")`);
    await ate(`sessionStorage.getItem("r:quadro:c1:t2:" + document.querySelector("#quadro [data-form=comentar-tarefa] textarea").id) === null`);
  });

  it("o ditado na pílula: o 🎤 grava, o texto entra no campo (com rascunho) e o Enviar gravando para e envia", async () => {
    await abrir();
    await ate(`document.querySelector('#quadro .qc-pil [data-act="ditar"]') && !document.querySelector('#quadro .qc-pil [data-act="ditar"]').hidden`);
    const bt = () => avaliar<string>(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`);
    await avaliar(cdp, `document.querySelector('#quadro .qc-pil [data-act="ditar"]').click()`);
    await ate("window.__motor");
    await avaliar(cdp, `window.__motor.aoEvento({ t: "gravando" })`);
    expect(await avaliar(cdp, `document.querySelector("#quadro .qc-pil").classList.contains("gravando")`)).toBe(true);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="ditado"]').hidden`)).toBe(false);
    expect(await bt()).toBe("Parar e enviar");
    // O chat não grava junto (o #composer do teste não tem as peças do ditado).
    await avaliar(cdp, `window.__motor.aoEvento({ t: "texto", texto: "ditei isto", teto: false })`);
    expect(await valor("#qc-txt")).toBe("ditei isto");
    expect(await avaliar(cdp, `sessionStorage.getItem("r:quadro:c1")`)).toBe("ditei isto");
    expect(await bt()).toBe("Enviar ao quadro");
    // Gravando de novo, o Enviar para a gravação e manda o que foi ditado.
    await avaliar(cdp, `window.__motor = null; document.querySelector('#quadro .qc-pil [data-act="ditar"]').click()`);
    await ate("window.__motor");
    await avaliar(cdp, `window.__motor.aoEvento({ t: "gravando" })`);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    expect(await avaliar(cdp, "window.__concluiu")).toEqual(["enviar"]);
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "enviar")`)).toBe(false);
    await avaliar(cdp, `window.__motor.aoEvento({ t: "texto", texto: "e mais", teto: false })`);
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    expect(await avaliar(cdp, `window.__chamadas.find((c) => c[0] === "enviar")[2]`)).toBe("ditei isto e mais");
  });

  it("a faixa é aria-live polite e o botão alterna Enviar ⇄ Parar com o bot respondendo", async () => {
    await abrir();
    // ADA-4 (revisão 2 do #646): a frase curta da faixa vai à região viva #qc-vivo; a faixa em si não é lida a cada frame.
    expect(await avaliar(cdp, `document.getElementById("qc-vivo").getAttribute("aria-live")`)).toBe("polite");
    const rot = () => avaliar<string>(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`);
    expect(await rot()).toBe("Enviar ao quadro");
    await focar("#qc-txt");
    await digitar("mexe aí");
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    // Revisão 1: quem diz se há turno vivo é o main (o critério do Parar do chat), não a faixa da pílula.
    expect(await rot()).toBe("Enviar ao quadro");
    await avaliar(cdp, `window.__trabalhando = true; window.__q.atualizarPilula()`);
    expect(await rot()).toBe("Parar a resposta de Ada");
    await digitar("x");
    expect(await rot()).toBe("Enviar ao quadro");
    await avaliar(cdp, `(() => { const t = document.getElementById("qc-txt"); t.value = ""; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    expect(await rot()).toBe("Parar a resposta de Ada");
    await esperar(650);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "parar")`);
  });

  it("revisão 4: o segundo clique de um clique duplo em Enviar não vira Parar do turno que acabou de começar", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("mexe aí");
    // O POST volta na hora e o turno já está vivo: o botão vira Parar debaixo do cursor.
    await avaliar(cdp, `(() => { const b = document.querySelector('#quadro [data-composer="enviar"]'); b.click(); return new Promise((r) => setTimeout(() => { window.__trabalhando = true; window.__q.atualizarPilula(); b.click(); r(0); }, 30)); })()`);
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`)).toBe("Parar a resposta de Ada");
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "parar")`)).toBe(false);
  });

  it("revisão 1: com o turno vivo do chat (recarregou, veio da agenda), o Parar aparece sem envio pela pílula", async () => {
    await abrir();
    await avaliar(cdp, `window.__trabalhando = true; window.__q.atualizarPilula()`);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`)).toBe("Parar a resposta de Ada");
    await avaliar(cdp, `window.__trabalhando = false; window.__q.atualizarPilula()`);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`)).toBe("Enviar ao quadro");
  });

  it("revisão 1: /nova-sessao roda na hora (não vai ao bot); com tarefa aberta, o comando do CLI vai sem o prefixo", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("/nova-sessao");
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comando")`);
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "enviar")`)).toBe(false);
    await ate(`document.getElementById("qc-txt").value === ""`);
    expect(await avaliar(cdp, `sessionStorage.getItem("r:quadro:c1")`)).toBe(null);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector("#quadro .qd-tarefa")`);
    await focar("#qc-txt");
    await digitar("/qa agora");
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    expect(await avaliar(cdp, `window.__chamadas.find((c) => c[0] === "enviar")[2]`)).toBe("/qa agora");
    // Texto comum com a tarefa aberta segue com o prefixo de sempre.
    await digitar("e isto");
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 2`);
    expect(await avaliar(cdp, `window.__chamadas.filter((c) => c[0] === "enviar")[1][2]`)).toBe("Sobre a tarefa t1 do quadro: e isto");
  });

  it("revisão 1: trocar de bot no meio do envio limpa a fila da conversa enviada (os anexos não vão duas vezes)", async () => {
    await abrir();
    await focar("#qc-txt");
    await avaliar(cdp, `window.__colar("print.png")`);
    await digitar("com anexo");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    await avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" }); window.__q.trocar("quadro")`);
    const faixaDeB = await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`);
    const conversasAntes = await avaliar<number>(cdp, `window.__chamadas.filter((c) => c[0] === "conversa").length`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`window.__filas.c1.length === 0`);
    // Revisão 8: a volta do envio de A não mexe na faixa de B nem relê a conversa fora de hora.
    await esperar(150);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`)).toBe(faixaDeB);
    expect(await avaliar<number>(cdp, `window.__chamadas.filter((c) => c[0] === "conversa").length`)).toBe(conversasAntes);
    await avaliar(cdp, `window.__chave = "c1"; window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")`);
    await focar("#qc-txt");
    await digitar("sem anexo");
    await tecla("Enter");
    await ate(`window.__chamadas.filter((c) => c[0] === "enviar").length === 2`);
    expect(await avaliar(cdp, `window.__chamadas.filter((c) => c[0] === "enviar")[1][3]`)).toEqual([]);
  });

  it("revisão 1: a resposta enviada com a troca de bot no meio não volta como rascunho", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    await ate(`document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in")`);
    await focar("#quadro .qd-tarefa textarea.qd-resp-in");
    await digitar("o workspace é o nod");
    const k = await avaliar<string>(cdp, `document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in").dataset.rascunho`);
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe("o workspace é o nod");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await avaliar(cdp, `document.querySelector("#quadro .qd-tarefa textarea.qd-resp-in").form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    await avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" })`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`sessionStorage.getItem(${JSON.stringify(`r:${k}`)}) === null`);
  });

  it("revisão 6: um frame que regrava a tarefa no meio do envio não traz a resposta enviada de volta", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro .qd-tarefa textarea.qd-resp-in";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("resposta que já foi");
    const k = await avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)}).dataset.rascunho`);
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await avaliar(cdp, `window.__antigo = document.querySelector(${JSON.stringify(sel)}); window.__antigo.form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    // O quadro relido durante o voo regrava a tarefa: o campo nasce de novo, com o texto em voo.
    await avaliar(cdp, `window.__dadoDoQuadro.tarefas[1].descricao = "mudou no meio"; window.__dadoDoQuadro.tarefas[1].mudadoEm += 1; window.__q.reler()`);
    await ate(`document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}) !== window.__antigo`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`window.__q && !document.querySelector(${JSON.stringify(sel)})?.readOnly`);
    await esperar(100);
    expect(await valor(sel)).toBe("");
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe(null);
  });

  it("revisão 8: o que a pessoa digita no comentário durante o envio fica no campo e no rascunho", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro [data-form=comentar-tarefa] textarea";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("abc");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comentar")`);
    // ADA-4: o envio é otimista: o campo esvazia na hora (o comentário fica "enviando" na lista).
    expect(await valor(sel)).toBe("");
    await focar(sel);
    await digitar("def");
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await esperar(250);
    expect(await valor(sel)).toBe("def");
    expect(await avaliar<string>(cdp, `sessionStorage.getItem("r:quadro:c1:t2:" + document.querySelector(${JSON.stringify(sel)}).id) ?? ""`)).toBe("def");
  });

  it("revisão 7: o campo regravado no voo e editado pela pessoa fica com a edição", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro .qd-tarefa textarea.qd-resp-in";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("primeira");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await avaliar(cdp, `window.__antigo = document.querySelector(${JSON.stringify(sel)}); window.__antigo.form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    await avaliar(cdp, `window.__dadoDoQuadro.tarefas[1].descricao = "mudou"; window.__dadoDoQuadro.tarefas[1].mudadoEm += 1; window.__q.reler()`);
    await ate(`document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}) !== window.__antigo`);
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).value = "outra coisa"`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await esperar(200);
    expect(await valor(sel)).toBe("outra coisa");
  });

  it("revisão 6: a resposta começada no card e mandada pela tarefa aberta não deixa o rascunho do card", async () => {
    await abrir();
    const card = "#quadro #qd-cresp-card-t2";
    await ate(`document.querySelector(${JSON.stringify(card)})`);
    await focar(card);
    await digitar("comecei no card");
    const kCard = await avaliar<string>(cdp, `document.querySelector(${JSON.stringify(card)}).dataset.rascunho`);
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${kCard}`)})`)).toBe("comecei no card");
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro .qd-tarefa textarea.qd-resp-in";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("terminei na tarefa");
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    await ate(`sessionStorage.getItem(${JSON.stringify(`r:${kCard}`)}) === null`);
  });

  it("revisão 6: A→B→A no meio de um /nova-sessao limpa a pílula nova (o comando não roda de novo no Enter)", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("/nova-sessao");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comando")`);
    await avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" }); window.__q.trocar("quadro")`);
    await avaliar(cdp, `window.__chave = "c1"; window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    await ate(`document.getElementById("qc-txt")?.value === "/nova-sessao"`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`document.getElementById("qc-txt").value === ""`);
  });

  it("revisão 1: Esc com o ditado gravando descarta a gravação (ADR-095), mesmo com texto no campo", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("já escrito");
    await ate(`document.querySelector('#quadro .qc-pil [data-act="ditar"]') && !document.querySelector('#quadro .qc-pil [data-act="ditar"]').hidden`);
    await avaliar(cdp, `window.__motor = null; window.__descartado = false; document.querySelector('#quadro .qc-pil [data-act="ditar"]').click()`);
    await ate("window.__motor");
    await avaliar(cdp, `window.__motor.aoEvento({ t: "gravando" })`);
    await focar("#qc-txt");
    await tecla("Escape");
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "descartou")`)).toBe(true);
    expect(await valor("#qc-txt")).toBe("já escrito");
    // Revisão 6: o Esc é do ditado; o campo não perde o foco (nem a tarefa fecha).
    expect(await avaliar(cdp, `document.activeElement?.id`)).toBe("qc-txt");
  });

  it("revisão 5: trocar de vista com o ditado gravando descarta a gravação (ADR-095), sem cair no campo escondido", async () => {
    await abrir();
    await ate(`document.querySelector('#quadro .qc-pil [data-act="ditar"]') && !document.querySelector('#quadro .qc-pil [data-act="ditar"]').hidden`);
    await avaliar(cdp, `window.__motor = null; document.querySelector('#quadro .qc-pil [data-act="ditar"]').click()`);
    await ate("window.__motor");
    await avaliar(cdp, `window.__motor.aoEvento({ t: "gravando" })`);
    await avaliar(cdp, `window.__q.trocar("conversa")`);
    await ate(`window.__chamadas.some((c) => c[0] === "descartou-na-troca")`);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="ditado"]').hidden`)).toBe(true);
  });

  it("revisão 1: bot que não lê anexo: colar arquivo não some (a colagem segue)", async () => {
    await abrir();
    await focar("#qc-txt");
    await avaliar(cdp, `window.__aceita = null`);
    const prevenido = await avaliar<boolean>(cdp, `(() => { const dt = new DataTransfer(); dt.items.add(new File(["oi"], "a.png", { type: "image/png" }));
      const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }); document.getElementById("qc-txt").dispatchEvent(ev); return ev.defaultPrevented; })()`);
    await avaliar(cdp, `window.__aceita = undefined`);
    expect(prevenido).toBe(false);
    expect(await avaliar(cdp, "window.__filas.c1.length")).toBe(0);
  });

  it("revisão 2: Enter com a pílula vazia não para o bot (só o clique no Parar para)", async () => {
    await abrir();
    await avaliar(cdp, `window.__trabalhando = true; window.__q.atualizarPilula()`);
    await focar("#qc-txt");
    await tecla("Enter");
    await esperar(150);
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "parar" || c[0] === "enviar")`)).toBe(false);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "parar")`);
  });

  it("revisão 2: com um envio em voo, o segundo não sai; o arquivo colado durante o voo fica na fila", async () => {
    await abrir();
    await focar("#qc-txt");
    await avaliar(cdp, `window.__colar("um.png")`);
    await digitar("primeiro");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    // O anexo enviado já saiu da fila; o colado agora fica para o próximo envio.
    expect(await avaliar(cdp, "window.__filas.c1")).toEqual([]);
    await avaliar(cdp, `window.__colar("dois.png")`);
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').click()`);
    await tecla("Enter");
    await esperar(100);
    expect(await avaliar(cdp, `window.__chamadas.filter((c) => c[0] === "enviar").length`)).toBe(1);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`document.getElementById("qc-txt").value === ""`);
    expect(await avaliar(cdp, "window.__filas.c1")).toEqual(["dois.png"]);
  });

  it("revisão 2: o envio que falha devolve os anexos à fila (e o texto fica)", async () => {
    await abrir();
    await focar("#qc-txt");
    await avaliar(cdp, `window.__colar("print.png")`);
    await digitar("vai falhar");
    await avaliar(cdp, `window.__falhar = true`);
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    await ate(`window.__filas.c1.length === 1`);
    expect(await valor("#qc-txt")).toBe("vai falhar");
    await avaliar(cdp, `window.__falhar = false`);
  });

  it("revisão 2: A→B→A no meio do envio limpa a pílula nova (o texto enviado não fica para reenviar)", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("vai e volta");
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    await avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" }); window.__q.trocar("quadro")`);
    await avaliar(cdp, `window.__chave = "c1"; window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);
    // ADA-4: o campo esvaziou no Enter (otimista) e o rascunho junto: a fala em voo não volta ao campo para sair de novo.
    await ate(`document.getElementById("qc-txt")`);
    expect(await valor("#qc-txt")).toBe("");
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`document.getElementById("qc-txt").value === ""`);
    expect(await avaliar(cdp, `sessionStorage.getItem("r:quadro:c1")`)).toBe(null);
  });

  const segurar = () => avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
  const soltar = () => avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
  const paraB = () => avaliar(cdp, `window.__chave = "c2"; window.__q.sincronizar({ chave: "c2", nome: "Gil", agenteId: "g" }); window.__q.trocar("quadro")`);
  const paraA = () => avaliar(cdp, `window.__chave = "c1"; window.__q.sincronizar({ chave: "c1", nome: "Ada", agenteId: "a" }); window.__q.trocar("quadro")`);

  it("QA (M01): A→B, a volta do envio e depois →A: o rascunho da pílula enviada não volta", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("envio lento");
    await segurar();
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    await paraB();
    await soltar();
    await esperar(150);
    expect(await avaliar(cdp, `sessionStorage.getItem("r:quadro:c1")`)).toBe(null);
    await paraA();
    await ate(`document.getElementById("qc-txt")`);
    expect(await valor("#qc-txt")).toBe("");
  });

  it("QA (M02, M05): o que a pessoa digita na pílula durante o envio fica no campo e no rascunho", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("primeiro");
    await segurar();
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    // ADA-4: o campo esvaziou no Enter (otimista); o que a pessoa escreve no voo é um recado novo.
    expect(await valor("#qc-txt")).toBe("");
    await focar("#qc-txt");
    await digitar("e mais");
    await soltar();
    await esperar(150);
    expect(await valor("#qc-txt")).toBe("e mais");
    expect(await avaliar(cdp, `sessionStorage.getItem("r:quadro:c1")`)).toBe("e mais");
    await paraB();
    await paraA();
    await ate(`document.getElementById("qc-txt")`);
    expect(await valor("#qc-txt")).toBe("e mais");
  });

  it("QA (M04): o envio de A que falha depois da troca para B não põe o erro na faixa de B", async () => {
    await abrir();
    await focar("#qc-txt");
    await digitar("vai falhar");
    await avaliar(cdp, `window.__falhar = true`);
    await segurar();
    await tecla("Enter");
    await ate(`window.__chamadas.some((c) => c[0] === "enviar")`);
    await paraB();
    const faixaDeB = await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`);
    await soltar();
    await esperar(150);
    await avaliar(cdp, `window.__falhar = false`);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`)).toBe(faixaDeB);
  });

  it("QA (M07): a resposta de A que volta depois da troca para B não mexe na faixa de B", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro .qd-tarefa textarea.qd-resp-in";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("o nod");
    await segurar();
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "responder")`);
    await paraB();
    const faixaDeB = await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`);
    await soltar();
    await esperar(150);
    expect(await avaliar<string>(cdp, `document.getElementById("qc-faixa")?.outerHTML ?? ""`)).toBe(faixaDeB);
  });

  it("QA (M09): um frame que regrava a tarefa no meio do comentário não deixa o rascunho do enviado", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    const sel = "#quadro [data-form=comentar-tarefa] textarea";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("comentário que já foi");
    const k = await avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)}).dataset.rascunho`);
    await segurar();
    await avaliar(cdp, `window.__antigo = document.querySelector(${JSON.stringify(sel)}); window.__antigo.form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comentar")`);
    await avaliar(cdp, `window.__dadoDoQuadro.tarefas[1].descricao = "mudou no comentário"; window.__dadoDoQuadro.tarefas[1].mudadoEm += 1; window.__q.reler()`);
    await ate(`document.querySelector(${JSON.stringify(sel)}) && document.querySelector(${JSON.stringify(sel)}) !== window.__antigo`);
    await soltar();
    await esperar(250);
    expect(await valor(sel)).toBe("");
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe(null);
    // Trocar de tarefa no meio: o campo do comentário de t2 sai da tela e o rascunho dele sai mesmo assim.
    await focar(sel);
    await digitar("segundo comentário");
    await segurar();
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "comentar").length === 2`);
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector('#quadro [data-form=comentar-tarefa][data-id="t1"]')`);
    await soltar();
    await esperar(250);
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe(null);
  });

  it("QA (M11, M12): o recado aceito com a troca de tarefa no meio sai do rascunho; o digitado durante o voo fica", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    const sel = "#qd-trab-recado";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("recado um");
    const k = await avaliar<string>(cdp, `document.querySelector(${JSON.stringify(sel)}).dataset.rascunho`);
    expect(k).toBeTruthy();
    await segurar();
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.some((c) => c[0] === "recado")`);
    // A pessoa troca de tarefa no meio do envio: o campo do recado de t1 sai da tela.
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    await ate(`document.querySelector('#quadro .qd-trab-form[data-id="t2"]')`);
    await soltar();
    await esperar(150);
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe(null);
    // M12: o digitado durante o voo fica no rascunho.
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("recado dois");
    await segurar();
    await avaliar(cdp, `document.querySelector(${JSON.stringify(sel)}).form.requestSubmit()`);
    await ate(`window.__chamadas.filter((c) => c[0] === "recado").length === 2`);
    // ADA-4: o campo do recado esvaziou no envio (otimista); o digitado no voo é o recado seguinte.
    expect(await valor(sel)).toBe("");
    await focar(sel);
    await digitar("e três");
    // ...e troca de tarefa antes da volta: o campo sai da tela, e o texto novo fica no rascunho de t1.
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t2")`);
    await ate(`document.querySelector('#quadro .qd-trab-form[data-id="t2"]')`);
    await soltar();
    await esperar(150);
    expect(await avaliar(cdp, `sessionStorage.getItem(${JSON.stringify(`r:${k}`)})`)).toBe("e três");
  });

  it("QA: o Esc da composição do IME (keyCode 229) não tira o foco do campo nem fecha a tarefa", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    const sel = "#quadro [data-form=comentar-tarefa] textarea";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await digitar("acentua");
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    expect(await avaliar(cdp, `document.activeElement === document.querySelector(${JSON.stringify(sel)})`)).toBe(true);
    expect(await avaliar(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await focar("#qc-txt");
    await digitar("pílula");
    await cdp.enviar("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    expect(await avaliar(cdp, `document.activeElement.id`)).toBe("qc-txt");
  });

  it("QA (M22, M23): o / digitado num campo da tarefa fica no campo; com um diálogo aberto, o / não foca a pílula", async () => {
    await abrir();
    await avaliar(cdp, `window.__q.abrirTarefa("a", "t1")`);
    const sel = "#quadro [data-form=comentar-tarefa] textarea";
    await ate(`document.querySelector(${JSON.stringify(sel)})`);
    await focar(sel);
    await tecla("/");
    expect(await avaliar(cdp, `document.activeElement === document.querySelector(${JSON.stringify(sel)})`)).toBe(true);
    expect(await valor(sel)).toBe("/");
    await avaliar(cdp, `(() => { const d = document.createElement("dialog"); d.id = "qa-dlg"; d.innerHTML = "<p>diálogo</p>"; document.body.append(d); d.show(); document.activeElement?.blur?.(); })()`);
    await tecla("/");
    expect(await avaliar(cdp, `document.activeElement?.id ?? ""`)).not.toBe("qc-txt");
    await avaliar(cdp, `document.getElementById("qa-dlg").remove()`);
  });

  it("revisão 2: sem field-sizing no CSS (Safari, Firefox), o JS do composer segura a altura em 170 px", async () => {
    await abrir();
    await avaliar(cdp, `(() => { const st = document.createElement("style"); st.textContent = "#qc-txt { field-sizing: fixed !important; }"; document.head.appendChild(st); })()`);
    await focar("#qc-txt");
    const h0 = await avaliar<number>(cdp, `document.getElementById("qc-txt").getBoundingClientRect().height`);
    await digitar("linha\n".repeat(3));
    const h1 = await avaliar<number>(cdp, `document.getElementById("qc-txt").getBoundingClientRect().height`);
    await digitar("linha\n".repeat(20));
    const h2 = await avaliar<number>(cdp, `document.getElementById("qc-txt").getBoundingClientRect().height`);
    expect(h1).toBeGreaterThan(h0);
    expect(h2).toBeGreaterThan(160);
    expect(h2).toBeLessThanOrEqual(171);
  });

  it("revisão 3: com o bot trabalhando e texto no campo, o Parar fica ao lado do Enviar (como no chat)", async () => {
    await abrir();
    const parar = () => avaliar<boolean>(cdp, `document.querySelector('#quadro [data-composer="parar"]').hidden`);
    expect(await parar()).toBe(true);
    await avaliar(cdp, `window.__trabalhando = true; window.__q.atualizarPilula()`);
    // Campo vazio: o próprio botão é o Parar; o segundo fica escondido.
    expect(await parar()).toBe(true);
    await focar("#qc-txt");
    await digitar("o próximo recado");
    expect(await parar()).toBe(false);
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="enviar"]').getAttribute("aria-label")`)).toBe("Enviar ao quadro");
    expect(await avaliar(cdp, `document.querySelector('#quadro [data-composer="parar"]').getAttribute("aria-label")`)).toBe("Parar a resposta de Ada");
    await avaliar(cdp, `document.querySelector('#quadro [data-composer="parar"]').click()`);
    await ate(`window.__chamadas.some((c) => c[0] === "parar-acao")`);
    expect(await avaliar(cdp, `window.__chamadas.some((c) => c[0] === "enviar")`)).toBe(false);
    expect(await valor("#qc-txt")).toBe("o próximo recado");
    await avaliar(cdp, `window.__trabalhando = false; window.__q.atualizarPilula()`);
    expect(await parar()).toBe(true);
  });

  it("revisão 3: o duplo clique num comando / roda o comando uma vez só", async () => {
    await abrir();
    await avaliar(cdp, `window.__soltar = null; window.__segurar = new Promise((r) => { window.__soltar = r; }); 0`);
    await focar("#qc-txt");
    await digitar("/nova-sessao");
    await avaliar(cdp, `(() => { const b = document.querySelector('#quadro [data-composer="enviar"]'); b.click(); b.click(); })()`);
    await ate(`window.__chamadas.some((c) => c[0] === "comando")`);
    await avaliar(cdp, `window.__soltar(); window.__segurar = undefined`);
    await ate(`document.getElementById("qc-txt").value === ""`);
    expect(await avaliar(cdp, `window.__chamadas.filter((c) => c[0] === "comando" || c[0] === "enviar").length`)).toBe(1);
  });

  it("QA: Esc com texto e depois Esc de novo fecha a tarefa aberta (da pílula e do comentário)", async () => {
    await abrir();
    const abrirT1 = async () => {
      await avaliar(cdp, `[...document.querySelectorAll('#quadro [data-act="abrir-tarefa"][data-id="t1"]')].find((b) => b.offsetParent).click()`);
      await ate(`document.querySelector("#quadro .qd-tarefa") && document.querySelector("#quadro [data-form=comentar-tarefa] textarea")`);
    };
    await abrirT1();
    await focar("#quadro [data-form=comentar-tarefa] textarea");
    await digitar("um comentário");
    await tecla("Escape");
    expect(await avaliar(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await tecla("Escape");
    await ate(`!document.querySelector("#quadro .qd-tarefa")`);
    await abrirT1();
    await focar("#qc-txt");
    await digitar("pedido");
    await tecla("Escape");
    expect(await avaliar(cdp, `!!document.querySelector("#quadro .qd-tarefa")`)).toBe(true);
    await tecla("Escape");
    await ate(`!document.querySelector("#quadro .qd-tarefa")`);
    expect(await valor("#qc-txt")).toBe("pedido");
  });
});
