/**
 * definido em 2026-11-04 (ADA-13, ADR-150): o processo filho que avalia os scripts de um protótipo (telas.js, canvas.js)
 * e devolve o `window.CANVAS` como JSON. Roda com `node --permission` (fs só lê este arquivo; sem child_process, worker,
 * addons), `--disallow-code-generation-from-strings`, heap pequeno, env vazio e timeout do pai.
 *
 * O código de fora roda num `vm` cujo global é um objeto vazio daqui (`Object.create(null)`): lá dentro ele ganha os
 * intrínsecos do realm do vm (o `Function` de lá, sem geração de código por string), nunca um objeto do processo; e só
 * uma string (o JSON.stringify feito lá dentro) volta. O Node 24
 * não fecha a rede no permission model; por isso, antes de tudo, este processo apaga fetch/WebSocket/EventSource do
 * próprio global (defesa em profundidade: o conteúdo vem só da allowlist de origens do nod).
 *
 * Entrada (stdin): JSON `{ scripts: string[] }`. Saída (stdout): JSON `{ ok: true, canvas: string }` ou `{ ok: false, erro }`.
 * Sem import fora de `node:`: o permission model só deixa ler este arquivo.
 */
import vm from "node:vm";

// Defesa em profundidade (revisão 5 do #649): sem o atalho para módulos internos, caso algo do processo vaze.
try {
  Reflect.deleteProperty(process, "getBuiltinModule");
} catch {
  /* Node sem a função */
}
for (const nome of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "navigator"]) {
  try {
    Reflect.deleteProperty(globalThis, nome);
  } catch {
    /* sem a propriedade: nada a fazer */
  }
}

const PRAZO_POR_SCRIPT_MS = 3000;
const MAX_SAIDA = 40_000_000;

function responder(r: { ok: true; canvas: string } | { ok: false; erro: string }): void {
  process.stdout.write(JSON.stringify(r));
}

async function lerEntrada(): Promise<string> {
  const partes: Buffer[] = [];
  for await (const p of process.stdin) partes.push(p as Buffer);
  return Buffer.concat(partes).toString("utf8");
}

function avaliar(scripts: readonly string[]): { ok: true; canvas: string } | { ok: false; erro: string } {
  const global = Object.create(null) as Record<string, unknown>;
  const ctx = vm.createContext(global, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
  // window/document/self nascem lá dentro (objetos do realm do vm), nunca daqui.
  vm.runInContext(
    `"use strict";
     globalThis.window = globalThis; globalThis.self = globalThis;
     globalThis.document = Object.freeze({ documentElement: {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: () => {} });
     globalThis.location = Object.freeze({ href: "about:blank", hash: "", search: "" });
     globalThis.console = Object.freeze({ log() {}, info() {}, warn() {}, error() {} });
     globalThis.addEventListener = () => {};
     // Revisão 10 do #649 (A1): o protótipo que agenda algo (o ada-17 usa setInterval) importa. Aqui só se quer a
     // estrutura: o timer devolve um id e nunca dispara.
     let __idTimer = 0;
     const __timer = () => ++__idTimer;
     globalThis.setTimeout = __timer; globalThis.setInterval = __timer; globalThis.requestAnimationFrame = __timer;
     globalThis.queueMicrotask = () => {};
     globalThis.clearTimeout = () => {}; globalThis.clearInterval = () => {}; globalThis.cancelAnimationFrame = () => {};`,
    ctx,
    { timeout: PRAZO_POR_SCRIPT_MS },
  );
  for (const [i, codigo] of scripts.entries()) {
    const inicio = Date.now();
    try {
      vm.runInContext(codigo, ctx, { timeout: PRAZO_POR_SCRIPT_MS, filename: `script-${i + 1}.js` });
    } catch (e) {
      // O erro pode ser um Proxy do código de fora: lê a mensagem lá dentro, com o mesmo prazo, e só aceita string
      // (#649 revisão 4, baixo 3). Aqui fora ninguém toca no objeto. O erro do prazo (criado pelo vm, não pelo script)
      // não volta para lá dentro (QA do #649, baixo 2): um setter do script o receberia e escreveria a mensagem. Sem
      // tocar no objeto (pode ser Proxy), o prazo se reconhece pelo relógio.
      if (Date.now() - inicio >= PRAZO_POR_SCRIPT_MS) return { ok: false, erro: `o script ${i + 1} passou do prazo` };
      global.__erroDoScript = e;
      let msg: unknown;
      try {
        msg = vm.runInContext(`(() => { try { const m = globalThis.__erroDoScript.message; return typeof m === "string" ? m.slice(0, 200) : null; } catch { return null; } })()`, ctx, { timeout: PRAZO_POR_SCRIPT_MS });
      } catch {
        msg = null;
      }
      return { ok: false, erro: `o script ${i + 1} falhou: ${typeof msg === "string" ? msg.slice(0, 200) : "erro desconhecido"}` };
    }
  }
  let saida: unknown;
  try {
    saida = vm.runInContext(`(() => { const c = globalThis.CANVAS; return c && typeof c === "object" ? JSON.stringify(c) : null; })()`, ctx, { timeout: PRAZO_POR_SCRIPT_MS });
  } catch {
    return { ok: false, erro: "o window.CANVAS não vira JSON" };
  }
  if (typeof saida !== "string") return { ok: false, erro: "o protótipo não define window.CANVAS (só o formato canvas é importado)" };
  if (saida.length > MAX_SAIDA) return { ok: false, erro: "o window.CANVAS é grande demais" };
  return { ok: true, canvas: saida };
}

try {
  const entrada = JSON.parse(await lerEntrada()) as { scripts?: unknown };
  const scripts = Array.isArray(entrada.scripts) ? entrada.scripts.filter((s): s is string => typeof s === "string") : [];
  responder(avaliar(scripts));
} catch {
  responder({ ok: false, erro: "entrada inválida para o avaliador" });
}
