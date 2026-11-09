import { connect, constants, type ClientHttp2Session } from "node:http2";
import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";

/**
 * Streaming do TTS Chirp 3 HD (definido em 2026-10-04, emenda da ADR-071). O Cloud Text-to-Speech só tem streaming
 * por gRPC (`StreamingSynthesize`, bidirecional); aqui o gRPC vai direto sobre `node:http2`, com as três mensagens
 * protobuf escritas à mão — sem `@grpc/grpc-js`, como o STT fala a Live API em WebSocket cru (google-transcricao.ts).
 *
 * O fluxo de um pedido: a primeira mensagem leva só a configuração (voz, PCM 24 kHz), a segunda só o texto, e a
 * escrita fecha em seguida; o servidor devolve o áudio em pedaços conforme sintetiza e encerra com `grpc-status` nos
 * trailers. Um fluxo por trecho da fila do orquestrador.
 *
 * Números de campo conferidos em 2026-10-04 em google/cloud/texttospeech/v1/cloud_tts.proto (googleapis, master):
 *   StreamingSynthesizeRequest  { streaming_config = 1; input = 2 }
 *   StreamingSynthesizeConfig   { voice = 1; streaming_audio_config = 4 }
 *   VoiceSelectionParams        { language_code = 1; name = 2 }
 *   StreamingAudioConfig        { audio_encoding = 1; sample_rate_hertz = 2; speaking_rate = 3 (double) }
 *   StreamingSynthesisInput     { text = 1 }
 *   StreamingSynthesizeResponse { audio_content = 1 }     AudioEncoding.PCM = 7 (LINEAR16 não vale no streaming)
 */
export const ORIGEM_TTS_GOOGLE = "https://texttospeech.googleapis.com";
export const CAMINHO_STREAMING = "/google.cloud.texttospeech.v1.TextToSpeech/StreamingSynthesize";
const AUDIO_ENCODING_PCM = 7;

// ---- protobuf mínimo: só o que as mensagens acima usam -----------------------------------------------------------------

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

const junta = (...partes: (Uint8Array | number[])[]): Uint8Array => Uint8Array.from(partes.flatMap((p) => [...p]));
/** Campo de bytes, string ou mensagem (wire type 2). */
const campoBytes = (campo: number, valor: Uint8Array): Uint8Array => junta(varint((campo << 3) | 2), varint(valor.length), valor);
const campoTexto = (campo: number, valor: string): Uint8Array => campoBytes(campo, new TextEncoder().encode(valor));
/** Campo inteiro (wire type 0). */
const campoInt = (campo: number, valor: number): Uint8Array => junta(varint(campo << 3), varint(valor));
/** Campo double (wire type 1, 8 bytes little-endian). */
function campoDouble(campo: number, valor: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, valor, true);
  return junta(varint((campo << 3) | 1), b);
}

/** A primeira mensagem do fluxo: só a configuração. `velocidade` 1 não vai (é o padrão do servidor). */
export function pedidoDeConfig(p: { voz: string; idioma: string; velocidade: number }): Uint8Array {
  const voz = junta(campoTexto(1, p.idioma), campoTexto(2, p.voz));
  const audio = junta(campoInt(1, AUDIO_ENCODING_PCM), campoInt(2, TAXA_VOZ_HZ), p.velocidade === 1 ? [] : campoDouble(3, p.velocidade));
  const config = junta(campoBytes(1, voz), campoBytes(4, audio));
  return campoBytes(1, config);
}

/** A segunda mensagem: só o texto a sintetizar. */
export function pedidoDeTexto(texto: string): Uint8Array {
  return campoBytes(2, campoTexto(1, texto));
}

/** O `audio_content` (campo 1) de uma `StreamingSynthesizeResponse`; os outros campos são pulados. */
export function audioDaResposta(msg: Uint8Array): Uint8Array {
  let i = 0;
  const lerVarint = (): number => {
    let v = 0;
    let mult = 1;
    for (;;) {
      const b = msg[i++];
      if (b === undefined) throw new Error("protobuf truncado");
      v += (b & 0x7f) * mult;
      if (b < 0x80) return v;
      mult *= 128;
    }
  };
  let audio: Uint8Array = new Uint8Array(0);
  while (i < msg.length) {
    const tag = lerVarint();
    const tipo = tag & 7;
    if (tipo === 0) lerVarint();
    else if (tipo === 1) i += 8;
    else if (tipo === 5) i += 4;
    else if (tipo === 2) {
      const n = lerVarint();
      if (i + n > msg.length) throw new Error("protobuf truncado");
      if (tag >> 3 === 1) audio = msg.subarray(i, i + n);
      i += n;
    } else throw new Error(`protobuf: wire type ${tipo}`);
  }
  return audio;
}

