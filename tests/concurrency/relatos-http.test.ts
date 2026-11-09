import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

describeIntegracao("relatos pelo HTTP real", () => {
  let srv: ServidorCompleto;
  const agentes: string[] = [];
  const conversas: string[] = [];

  beforeAll(async () => {
    srv = await servidorCompleto();
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes, conversas });
    await srv.desligar();
  });

  it("relata a partir de uma mensagem, lista o relato e recusa entrada inválida sem 500", async () => {
    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Relato HTTP" });
    agentes.push(b.agente.id);
    conversas.push(b.conversa.id);

    await srv.json<RespostaMutacao>("POST", `conversas/${b.conversa.id}/mensagens`, { texto: "faça a coisa" });
    const conversa = await srv.json<ConversaDto>("GET", `conversas/${b.conversa.id}/mensagens`);
    const mensagemId = conversa.mensagens[0]!.id;

    const criado = await srv.json<RespostaMutacao>("POST", "relatos", {
      mensagemId,
      categoria: "resposta_errada",
      alcance: "janela",
      texto: "esperava que perguntasse antes",
      versaoApp: "0.2.0-rc.1",
    });
    expect(criado.ids.relato).toBeTruthy();

    const { relatos } = await srv.json<{ relatos: Relato[] }>("GET", "relatos");
    const r = relatos.find((x) => x.id === criado.ids.relato);
    expect(r).toMatchObject({ categoria: "resposta_errada", alcance: "janela", mensagemId, conversaId: b.conversa.id });
    expect(r!.metadados.versaoApp).toBe("0.2.0-rc.1");
    expect(r!.mensagensAnexadas).toBeGreaterThanOrEqual(1);
    // Emenda NOD-367 da ADR-041: a listagem traz à PRÓPRIA pessoa o resumo do que ela escreveu (o título da linha em
    // Feedback); o relato de outra pessoa continua sem prosa (tests/integration/relatos.test.ts prova o outro lado).
    expect(r!.resumo).toBe("esperava que perguntasse antes");

    // Categoria fora da união, alcance inválido e id malformado: 400 de entrada, nunca 500.
    for (const corpo of [
      { mensagemId, categoria: "nao_gostei", alcance: "mensagem" },
      { mensagemId, categoria: "outro", alcance: "tudo" },
      { mensagemId: "nao-e-uuid", categoria: "outro", alcance: "mensagem" },
      { mensagemId, categoria: "outro", alcance: "mensagem", texto: "x".repeat(2001) },
    ]) {
      const resp = await srv.chamar("POST", "relatos", corpo);
      expect(resp.status).toBe(400);
    }

    // Mensagem que não existe é 404, e não deixa relato órfão.
    expect((await srv.chamar("POST", "relatos", { mensagemId: randomUUID(), categoria: "outro", alcance: "mensagem" })).status).toBe(404);
  });

  it("uma falha do catcher com segredo deixa o diagnóstico do relato redigido (NOD-158)", async () => {
    const b = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Relato com segredo" });
    agentes.push(b.agente.id);
    conversas.push(b.conversa.id);

    // Montado em tempo de execução para não parecer chave real ao secret scanning.
    const tok = "Zk3".repeat(14);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${b.conversa.id}/mensagens`, { texto: `[[falha: 401 Bearer ${tok}]]` });
    const turnoId = enviada.ids.turno ?? "";
    await srv.esperar(async () => {
      const { turno } = await srv.json<{ turno: Turno }>("GET", `turnos/${turnoId}`);
      return turno.estado === "concluido" || turno.estado === "interrompido" ? turno : null;
    }, { nome: `turno ${turnoId} terminar`, timeoutMs: 15_000 });

    const conversa = await srv.json<ConversaDto>("GET", `conversas/${b.conversa.id}/mensagens`);
    const mensagemId = (conversa.mensagens.find((m) => m.turnoId === turnoId) ?? conversa.mensagens[0]!).id;
    const criado = await srv.json<RespostaMutacao>("POST", "relatos", { mensagemId, categoria: "travou_ou_parou", alcance: "mensagem" });

    const { relatos } = await srv.json<{ relatos: Relato[] }>("GET", "relatos");
    const r = relatos.find((x) => x.id === criado.ids.relato);
    expect(r?.diagnostico?.erroCru).toContain(`Bearer «redigido: ${tok.length} caracteres»`);
    expect(JSON.stringify(relatos)).not.toContain(tok);
  });
});
