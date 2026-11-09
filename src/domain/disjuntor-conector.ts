import type { EpochMs } from "../contracts/ids.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";

/**
 * definido em 2026-10-26 (NOD-374): disjuntor por app. Um timeout de `tools/call` sozinho não põe o app em "Fora do ar":
 * a chamada dispara uma sonda de confirmação (`tools/list`) e só a sonda falhando abre a falha; uma chamada bem-sucedida
 * limpa; um laço de fundo re-sonda a falha aberta (half-open) com espera crescente e jitter. O app só aparece em Fora do ar
 * quando a falha persiste (≥ 10 min e ≥ 2 sondas falhando, ou ≥ 5 timeouts seguidos) ou, na hora, quando o app recusou o
 * acesso (401/403), que re-sondar não resolve. Puro: o relógio e o aleatório entram por parâmetro.
 */

/** A falha aberta do app. `causa` muda a redação sem criar motivo novo no enum (ADR-029, NOD-157). */
export type FalhaDoConector = { motivo: MotivoNegacao; em: EpochMs; causa?: "acesso_recusado" };

export type EstadoDisjuntor = {
  ultimaFalha: FalhaDoConector | null;
  /** Sondas seguidas que falharam desde que a falha abriu. */
  falhasSeguidas: number;
  /** Chamadas seguidas que estouraram o tempo, sem nenhum sucesso de chamada no meio. */
  timeoutsSeguidos: number;
  /**
   * definido em 2026-10-27 (revisão 5 do PR #538): o instante do último timeout contado. Um timeout mais de
   * `JANELA_DOS_TIMEOUTS_MS` (24h30) depois do anterior (sem falha aberta) recomeça a contagem: timeouts isolados espalhados por dias
   * não somam "5 seguidos". Opcional: ausente (cor antiga, estado montado à mão) conta como antigo.
   */
  ultimoTimeoutEm?: EpochMs | null;
  /** Quando o laço de fundo sonda de novo (null = no próximo ciclo). */
  proximaSondaEm: EpochMs | null;
  /** Desde quando o app aparece em Fora do ar (null = a falha ainda não persistiu o bastante para ser mostrada). */
  foraDoArDesde: EpochMs | null;
};

export const ESTADO_LIMPO: EstadoDisjuntor = Object.freeze({ ultimaFalha: null, falhasSeguidas: 0, timeoutsSeguidos: 0, ultimoTimeoutEm: null, proximaSondaEm: null, foraDoArDesde: null });

/** definido em 2026-10-26 (decisão do Marlon na NOD-374): o limiar para mostrar Fora do ar e o teto da re-sonda. */
export const LIMIAR_FORA_DO_AR_MS = 10 * 60_000;
export const SONDAS_PARA_FORA_DO_AR = 2;
export const TIMEOUTS_PARA_FORA_DO_AR = 5;
export const ESPERAS_DA_RESSONDA_MS: readonly number[] = [1, 2, 5, 15, 30].map((m) => m * 60_000);
export const JITTER_DA_RESSONDA = 0.25;
/**
 * "Seguidos": no máximo 24h30 (um dia e a folga do jitter) entre um timeout e o próximo, sem falha aberta no meio. Revisão 5: timeouts isolados espalhados
 * por semanas não somam 5. Revisão 6: a rotina de hora em hora (ou diária) que sempre estoura ainda chega a 5 — o critério
 * "sem nenhum sucesso no meio" vale para ela. Suposição registrada no PR #538.
 */
export const JANELA_DOS_TIMEOUTS_MS = 24 * 60 * 60_000 + 30 * 60_000;

/**
 * definido em 2026-10-26 (revisão do PR #538): sem falha aberta, o resto do estado (sonda marcada, Fora do ar, sondas
 * seguidas) não vale — só a contagem de timeouts existe sozinha. Lido assim antes de cada transição: a cor antiga do
 * blue/green limpa `ultima_falha` sem conhecer as colunas novas, e o que sobra não pode fazer a próxima falha aparecer na hora.
 */
export function normalizar(e: EstadoDisjuntor): EstadoDisjuntor {
  if (e.ultimaFalha !== null) return e;
  if (e.falhasSeguidas === 0 && e.proximaSondaEm === null && e.foraDoArDesde === null) return e;
  return { ...ESTADO_LIMPO, timeoutsSeguidos: e.timeoutsSeguidos, ultimoTimeoutEm: e.ultimoTimeoutEm ?? null };
}

