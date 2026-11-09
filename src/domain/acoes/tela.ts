import type { DefinicaoAcao } from "../../contracts/acoes.ts";

/**
 * As telas que `tela.capturar` sabe abrir (NOD-398): nome → caminho FIXO na própria web do Nod. Lista fechada, sem URL
 * livre: o Chrome nunca vai a um endereço que veio do pedido (sem SSRF). A web hoje é uma página só (as seções abrem por
 * estado, não por caminho); tela nova entra aqui quando ganhar caminho próprio.
 */
export const TELAS_CAPTURAVEIS = { inicio: "/" } as const satisfies Record<string, string>;
export type TelaCapturavel = keyof typeof TELAS_CAPTURAVEIS;

/** As duas larguras do produto: celular e computador. */
export const LARGURAS_DE_CAPTURA = [390, 1440] as const;

/** Lê o corpo do pedido: tela da lista, largura 390|1440 (padrão 1440), nada além. Puro; `null` = entrada inválida. */
export function lerPedidoDeCaptura(corpo: unknown): { tela: TelaCapturavel; caminho: string; largura: (typeof LARGURAS_DE_CAPTURA)[number] } | null {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
  const c = corpo as Record<string, unknown>;
  if (Object.keys(c).some((k) => k !== "tela" && k !== "largura")) return null;
  if (typeof c.tela !== "string" || !Object.hasOwn(TELAS_CAPTURAVEIS, c.tela)) return null;
  const largura = c.largura === undefined ? 1440 : c.largura;
  if (!(LARGURAS_DE_CAPTURA as readonly unknown[]).includes(largura)) return null;
  const tela = c.tela as TelaCapturavel;
  return { tela, caminho: TELAS_CAPTURAVEIS[tela], largura: largura as (typeof LARGURAS_DE_CAPTURA)[number] };
}

export const ACOES_TELA = [
  {
    id: "tela.capturar",
    titulo: "Capturar uma tela do Nod",
    risco: "leitura",
    cartaoNoChat: false,
    schema: {
      type: "object",
      properties: {
        tela: { type: "string", enum: Object.keys(TELAS_CAPTURAVEIS) },
        // O subconjunto de JSON Schema só tem enum de texto: o 390|1440 a rota confere (lerPedidoDeCaptura).
        largura: { type: "integer", description: "390 (celular) ou 1440 (computador); sem ela, 1440" },
      },
      required: ["tela"],
      additionalProperties: false,
    },
    chat: { estado: "nunca", motivo: "só no dev, no CI e no efêmero (NOD_CAPTURA_TELA); captura no chat da pessoa pede revisão de privacidade à parte" },
  },
] as const satisfies readonly DefinicaoAcao[];
