import type { MsgDitadoCliente } from "../../src/contracts/ditado.ts";
import { energiaPcm, lerMsgDitado, type EventoDitado, type FalhaDitado } from "./ditado-protocolo.ts";
import { quadroMicrofone, VERSAO_PROTOCOLO } from "./ligacao-protocolo.ts";
// O mesmo worklet de captura da ligação (definido em 2026-10-11, ADR-095): reamostra para 16 kHz e entrega quadros de
// 20 ms; a porta para o worklet de toque é opcional, e no ditado não existe.
import urlCaptura from "./ligacao-captura.worklet.ts?worker&url";

/**
 * Motor do ditado no renderer (definido em 2026-10-11, ADR-095): microfone → worklet de captura → canal
 * `/api/t/:tenant/voz/v1/ditado`. Não desenha nada: a tela (web/telas/ditado.ts) recebe os eventos.
 *
 * - O `AudioContext` nasce e é retomado DENTRO do toque no microfone (o Safari do iPhone só libera áudio no gesto).
 * - Os quadros que chegam antes do `pronto` (o STT do servidor ainda abrindo) ficam guardados e saem de uma vez.
 * - `concluir` para o microfone na hora e espera o texto; `descartar` fecha tudo e não devolve nada.
 */

export type MotorDitado = {
  /** ■ (`campo`) ou ↑ (`enviar`): para o microfone e pede o texto. */
  concluir(destino: "campo" | "enviar"): void;
  /** Esc, troca de conversa, tela bloqueada: fecha tudo sem texto. */
  descartar(): void;
};

export type OpcoesDitado = {
  tenantId: string;
  aoEvento: (ev: EventoDitado) => void;
  /** Antes de abrir o canal (o consentimento gravando no servidor): o microfone já abre, o canal espera. */
  antesDeConectar?: Promise<unknown>;
};

/** definido em 2026-10-11: até 5 s de quadros guardados antes do `pronto` (250 × 20 ms); o resto se perde. */
const GUARDADOS_MAX = 250;
/** Com mais que isto parado no socket (rede lenta), o quadro é descartado em vez de acumular atraso (como na ligação). */
const ATRASO_MAX_BYTES = 32 * 1024;
/**
 * definido em 2026-10-11: o texto tem de chegar em 15 s depois do clique. O servidor espera os finais por até 6 s
 * (`PRAZO_FINAIS_MS`); o resto é folga para a rede.
 */
const PRAZO_TEXTO_MS = 15_000;
/**
 * definido em 2026-10-11: depois de liberado, o microfone tem 8 s para mandar o primeiro quadro (o worklet ainda carrega).
 * Sem isso, um aparelho que abre mas não manda som deixaria a tela em "Abrindo o microfone…" para sempre.
 */
const PRAZO_PRIMEIRO_QUADRO_MS = 8_000;
/** O nível pulsa a cada 4 quadros (80 ms): mais que isso só redesenha à toa. */
const QUADROS_POR_NIVEL = 4;

const RESTRICOES_AUDIO = { noiseSuppression: true, autoGainControl: true, channelCount: 1, echoCancellation: true } as const;

