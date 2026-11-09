import type { DesfazerParaRodar, DesfechoArquivo, RelatoDesfazer } from "../../contracts/checkpoint.ts";
import type { PonteInterna } from "../../contracts/ponte.ts";
import { caminhoParaRelato } from "../../domain/checkpoints.ts";
import { log } from "../../obs/log.ts";
import { desfazerTurno } from "./checkpoints.ts";

/** De quanto em quanto a máquina puxa os desfazeres (a pessoa clicou e espera ver "Desfazendo…" logo). */
export const INTERVALO_DESFAZERES_MS = 3_000;
/**
 * O progresso vai no máximo uma vez por isto (um desfazer de 200 arquivos não vira 200 chamadas). Cada relato relê a
 * conversa nas abas abertas: 2 s basta para o "N de M" andar sem pesar (revisão 2, M4).
 */
export const PROGRESSO_A_CADA_MS = 2_000;
/** O desfazer que espera um turno da máquina avisa o servidor que segue vivo, no máximo uma vez por minuto. */
export const SINAL_A_CADA_MS = 60_000;
/** O teto de caminhos no relato (a validação da ponte recusa acima disso). */
export const TETO_RELATO = 1_000;
const ORDEM: Record<DesfechoArquivo, number> = { conflito: 0, erro: 1, mesclado: 2, voltou: 3 };

/** O fim que o servidor ainda não aceitou, por turno (no módulo: sobrevive a religar o laço no mesmo processo). */
const relatosPendentes = new Map<string, { dono: string; machineId: string; relato: RelatoDesfazer }>();

export type OpcoesDesfazeres = {
  ponte: Pick<PonteInterna, "desfazeres" | "relatarDesfazer">;
  pessoaId: string;
  machineId: string;
  home: string;
  intervaloMs?: number;
  /** Só testes: o desfazer de verdade é `desfazerTurno` (git sombra em ~/nod/.checkpoints). */
  desfazer?: typeof desfazerTurno;
  agora?: () => number;
};

export type Desfazeres = { parar(): void; passada(): Promise<void> };

/**
 * definido em 2026-10-28 (NOD-54, ADR-134): o laço que puxa os desfazeres desta máquina (o servidor nunca disca, ADR-021)
 * e os roda um de cada vez. Refazer é seguro: o arquivo que já voltou dá `voltou` de novo, então a máquina que caiu no meio
 * refaz a passada inteira quando volta. O fim fica guardado até o servidor aceitar; enquanto isso o mesmo turno não roda
 * de novo. Ponte sem `desfazeres` (servidor antigo, catcher de teste) = nada roda.
 */
