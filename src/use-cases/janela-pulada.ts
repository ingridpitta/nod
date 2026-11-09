import type { Rotina } from "../contracts/rotina.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";

const DUAS_HORAS_MS = 2 * 60 * 60_000;

/**
 * definido em 2026-10-16 (NOD-274, C9; decidido em 15/10): o prazo da frente que espera um colega — 2 períodos do cron,
 * no mínimo 2 h. O período é o intervalo da janela agendada até a seguinte (o cron irregular usa o intervalo de agora).
 * revisto em 2026-10-16 (integração da main no #335): a janela pulada dentro do prazo fica no histórico como a 'adiada'
 * da NOD-243 (disparar-rotina.ts, registrarAdiada) — o registro 'nao_rodou'/'execucao_anterior_aberta' da C9 saiu para
 * não haver duas linhas para o mesmo fato.
 */
export function prazoDoColega(rotina: Pick<Rotina, "cron" | "fusoIana">, instanteAgendado: number): number {
  const seguinte = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: instanteAgendado });
  return Math.max(2 * (seguinte - instanteAgendado), DUAS_HORAS_MS);
}
