import type { JsonSchema } from "./json-schema.ts";

/**
 * NOD-61 (definido em 2026-10-29): o bot busca e lê as próprias conversas passadas, para o "lembra quando…" ir além das
 * falas recentes do plano (ADR-111). Só leitura e só no que é do bot: a conversa própria dele (com as falas das tasks e
 * frentes, que moram nela) e as salas de que ele é membro. Mensagem de outro bot da mesma pessoa responde `nao_encontrado`,
 * igual a id inexistente (ADR-058/066). O resultado chega NÃO confiável (ADR-026): o histórico tem conteúdo de fora.
 * Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD. Os números
 * dos schemas são os de src/domain/conversas-passadas.ts, repetidos porque o schema precisa de literal.
 */
export const FERRAMENTAS_CONVERSAS = {
  buscar_conversas: {
    type: "object",
    description:
      "Busca nas suas conversas passadas com a pessoa (e nas salas de que você participa; numa sala, só nela) as falas que contêm um termo, sem ligar para acento ou caixa, da mais nova à mais antiga. Use quando a pessoa disser \"lembra quando…\" ou citar algo que não está nas falas recentes. Devolve até 10 resultados com mensagem_id, quando (UTC), autor e um trecho; para ler a conversa em volta, chame ler_conversa com o mensagem_id. Leitura: nada muda.",
    properties: {
      termo: { type: "string", description: "Uma palavra ou expressão curta que deve aparecer na fala (ex.: \"orçamento\").", minLength: 2, maxLength: 100 },
      antes_de: { type: "string", description: "Só falas anteriores a isto: uma data (AAAA-MM-DD, meia-noite UTC), um instante ISO com fuso ou o valor mais_antigos do resultado anterior, para continuar.", minLength: 1, maxLength: 80 },
      limite: { type: "integer", description: "Quantos resultados, de 1 a 10 (padrão 10; fora disso vale o mais perto)." },
    },
    required: ["termo"],
    additionalProperties: false,
  },
  ler_conversa: {
    type: "object",
    description:
      "Lê a conversa em volta de uma fala que buscar_conversas achou: a fala pedida e as vizinhas, em ordem, até 20, só texto, com autor e hora (UTC). Cada fala vem com até 2.000 caracteres; a que passa disso vem com continua_de: para ler o resto, chame de novo com o mensagem_id dela e a_partir_de = continua_de. Leitura: nada muda.",
    properties: {
      mensagem_id: { type: "string", description: "O mensagem_id que buscar_conversas devolveu.", minLength: 1, maxLength: 80 },
      antes: { type: "integer", description: "Quantas falas antes da pedida, de 0 a 19 (padrão 5)." },
      depois: { type: "integer", description: "Quantas falas depois da pedida, de 0 a 19 (padrão 5). A janela tem até 20 com a pedida: antes tem preferência e, se faltarem falas antes, vêm mais depois." },
      a_partir_de: { type: "integer", description: "Para continuar uma fala longa: o continua_de que ela trouxe. Com ele vem só a fala pedida, do caractere indicado em diante." },
    },
    required: ["mensagem_id"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsBuscarConversas = { termo: string; antes_de?: string; limite?: number };
export type ArgsLerConversa = { mensagem_id: string; antes?: number; depois?: number; a_partir_de?: number };

/** Onde a fala está: a sua conversa com a pessoa ou uma sala (pelo nome). */
export type OndeDaFala = { tipo: "conversa" } | { tipo: "sala"; nome: string };

export type FalaAchada = { mensagem_id: string; quando: string; autor: string; onde: OndeDaFala; trecho: string };
/** cortada: o texto parou no teto; continua_de: o a_partir_de que lê o resto (critério 5 da NOD-61). */
export type FalaLida = { mensagem_id: string; quando: string; autor: string; texto: string; pedida?: true; cortada?: true; continua_de?: number };

/** termo_invalido: só espaços ou caractere de controle. antes_de_invalido: nem data, nem instante, nem cursor. busca_demorou: passou de 4 s. */
export type ErroBuscarConversas = "termo_invalido" | "antes_de_invalido" | "busca_demorou";

export type ResultadoBuscarConversas = { resultados: FalaAchada[]; mais_antigos: string | null } | { erro: ErroBuscarConversas };
export type ResultadoLerConversa = { onde: OndeDaFala; mensagens: FalaLida[] } | { erro: "nao_encontrado" };

export type ContratoFerramentasConversas = {
  buscar_conversas: { args: ArgsBuscarConversas; resultado: ResultadoBuscarConversas };
  ler_conversa: { args: ArgsLerConversa; resultado: ResultadoLerConversa };
};
