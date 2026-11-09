import type { JsonSchema } from "./json-schema.ts";

/**
 * remover_computador (ADA-245, jornada D do onboarding): QUALQUER bot, na conversa com a pessoa, pede para tirar o nod
 * de um computador dela ("tira o nod deste notebook", "remove o PC do escritório da minha conta"). Nunca roda direto: é
 * `pessoa_confirma` (apaga programas e tira o computador da conta), então vira SEMPRE um card para a pessoa, também em
 * "Ignorar todas as aprovações". Aprovado, roda o mesmo executor da tela (src/use-cases/acoes/maquinas.ts). Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

/** As propriedades; o registro (src/domain/acoes/maquinas.ts) reusa as mesmas. */
export const PROPRIEDADES_COMPUTADORES = {
  computador: { type: "string", minLength: 1, maxLength: 80, description: "O computador: o nome exato como aparece em Configurações › Computadores, ou o id." },
  manter_ias: { type: "boolean", description: "true mantém o Claude e o ChatGPT que o nod instalou lá; padrão false (tira também). Os logins da pessoa nessas IAs são dela e ficam." },
  manter_conexao: { type: "boolean", description: "true deixa o computador ligado à conta, para instalar de novo sem entrar outra vez; padrão false (sai da conta)." },
} as const satisfies Record<string, JsonSchema>;

export const FERRAMENTAS_COMPUTADORES = {
  remover_computador: {
    type: "object",
    description:
      "Tira o nod de um computador da pessoa, a pedido dela: o programa para e sai de lá, os bots de lá passam para o computador padrão (ou esperam um computador) e, sem manter_conexao, o computador sai da conta. Sempre espera a pessoa num card nesta conversa; nada muda antes do ok dela. Se o nome não bater, a ferramenta devolve os computadores: pergunte qual.",
    properties: {
      resumo: { type: "string", minLength: 1, maxLength: 200, description: "O pedido em uma frase (vai para o card)." },
      ...PROPRIEDADES_COMPUTADORES,
    },
    required: ["resumo", "computador"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsRemoverComputador = { resumo: string; computador: string; manter_ias?: boolean; manter_conexao?: boolean };
export type ErroRemoverComputador = "fora_da_conversa" | "entrada_invalida" | "computador_ambiguo";
export type ResultadoRemoverComputador =
  | { ok: true; decisao_id: string; computador: string; bots: string[]; assume: string | null; instrucao: string }
  | { ok: false; erro: ErroRemoverComputador; opcoes?: string[]; instrucao: string };

export type ContratoFerramentasComputadores = {
  remover_computador: { args: ArgsRemoverComputador; resultado: ResultadoRemoverComputador };
};
