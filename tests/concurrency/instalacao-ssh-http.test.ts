import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { InstalacaoCriadaDto, InstalacaoSshDto, PedidoDeInstalacao } from "../../src/contracts/instalacoes-ssh.ts";

/**
 * NOD-94 (emenda 11 da ADR-090) de ponta a ponta pelo app composto: a tela pede a instalação por SSH, manda a credencial
 * cifrada, a instaladora (uma máquina da pessoa) a recebe UMA vez e relata o progresso, e a máquina nova pareia com o
 * convite do pedido (papel computador, sem digitar código) — o pedido fica `pronta` e o endereço é guardado. Commita
 * (a chave da máquina é validada na transação dela); limpa as linhas da pessoa ao fim.
 */
describeIntegracao("instalação por SSH pela tela e pela ponte (NOD-94, HTTP real)", () => {
  let srv: ServidorCompleto;
  let chave = "", machineId = "";
  const PUB = "TUlJQklqQU5CZ2txaGtpRzl3MEJBUUVGQUFPQ0FROEFNSUlCQ2dLQ0FRRUE=";
  const CIFRADO = { chave: "QUJD", iv: "REVG", dados: "R0hJ" };
  const IMP = `SHA256:${"k".repeat(43)}`;
  const inventario = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const maquina = (nome: string, body: unknown = {}, token = chave) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const publica = (caminho: string, corpo: unknown) =>
    fetch(`${srv.url}/api/${caminho}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
  const outraPessoa = () => srv.sessaoDe({ tenantId: TENANT_PADRAO, pessoaId: randomUUID() });
  /** A máquina nova roda o script com o convite: pede e troca (o convite do pedido aprova sozinho). */
  const parear = async (nome: string, convite: string) => {
    const p = await publica("pareamento/dispositivo", { nome, plataforma: "linux", convite });
    if (p.status !== 201) return { status: p.status, corpo: await p.json() as Record<string, unknown> };
    const { codigoDispositivo } = (await p.json()) as { codigoDispositivo: string };
    const t = await publica("pareamento/dispositivo/trocar", { codigoDispositivo });
    return { status: t.status, corpo: await t.json() as Record<string, unknown> };
  };

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-bots" });
    chave = a.chave; machineId = a.dados.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from maquinas_ssh where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await srv.desligar();
  });

  it("sem instaladora viva: 409 sem_instaladora; a entrada que viraria opção do ssh é recusada", async () => {
    expect((await srv.chamar("POST", "maquinas/ssh", { host: "vm.exemplo.com", usuario: "root", metodo: "chave" })).status).toBe(409);
    expect((await srv.chamar("POST", "maquinas/ssh", { host: "-oProxyCommand=sh", usuario: "root", metodo: "chave" })).status).toBe(400);
    expect((await srv.chamar("POST", "maquinas/ssh", { host: "vm.exemplo.com", usuario: "-l", metodo: "chave" })).status).toBe(400);
    expect((await srv.chamar("POST", "maquinas/ssh", { host: "vm.exemplo.com", porta: 0, usuario: "root", metodo: "chave" })).status).toBe(400);
    expect((await srv.chamar("POST", "maquinas/ssh", { host: "vm.exemplo.com", usuario: "root", metodo: "telnet" })).status).toBe(400);
  });

  it("pedido → credencial uma vez → a instaladora recebe e relata → a máquina nova pareia sozinha → pronta", async () => {
    const c = await maquina("conectar", { nome: "vm-bots", plataforma: "linux", versaoContrato: 1, inventario });
    expect(await c.json()).toMatchObject({ papel: "motor", instalacoes: true });
    // Revisão do PR #579 (codex): a instaladora de antes da NOD-344 (sem `servidorProprio`) não sabe usar a própria origem;
    // sem NOD_URL_PUBLICA o pedido é recusado na hora (409), em vez de falhar lá no meio.
    expect(await (await maquina("instalacoes", { chavePublica: PUB })).json()).toEqual({ pedidos: [] });
    const antiga = await srv.chamar("POST", "maquinas/ssh", { host: "vm.exemplo.com", usuario: "root", metodo: "senha" });
    expect(antiga.status).toBe(409);
    expect(await antiga.json()).toMatchObject({ codigo: "instaladora_antiga" });
    expect(await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()).toEqual({ pedidos: [] });
    expect((await maquina("instalacoes", { chavePublica: "não é base64" })).status).toBe(400);

    const instaladoras = await srv.json<{ instaladoras: { id: string; nome: string }[] }>("GET", "maquinas/ssh/instaladoras");
    expect(instaladoras.instaladoras).toEqual([{ id: machineId, nome: "vm-bots", plataforma: "linux" }]);

    // NOD-344: sem NOD_URL_PUBLICA, o endereço do script NUNCA vem do header de quem pediu: vai null e a instaladora usa
    // a origem dela. Aqui o pedido chega com um X-Forwarded-Host forjado.
    // `fetch` do Node normaliza Host; node:http preserva o valor forjado e prova o caso exato do critério.
    const r = await new Promise<{ status: number; corpo: InstalacaoCriadaDto }>((resolve, reject) => {
      const req = request(`${srv.url}/api/t/${srv.pessoa.tenantId}/maquinas/ssh`, {
        method: "POST",
        headers: { cookie: srv.pessoa.cookie, "content-type": "application/json", host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
      }, (res) => {
        const pedacos: Buffer[] = [];
        res.on("data", (p: Buffer) => pedacos.push(p));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, corpo: JSON.parse(Buffer.concat(pedacos).toString()) as InstalacaoCriadaDto }));
      });
      req.on("error", reject);
      req.end(JSON.stringify({ host: "vm.exemplo.com", usuario: "root", metodo: "senha" }));
    });
    expect(r.status).toBe(201);
    const criado = r.corpo;
    expect(criado).toMatchObject({ origemId: machineId, chavePublica: PUB });

    // Outra pessoa não vê nem manda credencial.
    expect((await srv.chamar("GET", `maquinas/ssh/${criado.id}`, undefined, outraPessoa())).status).toBe(404);
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO }, outraPessoa())).status).toBe(404);

    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: { chave: "x y" } })).status).toBe(400);
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO })).status).toBe(204);
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO })).status).toBe(409);

    const { pedidos } = (await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()) as { pedidos: PedidoDeInstalacao[] };
    expect(pedidos).toEqual([expect.objectContaining({ id: criado.id, host: "vm.exemplo.com", porta: 22, usuario: "root", metodo: "senha", impressaoConhecida: null, cifrado: CIFRADO, servidor: null })]);
    const convite = pedidos[0]!.convite;
    // O cifrado saiu: a próxima puxada não o traz, e a tela nunca o vê.
    expect(await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()).toEqual({ pedidos: [] });
    expect(JSON.stringify(await srv.json("GET", `maquinas/ssh/${criado.id}`))).not.toContain(CIFRADO.dados);

    expect((await maquina("instalacoes/progresso", { id: criado.id, etapa: "conferencia", impressao: IMP })).status).toBe(200);
    expect((await maquina("instalacoes/progresso", { id: criado.id, etapa: "inventada" })).status).toBe(409);
    expect((await maquina("instalacoes/progresso", { id: criado.id })).status).toBe(400);
    expect((await maquina("instalacoes/progresso", { id: criado.id, etapa: "pareamento" })).status).toBe(200);
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "pareando", etapa: "pareamento" });

    const troca = await parear("vm-computador", convite);
    expect(troca.status).toBe(201);
    expect(troca.corpo).toMatchObject({ papel: "computador" });
    const nova = troca.corpo.machineId as string;
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "pronta", maquinaId: nova });
    // O endereço e a host key ficam guardados para a reinstalação.
    const [linha] = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ maquina_id: string; impressao_host: string }[]>`select maquina_id, impressao_host from maquinas_ssh where lower(host) = 'vm.exemplo.com'`;
    });
    expect(linha).toEqual({ maquina_id: nova, impressao_host: IMP });

    // O convite aprova UM pedido: reusado, 401.
    expect((await parear("intrusa", convite)).status).toBe(401);

    // A só-computador não é instaladora.
    const chaveNova = troca.corpo.chave as string;
    await maquina("conectar", { nome: "vm-computador", plataforma: "linux", versaoContrato: 1, inventario, papel: "computador" }, chaveNova);
    expect((await maquina("instalacoes", { chavePublica: PUB }, chaveNova)).status).toBe(404);
  });

  it("já há uma só-computador: 409 ja_tem_computador; com substituir, a reinstalação leva a impressão guardada", async () => {
    await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true });
    const r = await srv.chamar("POST", "maquinas/ssh", { host: "VM.exemplo.com", usuario: "root", metodo: "chave" });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: "ja_tem_computador", maquina: { nome: "vm-computador" } });
    const s = await srv.chamar("POST", "maquinas/ssh", { host: "VM.exemplo.com", usuario: "root", metodo: "chave", substituir: true });
    expect(s.status).toBe(201);
    const criado = (await s.json()) as InstalacaoCriadaDto;
    await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO });
    const { pedidos } = (await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()) as { pedidos: PedidoDeInstalacao[] };
    expect(pedidos[0]).toMatchObject({ id: criado.id, impressaoConhecida: IMP });

    // Host key trocada: a tela vê as duas e confia na nova (a guardada muda).
    const nova = `SHA256:${"n".repeat(43)}`;
    expect((await maquina("instalacoes/progresso", { id: criado.id, erro: "chave_do_servidor_mudou", impressao: nova })).status).toBe(200);
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "erro", impressoes: { antiga: IMP, nova } });
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/confiar-nova`, {}, outraPessoa())).status).toBe(404);
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/confiar-nova`, {})).status).toBe(204);
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "esperando", pedeCredencial: true });
    const [linha] = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ impressao_host: string }[]>`select impressao_host from maquinas_ssh where lower(host) = 'vm.exemplo.com'`;
    });
    expect(linha?.impressao_host).toBe(nova);

    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/cancelar`, {})).status).toBe(204);
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/cancelar`, {})).status).toBe(409);
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "cancelada" });

    // NOD-94 (QA): cancelado, o convite morre — o script que ainda rodava lá não pareia (nem tira a vm-computador, com substituir).
    expect((await parear("tardia", pedidos[0]!.convite)).status).not.toBe(201);
    const vivas = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return tx<{ nome: string }[]>`select nome from maquina_tokens where papel = 'computador' and revogado_em is null order by nome`;
    });
    expect(vivas.map((v) => v.nome)).toEqual(["vm-computador"]);
  });

  it("NOD-94 (QA): o convite cancelado também derruba o pedido que já chegou com ele e ainda não trocou", async () => {
    await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true });
    const r = await srv.chamar("POST", "maquinas/ssh", { host: "outra.exemplo.com", usuario: "root", metodo: "senha", substituir: true });
    expect(r.status).toBe(201);
    const criado = (await r.json()) as InstalacaoCriadaDto;
    await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO });
    const { pedidos } = (await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()) as { pedidos: PedidoDeInstalacao[] };
    const p = await publica("pareamento/dispositivo", { nome: "a-meio-caminho", plataforma: "linux", convite: pedidos[0]!.convite });
    expect(p.status).toBe(201);
    const { codigoDispositivo } = (await p.json()) as { codigoDispositivo: string };
    expect((await srv.chamar("POST", `maquinas/ssh/${criado.id}/cancelar`, {})).status).toBe(204);
    expect((await publica("pareamento/dispositivo/trocar", { codigoDispositivo })).status).not.toBe(201);
  });

  it("NOD-344: a instaladora relatou erro: o convite morre e o script que seguiu rodando lá não pareia", async () => {
    await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true });
    const r = await srv.chamar("POST", "maquinas/ssh", { host: "falhou.exemplo.com", usuario: "root", metodo: "senha", substituir: true });
    expect(r.status).toBe(201);
    const criado = (await r.json()) as InstalacaoCriadaDto;
    await srv.chamar("POST", `maquinas/ssh/${criado.id}/credencial`, { cifrado: CIFRADO });
    const { pedidos } = (await (await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).json()) as { pedidos: PedidoDeInstalacao[] };
    expect((await maquina("instalacoes/progresso", { id: criado.id, erro: "tempo_esgotado" })).status).toBe(200);
    expect(await srv.json<InstalacaoSshDto>("GET", `maquinas/ssh/${criado.id}`)).toMatchObject({ estado: "erro", motivo: "tempo_esgotado" });
    expect((await parear("tardia-do-erro", pedidos[0]!.convite)).status).not.toBe(201);
  });

  it("o comando manual (\"Prefere fazer você mesmo?\"): o convite com papel computador pareia sozinho como só computador", async () => {
    const { convite } = await srv.json<{ convite: string }>("POST", "maquinas/convites", { papel: "computador", substituir: true });
    const troca = await parear("vm-manual", convite);
    expect(troca.status).toBe(201);
    expect(troca.corpo).toMatchObject({ papel: "computador" });
  });

  it("NOD-344: aposentar revoga só a chave do próprio Bearer; depois dela, a chave antiga leva 401", async () => {
    const velha = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-velha" });
    const r = await maquina("aposentar", {}, velha.chave);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, revogou: true });
    expect((await maquina("aposentar", {}, velha.chave)).status).toBe(401);
    // A chave da instaladora (outra máquina da pessoa) segue viva.
    expect((await maquina("instalacoes", { chavePublica: PUB, servidorProprio: true })).status).toBe(200);
  });

  it("NOD-344 (ADR-121): a VM ligada à nuvem não aposenta a própria chave: 409 maquina_na_nuvem e a chave segue viva", async () => {
    const vm = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-nuvem" });
    // Cada execução ganha uma referência própria: se uma anterior cair antes da limpeza, o índice global da instância não
    // transforma a próxima execução num falso vermelho.
    const projeto = `nod-344-${randomUUID().slice(0, 8)}`;
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      const r = criarRepos(tx, srv.pessoa);
      const cred = await r.credenciaisNuvem.gravar({ provedor: "gcp", projeto, contaServico: "x@y.iam.gserviceaccount.com", chaveCifrada: "cifrada" });
      await r.maquinasNuvem.criarConectada({ credencialId: cred.id, maquinaId: vm.dados.id, ref: { projeto, zona: "southamerica-east1-a", nome: "vm-344" }, agora: Date.now() });
    });
    const r = await maquina("aposentar", {}, vm.chave);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ codigo: "maquina_na_nuvem" });
    expect((await maquina("aposentar", {}, vm.chave)).status).toBe(409); // a chave segue valendo (não virou 401)
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from maquinas_nuvem where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`delete from credenciais_nuvem where owner_id = ${srv.pessoa.pessoaId}`;
    });
  });
});