// ---- quadros gRPC: 1 byte de compressão + 4 bytes de tamanho (big-endian) + mensagem --------------------------------------

export function quadroGrpc(msg: Uint8Array): Uint8Array {
  const q = new Uint8Array(5 + msg.length);
  new DataView(q.buffer).setUint32(1, msg.length, false);
  q.set(msg, 5);
  return q;
}

/** Remonta as mensagens gRPC de um fluxo de bytes: uma mensagem pode vir partida entre vários pedaços da rede. */
export function criarLeitorGrpc(): { alimentar(b: Uint8Array): Uint8Array[] } {
  let resto: Uint8Array = new Uint8Array(0);
  return {
    alimentar(b) {
      const junto = new Uint8Array(resto.length + b.length);
      junto.set(resto);
      junto.set(b, resto.length);
      const prontas: Uint8Array[] = [];
      let i = 0;
      while (junto.length - i >= 5) {
        if (junto[i] !== 0) throw new Error("grpc: mensagem comprimida");
        const n = new DataView(junto.buffer, junto.byteOffset + i + 1, 4).getUint32(0, false);
        if (junto.length - i - 5 < n) break;
        prontas.push(junto.subarray(i + 5, i + 5 + n));
        i += 5 + n;
      }
      resto = junto.subarray(i);
      return prontas;
    },
  };
}

// ---- transporte: injetável (o HTTP/2 em produção, um falso nos testes) ----------------------------------------------------

export type FimDoFluxo = { httpStatus: number | null; grpcStatus: number | null };
export type EventosFluxoGrpc = {
  aoDado(b: Uint8Array): void;
  /** O fluxo acabou; `grpcStatus` 0 é sucesso, null é fim sem trailers. */
  aoFim(fim: FimDoFluxo): void;
  aoErro(e: Error): void;
};
/** `enviarTudo`: escreve os quadros e fecha a escrita de uma vez (o fim do envio vai junto com o último quadro). */
export type FluxoGrpc = { enviarTudo(quadros: readonly Uint8Array[]): void; cancelar(): void };
export type TransporteGrpc = {
  abrir(caminho: string, headers: Record<string, string>, ev: EventosFluxoGrpc): FluxoGrpc;
  /** Larga a sessão atual (parecia morta): o próximo fluxo abre outra. */
  reiniciar(): void;
  fechar(): void;
};

