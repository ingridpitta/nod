import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

/**
 * ADR-092: o servidor no Mac (modo local, o diário) com a VM da pessoa conectada pela ponte HTTP. O Mac roda os bots
 * neste processo (catcher, custo zero); a VM só pega o turno do bot escolhido para ela, sem --resume e sem tocar na
 * sessão da conversa. Commita (servidorCompleto) e limpa por id ao fim.
 */
describeIntegracao("ponte HTTP com o servidor no Mac (modo local) e uma VM", () => {
  let srv: ServidorCompleto;
  let chave = "", vmId = "";
  const bots: { agente: Agente; conversa: Conversa }[] = [];
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const puxar = async () => ((await (await pedir("puxar")).json()) as { plano: PlanoTurno | null }).plano;
  const turno = (id: string) => srv.json<{ turno: { estado: string; machineId: string | null } }>("GET", `turnos/${id}`).then((r) => r.turno);

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LONGPOLL_MS: "20" } });
    const k = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-teste" });
    chave = k.chave; vmId = k.dados.id;
    for (const nome of ["Bot do Mac", "Bot da VM"]) bots.push(await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Ajuda o time" }));
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: bots.map((b) => b.agente.id), conversas: bots.map((b) => b.conversa.id) });
    await srv.desligar();
  });

  it("a chave da máquina vale no modo local: a VM conecta e aparece em Máquinas, com o endereço da API do Mac", async () => {
    // NOD-8: o Codex abaixo do piso vai com a causa e as versões em `iasDetalhe` (a "Nova conta" diz "atualiza para X").
    const codexAntigo = { estado: "ausente", motivo: "do Mac", causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0", em: 0 };
    expect((await pedir("conectar", { nome: "vm-teste", plataforma: "linux", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": codexAntigo } })).status).toBe(200);
    const m = await srv.json<MaquinasDto>("GET", "maquinas");
    expect(m.servidorNoMac?.api).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const vm = m.maquinas.find((x) => x.id === vmId);
    expect(vm).toMatchObject({ conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto", "codex-cli": "ausente" } });
    expect(vm?.iasDetalhe).toEqual({ "claude-cli": { versao: "fake-sem-custo" }, "codex-cli": { causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0" } });
    // O seletor de IA continua sendo o deste Mac (no compartilhado ele vira o das máquinas).
    expect((await srv.chamar("POST", "executor", { id: "catcher" })).status).toBe(200);
  });

  it("o bot sem máquina escolhida roda no Mac; a VM não o pega", async () => {
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${bots[0]!.conversa.id}/mensagens`, { texto: "Olá, Mac" });
    expect(await puxar()).toBeNull();
    const t = await srv.esperar(async () => { const x = await turno(enviada.ids.turno!); return x.estado === "concluido" ? x : null; }, { nome: "turno no Mac" });
    expect(t.machineId).toBe(srv.machineId);
  });

  it("o bot escolhido para a VM sai só para ela, sem --resume, e a sessão que ela devolve não vira a da conversa", async () => {
    expect((await srv.chamar("PUT", `agentes/${bots[1]!.agente.id}/maquina`, { maquinaId: vmId })).status).toBe(200);
    const conversaId = bots[1]!.conversa.id;
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Olá, VM" });
    let plano: PlanoTurno | null = null;
    for (let i = 0; i < 40 && !plano; i++) plano = await puxar();
    expect(plano).toMatchObject({ turnoId: enviada.ids.turno, machineId: vmId, executor: "local" });
    expect(plano!.entrada.sessaoCli).toBeNull();
    expect(plano!.workspaceId ?? null).toBeNull();
    // O laço do Mac (50 ms) teve tempo de sobra e não o pegou: o turno é da VM.
    expect((await turno(plano!.turnoId)).machineId).toBe(vmId);

    const entrega: Entrega = { turnoId: plano!.turnoId, machineId: vmId, seqLocal: 1, fala: { tipo: "texto", texto: "Resposta da VM" }, resultado: {
      desfecho: "sucesso", texto: "Resposta da VM", sessaoCli: randomUUID(), sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    } };
    expect((await pedir("renovar", { turnoId: plano!.turnoId, sinais, eventos: [] })).status).toBe(200);
    expect((await pedir("entregar", entrega)).status).toBe(200);
    expect((await turno(plano!.turnoId)).estado).toBe("concluido");
    const [conversa] = await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); return tx<{ sessao_cli: string | null }[]>`select sessao_cli from conversas where id = ${conversaId}`; });
    expect(conversa?.sessao_cli).toBeNull();
  });

  it("de volta a \"Este Mac\", o bot sai do alcance da VM e roda no Mac", async () => {
    expect((await srv.chamar("PUT", `agentes/${bots[1]!.agente.id}/maquina`, { maquinaId: null })).status).toBe(200);
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${bots[1]!.conversa.id}/mensagens`, { texto: "De volta ao Mac" });
    expect(await puxar()).toBeNull();
    const t = await srv.esperar(async () => { const x = await turno(enviada.ids.turno!); return x.estado === "concluido" ? x : null; }, { nome: "turno de volta no Mac" });
    expect(t.machineId).toBe(srv.machineId);
  });
});
