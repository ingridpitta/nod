import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";

/**
 * O capturador de tela do Nod (NOD-398): abre o Chrome headless, entra na página com o cookie da própria pessoa e devolve
 * o PNG pelo Chrome DevTools Protocol. Sem dependência npm.
 *
 * - O CDP corre por PIPE (`--remote-debugging-pipe`, fd 3 e 4), não por porta: nenhum outro processo da máquina alcança
 *   o Chrome nem lê o cookie dele durante a captura.
 * - A rede do Chrome só resolve o loopback (`--host-resolver-rules`) e, na aba, toda requisição fora da origem exata da
 *   página (outra porta, IP literal, redirect) é barrada pelo `Fetch` do CDP: a página do Nod não puxa nada de fora, nem
 *   o que a pessoa colou (imagem em markdown, avatar), então a captura não vira SSRF. Limite aceito: WebSocket não passa
 *   pelo `Fetch` (só o JS do próprio Nod abriria um).
 * - Perfil novo a cada captura, apagado no fim (nada de estado entre pessoas); o Chrome sobe num grupo de processos
 *   próprio e o grupo inteiro morre no fim.
 * - Uma captura por vez, no máximo `maxEmEspera` esperando (o resto recebe `CapturaOcupada`); o prazo conta desde a
 *   entrada na fila e TODA espera (Chrome subindo, load da página, resposta do CDP) acaba nele, no erro do processo ou
 *   no cancelamento de quem pediu.
 */

export type CookieDaCaptura = { nome: string; valor: string };
/**
 * `pronto`: uma expressão JS que a página avalia (Runtime.evaluate) e que tem de dar `true` antes do print — o app
 * logado e desenhado, não a tela de entrada nem a página em branco. Sem ela, o print sai logo depois do load.
 */
export type PedidoDeCaptura = { url: string; largura: number; altura?: number; cookies: readonly CookieDaCaptura[]; pronto?: string };
export type Capturador = { capturar(p: PedidoDeCaptura, sinal?: AbortSignal): Promise<Buffer> };

/** A fila está cheia: quem chama responde "indisponível" na hora em vez de segurar o pedido. */
export class CapturaOcupada extends Error {
  constructor() {
    super("captura: fila cheia");
  }
}

/** O Chrome: NOD_CHROME (ou CARGA_CHROME, do teste de carga) ou o do cache do Playwright (`npx playwright install chromium`). */
export function acharChrome(env: Record<string, string | undefined> = process.env): string {
  const doEnv = env.NOD_CHROME ?? env.CARGA_CHROME;
  if (doEnv) return doEnv;
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  const versoes = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])) : [];
  for (const v of versoes) {
    for (const rel of [
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "chrome-linux64/chrome",
      "chrome-linux-arm64/chrome",
      "chrome-linux/chrome",
    ]) {
      const p = join(cache, v, rel);
      if (existsSync(p)) return p;
    }
  }
  throw new Error("Chrome não encontrado: instale com `npx playwright install chromium` ou defina NOD_CHROME");
}

/** O PNG começa com estes 8 bytes; o resto é do Chrome. */
export const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type MensagemCdp = { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string }; sessionId?: string };

/**
 * Mata o grupo inteiro do Chrome (renderer, gpu, crashpad), não só o processo principal. Também quando o principal já saiu
 * (revisão 4): os filhos do grupo destacado podem seguir vivos. Enquanto houver membro vivo o kernel não reusa o id do
 * grupo; sem nenhum, o kill dá ESRCH e não faz nada.
 */
function matarGrupo(chrome: ChildProcess): void {
  if (chrome.pid === undefined) return;
  try {
    process.kill(-chrome.pid, "SIGKILL");
  } catch {
    try { chrome.kill("SIGKILL"); } catch { /* já morreu */ }
  }
}

