import type { ComandoComputador, EstadoComputadorRelatado, ResultadoComandoComputador } from "../../contracts/computador-motor.ts";
import { ESTADO_VALIDO_MS, PRAZO_COMANDO_MS } from "../../domain/computador-canal.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";

/**
 * A fila do computador entre o driver `motor` e a ponte (definido em 2026-10-22, NOD-96 PR 3, ADR-122). Em memória, como
 * as reservas de `itens-locais`: o servidor nunca disca (ADR-021), a máquina puxa. Cada comando é de UMA máquina e de UMA
 * pessoa: a puxada só entrega à conexão cuja chave é a máquina e cujo escopo é o dono do comando. Um servidor reiniciado
 * perde a fila: o resultado que chegar depois é ignorado (id desconhecido) e quem esperava já recebeu o erro.
 */

type Pendente = { comando: ComandoComputador; maquinaId: string; escopo: Escopo; reservadoAte: number; resolver: (r: ResultadoComandoComputador) => void; rejeitar: (e: Error) => void };
type Foto = { escopo: Escopo; relato: EstadoComputadorRelatado; em: number };

export type CanalComputador = ReturnType<typeof criarCanalComputador>;

export function criarCanalComputador(o: { agora: () => number }) {
  const pendentes = new Map<string, Pendente>();
  /** A última foto de cada máquina (a chave é a máquina: um supervisor por máquina). */
  const fotos = new Map<string, Foto>();
  const mesmaPessoa = (a: Escopo, b: Escopo) => a.tenantId === b.tenantId && a.pessoaId === b.pessoaId;

  return {
    /**
     * Põe o comando na fila da máquina e devolve a resposta dela. Não tem prazo próprio: quem chama corta pelo
     * `cancelar` (o teto de 60 s, o prazo da ação). O comando vencido (`prazoMs`) não sai mais na puxada.
     */
    enviar(escopo: Escopo, maquinaId: string, comando: ComandoComputador): Promise<ResultadoComandoComputador> {
      return new Promise((resolver, rejeitar) => {
        pendentes.set(comando.id, { comando, maquinaId, escopo, reservadoAte: 0, resolver, rejeitar });
      });
    },
    /** Tira o comando da fila; quem esperava recebe `motivo` (o resultado que chegar depois é ignorado). */
    cancelar(id: string, motivo: Error): void {
      const p = pendentes.get(id);
      if (!p) return;
      pendentes.delete(id);
      p.rejeitar(motivo);
    },
    /**
     * O que a máquina leva nesta puxada: os comandos dela, da mesma pessoa, ainda no prazo e sem reserva viva. Cada um
     * fica reservado por 2 min (a máquina caiu no meio: volta à fila depois disso, e o supervisor recusa o id repetido).
     */
    puxar(escopo: Escopo, maquinaId: string): ComandoComputador[] {
      const agora = o.agora();
      const saem: ComandoComputador[] = [];
      for (const p of pendentes.values()) {
        if (p.maquinaId !== maquinaId || !mesmaPessoa(p.escopo, escopo) || p.comando.prazoMs <= agora || p.reservadoAte > agora) continue;
        p.reservadoAte = agora + PRAZO_COMANDO_MS;
        saem.push(p.comando);
      }
      return saem;
    },
    /** Há comando esperando esta máquina (o long-poll volta na hora). */
    temPara(escopo: Escopo, maquinaId: string): boolean {
      const agora = o.agora();
      for (const p of pendentes.values()) if (p.maquinaId === maquinaId && mesmaPessoa(p.escopo, escopo) && p.comando.prazoMs > agora && p.reservadoAte <= agora) return true;
      return false;
    },
    /**
     * A resposta de um comando. Idempotente: a segunda vez o id já saiu e é ignorada. Id desconhecido (servidor
     * reiniciado, já cancelado) ou de outra máquina/pessoa: ignorado, com log — nunca resolve o comando alheio.
     */
    resultado(escopo: Escopo, maquinaId: string, r: ResultadoComandoComputador): boolean {
      const p = pendentes.get(r.id);
      if (!p || p.maquinaId !== maquinaId || !mesmaPessoa(p.escopo, escopo)) {
        log("aviso", "computador_resultado_ignorado", { comando_id: r.id, maquina_id: maquinaId, conhecido: Boolean(p) });
        return false;
      }
      pendentes.delete(r.id);
      if (r.desfecho === "falhou") log("aviso", "computador_comando_falhou", { comando_id: r.id, tipo: p.comando.tipo, maquina_id: maquinaId, motivo: r.motivo ?? null });
      p.resolver(r);
      return true;
    },
    relatarEstado(escopo: Escopo, maquinaId: string, relato: EstadoComputadorRelatado): void {
      fotos.set(maquinaId, { escopo, relato, em: o.agora() });
    },
    /** A foto viva (até 45 s) desta máquina, se é da pessoa. */
    foto(escopo: Escopo, maquinaId: string): EstadoComputadorRelatado | null {
      const f = fotos.get(maquinaId);
      return f && mesmaPessoa(f.escopo, escopo) && o.agora() - f.em < ESTADO_VALIDO_MS ? f.relato : null;
    },
    /** A foto viva da máquina, sem olhar a pessoa: só para o gancho interno da NOD-92 (a máquina já é do chamador). */
    fotoDaMaquina(maquinaId: string): EstadoComputadorRelatado | null {
      const f = fotos.get(maquinaId);
      return f && o.agora() - f.em < ESTADO_VALIDO_MS ? f.relato : null;
    },
    /** As fotos vivas da pessoa (todas as máquinas dela), para os ganchos da NOD-92. */
    fotosDa(escopo: Escopo): { maquinaId: string; relato: EstadoComputadorRelatado }[] {
      const agora = o.agora();
      return [...fotos.entries()].filter(([, f]) => mesmaPessoa(f.escopo, escopo) && agora - f.em < ESTADO_VALIDO_MS).map(([maquinaId, f]) => ({ maquinaId, relato: f.relato }));
    },
    /** NOD-170: os computadores ligados, pela foto viva de cada máquina (de qualquer pessoa). */
    ligados(): Set<string> {
      const agora = o.agora();
      const ids = new Set<string>();
      for (const f of fotos.values()) if (f.relato.ligado && f.relato.computadorId && agora - f.em < ESTADO_VALIDO_MS) ids.add(f.relato.computadorId);
      return ids;
    },
    /**
     * NOD-96 PR 4: as telas abertas (ou abrindo) pela foto viva de cada máquina, como `${computadorId}:${agenteId}`. A
     * tela só conta com o computador ligado.
     */
    telasLigadas(): Set<string> {
      const agora = o.agora();
      const ids = new Set<string>();
      for (const f of fotos.values()) {
        if (!f.relato.ligado || !f.relato.computadorId || agora - f.em >= ESTADO_VALIDO_MS) continue;
        for (const t of f.relato.telas) if (t.estado === "aberta" || t.estado === "abrindo") ids.add(`${f.relato.computadorId}:${t.agenteId}`);
      }
      return ids;
    },
    /** A máquina saiu (desconectada pela tela): a foto dela não vale mais. */
    esquecerMaquina(maquinaId: string): void {
      fotos.delete(maquinaId);
    },
    /** Só testes. */
    pendentes: () => [...pendentes.values()].map((p) => ({ id: p.comando.id, maquinaId: p.maquinaId, tipo: p.comando.tipo })),
  };
}
