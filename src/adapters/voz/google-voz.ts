import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { fatiar, lerWav, misturarParaMono, reamostrar, bytesParaPcm } from "./audio.ts";
import { vozDoProvedor } from "./catalogo-vozes.ts";
import { FalhaAntesDoAudio, sintetizarEmStreaming, type TransporteGrpc } from "./google-voz-streaming.ts";
import type { PedidoTts, Sintetizador } from "./spi.ts";

/**
 * TTS Chirp 3 HD (definido em 2026-10-04, ADR-071). Uma frase por pedido (o orquestrador já fatia em trechos).
 *
 * Dois caminhos: o streaming (gRPC sobre HTTP/2, google-voz-streaming.ts), que devolve áudio conforme sintetiza, e o
 * REST `text:synthesize`, que só devolve a frase inteira. Com `streaming` nas opções, o REST vira a rede de segurança:
 * entra quando o streaming falha antes de entregar qualquer áudio, e direto por 5 min depois de 3 falhas seguidas.
 *
 * Medido em 2026-10-04 (scripts/voz/sonda-tts-streaming.ts, de um Mac no Brasil, voz Erinome): primeiro áudio do REST
 * em 1,2–2,8 s; do streaming, metade das vezes em ~0,35 s e metade em ~1,2 s — o endpoint global alterna entre dois
 * grupos de servidores, e não há como escolher (o endpoint `us-` fica fixo em ~0,87 s, o `eu-` em ~1,7 s, e não existe
 * um regional de São Paulo para este método). Pedidos simultâneos na mesma sessão não mudam isso de forma estável:
 * com 6 juntos, duas rodadas deram 36/48 e 11/24 na faixa rápida, e 2/48 e 0/24 acima de 2 s. A síntese inteira sai
 * 5 a 8 vezes mais rápido que a fala, com no máximo ~120 ms entre pedaços.
 *
 * A confirmar: `speaking_rate` honrado no streaming (o campo existe no proto) e se cada fluxo conta na cota de 200
 * pedidos por minuto. Enquanto isso, o limitador (limitador-tts.ts) conta cada fluxo e cada pedido REST como um
 * pedido, o caso mais conservador; a sonda `scripts/voz/sonda-google.ts --cota` responde a dúvida.
 */
export const URL_TTS_GOOGLE = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** definido em 2026-10-04: 100 ms por pedaço (2400 amostras a 24 kHz), o mesmo do `say` e do falso. */
const AMOSTRAS_POR_PEDACO = (100 * TAXA_VOZ_HZ) / 1000;
/** definido em 2026-10-04: uma nova tentativa em 429/5xx/rede, depois de 300 ms; depois erro (plano, "Operação"). */
const ESPERA_NOVA_TENTATIVA_MS = 300;
const TIMEOUT_PEDIDO_MS = 15_000;
/**
 * definido em 2026-10-04: sem áudio do streaming em 3 s, cai no REST. Com pedidos simultâneos a sonda viu o primeiro
 * áudio chegar a 2,1 s, e no UAT um fluxo estourou os 2,5 s que valiam antes; esperar um fluxo lento custa menos que
 * desistir dele e pedir tudo de novo pelo REST.
 */
export const PRAZO_PRIMEIRO_AUDIO_MS = 3_000;
/**
 * definido em 2026-10-04: o primeiro pedaço do streaming só sai com 400 ms de áudio juntos. O app dá a fala por
 * terminada com 200 ms de fila vazia, e o UAT viu um intervalo de 332 ms entre dois pedaços. Como a síntese anda 5 a
 * 8 vezes mais rápido que a fala, juntar 400 ms custa ~70 ms de espera.
 */
export const FOLGA_INICIAL_MS = 400;
/** definido em 2026-10-04: 3 falhas seguidas do streaming antes do áudio → só REST por 5 min. */
const FALHAS_PARA_ABRIR = 3;
const DISJUNTOR_MS = 5 * 60_000;

export type OpcoesGoogleVoz = {
  token: () => Promise<string>;
  projeto: string | null;
  fetchImpl?: typeof fetch;
  url?: string;
  /**
   * Com o limitador da cota (limitador-tts.ts): o decorator já pegou a vaga do primeiro pedido HTTP; cada pedido a
   * mais dentro do mesmo `sintetizar` (o REST depois do streaming, a nova tentativa) pede outra aqui. `false`: o pedido
   * foi cancelado ou descartado na fila.
   */
  vagaExtra?: (p: PedidoTts) => Promise<boolean>;
  /** Liga o caminho de streaming; sem isto, só REST. */
  streaming?: { transporte: TransporteGrpc; prazoPrimeiroAudioMs?: number; folgaInicialMs?: number; agora?: () => number };
};

class Transitorio extends Error {}

function abortado(sinal: AbortSignal | undefined, e: unknown): boolean {
  return sinal?.aborted === true || (e instanceof Error && e.name === "AbortError" && sinal !== undefined);
}

