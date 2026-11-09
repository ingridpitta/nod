import type { JsonSchema } from "./json-schema.ts";
import { TETO_NOME_TIME } from "./time.ts";

/**
 * gerir_times (definido em 2026-11-02, NOD-437, ADR-135): QUALQUER bot organiza os times de bots da pessoa como ela faz na
 * barra lateral — criar, renomear, excluir, mudar de lugar, recolher e mover bots entre times —, num lote só (até 20
 * ações). Cada ação passa pelo mesmo executor da tela (src/use-cases/acoes/times.ts). Só excluir um time que tem bots
 * espera a pessoa num card (o lote dos bots, "Excluir o time Produção?"); o resto roda na hora. Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

export const TIPOS_ACAO_TIMES = ["criar", "renomear", "excluir", "ordenar", "recolher", "mover"] as const;
export type TipoAcaoTimes = (typeof TIPOS_ACAO_TIMES)[number];
export const MAX_ACOES_TIMES = 20;
/** Bots por ação, na tela (multisseleção, Desfazer) e no chat: o mesmo teto (revisão do PR #632, M5). */
export const MAX_BOTS_POR_ACAO = 200;

/** As propriedades de cada ação; o registro (src/domain/acoes/times.ts) reusa as mesmas. */
export const PROPRIEDADES_TIMES = {
  time: { type: "string", minLength: 1, maxLength: 80, description: "O time: o nome (sem diferenciar maiúsculas e acentos) ou o id. \"Sem time\" é o grupo dos bots sem time. Em criar, o nome do time novo." },
  nome: { type: "string", minLength: 1, maxLength: TETO_NOME_TIME, description: "Só em renomear: o nome novo." },
  posicao: { type: "integer", description: "criar e ordenar: o lugar na barra, 1 = o primeiro (o topo). Em criar, sem ele o time vai para o fim." },
  recolhido: { type: "boolean", description: "Só em recolher (e opcional em criar): true recolhe, false abre." },
  bots: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, minItems: 1, maxItems: MAX_BOTS_POR_ACAO, description: "mover (obrigatório) e criar (opcional): os bots, pelo nome exato ou id. Só bots da pessoa; pessoas não entram em times." },
} as const satisfies Record<string, JsonSchema>;

export const FERRAMENTAS_TIMES = {
  gerir_times: {
    type: "object",
    description:
      "Organiza os times de bots da pessoa na barra lateral, como ela faz na tela: criar, renomear, excluir, ordenar (mudar de lugar), recolher/abrir e mover bots para um time (\"Sem time\" tira do time). Use quando a pessoa pedir; junte tudo o que ela pediu num lote só, na ordem. Times são só de bots: pessoas não entram. Se o nome do time for ambíguo, a ferramenta devolve as opções: pergunte à pessoa qual (\"Produto ou Produção?\") antes de chamar de novo. Excluir um time com bots espera a pessoa num card; os bots vão para Sem time e nenhum é excluído.",
    properties: {
      resumo: { type: "string", minLength: 1, maxLength: 200, description: "O pedido em uma frase (vai para o card e para o histórico)." },
      acoes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ACOES_TIMES,
        items: {
          type: "object",
          properties: { tipo: { type: "string", enum: [...TIPOS_ACAO_TIMES] }, ...PROPRIEDADES_TIMES },
          required: ["tipo", "time"],
          additionalProperties: false,
        },
      },
    },
    required: ["resumo", "acoes"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type AcaoTimes = { tipo: TipoAcaoTimes; time: string; nome?: string; posicao?: number; recolhido?: boolean; bots?: string[] };
export type ArgsGerirTimes = { resumo: string; acoes: AcaoTimes[] };

export type ErroGerirTimes = "fora_da_conversa" | "entrada_invalida" | "nome_ambiguo";

export type ResultadoGerirTimes =
  | { ok: true; feitas: { i: number; linha: string }[]; esperando: number[]; decisao_id: string | null; instrucao: string }
  | { ok: false; erro: ErroGerirTimes; problemas: { i: number; motivo: string; opcoes?: string[] }[]; instrucao: string };

export type ContratoFerramentasTimes = {
  gerir_times: { args: ArgsGerirTimes; resultado: ResultadoGerirTimes };
};
