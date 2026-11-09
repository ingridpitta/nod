import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { FrotaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

describeIntegracao("gestão pelo HTTP real", () => {
  let srv: ServidorCompleto;
  beforeAll(async () => { srv = await servidorCompleto(); });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
  });
  it("cria, organiza, oculta, recupera, exclui e restaura; API não aceita dados inválidos nem execução do excluído", async () => {
    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Gestão HTTP" });
    const id = b.agente.id;
    // 0039: "não lido" é o "lido até" da conversa, então o bot precisa ter falado — o catcher responde.
    const comNovidade = async () => (await srv.json<NaoLidosDto>("GET", "nao-lidos")).conversas.some((c) => c.conversaId === b.conversa.id);
    await srv.json("POST", `conversas/${b.conversa.id}/mensagens`, { texto: "oi" });
    await srv.esperar(comNovidade, { nome: "resposta do catcher não lida" });
    await srv.json("PATCH", `agentes/${id}/organizacao`, { naoLido: false });
    expect(await comNovidade()).toBe(false);
    await srv.json("PATCH", `agentes/${id}/organizacao`, { secao: "Produto", naoLido: true });
    expect(await comNovidade()).toBe(true);
    await srv.json("POST", `agentes/${id}/ocultar`, { oculto: true });
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.some((a) => a.id === id)).toBe(false);
    expect((await srv.json<FrotaDto>("GET", "gestao-agentes")).agentes.find((a) => a.id === id)).toMatchObject({ secao: "Produto", naoLido: true, oculto: true });
    await srv.json("POST", `agentes/${id}/ocultar`, { oculto: false });
    expect((await srv.chamar("PATCH", `agentes/${id}/organizacao`, { naoLido: "sim" })).status).toBe(400);
    expect((await srv.chamar("PATCH", `agentes/${id}/organizacao`, { secao: 42 })).status).toBe(400);
    expect((await srv.chamar("DELETE", "agentes/invalido")).status).toBe(404);
    await srv.json("DELETE", `agentes/${id}`);
    expect((await srv.chamar("POST", `conversas/${b.conversa.id}/mensagens`, { texto: "não executar" })).status).toBe(404);
    expect((await srv.chamar("POST", `agentes/${id}/duplicar`)).status).toBe(404);
    const r = await srv.json<{ agente: Agente }>("POST", `agentes/${id}/restaurar`);
    expect(r.agente).toMatchObject({ nome: "Gestão HTTP", excluidoEm: null, oculto: false });
    expect((await srv.json<FrotaDto>("GET", "frota")).agentes.some((a) => a.id === id)).toBe(true);
  });
});
