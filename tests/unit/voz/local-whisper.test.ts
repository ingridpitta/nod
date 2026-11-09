import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lerWav, misturarParaMono, reamostrar } from "../../../src/adapters/voz/audio.ts";
import { acharBinarioWhisper, caminhoModeloWhisper, criarTranscritorWhisperLocal, filtrarAlucinacao, promptDoVocabulario } from "../../../src/adapters/voz/local-whisper.ts";
import type { ResultadoStt } from "../../../src/adapters/voz/spi.ts";
import { log } from "../../../src/obs/log.ts";

/** Fala sintética alta o bastante para passar do limiar de silêncio. */
function fala(ms: number): Int16Array {
  const n = (ms * 16_000) / 1000;
  return Int16Array.from({ length: n }, (_, i) => Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / 16_000)));
}

function quadros(pcm: Int16Array): Int16Array[] {
  const out: Int16Array[] = [];
  for (let i = 0; i < pcm.length; i += 320) out.push(pcm.subarray(i, i + 320));
  return out;
}

type Pedido = { campos: Record<string, string>; wav: Buffer };

async function lerForm(req: IncomingMessage): Promise<Pedido> {
  const partes: Buffer[] = [];
  for await (const c of req) partes.push(c as Buffer);
  const form = await new Request("http://x/", { method: "POST", headers: { "content-type": String(req.headers["content-type"]) }, body: Buffer.concat(partes) }).formData();
  const campos: Record<string, string> = {};
  let wav = Buffer.alloc(0);
  for (const [k, v] of form.entries()) {
    if (typeof v === "string") campos[k] = v;
    else wav = Buffer.from(await v.arrayBuffer());
  }
  return { campos, wav };
}

