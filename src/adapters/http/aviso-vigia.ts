import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { VigiaVivo } from "../../contracts/ponte.ts";
import { nomeDaFerramenta } from "../../domain/rotulo-ferramenta.ts";
import { nivelDoSilencio } from "../../domain/vigia-turno.ts";
import { log } from "../../obs/log.ts";

/** Turnos lembrados para não repetir a linha de log; o mais antigo sai (um turno que nunca entregou não vaza). */
const TURNOS_LEMBRADOS = 1_024;

/**
 * O vigia do turno no servidor (definido em 2026-10-05, NOD-73), igual para o app do Mac (rota renovar) e o modo
 * servidor (laço in-process): publica turno.vigia com os NOMES curtos ("Terminal") e registra no log uma linha por
 * nível de silêncio (`turno_sem_novidade`) e uma por limiar de repetição (`turno_repeticao`) — é o dado que mede o
 * gatilho "Preso" da ADR-067. Sem argumento nenhum: o aviso só carrega nome e números.
 */
export function criarAvisoDoVigia(publicar: (plano: PlanoTurno, dados: Record<string, unknown>) => void) {
  const avisados = new Map<string, { nivel: number; repeticao: string | null }>();
  return (plano: PlanoTurno, v: VigiaVivo): void => {
    // A ligação não mostra o aviso (o reducer ignora o frame) e o turno-cérebro dela não conta para o gatilho "Preso".
    if (plano.modoTurno === "ligacao") return;
    const anterior = avisados.get(plano.turnoId) ?? { nivel: 0, repeticao: null };
    const nivel = nivelDoSilencio(v.mudoMs);
    if (nivel > anterior.nivel) {
      log("aviso", "turno_sem_novidade", { turno_id: plano.turnoId, agente_id: plano.agenteId, mudo_ms: v.mudoMs, aberta: v.aberta ?? null, em_fundo: v.emFundo });
    }
    const repeticao = v.repeticao ? `${v.repeticao.nome}:${v.repeticao.vezes}` : null;
    if (v.repeticao && repeticao !== anterior.repeticao) {
      log("aviso", "turno_repeticao", { turno_id: plano.turnoId, agente_id: plano.agenteId, ferramenta: v.repeticao.nome, vezes: v.repeticao.vezes });
    }
    avisados.delete(plano.turnoId);
    avisados.set(plano.turnoId, { nivel, repeticao });
    if (avisados.size > TURNOS_LEMBRADOS) avisados.delete(avisados.keys().next().value!);
    publicar(plano, {
      mudoMs: v.mudoMs,
      emFundo: v.emFundo,
      ...(v.aberta ? { aberta: nomeDaFerramenta(v.aberta) } : {}),
      ...(v.repeticao ? { repeticao: { rotulo: nomeDaFerramenta(v.repeticao.nome), vezes: v.repeticao.vezes } } : {}),
    });
  };
}
