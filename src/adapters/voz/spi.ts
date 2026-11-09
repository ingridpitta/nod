/**
 * SPI dos provedores de voz (definido em 2026-10-04, ADR-071). O orquestrador fala só com estas interfaces; trocar de
 * provedor é configuração (`NOD_VOZ_STT`, `NOD_VOZ_TTS`). Esta pasta não importa banco, repositórios nem casos de uso.
 *
 * Provedores da v1:
 * - `google`: Transcribe Live (Live API) + Chirp 3 HD, pago pelos créditos GCP (produção).
 * - `local`: whisper.cpp + `say` do macOS, grátis, só na máquina de quem desenvolve.
 * - `falso`: sem áudio de verdade, roteirizado, para testes e CI.
 */

/** O que um transcritor sabe fazer; o orquestrador se adapta (ex.: sem parciais, a legenda só aparece no fim). */
export type CapacidadesStt = {
  /** Emite parciais enquanto a pessoa fala. */
  parciais: boolean;
  /** Aceita lista de termos (nomes de bots, apps) para reconhecer melhor. */
  vocabulario: boolean;
  /** Precisa que o orquestrador diga onde a fala acabou (o VAD do nod) para fechar o final. */
  fimDeFalaManual: boolean;
};

export type ResultadoStt = { texto: string; final: boolean; confianca: number | null };

/**
 * Uma sessão de transcrição de uma ligação. O áudio entra em PCM16 mono 16 kHz, em quadros de 20 ms. `fimDeFala()` é
 * chamado pelo VAD do orquestrador quando a pessoa para de falar: o provedor devolve o final daquele trecho.
 */
export interface SessaoStt {
  enviar(pcm16: Int16Array): void;
  /** A fala acabou (VAD do nod): o provedor fecha o trecho e emite o final. */
  fimDeFala(): void;
  /** Descarta o trecho em curso sem emitir final (eco, ruído). */
  descartar(): void;
  /**
   * O áudio do trecho em curso ainda não foi ao provedor (espera o final do trecho anterior): nenhuma parcial dele
   * pode chegar. Quem vigia "trecho sem texto" não conta esse tempo. Ausente = nunca guarda.
   */
  guardando?(): boolean;
  fechar(): Promise<void>;
}

export type OpcoesSessaoStt = {
  idioma: "pt-BR";
  vocabulario?: readonly string[];
  aoResultado(r: ResultadoStt): void;
  /** Erro irrecuperável da sessão (o orquestrador decide: reconectar ou pedir para digitar). */
  aoErro(e: Error): void;
};

export interface Transcritor {
  readonly id: string;
  readonly capacidades: CapacidadesStt;
  abrir(o: OpcoesSessaoStt): Promise<SessaoStt>;
}

export type CapacidadesTts = {
  /** Começa a devolver áudio antes de sintetizar a frase inteira. */
  streaming: boolean;
  /** Aceita `velocidade` diferente de 1. */
  velocidade: boolean;
};

/**
 * Quem passa na frente quando a cota do TTS aperta (limitador-tts.ts): conteúdo > leitura de aprovação > espera e
 * prévia da voz. Ausente = conteúdo.
 */
export type PrioridadeTts = "conteudo" | "leitura" | "espera" | "previa";

export type PedidoTts = {
  texto: string;
  /** Id neutro do catálogo VOZES_NOD (src/contracts/vozes.ts). */
  voz: string;
  velocidade: number;
  sinal?: AbortSignal;
  prioridade?: PrioridadeTts;
};

export interface Sintetizador {
  readonly id: string;
  readonly capacidades: CapacidadesTts;
  /** PCM16 mono 24 kHz, em pedaços. Cancelável pelo `sinal`. */
  sintetizar(p: PedidoTts): AsyncIterable<Int16Array>;
  /** Só com o limitador da cota: mede o pico de pedidos por minuto; a função devolvida lê o pico e para de medir. */
  medirPico?(): () => number;
}

/**
 * Transcrição de ARQUIVO com tempo por palavra (definido em 2026-10-22, NOD-329): o memo de voz do bot. Fica separada do
 * `Transcritor` (streaming da ligação), que não dá tempo por palavra. O arquivo vai inteiro num pedido síncrono.
 */
export type PalavraTranscrita = { texto: string; inicioMs: number; fimMs: number };

export type PedidoTranscricaoArquivo = { bytes: Uint8Array; mime: string; idioma: "pt-BR"; sinal?: AbortSignal };

/** `palavras` vazia = sem fala. `cobradoMs`: a duração que o provedor cobrou, quando ele diz (null no falso). */
export type ResultadoTranscricaoArquivo = { palavras: PalavraTranscrita[]; cobradoMs: number | null };

export interface TranscritorDeArquivo {
  readonly id: "google" | "falso";
  readonly modelo: string;
  transcrever(p: PedidoTranscricaoArquivo): Promise<ResultadoTranscricaoArquivo>;
}

/**
 * O provedor recusou o arquivo por causa dele mesmo (não adianta tentar de novo): `longo` (acima do limite do pedido
 * síncrono) ou `nao_suportado` (codificação que ele não decodifica). Os outros erros saem como `ErroDeDominio`.
 */
export class RecusaDoArquivo extends Error {
  readonly motivo: "longo" | "nao_suportado";
  constructor(motivo: "longo" | "nao_suportado", opcoes?: { cause?: unknown }) {
    super(motivo, opcoes);
    this.name = "RecusaDoArquivo";
    this.motivo = motivo;
  }
}

/** `arquivo`: null com `NOD_VOZ_STT_ARQUIVO=desligado`. */
export type ProvedoresVoz = { stt: Transcritor; tts: Sintetizador; arquivo: TranscritorDeArquivo | null; encerrar(): Promise<void> };
