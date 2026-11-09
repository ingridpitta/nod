/**
 * ADA-14 (ADR-153): um bot com N quadros, o quadro em mais de um bot e o projeto da pessoa. Mora fora de quadro.ts (o teto
 * de 200 linhas dos contratos).
 */

/** O nome que a tela e o chat mostram para o quadro sem nome (o migrado e o criado sem nome): o nome da página de antes. */
export const NOME_QUADRO_PADRAO = "Tarefas";

/** Os tetos (S10 do plano): por bot, por pessoa e de projetos ativos. */
export const LIMITES_QUADROS = { nome: 60, descricaoProjeto: 2000, metaProjeto: 200, quadrosPorBot: 50, quadrosPorPessoa: 200, projetos: 100 } as const;

export type Projeto = {
  id: string;
  nome: string;
  descricao: string;
  meta: string | null;
  /** AAAA-MM-DD, ou null. */
  prazo: string | null;
  posicao: number;
  arquivadoEm: number | null;
  criadoEm: number;
  atualizadoEm: number;
};

/** Um bot em que o quadro aparece (o dono é o `quadros.agente_id`). */
export type BotDoQuadroDto = { id: string; nome: string; dono: boolean };

/** Uma linha do seletor: o quadro já com o nome resolvido ("Tarefas" sem nome) e o progresso só com meta (ADR-141). */
export type QuadroDoBotDto = {
  id: string;
  nome: string;
  /** O nome gravado (null = "Tarefas"). */
  nomeProprio: string | null;
  prefixo: string | null;
  projetoId: string | null;
  padrao: boolean;
  meta: string | null;
  prazo: string | null;
  abertas: number;
  feitas: number;
  total: number;
  bots: BotDoQuadroDto[];
};

export type ProjetoDto = Projeto & {
  quadros: number;
  /** Só com meta: a soma do "N de M" dos quadros do projeto que têm meta (null sem meta). */
  progresso: { feitas: number; total: number } | null;
};

/** GET /agentes/:id/quadros: o seletor do app Quadro. */
export type QuadrosDoBotDto = {
  quadros: QuadroDoBotDto[];
  projetos: ProjetoDto[];
  /** O que a tela abre: o último aberto neste bot (se ainda vinculado), senão o padrão. */
  aberto: string | null;
  padrao: string | null;
  /** A flag NOD_QUADROS_N deixa criar o 2º quadro (a tela mostra "+ Novo quadro"). */
  podeCriarOutro: boolean;
};

/** As ops do gerir_quadro que não são do lote de um quadro (sem Desfazer de lote; o inverso é a op contrária). */
export type OpQuadrosDoBot =
  | { tipo: "listar_quadros"; todos?: boolean }
  | { tipo: "abrir_quadro"; quadro: string }
  | { tipo: "definir_padrao"; quadro: string; bot?: string }
  | { tipo: "vincular_bot"; quadro: string; bot: string }
  | { tipo: "desvincular_bot"; quadro: string; bot: string }
  | { tipo: "criar_projeto"; nome: string; descricao?: string; meta?: string | null; prazo?: string | null }
  | { tipo: "editar_projeto"; projeto: string; nome?: string; descricao?: string; meta?: string | null; prazo?: string | null }
  | { tipo: "arquivar_projeto"; projeto: string }
  | { tipo: "restaurar_projeto"; projeto: string };
export type TipoOpQuadrosDoBot = OpQuadrosDoBot["tipo"];
export const OPS_QUADROS_DO_BOT = ["listar_quadros", "abrir_quadro", "definir_padrao", "vincular_bot", "desvincular_bot", "criar_projeto", "editar_projeto", "arquivar_projeto", "restaurar_projeto"] as const satisfies readonly TipoOpQuadrosDoBot[];

/** As que mexem no que a pessoa organizou: só num turno limpo da pessoa (o corte das colunas, ADR-140 §5). */
export const OPS_QUADROS_DO_BOT_DA_PESSOA = ["definir_padrao", "vincular_bot", "desvincular_bot", "arquivar_projeto"] as const satisfies readonly TipoOpQuadrosDoBot[];

/** As falhas próprias dos N quadros (as frases moram em src/adapters/http/erros.ts e no gerir_quadro). */
export type FalhaQuadrosDoBot =
  | "quadro_ambiguo"
  | "quadro_fora_do_bot"
  | "ultimo_quadro_do_bot"
  | "projeto_nome_em_uso"
  | "um_por_bot_ainda"
  | "limite_de_quadros";
