import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import { CAPACIDADES_GITHUB, COMANDO_GITHUB_NATIVO } from "../../src/contracts/github.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { autoriaPessoa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * ADR-048 (revisão de 2026-09-24) no servidor COMPARTILHADO de verdade, com dois Macs da mesma pessoa:
 * só o Mac que anunciou o gh tem as ferramentas do GitHub marcadas para rodar nele, e só ele puxa os
 * itens aprovados que rodam no gh. O servidor nunca disca a máquina: tudo é pedido do Mac.
 */
describeIntegracao("GitHub na máquina pela ponte HTTP (modo compartilhado)", () => {
  let srv: ServidorCompleto;
  let comGh = "", semGh = "", agenteId = "", conversaId = "", conectorId = "";
  const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
  const pedir = (nome: string, body: unknown, token: string) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const entrega = (plano: PlanoTurno, machineId: string, seqLocal: number): Entrega => ({ turnoId: plano.turnoId, machineId, seqLocal, fala: { tipo: "texto", texto: "ok" }, resultado: {
    desfecho: "sucesso", texto: "ok", sessaoCli: null, sinais, custoUsd: 0, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
  } });
  const dentro = <T>(fn: (d: Deps) => Promise<T>) => srv.app.dentro(srv.pessoa, fn);

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac com gh" });
    const b = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac sem gh" });
    comGh = a.chave; semGh = b.chave;
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Dev 1", descricao: "Revisa PRs" });
    agenteId = bot.agente.id; conversaId = bot.conversa.id;
    const inventario = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
    expect((await pedir("conectar", { nome: "Mac com gh", versaoContrato: 1, inventario, github: { gh: true } }, comGh)).status).toBe(200);
    expect((await pedir("conectar", { nome: "Mac sem gh", versaoContrato: 1, inventario }, semGh)).status).toBe(200);
  });

  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [agenteId], conversas: [conversaId] });
    await srv.desligar();
  });

  it("o gh anunciado por um Mac da pessoa faz o GitHub nascer sem configuração (sonda sem rede nem processo)", async () => {
    expect(await dentro((d) => d.services.github?.prontoSemConfiguracao() ?? Promise.resolve(null))).toBe("gh");
    const conector = await dentro(async (d) => {
      const c = await d.repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, declaracao: "toca" });
      const sonda = await d.services.conectores.sondar(c!);
      expect(sonda).toMatchObject({ ok: true });
      await d.repos.conectores.registrarSonda(c!.id, sonda.ok ? { ok: true, catalogo: sonda.ferramentas, agora: Date.now() } : { ok: false, motivo: sonda.motivo, agora: Date.now() });
      const consentimento = await d.repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(srv.pessoa.pessoaId), kind: "texto", texto: "pode", confianca: "confiavel" });
      for (const cap of CAPACIDADES_GITHUB) await d.repos.concessoes.conceder({ agenteId, conectorId: c!.id, capacidade: cap.nome, mensagemId: consentimento!.id });
      return c!;
    });
    conectorId = conector.id;
  });

  it("o plano de um turno puxado pelo Mac COM gh marca o GitHub para a máquina; pelo Mac SEM gh, não", async () => {
    await srv.json("POST", `conversas/${conversaId}/mensagens`, { texto: "revise o PR 466" });
    const a = await (await pedir("puxar", {}, comGh)).json() as { plano: PlanoTurno };
    expect(a.plano.catalogo.ferramentas.filter((f) => f.conectorId === conectorId).every((f) => f.execucao === "maquina")).toBe(true);
    expect((await pedir("entregar", entrega(a.plano, a.plano.machineId, 1), comGh)).status).toBe(200);

    await srv.json("POST", `conversas/${conversaId}/mensagens`, { texto: "e o 467?" });
    const b = await (await pedir("puxar", {}, semGh)).json() as { plano: PlanoTurno };
    expect(b.plano.catalogo.ferramentas.some((f) => f.execucao === "maquina")).toBe(false);
    expect((await pedir("entregar", entrega(b.plano, b.plano.machineId, 1), semGh)).status).toBe(200);
  });

  it("item aprovado que roda no gh: só o Mac com gh o puxa, só quem puxou relata, e o relato fecha a decisão", async () => {
    const itemId = await dentro(async (d) => {
      const decisao = await d.repos.decisoes.criar({ tipo: "aprovacao", agenteId, conversaId, turnoId: null, prazoDecisaoEm: Date.now() + 3_600_000, frase: "Comentar no PR 466" });
      const [item] = await d.repos.itensAprovacao.criarLote(decisao!.id, [{ idx: 0, texto: "Faltou teste", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 466, texto: "Faltou teste" }, execucao: "maquina" }, origemSensivel: false }]);
      await d.repos.decisoes.decidir(decisao!.id, { por: srv.pessoa.pessoaId, agora: Date.now() });
      return item!.id;
    });
    expect(await (await pedir("itens-locais", {}, semGh)).json()).toEqual({ itens: [] });
    const puxados = await (await pedir("itens-locais", {}, comGh)).json() as { itens: { itemId: string; capacidade: string; argumentos: Record<string, unknown> }[] };
    expect(puxados.itens).toEqual([{ itemId, capacidade: "pr_comentar", argumentos: { repositorio: "acme/nod", numero: 466, texto: "Faltou teste" } }]);
    // Reservado para quem puxou: o outro Mac nem vê, nem relata. Nem o próprio Mac recebe de novo
    // enquanto a reserva vive (revisão 2026-09-25: comentar duas vezes no PR).
    expect(await (await pedir("itens-locais", {}, comGh)).json()).toEqual({ itens: [] });
    expect((await pedir("itens-locais/resultado", { itemId, desfecho: "executado" }, semGh)).status).toBe(403);
    expect((await pedir("itens-locais/resultado", { itemId, desfecho: "executado" }, comGh)).status).toBe(200);
    expect(await dentro((d) => d.repos.itensAprovacao.buscar(itemId))).toMatchObject({ desfecho: "executado" });
    const mensagens = await dentro((d) => d.repos.mensagens.listarDaConversa(conversaId, 50));
    expect(mensagens.some((m) => m.kind === "resultado_aprovacao")).toBe(true);
    expect(await (await pedir("itens-locais", {}, comGh)).json()).toEqual({ itens: [] });
  });
});

