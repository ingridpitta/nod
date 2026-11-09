import type { IdColuna } from "./quadro.ts";

/**
 * NOD-422 (definido em 2026-11-02): trazer um time do Linear para o quadro pelo servidor (decisão 1 da Ada). A op
 * `importar_time_linear` abre um card de prévia (proposta e decisão 'importacao_linear', mesmo id); confirmar grava uma
 * importação 'trazendo' e o servidor busca em segundo plano, com progresso, e aplica tudo num lote só com Desfazer.
 * Fica separado do quadro.ts para não passar do teto de linhas dos contratos.
 */

/** A op do gerir_quadro: o servidor traz as issues abertas do time (sozinha na chamada); vira o card de prévia. */
export type OpImportarTimeLinear = { tipo: "importar_time_linear"; time: string; filtro?: "sem_backlog" };
/** As recusas do gerir_quadro próprias da importação (somadas às do quadro). */
/** Revisão 4 do PR #630: `importacao_indisponivel` = a busca pelo servidor está desligada (NOD_LINEAR_SERVIDOR), não é acesso. */
/**
 * Revisão 6 do PR #630: `linear_indisponivel` = o Linear (ou o Composio) não respondeu (prazo, 5xx, rede): é passageiro,
 * não falta de acesso. `sem_conector` fica para a falta de conexão e a recusa de autorização (integracao_autenticacao).
 */
export type FalhaImportacao = "sem_conector" | "linear_indisponivel" | "importacao_indisponivel" | "importacao_em_andamento" | "demais";
/**
 * QA do PR #630: a causa do `sem_conector` dita igual pela prévia (a tela) e pelo Trazer (o 409 da rota). Sem a chave do
 * Composio ou sem a sessão do Linear a causa para a pessoa é a mesma: o Linear não está conectado; o Conectar em
 * Conectores leva à chave quando ela falta.
 */
export const FRASE_SEM_CONECTOR = "O Linear não está conectado. Conecte o Linear (só leitura) em Conectores e tente de novo.";
/** Revisão 6 do PR #630: a falha passageira do Linear (prazo, 5xx, rede), dita igual pela conversa e pela tela. */
export const FRASE_LINEAR_INDISPONIVEL = "o Linear não respondeu, tente de novo em instantes";

export const FILTROS_IMPORTACAO = ["sem_backlog"] as const;
export type FiltroImportacao = (typeof FILTROS_IMPORTACAO)[number];

/** A prévia do card: quantas vêm, para qual coluna, quem cuida e o que fica fora. */
export type PreviaImportacao = {
  total: number;
  colunas: { coluna: IdColuna; nome: string; estado: string; tarefas: number; responsavel: string | null }[];
  precisamDeVoce: number;
  /** Estados do Linear sem linha na tabela: vêm para o Backlog com a nota. */
  semColuna: string[];
};

export type PayloadPropostaImportacaoLinear = {
  kind: "importacao_linear";
  quadroId: string;
  anfitriaoId: string;
  anfitriaoNome: string;
  /** A chave do time no Linear (NOD). */
  time: string;
  filtro: FiltroImportacao | null;
  previa: PreviaImportacao;
  turnoId?: string;
  /** Preenchido ao confirmar: a importação que acompanha o progresso (o mesmo id da proposta). */
  importacaoId?: string | null;
};

export type EstadoImportacao = "trazendo" | "aplicada" | "falhou" | "desfeita";

/** A importação como a tela a lê (a linha "Trazendo do Linear · 120 de 190" e o resultado). */
export type ImportacaoDto = {
  id: string;
  quadroId: string;
  time: string;
  filtro: FiltroImportacao | null;
  estado: EstadoImportacao;
  total: number;
  trazidas: number;
  /** A frase do erro, sem dado do Linear. */
  erro: string | null;
  loteId: string | null;
  /** Depois de aplicada: quantas tarefas e em quantas colunas ("Trouxe 190 tarefas para 11 colunas"). */
  colunas: number | null;
  criadoEm: number;
  atualizadoEm: number;
};

/** Uma issue aberta do Linear, como o adaptador entrega (já lida e conferida; o texto é de fora, ADR-062). */
export type IssueLinear = {
  identificador: string;
  numero: number;
  titulo: string;
  /** A página da issue (https://linear.app/…); null quando o Linear mandou outra coisa (o adaptador descarta). */
  url: string | null;
  descricao: string;
  estado: string;
  /** Quando a issue entrou no estado atual (ms). */
  noEstadoDesde: number;
  etiquetas: readonly string[];
  mae: string | null;
  bloqueadaPor: readonly string[];
  comentarios: readonly ComentarioLinear[];
  anexos: readonly { url: string; criadoEm: number }[];
};
export type ComentarioLinear = { id: string; autor: string; texto: string; criadoEm: number };

/** A conta do Linear que o servidor usa (o conector do tenant pelo Composio, só leitura). */
/** `chaveCifrada` é a do tenant como está no banco: só o adaptador decifra (o caso de uso nunca vê a chave). */
export type CredencialLinear = { chaveCifrada: string; contaId: string; userId: string };

/**
 * A porta da busca (ADR-041): só consultas, nunca escreve no Linear (decisão 7). `completo: false` é a prévia (estado e
 * etiquetas); `true` traz descrição, comentários e anexos, chamando `aoAvancar` a cada página. `filtro` sem_backlog tira o
 * Backlog na própria consulta. Erro do provedor lança ErroDeDominio ("conector_indisponivel" ou "integracao_autenticacao");
 * passar do teto de páginas lança "limite_atingido" (nunca devolve lista incompleta).
 */
export interface FonteLinear {
  /** `aoDescartar`: a issue que veio mas não se leu (o identificador, se legível); a importação não a dá por fechada. */
  listar(cred: CredencialLinear, p: { time: string; completo: boolean; filtro?: FiltroImportacao | null; aoAvancar?: (trazidas: number) => Promise<void>; aoDescartar?: (identificador: string | null) => void }): Promise<IssueLinear[]>;
}

/** O serviço nos Deps (ServicesNod estende isto). Ausente = NOD_LINEAR_SERVIDOR desligada: a importação diz importacao_indisponivel (revisão 4 do PR #630). */
export type ServicosLinear = { linear?: FonteLinear };

/** NOD-422: a resposta do GET da prévia pela tela (só lê). A recusa vem com o código e a frase (sem dado do Linear). */
export type PreviaDaTela =
  | { ok: true; time: string; filtro: FiltroImportacao | null; anfitriaoNome: string; previa: PreviaImportacao }
  | { ok: false; erro: string; detalhe: string };
