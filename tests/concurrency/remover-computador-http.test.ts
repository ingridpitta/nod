import { afterAll, beforeAll, expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";

/**
 * ADA-245 (QA do PR #694): remover um computador pelo app inteiro (boot, rotas, puxada do motor). Cobre os ramos de
 * `removerDepoisDoCommit` e do `saiu` em compor.ts, que a paridade (rotas soltas, sem compor) não vê: ligado sai da conta
 * só quando ele confirma; desligado sem "Continuar ligado" sai da conta na hora; com "Continuar ligado" a chave fica.
 */
describeIntegracao("remover o nod de um computador pela API real (ADA-245)", () => {
  let srv: ServidorCompleto;
  const inventario = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const pedir = (nome: string, chave: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, { method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body) });
  const novo = (nome: string) => srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome });
  const ligar = async (nome: string, chave: string) => expect((await pedir("conectar", chave, { nome, plataforma: "win32", versaoContrato: 1, inventario })).status).toBe(200);

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20", NOD_ONBOARDING_TEXTO: "1" } });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (t) => {
      await vincularEscopo(t, srv.pessoa);
      await t`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await srv.desligar();
  });

  it("ligado, saindo da conta: a puxada pede para desconectar e a chave só cai quando ele confirma", async () => {
    const pc = await novo("Notebook");
    await ligar("Notebook", pc.chave);
    const r = await srv.json("POST", `maquinas/${pc.dados.id}/remover`, { manterIas: false, manterConexao: false });
    expect(r).toMatchObject({ ok: true, saiuDaConta: true, aguardandoComputador: true });
    expect(await (await pedir("contas", pc.chave)).json()).toMatchObject({ desconectar: true, remover: { manterIas: false, manterConexao: false } });
    expect((await pedir("contas/saiu", pc.chave, { impressoes: [], desconectada: true })).status).toBe(200);
    expect((await pedir("contas", pc.chave)).status).toBe(401);
  });

  it("ligado, continuar ligado: a puxada não desconecta, e a confirmação não tira a chave", async () => {
    const pc = await novo("Mac");
    await ligar("Mac", pc.chave);
    await srv.json("POST", `maquinas/${pc.dados.id}/remover`, { manterIas: true, manterConexao: true });
    expect(await (await pedir("contas", pc.chave)).json()).toMatchObject({ desconectar: false, remover: { manterIas: true, manterConexao: true } });
    expect((await pedir("contas/saiu", pc.chave, { impressoes: [], desconectada: true })).status).toBe(200);
    expect((await pedir("contas", pc.chave)).status).toBe(200);
  });

  it("desligado: sem continuar ligado sai da conta na hora; com continuar ligado o pedido espera ele voltar", async () => {
    const sai = await novo("PC desligado");
    expect(await srv.json("POST", `maquinas/${sai.dados.id}/remover`, { manterIas: false, manterConexao: false })).toMatchObject({ saiuDaConta: true, aguardandoComputador: false });
    expect((await pedir("contas", sai.chave)).status).toBe(401);
    const fica = await novo("PC desligado 2");
    expect(await srv.json("POST", `maquinas/${fica.dados.id}/remover`, { manterIas: false, manterConexao: true })).toMatchObject({ saiuDaConta: false, aguardandoComputador: true });
    // Ele liga depois: a chave segue valendo e o pedido guardado vem na primeira puxada.
    await ligar("PC desligado 2", fica.chave);
    expect(await (await pedir("contas", fica.chave)).json()).toMatchObject({ desconectar: false, remover: { manterIas: false, manterConexao: true } });
  });
});