/** whisper-server falso: /health e /inference, com a resposta escolhida pelo teste. */
function servidorFalso(responder: (p: Pedido, n: number) => Promise<{ status?: number; text?: string }>) {
  const pedidos: Pedido[] = [];
  const srv: Server = createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    if (req.url === "/inference" && req.method === "POST") {
      const p = await lerForm(req);
      pedidos.push(p);
      const r = await responder(p, pedidos.length);
      res.writeHead(r.status ?? 200, { "content-type": "application/json" }).end(JSON.stringify({ text: r.text ?? "" }));
      return;
    }
    res.writeHead(404).end();
  });
  return {
    pedidos,
    async subir(): Promise<number> {
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      const end = srv.address();
      return typeof end === "object" && end ? end.port : 0;
    },
    fechar: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

async function portaLivre(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const end = s.address();
  const porta = typeof end === "object" && end ? end.port : 0;
  await new Promise<void>((r) => s.close(() => r()));
  return porta;
}

function esperar(cond: () => boolean, ms = 5_000): Promise<void> {
  const inicio = Date.now();
  return new Promise((resolver, rejeitar) => {
    const t = setInterval(() => {
      if (cond()) {
        clearInterval(t);
        resolver();
      } else if (Date.now() - inicio > ms) {
        clearInterval(t);
        rejeitar(new Error("tempo esgotado"));
      }
    }, 5);
  });
}

/** Prazo para o whisper-server (falso) sair do 503 no /health; vale para o transcritor e para o teto do teste. */
// NOD-194: 10 s e depois 30 s não bastaram com o Mac em load ~1000 (o binário falso é um node que precisa subir);
// medido em 2026-10-07. O real tem TIMEOUT_PRONTO_MS = 90 s.
const PRONTO_MS = 60_000;

/**
 * NOD-194: a sonda do /health tem prazo de 1 s (`saude()` em local-whisper.ts), e o servidor falso destes testes
 * roda no MESMO event loop do teste. Com o Mac em load ~950 a resposta passou de 1 s, a sonda leu "ausente" e o
 * teste caiu em integracao_nao_configurada sem defeito nenhum (medido em 2026-10-07: falhou em 1,5 s). Quem
 * não testa a sonda usa este fetch, que troca só o prazo do /health por PRONTO_MS; o resto passa intacto.
 */
const sondaSemPressa: typeof fetch = (url, init) => fetch(url, String(url).endsWith("/health") ? { ...init, signal: AbortSignal.timeout(PRONTO_MS) } : init);

describe("voz: whisper local (servidor falso)", () => {
  let fecharDepois: Array<() => Promise<void>> = [];
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const f of fecharDepois) await f();
    fecharDepois = [];
    vi.restoreAllMocks();
  });

  it("acha o servidor já de pé, manda o WAV 16 kHz com os campos certos e emite o final", async () => {
    const falso = servidorFalso(async () => ({ text: " Cria uma rotina pro Tuca. " }));
    const porta = await falso.subir();
    fecharDepois.push(falso.fechar);
    const stt = criarTranscritorWhisperLocal({ env: { NOD_VOZ_WHISPER_PORTA: String(porta), NOD_VOZ_WHISPER_BIN: "/nao/existe" }, fetchImpl: sondaSemPressa });
    expect(stt.capacidades).toEqual({ parciais: false, vocabulario: true, fimDeFalaManual: true });
    const resultados: ResultadoStt[] = [];
    const s = await stt.abrir({ idioma: "pt-BR", vocabulario: ["Tuca", "Vera"], aoResultado: (r) => resultados.push(r), aoErro: () => {} });
    const audio = fala(1000);
    for (const q of quadros(audio)) s.enviar(q);
    s.fimDeFala();
    await esperar(() => resultados.length === 1);
    expect(resultados).toEqual([{ texto: "Cria uma rotina pro Tuca.", final: true, confianca: null }]);
    const p = falso.pedidos[0];
    expect(p?.campos).toEqual({ response_format: "json", language: "pt", temperature: "0", prompt: "Tuca, Vera. Conversa por voz em português do Brasil." });
    const wav = lerWav(p?.wav ?? Buffer.alloc(0));
    expect(wav.taxa).toBe(16_000);
    expect(wav.pcm).toEqual(audio);
    await s.fechar();
    await stt.encerrar(); // não mata o que não subiu
    expect((await fetch(`http://127.0.0.1:${porta}/health`)).ok).toBe(true);
  });

  it("trecho curto (<300 ms) ou só silêncio vira final vazio sem chamar o servidor", async () => {
    const falso = servidorFalso(async () => ({ text: "não devia" }));
    const porta = await falso.subir();
    fecharDepois.push(falso.fechar);
    const stt = criarTranscritorWhisperLocal({ env: { NOD_VOZ_WHISPER_PORTA: String(porta) }, fetchImpl: sondaSemPressa });
    const resultados: ResultadoStt[] = [];
    const s = await stt.abrir({ idioma: "pt-BR", aoResultado: (r) => resultados.push(r), aoErro: () => {} });
    for (const q of quadros(fala(200))) s.enviar(q);
    s.fimDeFala();
    for (const q of quadros(new Int16Array(16_000).fill(30))) s.enviar(q);
    s.fimDeFala();
    s.fimDeFala(); // sem áudio: não é trecho
    await esperar(() => resultados.length === 2);
    expect(resultados.map((r) => r.texto)).toEqual(["", ""]);
    expect(falso.pedidos).toHaveLength(0);
  });

  it("finais saem na ordem dos trechos; descartar joga fora o trecho em curso; alucinação vira vazio", async () => {
    const falso = servidorFalso(async (_p, n) => {
      if (n === 1) await new Promise((r) => setTimeout(r, 80));
      return { text: n === 1 ? "primeiro" : n === 2 ? "Obrigado." : "terceiro" };
    });
    const porta = await falso.subir();
    fecharDepois.push(falso.fechar);
    const stt = criarTranscritorWhisperLocal({ env: { NOD_VOZ_WHISPER_PORTA: String(porta) }, fetchImpl: sondaSemPressa });
    const resultados: ResultadoStt[] = [];
    const s = await stt.abrir({ idioma: "pt-BR", aoResultado: (r) => resultados.push(r), aoErro: () => {} });
    for (const q of quadros(fala(500))) s.enviar(q);
    s.fimDeFala();
    for (const q of quadros(fala(500))) s.enviar(q);
    s.fimDeFala();
    for (const q of quadros(fala(500))) s.enviar(q);
    s.descartar();
    for (const q of quadros(fala(2500))) s.enviar(q);
    s.fimDeFala();
    await esperar(() => resultados.length === 3);
    expect(resultados.map((r) => r.texto)).toEqual(["primeiro", "", "terceiro"]);
    expect(falso.pedidos).toHaveLength(3);
  });

  it("erro do servidor vai para aoErro como conector_indisponivel", async () => {
    const falso = servidorFalso(async () => ({ status: 500 }));
    const porta = await falso.subir();
    fecharDepois.push(falso.fechar);
    const stt = criarTranscritorWhisperLocal({ env: { NOD_VOZ_WHISPER_PORTA: String(porta) }, fetchImpl: sondaSemPressa });
    const erros: Error[] = [];
    const s = await stt.abrir({ idioma: "pt-BR", aoResultado: () => {}, aoErro: (e) => erros.push(e) });
    for (const q of quadros(fala(500))) s.enviar(q);
    s.fimDeFala();
    await esperar(() => erros.length === 1);
    expect(erros[0]?.message).toBe("conector_indisponivel");
  });

  it("sem servidor e sem binário: integracao_nao_configurada (e tenta de novo na próxima sessão)", async () => {
    const porta = await portaLivre();
    const stt = criarTranscritorWhisperLocal({ env: { NOD_VOZ_WHISPER_PORTA: String(porta), NOD_VOZ_WHISPER_BIN: "/nao/existe/whisper-server" } });
    const abrir = () => stt.abrir({ idioma: "pt-BR", aoResultado: () => {}, aoErro: () => {} });
    await expect(abrir()).rejects.toThrow("integracao_nao_configurada");
    await expect(abrir()).rejects.toThrow("integracao_nao_configurada");
  });

  // NOD-194: sobe um binário falso de verdade e espera o /health dentro de PRONTO_MS. O teste espera esse prazo e mais
  // 30 s para a inferência e para matar o processo: medido em 2026-10-07, 7,1 s com load ~950 e mais de 10 s com
  // load ~1000 (o teto era 15 s fixo).
  it("sobe o binário com -m -l pt --host --port, espera o /health sair do 503 e mata no encerrar", { timeout: PRONTO_MS + 30_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-whisper-falso-"));
    fecharDepois.push(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "ggml-base-q5_1.bin"), "modelo falso");
    const argsArquivo = join(dir, "args.json");
    const bin = join(dir, "whisper-server");
    // processo filho de verdade: grava os argumentos, responde 503 ("loading model") por 300 ms e depois 200
    await writeFile(
      bin,
      `#!${process.execPath}
const http = require("node:http");
require("node:fs").writeFileSync(${JSON.stringify(argsArquivo)}, JSON.stringify(process.argv.slice(2)));
const porta = Number(process.argv[process.argv.indexOf("--port") + 1]);
const inicio = Date.now();
http.createServer((req, res) => {
  if (req.url === "/health") { const ok = Date.now() - inicio > 300; res.writeHead(ok ? 200 : 503).end(ok ? '{"status":"ok"}' : '{"status":"loading model"}'); return; }
  req.resume(); req.on("end", () => res.writeHead(200, {"content-type":"application/json"}).end('{"text":"oi"}'));
}).listen(porta, "127.0.0.1");
`,
    );
    await chmod(bin, 0o755);
    const porta = await portaLivre();
    const env = { NOD_VOZ_WHISPER_PORTA: String(porta), NOD_VOZ_WHISPER_BIN: bin, NOD_VOZ_LOCAL: dir };
    expect(await acharBinarioWhisper(env)).toBe(bin);
    expect(caminhoModeloWhisper(env)).toBe(join(dir, "ggml-base-q5_1.bin"));
    const stt = criarTranscritorWhisperLocal({ env, timeoutProntoMs: PRONTO_MS });
    const resultados: ResultadoStt[] = [];
    const s = await stt.abrir({ idioma: "pt-BR", aoResultado: (r) => resultados.push(r), aoErro: () => {} });
    expect(JSON.parse(await readFile(argsArquivo, "utf8"))).toEqual(["-m", join(dir, "ggml-base-q5_1.bin"), "-l", "pt", "--host", "127.0.0.1", "--port", String(porta)]);
    for (const q of quadros(fala(500))) s.enviar(q);
    s.fimDeFala();
    await esperar(() => resultados.length === 1);
    expect(resultados[0]?.texto).toBe("oi");
    await s.fechar();
    await stt.encerrar();
    await expect(fetch(`http://127.0.0.1:${porta}/health`)).rejects.toThrow();
  });
});

