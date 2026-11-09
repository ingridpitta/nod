import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

/**
 * NOD-368: a troca em lote de Agentes manda um PUT por bot pelo mesmo caminho da ficha, até 4 ao mesmo tempo. Aqui, os
 * PUTs em paralelo: cada bot grava o seu, o padrão da pessoa não muda, o que falha (404) não desfaz os outros.
 */
describeIntegracao("NOD-368: a troca em lote, PUTs em paralelo", () => {
  let srv: ServidorCompleto;
  let vmId = "", padraoId = "";
  const bots: { agente: Agente; conversa: Conversa }[] = [];
  const gestao = () => srv.json<{ agentes: (Agente & { maquinaId: string | null })[] }>("GET", "gestao-agentes");

  beforeAll(async () => {
    srv = await servidorCompleto();
    vmId = (await srv.json<{ dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-lote" })).dados.id;
    padraoId = (await srv.json<{ dados: { id: string } }>("POST", "maquinas/chaves", { nome: "mac-lote" })).dados.id;
    expect((await srv.chamar("PUT", "maquinas/padrao", { maquinaId: padraoId })).status).toBe(200);
    for (const nome of ["Ada lote", "Gil lote", "Leo lote", "Téo lote"]) bots.push(await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Ajuda o time" }));
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: bots.map((b) => b.agente.id), conversas: bots.map((b) => b.conversa.id) });
    await srv.desligar();
  });

  it("máquina: 3 bots em paralelo e 1 id que não existe; os 3 gravam, o 4º bot e o padrão ficam", async () => {
    const [ada, gil, leo, teo] = bots.map((b) => b.agente.id) as [string, string, string, string];
    const r = await Promise.all([ada, gil, leo, "00000000-0000-4000-8000-000000000000"].map((id) => srv.chamar("PUT", `agentes/${id}/maquina`, { maquinaId: vmId })));
    expect(r.map((x) => x.status)).toEqual([200, 200, 200, 404]);
    const g = await gestao();
    const por = (id: string) => g.agentes.find((a) => a.id === id)!;
    expect([ada, gil, leo].map((id) => por(id).maquinaId)).toEqual([vmId, vmId, vmId]);
    expect(por(teo).maquinaId).toBeNull();
    expect((await srv.json<MaquinasDto>("GET", "maquinas")).padraoId).toBe(padraoId);
    // De volta a "Qualquer uma" em lote: null em todos, o padrão continua.
    expect((await Promise.all([ada, gil].map((id) => srv.chamar("PUT", `agentes/${id}/maquina`, { maquinaId: null })))).map((x) => x.status)).toEqual([200, 200]);
    const g2 = await gestao();
    expect(g2.agentes.find((a) => a.id === ada)!.maquinaId).toBeNull();
    expect(g2.agentes.find((a) => a.id === leo)!.maquinaId).toBe(vmId);
    expect((await srv.json<MaquinasDto>("GET", "maquinas")).padraoId).toBe(padraoId);
  });

  it("IA: o mesmo pedido da ficha em paralelo; uma IA só e de volta ao Automático", async () => {
    const ids = bots.slice(0, 3).map((b) => b.agente.id);
    const fixa = await Promise.all(ids.map((id) => srv.chamar("PUT", `agentes/${id}/inteligencia`, { modo: "fixa", fixa: "codex-cli" })));
    expect(fixa.map((x) => x.status)).toEqual([200, 200, 200]);
    let g = await gestao();
    for (const id of ids) expect(g.agentes.find((a) => a.id === id)!.inteligencia).toMatchObject({ modo: "fixa", fixa: "codex-cli" });
    expect(g.agentes.find((a) => a.id === bots[3]!.agente.id)!.inteligencia?.modo ?? "auto").not.toBe("fixa");
    const auto = await Promise.all(ids.map((id) => srv.chamar("PUT", `agentes/${id}/inteligencia`, { modo: "auto" })));
    expect(auto.map((x) => x.status)).toEqual([200, 200, 200]);
    g = await gestao();
    for (const id of ids) expect(g.agentes.find((a) => a.id === id)!.inteligencia?.modo).toBe("auto");
  });
});
