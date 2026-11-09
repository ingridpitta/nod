import type { JsonSchema } from "./json-schema.ts";

/**
 * gerir_acessos (definido em 2026-11-07, ADA-241, ADR-158): QUALQUER bot muda, a pedido da pessoa, quem pode usar um app —
 * vários bots de uma vez ("Ler no Gmail para todos"), o padrão do app ("bots novos começam com Ler") e o Desfazer de um
 * lote. Cada pedido passa pelo mesmo executor da tela (src/use-cases/acoes/acessos.ts). O que dá acesso (Ler ou Ler e
 * alterar) segue o modo do bot; "Ler e alterar" em lote espera SEMPRE a pessoa num card (pessoa_confirma). Tirar acesso
 * (Nenhum) roda na hora. Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26.
 */

export const ACOES_GERIR_ACESSOS = ["lote", "padrao", "desfazer"] as const;
export type AcaoGerirAcessos = (typeof ACOES_GERIR_ACESSOS)[number];
export const NIVEIS_GERIR_ACESSOS = ["nenhum", "leitura", "escrita"] as const;

/** As propriedades; o registro (src/domain/acoes/acessos.ts) reusa as mesmas. */
export const PROPRIEDADES_ACESSOS = {
  app: { type: "string", minLength: 1, maxLength: 80, description: "O app: o nome (\"Gmail\"), o slug ou o id. Em desfazer, não vai." },
  nivel: { type: "string", enum: [...NIVEIS_GERIR_ACESSOS], description: "nenhum (tira o acesso), leitura (Ler) ou escrita (Ler e alterar). Em lote e padrao." },
  bots: { type: "array", items: { type: "string", minLength: 1, maxLength: 80 }, minItems: 1, maxItems: 100, description: "Só em lote: os bots, pelo nome exato ou id. Sem bots, o lote vale para todos os bots da pessoa (Ler para todos não rebaixa quem já tem Ler e alterar)." },
  aplicar: { type: "boolean", description: "Só em padrao: true (o padrão) também passa ao novo nível os bots que seguem o padrão; false só vale para os bots novos." },
  lote_id: { type: "string", minLength: 1, maxLength: 80, description: "Só em desfazer: o lote_id que o gerir_acessos devolveu (vale por 24 horas)." },
} as const satisfies Record<string, JsonSchema>;

export const FERRAMENTAS_ACESSOS = {
  gerir_acessos: {
    type: "object",
    description:
      "Muda quem pode usar um app, como a pessoa faz em Apps > Quem pode usar: um nível (Nenhum, Ler, Ler e alterar) para vários bots de uma vez ou para todos (acao lote), o padrão do app com que os bots novos nascem (acao padrao) ou desfaz um lote (acao desfazer, com o lote_id). Use só quando a pessoa pedir. Ler e alterar espera o ok da pessoa num card; Nenhum e Ler seguem o modo de aprovação do bot. Para um bot só, use gerir_bots (dar_acesso).",
    properties: {
      resumo: { type: "string", minLength: 1, maxLength: 200, description: "O pedido em uma frase (vai para o card e para o histórico)." },
      acao: { type: "string", enum: [...ACOES_GERIR_ACESSOS] },
      ...PROPRIEDADES_ACESSOS,
    },
    required: ["resumo", "acao"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type NivelGerirAcessos = (typeof NIVEIS_GERIR_ACESSOS)[number];
export type ArgsGerirAcessos = { resumo: string; acao: AcaoGerirAcessos; app?: string; nivel?: NivelGerirAcessos; bots?: string[]; aplicar?: boolean; lote_id?: string };

export type ErroGerirAcessos = "fora_da_conversa" | "entrada_invalida" | "nome_ambiguo";

export type ResultadoGerirAcessos =
  | { ok: true; feito: string | null; lote_id: string | null; esperando: boolean; decisao_id: string | null; instrucao: string }
  | { ok: false; erro: ErroGerirAcessos; problemas: { motivo: string; opcoes?: string[] }[]; instrucao: string };

export type ContratoFerramentasAcessos = {
  gerir_acessos: { args: ArgsGerirAcessos; resultado: ResultadoGerirAcessos };
};
