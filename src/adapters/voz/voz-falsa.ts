import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";
import { duracaoMs } from "../../domain/duracao-audio.ts";
import type { OpcoesSessaoStt, PalavraTranscrita, ProvedoresVoz, SessaoStt, Sintetizador, Transcritor, TranscritorDeArquivo } from "./spi.ts";

/**
 * Provedor `falso` (definido em 2026-10-04, ADR-071): sem áudio de verdade, custo zero, determinístico. É o dos testes
 * automáticos e do CI. O áudio que entra é ignorado (só conta se houve ou não); o texto vem de um roteiro.
 */

/** definido em 2026-10-04: confiança fixa dos finais roteirizados (acima de qualquer limiar de "não entendi"). */
export const CONFIANCA_FALSA = 0.95;

export type OpcoesTranscritorFalso = { parciais?: boolean };

export type TranscritorFalso = Transcritor & {
  /** Enfileira a próxima fala que "a pessoa" vai dizer (vale para todas as sessões deste transcritor). */
  empurrarTexto(t: string): void;
  /** Quantas falas do roteiro ainda não viraram final. */
  readonly restantes: number;
};

/**
 * Cada trecho (do primeiro `enviar` com áudio até o `fimDeFala()`) vira o próximo texto do roteiro como final. Roteiro
 * vazio ou esgotado → final "". Com `parciais`, o primeiro áudio do trecho emite um parcial com a primeira metade das
 * palavras. `descartar()` joga fora o trecho sem consumir o roteiro (o texto continua sendo o próximo). Os resultados
 * saem num microtask, como num provedor de verdade (nunca dentro da própria chamada de `enviar`/`fimDeFala`).
 */
export function criarTranscritorFalso(roteiro: readonly string[] = [], opcoes: OpcoesTranscritorFalso = {}): TranscritorFalso {
  const fila = [...roteiro];
  const parciais = opcoes.parciais === true;
  return {
    id: "falso",
    capacidades: { parciais, vocabulario: true, fimDeFalaManual: true },
    empurrarTexto(t: string) {
      fila.push(t);
    },
    get restantes() {
      return fila.length;
    },
    async abrir(o: OpcoesSessaoStt): Promise<SessaoStt> {
      let fechada = false;
      let temAudio = false;
      let parcialEmitido = false;
      const emitir = (texto: string, final: boolean) => {
        queueMicrotask(() => {
          if (!fechada) o.aoResultado({ texto, final, confianca: final ? CONFIANCA_FALSA : null });
        });
      };
      return {
        enviar(pcm16: Int16Array) {
          // áudio depois de fechar é corrida normal no fim da ligação: ignorado, nunca lança
          if (fechada || pcm16.length === 0) return;
          temAudio = true;
          if (parciais && !parcialEmitido) {
            parcialEmitido = true;
            const palavras = (fila[0] ?? "").split(/\s+/).filter(Boolean);
            const metade = palavras.slice(0, Math.max(1, Math.floor(palavras.length / 2)));
            if (metade.length > 0) emitir(metade.join(" "), false);
          }
        },
        fimDeFala() {
          if (fechada || !temAudio) return;
          temAudio = false;
          parcialEmitido = false;
          emitir(fila.shift() ?? "", true);
        },
        descartar() {
          temAudio = false;
          parcialEmitido = false;
        },
        async fechar() {
          fechada = true;
        },
      };
    },
  };
}

/** definido em 2026-10-04: ~60 ms por caractere, mínimo 200 ms; pedaços de 100 ms; tom de 220 Hz bem baixo. */
export const MS_POR_CARACTERE_FALSO = 60;
export const MS_MINIMO_FALSO = 200;
export const PEDACO_MS = 100;
const TOM_HZ = 220;
const TOM_AMPLITUDE = 600;

