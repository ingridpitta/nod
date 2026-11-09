import type { ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../src/contracts/maquina.ts";

export type EstadoDoDestaVez = { maquinas: { maquinas: MaquinaDto[] } | null; contasIa: ContasIaDto | null; agora: number };

/**
 * QA do NOD-314 (definido em 2026-10-20): a outra máquina que o "Rodar em <outra> desta vez" oferece — conectada, com uma IA
 * pronta e com uma conta de IA pronta nela e fora do limite (a regra do servidor em `rodarDestaVezComConta`, que recusa com
 * `conta_fora_da_maquina`). Sem as contas lidas ainda, nenhuma: o botão não nasce para ser recusado. Com `ia` (o turno
 * fixado numa IA, `harnessFixado`), só conta dessa IA serve — a mesma regra do servidor; sem, no Automático, qualquer uma.
 */
export function outraMaquinaDestaVez(estado: EstadoDoDestaVez, excluir: string | null | undefined, ia?: string | null): MaquinaDto | null {
  const contas = (estado.contasIa?.contas ?? []).filter((c) => !ia || c.ia === ia);
  const temConta = (maquinaId: string) => contas.some((c) => (c.noLimiteAte === null || c.noLimiteAte <= estado.agora) && c.maquinas.some((m) => m.maquinaId === maquinaId && m.estado === "pronta"));
  // NOD-94 (QA): a "só computador" não pega turno (o servidor a exclui), como em conversa.ts.
  return (estado.maquinas?.maquinas ?? []).find((m) => m.conectada && m.papel !== "computador" && m.id !== excluir && Object.values(m.ias).includes("pronto") && temConta(m.id)) ?? null;
}
