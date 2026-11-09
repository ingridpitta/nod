/**
 * definido em 2026-10-24 (NOD-93, ADR-127 §4): o estado da VM local do Mac, como o app anuncia (`ConexaoAnuncio.vmLocal`)
 * e o `GET /computador` devolve (`preparo`). Os estados são as fases do preparo (src/domain/preparo-vm-local.ts).
 * Ausente = app antigo ou `NOD_VM_LOCAL` desligada: o Mac não tem VM. Só tipo e lista (EMENDA 26).
 */
export const ESTADOS_VM_LOCAL = ["baixando", "pausado_sem_internet", "esperando_memoria", "preparando", "ligando", "pronto", "dormindo", "macos_antigo", "falhou"] as const;
export type EstadoVmLocal = (typeof ESTADOS_VM_LOCAL)[number];

/** `bytes`/`total` só no download; `motivo` só em `falhou`; `desde` = quando entrou no estado (epoch ms). */
export type VmLocalAnunciada = { estado: EstadoVmLocal; bytes?: number; total?: number; motivo?: string; desde: number };

/** definido em 2026-10-24 (plano da NOD-93, passo 9): o app reanuncia a VM no máximo 1 vez por segundo. */
export const INTERVALO_ANUNCIO_VM_MS = 1_000;
