import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancelarTurno } from "../../../src/use-cases/cancelar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../../src/use-cases/enviar-mensagem.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describe("cancelarTurno: uma mensagem da fila, sem mexer no que roda", () => {
  it("a mensagem aponta para o turno que disparou; cancelar a da fila a marca 'não rodou' e deixa a outra seguir", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const conversaId = criado.conversa.id;
    const m1 = await executar(deps, enviarMensagem, { conversaId, texto: "fazer", inventario: PRONTO });
    await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    const m2 = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
    const m3 = await executar(deps, enviarMensagem, { conversaId, texto: "e o e-mail do Daniel?", inventario: PRONTO });
    expect(m2.data.turno.mensagemOrigemId).toBe(m2.data.mensagem.id);

    const { data, events } = await executar(deps, cancelarTurno, { turnoId: m2.data.turno.id });
    expect(data.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
    expect(events.map((e) => e.kind)).toEqual(["turno_interrompido"]);

    const lida = (await lerConversa(deps, { conversaId })).data;
    expect(lida.turnosCancelados).toEqual([{ id: m2.data.turno.id, mensagemId: m2.data.mensagem.id }]);
    // A fala da pessoa não vira "fala do turno": mensagens.turno_id continua sendo só o que o turno produziu.
    expect(lida.mensagens.find((m) => m.id === m2.data.mensagem.id)?.turnoId).toBeNull();
    expect(lida.turnosEmCurso).toEqual([
      expect.objectContaining({ id: m1.data.turno.id, estado: "despachando", mensagemId: m1.data.mensagem.id }),
      expect.objectContaining({ id: m3.data.turno.id, estado: "pendente", mensagemId: m3.data.mensagem.id }),
    ]);
  });

  it("o que já está rodando não se cancela por aqui (é o Parar); turno de ninguém → nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const m1 = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "fazer", inventario: PRONTO });
    await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    await esperarErro(() => cancelarTurno(deps, { turnoId: m1.data.turno.id }), "estado_invalido");
    await esperarErro(() => cancelarTurno(deps, { turnoId: randomUUID() }), "nao_encontrado");
  });
});
