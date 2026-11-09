import { describe, expect, it } from "vitest";
import {
  assinaturaDaTela,
  avaliarNoFilho,
  criarImportador,
  dentroDasOrigens,
  origensDoAmbiente,
  scriptsAntesDoMotor,
} from "../../../src/adapters/canvas/importador.ts";
import { normalizarEstrutura } from "../../../src/domain/canvas.ts";

const ORIGEM = "https://gamefik.github.io/nod-prototipos/";
const FONTE = Buffer.from("wOF2-fonte-falsa");
const MINI = Buffer.from("RIFF-webp-falso");

/** Um protótipo no formato canvas, como o nod-ada-13-canvas, servido de memória. */
function siteFalso(extra: Record<string, string | Buffer | { status: number; location?: string }> = {}) {
  const telasJs = `window.TELAS = {"a":"<div class=\\"x\\">A</div>","b":"<div>B</div>"};`;
  const canvasJs = `const T = window.TELAS;
    window.CANVAS = { issue: "ADA-13", titulo: "App Canvas", versao: "v4",
      css: ["../_nod/c1c07b78/tokens.css", "proposta.css"], js: ["../_nod/0ad3bda5/mascote.js"],
      links: [{ rotulo: "Exemplo", href: "../nod-463-canvas/" }],
      jornadas: [{ id: "J1", titulo: "Instalar", resumo: "r", telas: [
        { hoje: true, tamanho: "desk", html: T.a, legenda: "hoje" },
        { titulo: "Novo", tamanho: "cel", html: T.b, novo: ["#app-canvas"] },
      ] }],
      notas: [{ titulo: "Nota", texto: "t", jornada: "J1" }] };`;
  const bruto = { css: ["../_nod/c1c07b78/tokens.css", "proposta.css"], js: ["../_nod/0ad3bda5/mascote.js"] };
  const indice = {
    telas: {
      "J1-0": { a: assinaturaDaTela({ html: '<div class="x">A</div>', tamanho: "desk" }, bruto.css, bruto.js), p: "J1-0.p.webp", g: "J1-0.webp" },
      "J1-1": { a: "velha", p: "J1-1.p.webp", g: "J1-1.webp" },
    },
  };
  const arquivos: Record<string, string | Buffer | { status: number; location?: string }> = {
    "ada-13/index.html": `<!DOCTYPE html><html><head><link rel="stylesheet" href="../_nod/canvas/canvas.css"></head><body>
      <script src="telas.js"></script><script src="canvas.js"></script><script src="../_nod/canvas/canvas.js"></script><script src="depois.js"></script></body></html>`,
    "ada-13/telas.js": telasJs,
    "ada-13/canvas.js": canvasJs,
    "ada-13/proposta.css": ".x{color:red}",
    "ada-13/miniaturas/indice.json": JSON.stringify(indice),
    "ada-13/miniaturas/J1-0.webp": MINI,
    "_nod/c1c07b78/tokens.css": `@font-face{src:url(fontes/geist.woff2) format("woff2")} .y{background:url("data:image/png;base64,AA")} .z{background:url(https://fora.exemplo/x.png)}`,
    "_nod/c1c07b78/fontes/geist.woff2": FONTE,
    "_nod/0ad3bda5/mascote.js": "/* mascote */",
    "_nod/canvas/tela.css": "html{margin:0}",
    ...extra,
  };
  const pedidos: string[] = [];
  const buscar = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(entrada));
    pedidos.push(u.href);
    expect(init?.redirect).toBe("manual");
    expect(u.searchParams.get("v")).toBe("1000");
    const caminho = u.href.startsWith(ORIGEM) ? u.pathname.replace("/nod-prototipos/", "") : null;
    const a = caminho !== null ? arquivos[caminho] : undefined;
    if (a === undefined) return new Response("não", { status: 404 });
    if (typeof a === "object" && !Buffer.isBuffer(a)) return new Response(null, { status: a.status, headers: a.location ? { location: a.location } : {} });
    return new Response(typeof a === "string" ? a : new Uint8Array(a), { status: 200 });
  }) as typeof fetch;
  return { buscar, pedidos };
}

const importador = (s: ReturnType<typeof siteFalso>) => criarImportador({ origens: [ORIGEM], buscar: s.buscar, agora: () => 1000 });

