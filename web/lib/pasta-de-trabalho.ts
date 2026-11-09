import type { ProjetoWorkspace, VinculoWorkspace } from "../../src/contracts/workspace.ts";

/** A conversa guarda vários projetos e um ativo; o diálogo mostra e abre o ativo (como projetoAtivo no servidor). */
export function projetoAtivo(vinculo: VinculoWorkspace | null): ProjetoWorkspace | null {
  return vinculo?.projetos.find((p) => p.id === vinculo.ativoId) ?? null;
}

/** A linha de estado do diálogo da Pasta de trabalho (web/telas/workspace.ts). */
export function textoDaPasta(vinculo: VinculoWorkspace | null): string {
  const ativo = projetoAtivo(vinculo);
  if (!ativo) return "Nenhuma pasta associada.";
  return `Associada: ${ativo.pasta}${ativo.preparado ? ` · Trabalhando em: ${ativo.preparado.caminho}` : ""}`;
}
