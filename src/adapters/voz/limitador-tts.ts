import { log } from "../../obs/log.ts";
import type { PedidoTts, PrioridadeTts, Sintetizador } from "./spi.ts";

/**
 * Limitador da cota do TTS do Google (definido em 2026-10-05, NOD-166). O Chirp 3 HD aceita 200 pedidos por minuto
 * por projeto; o nod roda numa VM só, então um limitador por processo basta, e todas as ligações dividem o mesmo.
 *
 * Janela deslizante de 60 s: cada pedido HTTP ao TTS consome uma vaga (o fallback REST do google-voz.ts pede a sua
 * pelo gancho `vagaExtra`). No teto ninguém é recusado: o pedido espera a vaga e sai na ordem conteúdo > leitura de
 * aprovação > espera e prévia (por ordem de chegada dentro do mesmo nível). Pedido cancelado sai da fila sem consumir
 * vaga. A fala de espera que passou de 2 s na fila perde o sentido e é descartada; as outras nunca são.
 */
export const JANELA_TTS_MS = 60_000;
/** definido em 2026-10-05: abaixo dos 200/min do Chirp 3 HD, com folga para o caso de a cota contar por fluxo. */
export const TETO_TTS_PADRAO_MIN = 180;
/** definido em 2026-10-05: "Hum, deixa eu ver…" que esperou mais que isto chegaria depois da resposta. */
export const ESPERA_MAX_FALA_DE_ESPERA_MS = 2_000;

const NIVEL: Record<PrioridadeTts, number> = { conteudo: 0, leitura: 1, espera: 2, previa: 2 };

export type LimitadorTts = {
  /** Espera a vaga. `false`: o pedido foi cancelado ou descartado e não deve ir ao provedor. */
  vaga(p: PedidoTts): Promise<boolean>;
  /** Começa a medir o maior número de pedidos numa janela de 60 s; a função devolvida lê o pico e para de medir. */
  medirPico(): () => number;
};

type NaFila = { nivel: number; seq: number; prioridade: PrioridadeTts; chegou: number; resolver(ok: boolean): void; soltar(): void };

export function criarLimitadorTts(o: { tetoPorMinuto: number; agora?: () => number }): LimitadorTts {
  const agora = o.agora ?? Date.now;
  const teto = o.tetoPorMinuto;
  const usos: number[] = [];
  const fila: NaFila[] = [];
  const medidores = new Set<{ pico: number }>();
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function limpar(t: number): void {
    while (usos.length > 0 && (usos[0] ?? 0) <= t - JANELA_TTS_MS) usos.shift();
  }

  function consumir(t: number): void {
    usos.push(t);
    for (const m of medidores) m.pico = Math.max(m.pico, usos.length);
  }

  function tirar(e: NaFila): void {
    const i = fila.indexOf(e);
    if (i >= 0) fila.splice(i, 1);
    e.soltar();
  }

  function drenar(): void {
    const t = agora();
    limpar(t);
    while (fila.length > 0 && usos.length < teto) {
      let melhor = fila[0] as NaFila;
      for (const e of fila) if (e.nivel < melhor.nivel || (e.nivel === melhor.nivel && e.seq < melhor.seq)) melhor = e;
      tirar(melhor);
      consumir(t);
      log("info", "voz_tts_limitado", { prioridade: melhor.prioridade, espera_ms: t - melhor.chegou, descartado: false });
      melhor.resolver(true);
    }
    reagendar();
  }

  function reagendar(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const primeiro = usos[0];
    if (fila.length === 0 || primeiro === undefined) return;
    timer = setTimeout(() => {
      timer = null;
      drenar();
    }, Math.max(0, primeiro + JANELA_TTS_MS - agora()));
    timer.unref?.();
  }

  return {
    vaga(p) {
      if (p.sinal?.aborted) return Promise.resolve(false);
      const t = agora();
      limpar(t);
      if (fila.length === 0 && usos.length < teto) {
        consumir(t);
        return Promise.resolve(true);
      }
      const prioridade = p.prioridade ?? "conteudo";
      return new Promise<boolean>((resolve) => {
        let descarte: ReturnType<typeof setTimeout> | null = null;
        const aoAbortar = () => {
          tirar(e);
          resolve(false);
          reagendar();
        };
        const e: NaFila = {
          nivel: NIVEL[prioridade],
          seq: seq++,
          prioridade,
          chegou: t,
          resolver: resolve,
          soltar() {
            if (descarte) clearTimeout(descarte);
            p.sinal?.removeEventListener("abort", aoAbortar);
          },
        };
        fila.push(e);
        p.sinal?.addEventListener("abort", aoAbortar, { once: true });
        if (prioridade === "espera") {
          descarte = setTimeout(() => {
            tirar(e);
            log("info", "voz_tts_limitado", { prioridade, espera_ms: agora() - t, descartado: true });
            resolve(false);
            reagendar();
          }, ESPERA_MAX_FALA_DE_ESPERA_MS);
          descarte.unref?.();
        }
        drenar();
      });
    },
    medirPico() {
      const m = { pico: 0 };
      medidores.add(m);
      return () => {
        medidores.delete(m);
        return m.pico;
      };
    },
  };
}

/** Decora um sintetizador: cada `sintetizar` espera a sua vaga no limitador antes de chegar ao provedor. */
export function criarSintetizadorLimitado(tts: Sintetizador, limitador: LimitadorTts): Sintetizador {
  return {
    id: tts.id,
    capacidades: tts.capacidades,
    medirPico: limitador.medirPico,
    async *sintetizar(p) {
      if (!(await limitador.vaga(p))) return;
      yield* tts.sintetizar(p);
    },
  };
}
