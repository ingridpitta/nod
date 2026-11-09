// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §5): a admissão de uma tela pela MESMA régua dos bots (ADR-085/097).
// Sem número fixo de telas: se a régua segura, fecha a tela ociosa mais antiga e reavalia; sem ociosa, a tela espera
// (`esperando_tela`, com quem ocupa). Falta de memória é espera, nunca erro.
import { deveSegurar, nivelDaMemoriaLinux, nivelDoProcessador, pressaoSimulada } from '../../src/domain/memoria-mac.ts';

/** Sem ação há este tempo, a tela conta como ociosa (pode ser fechada para dar lugar a outra). */
export const OCIOSA_APOS_MS = 2 * 60_000;

/** A leitura local da máquina: memória pelo /proc/meminfo, processador pelo loadavg. `simular` = NOD_SIMULAR_PRESSAO. */
export function leituraLocal({ meminfo, loadavg, nucleos, simular }) {
  const memoria = pressaoSimulada(simular) ?? nivelDaMemoriaLinux(meminfo ?? '');
  const carga = Number(String(loadavg ?? '').trim().split(/\s+/)[0]);
  const processador = Number.isFinite(carga) ? nivelDoProcessador(carga, nucleos).nivel : null;
  return { memoria, processador };
}

/** A tela está ociosa: aberta, sem ação em curso e sem ação há OCIOSA_APOS_MS. */
export function ociosa(t, agora) {
  return t.estado === 'aberta' && !t.ocupada && agora - (t.ultimaAcaoEm ?? 0) >= OCIOSA_APOS_MS;
}

/**
 * Pode abrir a tela de `agenteId`? `telas`: as do computador ({agenteId, estado, ocupada, ultimaAcaoEm}).
 * - abrir: a régua não segura;
 * - fechar: segura, e esta é a tela ociosa mais antiga (o supervisor fecha e chama de novo);
 * - esperar: segura e não há ociosa; `quem` são os bots com tela aberta.
 */
export function decidirAbertura({ uso, memoria, processador, telas, agenteId, agora = Date.now() }) {
  if (!deveSegurar(uso, memoria, processador, { plataforma: 'linux' })) return { acao: 'abrir' };
  const outras = telas.filter((t) => t.agenteId !== agenteId);
  const candidata = outras.filter((t) => ociosa(t, agora)).sort((a, b) => (a.ultimaAcaoEm ?? 0) - (b.ultimaAcaoEm ?? 0))[0];
  if (candidata) return { acao: 'fechar', agenteId: candidata.agenteId };
  return { acao: 'esperar', quem: outras.filter((t) => t.estado === 'aberta' || t.estado === 'abrindo').map((t) => t.agenteId) };
}
