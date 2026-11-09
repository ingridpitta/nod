import type { JsonSchema } from "./json-schema.ts";
import type { CampoEntrevista, CamposEntrevista } from "./onboarding.ts";

/**
 * As ferramentas do laço de voz (definido em 2026-10-04, ADR-072). Moram fora de ferramentas-nod.ts pelo gatilho de
 * 200 linhas da EMENDA 26, como as de pendência; entram só no catálogo do modo `ligacao`.
 */
export const FERRAMENTAS_LIGACAO = {
  iniciar_tarefa: {
    type: "object",
    description:
      "Começa um trabalho demorado (ler e revisar algo, pesquisar, fazer várias ações) sem parar a ligação. Devolve na hora; você segue conversando, e o resultado chega depois como aviso [nod]. Use para tudo que leve mais que alguns segundos. No máximo 3 por ligação.",
    properties: {
      pedido: { type: "string", description: "O que fazer, autocontido, como você escreveria para você mesmo no chat. Inclua nomes, links e detalhes que a pessoa disse.", minLength: 1, maxLength: 2000 },
    },
    required: ["pedido"],
    additionalProperties: false,
  },
  desligar: {
    type: "object",
    description: "Encerra a ligação depois da sua última frase. Use só quando a pessoa se despedir ou pedir para desligar.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  // definido em 2026-10-04 (ADR-077): as três do onboarding por ligação. Entram SÓ no catálogo da ligação que o produto
  // iniciou enquanto o onboarding da pessoa não terminou (montarPlano, `onboarding`).
  anotar_entrevista: {
    type: "object",
    description:
      "Só na primeira ligação: guarda o que a pessoa respondeu numa das quatro perguntas. Chame depois de falar a reação e a próxima pergunta, na mesma resposta, uma vez por campo, com o valor curto (o apelido, de onde conheceu, o que quer que os bots façam, o tamanho do time). Não diga que anotou.",
    properties: {
      campo: { type: "string", enum: ["apelido", "como_conheceu", "objetivo", "tamanho_time"], description: "Qual pergunta ela respondeu." },
      valor: {
        type: "string",
        description: "A resposta, curta. tamanho_time: so_eu, 2_10, 11_50 ou 51_mais. objetivo: nas palavras dela.",
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ["campo", "valor"],
    additionalProperties: false,
  },
  concluir_entrevista: {
    type: "object",
    description: "Só na primeira ligação: a pessoa confirmou o resumo (\"Certo?\"). A ligação vira a pílula e você guia a configuração. Chame uma vez, depois do sim dela e de dizer a frase de transição.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  propor_bot: {
    type: "object",
    description:
      "Só na primeira ligação: propõe o primeiro bot da pessoa, já preenchido com o que ela contou. Vira um card que ela confirma clicando ou dizendo \"pode criar\"; nada é criado antes. Depois de confirmado, use pedir_acesso e criar_rotina com para_bot igual ao nome dele.",
    properties: {
      nome: { type: "string", description: "Nome curto do bot (uma palavra).", minLength: 1, maxLength: 60 },
      descricao: { type: "string", description: "O que ele faz, em uma ou duas frases, na primeira pessoa da dona (\"Lê os meus e-mails…\").", minLength: 1, maxLength: 600 },
      forma: { type: "string", description: "Mascote (opcional): shape-square, shape-hex, shape-circle, shape-pebble, shape-capsule, shape-triangle, shape-cloud ou shape-drop." },
      cor: { type: "string", description: "Cor (opcional): c-red, c-pink, c-purple, c-blue, c-teal, c-green, c-orange, c-black, c-brown, c-amber, c-gray ou c-cream." },
      voz: { type: "string", description: "Voz (opcional): clara, bento, luna, theo, aurora, caio, iris ou rui." },
    },
    required: ["nome", "descricao"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsIniciarTarefa = { pedido: string };
export type ResultadoIniciarTarefa = { ok: true; tarefa_id: string; instrucao: string } | { ok: false; erro: "fora_da_ligacao" | "limite_de_tarefas"; instrucao: string };
export type ResultadoDesligar = { ok: true; instrucao: string } | { ok: false; erro: "fora_da_ligacao" };

export type ArgsAnotarEntrevista = { campo: CampoEntrevista; valor: string };
export type ResultadoAnotarEntrevista =
  | { ok: true; campos: CamposEntrevista; falta: CampoEntrevista[]; instrucao: string }
  | { ok: false; erro: "fora_do_onboarding" | "valor_invalido"; instrucao: string };
export type ResultadoConcluirEntrevista = { ok: true; instrucao: string } | { ok: false; erro: "fora_do_onboarding" | "entrevista_incompleta"; falta?: CampoEntrevista[]; instrucao: string };
export type ArgsProporBot = { nome: string; descricao: string; forma?: string; cor?: string; voz?: string };
export type ResultadoProporBot =
  | { ok: true; proposta_id: string; instrucao: string }
  | { ok: false; erro: "fora_do_onboarding" | "ja_tem_bot" | "entrada_invalida"; instrucao: string };

export type ContratoFerramentasLigacao = {
  iniciar_tarefa: { args: ArgsIniciarTarefa; resultado: ResultadoIniciarTarefa };
  desligar: { args: { _?: never }; resultado: ResultadoDesligar };
  anotar_entrevista: { args: ArgsAnotarEntrevista; resultado: ResultadoAnotarEntrevista };
  concluir_entrevista: { args: { _?: never }; resultado: ResultadoConcluirEntrevista };
  propor_bot: { args: ArgsProporBot; resultado: ResultadoProporBot };
};
