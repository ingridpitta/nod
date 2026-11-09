import { DetectorDeFala, energia, paraPcm16, Reamostrador } from "./ligacao-audio.ts";
import { AMOSTRAS_POR_QUADRO, TAXA_MICROFONE_HZ } from "./ligacao-protocolo.ts";

/**
 * Worklet de CAPTURA da ligação (definido em 2026-10-04, ADR-071): roda no thread de áudio, recebe o microfone já com
 * o AEC do Chromium, reamostra para 16 kHz e entrega quadros de 20 ms (320 amostras PCM16) ao thread principal. Quando
 * vê três quadros seguidos com energia (limiar maior enquanto o bot fala), manda "abaixar" DIRETO ao worklet de toque,
 * pela porta que os liga, sem passar pelo thread principal: o volume do bot cai em menos de 50 ms.
 *
 * Os tipos do AudioWorkletGlobalScope não estão nas libs do TypeScript 5.9; os três abaixo são o que este arquivo usa.
 */
declare const sampleRate: number;
declare function registerProcessor(nome: string, construtor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type MsgParaCaptura = { tipo: "porta"; porta: MessagePort } | { tipo: "mudo"; ativo: boolean };

class CapturaLigacao extends AudioWorkletProcessor {
  private readonly reamostrador = new Reamostrador(sampleRate, TAXA_MICROFONE_HZ);
  private readonly quadro = new Float32Array(AMOSTRAS_POR_QUADRO);
  private preenchido = 0;
  private readonly detector = new DetectorDeFala();
  private botFalando = false;
  private mudo = false;
  private toque: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MsgParaCaptura>) => {
      const m = e.data;
      if (m.tipo === "porta") {
        this.toque = m.porta;
        this.toque.onmessage = (ev: MessageEvent<{ tipo: string; ativo?: boolean }>) => {
          if (ev.data.tipo === "falando") this.botFalando = ev.data.ativo === true;
        };
      } else if (m.tipo === "mudo") this.mudo = m.ativo;
    };
  }

  process(entradas: Float32Array[][]): boolean {
    const canal = entradas[0]?.[0];
    if (!canal || canal.length === 0) return true;
    const novas = this.reamostrador.processar(canal);
    let i = 0;
    while (i < novas.length) {
      const cabe = Math.min(AMOSTRAS_POR_QUADRO - this.preenchido, novas.length - i);
      this.quadro.set(novas.subarray(i, i + cabe), this.preenchido);
      this.preenchido += cabe;
      i += cabe;
      if (this.preenchido === AMOSTRAS_POR_QUADRO) {
        this.fecharQuadro();
        this.preenchido = 0;
      }
    }
    return true;
  }

  private fecharQuadro(): void {
    if (this.mudo) return;
    const fala = this.detector.quadro(energia(this.quadro), this.botFalando);
    if (fala === "inicio") this.toque?.postMessage({ tipo: "abaixar" });
    if (fala) this.port.postMessage({ tipo: "fala", ativo: fala === "inicio" });
    const pcm = paraPcm16(this.quadro);
    this.port.postMessage({ tipo: "quadro", pcm }, [pcm.buffer]);
  }
}

registerProcessor("nod-ligacao-captura", CapturaLigacao);
