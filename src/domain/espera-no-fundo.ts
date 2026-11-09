import type { MotivoNaoRodouRotina } from "../contracts/motivos.ts";
import { ESPERAS_QUEDA_NO_FUNDO_MS, ESPERAS_TRANSITORIAS_NO_FUNDO_MS, MAX_QUEDAS_NO_FUNDO_NA_JANELA, PRAZO_DO_FUNDO_MS, TENTATIVAS_TRANSITORIAS_MAX } from "../shared/constantes.ts";
import { comJitter } from "./nova-tentativa.ts";

/**
 * Trabalho de fundo não se perde por nenhuma queda (definido em 2026-10-20, NOD-309, emenda da ADR-045). Uma regra só
 * para o fundo — rotina, pedido de colega (delegação/peer), frente e retorno do lote: toda queda vira ESPERA com volta
 * marcada (ou "quando o Mac voltar"), com um aviso por cadeia e um teto. Generaliza a espera da cota (aposLimiteNoFundo,
 * NOD-274). A conversa com a pessoa fica fora: ela continua com o card Retomar.
 *
 * Pura: relógio e aleatório entram por parâmetro. Quem chama decide antes o que vence tudo: Parar (`parado_pela_pessoa`
 * nunca retoma) e o pedido de colega cujo pedinte já desistiu. No modo local (sem `ultimoContato`) não há como saber se
 * a máquina estava em contato: `maquinaPresente` vem falso e a volta é quando ela puxar (NOD-386). O reinício do motor (ADR-131)
 * volta na hora, sem a espera crescente do servidor, e não conta no teto de quedas (QUEDAS_FORA_DO_TETO).
 */
export const CAUSAS_DE_ESPERA_NO_FUNDO = ["cota", "reinicio_servidor", "reinicio_do_motor", "maquina_sem_contato", "erro_transitorio"] as const;
export type CausaDeEsperaNoFundo = (typeof CAUSAS_DE_ESPERA_NO_FUNDO)[number];

/** Por que o fundo desistiu: `falhou` com aviso único a quem pediu. */
export type MotivoDesistenciaDoFundo = "tentativas_esgotadas" | "quedas_esgotadas" | "prazo_esgotado";

export type EntradaEsperaNoFundo = {
  causa: CausaDeEsperaNoFundo;
  /** Quedas transitórias que a cadeia já teve ANTES desta (turnos.tentativas_transitorias da origem). */
  tentativasTransitorias: number;
  /**
   * Quedas de infraestrutura (reinício, máquina) que a cadeia já teve ANTES desta, só as da janela de 2 h
   * (JANELA_QUEDAS_NO_FUNDO_MS, NOD-386): quem chama conta com `quedasDaCadeia(..., desde)`.
   */
  quedas: number;
  /**
   * NOD-386: a máquina do turno estava em contato quando o lease venceu (modo compartilhado, contato < OFFLINE_MS). Com
   * ela presente, quem não respondeu foi o servidor: `maquina_sem_contato` volta com espera crescente, como o reinício.
   * Ausente (ou modo local) = a máquina sumiu de fato e a volta é quando ela puxar. Quem chama passa aqui o "servidor
   * falhou" do varredor (máquina em contato no modo compartilhado). Só vale para `maquina_sem_contato`.
   */
  maquinaPresente: boolean;
  agora: number;
  /** Quando a cadeia começou (o turno raiz): o prazo de 24 h conta daqui. */
  inicioDaCadeia: number;
  /** A hora da volta da cota (só `cota`); null = sem hora conhecida. */
  voltaDaCota?: number | null;
  /** Turno de rotina: a volta que passa da próxima janela vira `nao_rodou`. */
  ehRotina: boolean;
  /** A próxima execução da rotina; null = sem próxima (rotina pausada/sem agenda) ou não é rotina. */
  proximaExecucao: number | null;
  /** [0, 1): o jitter do backoff. */
  aleatorio: number;
};

export type DecisaoEsperaNoFundo =
  /** Espera e volta sozinho em `voltaEm` (null = quando a máquina voltar). `tentativa` é a desta volta (1, 2, 3…). */
  | { tipo: "esperar"; voltaEm: number | null; tentativa: number }
  /** Rotina: a volta passa da próxima janela — esta fica `nao_rodou` com motivo e hora, e a agenda segue. */
  | { tipo: "nao_rodou"; voltaEm: number | null; motivo: MotivoNaoRodouRotina }
  | { tipo: "desistir"; motivo: MotivoDesistenciaDoFundo };

