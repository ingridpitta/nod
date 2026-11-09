import type { AcaoLote, TipoAcaoLote } from "./ferramentas-do-nod.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * O registro único de ações (definido em 2026-10-28, NOD-391, ADR-135): toda ação de pessoa que muda algo é declarada UMA
 * vez, com um id `dominio.verbo`. A rota de pessoa que muda algo declara o id (`Rota.acao`), o lote do Nod deriva dele o
 * enum e o risco, e a catraca de paridade (tests/conformidade/paridade.test.ts) mede o que o chat já faz.
 *
 * Só tipos (EMENDA 26): o registro, puro, mora em src/domain/acoes/.
 */

/** O risco da ação, mapeado no modo de aprovação (ADR-082 §3, ADR-135 §3). */
export type RiscoAcao =
  /** nunca vira cartão */
  | "leitura"
  /** segue o modo do bot */
  | "muda"
  /** cartão no manual e no automático */
  | "arriscada"
  /** sempre a pessoa, inclusive em "Ignorar todas as aprovações" */
  | "pessoa_confirma";

/** As ondas do projeto Tudo pelo chat donas do que ainda falta no chat. */
export const ONDAS = ["NOD-393", "NOD-394", "NOD-395", "NOD-396", "NOD-397", "NOD-400"] as const;
export type Onda = (typeof ONDAS)[number];

/** O nome legível de cada onda (o docs/paridade.md agrupa por elas). */
export const NOME_DA_ONDA = {
  "NOD-393": "Onda 1: bots e rotinas",
  "NOD-394": "Onda 2: apps e acessos",
  "NOD-395": "Onda 3: conta e segurança",
  "NOD-396": "Onda 4: máquinas e computadores",
  "NOD-397": "Onda 5: conversa, salas, voz e preferências",
  "NOD-400": "Onda 4b: contas de IA",
} as const satisfies Record<Onda, string>;

/** Por onde o chat chega à ação: hoje, uma ferramenta do bot (o nome dela) e, no lote, o tipo da ação. */
export type ViaNoChat = { ferramenta: string; tipoNoLote?: TipoAcaoLote };

/**
 * O estado da ação no chat.
 * - `vivo`: tem caminho no chat, o mesmo executor da tela e um teste de contrato verde (`contrato`, o arquivo do teste).
 * - `parcial`: tem caminho, mas diverge da tela ou falta parâmetro (`falta` diz o quê).
 * - `falta`: sem caminho ainda; `onda` é a issue dona.
 * - `nunca`: exceção escrita (senha, sessão, pareamento, o próprio chat); `motivo` diz por quê.
 */
export type EstadoNoChat =
  | { estado: "vivo"; via: ViaNoChat; contrato: string }
  | { estado: "parcial"; via: ViaNoChat; falta: string }
  | { estado: "falta"; onda: Onda }
  | { estado: "nunca"; motivo: string };

/** O que o lote do Nod precisa da ação (só as que o gerir_bots executa). */
export type AcaoNoLoteDoRegistro = {
  tipo: TipoAcaoLote;
  /** O risco desta chamada, quando depende dos argumentos (mudar_modo para "total" → pessoa_confirma). Ausente = `risco`. */
  riscoDe?: (a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo" | "nivel_lote">) => RiscoAcao;
  /**
   * Cerca 3 (ADR-082): depois de conteúdo de fora no turno, esta chamada vira cartão também no automático? Ausente = não.
   * `alvoTemAcessos`: o bot alvo tem concessões (a cópia as levaria).
   */
  deFora?: (a: Pick<AcaoLote, "tipo" | "descricao" | "titulo" | "modo" | "nivel_lote">, s: { alvoTemAcessos: boolean }) => boolean;
};

export type DefinicaoAcao = {
  /** `dominio.verbo`, minúsculas e sublinhado. */
  id: string;
  /** O que a pessoa faz, numa frase curta (o docs/paridade.md mostra). */
  titulo: string;
  /** Os argumentos, no formato das ferramentas. Obrigatório em `vivo` e `parcial`. */
  schema?: JsonSchema;
  risco: RiscoAcao;
  /** No chat, a ação mostra um cartão para a pessoa (o pedido de acesso, o lote que espera)? */
  cartaoNoChat: boolean;
  chat: EstadoNoChat;
  /** A chave do executor único (src/use-cases/acoes/), quando a tela e o chat já passam por ele. */
  casoDeUso?: string;
  /** NOD-393: o pedido tem de vir de uma pessoa (não de um bot repassando). Nasce sem uso. */
  exigeOrigemHumana?: boolean;
  lote?: AcaoNoLoteDoRegistro;
  /**
   * A ação não tem rota de pessoa em /api/t (a conta mora em /api/conta, rota pública) e o motivo; ausente = a catraca
   * exige ao menos uma rota de pessoa com este id.
   */
  semRotaDePessoa?: string;
};

/**
 * O que só roda depois do commit da transação (o efeito fora do banco, ADR-135 §4). `importar_linear` (NOD-422): a
 * importação confirmada é trazida do Linear em segundo plano (não segura a resposta do Confirmar).
 */
export type EfeitoAposCommit =
  | { tipo: "desligar_computador"; agenteId: string }
  | { tipo: "importar_linear"; importacaoId: string }
  /** ADA-245: o computador removido sem o app dele na frente (outra tela, o chat): ligado, a limpeza vai na puxada; desligado, sai da conta agora. */
  | { tipo: "remover_computador"; maquinaId: string; manterIas: boolean; manterConexao: boolean };
