import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { PedidoParado } from "../../../src/domain/pedido-parado.ts";
import { ADIAR_PEDIDO_IGNORADO_MS, cuidarDosPedidosParados, type PedidosAdiados } from "../../../src/use-cases/pedidos-parados.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsFalsos } from "./deps-l5.ts";

/**
 * #218 (2026-10-09): o pedido que a entrega ou o aviso deixa de lado (`ignorado`) não grava nada e continua na consulta
 * do varredor. Antes ele era refeito a cada passada de 30 s; agora fica adiado por ADIAR_PEDIDO_IGNORADO_MS.
 */
const AGORA = 1_700_000_000_000;

function montar() {
  const { deps } = depsFalsos({ agora: AGORA });
  // Um pedido cuja tarefa não existe (nunca foi uma delegação): o aviso responde `nao_e_tarefa_peer` e não grava.
  const pedido: PedidoParado = { tarefaId: randomUUID(), trabalhoColegaId: randomUUID(), estadoColega: "falhou", ultimoTurnoId: null, ultimoMotivo: "trabalho_incompleto", ultimoMotivoFalha: null, quedaEm: null, quedas: 0, cardRetomar: null, sinalDepoisDaQueda: false, textoFinal: null, turnoDoTextoFinal: null };
  let buscas = 0;
  const repos = {
    ...deps.repos,
    trabalhos: { ...deps.repos.trabalhos, pedidosAColegaParados: async () => [pedido] },
    turnos: { ...deps.repos.turnos, buscar: async (id: string) => { buscas += 1; return deps.repos.turnos.buscar(id); } },
  };
  const em = (ms: number): Deps => ({ ...deps, repos, agora: () => AGORA + ms });
  return { pedido, em, buscas: () => buscas };
}

describe("pedidos parados: o ignorado é adiado, não refeito a cada passada (#218)", () => {
  it("dentro de 5 min o pedido ignorado nem é olhado; vencido o prazo, é avaliado de novo", async () => {
    const m = montar();
    const adiados: PedidosAdiados = new Map();
    expect((await cuidarDosPedidosParados(m.em(0), { adiados })).data.avisados).toEqual([]);
    expect(m.buscas()).toBe(1);
    expect(adiados.get(m.pedido.tarefaId)).toBe(AGORA + ADIAR_PEDIDO_IGNORADO_MS);

    for (const s of [30, 60, 90, 120, 240]) await cuidarDosPedidosParados(m.em(s * 1_000), { adiados });
    expect(m.buscas()).toBe(1);

    await cuidarDosPedidosParados(m.em(ADIAR_PEDIDO_IGNORADO_MS), { adiados });
    expect(m.buscas()).toBe(2);
    expect(adiados.get(m.pedido.tarefaId)).toBe(AGORA + 2 * ADIAR_PEDIDO_IGNORADO_MS);
  });

  it("sem a memória (chamada avulsa, testes antigos), cada chamada avalia como antes", async () => {
    const m = montar();
    await cuidarDosPedidosParados(m.em(0));
    await cuidarDosPedidosParados(m.em(30_000));
    expect(m.buscas()).toBe(2);
  });
});