/** O motivo de `nao_rodou` de cada causa (rotina_execucoes.motivo). */
export const MOTIVO_NAO_RODOU_DA_CAUSA: Readonly<Record<CausaDeEsperaNoFundo, MotivoNaoRodouRotina>> = {
  cota: "cota_da_ia",
  reinicio_servidor: "reinicio_servidor",
  reinicio_do_motor: "reinicio_do_motor",
  maquina_sem_contato: "maquina_sem_contato",
  erro_transitorio: "erro_do_provedor",
};

/** A espera antes da tentativa `n` (1 = a primeira volta): ~1, ~5, ~15 min com jitter de ±25%. */
export function esperaTransitoriaNoFundo(n: number, aleatorio: number): number {
  const i = Math.min(Math.max(n, 1), ESPERAS_TRANSITORIAS_NO_FUNDO_MS.length) - 1;
  return comJitter(ESPERAS_TRANSITORIAS_NO_FUNDO_MS[i] ?? 0, aleatorio);
}

/**
 * NOD-386: a espera antes da volta `n` depois de uma queda de infraestrutura com o servidor em falta (reinício, ou a máquina
 * em contato): ~30 s, 1, 2, 5 e 10 min com jitter de ±25%; da 5ª em diante, ~10 min.
 */
export function esperaQuedaNoFundo(n: number, aleatorio: number): number {
  const i = Math.min(Math.max(n, 1), ESPERAS_QUEDA_NO_FUNDO_MS.length) - 1;
  return comJitter(ESPERAS_QUEDA_NO_FUNDO_MS[i] ?? 0, aleatorio);
}

/**
 * Esperar, não rodar esta janela, ou desistir. Ordem: o teto da causa (3 transitórias; 5 quedas nas últimas 2 h, NOD-386), o prazo da cadeia (24 h,
 * menos para a cota, que tem hora de volta e nunca teve teto — o fim de semana do plano semanal espera), e por último a
 * fronteira da rotina: volta em ou depois da próxima janela = `nao_rodou`, sem empilhar. A volta "quando o Mac voltar"
 * (null) não tem hora para comparar: a rotina espera, e a janela seguinte a fecha como `nao_rodou` (disparar-rotina).
 */
export function decidirEsperaNoFundo(e: EntradaEsperaNoFundo): DecisaoEsperaNoFundo {
  if (e.causa === "erro_transitorio" && e.tentativasTransitorias >= TENTATIVAS_TRANSITORIAS_MAX) return { tipo: "desistir", motivo: "tentativas_esgotadas" };
  if ((e.causa === "reinicio_servidor" || e.causa === "maquina_sem_contato") && e.quedas >= MAX_QUEDAS_NO_FUNDO_NA_JANELA) return { tipo: "desistir", motivo: "quedas_esgotadas" };

  const voltaEm = voltaDaCausa(e);
  // A rotina tem prazo próprio (a próxima janela); o resto do fundo, 24 h desde o começo da cadeia.
  if (!e.ehRotina && e.causa !== "cota") {
    const limite = e.inicioDaCadeia + PRAZO_DO_FUNDO_MS;
    if (e.agora >= limite || (voltaEm !== null && voltaEm >= limite)) return { tipo: "desistir", motivo: "prazo_esgotado" };
  }
  if (e.ehRotina && e.proximaExecucao !== null && voltaEm !== null && voltaEm >= e.proximaExecucao) {
    // NOD-386: com a máquina em contato, quem falhou foi o servidor — o motivo não culpa a máquina.
    const motivo = e.causa === "maquina_sem_contato" && e.maquinaPresente ? "servidor_nao_respondeu" : MOTIVO_NAO_RODOU_DA_CAUSA[e.causa];
    return { tipo: "nao_rodou", voltaEm, motivo };
  }
  const tentativa = e.causa === "erro_transitorio" ? e.tentativasTransitorias + 1 : e.causa === "cota" ? 1 : e.quedas + 1;
  return { tipo: "esperar", voltaEm, tentativa };
}

function voltaDaCausa(e: EntradaEsperaNoFundo): number | null {
  switch (e.causa) {
    case "cota": return e.voltaDaCota ?? null;
    // NOD-386: o servidor em falta volta com espera crescente; a máquina que sumiu de fato, quando ela puxar (null).
    case "reinicio_servidor": return e.agora + esperaQuedaNoFundo(e.quedas + 1, e.aleatorio);
    // ADR-131: o motor que se reiniciou de propósito já está de volta — sem espera.
    case "reinicio_do_motor": return e.agora;
    case "maquina_sem_contato": return e.maquinaPresente ? e.agora + esperaQuedaNoFundo(e.quedas + 1, e.aleatorio) : null;
    case "erro_transitorio": return e.agora + esperaTransitoriaNoFundo(e.tentativasTransitorias + 1, e.aleatorio);
  }
}
