import type { PastaParaLimpar, RelatoLimpeza } from "../contracts/ponte.ts";
import { JANELA_DA_LIMPEZA_MS, pastaDeTask, quandoLimpar } from "../domain/limpeza-das-tasks.ts";
import type { Deps } from "./tipos.ts";

/**
 * As pastas de task que o Mac da pessoa pode limpar (definido em 2026-10-09, ADR-088). O servidor decide pelo banco
 * (src/domain/limpeza-das-tasks.ts); o Mac confere o disco e apaga só o que o git deixa apagar sem --force.
 *
 * ADR-106 (2026-10-15): `codigos` = o sha256 de cada pasta que a máquina tem no disco (`codigosDaMaquina`); só essas
 * entram, e sem a janela de 30 dias — a lista já limita, e a pasta presa há mais tempo volta a ser vista. Lista vazia =
 * nada a limpar. Sem lista (máquina antiga), as encerradas dos últimos 30 dias, das mais recentes para as mais antigas.
 */
export async function pastasParaLimpar(deps: Deps, o: { apertado?: boolean; codigos?: readonly string[] } = {}): Promise<PastaParaLimpar[]> {
  if (o.codigos?.length === 0) return [];
  const agora = deps.agora();
  const candidatos = await deps.repos.trabalhos.candidatosALimpeza(o.codigos ? 0 : agora - JANELA_DA_LIMPEZA_MS, o.codigos ? { codigos: o.codigos } : {});
  return candidatos.flatMap((c) => {
    const quando = quandoLimpar(c, agora, { apertado: o.apertado === true });
    const pasta = pastaDeTask(c.pasta);
    return quando && pasta ? [{ trabalhoId: c.id, pasta, quando }] : [];
  });
}

/**
 * ADR-099 item 9 (definido em 2026-10-12, I5): a pasta da frente que terminou com este turno, se ela já vale
 * `sem_trabalho`. Vai na resposta do `entregar` (rotas/ponte.ts) para o Mac limpar na hora, sem esperar a passada de 6 h.
 * Turno sem trabalho, task, frente que não terminou: null.
 */
export async function pastaSemTrabalhoDoTurno(deps: Deps, turnoId: string): Promise<PastaParaLimpar | null> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno?.trabalhoId) return null;
  const agora = deps.agora();
  const [c] = await deps.repos.trabalhos.candidatosALimpeza(agora - JANELA_DA_LIMPEZA_MS, { id: turno.trabalhoId });
  if (!c) return null;
  const pasta = pastaDeTask(c.pasta);
  return pasta && quandoLimpar(c, agora) === "sem_trabalho" ? { trabalhoId: c.id, pasta, quando: "sem_trabalho" } : null;
}

const MOTIVOS: readonly (keyof RelatoLimpeza["puladas"])[] = ["suja", "travada", "montagem", "pr_nao_mergeado", "clone", "fora_da_pasta", "aninhado", "ignorado_valioso", "head_solto", "em_uso", "nao_reconfirmada", "erro", "processo_vivo", "grande_demais", "sem_prova", "clone_sumiu", "clone_em_uso", "sem_espaco"];
const inteiro = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), Number.MAX_SAFE_INTEGER) : 0);

/**
 * O relato que veio do Mac, só com números conhecidos (a rota HTTP o recebe de fora). Campo estranho some; número
 * inválido vira 0. Nunca lança: o relato é só para o log.
 */
export function relatoValido(v: unknown): RelatoLimpeza {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const p = typeof o.puladas === "object" && o.puladas !== null ? (o.puladas as Record<string, unknown>) : {};
  const puladas: RelatoLimpeza["puladas"] = {};
  for (const m of MOTIVOS) if (inteiro(p[m]) > 0) puladas[m] = inteiro(p[m]);
  return {
    pastas: inteiro(o.pastas),
    removidas: inteiro(o.removidas),
    pastasApagadas: inteiro(o.pastasApagadas),
    liberadoBytes: inteiro(o.liberadoBytes),
    puladas,
    orfas: inteiro(o.orfas),
    orfasParadas: inteiro(o.orfasParadas),
    duracaoMs: inteiro(o.duracaoMs),
    ...(o.simulada === true ? { simulada: true, estimadoBytes: inteiro(o.estimadoBytes) } : {}),
    ...(o.adiada === true ? { adiada: true } : {}),
    ...(o.apertada === true ? { apertada: true, cachesBytes: inteiro(o.cachesBytes) } : {}),
    ...(o.imediata === true ? { imediata: true } : {}),
    // ADR-096 §4: só aparecem quando a máquina manda (máquina antiga não manda).
    ...(inteiro(o.guardadas) > 0 ? { guardadas: inteiro(o.guardadas), guardadoBytes: inteiro(o.guardadoBytes) } : {}),
    ...(inteiro(o.guardadosVencidos) > 0 ? { guardadosVencidos: inteiro(o.guardadosVencidos) } : {}),
    ...(inteiro(o.orfasRemovidas) > 0 ? { orfasRemovidas: inteiro(o.orfasRemovidas) } : {}),
    // NOD-295 A: só a máquina nova manda.
    ...(inteiro(o.clonesApagados) > 0 ? { clonesApagados: inteiro(o.clonesApagados) } : {}),
    // ADR-106: só a máquina nova manda; zero também é notícia (nenhuma pasta no disco, nada oferecido).
    ...(typeof o.pastasEnviadas === "number" ? { pastasEnviadas: inteiro(o.pastasEnviadas), pastasCortadas: inteiro(o.pastasCortadas), candidatos: inteiro(o.candidatos) } : {}),
  };
}

/** Os campos do log `limpeza_feita` (o log só aceita valor plano): um `pulada_<motivo>` por motivo que apareceu. */
export function camposDoRelato(r: RelatoLimpeza): Record<string, number> {
  const campos: Record<string, number> = {
    pastas: r.pastas,
    removidas: r.removidas,
    pastas_apagadas: r.pastasApagadas,
    liberado_mb: Math.round(r.liberadoBytes / 1_048_576),
    orfas: r.orfas,
    orfas_paradas: r.orfasParadas,
    duracao_ms: r.duracaoMs,
  };
  if (r.simulada) campos.estimado_mb = Math.round((r.estimadoBytes ?? 0) / 1_048_576);
  if (r.apertada) { campos.apertada = 1; campos.caches_mb = Math.round((r.cachesBytes ?? 0) / 1_048_576); }
  if (r.imediata) campos.imediata = 1;
  if (r.guardadas) { campos.guardadas = r.guardadas; campos.guardado_mb = Math.round((r.guardadoBytes ?? 0) / 1_048_576); }
  if (r.guardadosVencidos) campos.guardados_vencidos = r.guardadosVencidos;
  if (r.orfasRemovidas) campos.orfas_removidas = r.orfasRemovidas;
  if (r.clonesApagados) campos.clones_apagados = r.clonesApagados;
  if (r.pastasEnviadas !== undefined) { campos.pastas_enviadas = r.pastasEnviadas; campos.pastas_cortadas = r.pastasCortadas ?? 0; campos.candidatos = r.candidatos ?? 0; }
  for (const [m, n] of Object.entries(r.puladas)) if (n) campos[`pulada_${m}`] = n;
  return campos;
}
