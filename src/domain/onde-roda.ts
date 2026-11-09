import type { OndeRodaDto } from "../contracts/rotina.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { ehMaquinaDoMotor } from "./plataforma-maquina.ts";

/** Uma chave de máquina viva (não revogada, não vencida) da pessoa, com o sistema que a máquina anunciou. */
export type MaquinaViva = { id: string; nome: string; plataforma: PlataformaMaquina | null };

/**
 * NOD-89 (corte 1, definido em 2026-10-22): onde a rotina de um bot roda. Puro.
 * - Alvo (a máquina do bot ou o padrão da pessoa, `alvoDoBot`) Linux ou Windows (ADR-147): não depende do Mac.
 * - Alvo Mac ou de plataforma desconhecida: depende (null conta como darwin, a mesma convenção do `compor.ts`).
 * - Sem alvo ("qualquer máquina") com alguma Linux viva: a primeira que estiver ligada leva — não depende.
 * - "Qualquer" sem Linux: nomeia o primeiro Mac vivo (ou nenhum = "seu Mac") e depende do Mac.
 * "Linux viva" é a chave persistida (não a presença do momento): a linha não pisca quando a VM perde um contato.
 */
export function ondeRodaDaRotina(alvo: { id: string; nome: string } | null, vivas: readonly MaquinaViva[]): OndeRodaDto {
  if (alvo) {
    const plataforma = vivas.find((m) => m.id === alvo.id)?.plataforma ?? null;
    return { modo: "maquina", maquina: { id: alvo.id, nome: alvo.nome, plataforma }, dependeDoMac: !ehMaquinaDoMotor(plataforma) };
  }
  if (vivas.some((m) => m.plataforma === "linux")) return { modo: "qualquer", maquina: null, dependeDoMac: false };
  // ADR-147: o PC com Windows não é o Mac nem um servidor sempre ligado — não leva o "qualquer" nem vira "seu Mac".
  const mac = vivas.find((m) => !ehMaquinaDoMotor(m.plataforma)) ?? null;
  return { modo: "qualquer", maquina: mac ? { id: mac.id, nome: mac.nome, plataforma: mac.plataforma } : null, dependeDoMac: true };
}