describe("voz: filtro de alucinação e prompt", () => {
  it("corta legendas, anotações e despedidas sozinhas em trecho curto", () => {
    for (const t of ["Legendas pela comunidade Amara.org", "[Música]", "(risos)", "♪ ♪", "Obrigado por assistir!", "  "]) expect(filtrarAlucinacao(t, 5_000)).toBe("");
    for (const t of ["Obrigado.", "Tchau.", "Obrigada!", "tchau, tchau"]) expect(filtrarAlucinacao(t, 1_000)).toBe("");
    expect(filtrarAlucinacao("Obrigado.", 2_500)).toBe("Obrigado.");
    expect(filtrarAlucinacao("Obrigado pela ajuda com a rotina.", 1_000)).toBe("Obrigado pela ajuda com a rotina.");
    expect(filtrarAlucinacao("  Cria   uma rotina. ", 1_000)).toBe("Cria uma rotina.");
  });
  it("prompt leva o vocabulário e o contexto", () => {
    expect(promptDoVocabulario(undefined)).toBe("Conversa por voz em português do Brasil.");
    expect(promptDoVocabulario([" Nod ", "", "GitHub"])).toBe("Nod, GitHub. Conversa por voz em português do Brasil.");
  });
});

// Integração opcional: whisper-server de verdade (Homebrew) + `say` gerando a fala. Pula fora do macOS ou sem os dois.
const binReal = process.platform === "darwin" ? await acharBinarioWhisper(process.env) : null;
const modeloReal = caminhoModeloWhisper(process.env);
const temModelo = await access(modeloReal).then(
  () => true,
  () => false,
);

