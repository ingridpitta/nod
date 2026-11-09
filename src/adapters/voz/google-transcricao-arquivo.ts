import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { RecusaDoArquivo, type PalavraTranscrita, type PedidoTranscricaoArquivo, type ResultadoTranscricaoArquivo, type TranscritorDeArquivo } from "./spi.ts";

/**
 * STT de ARQUIVO `google` (definido em 2026-10-22, NOD-329): Speech-to-Text v2 `recognize` (síncrono, até 60 s e
 * 10 MB), modelo Chirp 2, com tempo por palavra (`enableWordTimeOffsets`). Serve ao memo de voz do bot; a ligação
 * continua no `google-transcricao.ts` (streaming, sem tempo por palavra).
 *
 * - Endpoint regional `{regiao}-speech.googleapis.com`, recognizer implícito `_` (sem recurso criado no projeto).
 * - Token de `token-google.ts` e `x-goog-user-project`; sem `NOD_VOZ_PROJETO`, `integracao_nao_configurada`.
 * - `autoDecodingConfig`: o Google detecta o formato pelo cabeçalho (wav, mp3, flac, ogg opus…). O que ele não
 *   decodifica volta 400 e vira `RecusaDoArquivo("nao_suportado")`; acima do limite do síncrono, `"longo"`.
 * - Erros: 401/403 → `integracao_autenticacao`; 429, 5xx, rede e timeout de 30 s → `conector_indisponivel`.
 * - Log: só status e código. Nunca o texto, as palavras, o corpo da resposta nem `err.message` do Google.
 *
 * A confirmar com `scripts/voz/sonda-stt-arquivo.ts` (dev com gcloud): se o chirp_2 aceita m4a (AAC) e ogg vorbis.
 */
export const MODELO_STT_ARQUIVO_PADRAO = "chirp_2";
export const REGIAO_STT_ARQUIVO_PADRAO = "us-central1";
/** definido em 2026-10-22: o pedido síncrono espera até 30 s; depois disso conta como provedor fora. */
export const TIMEOUT_STT_ARQUIVO_MS = 30_000;