const numero = (v: unknown): number | null => {
  const s = Array.isArray(v) ? v[0] : v;
  const n = typeof s === "string" || typeof s === "number" ? Number(s) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Uma sessão HTTP/2 reaproveitada por todos os fluxos (sem novo TLS a cada trecho). GOAWAY, erro ou fechamento largam
 * a sessão, e o fluxo seguinte abre outra; quem decide que a sessão morreu calada é o prazo de primeiro áudio de quem
 * usa (`reiniciar`).
 */
export function criarTransporteHttp2(origem: string = ORIGEM_TTS_GOOGLE): TransporteGrpc {
  let sessao: ClientHttp2Session | null = null;
  let abertos = 0;
  const largar = (s: ClientHttp2Session) => {
    if (sessao === s) sessao = null;
  };
  const obterSessao = (): ClientHttp2Session => {
    if (sessao && !sessao.closed && !sessao.destroyed) return sessao;
    const s = connect(origem);
    s.on("goaway", () => largar(s));
    s.on("close", () => largar(s));
    s.on("error", () => largar(s));
    sessao = s;
    return s;
  };
  return {
    abrir(caminho, headers, ev) {
      let acabou = false;
      let grpcStatus: number | null = null;
      let httpStatus: number | null = null;
      // A sessão só segura o processo vivo enquanto há fluxo aberto; ociosa, não impede o servidor de encerrar.
      const s = obterSessao();
      s.ref();
      let solto = false;
      const soltar = () => {
        if (solto) return;
        solto = true;
        if (--abertos === 0 && sessao === s) s.unref();
      };
      abertos++;
      const fim = () => {
        soltar();
        if (acabou) return;
        acabou = true;
        ev.aoFim({ httpStatus, grpcStatus });
      };
      const fluxo = s.request({ ":method": "POST", ":path": caminho, "content-type": "application/grpc", te: "trailers", "grpc-accept-encoding": "identity", ...headers });
      fluxo.on("response", (h) => {
        httpStatus = numero(h[":status"]);
        // Erro sem corpo: o `grpc-status` vem já nos headers ("trailers-only").
        grpcStatus = numero(h["grpc-status"]) ?? grpcStatus;
      });
      fluxo.on("trailers", (t) => {
        grpcStatus = numero(t["grpc-status"]) ?? grpcStatus;
      });
      fluxo.on("data", (b: Buffer) => {
        if (!acabou) ev.aoDado(b);
      });
      fluxo.on("end", fim);
      fluxo.on("close", fim);
      fluxo.on("error", (e: Error) => {
        soltar();
        if (acabou) return;
        acabou = true;
        ev.aoErro(e);
      });
      return {
        enviarTudo: (quadros) => void fluxo.end(Buffer.concat(quadros)),
        cancelar() {
          acabou = true;
          fluxo.close(constants.NGHTTP2_CANCEL);
        },
      };
    },
    reiniciar() {
      const s = sessao;
      sessao = null;
      s?.destroy();
    },
    fechar() {
      const s = sessao;
      sessao = null;
      s?.close();
    },
  };
}

// ---- o pedido de síntese ----------------------------------------------------------------------------------------------

/** O streaming falhou antes de qualquer áudio: quem chamou ainda pode sintetizar por outro caminho (REST). */
export class FalhaAntesDoAudio extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(`streaming sem áudio: ${motivo}`);
    this.name = "FalhaAntesDoAudio";
    this.motivo = motivo;
  }
}

/** O streaming caiu com áudio já entregue: não há como refazer o trecho sem repetir o que a pessoa já ouviu. */
export class FalhaNoMeioDoAudio extends Error {
  readonly motivo: string;
  constructor(motivo: string) {
    super(`streaming interrompido: ${motivo}`);
    this.name = "FalhaNoMeioDoAudio";
    this.motivo = motivo;
  }
}

export type PedidoStreaming = {
  texto: string;
  /** Nome da voz no provedor ("pt-BR-Chirp3-HD-Erinome"). */
  voz: string;
  velocidade: number;
  token: string;
  projeto: string | null;
  sinal?: AbortSignal;
  /** Sem áudio neste prazo, o fluxo é cancelado e a sessão largada. */
  prazoPrimeiroAudioMs: number;
  /** O primeiro pedaço só sai com este tanto de áudio junto (ou no fim do fluxo): o app não fica sem o que tocar. */
  folgaInicialMs: number;
  /** Tamanho dos pedaços devolvidos. */
  amostrasPorPedaco: number;
};

type Evento = { tipo: "dado"; bytes: Uint8Array } | { tipo: "fim"; fim: FimDoFluxo } | { tipo: "erro"; erro: Error } | { tipo: "prazo" } | { tipo: "abortado" };

/**
 * Sintetiza um trecho em streaming: PCM16 mono 24 kHz em pedaços, conforme o servidor entrega. Abortar pelo `sinal`
 * encerra sem erro. Lança `FalhaAntesDoAudio` (prazo, erro de rede, `grpc-status` ≠ 0, fluxo vazio) ou
 * `FalhaNoMeioDoAudio`.
 */