describe.skipIf(!binReal || !temModelo)("voz: whisper local (integração com whisper-server e say)", () => {
  it("transcreve uma frase do say com as palavras esperadas", { timeout: 150_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-whisper-integ-"));
    try {
      const arquivo = join(dir, "fala.wav");
      await promisify(execFile)("say", ["-v", "Luciana", "--file-format=WAVE", "--data-format=LEI16@16000", "-o", arquivo, "Oi, eu quero ver as minhas tarefas de hoje e criar uma rotina nova."]);
      const wav = lerWav(await readFile(arquivo));
      const pcm = wav.taxa === 16_000 ? misturarParaMono(wav.pcm, wav.canais) : reamostrar(misturarParaMono(wav.pcm, wav.canais), wav.taxa, 16_000);
      await rm(arquivo, { force: true });

      const stt = criarTranscritorWhisperLocal({ env: process.env });
      const t0 = Date.now();
      await stt.preparar();
      const subirMs = Date.now() - t0;
      const resultados: ResultadoStt[] = [];
      const s = await stt.abrir({ idioma: "pt-BR", vocabulario: ["Nod"], aoResultado: (r) => resultados.push(r), aoErro: () => {} });
      const tempos: number[] = [];
      for (let rodada = 0; rodada < 3; rodada++) {
        for (const q of quadros(pcm)) s.enviar(q);
        const t1 = Date.now();
        s.fimDeFala();
        await esperar(() => resultados.length === rodada + 1, 30_000);
        tempos.push(Date.now() - t1);
      }
      log("info", "medicao_whisper_local", { subir_ms: subirMs, fala_ms: Math.round((pcm.length * 1000) / 16_000), final_ms: tempos.join("/") });
      await s.fechar();
      await stt.encerrar();
      for (const r of resultados) {
        const t = r.texto.toLowerCase();
        expect(t).toContain("tarefas");
        expect(t).toContain("rotina");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