export function iniciarDitado(o: OpcoesDitado): MotorDitado {
  let acabou = false;
  let pronto = false;
  let concluido: "campo" | "enviar" | null = null;
  let ws: WebSocket | null = null;
  let seq = 0;
  let quadros = 0;
  let microfone: MediaStream | null = null;
  let captura: AudioWorkletNode | null = null;
  let prazoTexto: number | null = null;
  let prazoMicrofone: number | null = null;
  const guardados: Int16Array[] = [];

  // No gesto: o Safari do iPhone deixa o áudio suspenso para sempre se o contexto nascer fora do toque.
  const ctx = new AudioContext({ latencyHint: "interactive" });
  void ctx.resume().catch(() => undefined);

  const emitir = (ev: EventoDitado): void => {
    if (!acabou) o.aoEvento(ev);
  };
  const enviar = (m: MsgDitadoCliente): void => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  function pararMicrofone(): void {
    for (const tr of microfone?.getTracks() ?? []) tr.stop();
    microfone = null;
    captura?.port.close();
    captura?.disconnect();
    captura = null;
    void ctx.close().catch(() => undefined);
  }

  function encerrar(): void {
    if (acabou) return;
    acabou = true;
    pararMicrofone();
    if (prazoTexto !== null) window.clearTimeout(prazoTexto);
    if (prazoMicrofone !== null) window.clearTimeout(prazoMicrofone);
    const s = ws;
    ws = null;
    if (s && (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING)) s.close(1000);
  }

  function falhar(codigo: FalhaDitado): void {
    emitir({ t: "erro", codigo });
    encerrar();
  }

  function mandarQuadro(pcm: Int16Array): void {
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > ATRASO_MAX_BYTES) return;
    ws.send(quadroMicrofone(seq, pcm));
    seq = (seq + 1) >>> 0;
  }

  function aoQuadro(pcm: Int16Array): void {
    if (acabou || concluido) return;
    // O primeiro quadro prova que o microfone está mandando som: só então (e com o servidor pronto) a tela diz "Ouvindo…".
    if (quadros === 0) {
      if (prazoMicrofone !== null) window.clearTimeout(prazoMicrofone);
      prazoMicrofone = null;
      if (pronto) emitir({ t: "gravando" });
    }
    if (++quadros % QUADROS_POR_NIVEL === 0) emitir({ t: "nivel", valor: Math.min(1, energiaPcm(pcm) * 8) });
    if (pronto) return mandarQuadro(pcm);
    guardados.push(pcm);
    if (guardados.length > GUARDADOS_MAX) guardados.shift();
  }

  function aoPronto(): void {
    pronto = true;
    for (const q of guardados.splice(0)) mandarQuadro(q);
    if (concluido) enviar({ t: "concluir", destino: concluido });
    else if (quadros > 0) emitir({ t: "gravando" });
  }

  // ---- canal -------------------------------------------------------------------------------------------------------
  function conectar(): void {
    if (acabou) return;
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/t/${encodeURIComponent(o.tenantId)}/voz/v1/ditado`;
    const s = new WebSocket(url);
    s.binaryType = "arraybuffer";
    ws = s;
    s.onopen = () => {
      if (ws === s) enviar({ t: "ola", v: VERSAO_PROTOCOLO });
    };
    s.onmessage = (e: MessageEvent<unknown>) => {
      if (ws !== s || typeof e.data !== "string") return;
      const m = lerMsgDitado(e.data);
      if (!m) return;
      if (m.t === "pronto") aoPronto();
      else if (m.t === "texto") {
        emitir({ t: "texto", texto: m.texto, teto: m.teto === true });
        encerrar();
      } else falhar(m.codigo);
    };
    s.onclose = () => {
      if (ws === s) falhar("caiu");
    };
  }

  // ---- microfone ---------------------------------------------------------------------------------------------------
  async function abrirMicrofone(): Promise<void> {
    // O macOS pergunta antes do Chromium (no app): negado lá, getUserMedia nem chega a pedir.
    const acesso = await window.nodDesktop?.microfone?.().catch(() => undefined);
    if (acesso === "negado" || acesso === "restrito") return falhar(acesso === "negado" ? "microfone-negado" : "microfone-restrito");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: RESTRICOES_AUDIO });
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : "";
      return falhar(nome === "NotAllowedError" || nome === "SecurityError" ? "microfone-negado" : "microfone-indisponivel");
    }
    if (acabou || concluido) {
      for (const tr of stream.getTracks()) tr.stop();
      return;
    }
    microfone = stream;
    prazoMicrofone = window.setTimeout(() => {
      if (quadros === 0 && !concluido) falhar("microfone-indisponivel");
    }, PRAZO_PRIMEIRO_QUADRO_MS);
    await ctx.audioWorklet.addModule(urlCaptura);
    if (acabou || concluido) return;
    const cap = new AudioWorkletNode(ctx, "nod-ligacao-captura", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    // A captura não toca nada: a saída vai para um ganho zero só para o nó continuar sendo puxado pelo grafo.
    const mudoNoGrafo = ctx.createGain();
    mudoNoGrafo.gain.value = 0;
    cap.connect(mudoNoGrafo).connect(ctx.destination);
    cap.port.onmessage = (e: MessageEvent<{ tipo: string; pcm?: Int16Array }>) => {
      if (e.data.tipo === "quadro" && e.data.pcm) aoQuadro(e.data.pcm);
    };
    ctx.createMediaStreamSource(stream).connect(cap);
    captura = cap;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  }

  // Depois do ■/↑ o contexto já fechou: o worklet que ainda carregava falha por isso, e o texto que vem não é um erro.
  void abrirMicrofone().catch(() => {
    if (!concluido) falhar("microfone-indisponivel");
  });
  void Promise.resolve(o.antesDeConectar)
    .then(() => conectar())
    .catch(() => falhar("falhou"));

  return {
    concluir(destino) {
      if (acabou || concluido) return;
      concluido = destino;
      pararMicrofone();
      emitir({ t: "transcrevendo" });
      prazoTexto = window.setTimeout(() => falhar("falhou"), PRAZO_TEXTO_MS);
      if (pronto) enviar({ t: "concluir", destino });
    },
    descartar() {
      if (acabou) return;
      enviar({ t: "descartar" });
      encerrar();
    },
  };
}
