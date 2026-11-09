import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import type { RespostaMutacao } from "../../src/contracts/api.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import { vincularEscopo } from "../../src/db/tx.ts";

describeIntegracao("ponte HTTP com servidor compartilhado e duas máquinas", () => {
  let srv: ServidorCompleto;
  let chave = "", outra = "", machineId = "", conversaId = "", agenteId = "";
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const pedir = (nome: string, body: unknown = {}, token = chave, extras: Record<string, string> = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0", ...extras }, body: JSON.stringify(body),
  });
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac A" });
    const b = await srv.json<{ chave: string }>("POST", "maquinas/chaves", { nome: "Mac B" });
    chave = a.chave; machineId = a.dados.id; outra = b.chave;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Bot desktop", descricao: "Ajuda o time" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });
  it("não liga nenhum executor local no servidor e mantém a web disponível", async () => {
    expect(srv.app.registry()?.["claude-cli"].estado).toBe("sombra");
    expect(srv.app.ponte.maquinasConectadas()).toEqual([]);
    expect((await srv.chamar("GET", "frota")).status).toBe(200);
    expect((await srv.chamar("POST", "executor", { id: "catcher" })).status).toBe(404);
  });
  it("recusa Origin antes do token; cookie de navegador não autoriza a máquina", async () => {
    expect((await pedir("conectar", {}, "invalida", { origin: "https://evil.example" })).status).toBe(403);
    expect((await pedir("conectar", {}, "", { cookie: srv.pessoa.cookie })).status).toBe(401);
    expect((await pedir("conectar", {}, chave, { "x-nod-versao": "0.0.9" })).status).toBe(426);
  });
  it("conecta duas máquinas; uma não renova nem entrega turno da outra", async () => {
    for (const token of [chave, outra]) {
      const r = await pedir("conectar", { nome: "Mac", machineId: "ignorado", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } }, token);
      expect(r.status).toBe(200);
    }
    const sessao = await pedir("sessao");
    expect(sessao.headers.get("set-cookie")).toContain("HttpOnly");
    // ADA-11 (ADR-147): a sessão lista as plataformas, e o motor do Windows só conecta com o win32 nela.
    expect(((await sessao.clone().json()) as { plataformas?: string[] }).plataformas).toContain("win32");
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Olá" });
    const pull = await pedir("puxar");
    const { plano } = await pull.json() as { plano: PlanoTurno };
    expect(plano.turnoId).toBe(enviada.ids.turno);
    expect(plano.machineId).toBe(machineId);
    expect(plano.executor).toBe("local");
    expect(plano.entrada.sessaoCli).toBeNull();
    const renew = await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [] }, outra);
    expect((await renew.json() as { ativo: boolean }).ativo).toBe(false);
    expect((await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [{ kind: "decisao" }] })).status).toBe(400);
    const entrega: Entrega = { turnoId: plano.turnoId, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "Resposta do Mac" }, resultado: {
      desfecho: "sucesso", texto: "Resposta do Mac", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    } };
    expect((await pedir("entregar", entrega, outra)).status).toBe(403);
    expect((await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [] })).status).toBe(200);
    expect((await pedir("entregar", entrega)).status).toBe(200);
    expect((await pedir("entregar", entrega)).status).toBe(200);
    const t = await srv.json<{ turno: { estado: string; machineId: string } }>("GET", `turnos/${plano.turnoId}`);
    expect(t.turno.estado).toBe("concluido"); expect(t.turno.machineId).toBe(machineId);
  });
  it("Parar pela web chega à próxima renovação da máquina", async () => {
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Pode trabalhar" });
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno };
    expect(plano.turnoId).toBe(enviada.ids.turno);
    await srv.json("POST", `conversas/${conversaId}/parar`, {});
    const renovada = await (await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [] })).json() as { ativo: boolean };
    expect(renovada.ativo).toBe(false);
    await pedir("entregar", { turnoId: plano.turnoId, machineId, seqLocal: 2, fala: { tipo: "texto", texto: "" }, resultado: {
      desfecho: "interrompido", texto: "", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    } });
    const t = await srv.json<{ turno: { motivoInterrupcao: string } }>("GET", `turnos/${plano.turnoId}`);
    expect(t.turno.motivoInterrupcao).toBe("parado_pela_pessoa");
  });
  it("NOD-199: com um turno do Claude rodando, o anúncio de inventário liga o Codex sem derrubar o turno; o próximo plano do Codex é puxado", async () => {
    const pronto = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
    const codex = async () => (await srv.json<EstadoExecutor>("GET", "executor")).harnesses?.opcoes.find((h) => h.id === "codex-cli")?.inventario.estado;
    expect(await codex()).not.toBe("pronto");
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Turno longo do Claude" });
    const { plano } = await (await pedir("puxar")).json() as { plano: PlanoTurno };
    expect(plano.turnoId).toBe(enviada.ids.turno);
    expect(plano.harness).toBe("claude-cli");
    // A pessoa fez `codex login` no meio do turno: o app anuncia só o inventário.
    const r = await pedir("inventario", { nome: "Mac", versaoContrato: 1, inventario: pronto, harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(await codex()).toBe("pronto");
    // O turno do Claude segue e termina normalmente.
    const entrega: Entrega = { turnoId: plano.turnoId, machineId, seqLocal: 3, fala: { tipo: "texto", texto: "Feito" }, resultado: {
      desfecho: "sucesso", texto: "Feito", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
    } };
    expect((await pedir("entregar", entrega)).status).toBe(200);
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${plano.turnoId}`)).turno.estado).toBe("concluido");
    // O próximo turno, com o bot no Codex, sai para o Mac.
    expect((await srv.chamar("PATCH", `agentes/${agenteId}`, { harness: "codex-cli", modelo: "auto" })).status).toBe(200);
    const seguinte = await srv.json<RespostaMutacao>("POST", `conversas/${conversaId}/mensagens`, { texto: "Agora pelo Codex" });
    const proximo = await (await pedir("puxar")).json() as { plano: PlanoTurno };
    expect(proximo.plano).toMatchObject({ turnoId: seguinte.ids.turno, harness: "codex-cli", machineId });
    await srv.json("POST", `conversas/${conversaId}/parar`, {});
    await pedir("entregar", { ...entrega, turnoId: proximo.plano.turnoId, seqLocal: 4, resultado: { ...entrega.resultado, desfecho: "interrompido" } });
  });
  it("NOD-199: o anúncio de inventário sem conexão desta chave pede reconexão (409); app antigo recebe 426", async () => {
    const corpo = { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } };
    expect((await pedir("inventario", corpo, chave, { "x-nod-versao": "0.0.9" })).status).toBe(426);
    const terceira = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac C" });
    expect((await pedir("inventario", corpo, terceira.chave)).status).toBe(409);
    await srv.json("DELETE", `maquinas/chaves/${terceira.dados.id}`);
  });
  it("revogação da chave corta o acesso HTTP imediatamente", async () => {
    await srv.json("DELETE", `maquinas/chaves/${machineId}`);
    expect((await pedir("puxar")).status).toBe(401);
  });
});