/**
 * Falha aberta SÓ pelos timeouts seguidos (nenhuma sonda falhou): o app lista as ferramentas, mas não executa — a sonda
 * que responde não prova a volta, só uma chamada que dá certo a fecha. Se alguma sonda falhou (o app caiu de fato), a
 * sonda que responde fecha (revisão 2 do PR #538).
 */
export function abertaPorTimeouts(e: EstadoDisjuntor): boolean {
  return e.ultimaFalha !== null && e.ultimaFalha.causa !== "acesso_recusado" && e.timeoutsSeguidos >= TIMEOUTS_PARA_FORA_DO_AR && e.falhasSeguidas === 0;
}

/** Há algo a limpar quando uma chamada dá certo: a falha aberta ou a contagem de timeouts. */
export function temFalha(e: EstadoDisjuntor): boolean {
  return e.ultimaFalha !== null || e.timeoutsSeguidos > 0 || e.foraDoArDesde !== null;
}

/**
 * A espera até a re-sonda depois da n-ésima sonda falhando (n ≥ 1): 1, 2, 5, 15 e 30 min, depois 30 min sempre, com
 * jitter de ±25% para os apps não sondarem todos no mesmo segundo. `aleatorio` em [0, 1).
 */
export function esperaDaRessonda(n: number, aleatorio: number): number {
  const i = Math.min(Math.max(1, Math.floor(n)), ESPERAS_DA_RESSONDA_MS.length) - 1;
  const base = ESPERAS_DA_RESSONDA_MS[i]!;
  const fator = 1 - JITTER_DA_RESSONDA + 2 * JITTER_DA_RESSONDA * Math.min(Math.max(aleatorio, 0), 1);
  return Math.round(base * fator);
}

/** Promove a falha aberta a visível quando ela persistiu além do limiar. Idempotente: quem já está visível fica. */
export function promover(e: EstadoDisjuntor, agora: EpochMs): EstadoDisjuntor {
  if (e.foraDoArDesde !== null || e.ultimaFalha === null) return e;
  const persistiu = agora - e.ultimaFalha.em >= LIMIAR_FORA_DO_AR_MS && e.falhasSeguidas >= SONDAS_PARA_FORA_DO_AR;
  if (persistiu || e.timeoutsSeguidos >= TIMEOUTS_PARA_FORA_DO_AR) return { ...e, foraDoArDesde: agora };
  return e;
}

/**
 * A chamada estourou o tempo: só conta. A sonda de confirmação decide se a falha abre. No 5º timeout seguido sem sucesso
 * no meio, a falha abre e aparece mesmo que a sonda responda (o app lista as ferramentas, mas não executa nenhuma).
 */
export function aposTimeoutDaChamada(e: EstadoDisjuntor, agora: EpochMs, aleatorio: number): EstadoDisjuntor {
  const anterior = e.ultimoTimeoutEm ?? null;
  const recente = anterior !== null && agora - anterior <= JANELA_DOS_TIMEOUTS_MS;
  // Sem falha aberta, o timeout longe do anterior recomeça a contagem (revisão 5 do PR #538).
  const timeoutsSeguidos = (e.ultimaFalha === null && !recente ? 0 : e.timeoutsSeguidos) + 1;
  if (timeoutsSeguidos < TIMEOUTS_PARA_FORA_DO_AR) return { ...e, timeoutsSeguidos, ultimoTimeoutEm: agora };
  const ultimaFalha = e.ultimaFalha ?? { motivo: "timeout_transporte" as const, em: agora };
  const aberto = { ...e, timeoutsSeguidos, ultimoTimeoutEm: agora, ultimaFalha };
  // Aberta só pelos timeouts (revisão 3 do PR #538): cada timeout empurra a sonda para o teto da espera. A sonda que
  // vence e responde prova um teto inteiro sem timeout nenhum — e fecha a falha (aposSondaOk).
  const proximaSondaEm = abertaPorTimeouts(aberto)
    ? agora + esperaDaRessonda(ESPERAS_DA_RESSONDA_MS.length, aleatorio)
    : e.proximaSondaEm ?? agora + esperaDaRessonda(Math.max(1, e.falhasSeguidas), aleatorio);
  return promover({ ...aberto, proximaSondaEm }, agora);
}

/** O app respondeu 401/403: aparece na hora, com o texto de reconectar. Não re-sonda (repetir não adianta). */
export function aposAcessoRecusado(e: EstadoDisjuntor, agora: EpochMs): EstadoDisjuntor {
  const em = e.ultimaFalha?.causa === "acesso_recusado" ? e.ultimaFalha.em : agora;
  return { ...e, ultimaFalha: { motivo: "falha_tecnica", em, causa: "acesso_recusado" }, proximaSondaEm: null, foraDoArDesde: e.foraDoArDesde ?? agora };
}

