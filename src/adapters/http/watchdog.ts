import { log } from "../../obs/log.ts";
import type { MotivoSaude, VerificacaoSaude } from "./rotas/saude.ts";

/** definido em 2026-10-15 (NOD-267): a mesma cadência do healthcheck do compose (15 s × 4) — ~1 min travado e o processo sai. */
export const INTERVALO_WATCHDOG_MS = 15_000;
export const FALHAS_ATE_REINICIAR = 4;

export type Watchdog = { parar(): void };

/**
 * Watchdog do modo compartilhado (NOD-267, emenda à ADR-017). O Docker só reinicia processo MORTO (`unless-stopped`),
 * não `unhealthy`; então o processo vivo e travado (pool esgotado, laço pendurado) se derruba sozinho: a cada
 * `intervaloMs` roda a mesma verificação do `/api/saude` e, depois de `falhasAteSair` falhas SEGUIDAS, loga
 * `watchdog_reiniciando` e chama `sair(1)` (uma vez). Uma verificação boa zera a contagem.
 *
 * Não age antes de `carenciaAte` (a carência do boot da NOD-214) nem depois de `parar()` — o boot para o watchdog no
 * começo da drenagem (ADR-071), então um SIGTERM nunca vira `exit(1)` no meio dela. A verificação em voo quando a
 * drenagem começa também não conta. Não cobre o event loop congelado: com ele, este timer também para.
 */
export function iniciarWatchdog(p: {
  verificar: VerificacaoSaude;
  sair: (codigo: number) => void;
  agora: () => number;
  carenciaAte: number;
  intervaloMs?: number;
  falhasAteSair?: number;
}): Watchdog {
  const falhasAteSair = p.falhasAteSair ?? FALHAS_ATE_REINICIAR;
  let falhas = 0;
  let parado = false;
  let emVoo = false;
  const verificarUmaVez = async () => {
    if (parado || emVoo || p.agora() < p.carenciaAte) return;
    emVoo = true;
    let motivo: MotivoSaude | null;
    try {
      motivo = await p.verificar();
    } catch {
      motivo = "erro";
    } finally {
      emVoo = false;
    }
    if (parado) return;
    if (motivo === null) {
      falhas = 0;
      return;
    }
    falhas += 1;
    log("aviso", "watchdog_falha", { motivo, falhas });
    if (falhas < falhasAteSair) return;
    parado = true;
    clearInterval(timer);
    log("erro", "watchdog_reiniciando", { motivo, falhas });
    p.sair(1);
  };
  const timer = setInterval(() => void verificarUmaVez(), p.intervaloMs ?? INTERVALO_WATCHDOG_MS);
  timer.unref();
  return {
    parar() {
      parado = true;
      clearInterval(timer);
    },
  };
}
