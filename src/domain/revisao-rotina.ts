import type { Rotina } from "../contracts/rotina.ts";
import { jsonEstavel as estavel } from "./json-estavel.ts";

/**
 * definido em 2026-10-06 (NOD-159): a revisão de uma rotina é o hash dos campos que uma proposta muda. A rotina não
 * tem versão nem `atualizadoEm`; a proposta guarda a revisão de quando nasceu e a confirmação só aplica se a rotina
 * ainda for aquela — senão o card velho sobrescreveria, sem a pessoa ver, o que mudou no meio.
 *
 * `estado`, `proximaExecucao` e as datas ficam de fora: pausar, reativar ou o tick não invalidam o card.
 * O domínio é puro (ADR-018), então o sha256 chega por parâmetro; quem chama usa `node:crypto`.
 */
export type CamposDaRevisao = Pick<Rotina, "cron" | "fusoIana" | "instrucao" | "fonte" | "entregavel" | "limitesAprovacao" | "politicaSemDado" | "acessos">;

/** Acessos são um conjunto: a ordem da lista (e das capacidades dentro de cada um) não muda a revisão. */
function acessosOrdenados(acessos: CamposDaRevisao["acessos"]): string[] | null {
  if (acessos === null) return null;
  return acessos
    .map((a) => estavel({ ...a, capacidades: [...a.capacidades].sort(), naoPedido: [...a.naoPedido].sort() }))
    .sort();
}

/** O texto canônico que vira a revisão; exportado para o teste ver o que entra. */
export function formaDaRevisao(r: CamposDaRevisao): string {
  return estavel({
    cron: r.cron,
    fusoIana: r.fusoIana,
    instrucao: r.instrucao,
    fonte: r.fonte,
    entregavel: r.entregavel,
    limitesAprovacao: r.limitesAprovacao,
    politicaSemDado: r.politicaSemDado,
    acessos: acessosOrdenados(r.acessos),
    // revisto em 2026-10-20 (NOD-317): o "só com pendência" saiu da rotina, mas a chave fica, sempre false, para o
    // hash continuar o mesmo — a proposta aberta guarda a revisão de quando nasceu, e mudar a forma a tornaria
    // obsoleta (TEXTO_ROTINA_MUDOU) sem a rotina ter mudado.
    soComPendencia: false,
  });
}

export function revisaoDaRotina(r: CamposDaRevisao, sha256: (texto: string) => string): string {
  return sha256(formaDaRevisao(r));
}
