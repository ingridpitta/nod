/**
 * Medição de uma vez da ligação (plano do modo ligação, "Medição"; definido em 2026-10-04). Puro: o orquestrador
 * marca os instantes com o relógio dele e este módulo só faz as contas. O resultado vira o log `ligacao_vez`, que
 * nunca leva texto falado — só tempos, contagens e de onde veio cada coisa.
 *
 * Por que existe: a ligação só guardava o p50 "da vez ao primeiro som" da ligação inteira. Na ligação do Marlon de
 * 2026-10-04 (onboarding, alto-falante) isso deu 5,6 s sem dizer onde o tempo ficou: a espera pelo fim da fala, o
 * final do STT, a ferramenta antes do texto ou a síntese.
 */

/** Como a vez da pessoa chegou: falada (passou pelo VAD e pelo STT), digitada (composer e chips) ou aviso do sistema. */
export type OrigemDaVez = "voz" | "texto" | "nota";

/** Quem fechou o último trecho de fala da vez: o silêncio do VAD, a vigia da transcrição parada ou o teto do trecho. */
export type QuemFechouTrecho = "vad" | "vigia" | "teto";

/** Como a vez acabou. `cerebro_caiu` (definido em 2026-10-05): a IA do Mac caiu antes de responder (ligacao-sem-ia.ts). */
export type DesfechoDaVez = "respondida" | "interrompida" | "refeita" | "substituida" | "encerrada" | "cerebro_caiu" | "sem_resposta";

/** Instantes (ms do relógio do orquestrador) e contagens de uma vez. `null` = não aconteceu ou não se aplica. */
export type MarcasDaVez = {
  n: number;
  origem: OrigemDaVez;
  /** Fim real da voz do último trecho (o VAD só avisa depois do silêncio). */
  fimDaVozEm: number | null;
  /** Quando o último trecho fechou. */
  trechoFechadoEm: number | null;
  fechou: QuemFechouTrecho | null;
  /** Quando chegou o final do STT do último trecho. */
  finalSttEm: number | null;
  /** Quantos trechos de fala viraram esta vez. */
  trechos: number;
  /** Inícios de fala que cancelaram a decisão já agendada desta vez. */
  iniciosQueCancelaram: number;
  /** A espera de fim de turno usada na decisão (esperaDeFimDeTurno). */
  esperaFimDeTurnoMs: number | null;
  vezEm: number;
  primeiroDeltaEm: number | null;
  primeiroTrechoEm: number | null;
  /** Primeiro áudio de conteúdo mandado ao app. */
  primeiroAudioEm: number | null;
  /** Primeiro `tocado` do app para uma fala de conteúdo desta vez. */
  primeiroTocadoEm: number | null;
  ferramentaInicioEm: number | null;
  ferramentaFimEm: number | null;
  /** O modelo chamou ferramenta antes de escrever qualquer texto. */
  ferramentaAntesDoTexto: boolean;
  /** Chegou texto depois de uma ferramenta terminar. */
  textoDepoisDaFerramenta: boolean;
  /** Maior intervalo entre dois pedaços de áudio da mesma fala de conteúdo. */
  maiorBuracoDeAudioMs: number;
};

export function novasMarcas(p: { n: number; origem: OrigemDaVez; vezEm: number }): MarcasDaVez {
  return {
    n: p.n,
    origem: p.origem,
    fimDaVozEm: null,
    trechoFechadoEm: null,
    fechou: null,
    finalSttEm: null,
    trechos: 0,
    iniciosQueCancelaram: 0,
    esperaFimDeTurnoMs: null,
    vezEm: p.vezEm,
    primeiroDeltaEm: null,
    primeiroTrechoEm: null,
    primeiroAudioEm: null,
    primeiroTocadoEm: null,
    ferramentaInicioEm: null,
    ferramentaFimEm: null,
    ferramentaAntesDoTexto: false,
    textoDepoisDaFerramenta: false,
    maiorBuracoDeAudioMs: 0,
  };
}

export type ResumoDaVez = {
  n: number;
  origem: OrigemDaVez;
  desfecho: DesfechoDaVez;
  trechos: number;
  fechou: QuemFechouTrecho | null;
  inicios_que_cancelaram: number;
  espera_fim_de_turno_ms: number | null;
  /** Do fim da voz até o trecho fechar. */
  trecho_fechado_ms: number | null;
  /** Do fim da voz até o final do STT. */
  stt_final_ms: number | null;
  /** Do fim da voz até a vez ser decidida. */
  vez_ms: number | null;
  /** Da vez até o primeiro pedaço de texto do modelo. */
  primeiro_delta_ms: number | null;
  /** Da vez até o primeiro trecho ir para a síntese. */
  primeiro_trecho_ms: number | null;
  /** Da vez até o primeiro áudio de conteúdo sair para o app. */
  primeiro_audio_ms: number | null;
  /** Da vez até o app dizer que começou a tocar. */
  primeiro_tocado_ms: number | null;
  /** Do fim da voz da pessoa até o primeiro áudio de conteúdo: o silêncio que ela ouve. */
  voz_a_voz_ms: number | null;
  ferramenta_antes_do_texto: boolean;
  texto_depois_da_ferramenta: boolean;
  ferramenta_ms: number | null;
  maior_buraco_de_audio_ms: number;
};

function entre(de: number | null, ate: number | null): number | null {
  return de === null || ate === null ? null : Math.max(0, Math.round(ate - de));
}

/** As marcas em tempos relativos, prontas para o log (nenhum campo é texto falado). */
export function resumoDaVez(m: MarcasDaVez, desfecho: DesfechoDaVez): ResumoDaVez {
  return {
    n: m.n,
    origem: m.origem,
    desfecho,
    trechos: m.trechos,
    fechou: m.fechou,
    inicios_que_cancelaram: m.iniciosQueCancelaram,
    espera_fim_de_turno_ms: m.esperaFimDeTurnoMs,
    trecho_fechado_ms: entre(m.fimDaVozEm, m.trechoFechadoEm),
    stt_final_ms: entre(m.fimDaVozEm, m.finalSttEm),
    vez_ms: entre(m.fimDaVozEm, m.vezEm),
    primeiro_delta_ms: entre(m.vezEm, m.primeiroDeltaEm),
    primeiro_trecho_ms: entre(m.vezEm, m.primeiroTrechoEm),
    primeiro_audio_ms: entre(m.vezEm, m.primeiroAudioEm),
    primeiro_tocado_ms: entre(m.vezEm, m.primeiroTocadoEm),
    voz_a_voz_ms: entre(m.fimDaVozEm, m.primeiroAudioEm),
    ferramenta_antes_do_texto: m.ferramentaAntesDoTexto,
    texto_depois_da_ferramenta: m.textoDepoisDaFerramenta,
    ferramenta_ms: entre(m.ferramentaInicioEm, m.ferramentaFimEm),
    maior_buraco_de_audio_ms: Math.round(m.maiorBuracoDeAudioMs),
  };
}

/** Percentil `p` (0–100) de uma lista de tempos, arredondado; null se a lista é vazia. */
export function percentilMs(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  return Math.round(ord[Math.min(ord.length - 1, Math.floor((p / 100) * ord.length))]!);
}
