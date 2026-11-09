/**
 * O áudio da ligação sem navegador (definido em 2026-10-04, ADR-071): reamostragem, PCM16, energia e a detecção de que
 * a pessoa começou a falar. Os dois worklets (ligacao-captura e ligacao-toque) importam daqui; o vitest testa daqui.
 * Nada aqui toca DOM, rede ou relógio.
 */

/**
 * Reamostrador linear contínuo: guarda a última amostra e a fase entre blocos, então quadros consecutivos não estalam
 * na emenda. definido em 2026-10-04: linear basta para voz (o STT pede 16 kHz, a voz do bot vem a 24 kHz e o contexto
 * roda a 44,1 ou 48 kHz); o filtro antialias antes de descer para 16 kHz é uma média móvel de 3 pontos, barata e o
 * suficiente para fala (a energia acima de 8 kHz na voz é pequena). Medir com o corpus da fase 0 antes de trocar.
 */
export class Reamostrador {
  readonly deHz: number;
  readonly paraHz: number;
  private readonly passo: number;
  private fase = 0;
  private anterior = 0;
  private readonly suavizar: boolean;
  private s1 = 0;
  private s2 = 0;

  constructor(deHz: number, paraHz: number) {
    this.deHz = deHz;
    this.paraHz = paraHz;
    this.passo = deHz / paraHz;
    this.suavizar = paraHz < deHz;
  }

  processar(entrada: Float32Array): Float32Array {
    if (this.deHz === this.paraHz) return entrada.slice();
    const fonte = this.suavizar ? this.filtrar(entrada) : entrada;
    const saida: number[] = [];
    // `fase` é a posição da próxima amostra de saída, contada a partir da amostra anterior a este bloco (índice -1).
    let pos = this.fase;
    while (pos < fonte.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.anterior : (fonte[i - 1] ?? 0);
      const b = fonte[i] ?? 0;
      saida.push(a + (b - a) * frac);
      pos += this.passo;
    }
    this.fase = pos - fonte.length;
    this.anterior = fonte[fonte.length - 1] ?? this.anterior;
    return Float32Array.from(saida);
  }

  private filtrar(entrada: Float32Array): Float32Array {
    const saida = new Float32Array(entrada.length);
    for (let i = 0; i < entrada.length; i++) {
      const x = entrada[i] ?? 0;
      saida[i] = (x + this.s1 + this.s2) / 3;
      this.s2 = this.s1;
      this.s1 = x;
    }
    return saida;
  }
}

export function paraPcm16(f: Float32Array): Int16Array {
  const s = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const x = Math.max(-1, Math.min(1, f[i] ?? 0));
    s[i] = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
  }
  return s;
}

export function dePcm16(s: Int16Array): Float32Array {
  const f = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) f[i] = (s[i] ?? 0) / 0x8000;
  return f;
}

/** Energia RMS do quadro (0..1). */
export function energia(f: Float32Array): number {
  if (f.length === 0) return 0;
  let soma = 0;
  for (let i = 0; i < f.length; i++) soma += (f[i] ?? 0) * (f[i] ?? 0);
  return Math.sqrt(soma / f.length);
}

/**
 * Limiares da detecção de fala no cliente (definido em 2026-10-04, ponto de partida até a bancada de AEC da fase 0):
 * ~-42 dBFS com o bot calado e ~-30 dBFS com ele falando, porque o resto de eco que o AEC deixa passar não pode
 * abaixar a voz do bot sozinho. Três quadros seguidos (60 ms) disparam.
 */
export const LIMIAR_CALADO = 0.008;
export const LIMIAR_COM_BOT = 0.03;
export const QUADROS_PARA_DISPARAR = 3;
/** 300 ms abaixo do limiar depois de disparar = a pessoa parou (só para o indicador de quem fala; quem decide a vez é o servidor). */
export const QUADROS_PARA_CALAR = 15;

/**
 * Detecta o começo e o fim de uma fala da pessoa: "inicio" UMA vez, no terceiro quadro seguido acima do limiar; "fim"
 * depois de 15 quadros seguidos abaixo dele. Entre os dois, nada: o "abaixar" sai só no começo.
 */
export class DetectorDeFala {
  private seguidos = 0;
  private calados = 0;
  private falando = false;

  quadro(rms: number, botFalando: boolean): "inicio" | "fim" | null {
    const limiar = botFalando ? LIMIAR_COM_BOT : LIMIAR_CALADO;
    if (rms >= limiar) {
      this.calados = 0;
      this.seguidos += 1;
      if (!this.falando && this.seguidos >= QUADROS_PARA_DISPARAR) {
        this.falando = true;
        return "inicio";
      }
      return null;
    }
    this.seguidos = 0;
    if (!this.falando) return null;
    this.calados += 1;
    if (this.calados < QUADROS_PARA_CALAR) return null;
    this.falando = false;
    this.calados = 0;
    return "fim";
  }
}

/**
 * O ganho da voz do bot rumo a um alvo, amostra a amostra (abaixar para 30% em ≤50 ms quando a pessoa começa a falar;
 * subir de volta; fade de 15 ms ao interromper). `passoPorAmostra` é quanto o ganho anda por amostra.
 */
export class Ganho {
  atual = 1;
  private alvo = 1;
  private passo = 0;

  rumo(alvo: number, ms: number, taxaHz: number): void {
    this.alvo = alvo;
    const amostras = Math.max(1, Math.round((ms / 1000) * taxaHz));
    this.passo = Math.abs(alvo - this.atual) / amostras;
  }

  proximo(): number {
    if (this.atual < this.alvo) this.atual = Math.min(this.alvo, this.atual + this.passo);
    else if (this.atual > this.alvo) this.atual = Math.max(this.alvo, this.atual - this.passo);
    return this.atual;
  }

  chegou(): boolean {
    return this.atual === this.alvo;
  }
}

/** Volume da voz do bot enquanto a pessoa fala por cima (o servidor ainda decide se foi interrupção). */
export const GANHO_ABAIXADO = 0.3;
export const MS_ABAIXAR = 40;
export const MS_SUBIR = 120;
export const MS_FADE_INTERROMPER = 15;
/** Buffer de toque: começa a tocar com 80 ms guardados (ou depois de 100 ms esperando, para a fala curta). */
export const MS_BUFFER_INICIAL = 80;
export const MS_ESPERA_MAXIMA = 100;
/** `tocado` a cada 250 ms enquanto toca; 200 ms de buffer vazio depois de tocar = a fala acabou. */
export const MS_RELATO_TOCADO = 250;
export const MS_SILENCIO_FIM = 200;
