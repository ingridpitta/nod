import type { CorAgente, FormaAgente } from "./agente.ts";
import type { EpochMs } from "./ids.ts";

/**
 * definido em 2026-10-30 (NOD-20): o histórico de versões do perfil do bot. Cada mudança de um campo versionável grava uma
 * versão com o perfil inteiro (redigido). A web só faz `import type` daqui.
 */
export const CAMPOS_VERSIONAVEIS = ["nome", "titulo", "descricao", "forma", "cor", "voz", "vozVelocidade"] as const;
export type CampoVersionavel = (typeof CAMPOS_VERSIONAVEIS)[number];

/** inicial = o perfil de antes da primeira mudança; tela; chat (o Nod editou); proposta confirmada; ajuste de voz; restauração. */
export const ORIGENS_VERSAO = ["inicial", "tela", "chat", "proposta", "voz", "restauracao"] as const;
export type OrigemVersao = (typeof ORIGENS_VERSAO)[number];

/** Quem fez a mudança: a pessoa (tela, ligação, cartão confirmado por ela) ou o Nod (gerir_bots no chat). */
export const AUTORES_VERSAO = ["pessoa", "nod"] as const;
export type AutorVersao = (typeof AUTORES_VERSAO)[number];

/** O perfil versionável: o que uma versão guarda e o que restaurar aplica. */
export type PerfilVersionavel = {
  nome: string;
  titulo: string;
  descricao: string;
  forma: FormaAgente;
  cor: CorAgente;
  /** null = a voz derivada do id. */
  voz: string | null;
  vozVelocidade: number;
};

export type VersaoPerfil = {
  id: string;
  agenteId: string;
  versao: number;
  origem: OrigemVersao;
  autor: AutorVersao;
  propostaId: string | null;
  restauradaDe: number | null;
  perfil: PerfilVersionavel;
  /** Os campos que mudaram em relação à versão anterior (vazio na inicial). */
  campos: CampoVersionavel[];
  criadoEm: EpochMs;
  /** Algum texto desta versão tem o marcador de segredo redigido («redigido: …»): restaurar devolve o marcador. */
  redigida: boolean;
};

/** GET /agentes/:id/perfil/versoes. `atual` = o número da versão vigente; `virtual` = nada gravado ainda (só a v1 de agora). */
export type ListaVersoesPerfil = { versoes: VersaoPerfil[]; total: number; atual: number; mais: boolean; virtual: boolean };

/**
 * GET /agentes/:id/perfil/versoes/:versao: a versão e o perfil de agora (redigido, a mesma forma da versão), para o
 * comparativo e a confirmação ("Isso vira a versão N"; "a proposta que o bot fez às hh:mm deixa de valer").
 * `restauravel` = restaurar mudaria algo (a Atual e as iguais a agora não mostram o botão).
 */
export type DetalheVersaoPerfil = {
  versao: VersaoPerfil;
  atual: PerfilVersionavel;
  numeroAtual: number;
  proxima: number;
  restauravel: boolean;
  /** Restaurar faz um segredo sumir (o da versão não volta, ou o de agora sai): a tela avisa e manda aceitarRedacao. */
  perdeSegredo: boolean;
  propostaPendente: { id: string; criadaEm: EpochMs } | null;
};

/** O maior número de versão aceito na entrada (a coluna é integer). */
export const VERSAO_MAXIMA = 2_147_483_647;

/** Quantas versões ficam por bot (a poda apaga as mais velhas). */
export const MAX_VERSOES_PERFIL = 50;
/** Página da lista. */
export const VERSOES_POR_PAGINA = 20;
