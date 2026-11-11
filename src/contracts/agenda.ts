import type { DesfechoRotina } from "./motivos.ts";
import type { EpochMs } from "./ids.ts";
import type { EstadoRotina } from "./rotina.ts";

/**
 * NOD-85 (definido em 2026-10-29): a agenda de rotinas, `GET rotinas/agenda?de&ate&fuso&agente`. Só leitura: o servidor
 * projeta (ADR-011, quem avalia o cron é ele) e a web só desenha. O passado é o que está guardado (20 execuções por
 * rotina); o futuro, as janelas do cron. `dia` é AAAA-MM-DD no `fuso` pedido (o da pessoa).
 */
export const AGENDA_MAX_DIAS = 42;
/** Acima disto, num dia, a rotina vira uma faixa "a cada N min" em vez de uma linha por janela. */
export const AGENDA_MAX_POR_DIA = 24;
/** Falhou, interrompida, bloqueada e não rodou ganham a marca de problema; os demais desfechos, não. */
export const DESFECHOS_COM_PROBLEMA = ["falhou", "interrompida", "bloqueada", "nao_rodou"] as const satisfies readonly DesfechoRotina[];

export type ItemAgenda =
  | { tipo: "execucao"; rotinaId: string; dia: string; instante: EpochMs; desfecho: DesfechoRotina; motivo: string | null; problema: boolean; turnoId: string | null; em: EpochMs }
  | { tipo: "prevista"; rotinaId: string; dia: string; instante: EpochMs }
  /** A rotina frequente num dia: `intervaloMin` = o passo mais comum entre janelas (null se só uma). */
  | { tipo: "faixa"; rotinaId: string; dia: string; instante: EpochMs; ultima: EpochMs; intervaloMin: number | null; previstas: number; execucoes: number; problemas: number };

export type RotinaNaAgenda = {
  id: string;
  agenteId: string;
  conversaId: string;
  instrucao: string;
  /** "Toda sexta às 17:00" (resumoCron); cron cru quando o parser não aceita. */
  resumo: string;
  fusoIana: string;
  estado: EstadoRotina;
  /** NOD-412: a pausada com data — quando volta sozinha (a agenda prevê as janelas dali em diante). null = sem data. */
  retomarEm?: EpochMs | null;
  /**
   * A execução guardada mais antiga quando a poda já cortou o resto (há 20 guardadas): antes dela a tela diz "sem
   * registro". null = o registro está inteiro.
   */
  registroDesde: EpochMs | null;
  /** O teto de janelas cortou as previstas desta rotina no intervalo (o teto cobre 42 dias de minuto em minuto). */
  cortado: boolean;
  /** É da pessoa que lê. A de outra pessoa (visibilidade equipe) aparece, mas sem Pausar/Ativar/Testar (o servidor recusa). */
  minha: boolean;
};

export type AgendaDto = { de: EpochMs; ate: EpochMs; agora: EpochMs; fuso: string; rotinas: RotinaNaAgenda[]; itens: ItemAgenda[] };
