import type { EpochMs, TenantId } from "./ids.ts";

export type TipoMemoria = "preferencia" | "fato" | "resumo";

/** Memória por bot, editável pela pessoa; injetada no prompt com "não substitui fonte autoritativa". */
export type Memoria = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  tipo: TipoMemoria;
  texto: string;
  origem: "pessoa" | "agente";
  criadoEm: EpochMs;
};

export type AutorMemoria = "pessoa" | "agente";
export type AcaoDiario = "criada" | "editada" | "apagada";

/** NOD-58: uma mudança na memória (antes e depois), desfazível pela dona; as do bot pedem revisão. */
export type EntradaDiario = {
  id: string;
  agenteId: string;
  memoriaId: string;
  acao: AcaoDiario;
  autor: AutorMemoria;
  antes: { tipo: TipoMemoria; texto: string } | null;
  depois: { tipo: TipoMemoria; texto: string } | null;
  /** Esta entrada desfaz outra (o id dela). */
  desfazId: string | null;
  desfeitaEm: EpochMs | null;
  revisadaEm: EpochMs | null;
  criadoEm: EpochMs;
};

export type PaginaDiario = { entradas: EntradaDiario[]; aRevisar: number; mais: boolean };
