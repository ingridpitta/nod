/**
 * NOD-443 (ADR-143): o quadro com várias pessoas como a web e o bot o recebem. Fica separado do quadro.ts para não
 * passar do teto de linhas dos contratos; o quadro.ts reexporta tudo.
 */

import type { AutorLote } from "./quadro.ts";

/**
 * NOD-417 (definido em 2026-11-02): um comentário numa tarefa. `deFora`: escrito por um bot (ADR-062): quem o recebe recebe
 * dado de fora. `acionados`: os bots que o comentário acionou (abriu turno ou se juntou ao que já estava na fila).
 */
/** Quem escreveu o comentário: a pessoa, um bot ou o Linear (NOD-422: trazido de lá; o nome de quem escreveu vem em autorNome). */
/** ADR-162: `sistema` = a explicação do próprio quadro (a espera que ele deixou com a pessoa); não aciona ninguém. */
export type AutorComentario = AutorLote | { tipo: "linear" } | { tipo: "sistema" };
export type ComentarioTarefa = { id: string; quadroId: string; tarefaId: string; autor: AutorComentario; texto: string; deFora: boolean; criadoEm: number; /** NOD-430: "Você, pela <bot>". */ pedidoPor?: string | null };
/** `autorNome`: o nome do bot, ou de quem escreveu no Linear (autor `linear`, NOD-422). */
export type ComentarioDto = ComentarioTarefa & {
  autorNome: string | null;
  acionados: string[];
  /** 2026-11-10 (0159): a raiz da thread (null = é raiz), os turnos que ele abriu e a marca de editado/apagado. */
  paiId?: string | null;
  turnos?: string[];
  editadoEm?: number | null;
  /** Apagado com respostas: fica como marcador, texto vazio. */
  apagado?: boolean;
};

/**
 * NOD-443 (revisão 3 do PR #628, achado 7): o aviso de "Com você" que a dona põe na conversa de quem participa. Só isto
 * passa pela volta (`Deps.avisoComVoce`): o bot de quem participa (a conversa própria dele), o texto e a chave que faz o
 * aviso idempotente (a mesma tarefa no mesmo estado avisa uma vez).
 */
export type AvisoComVoce = { agenteId: string; texto: string; chave: string };

/** NOD-443: uma pessoa no quadro (a dona não entra na lista: ela é a dona). */
export type MembroQuadroDto = { pessoaId: string; nome: string; adicionadoEm: number };

/**
 * NOD-443 (D5, D6): quem decide a pendência da tarefa (o card em "Precisa de alguém"). `voce` = é quem lê. `saiu` = o
 * nome de quem pediu e saiu do quadro (a pendência voltou à dona: "Era do Bruno, que saiu do quadro").
 */
export type QuemDecideDto = { pessoaId: string; nome: string; voce: boolean; saiu: string | null };

/** NOD-443 (D1, D8): uma linha do mural de Atividade: um ou mais pedidos seguidos da mesma pessoa, pelo mesmo bot. */
export type LinhaMuralDto = {
  /** O id do lote mais recente do grupo. */
  id: string;
  pessoaId: string;
  /** "Ana, pela Ada" / "Você, pela Ada" / "Ana" (pela tela). */
  assinatura: string;
  resumo: string;
  /** Os códigos das tarefas tocadas (ex.: SEC-1). */
  codigos: string[];
  mudancas: number;
  criadoEm: number;
  desfeito: boolean;
};

/** NOD-455: um quadro de outra pessoa em que quem lê participa (a seção "Compartilhados com você" da barra). */
export type QuadroCompartilhadoDto = { id: string; agenteId: string; agenteNome: string; prefixo: string | null; donaNome: string; modo: ModoConversa };

/** NOD-443 (D7): o pedido de quem participa, no modo "só a dona": um comentário na tarefa, para ela. */
/** `deFora`: escrito num turno não confiável ou por quem participa (revisão 1, achado 9). */
export type ComentarioQuadroDto = { id: string; tarefaId: string | null; texto: string; assinatura: string; deFora: boolean; criadoEm: number };

/**
 * NOD-443 (ADR-143, definido em 2026-11-02): como as pessoas do quadro conversam com ele. A dona escolhe; o padrão é
 * cada um na sua conversa (D3). Só a dona (1): quem participa comenta numa tarefa (D7). A conversa do grupo (3) fica
 * para a próxima etapa: revisão 8 do PR #628, ela sai do tipo e do CHECK da 0146 (o modo não existe; aceitar o valor
 * era funcionar como o individual com outro nome). Quem pede "grupo" recebe a recusa de erroDoModo (src/domain/quadro.ts).
 */
export const MODOS_CONVERSA = ["so_dono", "individual"] as const;
export type ModoConversa = (typeof MODOS_CONVERSA)[number];
/** Os modos que se escolhem (revisão 2 do PR #628, achado 7): hoje, todos os que existem. */
export const MODOS_ESCOLHIVEIS = MODOS_CONVERSA;