export function criarSintetizadorGoogle(o: OpcoesGoogleVoz): Sintetizador {
  const fetchImpl = o.fetchImpl ?? fetch;
  const url = o.url ?? URL_TTS_GOOGLE;

  async function pedir(p: PedidoTts): Promise<Buffer> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await o.token()}`, "Content-Type": "application/json; charset=utf-8" };
    if (o.projeto) headers["x-goog-user-project"] = o.projeto;
    const corpo = {
      input: { text: p.texto },
      voice: { languageCode: "pt-BR", name: vozDoProvedor("google", p.voz) },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: TAXA_VOZ_HZ, speakingRate: p.velocidade },
    };
    const sinais = [AbortSignal.timeout(TIMEOUT_PEDIDO_MS)];
    if (p.sinal) sinais.push(p.sinal);
    let r: Response;
    try {
      r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(corpo), signal: AbortSignal.any(sinais) });
    } catch (e) {
      if (abortado(p.sinal, e)) throw e;
      throw new Transitorio("rede", { cause: e });
    }
    if (r.status === 429 || r.status >= 500) throw new Transitorio(String(r.status));
    if (r.status === 401 || r.status === 403) throw new ErroDeDominio("integracao_autenticacao", { cause: new Error(`tts ${r.status}`) });
    if (r.status === 400) throw new ErroDeDominio("entrada_invalida", { cause: new Error("tts 400") });
    if (!r.ok) throw new ErroDeDominio("conector_indisponivel", { cause: new Error(`tts ${r.status}`) });
    const json: unknown = await r.json();
    const b64 = typeof json === "object" && json !== null && "audioContent" in json && typeof json.audioContent === "string" ? json.audioContent : "";
    if (!b64) throw new ErroDeDominio("conector_indisponivel", { cause: new Error("tts sem audioContent") });
    return Buffer.from(b64, "base64");
  }

  const agora = o.streaming?.agora ?? Date.now;
  let falhasSeguidas = 0;
  let soRestAte = 0;

  return {
    id: "google",
    capacidades: { streaming: o.streaming !== undefined, velocidade: true },
    async *sintetizar(p: PedidoTts) {
      if (p.sinal?.aborted) return;
      let pedidos = 0;
      if (o.streaming && agora() >= soRestAte) {
        let token: string | null = null;
        try {
          token = await o.token();
        } catch {
          // sem token o REST abaixo falha do mesmo jeito, e é ele que classifica e registra o erro
        }
        if (p.sinal?.aborted) return;
        if (token !== null) {
          pedidos++;
          try {
            yield* sintetizarEmStreaming(o.streaming.transporte, {
              texto: p.texto,
              voz: vozDoProvedor("google", p.voz),
              velocidade: p.velocidade,
              token,
              projeto: o.projeto,
              sinal: p.sinal,
              prazoPrimeiroAudioMs: o.streaming.prazoPrimeiroAudioMs ?? PRAZO_PRIMEIRO_AUDIO_MS,
              folgaInicialMs: o.streaming.folgaInicialMs ?? FOLGA_INICIAL_MS,
              amostrasPorPedaco: AMOSTRAS_POR_PEDACO,
            });
            falhasSeguidas = 0;
            return;
          } catch (e) {
            if (abortado(p.sinal, e)) return;
            if (!(e instanceof FalhaAntesDoAudio)) {
              // Já saiu áudio: refazer o trecho repetiria o que a pessoa ouviu.
              log("aviso", "voz_tts_falhou", { provedor: "google", codigo: "streaming_interrompido" });
              throw new ErroDeDominio("conector_indisponivel", { cause: e });
            }
            falhasSeguidas++;
            if (falhasSeguidas >= FALHAS_PARA_ABRIR) soRestAte = agora() + DISJUNTOR_MS;
            log("aviso", "voz_tts_streaming_falhou", { provedor: "google", motivo: e.motivo, falhas_seguidas: falhasSeguidas, so_rest: falhasSeguidas >= FALHAS_PARA_ABRIR });
          }
        }
      }
      let bytes: Buffer | null = null;
      for (let tentativa = 1; bytes === null; tentativa++) {
        if (pedidos > 0 && o.vagaExtra && !(await o.vagaExtra(p))) return;
        pedidos++;
        try {
          bytes = await pedir(p);
        } catch (e) {
          if (abortado(p.sinal, e)) return;
          if (!(e instanceof Transitorio)) {
            log("aviso", "voz_tts_falhou", { provedor: "google", codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
            throw e;
          }
          log("aviso", "voz_tts_transitorio", { provedor: "google", motivo: e.message, tentativa });
          if (tentativa >= 2) throw new ErroDeDominio("conector_indisponivel", { cause: e });
          await new Promise((r) => setTimeout(r, ESPERA_NOVA_TENTATIVA_MS));
          if (p.sinal?.aborted) return;
        }
      }
      // LINEAR16 vem com cabeçalho WAV; sem ele (resposta crua), trata como PCM 24 kHz mono
      let pcm: Int16Array;
      if (bytes.toString("ascii", 0, 4) === "RIFF") {
        const wav = lerWav(bytes);
        const mono = misturarParaMono(wav.pcm, wav.canais);
        pcm = wav.taxa === TAXA_VOZ_HZ ? mono : reamostrar(mono, wav.taxa, TAXA_VOZ_HZ);
      } else {
        pcm = bytesParaPcm(bytes);
      }
      for (const pedaco of fatiar(pcm, AMOSTRAS_POR_PEDACO)) {
        if (p.sinal?.aborted) return;
        yield pedaco;
      }
    },
  };
}