describe("canvas: importador (ADA-13)", () => {
  it("importa o formato canvas sem reescrita: scripts antes do motor, CSS com fonte embutida, miniatura que bate", async () => {
    const s = siteFalso();
    const r = await importador(s)(`${ORIGEM}ada-13/`);
    if (!r.ok) throw new Error(r.erro);
    expect(r.origemUrl).toBe(`${ORIGEM}ada-13/`);
    expect(s.pedidos.some((p) => p.includes("depois.js"))).toBe(false); // nada depois do motor
    const n = normalizarEstrutura(r.bruto);
    if (!n.ok) throw new Error(n.erro);
    const e = n.estrutura;
    expect(e.issue).toBe("ADA-13");
    expect(e.versaoTexto).toBe("v4");
    expect(e.jornadas[0]?.telas.map((t) => [t.id, t.tamanho, t.hoje])).toEqual([["J1-0", "desk", true], ["J1-1", "cel", false]]);
    expect(e.jornadas[0]?.telas[1]?.novo).toEqual(["#app-canvas"]);
    expect(e.css).toHaveLength(3); // tokens, proposta e o tela.css do motor
    expect(e.css[0]).toContain(`url("data:font/woff2;base64,${FONTE.toString("base64")}")`);
    expect(e.css[0]).toContain('url("data:image/png;base64,AA")'); // data: fica
    expect(e.css[0]).toContain("url(https://fora.exemplo/x.png)"); // fora da allowlist: não busca
    expect(s.pedidos.some((p) => p.includes("fora.exemplo"))).toBe(false);
    expect(e.css[2]).toBe("html{margin:0}");
    expect(e.js).toEqual(["/* mascote */"]);
    expect(e.jornadas[0]?.telas[0]?.miniatura).toBe(`data:image/webp;base64,${MINI.toString("base64")}`);
    expect(e.jornadas[0]?.telas[1]?.miniatura).toBeNull(); // assinatura velha
    expect(r.avisos.join(" ")).toContain("miniatura velha");
    expect(e.notas).toEqual([{ titulo: "Nota", texto: "t", jornada: "J1" }]);
  });

  it("revisão 9 do #649 (M2): <img src> relativo e url() do style da tela viram data:; o de fora avisa; a miniatura segue valendo", async () => {
    const PRINT = Buffer.from("RIFF-print");
    const htmlA = `<div class="x">A<img class="cl-print-img" src="../ada-2/hoje/01.webp" alt=""><img src='https://fora.exemplo/y.png'><i style="background:url(../ada-2/hoje/01.webp)"></i></div>`;
    const bruto = { css: ["../_nod/c1c07b78/tokens.css", "proposta.css"], js: ["../_nod/0ad3bda5/mascote.js"] };
    const s = siteFalso({
      "ada-13/telas.js": `window.TELAS = {"a":${JSON.stringify(htmlA)},"b":"<div>B</div>"};`,
      "ada-13/miniaturas/indice.json": JSON.stringify({ telas: { "J1-0": { a: assinaturaDaTela({ html: htmlA, tamanho: "desk" }, bruto.css, bruto.js), p: "J1-0.p.webp", g: "J1-0.webp" } } }),
      "ada-2/hoje/01.webp": PRINT,
    });
    const r = await importador(s)(`${ORIGEM}ada-13/`);
    if (!r.ok) throw new Error(r.erro);
    const n = normalizarEstrutura(r.bruto);
    if (!n.ok) throw new Error(n.erro);
    const html = n.estrutura.jornadas[0]?.telas[0]?.html ?? "";
    const dado = `data:image/webp;base64,${PRINT.toString("base64")}`;
    expect(html).toContain(`src="${dado}"`);
    expect(html).toContain(`url("${dado}")`);
    expect(html).toContain("src='https://fora.exemplo/y.png'");
    expect(s.pedidos.some((p) => p.includes("fora.exemplo"))).toBe(false);
    expect(s.pedidos.filter((p) => p.includes("01.webp"))).toHaveLength(1);
    expect(r.avisos.join(" ")).toContain("fora.exemplo/y.png está fora das origens");
    expect(n.estrutura.jornadas[0]?.telas[0]?.miniatura).toBe(`data:image/webp;base64,${MINI.toString("base64")}`);
  });

  it("recusa fora da allowlist, redirect, 404, formato antigo e teto", async () => {
    expect(await importador(siteFalso())("https://evil.exemplo/nod-prototipos/ada-13/")).toMatchObject({ ok: false });
    expect(await importador(siteFalso())("https://gamefik.github.io/outro/")).toMatchObject({ ok: false });
    expect(await importador(siteFalso())(`${ORIGEM}../outro/`)).toMatchObject({ ok: false }); // .. sai da pasta
    expect(await importador(siteFalso())("nao é url")).toMatchObject({ ok: false });
    const redir = siteFalso({ "ada-13/telas.js": { status: 302, location: "https://evil.exemplo/x.js" } });
    expect(await importador(redir)(`${ORIGEM}ada-13/`)).toMatchObject({ ok: false, erro: expect.stringContaining("redirect") });
    expect(await importador(siteFalso())(`${ORIGEM}nao-existe/`)).toMatchObject({ ok: false, erro: expect.stringContaining("404") });
    const antigo = siteFalso({ "ada-13/index.html": '<script src="../_nod/jornada.js"></script>' });
    expect(await importador(antigo)(`${ORIGEM}ada-13/`)).toMatchObject({ ok: false, erro: expect.stringContaining("formato canvas") });
    const grande = siteFalso({ "ada-13/telas.js": "x".repeat(5_000_001) });
    expect(await importador(grande)(`${ORIGEM}ada-13/`)).toMatchObject({ ok: false, erro: expect.stringContaining("teto") });
    const cssFora = siteFalso({ "ada-13/canvas.js": `window.CANVAS={titulo:"t",css:["https://evil.exemplo/a.css"],jornadas:[{telas:[{html:"x"}]}]}` });
    expect(await importador(cssFora)(`${ORIGEM}ada-13/`)).toMatchObject({ ok: false, erro: expect.stringContaining("fora das origens") });
    // revisão 1 do #649 (M9): um href que não vira URL é recusa, não exceção.
    const urlRuim = siteFalso({ "ada-13/canvas.js": `window.CANVAS={titulo:"t",css:["http://[::1"],jornadas:[{telas:[{html:"x"}]}]}` });
    expect(await importador(urlRuim)(`${ORIGEM}ada-13/`)).toMatchObject({ ok: false, erro: expect.stringContaining("URL válida") });
  });

  it("revisão 3 do #649 (M5): a importação inteira tem prazo, mesmo com cada busca dentro do dela", async () => {
    const s = siteFalso();
    const devagar = (async (entrada: string | URL | Request, init?: RequestInit) => {
      await new Promise<void>((ok, falha) => {
        const t = setTimeout(ok, 40);
        init?.signal?.addEventListener("abort", () => { clearTimeout(t); falha(new Error("abortado")); });
      });
      return s.buscar(entrada, init);
    }) as typeof fetch;
    const r = await criarImportador({ origens: [ORIGEM], buscar: devagar, agora: () => 1000, prazoTotalMs: 100 })(`${ORIGEM}ada-13/`);
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("a importação passou de") });
  });

  it("allowlist: prefixo da pasta, sem usuário/senha; NOD_CANVAS_ORIGENS com padrão", () => {
    expect(dentroDasOrigens(`${ORIGEM}a/b.js`, [ORIGEM])).toBe(true);
    expect(dentroDasOrigens("https://gamefik.github.io/nod-prototipos-falso/a.js", [ORIGEM])).toBe(false);
    expect(dentroDasOrigens("https://u:p@gamefik.github.io/nod-prototipos/a.js", [ORIGEM])).toBe(false);
    expect(dentroDasOrigens("https://gamefik.github.io.evil.exemplo/nod-prototipos/a.js", [ORIGEM])).toBe(false);
    expect(origensDoAmbiente(undefined)).toEqual([ORIGEM]);
    expect(origensDoAmbiente("https://a.exemplo/p, ftp://x/, lixo")).toEqual(["https://a.exemplo/p/"]);
  });

  it("scriptsAntesDoMotor para no motor e devolve null sem ele", () => {
    expect(scriptsAntesDoMotor('<script src="a.js"></script><script src=\'../_nod/canvas/canvas.js\'></script>', `${ORIGEM}x/index.html`)).toEqual([`${ORIGEM}x/a.js`]);
    expect(scriptsAntesDoMotor('<script src="a.js"></script>', `${ORIGEM}x/index.html`)).toBeNull();
  });
});

