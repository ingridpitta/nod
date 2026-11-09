/** NOD-346 (ADR-126): o que a tela Minha conta lê e recebe. Sem segredo: nem hash, nem token, nem id de sessão. */
export type EstadoExportacaoDto = "pedida" | "pronta" | "falhou";
export type ExportacaoDto = { id: string; estado: EstadoExportacaoDto; motivo: string | null; tamanho: number | null; pedidaEm: number; prontaEm: number | null; expiraEm: number | null };
export type PerfilDto = { nome: string | null; sobreMim: string | null; temFoto: boolean };
export type FormasDto = { senha: boolean; google: boolean };

export type MinhaContaDto = {
  perfil: PerfilDto;
  /** null = sessão sem conta (provisória ou de antes das contas): só o perfil aparece. */
  conta: {
    email: string;
    formas: FormasDto;
    trocaEmail: { para: string; expiraEm: number } | null;
    exclusao: { pedidaEm: number; purgarEm: number } | null;
    /** A exclusão só vale para o espaço pessoal (uma pessoa, uma conta). */
    podeExcluir: boolean;
  } | null;
  exportacao: ExportacaoDto | null;
  /** Até quando a reautenticação desta sessão vale (null = precisa confirmar). */
  reautenticadaAte: number | null;
  purgaLigada: boolean;
};

export type ReautenticarDto = { resultado: "ok"; ate: number } | { resultado: "recusado" } | { resultado: "errado"; restantes: number } | { resultado: "vencido" };
export type ConfirmarEmailDto = { resultado: "trocado"; email: string; encerradas: number } | { resultado: "invalido" } | { resultado: "email_em_uso" };