/** Duração (ms) da fala falsa de um texto a uma velocidade. Exportada para os testes do orquestrador. */
export function duracaoFalaFalsaMs(texto: string, velocidade = 1): number {
  return Math.round(Math.max(MS_MINIMO_FALSO, texto.length * MS_POR_CARACTERE_FALSO) / (velocidade > 0 ? velocidade : 1));
}

/** PCM 24 kHz de um tom baixo com duração proporcional ao texto, em pedaços de 100 ms. Abortar encerra a iteração sem erro. */
export function criarSintetizadorFalso(opcoes: { silencioso?: boolean } = {}): Sintetizador {
  return {
    id: "falso",
    capacidades: { streaming: false, velocidade: true },
    async *sintetizar(p) {
      const total = Math.round((duracaoFalaFalsaMs(p.texto, p.velocidade) * TAXA_VOZ_HZ) / 1000);
      const porPedaco = (PEDACO_MS * TAXA_VOZ_HZ) / 1000;
      for (let inicio = 0; inicio < total; inicio += porPedaco) {
        if (p.sinal?.aborted) return;
        const n = Math.min(porPedaco, total - inicio);
        const pedaco = new Int16Array(n);
        if (!opcoes.silencioso) {
          for (let i = 0; i < n; i++) pedaco[i] = Math.round(TOM_AMPLITUDE * Math.sin((2 * Math.PI * TOM_HZ * (inicio + i)) / TAXA_VOZ_HZ));
        }
        yield pedaco;
      }
    },
  };
}

/** definido em 2026-10-22 (NOD-329): sem saber a duração do arquivo (nem dada, nem no cabeçalho), o falso espalha as palavras em 400 ms cada. */
export const MS_POR_PALAVRA_FALSA = 400;

export type TranscritorDeArquivoFalso = TranscritorDeArquivo & {
  /** Quantas vezes `transcrever` foi chamado (o teste das "0 chamadas" sem consentimento). */
  readonly chamadas: number;
};

/**
 * STT de arquivo `falso` (definido em 2026-10-22, NOD-329): devolve o roteiro (um texto) como palavras espalhadas pela
 * duração — `duracaoMs` quando dada, senão a lida do cabeçalho do arquivo (`duracao-audio.ts`), senão 400 ms por palavra. Roteiro vazio → `[]` (áudio sem fala). Nada vai à rede.
 */
export function criarTranscritorDeArquivoFalso(roteiro = "", opcoes: { duracaoMs?: number } = {}): TranscritorDeArquivoFalso {
  let chamadas = 0;
  return {
    id: "falso",
    modelo: "falso",
    get chamadas() {
      return chamadas;
    },
    async transcrever(p) {
      chamadas++;
      if (p.sinal?.aborted) throw new DOMException("abortado", "AbortError");
      const textos = roteiro.split(/\s+/).filter(Boolean);
      const total = opcoes.duracaoMs ?? duracaoMs(p.bytes, p.mime) ?? textos.length * MS_POR_PALAVRA_FALSA;
      const passo = textos.length > 0 ? total / textos.length : 0;
      const palavras: PalavraTranscrita[] = textos.map((texto, i) => ({ texto, inicioMs: Math.round(i * passo), fimMs: Math.round((i + 1) * passo) }));
      return { palavras, cobradoMs: null };
    },
  };
}

export type OpcoesProvedoresFalsos = { roteiro?: readonly string[]; parciais?: boolean; silencioso?: boolean; roteiroArquivo?: string };

export function criarProvedoresFalsos(opcoes: OpcoesProvedoresFalsos = {}): ProvedoresVoz & { stt: TranscritorFalso; arquivo: TranscritorDeArquivoFalso } {
  return {
    stt: criarTranscritorFalso(opcoes.roteiro ?? [], { parciais: opcoes.parciais === true }),
    tts: criarSintetizadorFalso({ silencioso: opcoes.silencioso === true }),
    arquivo: criarTranscritorDeArquivoFalso(opcoes.roteiroArquivo ?? ""),
    async encerrar() {},
  };
}