describe("canvas: avaliador isolado (processo filho)", () => {
  const avaliar = async (codigo: string) => avaliarNoFilho([codigo]);
  const ler = async (codigo: string) => {
    const r = await avaliar(`window.CANVAS = { x: (() => { ${codigo} })() };`);
    if (!r.ok) throw new Error(r.erro);
    return (JSON.parse(r.canvas) as { x: unknown }).x;
  };

  it("devolve o window.CANVAS dos scripts em sequência", async () => {
    const r = await avaliarNoFilho(['window.TELAS = { a: "<p>x</p>" };', "window.CANVAS = { titulo: 't', html: window.TELAS.a };"]);
    expect(r).toEqual({ ok: true, canvas: JSON.stringify({ titulo: "t", html: "<p>x</p>" }) });
  }, 30_000);

  it("não vê process, require, fetch nem gera código de string", async () => {
    expect(await ler("return [typeof process, typeof require, typeof fetch, typeof WebSocket].join(',')")).toBe("undefined,undefined,undefined,undefined");
    expect(await ler("try { return this.constructor.constructor('return process')().pid } catch (e) { return 'barrado' }")).toBe("barrado");
    expect(await ler("try { return Function('return 1')() } catch (e) { return 'barrado' }")).toBe("barrado");
    expect(await ler("try { return eval('1') } catch (e) { return 'barrado' }")).toBe("barrado");
    expect(await ler("try { return document.constructor.constructor('return 1')() } catch (e) { return 'barrado' }")).toBe("barrado");
  }, 30_000);

  it("loop infinito, alocação gigante e erro viram recusa, sem derrubar o servidor", async () => {
    expect(await avaliar("while (true) {}")).toMatchObject({ ok: false });
    expect(await avaliar("const a = []; for (;;) a.push(new Array(1e6).fill(1));")).toMatchObject({ ok: false });
    expect(await avaliar("throw new Error('quebrou')")).toEqual({ ok: false, erro: "o script 1 falhou: quebrou" });
    expect(await avaliar("throw { get message() { for (;;) {} } }")).toMatchObject({ ok: false });
    // #649 revisão 4 (baixo 3): o Proxy lançado trava o próprio Node antes do catch (fora do timeout do vm); quem segura
    // é o prazo total do filho, que o pai mata.
    const t0 = Date.now();
    expect(await avaliar("throw new Proxy({}, { getOwnPropertyDescriptor() { for (;;) {} }, get() { for (;;) {} } })")).toEqual({ ok: false, erro: "os scripts do protótipo passaram do tempo" });
    expect(Date.now() - t0).toBeLessThan(12_000);
    expect(await avaliar("window.OUTRA = 1")).toMatchObject({ ok: false, erro: expect.stringContaining("window.CANVAS") });
  }, 30_000);

  it("QA do #649 (baixo 2): o erro do próprio avaliador (o prazo) nunca entra na área isolada", async () => {
    const armadilha = `Object.defineProperty(globalThis, "__erroDoScript", { configurable: false,
      set(e) { globalThis.__visto = e instanceof Error ? "do-vm" : "de-fora"; },
      get() { return { message: "viu:" + globalThis.__visto }; } });
      while (true) {}`;
    const r = await avaliar(armadilha);
    expect(r).toMatchObject({ ok: false });
    expect(JSON.stringify(r)).not.toContain("viu:");
  }, 30_000);

  it("revisão 10 do #649 (A1): o protótipo que agenda timer importa, e o timer nunca dispara", async () => {
    // O trecho do fim do canvas.js do ada-17 (nod-prototipos), igual.
    const ada17 = `(function () {
  let n = 0;
  const t = setInterval(() => {
    const b = document.getElementById("cm-botao");
    if (b || ++n > 50) clearInterval(t);
    if (b && b.getAttribute("aria-pressed") !== "true" && !b.disabled) b.click();
  }, 100);
})();`;
    const r = await avaliarNoFilho(["window.CANVAS = { titulo: 't', disparou: 0 };", ada17,
      "setTimeout(() => { window.CANVAS.disparou++ }, 0); requestAnimationFrame(() => { window.CANVAS.disparou++ }); cancelAnimationFrame(1); clearTimeout(2); queueMicrotask(() => { window.CANVAS.disparou++ });"]);
    expect(r).toEqual({ ok: true, canvas: JSON.stringify({ titulo: "t", disparou: 0 }) });
  }, 30_000);
});
