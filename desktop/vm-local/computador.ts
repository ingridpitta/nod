import type { GanchosDoComputador, RespostaDoGancho } from "../../src/adapters/executor/computador.ts";
import type { ComandoComputador, EstadoComputadorRelatado } from "../../src/contracts/computador-motor.ts";
import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import { motivoParaFicarAcordada, VM_LOCAL_ACORDADA_APOS_ACAO_MS } from "../../src/domain/computador-canal.ts";
import type { Fase } from "../../src/domain/preparo-vm-local.ts";
import { log } from "../../src/obs/log.ts";
import type { PedidoLigar, RuntimeVmLocal } from "./runtime.ts";

/**
 * definido em 2026-10-24 (NOD-93, ADR-127 §3): o fio do Mac. O app usa o mesmo `iniciarComputador` do motor do Linux,
 * com o socket encaminhado da VM (vm/ctl.sock); estes ganchos põem a VM no caminho:
 *
 *   fechar_tela/parar com a VM desligada   → ok, sem acordar a VM (não há o que fechar)
 *   preparo baixando/pausado/preparando     → esperando_tela (o servidor segura até o TETO_PRONTO_MS)
 *   macos_antigo ou falhou                  → falhou, com o motivo
 *   deveSegurar(c.uso) (memória apertada)   → esperando_tela, etapa esperando_memoria (Livre nunca segura)
 *   senão                                   → liga a VM em segundo plano e responde esperando_tela (etapa ligando) até
 *                                             o supervisor responder; quem desiste é o teto do servidor (nunca segura o
 *                                             comando, que vence em 2 min)
 *
 * No `aoRelato`, a VM ociosa (nenhuma tela viva, nenhum comando há 15 min: `motivoParaFicarAcordada`) dorme.
 * Depois do resume do Mac (`aoAcordarDoMac`), se o supervisor não responde, a VM é religada; o chrony acerta o relógio.
 */

/** definido em 2026-10-24 (plano da NOD-93, passo 8): o supervisor tem 60 s para responder depois do `limactl start`. */
export const PRAZO_LIGAR_MS = 60_000;
const PASSO_LIGAR_MS = 1_000;
/**
 * Revisão do PR #599 (NOD-407): o `limactl start` que falha (disco cheio, imagem corrompida) vira `nao_iniciou` para os
 * pedidos desta janela, em vez de `esperando_tela` até o teto do servidor (4 min) e um ligar novo a cada 1 s. Passada a
 * janela, a próxima tentativa liga de novo.
 */
export const JANELA_FALHA_LIGAR_MS = 30_000;

export type DepsComputadorDaVm = {
  runtime: Pick<RuntimeVmLocal, "status" | "ligar" | "parar" | "supervisorResponde">;
  /** A fase do preparo agora (src/domain/preparo-vm-local.ts). */
  preparo: () => Fase;
  /** Imagem, versão, arquitetura, memória (a do uso da pessoa) e cpus da VM. */
  pedido: (uso: UsoDoMac) => PedidoLigar;
  /** O `deveSegurar` da régua do Mac (ADR-085) no uso que veio no comando: true = não ligar a VM agora. */
  deveSegurar: (uso: UsoDoMac) => boolean;
  agora: () => number;
  esperar?: (ms: number) => Promise<void>;
};

export type ComputadorDaVm = Omit<Required<GanchosDoComputador>, "aoRelato"> & {
  /** Revisão 9 do PR #600: o último relato de cada computador da VM (o `aoRelatoDaVm` junta). */
  aoRelato(estados: readonly EstadoComputadorRelatado[]): void;
  /** powerMonitor `resume`: a VM ligada que não responde é parada e ligada de novo. */
  aoAcordarDoMac(): Promise<void>;
};

/** O que não precisa da VM ligada: fechar o que não está aberto. A sonda do servidor (sem assinatura) acorda a VM. */
function dispensaVm(c: ComandoComputador): boolean {
  return (c.tipo === "fechar_tela" || c.tipo === "parar") && c.assinatura !== "";
}

