import type { JsonSchema } from "./json-schema.ts";

/**
 * gerir_maquinas (definido em 2026-11-07, ADA-243, ADR-135): QUALQUER bot responde onde os bots trabalham e escolhe a
 * máquina padrão da pessoa pela conversa, como ela faz no seletor "Máquina padrão" (Configurações › Computadores) e na
 * tela "Onde os bots trabalham" do onboarding. Escolher a padrão passa pelo MESMO executor da tela
 * (src/use-cases/acoes/maquinas.ts). Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é
 * espalhada em FERRAMENTAS_NOD.
 */
export const ACOES_GERIR_MAQUINAS = ["listar", "definir_padrao"] as const;
export type AcaoGerirMaquinas = (typeof ACOES_GERIR_MAQUINAS)[number];

/** As propriedades da ação; o registro (src/domain/acoes/maquinas.ts) reusa as mesmas. */
export const PROPRIEDADES_MAQUINAS = {
  maquina: { type: "string", minLength: 1, maxLength: 120, description: "definir_padrao: a máquina, pelo nome como aparece em listar (sem diferenciar maiúsculas e acentos) ou pelo id." },
  qualquer_uma: { type: "boolean", description: "definir_padrao: true tira a máquina padrão (os bots sem máquina rodam em qualquer uma conectada). Não mande junto com maquina." },
} as const satisfies Record<string, JsonSchema>;

export const FERRAMENTAS_MAQUINAS = {
  gerir_maquinas: {
    type: "object",
    description:
      "As máquinas (computadores) da pessoa onde os bots trabalham. Ações: listar (cada máquina com nome, se está ligada, a plataforma e qual é a padrão; com bot, diz em que máquina aquele bot trabalha — use para \"qual computador está rodando a Bruna?\"); definir_padrao {maquina} ou {qualquer_uma: true} (escolhe a máquina padrão, onde trabalham os bots sem máquina própria — \"trabalha neste computador a partir de agora\", \"manda os bots pro meu notebook\"). Você não sabe qual computador a pessoa está usando: se ela disser \"aqui\" ou \"este computador\" e houver mais de uma máquina, chame listar e pergunte qual pelo nome. Nome ambíguo ou desconhecido volta com as opções: pergunte antes de chamar de novo. Responda numa frase curta.",
    properties: {
      acao: { type: "string", enum: [...ACOES_GERIR_MAQUINAS] },
      bot: { type: "string", minLength: 1, maxLength: 80, description: "listar: o bot (nome exato ou id) para dizer onde ele trabalha." },
      ...PROPRIEDADES_MAQUINAS,
    },
    required: ["acao"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsGerirMaquinas = { acao: AcaoGerirMaquinas; maquina?: string; qualquer_uma?: boolean; bot?: string };

/** Uma máquina, do jeito que o bot a recebe. `ligada` = a ponte falou com ela há pouco (o chip da tela). */
export type MaquinaParaBot = { id: string; nome: string; ligada: boolean; plataforma: string | null; padrao: boolean };

export type ErroGerirMaquinas = "fora_da_conversa" | "entrada_invalida" | "nao_encontrado" | "nome_ambiguo";

export type ResultadoGerirMaquinas =
  | { ok: true; maquinas: MaquinaParaBot[]; padrao: string | null; bot?: { nome: string; trabalha_em: string | null; ligada: boolean | null }; instrucao: string }
  | { ok: true; padrao: { id: string; nome: string } | null; instrucao: string }
  | { ok: false; erro: ErroGerirMaquinas; instrucao: string; opcoes?: string[] };

export type ContratoFerramentasMaquinas = { gerir_maquinas: { args: ArgsGerirMaquinas; resultado: ResultadoGerirMaquinas } };