async function umaCaptura(chromeBin: string, p: PedidoDeCaptura, prazo: AbortSignal, semSandbox: boolean): Promise<Buffer> {
  if (prazo.aborted) throw new Error("captura: prazo estourado na fila");
  const perfil = mkdtempSync(join(tmpdir(), "nod-captura-"));
  const altura = p.altura ?? (p.largura <= 500 ? 844 : 900);
  let chrome: ChildProcess | null = null;
  // Uma promessa que só rejeita: prazo, erro ao subir, o Chrome saindo. Toda espera corre contra ela.
  let caiu!: (e: Error) => void;
  const queda = new Promise<never>((_, rejeitar) => { caiu = rejeitar; });
  queda.catch(() => undefined);
  const aoAbortar = () => caiu(new Error("captura: prazo estourado"));
  prazo.addEventListener("abort", aoAbortar, { once: true });
  // Toda espera corre contra a queda, e já nasce TRATADA: uma espera criada antes de outra que lança (o documento e o
  // load, criados antes do navigate) rejeitaria depois sem ninguém ouvindo — e unhandledRejection derruba o servidor.
  const contra = <T>(promessa: Promise<T>): Promise<T> => {
    const corrida = Promise.race([promessa, queda]);
    corrida.catch(() => undefined);
    return corrida;
  };
  try {
    chrome = spawn(chromeBin, [
      "--headless=new",
      "--remote-debugging-pipe",
      `--user-data-dir=${perfil}`,
      // Só o loopback resolve: o resto vira "host não encontrado".
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      // Popup/aba nova não nasce (fora do alcance do filtro de origem da aba).
      "--block-new-web-contents",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      // Só no runner de CI com user namespaces travados pelo AppArmor (ubuntu 24.04), onde o sandbox do Chrome não sobe:
      // a página é só o próprio servidor no loopback. Fora disso, sandbox ligado.
      ...(semSandbox ? ["--no-sandbox"] : []),
      `--window-size=${p.largura},${altura}`,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], detached: true });
    chrome.once("error", (e) => caiu(new Error(`captura: o Chrome não subiu (${(e as NodeJS.ErrnoException).code ?? e.message})`)));
    chrome.once("exit", (codigo, sinal) => caiu(new Error(`captura: o Chrome saiu (${codigo ?? sinal})`)));
    const escrita = chrome.stdio[3] as Writable;
    const leitura = chrome.stdio[4] as Readable;
    escrita.on("error", () => caiu(new Error("captura: pipe do Chrome fechou")));
    leitura.on("error", () => caiu(new Error("captura: pipe do Chrome fechou")));

    let seq = 0;
    const pendentes = new Map<number, { ok: (v: unknown) => void; erro: (e: Error) => void }>();
    const ouvintes = new Set<(m: MensagemCdp) => void>();
    let resto = "";
    leitura.setEncoding("utf8");
    leitura.on("data", (pedaco: string) => {
      resto += pedaco;
      let fim: number;
      while ((fim = resto.indexOf("\0")) !== -1) {
        const bruto = resto.slice(0, fim);
        resto = resto.slice(fim + 1);
        let msg: MensagemCdp;
        try { msg = JSON.parse(bruto) as MensagemCdp; } catch { continue; }
        if (msg.id === undefined) {
          for (const f of ouvintes) f(msg);
          continue;
        }
        const pend = pendentes.get(msg.id);
        pendentes.delete(msg.id);
        if (msg.error) pend?.erro(new Error(msg.error.message));
        else pend?.ok(msg.result);
      }
    });
    // A sessão da aba (flatten): até o attach, os comandos vão ao browser.
    const alvo: { sessao?: string } = {};
    const enviar = <T>(metodo: string, params: Record<string, unknown> = {}): Promise<T> => {
      const id = ++seq;
      const resposta = new Promise<T>((ok, erro) => pendentes.set(id, { ok: ok as (v: unknown) => void, erro }));
      escrita.write(`${JSON.stringify({ id, method: metodo, params, ...(alvo.sessao ? { sessionId: alvo.sessao } : {}) })}\0`);
      return contra(resposta);
    };
    const esperarEvento = (filtro: (m: MensagemCdp) => boolean): Promise<MensagemCdp> =>
      contra(new Promise<MensagemCdp>((ok) => {
        const f = (m: MensagemCdp) => { if (filtro(m)) { ouvintes.delete(f); ok(m); } };
        ouvintes.add(f);
      }));

    const { targetId } = await enviar<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    alvo.sessao = (await enviar<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    // Toda requisição da aba (sub-recurso e cada salto de redirect) passa por aqui: só a ORIGEM exata da página (esquema,
    // host e porta) segue. O resolvedor acima não barra IP literal nem outra porta do loopback; isto barra, e o cookie da
    // sessão (que não separa por porta) nunca sai para outro serviço da máquina.
    const origem = new URL(p.url).origin;
    ouvintes.add((m) => {
      if (m.method !== "Fetch.requestPaused" || m.sessionId !== alvo.sessao) return;
      const { requestId, request } = m.params as { requestId: string; request: { url: string } };
      let mesma = false;
      try { mesma = new URL(request.url).origin === origem; } catch { /* URL estranha: barra */ }
      void (mesma ? enviar("Fetch.continueRequest", { requestId }) : enviar("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" })).catch(() => undefined);
    });
    await enviar("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await enviar("Page.enable");
    // O service worker (web/pwa.ts) é um alvo CDP próprio: as requisições dele não passam pelo Fetch desta aba (revisão 7).
    // A captura não precisa dele: some do navigator antes de qualquer script da página, e o app segue sem PWA.
    await enviar("Page.addScriptToEvaluateOnNewDocument", { source: "delete Navigator.prototype.serviceWorker;" });
    await enviar("Network.enable");
    const celular = p.largura <= 500;
    await enviar("Emulation.setDeviceMetricsOverride", { width: p.largura, height: altura, deviceScaleFactor: 1, mobile: celular });
    // O layout de celular do app pede (hover:none) e (pointer:coarse) além da largura (CONSULTA_CELULAR, AGENTS.md): sem o
    // toque emulado, o print em 390 sairia com a casca de desktop espremida (codex, revisão 5).
    if (celular) await enviar("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    for (const c of p.cookies) await enviar("Network.setCookie", { name: c.nome, value: c.valor, url: p.url, httpOnly: true, sameSite: "Lax" });
    // O status do documento: 4xx/5xx (sem a web montada, p.ex.) não vira um print "bom" de uma página de erro.
    const documento = esperarEvento((m) => m.sessionId === alvo.sessao && m.method === "Network.responseReceived" && (m.params as { type?: string }).type === "Document");
    const carregou = esperarEvento((m) => m.sessionId === alvo.sessao && m.method === "Page.loadEventFired");
    const nav = await enviar<{ errorText?: string }>("Page.navigate", { url: p.url });
    if (nav.errorText) throw new Error(`captura: navegação falhou (${nav.errorText})`);
    const status = ((await documento).params as { response?: { status?: number } }).response?.status ?? 0;
    if (status >= 400) throw new Error(`captura: a página respondeu ${status}`);
    await carregou;
    if (p.pronto) {
      // O app pinta depois do load (sessão, leituras da API): espera o marcador, sem passar do prazo. Nunca dá certo na
      // tela de entrada: o prazo estoura e a captura falha em vez de devolver o print errado.
      for (;;) {
        const r = await enviar<{ result?: { value?: unknown } }>("Runtime.evaluate", { expression: p.pronto, returnByValue: true });
        if (r.result?.value === true) break;
        await contra(new Promise((ok) => setTimeout(ok, 150)));
      }
    }
    // Um respiro para a última pintura (fontes, imagens da mesma origem).
    await contra(new Promise((ok) => setTimeout(ok, 300)));
    const r = await enviar<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const png = Buffer.from(r.data, "base64");
    if (png.length <= ASSINATURA_PNG.length || !png.subarray(0, 8).equals(ASSINATURA_PNG)) throw new Error("captura: o Chrome não devolveu um PNG");
    return png;
  } finally {
    prazo.removeEventListener("abort", aoAbortar);
    if (chrome) {
      const c = chrome;
      matarGrupo(c);
      // O Chrome pode segurar arquivos do perfil por um instante depois do kill; se nem subiu (ENOENT), não há exit.
      // Revisão 10: com prazo de 5 s; um Chrome que não morre não trava a fila (o grupo já levou SIGKILL acima).
      if (c.pid !== undefined) await Promise.race([new Promise<void>((ok) => (c.exitCode !== null || c.signalCode !== null ? ok() : c.once("exit", () => ok()))), new Promise<void>((ok) => setTimeout(ok, 5_000).unref())]);
    }
    rmSync(perfil, { recursive: true, force: true });
  }
}

/** O capturador de verdade: uma captura por vez, fila limitada, prazo desde a entrada na fila. */
export function criarCapturadorCdp(o: { chrome?: string; prazoMs?: number; maxEmEspera?: number; semSandbox?: boolean } = {}): Capturador {
  let fila: Promise<unknown> = Promise.resolve();
  let naFila = 0;
  const prazoMs = o.prazoMs ?? 20_000;
  const maxEmEspera = o.maxEmEspera ?? 2;
  return {
    capturar(p, sinal) {
      // Uma rodando + `maxEmEspera` esperando; o resto volta na hora.
      if (sinal?.aborted) return Promise.reject(new Error("captura: cancelada por quem pediu"));
      if (naFila > maxEmEspera) return Promise.reject(new CapturaOcupada());
      naFila++;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), prazoMs);
      const cancelar = () => ctl.abort();
      sinal?.addEventListener("abort", cancelar, { once: true });
      const vez = fila.then(async () => {
        try {
          return await umaCaptura(o.chrome ?? acharChrome(), p, ctl.signal, o.semSandbox ?? process.env.NOD_CAPTURA_SEM_SANDBOX === "1");
        } catch (e) {
          if (ctl.signal.aborted) throw new Error(sinal?.aborted ? "captura: cancelada por quem pediu" : `captura: passou de ${prazoMs} ms`, { cause: e });
          throw e;
        }
      }).finally(() => {
        clearTimeout(t);
        sinal?.removeEventListener("abort", cancelar);
        naFila--;
      });
      fila = vez.catch(() => undefined);
      return vez;
    },
  };
}