function respostaDoPreparo(f: Fase, uso: UsoDoMac): RespostaDoGancho | null {
  switch (f.tipo) {
    case "baixando":
      return { desfecho: "esperando_tela", progresso: { pct: f.total ? Math.floor((f.recebidos / f.total) * 100) : 0, etapa: "baixando" } };
    case "pausado_sem_internet":
      return { desfecho: "esperando_tela", progresso: { pct: f.total ? Math.floor((f.recebidos / f.total) * 100) : 0, etapa: "pausado_sem_internet" } };
    case "preparando":
      return { desfecho: "esperando_tela", progresso: { pct: 100, etapa: "preparando" } };
    case "esperando_memoria":
      // Livre nunca segura por memória (ADR-085): o fio liga; o preparo sai da espera pelo `usar` do mesmo uso.
      if (uso === "livre") return null;
      return { desfecho: "esperando_tela", progresso: { pct: 0, etapa: "esperando_memoria" } };
    case "macos_antigo":
      return { desfecho: "falhou", motivo: "sem_suporte" };
    case "falhou":
      return { desfecho: "falhou", motivo: "nao_iniciou" };
    default:
      return null;
  }
}

export function criarComputadorDaVm(d: DepsComputadorDaVm): ComputadorDaVm {
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let ultimoComandoEm: number | null = null;
  // O uso do último comando (ComandoComputador.uso, a régua da pessoa): o religar depois do sono do Mac usa o mesmo.
  let ultimoUso: UsoDoMac = "equilibrado";
  let ligando: Promise<boolean> | null = null;
  let parando = false;
  let falhouAoLigarEm: number | null = null;

  /** Liga (idempotente) e espera o supervisor. Uma ligação por vez: comandos juntos esperam a mesma. */
  function ligarEEsperar(uso: UsoDoMac): Promise<boolean> {
    ligando ??= (async () => {
      try {
        await d.runtime.ligar(d.pedido(uso));
        falhouAoLigarEm = null;
      } catch (e) {
        log("aviso", "vm_local_nao_ligou", { erro: String(e) });
        falhouAoLigarEm = d.agora();
        return false;
      }
      // Os 60 s contam depois do `limactl start`, como diz o PRAZO_LIGAR_MS: no 1º ensaio no Mac (29/10) o prazo nascia
      // antes do ligar, e descompactar + criar + 1º boot (~3 min) o estourava com a VM a segundos de responder.
      const ate = d.agora() + PRAZO_LIGAR_MS;
      while (!(await d.runtime.supervisorResponde())) {
        if (d.agora() >= ate) {
          log("aviso", "vm_local_supervisor_mudo", { prazo_ms: PRAZO_LIGAR_MS });
          return false;
        }
        await esperar(PASSO_LIGAR_MS);
      }
      return true;
    })().finally(() => { ligando = null; });
    return ligando;
  }

  return {
    async antesDeRepassar(c) {
      ultimoComandoEm = d.agora();
      ultimoUso = c.uso;
      const ligada = (await d.runtime.status()) === "ligada";
      if (!ligada && dispensaVm(c)) return { desfecho: "ok" };
      const doPreparo = respostaDoPreparo(d.preparo(), c.uso);
      if (doPreparo) return doPreparo;
      if (ligada && (await d.runtime.supervisorResponde())) return null;
      if (d.deveSegurar(c.uso)) return { desfecho: "esperando_tela", progresso: { pct: 0, etapa: "esperando_memoria" } };
      // definido em 2026-10-29 (1º ensaio no Mac): religar a VM leva 1 a 3 min, e o comando assinado vale 2 min — segurá-lo
      // aqui até a VM subir o entregava vencido ao supervisor. A VM liga em segundo plano e a resposta é esperando_tela:
      // o servidor pede de novo a cada 1 s, com comando novo, até o teto dele (4 min no Mac), e o painel mostra o progresso.
      if (!ligando && falhouAoLigarEm !== null && d.agora() - falhouAoLigarEm < JANELA_FALHA_LIGAR_MS) return { desfecho: "falhou", motivo: "nao_iniciou" };
      void ligarEEsperar(c.uso);
      return { desfecho: "esperando_tela", progresso: { pct: 0, etapa: "ligando" } };
    },

    // Revisão 9 do PR #600: o último relato de cada computador da VM, não só o que acabou de chegar.
    aoRelato(estados: readonly EstadoComputadorRelatado[]) {
      if (parando || ligando || motivoParaFicarAcordada(estados, ultimoComandoEm, d.agora(), VM_LOCAL_ACORDADA_APOS_ACAO_MS)) return;
      parando = true;
      void d.runtime.parar()
        .then(() => log("info", "vm_local_dormiu", {}))
        .catch((err: unknown) => log("aviso", "vm_local_nao_dormiu", { erro: String(err) }))
        .finally(() => { parando = false; });
    },

    async aoAcordarDoMac() {
      if ((await d.runtime.status()) !== "ligada" || (await d.runtime.supervisorResponde())) return;
      log("aviso", "vm_local_religando_apos_sono", {});
      await d.runtime.parar().catch(() => undefined);
      await ligarEEsperar(ultimoUso);
    },
  };
}
