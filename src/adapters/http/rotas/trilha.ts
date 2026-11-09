import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Rota } from "../roteador.ts";
import type { DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasTrilha = { dentro: DentroDeTx };

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const FUSO = /^[A-Za-z_]+\/[A-Za-z_/+-]+$|^UTC$/;

/**
 * GET trilha?dia&agente&conector[&fuso] (E8.4): devolve exatamente o recorte, não "as últimas N".
 * Só leitura: a trilha é imutável por trigger e REVOKE (ADR-004); nenhuma rota escreve nela.
 */
export function rotasTrilha(deps: DepsRotasTrilha): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/trilha$/,
      async handler(ctx) {
        const url = new URL(ctx.req.url ?? "/", "http://127.0.0.1");
        const dia = url.searchParams.get("dia") ?? undefined;
        const agenteId = url.searchParams.get("agente") ?? undefined;
        const conectorId = url.searchParams.get("conector") ?? undefined;
        const fuso = url.searchParams.get("fuso") ?? undefined;
        if (dia !== undefined && !DIA.test(dia)) throw new ErroDeDominio("entrada_invalida", { cause: "dia" });
        if (fuso !== undefined && !FUSO.test(fuso)) throw new ErroDeDominio("fuso_invalido");
        const linhas = await deps.dentro(ctx.escopo, (d) => d.repos.trilha.filtrar({ dia, agenteId, conectorId, fuso }));
        ctx.json(200, { linhas });
      },
    },
  ];
}
