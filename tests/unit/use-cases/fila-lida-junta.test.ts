import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { entradaDaFila } from "../../../src/domain/entrada-da-fila.ts";
import { assentarTurno } from "../../../src/use-cases/assentar-turno.ts";
import { cancelarTurno } from "../../../src/use-cases/cancelar-turno.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../../src/use-cases/enviar-mensagem.ts";
import { depsEmMemoria, executar } from "../../helpers/deps-l6.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };

describe("fila lida junta: cada mensagem cancela sozinha, o agente lê as restantes num turno só", () => {
  it("entradaDaFila: uma passa inalterada; várias viram lista numerada na ordem de envio", () => {
    expect(entradaDaFila(["oi"])).toBe("oi");
    const junta = entradaDaFila(["fazer novamente", "e o Daniel?"]);
    expect(junta).toContain("2 mensagens");
    expect(junta).toMatch(/1\. fazer novamente\n2\. e o Daniel\?$/);
  });

  it("3 na fila, 1 cancelada: o próximo turno lê as 2 restantes; a outra sai 'absorvido' apontando para ele", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const conversaId = criado.conversa.id;
    const maquina = randomUUID();
    const rodando = await executar(deps, enviarMensagem, { conversaId, texto: "fazer a triagem", inventario: PRONTO });
    await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    const a = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
    const b = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
    const c = await executar(deps, enviarMensagem, { conversaId, texto: "e o e-mail do Daniel?", inventario: PRONTO });
    await executar(deps, cancelarTurno, { turnoId: b.data.turno.id });
    await executar(deps, assentarTurno, { turnoId: rodando.data.turno.id, machineId: maquina, seqLocal: 1, fala: { tipo: "texto", texto: "feito" }, resultado: { desfecho: "sucesso", texto: "feito", sessaoCli: "s1", sinais: SINAIS, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] } });

    const d = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
    expect(d.data.turno?.id).toBe(a.data.turno.id);
    expect(d.data.plano?.entrada.texto).toBe(entradaDaFila(["fazer novamente", "e o e-mail do Daniel?"]));
    expect(d.events?.map((e) => [e.kind, e.turnoId])).toEqual([["turno_interrompido", c.data.turno.id]]);
    expect(await deps.repos.turnos.buscar(c.data.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: a.data.turno.id });

    const lida = (await lerConversa(deps, { conversaId })).data;
    expect(lida.turnosCancelados.map((t) => t.mensagemId)).toEqual([b.data.mensagem.id]);
    expect(lida.turnosEmCurso.map((t) => t.id)).toEqual([a.data.turno.id]);
  });

  it("rotina na mesma conversa não é absorvida; uma mensagem sozinha segue igual", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const so = await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "só esta", inventario: PRONTO });
    const rotina = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: criado.conversa.id, agenteId: criado.agente.id, origem: "rotina", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "rotina das 18h", entradaConfianca: "confiavel", modelo: criado.agente.modelo });
    const d = await executar(deps, despacharTurno, { machineId: randomUUID(), inventario: PRONTO });
    expect(d.data.turno?.id).toBe(so.data.turno.id);
    expect(d.data.plano?.entrada.texto).toBe("só esta");
    expect(d.events ?? []).toEqual([]);
    expect(await deps.repos.turnos.buscar(rotina?.id ?? "")).toMatchObject({ estado: "pendente", absorvidoPor: null });
  });
});