/**
 * A sonda falhou: abre (ou mantém) a falha, soma a sonda e marca a próxima. A data da falha é a da primeira. Antes da hora
 * marcada a sonda não sobe a escada (revisão 2 do PR #538): as confirmações de chamadas seguidas num app caído — nas duas
 * cores do blue/green — não contam como sondas da espera; só a vencida (a do laço, ou a primeira) conta.
 */
export function aposSondaFalha(e: EstadoDisjuntor, motivo: MotivoNegacao, agora: EpochMs, aleatorio: number): EstadoDisjuntor {
  if (e.ultimaFalha !== null && e.proximaSondaEm !== null && agora < e.proximaSondaEm && !abertaPorTimeouts(e)) return e;
  const falhasSeguidas = e.falhasSeguidas + 1;
  const ultimaFalha = e.ultimaFalha && e.ultimaFalha.causa !== "acesso_recusado" ? e.ultimaFalha : { motivo, em: agora };
  return promover({ ...e, ultimaFalha, falhasSeguidas, proximaSondaEm: agora + esperaDaRessonda(falhasSeguidas, aleatorio) }, agora);
}

/**
 * A sonda respondeu. Com falha aberta, o app voltou: limpa tudo. Sem falha aberta (a confirmação de um timeout isolado),
 * nada muda — a contagem de timeouts só zera com uma chamada que dá certo. A falha aberta pelos 5 timeouts seguidos não
 * sai com a confirmação de um timeout novo (o `tools/list` responde justamente nesse caso); sai com a sonda vencida, que
 * só chega depois de um teto inteiro (~30 min) sem timeout nenhum (revisão 3 do PR #538: o app se recupera sozinho).
 */
export function aposSondaOk(e: EstadoDisjuntor, agora: EpochMs, _aleatorio: number): EstadoDisjuntor {
  if (e.ultimaFalha === null) return e;
  if (abertaPorTimeouts(e) && e.proximaSondaEm !== null && agora < e.proximaSondaEm) return e;
  // Fecha tudo, inclusive os timeouts: depois de uma queda real, os timeouts da queda não contam para "lento" (revisão 2, A1).
  return ESTADO_LIMPO;
}

/** Uma chamada deu certo: limpa tudo. O chamador só escreve quando `temFalha` (NOD-263: app sem falha não escreve). */
export function aposSucessoDaChamada(_e: EstadoDisjuntor): EstadoDisjuntor {
  return ESTADO_LIMPO;
}

/** O laço re-sonda a falha aberta vencida. O acesso recusado espera a pessoa reconectar. */
export function deveRessondar(e: EstadoDisjuntor, agora: EpochMs): boolean {
  if (e.ultimaFalha === null || e.ultimaFalha.causa === "acesso_recusado") return false;
  return e.proximaSondaEm === null || agora >= e.proximaSondaEm;
}

/** Iguais campo a campo (para não escrever o que não mudou). */
export function mesmoEstado(a: EstadoDisjuntor, b: EstadoDisjuntor): boolean {
  const fa = a.ultimaFalha, fb = b.ultimaFalha;
  const falhaIgual = fa === fb || (fa !== null && fb !== null && fa.motivo === fb.motivo && fa.em === fb.em && fa.causa === fb.causa);
  return falhaIgual && a.falhasSeguidas === b.falhasSeguidas && a.timeoutsSeguidos === b.timeoutsSeguidos && (a.ultimoTimeoutEm ?? null) === (b.ultimoTimeoutEm ?? null) && a.proximaSondaEm === b.proximaSondaEm && a.foraDoArDesde === b.foraDoArDesde;
}

/**
 * definido em 2026-10-26 (NOD-374): o app aparece como "Fora do ar" (Provedores, ficha do bot, marketplace) só quando a
 * falha persistiu (`foraDoArDesde`) ou o acesso foi recusado (que já nasce com `foraDoArDesde`). A falha aberta que ainda
 * espera a confirmação não pinta nada. `foraDoArDesde` ausente (Conector montado à mão, sem o disjuntor) conta como visível.
 */
export function falhaVisivel(c: { ultimaFalha: unknown; foraDoArDesde?: EpochMs | null }): boolean {
  return c.ultimaFalha !== null && c.foraDoArDesde !== null;
}
