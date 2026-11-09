/**
 * O "/" do chat (definido em 2026-09-28; canvas "Nod — tela do agente", página "Comandos /"). Dois tipos de comando:
 *  - os do Mac da pessoa: as skills e os comandos que o Claude Code dela carrega (as dela, as dos plugins, as do
 *    projeto e as embutidas que fazem sentido no chat). A lista vem do `init` de um turno real mais o frontmatter
 *    de cada SKILL.md, lido no próprio Mac;
 *  - os da conversa: ações do nod com o nome do terminal como apelido (/contexto = /context).
 * Medido no CLI 2.1.284: "/nome args" no começo do prompt roda a skill em `-p` sem depender do modelo.
 */

/** Um comando do Mac: nome como o CLI o aceita depois da barra (`review`, `posthog:auditing-endpoints`). */
export type ComandoDoMac = {
  nome: string;
  /** A primeira linha do `description` do frontmatter; vazia quando o comando não tem arquivo (embutido). */
  descricao: string;
  /** De onde vem, como a pessoa reconhece: "gstack", "posthog", "acme", "Claude Code", "suas". */
  origem: string;
  /** O `argument-hint` do frontmatter, quando houver. */
  argumento?: string;
};

export type CatalogoDeComandos = {
  comandos: ComandoDoMac[];
  /** Comandos que o Claude Code tem e o chat não oferece (/doctor, /theme): o "/" diz que são do terminal. */
  soDoTerminal: string[];
  versaoCli: string | null;
};

/** Tetos do catálogo: ele viaja na entrega do turno (corpo de até 1 MB, com a fala de até 100 mil caracteres). */
export const TETO_COMANDOS = 1000;
export const TETO_DESCRICAO_COMANDO = 300;
export const TETO_SO_DO_TERMINAL = 300;

/**
 * Um comando da conversa. `turno`: vira um turno com o comando do CLI no lugar do nome (/contexto → /context);
 * `nod`: o nod resolve sem turno (/nova-sessao); `tela`: a web abre uma tela (/modelo).
 */
export type ComandoDaConversa = {
  nome: string;
  apelidos: string[];
  descricao: string;
  acao: "turno" | "nod" | "tela";
  /** Só em `turno`: o comando do Claude Code que vai no lugar do nome. */
  cli?: string;
  /** Não chama o modelo (medido: /context e /cost custam US$ 0). */
  gratis?: boolean;
  /** NOD-23: só no "/" da conversa com um bot da própria pessoa, já confirmado (nunca no Nod nem em bot alheio). */
  soBotProprio?: boolean;
};

/** GET comandos: o catálogo do Mac da pessoa (null antes do primeiro turno no Claude Code) e os da conversa. */
export type ComandosDto = {
  doMac: CatalogoDeComandos | null;
  /** Quando o catálogo chegou do Mac pela última vez. */
  doMacEm: number | null;
  daConversa: ComandoDaConversa[];
};
