/**
 * Declaração TypeScript do que a 0052 cria para a admissão por domínio (emenda de 2026-10-05 da ADR-030), com
 * nomes IDÊNTICOS aos do banco. tests/conformidade/admissao-por-dominio.test.ts compara isto com o catálogo.
 */
export const ADMISSAO = {
  tabela: "dominios_admitidos",
  funcao: "nod_admitir_pessoa(text, text, text)",
  /** Catálogo de identidade: nod_app só lê; quem escreve é o seed e a função acima. */
  identidade: ["pessoas", "tenants"],
  /** Privilégios de escrita que nod_app NÃO pode ter nas tabelas de identidade. */
  escritas: ["INSERT", "UPDATE", "DELETE", "TRUNCATE"],
  /** Em dominios_admitidos nod_app não pode ter NENHUM destes (só a função, que é do dono, lê a tabela). */
  todos: ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"],
  /** Quem pode executar a função: o dono e a aplicação. PUBLIC não. */
  executam: ["nod_app", "nod_dono"],
} as const;
