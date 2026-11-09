import type { MotivoNegacao, MotivoPasse } from "../contracts/motivos.ts";
import type { EstadoOrcamento, PoliticaSala } from "../contracts/sala.ts";
import { quemResponde } from "./canal-responde.ts";

/**
 * EMENDA 14, eixo 2 de profundidade: handoffs por rodada (o eixo 1 é `profundidade`, 0 a 3 passes entre bots desde a ADR-063).
 * definido em 2026-09-16: 3 encaminhamentos sem fala humana — o quarto `encaminhar` na mesma
 * rodada vira passe `teto_canal`. Uma sala de até 6 bots ainda alcança quem importa em 3 saltos;
 * mais que isso é os bots conversando entre si sem a pessoa, que é o que o orçamento existe para impedir.
 */
export const HANDOFFS_POR_RODADA = 3;

/** Porta de roomResponders: menção vence nas três políticas (E12.1). */
export function responders(
  sala: { politica: PoliticaSala; leadAgenteId: string | null; membros: readonly string[]; nomes: Readonly<Record<string, string>> },
  mensagem: { texto: string; autorTipo: "pessoa" | "agente"; autorId?: string },
): string[] {
  return quemResponde(sala, mensagem);
}

export type ResultadoEncaminhar = { ok: true; estado: EstadoOrcamento } | { ok: false; passe: Extract<MotivoPasse, "negado_fail_closed">; motivo: "teto_canal" };

/** Quarto encaminhar da rodada (sem fala humana no meio) não acontece: vira passe tipado. */
export function avaliarEncaminhar(estado: EstadoOrcamento): ResultadoEncaminhar {
  if (estado.handoffsNaRodada >= HANDOFFS_POR_RODADA) return { ok: false, passe: "negado_fail_closed", motivo: "teto_canal" };
  return { ok: true, estado: { ...estado, handoffsNaRodada: estado.handoffsNaRodada + 1 } };
}

/** Passe negado_fail_closed carrega a causa (MotivoNegacao): só `teto_canal` conta como teto da rodada. */
export type Fala = { agenteId: string; tipo: "texto" } | { agenteId: string; tipo: "passe"; motivo: MotivoPasse; causa?: MotivoNegacao };
export type DesfechoRodada = "assentou" | "teto" | "ninguem_disponivel" | "em_andamento";

/**
 * Assentamento por CONTAGEM no servidor, nunca por leitura do texto (GRUPO.passe-tipado):
 * assenta quando todo mundo que ESTAVA PRESENTE passou e pelo menos um estava presente;
 * 'teto' quando algum passe tem causa teto_canal (avaliarEncaminhar); outro negado_fail_closed
 * (parada, plano ausente…) assenta como passe comum; 'em_andamento' enquanto alguém ainda deve falar.
 */
export function assentar(presentes: readonly string[], falas: readonly Fala[]): DesfechoRodada {
  if (presentes.length === 0) return "ninguem_disponivel";
  const ultimaPorAgente = new Map<string, Fala>();
  for (const f of falas) ultimaPorAgente.set(f.agenteId, f);
  const todosPassaram = presentes.every((id) => ultimaPorAgente.get(id)?.tipo === "passe");
  if (!todosPassaram) return "em_andamento";
  const houveTeto = presentes.some((id) => {
    const f = ultimaPorAgente.get(id);
    return f?.tipo === "passe" && f.motivo === "negado_fail_closed" && f.causa === "teto_canal";
  });
  return houveTeto ? "teto" : "assentou";
}