describeIntegracao("GitHub pelo gh no modo LOCAL: só a dona da máquina (NOD_DONO_DA_MAQUINA)", () => {
  let dir = "";
  let srv: ServidorCompleto | null = null;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nod-ghlocal-"));
    writeFileSync(join(dir, "gh"), "#!/bin/sh\n[ \"$1 $2\" = \"auth status\" ] && exit 0\nexit 9\n");
    chmodSync(join(dir, "gh"), 0o755);
  });

  afterAll(async () => {
    if (srv) {
      await srv.fechar();
      await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
      await srv.desligar();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("o gh deste Mac serve à pessoa nomeada; qualquer outra do cadastro não ganha o login dela; sem nome, ninguém", async () => {
    const pronto = (s: ServidorCompleto, escopo: { tenantId: string; pessoaId: string }) => s.app.dentro(escopo, (d) => d.services.github?.prontoSemConfiguracao() ?? Promise.resolve(null));
    const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
    srv = await servidorCompleto({ env: { NOD_EXECUTOR: "catcher", PATH: `${dir}:/usr/bin:/bin`, NOD_DONO_DA_MAQUINA: PESSOA_MARLON } });
    expect(await pronto(srv, MARLON)).toBe("gh");
    expect(await pronto(srv, srv.pessoa)).toBeNull();
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
    srv = await servidorCompleto({ env: { NOD_EXECUTOR: "catcher", PATH: `${dir}:/usr/bin:/bin`, NOD_DONO_DA_MAQUINA: "" } });
    expect(await pronto(srv, MARLON)).toBeNull();
  });
});
