import type { JsonSchema } from "./json-schema.ts";
import type { LeituraMarcada } from "./nao-lidos.ts";

/**
 * nao_lidos (definido em 2026-11-01, NOD-449, ADR-135): QUALQUER bot faz pela conversa o que a pessoa faz na tela Não
 * lidos — listar quem tem fala nova para ela, marcar uma, várias ou todas como lidas, desmarcar e desfazer a última
 * marcação. Listar põe no chat o card enxuto (a lista, ✓ por item, "Marcar todas como lidas"); marcar grava o recibo de
 * uma linha com Desfazer. Ao bot voltam só nomes, contagens e horas, nunca o texto das falas (não contamina o turno).
 * Só a pedido da pessoa, na conversa com ela (conversa ou criação). Mora fora de ferramentas-nod.ts pelo gatilho de 200
 * linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */
export const ACOES_NAO_LIDOS = ["listar", "marcar", "marcar_nao_lida", "desfazer"] as const;
export type AcaoNaoLidos = (typeof ACOES_NAO_LIDOS)[number];

/** Quantos nomes uma chamada cabe (a barra lateral de uma pessoa). */
export const MAX_CONVERSAS_NAO_LIDOS = 50;

export const PROPRIEDADES_NAO_LIDOS = {
  conversas: {
    type: "array",
    minItems: 1,
    maxItems: MAX_CONVERSAS_NAO_LIDOS,
    items: { type: "string", minLength: 1, maxLength: 120 },
    description: "As conversas: o nome do bot (ou da sala) como aparece em listar, ou o conversa_id.",
  },
  todas: { type: "boolean", description: "true marca todas as conversas com fala nova (o \"Marcar tudo como lido\")." },
} as const satisfies Record<string, JsonSchema>;

export const FERRAMENTAS_NAO_LIDOS = {
  nao_lidos: {
    type: "object",
    description:
      "As conversas com fala nova para a pessoa (a tela Não lidos), pela conversa. Use quando ela perguntar o que tem de novo, quem falou com ela, ou pedir para marcar como lido. Ações: listar (põe no chat o card com a lista; você recebe nome, quantas novas e a hora de cada uma, sem o texto); marcar {conversas} ou {todas: true} (marca como lidas e põe no chat um recibo de uma linha com Desfazer — não mande card de confirmação); marcar_nao_lida {conversas} (a última fala volta a ser nova); desfazer (desfaz a última marcação desta conversa). Falas entre bots não entram. Responda numa frase curta; o card e o recibo já mostram o resto.",
    properties: {
      acao: { type: "string", enum: [...ACOES_NAO_LIDOS] },
      ...PROPRIEDADES_NAO_LIDOS,
    },
    required: ["acao"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsNaoLidos = { acao: AcaoNaoLidos; conversas?: string[]; todas?: boolean };

/** Uma conversa com fala nova, do jeito que o bot a recebe: sem o texto (só metadados). */
export type NaoLidaParaBot = { conversa_id: string; nome: string; tipo: "bot" | "sala"; novas: number; ultima_em: string };

export type ErroNaoLidos = "fora_da_conversa" | "nao_encontrado" | "entrada_invalida" | "nada_para_desfazer" | "turno_nao_limpo";

export type ResultadoNaoLidos =
  | { ok: true; conversas: NaoLidaParaBot[]; instrucao: string }
  | { ok: true; marcadas: string[]; instrucao: string }
  | { ok: true; restauradas: number; instrucao: string }
  | { ok: false; erro: ErroNaoLidos; instrucao: string; disponiveis?: string[] };

export type ContratoFerramentasNaoLidos = { nao_lidos: { args: ArgsNaoLidos; resultado: ResultadoNaoLidos } };

/**
 * As linhas que a ferramenta grava no chat (kind sistema). `nao_lidos_lista`: o card; a web desenha com o estado AO VIVO
 * da tela Não lidos (o que já foi lido aparece com ✓), então o payload guarda só ids. `recibo_leitura`: a marcação e as
 * leituras do Desfazer; `desfeito` vira true quando desfeita (a linha passa a "voltaram para Não lidos").
 */
export type PayloadNaoLidosLista = { kind: "nao_lidos_lista"; conversas: { conversaId: string; agenteId: string | null; salaId: string | null; nome: string }[] };
export type PayloadReciboLeitura = { kind: "recibo_leitura"; nomes: string[]; leituras: LeituraMarcada[]; desfeito?: boolean };
