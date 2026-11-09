import { maquinaVoltou } from "../../domain/incidente.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao, type Metricas } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import { LEASE_MS } from "../../shared/constantes.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { interromperPorMaquina, registrarVoltaDasMaquinas, type SaidaQuedaDaMaquina } from "../../use-cases/interromper-por-maquina.ts";
import { varrerEsperasSemNoticia } from "../../use-cases/esperar-comando.ts";
import { logarTickLento, paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: um sexto do lease (90 s) — um turno órfão fica no máximo 15 s a mais como 'despachando' (ADR-010). */
export const INTERVALO_VARREDOR_LEASE_MS = 15_000;

export type OpcoesVarredura = {
  prazoDecisaoMs?: number;
  metricas?: Metricas;
  /**
   * Só no modo COMPARTILHADO (ADR-045): quando o processo subiu — turno sem sinal desde antes disso foi
   * perdido pelo servidor (reinicio_servidor), não pelo Mac — e o último contato de cada máquina pela
   * ponte HTTP, para o aviso ficar em curso até ela voltar a puxar. Ausentes = modo local: o varredor
   * roda no próprio Mac, então notar a queda já é ter voltado.
   */
  inicioDoProcesso?: number;
  ultimoContato?: (machineId: string) => number | null;
};
export type OpcoesVarredor = OpcoesLaco & OpcoesVarredura;
export type ResultadoVarredura = { interrompidos: string[]; decisoes: string[]; incidenteId?: string | null; voltaram?: string[]; esperasCaidas?: string[] };

/**
 * Lease vencido (ADR-010/021, E9.4): o turno vira 'interrompido' — transição terminal e idempotente
 * (só o que está vivo muda), NUNCA volta a 'pendente', NUNCA reenvia (ADR-009). O que acontece depois
 * (definido em 2026-09-24, ADR-045) é a regra única de interromper-por-maquina.ts: rotina só no
 * histórico, conversa com um "Retomar" por conversa, e UM aviso por queda do Mac.
 */
export async function varrerPessoa(tx: Transacao, escopo: Escopo, agora: number, opcoes: OpcoesVarredura = {}): Promise<ResultadoVarredura> {
  return tx(async (trx) => {
    const repos = criarRepos(trx, escopo);
    const deps = { repos, escopo, agora: () => agora };
    const presente = opcoes.ultimoContato ? (id: string | null) => id !== null && maquinaVoltou(opcoes.ultimoContato?.(id) ?? null, agora) : undefined;
    const vencidos = await repos.turnos.vencidos(agora);
    // NOD-214: a carência do lease no boot (só com inicioDoProcesso, o modo compartilhado).
    const carenciaAte = opcoes.inicioDoProcesso !== undefined ? opcoes.inicioDoProcesso + LEASE_MS : null;
    const r = vencidos.length ? await interromperPorMaquina(deps, { turnos: vencidos, prazoMs: opcoes.prazoDecisaoMs, inicioDoProcesso: opcoes.inicioDoProcesso ?? null, maquinaPresente: presente, carenciaAte }) : null;
    if (r?.events.length) await repos.events.gravarComOutbox(r.events);
    if (r) contarPerdidos(opcoes.metricas ?? registroPadrao, escopo, r.data);
    // ADR-099 (parte 2): a espera de comando cuja máquina sumiu cai e acorda o dono (depois dos turnos: a volta lê o turno).
    const esperas = await varrerEsperasSemNoticia(deps);
    if (esperas.events.length) await repos.events.gravarComOutbox(esperas.events);
    // Por ÚLTIMO: fechar o aviso em curso trava o incidente, e a ordem é turnos → trava por pessoa → incidente.
    const voltaram = presente ? await registrarVoltaDasMaquinas(deps, presente) : [];
    return { interrompidos: r?.data.interrompidos ?? [], decisoes: r?.data.decisoes ?? [], ...(r ? { incidenteId: r.data.incidenteId } : {}), ...(voltaram.length ? { voltaram } : {}), ...(esperas.caidas.length ? { esperasCaidas: esperas.caidas } : {}) };
  });
}

/** ADR-017 #4: turno perdido, pela origem — o Mac que sumiu ou o servidor que reiniciou. A borda observa. */
export function contarPerdidos(metricas: Metricas, escopo: Escopo, r: Pick<SaidaQuedaDaMaquina, "porMotivo">): void {
  if (r.porMotivo.maquina_sem_contato) metricas.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: escopo.tenantId }, r.porMotivo.maquina_sem_contato);
  if (r.porMotivo.reinicio_servidor) metricas.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "restart_servidor", tenant_id: escopo.tenantId }, r.porMotivo.reinicio_servidor);
}

/** Uma varredura por pessoa (paraCadaPessoa: tx REAL por pessoa; uma que falha não impede as outras). */
export async function varrer(db: Db, agora: number, opcoes: OpcoesVarredor = {}): Promise<Record<string, ResultadoVarredura>> {
  const saida: Record<string, ResultadoVarredura> = {};
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      const r = await varrerPessoa(tx, escopo, agora, opcoes);
      if (r.interrompidos.length || r.voltaram?.length || r.esperasCaidas?.length) {
        saida[escopo.pessoaId] = r;
        log("aviso", "lease_vencido", { pessoa_id: escopo.pessoaId, interrompidos: r.interrompidos.length, decisoes: r.decisoes.length, incidente_id: r.incidenteId ?? null, voltaram: r.voltaram?.length ?? 0 });
      }
    },
    { listarPessoas: opcoes.listarPessoas, aoFalhar: opcoes.aoFalhar },
  );
  return saida;
}

export function iniciarVarredorLease(p: {
  db: Db;
  relogio?: Relogio;
  intervaloMs?: number;
  opcoes?: OpcoesVarredor;
  /**
   * revisto em 2026-10-01 (ADR-067): o token de turno não expira mais por relógio, então o turno que o varredor
   * encerrou tem o token revogado aqui — senão ele ficaria vivo em memória até o servidor reiniciar.
   */
  aoInterromper?: (turnoIds: string[]) => void;
  /** NOD-267: chamado ao TERMINAR cada tick (sucesso ou erro); o tick pulado por `rodando` não bate. */
  aoBater?: () => void;
}): { parar(): Promise<void> } {
  const relogio = p.relogio ?? (() => Date.now());
  const intervaloMs = p.intervaloMs ?? INTERVALO_VARREDOR_LEASE_MS;
  let rodando = false;
  let emVoo: Promise<unknown> | null = null;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    const inicio = relogio();
    try {
      const r = await varrer(p.db, inicio, p.opcoes);
      const interrompidos = Object.values(r).flatMap((x) => x.interrompidos);
      if (interrompidos.length) p.aoInterromper?.(interrompidos);
    } finally {
      rodando = false;
      logarTickLento("varredor_lease", relogio() - inicio, intervaloMs);
      p.aoBater?.();
    }
  };
  // NOD-267: sem o catch, um erro do tick (listarPessoas com o banco fora, por exemplo) virava unhandledRejection e
  // derrubava o processo — o agendador e o varredor de expiração já logam e seguem.
  const timer = setInterval(() => {
    if (rodando) return;
    emVoo = tick()
      .catch((e: unknown) => log("erro", "varredor_lease_tick_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }))
      .finally(() => {
        emVoo = null;
      });
  }, intervaloMs);
  timer.unref();
  // NOD-218: `parar()` espera o tick em voo — a drenagem do deploy azul/verde não deixa um tick pela metade quando a
  // outra cor já assumiu.
  return {
    async parar() {
      clearInterval(timer);
      if (emVoo) await emVoo;
    },
  };
}
