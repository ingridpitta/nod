export const FORMAS_DO_APP = ["lista", "quadro", "painel", "doc"] as const;
export type FormaDoApp = (typeof FORMAS_DO_APP)[number];
export const FONTES_DO_APP = ["tarefas", "conector", "arquivo", "bot"] as const;
export type FonteDoApp = (typeof FONTES_DO_APP)[number];
export const ICONES_DO_APP = ["app", "lista", "quadro", "painel", "doc", "pessoas", "dinheiro", "agenda", "mala", "estrela"] as const;
export type IconeDoApp = (typeof ICONES_DO_APP)[number];
/** "Quem vê": só "só eu" no MVP; "todos que falam com o bot" entra com a NOD-443. */
export const QUEM_VE = ["so_eu"] as const;
export type QuemVe = (typeof QUEM_VE)[number];
/**
 * definido em 2026-11-02 (0145, CHECK de paginas_do_bot.ordem): no máximo 20 ids na ordem, a guardada e a pedida (pela
 * tela ou pelo gerir_apps). Uma constante só (revisão 7 do #626: o schema dizia 20 e o caso aceitava 40).
 */
export const MAX_ORDEM_GUARDADA = 20;

/**
 * QA do #626: as recusas das páginas que têm frase própria na tela (o limite, o nome em uso, a Conversa que fica). Saem
 * no corpo do 409 como `motivo`, ao lado do código e da frase fixa; o detalhe (nomes, contagens) fica só no log.
 */
export const MOTIVOS_RECUSA_APP = ["nome_em_uso", "limite_de_apps", "conversa_fica"] as const;
export type MotivoRecusaApp = (typeof MOTIVOS_RECUSA_APP)[number];

/**
 * Um item do retrato: o título, um detalhe, a coluna (forma quadro), um número (painel), desde quando o item espera (data
 * ISO; a regra `dias_desde` conta daqui) e se pede a pessoa.
 */
export type ItemDoRetrato = { titulo: string; detalhe?: string; coluna?: string; valor?: string; desde?: string; pede?: boolean };

/**
 * A regra do "pede você" que o servidor avalia (revisão 7 do #626, ADR-146): todas as condições dadas valem juntas. Um
 * item pede quando a coluna é esta (sem acento nem caixa), quando espera há mais de N dias (`desde`) e quando o número
 * do `valor` passa do limite. Sem ela, vale a marca `pede` que o bot grava num turno limpo (o jeito antigo).
 */
export type PedeQuando = { coluna?: string; dias_desde?: number; valor_acima?: number; valor_abaixo?: number };
/** O retrato que o bot grava e a tela mostra. `texto` é o corpo da forma doc. */
export type RetratoDoApp = { itens: ItemDoRetrato[]; texto?: string };

/** O estado da página do app na tela: a fonte falhou, o retrato está vazio (ou ainda não veio) ou há o que mostrar. */
export type EstadoDoApp = "erro" | "vazio" | "pronto";

/**
 * NOD-445 (0145, ADR-146): o que a web e a ferramenta gerir_apps trocam sobre as páginas do bot. A ordem são ids de
 * página: "conversa", "tarefas" e "app:<uuid>"; a primeira é a home do bot.
 */
export type AppDto = {
  id: string;
  nome: string;
  icone: IconeDoApp;
  fonte: FonteDoApp;
  fonteRef: string | null;
  forma: FormaDoApp;
  quemVe: QuemVe;
  regraPede: string | null;
  /** A regra estruturada que o servidor avalia; null = vale a marca `pede` do bot. */
  pedeQuando: PedeQuando | null;
  /** O retrato; com `pedeQuando`, o `pede` de cada item já vem calculado pelo servidor. */
  dados: RetratoDoApp | null;
  erroFonte: string | null;
  /** O app acende o laranja (regra + item marcado pelo bot, fonte sem erro). */
  pedeVoce: boolean;
  /** O estado da página (`estadoDoApp`): o app recém-criado, sem retrato, é "vazio" (a frase e o exemplo), não esqueleto. */
  estado: EstadoDoApp;
  criadoEm: number;
  atualizadoEm: number;
};

export type PaginasDto = {
  agenteId: string;
  /** A ordem que vale (normalizada: o que sumiu sai, o que é novo entra no fim). */
  ordem: string[];
  apps: AppDto[];
  /** O bot tem quadro (a página Tarefas existe). */
  temTarefas: boolean;
  /** ADA-13: o bot tem acesso ao app Canvas (a página "canvas" existe, fora do limite). */
  temCanvas?: boolean;
  /** Cabe mais um app (até 11: a 12ª página é de Tarefas, reservada mesmo sem quadro). */
  cabeMais: boolean;
  /** O limite de páginas além da Conversa (12, Tarefas conta). */
  limite: number;
};

/** O card Criar/Ajustar pela conversa (kind 'app'): o app proposto, ainda sem existir. */
export type PayloadPropostaApp = {
  kind: "app";
  /** O bot que ganha o app (pode ser outro que o da conversa: "cria um app de vagas para a Nina"). */
  alvoId: string;
  alvoNome: string;
  nome: string;
  icone: IconeDoApp;
  fonte: FonteDoApp;
  fonteRef: string | null;
  forma: FormaDoApp;
  quemVe: QuemVe;
  regraPede: string | null;
  /** A regra estruturada (revisão 7 do #626); ausente nos cards antigos. */
  pedeQuando?: PedeQuando | null;
  turnoId?: string;
  /** Preenchido ao confirmar: o app criado. */
  appId?: string | null;
};

/** gerir_apps: os argumentos chegam validados pelo schema (src/contracts/ferramentas-apps.ts); o caso revalida. */
export type ArgsGerirApps = {
  op: "listar" | "propor" | "editar" | "ordenar" | "remover" | "restaurar";
  bot?: string; app?: string; nome?: string; icone?: string; fonte?: string; fonte_ref?: string | null; forma?: string; regra_pede?: string | null; pede_quando?: PedeQuando | null;
  dados?: { itens: ItemDoRetrato[]; texto?: string } | null; erro_fonte?: string | null;
  ordem?: string[]; pagina?: string; posicao?: number; antes_de?: string; depois_de?: string;
};

/** O que o bot recebe: as páginas como ele as diz à pessoa (nome, não id) e a instrução do próximo passo. */
export type ResultadoGerirApps =
  | { ok: true; paginas: { pagina: string; nome: string; posicao: number }[]; /** ADA-9: o nome da primeira página, a que abre primeiro (a view padrão). */ tela_inicial: string; apps: { id: string; nome: string; forma: FormaDoApp; fonte: FonteDoApp; regra_pede: string | null; pede_quando: PedeQuando | null; pede_voce: boolean; erro_fonte: string | null }[]; cabe_mais: boolean; proposta_id?: string; cards_fechados?: { proposta_id: string; nome: string }[]; app_id?: string; instrucao: string }
  | { ok: false; erro: "experimento_desligado" | "nao_encontrado" | "entrada_invalida" | "nome_em_uso" | "limite_de_apps" | "conversa_fica"; sugestao?: string; instrucao: string };
