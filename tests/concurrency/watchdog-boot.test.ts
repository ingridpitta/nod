import { afterEach, expect, it, vi } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-267 sobre o boot REAL do modo compartilhado (no lugar do `kill -STOP`, critério 4): depois do boot, a fonte das
 * pessoas dos laços pendura — o tick do agendador e do varredor fica preso como no pool esgotado de 15/10. O servidor
 * continua respondendo: `/api/saude` vira 503 e o watchdog chama `sair(1)`. Na drenagem (deploy), o watchdog não sai.
 */

type Pessoas = { tenantId: string; id: string }[];

function portaoDasPessoas(travadoDesdeOInicio = false) {
  let travado = travadoDesdeOInicio;
  const pendentes: (() => void)[] = [];
  return {
    envolver: (listar: () => Promise<Pessoas>) => () => (travado ? new Promise<Pessoas>((r) => { pendentes.push(() => void listar().then(r)); }) : listar()),
    travar: () => { travado = true; },
    soltar: () => {
      travado = false;
      for (const p of pendentes.splice(0)) p();
    },
  };
}

let abertos: { srv: ServidorCompleto; portao: ReturnType<typeof portaoDasPessoas> }[] = [];
afterEach(async () => {
  for (const { srv, portao } of abertos) {
    portao.soltar();
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
  }
  abertos = [];
});

async function subir() {
  const portao = portaoDasPessoas();
  const sair = vi.fn();
  const srv = await servidorCompleto({
    env: { NOD_MODO: "compartilhado" },
    envolverListarPessoas: portao.envolver,
    // Piso 0: o laço de 200 ms é dado como parado em 600 ms. Carência de 5 s: o boot (que também bate) tem folga sob carga.
    watchdog: { intervaloMs: 50, carenciaMs: 5_000, sair, lacoParadoMinimoMs: 0 },
  });
  abertos.push({ srv, portao });
  return { srv, portao, sair, saude: async () => (await fetch(`${srv.url}/api/saude`)).status };
}

describeIntegracao("NOD-267: watchdog no boot do compartilhado", () => {
  it("tick travado → /api/saude 503 (o servidor responde) e o watchdog sai com 1", async () => {
    const { portao, sair, saude } = await subir();
    await expect.poll(saude, { timeout: 5_000, interval: 50 }).toBe(200);
    expect(sair).not.toHaveBeenCalled();

    portao.travar();
    await expect.poll(saude, { timeout: 10_000, interval: 50 }).toBe(503);
    await expect.poll(() => sair.mock.calls.length, { timeout: 15_000, interval: 50 }).toBe(1);
    expect(sair).toHaveBeenCalledWith(1);
  });

  it("boot pendurado no banco (passo 5, antes dos laços) → o watchdog, já ligado depois do listen, sai com 1", async () => {
    const portao = portaoDasPessoas(true);
    const sair = vi.fn();
    const subindo = servidorCompleto({
      env: { NOD_MODO: "compartilhado" },
      envolverListarPessoas: portao.envolver,
      watchdog: { intervaloMs: 50, carenciaMs: 500, sair, lacoParadoMinimoMs: 0 },
    });
    try {
      await expect.poll(() => sair.mock.calls.length, { timeout: 15_000, interval: 50 }).toBe(1);
      expect(sair).toHaveBeenCalledWith(1);
    } finally {
      portao.soltar();
      abertos.push({ srv: await subindo, portao });
    }
  });

  // QA da NOD-267 (Teodora, 2026-10-15): o contrato "batimento só no compartilhado" no boot REAL — no Mac, acordar do
  // sono deixaria o batimento velho; aqui o tick trava de verdade no modo local e a saúde segue 200, sem watchdog.
  it("modo local com o tick travado: /api/saude segue 200 e não há watchdog", async () => {
    const portao = portaoDasPessoas();
    const sair = vi.fn();
    const srv = await servidorCompleto({
      env: { NOD_MODO: undefined },
      envolverListarPessoas: portao.envolver,
      watchdog: { intervaloMs: 50, carenciaMs: 0, sair, lacoParadoMinimoMs: 0 },
    });
    abertos.push({ srv, portao });
    const saude = async () => (await fetch(`${srv.url}/api/saude`)).status;
    await expect.poll(saude, { timeout: 5_000, interval: 50 }).toBe(200);

    portao.travar();
    await new Promise((r) => setTimeout(r, 1_500)); // > 3 × 200 ms de laço vencido e > 4 verificações de 50 ms
    expect(await saude()).toBe(200);
    expect(sair).not.toHaveBeenCalled();
  });

  it("na drenagem do deploy (ADR-071) o watchdog não sai, mesmo com o tick travado", async () => {
    const { srv, portao, sair, saude } = await subir();
    await expect.poll(saude, { timeout: 5_000, interval: 50 }).toBe(200);
    await srv.drenar({ prazoMs: 0 });
    portao.travar();
    await expect.poll(saude, { timeout: 10_000, interval: 50 }).toBe(503);
    await new Promise((r) => setTimeout(r, 1_000)); // > 4 verificações de 50 ms com o laço já vencido
    expect(sair).not.toHaveBeenCalled();
  });
});
