import { EXECUCOES_GUARDADAS, ROTINAS_POR_AGENTE } from "../shared/constantes.ts";

/** 50 rotinas por bot (Grok Bot): a 51ª é recusada com limite_atingido. */
export function podeCriarRotina(rotinasDoAgente: number, teto = ROTINAS_POR_AGENTE): boolean {
  return rotinasDoAgente < teto;
}

/** Guarda as 20 execuções mais recentes por rotina (Grok Bot); devolve a lista podada, mais recente primeiro. */
export function podarExecucoes<T extends { em: number }>(lista: readonly T[], guardar = EXECUCOES_GUARDADAS): T[] {
  return [...lista].sort((a, b) => b.em - a.em).slice(0, guardar);
}
