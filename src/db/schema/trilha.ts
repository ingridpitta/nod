/**
 * Declaração TypeScript do que a 0001 cria na trilha, com nomes IDÊNTICOS aos do banco (ADR-004
 * refinado). tests/conformidade/trilha.test.ts compara isto com pg_trigger e pg_constraint.
 */
export const TRILHA = {
  tabela: "trilha",
  prosa: "trilha_prosa",
  check: {
    nome: "trilha_sem_texto_livre",
    // Cada fragmento tem que aparecer em pg_get_constraintdef.
    fragmentos: ["'^[a-z0-9_]+$'", "'^[a-z0-9_:]+$'", "'^[A-Za-z0-9_-]+$'", "'^[a-z_]+$'"],
  },
  triggers: ["trilha_no_update", "trilha_no_truncate"],
  funcao: "nod_trilha_imutavel",
  /** Privilégios que nod_app NÃO pode ter sobre a trilha. */
  revogados: ["UPDATE", "DELETE", "TRUNCATE"],
} as const;

export interface LinhaTrilha {
  tenantId: string;
  id: string;
  ownerId: string;
  agenteId: string;
  turnoId: string | null;
  conectorId: string | null;
  ferramenta: string;
  kind: string;
  motivo: string | null;
  regra: string;
  regraVersao: number;
  em: string;
}
