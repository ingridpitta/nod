import type { JsonSchema } from "./json-schema.ts";

/**
 * abrir_conta (definido em 2026-10-28, NOD-351, ADR-124 §4): qualquer bot abre, na conversa, o cartão de conta da NOD-345
 * que serve ao pedido da pessoa. A ferramenta NÃO executa nada: o servidor escolhe o cartão pela situação da conta da
 * pessoa do turno e manda o frame `conta.abrir` só para ela; quem age é a pessoa, no cartão (a confirmação de sair das
 * outras sessões e de importar continua lá). Os args são só o enum do pedido: nenhum campo leva senha, código, token ou
 * cookie, e o resultado também não (nem o e-mail da conta). Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da
 * EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */
export const PEDIDOS_DE_CONTA = ["criar", "entrar", "trocar_senha", "sair_das_outras", "conectar_computador"] as const;
export type PedidoDeConta = (typeof PEDIDOS_DE_CONTA)[number];

/**
 * Os cartões que o chat abre: o subconjunto das etapas diretas de web/telas/conta-no-chat.ts (`inicio` = criar conta,
 * Google ou e-mail; `parear-gerar` = gerar o código de pareamento). A web confere de novo a lista ao receber o frame.
 */
export const ETAPAS_PELO_CHAT = ["inicio", "entrar", "senha", "recuperar", "sessoes", "parear-gerar"] as const;
export type EtapaPeloChat = (typeof ETAPAS_PELO_CHAT)[number];

/** A situação da conta da pessoa do turno, lida pelo servidor (situacaoDaConta, em contas.repo.ts, na transação do turno). */
export type SituacaoConta =
  /** espaço provisório: sem conta e sem o login de antes */
  | "sem_conta"
  /** pessoa de antes das contas (login Google da ADR-030), sem conta: tem sessões, não tem senha */
  | "legado"
  /** conta sem senha (só Google) de pessoa nascida fora do login de antes: a recuperação cria a primeira senha */
  | "conta_sem_senha"
  /** conta só Google de pessoa do login de antes: entra só pelo Google, o link de recuperação não cria senha */
  | "conta_google_de_antes"
  | "conta_com_senha"
  /** sem conta, fora do provisório e sem o login Google de antes (pessoa de time sem e-mail, instalação aposentada, login de teste) */
  | "fora_das_contas";

export const FERRAMENTAS_CONTA = {
  abrir_conta: {
    type: "object",
    description:
      "Abre, nesta conversa, o cartão de conta do nod que a pessoa pediu: criar conta, entrar ou trocar de conta, trocar a senha, sair dos outros computadores ou conectar outro computador. Você não executa nada: a pessoa preenche e confirma no cartão. Nunca peça, receba ou repita senha, código, token ou cookie. Se o pedido for ambíguo, pergunte qual destes antes de chamar. Se voltar sem cartão, explique o motivo que vier na instrução.",
    properties: {
      pedido: { type: "string", enum: [...PEDIDOS_DE_CONTA], description: "criar = criar conta; entrar = entrar ou trocar de conta; trocar_senha = alterar ou recuperar a senha; sair_das_outras = sair dos outros computadores/sessões; conectar_computador = conectar outro computador com um código." },
    },
    required: ["pedido"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAbrirConta = { pedido: PedidoDeConta };

/**
 * Sem cartão: `sem_conta` (pedido que exige conta, no espaço provisório), `ja_tem_conta` (criar com conta ou login de
 * antes), `entra_pelo_google` (senha ou código para quem entra só pelo Google do login de antes), `nao_foi_a_pessoa`
 * (o turno não nasceu de uma fala confiável da própria pessoa), `fora_das_contas` (espaço que não usa conta do nod),
 * `indisponivel` (contas desligadas).
 */
export type MotivoSemCartao = "sem_conta" | "ja_tem_conta" | "entra_pelo_google" | "nao_foi_a_pessoa" | "fora_das_contas" | "indisponivel";

export type ResultadoAbrirConta =
  | { aberto: EtapaPeloChat; instrucao: string }
  | { aberto: null; motivo: MotivoSemCartao; instrucao: string };

export type ContratoFerramentasConta = {
  abrir_conta: { args: ArgsAbrirConta; resultado: ResultadoAbrirConta };
};
