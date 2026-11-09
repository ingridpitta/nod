import type { JsonSchema } from "./json-schema.ts";

/**
 * pedir_credencial (definido em 2026-10-28, NOD-50): o bot pede UMA chave por um cartão só de escrita, para um alvo fixo —
 * uma chave (env ou header) de um conector que a pessoa já tem, o token do GitHub ou a chave do Composio. Nunca caminho,
 * variável de sistema nem URL. O valor vai da web direto ao cofre (POST propostas/:id/credencial) e o bot recebe só
 * `guardada` ou `recusada` na retomada. Os args não levam valor nenhum: eles ficam gravados com a chamada da ferramenta.
 * Mora fora de ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

/**
 * definido em 2026-10-28 (NOD-50, 0115): o cartão de pedido de credencial. O bot pede UMA chave para um alvo fixo — uma
 * chave (env ou header) de um conector da pessoa, o token do GitHub ou a chave do Composio — e a pessoa cola o valor num
 * campo que vai da web direto ao cofre (POST /propostas/:id/credencial). O payload NUNCA leva o valor: só o alvo, o nome
 * legível do app e o "para" que o bot escreveu. Decisão de mesmo id em "Sua vez"; o modo automático nunca a resolve.
 */
export type AlvoCredencial = "conector" | "github_token" | "composio";
export type PayloadPropostaCredencial = {
  kind: "credencial";
  alvo: AlvoCredencial;
  /** O conector alvo (alvo "conector"); null nos outros. */
  conectorId: string | null;
  /** Nome legível do app para o cartão ("Exemplo", "GitHub", "Composio"). */
  app: string;
  /** Nome da chave do env/header (alvo "conector"); null nos outros. */
  chave: string | null;
  /** Para que o bot quer a chave, até 80 caracteres (sempre preenchido: há um padrão). */
  para: string;
  turnoId?: string;
};

/** O teto do "para" no cartão (protótipo da NOD-50): mais que isso é cortado com reticências. */
export const TETO_PARA_CREDENCIAL = 80;

export const FERRAMENTAS_CREDENCIAL = {
  pedir_credencial: {
    type: "object",
    description:
      "Pede à pessoa UMA chave, token ou senha de API por um cartão seguro: ela cola o valor num campo que vai direto ao cofre, e você nunca o vê. Use sempre que faltar uma credencial — nunca peça para colar segredo no chat. Alvos: 'conector' (uma chave do env ou header de um conector que a pessoa já tem; informe conector e chave), 'github_token' (o token pessoal do GitHub) ou 'composio' (a chave do Composio do time). Se voltar 'pendente', diga em uma frase que pediu e ENCERRE o turno: a resposta volta como guardada ou recusada.",
    properties: {
      alvo: { type: "string", enum: ["conector", "github_token", "composio"], description: "Onde a chave vai ser guardada." },
      conector: { type: "string", description: "Slug do conector já registrado (só no alvo 'conector').", minLength: 1, maxLength: 64 },
      chave: { type: "string", description: "Nome exato da variável de ambiente (stdio) ou do header (http) que falta, como EXEMPLO_API_KEY (só no alvo 'conector').", minLength: 1, maxLength: 128 },
      para: { type: "string", description: "Para que você precisa da chave, numa frase curta que começa com verbo no infinitivo. Ex.: \"Ler os pedidos de hoje da loja\".", maxLength: 200 },
    },
    required: ["alvo"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsPedirCredencial = { alvo: AlvoCredencial; conector?: string; chave?: string; para?: string };

/**
 * conector_nao_encontrado: não há conector com esse slug que seja da pessoa. conector_nativo: o conector é do nod
 * (`nod:`), e as chaves dele têm caminho próprio — use o alvo github_token ou composio. chave_invalida: o nome da chave não
 * serve para o transporte do conector, é variável de sistema (PATH, NODE_*, LD_*…) ou faltou. composio_ja_configurado: o
 * time já tem chave do Composio — trocar a do time inteiro é na tela do Composio, não por pedido do bot. Em todos, nenhum
 * cartão nasce.
 */
export type ErroPedirCredencial = "conector_nao_encontrado" | "conector_nativo" | "chave_invalida" | "composio_ja_configurado";

export type ResultadoPedirCredencial =
  | { estado: "pendente"; proposta_id: string; instrucao: string }
  | { estado: "recusada"; erro: ErroPedirCredencial; instrucao: string };

export type ContratoFerramentasCredencial = {
  pedir_credencial: { args: ArgsPedirCredencial; resultado: ResultadoPedirCredencial };
};
