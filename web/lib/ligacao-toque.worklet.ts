import { dePcm16, Ganho, GANHO_ABAIXADO, MS_ABAIXAR, MS_BUFFER_INICIAL, MS_ESPERA_MAXIMA, MS_FADE_INTERROMPER, MS_RELATO_TOCADO, MS_SILENCIO_FIM, MS_SUBIR, Reamostrador } from "./ligacao-audio.ts";
import { TAXA_VOZ_HZ } from "./ligacao-protocolo.ts";

/**
 * Worklet de TOQUE da ligação (definido em 2026-10-04, ADR-071): a voz do bot toca NESTE AudioContext do renderer,
 * nunca pelo processo principal do Electron — é assim que o AEC do Chromium a usa como referência e tira o eco do
 * microfone. Recebe PCM16 a 24 kHz por fala (`utt`), reamostra para o contexto, segura 60–100 ms antes de começar, conta
 * o que já saiu no alto-falante (`tocado` a cada 250 ms, `tocou-fim`) e obedece `interromper` (fade de 15 ms e esvazia),
 * `abaixar` (30% em ≤50 ms, vindo direto do worklet de captura) e `subir`.
 */
declare const sampleRate: number;
declare function registerProcessor(nome: string, construtor: new () => AudioWorkletProcessor): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type Pedaco = { utt: number; amostras: Float32Array; pos: number };
type MsgParaToque =
  | { tipo: "voz"; utt: number; pcm: Int16Array }
  | { tipo: "interromper"; utt: number }
  | { tipo: "abaixar" }
  | { tipo: "subir" }
  | { tipo: "porta"; porta: MessagePort };

const amostrasDe = (ms: number): number => Math.round((ms / 1000) * sampleRate);
/** Abaixado sem notícia do servidor por 2 s, o volume volta sozinho (o `subir` pode ter se perdido numa reconexão). */
const MS_ABAIXADO_MAXIMO = 2_000;

