/**
 * Declaração TypeScript do que a 0002 cria para rotinas (ADR-011), com nomes IDÊNTICOS aos do
 * banco (ADR-004 refinado). Duas UNIQUE: reivindicação de janela e idempotência do varredor.
 */
export const ROTINAS = {
  tabela: "rotinas",
  check: {
    nome: "rotinas_fuso_iana",
    /** definido em 2026-09-17: a 0010 aceita UTC além dos nomes com barra; offsets continuam recusados. */
    fragmento: "'^[A-Za-z_]+/[A-Za-z_/+-]+$'",
  },
  /** DEFAULT true na coluna: o gate nasce ligado por schema, nunca por texto (E7.3). */
  exigeAprovacaoDefault: true,
  /** definido em 2026-09-24 (0027): `acessos` é null (sem declaração) ou uma LISTA jsonb. */
  acessos: { coluna: "acessos", check: "rotinas_acessos_lista" },
  janelas: { tabela: "rotina_janelas", unique: "rotina_janelas_unica" },
  execucoes: { tabela: "rotina_execucoes", check: "rotina_execucoes_motivo_sem_texto_livre" },
  varredor: { tabela: "decisao_eventos_varridos", unique: "decisao_eventos_varridos_unico" },
} as const;