export async function* sintetizarEmStreaming(transporte: TransporteGrpc, p: PedidoStreaming): AsyncGenerator<Int16Array> {
  if (p.sinal?.aborted) return;
  const fila: Evento[] = [];
  let acordar: (() => void) | null = null;
  const por = (e: Evento) => {
    fila.push(e);
    const fn = acordar;
    acordar = null;
    fn?.();
  };
  const headers: Record<string, string> = { authorization: `Bearer ${p.token}` };
  if (p.projeto) headers["x-goog-user-project"] = p.projeto;
  const fluxo = transporte.abrir(CAMINHO_STREAMING, headers, {
    aoDado: (bytes) => por({ tipo: "dado", bytes }),
    aoFim: (fim) => por({ tipo: "fim", fim }),
    aoErro: (erro) => por({ tipo: "erro", erro }),
  });
  const aoAbortar = () => por({ tipo: "abortado" });
  p.sinal?.addEventListener("abort", aoAbortar, { once: true });
  const prazo = setTimeout(() => por({ tipo: "prazo" }), p.prazoPrimeiroAudioMs);
  prazo.unref?.();
  const leitor = criarLeitorGrpc();
  // Bytes ainda não devolvidos: o áudio chega em pedaços de tamanho qualquer (até ímpar), e sai em pedaços inteiros.
  let pendente: Uint8Array = new Uint8Array(0);
  let saiuAudio = false;
  let recebeuAudio = false;
  const bytesPorPedaco = p.amostrasPorPedaco * 2;
  const bytesDeFolga = Math.round((p.folgaInicialMs * TAXA_VOZ_HZ) / 1000) * 2;
  function* drenar(tudo: boolean): Generator<Int16Array> {
    while (pendente.length >= bytesPorPedaco || (tudo && pendente.length >= 2)) {
      const n = Math.min(bytesPorPedaco, pendente.length - (pendente.length % 2));
      const copia = pendente.slice(0, n);
      pendente = pendente.subarray(n);
      saiuAudio = true;
      yield new Int16Array(copia.buffer, copia.byteOffset, n / 2);
    }
  }
  try {
    fluxo.enviarTudo([quadroGrpc(pedidoDeConfig({ voz: p.voz, idioma: "pt-BR", velocidade: p.velocidade })), quadroGrpc(pedidoDeTexto(p.texto))]);
    for (;;) {
      const ev = fila.shift();
      if (!ev) {
        await new Promise<void>((r) => {
          acordar = r;
        });
        continue;
      }
      if (ev.tipo === "abortado") return;
      if (ev.tipo === "prazo") {
        if (recebeuAudio) continue;
        transporte.reiniciar();
        throw new FalhaAntesDoAudio("prazo");
      }
      if (ev.tipo === "erro") {
        if (p.sinal?.aborted) return;
        throw saiuAudio ? new FalhaNoMeioDoAudio("rede") : new FalhaAntesDoAudio("rede");
      }
      if (ev.tipo === "dado") {
        let mensagens: Uint8Array[];
        try {
          mensagens = leitor.alimentar(ev.bytes);
        } catch {
          throw saiuAudio ? new FalhaNoMeioDoAudio("quadro") : new FalhaAntesDoAudio("quadro");
        }
        for (const m of mensagens) {
          const audio = audioDaResposta(m);
          if (audio.length === 0) continue;
          recebeuAudio = true;
          const junto = new Uint8Array(pendente.length + audio.length);
          junto.set(pendente);
          junto.set(audio, pendente.length);
          pendente = junto;
        }
        // A folga só vale para o começo: depois do primeiro pedaço, sai o que chegar.
        if (saiuAudio || pendente.length >= bytesDeFolga) yield* drenar(false);
        continue;
      }
      // fim do fluxo
      const ok = ev.fim.grpcStatus === 0 && (ev.fim.httpStatus === null || ev.fim.httpStatus === 200);
      if (!ok) {
        const motivo = `grpc_${ev.fim.grpcStatus ?? "sem_status"}_http_${ev.fim.httpStatus ?? "sem_status"}`;
        if (!saiuAudio) throw new FalhaAntesDoAudio(motivo);
        throw new FalhaNoMeioDoAudio(motivo);
      }
      if (!recebeuAudio) throw new FalhaAntesDoAudio("vazio");
      yield* drenar(true);
      return;
    }
  } finally {
    clearTimeout(prazo);
    p.sinal?.removeEventListener("abort", aoAbortar);
    // Sair antes do fim (abortado, erro, quem consumia parou): o fluxo não fica aberto no servidor.
    fluxo.cancelar();
  }
}
