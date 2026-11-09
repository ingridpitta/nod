import { spawn, type ChildProcess } from "node:child_process";
import { constants, existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { TAXA_MICROFONE_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { concatenar, duracaoMs, montarWav, rms } from "./audio.ts";
import type { OpcoesSessaoStt, SessaoStt, Transcritor } from "./spi.ts";

/**
 * STT `local` para dev (definido em 2026-10-04, ADR-071): whisper.cpp (`brew install whisper-cpp`, MIT) com o modelo
 * `ggml-base-q5_1.bin` em `~/.cache/nod/voz` (fora do NOD_HOME, EMENDA 11). Grátis e sem internet.
 *
 * Na primeira sessão, se não houver servidor em 127.0.0.1:<porta>, sobe o `whisper-server` como processo filho (morto
 * no `encerrar()`). Se o nod cair sem encerrar, o filho fica; o próximo boot o encontra pelo `/health` e reaproveita.
 * Sem parciais: acumula o PCM do trecho e, no `fimDeFala()`, manda o WAV para `/inference`. O áudio só existe em memória
 * e no corpo do pedido HTTP local; nada vai para disco nem para log.
 *
 * medido em 2026-10-04 (M1, macOS 26.0, whisper.cpp 1.9.4 do Homebrew, ggml-base-q5_1, teste de integração deste
 * adaptador com 4,6 s de fala do `say` Luciana): 194–232 ms do `fimDeFala()` ao final, 3 rodadas, modelo quente, texto
 * exato. Subir o servidor com o Metal já compilado: 0,52–0,87 s. Uma frase com termos em inglês na voz Eddy levou
 * 1,36 s e saiu errada (o `base` é fraco para nome estrangeiro em voz robótica; se atrapalhar o dev, `small`).
 */

export const PORTA_WHISPER_PADRAO = 8178;
export const MODELO_WHISPER_PADRAO = "ggml-base-q5_1.bin";
/** definido em 2026-10-04: o primeiro carregamento compila os shaders do Metal (~30–40 s num M1); 90 s dá folga. */
export const TIMEOUT_PRONTO_MS = 90_000;
/** definido em 2026-10-04: trecho abaixo de 300 ms não é fala (é clique, respiração, o fim de uma palavra cortada). */
export const TRECHO_MINIMO_MS = 300;
/**
 * definido em 2026-10-04: RMS abaixo de 120 (≈ -49 dBFS) é silêncio. O microfone com AEC fica em dezenas no silêncio
 * de um quarto; fala normal fica na casa dos milhares. A confirmar com o corpus pt-BR.
 */
export const RMS_SILENCIO = 120;
/** definido em 2026-10-04: teto do trecho acumulado (60 s); o resto é ignorado e o trecho fecha com o que tem. */
export const TRECHO_MAXIMO_MS = 60_000;
/** definido em 2026-10-04: "Tchau." / "Obrigado." sozinhos só são aceitos em trecho de 2 s ou mais. */
export const TRECHO_CURTO_MS = 2_000;
const TIMEOUT_INFERENCIA_MS = 30_000;
const INTERVALO_SONDA_MS = 250;
const CONTEXTO = "Conversa por voz em português do Brasil.";

function normalizar(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alucinações do Whisper em silêncio/ruído que aparecem em qualquer trecho (legendas de vídeo do treino). */
const SEMPRE_ALUCINACAO = [/amara ?org/, /^legenda(s)? (por|pela|de)\b/, /^obrigad[oa] por assistir/, /^inscreva se/, /^subtitles? by/];
/** Só alucinação quando sozinhas num trecho curto (uma pessoa de verdade pode dizer "obrigado" numa frase longa). */
const CURTA_ALUCINACAO = new Set(["obrigado", "obrigada", "tchau", "tchau tchau", "muito obrigado", "muito obrigada"]);

/**
 * Limpa o texto do Whisper e devolve "" para alucinação conhecida. Trade-off registrado em 2026-10-04: um "obrigado"
 * de verdade num trecho curto também vira "" (o orquestrador trata como "não peguei"); só vale para o provedor de dev.
 */
export function filtrarAlucinacao(texto: string, trechoMs: number): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  if (!limpo) return "";
  // [Música], (risos), ♪ … — anotação de legenda, não fala
  if (/^[[(♪*].*[\])♪*]$/u.test(limpo) || /^[♪\s.]+$/u.test(limpo)) return "";
  const n = normalizar(limpo);
  if (!n) return "";
  if (SEMPRE_ALUCINACAO.some((r) => r.test(n))) return "";
  if (trechoMs < TRECHO_CURTO_MS && CURTA_ALUCINACAO.has(n)) return "";
  return limpo;
}

export function promptDoVocabulario(vocabulario: readonly string[] | undefined): string {
  const termos = (vocabulario ?? []).map((t) => t.trim()).filter(Boolean);
  return termos.length > 0 ? `${termos.join(", ")}. ${CONTEXTO}` : CONTEXTO;
}

async function executavel(caminho: string): Promise<boolean> {
  try {
    await access(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `NOD_VOZ_WHISPER_BIN`, ou `whisper-server` no PATH, em /opt/homebrew/bin ou em /usr/local/bin. */
export async function acharBinarioWhisper(env: Record<string, string | undefined>): Promise<string | null> {
  if (env.NOD_VOZ_WHISPER_BIN) return (await executavel(env.NOD_VOZ_WHISPER_BIN)) ? env.NOD_VOZ_WHISPER_BIN : null;
  const dirs = [...(env.PATH ?? "").split(delimiter).filter(Boolean), "/opt/homebrew/bin", "/usr/local/bin"];
  for (const d of dirs) {
    const c = join(d, "whisper-server");
    if (await executavel(c)) return c;
  }
  return null;
}

export const MODELO_WHISPER_SMALL = "ggml-small-q5_1.bin";

export function caminhoModeloWhisper(env: Record<string, string | undefined>): string {
  const dir = env.NOD_VOZ_LOCAL || join(homedir(), ".cache", "nod", "voz");
  if (env.NOD_VOZ_WHISPER_MODELO) return join(dir, env.NOD_VOZ_WHISPER_MODELO);
  // medido em 2026-10-04 (M1, ~7 s de fala): base 0,23 s, small 0,65 s, large-v3-turbo 2,2 s. Com microfone de verdade
  // o base errava demais ("Tá meu vinho?"); o small entra quando está baixado (scripts/voz/preparar-local.sh).
  const small = join(dir, MODELO_WHISPER_SMALL);
  return existsSync(small) ? small : join(dir, MODELO_WHISPER_PADRAO);
}

export type OpcoesWhisperLocal = {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Para testes: encurta a espera do servidor. */
  timeoutProntoMs?: number;
};

export type TranscritorLocal = Transcritor & {
  /** Sobe (ou acha) o servidor sem abrir sessão: o boot do dev pode chamar para não esperar na primeira ligação. */
  preparar(): Promise<void>;
  encerrar(): Promise<void>;
};

type Saude = "pronto" | "carregando" | "ausente";

export function criarTranscritorWhisperLocal(o: OpcoesWhisperLocal): TranscritorLocal {
  const fetchImpl = o.fetchImpl ?? fetch;
  const porta = Number(o.env.NOD_VOZ_WHISPER_PORTA) || PORTA_WHISPER_PADRAO;
  const base = `http://127.0.0.1:${porta}`;
  const timeoutPronto = o.timeoutProntoMs ?? TIMEOUT_PRONTO_MS;
  let filho: ChildProcess | null = null;
  let pronto: Promise<void> | null = null;

  async function saude(): Promise<Saude> {
    try {
      const r = await fetchImpl(`${base}/health`, { signal: AbortSignal.timeout(1_000) });
      await r.body?.cancel();
      if (r.ok) return "pronto";
      return "carregando";
    } catch {
      return "ausente";
    }
  }

  async function subir(): Promise<void> {
    const estado = await saude();
    if (estado === "pronto") return;
    if (estado === "ausente") {
      const bin = await acharBinarioWhisper(o.env);
      const modelo = caminhoModeloWhisper(o.env);
      const temModelo = await access(modelo, constants.R_OK).then(
        () => true,
        () => false,
      );
      if (!bin || !temModelo) {
        log("aviso", "voz_whisper_ausente", { tem_binario: bin !== null, tem_modelo: temModelo, dica: "rode scripts/voz/preparar-local.sh (brew install whisper-cpp e o modelo)" });
        throw new ErroDeDominio("integracao_nao_configurada");
      }
      log("info", "voz_whisper_subindo", { porta, aviso: "o primeiro carregamento compila o Metal e pode levar ~40 s" });
      const p = spawn(bin, ["-m", modelo, "-l", "pt", "--host", "127.0.0.1", "--port", String(porta)], { stdio: "ignore", shell: false });
      filho = p;
      p.on("exit", (codigo) => {
        if (filho === p) filho = null;
        log("info", "voz_whisper_saiu", { codigo: codigo ?? null });
      });
      p.on("error", () => {
        if (filho === p) filho = null;
      });
    }
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutPronto) {
      await new Promise((r) => setTimeout(r, INTERVALO_SONDA_MS));
      if ((await saude()) === "pronto") {
        log("info", "voz_whisper_pronto", { porta, ms: Date.now() - inicio });
        return;
      }
      if (estado === "ausente" && filho === null) {
        log("aviso", "voz_whisper_morreu_ao_subir", { porta });
        throw new ErroDeDominio("conector_indisponivel");
      }
    }
    log("aviso", "voz_whisper_timeout", { porta, ms: timeoutPronto });
    await matar();
    throw new ErroDeDominio("conector_indisponivel");
  }

  function preparar(): Promise<void> {
    if (!pronto) {
      pronto = subir().catch((e: unknown) => {
        pronto = null; // a próxima sessão tenta de novo
        throw e;
      });
    }
    return pronto;
  }

  async function matar(): Promise<void> {
    const p = filho;
    filho = null;
    pronto = null;
    if (!p || p.exitCode !== null) return;
    await new Promise<void>((resolver) => {
      const forcar = setTimeout(() => p.kill("SIGKILL"), 2_000);
      p.once("exit", () => {
        clearTimeout(forcar);
        resolver();
      });
      p.kill("SIGTERM");
    });
  }

  async function inferir(pcm: Int16Array, prompt: string): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(montarWav(pcm, TAXA_MICROFONE_HZ))], { type: "audio/wav" }), "trecho.wav");
    form.append("response_format", "json");
    form.append("language", "pt");
    form.append("temperature", "0");
    form.append("prompt", prompt);
    const r = await fetchImpl(`${base}/inference`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_INFERENCIA_MS) });
    if (!r.ok) throw new ErroDeDominio("conector_indisponivel", { cause: new Error(`whisper ${r.status}`) });
    const json: unknown = await r.json();
    return typeof json === "object" && json !== null && "text" in json && typeof json.text === "string" ? json.text : "";
  }

  return {
    id: "local",
    capacidades: { parciais: false, vocabulario: true, fimDeFalaManual: true },
    preparar,
    encerrar: matar,
    async abrir(opcoes: OpcoesSessaoStt): Promise<SessaoStt> {
      await preparar();
      const prompt = promptDoVocabulario(opcoes.vocabulario);
      const maxAmostras = (TRECHO_MAXIMO_MS * TAXA_MICROFONE_HZ) / 1000;
      let pedacos: Int16Array[] = [];
      let amostras = 0;
      let fechada = false;
      let fila: Promise<void> = Promise.resolve();

      const emitir = (texto: string) => {
        if (!fechada) opcoes.aoResultado({ texto, final: true, confianca: null });
      };

      return {
        enviar(pcm16: Int16Array) {
          if (fechada || pcm16.length === 0 || amostras >= maxAmostras) return;
          const resto = maxAmostras - amostras;
          const copia = pcm16.slice(0, resto); // o chamador pode reaproveitar o buffer do quadro
          pedacos.push(copia);
          amostras += copia.length;
        },
        fimDeFala() {
          if (fechada || amostras === 0) return;
          const pcm = concatenar(pedacos);
          pedacos = [];
          amostras = 0;
          const ms = duracaoMs(pcm, TAXA_MICROFONE_HZ);
          // finais saem na ordem dos trechos, mesmo com inferências de tempos diferentes
          fila = fila.then(async () => {
            if (ms < TRECHO_MINIMO_MS || rms(pcm) < RMS_SILENCIO) {
              emitir("");
              return;
            }
            const t0 = Date.now();
            try {
              const bruto = await inferir(pcm, prompt);
              const texto = filtrarAlucinacao(bruto, ms);
              log("info", "voz_stt_final", { provedor: "local", trecho_ms: Math.round(ms), inferencia_ms: Date.now() - t0, vazio: texto === "", filtrado: texto === "" && bruto.trim() !== "" });
              emitir(texto);
            } catch (e) {
              log("aviso", "voz_stt_falhou", { provedor: "local", codigo: e instanceof ErroDeDominio ? e.codigo : "rede" });
              if (!fechada) opcoes.aoErro(e instanceof ErroDeDominio ? e : new ErroDeDominio("conector_indisponivel", { cause: e }));
            }
          });
        },
        descartar() {
          pedacos = [];
          amostras = 0;
        },
        async fechar() {
          fechada = true;
          pedacos = [];
          amostras = 0;
          await fila;
        },
      };
    },
  };
}
