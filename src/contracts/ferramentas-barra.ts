import type { JsonSchema } from "./json-schema.ts";

/**
 * ajustar_barra_lateral (definido em 2026-10-29, NOD-119, jornada v2 C1): a pessoa pede a um bot "deixa a barra compacta",
 * "só os avatares" ou "volta ao normal" e ele responde com um card no chat (pergunta, Antes → Depois, nota, o botão com o
 * verbo e "Agora não"). Nada muda antes de a pessoa confirmar: a barra é deste computador (como o tema), então quem aplica
 * é a web, no clique, pelo mesmo executor de Configurações e da borda (web/lib/densidade.ts). A ferramenta só grava a
 * linha `sistema` com payload `ajuste_barra` (assunto `barra.ajuste`, chat). Um card por turno. Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

export const PEDIDOS_BARRA = ["compacta", "so_avatares", "normal"] as const;
export type PedidoBarraLateral = (typeof PEDIDOS_BARRA)[number];

/** A linha `sistema` do card (mensagem.ts): a web aplica no clique, neste computador. */
export type PayloadAjusteBarra = { kind: "ajuste_barra"; pedido: PedidoBarraLateral };

export const FERRAMENTAS_BARRA = {
  ajustar_barra_lateral: {
    type: "object",
    description:
      "Mostra à pessoa um card para mudar a barra lateral do nod neste computador: \"compacta\" (linhas mais baixas, sem a prévia), \"so_avatares\" (a barra recolhida, só os mascotes) ou \"normal\" (a Confortável de sempre). Use quando a pessoa pedir isso. Nada muda antes de ela confirmar no card: diga numa frase que deixou o card, sem dizer que já mudou.",
    properties: {
      pedido: { type: "string", enum: [...PEDIDOS_BARRA], description: "compacta, so_avatares ou normal." },
    },
    required: ["pedido"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAjustarBarraLateral = { pedido: PedidoBarraLateral };

/** fora_do_turno: o turno não é deste bot ou não é conversa (ou criação). ja_mostrou_neste_turno: um card por turno. */
export type ErroAjustarBarraLateral = "fora_do_turno" | "pedido_invalido" | "entrada_nao_confiavel" | "ja_mostrou_neste_turno";

export type ResultadoAjustarBarraLateral = { ok: true; mensagem_id: string; instrucao: string } | { ok: false; erro: ErroAjustarBarraLateral; instrucao: string };

export type ContratoFerramentasBarra = {
  ajustar_barra_lateral: { args: ArgsAjustarBarraLateral; resultado: ResultadoAjustarBarraLateral };
};