export type OpcoesTranscricaoArquivoGoogle = {
  token: () => Promise<string>;
  projeto: string | null;
  regiao?: string;
  modelo?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function urlRecognizeV2(projeto: string, regiao: string): string {
  return `https://${regiao}-speech.googleapis.com/v2/projects/${encodeURIComponent(projeto)}/locations/${encodeURIComponent(regiao)}/recognizers/_:recognize`;
}

export function montarCorpoRecognize(bytes: Uint8Array, modelo: string, idioma: string): object {
  return {
    config: {
      autoDecodingConfig: {},
      model: modelo,
      languageCodes: [idioma],
      features: { enableWordTimeOffsets: true, enableAutomaticPunctuation: true },
    },
    content: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64"),
  };
}

/** Duration do protobuf em JSON ("1.500s", "2s", "0.1s") para ms. Ausente = 0 (o protobuf omite o zero). Inválida = null. */
export function duracaoParaMs(v: unknown): number | null {
  if (v === undefined || v === null) return 0;
  if (typeof v !== "string") return null;
  const m = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(v.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(3, "0").slice(0, 3);
  return Number(m[1]) * 1000 + Number(frac);
}

function obj(x: unknown): Record<string, unknown> | null {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** Lê `results[].alternatives[0].words[]` e `metadata.totalBilledDuration`. Palavras sem texto ou com tempo inválido são puladas. */
export function lerRespostaRecognize(json: unknown): ResultadoTranscricaoArquivo {
  const raiz = obj(json);
  const palavras: PalavraTranscrita[] = [];
  const resultados = Array.isArray(raiz?.results) ? raiz.results : [];
  for (const r of resultados) {
    const alts = obj(r)?.alternatives;
    const alt = Array.isArray(alts) ? obj(alts[0]) : null;
    const words = Array.isArray(alt?.words) ? alt.words : [];
    for (const w of words) {
      const p = obj(w);
      const texto = typeof p?.word === "string" ? p.word.trim() : "";
      const inicioMs = duracaoParaMs(p?.startOffset);
      const fimMs = duracaoParaMs(p?.endOffset);
      if (!texto || inicioMs === null || fimMs === null) continue;
      palavras.push({ texto, inicioMs, fimMs: Math.max(inicioMs, fimMs) });
    }
  }
  const cobrado = obj(raiz?.metadata)?.totalBilledDuration;
  const cobradoMs = cobrado === undefined ? null : duracaoParaMs(cobrado);
  return { palavras, cobradoMs };
}

/** 400 do Google: duração acima do síncrono → longo; codificação → nao_suportado; outro → entrada_invalida. Só lê a mensagem para classificar. */
export function classificar400(mensagem: string): "longo" | "nao_suportado" | null {
  if (/(duration|too long|longer than|maximum of \d+ seconds|exceeds.*(second|limit|size)|payload size)/i.test(mensagem)) return "longo";
  if (/(encoding|decod|unsupported|not supported|audio format|invalid audio|could not (read|parse) audio)/i.test(mensagem)) return "nao_suportado";
  return null;
}

async function mensagemDoErro(r: Response): Promise<string> {
  try {
    const j: unknown = await r.json();
    const m = obj(obj(j)?.error)?.message;
    return typeof m === "string" ? m : "";
  } catch {
    return "";
  }
}

export function criarTranscritorDeArquivoGoogle(o: OpcoesTranscricaoArquivoGoogle): TranscritorDeArquivo {
  const fetchImpl = o.fetchImpl ?? fetch;
  const regiao = o.regiao?.trim() || REGIAO_STT_ARQUIVO_PADRAO;
  const modelo = o.modelo?.trim() || MODELO_STT_ARQUIVO_PADRAO;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_STT_ARQUIVO_MS;

  function falhar(codigo: string, status: number | null, e: Error): never {
    log("aviso", "voz_stt_arquivo_falhou", { provedor: "google", modelo, codigo, status });
    throw e;
  }

  return {
    id: "google",
    modelo,
    async transcrever(p: PedidoTranscricaoArquivo) {
      if (!o.projeto) falhar("integracao_nao_configurada", null, new ErroDeDominio("integracao_nao_configurada"));
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await o.token()}`,
        "Content-Type": "application/json; charset=utf-8",
        "x-goog-user-project": o.projeto,
      };
      const sinais = [AbortSignal.timeout(timeoutMs)];
      if (p.sinal) sinais.push(p.sinal);
      let r: Response;
      try {
        r = await fetchImpl(urlRecognizeV2(o.projeto, regiao), {
          method: "POST",
          headers,
          body: JSON.stringify(montarCorpoRecognize(p.bytes, modelo, p.idioma)),
          signal: AbortSignal.any(sinais),
        });
      } catch (e) {
        if (p.sinal?.aborted) throw e;
        falhar("conector_indisponivel", null, new ErroDeDominio("conector_indisponivel", { cause: new Error(e instanceof Error ? e.name : "rede") }));
      }
      if (r.status === 401 || r.status === 403) {
        log("erro", "voz_stt_arquivo_autenticacao", { provedor: "google", modelo, status: r.status });
        throw new ErroDeDominio("integracao_autenticacao", { cause: new Error(`stt arquivo ${r.status}`) });
      }
      if (r.status === 429 || r.status >= 500) falhar("conector_indisponivel", r.status, new ErroDeDominio("conector_indisponivel", { cause: new Error(`stt arquivo ${r.status}`) }));
      if (r.status === 400) {
        const motivo = classificar400(await mensagemDoErro(r));
        if (motivo) falhar(motivo, 400, new RecusaDoArquivo(motivo));
        falhar("entrada_invalida", 400, new ErroDeDominio("entrada_invalida", { cause: new Error("stt arquivo 400") }));
      }
      if (!r.ok) falhar("conector_indisponivel", r.status, new ErroDeDominio("conector_indisponivel", { cause: new Error(`stt arquivo ${r.status}`) }));
      let json: unknown;
      try {
        json = await r.json();
      } catch {
        falhar("conector_indisponivel", r.status, new ErroDeDominio("conector_indisponivel", { cause: new Error("stt arquivo json") }));
      }
      return lerRespostaRecognize(json);
    },
  };
}
