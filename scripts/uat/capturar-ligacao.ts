/**
 * UAT visual da ligação no navegador (definido em 2026-10-04): abre o app num Chrome headless com MICROFONE FALSO (um WAV
 * gerado pelo `say` tocando em laço), entra pelo login stub, abre a conversa de um bot, aperta "Ligar", aceita o aviso
 * de voz e tira capturas da tela cheia, da pílula e da linha "Chat de voz" depois de desligar. É o teste do app inteiro:
 * worklets, AEC do Chromium, WebSocket pelo proxy do Vite, servidor, whisper e `say`.
 *
 * Uso: node scripts/uat/capturar-ligacao.ts --web http://127.0.0.1:5276 --saida /tmp/uat-tela --bot Nina [--escuro]
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1]! : padrao;
}
const web = arg("web", "http://127.0.0.1:5276");
const saida = arg("saida", join(tmpdir(), "uat-tela"));
const bot = arg("bot", "Nina");
const frase = arg("frase", "Oi, tudo bem? Me conta o que você faz.");
const escuro = process.argv.includes("--escuro");
mkdirSync(saida, { recursive: true });
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function acharChrome(): string {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  for (const v of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = join(cache, v, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(p)) return p;
  }
  throw new Error("Chrome for Testing não encontrado (npx playwright install chromium)");
}

async function main(): Promise<void> {
  // O microfone falso: a frase, depois 4 s de silêncio (o Chrome repete o arquivo em laço).
  const wav = join(saida, "microfone.wav");
  execFileSync("say", ["-v", "Luciana", "--file-format=WAVE", "--data-format=LEI16@48000", "-o", wav, `${frase} [[slnc 4000]]`]);
  const perfil = join(tmpdir(), `nod-uat-chrome-${Date.now()}`);
  rmSync(perfil, { recursive: true, force: true });
  const porta = 9333;
  const chrome = spawn(acharChrome(), [
    "--headless=new", `--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, "--no-first-run", "--window-size=1440,900",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${wav}`,
    "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank",
  ], { stdio: "ignore" });
  try {
    let alvo: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 200 && !alvo; i++) {
      await dormir(200);
      try {
        alvo = ((await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page");
      } catch { /* subindo */ }
    }
    if (!alvo) throw new Error("Chrome não abriu");
    const ws = new WebSocket(alvo.webSocketDebuggerUrl);
    await new Promise<void>((ok) => { ws.onopen = () => ok(); });
    let id = 0;
    const pendentes = new Map<number, (v: unknown) => void>();
    const console_: string[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as { id?: number; result?: unknown; method?: string; params?: { args?: { value?: unknown }[]; type?: string } };
      if (m.id !== undefined) pendentes.get(m.id)?.(m.result);
      if (m.method === "Runtime.exceptionThrown") console_.push(`exceção: ${JSON.stringify(m.params).slice(0, 600)}`);
      if (m.method === "Log.entryAdded") console_.push(`log: ${JSON.stringify(m.params).slice(0, 400)}`);
      if (m.method === "Runtime.consoleAPICalled") console_.push(`${m.params?.type}: ${(m.params?.args ?? []).map((a) => String(a.value)).join(" ")}`);
    };
    const cdp = <T>(metodo: string, params: Record<string, unknown> = {}): Promise<T> => new Promise((ok) => {
      const n = ++id;
      pendentes.set(n, (v) => ok(v as T));
      ws.send(JSON.stringify({ id: n, method: metodo, params }));
    });
    const avaliar = async <T>(expr: string): Promise<T> => {
      const r = await cdp<{ result: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`avaliar falhou: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
      return r.result.value as T;
    };
    const capturar = async (nome: string) => {
      const r = await cdp<{ data: string }>("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(saida, `${nome}.png`), Buffer.from(r.data, "base64"));
      process.stdout.write(`captura: ${join(saida, `${nome}.png`)}\n`);
    };
    await cdp("Runtime.enable");
    // medido em 2026-10-04: no macOS o Chrome headless fica esperando a permissão de microfone do sistema (TCC) mesmo
    // com o dispositivo falso, e o getUserMedia nunca resolve. O UAT troca o getUserMedia por um "microfone" que toca o
    // WAV da frase num AudioContext (MediaStreamDestination): testa captura, worklets, WebSocket e servidor, não o aparelho.
    const wavB64 = readFileSync(wav).toString("base64");
    await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (c) => {
        if (!c || !c.audio) return original(c);
        const ctx = new AudioContext({ sampleRate: 48000 });
        const bin = Uint8Array.from(atob('${wavB64}'), (ch) => ch.charCodeAt(0));
        const buf = await ctx.decodeAudioData(bin.buffer);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const dest = ctx.createMediaStreamDestination();
        src.connect(dest); src.start(ctx.currentTime + 1.5);
        return dest.stream;
      };
    })();` });
    await cdp("Page.enable");
    await cdp("Log.enable");
    if (escuro) await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    // sem Browser.grantPermissions: com ele o getUserMedia ficava pendurado no headless (medido em 2026-10-04)
    await cdp("Page.navigate", { url: web });
    await dormir(2500);
    // Login stub: a primeira pessoa do cadastro.
    await avaliar(`(async () => { const m = await (await fetch('/api/sessao/modo')).json(); await fetch('/api/sessao/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pessoaId: m.pessoas[0].id }) }); return true; })()`);
    await cdp("Page.navigate", { url: web });
    await dormir(3500);
    // Abre a conversa do bot pela barra lateral.
    const abriu = await avaliar<boolean>(`(() => { const el = [...document.querySelectorAll('[data-agente-id], a, button')].find((e) => e.textContent?.trim().startsWith(${JSON.stringify(bot)})); if (!el) return false; el.click(); return true; })()`);
    if (!abriu) throw new Error(`não achei o bot ${bot} na barra`);
    await dormir(2000);
    await capturar("1-conversa");
    const sonda = await avaliar<string>(`(async () => { const lim = (p, n) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('tempo: ' + n)), 4000))]); const m = await lim(import('/lib/ligacao-captura.worklet.ts?worker&url'), 'import'); const c = new AudioContext(); try { await lim(c.audioWorklet.addModule(m.default), 'addModule ' + m.default); new AudioWorkletNode(c, 'nod-ligacao-captura'); return 'ok ' + m.default + ' ' + c.state; } catch (e) { return 'erro ' + e + ' ' + m.default; } })()`);
    console_.push(`sonda do worklet: ${sonda}`);
    const mic = await avaliar<string>(`(async () => { try { const s = await Promise.race([navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } }), new Promise((_, j) => setTimeout(() => j(new Error('tempo getUserMedia')), 4000))]); return 'mic ok ' + s.getAudioTracks().map((t) => t.label).join(','); } catch (e) { return 'mic erro ' + e; } })()`);
    console_.push(`sonda do microfone: ${mic}`);
    const ligou = await avaliar<boolean>(`(() => { const b = document.querySelector('[data-act="iniciar-ligacao"]'); if (!b) return false; b.click(); return true; })()`);
    if (!ligou) throw new Error("sem botão Ligar (data-act=iniciar-ligacao)");
    await dormir(1500);
    await capturar("2-depois-de-ligar");
    // Aviso de voz na primeira vez: "Concordo e ligar".
    await avaliar(`(() => { const b = [...document.querySelectorAll('button')].find((e) => /Concordo e ligar/.test(e.textContent ?? '')); b?.click(); return Boolean(b); })()`);
    await dormir(9000);
    await capturar("3-tela-cheia-em-ligacao");
    const recursos = await avaliar<string[]>(`performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /worklet|voz/.test(n))`);
    console_.push(`recursos: ${recursos.join(" | ")}`);
    await dormir(9000);
    await capturar("4-tela-cheia-depois-da-resposta");
    await avaliar(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await dormir(1500);
    await capturar("5-pilula");
    await avaliar(`(() => { const b = document.querySelector('[data-act="ligacao-desligar"]'); b?.click(); return Boolean(b); })()`);
    await dormir(3000);
    await capturar("6-depois-de-desligar");
    const legenda = await avaliar<string>(`document.querySelector('#ligacao')?.innerText ?? ''`);
    process.stdout.write(`texto da região #ligacao no fim:\n${legenda.slice(0, 600)}\n`);
    writeFileSync(join(saida, "console.txt"), console_.join("\n"));
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
