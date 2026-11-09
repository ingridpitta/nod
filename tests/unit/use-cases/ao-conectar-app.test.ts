import { describe, expect, it } from "vitest";
import { aoConectarApp } from "../../../src/use-cases/ao-conectar-app.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { decidirAcesso } from "../../../src/use-cases/decidir-acesso.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

/** ClickUp conectado e habilitado: duas de leitura, criar, editar e apagar. */
async function clickupConectado(deps: Deps): Promise<string> {
  const conector = await deps.repos.conectores.criar({ nome: "ClickUp", slug: "clickup", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  await deps.repos.conectores.registrarSonda(conector.id, {
    ok: true,
    agora: deps.agora(),
    catalogo: [
      { nome: "CLICKUP_GET_TASKS", descricao: "", schema: { type: "object" }, readOnlyHint: true },
      { nome: "CLICKUP_GET_LISTS", descricao: "", schema: { type: "object" }, readOnlyHint: true },
      { nome: "CLICKUP_CREATE_TASK", descricao: "", schema: { type: "object" }, readOnlyHint: false },
      { nome: "CLICKUP_UPDATE_TASK", descricao: "", schema: { type: "object" }, readOnlyHint: false },
      { nome: "CLICKUP_DELETE_TASK", descricao: "", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  await deps.repos.conectores.habilitar(conector.id, true);
  return conector.id;
}

describe("o login do app terminou: os cards de conexão viram cards de permitir (definido em 2026-09-25)", () => {
  it("leitura e escrita, em conversas diferentes, viram cards do nível pedido; o 'para' segue junto; nada é concedido", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: milton } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Milton" });
    const { data: gil } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
    const ler = await pedirAcesso(deps, { turnoId: "t1", agenteId: milton.agente.id, conversaId: milton.conversa.id, conector: "clickup", capacidades: [], nivel: "leitura", nao_pedido: [], para: "Listar as tarefas atrasadas" });
    const criar = await pedirAcesso(deps, { turnoId: "t2", agenteId: gil.agente.id, conversaId: gil.conversa.id, conector: "clickup", capacidades: [], nivel: "escrita", nao_pedido: [] });
    const outro = await pedirAcesso(deps, { turnoId: "t3", agenteId: gil.agente.id, conversaId: gil.conversa.id, conector: "slack", capacidades: [], nivel: "leitura", nao_pedido: [] });

    // Sem o app conectado, nada muda.
    expect((await executar(deps, aoConectarApp, { slug: "clickup" })).data.cards).toBe(0);

    await clickupConectado(deps);
    expect((await executar(deps, aoConectarApp, { slug: "clickup" })).data.cards).toBe(2);
    expect((await deps.repos.propostas.buscar(ler.data.proposta_id))?.estado).toBe("confirmada");
    expect((await deps.repos.propostas.buscar(criar.data.proposta_id))?.estado).toBe("confirmada");
    expect((await deps.repos.propostas.buscar(outro.data.proposta_id))?.estado).toBe("pendente");

    const novos = banco.propostas.filter((p) => p.estado === "pendente" && p.payload.kind === "acesso" && p.payload.conector === "clickup");
    const deLeitura = novos.find((p) => p.agenteId === milton.agente.id);
    const deEscrita = novos.find((p) => p.agenteId === gil.agente.id);
    expect(deLeitura?.payload).toMatchObject({ capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_GET_LISTS"], nivel: "leitura", para: "Listar as tarefas atrasadas" });
    expect(deEscrita?.payload).toMatchObject({ capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_GET_LISTS", "CLICKUP_CREATE_TASK", "CLICKUP_UPDATE_TASK"], nivel: "escrita" });
    expect(banco.decisoes.filter((d) => d.tipo === "acesso" && d.estado === "pendente").map((d) => d.id).sort()).toEqual([deLeitura?.id, deEscrita?.id].sort());
    expect(banco.concessoes).toHaveLength(0);
    // Segunda passada não abre card de novo.
    expect((await executar(deps, aoConectarApp, { slug: "clickup" })).data.cards).toBe(0);
  });

  it("Permitir com grupos desmarcados concede só o que ficou marcado; nunca algo fora do pedido nem nada", async () => {
    const { deps, banco } = depsEmMemoria();
    const { data: gil } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Gil" });
    await clickupConectado(deps);
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: gil.conversa.id, agenteId: gil.agente.id, origem: "conversa", prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "crie a tarefa", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
    const pedido = await pedirAcesso(deps, { turnoId: turno?.id ?? "", agenteId: gil.agente.id, conversaId: gil.conversa.id, conector: "clickup", capacidades: [], nivel: "escrita", nao_pedido: [] });
    const id = pedido.data.proposta_id;
    await esperarErro(() => decidirAcesso(deps, { decisaoId: id, recusar: false, executor: "catcher", capacidades: ["CLICKUP_DELETE_TASK"] }), "entrada_invalida");
    await esperarErro(() => decidirAcesso(deps, { decisaoId: id, recusar: false, executor: "catcher", capacidades: [] }), "entrada_invalida");
    const r = await executar(deps, decidirAcesso, { decisaoId: id, recusar: false, executor: "catcher", capacidades: ["CLICKUP_GET_TASKS", "CLICKUP_GET_LISTS"] });
    expect(r.data.concessoes).toBe(2);
    expect(banco.concessoes.map((c) => c.capacidade).sort()).toEqual(["CLICKUP_GET_LISTS", "CLICKUP_GET_TASKS"]);
  });
});
