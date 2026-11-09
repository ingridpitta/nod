import { describe, expect, it } from "vitest";
import { criarComputadorDaVm, JANELA_FALHA_LIGAR_MS, PRAZO_LIGAR_MS, type DepsComputadorDaVm } from "../../../desktop/vm-local/computador.ts";
import type { ComandoComputador, EstadoComputadorRelatado, TipoComandoComputador } from "../../../src/contracts/computador-motor.ts";
import { VM_LOCAL_ACORDADA_APOS_ACAO_MS } from "../../../src/domain/computador-canal.ts";
import type { Fase } from "../../../src/domain/preparo-vm-local.ts";
import type { PedidoLigar, StatusInstancia } from "../../../desktop/vm-local/runtime.ts";
import type { UsoDoMac } from "../../../src/contracts/raio-x.ts";
import { deveSegurar } from "../../../src/domain/memoria-mac.ts";

/** NOD-93 (ADR-127 §3): a tabela comando × estado do fio do Mac, com um runtime falso. */
const comando = (tipo: TipoComandoComputador, assinatura = "a", uso: UsoDoMac = "equilibrado"): ComandoComputador => ({ id: tipo, computadorId: "c", tipo, uso, prazoMs: 1, assinatura });
const pedido = { imagem: "/i.img.zst", versao: "1.0.0", arch: "arm64" as const, memoriaGiB: 3, cpus: 4 };
const foto = (telas: EstadoComputadorRelatado["telas"] = []): EstadoComputadorRelatado => ({ computadorId: "c", ligado: true, supervisorPub: "p", telas });

function cenario(o: { status?: StatusInstancia; fase?: Fase; segurar?: boolean | ((uso: UsoDoMac) => boolean); responde?: (ligada: boolean) => boolean; ligarMs?: number; ligarFalha?: () => boolean } = {}) {
  let status: StatusInstancia = o.status ?? "parada";
  let agora = 1_000_000;
  const chamadas: string[] = [];
  const pedidos: PedidoLigar[] = [];
  const deps: DepsComputadorDaVm = {
    runtime: {
      status: async () => status,
      ligar: async (p) => { chamadas.push("ligar"); if (o.ligarFalha?.()) throw new Error("ENOSPC"); pedidos.push(p); agora += o.ligarMs ?? 0; status = "ligada"; },
      parar: async () => { chamadas.push("parar"); status = "parada"; },
      supervisorResponde: async () => (o.responde ?? ((l) => l))(status === "ligada"),
    },
    preparo: () => o.fase ?? { tipo: "pronto", semTelaDesde: null },
    pedido: (uso) => ({ ...pedido, memoriaGiB: uso === "livre" ? 4 : uso === "pouco" ? 2 : 3 }),
    deveSegurar: (uso) => (typeof o.segurar === "function" ? o.segurar(uso) : (o.segurar ?? false)),
    agora: () => agora,
    esperar: async (ms) => { agora += ms; },
  };
  return { vm: criarComputadorDaVm(deps), chamadas, pedidos, avancar: (ms: number) => { agora += ms; }, status: () => status };
}

/** Liga como o servidor liga: pede de novo enquanto vem esperando_tela (a VM sobe em segundo plano), até o gancho deixar passar. */
async function ligar(vm: ReturnType<typeof criarComputadorDaVm>): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if ((await vm.antesDeRepassar(comando("iniciar"))) === null) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("a VM não ligou");
}