export function iniciarDesfazeres(o: OpcoesDesfazeres): Desfazeres {
  const desfazer = o.desfazer ?? desfazerTurno;
  const agora = o.agora ?? Date.now;
  let parado = false;
  let ocupado = false;
  const sinalEm = new Map<string, number>();

  async function relatar(relato: RelatoDesfazer): Promise<boolean> {
    if (!o.ponte.relatarDesfazer) return false;
    try {
      return (await o.ponte.relatarDesfazer(o.pessoaId, o.machineId, relato)) !== null;
    } catch {
      return false;
    }
  }

  async function relatarFim(relato: RelatoDesfazer): Promise<void> {
    relatosPendentes.set(relato.turnoId, { dono: o.pessoaId, machineId: o.machineId, relato });
    if (await relatar(relato)) relatosPendentes.delete(relato.turnoId);
  }

  async function rodar(d: DesfazerParaRodar): Promise<void> {
    const base = { turnoId: d.turnoId, tentativa: d.tentativa };
    let ultimo = 0;
    let total = 0;
    // O progresso vai sem esperar (revisão 13, M1): o desfazer segura a trava do bot, e a rede pendurada (até 35 s por
    // relato) a seguraria por horas, com o turno novo do bot gravando por baixo. Um relato no ar por vez.
    let noAr = false;
    try {
      const r = await desfazer({
        home: o.home,
        pastaDoBot: d.pastaDoBot,
        turnoId: d.turnoId,
        forcar: d.forcar,
        aoProgresso: (feitos, t) => {
          total = t;
          if (feitos >= t || noAr || agora() - ultimo < PROGRESSO_A_CADA_MS) return;
          ultimo = agora();
          noAr = true;
          void relatar({ ...base, feitos, total: t }).finally(() => { noAr = false; });
        },
      });
      // Um turno do bot está aberto na mesma pasta: nada foi mexido; a próxima passada tenta de novo (sem relato).
      // O sinal de vida (total 0, no máximo um por minuto) renova o prazo de 15 min do servidor (revisão 3, M2).
      if (r === "ocupado") {
        log("info", "desfazer_esperando_turno", { turno_id: d.turnoId });
        if (agora() - (sinalEm.get(d.turnoId) ?? 0) >= SINAL_A_CADA_MS) {
          sinalEm.set(d.turnoId, agora());
          await relatar({ ...base, feitos: 0, total: 0 });
        }
        return;
      }
      sinalEm.delete(d.turnoId);
      if (r === "sem_checkpoint") {
        log("aviso", "desfazer_sem_checkpoint", { turno_id: d.turnoId });
        await relatarFim({ ...base, feitos: 0, total: 0, falha: "sem_checkpoint" });
        return;
      }
      const contagem = r.arquivos.reduce<Record<string, number>>((c, a) => ({ ...c, [a.desfecho]: (c[a.desfecho] ?? 0) + 1 }), {});
      log("info", "desfazer_terminou", { turno_id: d.turnoId, ...contagem });
      // O servidor aceita até 1000 caminhos no relato: acima disso vão os que pedem atenção primeiro (a contagem da tela
      // fica sobre esses; um turno que mexe em mais de mil arquivos é raro, e o total real segue no checkpoint).
      // O caminho que o servidor recusaria (nome com controle, longo demais) vai como marcador: senão o relato inteiro
      // seria recusado para sempre e o desfazer ficaria preso em "Desfazendo…".
      const ordenados = r.arquivos.length > TETO_RELATO ? [...r.arquivos].sort((a, b) => ORDEM[a.desfecho] - ORDEM[b.desfecho]).slice(0, TETO_RELATO) : r.arquivos;
      const enviado = { arquivos: ordenados.map((a) => ({ caminho: caminhoParaRelato(a.caminho), desfecho: a.desfecho })) };
      await relatarFim({ ...base, feitos: r.arquivos.length, total: r.arquivos.length, resultado: enviado });
    } catch (e) {
      log("aviso", "desfazer_falhou", { turno_id: d.turnoId, erro: e instanceof Error ? e.name : "desconhecido" });
      await relatarFim({ ...base, feitos: 0, total, falha: "erro" });
    }
  }

  async function passada(): Promise<void> {
    if (parado || ocupado || !o.ponte.desfazeres) return;
    ocupado = true;
    try {
      for (const [turnoId, p] of [...relatosPendentes]) {
        if (p.dono !== o.pessoaId || p.machineId !== o.machineId) continue;
        if (await relatar(p.relato)) relatosPendentes.delete(turnoId);
      }
      let lista: DesfazerParaRodar[] | null;
      try {
        lista = await o.ponte.desfazeres(o.pessoaId, o.machineId);
      } catch {
        lista = null;
      }
      if (!lista || parado) return;
      for (const d of lista) {
        if (parado) return;
        // O fim desta tentativa ainda não foi aceito: não refaz. Pendente de uma tentativa velha: o servidor já o recusaria.
        const pendente = relatosPendentes.get(d.turnoId);
        if (pendente && pendente.relato.tentativa === d.tentativa) continue;
        if (pendente) relatosPendentes.delete(d.turnoId);
        log("info", "desfazer_comecou", { turno_id: d.turnoId, tentativa: d.tentativa, forcar: d.forcar.length });
        await rodar(d);
      }
    } catch (e) {
      log("aviso", "desfazeres_passada_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    } finally {
      ocupado = false;
    }
  }

  void passada();
  const timer = setInterval(() => void passada(), o.intervaloMs ?? INTERVALO_DESFAZERES_MS);
  timer.unref?.();
  return {
    parar() {
      parado = true;
      clearInterval(timer);
    },
    passada,
  };
}

/** Só testes: esquece os relatos guardados (o estado mora no módulo). */
export function esquecerDesfazeresDoProcesso(): void {
  relatosPendentes.clear();
}