class ToqueLigacao extends AudioWorkletProcessor {
  private readonly reamostrador = new Reamostrador(TAXA_VOZ_HZ, sampleRate);
  private fila: Pedaco[] = [];
  private naFila = 0;
  private tocando = false;
  private uttAtual = -1;
  private tocadoNaUtt = 0;
  private desdeRelato = 0;
  private esperando = 0;
  private silencio = 0;
  private abaixadoHa = -1;
  private readonly ganho = new Ganho();
  /** Fade de interrupção em curso: a utt que sai e quantas amostras faltam até o silêncio. */
  private saindo: { utt: number; restante: number; passo: number; fator: number } | null = null;
  /** Falas interrompidas: pedaço que chegar atrasado delas não toca. */
  private readonly descartadas = new Set<number>();
  private captura: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MsgParaToque>) => this.receber(e.data);
  }

  private receber(m: MsgParaToque): void {
    if (m.tipo === "porta") {
      this.captura = m.porta;
      this.captura.onmessage = (ev: MessageEvent<{ tipo: string }>) => { if (ev.data.tipo === "abaixar") this.abaixar(); };
    } else if (m.tipo === "voz") {
      if (this.descartadas.has(m.utt)) return;
      const amostras = this.reamostrador.processar(dePcm16(m.pcm));
      if (amostras.length === 0) return;
      this.fila.push({ utt: m.utt, amostras, pos: 0 });
      this.naFila += amostras.length;
    } else if (m.tipo === "interromper") this.interromper(m.utt);
    else if (m.tipo === "abaixar") this.abaixar();
    else if (m.tipo === "subir") this.subir();
  }

  private abaixar(): void {
    if (!this.tocando) return;
    this.ganho.rumo(GANHO_ABAIXADO, MS_ABAIXAR, sampleRate);
    this.abaixadoHa = 0;
  }

  private subir(): void {
    this.ganho.rumo(1, MS_SUBIR, sampleRate);
    this.abaixadoHa = -1;
  }

  private interromper(utt: number): void {
    this.descartadas.add(utt);
    if (this.descartadas.size > 64) this.descartadas.delete(this.descartadas.values().next().value as number);
    const tocandoEla = this.tocando && this.uttAtual === utt;
    if (!tocandoEla) {
      // Ainda não tocou (ou já acabou): sai da fila sem fade; o servidor recebe o que tinha saído (0 se nada).
      this.tirarDaFila(utt);
      this.port.postMessage({ tipo: "interrompido", utt, ms: this.uttAtual === utt ? this.ms(this.tocadoNaUtt) : 0 });
      return;
    }
    const restante = Math.max(1, amostrasDe(MS_FADE_INTERROMPER));
    this.saindo = { utt, restante, passo: 1 / restante, fator: 1 };
  }

  private tirarDaFila(utt: number): void {
    const ficam = this.fila.filter((p) => p.utt !== utt);
    this.naFila = ficam.reduce((n, p) => n + p.amostras.length - p.pos, 0);
    this.fila = ficam;
  }

  private ms(amostras: number): number {
    return Math.round((amostras / sampleRate) * 1000);
  }

  private falando(ativo: boolean): void {
    this.captura?.postMessage({ tipo: "falando", ativo });
    this.port.postMessage({ tipo: "falando", ativo });
  }

  private acabouUtt(): void {
    if (this.uttAtual >= 0 && !this.descartadas.has(this.uttAtual)) {
      this.port.postMessage({ tipo: "tocado", utt: this.uttAtual, ms: this.ms(this.tocadoNaUtt) });
      this.port.postMessage({ tipo: "tocou-fim", utt: this.uttAtual });
    }
  }

  private proximaAmostra(): number | null {
    let cabeca = this.fila[0];
    while (cabeca && cabeca.pos >= cabeca.amostras.length) {
      this.fila.shift();
      cabeca = this.fila[0];
    }
    if (!cabeca) return null;
    if (cabeca.utt !== this.uttAtual) {
      this.acabouUtt();
      this.uttAtual = cabeca.utt;
      this.tocadoNaUtt = 0;
      this.desdeRelato = 0;
    }
    const x = cabeca.amostras[cabeca.pos] ?? 0;
    cabeca.pos += 1;
    this.naFila -= 1;
    return x;
  }

  process(_entradas: Float32Array[][], saidas: Float32Array[][]): boolean {
    const saida = saidas[0];
    const canal0 = saida?.[0];
    if (!saida || !canal0) return true;
    const n = canal0.length;
    if (!this.tocando) {
      if (this.naFila > 0) this.esperando += n;
      if (this.naFila >= amostrasDe(MS_BUFFER_INICIAL) || (this.naFila > 0 && this.esperando >= amostrasDe(MS_ESPERA_MAXIMA))) {
        this.tocando = true;
        this.esperando = 0;
        this.silencio = 0;
        this.ganho.rumo(1, 1, sampleRate);
        this.falando(true);
      } else {
        for (const c of saida) c.fill(0);
        return true;
      }
    }
    for (let i = 0; i < n; i++) {
      let x = 0;
      if (this.saindo) {
        const amostra = this.proximaAmostra();
        x = (amostra ?? 0) * this.saindo.fator;
        this.saindo.fator = Math.max(0, this.saindo.fator - this.saindo.passo);
        if (amostra !== null) this.tocadoNaUtt += 1;
        this.saindo.restante -= 1;
        if (this.saindo.restante <= 0) {
          const utt = this.saindo.utt;
          this.saindo = null;
          this.tirarDaFila(utt);
          this.port.postMessage({ tipo: "interrompido", utt, ms: this.ms(this.tocadoNaUtt) });
        }
      } else {
        const amostra = this.proximaAmostra();
        if (amostra === null) {
          this.silencio += 1;
          if (this.silencio >= amostrasDe(MS_SILENCIO_FIM)) {
            this.acabouUtt();
            this.tocando = false;
            this.uttAtual = -1;
            this.tocadoNaUtt = 0;
            this.subir();
            this.falando(false);
            for (const c of saida) c.fill(0, i);
            return true;
          }
        } else {
          this.silencio = 0;
          this.tocadoNaUtt += 1;
          this.desdeRelato += 1;
          x = amostra;
        }
      }
      const g = this.ganho.proximo();
      for (const c of saida) c[i] = x * g;
    }
    if (this.abaixadoHa >= 0) {
      this.abaixadoHa += n;
      if (this.abaixadoHa >= amostrasDe(MS_ABAIXADO_MAXIMO)) this.subir();
    }
    if (this.desdeRelato >= amostrasDe(MS_RELATO_TOCADO) && this.uttAtual >= 0) {
      this.desdeRelato = 0;
      this.port.postMessage({ tipo: "tocado", utt: this.uttAtual, ms: this.ms(this.tocadoNaUtt) });
    }
    return true;
  }
}

registerProcessor("nod-ligacao-toque", ToqueLigacao);