describe("desktop/vm-local/computador.ts (NOD-93)", () => {
  it("VM desligada + fechar_tela ou parar: ok sem acordar; a sonda sem assinatura acorda", async () => {
    const { vm, chamadas } = cenario();
    expect(await vm.antesDeRepassar(comando("fechar_tela"))).toEqual({ desfecho: "ok" });
    expect(await vm.antesDeRepassar(comando("parar"))).toEqual({ desfecho: "ok" });
    expect(chamadas).toEqual([]);
    expect(await vm.antesDeRepassar(comando("parar", ""))).toMatchObject({ desfecho: "esperando_tela", progresso: { etapa: "ligando" } });
    expect(chamadas).toEqual(["ligar"]);
  });

  it("preparo baixando, pausado ou preparando: esperando_tela com o progresso, sem ligar", async () => {
    const casos: Array<[Fase, string, number]> = [
      [{ tipo: "baixando", recebidos: 79, total: 100 }, "baixando", 79],
      [{ tipo: "pausado_sem_internet", recebidos: 62, total: 100, retomaEm: 0 }, "pausado_sem_internet", 62],
      [{ tipo: "preparando" }, "preparando", 100],
    ];
    for (const [fase, etapa, pct] of casos) {
      const { vm, chamadas } = cenario({ fase });
      expect(await vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "esperando_tela", progresso: { pct, etapa } });
      expect(chamadas).toEqual([]);
    }
  });

  it("macos_antigo e falhou: falhou com o motivo", async () => {
    expect(await cenario({ fase: { tipo: "macos_antigo" } }).vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "falhou", motivo: "sem_suporte" });
    expect(await cenario({ fase: { tipo: "falhou", motivo: "sha" } }).vm.antesDeRepassar(comando("acao"))).toEqual({ desfecho: "falhou", motivo: "nao_iniciou" });
  });

  it("deveSegurar: esperando_tela (esperando_memoria) sem ligar", async () => {
    const { vm, chamadas } = cenario({ segurar: true });
    expect(await vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "esperando_tela", progresso: { pct: 0, etapa: "esperando_memoria" } });
    expect(chamadas).toEqual([]);
  });

  it("o uso do comando decide (critério da NOD-93): memória apertada segura Pouco e Equilibrado; Livre liga com a memória do Livre", async () => {
    // A régua real do Mac com a memória em amarela: só o uso muda entre os casos.
    const apertada = (uso: UsoDoMac) => deveSegurar(uso, "amarela", null);
    for (const uso of ["pouco", "equilibrado"] as const) {
      const { vm, chamadas } = cenario({ segurar: apertada });
      expect(await vm.antesDeRepassar(comando("iniciar", "a", uso))).toEqual({ desfecho: "esperando_tela", progresso: { pct: 0, etapa: "esperando_memoria" } });
      expect(chamadas).toEqual([]);
    }
    const livre = cenario({ segurar: apertada });
    expect(await livre.vm.antesDeRepassar(comando("iniciar", "a", "livre"))).toMatchObject({ desfecho: "esperando_tela", progresso: { etapa: "ligando" } });
    expect(livre.chamadas).toEqual(["ligar"]);
    expect(livre.pedidos[0]?.memoriaGiB).toBe(4);
    // O preparo em esperando_memoria também não segura o Livre (liga); Equilibrado segue esperando memória.
    const espera: Fase = { tipo: "esperando_memoria", precisaGiB: 3, livreGiB: 1, remedeEm: 0 };
    expect(await cenario({ fase: espera }).vm.antesDeRepassar(comando("iniciar", "a", "livre"))).toMatchObject({ desfecho: "esperando_tela", progresso: { etapa: "ligando" } });
    expect(await cenario({ fase: espera }).vm.antesDeRepassar(comando("iniciar", "a", "equilibrado"))).toEqual({ desfecho: "esperando_tela", progresso: { pct: 0, etapa: "esperando_memoria" } });
  });

  it("parada: liga em segundo plano e responde esperando_tela (ligando); ligada e respondendo, segue (1º ensaio no Mac)", async () => {
    const { vm, chamadas } = cenario();
    expect(await vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "esperando_tela", progresso: { pct: 0, etapa: "ligando" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await vm.antesDeRepassar(comando("iniciar"))).toBeNull();
    expect(await vm.antesDeRepassar(comando("acao"))).toBeNull();
    expect(chamadas).toEqual(["ligar"]);
  });

  it("supervisor mudo depois do start: continua esperando_tela (quem desiste é o teto do servidor); uma ligação por vez", async () => {
    const { vm, chamadas } = cenario({ responde: () => false });
    expect(await vm.antesDeRepassar(comando("iniciar"))).toMatchObject({ desfecho: "esperando_tela" });
    expect(await vm.antesDeRepassar(comando("iniciar"))).toMatchObject({ desfecho: "esperando_tela" });
    expect(chamadas).toEqual(["ligar"]);
    expect(PRAZO_LIGAR_MS).toBe(60_000);
  });

  it("revisão do PR #599 (NOD-407): o limactl que falha vira nao_iniciou na janela, sem ligar de novo; depois dela, tenta outra vez", async () => {
    let falha = true;
    const { vm, chamadas, avancar } = cenario({ ligarFalha: () => falha });
    expect(await vm.antesDeRepassar(comando("iniciar"))).toMatchObject({ desfecho: "esperando_tela", progresso: { etapa: "ligando" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "falhou", motivo: "nao_iniciou" });
    expect(await vm.antesDeRepassar(comando("iniciar"))).toEqual({ desfecho: "falhou", motivo: "nao_iniciou" });
    expect(chamadas).toEqual(["ligar"]);
    avancar(JANELA_FALHA_LIGAR_MS);
    falha = false;
    expect(await vm.antesDeRepassar(comando("iniciar"))).toMatchObject({ desfecho: "esperando_tela", progresso: { etapa: "ligando" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await vm.antesDeRepassar(comando("iniciar"))).toBeNull();
    expect(chamadas).toEqual(["ligar", "ligar"]);
  });

  it("os 60 s contam depois do ligar: 1ª criação de ~3 min e o supervisor 5 s depois ainda segue (1º ensaio no Mac)", async () => {
    let perguntas = 0;
    const { vm } = cenario({ ligarMs: 180_000, responde: (ligada) => ligada && ++perguntas > 5 });
    await ligar(vm);
  });

  it("relato ocioso (sem tela viva, 1 h sem comando, 1º ensaio no Mac) para a VM; com tela aberta ou comando recente, não", async () => {
    const { vm, chamadas, avancar } = cenario();
    await ligar(vm);
    vm.aoRelato([foto()]);
    avancar(VM_LOCAL_ACORDADA_APOS_ACAO_MS);
    vm.aoRelato([foto([{ agenteId: "a", estado: "aberta", ultimaAcaoEm: null, memoriaMb: null }])]);
    await Promise.resolve();
    expect(chamadas).toEqual(["ligar"]);
    vm.aoRelato([foto([{ agenteId: "a", estado: "fechada", ultimaAcaoEm: null, memoriaMb: null }])]);
    await new Promise((r) => setTimeout(r, 0));
    expect(chamadas).toEqual(["ligar", "parar"]);
  });

  it("depois do resume do Mac: ligada e muda → para e liga de novo; respondendo ou parada, nada", async () => {
    let mudo = true;
    const { vm, chamadas } = cenario({ status: "ligada", responde: (l) => l && !mudo });
    const p = vm.aoAcordarDoMac();
    await new Promise((r) => setTimeout(r, 0));
    mudo = false;
    await p;
    expect(chamadas).toEqual(["parar", "ligar"]);
    await vm.aoAcordarDoMac();
    expect(chamadas).toEqual(["parar", "ligar"]);
    const parada = cenario({ status: "parada" });
    await parada.vm.aoAcordarDoMac();
    expect(parada.chamadas).toEqual([]);
  });
});
