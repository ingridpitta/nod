/**
 * Os PRs do GitHub ligados a uma tarefa do quadro (NOD-421). Só tipos (EMENDA 26); saiu de contracts/quadro.ts para o
 * arquivo de lá ficar nas 200 linhas (o quadro reexporta).
 */

/**
 * definido em 2026-11-02 (NOD-421): um PR do GitHub ligado à tarefa (pelo id no branch ou pelo pr_url). O laço de fundo
 * guarda o último estado visto; só a transição vira linha de sistema.
 */
export type EstadoPr = "aberto" | "mergeado" | "fechado";
export type CiPr = "pendente" | "ok" | "falhou";
export type PrDaTarefa = { repo: string; numero: number; url: string; branch: string; estado: EstadoPr; ci: CiPr | null; conflito: boolean };
/**
 * O PR como a fonte o leu: `conflito` null = o GitHub ainda não calculou (`mergeable: UNKNOWN`); o caso de uso mantém o
 * último valor visto (fixarConflito) em vez de tomar o UNKNOWN por "sem conflito".
 */
/** `fork` (isCrossRepository): o PR vem de um fork e nunca casa com tarefa. Ausente = do próprio repo. */
export type PrLido = Omit<PrDaTarefa, "conflito"> & { conflito: boolean | null; fork?: boolean };
export type TipoLinhaTarefa = "pr_ligado" | "ci_ok" | "ci_falhou" | "conflito" | "conflito_resolvido" | "pr_mergeado" | "pr_fechado" | "pr_reaberto";
/** Uma linha de sistema da tarefa (até o histórico da NOD-416: tabela quadro_tarefa_linhas). */
export type LinhaDeSistema = { tipo: TipoLinhaTarefa; texto: string; criadoEm: number };

/** O PR como a tela recebe: sem o branch (nome de fora que a tela não mostra; revisão do PR #621). */
export type PrNaTela = Omit<PrDaTarefa, "branch">;
