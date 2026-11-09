/** definido em 2026-09-18 (ADR-038): recurso de arquivos independente do harness. */
export type ModoWorkspace = "auto" | "direto" | "worktree";

export type WorkspacePreparado = {
  id: string;
  modo: "direto" | "worktree";
  caminho: string;
  origem: string;
  git: null | { raiz: string; diretorioComum: string; commitInicial: string | null; branch: string | null };
};

/** Um projeto autorizado: pasta escolhida pela pessoa mais o ambiente já preparado para ela. */
export type ProjetoWorkspace = { id: string; pasta: string; preparado: WorkspacePreparado | null; autorizadoEm: number; ultimoUsoEm: number };
/**
 * definido em 2026-09-18: o bot é uma sessão viva, então a conversa guarda VÁRIOS projetos e um
 * ativo, não uma pasta só. Autorizar o segundo projeto não revoga o primeiro nem descarta o
 * ambiente preparado dele.
 */
export type VinculoWorkspace = { projetos: ProjetoWorkspace[]; ativoId: string | null };
/**
 * GET conversas/:id/workspace. definido em 2026-10-01: servidor e web leem o mesmo tipo; a web
 * declarava à parte o vínculo antigo de uma pasta e mostrava "Associada: undefined".
 */
export type WorkspaceDto = { disponivel: boolean; vinculo: VinculoWorkspace | null };

export type PedidoWorkspace = {
  id: string;
  /** Caminho já escolhido/autorizado na máquina; nunca um caminho arbitrário do modelo. */
  pastaAutorizada: string;
  modo: ModoWorkspace;
  /** Commit/ref para um NOVO worktree; ausente leva alterações e novos arquivos não ignorados. */
  referencia?: string;
};
